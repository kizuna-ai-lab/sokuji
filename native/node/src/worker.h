// HandleWorker: one native thread with a FIFO queue of jobs (job.h). Every loaded model owns
// one, so calls on a handle run in the order JS made them, one at a time, off the JS thread
// and off libuv's pool; two handles run in parallel. Loads and process-wide checks run on the
// one process-wide MiscWorker().
//
// Threads: post(), cancelAll() and requestStop() may be called from any thread;
// stopAndJoin() from any thread but the worker's own (concurrent calls are fine: the first joins,
// the others wait for it); the destructor from the JS thread.
//
// Ending: a worker ends when its owner unloads (model.h), when its owner is collected (Retire),
// when its environment ends (StopOwnedBy, from the addon's environment cleanup hook), or when the
// process exits (StopAllAtExit, from the exit handler). process.exit() runs no environment
// cleanup, so without the exit handler ggml's compute threads would still be running while the
// process destroys the library's statics.
#pragma once

#include "job.h"

#include <napi.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

namespace sk_node {

class HandleWorker {
public:
    // `owner` tags the worker with the environment whose handle owns it (nullptr: process-
    // wide), so an environment's cleanup can find the workers that belong to it.
    explicit HandleWorker(napi_env owner);
    ~HandleWorker();   // stopAndJoin()
    HandleWorker(const HandleWorker &) = delete;
    HandleWorker &operator=(const HandleWorker &) = delete;

    // Queues `job` behind every job posted before it. After the stop sentinel is queued,
    // a posted job never runs: it settles at once as cancelled.
    void post(std::unique_ptr<Job> job);

    // Sets the cancel flag of every queued job and of the one running now. Queued jobs then
    // reject with SK_ERR_CANCELLED without calling the library; the running one stops at its
    // next native callback.
    void cancelAll();

    // Queues the stop sentinel (once): the thread ends after the jobs already queued.
    void requestStop();

    // requestStop(), then waits for the thread to end. Blocks for as long as the queued
    // jobs take: cancelAll() first to keep that short. Safe to call again and concurrently.
    void stopAndJoin();

    // True once the thread has left its loop (stopped, and every job it was given has run).
    bool finished() const { return done_.load(); }

    napi_env owner() const { return owner_; }

    // The owner is gone but its worker still has jobs to run (a collected model's unload):
    // keeps the worker alive until its thread has ended. The thread is joined, and the worker
    // freed, by a later call from the same environment (a retire, a new worker) or by the
    // environment's cleanup, never by the JS thread waiting on it here. The caller has queued
    // the worker's last jobs and called requestStop().
    static void Retire(std::unique_ptr<HandleWorker> worker);

    // Environment cleanup, JS thread: cancels the jobs of every worker owned by `owner`,
    // lets them end and joins them, retired ones included, and frees the retired ones.
    static void StopOwnedBy(napi_env owner);

    // Calls `fn` for every live worker, under the registry lock (so `fn` must not create or
    // destroy a worker).
    static void ForEachLive(const std::function<void(HandleWorker &)> &fn);

private:
    void Loop();

    const napi_env owner_;
    std::mutex join_mu_;                // one join at a time; see stopAndJoin()
    std::atomic_bool done_{false};      // set by the thread as it leaves Loop()
    std::mutex mu_;
    std::condition_variable cv_;
    std::deque<std::unique_ptr<Job>> queue_;            // nullptr: the stop sentinel
    std::shared_ptr<std::atomic_bool> running_cancel_;  // the running job's flag, if any
    bool stop_queued_ = false;
    std::thread thread_;   // last: started once everything above exists
};

// The process-wide worker for loads and deviceSupportsOps. Started on first use, never
// stopped before the process exits: it outlives every environment.
HandleWorker &MiscWorker();

// Registers a process exit handler: it cancels the queued jobs and the running job of every
// live worker, lets them end and joins them, then stops anything that would post to a
// JavaScript environment. An exit waits for a job that cannot be interrupted (a load, an
// offline synth) to end.
//
// Exit handlers run in reverse order of registration, and a library's static destructors count as
// one registered when it was constructed, and ggml builds some lazily (at the first load, at the
// first compute). So call this as late as there is a chance to: right after a successful sk_init
// (the backend modules are loaded by then), and again from process 'exit' (addon.cpp), just
// before exit() runs the handlers. Registered earlier than a static, the handler would run after
// that static was destroyed, with a compute thread still using it. Calling it again is harmless.
void InstallExitHandler();

}  // namespace sk_node
