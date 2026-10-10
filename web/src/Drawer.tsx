import { useEffect, type ReactNode } from 'react';

export function Drawer({
  title,
  badge,
  onClose,
  footer,
  children,
  wide = false,
}: {
  title: string;
  badge?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <section className={wide ? 'drawer' : 'drawer narrow'} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {badge}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="drawer-body single">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </section>
    </div>
  );
}
