# Oracle Arena

Oracle Arena is an autonomous event-contract trading system for Somnia. It combines on-chain price requests, contract-aware directional inference, deterministic risk checks, and bounded order execution on DreamDEX binary markets. A React dashboard displays each cycle from signal collection through settlement-ready transaction receipts.

> Oracle Arena is experimental testnet software. Review the contracts, limits, and transaction payloads before using it with assets of value.

## How it works

Each cycle follows a fixed pipeline:

1. Request two BTC/USD observations through Somnia's JSON API agent.
2. Discover active BTC binary markets and read their current contract state.
3. Submit the price trend and selected market context to the LLM inference agent.
4. Parse the response into `UP`, `DOWN`, or `SKIP`.
5. Apply deterministic limits for trade size, time to expiry, available liquidity, and duplicate markets.
6. Submit an immediate-or-cancel order when every risk check passes.
7. Store a receipt for the dashboard and append it to local cycle history.

Inference proposes a direction; it cannot bypass the deterministic risk gate.

## Architecture

```text
Somnia agents ── callbacks ──> AgentCallbackV2
       │                              │
       └──────── run-cycle.ts <───────┘
                    │
          market discovery + reads
                    │
              deterministic risk gate
                    │
              DreamDEX order book
                    │
           receipt and history JSON
                    │
             dashboard API + React UI
```

- `contracts/` contains the callback contract and the ABI consumed by the runtime.
- `bot/run-cycle.ts` coordinates agent requests, market discovery, policy checks, and execution.
- `bot/risk-gate.ts` contains the standalone deterministic policy and prompt validation utilities.
- `bot/lib/` provides the Somnia market client configuration used by the cycle.
- `frontend/` contains the Vite/React dashboard and its small JSON API server.

## Tech stack

- TypeScript and Node.js
- Somnia Markets SDK
- viem
- Solidity
- React and Vite

## Requirements

- Node.js 22 or newer
- npm 11 or newer
- A funded Somnia testnet wallet
- Testnet STT for gas and tUSDC for event-contract orders

## Setup

Install backend and frontend dependencies:

```bash
npm install
npm --prefix frontend install
```

Copy the environment template:

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Set `PRIVATE_KEY` in `.env` to the private key of a dedicated testnet wallet. Do not reuse a production wallet or commit `.env`.

The default policy values are deliberately conservative:

```dotenv
MAX_TRADE_TUSDC=5
MIN_TIME_LEFT_SECONDS=15
MIN_LIQUIDITY_SHARES=50
ASK_PREMIUM=0.01
TREND_SAMPLE_DELAY_MS=120000
DRY_RUN=true
```

Keep `DRY_RUN=true` while validating configuration. Change it only when the wallet is funded and you intend to submit testnet transactions.

## Development

Typecheck the trading service:

```bash
npm run typecheck
```

Build the dashboard:

```bash
npm --prefix frontend run build
```

Run one trading cycle:

```bash
npm run cycle
```

Serve the production dashboard after building it:

```bash
npm --prefix frontend run serve
```

The server listens on `PORT` when provided and defaults to `4173`. It reads `bot/last-trade-receipt.json` and `bot/trade-history.json`; both are local runtime files and are excluded from Git.

## Security

- Use a dedicated testnet wallet with only the funds needed for testing.
- Store secrets only in `.env` or your deployment platform's secret manager.
- Never place private keys in source files, command history, screenshots, logs, or issue reports.
- Rotate a wallet immediately if its private key is exposed.
- Treat risk limits as a final safety boundary, not as a guarantee against loss or contract failure.

## License notices

The market integration helpers under `bot/lib/` retain their upstream license in `bot/lib/LICENSE`.
