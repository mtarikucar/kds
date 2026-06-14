#include "args.hpp"

#include <iostream>

namespace kds {

void print_usage(const char* program_name) {
    std::cout << "Usage: " << program_name << " [OPTIONS]\n\n"
              << "Options:\n"
              << "  --config <path>        Path to config file (default: config/config.yaml)\n"
              << "  --device-id <id>       Device ID (overrides config)\n"
              << "  --camera <url>         Camera RTSP URL (overrides config)\n"
              << "  --backend <url>        Backend WebSocket URL (overrides config)\n"
              << "  --build-engine <onnx>  Build TensorRT engine from ONNX and exit\n"
              << "  --test-inference       Run inference test and exit\n"
              << "  --test-camera          Test camera connection and exit\n"
              << "  --log-level <level>    Log level: debug, info, warn, error\n"
              << "  --help                 Show this help message\n"
              << std::endl;
}

Args parse_args(int argc, char* argv[]) {
    Args args;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "--config" && i + 1 < argc) {
            args.config_path = argv[++i];
        } else if (arg == "--device-id" && i + 1 < argc) {
            args.device_id = argv[++i];
        } else if (arg == "--camera" && i + 1 < argc) {
            args.camera_url = argv[++i];
        } else if (arg == "--backend" && i + 1 < argc) {
            args.backend_url = argv[++i];
        } else if (arg == "--build-engine" && i + 1 < argc) {
            args.build_engine_onnx = argv[++i];
        } else if (arg == "--test-inference") {
            args.test_inference = true;
        } else if (arg == "--test-camera") {
            args.test_camera = true;
        } else if (arg == "--log-level" && i + 1 < argc) {
            args.log_level = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            args.help = true;
        }
    }

    return args;
}

} // namespace kds
