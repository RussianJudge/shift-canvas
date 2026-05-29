# Schwifty Invites

Send personalized, branded invitation emails to every contact in your Resend audience. Each recipient gets:

- A greeting with their first name
- A unique signup token plus their email in the URL (`/signup?token=…&email=…`) so the form pre-fills
- The Schwifty wordmark logo and brand orange (`#FF6B1A`)
- Plaintext fallback link, footer, and unsubscribe header

## Quick start

```bash
cd "schwifty-invites"
npm install
cp .env.example .env
# fill in RESEND_API_KEY and AUDIENCE_ID at minimum
npm run dry-run     # prints what would be sent — no emails go out
npm run send        # send for real
```

## Required env vars

| Var               | Required | Notes                                                                |
| ----------------- | -------- | -------------------------------------------------------------------- |
| `RESEND_API_KEY`  | yes      | https://resend.com/api-keys                                          |
| `AUDIENCE_ID`     | yes      | UUID of the audience in Resend                                       |
| `FROM_EMAIL`      | yes      | Must be on a verified domain in Resend                               |
| `SIGNUP_BASE_URL` | yes      | Token gets appended as `?token=…`                                    |
| `LOGO_URL`        | no       | If empty, falls back to inlining `./public/schwifty-logo.png` base64 |
| `REPLY_TO`        | no       | Address that replies route to                                        |
| `SUBJECT`         | no       | Defaults to `You're invited to Schwifty`                             |
| `DRY_RUN`         | no       | `true` to preview only                                               |
| `SEND_INTERVAL_MS`| no       | Throttle between sends, default 600ms (~100/min)                     |

## About the logo

The base64 fallback works in most clients (Apple Mail, Outlook desktop, Yahoo) but **Gmail strips data URIs**. For a production blast, host the logo somewhere public and set `LOGO_URL`. Quick options:

- Upload `public/schwifty-logo.png` to your website at e.g. `https://schwifty.com/email/logo.png`
- Drop it into an S3/Cloudflare R2 bucket with a public URL
- Use Resend's own asset hosting if available, or any CDN

The image is referenced from the React Email template at `<Img src={logoUrl} … />`.

## Signup page behavior

Each invite link looks like:

```
https://schwifty-adambursey-3058s-projects.vercel.app/sign-up?token=<32-char-token>&email=<urlencoded-email>&first_name=<first>&last_name=<last>
```

**On the signup page (client-side prefill, no backend lookup needed):**

```js
const params = new URLSearchParams(window.location.search);
const email     = params.get('email')      ?? '';
const firstName = params.get('first_name') ?? '';
const lastName  = params.get('last_name')  ?? '';
const token     = params.get('token')      ?? '';

document.querySelector('#email').value      = email;
document.querySelector('#email').readOnly   = true;     // bound to the token

document.querySelector('#first_name').value = firstName;
document.querySelector('#last_name').value  = lastName;

document.querySelector('#token').value      = token;    // hidden field on submit
```

For Next.js (App Router) on Vercel:

```tsx
'use client';
import { useSearchParams } from 'next/navigation';

export default function SignUpForm() {
  const p = useSearchParams();
  return (
    <form>
      <input name="email"      defaultValue={p.get('email')      ?? ''} readOnly />
      <input name="first_name" defaultValue={p.get('first_name') ?? ''} />
      <input name="last_name"  defaultValue={p.get('last_name')  ?? ''} />
      <input type="hidden" name="token" value={p.get('token') ?? ''} />
      <input type="password" name="password" required />
      <button type="submit">Create account</button>
    </form>
  );
}
```

The visitor only needs to enter (and confirm) a password — name and email are pre-filled.

**On your signup endpoint (server-side validation — still required):**

When the script runs it writes a `tokens.json` file mapping each email to the issued token:

```json
{
  "alice@example.com": {
    "token": "8u7Y…32-char…",
    "sentAt": "2026-04-25T19:32:11.000Z",
    "messageId": "73a4f8b1-…"
  }
}
```

Import this map into your backend, then on POST `/signup`:

1. Look up the submitted `token` and confirm it matches the `email` it was issued to. If they don't match, reject — someone tampered with the URL.
2. Reject tokens older than your TTL (the email tells users the invite expires in 7 days; enforce that here).
3. Mark the token consumed once the account is created so it can't be reused.

> ⚠ **Don't trust the URL alone.** The email is in the URL only to populate the form for convenience — the *token* is what authorizes account creation. Always verify token → email on the server.

If a contact appears in `tokens.json` already and you re-run the script, **the existing token is reused** rather than re-generated. That makes the script idempotent — safe to re-run for failed sends.

## Preview the design without sending

```bash
npm run preview
```

Opens the React Email dev server at http://localhost:3000 with the template using sample preview props.

## Re-running and resends

- The script skips contacts whose `unsubscribed` flag is true.
- It checkpoints `tokens.json` every 10 contacts, so a crash won't cost you the tokens already issued.
- To resend just the failures, delete the corresponding entries from `tokens.json` (or the `sentAt` field) and re-run.

## Files

```
schwifty-invites/
├── emails/
│   └── InviteEmail.tsx     React Email template
├── public/
│   └── schwifty-logo.png   Brand wordmark
├── send-invites.ts         The sending script
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Note on Resend's contacts API

`resend.contacts.list({ audienceId })` returns the full audience in a single call (no cursor at the time of writing). If your audience grows past Resend's per-call cap, swap the `fetchAllContacts` helper to a paginated version.
