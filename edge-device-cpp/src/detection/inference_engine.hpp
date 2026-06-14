#pragma once

#include "types.hpp"

#include <opencv2/opencv.hpp>
#include <vector>

namespace kds {

// =============================================================================
// IInferenceEngine — dependency-inversion seam over the object detector.
//
// The production detector (YoloTensorRT) runs a TensorRT / CUDA engine, which
// cannot be instantiated in a unit-test environment (no GPU, no .engine file).
// This pure-virtual interface lets the ORCHESTRATION that consumes a detector
// (the main loop, batch helpers, any code that just wants "frame in, detections
// out") be written against the abstraction and driven by a FakeInferenceEngine
// in tests.
//
// YoloTensorRT implements this interface as a thin adapter; the heavy
// TensorRT lifting stays behind the seam, behavior-preserving.
//
// NOTE: the genuinely PURE part of detection — turning a raw YOLOv8 output
// tensor into a clipped, thresholded, NMS-filtered set of Detections — lives
// in yolo_postprocess.{hpp,cpp} and is unit-tested directly, independent of
// any engine.
// =============================================================================
class IInferenceEngine {
public:
    virtual ~IInferenceEngine() = default;

    // Run inference on a single frame, returning post-processed detections
    // (already thresholded + NMS-filtered, in original-image coordinates).
    virtual std::vector<Detection> detect(const cv::Mat& frame) = 0;

    // Run inference on a batch of frames. Default: sequential fan-out over
    // detect(); real engines may override for true batched throughput.
    virtual std::vector<std::vector<Detection>> detect_batch(
        const std::vector<cv::Mat>& frames) {
        std::vector<std::vector<Detection>> out;
        out.reserve(frames.size());
        for (const auto& f : frames) {
            out.push_back(detect(f));
        }
        return out;
    }

    // True once the engine is ready to serve detect() calls.
    virtual bool is_initialized() const = 0;

    // Last-call inference time in milliseconds (0 if never run).
    virtual float get_inference_time() const = 0;

    // Network input dimensions (width, height).
    virtual cv::Size get_input_size() const = 0;
};

} // namespace kds
