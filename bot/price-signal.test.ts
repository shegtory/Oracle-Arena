import test from 'node:test';
import assert from 'node:assert/strict';
import { medianPrice, PRICE_SOURCES } from './price-signal.js';

test('median uses successful finite positive sources', () => {
  assert.equal(medianPrice([100, 102, 1000]), 102);
  assert.equal(medianPrice([100, Number.NaN, 102]), 101);
});
test('price aggregation fails closed below source quorum', () => {
  assert.throws(() => medianPrice([100, Number.NaN, -1]), /quorum unavailable/);
});
test('three independent provider specifications are configured', () => {
  assert.deepEqual(PRICE_SOURCES.map(({ name }) => name), ['CoinGecko', 'Binance', 'Coinbase']);
});
