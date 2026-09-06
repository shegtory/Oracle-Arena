import { ExternalLink } from 'lucide-react';
import { explorerTxUrl, type TradeCycle } from '../types';
import { StatusPill } from './StatusPill';

interface TradeHistoryProps {
  history: TradeCycle[];
}

const shortHash = (hash: string) => `${hash.slice(0, 7)}…${hash.slice(-5)}`;

const formatTime = (timestamp: string) =>
  new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

export function TradeHistory({ history }: TradeHistoryProps) {
  return (
    <section className="panel history" aria-labelledby="history-title">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="section-kicker">IMMUTABLE EXECUTION LOG</p>
          <h2 id="history-title">Trade History</h2>
        </div>
        <span className="history-count">LATEST {history.length}</span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Asset</th>
              <th>Oracle price</th>
              <th>Decision</th>
              <th>Order</th>
              <th>Size</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {history.map((trade) => (
              <tr key={trade.id}>
                <td className="mono muted">{formatTime(trade.timestamp)}</td>
                <td><span className="asset-chip">{trade.asset}</span></td>
                <td className="mono">${trade.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                <td><span className={`decision decision--${trade.decision.toLowerCase()}`}>{trade.decision}</span></td>
                <td><StatusPill status={trade.orderStatus} /></td>
                <td className="mono">{trade.orderSize.toFixed(2)} USDC</td>
                <td>
                  <a className="tx-link" href={explorerTxUrl(trade.txHash)} target="_blank" rel="noreferrer">
                    <span>{shortHash(trade.txHash)}</span>
                    <ExternalLink size={13} strokeWidth={1.7} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
