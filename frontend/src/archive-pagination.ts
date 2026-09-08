import type { TradeReceipt } from './hooks/useTradeReceipt';

export const ARCHIVE_PAGE_SIZE = 10;
export type PageToken = number | 'ellipsis';

const timestamp = (cycle: TradeReceipt) => {
  const value = Date.parse(cycle.finishedAt ?? cycle.startedAt ?? '');
  return Number.isFinite(value) ? value : 0;
};

export function normalizeArchiveHistory(input: unknown): TradeReceipt[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, TradeReceipt>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const cycle = item as TradeReceipt;
    if (!cycle.cycleId || byId.has(cycle.cycleId)) continue;
    byId.set(cycle.cycleId, cycle);
  }
  return [...byId.values()].sort((a, b) => timestamp(b) - timestamp(a));
}

export const archivePageCount = (count: number) => Math.max(1, Math.ceil(count / ARCHIVE_PAGE_SIZE));
export const clampArchivePage = (page: number, count: number) => Math.min(Math.max(1, page), archivePageCount(count));
export const archivePageItems = (history: TradeReceipt[], page: number) => history.slice((page - 1) * ARCHIVE_PAGE_SIZE, page * ARCHIVE_PAGE_SIZE);

export function archivePageTokens(page: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter(value => value >= 1 && value <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const tokens: PageToken[] = [];
  for (const value of sorted) {
    if (tokens.length && value - Number(tokens[tokens.length - 1]) > 1) tokens.push('ellipsis');
    tokens.push(value);
  }
  return tokens;
}
