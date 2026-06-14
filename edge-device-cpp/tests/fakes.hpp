#pragma once

// Fake implementations of the three hardware seams, for driving the pure
// orchestration logic in unit tests without CUDA/TensorRT, websocketpp, or
// GStreamer.

#include "detection/inference_engine.hpp"
#include "communication/transport.hpp"
#include "camera/frame_source.hpp"

#include <deque>
#include <string>
#include <vector>

namespace kds {
namespace fakes {

// -----------------------------------------------------------------------------
// FakeInferenceEngine — a scriptable IInferenceEngine. Each detect() call pops
// and returns the next pre-loaded result (or empty once exhausted), recording
// how many frames it was asked about.
// -----------------------------------------------------------------------------
class FakeInferenceEngine : public IInferenceEngine {
public:
    FakeInferenceEngine() = default;

    // Queue a result to be returned by the next detect() call.
    void push_result(std::vector<Detection> dets) {
        scripted_.push_back(std::move(dets));
    }

    void set_initialized(bool v) { initialized_ = v; }
    void set_input_size(cv::Size s) { input_size_ = s; }

    std::vector<Detection> detect(const cv::Mat& /*frame*/) override {
        ++detect_calls_;
        if (scripted_.empty()) {
            return {};
        }
        auto out = std::move(scripted_.front());
        scripted_.pop_front();
        last_inference_ms_ = 1.0f;
        return out;
    }

    bool is_initialized() const override { return initialized_; }
    float get_inference_time() const override { return last_inference_ms_; }
    cv::Size get_input_size() const override { return input_size_; }

    int detect_calls() const { return detect_calls_; }

private:
    std::deque<std::vector<Detection>> scripted_;
    int detect_calls_ = 0;
    bool initialized_ = true;
    float last_inference_ms_ = 0.0f;
    cv::Size input_size_{640, 640};
};

// -----------------------------------------------------------------------------
// FakeTransport — an ITransport that records every frame it is asked to send,
// with a togglable connected state and an optional "fail next send" switch.
// -----------------------------------------------------------------------------
class FakeTransport : public ITransport {
public:
    bool send_raw(const std::string& message) override {
        if (!connected_) {
            return false;
        }
        if (fail_send_) {
            return false;
        }
        sent_.push_back(message);
        return true;
    }

    bool is_connected() const override { return connected_; }

    void set_connected(bool v) { connected_ = v; }
    void set_fail_send(bool v) { fail_send_ = v; }

    const std::vector<std::string>& sent() const { return sent_; }
    bool sent_contains(const std::string& substr) const {
        for (const auto& m : sent_) {
            if (m.find(substr) != std::string::npos) return true;
        }
        return false;
    }
    void clear() { sent_.clear(); }

private:
    std::vector<std::string> sent_;
    bool connected_ = true;
    bool fail_send_ = false;
};

// -----------------------------------------------------------------------------
// FakeFrameSource — an IFrameSource scripted with a sequence of "has frame /
// no frame (timeout)" ticks, plus a controllable reconnect outcome. Records
// reconnect attempts.
// -----------------------------------------------------------------------------
class FakeFrameSource : public IFrameSource {
public:
    // Queue a tick that yields a frame.
    void push_frame() { ticks_.push_back(true); }
    // Queue a tick that yields nothing (a timeout / miss).
    void push_miss(int n = 1) {
        for (int i = 0; i < n; ++i) ticks_.push_back(false);
    }

    // Control what reconnect() returns. If a finite script is given it is
    // consumed in order; otherwise reconnect_default_ is used.
    void set_reconnect_default(bool v) { reconnect_default_ = v; }
    void push_reconnect_result(bool v) { reconnect_script_.push_back(v); }

    bool try_pull(Frame& frame) override {
        if (ticks_.empty()) {
            return false;  // no more scripted ticks => treat as a miss
        }
        const bool has = ticks_.front();
        ticks_.pop_front();
        if (!has) {
            return false;
        }
        frame.frame_number = ++produced_;
        frame.timestamp = std::chrono::steady_clock::now();
        // 2x2 dummy image so frame.empty() is false.
        frame.data = cv::Mat::zeros(2, 2, CV_8UC3);
        return true;
    }

    bool reconnect() override {
        ++reconnect_calls_;
        if (!reconnect_script_.empty()) {
            const bool v = reconnect_script_.front();
            reconnect_script_.pop_front();
            open_ = v;
            return v;
        }
        open_ = reconnect_default_;
        return reconnect_default_;
    }

    bool is_open() const override { return open_; }
    void set_open(bool v) { open_ = v; }

    int reconnect_calls() const { return reconnect_calls_; }
    uint64_t produced() const { return produced_; }

private:
    std::deque<bool> ticks_;
    std::deque<bool> reconnect_script_;
    bool reconnect_default_ = true;
    bool open_ = true;
    int reconnect_calls_ = 0;
    uint64_t produced_ = 0;
};

} // namespace fakes
} // namespace kds
