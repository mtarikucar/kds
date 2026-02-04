#pragma once

#include "../config.hpp"
#include "../detection/types.hpp"

#include <opencv2/opencv.hpp>
#include <vector>
#include <optional>

namespace kds {

class Homography {
public:
    explicit Homography(const CalibrationConfig& config);
    ~Homography() = default;

    // Check if calibration is loaded/computed
    bool is_calibrated() const { return calibrated_; }

    // Compute homography from calibration points
    bool calibrate();

    // Compute homography from explicit point correspondences
    bool calibrate(const std::vector<cv::Point2f>& image_points,
                   const std::vector<cv::Point2f>& floor_points);

    // Load homography matrix directly
    bool set_homography_matrix(const cv::Mat& matrix);

    // Transform a single point from image to floor coordinates
    FloorPosition transform_point(float image_x, float image_y) const;
    FloorPosition transform_point(const cv::Point2f& image_point) const;

    // Transform multiple points
    std::vector<FloorPosition> transform_points(
        const std::vector<cv::Point2f>& image_points) const;

    // Transform bounding box bottom center to floor position
    FloorPosition transform_bbox_bottom(const cv::Rect2f& bbox) const;

    // Get the homography matrix (for debugging/serialization)
    cv::Mat get_homography_matrix() const;

    // Get inverse homography matrix (floor to image)
    cv::Mat get_inverse_homography_matrix() const;

    // Transform floor point to image point (inverse)
    cv::Point2f inverse_transform_point(const FloorPosition& floor_pos) const;

    // Compute reprojection error (for calibration quality)
    float compute_reprojection_error() const;

    // Update configuration
    void set_config(const CalibrationConfig& config);

    // Get current grid size
    int get_grid_size() const { return config_.grid_size; }

    // Get floor plan dimensions
    float get_floor_width() const { return config_.floor_plan_width; }
    float get_floor_height() const { return config_.floor_plan_height; }

private:
    CalibrationConfig config_;
    bool calibrated_ = false;

    cv::Mat homography_matrix_;       // 3x3 homography matrix (image -> floor)
    cv::Mat inverse_matrix_;          // 3x3 inverse matrix (floor -> image)

    // Cached calibration points (for reprojection error)
    std::vector<cv::Point2f> image_points_;
    std::vector<cv::Point2f> floor_points_;

    // Internal methods
    int compute_grid_x(float floor_x) const;
    int compute_grid_z(float floor_z) const;
};

} // namespace kds
