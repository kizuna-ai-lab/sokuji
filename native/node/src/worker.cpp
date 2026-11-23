// HandleWorker and the Job plumbing it drives: Submit (JS thread), Run (worker thread), the
// per-job thread-safe function that carries callback events and the settle event back.
#include "worker.h"

#include "errors.h"

#include <exception>
#include <set>
#include <utility>

namespace sk_node {

// ---- the two halves of a job and the link between them -----------------------------------

// One message from the worker thread to the JS thread: a callback call, or (done set) the
// job itself, handed over to be settled.
struct JobEvent {
    std::function<void(Napi::Env, Napi::Function)> call;
    std::unique_ptr<Job> done;
};

void DeliverJobEvent(Napi::Env env, Napi::Function, JobJs *js, JobEvent *raw);
using JobTsfn = Napi::TypedThreadSafeFunction<JobJs, JobEvent, DeliverJobEvent>;

// Shared by both halves. The worker thread posts through `tsfn` only while `open`, and only
// under `mu`. `open` goes false when the job hands itself over (its last post) or when the
// environment starts tearing down: a cleanup hook registered right after the thread-safe
// function runs before Node's own hook deletes that function, so from then on no thread
// touches it.
struct JobLink {
    std::mutex mu;
    JobTsfn tsfn;
    bool open = true;
    std::shared_ptr<std::atomic_bool> cancel;
};

// The JS half. Owned by the job's thread-safe function: its finalizer deletes it.
struct JobJs {
    explicit JobJs(Napi::Env env) : deferred(Napi::Promise::Deferred::New(env)) {}

    Napi::Promise::Deferred deferred;
    bool settled = false;            // the promise is resolved or rejected
    Napi::ObjectReference owner;     // keeps the handle object alive until the job settles
    Napi::FunctionReference callback;
    Napi::ObjectReference signal;
    Napi::FunctionReference listener;   // the 'abort' listener added to `signal`
    Napi::Error thrown;              // the first exception the callback threw, if any
    std::shared_ptr<JobLink> link;
};

namespace {

// Environment cleanup: the job's thread-safe function is about to be deleted. Close the link
// so the worker thread never posts to it again, and stop the native work.
void CloseLink(void *arg) {
    auto *link = static_cast<JobLink *>(arg);
    std::lock_guard<std::mutex> lock(link->mu);
    link->open = false;
    link->cancel->store(true);
}

void RemoveAbortListener(Napi::Env env, JobJs &js) {
    if (js.signal.IsEmpty() || js.listener.IsEmpty()) return;
    try {
        Napi::Object signal = js.signal.Value();
        signal.Get("removeEventListener").As<Napi::Function>().Call(
            signal, {Napi::String::New(env, "abort"), js.listener.Value()});
    } catch (const Napi::Error &) {
        // The listener only sets a flag nobody reads after this; leaving it is harmless.
    }
}

}  // namespace

// The friend of Job that drives it: the worker loop, Submit and the settle event.
struct JobAccess {
    static void Run(Job &job) { job.Run(); }
    static std::shared_ptr<JobLink> &Link(Job &job) { return job.link_; }

    // JS thread: settles the job's promise once. When a callback threw, the job was cancelled
    // because of it, and whatever settle() chose, the promise rejects with a NativeError whose
    // `cause` is the thrown value: the one the native call ended with (normally
    // SK_ERR_CANCELLED with the library's "cancelled by the callback"), or, when the call had
    // already succeeded before the flag reached it, SK_ERR_CANCELLED with kCancelledByCallback.
    // As in the Python binding, where an exception in a callback cancels the call and surfaces
    // as SK_ERR_CANCELLED.
    static void SettleOnce(JobJs &js, Job &job, bool ok, Napi::Value value) {
        if (js.settled) return;
        js.settled = true;
        if (js.thrown.IsEmpty()) {
            if (ok) {
                js.deferred.Resolve(value);
            } else {
                js.deferred.Reject(value);
            }
            return;
        }
        Napi::Env env = js.deferred.Env();
        Napi::Error err = job.failed()
                              ? MakeNativeError(env, job.status_, StatusText(job.what_, job.last_error_))
                              : MakeNativeError(env, SK_ERR_CANCELLED, StatusText(job.what_, kCancelledByCallback));
        // Non-enumerable, as `new Error(message, { cause })` defines it.
        err.Value().DefineProperty(Napi::PropertyDescriptor::Value(
            "cause", js.thrown.Value(), static_cast<napi_property_attributes>(napi_writable | napi_configurable)));
        js.deferred.Reject(err.Value());
    }

    // Worker thread (or the JS thread, for a job posted after stop): hands the finished job
    // to its JS half. When there is nobody to settle it (a native-only job, or the
    // environment is going away) the job is destroyed here instead, outside the lock.
    static void Complete(std::unique_ptr<Job> job) {
        std::shared_ptr<JobLink> link = job->link_;
        if (!link) return;
        auto ev = std::make_unique<JobEvent>();
        ev->done = std::move(job);
        std::lock_guard<std::mutex> lock(link->mu);
        if (!link->open) return;   // `lock` is released before `ev` is destroyed
        link->open = false;        // the job's last post
        const napi_status st = link->tsfn.NonBlockingCall(ev.get());
        if (st == napi_ok) ev.release();
        // Finalized once the queue (this event included) drains. A closing function has
        // already dropped this thread's count in the failed call.
        if (st != napi_closing) link->tsfn.Release();
    }

