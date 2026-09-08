import { Activity, BarChart3, CheckCircle2, CircleSlash2, XCircle } from 'lucide-react';
import type { TradeReceipt } from './hooks/useTradeReceipt';

const decisionOf = (cycle: TradeReceipt) => cycle.llmDecision?.decision ?? 'SKIP';
const confidenceOf = (cycle: TradeReceipt) => cycle.llmDecision?.confidence?.toUpperCase() ?? '—';

export function PerformancePanel({ history }: { history: TradeReceipt[] }) {
  const orders = history.filter((cycle) => (cycle.order?.filledShares ?? 0) > 0).length;
  const errors = history.filter((cycle) => cycle.error || cycle.order?.status === 'reverted').length;
  const skipped = history.filter((cycle) => cycle.order?.status === 'skipped' || cycle.llmDecision?.skipped || (!cycle.order && !cycle.error)).length;
  const settled = history.filter((cycle) => (cycle.order?.filledShares ?? 0) > 0 && (cycle.settlement?.status === 'voided' || cycle.settlement?.status === 'resolved'));
  const wins = settled.filter((cycle) => cycle.settlement?.result === 'WIN').length;
  const losses = settled.filter((cycle) => cycle.settlement?.result === 'LOSS').length;
  const decided = wins + losses;
  const winRate = decided ? `${Math.round((wins / decided) * 100)}%` : '—';
  const fillRate = history.length ? `${Math.round(orders / history.length * 100)}%` : '—';
  const filled=history.filter(c=>(c.order?.filledShares??0)>0);const stakeKnown=filled.every(c=>Number.isFinite(c.order?.averageFillPrice));const stake=stakeKnown?filled.reduce((n,c)=>n+(c.order?.filledShares??0)*c.order!.averageFillPrice!,0):null;
  const payoutKnown = filled.every(c=>c.settlement?.result==='LOSS'||(c.redeem?.status==='confirmed'&&Number.isFinite(c.redeem.amountReceived)));
  const payout = history.reduce((n,c)=>n+(c.redeem?.status==='confirmed'?(c.redeem.amountReceived??0):0),0);
  const cycleLatencies=history.map(c=>Date.parse(c.finishedAt??'')-Date.parse(c.startedAt??'')).filter(Number.isFinite);const avgCycle=cycleLatencies.length?cycleLatencies.reduce((a,b)=>a+b,0)/cycleLatencies.length:null;
  const costKnown=history.length>0&&history.every(c=>c.costs?.agentCostWei!=null);const totalAgentCost=costKnown?history.reduce((n,c)=>n+BigInt(c.costs!.agentCostWei),0n).toString():'NOT MEASURED';

  return <section className="performance-section">
    <div className="section-title"><div><BarChart3/><span>SETTLED PERFORMANCE</span></div><h2>AGENT SCORECARD <em>/ ON-CHAIN RECONCILED</em></h2><p>RESOLUTIONS REFRESH EACH CYCLE</p></div>
    <div className="performance-stats">
      <div><small>CYCLES TRACKED</small><strong>{history.length}</strong></div>
      <div><small>FILLED TRADES</small><strong>{orders}</strong></div>
      <div><small>SAFE SKIPS</small><strong>{skipped}</strong></div>
      <div><small>ERRORS</small><strong>{errors}</strong></div>
      <div><small>FILL RATE</small><strong>{fillRate}</strong></div><div><small>STAKE</small><strong>{stake==null?'NOT MEASURED':stake.toFixed(3)}</strong><span>tUSDC</span></div><div><small>REALIZED PNL</small><strong>{payoutKnown&&stake!=null?(payout-stake).toFixed(3):'NOT MEASURED'}</strong></div><div><small>AVG CYCLE</small><strong>{avgCycle==null?'NOT MEASURED':`${Math.round(avgCycle)}ms`}</strong></div><div><small>AGENT REQUEST VALUE</small><strong>{totalAgentCost}</strong><span>{costKnown?'Wei attached; net cost not measured':'Not measured for legacy cycles'}</span></div>
      <div><small>WIN RATE</small><strong className={wins ? 'result--win' : ''}>{winRate}</strong><span>{wins}W / {losses}L</span></div>
    </div>
    {decided<30&&<p className="sample-warning">Small sample — not statistically significant</p>}<div className="settled-list">
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
