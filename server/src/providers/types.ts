export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'blocked';

export interface SendRequest {
  messageId: string;
  to: string; // E.164
  senderId: string;
  body: string;
}

export interface SendResult {
  providerMessageId: string;
  status: MessageStatus;
}

export interface StatusUpdate {
  providerMessageId: string;
  status: MessageStatus;
  error?: string;
  raw: unknown;
}

export interface MessagingProvider {
  name: string;
  send(req: SendRequest): Promise<SendResult>;
  // Turns a raw webhook body into status updates. Returns [] for payloads we don't understand.
  parseWebhook(body: unknown): StatusUpdate[];
}
