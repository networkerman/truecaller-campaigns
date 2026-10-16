import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { config } from '../config.js';
import type { MessageStatus, MessagingProvider, SendRequest, StatusUpdate } from './types.js';

// Truecaller Business Chat API v2: gRPC service truecaller.messenger.business.v2.BusinessApi.
// v2 has one send method (BusinessSendMessage) and reports delivery through webhooks only.
//
// The .proto files come from Truecaller's partner portal and are not kept in this repo.
// Put them in TC_PROTO_DIR on the box. Field names below follow the v2 announcement
// (flat recipient.phone_number, deduplication_id, ttl_seconds, timestamp in the reply) and
// must be checked against the protos once they are in hand: see buildSendRequest().

const SERVICE = 'truecaller.messenger.business.v2.BusinessApi';

type SendFn = (req: object, meta: grpc.Metadata, opts: grpc.CallOptions, cb: (err: grpc.ServiceError | null, res: Record<string, unknown>) => void) => void;
let client: (grpc.Client & { BusinessSendMessage: SendFn }) | null = null;

function protoFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.proto'))
    .map((f) => join(f.parentPath, f.name));
}

function getClient() {
  if (client) return client;
  const { apiBaseUrl, apiKey, protoDir } = { apiBaseUrl: config.tc.baseUrl, apiKey: config.tc.apiKey, protoDir: config.tc.protoDir };
  if (!apiBaseUrl || !apiKey) throw new Error('TC_API_BASE_URL and TC_API_KEY must be set to use the truecaller provider');
  if (!existsSync(protoDir) || !protoFiles(protoDir).length) {
    throw new Error(`No Truecaller .proto files found in ${protoDir}. Download them from the partner portal and set TC_PROTO_DIR.`);
  }

  const def = protoLoader.loadSync(protoFiles(protoDir), { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [protoDir] });
  const pkg = grpc.loadPackageDefinition(def);
  const Service = SERVICE.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], pkg) as grpc.ServiceClientConstructor | undefined;
  if (!Service) throw new Error(`${SERVICE} not found in the .proto files in ${protoDir}`);

  // TC_API_BASE_URL is the gRPC host, e.g. api.example.com:443 (TLS). grpc:// means plain text, for local tests only.
  const target = apiBaseUrl.replace(/^(grpcs?|https?):\/\//, '').replace(/\/$/, '');
  const creds = apiBaseUrl.startsWith('grpc://') ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  client = new Service(target, creds) as unknown as typeof client;
  return client!;
}

// v2 request shape as announced. Confirm the content field names against the proto.
export function buildSendRequest(req: SendRequest) {
  return {
    deduplication_id: req.messageId, // our message id, so a retried send is not delivered twice
    sender_id: req.senderId,
    recipient: { phone_number: req.to },
    ttl_seconds: config.tc.ttlSeconds,
    content: { text: req.body }, // rich text is always on in v2
  };
}

function send(req: SendRequest): Promise<Record<string, unknown>> {
  const c = getClient();
  const meta = new grpc.Metadata();
  meta.set('authorization', `Bearer ${config.tc.apiKey}`);
  return new Promise((resolve, reject) => {
    c.BusinessSendMessage(buildSendRequest(req), meta, { deadline: Date.now() + 15_000 }, (err, res) => {
      if (err) return reject(new Error(`Truecaller ${grpc.status[err.code] ?? err.code}: ${err.details || err.message}`));
      resolve(res);
    });
  });
}

// Webhook statuses mapped onto ours. Unknown values are ignored rather than guessed.
const STATUS: Record<string, MessageStatus> = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  SEEN: 'read',
  FAILED: 'failed',
  UNDELIVERED: 'failed',
  REJECTED: 'failed',
};

const pick = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => typeof v === 'string' && v) as string | undefined;

export function parseV2Webhook(body: unknown): StatusUpdate[] {
  const events = Array.isArray(body) ? body : Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : [body];
  const out: StatusUpdate[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const ev = e as Record<string, unknown>;
    const inner = (ev.message_status ?? ev.status_update ?? ev) as Record<string, unknown>;
    const id = pick(inner, ['message_id', 'messageId', 'id']) ?? pick(ev, ['message_id', 'messageId']);
    const raw = pick(inner, ['status', 'state', 'event']);
    const status = raw ? STATUS[raw.toUpperCase().replace(/^MESSAGE_STATUS_|^STATUS_/, '')] : undefined;
    if (!id || !status) continue;
    out.push({ providerMessageId: id, status, error: pick(inner, ['error', 'reason', 'error_message']), raw: e });
  }
  return out;
}

export function createTruecallerProvider(): MessagingProvider {
  return {
    name: 'truecaller',
    async send(req) {
      const res = await send(req);
      const id = pick(res, ['message_id', 'messageId', 'id']);
      if (!id) throw new Error('Truecaller accepted the send but returned no message id');
      return { providerMessageId: id, status: 'sent' };
    },
    parseWebhook: parseV2Webhook,
  };
}
