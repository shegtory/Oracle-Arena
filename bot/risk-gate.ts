/** Pure parsing, sizing, and deterministic trade policy for Oracle Arena. */
export type TradeDecision = 'UP' | 'DOWN' | 'SKIP';
export type Confidence = 'low' | 'medium' | 'high';

export interface StructuredDecision { decision: TradeDecision; reasoning: string; confidence: Confidence }
export interface RiskPolicy { maxTradeTUSDC: number; minTimeLeftSeconds: number; minLiquidityShares: number; askPremium: number; grid: number }
export interface RiskGateInput {
  decision: StructuredDecision; marketId: string; marketStatus: number; secondsLeft: number;
  liquidityShares: number; bestAsk: number; limitPrice: number; sizeShares: number;
  maxCostTUSDC: number; tradedMarketIds: ReadonlySet<string>; policy: RiskPolicy;
}
export interface RiskResult { allowed: boolean; reason: string }
export interface ExecutionInputs { outcome: 'YES' | 'NO'; bestAsk: number; limitPrice: number; sizeShares: number; maxCostTUSDC: number; liquidityShares: number; secondsLeft: number }

const DECISIONS = new Set<TradeDecision>(['UP', 'DOWN', 'SKIP']);
const CONFIDENCE = new Set<Confidence>(['low', 'medium', 'high']);
export const MAX_REASONING_LENGTH = 500;

/** Strictly validate the JSON contract requested by the production prompt. */
export function parseDecision(raw: string): StructuredDecision {
  let value: unknown;
  try { value = JSON.parse(raw.trim()); }
  catch { throw new Error('LLM response was not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LLM response must be a JSON object');
  const candidate = value as Record<string, unknown>;
  const { decision, confidence, reasoning } = candidate;
  if (typeof decision !== 'string' || !DECISIONS.has(decision as TradeDecision)) throw new Error('LLM decision must be UP, DOWN, or SKIP');
  if (typeof confidence !== 'string' || !CONFIDENCE.has(confidence as Confidence)) throw new Error('LLM confidence must be low, medium, or high');
  if (typeof reasoning !== 'string' || !reasoning.trim()) throw new Error('LLM reasoning must be a non-empty string');
  if (reasoning.length > MAX_REASONING_LENGTH) throw new Error(`LLM reasoning exceeds ${MAX_REASONING_LENGTH} characters`);
  return { decision: decision as TradeDecision, confidence: confidence as Confidence, reasoning: reasoning.trim() };
}

/** Derive price, size, cost, depth, and time only from the supplied fresh snapshot. */
export function deriveExecutionInputs(decision: StructuredDecision, expiry: number, yesAsks: ReadonlyArray<readonly [number, number]>, noAsks: ReadonlyArray<readonly [number, number]>, policy: RiskPolicy, nowMs = Date.now()): ExecutionInputs {
  const outcome = decision.decision === 'UP' ? 'YES' : 'NO';
  const asks = outcome === 'YES' ? yesAsks : noAsks;
  const bestAsk = asks[0]?.[0] ?? Number.NaN;
  const limitPrice = Number.isFinite(bestAsk) ? Math.min(.99, Math.ceil((bestAsk + policy.askPremium) / policy.grid) * policy.grid) : Number.NaN;
  const sizeShares = Number.isFinite(limitPrice) && limitPrice > 0 ? Math.floor((policy.maxTradeTUSDC / limitPrice) / policy.grid) * policy.grid : Number.NaN;
  const liquidityShares = Number.isFinite(limitPrice) ? asks.filter(([price]) => Number.isFinite(price) && price <= limitPrice).reduce((sum, [, quantity]) => sum + quantity, 0) : 0;
  return { outcome, bestAsk, limitPrice, sizeShares, maxCostTUSDC: sizeShares * limitPrice, liquidityShares, secondsLeft: expiry - Math.floor(nowMs / 1000) };
}

export function riskGate(input: RiskGateInput): RiskResult {
  const reasons: string[] = [];
  const { policy } = input;
  if (input.decision.decision === 'SKIP') reasons.push('LLM selected SKIP');
  if (input.marketStatus !== 1) reasons.push(`market status is ${input.marketStatus}, not Trading`);
  if (!Number.isFinite(input.secondsLeft) || input.secondsLeft <= policy.minTimeLeftSeconds) reasons.push(`${input.secondsLeft}s left; minimum is ${policy.minTimeLeftSeconds}s`);
  if (!Number.isFinite(input.bestAsk) || input.bestAsk <= 0 || input.bestAsk >= 1) reasons.push('best ask must be inside (0, 1)');
  if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0 || input.limitPrice >= 1) reasons.push('limit price must be inside (0, 1)');
  if (!Number.isFinite(input.sizeShares) || input.sizeShares <= 0) reasons.push('order size must be positive and finite');
  if (!Number.isFinite(input.liquidityShares) || input.liquidityShares < policy.minLiquidityShares) reasons.push(`${input.liquidityShares} shares liquidity; minimum is ${policy.minLiquidityShares}`);
  if (!Number.isFinite(input.maxCostTUSDC) || input.maxCostTUSDC <= 0 || input.maxCostTUSDC > policy.maxTradeTUSDC + 1e-9) reasons.push(`maximum cost exceeds ${policy.maxTradeTUSDC} tUSDC`);
  if (input.tradedMarketIds.has(input.marketId.toLowerCase())) reasons.push('marketId already traded');
  return { allowed: reasons.length === 0, reason: reasons.length ? reasons.join('; ') : 'all deterministic checks passed' };
}
