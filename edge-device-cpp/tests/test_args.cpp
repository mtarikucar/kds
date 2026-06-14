// Pure unit tests for the edge-device CLI argument parser (kds::parse_args).
//
// Assert-based — no framework dependency. Each check uses the CHECK macro
// which prints a PASS/FAIL line and tracks failures; main() returns non-zero
// if any check failed, so ctest reports the target as failed.
//
// parse_args is pure (no I/O, no globals beyond reading the provided argv),
// so it links against only src/args.cpp — none of main.cpp's CUDA / TensorRT /
// GStreamer / OpenCV dependencies.

#include "args.hpp"

#include <iostream>
#include <string>
#include <vector>

#include "test_util.hpp"

// Helper: build a fake argv (program name + flags) and parse it.
static kds::Args parse(const std::vector<std::string>& tokens) {
    std::vector<char*> argv;
    argv.push_back(const_cast<char*>("edge-device")); // argv[0] = program name
    for (const auto& t : tokens) {
        argv.push_back(const_cast<char*>(t.c_str()));
    }
    return kds::parse_args(static_cast<int>(argv.size()), argv.data());
}

void run_args_tests() {
    // --- Defaults when no flags given ---
    {
        kds::Args a = parse({});
        CHECK(a.config_path == "config/config.yaml");
        CHECK(a.log_level == "info");
        CHECK(a.device_id.empty());
        CHECK(a.camera_url.empty());
        CHECK(a.backend_url.empty());
        CHECK(a.build_engine_onnx.empty());
        CHECK(a.test_inference == false);
        CHECK(a.test_camera == false);
        CHECK(a.help == false);
    }

    // --- Value flags consume the next token ---
    {
        kds::Args a = parse({"--config", "/etc/edge/cfg.yaml",
                             "--device-id", "cam-42",
                             "--camera", "rtsp://10.0.0.5/stream",
                             "--backend", "wss://api.example.com/edge",
                             "--log-level", "debug"});
        CHECK(a.config_path == "/etc/edge/cfg.yaml");
        CHECK(a.device_id == "cam-42");
        CHECK(a.camera_url == "rtsp://10.0.0.5/stream");
        CHECK(a.backend_url == "wss://api.example.com/edge");
        CHECK(a.log_level == "debug");
    }

    // --- Boolean switch flags ---
    {
        kds::Args a = parse({"--test-inference"});
        CHECK(a.test_inference == true);
        CHECK(a.test_camera == false);
    }
    {
        kds::Args a = parse({"--test-camera"});
        CHECK(a.test_camera == true);
        CHECK(a.test_inference == false);
    }

    // --- --help and -h both set help ---
    {
        CHECK(parse({"--help"}).help == true);
        CHECK(parse({"-h"}).help == true);
    }

    // --- build-engine carries its ONNX path ---
    {
        kds::Args a = parse({"--build-engine", "model.onnx"});
        CHECK(a.build_engine_onnx == "model.onnx");
    }

    // --- A value flag with no following token is ignored (no crash, default
    //     kept) — mirrors the `i + 1 < argc` guard in parse_args. ---
    {
        kds::Args a = parse({"--config"}); // dangling, no value
        CHECK(a.config_path == "config/config.yaml"); // unchanged default
    }

    // --- Unknown flags are silently ignored ---
    {
        kds::Args a = parse({"--frobnicate", "--device-id", "d1"});
        CHECK(a.device_id == "d1"); // known flag after unknown still parsed
    }

    // --- Realistic combined invocation ---
    {
        kds::Args a = parse({"--config", "prod.yaml",
                             "--device-id", "lobby-cam",
                             "--log-level", "warn",
                             "--test-camera"});
        CHECK(a.config_path == "prod.yaml");
        CHECK(a.device_id == "lobby-cam");
        CHECK(a.log_level == "warn");
        CHECK(a.test_camera == true);
        CHECK(a.help == false);
    }
}
