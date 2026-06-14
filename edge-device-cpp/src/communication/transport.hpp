#pragma once

#include <string>

namespace kds {

// =============================================================================
// ITransport — dependency-inversion seam over the raw bidirectional byte/text
// channel (production: a websocketpp TLS client).
//
// The Socket.IO message routing and reconnection policy don't actually care
// HOW bytes get on the wire; they only need "send this frame" and "are we
// connected". Hiding websocketpp behind this interface lets that logic
// (SocketIoRouter, ReconnectPolicy) be unit-tested against a FakeTransport
// that just records sent frames — no ASIO, no TLS, no live socket.
//
// WebSocketClient implements this interface as a thin adapter; the real
// send/connect machinery stays behind the seam, behavior-preserving.
// =============================================================================
class ITransport {
public:
    virtual ~ITransport() = default;

    // Send a raw text frame. Returns true if the frame was accepted for sending.
    virtual bool send_raw(const std::string& message) = 0;

    // True while the underlying connection is open.
    virtual bool is_connected() const = 0;
};

} // namespace kds
