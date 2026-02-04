/**
 * KDS Edge Device - C++ TensorRT Edition
 *
 * High-performance edge device application for restaurant analytics.
 * Uses TensorRT for YOLOv8 inference on NVIDIA Jetson platforms.
 *
 * Architecture:
 *   - GStreamer RTSP client for camera capture
 *   - TensorRT for hardware-accelerated person detection
 *   - IoU-based tracker for person tracking
 *   - Homography for image-to-floor coordinate mapping
 *   - WebSocket client for backend communication
 */

#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <thread>

#include "config.hpp"
#include "camera/rtsp_client.hpp"
#include "camera/frame_buffer.hpp"
#include "detection/yolo_tensorrt.hpp"
#include "detection/tracker.hpp"
#include "calibration/homography.hpp"
#include "communication/websocket_client.hpp"
#include "utils/logger.hpp"

namespace {
    std::atomic<bool> g_running{true};
    std::atomic<bool> g_reload_config{false};
}

void signal_handler(int signal) {
    if (signal == SIGINT || signal == SIGTERM) {
        LOG_INFO("Shutdown signal received ({})", signal);
        g_running = false;
    } else if (signal == SIGHUP) {
        LOG_INFO("Reload signal received");
        g_reload_config = true;
    }
}

void print_usage(const char* program_name) {
    std::cout << "Usage: " << program_name << " [OPTIONS]\n\n"
              << "Options:\n"
              << "  --config <path>        Path to config file (default: config/config.yaml)\n"
              << "  --device-id <id>       Device ID (overrides config)\n"
              << "  --camera <url>         Camera RTSP URL (overrides config)\n"
              << "  --backend <url>        Backend WebSocket URL (overrides config)\n"
              << "  --build-engine <onnx>  Build TensorRT engine from ONNX and exit\n"
              << "  --test-inference       Run inference test and exit\n"
              << "  --test-camera          Test camera connection and exit\n"
              << "  --log-level <level>    Log level: debug, info, warn, error\n"
              << "  --help                 Show this help message\n"
              << std::endl;
}

// Parse command line arguments
struct Args {
    std::string config_path = "config/config.yaml";
    std::string device_id;
    std::string camera_url;
    std::string backend_url;
    std::string build_engine_onnx;
    std::string log_level = "info";
    bool test_inference = false;
    bool test_camera = false;
    bool help = false;
};

Args parse_args(int argc, char* argv[]) {
    Args args;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--config" && i + 1 < argc) {
            args.config_path = argv[++i];
        } else if (arg == "--device-id" && i + 1 < argc) {
            args.device_id = argv[++i];
        } else if (arg == "--camera" && i + 1 < argc) {
            args.camera_url = argv[++i];
        } else if (arg == "--backend" && i + 1 < argc) {
            args.backend_url = argv[++i];
        } else if (arg == "--build-engine" && i + 1 < argc) {
            args.build_engine_onnx = argv[++i];
        } else if (arg == "--test-inference") {
            args.test_inference = true;
        } else if (arg == "--test-camera") {
            args.test_camera = true;
        } else if (arg == "--log-level" && i + 1 < argc) {
            args.log_level = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            args.help = true;
        }
    }

    return args;
}

// Get system health metrics
kds::HealthStatusPayload get_health_status(
    const kds::Config& config,
    const kds::RTSPClient& camera,
    const kds::Tracker& tracker,
    const kds::YoloTensorRT& detector,
    uint64_t frames_processed,
    uint64_t detections_total,
    std::chrono::steady_clock::time_point start_time) {

    kds::HealthStatusPayload status;
    status.device_id = config.device_id;

    auto now = std::chrono::steady_clock::now();
    auto uptime = std::chrono::duration_cast<std::chrono::seconds>(now - start_time).count();
    status.uptime = static_cast<int>(uptime);
    status.frames_processed = frames_processed;
    status.detections_total = detections_total;
    status.fps = uptime > 0 ? static_cast<float>(frames_processed) / uptime : 0;

    // Camera status
    auto cam_stats = camera.get_stats();
    status.camera.state = cam_stats.state;
    status.camera.url = config.camera.url;
    status.camera.reconnect_count = cam_stats.reconnect_count;
    status.camera.actual_fps = cam_stats.actual_fps;

    // Tracker status
    auto tracker_stats = tracker.get_stats();
    status.tracker.active_tracks = tracker_stats.active_tracks;
    status.tracker.total_tracked = tracker_stats.total_tracked;

    // System metrics (simplified - proper implementation would use sysinfo)
    // These are placeholder values - real implementation should read from /proc
    status.cpu_usage = 0.0f;
    status.memory_usage = 0.0f;
    status.gpu_usage = 0.0f;
    status.temperature = 0.0f;

    return status;
}

