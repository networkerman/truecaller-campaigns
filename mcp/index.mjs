#!/usr/bin/env node
// MCP server for Truecaller Campaigns. Speaks stdio and calls the Campaigns API with a workspace API key.
//
// Auth: the key decides the workspace and is never passed as an argument. It is read from
//   1. TC_CAMPAIGNS_API_KEY, if set, or
//   2. the macOS Keychain item "truecaller-campaigns-mcp" (store it with ./login.sh).
// TC_CAMPAIGNS_URL points at the deployment (default https://truecaller.udchowdhury.me).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.TC_CAMPAIGNS_URL ?? 'https://truecaller.udchowdhury.me').replace(/\/$/, '');
const KEYCHAIN_SERVICE = 'truecaller-campaigns-mcp';

function apiKey() {
  if (process.env.TC_CAMPAIGNS_API_KEY) return process.env.TC_CAMPAIGNS_API_KEY;
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function call(method, path, body, contentType = 'application/json') {
  const key = apiKey();
  if (!key) throw new Error(`No API key. Run mcp/login.sh to store a workspace API key in the Keychain (service "${KEYCHAIN_SERVICE}").`);
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'x-api-key': key, ...(body !== undefined ? { 'content-type': contentType } : {}) },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${typeof data === 'string' ? data : data.error ?? JSON.stringify(data)}`);
  return data;
}

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ content: [{ type: 'text', text: err.message }], isError: true });
const tool = (fn) => async (args) => {
  try {
    return ok(await fn(args ?? {}));
  } catch (err) {
    return fail(err);
  }
};

const Category = z.enum(['promotional', 'transactional', 'service']);
const server = new McpServer({ name: 'truecaller-campaigns', version: '0.1.0' });

server.registerTool('health', {
  description: 'Check the deployment is up and which provider it sends through (mock or truecaller). No key needed.',
  inputSchema: {},
}, tool(async () => (await fetch(`${BASE_URL}/health`)).json()));

server.registerTool('list_senders', {
  description: 'Active senders for this workspace, plus pending sender requests.',
  inputSchema: {},
}, tool(() => call('GET', '/v1/senders')));

server.registerTool('list_templates', {
  description: 'Templates in this workspace with their status (draft, pending, approved, rejected) and category.',
  inputSchema: {},
}, tool(() => call('GET', '/v1/templates')));

server.registerTool('create_template', {
  description: 'Create a template. Use {{name}} style placeholders for variables; they are filled from list columns. Submit it before use.',
  inputSchema: { name: z.string(), category: Category, body: z.string().max(1000) },
}, tool((a) => call('POST', '/v1/templates', a)));

server.registerTool('submit_template', {
  description: 'Submit a template for approval.',
  inputSchema: { template_id: z.string().uuid() },
}, tool((a) => call('POST', `/v1/templates/${a.template_id}/submit`, {})));

server.registerTool('list_contact_lists', {
  description: 'Contact lists in this workspace with contact counts.',
  inputSchema: {},
}, tool(() => call('GET', '/v1/lists')));

server.registerTool('create_contact_list', {
  description:
    'Create a contact list and load contacts. Give exactly one source: csv (CSV text), csv_path (local .csv file), or url (public Google Sheet or CSV link). ' +
    'Needs a phone column (phone, mobile, ...); other columns become template variables.',
  inputSchema: {
    name: z.string(),
    csv: z.string().optional(),
    csv_path: z.string().optional(),
    url: z.string().optional(),
  },
}, tool(async (a) => {
  const sources = [a.csv, a.csv_path, a.url].filter(Boolean);
  if (sources.length !== 1) throw new Error('Give exactly one of csv, csv_path or url.');
  const list = await call('POST', '/v1/lists', { name: a.name });
  let loaded;
  if (a.url) {
    const source = /docs\.google\.com\/spreadsheets/.test(a.url) ? 'sheet' : 'url';
    loaded = await call('POST', `/v1/lists/${list.id}/contacts`, { source, url: a.url });
  } else {
    loaded = await call('POST', `/v1/lists/${list.id}/contacts`, a.csv ?? readFileSync(a.csv_path, 'utf8'), 'text/csv');
  }
  return { list, loaded };
}));

server.registerTool('send_message', {
  description:
    'Send ONE real message now. Give body, or template_id with variables. sender_id defaults to the workspace default sender. ' +
    'Phone numbers in international format, e.g. +919812345678.',
  inputSchema: {
    to: z.string(),
    body: z.string().max(1000).optional(),
    template_id: z.string().uuid().optional(),
    variables: z.record(z.string(), z.string()).optional(),
    sender_id: z.string().optional(),
    category: Category.optional(),
  },
}, tool((a) => call('POST', '/v1/messages', a)));

server.registerTool('get_message', {
  description: 'Status of one message with its event history (queued, sent, delivered, read, failed).',
  inputSchema: { message_id: z.string().uuid() },
}, tool((a) => call('GET', `/v1/messages/${a.message_id}`)));

server.registerTool('list_campaigns', {
  description: 'Campaigns in this workspace with status and live counts.',
  inputSchema: {},
}, tool(() => call('GET', '/v1/campaigns')));

server.registerTool('create_campaign', {
  description:
    'Create a campaign from an approved template and a contact list. With launch=true it starts sending real messages ' +
    'to the whole list right away (or at scheduled_at, ISO 8601). Without launch it stays a draft for launch_campaign.',
  inputSchema: {
    name: z.string(),
    template_id: z.string().uuid(),
    list_id: z.string().uuid(),
    sender_id: z.string().optional(),
    launch: z.boolean().optional(),
    scheduled_at: z.string().optional(),
  },
}, tool((a) => call('POST', '/v1/campaigns', a)));

server.registerTool('launch_campaign', {
  description: 'Start sending a draft campaign to its whole list (real messages).',
  inputSchema: { campaign_id: z.string().uuid(), scheduled_at: z.string().optional() },
}, tool((a) => call('POST', `/v1/campaigns/${a.campaign_id}/launch`, a.scheduled_at ? { scheduled_at: a.scheduled_at } : {})));

server.registerTool('cancel_campaign', {
  description: 'Stop a running or scheduled campaign. Messages already sent are not recalled.',
  inputSchema: { campaign_id: z.string().uuid() },
}, tool((a) => call('POST', `/v1/campaigns/${a.campaign_id}/cancel`, {})));

server.registerTool('get_campaign', {
  description: 'One campaign with live counts.',
  inputSchema: { campaign_id: z.string().uuid() },
}, tool((a) => call('GET', `/v1/campaigns/${a.campaign_id}`)));

server.registerTool('campaign_report', {
  description: 'Funnel (sent, delivered, read, failed), rates and failure reasons for a campaign.',
  inputSchema: { campaign_id: z.string().uuid() },
}, tool((a) => call('GET', `/v1/campaigns/${a.campaign_id}/report`)));

await server.connect(new StdioServerTransport());
