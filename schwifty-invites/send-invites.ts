/**
 * send-invites.ts
 *
 * Pulls every contact from a Resend audience and sends each one a personalized
 * Schwifty-branded invite email with a unique signup token.
 *
 * Usage:
 *   cp .env.example .env       # fill in your values
 *   npm install
 *   npm run dry-run            # preview without sending
 *   npm run send               # send for real
 *
 * The script writes a tokens.json file mapping each email to the token it was
 * issued. Persist this on your backend so you can validate the token when the
 * user lands on the signup page.
 */

import { Resend } from 'resend';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import InviteEmail from './emails/InviteEmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -------- env --------
const {
  RESEND_API_KEY,
  AUDIENCE_ID,
  FROM_EMAIL = 'invites@schwifty.com',
  FROM_NAME = 'Schwifty',
  REPLY_TO,
  SIGNUP_BASE_URL = 'https://schwifty-adambursey-3058s-projects.vercel.app/sign-up',
  SUBJECT = "You're invited to Schwifty",
  LOGO_URL,
  DRY_RUN = 'false',
  SEND_INTERVAL_MS = '600',
} = process.env;

if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY in env');
if (!AUDIENCE_ID) throw new Error('Missing AUDIENCE_ID in env');

const isDryRun = DRY_RUN.toLowerCase() === 'true';
const intervalMs = Math.max(0, Number.parseInt(SEND_INTERVAL_MS, 10) || 0);

const resend = new Resend(RESEND_API_KEY);

// -------- logo: prefer hosted URL; fall back to inlined base64 --------
function resolveLogo(): string {
  if (LOGO_URL && LOGO_URL.trim().length > 0) return LOGO_URL.trim();

  const localPath = path.join(__dirname, 'public', 'schwifty-logo.png');
  if (existsSync(localPath)) {
    const buf = readFileSync(localPath);
    const b64 = buf.toString('base64');
    console.warn(
      '⚠  No LOGO_URL set — inlining ./public/schwifty-logo.png as base64.\n' +
        '   Most clients render this fine, but Gmail strips data URIs.\n' +
        '   For production, host the logo and set LOGO_URL.',
    );
    return `data:image/png;base64,${b64}`;
  }

  throw new Error(
    'Logo not found: set LOGO_URL or place a file at ./public/schwifty-logo.png',
  );
}

const logoUrl = resolveLogo();

// -------- token persistence --------
type TokenRecord = { token: string; sentAt?: string; messageId?: string };
const tokensFile = path.join(__dirname, 'tokens.json');
const tokens: Record<string, TokenRecord> = existsSync(tokensFile)
  ? JSON.parse(readFileSync(tokensFile, 'utf8'))
  : {};

function saveTokens() {
  writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
}

function generateToken(): string {
  return randomBytes(24).toString('base64url'); // 32-char URL-safe
}

// -------- contact paging --------
type Contact = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed?: boolean;
};

async function fetchAllContacts(audienceId: string): Promise<Contact[]> {
  // Resend's contacts.list returns the full list (no cursor today).
  // If they add pagination later, this is the spot to update.
  const { data, error } = await resend.contacts.list({ audienceId });
  if (error) throw new Error(`Failed to list contacts: ${error.message}`);
  return (data?.data ?? []) as Contact[];
}

// -------- sender --------
async function sendOne(contact: Contact) {
  const existing = tokens[contact.email];
  const token = existing?.token ?? generateToken();
  const params = new URLSearchParams({
    token,
    email: contact.email,
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
  });
  const inviteUrl = `${SIGNUP_BASE_URL}?${params.toString()}`;
  const firstName = (contact.first_name?.trim() || '').split(' ')[0] || 'there';

  if (isDryRun) {
    console.log(`[dry-run] ${contact.email}  →  ${inviteUrl}`);
    tokens[contact.email] = { token };
    return;
  }

  const result = await resend.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: contact.email,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    subject: SUBJECT,
    react: InviteEmail({ firstName, inviteUrl, logoUrl }),
    tags: [{ name: 'campaign', value: 'invite' }],
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  tokens[contact.email] = {
    token,
    sentAt: new Date().toISOString(),
    messageId: result.data?.id,
  };
  console.log(`✔ ${contact.email}  (${result.data?.id})`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// -------- main --------
async function main() {
  console.log(
    `\nSchwifty invites — ${isDryRun ? 'DRY RUN' : 'LIVE'}\n` +
      `Audience: ${AUDIENCE_ID}\n` +
      `From:     ${FROM_NAME} <${FROM_EMAIL}>\n`,
  );

  const contacts = await fetchAllContacts(AUDIENCE_ID!);
  const eligible = contacts.filter((c) => !c.unsubscribed);
  const skipped = contacts.length - eligible.length;

  console.log(
    `Found ${contacts.length} contacts (${eligible.length} eligible, ${skipped} unsubscribed)\n`,
  );

  let sent = 0;
  let failed = 0;

  for (const [i, contact] of eligible.entries()) {
    try {
      await sendOne(contact);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`✘ ${contact.email}: ${(err as Error).message}`);
    }

    // checkpoint every 10
    if ((i + 1) % 10 === 0) saveTokens();

    if (intervalMs && i < eligible.length - 1 && !isDryRun) {
      await sleep(intervalMs);
    }
  }

  saveTokens();

  console.log(
    `\nDone. Sent: ${sent}  Failed: ${failed}  Skipped (unsubscribed): ${skipped}`,
  );
  console.log(`Token map written to ${path.relative(process.cwd(), tokensFile)}`);
  if (!isDryRun) {
    console.log(
      '→ Import tokens.json into your backend so the signup endpoint can validate ?token=… and link it to the right email.',
    );
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
