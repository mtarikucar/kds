#pragma once

#include "../detection/types.hpp"
#include <vector>

namespace kds {

// Calculate IoU (Intersection over Union) between two bounding boxes
float calculate_iou(const cv::Rect2f& box1, const cv::Rect2f& box2);

// Non-Maximum Suppression
std::vector<Detection> nms(const std::vector<Detection>& detections,
                            float iou_threshold);

// Soft-NMS (reduces confidence instead of eliminating)
std::vector<Detection> soft_nms(std::vector<Detection> detections,
                                 float iou_threshold,
                                 float sigma = 0.5f,
                                 float score_threshold = 0.01f);

// Filter detections by class (keep only persons - class_id 0)
std::vector<Detection> filter_persons(const std::vector<Detection>& detections);

// Filter detections by confidence threshold
std::vector<Detection> filter_by_confidence(const std::vector<Detection>& detections,
                                             float threshold);

} // namespace kds
