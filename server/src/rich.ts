import { z } from 'zod';
import { config } from './config.js';
import { newCode } from './links.js';
import { render } from './templates.js';

// What Truecaller accepts as attachments (Media management, API v2). Files are capped at 20 MB.
export const MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf', 'text/plain'] as const;
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export const MediaSchema = z.object({
  url: z.string().trim().url().refine((u) => u.startsWith('https://'), 'Media URL must be https'),
  mime_type: z.enum(MIME_TYPES),
  // Shown to the recipient for PDFs and text files, e.g. invoice.pdf.
  file_name: z.string().trim().max(100).optional(),
});

// Up to 3 buttons. Link buttons open a URL (https, or an app deep link); quick replies send their text back.
export const ButtonSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link'),
    text: z.string().trim().min(1).max(40),
    url: z.string().trim().min(1).max(1000).refine((u) => !/^http:\/\//i.test(u), 'Web links on buttons must use https'),
  }),
  z.object({ type: z.literal('reply'), text: z.string().trim().min(1).max(100) }),
]);
export const ButtonsSchema = z.array(ButtonSchema).max(3, 'Truecaller allows up to 3 buttons');

export type Media = z.infer<typeof MediaSchema>;
export type Button = z.infer<typeof ButtonSchema>;

// A button as sent: rendered text and URL, plus the action tag Truecaller echoes back on a tap.
export interface Action {
  type: 'link' | 'reply';
  text: string;
  url?: string;
  tag: string;
}

export interface ActionRow {
  code: string;
  url: string;
  kind: 'button' | 'button_direct' | 'reply';
  label: string;
}

// Renders a template's buttons for one contact. Every button gets a tag (a letter, then its code, to fit
// Truecaller's [a-zA-Z][a-zA-Z0-9_-]{2,}) so taps can be counted. With tracking on, link buttons go through
// /r/<code> so the click time is ours; without it they open the URL directly and the tap event counts.
export function buildActions(
  buttons: Button[],
  values: Record<string, string>,
  defaults: Record<string, string>,
  track: boolean,
): { actions: Action[]; rows: ActionRow[] } | { error: string } {
  const actions: Action[] = [];
  const rows: ActionRow[] = [];
  for (const b of buttons) {
    const text = render(b.text, values, defaults);
    if (text.error !== undefined) return { error: text.error };
    const code = newCode();
    if (b.type === 'reply') {
      actions.push({ type: 'reply', text: text.text!, tag: `r${code}` });
      rows.push({ code, url: '', kind: 'reply', label: text.text! });
      continue;
    }
    const url = render(b.url, values, defaults);
    if (url.error !== undefined) return { error: url.error };
    const target = url.text!;
    const web = /^https?:\/\//.test(target);
    const viaRedirect = track && web;
    actions.push({ type: 'link', text: text.text!, url: viaRedirect ? `${config.publicUrl}/r/${code}` : target, tag: `b${code}` });
    rows.push({ code, url: target, kind: viaRedirect ? 'button' : 'button_direct', label: text.text! });
  }
  return { actions, rows };
}

// The content block of BusinessSendMessage (business_api_v2.proto).
export function toContent(text: string, media?: Media | null, actions?: Action[]) {
  return {
    text,
    ...(media
      ? {
          media: {
            url: media.url,
            mime_type: media.mime_type,
            ...(media.file_name && !media.mime_type.startsWith('image/') && !media.mime_type.startsWith('video/')
              ? { file_metadata: { file_name: media.file_name } }
              : {}),
          },
        }
      : {}),
    ...(actions?.length
      ? {
          actions: actions.map((a) =>
            a.type === 'reply'
              ? { reply: { text: a.text, action_tag: a.tag } }
              : { deep_link: { uri: a.url, text: a.text, action_tag: a.tag } },
          ),
        }
      : {}),
  };
}
