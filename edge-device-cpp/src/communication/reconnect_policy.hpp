#pragma once

#include <algorithm>
#include <cstdint>

namespace kds {

// =============================================================================
// ReconnectPolicy — pure reconnection/backoff logic.
//
// Both the WebSocket client and the RTSP client need to decide "how long do I
// wait before the next reconnect attempt?" and "have I exhausted my retries?".
// That decision is pure arithmetic, but in the original code it was a bare
// `sleep_for(config_.reconnect_delay_ms)` inlined in a thread loop — impossible
// to unit-test and not even exponential.
//
// This struct captures the policy as testable logic: a base delay that grows
// exponentially (x2 per failure) up to a cap, reset on a successful connect,
// with an optional max-attempt budget. It performs NO sleeping itself — the
// caller sleeps for next_delay_ms(); that keeps it fully deterministic.
//
// Setting base==max and unlimited attempts reproduces the original fixed-delay
// behavior exactly, so adopting it is behavior-preserving for the existing
// call sites.
// =============================================================================
class ReconnectPolicy {
public:
    // base_delay_ms : delay before the first reconnect after a failure.
    // max_delay_ms  : ceiling the exponential growth saturates at.
    // max_attempts  : retry budget; 0 (default) means unlimited.
    explicit ReconnectPolicy(int base_delay_ms = 5000,
                             int max_delay_ms = 60000,
                             int max_attempts = 0)
        : base_delay_ms_(base_delay_ms < 0 ? 0 : base_delay_ms),
          max_delay_ms_(max_delay_ms < base_delay_ms_ ? base_delay_ms_ : max_delay_ms),
          max_attempts_(max_attempts < 0 ? 0 : max_attempts) {}

    // Record a successful (re)connection — clears the failure streak so the
    // next failure starts back at the base delay.
    void on_connected() { failure_count_ = 0; }

    // Should we attempt another reconnect? False once the retry budget is
    // exhausted (always true when max_attempts == 0 / unlimited).
    bool should_retry() const {
        return max_attempts_ == 0 || failure_count_ < max_attempts_;
    }

    // Delay (ms) to wait before the *next* attempt, given the current failure
    // streak: base * 2^failures, capped at max_delay_ms. Does not mutate state.
    int next_delay_ms() const {
        int64_t delay = base_delay_ms_;
        for (int i = 0; i < failure_count_ && delay < max_delay_ms_; ++i) {
            delay *= 2;
        }
        return static_cast<int>(std::min<int64_t>(delay, max_delay_ms_));
    }

    // Record a failed attempt and return the delay to wait before the next one.
    // (Combines next_delay_ms() with the failure-count increment.)
    int record_failure() {
        const int delay = next_delay_ms();
        ++failure_count_;
        return delay;
    }

    int failure_count() const { return failure_count_; }

private:
    int base_delay_ms_;
    int max_delay_ms_;
    int max_attempts_;
    int failure_count_ = 0;
};

} // namespace kds
