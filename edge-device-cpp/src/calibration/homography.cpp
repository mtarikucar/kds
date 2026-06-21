#include "homography.hpp"
#include "../utils/logger.hpp"

#include <cmath>

namespace kds {

namespace {
// Build a 3x3 cv::Mat from a config matrix, validating EVERY row. The old guard
// checked only matrix[0].size(), so a ragged matrix with a 3-wide first row
// passed and then read out of bounds on rows 1/2.
template <typename M>
bool build_3x3(const M& matrix, cv::Mat& out) {
    if (matrix.size() != 3) return false;
    for (const auto& row : matrix) {
        if (row.size() != 3) return false;
    }
    out = cv::Mat(3, 3, CV_64F);
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            out.at<double>(i, j) = matrix[i][j];
        }
    }
    return true;
}
}  // namespace

Homography::Homography(const CalibrationConfig& config)
    : config_(config) {

    // Check if homography matrix is provided in config
    if (config.homography_matrix.has_value()) {
        cv::Mat m;
        if (build_3x3(config.homography_matrix.value(), m)) {
            set_homography_matrix(m);  // validates 3x3 + computes inverse
        } else {
            LOG_ERROR("Ignoring malformed homography_matrix in config (must be 3x3)");
        }
    }

    // Check if calibration points are provided
    if (!calibrated_ && !config.points.empty()) {
        calibrate();
    }
}

bool Homography::calibrate() {
    if (config_.points.size() < 4) {
        LOG_ERROR("Need at least 4 calibration points, got {}", config_.points.size());
        return false;
    }

    image_points_.clear();
    floor_points_.clear();

    for (const auto& pt : config_.points) {
        image_points_.emplace_back(pt.image_x, pt.image_y);
        floor_points_.emplace_back(pt.floor_x, pt.floor_z);
    }

    return calibrate(image_points_, floor_points_);
}

bool Homography::calibrate(const std::vector<cv::Point2f>& image_points,
                            const std::vector<cv::Point2f>& floor_points) {
    if (image_points.size() < 4 || floor_points.size() < 4) {
        LOG_ERROR("Need at least 4 calibration points");
        return false;
    }

    if (image_points.size() != floor_points.size()) {
        LOG_ERROR("Image and floor points count mismatch");
        return false;
    }

    image_points_ = image_points;
    floor_points_ = floor_points;

    // Compute homography matrix using OpenCV
    // RANSAC for robustness to outliers
    homography_matrix_ = cv::findHomography(image_points, floor_points, cv::RANSAC);

    if (homography_matrix_.empty()) {
        LOG_ERROR("Failed to compute homography matrix");
        return false;
    }

    // Compute inverse matrix
    inverse_matrix_ = homography_matrix_.inv();

    calibrated_ = true;

    // Log calibration quality
    float error = compute_reprojection_error();
    LOG_INFO("Homography calibrated with {} points, reprojection error: {:.2f} pixels",
             image_points.size(), error);

    return true;
}

bool Homography::set_homography_matrix(const cv::Mat& matrix) {
    if (matrix.rows != 3 || matrix.cols != 3) {
        LOG_ERROR("Invalid homography matrix size: {}x{}", matrix.rows, matrix.cols);
        return false;
    }

    matrix.convertTo(homography_matrix_, CV_64F);
    inverse_matrix_ = homography_matrix_.inv();
    calibrated_ = true;

    LOG_INFO("Homography matrix set directly");
    return true;
}

FloorPosition Homography::transform_point(float image_x, float image_y) const {
    return transform_point(cv::Point2f(image_x, image_y));
}

FloorPosition Homography::transform_point(const cv::Point2f& image_point) const {
    FloorPosition result{};

    if (!calibrated_) {
        // Fallback: use simple linear mapping
        result.x = image_point.x / 100.0f;  // Assume 100 pixels = 1 meter
        result.z = image_point.y / 100.0f;
        result.grid_x = compute_grid_x(result.x);
        result.grid_z = compute_grid_z(result.z);
        return result;
    }

    // Apply homography transformation
    std::vector<cv::Point2f> src_points = {image_point};
    std::vector<cv::Point2f> dst_points;

    cv::perspectiveTransform(src_points, dst_points, homography_matrix_);

    if (!dst_points.empty()) {
        result.x = dst_points[0].x;
        result.z = dst_points[0].y;  // Note: OpenCV Y -> floor Z
    }

    result.grid_x = compute_grid_x(result.x);
    result.grid_z = compute_grid_z(result.z);

    return result;
}

