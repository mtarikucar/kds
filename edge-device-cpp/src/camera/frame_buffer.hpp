#pragma once

#include "rtsp_client.hpp"

#include <opencv2/opencv.hpp>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>
#include <chrono>

namespace kds {

// Thread-safe ring buffer for frames
class FrameBuffer {
public:
    explicit FrameBuffer(size_t max_size = 3);
    ~FrameBuffer() = default;

    // Non-copyable
    FrameBuffer(const FrameBuffer&) = delete;
    FrameBuffer& operator=(const FrameBuffer&) = delete;

    // Push a new frame (overwrites oldest if full)
    void push(const Frame& frame);
    void push(Frame&& frame);

    // Pop the oldest frame
    std::optional<Frame> pop();

    // Pop with timeout (returns nullopt if timeout)
    std::optional<Frame> pop(std::chrono::milliseconds timeout);

    // Get the latest frame without removing it
    std::optional<Frame> peek() const;

    // Clear all frames
    void clear();

    // Check if buffer is empty
    bool empty() const;

    // Check if buffer is full
    bool full() const;

    // Get current size
    size_t size() const;

    // Get max size
    size_t max_size() const { return max_size_; }

    // Get statistics
    struct Stats {
        uint64_t frames_pushed = 0;
        uint64_t frames_popped = 0;
        uint64_t frames_dropped = 0;
    };
    Stats get_stats() const;

private:
    size_t max_size_;
    std::deque<Frame> buffer_;

    mutable std::mutex mutex_;
    std::condition_variable not_empty_;

    // Statistics
    uint64_t frames_pushed_ = 0;
    uint64_t frames_popped_ = 0;
    uint64_t frames_dropped_ = 0;
};

} // namespace kds
