# =============================================================================
# Standalone unit-test target for the edge-device PURE logic.
#
# This is a SEPARATE, lightweight CMake project — deliberately decoupled from
# the top-level edge-device CMakeLists.txt, which requires CUDA, OpenCV,
# GStreamer, and TensorRT (none of which are needed to test the pure CLI parser
# and config env-merge / validation).
#
# It compiles only:
#   - src/args.cpp     (parse_args / print_usage — pure)
#   - src/config.cpp   (merge_env / from_env / validate / to_json — pure)
#   - src/utils/logger.cpp  (config.cpp's LOG_* macros need a logger)
#
# Dependencies are header/lib-only and fetched at configure time:
#   - spdlog        (logger)
#   - yaml-cpp      (config.cpp links it even though we don't exercise load())
#   - nlohmann/json (Config::to_json)
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

# nlohmann/json (header-only) — Config::to_json.
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
    ${EDGE_SRC}/src/args.cpp
    ${EDGE_SRC}/src/config.cpp
    ${EDGE_SRC}/src/utils/logger.cpp
)

target_include_directories(edge_device_tests PRIVATE
    ${EDGE_SRC}/src
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(edge_device_tests PRIVATE
    nlohmann_json::nlohmann_json
    yaml-cpp::yaml-cpp
    spdlog::spdlog
)

target_compile_options(edge_device_tests PRIVATE -Wall -Wextra)

enable_testing()
add_test(NAME edge_device_unit_tests COMMAND edge_device_tests)
