// Job: one call on a handle, run by that handle's HandleWorker (worker.h).
//
// A job has two halves that live on different threads:
//   - the native half, this class: the call's inputs (copied), execute() on the worker
//     thread, the outcome as plain C++ data. It never owns an N-API object, so it may be
//     destroyed on any thread.
//   - the JS half (JobJs, worker.cpp): the promise, the call's callback (onProgress,
//     onToken, onAudio), the AbortSignal listener and a reference that keeps the handle
//     object alive while the job is in flight. Created, used and destroyed on the JS thread.
// The halves talk through one thread-safe function per job, in FIFO order: every callback
// event the job emits during execute() reaches JS before its settle event, so pieces and
// chunks always arrive before the promise settles, and none after. The worker thread only
// ever posts to it in non-blocking mode; it never waits for JS.
//
// Cancellation is the shared atomic flag `cancel`: set by the call's AbortSignal, by
// HandleWorker::cancelAll(), by a throwing callback, or when the environment goes away. The
// native callbacks (sk_text_cb and friends) return !*cancel, so the library stops at its
// next callback with SK_ERR_CANCELLED. A job already cancelled when the worker reaches it
// never calls the library and rejects with SK_ERR_CANCELLED.
#pragma once

#include <napi.h>
#include <sokuji_native.h>

#include <atomic>
#include <functional>
#include <memory>
#include <string>

namespace sk_node {

class HandleWorker;
struct JobJs;       // worker.cpp: the JS half
struct JobLink;     // worker.cpp: the bridge between the halves
struct JobAccess;   // worker.cpp

// The last-error text of a job that was cancelled before the worker started it.
inline constexpr const char *kCancelledBeforeStart = "cancelled before it started";

class Job {
public:
    virtual ~Job();
    Job(const Job &) = delete;
    Job &operator=(const Job &) = delete;

    std::shared_ptr<std::atomic_bool> cancel = std::make_shared<std::atomic_bool>(false);

    // Worker thread. Not called when the job was cancelled before it started. May throw:
    // an exception becomes SK_ERR_INTERNAL with its what() as the error text.
    virtual void execute() = 0;

    // JS thread, exactly once, after every callback event of this job has been delivered.
    // Settles the promise with Resolve() / Reject() / RejectStatus(). Not called when the
    // environment is torn down first.
    virtual void settle(Napi::Env env) = 0;

    // The C function the job calls, as errors name it ("sk_asr_run").
    const char *what() const { return what_; }

protected:
    explicit Job(const char *what) : what_(what) {}

    // Worker thread, right after the failing call and before any other sk_* call: records
    // `status` and sk_last_error() (thread-local: only this thread, only now, has it).
    void Fail(const char *what, sk_status status);
    // Records `status` with an explicit last-error text.
    void Fail(const char *what, sk_status status, std::string last_error);
    bool failed() const { return status_ != SK_OK; }
    sk_status status() const { return status_; }

    // Worker thread: queue a call of the job's JS callback; `call` runs on the JS thread with
    // the callback. Never waits. Returns false when there is no JS side to deliver to (a
    // native-only job, or the environment is going away). If the callback throws, the job
    // is cancelled and its promise rejects with what was thrown.
    bool Emit(std::function<void(Napi::Env, Napi::Function)> call);

    // JS thread, inside settle(). If a callback of this job threw, each rejects with what it
    // threw instead.
    void Resolve(Napi::Value value);
    void Reject(Napi::Value error);
    void RejectStatus(Napi::Env env);   // the NativeError for the recorded status and text

private:
    friend struct JobAccess;   // worker.cpp: Submit, the worker loop, the settle event

    void Run();   // worker thread: execute(), or the cancelled-before-start outcome

    const char *what_;
    sk_status status_ = SK_OK;
    std::string last_error_;
    std::shared_ptr<JobLink> link_;   // null for a native-only job (nothing to settle)
    JobJs *js_ = nullptr;             // set only while settle() runs
};

// A promise already resolved with `value` / rejected with `error` (calls that finish
// without queuing anything: empty input, an unloaded handle, an aborted signal).
Napi::Promise Resolved(Napi::Env env, Napi::Value value);
Napi::Promise Rejected(Napi::Env env, Napi::Value error);

// True when `signal` is a non-empty object whose `aborted` is truthy.
bool Aborted(const Napi::Object &signal);

// The promise of a call whose signal was already aborted: SK_ERR_CANCELLED, nothing queued.
Napi::Promise RejectedCancelled(Napi::Env env, const char *what);

// JS thread: gives `job` its JS half and queues it on `worker`; returns the job's promise.
//   owner     kept alive until the job settles (the handle object); may be empty
//   callback  the call's onProgress / onToken / onAudio, for Emit(); may be empty
//   signal    an AbortSignal; aborting it sets the job's cancel flag. Already aborted: the
//             promise rejects with SK_ERR_CANCELLED and nothing is queued.
Napi::Promise Submit(Napi::Env env, HandleWorker &worker, std::unique_ptr<Job> job,
                     Napi::Object owner = Napi::Object(), Napi::Function callback = Napi::Function(),
                     Napi::Object signal = Napi::Object());

}  // namespace sk_node
