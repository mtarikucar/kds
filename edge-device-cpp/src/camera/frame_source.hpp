#pragma once

#include "frame.hpp"  // for kds::Frame

#include <functional>

namespace kds {

// =============================================================================
// IFrameSource — dependency-inversion seam over the video frame producer
// (production: a GStreamer RTSP pipeline pulling samples off an appsink).
//
// The capture LOGIC — pull a frame, dispatch it, count consecutive failures,
// decide when to reconnect — doesn't depend on GStreamer; it only needs
// "give me the next frame (or tell me there isn't one yet)" and "reconnect the
// pipeline". This interface exposes exactly that, so the FrameDispatcher policy
// can be driven by a FakeFrameSource in tests (no GStreamer, no live camera).
//
// RTSPClient implements this interface as a thin adapter; the GStreamer
// pipeline management stays behind the seam, behavior-preserving.
// =============================================================================
class IFrameSource {
public:
    virtual ~IFrameSource() = default;

    // Try to pull the next frame within an internal timeout.
    //   returns true  + fills `frame` when a frame is available,
    //   returns false (a timeout / transient miss) otherwise.
    virtual bool try_pull(Frame& frame) = 0;

    // Tear down and re-establish the underlying source. Returns true if the
    // source is producing again afterwards.
    virtual bool reconnect() = 0;

    // True while the source is in a running/connected state.
    virtual bool is_open() const = 0;
};

} // namespace kds
