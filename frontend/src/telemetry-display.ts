import type { TradeReceipt } from './hooks/useTradeReceipt';

export const TELEMETRY_STALE_AFTER_MS = 15 * 60_000;

const positiveSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

const absoluteTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const receiptMarketAsset = (receipt: TradeReceipt): 'BTC' | 'ETH' | null => {
  const data = receipt as any;
  const explicit = data.marketContext?.asset?.toUpperCase();
  if (explicit === 'BTC' || explicit === 'ETH') return explicit;
  const marketId = data.riskGate?.marketId ?? data.marketContext?.marketId;
  return data.discovery?.candidates.find((candidate: any) => candidate.marketId === marketId)?.asset ?? null;
};

export function marketWindowSeconds(receipt: TradeReceipt, asset: 'BTC' | 'ETH'): number | null {
  const data = receipt as any;
  const marketAsset = receiptMarketAsset(receipt);
  if (marketAsset && marketAsset !== asset) return null;
  const measured = [data.riskGate?.secondsLeft,data.snapshots?.preWrite?.secondsLeft,data.snapshots?.postInference?.secondsLeft,data.snapshots?.preInference?.secondsLeft,data.fairValue?.modelInputs?.secondsLeft,data.marketContext?.secondsLeft]
    .map(positiveSeconds).find(value => value !== null);
  if (measured !== undefined) return measured;
  const expiry = positiveSeconds(data.riskGate?.expiry ?? data.snapshots?.preWrite?.expiry ?? data.snapshots?.postInference?.expiry ?? data.snapshots?.preInference?.expiry ?? data.marketContext?.expiry);
  const recordedAt = [data.riskGate?.checkedAt,data.snapshots?.preWrite?.checkedAt,data.snapshots?.postInference?.checkedAt,data.snapshots?.preInference?.checkedAt,data.finishedAt,data.stageStartedAt,data.startedAt]
    .map(absoluteTimestamp).find(value => value !== null);
  if (expiry === null || recordedAt === undefined) return null;
  return positiveSeconds(expiry - Math.floor(recordedAt / 1000));
}

export function latestTelemetryDate(receipt: TradeReceipt): Date | null {
  const data = receipt as any;
  const timestamps = [data.finishedAt,data.redeem?.checkedAt,data.settlement?.checkedAt,data.riskGate?.checkedAt,data.snapshots?.preWrite?.checkedAt,data.snapshots?.postInference?.checkedAt,data.snapshots?.preInference?.checkedAt,data.llmDecision?.receivedAt,data.priceSignal?.current?.receivedAt,data.priceSignal?.first?.receivedAt,data.stageStartedAt,data.startedAt]
    .map(absoluteTimestamp).filter((value): value is number => value !== null);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export function isTelemetryStale(receipt: TradeReceipt, nowMs = Date.now()): boolean {
  const timestamp = latestTelemetryDate(receipt)?.getTime();
  return timestamp == null || nowMs - timestamp > TELEMETRY_STALE_AFTER_MS;
}

export function cycleSourceLabel(sourceCommit?: string | null): string {
  return sourceCommit ? `CYCLE SOURCE · ${sourceCommit.slice(0, 7)}` : 'SOURCE UNKNOWN';
}
