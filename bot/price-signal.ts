export type PriceAsset = 'bitcoin' | 'ethereum';
export type PriceSourceName = 'CoinGecko' | 'Binance' | 'Coinbase';

export interface PriceSourceSpec {
  name: PriceSourceName;
  url: (asset: PriceAsset) => string;
  path: (asset: PriceAsset) => string;
}

const ticker = (asset: PriceAsset) => asset === 'bitcoin' ? 'BTC' : 'ETH';
export const PRICE_SOURCES: readonly PriceSourceSpec[] = [
  { name: 'CoinGecko', url: (asset) => `https://api.coingecko.com/api/v3/simple/price?ids=${asset}&vs_currencies=usd`, path: (asset) => `${asset}.usd` },
  { name: 'Binance', url: (asset) => `https://api.binance.com/api/v3/ticker/price?symbol=${ticker(asset)}USDT`, path: () => 'price' },
  { name: 'Coinbase', url: (asset) => `https://api.coinbase.com/v2/prices/${ticker(asset)}-USD/spot`, path: () => 'data.amount' },
] as const;
export const MIN_PRICE_SOURCES = 2;

export function medianPrice(values: readonly number[], minimumSources = MIN_PRICE_SOURCES): number {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (valid.length < minimumSources) throw new Error(`price quorum unavailable: ${valid.length}/${minimumSources} sources succeeded`);
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}
