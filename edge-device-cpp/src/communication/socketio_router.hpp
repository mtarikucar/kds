#pragma once

#include "transport.hpp"
#include "types.hpp"

#include <nlohmann/json.hpp>

#include <functional>
#include <string>

namespace kds {

// =============================================================================
// SocketIoRouter — the PURE Socket.IO / Engine.IO message routing logic.
//
// Lifted out of WebSocketClient so the protocol handling (ping/pong, event
// framing, namespace-prefixed event dispatch, JSON payload parsing) can be
// unit-tested directly. It owns no socket: it parses inbound payloads and
// dispatches to callbacks, and it emits outbound frames through an ITransport.
//
// The framing is identical to the original WebSocketClient:
//   - Engine.IO packet types: '0' open, '2' ping (-> reply '3'), '4' message.
//   - Socket.IO event packets: "42<namespace>,[\"event\", data]".
//   - emit() produces "42/analytics-edge,[\"event\", data]".
//
// WebSocketClient now delegates handle_socketio_message()/emit() here, so the
// wire behavior is unchanged.
// =============================================================================
class SocketIoRouter {
public:
    using ConfigCallback = std::function<void(const EdgeDeviceConfig&)>;
    using CommandCallback = std::function<void(const EdgeDeviceCommand&)>;
    using CalibrationCallback = std::function<void(const nlohmann::json&)>;

    // The router emits outbound frames through `transport`. The transport must
    // outlive the router (WebSocketClient owns both).
    explicit SocketIoRouter(ITransport& transport) : transport_(transport) {}

    void set_config_callback(ConfigCallback cb) { config_cb_ = std::move(cb); }
    void set_command_callback(CommandCallback cb) { command_cb_ = std::move(cb); }
    void set_calibration_callback(CalibrationCallback cb) {
        calibration_cb_ = std::move(cb);
    }

    // Result of routing one inbound payload — useful for tests/observability.
    enum class Inbound {
        Empty,        // empty payload, ignored
        Open,         // Engine.IO open packet ('0')
        Ping,         // ping ('2') -> pong sent
        Event,        // a recognized Socket.IO event ('42...') dispatched
        Ack,          // ack frame ('43...')
        Ignored,      // well-formed but not a handled event / unknown type
        ParseError,   // '42' event whose JSON body failed to parse
    };

    // Route a single inbound Engine.IO/Socket.IO payload, invoking the relevant
    // callback if it matches a known event. Mirrors
    // WebSocketClient::handle_socketio_message exactly.
    Inbound handle_message(const std::string& payload);

    // Emit a Socket.IO event over the transport:
    //   "42/analytics-edge,[\"event\", data]"
    // Returns false (without sending) if the transport is not connected.
    bool emit(const std::string& event, const nlohmann::json& data);

private:
    ITransport& transport_;
    ConfigCallback config_cb_;
    CommandCallback command_cb_;
    CalibrationCallback calibration_cb_;
};

} // namespace kds
