/** Oracle Arena production cycle — contract-aware inference pipeline.
 * Run from bot/: npx tsx run-cycle.ts
 *
 * Flow:
 *   price_sample_1 → trend_sampling → price_sample_2 → eth_price
 *   → discovery (scan + pick eligible BTC market) → contract_context
 *     (getMarket / getOpeningPrices / getBinaryOrderBook)
 *   → llm_inference (prompt now carries real contract data)
 *   → risk_gate → order_execution
 *
 * If discovery finds no eligible BTC market BEFORE the LLM call, the cycle
 * exits cleanly with status 'no_eligible_market' instead of calling the LLM
 * with nothing concrete to reason about.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createExchange,
  isTradable,
  loadEnv,
  shutdown,
  type MarketOnchain,
} from './lib/index.js';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  toEventSelector,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { deriveExecutionInputs, parseDecision, riskGate, type RiskPolicy } from './risk-gate.js';
import { medianPrice, MIN_PRICE_SOURCES, PRICE_SOURCES, type PriceAsset } from './price-signal.js';

const BOT_DIR = dirname(fileURLToPath(import.meta.url));
loadEnv(BOT_DIR);

export const CONFIG = {
  // Temporary third-party fallback while the Somnia-operated RPC returns 403.
  rpc: 'https://rpc.ankr.com/somnia_testnet',
  chainId: 50312,
  module: '0x3ecC694Cef705358864a646142ac17A90E29e388' as Address,
  topic: '0xb5ec75cdb7dbcd28a5f50d152d8833334525a902ef5332ebc19bcf5c0011f8cd' as Hex,
  platform: '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776' as Address,
  callback: '0x4c88a0b56E8AdBe91328fac6F9ddD1C5619B84Df' as Address,
  jsonAgent: 13174292974160097713n,
  llmAgent: 12847293847561029384n,
  committee: 3n,
  jsonPrice: parseEther('.03'),
  llmPrice: parseEther('.07'),
  trendDelayMs: Number(process.env.TREND_SAMPLE_DELAY_MS ?? 120000),
  pollMs: 2000,
  timeoutMs: 120000,
  priceSourceTimeoutMs: Number(process.env.PRICE_SOURCE_TIMEOUT_MS ?? 60000),
  scanBlocks: 6000n,
  maxCandidates: 10,
  indexerAttempts: 5,
  indexerBackoffMs: 1000,
  maxTradeTUSDC: Number(process.env.MAX_TRADE_TUSDC ?? 5),
  minTimeLeftSeconds: Number(process.env.MIN_TIME_LEFT_SECONDS ?? 15),
  minLiquidityShares: Number(process.env.MIN_LIQUIDITY_SHARES ?? 50),
  askPremium: Number(process.env.ASK_PREMIUM ?? .01),
  dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false' && process.env.DRY_RUN !== '0',
  grid: .001,
  stateFile: resolve(BOT_DIR, 'traded-markets.json'),
  receiptFile: resolve(BOT_DIR, 'last-trade-receipt.json'),
  historyFile: resolve(BOT_DIR, 'trade-history.json'),
} as const;

const RISK_POLICY: RiskPolicy = {
  maxTradeTUSDC: CONFIG.maxTradeTUSDC,
  minTimeLeftSeconds: CONFIG.minTimeLeftSeconds,
  minLiquidityShares: CONFIG.minLiquidityShares,
  askPremium: CONFIG.askPremium,
  grid: CONFIG.grid,
};

/** Contract-specific data used for inference. Captured for the receipt. */
export interface MarketContext {
  marketId: Hex;
  asset: string;
  question: string | null;
  strike: number;
  strikeRaw: string;
  openingPrice: number | null;
  openingPriceRaw: string | null;
  bestYesAsk: number;
  bestNoAsk: number;
  mid: number;
  tradingStart: number;
  expiry: number;
  secondsLeft: number;
  timeLeft: number;
  intervalSec: number | undefined;
  status: number;
  yesAsks: Array<[number, number]>;
  noAsks: Array<[number, number]>;
}

