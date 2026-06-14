import {
  IntegrationType,
  IntegrationTypeLabels,
} from "./integration-types.enum";

/**
 * Long-tail drift-guard: the IntegrationTypeLabels map is rendered in the
 * settings UI. If a new IntegrationType is added without a label, the UI
 * shows `undefined`. This pins one-to-one coverage so the maps can't drift.
 */
describe("integration-types.enum", () => {
  it("has a human label for every IntegrationType", () => {
    for (const type of Object.values(IntegrationType)) {
      expect(IntegrationTypeLabels[type]).toBeDefined();
      expect(typeof IntegrationTypeLabels[type]).toBe("string");
      expect(IntegrationTypeLabels[type].length).toBeGreaterThan(0);
    }
  });

  it("has no orphan labels for non-existent types", () => {
    const enumValues = new Set<string>(Object.values(IntegrationType));
    for (const key of Object.keys(IntegrationTypeLabels)) {
      expect(enumValues.has(key)).toBe(true);
    }
  });
});
