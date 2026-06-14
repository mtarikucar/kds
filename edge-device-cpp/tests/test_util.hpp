#pragma once

// Tiny assert-based test harness — no external framework. Keeps the C++ test
// target dependency-free (no gtest/doctest vendoring required). Each CHECK
// records a pass/fail and prints a line; the test runner returns non-zero if
// any check failed so ctest marks the target failed.

#include <iostream>
#include <string>

namespace testkit {

inline int& checks_run() {
    static int n = 0;
    return n;
}

inline int& checks_failed() {
    static int n = 0;
    return n;
}

inline void record(bool ok, const char* expr, const char* file, int line) {
    ++checks_run();
    if (ok) {
        std::cout << "  PASS: " << expr << "\n";
    } else {
        ++checks_failed();
        std::cout << "  FAIL: " << expr << "  (" << file << ":" << line << ")\n";
    }
}

} // namespace testkit

#define CHECK(expr) ::testkit::record((expr), #expr, __FILE__, __LINE__)
