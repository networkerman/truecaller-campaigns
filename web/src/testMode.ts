import { useEffect, useState } from 'react';

// True while the server runs the mock provider: nothing is really sent, and delivery and
// read receipts are simulated. Read once from /health and shared by every component.
let mode: Promise<boolean> | null = null;
const load = () =>
  (mode ??= fetch('/health')
    .then((r) => r.json())
    .then((h: { provider?: string }) => h.provider === 'mock')
    .catch(() => false));

export function useTestMode() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}
