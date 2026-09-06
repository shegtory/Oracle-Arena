import { Activity } from 'lucide-react';

interface HeaderProps {
  isLive: boolean;
  network: string;
}

export function Header({ isLive, network }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="brand-name">ORACLE ARENA</p>
          <p className="brand-subtitle">
            Autonomous on-chain prediction agent — Somnia × dreamDEX
          </p>
        </div>
      </div>

      <div className="header-status">
        <span className="network-label">{network}</span>
        <span className={`live-indicator ${isLive ? 'is-live' : ''}`}>
          <Activity size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="live-indicator__dot" aria-hidden="true" />
          {isLive ? 'LIVE' : 'IDLE'}
        </span>
      </div>
    </header>
  );
}
