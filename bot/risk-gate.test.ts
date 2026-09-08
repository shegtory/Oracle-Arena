import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveExecutionInputs, parseDecision, riskGate, type RiskGateInput, type StructuredDecision } from './risk-gate.js';

const decision: StructuredDecision = { decision: 'UP', confidence: 'medium', reasoning: 'Fresh data supports the position.' };
const policy = { maxTradeTUSDC: 5, minTimeLeftSeconds: 15, minLiquidityShares: 50, askPremium: .01, grid: .001 };
const base: RiskGateInput = { decision, marketId: '0xabc', marketStatus: 1, secondsLeft: 60, liquidityShares: 60, bestAsk: .5, limitPrice: .51, sizeShares: 9.803, maxCostTUSDC: 4.99953, tradedMarketIds: new Set(), policy };
const gate = (overrides: Partial<RiskGateInput> = {}) => riskGate({ ...base, ...overrides });

test('valid LLM JSON parses', () => assert.deepEqual(parseDecision('{"decision":"UP","reasoning":"Clear signal","confidence":"high"}'), { decision: 'UP', reasoning: 'Clear signal', confidence: 'high' }));
test('malformed and invalid LLM fields fail closed', () => {
  for (const raw of ['UP', '{', '{"decision":"SIDEWAYS","reasoning":"x","confidence":"high"}', '{"decision":"UP","reasoning":"x","confidence":"0.9"}', '{"decision":"UP","reasoning":"","confidence":"low"}']) assert.throws(() => parseDecision(raw));
});
test('SKIP never trades', () => assert.equal(gate({ decision: { ...decision, decision: 'SKIP' } }).allowed, false));
test('time at or below minimum is rejected', () => { assert.equal(gate({ secondsLeft: 15 }).allowed, false); assert.equal(gate({ secondsLeft: 14 }).allowed, false); });
test('insufficient liquidity is rejected', () => assert.equal(gate({ liquidityShares: 49.999 }).allowed, false));
test('duplicate market is rejected', () => assert.equal(gate({ tradedMarketIds: new Set(['0xabc']) }).allowed, false));
test('prices outside (0,1) are rejected', () => { for (const bestAsk of [0, 1, -1, Number.NaN]) assert.equal(gate({ bestAsk }).allowed, false); });
test('zero, negative, and non-finite sizes are rejected', () => { for (const sizeShares of [0, -1, Number.NaN, Infinity]) assert.equal(gate({ sizeShares }).allowed, false); });
test('derived size never exceeds maximum cost and price/depth snap correctly', () => {
  const result = deriveExecutionInputs(decision, 200, [[.5012, 20], [.509, 35], [.52, 100]], [], policy, 100_000);
  assert.equal(result.secondsLeft, 100); assert.equal(result.limitPrice, .512); assert.equal(result.liquidityShares, 55); assert.ok(result.maxCostTUSDC <= policy.maxTradeTUSDC);
});
test('post-inference time is recomputed from fresh now, not an older snapshot', () => {
  const old = deriveExecutionInputs(decision, 200, [[.5, 60]], [], policy, 100_000);
  const fresh = deriveExecutionInputs(decision, 200, [[.5, 60]], [], policy, 130_000);
  assert.equal(old.secondsLeft, 100); assert.equal(fresh.secondsLeft, 70); assert.notEqual(fresh.secondsLeft, old.secondsLeft);
});
