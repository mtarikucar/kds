#pragma once

#include "../detection/types.hpp"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <chrono>

namespace kds {

// Edge device registration data
struct EdgeDeviceRegisterData {
    std::string device_id;
    std::string tenant_id;
    std::string camera_id;
    std::string firmware_version;
    std::string hardware_type;

    struct Capabilities {
        bool yolov8 = true;
        bool pose = false;
        bool tracking = true;
        bool gpu_accel = true;
    } capabilities;

    nlohmann::json to_json() const {
        return {
            {"deviceId", device_id},
            {"tenantId", tenant_id},
            {"cameraId", camera_id},
            {"timestamp", std::chrono::system_clock::now().time_since_epoch().count()},
            {"firmwareVersion", firmware_version},
            {"hardwareType", hardware_type},
            {"capabilities", {
                {"yolov8", capabilities.yolov8},
                {"pose", capabilities.pose},
                {"tracking", capabilities.tracking},
                {"gpuAccel", capabilities.gpu_accel}
            }}
        };
    }
};

// Detection data to send to backend
struct DetectionPayload {
    std::string tracking_id;
    float position_x;
    float position_z;
    int grid_x;
    int grid_z;
    std::string state;
    float confidence;
    float velocity_x = 0.0f;
    float velocity_z = 0.0f;

    nlohmann::json to_json() const {
        return {
            {"trackingId", tracking_id},
            {"positionX", position_x},
            {"positionZ", position_z},
            {"gridX", grid_x},
            {"gridZ", grid_z},
            {"state", state},
            {"confidence", confidence},
            {"velocityX", velocity_x},
            {"velocityZ", velocity_z}
        };
    }
};

// Occupancy data payload
struct OccupancyPayload {
    std::string camera_id;
    std::string tenant_id;
    std::string timestamp;  // ISO 8601 format
    std::vector<DetectionPayload> detections;

    nlohmann::json to_json() const {
        nlohmann::json j = {
            {"cameraId", camera_id},
            {"tenantId", tenant_id},
            {"timestamp", timestamp}
        };

        nlohmann::json det_array = nlohmann::json::array();
        for (const auto& det : detections) {
            det_array.push_back(det.to_json());
        }
        j["detections"] = det_array;

        return j;
    }
};

// Health status payload
struct HealthStatusPayload {
    std::string device_id;
    std::string timestamp;
    int uptime = 0;           // seconds
    uint64_t frames_processed = 0;
    uint64_t detections_total = 0;
    float fps = 0.0f;

    float cpu_usage = 0.0f;   // 0-100
    float memory_usage = 0.0f;// 0-100
    float gpu_usage = 0.0f;   // 0-100
    float temperature = 0.0f; // Celsius

    struct CameraStatus {
        std::string state;
        std::string url;
        int reconnect_count = 0;
        float actual_fps = 0.0f;
    } camera;

    struct TrackerStatus {
        int active_tracks = 0;
        int total_tracked = 0;
    } tracker;

    nlohmann::json to_json() const {
        return {
            {"deviceId", device_id},
            {"timestamp", timestamp},
            {"uptime", uptime},
            {"framesProcessed", frames_processed},
            {"detectionsTotal", detections_total},
            {"fps", fps},
            {"cpuUsage", cpu_usage},
            {"memoryUsage", memory_usage},
            {"gpuUsage", gpu_usage},
            {"temperature", temperature},
            {"camera", {
                {"state", camera.state},
                {"url", camera.url},
                {"reconnectCount", camera.reconnect_count},
                {"actualFps", camera.actual_fps}
            }},
            {"tracker", {
                {"activeTracks", tracker.active_tracks},
                {"totalTracked", tracker.total_tracked}
            }}
        };
    }
};

// Configuration received from backend
struct EdgeDeviceConfig {
    std::string camera_id;
    std::string camera_url;
    int fps = 30;
    float confidence_threshold = 0.5f;

    struct Calibration {
        std::vector<std::vector<float>> homography_matrix;
        float floor_plan_width = 20.0f;
        float floor_plan_height = 20.0f;
        int grid_size = 20;
    } calibration;

    static EdgeDeviceConfig from_json(const nlohmann::json& j) {
        EdgeDeviceConfig config;

        if (j.contains("cameraId")) config.camera_id = j["cameraId"].get<std::string>();
        if (j.contains("cameraUrl")) config.camera_url = j["cameraUrl"].get<std::string>();
        if (j.contains("fps")) config.fps = j["fps"].get<int>();
        if (j.contains("confidenceThreshold")) {
            config.confidence_threshold = j["confidenceThreshold"].get<float>();
        }

        if (j.contains("calibration")) {
            const auto& cal = j["calibration"];
            if (cal.contains("homographyMatrix")) {
                config.calibration.homography_matrix =
                    cal["homographyMatrix"].get<std::vector<std::vector<float>>>();
            }
            if (cal.contains("floorPlanWidth")) {
                config.calibration.floor_plan_width = cal["floorPlanWidth"].get<float>();
            }
            if (cal.contains("floorPlanHeight")) {
                config.calibration.floor_plan_height = cal["floorPlanHeight"].get<float>();
            }
            if (cal.contains("gridSize")) {
                config.calibration.grid_size = cal["gridSize"].get<int>();
            }
        }

        return config;
    }
};

// Command from backend
struct EdgeDeviceCommand {
    std::string command;  // START, STOP, RESTART, RECALIBRATE, UPDATE_CONFIG
    nlohmann::json params;

    static EdgeDeviceCommand from_json(const nlohmann::json& j) {
        EdgeDeviceCommand cmd;
        if (j.contains("command")) cmd.command = j["command"].get<std::string>();
        if (j.contains("params")) cmd.params = j["params"];
        return cmd;
    }
};

} // namespace kds