    // JS thread: the settle event.
    static void Finish(Napi::Env env, JobJs &js, std::unique_ptr<Job> job) {
        napi_remove_env_cleanup_hook(env, CloseLink, js.link.get());
        RemoveAbortListener(env, js);
        job->js_ = &js;
        try {
            job->settle(env);
        } catch (const Napi::Error &e) {
            SettleOnce(js, *job, false, e.Value());
        } catch (const std::exception &e) {
            SettleOnce(js, *job, false, Napi::Error::New(env, e.what()).Value());
        }
        if (!js.settled) {
            SettleOnce(js, *job, false,
                       MakeNativeError(env, SK_ERR_INTERNAL, StatusText(job->what_, "the job did not settle")).Value());
        }
        job->js_ = nullptr;
        // Drop the references now rather than when the thread-safe function is finalized.
        js.owner.Reset();
        js.callback.Reset();
        js.signal.Reset();
        js.listener.Reset();
    }

    static void Settle(Job &job, bool ok, Napi::Value value) { SettleOnce(*job.js_, job, ok, value); }
};

void DeliverJobEvent(Napi::Env env, Napi::Function, JobJs *js, JobEvent *raw) {
    std::unique_ptr<JobEvent> ev(raw);
    // A null env: the environment is gone and Node is emptying the queue. Free the event
    // (and a job it carries) without touching JS.
    if (static_cast<napi_env>(env) == nullptr || js == nullptr) return;
    if (ev->done) {
        try {
            JobAccess::Finish(env, *js, std::move(ev->done));
        } catch (...) {
            // Only N-API failures land here (the environment is stopping): nobody is left to
            // tell, and nothing may unwind into Node.
        }
        return;
    }
    if (js->settled || js->callback.IsEmpty() || !js->thrown.IsEmpty() || !ev->call) return;
    // A throwing callback cancels the job; its promise then rejects with a NativeError whose
    // `cause` is what was thrown (JobAccess::SettleOnce).
    try {
        ev->call(env, js->callback.Value());
    } catch (Napi::Error &e) {
        js->thrown = std::move(e);
        js->link->cancel->store(true);
    } catch (const std::exception &e) {
        js->thrown = Napi::Error::New(env, e.what());
        js->link->cancel->store(true);
    }
}

// ---- Job ------------------------------------------------------------------------------------

Job::~Job() = default;

void Job::Fail(const char *what, sk_status status) {
    const char *last = sk_last_error();
    Fail(what, status, last ? last : "");
}

void Job::Fail(const char *what, sk_status status, std::string last_error) {
    what_ = what;
    status_ = status;
    last_error_ = std::move(last_error);
}

bool Job::Emit(std::function<void(Napi::Env, Napi::Function)> call) {
    if (!link_) return false;
    auto ev = std::make_unique<JobEvent>();
    ev->call = std::move(call);
    std::lock_guard<std::mutex> lock(link_->mu);
    if (!link_->open || link_->tsfn.NonBlockingCall(ev.get()) != napi_ok) return false;
    ev.release();
    return true;
}

void Job::Resolve(Napi::Value value) { JobAccess::Settle(*this, true, value); }

void Job::Reject(Napi::Value error) { JobAccess::Settle(*this, false, error); }

void Job::RejectStatus(Napi::Env env) {
    Reject(MakeNativeError(env, status_, StatusText(what_, last_error_)).Value());
}

void Job::Run() {
    try {
        if (cancel->load()) {
            Fail(what_, SK_ERR_CANCELLED, kCancelledBeforeStart);
        } else {
            execute();
        }
    } catch (const std::exception &e) {
        Fail(what_, SK_ERR_INTERNAL, e.what());
    } catch (...) {
        Fail(what_, SK_ERR_INTERNAL, "unknown C++ exception");
    }
}

// ---- free functions ---------------------------------------------------------------------------

Napi::Promise Resolved(Napi::Env env, Napi::Value value) {
    Napi::Promise::Deferred d = Napi::Promise::Deferred::New(env);
    d.Resolve(value);
    return d.Promise();
}

Napi::Promise Rejected(Napi::Env env, Napi::Value error) {
    Napi::Promise::Deferred d = Napi::Promise::Deferred::New(env);
    d.Reject(error);
    return d.Promise();
}

bool Aborted(const Napi::Object &signal) {
    return !signal.IsEmpty() && signal.Get("aborted").ToBoolean().Value();
}

Napi::Promise RejectedCancelled(Napi::Env env, const char *what) {
    return Rejected(env, MakeNativeError(env, SK_ERR_CANCELLED, StatusText(what, kCancelledBeforeStart)).Value());
}

Napi::Promise Submit(Napi::Env env, HandleWorker &worker, std::unique_ptr<Job> job, Napi::Object owner,
                     Napi::Function callback, Napi::Object signal) {
    if (Aborted(signal)) return RejectedCancelled(env, job->what());
    auto js = std::make_unique<JobJs>(env);
    if (!owner.IsEmpty()) js->owner = Napi::Persistent(owner);
    if (!callback.IsEmpty()) js->callback = Napi::Persistent(callback);
    if (!signal.IsEmpty()) {
        // The listener holds the flag, not the job: it may run after the job is gone.
        Napi::Function listener = Napi::Function::New(
            env, [cancel = job->cancel](const Napi::CallbackInfo &) { cancel->store(true); }, "onabort");
        Napi::Object once = Napi::Object::New(env);
        once.Set("once", true);
        signal.Get("addEventListener").As<Napi::Function>().Call(signal, {Napi::String::New(env, "abort"), listener, once});
        js->signal = Napi::Persistent(signal);
        js->listener = Napi::Persistent(listener);
    }

    auto link = std::make_shared<JobLink>();
    link->cancel = job->cancel;
    js->link = link;
    Napi::Promise promise = js->deferred.Promise();

    // From here the thread-safe function owns the JS half. Ref'd: a job in flight keeps the
    // event loop (and so the process) alive, as any pending I/O does.
    link->tsfn = JobTsfn::New(env, job->what(), 0, 1, js.get(), [](Napi::Env, void *, JobJs *j) { delete j; });
    JobJs *raw = js.release();
    if (napi_add_env_cleanup_hook(env, CloseLink, link.get()) != napi_ok) {
        RemoveAbortListener(env, *raw);
        link->tsfn.Release();
        throw Napi::Error::New(env, std::string(job->what()) + ": cannot register an environment cleanup hook");
    }
    JobAccess::Link(*job) = std::move(link);
    worker.post(std::move(job));
    return promise;
}

// ---- HandleWorker -------------------------------------------------------------------------

namespace {

// The live workers. Never destroyed: a worker may still unregister while the process exits.
struct Registry {
    std::mutex mu;
    std::set<HandleWorker *> live;
};

Registry &registry() {
    static Registry *r = new Registry();
    return *r;
}

}  // namespace

HandleWorker::HandleWorker(napi_env owner) : owner_(owner) {
    {
        Registry &r = registry();
        std::lock_guard<std::mutex> lock(r.mu);
        r.live.insert(this);
    }
    try {
        thread_ = std::thread([this] { Loop(); });
    } catch (...) {
        Registry &r = registry();
        std::lock_guard<std::mutex> lock(r.mu);
        r.live.erase(this);
        throw;
    }
}

HandleWorker::~HandleWorker() {
    if (thread_.joinable() && thread_.get_id() == std::this_thread::get_id()) {
        thread_.detach();   // never: owners are destroyed on the JS thread; but never terminate()
    } else {
        stopAndJoin();
    }
    Registry &r = registry();
    std::lock_guard<std::mutex> lock(r.mu);
    r.live.erase(this);
}

void HandleWorker::post(std::unique_ptr<Job> job) {
    {
        std::lock_guard<std::mutex> lock(mu_);
        if (!stop_queued_) {
            queue_.push_back(std::move(job));
            cv_.notify_one();
            return;
        }
    }
    // Nothing will run it: settle it as cancelled, here (no native call is made).
    job->cancel->store(true);
    JobAccess::Run(*job);
    JobAccess::Complete(std::move(job));
}

void HandleWorker::cancelAll() {
    std::lock_guard<std::mutex> lock(mu_);
    for (const std::unique_ptr<Job> &job : queue_) {
        if (job) job->cancel->store(true);
    }
    if (running_cancel_) running_cancel_->store(true);
}

void HandleWorker::requestStop() {
    std::lock_guard<std::mutex> lock(mu_);
    if (stop_queued_) return;
    stop_queued_ = true;
    queue_.push_back(nullptr);
    cv_.notify_one();
}

void HandleWorker::stopAndJoin() {
    requestStop();
    if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) thread_.join();
}

void HandleWorker::ForEachLive(const std::function<void(HandleWorker &)> &fn) {
    Registry &r = registry();
    std::lock_guard<std::mutex> lock(r.mu);
    for (HandleWorker *w : r.live) fn(*w);
}

void HandleWorker::Loop() {
    for (;;) {
        std::unique_ptr<Job> job;
        {
            std::unique_lock<std::mutex> lock(mu_);
            cv_.wait(lock, [this] { return !queue_.empty(); });
            job = std::move(queue_.front());
            queue_.pop_front();
            if (!job) return;   // the stop sentinel: nothing is queued behind it
            running_cancel_ = job->cancel;
        }
        JobAccess::Run(*job);
        {
            std::lock_guard<std::mutex> lock(mu_);
            running_cancel_.reset();
        }
        JobAccess::Complete(std::move(job));
    }
}

HandleWorker &MiscWorker() {
    static HandleWorker *w = new HandleWorker(nullptr);
    return *w;
}

}  // namespace sk_node
