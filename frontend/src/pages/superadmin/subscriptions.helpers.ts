// Pure helper extracted from SubscriptionsPage so it can be unit-tested in
// isolation. The component re-imports it at the call site.

// Guard for the "extend by N days" value (now fed by the extend modal's
// number input; historically the window.prompt result): valid only when it is
// a non-empty truthy string that parses to a non-NaN number. Returns a
// boolean (the expression is only used in a boolean context).
export function isValidExtendDays(days: string | null): boolean {
  return !!(days && !isNaN(Number(days)));
}