const platformAbi = parseAbi([
  'function createRequest(uint256,address,bytes4,bytes) payable returns(uint256)',
  'function getRequestDeposit() view returns(uint256)',
]);
const createdAbi = parseAbi([
  'event RequestCreated(uint256 indexed requestId,uint256 indexed agentId,uint256 perAgentBudget,bytes payload,address[] subcommittee)',
]);
const fetchAbi = parseAbi([
  'function fetchUint(string,string,uint8) returns(uint256)',
]);
const inferAbi = parseAbi([
  'function inferString(string,string,bool,string[]) returns(string)',
]);
const callbackAbi = JSON.parse(
  readFileSync(resolve(BOT_DIR, '..', 'contracts', 'abi', 'AgentCallbackV2.json'), 'utf8'),
) as any[];
const callbackEvents = parseAbi([
  'event ResponseReceived(uint256 requestId,uint8 status,bytes result)',
  'event DecisionReceived(uint256 requestId,uint8 status,string decision)',
]);
const binaryModuleReadAbi = parseAbi([
  'function markets(bytes32 marketId) view returns (uint256 oracleQuestionId, uint8 outcomeSlotCount, uint8 voidPolicy, address collateral, uint32 originOperatorId, bytes32 originVenueId, address oracleAdapter, address creator, address market, address pool, uint256 yesId, uint256 noId, uint64 tradingStart, uint64 expiry)',
  'function marketNonce(bytes32 marketId) view returns (uint64 nonce)',
]);
const binaryModuleEventsAbi = parseAbi([
  'event MarketCreated(bytes32 indexed marketId,address indexed market,address indexed pool,uint256 oracleQuestionId,uint32 operatorId,bytes32 venueId,address creator,address collateral,uint256 yesId,uint256 noId,uint64 nonce,uint8 outcomeSlotCount,uint8 marketType,uint64 tradingStart,uint64 expiry,uint8 voidPolicy,string asset,uint256 strike,string question,bytes context)',
]);
const binaryMarketReadAbi = parseAbi([
  'function outcomeToken() view returns (address)',
  'function status() view returns (uint8)',
  'function backing() view returns (uint256)',
  'function payoutNumerators() view returns (uint256[])',
  'function isResolved() view returns (bool)',
  'function isVoided() view returns (bool)',
]);
const binaryPoolReadAbi = parseAbi([
  'function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])',
]);
const erc20ReadAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const binaryPoolWriteAbi = parseAbi([
  'function placeBinaryOrder(uint8 kind,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k,uint64 userData) payable returns (bool success,uint128 id)',
]);
const orderEventsAbi = parseAbi([
  'event OrderPlaced(uint128 indexed orderId,(uint128 orderId,bool isBid,address owner,uint64 userData,uint256 price,uint256 fullQuantity,uint256 quantityRemaining,uint64 expireTimestampNs) placedOrder)',
  'event OrderFilled(uint128 indexed takerOrderId,uint128 indexed makerOrderId,uint256 quantityFilled,uint256 takerRemainingQuantity,uint256 makerRemainingQuantity,uint256 fillPrice)',
]);
const callbackSelector = (name: 'handleResponse' | 'handleLlmResponse') =>
  toFunctionSelector(callbackAbi.find((x) => x.type === 'function' && x.name === name));
const sleep = (n: number) => new Promise<void>((r) => setTimeout(r, n));
const nowIso = () => new Date().toISOString();

function loadTraded() {
  try { return new Set<string>(JSON.parse(readFileSync(CONFIG.stateFile, 'utf8'))); }
  catch { return new Set<string>(); }
}
function saveTraded(s: Set<string>) {
  writeFileSync(CONFIG.stateFile, JSON.stringify([...s], null, 2));
}

/**
 * Compute executable liquidity on a chosen side — the shares resting at or
 * below the intended limit price. Used by both the risk gate and the receipt.
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); }
  catch { return String(e); }
}

function assetFromMarket(row: any): string | null {
  const indexed = typeof row?.asset === 'string' ? row.asset.toUpperCase() : null;
  if (indexed === 'BTC' || indexed === 'BITCOIN') return 'BTC';
  if (indexed === 'ETH' || indexed === 'ETHEREUM') return 'ETH';
  const q = typeof row?.question === 'string' ? row.question : '';
  if (/\b(?:BTC|BITCOIN)\b/i.test(q)) return 'BTC';
  if (/\b(?:ETH|ETHEREUM)\b/i.test(q)) return 'ETH';
  return indexed;
}

function metadataFromCreationLog(log: any) {
  const decoded = decodeEventLog({
    abi: binaryModuleEventsAbi,
    data: log.data,
    topics: log.topics,
    strict: true,
  }) as any;
  const args = decoded.args;
  const question = String(args.question ?? '');
  const assetMatch = question.match(/\b(BTC|ETH)\b/i);
  const strikeMatch = question.match(/\bat\s+or\s+above\s+\$?([0-9]+(?:\.[0-9]+)?)/i);
  const asset = assetMatch?.[1]?.toUpperCase() ?? (String(args.asset ?? '').toUpperCase() || null);
  const strike = strikeMatch ? Number(strikeMatch[1]) : null;
  return {
    marketId: String(args.marketId).toLowerCase() as Hex,
    asset,
    strike,
    strikeRaw: args.strike == null ? null : String(args.strike),
    question,
    intervalSec: Number(args.expiry) - Number(args.tradingStart),
    tradingStart: Number(args.tradingStart),
    expiry: Number(args.expiry),
  };
}

/** Market oracle values use asset-dependent decimal scales; infer the power
 * of ten that places the raw value nearest the live spot price. */
function scaleOraclePrice(rawValue: string | null, spot: number): number | null {
  if (rawValue == null || !(spot > 0)) return null;
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw < 0) return null;
  if (raw === 0) return 0;
  let best: number | null = null;
  let bestErr = Infinity;
  for (let exp = 0; exp <= 18; exp++) {
    const candidate = raw / 10 ** exp;
    const err = Math.abs(Math.log(candidate / spot));
    if (err < bestErr) {
      bestErr = err;
      best = candidate;
    }
  }
  return bestErr <= Math.log(2) ? best : null;
}

