/**
 * render-html.ts
 *
 * Renders the InviteEmail React template to a static HTML file with Resend's
 * broadcast merge tags ({{{FIRST_NAME}}}, {{{EMAIL}}}) embedded, so you can
 * paste it directly into Resend → Broadcasts → New broadcast → Code editor.
 *
 * Usage:
 *   npx tsx --env-file=.env render-html.ts
 *   # writes ./template.html — paste its contents into Resend's HTML editor
 *
 * Note: broadcasts cannot inject unique per-user tokens. The signup link in
 * this output is the same generic URL for every recipient. If you need unique
 * tokens, use `npm run send` instead.
 */

import { render } from '@react-email/render';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import InviteEmail from './emails/InviteEmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  SIGNUP_BASE_URL = 'https://schwifty-adambursey-3058s-projects.vercel.app/sign-up',
  LOGO_URL,
} = process.env;

function resolveLogo(): string {
  if (LOGO_URL && LOGO_URL.trim().length > 0) return LOGO_URL.trim();
  const localPath = path.join(__dirname, 'public', 'schwifty-logo.png');
  if (existsSync(localPath)) {
    const b64 = readFileSync(localPath).toString('base64');
    console.warn(
      '⚠ No LOGO_URL — inlining base64. Gmail strips data URIs; host the logo for production.',
    );
    return `data:image/png;base64,${b64}`;
  }
  throw new Error('Logo not found');
}

const html = await render(
  InviteEmail({
    // Resend broadcast merge tags — substituted server-side per recipient.
    // FIRST_NAME / EMAIL are Resend's reserved contact variables.
    // (No |default pipe — set a fallback in Resend's variable settings instead;
    //  the inline pipe filter doesn't always survive the editor.)
    firstName: '{{{FIRST_NAME}}}',
    // Generic signup URL — broadcasts cannot inject unique tokens.
    // Email gets pre-filled via the {{{EMAIL}}} merge tag.
    inviteUrl: `${SIGNUP_BASE_URL}?email={{{EMAIL}}}&first_name={{{FIRST_NAME}}}&last_name={{{LAST_NAME}}}`,
    logoUrl: resolveLogo(),
    expiresInDays: 7,
  }),
);

const outFile = path.join(__dirname, 'template.html');
writeFileSync(outFile, html);
console.log(`Wrote ${html.length} chars to ${outFile}`);
console.log(
  '\nNext: open Resend → Broadcasts → New broadcast → switch the editor to HTML/Code view → paste the contents of template.html.',
);
