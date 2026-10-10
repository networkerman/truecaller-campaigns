import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || !config.apiKeys.includes(key)) {
    return reply.code(401).send({ error: 'invalid or missing x-api-key' });
  }
}
