#include "websocket_client.hpp"
#include "../utils/logger.hpp"

#include <boost/asio/ssl/host_name_verification.hpp>  // deep-review NH14

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

        ctx->set_verify_mode(boost::asio::ssl::verify_peer);

        // deep-review NH14: verify_peer only validates the cert chains to a
        // trusted CA — it does NOT check the cert's hostname. Without this any
        // CA-valid cert for the WRONG host (or a DNS-redirected MITM) would
        // complete the handshake and capture the device's long-lived Bearer
        // auth_token. Install RFC2818 hostname verification against the host
        // parsed from the backend URL. (Boost.Asio does not do this under
        // verify_peer by default.)
        const std::string host = parse_host(config_.url);
        if (!host.empty()) {
            ctx->set_verify_callback(boost::asio::ssl::host_name_verification(host));
        } else {
            LOG_ERROR("Could not parse host from backend URL for TLS hostname "
                      "verification: {}", config_.url);
        }

    } catch (const std::exception& e) {
        LOG_ERROR("TLS init error: {}", e.what());
    }

    return ctx;
}

// deep-review NH14: extract the bare hostname from a ws(s)://host[:port][/path]
// (or with a query string) URL. Returns "" if no host can be found.
std::string WebSocketClient::parse_host(const std::string& url) {
    std::string s = url;

    // Strip scheme (ws://, wss://, http://, https://, ...).
    const auto scheme_pos = s.find("://");
    if (scheme_pos != std::string::npos) {
        s = s.substr(scheme_pos + 3);
    }

    // Strip any userinfo (user:pass@host) if present.
    const auto at_pos = s.find('@');
    if (at_pos != std::string::npos) {
        s = s.substr(at_pos + 1);
    }

    // Host ends at the first of '/', ':' (port) or '?' (query).
    const auto end = s.find_first_of("/:?");
    if (end != std::string::npos) {
        s = s.substr(0, end);
    }

    return s;
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

    {
        // deep-review NH15: serialize the connection_ write against send_raw/
        // disconnect reads on other threads.
        std::lock_guard<std::mutex> lk(conn_mutex_);
        connection_ = con->get_handle();
    }
    client_.connect(con);

    return true;
}

void WebSocketClient::disconnect() {
    if (!connected_) {
        return;
    }

    LOG_INFO("Disconnecting from backend");

    // deep-review NH15: copy the handle under the lock before the network call.
    ConnectionHdl hdl;
    {
        std::lock_guard<std::mutex> lk(conn_mutex_);
        hdl = connection_;
    }

    websocketpp::lib::error_code ec;
    client_.close(hdl, websocketpp::close::status::normal, "Client closing", ec);

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

    // deep-review NH13: cancel the pending registration timer before stopping
    // the io_service so its callback can't fire against a tearing-down client.
    if (register_timer_) {
        register_timer_->cancel();
    }

    // Stop the io_service
    client_.stop();

    // Notify queue waiter
    queue_cv_.notify_all();
}

void WebSocketClient::on_open(ConnectionHdl hdl) {
    LOG_INFO("WebSocket connection opened");
    {
        // deep-review NH15: serialize the connection_ write against sender-thread
        // reads in send_raw/disconnect.
        std::lock_guard<std::mutex> lk(conn_mutex_);
        connection_ = hdl;
    }
    connected_ = true;

    // Socket.IO open packet
    send_raw("40/analytics-edge,");

    // deep-review NH13: schedule the delayed device registration on the
    // io_service's own timer instead of a detached std::thread. The old detached
    // thread captured `this` and ran 500ms later — if the client was destroyed
    // within that window (shutdown), it dereferenced freed memory (use-after-
    // free), and every reconnect spawned a fresh thread (thread churn on a
    // reconnect storm). This timer is owned by, and cancelled with, the client:
    // its callback runs on the same io thread that stop()+join() drains, so by
    // the time the object is destroyed no callback can still be pending.
    // Cancel any in-flight timer first so reconnects don't accumulate timers.
    if (register_timer_) {
        register_timer_->cancel();
    }
    register_timer_ = client_.set_timer(500, [this](const websocketpp::lib::error_code& ec) {
        if (ec) {
            return;  // cancelled (e.g. on stop) — bail
        }
        if (connected_) {
            register_device();
        }
    });
}

void WebSocketClient::on_close(ConnectionHdl /*hdl*/) {
    LOG_INFO("WebSocket connection closed");
    connected_ = false;
    registered_ = false;
    // deep-review NH15: clear the stale handle so nothing is sent on a dead
    // connection after a drop.
    {
        std::lock_guard<std::mutex> lk(conn_mutex_);
        connection_ = ConnectionHdl();
    }
}

void WebSocketClient::on_fail(ConnectionHdl /*hdl*/) {
    LOG_ERROR("WebSocket connection failed");
    connected_ = false;
    registered_ = false;
    // deep-review NH15: clear the stale handle (see on_close).
    {
        std::lock_guard<std::mutex> lk(conn_mutex_);
        connection_ = ConnectionHdl();
    }
}

void WebSocketClient::on_message(ConnectionHdl /*hdl*/, MessagePtr msg) {
    std::string payload = msg->get_payload();

    {
        std::lock_guard<std::mutex> lock(stats_mutex_);
        stats_.messages_received++;
    }

    LOG_DEBUG("Received message: {}", payload);
    // Delegate Socket.IO/Engine.IO framing + event routing to the pure router.
    router_.handle_message(payload);
}

bool WebSocketClient::emit(const std::string& event, const nlohmann::json& data) {
    // Forward to the router, which builds the Socket.IO frame and sends it
    // back through *this (ITransport::send_raw).
    return router_.emit(event, data);
}

bool WebSocketClient::send_raw(const std::string& message) {
    if (!connected_) {
        return false;
    }

    try {
        // deep-review NH15: copy the handle under the lock, then send outside it
        // so the network call isn't serialized behind conn_mutex_.
        ConnectionHdl hdl;
        {
            std::lock_guard<std::mutex> lk(conn_mutex_);
            hdl = connection_;
        }

        websocketpp::lib::error_code ec;
        client_.send(hdl, message, websocketpp::frame::opcode::text, ec);

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
