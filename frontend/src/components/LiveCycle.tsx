import { ArrowRight, ExternalLink } from 'lucide-react';
import { explorerTxUrl, type CycleStage } from '../types';
import { StatusPill } from './StatusPill';

interface LiveCycleProps {
  stages: CycleStage[];
  requestId: bigint;
  updatedAt: string;
}

export function LiveCycle({ stages, requestId, updatedAt }: LiveCycleProps) {
  return (
    <section className="panel live-cycle" aria-labelledby="live-cycle-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">ACTIVE SIGNAL PATH</p>
          <h1 id="live-cycle-title">Live Cycle</h1>
        </div>
        <div className="cycle-meta">
          <span>REQUEST #{requestId.toString()}</span>
          <span className="cycle-meta__divider" />
          <span>UPDATED {updatedAt.toUpperCase()}</span>
        </div>
      </div>

      <div className="stage-track">
        {stages.map((stage, index) => (
          <div className="stage-unit" key={stage.id}>
            <article className={`stage-card stage-card--${stage.status}`}>
              <div className="stage-card__topline">
                <span className="stage-index">0{index + 1}</span>
                <StatusPill status={stage.status} />
              </div>
              <p className="stage-eyebrow">{stage.eyebrow}</p>
              <h2>{stage.title}</h2>
              <p className={`stage-value ${stage.id === 'price' ? 'price-tick' : ''}`}>
                {stage.value}
              </p>
              <div className="stage-card__footer">
                <span>{stage.detail}</span>
                {stage.txHash && (
                  <a
                    href={explorerTxUrl(stage.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${stage.title} transaction in Shannon Explorer`}
                  >
                    <ExternalLink size={15} strokeWidth={1.7} />
                  </a>
                )}
              </div>
            </article>

            {index < stages.length - 1 && (
              <div className="stage-connector" aria-hidden="true">
                <span className="stage-connector__beam" />
                <ArrowRight size={16} strokeWidth={1.5} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
