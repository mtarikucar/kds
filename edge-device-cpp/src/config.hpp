#pragma once

#include <string>
#include <vector>
#include <optional>
#include <nlohmann/json.hpp>

namespace kds {

struct CameraConfig {
    std::string url;           // RTSP URL
    int width = 1280;
    int height = 720;
    int fps = 30;
    int reconnect_delay_ms = 5000;
    int buffer_size = 3;       // Frame buffer size
};

struct DetectionConfig {
    std::string model_path = "models/yolov8n.onnx";
    std::string engine_path = "models/yolov8n.engine";
    int input_size = 640;
    float confidence_threshold = 0.5f;
    float nms_threshold = 0.45f;
    bool use_fp16 = true;      // Use FP16 precision (faster on Jetson)
    bool use_int8 = false;     // Use INT8 quantization (requires calibration)
    int max_batch_size = 1;
};

struct TrackerConfig {
    int max_age = 30;          // Max frames to keep track without detection
    int min_hits = 3;          // Min hits before track is confirmed
    float iou_threshold = 0.3f;
    bool use_kalman = true;
};

struct CalibrationPoint {
    float image_x;
    float image_y;
    float floor_x;
    float floor_z;
};

struct CalibrationConfig {
    std::vector<CalibrationPoint> points;
    float floor_plan_width = 20.0f;   // meters
    float floor_plan_height = 20.0f;  // meters
    int grid_size = 20;               // 20x20 grid
    std::optional<std::vector<std::vector<float>>> homography_matrix;
};

struct BackendConfig {
    std::string url = "ws://localhost:3000/analytics-edge";
    std::string auth_token;
    std::string tenant_id;
    std::string device_id;
    std::string camera_id;
    int heartbeat_interval_ms = 30000;
    int reconnect_delay_ms = 5000;
    int health_report_interval_ms = 60000;
};

struct Config {
    std::string device_id;
    std::string log_level = "info";    // debug, info, warn, error
    std::string log_file;              // Optional log file path

    CameraConfig camera;
    DetectionConfig detection;
    TrackerConfig tracker;
    CalibrationConfig calibration;
    BackendConfig backend;

    // Load config from YAML file
    static Config load(const std::string& path);

    // Load config from environment variables
    static Config from_env();

    // Merge with environment variables (env takes precedence)
    void merge_env();

    // Validate configuration
    bool validate() const;

    // Convert to JSON (for sending to backend)
    nlohmann::json to_json() const;
};

} // namespace kds
