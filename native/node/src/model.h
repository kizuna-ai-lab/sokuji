// What every loaded-model object (AsrModel, Translator, Tts) shares: the native handle,
// the model's own worker thread, and unload.
//
//   NativeHandle    the native pointer, freed exactly once by whoever gets there first
//   ModelLifecycle  the worker thread and the unload state of one model object. The rules every
//                   model object obeys:
//                   - unload() sets the cancel flag of every queued job (each rejects with
//                     SK_ERR_CANCELLED, "cancelled before it started") and of the running one (it
//                     stops at its next native callback), then queues one UnloadJob behind them on
//                     the model's own thread, then the stop sentinel; the job's settle joins the
//                     thread and resolves. Every later unload() returns the first call's promise.
//                   - a call made once unload() was called rejects at once: status -2,
//                     "<fn>: model is unloaded", the Python binding's wording (RejectedUnloaded).
//                   - an owner collected without unload() logs a warning naming it; its own thread
//                     frees the model, the JS thread never waits for it (Teardown, Retire).
//                   - an owner finalized when its environment ends finds its thread already stopped
//                     and joined by the addon's environment cleanup hook (addon.cpp), and frees the
//                     model on the spot.
//   RejectedUnloaded  the rejection of a call on an unloaded (or unloading) model
//
// A Handle, for ModelLifecycle, is any class with a noexcept Unload() that frees the model once
// (NativeHandle, or asr.cpp's AsrHandle, which closes the model's open stream first).
#pragma once

#include "addon.h"
#include "errors.h"
#include "job.h"
#include "worker.h"

#include <napi.h>
#include <sokuji_native.h>

#include <atomic>
#include <memory>
#include <string>
#include <utility>

namespace sk_node {

// A loaded model's native pointer, shared by the model object and the jobs queued for it.
// Unload() frees it once, whoever gets there first; the last owner frees it if nobody did.
template <class T, void (*Free)(T *)>
class NativeHandle {
public:
    NativeHandle() = default;
    ~NativeHandle() { Unload(); }
    NativeHandle(const NativeHandle &) = delete;
    NativeHandle &operator=(const NativeHandle &) = delete;

    void Adopt(T *p) noexcept { p_.store(p); }
    T *get() const noexcept { return p_.load(); }
    void Unload() noexcept {
        if (T *p = p_.exchange(nullptr)) Free(p);
    }

private:
    std::atomic<T *> p_{nullptr};
};

// Unloaded (or unloading): the Python binding's text and status.
inline Napi::Promise RejectedUnloaded(Napi::Env env, const char *what) {
    return Rejected(env, MakeNativeError(env, SK_ERR_NOT_INITIALISED, StatusText(what, "model is unloaded")).Value());
}

class ModelLifecycle;

// A collected model's last job: frees it on its own thread. Native only: nobody waits for it.
template <class Handle>
class ReleaseJob : public Job {
public:
    explicit ReleaseJob(std::shared_ptr<Handle> handle) : Job("unload"), handle_(std::move(handle)) {}

    void execute() override { handle_->Unload(); }
    void settle(Napi::Env) override {}   // never called: a native-only job has no promise

private:
    std::shared_ptr<Handle> handle_;
};

// The model's unload on its own thread, behind the jobs queued before it (all cancelled by then).
// `what` names the C function ("sk_asr_unload").
template <class Handle>
class UnloadJob : public Job {
public:
    UnloadJob(const char *what, std::shared_ptr<Handle> handle, ModelLifecycle *life)
        : Job(what), handle_(std::move(handle)), life_(life) {}

    void execute() override { handle_->Unload(); }

    void settle(Napi::Env env) override;

private:
    std::shared_ptr<Handle> handle_;
    ModelLifecycle *life_;
};

// A member of the model object. JS thread only. Never moved or copied: every UnloadJob it
// queues points back at it.
class ModelLifecycle {
public:
    ModelLifecycle() = default;
    ModelLifecycle(const ModelLifecycle &) = delete;
    ModelLifecycle &operator=(const ModelLifecycle &) = delete;
    ModelLifecycle(ModelLifecycle &&) = delete;
    ModelLifecycle &operator=(ModelLifecycle &&) = delete;

    // The owner's constructor, once its arguments are checked: starts the model's worker thread.
    // `label` names the owner in the warning of a collected, never-unloaded model, e.g.
    // "AsrModel(/models/whisper-tiny.gguf)".
    void Start(napi_env env, std::string label) {
        label_ = std::move(label);
        worker_ = std::make_unique<HandleWorker>(env);
    }

    // The model's worker. Only while !Unloading(): it is gone once the unload has settled.
    HandleWorker &worker() { return *worker_; }

    bool Unloading() const { return !unloading_.IsEmpty(); }

    // unload() → Promise<void>. Idempotent: every call returns the first call's promise. Cancels
    // the jobs queued so far and the running one, then, on the model's own thread, `handle` is
    // unloaded and the thread ends. `owner` (the model object) is kept alive until the unload
    // settles.
    template <class Handle>
    Napi::Promise Unload(Napi::Env env, Napi::Object owner, const char *what, std::shared_ptr<Handle> handle) {
        if (Unloading()) return unloading_.Value();
        auto job = std::make_unique<UnloadJob<Handle>>(what, std::move(handle), this);
        worker_->cancelAll();   // before the unload is queued: it must run
        Napi::Promise p = Submit(env, *worker_, std::move(job), owner);
        worker_->requestStop();
        unloading_ = Napi::Persistent(p);
        return p;
    }

    // From the unload job's settle: the worker ends right after that job.
    void Stopped() {
        if (worker_) worker_->stopAndJoin();
        worker_.reset();
    }

    // The owner's destructor.
    //  - unload() finished: nothing is left.
    //  - The environment is ending: its cleanup hook has stopped and joined the thread already,
    //    so freeing the model here waits for nobody.
    //  - Collected while loaded, nobody called unload(): warn, then let the model's own thread
    //    free it (a 0.6B LLM takes 200-250 ms, a larger one longer: not on the JS thread). Every
    //    job holds the owner object until it settles, so nothing of the owner's is queued.
    template <class Handle>
    void Teardown(const std::shared_ptr<Handle> &handle) {
        if (!worker_) return;
        if (worker_->finished()) {
            worker_.reset();
            handle->Unload();
            return;
        }
        try {
            LogWarning(label_ + " was collected without unload(); unloading it now. Call unload() to free the model when you choose.");
            worker_->cancelAll();
            worker_->post(std::make_unique<ReleaseJob<Handle>>(handle));
            worker_->requestStop();
            HandleWorker::Retire(std::move(worker_));
        } catch (...) {
            // Out of memory: stop and free it here instead.
            if (worker_) {
                worker_->cancelAll();
                worker_->stopAndJoin();
                worker_.reset();
            }
            handle->Unload();
        }
    }

private:
    std::unique_ptr<HandleWorker> worker_;      // null once unloaded
    Napi::Reference<Napi::Promise> unloading_;  // what every unload() returns; set by the first
    std::string label_;
};

template <class Handle>
void UnloadJob<Handle>::settle(Napi::Env env) {
    life_->Stopped();   // alive: the job holds the owner object, and so its lifecycle, until it settles
    if (failed()) return RejectStatus(env);
    Resolve(env.Undefined());
}

}  // namespace sk_node
