// Unit tests for the inference seam:
//   - decode_yolo_output(): the pure YOLOv8 output decoding (threshold, class
//     filter, letterbox-undo, clipping, NMS) extracted from YoloTensorRT.
//   - IInferenceEngine driven through a FakeInferenceEngine (detect_batch
//     fan-out, the contract the orchestration relies on).
//
// None of this needs CUDA / TensorRT — that is the whole point of the seam.

#include "detection/yolo_postprocess.hpp"
#include "detection/inference_engine.hpp"
#include "utils/nms.hpp"
#include "fakes.hpp"

#include <vector>

#include "test_util.hpp"

namespace {

// Build a flat YOLOv8 output tensor [1, num_classes+4, num_detections] in the
// channel-major layout decode_yolo_output expects:
//   value(feature, det) = output[feature * num_detections + det].
// `boxes` is a list of (cx, cy, w, h, class_id, score) entries; everything else
// is zero. Coordinates are in NETWORK input space (post-letterbox).
struct Box {
    float cx, cy, w, h;
    int class_id;
    float score;
};

std::vector<float> make_output(int num_classes, int num_detections,
                               const std::vector<Box>& boxes) {
    const int features = num_classes + 4;
    std::vector<float> out(static_cast<size_t>(features) * num_detections, 0.0f);
    auto at = [&](int feature, int det) -> float& {
        return out[static_cast<size_t>(feature) * num_detections + det];
    };
    int det = 0;
    for (const auto& b : boxes) {
        at(0, det) = b.cx;
        at(1, det) = b.cy;
        at(2, det) = b.w;
        at(3, det) = b.h;
        at(4 + b.class_id, det) = b.score;
        ++det;
    }
    return out;
}

} // namespace

