import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSettlement } from './reconcile-history.mjs';

const at = '2026-01-01T00:00:00.000Z';
const entry = (decision, filledShares = 1) => ({ llmDecision: { decision }, order: { status: 'confirmed', filledShares } });
test('settlement computes WIN and LOSS only for filled positions', () => {
  assert.equal(computeSettlement(entry('UP'), { isResolved: true, isVoided: false, payouts: [1n, 0n] }, at).result, 'WIN');
  assert.equal(computeSettlement(entry('DOWN'), { isResolved: true, isVoided: false, payouts: [1n, 0n] }, at).result, 'LOSS');
  assert.equal(computeSettlement(entry('UP', 0), { isResolved: true, isVoided: false, payouts: [1n, 0n] }, at).result, 'SKIP');
});
test('settlement computes VOID and pending SKIP semantics', () => {
  assert.equal(computeSettlement(entry('SKIP', 0), { isResolved: false, isVoided: true, payouts: [] }, at).result, 'VOID');
  assert.equal(computeSettlement(entry('SKIP', 0), { isResolved: true, isVoided: false, payouts: [0n, 1n] }, at).result, 'SKIP');
});
