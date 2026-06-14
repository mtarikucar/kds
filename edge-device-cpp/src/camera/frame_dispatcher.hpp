#pragma once

#include "frame_source.hpp"

#include <cstdint>
#include <functional>

namespace kds {

// =============================================================================
// FrameDispatcher — the PURE capture-loop policy.
//
// This is the decision logic that lived inside RTSPClient::capture_loop():
//   - pull the next frame from the source,
//   - on success: dispatch it to a sink and reset the failure streak,
//   - on a miss (timeout/no sample): increment a consecutive-error counter,
//   - once the counter exceeds a threshold: reconnect the source and reset
//     the counter (on a successful reconnect) or surface an error.
//
// Lifting it out of the GStreamer thread loop (which can't run without a
// camera) makes the policy unit-testable: drive it with a FakeFrameSource and
// assert on dispatch counts and reconnect timing. RTSPClient keeps its real
// loop but the BEHAVIOR matches this policy.
// =============================================================================
class FrameDispatcher {
public:
    using FrameSink = std::function<void(const Frame&)>;

    // source : where frames come from (must outlive the dispatcher).
    // sink   : invoked once per successfully pulled frame.
    // max_consecutive_errors : misses tolerated before forcing a reconnect.
    FrameDispatcher(IFrameSource& source, FrameSink sink,
                    int max_consecutive_errors = 30)
        : source_(source),
          sink_(std::move(sink)),
          max_consecutive_errors_(max_consecutive_errors) {}

    // Outcome of processing one iteration — lets tests/observers see exactly
    // what the policy decided.
    enum class Step {
        Dispatched,      // a frame was pulled and handed to the sink
        Missed,          // no frame this tick (under the error threshold)
        Reconnected,     // error threshold hit; reconnect succeeded
        ReconnectFailed, // error threshold hit; reconnect failed
    };

    // Run one iteration of the capture policy.
    Step step() {
        Frame frame;
        if (source_.try_pull(frame)) {
            consecutive_errors_ = 0;
            ++frames_dispatched_;
            if (sink_) {
                sink_(frame);
            }
            return Step::Dispatched;
        }

        // No frame this tick.
        ++consecutive_errors_;
        if (consecutive_errors_ > max_consecutive_errors_) {
            const bool ok = source_.reconnect();
            if (ok) {
                consecutive_errors_ = 0;
                ++reconnect_count_;
                return Step::Reconnected;
            }
            return Step::ReconnectFailed;
        }
        return Step::Missed;
    }

    int consecutive_errors() const { return consecutive_errors_; }
    uint64_t frames_dispatched() const { return frames_dispatched_; }
    int reconnect_count() const { return reconnect_count_; }

private:
    IFrameSource& source_;
    FrameSink sink_;
    int max_consecutive_errors_;

    int consecutive_errors_ = 0;
    uint64_t frames_dispatched_ = 0;
    int reconnect_count_ = 0;
};

} // namespace kds