export async function runCycle() {
  loadEnv(BOT_DIR);
  process.env.NETWORK = 'testnet';
  process.env.CHAIN_ID = '50312';
  process.env.RPC_URL = CONFIG.rpc;
  const key = process.env.PRIVATE_KEY as Hex | undefined;
  if (!key) throw Error('PRIVATE_KEY missing from bot/.env');
  const account = privateKeyToAccount(key);
  const chain = defineChain({
    id: 50312,
    name: 'Somnia Testnet',
    nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
    rpcUrls: { default: { http: [CONFIG.rpc] } },
  });
  // The cycle uses dynamic ABI selections across several contracts. Keep the
  // strongly typed domain objects above this low-level RPC boundary.
  const pub: any = createPublicClient({ chain, transport: http(CONFIG.rpc) });
  // Dedicated market reader. Explicitly disable viem's eth_call aggregation:
  // Ankr accepts the individual reads, while the SDK-managed path failed.
  const marketPub: any = createPublicClient({
    batch: { multicall: false },
    chain,
    transport: http(CONFIG.rpc),
  });
  const wallet: any = createWalletClient({
    account,
    chain,
    transport: http(CONFIG.rpc),
  });
  const ctx = createExchange({ withSigner: true });
  // createExchange's public setSigner surface intentionally omits publicClient,
  // but the underlying SDK trader supports both injected clients. Install an
  // HTTP/Ankr trader so placeLimit keeps ec-core's conversions + safeguards
  // while avoiding the SDK's Somnia-WebSocket-only send path.
  /** Exact equivalent of ec-core placeLimit's conversion + SDK submission,
   * excluding its assertFunded preflight (which is hard-wired to the SDK's
   * WebSocket client). Writes and receipt polling both use unbatched Ankr HTTP. */
  async function placeLimitViaAnkr(args: {
    onchain: MarketOnchain;
    outcome: 'YES' | 'NO';
    price: number;
    size: number;
    expiresInSec: number;
  }) {
    const one = 10n ** BigInt(ctx.config.decimals);
    const toSteps = (human: number, step: bigint, mode: 'round' | 'floor') => {
      const n = human * Number(one / step);
      const steps = mode === 'round' ? Math.round(n) : Math.floor(n + 1e-9);
      return BigInt(Math.max(0, steps)) * step;
    };
    const quantity = toSteps(args.size, ctx.config.lot, 'floor');
    const priceOwn = toSteps(args.price, ctx.config.tick, 'round');
    if (quantity <= 0n) throw Error('order size rounds below one lot');
    if (priceOwn <= 0n || priceOwn >= one)
      throw Error(`price ${args.price} is outside (0, 1) after tick snapping`);

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = Math.min(nowSec + args.expiresInSec, Number(args.onchain.expiry));
    if (expiresAt <= nowSec) throw Error('market expired before order submission');
    const priceYes = args.outcome === 'YES' ? priceOwn : one - priceOwn;
    const hash = await wallet.writeContract({
      address: args.onchain.pool,
      abi: binaryPoolWriteAbi,
      functionName: 'placeBinaryOrder',
      args: [
        args.outcome === 'YES' ? 0 : 2,
        priceYes,
        quantity,
        BigInt(expiresAt) * 1_000_000_000n,
        2, // SDK ORDER_TYPE.MARKET: IOC semantics at the supplied limit.
        0,
        '0x0000000000000000000000000000000000000000',
        0n,
        0n,
      ],
    });
    const receipt = await marketPub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw Error(`order transaction ${hash} reverted on-chain`);
    let orderId: bigint | undefined;
    const fills: any[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== args.onchain.pool.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: orderEventsAbi, data: log.data, topics: log.topics }) as any;
        if (decoded.eventName === 'OrderPlaced') orderId = decoded.args.orderId;
        if (decoded.eventName === 'OrderFilled') fills.push(decoded.args);
      } catch { /* unrelated pool event */ }
    }
    const filledRaw = fills.reduce((sum, fill) => sum + BigInt(fill.quantityFilled), 0n);
    return {
      hash,
      receipt,
      orderId,
      rested: orderId !== undefined && filledRaw < quantity,
      filled: Number(filledRaw) / Number(one),
      size: Number(quantity) / Number(one),
      price: Number(priceOwn) / Number(one),
      fills,
    };
  }

  async function ensureAllowance(onchain: MarketOnchain, requiredHumanCost: number) {
    const one = 10n ** BigInt(ctx.config.decimals);
    const requiredCollateral = BigInt(Math.ceil(requiredHumanCost * Number(one)));
    const allowance = await marketPub.readContract({
      address: onchain.collateral,
      abi: erc20ReadAbi,
      functionName: 'allowance',
      args: [account.address, onchain.pool],
      blockTag: 'latest',
    });
    if (allowance >= requiredCollateral) return;
    const approvalHash = await wallet.writeContract({
      address: onchain.collateral,
      abi: erc20ReadAbi,
      functionName: 'approve',
      args: [onchain.pool, (1n << 256n) - 1n],
    });
    const approvalReceipt = await marketPub.waitForTransactionReceipt({ hash: approvalHash });
    if (approvalReceipt.status !== 'success') throw Error(`collateral approval ${approvalHash} reverted on-chain`);
  }

  const out: any = {
    schemaVersion: 2,
    cycleId: crypto.randomUUID(),
    startedAt: nowIso(),
    currentStage: 'initializing',
    stageStartedAt: nowIso(),
    network: { chainId: 50312, name: 'Somnia Testnet', rpc: CONFIG.rpc },
    agents: {
      jsonApiAgentId: CONFIG.jsonAgent.toString(),
      llmInferenceAgentId: CONFIG.llmAgent.toString(),
      callbackAddress: CONFIG.callback,
      platformAddress: CONFIG.platform,
    },
    discovery: null,
    priceSignal: null,
    marketContext: null, // NEW — contract data the LLM saw
    llmDecision: null,
    riskGate: null,
    order: null,
    error: null,
  };
  const persist = () => writeFileSync(CONFIG.receiptFile, JSON.stringify(out, null, 2));
  const stage = (name: string) => {
    out.currentStage = name;
    out.stageStartedAt = nowIso();
    persist();
  };
  persist();

  try {
    async function readMarketOnchainDirect(marketId: Hex): Promise<MarketOnchain> {
      const rec = await marketPub.readContract({
        address: CONFIG.module,
        abi: binaryModuleReadAbi,
        functionName: 'markets',
        args: [marketId],
        blockTag: 'latest',
      });
      const collateral = rec[3];
      const marketAddress = rec[8];
      const pool = rec[9];
      const yesId = rec[10];
      const noId = rec[11];
      const expiry = rec[13];
      if (/^0x0{40}$/i.test(marketAddress)) throw Error(`unknown marketId ${marketId}`);

      // Promise.all still emits separate eth_call requests because multicall is disabled.
      const [nonce, outcomeToken, status, backing, payoutNumerators, isResolved, isVoided, decimals] =
        await Promise.all([
          marketPub.readContract({ address: CONFIG.module, abi: binaryModuleReadAbi, functionName: 'marketNonce', args: [marketId], blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'outcomeToken', blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'status', blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'backing', blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'payoutNumerators', blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'isResolved', blockTag: 'latest' }),
          marketPub.readContract({ address: marketAddress, abi: binaryMarketReadAbi, functionName: 'isVoided', blockTag: 'latest' }),
          marketPub.readContract({ address: collateral, abi: erc20ReadAbi, functionName: 'decimals', blockTag: 'latest' }).catch(() => 6),
        ]);
      let winningOutcome = 0;
      for (let i = 1; i < payoutNumerators.length; i++)
        if ((payoutNumerators[i] ?? 0n) > (payoutNumerators[winningOutcome] ?? 0n)) winningOutcome = i;
      return {
        marketAddress,
        outcomeToken,
        yesId,
        noId,
        pool,
        nonce,
        collateral,
        status: Number(status),
        backing,
        finalized: false,
        expiry,
        decimals: Number(decimals),
        winningOutcome,
        isResolved,
        isVoided,
        tradingStart: Number(rec[12]),
      } as MarketOnchain & { tradingStart: number };
    }

    async function readBinaryOrderBookDirect(pool: Address, depth = 10) {
      const [yesBids, yesAsks] = await Promise.all([
        marketPub.readContract({ address: pool, abi: binaryPoolReadAbi, functionName: 'getBookLevels', args: [true, BigInt(depth)], blockTag: 'latest' }),
        marketPub.readContract({ address: pool, abi: binaryPoolReadAbi, functionName: 'getBookLevels', args: [false, BigInt(depth)], blockTag: 'latest' }),
      ]);
      const oneBase = 1_000_000n;
      const noBids = yesAsks.map((x) => ({ price: oneBase - x.price, quantity: x.quantity }))
        .sort((a, b) => a.price > b.price ? -1 : 1);
      const noAsks = yesBids.map((x) => ({ price: oneBase - x.price, quantity: x.quantity }))
        .sort((a, b) => a.price > b.price ? 1 : -1);
      return { yesBids: [...yesBids], yesAsks: [...yesAsks], noBids, noAsks };
    }

    const normalizeLevels = (levels: any[]): Array<[number, number]> => (levels ?? []).map((entry: any) => {
      const price = Array.isArray(entry) ? entry[0] : (entry.price ?? 0n);
      const quantity = Array.isArray(entry) ? entry[1] : (entry.quantity ?? 0n);
      return [Number(price) / 1e6, Number(quantity) / 1e6];
    });

    /** A new on-chain market and order-book read for each safety boundary. */
    async function freshExecutionSnapshot(marketId: Hex, decision: ReturnType<typeof parseDecision>) {
      const onchain = await readMarketOnchainDirect(marketId);
      const book = await readBinaryOrderBookDirect(onchain.pool, 10);
      const execution = deriveExecutionInputs(
        decision,
        Number(onchain.expiry),
        normalizeLevels(book.yesAsks),
        normalizeLevels(book.noAsks),
        RISK_POLICY,
        Date.now(),
      );
      return { onchain, book, execution, checkedAt: nowIso() };
    }

    const floor = await pub.readContract({
      address: CONFIG.platform,
      abi: platformAbi,
      functionName: 'getRequestDeposit',
    });

    async function request(
      agent: bigint,
      payload: Hex,
      price: bigint,
      kind: 'price' | 'decision',
      timeoutMs: number = CONFIG.timeoutMs,
    ) {
      const value = floor + price * CONFIG.committee;
      const selector = callbackSelector(
        kind === 'price' ? 'handleResponse' : 'handleLlmResponse',
      );
      const hash = await wallet.writeContract({
        address: CONFIG.platform,
        abi: platformAbi,
        functionName: 'createRequest',
        args: [agent, CONFIG.callback, selector, payload],
        value,
        account,
      });
      const tx = await pub.waitForTransactionReceipt({ hash });
      if (tx.status !== 'success') throw Error(`agent tx reverted ${hash}`);
      const topic = toEventSelector(createdAbi[0]);
      const log = tx.logs.find(
        (x: any) =>
          x.address.toLowerCase() === CONFIG.platform.toLowerCase() &&
          x.topics[0] === topic,
      );
      if (!log) throw Error(`RequestCreated missing ${hash}`);
      const id = BigInt(
        (decodeEventLog({ abi: createdAbi, data: log.data, topics: log.topics }) as any).args.requestId,
      );
      const event = kind === 'price' ? callbackEvents[0] : callbackEvents[1];
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const logs = await pub.getLogs({
          address: CONFIG.callback,
          event: event as any,
          fromBlock: tx.blockNumber,
          toBlock: 'latest',
          strict: true,
        });
        const hit = logs.find(
          (x: any) => BigInt(x.args.requestId) === id,
        ) as any;
        if (hit) {
          if (Number(hit.args.status) !== 2)
            throw Error(`callback request ${id} status ${hit.args.status}`);
          if (kind === 'price') {
            const raw = decodeAbiParameters([{ type: 'uint256' }], hit.args.result as Hex)[0];
            return { id, hash, value, result: raw };
          }
          const result = String(hit.args.decision);
          return { id, hash, value, result };
        }
        await sleep(CONFIG.pollMs);
      }
      throw Error(`callback request ${id} timed out`);
    }

    async function sample(asset: PriceAsset) {
      const sources: any[] = [];
      // Wallet-backed requests stay sequential to avoid nonce races.
      for (const source of PRICE_SOURCES) {
        try {
          const payload = encodeFunctionData({ abi: fetchAbi, functionName: 'fetchUint', args: [source.url(asset), source.path(asset), 8] });
          const response = await request(CONFIG.jsonAgent, payload, CONFIG.jsonPrice, 'price', CONFIG.priceSourceTimeoutMs);
          const raw = response.result as bigint;
          const usd = Number(raw) / 1e8;
          if (!Number.isFinite(usd) || usd <= 0) throw Error(`${source.name} returned an invalid price`);
          sources.push({ source: source.name, ok: true, requestId: response.id.toString(), txHash: response.hash, valueWei: response.value.toString(), raw: raw.toString(), usd, receivedAt: nowIso() });
        } catch (error) {
          sources.push({ source: source.name, ok: false, error: errorMessage(error).slice(0, 300), receivedAt: nowIso() });
        }
      }
      const successful = sources.filter((source) => source.ok);
      const usd = medianPrice(successful.map((source) => source.usd), MIN_PRICE_SOURCES);
      const representative = successful.reduce((closest, source) => Math.abs(source.usd - usd) < Math.abs(closest.usd - usd) ? source : closest);
      return {
        asset: asset === 'bitcoin' ? 'BTC' : 'ETH',
        method: 'multi-source median',
        minimumSources: MIN_PRICE_SOURCES,
        successfulSources: successful.length,
        sources,
        requestId: representative.requestId,
        txHash: representative.txHash,
        valueWei: representative.valueWei,
        raw: representative.raw,
        usd,
        receivedAt: nowIso(),
      };
    }

    // ---- Stage 1-4: price sampling (unchanged) ----
    stage('price_sample_1');
    const first = await sample('bitcoin');
    stage('trend_sampling');
    await sleep(CONFIG.trendDelayMs);
    stage('price_sample_2');
    const current = await sample('bitcoin');
    const pct = (current.usd - first.usd) / first.usd * 100;
    const trend = pct > 0 ? 'UP' : pct < 0 ? 'DOWN' : 'FLAT';
    stage('eth_price');
    const eth = await sample('ethereum');
    out.priceSignal = {
      method: `median of at least ${MIN_PRICE_SOURCES}/${PRICE_SOURCES.length} on-chain JSON Agent sources per observation`,
      sampleDelayMs: CONFIG.trendDelayMs,
      first,
      current,
      eth,
      changePct: pct,
      trend,
    };
    persist();

    // ---- Stage 5: discovery — moved BEFORE LLM (item 1) ----
    stage('discovery');
    async function scanMarkets() {
      const head = await pub.getBlockNumber();
      const from =
        head >= CONFIG.scanBlocks - 1n
          ? head - (CONFIG.scanBlocks - 1n)
          : 0n;
      const ranges: { from: bigint; to: bigint }[] = [];
      for (let start = from; start <= head; start += 1000n)
        ranges.push({
          from: start,
          to: start + 999n < head ? start + 999n : head,
        });
      const chunks = await Promise.all(
        ranges.map((r) =>
          pub.request({
            method: 'eth_getLogs',
            params: [
              {
                address: CONFIG.module,
                topics: [CONFIG.topic],
                fromBlock: `0x${r.from.toString(16)}`,
                toBlock: `0x${r.to.toString(16)}`,
              },
            ],
          }),
        ),
      );
      const logs = chunks.flat();
      logs.sort(
        (a: any, b: any) =>
          Number(BigInt(b.blockNumber ?? 0) - BigInt(a.blockNumber ?? 0)) ||
          Number(BigInt(b.logIndex ?? 0) - BigInt(a.logIndex ?? 0)),
      );
      const creationById = new Map<string, ReturnType<typeof metadataFromCreationLog>>();
      for (const log of logs) {
        try {
          const metadata = metadataFromCreationLog(log);
          if (!creationById.has(metadata.marketId)) creationById.set(metadata.marketId, metadata);
        } catch { /* ignore malformed/non-matching logs */ }
      }
      const ids = [...creationById.keys()].slice(0, CONFIG.maxCandidates) as Hex[];
      return { head, from, ids, creationById, chunkCount: ranges.length };
    }

    let scanned = await scanMarkets();
    let scanAttempts = 1;
    if (!scanned.ids.length) {
      await sleep(3000);
      scanned = await scanMarkets();
      scanAttempts = 2;
    }
    const { head, from, ids } = scanned;
    const checked: any[] = [];
    const eligible: Array<{ id: Hex; m: MarketOnchain; row: any; asset: string; secondsLeft: number; checkedIndex: number }> = [];
    let chosen: ({ id: Hex; m: MarketOnchain; row: any; asset: string; rawBook: any; yesAsks: Array<[number, number]>; noAsks: Array<[number, number]> }) | undefined;

    for (const id of ids) {
      let m: MarketOnchain | null = null;
      const eventMeta = scanned.creationById.get(id.toLowerCase()) ?? null;
      const row: any = eventMeta && {
        marketType: 'BINARY',
        asset: eventMeta.asset,
        question: eventMeta.question,
        strike: eventMeta.strike == null ? eventMeta.strikeRaw : String(eventMeta.strike),
        strikeRaw: eventMeta.strikeRaw,
        intervalSec: eventMeta.intervalSec,
      };
      let lastErr = '';
      try {
        m = await readMarketOnchainDirect(id);
      } catch (e) {
        lastErr = `on-chain read: ${errorMessage(e)}`;
      }
      if (!m || !row) {
        checked.push({
          marketId: id,
          asset: null,
          status: -1,
          isTradable: false,
          secondsLeft: -1,
          metadataSource: eventMeta ? 'MarketCreated event' : null,
          error: lastErr.slice(0, 500) || 'MarketCreated metadata unavailable',
        });
        continue;
      }
      if (m.status !== 1) continue; // not Trading — skip silently
      if (!isTradable(m)) continue;

      // Resolve the asset label. The indexer normally carries it; when it is
      // null (lag or a partial 403 response) fall back to scanning the
      // question text for the underlying asset keyword.
      const asset = assetFromMarket(row);
      const left = Number(m.expiry) - Math.floor(Date.now() / 1000);
      checked.push({
        marketId: id,
        asset,
        status: Number(m.status),
        isTradable: isTradable(m),
        secondsLeft: left,
        question: row.question,
        strike: row.strike,
        metadataSource: 'MarketCreated event',
        error: null,
      });
      if (asset === 'BTC' && left > CONFIG.minTimeLeftSeconds)
        eligible.push({ id, m, row, asset, secondsLeft: left, checkedIndex: checked.length - 1 });
    }

    // Prefer markets with more remaining time, then require executable liquidity.
    // Each raw contract response is retained in the receipt so an empty book can
    // be distinguished from an RPC/ABI failure after the run.
    eligible.sort((a, b) => b.secondsLeft - a.secondsLeft);
    for (const candidate of eligible) {
      const candidateLog = checked[candidate.checkedIndex];
      try {
        const rawBook = await readBinaryOrderBookDirect(candidate.m.pool, 10);
        const serializeLevels = (levels: any[]) => (levels ?? []).map((entry: any) => {
          const price = Array.isArray(entry) ? entry[0] : (entry.price ?? 0n);
          const quantity = Array.isArray(entry) ? entry[1] : (entry.quantity ?? 0n);
          return { price: String(price), quantity: String(quantity) };
        });
        const yesAsks = normalizeLevels(rawBook.yesAsks);
        const noAsks = normalizeLevels(rawBook.noAsks);
        candidateLog.orderBook = {
          source: 'getBookLevels',
          rawYesBids: serializeLevels(rawBook.yesBids),
          rawYesAsks: serializeLevels(rawBook.yesAsks),
          derivedNoAsks: serializeLevels(rawBook.noAsks),
          usableYesAsk: yesAsks[0]?.[0] ?? null,
          usableNoAsk: noAsks[0]?.[0] ?? null,
          error: null,
        };
        if (!chosen && (yesAsks[0]?.[0] ?? 0) > 0 && (noAsks[0]?.[0] ?? 0) > 0)
          chosen = { ...candidate, rawBook, yesAsks, noAsks };
      } catch (error) {
        candidateLog.orderBook = {
          source: 'getBookLevels',
          rawYesBids: null,
          rawYesAsks: null,
          derivedNoAsks: null,
          usableYesAsk: null,
          usableNoAsk: null,
          error: errorMessage(error).slice(0, 500),
        };
      }
    }

    out.discovery = {
      head: head.toString(),
      fromBlock: from.toString(),
      scanBlocks: CONFIG.scanBlocks.toString(),
      scanChunks: scanned.chunkCount,
      scanAttempts,
      maxCandidates: CONFIG.maxCandidates,
      metadataSource: 'on-chain MarketCreated event',
      candidates: checked,
    };

    // Item 4: if no eligible market, skip the cycle cleanly BEFORE calling the LLM.
    if (!chosen) {
      const reason = eligible.length
        ? `no executable YES/NO liquidity across ${eligible.length} eligible BTC market candidate(s)`
        : `no eligible live BTC market among ${ids.length} on-chain MarketCreated candidates`;
      out.llmDecision = {
        skipped: true,
        reason,
      };
      out.order = { status: 'skipped', reason };
      out.currentStage = 'no_eligible_market';
      out.finishedAt = nowIso();
      persist();
      return out;
    }

    // ---- Stage 6: contract_context — fetch real contract data (item 2) ----
    stage('contract_context');
    const mOnchain = chosen.m;
    const mRow = chosen.row;
    const pool = mOnchain.pool;
    const secondsLeft = Number(mOnchain.expiry) - Math.floor(Date.now() / 1000);
    const asset = chosen.asset;

    // Reuse the book snapshot that made this candidate eligible, keeping market
    // selection and the eventual executable context internally consistent.
    const rawBook = chosen.rawBook;
    const yesAsks = chosen.yesAsks;
    const noAsks = chosen.noAsks;
    const bestYesAsk = yesAsks[0]?.[0] ?? 0;
    const bestNoAsk = noAsks[0]?.[0] ?? 0;
    const mid = (bestYesAsk + bestNoAsk) > 0
      ? (bestYesAsk + bestNoAsk) / 2
      : 0;

    // Opening price (reference-question oracle answer)
    let openingPriceRaw: string | null = null;
    try {
      const opens = await ctx.exchange.client.getOpeningPrices([chosen.id]);
      openingPriceRaw = opens[chosen.id.toLowerCase()] ?? null;
    } catch (e) {
      out.discovery.openingPriceError = errorMessage(e);
      openingPriceRaw = null;
    }

    const strikeRaw = mRow?.strikeRaw == null ? null : String(mRow.strikeRaw);
    // The question regex yields an already-human USD value; raw event strike is
    // retained separately for auditability.
    const strike = mRow?.strike == null ? null : Number(mRow.strike);
    const openingPrice = scaleOraclePrice(openingPriceRaw, current.usd);
    const contextProblems: string[] = [];
    if (strike === null) contextProblems.push('strike unavailable or implausibly scaled');
    if (!(bestYesAsk > 0)) contextProblems.push('YES ask unavailable');
    if (!(bestNoAsk > 0)) contextProblems.push('NO ask unavailable');
    if (contextProblems.length) {
      out.llmDecision = {
        skipped: true,
        reason: `incomplete contract context: ${contextProblems.join(', ')}`,
      };
      out.order = { status: 'skipped', reason: out.llmDecision.reason };
      out.currentStage = 'incomplete_market_context';
      out.finishedAt = nowIso();
      persist();
      return out;
    }

    // Build marketContext — persisted into the receipt (item 5)
    const marketContext: MarketContext = {
      marketId: chosen.id,
      asset,
      question: typeof mRow?.question === 'string' ? mRow.question : null,
      strike: strike!,
      strikeRaw: strikeRaw!,
      openingPrice,
      openingPriceRaw,
      bestYesAsk,
      bestNoAsk,
      mid,
      tradingStart: Number((mOnchain as any).tradingStart ?? 0),
      expiry: Number(mOnchain.expiry),
      secondsLeft,
      timeLeft: secondsLeft,
      intervalSec: mRow && mRow.intervalSec ? Number(mRow.intervalSec) : undefined,
      status: Number(mOnchain.status),
      yesAsks,
      noAsks,
    };
    out.marketContext = marketContext;
    persist();

    // ---- Stage 7: llm_inference — contract-aware prompt (item 3) ----
    stage('llm_inference');

    const pctFormatted = pct.toFixed(4);
    const trendDelaySec = (CONFIG.trendDelayMs / 1000).toFixed(0);
    const firstUsd = first.usd.toFixed(2);
    const currentUsd = current.usd.toFixed(2);
    const strikeDisplay = `$${marketContext.strike.toFixed(2)}`;
    const openingLine = marketContext.openingPrice == null
      ? ''
      : `Opening price (reference oracle): $${marketContext.openingPrice.toFixed(2)}\n`;
    const intervalLabel = marketContext.intervalSec
      ? `${marketContext.intervalSec}s (${Math.floor(marketContext.intervalSec / 60)}m)`
      : 'unknown cadence';
    const timeLeftLabel = `${marketContext.secondsLeft}s`;
    const bestYesDisplay = marketContext.bestYesAsk.toFixed(4);
    const bestNoDisplay = marketContext.bestNoAsk.toFixed(4);
    const midDisplay = marketContext.mid.toFixed(4);

    // Determine the directional read: is spot trending toward or away from strike?
    let strikeRelation = 'unknown';
    if (Number.isFinite(marketContext.strike)) {
      const strike = marketContext.strike;
      if (current.usd > strike && trend === 'UP') strikeRelation = 'above_strike_rising';
      else if (current.usd > strike && trend === 'DOWN') strikeRelation = 'above_strike_falling';
      else if (current.usd < strike && trend === 'DOWN') strikeRelation = 'below_strike_falling';
      else if (current.usd < strike && trend === 'UP') strikeRelation = 'below_strike_rising';
      else if (current.usd === strike) strikeRelation = 'at_strike';
    }

    const prompt = `You are a conservative crypto signal agent for a binary event contract.
You must output ONLY valid JSON: {"decision":"UP|DOWN|SKIP","reasoning":"one sentence","confidence":"low|medium|high"}

=== MARKET CONTEXT (the specific contract you would trade) ===
Asset:              ${marketContext.asset}
Market ID:          ${marketContext.marketId}
Strike (resolve against): ${strikeDisplay}
${openingLine}Current BTC/USD spot: ${currentUsd}  (moved from ${firstUsd} in ${trendDelaySec}s, ${pctFormatted}%, trend ${trend})
Best YES ask:       ${bestYesDisplay}   (prob of YES ≈ ${(marketContext.bestYesAsk * 100).toFixed(2)}%)
Best NO ask:        ${bestNoDisplay}   (prob of NO ≈ ${(marketContext.bestNoAsk * 100).toFixed(2)}%)
Mid probability:    ${midDisplay}
Time left until expiry: ${timeLeftLabel}
Cadence:            ${intervalLabel}
Status:             ${marketContext.status === 1 ? 'Trading' : 'other'}

=== WHAT THE DECISION MEANS ===
- UP = buy YES  (bet the event happens / price closes at-or-above strike)
- DOWN = buy NO  (bet the event does not happen / price closes below strike)
- SKIP = no trade this cycle

=== REASONING GUIDANCE ===
Think relative to THIS contract's strike${marketContext.openingPrice == null ? '' : ' and opening price'}, not generic momentum.
Ask yourself:
  1. Is the current spot price above or below the strike, and is it trending toward or away from it?
  2. Does the current spot price, projected forward over the time left, plausibly cross the strike?
  3. Does the order-book implied probability (YES ask / NO ask) agree or disagree with the spot trend?
  4. Is there enough time left for the trend to resolve, or is expiry too close?
  5. Is the evidence weak or conflicting — if so, SKIP.

Strike relation (spot vs strike, trend direction): ${strikeRelation}

{{"decision":"UP|DOWN|SKIP","reasoning":"...","confidence":"low|medium|high"}}`;

    // Log the exact prompt sent (item 6 verification)
    console.error('[LLM PROMPT]');
    console.error(prompt);

    const payload = encodeFunctionData({
      abi: inferAbi,
      functionName: 'inferString',
      args: [prompt, 'Conservative crypto signal agent. Use only supplied data. Valid JSON only.', false, []],
    });
    const lr = await request(CONFIG.llmAgent, payload, CONFIG.llmPrice, 'decision');
    const text = String(lr.result);
    const decision = parseDecision(text);

    out.llmDecision = {
      requestId: lr.id.toString(),
      txHash: lr.hash,
      valueWei: lr.value.toString(),
      raw: text,
      ...decision,
      receivedAt: nowIso(),
      promptSent: prompt, // full prompt captured for transparency
    };
    persist();

    // ---- Stage 8: risk_gate — discard the pre-inference market/book snapshot ----
    stage('risk_gate');
    const traded = loadTraded();
    let fresh = await freshExecutionSnapshot(chosen.id, decision);
    let risk = riskGate({
      decision,
      marketId: chosen.id,
      marketStatus: Number(fresh.onchain.status),
      ...fresh.execution,
      tradedMarketIds: traded,
      policy: RISK_POLICY,
    });

    out.riskGate = {
      ...risk,
      checkedAt: fresh.checkedAt,
      marketId: chosen.id,
      pool: fresh.onchain.pool,
      marketStatus: Number(fresh.onchain.status),
      tradingStart: Number((fresh.onchain as any).tradingStart ?? 0),
      expiry: Number(fresh.onchain.expiry),
      windowSeconds: Number(fresh.onchain.expiry) - Number((fresh.onchain as any).tradingStart ?? fresh.onchain.expiry),
      ...fresh.execution,
      validationCount: 1,
    };
    if (!risk.allowed) {
      out.order = { status: 'skipped', reason: risk.reason };
      return out;
    }

    if (CONFIG.dryRun) {
      out.order = { status: 'skipped', reason: 'dry run: execution disabled by configuration' };
      return out;
    }

    // ---- Stage 9: order execution through the injected Ankr trader ----
    stage('order_execution');
    await ensureAllowance(fresh.onchain, fresh.execution.maxCostTUSDC);
    // Revalidate once more immediately before the wallet write. This prevents
    // approval latency or any earlier processing from making the gate stale.
    fresh = await freshExecutionSnapshot(chosen.id, decision);
    risk = riskGate({
      decision,
      marketId: chosen.id,
      marketStatus: Number(fresh.onchain.status),
      ...fresh.execution,
      tradedMarketIds: loadTraded(),
      policy: RISK_POLICY,
    });
    out.riskGate = {
      ...out.riskGate,
      ...risk,
      revalidatedAt: fresh.checkedAt,
      pool: fresh.onchain.pool,
      marketStatus: Number(fresh.onchain.status),
      expiry: Number(fresh.onchain.expiry),
      ...fresh.execution,
      validationCount: 2,
    };
    persist();
    if (!risk.allowed) {
      out.order = { status: 'skipped', reason: `pre-submit revalidation: ${risk.reason}` };
      return out;
    }
    const expiresInSec = Math.min(10, fresh.execution.secondsLeft - 1);
    const placed = await placeLimitViaAnkr({
      onchain: fresh.onchain,
      outcome: fresh.execution.outcome,
      price: fresh.execution.limitPrice,
      size: fresh.execution.sizeShares,
      expiresInSec,
    });
    // Independent confirmation read: do not rely solely on the writer's return.
    const confirmed = await marketPub.getTransactionReceipt({ hash: placed.hash });
    out.order = {
      status: 'confirmed',
      submittedAt: nowIso(),
      txHash: placed.hash,
      receiptStatus: confirmed.status,
      blockNumber: confirmed.blockNumber.toString(),
      gasUsed: confirmed.gasUsed.toString(),
      filledShares: placed.filled,
      submittedSizeShares: placed.size,
      price: placed.price,
      rested: placed.rested,
      orderId: placed.orderId?.toString() ?? null,
      fillCount: placed.fills.length,
    };
    traded.add(chosen.id.toLowerCase());
    saveTraded(traded);
    return out;
  } catch (e) {
    out.error = {
      at: nowIso(),
      message: e instanceof Error ? e.message : String(e),
    };
    return out;
  } finally {
    if (out.error) out.currentStage = 'error';
    else if (!['no_eligible_market', 'incomplete_market_context'].includes(out.currentStage))
      out.currentStage = 'complete';
    out.finishedAt = nowIso();
    persist();
    try {
      const old = JSON.parse(readFileSync(CONFIG.historyFile, 'utf8'));
      const history = Array.isArray(old) ? old : [];
      writeFileSync(
        CONFIG.historyFile,
        JSON.stringify(
          [out, ...history.filter((x: any) => x.cycleId !== out.cycleId)].slice(0, 20),
          null,
          2,
        ),
      );
    } catch {
      writeFileSync(CONFIG.historyFile, JSON.stringify([out], null, 2));
    }
    await shutdown(ctx);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCycle().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (r.error) process.exitCode = 1;
  });
