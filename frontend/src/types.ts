export type CycleStatus = 'pending' | 'success' | 'failed';
export type Decision = 'UP' | 'DOWN';
export type Asset = 'BTC' | 'ETH';

export interface CycleStage {
  id: 'price' | 'decision' | 'risk' | 'order';
  title: string;
  eyebrow: string;
  status: CycleStatus;
  value: string;
  detail: string;
  txHash?: `0x${string}`;
}

export interface TradeCycle {
  id: string;
  timestamp: string;
  asset: Asset;
  price: number;
  decision: Decision;
  orderStatus: CycleStatus;
  orderSize: number;
  txHash: `0x${string}`;
  won?: boolean;
}

export interface OracleArenaSnapshot {
  network: string;
  isLive: boolean;
  activeRequestId: bigint;
  updatedAt: string;
  stages: CycleStage[];
  reasoning: string[];
  history: TradeCycle[];
}

export const explorerTxUrl = (txHash: string) =>
  `https://shannon-explorer.somnia.network/tx/${txHash}`;
