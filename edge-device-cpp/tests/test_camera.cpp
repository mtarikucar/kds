// Unit tests for the frame-source seam:
//   - FrameDispatcher: the capture-loop policy (pull -> dispatch -> count
//     misses -> reconnect on threshold) extracted from RTSPClient::capture_loop,
//     driven through a FakeFrameSource.
//
// None of this needs GStreamer / a live camera — that is the point of the seam.

#include "camera/frame_dispatcher.hpp"
#include "fakes.hpp"

#include <vector>

#include "test_util.hpp"

void run_camera_tests() {
    using S = kds::FrameDispatcher::Step;

    // --- A pulled frame is dispatched to the sink, error streak stays 0 ---
    {
        kds::fakes::FakeFrameSource src;
        src.push_frame();
        src.push_frame();

        int sink_calls = 0;
        kds::FrameDispatcher disp(src, [&](const kds::Frame& f) {
            CHECK(!f.empty());  // FakeFrameSource yields a 2x2 image
            ++sink_calls;
        }, /*max_consecutive_errors=*/30);

        CHECK(disp.step() == S::Dispatched);
        CHECK(disp.step() == S::Dispatched);
        CHECK(sink_calls == 2);
        CHECK(disp.frames_dispatched() == 2);
        CHECK(disp.consecutive_errors() == 0);
        CHECK(disp.reconnect_count() == 0);
    }

    // --- Misses under the threshold accumulate but do NOT reconnect ---
    {
        kds::fakes::FakeFrameSource src;
        src.push_miss(3);

        kds::FrameDispatcher disp(src, nullptr, /*max_consecutive_errors=*/5);
        CHECK(disp.step() == S::Missed);
        CHECK(disp.step() == S::Missed);
        CHECK(disp.step() == S::Missed);
        CHECK(disp.consecutive_errors() == 3);
        CHECK(src.reconnect_calls() == 0);
    }

    // --- Exceeding the threshold triggers exactly one reconnect, which
    //     succeeds and resets the error streak ---
    {
        kds::fakes::FakeFrameSource src;
        src.push_miss(20);                 // plenty of misses
        src.set_reconnect_default(true);   // reconnect succeeds

        const int THRESH = 3;
        kds::FrameDispatcher disp(src, nullptr, THRESH);

        // First THRESH+1 misses: the (THRESH+1)-th crosses the boundary.
        S last = S::Missed;
        for (int i = 0; i < THRESH + 1; ++i) {
            last = disp.step();
        }
        CHECK(last == S::Reconnected);
        CHECK(src.reconnect_calls() == 1);
        CHECK(disp.reconnect_count() == 1);
        CHECK(disp.consecutive_errors() == 0);  // reset after reconnect
    }

    // --- A failed reconnect is surfaced and does NOT reset the streak ---
    {
        kds::fakes::FakeFrameSource src;
        src.push_miss(20);
        src.set_reconnect_default(false);  // reconnect fails

        const int THRESH = 2;
        kds::FrameDispatcher disp(src, nullptr, THRESH);

        S last = S::Missed;
        for (int i = 0; i < THRESH + 1; ++i) {
            last = disp.step();
        }
        CHECK(last == S::ReconnectFailed);
        CHECK(src.reconnect_calls() == 1);
        CHECK(disp.reconnect_count() == 0);          // not counted as success
        CHECK(disp.consecutive_errors() == THRESH + 1);  // streak preserved
    }

    // --- A frame after a miss streak clears the streak (no reconnect) ---
    {
        kds::fakes::FakeFrameSource src;
        src.push_miss(2);
        src.push_frame();

        kds::FrameDispatcher disp(src, nullptr, /*max_consecutive_errors=*/5);
        CHECK(disp.step() == S::Missed);
        CHECK(disp.step() == S::Missed);
        CHECK(disp.consecutive_errors() == 2);
        CHECK(disp.step() == S::Dispatched);
        CHECK(disp.consecutive_errors() == 0);
        CHECK(src.reconnect_calls() == 0);
    }

    // --- Recovery: misses -> reconnect (success) -> frames flow again ---
    {
        kds::fakes::FakeFrameSource src;
        const int THRESH = 1;
        src.push_miss(THRESH + 1);   // force a reconnect
        src.push_reconnect_result(true);
        src.push_frame();            // a frame after reconnecting

        kds::FrameDispatcher disp(src, nullptr, THRESH);
        CHECK(disp.step() == S::Missed);        // 1st miss
        CHECK(disp.step() == S::Reconnected);   // crosses threshold -> reconnect
        CHECK(disp.step() == S::Dispatched);    // frame flows again
        CHECK(disp.frames_dispatched() == 1);
        CHECK(src.reconnect_calls() == 1);
        CHECK(src.is_open() == true);
    }
}
