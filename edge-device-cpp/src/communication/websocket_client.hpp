#pragma once

#include "../config.hpp"
#include "types.hpp"
#include "transport.hpp"
#include "socketio_router.hpp"
#include "reconnect_policy.hpp"

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

// WebSocket client using websocketpp with Socket.IO-like protocol.
// Implements ITransport (the raw send/connect seam) and delegates all
// Socket.IO framing/routing to a SocketIoRouter — the protocol logic is thus
// unit-testable against a FakeTransport without a live socket.
class WebSocketClient : public ITransport {
public:
    explicit WebSocketClient(const BackendConfig& config);
    ~WebSocketClient() override;

    // Non-copyable
    WebSocketClient(const WebSocketClient&) = delete;
    WebSocketClient& operator=(const WebSocketClient&) = delete;

    // Connect to backend
    bool connect();

    // Disconnect from backend
    void disconnect();

    // Check connection status (ITransport)
    bool is_connected() const override { return connected_; }

    // Send occupancy data
    bool send_occupancy_data(const std::vector<OccupancyData>& detections);

    // Send heartbeat
    bool send_heartbeat();

    // Send health status
    bool send_health_status(const HealthStatusPayload& status);

    // Callbacks for backend events (forwarded to the SocketIoRouter).
    using ConfigCallback = SocketIoRouter::ConfigCallback;
    using CommandCallback = SocketIoRouter::CommandCallback;
    using CalibrationCallback = SocketIoRouter::CalibrationCallback;

    void set_config_callback(ConfigCallback callback) {
        router_.set_config_callback(std::move(callback));
    }

    void set_command_callback(CommandCallback callback) {
        router_.set_command_callback(std::move(callback));
    }

    void set_calibration_callback(CalibrationCallback callback) {
        router_.set_calibration_callback(std::move(callback));
    }

    // Raw text send over the live socket (ITransport). Public because the
    // SocketIoRouter emits through the ITransport seam.
    bool send_raw(const std::string& message) override;

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

    // Socket.IO framing/routing — pure logic, emits via *this (ITransport).
    SocketIoRouter router_{*this};

    // Internal methods
    void init_client();
    void on_open(ConnectionHdl hdl);
    void on_close(ConnectionHdl hdl);
    void on_fail(ConnectionHdl hdl);
    void on_message(ConnectionHdl hdl, MessagePtr msg);

    // Emit a Socket.IO event (thin forwarder to router_.emit()).
    bool emit(const std::string& event, const nlohmann::json& data);

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
