#include "socketio_router.hpp"
#include "../utils/logger.hpp"

namespace kds {

SocketIoRouter::Inbound SocketIoRouter::handle_message(const std::string& payload) {
    // Engine.IO packet format: first character indicates packet type.
    //   0: open, 1: close, 2: ping, 3: pong, 4: message
    if (payload.empty()) {
        return Inbound::Empty;
    }

    const char packet_type = payload[0];

    switch (packet_type) {
        case '0': {
            // Open packet — session info.
            LOG_DEBUG("Socket.IO open packet received");
            return Inbound::Open;
        }
        case '2': {
            // Ping -> respond with pong.
            transport_.send_raw("3");
            return Inbound::Ping;
        }
        case '4': {
            // Message packet. Format: 4<namespace>[<id>]<event>,<data>
            // Example: 42/analytics-edge,["edge:config",{"data":{...}}]
            if (payload.length() > 1 && payload[1] == '2') {
                // Event message: find namespace/data separator.
                const size_t comma_pos = payload.find(',', 2);
                if (comma_pos == std::string::npos) {
                    return Inbound::Ignored;
                }
                const std::string json_str = payload.substr(comma_pos + 1);

                try {
                    auto arr = nlohmann::json::parse(json_str);
                    if (arr.is_array() && arr.size() >= 2) {
                        const std::string event = arr[0].get<std::string>();
                        const nlohmann::json data = arr[1];

                        LOG_DEBUG("Received event: {}", event);

                        if (event == "edge:config" && config_cb_) {
                            if (data.contains("data")) {
                                config_cb_(EdgeDeviceConfig::from_json(data["data"]));
                                return Inbound::Event;
                            }
                        } else if (event == "edge:command" && command_cb_) {
                            if (data.contains("data")) {
                                command_cb_(EdgeDeviceCommand::from_json(data["data"]));
                                return Inbound::Event;
                            }
                        } else if (event == "edge:calibration" && calibration_cb_) {
                            if (data.contains("data")) {
                                calibration_cb_(data["data"]);
                                return Inbound::Event;
                            }
                        }
                    }
                    return Inbound::Ignored;
                } catch (const nlohmann::json::exception& e) {
                    LOG_ERROR("Failed to parse message JSON: {}", e.what());
                    return Inbound::ParseError;
                }
            } else if (payload.length() > 1 && payload[1] == '3') {
                // Ack message (response to an emitted event).
                LOG_DEBUG("Received ack: {}", payload);
                return Inbound::Ack;
            }
            return Inbound::Ignored;
        }
        default:
            LOG_DEBUG("Unknown packet type: {}", packet_type);
            return Inbound::Ignored;
    }
}

bool SocketIoRouter::emit(const std::string& event, const nlohmann::json& data) {
    if (!transport_.is_connected()) {
        LOG_WARN("Cannot emit - not connected");
        return false;
    }

    // Build Socket.IO message: 42<namespace>,["event",data]
    nlohmann::json msg_array = nlohmann::json::array();
    msg_array.push_back(event);
    msg_array.push_back(data);

    const std::string message = "42/analytics-edge," + msg_array.dump();
    return transport_.send_raw(message);
}

} // namespace kds
