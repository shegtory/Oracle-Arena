# Oracle Arena

Oracle Arena is an autonomous event-contract trading system running on Somnia Testnet. It requests market data through Somnia's native JSON API Agent, asks the native LLM Inference Agent for a contract-aware directional decision, applies deterministic risk controls, and can submit bounded orders to DreamDEX binary markets.

The public dashboard exposes the complete pipeline: price observations, market selection, inference, risk checks, execution receipts, accumulated cycle history, and resolved win/loss performance.

- **Live dashboard:** https://oracle-arena-agent.vercel.app/
- **Demo video:** [DEMO_VIDEO_URL](DEMO_VIDEO_URL)
- **Network:** Somnia Testnet (`50312`)

> Oracle Arena is experimental testnet software. It deliberately skips a cycle when contract context, time remaining, or executable liquidity is insufficient.

## What makes it different

- **Native on-chain inference:** trading decisions come from Somnia's LLM Inference Agent rather than an external hosted model.
- **Verifiable data path:** price and inference requests produce Somnia transaction proofs and asynchronous contract callbacks.
- **Deterministic safety boundary:** inference can propose `UP`, `DOWN`, or `SKIP`, but it cannot bypass the hard-coded size, expiry, liquidity, and duplicate-market checks.
- **Real execution path:** when every gate passes and `DRY_RUN=false`, the cycle submits a bounded order to the DreamDEX binary pool.
- **Honest outcome reporting:** the dashboard reconciles filled positions against resolved on-chain market payouts and displays losses as well as wins.

## Live deployment and proofs

