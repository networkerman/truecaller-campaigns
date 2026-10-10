import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyKey } from './apiKeys.js';
import { config } from './config.js';

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key && (config.apiKeys.includes(key) || (await verifyKey(key)))) return;
  return reply.code(401).send({ error: 'invalid or missing x-api-key' });
}
