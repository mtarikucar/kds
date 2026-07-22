/**
 * Single source of truth for the shared "explore demo" tenant's plan name.
 * DemoService seeds the demo tenant onto a SubscriptionPlan with this exact
 * name (never active/public — internal only), and DemoGuardService keys off
 * the SAME constant to recognize the demo tenant and block real-money
 * initiation for it. Do NOT change this value without a migration — it must
 * keep matching the already-seeded plan row.
 */
export const DEMO_PLAN_NAME = "DEMO";
