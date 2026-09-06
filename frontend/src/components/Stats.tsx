import { Gauge, Target, Waves } from 'lucide-react';
import type { TradeCycle } from '../types';

interface StatsProps {
  history: TradeCycle[];
}

export function Stats({ history }: StatsProps) {
  const settled = history.filter((item) => item.won !== undefined);
  const wins = settled.filter((item) => item.won).length;
  const winRate = settled.length ? Math.round((wins / settled.length) * 100) : null;
  const totalVolume = history.reduce((sum, item) => sum + item.orderSize, 0);

  const stats = [
    { label: 'Total cycles', value: '1,042', detail: '+18 today', icon: Waves },
    { label: 'Win rate', value: winRate === null ? '—' : `${winRate}%`, detail: `${settled.length} settled`, icon: Target },
    { label: 'Visible volume', value: `$${totalVolume.toFixed(2)}`, detail: 'USDC · 5 cycles', icon: Gauge },
  ];

  return (
    <section className="stats-grid" aria-label="Agent statistics">
      {stats.map(({ label, value, detail, icon: Icon }) => (
        <article className="stat-card" key={label}>
          <div className="stat-card__icon"><Icon size={17} strokeWidth={1.5} /></div>
          <div>
            <p className="stat-card__label">{label}</p>
            <p className="stat-card__value">{value}</p>
          </div>
          <span className="stat-card__detail">{detail}</span>
        </article>
      ))}
    </section>
  );
}
