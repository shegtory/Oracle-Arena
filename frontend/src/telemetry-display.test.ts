import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleSourceLabel, isTelemetryStale, marketWindowSeconds, TELEMETRY_STALE_AFTER_MS } from './telemetry-display';
import type { TradeReceipt } from './hooks/useTradeReceipt';

const receipt = (overrides: Partial<TradeReceipt> = {}): TradeReceipt => ({cycleId:'cycle-a',marketContext:{marketId:'btc-market',asset:'BTC'},...overrides} as TradeReceipt);

test('market window prefers risk gate, then snapshots, then fair-value horizon',()=>{
  assert.equal(marketWindowSeconds(receipt({riskGate:{secondsLeft:1503} as any}),'BTC'),1503);
  assert.equal(marketWindowSeconds(receipt({snapshots:{postInference:{secondsLeft:900} as any}}),'BTC'),900);
  assert.equal(marketWindowSeconds(receipt({fairValue:{modelInputs:{secondsLeft:720}} as any}),'BTC'),720);
});
test('expiry fallback uses the cycle timestamp and stays fixed for history',()=>{const historical=receipt({finishedAt:'2026-09-08T10:00:00Z',marketContext:{marketId:'btc-market',asset:'BTC',expiry:1788863100} as any});assert.equal(marketWindowSeconds(historical,'BTC'),1500);assert.equal(marketWindowSeconds(historical,'BTC'),1500)});
test('missing, negative and invalid windows fail closed',()=>{assert.equal(marketWindowSeconds(receipt(),'BTC'),null);assert.equal(marketWindowSeconds(receipt({riskGate:{secondsLeft:-1,expiry:Infinity} as any}),'BTC'),null);assert.equal(marketWindowSeconds(receipt({fairValue:{modelInputs:{secondsLeft:NaN}} as any}),'BTC'),null)});
test('window stays scoped to the selected cycle and asset',()=>{const a=receipt({cycleId:'a',riskGate:{secondsLeft:1503} as any});const b=receipt({cycleId:'b',riskGate:{secondsLeft:412} as any});assert.equal(marketWindowSeconds(a,'BTC'),1503);assert.equal(marketWindowSeconds(b,'BTC'),412);assert.equal(marketWindowSeconds(a,'ETH'),null)});
test('stale uses newest absolute telemetry timestamp and existing threshold',()=>{const now=Date.parse('2026-09-08T12:20:00Z');assert.equal(TELEMETRY_STALE_AFTER_MS,15*60_000);assert.equal(isTelemetryStale(receipt({finishedAt:'2026-09-08T12:10:00+00:00'}),now),false);assert.equal(isTelemetryStale(receipt({finishedAt:'2026-09-08T12:04:59Z'}),now),true);assert.equal(isTelemetryStale(receipt({finishedAt:'2026-09-08 12:19:00'}),now),true)});
test('live freshness is independent of a selected historical cycle',()=>{const now=Date.parse('2026-09-08T12:20:00Z');assert.equal(isTelemetryStale(receipt({finishedAt:'2026-09-08T12:19:00Z'}),now),false);assert.equal(isTelemetryStale(receipt({finishedAt:'2026-09-01T12:00:00Z'}),now),true)});
test('cycle source label is explicit and never invents a commit',()=>{assert.equal(cycleSourceLabel('a26a276ecb8323c128747c4ee1cab396329a92d0'),'CYCLE SOURCE · a26a276');assert.equal(cycleSourceLabel(undefined),'SOURCE UNKNOWN')});
