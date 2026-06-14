#pragma once

#include "types.hpp"

#include <opencv2/opencv.hpp>
#include <vector>

namespace kds {

// =============================================================================
// YOLOv8 output decoding — the PURE detection post-processing logic.
//
// This is the part of the detector that has nothing to do with CUDA/TensorRT:
// given a flat output tensor (and the letterbox geometry used to feed the net),
// it produces final Detections in original-image coordinates after confidence
// thresholding, person-class filtering, letterbox-undo, bound-clipping, and NMS.
//
// It was previously buried inside YoloTensorRT::postprocess under
// `#ifdef WITH_TENSORRT`, so it could neither be compiled nor unit-tested
// without a full TensorRT toolchain. Extracting it here (header-only-friendly,
// no GPU types) makes the most safety-critical detection logic directly
// testable; YoloTensorRT now just calls decode_yolo_output().
// =============================================================================

// Geometry of the letterbox transform applied during preprocessing.
struct LetterboxParams {
    int input_width;   // network input width  (e.g. 640)
    int input_height;  // network input height (e.g. 640)
    cv::Size original;  // original frame size before letterboxing

    // Uniform scale used to fit `original` inside the input while preserving
    // aspect ratio (min of the two axis ratios).
    float scale() const {
        return std::min(static_cast<float>(input_width) / original.width,
                        static_cast<float>(input_height) / original.height);
    }
    // Padding offsets (gray bars) added to center the resized image.
    float x_offset() const { return (input_width - original.width * scale()) / 2.0f; }
    float y_offset() const { return (input_height - original.height * scale()) / 2.0f; }
};

// Thresholds / class selection for decoding.
struct PostprocessParams {
    float confidence_threshold = 0.5f;
    float nms_threshold = 0.45f;
    int num_classes = 80;       // COCO
    int num_detections = 8400;  // anchor count for 640x640
    int person_class_id = 0;    // COCO person; <0 means "keep all classes"
};

// Decode a YOLOv8 output tensor laid out as [1, num_classes+4, num_detections]
// (channel-major: value(feature, det) = output[feature * num_detections + det]).
//
// Steps (identical to the original YoloTensorRT::postprocess):
//   1. for each anchor, pick the best class score,
//   2. drop anchors below confidence_threshold,
//   3. keep only person_class_id (unless person_class_id < 0),
//   4. convert center/size -> corner, undo letterbox, scale to original,
//   5. clip to image bounds,
//   6. run NMS at nms_threshold.
std::vector<Detection> decode_yolo_output(const std::vector<float>& output,
                                          const LetterboxParams& lb,
                                          const PostprocessParams& pp);

} // namespace kds
