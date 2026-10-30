import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { MAX_MEDIA_BYTES, MIME_TYPES } from '../rich.js';

const safeName = (n: string) => n.replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'file';
const urlOf = (id: string, name: string) => `${config.publicUrl}/m/${id}/${encodeURIComponent(name)}`;

// Template attachments. Truecaller needs a public URL to download a file from at send time, so files
// uploaded here are stored in Postgres and served at /m/<id>/<name>. The id is a random UUID.
export async function mediaRoutes(app: FastifyInstance) {
  app.register(async (priv) => {
    priv.addHook('onRequest', requireAuth);
    priv.addContentTypeParser(MIME_TYPES as unknown as string[], { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES }, (_req, body, done) => done(null, body));

    // Raw file body with its Content-Type; the file name in x-file-name.
    priv.post('/v1/media', { preHandler: requirePermission('templates:manage'), bodyLimit: MAX_MEDIA_BYTES }, async (req, reply) => {
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      if (!(MIME_TYPES as readonly string[]).includes(mime)) {
        return reply.code(415).send({ error: 'Use a JPEG, PNG or GIF image, an MP4 or MOV video, or a PDF or text file.' });
      }
      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || !bytes.length) return reply.code(400).send({ error: 'The file is empty.' });
      const name = safeName(decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')));
      const { rows } = await pool.query(
        `INSERT INTO media_files (workspace_id, file_name, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [req.ctx.workspaceId, name, mime, bytes.length, bytes],
      );
      return reply.code(201).send({ id: rows[0].id, url: urlOf(rows[0].id, name), mime_type: mime, file_name: name, size: bytes.length });
    });
  });

  // Public: Truecaller (and the dashboard preview) fetch attachments from here.
  app.get('/m/:id/:name', async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success) return reply.code(404).send('not found');
    const { rows } = await pool.query(`SELECT mime_type, bytes FROM media_files WHERE id = $1`, [p.data.id]);
    if (!rows[0]) return reply.code(404).send('not found');
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type(rows[0].mime_type).send(rows[0].bytes);
  });
}
