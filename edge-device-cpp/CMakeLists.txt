cmake_minimum_required(VERSION 3.18)
project(kds_edge_device LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

# Build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Export compile commands for IDE support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# =============================================================================
# Find Required Packages
# =============================================================================

# CUDA
find_package(CUDA REQUIRED)
message(STATUS "CUDA version: ${CUDA_VERSION}")
message(STATUS "CUDA libraries: ${CUDA_LIBRARIES}")

# OpenCV
find_package(OpenCV REQUIRED)
message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "OpenCV libraries: ${OpenCV_LIBS}")

# GStreamer
find_package(PkgConfig REQUIRED)
pkg_check_modules(GSTREAMER REQUIRED gstreamer-1.0 gstreamer-app-1.0 gstreamer-video-1.0)

# TensorRT - Check multiple locations
set(TENSORRT_ROOT "" CACHE PATH "TensorRT installation directory")

# Search paths for TensorRT
list(APPEND TENSORRT_SEARCH_PATHS
    ${TENSORRT_ROOT}
    /usr/local/tensorrt
    /usr/local/TensorRT
    /usr
    /usr/lib/x86_64-linux-gnu
    /usr/lib/aarch64-linux-gnu
)

# Find TensorRT include directory
find_path(TENSORRT_INCLUDE_DIR NvInfer.h
    HINTS ${TENSORRT_SEARCH_PATHS}
    PATH_SUFFIXES include
)

# Find TensorRT libraries
find_library(NVINFER nvinfer
    HINTS ${TENSORRT_SEARCH_PATHS}
    PATH_SUFFIXES lib lib64 lib/x86_64-linux-gnu lib/aarch64-linux-gnu
)

find_library(NVONNXPARSER nvonnxparser
    HINTS ${TENSORRT_SEARCH_PATHS}
    PATH_SUFFIXES lib lib64 lib/x86_64-linux-gnu lib/aarch64-linux-gnu
)

find_library(NVINFER_PLUGIN nvinfer_plugin
    HINTS ${TENSORRT_SEARCH_PATHS}
    PATH_SUFFIXES lib lib64 lib/x86_64-linux-gnu lib/aarch64-linux-gnu
)

if(TENSORRT_INCLUDE_DIR AND NVINFER AND NVONNXPARSER)
    message(STATUS "TensorRT include: ${TENSORRT_INCLUDE_DIR}")
    message(STATUS "TensorRT nvinfer: ${NVINFER}")
    message(STATUS "TensorRT nvonnxparser: ${NVONNXPARSER}")
    set(TENSORRT_FOUND TRUE)
else()
    message(WARNING "TensorRT not found - building without TensorRT support")
    set(TENSORRT_FOUND FALSE)
endif()

# =============================================================================
# External Dependencies (Header-Only or Fetched)
# =============================================================================

include(FetchContent)

# WebSocket++ (header-only)
FetchContent_Declare(
    websocketpp
    GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
    GIT_TAG 0.8.2
)
FetchContent_MakeAvailable(websocketpp)

# nlohmann/json (header-only)
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)

# yaml-cpp for configuration
FetchContent_Declare(
    yaml-cpp
    GIT_REPOSITORY https://github.com/jbeder/yaml-cpp.git
    GIT_TAG 0.8.0
)
FetchContent_MakeAvailable(yaml-cpp)

# spdlog for logging
FetchContent_Declare(
    spdlog
    GIT_REPOSITORY https://github.com/gabime/spdlog.git
    GIT_TAG v1.12.0
)
FetchContent_MakeAvailable(spdlog)

# cpp-jwt for JWT handling
FetchContent_Declare(
    cpp_jwt
    GIT_REPOSITORY https://github.com/arun11299/cpp-jwt.git
    GIT_TAG v1.4
)
FetchContent_GetProperties(cpp_jwt)
if(NOT cpp_jwt_POPULATED)
    FetchContent_Populate(cpp_jwt)
endif()

# =============================================================================
# Source Files
# =============================================================================

set(SOURCES
    src/main.cpp
    src/config.cpp
    src/camera/rtsp_client.cpp
    src/camera/frame_buffer.cpp
    src/detection/yolo_tensorrt.cpp
    src/detection/tracker.cpp
    src/calibration/homography.cpp
    src/communication/websocket_client.cpp
    src/utils/logger.cpp
    src/utils/nms.cpp
)

set(HEADERS
    src/config.hpp
    src/camera/rtsp_client.hpp
    src/camera/frame_buffer.hpp
    src/detection/yolo_tensorrt.hpp
    src/detection/tracker.hpp
    src/detection/types.hpp
    src/calibration/homography.hpp
    src/communication/websocket_client.hpp
    src/communication/types.hpp
    src/utils/logger.hpp
    src/utils/nms.hpp
)

# =============================================================================
# Main Executable
# =============================================================================

add_executable(${PROJECT_NAME} ${SOURCES} ${HEADERS})

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${OpenCV_INCLUDE_DIRS}
    ${GSTREAMER_INCLUDE_DIRS}
    ${websocketpp_SOURCE_DIR}
    ${cpp_jwt_SOURCE_DIR}/include
    ${CUDA_INCLUDE_DIRS}
)

if(TENSORRT_FOUND)
    target_include_directories(${PROJECT_NAME} PRIVATE
        ${TENSORRT_INCLUDE_DIR}
    )
    target_compile_definitions(${PROJECT_NAME} PRIVATE WITH_TENSORRT)
endif()

# Link libraries
target_link_libraries(${PROJECT_NAME} PRIVATE
    ${OpenCV_LIBS}
    ${GSTREAMER_LIBRARIES}
    ${CUDA_LIBRARIES}
    ${CUDA_cudart_LIBRARY}
    nlohmann_json::nlohmann_json
    yaml-cpp::yaml-cpp
    spdlog::spdlog
    pthread
    ssl
    crypto
)

if(TENSORRT_FOUND)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        ${NVINFER}
        ${NVONNXPARSER}
    )
    if(NVINFER_PLUGIN)
        target_link_libraries(${PROJECT_NAME} PRIVATE ${NVINFER_PLUGIN})
    endif()
endif()

# =============================================================================
# Compiler Options
# =============================================================================

target_compile_options(${PROJECT_NAME} PRIVATE
    $<$<CONFIG:Release>:-O3 -march=native -ffast-math>
    $<$<CONFIG:Debug>:-g -O0>
    -Wall -Wextra -Wpedantic
)

# Disable some warnings for external headers
target_compile_options(${PROJECT_NAME} PRIVATE
    -Wno-deprecated-declarations
)

# =============================================================================
# Installation
# =============================================================================

install(TARGETS ${PROJECT_NAME}
    RUNTIME DESTINATION bin
)

install(DIRECTORY config/
    DESTINATION share/kds-edge-device/config
)

install(DIRECTORY models/
    DESTINATION share/kds-edge-device/models
    PATTERN "*.onnx"
    PATTERN "*.engine"
)

# =============================================================================
# Summary
# =============================================================================

message(STATUS "")
message(STATUS "==================== Build Configuration ====================")
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "CUDA version: ${CUDA_VERSION}")
message(STATUS "OpenCV version: ${OpenCV_VERSION}")
message(STATUS "TensorRT found: ${TENSORRT_FOUND}")
message(STATUS "=============================================================")
message(STATUS "")
