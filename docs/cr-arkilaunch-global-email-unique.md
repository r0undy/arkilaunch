# Change Record

**Title:** One account per email; registration, invite and ID-scan fixes
**Project:** ArkiLaunch
**Date:** 2026-09-28
**Version:** 0.1
**Status:** `Applied` (branch `fix/registration-email-kyc-site-proof`)
**Trigger doc:** owner bug report 2026-09-28 (two accounts on one Gmail; "Something went wrong submitting your application"; a clear ID screenshot flagged unclear; site proof pickers easy to miss)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 `users.email`, [index.md](index.md) §2

---

## 1. One account per email, platform-wide

**Before:** `users_tenant_email_uq (tenant_id, email)` was the only constraint.
- `customer_register` checked other tenants in code only, so two concurrent signups could both pass.
- `tenants_register` refused only an owner who had not activated yet.
- Staff invites were checked per tenant.
- `juan.dc@gmail.com`, `juandc@gmail.com` and `juandc+x@googlemail.com` were three different accounts.

**After (migration `0063_global_email_unique.sql`):**
- **`email_key(text)`** (IMMUTABLE) builds the comparison key. It trims and lowercases the address. For `gmail.com` / `googlemail.com` it also drops the dots and any `+tag` from the local part, and uses the domain `gmail.com`.
- **`users_email_key_uq`** is a unique index on `email_key(email)`. It is the rule itself, and it holds for every write path, RLS or not.
- **Pre-flight:** the migration refuses to run over existing duplicates and lists them. Nobody's login is rewritten; resolve the duplicates by hand, then re-run.
- **The functions:** `customer_register` and `tenants_register` compare keys. `tenants_register` now refuses any existing account on the email (`email_taken`), after its unchanged `duplicate_pending_application` guard.
- **Every path answers 409 `email_taken`:** customer signup, `/tenants/register` and `POST /users`. That covers a concurrent write that loses on the index (`tenant-register.ts` `isEmailTaken`).

**Accepted consequence:**
- A person with a customer account can't reuse that email to register a rental company or to be staff elsewhere.
- One customer login can already hold several companies (`account.companies`).

**Not changed:**
- Login still matches the email exactly as it was stored, within the request host's tenant (0048).
- Stored emails keep their dots and +tags.

## 2. Postgres errors read off Drizzle's `cause`

drizzle-orm 0.44 throws `DrizzleQueryError`, which carries the Postgres error on `cause`. As a result, the checks on `err.code` never matched: `isDuplicatePendingApplication`, `isSlugCollision`, the users service's unique and FK checks, and `DbErrorFilter`'s 22P02 check. Their 409/422/400 answers were 500s. All of them now go through `pgError()` in `packages/db/src/pg-error.ts`.

## 3. `/register/company` says what is wrong

- **TIN and SEC number** are normalized on blur and on submit (`normalizeTin` / `normalizeSecNumber`), with the same `pattern` and hints as the account company form.
- **A zod 400** names the field it failed on. A field from step 1 sends the visitor back to `/register`.
- **Other answers** (`email_taken`, 429, a missing step-1 draft) each get their own message instead of "Something went wrong".

## 4. The ID scan's "hard to read" hint

- **The old warning:** "This photo looks unclear, so it may be sent back to you." It was the minimum Azure `queryFields` confidence over every ID field. That included sex, which is not printed on the front of a PhilSys card, and middle name, which is often blank. Both are guessed at low confidence even on a sharp screenshot. Nothing has been sent back since commit `36a4a45`.
- **The customer scan (`scanDocument`) now:**
  - leaves out sex and middle name (`SCAN_HINT_EXCLUDED`)
  - scores only values that passed their format check
  - shows "Some details were hard to read. Check each one against your card before continuing." as a warning Alert
- **Unchanged:** the staff read (`analyzeDocument`) and its stored confidence, which feeds the 0.90 RFC-2 review gate.

## 5. Site proof pickers

`SiteProofFields` shows its two file inputs as pill buttons, "Upload document" and "Take or choose a photo", with the chosen file's name beside each.
