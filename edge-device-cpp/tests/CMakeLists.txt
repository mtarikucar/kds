# =============================================================================
# Standalone unit-test target for the edge-device PURE logic + the hardware
# dependency-inversion seams.
#
# This is a SEPARATE, lightweight CMake project — deliberately decoupled from
# the top-level edge-device CMakeLists.txt, which requires CUDA, TensorRT,
# GStreamer and websocketpp (NONE of which are needed to test the pure logic).
#
# What it covers WITHOUT any hardware toolchain, via the seams:
#   - src/args.cpp                       (parse_args / print_usage — pure)
#   - src/config.cpp                     (merge_env / from_env / validate / to_json)
#   - src/utils/logger.cpp               (LOG_* macros used by the above)
#   - src/utils/nms.cpp                  (IoU / NMS / soft-NMS / filters — pure)
#   - src/detection/yolo_postprocess.cpp (YOLOv8 decode: threshold/class/NMS)
#       driven directly + via FakeInferenceEngine (IInferenceEngine seam)
#   - src/communication/socketio_router.cpp (Socket.IO framing/routing)
#       driven via FakeTransport (ITransport seam)
#   - ReconnectPolicy (header-only)      (backoff/retry arithmetic — pure)
#   - FrameDispatcher (header-only)      (capture-loop policy)
#       driven via FakeFrameSource (IFrameSource seam)
#
# The hardware adapters themselves — YoloTensorRT (TensorRT/CUDA),
# WebSocketClient (websocketpp/TLS), RTSPClient (GStreamer) — are NOT compiled
# here: they sit behind the seams and require their respective SDKs. They are
# built by the top-level CMakeLists.txt on the Jetson/edge target.
#
# OpenCV IS used (cv::Rect2f / cv::Mat appear in Detection / Frame). It is a
# normal system package (apt install libopencv-dev), unlike CUDA/TensorRT.
#
# Dependencies fetched at configure time: spdlog, yaml-cpp, nlohmann/json.
#
# Build + run (use a build/ dir — it's gitignored):
#   cmake -S edge-device-cpp/tests -B edge-device-cpp/build
#   cmake --build edge-device-cpp/build
#   ctest --test-dir edge-device-cpp/build --output-on-failure
# (or just run ./edge-device-cpp/build/edge_device_tests)
# =============================================================================

cmake_minimum_required(VERSION 3.18)
project(kds_edge_device_tests LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Debug)
endif()

include(FetchContent)

# OpenCV — system package; cv::Rect2f / cv::Mat appear in Detection / Frame and
# thus in the pure detection + frame logic under test. (NOT CUDA/TensorRT.)
find_package(OpenCV REQUIRED)
message(STATUS "OpenCV version: ${OpenCV_VERSION}")

# nlohmann/json (header-only) — Config::to_json + Socket.IO message parsing.
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)

# yaml-cpp — config.cpp includes/links it (Config::load uses YAML::LoadFile).
FetchContent_Declare(
    yaml-cpp
    GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
    GIT_TAG 0.8.0
)
FetchContent_MakeAvailable(yaml-cpp)

# spdlog — the LOG_* macros used throughout config.cpp.
FetchContent_Declare(
    spdlog
    GIT_REPOSITORY https://github.com/gabime/spdlog.git
    GIT_TAG v1.12.0
)
FetchContent_MakeAvailable(spdlog)

# Path back to the production sources (this file lives in tests/).
set(EDGE_SRC ${CMAKE_CURRENT_SOURCE_DIR}/..)

add_executable(edge_device_tests
    ${CMAKE_CURRENT_SOURCE_DIR}/test_main.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/test_args.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/test_config.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/test_inference.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/test_transport.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/test_camera.cpp
    ${EDGE_SRC}/src/args.cpp
    ${EDGE_SRC}/src/config.cpp
    ${EDGE_SRC}/src/utils/logger.cpp
    ${EDGE_SRC}/src/utils/nms.cpp
    ${EDGE_SRC}/src/detection/yolo_postprocess.cpp
    ${EDGE_SRC}/src/communication/socketio_router.cpp
)

target_include_directories(edge_device_tests PRIVATE
    ${EDGE_SRC}/src
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(edge_device_tests PRIVATE
    nlohmann_json::nlohmann_json
    yaml-cpp::yaml-cpp
    spdlog::spdlog
    ${OpenCV_LIBS}
)

target_compile_options(edge_device_tests PRIVATE -Wall -Wextra)

enable_testing()
add_test(NAME edge_device_unit_tests COMMAND edge_device_tests)
