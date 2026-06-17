#include "rtsp_client.hpp"
#include "../utils/logger.hpp"

#include <gst/gst.h>
#include <gst/app/gstappsink.h>

#include <algorithm>  // deep-review NH11: std::max for fps clamp
#include <cstddef>

namespace kds {

// Initialize GStreamer once
static bool gst_initialized = false;

static void init_gstreamer() {
    if (!gst_initialized) {
        gst_init(nullptr, nullptr);
        gst_initialized = true;
        LOG_DEBUG("GStreamer initialized");
    }
}

RTSPClient::RTSPClient(const CameraConfig& config)
    : config_(config)
    , current_url_(config.url) {
    init_gstreamer();
}

RTSPClient::~RTSPClient() {
    stop();
}

bool RTSPClient::start() {
    if (running_) {
        LOG_WARN("Camera already running");
        return true;
    }

    // deep-review NH12: read a locked snapshot of the URL, never the shared member.
    const std::string url = get_url();
    LOG_INFO("Starting RTSP client: {}", url);

    // Reset statistics
    {
        std::lock_guard<std::mutex> lock(stats_mutex_);
        stats_ = CameraStats{};
        stats_.url = url;
    }

    if (!create_pipeline()) {
        LOG_ERROR("Failed to create GStreamer pipeline");
        return false;
    }

    running_ = true;
    capture_thread_ = std::thread(&RTSPClient::capture_loop, this);

    LOG_INFO("RTSP client started");
    return true;
}

void RTSPClient::stop() {
    if (!running_) {
        return;
    }

    LOG_INFO("Stopping RTSP client");
    running_ = false;

    if (capture_thread_.joinable()) {
        capture_thread_.join();
    }

    destroy_pipeline();
    connected_ = false;

    set_state("STOPPED");
    LOG_INFO("RTSP client stopped");
}

bool RTSPClient::read(cv::Mat& frame) {
    std::lock_guard<std::mutex> lock(frame_mutex_);

    if (latest_frame_.empty()) {
        return false;
    }

    frame = latest_frame_.data.clone();
    return true;
}

bool RTSPClient::read_frame(Frame& frame) {
    std::lock_guard<std::mutex> lock(frame_mutex_);

    if (latest_frame_.empty()) {
        return false;
    }

    frame = latest_frame_;
    frame.data = latest_frame_.data.clone();
    return true;
}

CameraStats RTSPClient::get_stats() const {
    std::lock_guard<std::mutex> lock(stats_mutex_);
    return stats_;
}

void RTSPClient::set_frame_callback(FrameCallback callback) {
    frame_callback_ = std::move(callback);
}

bool RTSPClient::reconnect() {
    LOG_INFO("Reconnecting to camera...");
    stop();

    // Wait before reconnecting
    std::this_thread::sleep_for(std::chrono::milliseconds(config_.reconnect_delay_ms));

    {
        std::lock_guard<std::mutex> lock(stats_mutex_);
        stats_.reconnect_count++;
    }

    return start();
}

void RTSPClient::set_url(const std::string& url) {
    // deep-review NH12: take the lock only for the write and release it before
    // reconnect(), which calls stop()/join(). Holding url_mutex_ across the join
    // would needlessly serialize against the capture thread (which also reads
    // the URL via get_url()) and risk a deadlock. set_url runs on the ws/io
    // thread, so the join itself is safe.
    {
        std::lock_guard<std::mutex> lock(url_mutex_);
        current_url_ = url;
    }
    if (running_) {
        reconnect();
    }
}

bool RTSPClient::create_pipeline() {
    // deep-review NH12: build the pipeline from one locked snapshot of the URL
    // so a concurrent set_url() on the ws thread can't tear the std::string read.
    const std::string url = get_url();

    // Build GStreamer pipeline string
    // Use hardware decoding if available (NVDEC for Jetson)
    std::string pipeline_str =
        "rtspsrc location=\"" + url + "\" "
        "latency=100 buffer-mode=auto ! "
        "rtph264depay ! "
        "h264parse ! ";

    // Try hardware decoder first (Jetson), fallback to software
#if defined(__aarch64__)
    // Jetson/ARM with NVIDIA decoder
    pipeline_str += "nvv4l2decoder ! ";
    pipeline_str += "nvvidconv ! ";
    pipeline_str += "video/x-raw,format=BGRx ! ";
    pipeline_str += "videoconvert ! ";
#else
    // x86 or software fallback
    pipeline_str += "avdec_h264 ! ";
    pipeline_str += "videoconvert ! ";
#endif

    pipeline_str +=
        "video/x-raw,format=BGR ! "
        "appsink name=sink emit-signals=true max-buffers=3 drop=true sync=false";

    LOG_DEBUG("GStreamer pipeline: {}", pipeline_str);

    GError* error = nullptr;
    pipeline_ = gst_parse_launch(pipeline_str.c_str(), &error);

    if (error) {
        LOG_ERROR("Failed to create pipeline: {}", error->message);
        set_error(error->message);
        g_error_free(error);
        return false;
    }

    if (!pipeline_) {
        LOG_ERROR("Pipeline is null");
        set_error("Pipeline creation failed");
        return false;
    }

    // Get appsink element
    appsink_ = gst_bin_get_by_name(GST_BIN(pipeline_), "sink");
    if (!appsink_) {
        LOG_ERROR("Failed to get appsink element");
        set_error("appsink not found");
        gst_object_unref(pipeline_);
        pipeline_ = nullptr;
        return false;
    }

    // Configure appsink
    gst_app_sink_set_emit_signals(GST_APP_SINK(appsink_), TRUE);
    gst_app_sink_set_drop(GST_APP_SINK(appsink_), TRUE);
    gst_app_sink_set_max_buffers(GST_APP_SINK(appsink_), config_.buffer_size);

    // Start pipeline
    GstStateChangeReturn ret = gst_element_set_state(pipeline_, GST_STATE_PLAYING);
    if (ret == GST_STATE_CHANGE_FAILURE) {
        LOG_ERROR("Failed to start pipeline");
        set_error("Pipeline start failed");
        destroy_pipeline();
        return false;
    }

    set_state("RUNNING");
    fps_start_time_ = std::chrono::steady_clock::now();
    fps_frame_count_ = 0;

    return true;
}

void RTSPClient::destroy_pipeline() {
    if (appsink_) {
        gst_object_unref(appsink_);
        appsink_ = nullptr;
    }

    if (pipeline_) {
        gst_element_set_state(pipeline_, GST_STATE_NULL);
        gst_object_unref(pipeline_);
        pipeline_ = nullptr;
    }
}

void RTSPClient::capture_loop() {
    LOG_DEBUG("Capture loop started");
    int consecutive_errors = 0;
    const int MAX_CONSECUTIVE_ERRORS = 30;

    while (running_) {
        if (!appsink_) {
            LOG_ERROR("appsink is null");
            break;
        }

        // Pull sample with timeout.
        // deep-review NH11: clamp fps to >= 1 before dividing. A misconfigured or
        // SIGHUP-reloaded config with fps == 0 would otherwise be integer
        // division by zero (SIGFPE); a negative fps would wrap to a huge unsigned
        // GstClockTime timeout and hang the capture loop.
        const int fps = std::max(1, config_.fps);
        GstSample* sample = gst_app_sink_try_pull_sample(
            GST_APP_SINK(appsink_), GST_SECOND / fps);

        if (!sample) {
            consecutive_errors++;
            if (consecutive_errors > MAX_CONSECUTIVE_ERRORS) {
                LOG_ERROR("Too many consecutive errors, reconnecting...");
                set_state("RECONNECTING");
                destroy_pipeline();

                std::this_thread::sleep_for(
                    std::chrono::milliseconds(config_.reconnect_delay_ms));

                if (running_ && create_pipeline()) {
                    consecutive_errors = 0;
                    {
                        std::lock_guard<std::mutex> lock(stats_mutex_);
                        stats_.reconnect_count++;
                    }
                } else if (running_) {
                    LOG_ERROR("Reconnection failed");
                    set_state("ERROR");
                }
            }
            continue;
        }

        consecutive_errors = 0;

        if (!connected_) {
            connected_ = true;
            LOG_INFO("Camera connected");
        }

        // Process the sample
        if (process_sample(sample)) {
            update_fps();
        }

        gst_sample_unref(sample);
    }

    LOG_DEBUG("Capture loop ended");
}

bool RTSPClient::process_sample(GstSample* sample) {
    GstBuffer* buffer = gst_sample_get_buffer(sample);
    if (!buffer) {
        LOG_WARN("Sample has no buffer");
        return false;
    }

    GstCaps* caps = gst_sample_get_caps(sample);
    if (!caps) {
        LOG_WARN("Sample has no caps");
        return false;
    }

    // Get frame dimensions
    GstStructure* structure = gst_caps_get_structure(caps, 0);
    int width = 0;
    int height = 0;
    gst_structure_get_int(structure, "width", &width);
    gst_structure_get_int(structure, "height", &height);

    // deep-review NM7: reject non-positive dims. The old `== 0` check let a
    // negative-but-nonzero width/height from malicious/buggy caps through and
    // into the cv::Mat allocation.
    if (width <= 0 || height <= 0) {
        LOG_WARN("Invalid frame dimensions: {}x{}", width, height);
        return false;
    }

    // Map buffer
    GstMapInfo map;
    if (!gst_buffer_map(buffer, &map, GST_MAP_READ)) {
        LOG_WARN("Failed to map buffer");
        return false;
    }

    // deep-review NM7: validate the mapped buffer is large enough for the
    // negotiated frame before constructing the Mat, otherwise frame.clone()
    // reads out-of-bounds past map.data (OOB read / crash) on a short buffer
    // from a malformed stream or stride/padding mismatch. GStreamer BGR rows
    // are padded up to a 4-byte boundary, so account for the real stride.
    const std::size_t stride = GST_ROUND_UP_4(static_cast<std::size_t>(width) * 3);
    const std::size_t expected = stride * static_cast<std::size_t>(height);
    if (map.size < expected) {
        LOG_WARN("Buffer too small: have {} need {} ({}x{} BGR)",
                 map.size, expected, width, height);
        gst_buffer_unmap(buffer, &map);  // NM7: don't leak the map on early return
        return false;
    }

    // Create OpenCV Mat from buffer data.
    // deep-review NM7: pass the real stride so a padded buffer isn't misread as
    // tight-packed (which would read past the row for non-4-aligned widths).
    cv::Mat frame(height, width, CV_8UC3, map.data, stride);

    // Update latest frame
    {
        std::lock_guard<std::mutex> lock(frame_mutex_);
        latest_frame_.data = frame.clone();
        latest_frame_.timestamp = std::chrono::steady_clock::now();
        latest_frame_.frame_number++;
    }

    // Update statistics
    {
        std::lock_guard<std::mutex> lock(stats_mutex_);
        stats_.frames_captured++;
        stats_.last_frame_time = latest_frame_.timestamp;
    }

    // Call frame callback if set
    if (frame_callback_) {
        frame_callback_(latest_frame_);
    }

    gst_buffer_unmap(buffer, &map);
    return true;
}

void RTSPClient::update_fps() {
    fps_frame_count_++;

    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration<float>(now - fps_start_time_).count();

    if (elapsed >= 1.0f) {
        float fps = fps_frame_count_ / elapsed;

        {
            std::lock_guard<std::mutex> lock(stats_mutex_);
            stats_.actual_fps = fps;
        }

        fps_frame_count_ = 0;
        fps_start_time_ = now;
    }
}

void RTSPClient::set_state(const std::string& state) {
    std::lock_guard<std::mutex> lock(stats_mutex_);
    stats_.state = state;
}

void RTSPClient::set_error(const std::string& error) {
    std::lock_guard<std::mutex> lock(stats_mutex_);
    stats_.state = "ERROR";
    stats_.last_error = error;
}

} // namespace kds