int main(int argc, char* argv[]) {
    // Parse command line arguments
    Args args = parse_args(argc, argv);

    if (args.help) {
        print_usage(argv[0]);
        return 0;
    }

    // Initialize logger
    kds::Logger::init("edge-device", args.log_level);

    LOG_INFO("KDS Edge Device v1.0.0 (C++ TensorRT Edition)");
    LOG_INFO("============================================");

    // Load configuration
    kds::Config config;
    try {
        config = kds::Config::load(args.config_path);
    } catch (const std::exception& e) {
        LOG_WARN("Failed to load config file: {}", e.what());
        LOG_INFO("Using default configuration");
    }

    // Override with command line arguments
    if (!args.device_id.empty()) config.device_id = args.device_id;
    if (!args.camera_url.empty()) config.camera.url = args.camera_url;
    if (!args.backend_url.empty()) config.backend.url = args.backend_url;

    // Merge environment variables
    config.merge_env();

    // Set log level from config
    kds::Logger::set_level(config.log_level);

    // Handle build-engine mode
    if (!args.build_engine_onnx.empty()) {
        LOG_INFO("Building TensorRT engine from: {}", args.build_engine_onnx);

        kds::DetectionConfig det_config;
        det_config.model_path = args.build_engine_onnx;
        det_config.engine_path = args.build_engine_onnx + ".engine";
        det_config.use_fp16 = true;

        kds::YoloTensorRT detector(det_config);
        if (!detector.build_engine()) {
            LOG_ERROR("Failed to build TensorRT engine");
            return 1;
        }

        if (!detector.save_engine(det_config.engine_path)) {
            LOG_ERROR("Failed to save TensorRT engine");
            return 1;
        }

        LOG_INFO("Engine saved to: {}", det_config.engine_path);
        return 0;
    }

    // Handle test-camera mode
    if (args.test_camera) {
        LOG_INFO("Testing camera connection: {}", config.camera.url);

        kds::RTSPClient camera(config.camera);
        if (!camera.start()) {
            LOG_ERROR("Failed to start camera");
            return 1;
        }

        // Capture a few frames
        int frames = 0;
        auto start = std::chrono::steady_clock::now();

        while (frames < 30) {
            cv::Mat frame;
            if (camera.read(frame)) {
                frames++;
                LOG_INFO("Frame {}: {}x{}", frames, frame.cols, frame.rows);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(33));
        }

        auto elapsed = std::chrono::duration<float>(
            std::chrono::steady_clock::now() - start).count();
        LOG_INFO("Captured {} frames in {:.2f}s ({:.1f} FPS)",
                 frames, elapsed, frames / elapsed);

        camera.stop();
        return 0;
    }

    // Handle test-inference mode
    if (args.test_inference) {
        LOG_INFO("Testing inference with TensorRT engine");

        kds::YoloTensorRT detector(config.detection);
        if (!detector.initialize()) {
            LOG_ERROR("Failed to initialize detector");
            return 1;
        }

        // Warmup
        detector.warmup(10);

        // Test with dummy image
        cv::Mat test_image(640, 640, CV_8UC3, cv::Scalar(128, 128, 128));
        auto detections = detector.detect(test_image);

        LOG_INFO("Inference time: {:.2f}ms, Detections: {}",
                 detector.get_inference_time(), detections.size());

        return 0;
    }

    // Validate configuration
    if (!config.validate()) {
        LOG_ERROR("Invalid configuration");
        return 1;
    }

    // Setup signal handlers
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
    std::signal(SIGHUP, signal_handler);

    LOG_INFO("Device ID: {}", config.device_id);
    LOG_INFO("Camera URL: {}", config.camera.url);
    LOG_INFO("Backend URL: {}", config.backend.url);

    // Initialize components
    LOG_INFO("Initializing components...");

    // TensorRT detector
    kds::YoloTensorRT detector(config.detection);
    if (!detector.initialize()) {
        LOG_ERROR("Failed to initialize TensorRT detector");
        return 1;
    }
    LOG_INFO("TensorRT detector initialized");
    detector.warmup(5);

    // Tracker
    kds::Tracker tracker(config.tracker);
    LOG_INFO("Tracker initialized");

    // Homography
    kds::Homography homography(config.calibration);
    if (homography.is_calibrated()) {
        LOG_INFO("Homography calibration loaded");
    } else {
        LOG_WARN("No homography calibration - using simple mapping");
    }

    // Camera
    kds::RTSPClient camera(config.camera);
    if (!camera.start()) {
        LOG_ERROR("Failed to start camera");
        return 1;
    }
    LOG_INFO("Camera started");

    // WebSocket client
    kds::WebSocketClient ws_client(config.backend);

    // Set callbacks for backend events
    ws_client.set_config_callback([&](const kds::EdgeDeviceConfig& new_config) {
        LOG_INFO("Received configuration update from backend");

        // Update camera URL if changed
        if (!new_config.camera_url.empty() &&
            new_config.camera_url != config.camera.url) {
            LOG_INFO("Camera URL changed, reconnecting...");
            camera.set_url(new_config.camera_url);
        }

        // Update calibration if provided
        if (!new_config.calibration.homography_matrix.empty()) {
            kds::CalibrationConfig cal_config;
            cal_config.homography_matrix = new_config.calibration.homography_matrix;
            cal_config.floor_plan_width = new_config.calibration.floor_plan_width;
            cal_config.floor_plan_height = new_config.calibration.floor_plan_height;
            cal_config.grid_size = new_config.calibration.grid_size;
            homography.set_config(cal_config);
            LOG_INFO("Homography calibration updated");
        }
    });

    ws_client.set_command_callback([&](const kds::EdgeDeviceCommand& cmd) {
        LOG_INFO("Received command: {}", cmd.command);

        if (cmd.command == "STOP") {
            g_running = false;
        } else if (cmd.command == "RESTART") {
            // Could implement restart logic
            g_running = false;
        } else if (cmd.command == "RECALIBRATE") {
            homography.calibrate();
        }
    });

    // Start WebSocket client in background thread
    std::thread ws_thread([&ws_client]() {
        ws_client.run();
    });

    // Statistics
    uint64_t frames_processed = 0;
    uint64_t detections_total = 0;
    auto start_time = std::chrono::steady_clock::now();
    auto last_health_report = start_time;
    auto last_heartbeat = start_time;

    // Main processing loop
    LOG_INFO("Starting main processing loop");
    float target_frame_time = 1000.0f / config.camera.fps;

    while (g_running) {
        auto loop_start = std::chrono::steady_clock::now();

        // Check for config reload
        if (g_reload_config) {
            LOG_INFO("Reloading configuration");
            try {
                config = kds::Config::load(args.config_path);
                config.merge_env();
                g_reload_config = false;
            } catch (const std::exception& e) {
                LOG_ERROR("Failed to reload config: {}", e.what());
            }
        }

        // Read frame from camera
        cv::Mat frame;
        if (!camera.read(frame)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        frames_processed++;

        // Run person detection
        auto detections = detector.detect(frame);

        if (detections.empty()) {
            // Still update tracker (age tracks without detections)
            tracker.update({});
        } else {
            // Update tracker with detections
            auto tracked = tracker.update(detections);

            // Transform to floor coordinates and prepare occupancy data
            std::vector<kds::OccupancyData> occupancy_data;

            for (const auto& person : tracked) {
                auto floor_pos = homography.transform_bbox_bottom(person.bbox);

                kds::OccupancyData data;
                data.tracking_id = "track_" + std::to_string(person.id);
                data.position = floor_pos;
                data.state = person.state;
                data.confidence = person.confidence;
                data.velocity = person.velocity;

                occupancy_data.push_back(data);
                detections_total++;
            }

            // Send to backend
            if (!occupancy_data.empty() && ws_client.is_connected()) {
                ws_client.send_occupancy_data(occupancy_data);
            }
        }

        // Send heartbeat periodically
        auto now = std::chrono::steady_clock::now();
        auto since_heartbeat = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - last_heartbeat).count();

        if (since_heartbeat >= config.backend.heartbeat_interval_ms) {
            if (ws_client.is_connected()) {
                ws_client.send_heartbeat();
            }
            last_heartbeat = now;
        }

        // Send health report periodically
        auto since_health = std::chrono::duration_cast<std::chrono::milliseconds>(
            now - last_health_report).count();

        if (since_health >= config.backend.health_report_interval_ms) {
            if (ws_client.is_connected()) {
                auto health = get_health_status(
                    config, camera, tracker, detector,
                    frames_processed, detections_total, start_time);
                ws_client.send_health_status(health);
            }
            last_health_report = now;
        }

        // Rate limiting
        auto loop_end = std::chrono::steady_clock::now();
        auto elapsed_ms = std::chrono::duration<float, std::milli>(
            loop_end - loop_start).count();

        if (elapsed_ms < target_frame_time) {
            std::this_thread::sleep_for(
                std::chrono::milliseconds(static_cast<int>(target_frame_time - elapsed_ms)));
        }
    }

    // Cleanup
    LOG_INFO("Shutting down...");

    ws_client.stop();
    if (ws_thread.joinable()) {
        ws_thread.join();
    }

    camera.stop();

    auto total_time = std::chrono::duration<float>(
        std::chrono::steady_clock::now() - start_time).count();

    LOG_INFO("Session statistics:");
    LOG_INFO("  Total time: {:.1f}s", total_time);
    LOG_INFO("  Frames processed: {}", frames_processed);
    LOG_INFO("  Average FPS: {:.1f}", frames_processed / total_time);
    LOG_INFO("  Total detections: {}", detections_total);
    LOG_INFO("  Tracker stats: active={} total={}",
             tracker.get_stats().active_tracks,
             tracker.get_stats().total_tracked);

    LOG_INFO("Shutdown complete");
    return 0;
}
