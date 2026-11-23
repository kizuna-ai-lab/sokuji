// HandleWorker: one native thread with a FIFO queue of jobs (job.h). Every loaded model owns
// one, so calls on a handle run in the order JS made them, one at a time, off the JS thread
// and off libuv's pool; two handles run in parallel. Loads and process-wide checks run on the
// one process-wide MiscWorker().
//
// Threads: post(), cancelAll() and requestStop() may be called from any thread;
// stopAndJoin() and the destructor from the JS thread (never from the worker itself).
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
    // jobs take: cancelAll() first to keep that short.
    void stopAndJoin();

    napi_env owner() const { return owner_; }

    // Calls `fn` for every live worker, under the registry lock (so `fn` must not create or
    // destroy a worker). For the environment cleanup that cancels and joins them.
    static void ForEachLive(const std::function<void(HandleWorker &)> &fn);

private:
    void Loop();

    const napi_env owner_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::deque<std::unique_ptr<Job>> queue_;            // nullptr: the stop sentinel
    std::shared_ptr<std::atomic_bool> running_cancel_;  // the running job's flag, if any
    bool stop_queued_ = false;
    std::thread thread_;   // last: started once everything above exists
};

// The process-wide worker for loads and deviceSupportsOps. Started on first use, never
// stopped: it outlives every environment.
HandleWorker &MiscWorker();

}  // namespace sk_node
