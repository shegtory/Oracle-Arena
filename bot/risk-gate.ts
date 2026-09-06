/**
 * Oracle Arena — deterministic risk policy and LLM prompt builder.
 *
 * POLICY CONFIGURATION:
 * - All policy thresholds are intentionally centralized in RISK_CONFIG.
 * - `liquidity` means total immediately available shares on the side Oracle
 *   Arena intends to buy, inside the caller's chosen book depth.
 * - `marketKey` must uniquely identify one DreamDEX market generation. Prefer
 *   `${marketId}:${pool}:${nonce}` so a recycled pool cannot collide.
 * - This module performs no network or inference calls; it is deterministic and
 *   can be unit-tested with plain objects.
 */

export type Asset = 'BTC' | 'ETH';
export type TradeDecision = 'UP' | 'DOWN' | 'SKIP';

export const RISK_CONFIG = {
  /** Maximum number of outcome shares submitted by one cycle. */
  maxTradeSize: 12.5,
  /** Do not open a position this close to the market's on-chain expiry. */
  minMinutesToClose: 3,
  /** Minimum immediately available shares on the intended outcome book. */
  minBookLiquidity: 25,
} as const;

export interface DecisionInput {
  asset: Asset;
  currentPriceUsd: number;
  priceOneHourAgoUsd: number;
  /** Optional market-implied probability for YES, in [0, 1]. */
  marketYesProbability?: number;
  marketClosesAt: Date;
}

export interface LlmDecision {
  decision: TradeDecision;
  /** Expected range: 0..1. The deterministic gate does not rely on it. */
  confidence: number;
  /** A short explanation returned by the Somnia LLM Inference Agent. */
  reasoning: string;
}

export interface RiskMarket {
  marketKey: string;
  closesAtMs: number;
  /** Immediately executable/resting liquidity for the outcome being bought. */
  liquidity: number;
}

export interface RiskGateInput {
  decision: LlmDecision;
  market: RiskMarket;
  requestedTradeSize: number;
  /** Injected state makes duplicate detection explicit and testable. */
  tradedMarketKeys: ReadonlySet<string>;
  nowMs?: number;
}

export type RiskGateResult =
  | { allowed: true; approvedTradeSize: number; reasons: [] }
  | { allowed: false; approvedTradeSize: 0; reasons: string[] };

/**
 * Produces the prompt submitted to Somnia's native LLM Inference Agent.
 *
 * TODO(agent ABI): The current AgentCallbackV2 uses an allowed-values string
 * response. If the deployed agent only supports enum output, ask it for
 * UP/DOWN/SKIP only and store confidence/reasoning in a separate request/event.
 */
export function buildDecisionPrompt(input: DecisionInput): string {
  const { asset, currentPriceUsd, priceOneHourAgoUsd, marketClosesAt } = input;
  if (!(currentPriceUsd > 0) || !(priceOneHourAgoUsd > 0)) {
    throw new Error('Current and one-hour prices must be positive');
  }

  const changePct = ((currentPriceUsd - priceOneHourAgoUsd) / priceOneHourAgoUsd) * 100;
  const marketContext = input.marketYesProbability === undefined
    ? 'Market YES probability is unavailable.'
    : `Market YES probability is ${(input.marketYesProbability * 100).toFixed(2)}%.`;

  return [
    'You are Oracle Arena, a conservative short-horizon binary-market signal agent.',
    `Asset: ${asset}`,
    `Current ${asset}/USD price: ${currentPriceUsd.toFixed(2)}`,
    `Price exactly one hour ago: ${priceOneHourAgoUsd.toFixed(2)}`,
    `One-hour change: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(4)}%`,
    `Market close time (UTC): ${marketClosesAt.toISOString()}`,
    marketContext,
    '',
    'Choose UP only when the one-hour evidence supports upward continuation.',
    'Choose DOWN only when the one-hour evidence supports downward continuation.',
    'Choose SKIP when the signal is weak, conflicting, stale, or uncertain.',
    'Do not invent news, indicators, or prices not supplied above.',
    '',
    'Return valid JSON only, with no Markdown or extra text:',
    '{"decision":"UP|DOWN|SKIP","confidence":0.00,"reasoning":"one short sentence"}',
    'confidence must be a number from 0 to 1.',
  ].join('\n');
}

/** Safely validates and normalizes the free-text/JSON response from the agent. */
export function parseLlmDecision(raw: string): LlmDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`LLM response was not valid JSON: ${raw}`);
  }

  if (!value || typeof value !== 'object') throw new Error('LLM response must be an object');
  const candidate = value as Record<string, unknown>;
  const decision = String(candidate.decision ?? '').toUpperCase();
  const confidence = Number(candidate.confidence);
  const reasoning = String(candidate.reasoning ?? '').trim();

  if (!['UP', 'DOWN', 'SKIP'].includes(decision)) {
    throw new Error(`Unsupported LLM decision: ${decision || '(empty)'}`);
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid LLM confidence: ${String(candidate.confidence)}`);
  }
  if (!reasoning) throw new Error('LLM reasoning is empty');

  return { decision: decision as TradeDecision, confidence, reasoning };
}

/** Applies only deterministic safety rules; it never upgrades an inference decision. */
export function riskGate(input: RiskGateInput): RiskGateResult {
  const nowMs = input.nowMs ?? Date.now();
  const reasons: string[] = [];

  if (input.decision.decision === 'SKIP') reasons.push('Agent chose SKIP');
  if (!(input.requestedTradeSize > 0)) reasons.push('Trade size must be positive');
  if (input.requestedTradeSize > RISK_CONFIG.maxTradeSize) {
    reasons.push(`Trade size exceeds maximum of ${RISK_CONFIG.maxTradeSize}`);
  }

  const millisecondsToClose = input.market.closesAtMs - nowMs;
  const minimumHeadroomMs = RISK_CONFIG.minMinutesToClose * 60_000;
  if (millisecondsToClose <= minimumHeadroomMs) {
    reasons.push(`Market closes within ${RISK_CONFIG.minMinutesToClose} minutes`);
  }
  if (!Number.isFinite(input.market.liquidity) || input.market.liquidity < RISK_CONFIG.minBookLiquidity) {
    reasons.push(`Book liquidity is below ${RISK_CONFIG.minBookLiquidity} shares`);
  }
  if (input.tradedMarketKeys.has(input.market.marketKey)) {
    reasons.push('This market generation was already traded');
  }

  return reasons.length > 0
    ? { allowed: false, approvedTradeSize: 0, reasons }
    : { allowed: true, approvedTradeSize: input.requestedTradeSize, reasons: [] };
}
