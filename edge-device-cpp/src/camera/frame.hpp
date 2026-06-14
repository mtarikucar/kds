#pragma once

#include <opencv2/opencv.hpp>
#include <chrono>
#include <cstdint>
#include <string>

namespace kds {

// A single captured video frame plus metadata. Lives in its own header so both
// the IFrameSource seam and the concrete RTSPClient can depend on it without a
// circular include.
struct Frame {
    cv::Mat data;
    std::chrono::steady_clock::time_point timestamp;
    uint64_t frame_number;

    bool empty() const { return data.empty(); }
    int width() const { return data.cols; }
    int height() const { return data.rows; }
};

// Camera/source statistics.
struct CameraStats {
    std::string state;           // "RUNNING", "STOPPED", "ERROR", "RECONNECTING"
    std::string url;
    int reconnect_count = 0;
    float actual_fps = 0.0f;
    uint64_t frames_captured = 0;
    uint64_t frames_dropped = 0;
    std::string last_error;
    std::chrono::steady_clock::time_point last_frame_time;
};

} // namespace kds