std::vector<FloorPosition> Homography::transform_points(
    const std::vector<cv::Point2f>& image_points) const {

    std::vector<FloorPosition> results;
    results.reserve(image_points.size());

    if (!calibrated_ || image_points.empty()) {
        for (const auto& pt : image_points) {
            results.push_back(transform_point(pt));
        }
        return results;
    }

    // Batch transform
    std::vector<cv::Point2f> dst_points;
    cv::perspectiveTransform(image_points, dst_points, homography_matrix_);

    for (const auto& dst : dst_points) {
        FloorPosition pos{};
        pos.x = dst.x;
        pos.z = dst.y;
        pos.grid_x = compute_grid_x(pos.x);
        pos.grid_z = compute_grid_z(pos.z);
        results.push_back(pos);
    }

    return results;
}

FloorPosition Homography::transform_bbox_bottom(const cv::Rect2f& bbox) const {
    // Use bottom center of bounding box as foot position
    float bottom_x = bbox.x + bbox.width / 2.0f;
    float bottom_y = bbox.y + bbox.height;

    return transform_point(bottom_x, bottom_y);
}

cv::Mat Homography::get_homography_matrix() const {
    return homography_matrix_.clone();
}

cv::Mat Homography::get_inverse_homography_matrix() const {
    return inverse_matrix_.clone();
}

cv::Point2f Homography::inverse_transform_point(const FloorPosition& floor_pos) const {
    if (!calibrated_) {
        return cv::Point2f(floor_pos.x * 100.0f, floor_pos.z * 100.0f);
    }

    std::vector<cv::Point2f> src_points = {cv::Point2f(floor_pos.x, floor_pos.z)};
    std::vector<cv::Point2f> dst_points;

    cv::perspectiveTransform(src_points, dst_points, inverse_matrix_);

    if (!dst_points.empty()) {
        return dst_points[0];
    }

    return cv::Point2f(0, 0);
}

float Homography::compute_reprojection_error() const {
    if (!calibrated_ || image_points_.empty()) {
        return -1.0f;
    }

    // Transform image points to floor, then back to image
    std::vector<cv::Point2f> reprojected;
    cv::perspectiveTransform(image_points_, reprojected, homography_matrix_);
    cv::perspectiveTransform(reprojected, reprojected, inverse_matrix_);

    // Compute RMS error
    float total_error = 0.0f;
    for (size_t i = 0; i < image_points_.size(); ++i) {
        float dx = image_points_[i].x - reprojected[i].x;
        float dy = image_points_[i].y - reprojected[i].y;
        total_error += dx * dx + dy * dy;
    }

    return std::sqrt(total_error / image_points_.size());
}

void Homography::set_config(const CalibrationConfig& config) {
    config_ = config;

    // Apply a directly-provided matrix (runtime recalibration via edge:config).
    // Previously this was ignored, so a pushed homography_matrix was a silent
    // no-op. An explicit matrix takes precedence over calibration points.
    if (config.homography_matrix.has_value()) {
        cv::Mat m;
        if (build_3x3(config.homography_matrix.value(), m)) {
            set_homography_matrix(m);
            return;
        }
        LOG_ERROR("Ignoring malformed homography_matrix in set_config (must be 3x3)");
    }

    // Re-calibrate if points are provided
    if (!config.points.empty()) {
        calibrate();
    }
}

int Homography::compute_grid_x(float floor_x) const {
    // Map floor X coordinate to grid cell
    float normalized = floor_x / config_.floor_plan_width;
    int grid_x = static_cast<int>(normalized * config_.grid_size);

    // Clamp to valid range
    return std::max(0, std::min(grid_x, config_.grid_size - 1));
}

int Homography::compute_grid_z(float floor_z) const {
    // Map floor Z coordinate to grid cell
    float normalized = floor_z / config_.floor_plan_height;
    int grid_z = static_cast<int>(normalized * config_.grid_size);

    // Clamp to valid range
    return std::max(0, std::min(grid_z, config_.grid_size - 1));
}

} // namespace kds
