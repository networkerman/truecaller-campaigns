import { createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

export async function listKeys() {
  const { rows } = await pool.query(
    `SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY revoked_at NULLS FIRST, created_at DESC`,
  );
  return rows;
}

// The full key is returned only here. Only its hash is stored.
export async function createKey(name: string) {
  const key = `tck_${randomBytes(24).toString('base64url')}`;
  const { rows } = await pool.query(
    `INSERT INTO api_keys (name, prefix, key_hash) VALUES ($1, $2, $3)
     RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
    [name, key.slice(0, 10), hash(key)],
  );
  return { ...rows[0], key };
}

export async function revokeKey(id: string) {
  const res = await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function verifyKey(key: string) {
  const { rows } = await pool.query(`SELECT id, last_used_at FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`, [hash(key)]);
  const row = rows[0];
  if (!row) return false;
  // Record usage at most once a minute per key, so every request isn't a write.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    void pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
  }
  return true;
}
