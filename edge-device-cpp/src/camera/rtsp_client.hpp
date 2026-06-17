#pragma once

#include "../config.hpp"
#include "frame.hpp"
#include "frame_source.hpp"

#include <opencv2/opencv.hpp>
#include <atomic>
#include <chrono>
#include <cstdint>
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

// RTSP client using GStreamer. Implements IFrameSource (the frame-producer
// seam) so the capture/reconnect policy (FrameDispatcher) can be unit-tested
// against a FakeFrameSource. The GStreamer pipeline management is the thin
// hardware adapter behind the seam.
class RTSPClient : public IFrameSource {
public:
    explicit RTSPClient(const CameraConfig& config);
    ~RTSPClient() override;

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

    // IFrameSource: pull the next frame (delegates to read_frame()).
    bool try_pull(Frame& frame) override { return read_frame(frame); }

    // IFrameSource: true while the source is connected/producing.
    bool is_open() const override { return connected_; }

    // Check if camera is running
    bool is_running() const { return running_; }

    // Check if camera is connected
    bool is_connected() const { return connected_; }

    // Get camera statistics
    CameraStats get_stats() const;

    // Set callback for new frames (optional, for async processing)
    using FrameCallback = std::function<void(const Frame&)>;
    void set_frame_callback(FrameCallback callback);

    // Reconnect to camera (IFrameSource)
    bool reconnect() override;

    // Update camera URL
    void set_url(const std::string& url);

private:
    CameraConfig config_;

    // deep-review NH12: current_url_ is read on the capture thread (pipeline
    // build / auto-reconnect) and written on the ws/io thread (set_url from a
    // backend config push). Guard it with a dedicated mutex; never touch the
    // shared std::string directly — always go through get_url() for a locked
    // snapshot.
    mutable std::mutex url_mutex_;
    std::string current_url_;  // guarded by url_mutex_

    std::string get_url() const {
        std::lock_guard<std::mutex> lock(url_mutex_);
        return current_url_;
    }

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
