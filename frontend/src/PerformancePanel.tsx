import { Activity, BarChart3, CheckCircle2, CircleSlash2, XCircle } from 'lucide-react';
import type { TradeReceipt } from './hooks/useTradeReceipt';

const decisionOf = (cycle: TradeReceipt) => cycle.llmDecision?.decision ?? 'SKIP';
const confidenceOf = (cycle: TradeReceipt) => cycle.llmDecision?.confidence?.toUpperCase() ?? '—';

export function PerformancePanel({ history }: { history: TradeReceipt[] }) {
  const orders = history.filter((cycle) => (cycle.order?.filledShares ?? 0) > 0).length;
  const errors = history.filter((cycle) => cycle.error).length;
  const skipped = history.filter((cycle) => cycle.order?.status === 'skipped' || cycle.llmDecision?.skipped || (!cycle.order && !cycle.error)).length;
  const settled = history.filter((cycle) => cycle.settlement?.status === 'voided' || (cycle.settlement?.status === 'resolved' && (cycle.order?.filledShares ?? 0) > 0));
  const wins = settled.filter((cycle) => cycle.settlement?.result === 'WIN').length;
  const losses = settled.filter((cycle) => cycle.settlement?.result === 'LOSS').length;
  const decided = wins + losses;
  const winRate = decided ? `${Math.round((wins / decided) * 100)}%` : '—';

  return <section className="performance-section">
    <div className="section-title"><div><BarChart3/><span>SETTLED PERFORMANCE</span></div><h2>AGENT SCORECARD <em>/ ON-CHAIN RECONCILED</em></h2><p>RESOLUTIONS REFRESH EACH CYCLE</p></div>
    <div className="performance-stats">
      <div><small>CYCLES TRACKED</small><strong>{history.length}</strong></div>
      <div><small>ORDERS PLACED</small><strong>{orders}</strong></div>
      <div><small>SAFE SKIPS</small><strong>{skipped}</strong></div>
      <div><small>ERRORS</small><strong>{errors}</strong></div>
      <div><small>WIN RATE</small><strong className={wins ? 'result--win' : ''}>{winRate}</strong><span>{wins}W / {losses}L</span></div>
    </div>
    <div className="settled-list">
      {settled.length ? settled.slice(0, 8).map((cycle) => {
        const result = cycle.settlement?.result ?? 'VOID';
        const Icon = result === 'WIN' ? CheckCircle2 : result === 'LOSS' ? XCircle : CircleSlash2;
        return <article key={cycle.cycleId} className={`settled-row result--${result.toLowerCase()}`}>
          <Icon/>
          <div className="settled-market"><small>MARKET</small><strong>#{(cycle.marketContext?.marketId ?? cycle.riskGate?.marketId ?? '').slice(-6).toUpperCase()}</strong></div>
          <div><small>DECISION</small><strong className={`decision--${decisionOf(cycle).toLowerCase()}`}>{decisionOf(cycle)}</strong></div>
          <div><small>OUTCOME</small><strong>{cycle.settlement?.marketOutcome ?? 'VOID'}</strong></div>
          <div><small>CONFIDENCE</small><strong>{confidenceOf(cycle)}</strong></div>
          <b>{result}</b>
        </article>;
      }) : <div className="settlement-empty"><Activity/><div><strong>NO SETTLED POSITIONS YET</strong><p>Cycles and safety skips are still counted above. Filled positions will appear here automatically after on-chain resolution.</p></div></div>}
    </div>
  </section>;
}
