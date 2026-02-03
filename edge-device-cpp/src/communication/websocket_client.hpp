#pragma once

#include "../config.hpp"
#include "types.hpp"

#include <websocketpp/config/asio_client.hpp>
#include <websocketpp/client.hpp>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <condition_variable>

namespace kds {

// WebSocket client using websocketpp with Socket.IO-like protocol
class WebSocketClient {
public:
    explicit WebSocketClient(const BackendConfig& config);
    ~WebSocketClient();

    // Non-copyable
    WebSocketClient(const WebSocketClient&) = delete;
    WebSocketClient& operator=(const WebSocketClient&) = delete;

    // Connect to backend
    bool connect();

    // Disconnect from backend
    void disconnect();

    // Check connection status
    bool is_connected() const { return connected_; }

    // Send occupancy data
    bool send_occupancy_data(const std::vector<OccupancyData>& detections);

    // Send heartbeat
    bool send_heartbeat();

    // Send health status
    bool send_health_status(const HealthStatusPayload& status);

    // Callbacks for backend events
    using ConfigCallback = std::function<void(const EdgeDeviceConfig&)>;
    using CommandCallback = std::function<void(const EdgeDeviceCommand&)>;
    using CalibrationCallback = std::function<void(const nlohmann::json&)>;

    void set_config_callback(ConfigCallback callback) {
        config_callback_ = std::move(callback);
    }

    void set_command_callback(CommandCallback callback) {
        command_callback_ = std::move(callback);
    }

    void set_calibration_callback(CalibrationCallback callback) {
        calibration_callback_ = std::move(callback);
    }

    // Run the client (blocking - call in separate thread)
    void run();

    // Stop the client
    void stop();

    // Get connection statistics
    struct Stats {
        uint64_t messages_sent = 0;
        uint64_t messages_received = 0;
        uint64_t reconnect_count = 0;
        bool connected = false;
    };
    Stats get_stats() const;

private:
    using Client = websocketpp::client<websocketpp::config::asio_tls_client>;
    using MessagePtr = Client::message_ptr;
    using ConnectionHdl = websocketpp::connection_hdl;

    BackendConfig config_;

    // WebSocket client
    Client client_;
    ConnectionHdl connection_;
    std::thread io_thread_;

    // State
    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    std::atomic<bool> registered_{false};

    // Message queue for async sending
    mutable std::mutex queue_mutex_;
    std::queue<std::string> message_queue_;
    std::condition_variable queue_cv_;

    // Statistics
    mutable std::mutex stats_mutex_;
    Stats stats_;

    // Callbacks
    ConfigCallback config_callback_;
    CommandCallback command_callback_;
    CalibrationCallback calibration_callback_;

    // Internal methods
    void init_client();
    void on_open(ConnectionHdl hdl);
    void on_close(ConnectionHdl hdl);
    void on_fail(ConnectionHdl hdl);
    void on_message(ConnectionHdl hdl, MessagePtr msg);

    // Socket.IO-like message handling
    void handle_socketio_message(const std::string& payload);
    bool emit(const std::string& event, const nlohmann::json& data);
    bool send_raw(const std::string& message);

    // Register with backend
    bool register_device();

    // TLS context setup
    std::shared_ptr<boost::asio::ssl::context> on_tls_init();

    // Reconnection logic
    void reconnect();

    // Timestamp helper
    static std::string get_iso_timestamp();
};

} // namespace kds
