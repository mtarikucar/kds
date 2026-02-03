#pragma once

#include <opencv2/opencv.hpp>
#include <string>
#include <vector>

namespace kds {

// Person state classifications
enum class PersonState {
    STANDING,
    SITTING,
    MOVING,
    WAITING,
    UNKNOWN
};

inline std::string person_state_to_string(PersonState state) {
    switch (state) {
        case PersonState::STANDING: return "STANDING";
        case PersonState::SITTING: return "SITTING";
        case PersonState::MOVING: return "MOVING";
        case PersonState::WAITING: return "WAITING";
        default: return "UNKNOWN";
    }
}

// Raw detection from YOLO model
struct Detection {
    cv::Rect2f bbox;           // Bounding box in image coordinates
    float confidence;          // Detection confidence (0-1)
    int class_id;              // Class ID (0 = person for YOLOv8)

    // Convenience methods
    cv::Point2f center() const {
        return cv::Point2f(bbox.x + bbox.width / 2.0f, bbox.y + bbox.height / 2.0f);
    }

    cv::Point2f bottom_center() const {
        return cv::Point2f(bbox.x + bbox.width / 2.0f, bbox.y + bbox.height);
    }

    float area() const {
        return bbox.width * bbox.height;
    }
};

// Tracked person with temporal information
struct TrackedPerson {
    int id;                    // Unique tracking ID
    cv::Rect2f bbox;           // Current bounding box
    cv::Point2f velocity;      // Estimated velocity (pixels/frame)
    float confidence;          // Current detection confidence
    PersonState state;         // Estimated state (standing, sitting, etc.)

    int age = 0;               // Frames since last detection
    int hits = 0;              // Number of consecutive detections
    bool is_confirmed = false; // Track is confirmed (hits >= min_hits)

    // Kalman filter state (if using Kalman tracking)
    cv::Mat kalman_state;      // [x, y, w, h, vx, vy]

    // Convenience methods
    cv::Point2f center() const {
        return cv::Point2f(bbox.x + bbox.width / 2.0f, bbox.y + bbox.height / 2.0f);
    }

    cv::Point2f bottom_center() const {
        return cv::Point2f(bbox.x + bbox.width / 2.0f, bbox.y + bbox.height);
    }

    bool is_moving() const {
        float speed = std::sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        return speed > 5.0f;  // Threshold in pixels/frame
    }
};

// Floor position after homography transformation
struct FloorPosition {
    float x;          // X coordinate in floor plan (meters)
    float z;          // Z coordinate in floor plan (meters)
    int grid_x;       // Grid cell X index (0-19)
    int grid_z;       // Grid cell Z index (0-19)
};

// Complete occupancy data for one person
struct OccupancyData {
    std::string tracking_id;
    FloorPosition position;
    PersonState state;
    float confidence;
    cv::Point2f velocity;
};

} // namespace kds
