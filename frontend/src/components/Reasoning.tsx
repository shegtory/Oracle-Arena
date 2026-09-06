import { Braces } from 'lucide-react';

interface ReasoningProps {
  lines: string[];
}

export function Reasoning({ lines }: ReasoningProps) {
  return (
    <section className="panel reasoning" aria-labelledby="reasoning-title">
      <div className="terminal-bar">
        <div className="terminal-title">
          <Braces size={16} strokeWidth={1.6} />
          <h2 id="reasoning-title">Reasoning</h2>
        </div>
        <span>LLM_INFERENCE / TRACE</span>
      </div>
      <div className="terminal-body">
        {lines.map((line, index) => (
          <p className={index === lines.length - 1 ? 'terminal-conclusion' : ''} key={line}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            {index === lines.length - 1 ? '> ' : '· '}{line}
          </p>
        ))}
        <span className="terminal-cursor" aria-hidden="true" />
      </div>
    </section>
  );
}
