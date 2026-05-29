/**
 * backfill-names.ts
 *
 * Patches first_name / last_name on contacts that are already in your Resend
 * audience. Use this when your original CSV import dropped the name columns
 * because of a header mismatch — instead of re-importing, you update the
 * existing contacts in place.
 *
 * Setup:
 *   1. Put your CSV at ./contacts.csv
 *   2. The CSV must have an `email` column and any of:
 *        first_name, last_name
 *      (case-insensitive; "First Name", "FirstName", "fname" all work)
 *   3. Make sure RESEND_API_KEY and AUDIENCE_ID are set in .env
 *
 * Run:
 *   npm run backfill-names           # live update
 *   DRY_RUN=true npm run backfill-names   # preview only
 */

import { Resend } from 'resend';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  RESEND_API_KEY,
  AUDIENCE_ID,
  CSV_PATH = path.join(__dirname, 'contacts.csv'),
  DRY_RUN = 'false',
} = process.env;

if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY in env');
if (!AUDIENCE_ID) throw new Error('Missing AUDIENCE_ID in env');
if (!existsSync(CSV_PATH)) {
  throw new Error(`CSV not found at ${CSV_PATH}. Place your file at ./contacts.csv or set CSV_PATH.`);
}

const isDryRun = DRY_RUN.toLowerCase() === 'true';
const resend = new Resend(RESEND_API_KEY);

// -------- minimal CSV parser (handles quoted fields with commas) --------
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const splitRow = (row: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQuotes) {
        if (ch === '"' && row[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const rawHeader = splitRow(lines[0]);
  // Normalize headers: lowercase, strip spaces, map common aliases.
  const header = rawHeader.map((h) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, '_');
    if (k === 'firstname' || k === 'fname' || k === 'given_name') return 'first_name';
    if (k === 'lastname' || k === 'lname' || k === 'surname' || k === 'family_name')
      return 'last_name';
    if (k === 'e-mail' || k === 'mail' || k === 'email_address') return 'email';
    return k;
  });

  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

// -------- main --------
async function main() {
  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  console.log(`Parsed ${rows.length} rows from ${path.basename(CSV_PATH)}`);

  const headers = Object.keys(rows[0] ?? {});
  console.log(`Detected columns: ${headers.join(', ')}`);
  if (!headers.includes('email')) {
    throw new Error('CSV needs an `email` column (or "Email" / "email_address" — they get normalized).');
  }
  if (!headers.includes('first_name') && !headers.includes('last_name')) {
    throw new Error('CSV needs at least a first_name or last_name column.');
  }

  // Build lookup: email -> { first_name, last_name }
  const csvByEmail = new Map<string, { first_name?: string; last_name?: string }>();
  for (const row of rows) {
    const email = row.email?.toLowerCase();
    if (!email) continue;
    csvByEmail.set(email, {
      first_name: row.first_name || undefined,
      last_name: row.last_name || undefined,
    });
  }

  // Fetch the existing audience.
  const { data, error } = await resend.contacts.list({ audienceId: AUDIENCE_ID! });
  if (error) throw new Error(`Failed to list contacts: ${error.message}`);
  const contacts = (data?.data ?? []) as Array<{
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
  }>;
  console.log(`Audience has ${contacts.length} contacts\n`);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;

  for (const contact of contacts) {
    const fromCsv = csvByEmail.get(contact.email.toLowerCase());
    if (!fromCsv) {
      missing += 1;
      continue;
    }

    // Only update if there's something to change.
    const newFirst = fromCsv.first_name ?? contact.first_name;
    const newLast = fromCsv.last_name ?? contact.last_name;
    const same =
      (newFirst ?? '') === (contact.first_name ?? '') &&
      (newLast ?? '') === (contact.last_name ?? '');
    if (same) {
      skipped += 1;
      continue;
    }

    if (isDryRun) {
      console.log(
        `[dry-run] ${contact.email}: "${contact.first_name ?? ''}|${contact.last_name ?? ''}" → "${newFirst ?? ''}|${newLast ?? ''}"`,
      );
      updated += 1;
      continue;
    }

    try {
      const res = await resend.contacts.update({
        id: contact.id,
        audienceId: AUDIENCE_ID!,
        firstName: newFirst,
        lastName: newLast,
      });
      if (res.error) throw new Error(res.error.message);
      console.log(`✔ ${contact.email}  (${newFirst ?? ''} ${newLast ?? ''})`);
      updated += 1;
    } catch (err) {
      console.error(`✘ ${contact.email}: ${(err as Error).message}`);
      failed += 1;
    }
  }

  console.log(
    `\nDone. Updated: ${updated}  Skipped (already matched): ${skipped}  Missing from CSV: ${missing}  Failed: ${failed}`,
  );
  if (isDryRun) console.log('(DRY_RUN was set — no changes were sent to Resend.)');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
