#include "yolo_postprocess.hpp"
#include "../utils/nms.hpp"

#include <algorithm>

namespace kds {

std::vector<Detection> decode_yolo_output(const std::vector<float>& output,
                                          const LetterboxParams& lb,
                                          const PostprocessParams& pp) {
    std::vector<Detection> detections;

    const float scale = lb.scale();
    const float x_offset = lb.x_offset();
    const float y_offset = lb.y_offset();

    const int num_classes = pp.num_classes;
    const int num_detections = pp.num_detections;

    for (int i = 0; i < num_detections; ++i) {
        // Best class score for this anchor.
        float max_score = 0.0f;
        int max_class = 0;
        for (int c = 0; c < num_classes; ++c) {
            // Channel-major layout: output[feature * num_detections + det].
            const float score = output[static_cast<size_t>(4 + c) * num_detections + i];
            if (score > max_score) {
                max_score = score;
                max_class = c;
            }
        }

        // Confidence threshold.
        if (max_score < pp.confidence_threshold) {
            continue;
        }

        // Class filter (person-only by default; negative => keep all).
        if (pp.person_class_id >= 0 && max_class != pp.person_class_id) {
            continue;
        }

        // Box (center/size) for this anchor.
        const float cx = output[static_cast<size_t>(0) * num_detections + i];
        const float cy = output[static_cast<size_t>(1) * num_detections + i];
        float w = output[static_cast<size_t>(2) * num_detections + i];
        float h = output[static_cast<size_t>(3) * num_detections + i];

        // Center -> corner.
        float x1 = cx - w / 2.0f;
        float y1 = cy - h / 2.0f;

        // Undo letterbox padding + scale back to original image.
        x1 = (x1 - x_offset) / scale;
        y1 = (y1 - y_offset) / scale;
        w = w / scale;
        h = h / scale;

        // Clip to image bounds.
        const float W = static_cast<float>(lb.original.width);
        const float H = static_cast<float>(lb.original.height);
        x1 = std::max(0.0f, std::min(x1, W));
        y1 = std::max(0.0f, std::min(y1, H));
        w = std::min(w, W - x1);
        h = std::min(h, H - y1);

        Detection det;
        det.bbox = cv::Rect2f(x1, y1, w, h);
        det.confidence = max_score;
        det.class_id = max_class;
        detections.push_back(det);
    }

    // Non-maximum suppression.
    return nms(detections, pp.nms_threshold);
}

} // namespace kds
