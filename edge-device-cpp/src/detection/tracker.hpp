#pragma once

#include "types.hpp"
#include "../config.hpp"

#include <opencv2/opencv.hpp>
#include <vector>
#include <deque>
#include <unordered_map>

namespace kds {

// Simple IoU-based tracker (similar to SORT algorithm)
class Tracker {
public:
    explicit Tracker(const TrackerConfig& config);
    ~Tracker() = default;

    // Update tracker with new detections
    std::vector<TrackedPerson> update(const std::vector<Detection>& detections);

    // Get all active tracks
    std::vector<TrackedPerson> get_tracks() const;

    // Get confirmed tracks only
    std::vector<TrackedPerson> get_confirmed_tracks() const;

    // Reset tracker state
    void reset();

    // Get tracker statistics
    struct Stats {
        int active_tracks;
        int confirmed_tracks;
        int total_tracked;
    };
    Stats get_stats() const;

private:
    TrackerConfig config_;

    // Track management
    int next_track_id_ = 1;
    int total_tracked_ = 0;
    std::vector<TrackedPerson> tracks_;

    // History for velocity estimation
    std::unordered_map<int, std::deque<cv::Point2f>> position_history_;
    static constexpr size_t MAX_HISTORY_SIZE = 10;

    // Internal methods
    float calculate_iou(const cv::Rect2f& box1, const cv::Rect2f& box2);

    // Hungarian algorithm for optimal matching
    std::vector<std::pair<int, int>> hungarian_match(
        const std::vector<std::vector<float>>& cost_matrix,
        float threshold);

    // Kalman filter prediction
    cv::Rect2f predict_kalman(TrackedPerson& track);

    // Update track with detection
    void update_track(TrackedPerson& track, const Detection& detection);

    // Estimate person state based on velocity and position
    PersonState estimate_state(const TrackedPerson& track);

    // Calculate velocity from history
    cv::Point2f calculate_velocity(int track_id);
};

} // namespace kds
