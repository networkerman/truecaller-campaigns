import { randomUUID } from 'node:crypto';
import type { MessagingProvider, StatusUpdate } from './types.js';

type Emit = (u: StatusUpdate) => Promise<void>;

// Behaves like the real channel: accepts the send, then reports delivered and read a moment later.
// Numbers ending in 0000 fail, so failure paths can be demoed too.
export function createMockProvider(emit: Emit): MessagingProvider {
  return {
    name: 'mock',
    async send(req) {
      const providerMessageId = `mock_${randomUUID()}`;
      const fail = req.to.endsWith('0000');
      setTimeout(() => {
        void emit(
          fail
            ? { providerMessageId, status: 'failed', error: 'Recipient not reachable on Truecaller', raw: null }
            : { providerMessageId, status: 'delivered', raw: null },
        );
      }, 500);
      if (!fail) setTimeout(() => void emit({ providerMessageId, status: 'read', raw: null }), 1500);
      return { providerMessageId, status: 'sent' };
    },
    parseWebhook() {
      return [];
    },
  };
}
