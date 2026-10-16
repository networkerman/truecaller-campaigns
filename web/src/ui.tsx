import { useTestMode } from './testMode';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const fmt = (n: number) => n.toLocaleString('en-IN');
export const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

// Calls fn now and every `ms` while the component is mounted (and `active` is true).
export function usePoll(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    if (!active) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}

export function Drawer({ title, badge, onClose, children, footer, narrow }: {
  title: string; badge?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <section className={narrow ? 'drawer narrow' : 'drawer'} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {badge}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="drawer-scroll">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function PageHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="muted">{sub}</p>
      </div>
      {action}
    </header>
  );
}

export function Funnel({ steps }: { steps: { stage: string; count: number }[] }) {
  const top = Math.max(steps[0]?.count ?? 0, 1);
  const testMode = useTestMode();
  return (
    <div className="funnel">
      {testMode && <p className="simulated">Simulated results: test mode, nothing was sent.</p>}
      {steps.map((s, i) => (
        <div key={s.stage} className="funnel-row">
          <span className="funnel-label">{s.stage}</span>
          <div className="funnel-track">
            <div className="funnel-bar" style={{ width: `${(s.count / top) * 100}%` }} />
          </div>
          <span className="funnel-num">
            {fmt(s.count)}
            {i > 0 && <small> {steps[i - 1].count ? Math.round((s.count / steps[i - 1].count) * 100) : 0}%</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
