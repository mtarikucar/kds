// Pure unit tests for kds::Config — environment merge + validation.
//
// merge_env(), from_env(), and validate() are pure functions of the process
// environment + the Config's own fields. We drive them deterministically by
// setting/unsetting the KDS_* env vars around each case.
//
// Note: these tests do NOT touch Config::load() (which needs a YAML file and
// pulls in yaml-cpp file parsing) — that path is exercised by integration,
// not unit, tests. merge_env / validate are the genuinely pure surface.

#include "config.hpp"

#include <cstdlib>
#include <string>

#include "test_util.hpp"

namespace {

// Portable setenv/unsetenv wrappers. On POSIX these are setenv/unsetenv; this
// edge target is Linux/Jetson only, so POSIX is a safe assumption.
void set_env(const char* k, const char* v) { ::setenv(k, v, /*overwrite=*/1); }
void clear_env(const char* k) { ::unsetenv(k); }

// Clear every KDS_* var this suite touches, so cases don't bleed into each
// other regardless of order.
void clear_all_kds_env() {
    const char* keys[] = {
        "KDS_DEVICE_ID", "KDS_LOG_LEVEL", "KDS_CAMERA_URL", "KDS_CAMERA_WIDTH",
        "KDS_CAMERA_HEIGHT", "KDS_CAMERA_FPS", "KDS_MODEL_PATH", "KDS_ENGINE_PATH",
        "KDS_CONFIDENCE_THRESHOLD", "KDS_BACKEND_URL", "KDS_AUTH_TOKEN",
        "KDS_TENANT_ID", "KDS_CAMERA_ID",
    };
    for (const char* k : keys) clear_env(k);
}

// Build a Config that already satisfies validate() so individual cases can
// knock out one field at a time.
kds::Config valid_config() {
    kds::Config c;
    c.device_id = "dev-1";
    c.camera.url = "rtsp://cam/stream";
    c.backend.url = "wss://api/edge";
    c.backend.auth_token = "tok";
    c.backend.tenant_id = "tenant-1";
    c.backend.camera_id = "cam-1";
    c.detection.confidence_threshold = 0.5f;
    return c;
}

} // namespace

void run_config_tests() {
    clear_all_kds_env();

    // --- merge_env: env vars override existing fields (env takes precedence) ---
    {
        kds::Config c;
        c.device_id = "from-file";
        c.camera.url = "rtsp://file-cam";
        set_env("KDS_DEVICE_ID", "from-env");
        set_env("KDS_CAMERA_URL", "rtsp://env-cam");
        set_env("KDS_BACKEND_URL", "wss://env-backend");
        set_env("KDS_AUTH_TOKEN", "env-token");
        set_env("KDS_TENANT_ID", "env-tenant");
        set_env("KDS_CAMERA_ID", "env-camera");
        set_env("KDS_LOG_LEVEL", "debug");

        c.merge_env();

        CHECK(c.device_id == "from-env");        // overridden
        CHECK(c.camera.url == "rtsp://env-cam");  // overridden
        CHECK(c.backend.url == "wss://env-backend");
        CHECK(c.backend.auth_token == "env-token");
        CHECK(c.backend.tenant_id == "env-tenant");
        CHECK(c.backend.camera_id == "env-camera");
        CHECK(c.log_level == "debug");
        clear_all_kds_env();
    }

    // --- merge_env: absent env vars leave existing fields untouched ---
    {
        kds::Config c;
        c.device_id = "keep-me";
        c.camera.url = "rtsp://keep";
        c.merge_env(); // no KDS_* set
        CHECK(c.device_id == "keep-me");
        CHECK(c.camera.url == "rtsp://keep");
    }

    // --- from_env: builds a fresh Config purely from env, typed parsing ---
    {
        set_env("KDS_DEVICE_ID", "edge-7");
        set_env("KDS_CAMERA_WIDTH", "1920");
        set_env("KDS_CAMERA_HEIGHT", "1080");
        set_env("KDS_CAMERA_FPS", "25");
        set_env("KDS_CONFIDENCE_THRESHOLD", "0.7");

        kds::Config c = kds::Config::from_env();
        CHECK(c.device_id == "edge-7");
        CHECK(c.camera.width == 1920);
        CHECK(c.camera.height == 1080);
        CHECK(c.camera.fps == 25);
        CHECK(c.detection.confidence_threshold > 0.69f &&
              c.detection.confidence_threshold < 0.71f);
        clear_all_kds_env();
    }

    // --- validate: a fully-populated config is valid ---
    {
        kds::Config c = valid_config();
        CHECK(c.validate() == true);
    }

    // --- validate: each required field, when empty, fails validation ---
    {
        kds::Config c = valid_config();
        c.device_id.clear();
        CHECK(c.validate() == false);
    }
    {
        kds::Config c = valid_config();
        c.camera.url.clear();
        CHECK(c.validate() == false);
    }
    {
        kds::Config c = valid_config();
        c.backend.auth_token.clear();
        CHECK(c.validate() == false);
    }
    {
        kds::Config c = valid_config();
        c.backend.tenant_id.clear();
        CHECK(c.validate() == false);
    }
    {
        kds::Config c = valid_config();
        c.backend.camera_id.clear();
        CHECK(c.validate() == false);
    }

    // --- validate: confidence_threshold out of [0,1] fails ---
    {
        kds::Config c = valid_config();
        c.detection.confidence_threshold = 1.5f;
        CHECK(c.validate() == false);
    }
    {
        kds::Config c = valid_config();
        c.detection.confidence_threshold = -0.1f;
        CHECK(c.validate() == false);
    }

    // --- to_json: round-trips the key fields the backend reads ---
    {
        kds::Config c = valid_config();
        auto j = c.to_json();
        CHECK(j["device_id"] == "dev-1");
        CHECK(j["camera"]["url"] == "rtsp://cam/stream");
        CHECK(j["backend"]["tenant_id"] == "tenant-1");
        CHECK(j["backend"]["camera_id"] == "cam-1");
    }

    clear_all_kds_env();
}
