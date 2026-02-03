#include "config.hpp"
#include "utils/logger.hpp"

#include <yaml-cpp/yaml.h>
#include <cstdlib>
#include <fstream>
#include <filesystem>

namespace kds {

Config Config::load(const std::string& path) {
    Config config;

    if (!std::filesystem::exists(path)) {
        LOG_WARN("Config file not found: {}, using defaults", path);
        return config;
    }

    try {
        YAML::Node yaml = YAML::LoadFile(path);

        // Device settings
        if (yaml["device_id"]) {
            config.device_id = yaml["device_id"].as<std::string>();
        }
        if (yaml["log_level"]) {
            config.log_level = yaml["log_level"].as<std::string>();
        }
        if (yaml["log_file"]) {
            config.log_file = yaml["log_file"].as<std::string>();
        }

        // Camera settings
        if (yaml["camera"]) {
            auto cam = yaml["camera"];
            if (cam["url"]) config.camera.url = cam["url"].as<std::string>();
            if (cam["width"]) config.camera.width = cam["width"].as<int>();
            if (cam["height"]) config.camera.height = cam["height"].as<int>();
            if (cam["fps"]) config.camera.fps = cam["fps"].as<int>();
            if (cam["reconnect_delay_ms"]) config.camera.reconnect_delay_ms = cam["reconnect_delay_ms"].as<int>();
            if (cam["buffer_size"]) config.camera.buffer_size = cam["buffer_size"].as<int>();
        }

        // Detection settings
        if (yaml["detection"]) {
            auto det = yaml["detection"];
            if (det["model_path"]) config.detection.model_path = det["model_path"].as<std::string>();
            if (det["engine_path"]) config.detection.engine_path = det["engine_path"].as<std::string>();
            if (det["input_size"]) config.detection.input_size = det["input_size"].as<int>();
            if (det["confidence_threshold"]) config.detection.confidence_threshold = det["confidence_threshold"].as<float>();
            if (det["nms_threshold"]) config.detection.nms_threshold = det["nms_threshold"].as<float>();
            if (det["use_fp16"]) config.detection.use_fp16 = det["use_fp16"].as<bool>();
            if (det["use_int8"]) config.detection.use_int8 = det["use_int8"].as<bool>();
            if (det["max_batch_size"]) config.detection.max_batch_size = det["max_batch_size"].as<int>();
        }

        // Tracker settings
        if (yaml["tracker"]) {
            auto trk = yaml["tracker"];
            if (trk["max_age"]) config.tracker.max_age = trk["max_age"].as<int>();
            if (trk["min_hits"]) config.tracker.min_hits = trk["min_hits"].as<int>();
            if (trk["iou_threshold"]) config.tracker.iou_threshold = trk["iou_threshold"].as<float>();
            if (trk["use_kalman"]) config.tracker.use_kalman = trk["use_kalman"].as<bool>();
        }

        // Calibration settings
        if (yaml["calibration"]) {
            auto cal = yaml["calibration"];
            if (cal["floor_plan_width"]) config.calibration.floor_plan_width = cal["floor_plan_width"].as<float>();
            if (cal["floor_plan_height"]) config.calibration.floor_plan_height = cal["floor_plan_height"].as<float>();
            if (cal["grid_size"]) config.calibration.grid_size = cal["grid_size"].as<int>();

            if (cal["points"]) {
                for (const auto& pt : cal["points"]) {
                    CalibrationPoint point{};
                    point.image_x = pt["image_x"].as<float>();
                    point.image_y = pt["image_y"].as<float>();
                    point.floor_x = pt["floor_x"].as<float>();
                    point.floor_z = pt["floor_z"].as<float>();
                    config.calibration.points.push_back(point);
                }
            }

            if (cal["homography_matrix"]) {
                std::vector<std::vector<float>> matrix;
                for (const auto& row : cal["homography_matrix"]) {
                    std::vector<float> row_vals;
                    for (const auto& val : row) {
                        row_vals.push_back(val.as<float>());
                    }
                    matrix.push_back(row_vals);
                }
                config.calibration.homography_matrix = matrix;
            }
        }

        // Backend settings
        if (yaml["backend"]) {
            auto be = yaml["backend"];
            if (be["url"]) config.backend.url = be["url"].as<std::string>();
            if (be["auth_token"]) config.backend.auth_token = be["auth_token"].as<std::string>();
            if (be["tenant_id"]) config.backend.tenant_id = be["tenant_id"].as<std::string>();
            if (be["device_id"]) config.backend.device_id = be["device_id"].as<std::string>();
            if (be["camera_id"]) config.backend.camera_id = be["camera_id"].as<std::string>();
            if (be["heartbeat_interval_ms"]) config.backend.heartbeat_interval_ms = be["heartbeat_interval_ms"].as<int>();
            if (be["reconnect_delay_ms"]) config.backend.reconnect_delay_ms = be["reconnect_delay_ms"].as<int>();
            if (be["health_report_interval_ms"]) config.backend.health_report_interval_ms = be["health_report_interval_ms"].as<int>();
        }

        LOG_INFO("Config loaded from: {}", path);

    } catch (const YAML::Exception& e) {
        LOG_ERROR("Failed to parse config file: {}", e.what());
        throw;
    }

    return config;
}

Config Config::from_env() {
    Config config;

    // Device settings
    if (const char* val = std::getenv("KDS_DEVICE_ID")) {
        config.device_id = val;
    }
    if (const char* val = std::getenv("KDS_LOG_LEVEL")) {
        config.log_level = val;
    }

    // Camera settings
    if (const char* val = std::getenv("KDS_CAMERA_URL")) {
        config.camera.url = val;
    }
    if (const char* val = std::getenv("KDS_CAMERA_WIDTH")) {
        config.camera.width = std::stoi(val);
    }
    if (const char* val = std::getenv("KDS_CAMERA_HEIGHT")) {
        config.camera.height = std::stoi(val);
    }
    if (const char* val = std::getenv("KDS_CAMERA_FPS")) {
        config.camera.fps = std::stoi(val);
    }

    // Detection settings
    if (const char* val = std::getenv("KDS_MODEL_PATH")) {
        config.detection.model_path = val;
    }
    if (const char* val = std::getenv("KDS_ENGINE_PATH")) {
        config.detection.engine_path = val;
    }
    if (const char* val = std::getenv("KDS_CONFIDENCE_THRESHOLD")) {
        config.detection.confidence_threshold = std::stof(val);
    }

    // Backend settings
    if (const char* val = std::getenv("KDS_BACKEND_URL")) {
        config.backend.url = val;
    }
    if (const char* val = std::getenv("KDS_AUTH_TOKEN")) {
        config.backend.auth_token = val;
    }
    if (const char* val = std::getenv("KDS_TENANT_ID")) {
        config.backend.tenant_id = val;
    }
    if (const char* val = std::getenv("KDS_CAMERA_ID")) {
        config.backend.camera_id = val;
    }

    return config;
}

void Config::merge_env() {
    // Merge environment variables (they take precedence)
    if (const char* val = std::getenv("KDS_DEVICE_ID")) {
        device_id = val;
    }
    if (const char* val = std::getenv("KDS_LOG_LEVEL")) {
        log_level = val;
    }
    if (const char* val = std::getenv("KDS_CAMERA_URL")) {
        camera.url = val;
    }
    if (const char* val = std::getenv("KDS_BACKEND_URL")) {
        backend.url = val;
    }
    if (const char* val = std::getenv("KDS_AUTH_TOKEN")) {
        backend.auth_token = val;
    }
    if (const char* val = std::getenv("KDS_TENANT_ID")) {
        backend.tenant_id = val;
    }
    if (const char* val = std::getenv("KDS_CAMERA_ID")) {
        backend.camera_id = val;
    }
}

bool Config::validate() const {
    bool valid = true;

    if (device_id.empty()) {
        LOG_ERROR("device_id is required");
        valid = false;
    }

    if (camera.url.empty()) {
        LOG_ERROR("camera.url is required");
        valid = false;
    }

    if (backend.url.empty()) {
        LOG_ERROR("backend.url is required");
        valid = false;
    }

    if (backend.auth_token.empty()) {
        LOG_ERROR("backend.auth_token is required");
        valid = false;
    }

    if (backend.tenant_id.empty()) {
        LOG_ERROR("backend.tenant_id is required");
        valid = false;
    }

    if (backend.camera_id.empty()) {
        LOG_ERROR("backend.camera_id is required");
        valid = false;
    }

    if (detection.confidence_threshold < 0.0f || detection.confidence_threshold > 1.0f) {
        LOG_ERROR("detection.confidence_threshold must be between 0 and 1");
        valid = false;
    }

    return valid;
}

nlohmann::json Config::to_json() const {
    nlohmann::json j;

    j["device_id"] = device_id;
    j["log_level"] = log_level;

    j["camera"] = {
        {"url", camera.url},
        {"width", camera.width},
        {"height", camera.height},
        {"fps", camera.fps}
    };

    j["detection"] = {
        {"model_path", detection.model_path},
        {"input_size", detection.input_size},
        {"confidence_threshold", detection.confidence_threshold},
        {"nms_threshold", detection.nms_threshold},
        {"use_fp16", detection.use_fp16},
        {"use_int8", detection.use_int8}
    };

    j["tracker"] = {
        {"max_age", tracker.max_age},
        {"min_hits", tracker.min_hits},
        {"iou_threshold", tracker.iou_threshold}
    };

    j["calibration"] = {
        {"floor_plan_width", calibration.floor_plan_width},
        {"floor_plan_height", calibration.floor_plan_height},
        {"grid_size", calibration.grid_size}
    };

    j["backend"] = {
        {"url", backend.url},
        {"tenant_id", backend.tenant_id},
        {"camera_id", backend.camera_id}
    };

    return j;
}

} // namespace kds
