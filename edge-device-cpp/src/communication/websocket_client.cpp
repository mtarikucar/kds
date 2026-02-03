#include "websocket_client.hpp"
#include "../utils/logger.hpp"

#include <chrono>
#include <iomanip>
#include <sstream>

namespace kds {

WebSocketClient::WebSocketClient(const BackendConfig& config)
    : config_(config) {
    init_client();
}

WebSocketClient::~WebSocketClient() {
    stop();
}

void WebSocketClient::init_client() {
    // Set logging handlers
    client_.clear_access_channels(websocketpp::log::alevel::all);
    client_.set_access_channels(websocketpp::log::alevel::connect);
    client_.set_access_channels(websocketpp::log::alevel::disconnect);
    client_.set_access_channels(websocketpp::log::alevel::fail);

    client_.clear_error_channels(websocketpp::log::elevel::all);
    client_.set_error_channels(websocketpp::log::elevel::warn);
    client_.set_error_channels(websocketpp::log::elevel::rerror);
    client_.set_error_channels(websocketpp::log::elevel::fatal);

    // Initialize ASIO
    client_.init_asio();

    // Set TLS handler
    client_.set_tls_init_handler([this](ConnectionHdl) {
        return on_tls_init();
    });

    // Set message handlers
    client_.set_open_handler([this](ConnectionHdl hdl) {
        on_open(hdl);
    });

    client_.set_close_handler([this](ConnectionHdl hdl) {
        on_close(hdl);
    });

    client_.set_fail_handler([this](ConnectionHdl hdl) {
        on_fail(hdl);
    });

    client_.set_message_handler([this](ConnectionHdl hdl, MessagePtr msg) {
        on_message(hdl, msg);
    });
}

std::shared_ptr<boost::asio::ssl::context> WebSocketClient::on_tls_init() {
    auto ctx = std::make_shared<boost::asio::ssl::context>(
        boost::asio::ssl::context::tlsv12_client);

    try {
        ctx->set_options(
            boost::asio::ssl::context::default_workarounds |
            boost::asio::ssl::context::no_sslv2 |
            boost::asio::ssl::context::no_sslv3 |
            boost::asio::ssl::context::single_dh_use);

        // Use system default certificates
        ctx->set_default_verify_paths();

        // For development, you might want to skip verification
        // ctx->set_verify_mode(boost::asio::ssl::verify_none);
        ctx->set_verify_mode(boost::asio::ssl::verify_peer);

    } catch (const std::exception& e) {
        LOG_ERROR("TLS init error: {}", e.what());
    }

    return ctx;
}

bool WebSocketClient::connect() {
    if (connected_) {
        LOG_WARN("Already connected");
        return true;
    }

    // Build Socket.IO handshake URL
    // Socket.IO uses HTTP upgrade to WebSocket
    std::string url = config_.url;

    // Add Socket.IO parameters
    if (url.find("?") == std::string::npos) {
        url += "?EIO=4&transport=websocket";
    } else {
        url += "&EIO=4&transport=websocket";
    }

    LOG_INFO("Connecting to backend: {}", url);

    websocketpp::lib::error_code ec;
    auto con = client_.get_connection(url, ec);

    if (ec) {
        LOG_ERROR("Connection error: {}", ec.message());
        return false;
    }

    // Add authorization header
    if (!config_.auth_token.empty()) {
        con->append_header("Authorization", "Bearer " + config_.auth_token);
    }

    connection_ = con->get_handle();
    client_.connect(con);

    return true;
}

void WebSocketClient::disconnect() {
    if (!connected_) {
        return;
    }

    LOG_INFO("Disconnecting from backend");

    websocketpp::lib::error_code ec;
    client_.close(connection_, websocketpp::close::status::normal, "Client closing", ec);

    if (ec) {
        LOG_ERROR("Close error: {}", ec.message());
    }

    connected_ = false;
    registered_ = false;
}

void WebSocketClient::run() {
    running_ = true;

    while (running_) {
        try {
            // Connect if not connected
            if (!connected_) {
                connect();
            }

            // Run the ASIO io_service
            client_.run();

        } catch (const std::exception& e) {
            LOG_ERROR("WebSocket error: {}", e.what());
        }

        // If we get here, connection was lost
        if (running_) {
            LOG_INFO("Connection lost, reconnecting in {}ms...",
                     config_.reconnect_delay_ms);
            std::this_thread::sleep_for(
                std::chrono::milliseconds(config_.reconnect_delay_ms));

            {
                std::lock_guard<std::mutex> lock(stats_mutex_);
                stats_.reconnect_count++;
            }

            // Reset client for reconnection
            client_.reset();
            init_client();
        }
    }
}

void WebSocketClient::stop() {
    running_ = false;
    disconnect();

    // Stop the io_service
    client_.stop();

    // Notify queue waiter
    queue_cv_.notify_all();
}

void WebSocketClient::on_open(ConnectionHdl hdl) {
    LOG_INFO("WebSocket connection opened");
    connection_ = hdl;
    connected_ = true;

    // Socket.IO open packet
    send_raw("40/analytics-edge,");

    // Register device after brief delay
    std::thread([this]() {
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        if (connected_) {
            register_device();
        }
    }).detach();
}

void WebSocketClient::on_close(ConnectionHdl /*hdl*/) {
    LOG_INFO("WebSocket connection closed");
    connected_ = false;
    registered_ = false;
}

void WebSocketClient::on_fail(ConnectionHdl /*hdl*/) {
    LOG_ERROR("WebSocket connection failed");
    connected_ = false;
    registered_ = false;
}

void WebSocketClient::on_message(ConnectionHdl /*hdl*/, MessagePtr msg) {
    std::string payload = msg->get_payload();

    {
        std::lock_guard<std::mutex> lock(stats_mutex_);
        stats_.messages_received++;
    }

    LOG_DEBUG("Received message: {}", payload);
    handle_socketio_message(payload);
}

void WebSocketClient::handle_socketio_message(const std::string& payload) {
    // Socket.IO Engine.IO packet format:
    // First character(s) indicate packet type
    // 0: open, 1: close, 2: ping, 3: pong, 4: message

    if (payload.empty()) {
        return;
    }

    char packet_type = payload[0];

    switch (packet_type) {
        case '0': {
            // Open packet - contains session info
            LOG_DEBUG("Socket.IO open packet received");
            break;
        }
        case '2': {
            // Ping - respond with pong
            send_raw("3");
            break;
        }
        case '4': {
            // Message packet
            // Format: 4<namespace>[<id>]<event>,<data>
            // Example: 42/analytics-edge,["edge:config",{"data":{...}}]

            if (payload.length() > 1 && payload[1] == '2') {
                // Event message
                // Find the namespace and data
                size_t comma_pos = payload.find(',', 2);
                if (comma_pos != std::string::npos) {
                    std::string json_str = payload.substr(comma_pos + 1);

                    try {
                        auto arr = nlohmann::json::parse(json_str);
                        if (arr.is_array() && arr.size() >= 2) {
                            std::string event = arr[0].get<std::string>();
                            nlohmann::json data = arr[1];

                            LOG_DEBUG("Received event: {}", event);

                            // Handle specific events
                            if (event == "edge:config" && config_callback_) {
                                if (data.contains("data")) {
                                    auto config = EdgeDeviceConfig::from_json(data["data"]);
                                    config_callback_(config);
                                }
                            } else if (event == "edge:command" && command_callback_) {
                                if (data.contains("data")) {
                                    auto cmd = EdgeDeviceCommand::from_json(data["data"]);
                                    command_callback_(cmd);
                                }
                            } else if (event == "edge:calibration" && calibration_callback_) {
                                if (data.contains("data")) {
                                    calibration_callback_(data["data"]);
                                }
                            }
                        }
                    } catch (const nlohmann::json::exception& e) {
                        LOG_ERROR("Failed to parse message JSON: {}", e.what());
                    }
                }
            } else if (payload.length() > 1 && payload[1] == '3') {
                // Ack message (response to emitted event)
                LOG_DEBUG("Received ack: {}", payload);
            }
            break;
        }
        default:
            LOG_DEBUG("Unknown packet type: {}", packet_type);
            break;
    }
}

bool WebSocketClient::emit(const std::string& event, const nlohmann::json& data) {
    if (!connected_) {
        LOG_WARN("Cannot emit - not connected");
        return false;
    }

    // Build Socket.IO message
    // Format: 42<namespace>,["event",data]
    nlohmann::json msg_array = nlohmann::json::array();
    msg_array.push_back(event);
    msg_array.push_back(data);

    std::string message = "42/analytics-edge," + msg_array.dump();

    return send_raw(message);
}

bool WebSocketClient::send_raw(const std::string& message) {
    if (!connected_) {
        return false;
    }

    try {
        websocketpp::lib::error_code ec;
        client_.send(connection_, message, websocketpp::frame::opcode::text, ec);

        if (ec) {
            LOG_ERROR("Send error: {}", ec.message());
            return false;
        }

        {
            std::lock_guard<std::mutex> lock(stats_mutex_);
            stats_.messages_sent++;
        }

        LOG_DEBUG("Sent message: {}", message.substr(0, 100));
        return true;

    } catch (const std::exception& e) {
        LOG_ERROR("Send exception: {}", e.what());
        return false;
    }
}

bool WebSocketClient::register_device() {
    LOG_INFO("Registering device with backend");

    EdgeDeviceRegisterData reg_data;
    reg_data.device_id = config_.device_id;
    reg_data.tenant_id = config_.tenant_id;
    reg_data.camera_id = config_.camera_id;
    reg_data.firmware_version = "1.0.0";
    reg_data.hardware_type = "JETSON_NANO";

    bool success = emit("edge:register", reg_data.to_json());

    if (success) {
        registered_ = true;
        LOG_INFO("Device registration sent");
    }

    return success;
}

bool WebSocketClient::send_occupancy_data(const std::vector<OccupancyData>& detections) {
    if (!registered_) {
        return false;
    }

    OccupancyPayload payload;
    payload.camera_id = config_.camera_id;
    payload.tenant_id = config_.tenant_id;
    payload.timestamp = get_iso_timestamp();

    for (const auto& det : detections) {
        DetectionPayload dp;
        dp.tracking_id = det.tracking_id;
        dp.position_x = det.position.x;
        dp.position_z = det.position.z;
        dp.grid_x = det.position.grid_x;
        dp.grid_z = det.position.grid_z;
        dp.state = person_state_to_string(det.state);
        dp.confidence = det.confidence;
        dp.velocity_x = det.velocity.x;
        dp.velocity_z = det.velocity.y;

        payload.detections.push_back(dp);
    }

    return emit("edge:occupancy", payload.to_json());
}

bool WebSocketClient::send_heartbeat() {
    if (!registered_) {
        return false;
    }

    nlohmann::json data = {
        {"deviceId", config_.device_id},
        {"timestamp", get_iso_timestamp()}
    };

    return emit("edge:heartbeat", data);
}

bool WebSocketClient::send_health_status(const HealthStatusPayload& status) {
    if (!registered_) {
        return false;
    }

    return emit("edge:health", status.to_json());
}

WebSocketClient::Stats WebSocketClient::get_stats() const {
    std::lock_guard<std::mutex> lock(stats_mutex_);
    Stats s = stats_;
    s.connected = connected_;
    return s;
}

std::string WebSocketClient::get_iso_timestamp() {
    auto now = std::chrono::system_clock::now();
    auto time_t_now = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;

    std::stringstream ss;
    ss << std::put_time(std::gmtime(&time_t_now), "%FT%T");
    ss << '.' << std::setfill('0') << std::setw(3) << ms.count() << 'Z';

    return ss.str();
}

} // namespace kds
