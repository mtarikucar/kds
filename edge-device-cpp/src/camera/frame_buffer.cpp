#include "frame_buffer.hpp"

namespace kds {

FrameBuffer::FrameBuffer(size_t max_size)
    : max_size_(max_size) {
}

void FrameBuffer::push(const Frame& frame) {
    std::lock_guard<std::mutex> lock(mutex_);

    // If buffer is full, drop oldest frame
    if (buffer_.size() >= max_size_) {
        buffer_.pop_front();
        frames_dropped_++;
    }

    buffer_.push_back(frame);
    frames_pushed_++;

    not_empty_.notify_one();
}

void FrameBuffer::push(Frame&& frame) {
    std::lock_guard<std::mutex> lock(mutex_);

    // If buffer is full, drop oldest frame
    if (buffer_.size() >= max_size_) {
        buffer_.pop_front();
        frames_dropped_++;
    }

    buffer_.push_back(std::move(frame));
    frames_pushed_++;

    not_empty_.notify_one();
}

std::optional<Frame> FrameBuffer::pop() {
    std::lock_guard<std::mutex> lock(mutex_);

    if (buffer_.empty()) {
        return std::nullopt;
    }

    Frame frame = std::move(buffer_.front());
    buffer_.pop_front();
    frames_popped_++;

    return frame;
}

std::optional<Frame> FrameBuffer::pop(std::chrono::milliseconds timeout) {
    std::unique_lock<std::mutex> lock(mutex_);

    if (!not_empty_.wait_for(lock, timeout, [this] { return !buffer_.empty(); })) {
        return std::nullopt;  // Timeout
    }

    Frame frame = std::move(buffer_.front());
    buffer_.pop_front();
    frames_popped_++;

    return frame;
}

std::optional<Frame> FrameBuffer::peek() const {
    std::lock_guard<std::mutex> lock(mutex_);

    if (buffer_.empty()) {
        return std::nullopt;
    }

    return buffer_.back();  // Return the latest frame
}

void FrameBuffer::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    buffer_.clear();
}

bool FrameBuffer::empty() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return buffer_.empty();
}

bool FrameBuffer::full() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return buffer_.size() >= max_size_;
}

size_t FrameBuffer::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return buffer_.size();
}

FrameBuffer::Stats FrameBuffer::get_stats() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return Stats{frames_pushed_, frames_popped_, frames_dropped_};
}

} // namespace kds
