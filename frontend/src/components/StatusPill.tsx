import type { CycleStatus } from '../types';

interface StatusPillProps {
  status: CycleStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      <span className="status-pill__dot" aria-hidden="true" />
      {status}
    </span>
  );
}
