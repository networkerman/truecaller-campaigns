import { config } from '../config.js';
import type { MessagingProvider } from './types.js';

// Placeholder until the Truecaller Business Messaging API spec is in hand.
// Fill in the send call and the webhook mapping here; nothing else needs to change.
export function createTruecallerProvider(): MessagingProvider {
  return {
    name: 'truecaller',
    async send() {
      if (!config.tc.baseUrl || !config.tc.apiKey) {
        throw new Error('TC_API_BASE_URL and TC_API_KEY must be set to use the truecaller provider');
      }
      throw new Error('Truecaller send not wired yet: waiting on API spec');
    },
    parseWebhook() {
      return [];
    },
  };
}
