// Unit tests for the transport seam:
//   - SocketIoRouter: Engine.IO/Socket.IO framing, ping/pong, event dispatch
//     to callbacks, and emit() framing — driven through a FakeTransport.
//   - ReconnectPolicy: pure exponential-backoff / retry-budget arithmetic.
//
// None of this needs websocketpp / ASIO / TLS — that is the point of the seam.

#include "communication/socketio_router.hpp"
#include "communication/reconnect_policy.hpp"
#include "communication/types.hpp"
#include "fakes.hpp"

#include <string>

#include "test_util.hpp"

void run_transport_tests() {
    using R = kds::SocketIoRouter;

    // --- Ping ('2') triggers a pong ('3') over the transport ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        auto r = router.handle_message("2");
        CHECK(r == R::Inbound::Ping);
        CHECK(t.sent().size() == 1);
        CHECK(t.sent()[0] == "3");
    }

    // --- Empty payload is ignored, sends nothing ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        CHECK(router.handle_message("") == R::Inbound::Empty);
        CHECK(t.sent().empty());
    }

    // --- Open packet ('0') is recognized, no callback, no send ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        CHECK(router.handle_message("0{\"sid\":\"abc\"}") == R::Inbound::Open);
        CHECK(t.sent().empty());
    }

    // --- edge:config event invokes the config callback with parsed data ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        bool called = false;
        kds::EdgeDeviceConfig got;
        router.set_config_callback([&](const kds::EdgeDeviceConfig& c) {
            called = true;
            got = c;
        });
        const std::string msg =
            "42/analytics-edge,[\"edge:config\","
            "{\"data\":{\"cameraId\":\"cam-9\",\"fps\":24,"
            "\"confidenceThreshold\":0.6}}]";
        auto r = router.handle_message(msg);
        CHECK(r == R::Inbound::Event);
        CHECK(called == true);
        CHECK(got.camera_id == "cam-9");
        CHECK(got.fps == 24);
        CHECK(got.confidence_threshold > 0.59f && got.confidence_threshold < 0.61f);
    }

    // --- edge:command event invokes the command callback ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        std::string cmd_seen;
        router.set_command_callback([&](const kds::EdgeDeviceCommand& c) {
            cmd_seen = c.command;
        });
        const std::string msg =
            "42/analytics-edge,[\"edge:command\","
            "{\"data\":{\"command\":\"RESTART\"}}]";
        CHECK(router.handle_message(msg) == R::Inbound::Event);
        CHECK(cmd_seen == "RESTART");
    }

    // --- edge:calibration event invokes the calibration callback ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        bool called = false;
        router.set_calibration_callback([&](const nlohmann::json& j) {
            called = j.contains("homographyMatrix");
        });
        const std::string msg =
            "42/analytics-edge,[\"edge:calibration\","
            "{\"data\":{\"homographyMatrix\":[[1,0,0]]}}]";
        CHECK(router.handle_message(msg) == R::Inbound::Event);
        CHECK(called == true);
    }

    // --- Unknown event is parsed but dispatched to nobody (Ignored) ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        const std::string msg =
            "42/analytics-edge,[\"edge:unknown\",{\"data\":{}}]";
        CHECK(router.handle_message(msg) == R::Inbound::Ignored);
    }

    // --- Malformed JSON body surfaces a ParseError (no crash) ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        const std::string msg = "42/analytics-edge,[not valid json";
        CHECK(router.handle_message(msg) == R::Inbound::ParseError);
    }

    // --- Ack frame ('43...') is recognized ---
    {
        kds::fakes::FakeTransport t;
        kds::SocketIoRouter router(t);
        CHECK(router.handle_message("43/analytics-edge,[]") == R::Inbound::Ack);
    }

    // --- emit() builds a 42-namespaced frame and sends it when connected ---
    {
        kds::fakes::FakeTransport t;
        t.set_connected(true);
        kds::SocketIoRouter router(t);
        nlohmann::json data = {{"deviceId", "dev-1"}};
        CHECK(router.emit("edge:heartbeat", data) == true);
        CHECK(t.sent().size() == 1);
        CHECK(t.sent()[0].rfind("42/analytics-edge,", 0) == 0);  // prefix
        CHECK(t.sent_contains("edge:heartbeat"));
        CHECK(t.sent_contains("dev-1"));
    }

    // --- emit() refuses (and sends nothing) when not connected ---
    {
        kds::fakes::FakeTransport t;
        t.set_connected(false);
        kds::SocketIoRouter router(t);
        CHECK(router.emit("edge:heartbeat", nlohmann::json::object()) == false);
        CHECK(t.sent().empty());
    }

    // === ReconnectPolicy =====================================================

    // --- Fixed-delay (base==max) reproduces the original behavior ---
    {
        kds::ReconnectPolicy p(5000, 5000, /*unlimited*/0);
        CHECK(p.next_delay_ms() == 5000);
        CHECK(p.record_failure() == 5000);
        CHECK(p.next_delay_ms() == 5000);  // capped, stays flat
        CHECK(p.should_retry() == true);   // unlimited budget
    }

    // --- Exponential growth, saturating at the cap ---
    {
        kds::ReconnectPolicy p(1000, 8000, 0);
        CHECK(p.next_delay_ms() == 1000);
        p.record_failure();                 // failures=1
        CHECK(p.next_delay_ms() == 2000);
        p.record_failure();                 // failures=2
        CHECK(p.next_delay_ms() == 4000);
        p.record_failure();                 // failures=3
        CHECK(p.next_delay_ms() == 8000);   // 8000 cap
        p.record_failure();                 // failures=4
        CHECK(p.next_delay_ms() == 8000);   // stays capped
    }

    // --- on_connected() resets the backoff streak ---
    {
        kds::ReconnectPolicy p(1000, 16000, 0);
        p.record_failure();
        p.record_failure();
        CHECK(p.failure_count() == 2);
        CHECK(p.next_delay_ms() == 4000);
        p.on_connected();
        CHECK(p.failure_count() == 0);
        CHECK(p.next_delay_ms() == 1000);   // back to base
    }

    // --- Retry budget is exhausted after max_attempts failures ---
    {
        kds::ReconnectPolicy p(1000, 8000, /*max_attempts*/3);
        CHECK(p.should_retry() == true);
        p.record_failure();  // 1
        CHECK(p.should_retry() == true);
        p.record_failure();  // 2
        CHECK(p.should_retry() == true);
        p.record_failure();  // 3
        CHECK(p.should_retry() == false);   // budget spent
    }
}
