import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';

// Plain URLs and markdown link targets alike; stops at whitespace and closing brackets.
const URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode() {
  return [...randomBytes(9)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

// Swaps each link in a campaign message for a /r/<code> redirect so clicks are counted.
export function trackLinks(text: string) {
  const links: { code: string; url: string }[] = [];
  const out = text.replace(URL_RE, (raw) => {
    const url = raw.replace(/[.,;:!?]+$/, '');
    const c = newCode();
    links.push({ code: c, url });
    return `${config.publicUrl}/r/${c}${raw.slice(url.length)}`;
  });
  return { text: out, links };
}

export async function saveLinks(
  messageId: string,
  campaignId: string | null,
  links: { code: string; url: string; kind?: string; label?: string }[],
) {
  for (const l of links) {
    await pool.query(
      `INSERT INTO links (code, message_id, campaign_id, url, kind, label) VALUES ($1, $2, $3, $4, $5, $6)`,
      [l.code, messageId, campaignId, l.url, l.kind ?? 'text', l.label ?? null],
    );
  }
}

// A button tap reported by Truecaller. Taps on redirect buttons only set the first click time, since
// opening the redirect counts the click itself; direct link buttons and quick replies count here.
export async function recordTap(tag: string, at: Date) {
  const m = /^[br]([A-Za-z0-9]{6,20})$/.exec(tag);
  if (!m) return false;
  const { rowCount } = await pool.query(
    `UPDATE links SET clicks = clicks + CASE WHEN kind = 'button' THEN 0 ELSE 1 END,
       first_clicked_at = LEAST(coalesce(first_clicked_at, $2), $2), last_clicked_at = GREATEST(coalesce(last_clicked_at, $2), $2)
     WHERE code = $1`,
    [m[1], at],
  );
  return Boolean(rowCount);
}

// Records a click and returns where to send the person.
export async function recordClick(c: string) {
  const { rows } = await pool.query(
    `UPDATE links SET clicks = clicks + 1, first_clicked_at = coalesce(first_clicked_at, now()), last_clicked_at = now()
     WHERE code = $1 AND kind <> 'reply' RETURNING url`,
    [c],
  );
  return (rows[0]?.url as string | undefined) ?? null;
}
