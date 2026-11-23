import type pg from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Notifications (master prompt §5): email and Slack on NEW findings and
 * recoveries, not on every run. Settings per project. Webhook payloads are
 * signed. P5 ships the interfaces + the storage; actual provider integrations
 * arrive at P6 (billing) or later.
 */

export type NotificationEvent =
  | { kind: 'new-findings'; count: number; sample: string[] }
  | { kind: 'recovery'; count: number; sample: string[] };

export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface SlackProvider {
  send(webhookUrl: string, text: string): Promise<void>;
}

/** Stub email provider — logs; real provider behind this interface at P6+. */
export const stubEmail: EmailProvider = {
  async send(to, subject) {
    console.log(`[email:stub] to=${to} subject="${subject}"`);
  },
};

/** Stub Slack provider — logs; real = incoming webhook POST. */
export const stubSlack: SlackProvider = {
  async send(webhookUrl, text) {
    console.log(`[slack:stub] ${webhookUrl.slice(0, 40)}… text="${text.slice(0, 60)}"`);
  },
};

/** Should this event trigger a notification? (only new findings + recoveries) */
export function shouldNotify(event: NotificationEvent): boolean {
  return event.kind === 'new-findings' || event.kind === 'recovery';
}

/** Sign a webhook payload with HMAC-SHA256. */
export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Verify a webhook signature in constant time. */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = signWebhookPayload(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deliver notifications for a diff result. */
export async function notify(
  pool: pg.Pool,
  projectId: number,
  event: NotificationEvent,
  deps: { email: EmailProvider; slack: SlackProvider },
): Promise<void> {
  if (!shouldNotify(event)) return;
  const settings = await pool.query<{ email_enabled: boolean; email: string; slack_enabled: boolean; slack_webhook_url: string }>(
    'SELECT ns.email_enabled, u.email, ns.slack_enabled, ns.slack_webhook_url FROM projects p JOIN notification_settings ns ON ns.project_id = p.id JOIN users u ON u.id = p.user_id WHERE p.id = $1',
    [projectId],
  ).catch(() => null);
  if (!settings || settings.rows.length === 0) return;
  const s = settings.rows[0]!;
  const subject = event.kind === 'new-findings' ? `[UIpocalypse] ${event.count} new finding${event.count === 1 ? '' : 's'}` : `[UIpocalypse] ${event.count} finding${event.count === 1 ? '' : 's'} recovered`;
  const body = event.sample.join('\n');
  if (s.email_enabled && s.email) await deps.email.send(s.email, subject, body).catch(() => undefined);
  if (s.slack_enabled && s.slack_webhook_url) await deps.slack.send(s.slack_webhook_url, `${subject}\n${body}`).catch(() => undefined);
}
