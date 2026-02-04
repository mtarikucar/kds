#pragma once

#include "../config.hpp"

#include <opencv2/opencv.hpp>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <functional>

// Forward declarations for GStreamer types
struct _GstElement;
typedef struct _GstElement GstElement;
struct _GstSample;
typedef struct _GstSample GstSample;

namespace kds {

// Frame data structure
struct Frame {
    cv::Mat data;
    std::chrono::steady_clock::time_point timestamp;
    uint64_t frame_number;

    bool empty() const { return data.empty(); }
    int width() const { return data.cols; }
    int height() const { return data.rows; }
};

// Camera statistics
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

// RTSP client using GStreamer
class RTSPClient {
public:
    explicit RTSPClient(const CameraConfig& config);
    ~RTSPClient();

    // Non-copyable
    RTSPClient(const RTSPClient&) = delete;
    RTSPClient& operator=(const RTSPClient&) = delete;

    // Start/stop streaming
    bool start();
    void stop();

    // Get the latest frame
    bool read(cv::Mat& frame);

    // Get frame with metadata
    bool read_frame(Frame& frame);

    // Check if camera is running
    bool is_running() const { return running_; }

    // Check if camera is connected
    bool is_connected() const { return connected_; }

    // Get camera statistics
    CameraStats get_stats() const;

    // Set callback for new frames (optional, for async processing)
    using FrameCallback = std::function<void(const Frame&)>;
    void set_frame_callback(FrameCallback callback);

    // Reconnect to camera
    bool reconnect();

    // Update camera URL
    void set_url(const std::string& url);

private:
    CameraConfig config_;
    std::string current_url_;

    // State
    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};

    // Latest frame storage
    mutable std::mutex frame_mutex_;
    Frame latest_frame_;

    // Capture thread
    std::thread capture_thread_;

    // GStreamer pipeline
    GstElement* pipeline_ = nullptr;
    GstElement* appsink_ = nullptr;

    // Statistics
    mutable std::mutex stats_mutex_;
    CameraStats stats_;
    std::chrono::steady_clock::time_point fps_start_time_;
    int fps_frame_count_ = 0;

    // Frame callback
    FrameCallback frame_callback_;

    // Internal methods
    bool create_pipeline();
    void destroy_pipeline();
    void capture_loop();
    bool process_sample(GstSample* sample);
    void update_fps();
    void set_state(const std::string& state);
    void set_error(const std::string& error);
};

} // namespace kds