| Component | Confirmed value | Explorer / proof |
| --- | --- | --- |
| JSON API Agent | `13174292974160097713` | [Agent Explorer](https://agents.testnet.somnia.network/) · [representative Shannon request](https://shannon-explorer.somnia.network/tx/0xef402b583def30e1a84f2cc25278eb0e8e9c32f6ff119ffd9ac4b644f98f8ee9) |
| LLM Inference Agent | `12847293847561029384` | [Agent Explorer](https://agents.testnet.somnia.network/) · [representative Shannon request](https://shannon-explorer.somnia.network/tx/0x379d3a92dd6e6231b86d37b8fd566c4ec88d4eab4c2775857afefdb366fa1ca3) |
| `AgentCallbackV2` | `0x4c88a0b56E8AdBe91328fac6F9ddD1C5619B84Df` | [Shannon Explorer](https://shannon-explorer.somnia.network/address/0x4c88a0b56E8AdBe91328fac6F9ddD1C5619B84Df) |
| Somnia Agents platform | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | [Shannon Explorer](https://shannon-explorer.somnia.network/address/0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776) |
| Binary market module | `0x3ecC694Cef705358864a646142ac17A90E29e388` | [Shannon Explorer](https://shannon-explorer.somnia.network/address/0x3ecC694Cef705358864a646142ac17A90E29e388) |

Somnia agent IDs are numeric protocol identifiers, not addresses or transactions, so Shannon Explorer does not provide a standalone entity route for an agent ID. The table therefore links each ID to the official testnet Agent Explorer and to a verified Shannon transaction produced by Oracle Arena using that agent.

## How a cycle works

1. Submit a BTC/USD request to the JSON API Agent and wait for the callback receipt.
2. Wait for the configured sampling interval, then request a second BTC/USD value and a current ETH/USD value.
3. Scan recent `MarketCreated` events, read authoritative market state directly from the binary contracts, and inspect raw order-book levels.
4. Prefer eligible BTC markets with more time remaining and select the first candidate with executable YES and NO liquidity.
5. Send the price trend, strike, time remaining, and live book context to the LLM Inference Agent.
6. Parse the constrained response into `UP`, `DOWN`, or `SKIP` plus reasoning and confidence.
7. Apply the deterministic risk gate: maximum cost, minimum time, minimum book liquidity, valid executable price, and duplicate-market protection.
8. Submit the order when the gate passes and real execution is enabled; otherwise persist the exact skip or error reason.
9. Merge the new receipt into the persistent telemetry history and reconcile previously traded markets against their on-chain settlement state.

The current implementation intentionally keeps this orchestration in the single file `bot/run-cycle.ts`. It is not split into hypothetical `agents/`, `market/`, or `execution/` subdirectories.

## Architecture

```text
Somnia JSON API Agent ─┐
                      ├─> Somnia Agents platform ─> AgentCallbackV2
Somnia LLM Agent ─────┘                                │
                                                       v
                                              bot/run-cycle.ts
                                              ├─ price sampling
                                              ├─ market discovery
                                              ├─ order-book reads
                                              ├─ deterministic risk gate
                                              └─ DreamDEX order submission
                                                       │
                                                       v
                                      last receipt + merged history JSON
                                                       │
                         telemetry branch <─ publisher + settlement reconciler
                                                       │
                                                       v
                                      Vercel JSON APIs ─> React dashboard
```

The Vercel deployment never relies on its ephemeral filesystem for historical state. GitHub Actions publishes `latest.json` and the capped, merged `history.json` to the dedicated `telemetry` branch; the serverless API functions read that branch at request time.

## Settled performance

The **Agent Scorecard** is designed to remain informative in both liquid and illiquid testnet conditions. It reports:

- cycles currently tracked in the capped history;
- orders placed;
- safe skips, including unavailable liquidity and policy decisions;
- execution errors;
- settled wins and losses; and
- win rate, excluding skips and voided markets.

During telemetry publication, `scripts/reconcile-history.mjs` revisits historical market IDs over the Ankr Somnia Testnet RPC. It reads `isResolved`, `isVoided`, and `payoutNumerators` from the authoritative market contract, derives the winning YES/NO outcome, compares it with the executed position, and writes `WIN`, `LOSS`, `SKIP`, or `VOID` into the history entry.

This is deliberately not a wins-only showcase. A real recovered execution demonstrates the policy:

- **Trade transaction:** [`0x7777d49c…5361c`](https://shannon-explorer.somnia.network/tx/0x7777d49cbd2942f5484956d8bb5f00a49d8b8afa4695da53d9524a807365361c)
- **Decision / position:** `UP` / `YES`
- **Confidence:** `medium`
- **Settled market outcome:** `NO`
- **Result:** `LOSS`

That loss is shown publicly because verifiable autonomy should expose actual outcomes, not only successful-looking transactions.

## Repository layout

```text
.
├── .github/workflows/cycle.yml     # Scheduled and manual cycle runner
├── api/
│   ├── _telemetry.mjs              # Local/remote telemetry reader and JSON response helper
│   ├── trade-history.mjs           # GET /api/trade-history
│   └── trade-receipt.mjs           # GET /api/trade-receipt
├── bot/
│   ├── lib/                         # Somnia/DreamDEX configuration and market helpers
│   ├── risk-gate.ts                 # Reusable deterministic policy checks
│   ├── run-cycle.ts                 # Complete cycle orchestration
│   └── tsconfig.json
├── contracts/
│   ├── abi/AgentCallbackV2.json     # Runtime callback ABI
│   └── AgentCallbackV2.sol          # Somnia Agent callback receiver
├── frontend/
│   ├── src/
│   │   ├── components/              # Dashboard presentation components
│   │   ├── hooks/useTradeReceipt.ts # Polling and telemetry types
│   │   ├── App.tsx                  # Main observatory dashboard
│   │   ├── PerformancePanel.tsx     # Settled scorecard and outcome rows
│   │   └── styles.css               # Desktop, tablet, and mobile styling
│   ├── package.json
│   ├── server.mjs                   # Local production-style static/API server
│   └── vite.config.ts
├── scripts/
│   ├── publish-telemetry.mjs        # Remote-history merge and telemetry-branch publisher
│   └── reconcile-history.mjs        # On-chain settlement reconciliation
├── .env.example
├── package.json                     # Root npm workspace and cycle scripts
└── vercel.json                      # Vercel build and output configuration
```

Runtime files such as `bot/last-trade-receipt.json`, `bot/trade-history.json`, and `bot/traded-markets.json` are intentionally ignored by Git.

## Tech stack

- TypeScript and Node.js
- Somnia Markets SDK
- viem
- Solidity
- React and Vite
- GitHub Actions
- Vercel serverless functions and static hosting

## Requirements

- Node.js 22 or newer
- npm
- A dedicated Somnia Testnet wallet
- Testnet STT for gas and Somnia Agent requests
- Testnet tUSDC for DreamDEX orders

## Setup

Install the root package and its `frontend` workspace:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Set `PRIVATE_KEY` to the `0x`-prefixed private key of a dedicated testnet wallet. Never use a production wallet or commit `.env`.

## Environment variables

These are the variables present in `.env.example`:

| Variable | Required | Default/example | Purpose |
| --- | --- | --- | --- |
| `PRIVATE_KEY` | Yes for cycles | replace in `.env` | Signs Somnia Testnet agent requests and orders |
| `NETWORK` | Present in template | `testnet` | Shared library selector; `run-cycle.ts` currently forces testnet |
| `CHAIN_ID` | No | `50312` | Shared library override; `run-cycle.ts` currently forces `50312` |
| `RPC_URL` | No | Somnia Testnet RPC in template | Shared library override; `run-cycle.ts` currently forces the Ankr endpoint |
| `WS_RPC_URL` | No | Somnia Testnet WebSocket override | WebSocket RPC override |
| `INDEXER_URL` | No | Somnia testnet GraphQL endpoint | Indexer override |
| `MAX_TRADE_TUSDC` | No | `5` | Maximum cost allowed per order |
| `MIN_TIME_LEFT_SECONDS` | No | `15` | Minimum remaining market time |
| `MIN_LIQUIDITY_SHARES` | No | `50` | Minimum executable shares at the limit price |
| `ASK_PREMIUM` | No | `0.01` | Maximum premium added above the best ask |
| `TREND_SAMPLE_DELAY_MS` | No | `120000` | Delay between BTC price observations |
| `DRY_RUN` | No | `true` | Prevents order submission unless explicitly set to `false` |
| `GITHUB_TOKEN` | Only for manual telemetry publishing | supplied automatically in Actions | Writes `latest.json` and `history.json` to the telemetry branch |

Start with `DRY_RUN=true`. Set it to `false` only when the dedicated wallet is funded and real testnet execution is intended.

## Commands

Run one complete cycle:

```bash
npm run cycle
```

Typecheck the bot:

```bash
npm run typecheck
```

Build the bot and production dashboard:

```bash
npm run build
```

Build only the frontend workspace:

```bash
npm run build:frontend
```

Run the Vite development server:

```bash
npm run dev --workspace oracle-arena-dashboard
```

Preview the production frontend build:

```bash
npm run preview --workspace oracle-arena-dashboard
```

Serve the built dashboard with the local JSON API server:

```bash
npm run serve --workspace oracle-arena-dashboard
```

The production-style server uses `PORT` when set and otherwise listens on `4173`.

Telemetry publication is normally handled by GitHub Actions. When `GITHUB_TOKEN` is available, it can also be run manually:

```bash
npm run publish:telemetry
```

## Automation and deployment

`.github/workflows/cycle.yml` supports both manual dispatch and a scheduled trigger at minutes `7`, `22`, `37`, and `52` of every hour. Each run:

1. installs the npm workspace with `npm ci` on Node.js 24;
2. validates the `PRIVATE_KEY` repository secret;
3. retries the complete cycle up to three times with exponential backoff;
4. records completed, skipped, and errored cycle receipts; and
5. merges and publishes telemetry even when the cycle step fails after producing a receipt.

Repository configuration:

- Actions secret: `PRIVATE_KEY`
- Actions variable: `DRY_RUN` (`true` or `false`)

GitHub-hosted cron is best-effort and may start later than the nominal minute. The dashboard remains useful between runs because it displays the last persisted receipts rather than pretending a runner is continuously active.

Vercel uses the root configuration:

```text
installCommand: npm install
buildCommand: npm run build:frontend
outputDirectory: frontend/dist
```

## Public JSON endpoints

- `GET https://oracle-arena-agent.vercel.app/api/trade-receipt`
- `GET https://oracle-arena-agent.vercel.app/api/trade-history`

Both endpoints disable response caching and read the persistent telemetry branch in production.

## Security

- Use a dedicated testnet wallet containing only the funds needed for testing.
- Keep `.env`, wallet files, private keys, keystores, logs, runtime receipts, and generated output out of Git.
- Store the CI signing key only in the `PRIVATE_KEY` Actions secret.
- Never paste a private key into source code, documentation, screenshots, issues, or workflow logs.
- Rotate the testnet wallet immediately if its key is ever exposed.
- Treat the deterministic risk gate as a safety boundary, not as a guarantee of profitability or contract safety.

## License notice

The imported DreamDEX integration helpers under `bot/lib/` retain their upstream license in `bot/lib/LICENSE`. No repository-wide license file is currently included.
