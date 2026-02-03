#include "nms.hpp"
#include <algorithm>
#include <cmath>

namespace kds {

float calculate_iou(const cv::Rect2f& box1, const cv::Rect2f& box2) {
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

std::vector<Detection> nms(const std::vector<Detection>& detections, float iou_threshold) {
    if (detections.empty()) {
        return {};
    }

    // Sort by confidence (descending)
    std::vector<Detection> sorted_detections = detections;
    std::sort(sorted_detections.begin(), sorted_detections.end(),
              [](const Detection& a, const Detection& b) {
                  return a.confidence > b.confidence;
              });

    std::vector<bool> suppressed(sorted_detections.size(), false);
    std::vector<Detection> result;

    for (size_t i = 0; i < sorted_detections.size(); ++i) {
        if (suppressed[i]) {
            continue;
        }

        result.push_back(sorted_detections[i]);

        for (size_t j = i + 1; j < sorted_detections.size(); ++j) {
            if (suppressed[j]) {
                continue;
            }

            float iou = calculate_iou(sorted_detections[i].bbox, sorted_detections[j].bbox);
            if (iou > iou_threshold) {
                suppressed[j] = true;
            }
        }
    }

    return result;
}

std::vector<Detection> soft_nms(std::vector<Detection> detections,
                                 float iou_threshold,
                                 float sigma,
                                 float score_threshold) {
    if (detections.empty()) {
        return {};
    }

    // Sort by confidence (descending)
    std::sort(detections.begin(), detections.end(),
              [](const Detection& a, const Detection& b) {
                  return a.confidence > b.confidence;
              });

    std::vector<Detection> result;

    while (!detections.empty()) {
        // Get best detection
        Detection best = detections.front();
        result.push_back(best);
        detections.erase(detections.begin());

        // Update scores of remaining detections
        for (auto& det : detections) {
            float iou = calculate_iou(best.bbox, det.bbox);
            if (iou > iou_threshold) {
                // Gaussian penalty
                float weight = std::exp(-(iou * iou) / sigma);
                det.confidence *= weight;
            }
        }

        // Remove low-confidence detections
        detections.erase(
            std::remove_if(detections.begin(), detections.end(),
                           [score_threshold](const Detection& d) {
                               return d.confidence < score_threshold;
                           }),
            detections.end());

        // Re-sort by confidence
        std::sort(detections.begin(), detections.end(),
                  [](const Detection& a, const Detection& b) {
                      return a.confidence > b.confidence;
                  });
    }

    return result;
}

std::vector<Detection> filter_persons(const std::vector<Detection>& detections) {
    std::vector<Detection> persons;
    persons.reserve(detections.size());

    for (const auto& det : detections) {
        // YOLOv8 COCO: class 0 = person
        if (det.class_id == 0) {
            persons.push_back(det);
        }
    }

    return persons;
}

std::vector<Detection> filter_by_confidence(const std::vector<Detection>& detections,
                                             float threshold) {
    std::vector<Detection> filtered;
    filtered.reserve(detections.size());

    for (const auto& det : detections) {
        if (det.confidence >= threshold) {
            filtered.push_back(det);
        }
    }

    return filtered;
}

} // namespace kds