void run_inference_tests() {
    // No-letterbox geometry: input == original, so scale==1, offsets==0, and
    // network coords map 1:1 to image coords (keeps assertions readable).
    kds::LetterboxParams lb;
    lb.input_width = 640;
    lb.input_height = 640;
    lb.original = cv::Size(640, 640);

    // --- A single confident person passes through unchanged ---
    {
        const int NC = 80, ND = 4;
        auto output = make_output(NC, ND, {
            {100.0f, 100.0f, 40.0f, 80.0f, /*person*/0, 0.9f},
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.nms_threshold = 0.45f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        pp.person_class_id = 0;

        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            // center (100,100) size (40,80) -> corner (80, 60)
            CHECK(dets[0].class_id == 0);
            CHECK(dets[0].confidence > 0.89f && dets[0].confidence < 0.91f);
            CHECK(dets[0].bbox.x > 79.9f && dets[0].bbox.x < 80.1f);
            CHECK(dets[0].bbox.y > 59.9f && dets[0].bbox.y < 60.1f);
            CHECK(dets[0].bbox.width > 39.9f && dets[0].bbox.width < 40.1f);
            CHECK(dets[0].bbox.height > 79.9f && dets[0].bbox.height < 80.1f);
        }
    }

    // --- Below-threshold detections are dropped ---
    {
        const int NC = 80, ND = 2;
        auto output = make_output(NC, ND, {
            {100.0f, 100.0f, 40.0f, 80.0f, 0, 0.30f},  // below 0.5
            {300.0f, 300.0f, 40.0f, 80.0f, 0, 0.80f},  // above 0.5
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            CHECK(dets[0].confidence > 0.79f);
        }
    }

    // --- Non-person classes are filtered out (person_class_id == 0) ---
    {
        const int NC = 80, ND = 2;
        auto output = make_output(NC, ND, {
            {100.0f, 100.0f, 40.0f, 80.0f, /*car?*/2, 0.95f},  // not person
            {300.0f, 300.0f, 40.0f, 80.0f, /*person*/0, 0.70f},
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        pp.person_class_id = 0;
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            CHECK(dets[0].class_id == 0);
        }
    }

    // --- person_class_id < 0 keeps ALL classes ---
    {
        const int NC = 80, ND = 2;
        auto output = make_output(NC, ND, {
            {100.0f, 100.0f, 40.0f, 80.0f, 2, 0.95f},
            {300.0f, 300.0f, 40.0f, 80.0f, 0, 0.70f},
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        pp.person_class_id = -1;  // keep all
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 2);
    }

    // --- NMS collapses two heavily-overlapping boxes into one ---
    {
        const int NC = 80, ND = 2;
        // Two near-identical boxes (IoU ~1) — NMS should keep the higher score.
        auto output = make_output(NC, ND, {
            {200.0f, 200.0f, 50.0f, 100.0f, 0, 0.92f},
            {201.0f, 201.0f, 50.0f, 100.0f, 0, 0.70f},
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.nms_threshold = 0.45f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            CHECK(dets[0].confidence > 0.91f);  // the stronger of the two
        }
    }

    // --- Letterbox undo: a box in network space maps back to original space ---
    {
        // Original 320x640 letterboxed into 640x640:
        //   scale = min(640/320, 640/640) = 1.0  -> x_offset = (640-320)/2 = 160
        kds::LetterboxParams lb2;
        lb2.input_width = 640;
        lb2.input_height = 640;
        lb2.original = cv::Size(320, 640);
        CHECK(lb2.scale() > 0.99f && lb2.scale() < 1.01f);
        CHECK(lb2.x_offset() > 159.9f && lb2.x_offset() < 160.1f);
        CHECK(lb2.y_offset() > -0.1f && lb2.y_offset() < 0.1f);

        const int NC = 80, ND = 1;
        // Network-space center at x=320 (the middle) -> original x = 320-160=160
        auto output = make_output(NC, ND, {
            {320.0f, 100.0f, 40.0f, 80.0f, 0, 0.9f},
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        auto dets = kds::decode_yolo_output(output, lb2, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            // original center x ~160, corner x = 160 - 20 = 140
            CHECK(dets[0].bbox.x > 139.0f && dets[0].bbox.x < 141.0f);
        }
    }

    // --- Bounds clipping: a box partly off the right edge is clamped ---
    {
        const int NC = 80, ND = 1;
        // center near right edge so x1 is fine but width spills past width.
        auto output = make_output(NC, ND, {
            {630.0f, 100.0f, 40.0f, 80.0f, 0, 0.9f},  // x1=610, x1+w=650 > 640
        });
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.size() == 1);
        if (!dets.empty()) {
            CHECK(dets[0].bbox.x + dets[0].bbox.width <= 640.1f);
        }
    }

    // --- Empty / all-zero tensor yields no detections ---
    {
        const int NC = 80, ND = 8;
        std::vector<float> output(static_cast<size_t>(NC + 4) * ND, 0.0f);
        kds::PostprocessParams pp;
        pp.confidence_threshold = 0.5f;
        pp.num_classes = NC;
        pp.num_detections = ND;
        auto dets = kds::decode_yolo_output(output, lb, pp);
        CHECK(dets.empty());
    }

    // --- IInferenceEngine via FakeInferenceEngine: detect() pops scripted
    //     results in order, and detect_batch() fans out over detect(). ---
    {
        kds::fakes::FakeInferenceEngine fake;
        kds::Detection a; a.bbox = cv::Rect2f(0, 0, 10, 10); a.confidence = 0.8f; a.class_id = 0;
        kds::Detection b; b.bbox = cv::Rect2f(5, 5, 10, 10); b.confidence = 0.6f; b.class_id = 0;
        fake.push_result({a});       // frame 1 -> 1 det
        fake.push_result({a, b});    // frame 2 -> 2 dets
        // frame 3 -> exhausted -> empty

        kds::IInferenceEngine& eng = fake;  // exercise via the interface
        CHECK(eng.is_initialized() == true);

        std::vector<cv::Mat> frames(3, cv::Mat::zeros(4, 4, CV_8UC3));
        auto results = eng.detect_batch(frames);
        CHECK(results.size() == 3);
        CHECK(results[0].size() == 1);
        CHECK(results[1].size() == 2);
        CHECK(results[2].empty());
        CHECK(fake.detect_calls() == 3);
        CHECK(eng.get_inference_time() > 0.0f);
        CHECK(eng.get_input_size().width == 640);
    }
}
