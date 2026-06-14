// Pure helper extracted (verbatim) from SubscriptionsPage so it can be
// unit-tested in isolation. The component re-imports it at the original call
// site, so runtime behavior is byte-identical. The global side-effect
// (window.prompt) stays in the component; this guards the value it returns.

// Guard for the "extend by N days" prompt value: the raw prompt result
// (string | null) is valid only when it is a non-empty truthy string that
// parses to a non-NaN number. Mirrors the `days && !isNaN(Number(days))`
// condition. Returns a boolean (the original `&&` expression is only used in
// a boolean context).
export function isValidExtendDays(days: string | null): boolean {
  return !!(days && !isNaN(Number(days)));
}
