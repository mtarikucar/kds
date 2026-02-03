#include "yolo_tensorrt.hpp"
#include "../utils/logger.hpp"
#include "../utils/nms.hpp"

#include <filesystem>
#include <fstream>
#include <chrono>

#ifdef WITH_TENSORRT
#include <NvOnnxParser.h>
#endif

namespace kds {

#ifdef WITH_TENSORRT

void TRTLogger::log(Severity severity, const char* msg) noexcept {
    if (severity == Severity::kINTERNAL_ERROR || severity == Severity::kERROR) {
        LOG_ERROR("[TensorRT] {}", msg);
    } else if (severity == Severity::kWARNING) {
        LOG_WARN("[TensorRT] {}", msg);
    } else if (verbose_ && severity == Severity::kINFO) {
        LOG_INFO("[TensorRT] {}", msg);
    } else if (verbose_) {
        LOG_DEBUG("[TensorRT] {}", msg);
    }
}

#endif

YoloTensorRT::YoloTensorRT(const DetectionConfig& config)
    : config_(config)
    , input_width_(config.input_size)
    , input_height_(config.input_size) {
}

YoloTensorRT::~YoloTensorRT() {
#ifdef WITH_TENSORRT
    free_buffers();
    if (stream_) {
        cudaStreamDestroy(stream_);
    }
#endif
}

bool YoloTensorRT::initialize() {
#ifdef WITH_TENSORRT
    // Check if engine file exists
    if (std::filesystem::exists(config_.engine_path)) {
        LOG_INFO("Loading existing TensorRT engine: {}", config_.engine_path);
        if (load_engine(config_.engine_path)) {
            initialized_ = true;
            return true;
        }
        LOG_WARN("Failed to load engine, rebuilding from ONNX");
    }

    // Build from ONNX
    if (!std::filesystem::exists(config_.model_path)) {
        LOG_ERROR("ONNX model not found: {}", config_.model_path);
        return false;
    }

    if (!build_engine()) {
        LOG_ERROR("Failed to build TensorRT engine");
        return false;
    }

    // Save engine for future use
    save_engine(config_.engine_path);

    initialized_ = true;
    return true;
#else
    LOG_ERROR("TensorRT support not compiled. Rebuild with TensorRT libraries.");
    return false;
#endif
}

bool YoloTensorRT::build_engine() {
#ifdef WITH_TENSORRT
    LOG_INFO("Building TensorRT engine from ONNX: {}", config_.model_path);
    LOG_INFO("This may take several minutes on first run...");

    // Create builder
    auto builder = std::unique_ptr<nvinfer1::IBuilder>(
        nvinfer1::createInferBuilder(trt_logger_));
    if (!builder) {
        LOG_ERROR("Failed to create TensorRT builder");
        return false;
    }

    // Create network with explicit batch
    const auto explicit_batch = 1U << static_cast<uint32_t>(
        nvinfer1::NetworkDefinitionCreationFlag::kEXPLICIT_BATCH);
    auto network = std::unique_ptr<nvinfer1::INetworkDefinition>(
        builder->createNetworkV2(explicit_batch));
    if (!network) {
        LOG_ERROR("Failed to create network definition");
        return false;
    }

    // Create ONNX parser
    auto parser = std::unique_ptr<nvonnxparser::IParser>(
        nvonnxparser::createParser(*network, trt_logger_));
    if (!parser) {
        LOG_ERROR("Failed to create ONNX parser");
        return false;
    }

    // Parse ONNX model
    if (!parser->parseFromFile(config_.model_path.c_str(),
                                static_cast<int>(nvinfer1::ILogger::Severity::kWARNING))) {
        LOG_ERROR("Failed to parse ONNX model");
        for (int i = 0; i < parser->getNbErrors(); ++i) {
            LOG_ERROR("  ONNX parse error: {}", parser->getError(i)->desc());
        }
        return false;
    }

    LOG_INFO("ONNX model parsed successfully");

    // Create builder config
    auto builder_config = std::unique_ptr<nvinfer1::IBuilderConfig>(
        builder->createBuilderConfig());
    if (!builder_config) {
        LOG_ERROR("Failed to create builder config");
        return false;
    }

    // Set workspace size (1GB)
    builder_config->setMemoryPoolLimit(nvinfer1::MemoryPoolType::kWORKSPACE, 1ULL << 30);

    // Enable FP16 if requested and supported
    if (config_.use_fp16 && builder->platformHasFastFp16()) {
        builder_config->setFlag(nvinfer1::BuilderFlag::kFP16);
        LOG_INFO("FP16 precision enabled");
    }

    // Enable INT8 if requested (requires calibration data)
    if (config_.use_int8 && builder->platformHasFastInt8()) {
        builder_config->setFlag(nvinfer1::BuilderFlag::kINT8);
        LOG_INFO("INT8 precision enabled (using FP16 calibration fallback)");
        // Note: For proper INT8, you need a calibration file
        // This is a simplified version that may not be optimal
    }

    // Build serialized network
    LOG_INFO("Building engine (this may take a few minutes)...");
    auto serialized_engine = std::unique_ptr<nvinfer1::IHostMemory>(
        builder->buildSerializedNetwork(*network, *builder_config));
    if (!serialized_engine) {
        LOG_ERROR("Failed to build serialized engine");
        return false;
    }

    // Create runtime and deserialize engine
    runtime_.reset(nvinfer1::createInferRuntime(trt_logger_));
    if (!runtime_) {
        LOG_ERROR("Failed to create inference runtime");
        return false;
    }

    engine_.reset(runtime_->deserializeCudaEngine(
        serialized_engine->data(), serialized_engine->size()));
    if (!engine_) {
        LOG_ERROR("Failed to deserialize CUDA engine");
        return false;
    }

    // Create execution context
    context_.reset(engine_->createExecutionContext());
    if (!context_) {
        LOG_ERROR("Failed to create execution context");
        return false;
    }

    // Create CUDA stream
    if (cudaStreamCreate(&stream_) != cudaSuccess) {
        LOG_ERROR("Failed to create CUDA stream");
        return false;
    }

    // Allocate buffers
    if (!allocate_buffers()) {
        LOG_ERROR("Failed to allocate buffers");
        return false;
    }

    LOG_INFO("TensorRT engine built successfully");
    LOG_INFO("  Input size: {}x{}", input_width_, input_height_);
    LOG_INFO("  Output detections: {}", num_detections_);

    return true;
#else
    return false;
#endif
}

bool YoloTensorRT::load_engine(const std::string& engine_path) {
#ifdef WITH_TENSORRT
    // Read engine file
    std::ifstream file(engine_path, std::ios::binary);
    if (!file.good()) {
        LOG_ERROR("Cannot open engine file: {}", engine_path);
        return false;
    }

    file.seekg(0, std::ios::end);
    size_t size = file.tellg();
    file.seekg(0, std::ios::beg);

    std::vector<char> engine_data(size);
    file.read(engine_data.data(), size);
    file.close();

    // Create runtime
    runtime_.reset(nvinfer1::createInferRuntime(trt_logger_));
    if (!runtime_) {
        LOG_ERROR("Failed to create inference runtime");
        return false;
    }

    // Deserialize engine
    engine_.reset(runtime_->deserializeCudaEngine(engine_data.data(), size));
    if (!engine_) {
        LOG_ERROR("Failed to deserialize engine");
        return false;
    }

    // Create execution context
    context_.reset(engine_->createExecutionContext());
    if (!context_) {
        LOG_ERROR("Failed to create execution context");
        return false;
    }

    // Create CUDA stream
    if (cudaStreamCreate(&stream_) != cudaSuccess) {
        LOG_ERROR("Failed to create CUDA stream");
        return false;
    }

    // Allocate buffers
    if (!allocate_buffers()) {
        LOG_ERROR("Failed to allocate buffers");
        return false;
    }

    LOG_INFO("TensorRT engine loaded successfully from: {}", engine_path);
    return true;
#else
    return false;
#endif
}

bool YoloTensorRT::save_engine(const std::string& engine_path) {
#ifdef WITH_TENSORRT
    if (!engine_) {
        LOG_ERROR("No engine to save");
        return false;
    }

    auto serialized = std::unique_ptr<nvinfer1::IHostMemory>(
        engine_->serialize());
    if (!serialized) {
        LOG_ERROR("Failed to serialize engine");
        return false;
    }

    std::ofstream file(engine_path, std::ios::binary);
    if (!file.good()) {
        LOG_ERROR("Cannot create engine file: {}", engine_path);
        return false;
    }

    file.write(static_cast<const char*>(serialized->data()), serialized->size());
    file.close();

    LOG_INFO("TensorRT engine saved to: {} ({} MB)",
             engine_path, serialized->size() / (1024 * 1024));
    return true;
#else
    return false;
#endif
}

#ifdef WITH_TENSORRT

bool YoloTensorRT::allocate_buffers() {
    // Get input/output tensor info
    int num_io_tensors = engine_->getNbIOTensors();
    LOG_DEBUG("Engine has {} I/O tensors", num_io_tensors);

    for (int i = 0; i < num_io_tensors; ++i) {
        const char* name = engine_->getIOTensorName(i);
        auto mode = engine_->getTensorIOMode(name);
        auto dims = engine_->getTensorShape(name);

        std::string dims_str;
        for (int j = 0; j < dims.nbDims; ++j) {
            dims_str += std::to_string(dims.d[j]) + " ";
        }
        LOG_DEBUG("  Tensor '{}': mode={} dims=[{}]",
                  name, mode == nvinfer1::TensorIOMode::kINPUT ? "INPUT" : "OUTPUT", dims_str);

        if (mode == nvinfer1::TensorIOMode::kINPUT) {
            // Input tensor (batch, channels, height, width)
            input_channels_ = dims.d[1];
            input_height_ = dims.d[2];
            input_width_ = dims.d[3];
            input_size_ = dims.d[0] * dims.d[1] * dims.d[2] * dims.d[3];

            host_input_.resize(input_size_);
            if (cudaMalloc(&device_input_, input_size_ * sizeof(float)) != cudaSuccess) {
                LOG_ERROR("Failed to allocate device input buffer");
                return false;
            }
        } else {
            // Output tensor (batch, num_classes + 4, num_detections)
            // YOLOv8 output: (1, 84, 8400) for COCO (4 box coords + 80 classes)
            num_classes_ = dims.d[1] - 4;
            num_detections_ = dims.d[2];
            output_size_ = dims.d[0] * dims.d[1] * dims.d[2];

            host_output_.resize(output_size_);
            if (cudaMalloc(&device_output_, output_size_ * sizeof(float)) != cudaSuccess) {
                LOG_ERROR("Failed to allocate device output buffer");
                return false;
            }
        }
    }

    LOG_DEBUG("Buffers allocated: input={} output={}", input_size_, output_size_);
    return true;
}

void YoloTensorRT::free_buffers() {
    if (device_input_) {
        cudaFree(device_input_);
        device_input_ = nullptr;
    }
    if (device_output_) {
        cudaFree(device_output_);
        device_output_ = nullptr;
    }
    host_input_.clear();
    host_output_.clear();
}

cv::Mat YoloTensorRT::preprocess(const cv::Mat& frame) {
    cv::Mat resized, rgb, blob;

    // Resize with letterbox to maintain aspect ratio
    float scale = std::min(static_cast<float>(input_width_) / frame.cols,
                           static_cast<float>(input_height_) / frame.rows);
    int new_width = static_cast<int>(frame.cols * scale);
    int new_height = static_cast<int>(frame.rows * scale);

    cv::resize(frame, resized, cv::Size(new_width, new_height));

    // Create letterbox image with gray padding
    cv::Mat letterbox(input_height_, input_width_, CV_8UC3, cv::Scalar(114, 114, 114));
    int x_offset = (input_width_ - new_width) / 2;
    int y_offset = (input_height_ - new_height) / 2;
    resized.copyTo(letterbox(cv::Rect(x_offset, y_offset, new_width, new_height)));

    // Convert BGR to RGB
    cv::cvtColor(letterbox, rgb, cv::COLOR_BGR2RGB);

    // Normalize to [0, 1] and convert to blob format
    rgb.convertTo(blob, CV_32F, 1.0 / 255.0);

    return blob;
}

std::vector<Detection> YoloTensorRT::postprocess(const std::vector<float>& output,
                                                   const cv::Size& original_size) {
    std::vector<Detection> detections;

    // Calculate scale factors for letterbox
    float scale = std::min(static_cast<float>(input_width_) / original_size.width,
                           static_cast<float>(input_height_) / original_size.height);
    float x_offset = (input_width_ - original_size.width * scale) / 2.0f;
    float y_offset = (input_height_ - original_size.height * scale) / 2.0f;

    // YOLOv8 output format: (1, 84, 8400) -> transposed to (8400, 84)
    // Each detection: [x_center, y_center, width, height, class_scores...]
    int num_features = num_classes_ + 4;

    for (int i = 0; i < num_detections_; ++i) {
        // Get class scores and find best class
        float max_score = 0.0f;
        int max_class = 0;

        for (int c = 0; c < num_classes_; ++c) {
            // Output is in format [batch, features, detections]
            // Access: output[feature * num_detections + detection]
            float score = output[(4 + c) * num_detections_ + i];
            if (score > max_score) {
                max_score = score;
                max_class = c;
            }
        }

        // Filter by confidence
        if (max_score < config_.confidence_threshold) {
            continue;
        }

        // Only keep person detections (class 0 in COCO)
        if (max_class != 0) {
            continue;
        }

        // Get box coordinates
        float cx = output[0 * num_detections_ + i];
        float cy = output[1 * num_detections_ + i];
        float w = output[2 * num_detections_ + i];
        float h = output[3 * num_detections_ + i];

        // Convert from center format to corner format
        float x1 = cx - w / 2.0f;
        float y1 = cy - h / 2.0f;

        // Remove letterbox offset and scale to original image
        x1 = (x1 - x_offset) / scale;
        y1 = (y1 - y_offset) / scale;
        w = w / scale;
        h = h / scale;

        // Clip to image bounds
        x1 = std::max(0.0f, std::min(x1, static_cast<float>(original_size.width)));
        y1 = std::max(0.0f, std::min(y1, static_cast<float>(original_size.height)));
        w = std::min(w, static_cast<float>(original_size.width) - x1);
        h = std::min(h, static_cast<float>(original_size.height) - y1);

        Detection det;
        det.bbox = cv::Rect2f(x1, y1, w, h);
        det.confidence = max_score;
        det.class_id = max_class;

        detections.push_back(det);
    }

    // Apply NMS
    detections = nms(detections, config_.nms_threshold);

    return detections;
}

#endif

std::vector<Detection> YoloTensorRT::detect(const cv::Mat& frame) {
#ifdef WITH_TENSORRT
    if (!initialized_) {
        LOG_ERROR("Detector not initialized");
        return {};
    }

    auto start = std::chrono::high_resolution_clock::now();

    // Preprocess
    cv::Mat blob = preprocess(frame);

    // Convert HWC to CHW format and copy to host input
    int channel_size = input_height_ * input_width_;
    for (int c = 0; c < input_channels_; ++c) {
        for (int h = 0; h < input_height_; ++h) {
            for (int w = 0; w < input_width_; ++w) {
                host_input_[c * channel_size + h * input_width_ + w] =
                    blob.at<cv::Vec3f>(h, w)[c];
            }
        }
    }

    // Copy input to device
    cudaMemcpyAsync(device_input_, host_input_.data(),
                    input_size_ * sizeof(float),
                    cudaMemcpyHostToDevice, stream_);

    // Set tensor addresses
    const char* input_name = engine_->getIOTensorName(0);
    const char* output_name = engine_->getIOTensorName(1);
    context_->setTensorAddress(input_name, device_input_);
    context_->setTensorAddress(output_name, device_output_);

    // Run inference
    bool success = context_->enqueueV3(stream_);
    if (!success) {
        LOG_ERROR("Inference failed");
        return {};
    }

    // Copy output back to host
    cudaMemcpyAsync(host_output_.data(), device_output_,
                    output_size_ * sizeof(float),
                    cudaMemcpyDeviceToHost, stream_);

    // Synchronize
    cudaStreamSynchronize(stream_);

    auto end = std::chrono::high_resolution_clock::now();
    inference_time_ms_ = std::chrono::duration<float, std::milli>(end - start).count();

    // Postprocess
    return postprocess(host_output_, frame.size());
#else
    (void)frame;
    LOG_ERROR("TensorRT support not compiled");
    return {};
#endif
}

std::vector<std::vector<Detection>> YoloTensorRT::detect_batch(
    const std::vector<cv::Mat>& frames) {
    // For now, process frames sequentially
    // Batch processing can be implemented for better throughput
    std::vector<std::vector<Detection>> results;
    results.reserve(frames.size());

    for (const auto& frame : frames) {
        results.push_back(detect(frame));
    }

    return results;
}

void YoloTensorRT::warmup(int iterations) {
    LOG_INFO("Warming up TensorRT engine with {} iterations...", iterations);

    cv::Mat dummy(input_height_, input_width_, CV_8UC3, cv::Scalar(128, 128, 128));

    for (int i = 0; i < iterations; ++i) {
        detect(dummy);
    }

    LOG_INFO("Warmup complete. Average inference time: {:.2f} ms", inference_time_ms_);
}

} // namespace kds
