import { useTestMode } from './testMode';
import type { Button, Media } from './api';
import { OnextelCurve } from './OnextelLogo';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// The Truecaller API reference in the OneXtel docs (Mintlify).
export const DOCS_URL = 'https://docs.onextel.com/api-reference/truecaller';

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

// The V5 page header box: navy gradient, dot pattern and the red brand curve. The page's main
// action sits under it on the right, like the design system's Broadcasts page.
export function PageHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <>
      <header className="page-head">
        <OnextelCurve className="page-head-curve" />
        <div className="page-head-text">
          <div className="crumbs">Truecaller campaigns <span>/</span> <b>{title}</b></div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
      </header>
      {action && <div className="page-actions">{action}</div>}
    </>
  );
}

// Bad steps (failed, skipped) sit under the funnel and show their share of the first step.
export function Funnel({ steps }: { steps: { stage: string; count: number; bad?: boolean }[] }) {
  const top = Math.max(steps[0]?.count ?? 0, 1);
  const testMode = useTestMode();
  return (
    <div className="funnel">
      {testMode && <p className="simulated">Simulated results: test mode, nothing was sent.</p>}
      {steps.map((s, i) => (
        <div key={s.stage} className={`funnel-row${s.bad ? ' bad' : ''}${s.bad && !steps[i - 1]?.bad ? ' first-bad' : ''}`}>
          <span className="funnel-label">{s.stage}</span>
          <div className="funnel-track">
            <div className="funnel-bar" style={{ width: `${(s.count / top) * 100}%` }} />
          </div>
          <span className="funnel-num">
            {fmt(s.count)}
            {s.bad ? (
              <small> {Math.round((s.count / top) * 100)}%</small>
            ) : (
              i > 0 && <small> {steps[i - 1].count ? Math.round((s.count / steps[i - 1].count) * 100) : 0}%</small>
            )}
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

// Attachment and buttons under a message preview, drawn the way Truecaller shows them.
export function RichParts({ media, buttons, fill = (t: string) => t }: { media: Media | null | undefined; buttons: Button[] | undefined; fill?: (t: string) => string }) {
  return (
    <>
      {media && (
        <div className="rich-media">
          {media.mime_type.startsWith('image/') ? (
            <img src={media.url} alt="" />
          ) : media.mime_type.startsWith('video/') ? (
            <div className="rich-file">▶ Video{media.file_name ? ` · ${media.file_name}` : ''}</div>
          ) : (
            <div className="rich-file">📄 {media.file_name || (media.mime_type === 'application/pdf' ? 'document.pdf' : 'file.txt')}</div>
          )}
        </div>
      )}
      {buttons && buttons.length > 0 && (
        <div className="rich-buttons">
          {buttons.map((b, i) => (
            <span key={i} className={`rich-btn ${b.type}`}>{b.type === 'link' ? '↗ ' : '↩ '}{fill(b.text) || (b.type === 'link' ? 'Link button' : 'Quick reply')}</span>
          ))}
        </div>
      )}
    </>
  );
}

// Truecaller styles text the way the Business Chat API documents: *bold*, _italic_, ~strike~,
// `mono` and [label](url) links. The preview does the same so it matches the phone.
export function TcText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((\S+?)\)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = parts.length;
    if (m[1]) parts.push(<span key={k} className="tc-a">{m[1]}</span>);
    else if (m[3]) parts.push(<b key={k}>{m[3]}</b>);
    else if (m[4]) parts.push(<i key={k}>{m[4]}</i>);
    else if (m[5]) parts.push(<s key={k}>{m[5]}</s>);
    else parts.push(<code key={k}>{m[6]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const plain = (t: string) => t.replace(/\[([^\]]+)\]\(\S+?\)/g, '$1').replace(/[*_~`]/g, '');
// Truecaller shows uploaded file names with underscores, e.g. onextel_test.pdf.
const shownFileName = (m: Media) => (m.file_name || (m.mime_type === 'application/pdf' ? 'document.pdf' : 'file.txt')).replace(/[-\s]+/g, '_');

function TcAvatar({ sender }: { sender: string }) {
  const initials = sender.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'B';
  return <span className="tc-avatar">{initials}</span>;
}

const Tick = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Verified"><path fill="#1a73e8" d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.6-.7 2.9 1.2 2.7-2.2 2 .1 3-2.9.8-1.6 2.6-2.9-.8L12 22.5l-2.4-1.8-3 .2-1-2.8-2.6-1.6.7-2.9-1.2-2.7 2.2-2-.1-3 2.9-.8 1.6-2.6 2.9.8z" /><path d="M7.5 12.3l3 3 6-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// The message inside the Truecaller app, drawn from how it renders on a phone: grey bubble, image or
// file card on top, outlined buttons inside the bubble, "Business Chat" under it.
export function TcPhone({ sender, text, media, buttons }: { sender: string; text: string; media?: Media | null; buttons?: Button[] }) {
  return (
    <div className="phone-frame tc">
      <div className="phone-notch" />
      <div className="tc-status"><span>10:42</span><span>▮▮▮ 5G</span></div>
      <div className="tc-bar">
        <span className="tc-back">←</span>
        <TcAvatar sender={sender} />
        <b className="tc-name">{sender}</b>
        <Tick />
        <span className="tc-more">⋮</span>
      </div>
      <div className="tc-chat">
        <div className="tc-day">Today</div>
        {text ? (
          <>
            <div className="tc-msg">
              {media?.mime_type.startsWith('image/') && <img className="tc-img" src={media.url} alt="" />}
              {media?.mime_type.startsWith('video/') && <div className="tc-video">▶</div>}
              {media && !media.mime_type.startsWith('image/') && !media.mime_type.startsWith('video/') && (
                <div className="tc-file">
                  <span className="tc-file-icon">📄</span>
                  <span className="tc-file-text"><b>{shownFileName(media)}</b><span>{media.mime_type === 'application/pdf' ? 'PDF' : 'TXT'}</span></span>
                  <span className="tc-file-open">↗</span>
                </div>
              )}
              <div className="tc-text"><TcText text={text} /></div>
              {buttons?.map((b, i) => <span key={i} className="tc-btn">{b.text}</span>)}
            </div>
            <div className="tc-meta">✓ Business Chat • 10:42 am</div>
            <div className="tc-chips"><span>⚠ Report</span><span>ⓘ View profile</span></div>
          </>
        ) : (
          <div className="tc-day">Pick a template to see the message</div>
        )}
      </div>
      <div className="tc-input"><span>Send Chat</span><span className="tc-send">➤</span></div>
    </div>
  );
}

// The same message as a Truecaller notification: sender, big image, three lines of
// text, then "Mark all as read" and the first button.
export function TcNotification({ sender, text, media, buttons }: { sender: string; text: string; media?: Media | null; buttons?: Button[] }) {
  if (!text) return null;
  const first = buttons?.[0];
  return (
    <div className="tc-notif">
      <div className="tc-notif-app"><span className="tc-notif-glyph">⋯</span>Truecaller • now <span className="tc-notif-caret">⌃</span></div>
      <div className="tc-notif-body">
        <TcAvatar sender={sender} />
        <div className="tc-notif-main">
          <b>{sender}</b>
          {media?.mime_type.startsWith('image/') && <img src={media.url} alt="" />}
          {media && !media.mime_type.startsWith('image/') && <span className="tc-notif-file">{media.mime_type.startsWith('video/') ? '▶ Video' : `📄 ${shownFileName(media)}`}</span>}
          <p>{plain(text)}</p>
        </div>
      </div>
      <div className="tc-notif-actions"><span>Mark all as read</span>{first && <span>{first.text}</span>}</div>
    </div>
  );
}

// Both views: the notification, then the message in the chat.
export function TcPreview(props: { sender: string; text: string; media?: Media | null; buttons?: Button[] }) {
  return (
    <div className="tc-preview">
      {props.text && (
        <>
          <div className="tc-preview-label">Notification</div>
          <TcNotification {...props} />
        </>
      )}
      <div className="tc-preview-label">Message</div>
      <TcPhone {...props} />
    </div>
  );
}
