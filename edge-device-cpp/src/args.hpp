#pragma once

#include <string>

namespace kds {

// Parsed command-line arguments for the edge device binary.
//
// Extracted from main.cpp (verbatim) so the pure argument parser can be
// unit-tested without compiling main.cpp's heavy CUDA/TensorRT/GStreamer
// dependencies. main.cpp includes this header and calls parse_args / print_usage
// exactly as before, so runtime behavior is unchanged.
struct Args {
    std::string config_path = "config/config.yaml";
    std::string device_id;
    std::string camera_url;
    std::string backend_url;
    std::string build_engine_onnx;
    std::string log_level = "info";
    bool test_inference = false;
    bool test_camera = false;
    bool help = false;
};

// Print CLI usage to stdout.
void print_usage(const char* program_name);

// Parse argv into Args. Pure: no I/O beyond reading the provided argv, no
// globals. Unknown flags are ignored (matching the original main.cpp behavior).
Args parse_args(int argc, char* argv[]);

} // namespace kds
