#pragma once

#include <spdlog/spdlog.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <memory>
#include <string>

namespace kds {

class Logger {
public:
    static void init(const std::string& name = "edge-device",
                     const std::string& level = "info",
                     const std::string& log_file = "");

    static std::shared_ptr<spdlog::logger> get();

    static void set_level(const std::string& level);

    static void flush();

private:
    static std::shared_ptr<spdlog::logger> logger_;
};

// Convenience macros for logging
#define LOG_TRACE(...) SPDLOG_LOGGER_TRACE(kds::Logger::get(), __VA_ARGS__)
#define LOG_DEBUG(...) SPDLOG_LOGGER_DEBUG(kds::Logger::get(), __VA_ARGS__)
#define LOG_INFO(...) SPDLOG_LOGGER_INFO(kds::Logger::get(), __VA_ARGS__)
#define LOG_WARN(...) SPDLOG_LOGGER_WARN(kds::Logger::get(), __VA_ARGS__)
#define LOG_ERROR(...) SPDLOG_LOGGER_ERROR(kds::Logger::get(), __VA_ARGS__)
#define LOG_CRITICAL(...) SPDLOG_LOGGER_CRITICAL(kds::Logger::get(), __VA_ARGS__)

} // namespace kds
