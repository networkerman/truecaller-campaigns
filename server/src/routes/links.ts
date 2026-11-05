import type { FastifyInstance } from 'fastify';
import { recordClick } from '../links.js';

// Public: recipients open these from their Truecaller chat.
export async function linkRoutes(app: FastifyInstance) {
  app.get('/r/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const url = /^[A-Za-z0-9]{6,20}$/.test(code) ? await recordClick(code) : null;
    if (!url) return reply.code(404).type('text/plain').send('This link is no longer available.');
    return reply.header('Cache-Control', 'no-store').redirect(url, 302);
  });
}
