// Test runner for the edge-device pure-logic unit tests.
//
// Aggregates the assert-based suites and reports a single PASS/FAIL summary.
// Returns 0 only if every CHECK passed, so ctest marks the target accordingly.

#include <iostream>

#include "test_util.hpp"

void run_args_tests();
void run_config_tests();

int main() {
    std::cout << "[edge-device unit tests]\n";

    std::cout << "\n== parse_args ==\n";
    run_args_tests();

    std::cout << "\n== Config (merge_env / from_env / validate / to_json) ==\n";
    run_config_tests();

    const int run = testkit::checks_run();
    const int failed = testkit::checks_failed();
    std::cout << "\n----------------------------------------\n";
    std::cout << (failed == 0 ? "ALL PASSED" : "FAILURES PRESENT") << ": "
              << (run - failed) << "/" << run << " checks passed\n";

    return failed == 0 ? 0 : 1;
}
