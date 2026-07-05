import { describe, it, expect } from 'vitest';
import { SAMPLE_PLANS } from '../index';
import { parsePlan } from '../../lib/parser';
import { parseBundle } from '../../lib/metadata/bundle';
import { pairBundleWithSlots } from '../../lib/metadata/pairing';
import type { PlanSlot } from '../../lib/compare';

// Curated examples may ship a `<stem>.meta.json` metadata-bundle sidecar that
// auto-attaches on load. This guards the contract those examples depend on:
// the bundle must be valid, and its SQL_ID/plan_hash must pair cleanly with the
// plan it rides alongside — otherwise the feature silently no-ops on load.
describe('example metadata sidecars', () => {
  const withMetadata = SAMPLE_PLANS.filter((p) => p.metadata);

  it('ships at least one example with a metadata sidecar', () => {
    expect(withMetadata.length).toBeGreaterThan(0);
  });

  for (const sample of withMetadata) {
    it(`"${sample.name}" bundle parses and auto-attaches to its plan`, () => {
      const parsed = parsePlan(sample.data);
      expect(parsed.rootNode).toBeTruthy();

      const bundle = parseBundle(sample.metadata as string);
      expect(bundle.format).toBe('ora-plan-metadata');
      expect(Object.keys(bundle.objects).length).toBeGreaterThan(0);

      const slots = [{ parsedPlan: parsed } as unknown as PlanSlot];
      const decision = pairBundleWithSlots(bundle, slots);
      expect(decision.kind).toBe('auto-attach');
      if (decision.kind === 'auto-attach') {
        // Same SQL_ID and plan_hash → no "captured for a different plan" warning.
        expect(decision.warning).toBeNull();
      }
    });
  }
});
