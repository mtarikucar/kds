#pragma once

#include "types.hpp"
#include "../config.hpp"

#include <opencv2/opencv.hpp>
#include <memory>
#include <string>
#include <vector>

#ifdef WITH_TENSORRT
#include <NvInfer.h>
#include <cuda_runtime_api.h>
#endif

namespace kds {

#ifdef WITH_TENSORRT

// TensorRT logger implementation
class TRTLogger : public nvinfer1::ILogger {
public:
    void log(Severity severity, const char* msg) noexcept override;

    void set_verbose(bool verbose) { verbose_ = verbose; }

private:
    bool verbose_ = false;
};

#endif

class YoloTensorRT {
public:
    explicit YoloTensorRT(const DetectionConfig& config);
    ~YoloTensorRT();

    // Non-copyable
    YoloTensorRT(const YoloTensorRT&) = delete;
    YoloTensorRT& operator=(const YoloTensorRT&) = delete;

    // Build or load TensorRT engine
    bool initialize();

    // Build engine from ONNX model
    bool build_engine();

    // Load pre-built engine
    bool load_engine(const std::string& engine_path);

    // Save engine to file
    bool save_engine(const std::string& engine_path);

    // Run inference on a single frame
    std::vector<Detection> detect(const cv::Mat& frame);

    // Run inference on a batch of frames
    std::vector<std::vector<Detection>> detect_batch(const std::vector<cv::Mat>& frames);

    // Check if engine is initialized
    bool is_initialized() const { return initialized_; }

    // Get inference time (last call, in milliseconds)
    float get_inference_time() const { return inference_time_ms_; }

    // Get input dimensions
    cv::Size get_input_size() const { return cv::Size(input_width_, input_height_); }

    // Warm up the engine (run a few inferences)
    void warmup(int iterations = 10);

private:
    DetectionConfig config_;
    bool initialized_ = false;
    float inference_time_ms_ = 0.0f;

    // Input dimensions
    int input_width_ = 640;
    int input_height_ = 640;
    int input_channels_ = 3;

    // Output dimensions (YOLOv8 specific)
    int num_classes_ = 80;     // COCO classes
    int num_detections_ = 8400; // For 640x640 input

#ifdef WITH_TENSORRT
    // TensorRT components
    TRTLogger trt_logger_;
    std::unique_ptr<nvinfer1::IRuntime> runtime_;
    std::unique_ptr<nvinfer1::ICudaEngine> engine_;
    std::unique_ptr<nvinfer1::IExecutionContext> context_;

    // CUDA resources
    cudaStream_t stream_ = nullptr;
    void* device_input_ = nullptr;
    void* device_output_ = nullptr;
    std::vector<float> host_input_;
    std::vector<float> host_output_;

    // Buffer sizes
    size_t input_size_ = 0;
    size_t output_size_ = 0;

    // Internal methods
    bool allocate_buffers();
    void free_buffers();

    cv::Mat preprocess(const cv::Mat& frame);
    std::vector<Detection> postprocess(const std::vector<float>& output,
                                         const cv::Size& original_size);
#endif
};

} // namespace kds
