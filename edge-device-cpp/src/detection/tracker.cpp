#include "tracker.hpp"
#include "../utils/logger.hpp"

#include <algorithm>
#include <limits>
#include <cmath>

namespace kds {

Tracker::Tracker(const TrackerConfig& config)
    : config_(config) {
}

std::vector<TrackedPerson> Tracker::update(const std::vector<Detection>& detections) {
    // Predict existing tracks (using Kalman or simple velocity prediction)
    for (auto& track : tracks_) {
        if (config_.use_kalman && !track.kalman_state.empty()) {
            track.bbox = predict_kalman(track);
        } else {
            // Simple velocity-based prediction
            track.bbox.x += track.velocity.x;
            track.bbox.y += track.velocity.y;
        }
        track.age++;
    }

    // Build cost matrix (IoU-based)
    std::vector<std::vector<float>> cost_matrix(tracks_.size(),
                                                  std::vector<float>(detections.size(), 0.0f));

    for (size_t i = 0; i < tracks_.size(); ++i) {
        for (size_t j = 0; j < detections.size(); ++j) {
            float iou = calculate_iou(tracks_[i].bbox, detections[j].bbox);
            cost_matrix[i][j] = 1.0f - iou;  // Convert to cost (lower is better)
        }
    }

    // Match tracks to detections using Hungarian algorithm
    auto matches = hungarian_match(cost_matrix, 1.0f - config_.iou_threshold);

    // Track which detections and tracks are matched
    std::vector<bool> track_matched(tracks_.size(), false);
    std::vector<bool> detection_matched(detections.size(), false);

    // Update matched tracks
    for (const auto& match : matches) {
        int track_idx = match.first;
        int det_idx = match.second;

        update_track(tracks_[track_idx], detections[det_idx]);
        track_matched[track_idx] = true;
        detection_matched[det_idx] = true;
    }

    // Handle unmatched tracks
    for (size_t i = 0; i < tracks_.size(); ++i) {
        if (!track_matched[i]) {
            // Track was not matched, update age but don't delete yet
            // (handled below based on max_age)
        }
    }

    // Create new tracks for unmatched detections
    for (size_t i = 0; i < detections.size(); ++i) {
        if (!detection_matched[i]) {
            TrackedPerson new_track;
            new_track.id = next_track_id_++;
            new_track.bbox = detections[i].bbox;
            new_track.confidence = detections[i].confidence;
            new_track.velocity = cv::Point2f(0, 0);
            new_track.state = PersonState::UNKNOWN;
            new_track.age = 0;
            new_track.hits = 1;
            new_track.is_confirmed = false;

            // Initialize Kalman filter state if enabled
            if (config_.use_kalman) {
                new_track.kalman_state = cv::Mat::zeros(6, 1, CV_32F);
                new_track.kalman_state.at<float>(0) = new_track.bbox.x + new_track.bbox.width / 2;
                new_track.kalman_state.at<float>(1) = new_track.bbox.y + new_track.bbox.height / 2;
                new_track.kalman_state.at<float>(2) = new_track.bbox.width;
                new_track.kalman_state.at<float>(3) = new_track.bbox.height;
            }

            // Initialize position history
            position_history_[new_track.id].push_back(new_track.center());

            tracks_.push_back(new_track);
            total_tracked_++;

            LOG_DEBUG("New track created: id={}", new_track.id);
        }
    }

    // Remove dead tracks (too old without detections)
    tracks_.erase(
        std::remove_if(tracks_.begin(), tracks_.end(),
                       [this](const TrackedPerson& track) {
                           if (track.age > config_.max_age) {
                               LOG_DEBUG("Track removed: id={} (age={})", track.id, track.age);
                               position_history_.erase(track.id);
                               return true;
                           }
                           return false;
                       }),
        tracks_.end());

    // Estimate states for all tracks
    for (auto& track : tracks_) {
        track.state = estimate_state(track);
    }

    return get_confirmed_tracks();
}

std::vector<TrackedPerson> Tracker::get_tracks() const {
    return tracks_;
}

std::vector<TrackedPerson> Tracker::get_confirmed_tracks() const {
    std::vector<TrackedPerson> confirmed;
    for (const auto& track : tracks_) {
        if (track.is_confirmed) {
            confirmed.push_back(track);
        }
    }
    return confirmed;
}

void Tracker::reset() {
    tracks_.clear();
    position_history_.clear();
    next_track_id_ = 1;
    total_tracked_ = 0;
}

Tracker::Stats Tracker::get_stats() const {
    Stats stats{};
    stats.active_tracks = static_cast<int>(tracks_.size());
    stats.confirmed_tracks = 0;
    for (const auto& track : tracks_) {
        if (track.is_confirmed) {
            stats.confirmed_tracks++;
        }
    }
    stats.total_tracked = total_tracked_;
    return stats;
}

float Tracker::calculate_iou(const cv::Rect2f& box1, const cv::Rect2f& box2) {
    float x1 = std::max(box1.x, box2.x);
    float y1 = std::max(box1.y, box2.y);
    float x2 = std::min(box1.x + box1.width, box2.x + box2.width);
    float y2 = std::min(box1.y + box1.height, box2.y + box2.height);

    if (x2 <= x1 || y2 <= y1) {
        return 0.0f;
    }

    float intersection = (x2 - x1) * (y2 - y1);
    float area1 = box1.width * box1.height;
    float area2 = box2.width * box2.height;
    float union_area = area1 + area2 - intersection;

    if (union_area <= 0.0f) {
        return 0.0f;
    }

    return intersection / union_area;
}

std::vector<std::pair<int, int>> Tracker::hungarian_match(
    const std::vector<std::vector<float>>& cost_matrix,
    float threshold) {

    std::vector<std::pair<int, int>> matches;

    if (cost_matrix.empty() || cost_matrix[0].empty()) {
        return matches;
    }

    size_t num_tracks = cost_matrix.size();
    size_t num_dets = cost_matrix[0].size();

    // Simple greedy matching (can be replaced with proper Hungarian algorithm)
    std::vector<bool> track_used(num_tracks, false);
    std::vector<bool> det_used(num_dets, false);

    // Create list of all possible matches
    std::vector<std::tuple<float, int, int>> all_matches;
    for (size_t i = 0; i < num_tracks; ++i) {
        for (size_t j = 0; j < num_dets; ++j) {
            if (cost_matrix[i][j] < threshold) {
                all_matches.emplace_back(cost_matrix[i][j], i, j);
            }
        }
    }

    // Sort by cost (ascending)
    std::sort(all_matches.begin(), all_matches.end());

    // Greedy matching
    for (const auto& match : all_matches) {
        int track_idx = std::get<1>(match);
        int det_idx = std::get<2>(match);

        if (!track_used[track_idx] && !det_used[det_idx]) {
            matches.emplace_back(track_idx, det_idx);
            track_used[track_idx] = true;
            det_used[det_idx] = true;
        }
    }

    return matches;
}

cv::Rect2f Tracker::predict_kalman(TrackedPerson& track) {
    // Simple constant velocity prediction
    // For full Kalman filter, use cv::KalmanFilter
    if (track.kalman_state.empty()) {
        return track.bbox;
    }

    // Predict: x' = x + vx, y' = y + vy
    float cx = track.kalman_state.at<float>(0) + track.kalman_state.at<float>(4);
    float cy = track.kalman_state.at<float>(1) + track.kalman_state.at<float>(5);
    float w = track.kalman_state.at<float>(2);
    float h = track.kalman_state.at<float>(3);

    track.kalman_state.at<float>(0) = cx;
    track.kalman_state.at<float>(1) = cy;

    return cv::Rect2f(cx - w / 2, cy - h / 2, w, h);
}

void Tracker::update_track(TrackedPerson& track, const Detection& detection) {
    track.bbox = detection.bbox;
    track.confidence = detection.confidence;
    track.age = 0;
    track.hits++;

    // Update confirmed status
    if (track.hits >= config_.min_hits) {
        track.is_confirmed = true;
    }

    // Update position history
    auto& history = position_history_[track.id];
    history.push_back(track.center());
    if (history.size() > MAX_HISTORY_SIZE) {
        history.pop_front();
    }

    // Calculate velocity
    track.velocity = calculate_velocity(track.id);

    // Update Kalman state
    if (config_.use_kalman && !track.kalman_state.empty()) {
        float cx = track.bbox.x + track.bbox.width / 2;
        float cy = track.bbox.y + track.bbox.height / 2;

        track.kalman_state.at<float>(4) = cx - track.kalman_state.at<float>(0);
        track.kalman_state.at<float>(5) = cy - track.kalman_state.at<float>(1);
        track.kalman_state.at<float>(0) = cx;
        track.kalman_state.at<float>(1) = cy;
        track.kalman_state.at<float>(2) = track.bbox.width;
        track.kalman_state.at<float>(3) = track.bbox.height;
    }
}

PersonState Tracker::estimate_state(const TrackedPerson& track) {
    // Calculate speed (pixels per frame)
    float speed = std::sqrt(track.velocity.x * track.velocity.x +
                            track.velocity.y * track.velocity.y);

    // Estimate based on velocity and aspect ratio
    float aspect_ratio = track.bbox.width / (track.bbox.height + 1e-6f);

    // Moving threshold (pixels per frame)
    const float MOVING_THRESHOLD = 5.0f;
    const float WAITING_THRESHOLD = 2.0f;

    // Sitting: typically has wider aspect ratio (person bent)
    const float SITTING_ASPECT_MIN = 0.6f;

    if (speed > MOVING_THRESHOLD) {
        return PersonState::MOVING;
    } else if (speed > WAITING_THRESHOLD) {
        return PersonState::WAITING;
    } else if (aspect_ratio > SITTING_ASPECT_MIN) {
        return PersonState::SITTING;
    } else {
        return PersonState::STANDING;
    }
}

cv::Point2f Tracker::calculate_velocity(int track_id) {
    const auto& history = position_history_[track_id];

    if (history.size() < 2) {
        return cv::Point2f(0, 0);
    }

    // Use exponential moving average for smoother velocity
    cv::Point2f velocity(0, 0);
    float alpha = 0.5f;  // Smoothing factor

    for (size_t i = 1; i < history.size(); ++i) {
        cv::Point2f delta = history[i] - history[i - 1];
        velocity = alpha * delta + (1 - alpha) * velocity;
    }

    return velocity;
}

} // namespace kds
