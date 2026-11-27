import type { MetadataBundle } from './bundle';
import type { PlanSlot } from '../compare';

export type PairingDecision =
  | { kind: 'auto-attach'; slotIndex: number; warning: string | null }
  | { kind: 'needs-choice'; reason: string; candidateIndices: number[] }
  | { kind: 'no-targets'; reason: string };

export function pairBundleWithSlots(
  bundle: MetadataBundle,
  slots: PlanSlot[],
): PairingDecision {
  const candidateIndices: number[] = [];
  slots.forEach((slot, idx) => {
    if (slot.parsedPlan) candidateIndices.push(idx);
  });
  if (candidateIndices.length === 0) {
    return { kind: 'no-targets', reason: 'No plan is loaded — paste a plan first, then drop the bundle.' };
  }

  const bundleSqlId = bundle.plan_ref.sql_id;
  if (!bundleSqlId) {
    return {
      kind: 'needs-choice',
      reason: 'Bundle has no SQL_ID — choose a target plan slot.',
      candidateIndices,
    };
  }

  const sqlIdMatches = candidateIndices.filter(
    (i) => slots[i].parsedPlan?.sqlId === bundleSqlId,
  );
  const bundleHash = bundle.plan_ref.plan_hash_value;
  const matchIndex =
    sqlIdMatches.find((i) => bundleHash !== null && slots[i].parsedPlan?.planHashValue === String(bundleHash)) ??
    sqlIdMatches[0];
  if (matchIndex === undefined) {
    return {
      kind: 'needs-choice',
      reason: `No loaded plan has SQL_ID ${bundleSqlId} — choose a target plan slot.`,
      candidateIndices,
    };
  }

  const slot = slots[matchIndex];
  const planHashValue = slot.parsedPlan?.planHashValue;
  if (
    bundleHash !== null &&
    planHashValue !== undefined &&
    planHashValue !== String(bundleHash)
  ) {
    return {
      kind: 'auto-attach',
      slotIndex: matchIndex,
      warning: `Metadata was captured for a different plan_hash of this SQL — stats may have changed (plan ${planHashValue} vs. bundle ${bundleHash}).`,
    };
  }
  return { kind: 'auto-attach', slotIndex: matchIndex, warning: null };
}
