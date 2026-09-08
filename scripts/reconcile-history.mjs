import { createPublicClient, defineChain, http, parseAbi } from 'viem';

const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.ankr.com/somnia_testnet'] } },
});

const moduleAbi = parseAbi([
  'function markets(bytes32 marketId) view returns (uint256 oracleQuestionId, uint8 outcomeSlotCount, uint8 voidPolicy, address collateral, uint32 originOperatorId, bytes32 originVenueId, address oracleAdapter, address creator, address market, address pool, uint256 yesId, uint256 noId, uint64 tradingStart, uint64 expiry)',
]);
const marketAbi = parseAbi([
  'function payoutNumerators() view returns (uint256[])',
  'function isResolved() view returns (bool)',
  'function isVoided() view returns (bool)',
]);

export function computeSettlement(entry, { isResolved, isVoided, payouts }, checkedAt = new Date().toISOString()) {
  if (isVoided) return { status: 'voided', checkedAt, marketOutcome: null, result: 'VOID' };
  if (!isResolved) return { status: 'pending', checkedAt, marketOutcome: null, result: null };
  let winner = 0;
  for (let index = 1; index < payouts.length; index++) if ((payouts[index] ?? 0n) > (payouts[winner] ?? 0n)) winner = index;
  const marketOutcome = winner === 0 ? 'YES' : 'NO';
  const position = entry?.riskGate?.outcome || (entry?.llmDecision?.decision === 'UP' ? 'YES' : entry?.llmDecision?.decision === 'DOWN' ? 'NO' : null);
  const result = (entry?.order?.filledShares ?? 0) > 0 && position ? (position === marketOutcome ? 'WIN' : 'LOSS') : 'SKIP';
  return { status: 'resolved', checkedAt, marketOutcome, position, result };
}

export async function reconcileHistory(history, options = {}) {
  const rpc = options.rpc || process.env.RPC_URL || 'https://rpc.ankr.com/somnia_testnet';
  const moduleAddress = options.moduleAddress || process.env.BINARY_MODULE || '0x3ecC694Cef705358864a646142ac17A90E29e388';
  const client = createPublicClient({ chain: somniaTestnet, transport: http(rpc, { timeout: 20_000 }) });
  const next = [];

  for (const entry of history) {
    const marketId = entry?.marketContext?.marketId || entry?.riskGate?.marketId;
    if (!marketId || entry?.settlement?.status === 'resolved' || entry?.settlement?.status === 'voided') {
      next.push(entry);
      continue;
    }
    try {
      const record = await client.readContract({ address: moduleAddress, abi: moduleAbi, functionName: 'markets', args: [marketId] });
      const marketAddress = record[8];
      const [isResolved, isVoided, payouts] = await Promise.all([
        client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'isResolved' }),
        client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'isVoided' }),
        client.readContract({ address: marketAddress, abi: marketAbi, functionName: 'payoutNumerators' }),
      ]);
      const settlement = computeSettlement(entry, { isResolved, isVoided, payouts });
      next.push({ ...entry, settlement });
    } catch (error) {
      next.push({ ...entry, settlement: { status: 'error', checkedAt: new Date().toISOString(), marketOutcome: null, result: null, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) } });
    }
  }
  return next;
}
