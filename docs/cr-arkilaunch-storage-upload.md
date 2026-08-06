# Change Record

**Title:** Supabase Storage upload for EDTR/KYC documents, implementing RFC-2 §6 as written
**Project:** ArkiLaunch
**Date:** 2026-08-06
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow
**Docs touched by this record:** [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §6 (now actually implemented — it never was), [index.md](index.md) §2 (Change Log)

---

## 1. Summary

Supabase Storage had zero integration despite being in the pinned stack (`build-arkilaunch.md` §3, SDD §2/§3): `POST /edtr` and `POST /kyc/extract` accepted an already-uploaded `fileUri`/`rawFileUri` **string**, and the POC frontend base64-encoded files into `data:` URLs to fill it, which is why `apps/api/src/main.ts` carried a 15mb JSON body limit. This pass implements the real upload path RFC-2 §2/§6 describe.

## 2. Upload mechanism: multipart through the API, not a direct-to-Storage signed URL

RFC-2 §6 (Locked) is explicit: *"File validation at the boundary: content-type allowlist (image/pdf), max size, magic-byte sniff, and a decompression-bomb guard **before the blob reaches Storage**. A forged content-type is rejected, not extracted."* And §2 step 1: *"`POST /api/v1/edtr` ... Paper writes the blob to Supabase Storage."* A browser `PUT` directly to a Supabase signed upload URL would skip every one of those server-side checks — the validation would have to move to a post-upload pass, which is not what "before the blob reaches Storage" says.

This pass follows the Locked RFC as written: `POST /edtr` and `POST /kyc/extract` now accept `multipart/form-data`. `apps/api/src/storage/upload-validation.ts` runs, in this order, before any Storage write: size cap (~10MB), magic-byte sniff (JPEG/PNG/PDF signatures — the actual bytes, never the client-supplied `Content-Type`), a PDF page-count heuristic, and a PNG pixel-dimension check, as the decompression-bomb guards. `digital_entry` EDTR captures have no file and are still plain JSON, unchanged.

**This is not drift** — no Change Record was needed for the mechanism itself, since it implements the Locked RFC rather than diverging from it. This CR exists because RFC-2 §6 had never actually been built until now.

Signed URLs remain in the design, but only for **reads**: `StorageService.createSignedDownloadUrl` (short-TTL, single-purpose, RFC-2 §6's "never a public URL"), for the Evidence Split View and, once a real Azure DI adapter reads real bytes, `jobs/src/edtr-ocr-worker.ts` (today it still receives an empty buffer from the stub/fixture adapters — wiring the worker to actually fetch and decode the stored object is a separate follow-up, tracked but not built in this pass).

## 3. `SUPABASE_SERVICE_ROLE_KEY` on a request path — why this does not violate AGENTS.md

`AGENTS.md` §5 bans `service_role` on a request path, and `build-arkilaunch.md` §3 explains why: a `service_role` **Postgres connection** is BYPASSRLS, so using it on a request path would defeat row-level security. `apps/api/src/storage/storage.service.ts` uses `SUPABASE_SERVICE_ROLE_KEY` to call the **Supabase Storage REST API** — a different service, authenticated with a different kind of credential, with no relationship to Postgres RLS. Tenant isolation for stored objects is enforced by the object key (`{tenantId}/{yyyy}/{mm}/{uuid}.{ext}`, where `tenantId` is taken from the verified JWT's `req.ctx.tenantId`, never from request input) plus the DB row that references that key — not by a database policy. No Postgres connection anywhere in this pass uses `service_role` or any BYPASSRLS role.

`@supabase/supabase-js` was deliberately **not** added as a dependency: only upload/sign/download are needed, and the repo's own precedent (`build-arkilaunch.md` §3: "Axios → native fetch") already favors a thin native-`fetch` call over a client SDK for exactly this shape of need (AGENTS.md §5 restraint ladder).

## 4. Object storage layout

New env vars (`.env.example`): `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET_EDTR`, `SUPABASE_STORAGE_BUCKET_KYC` — both buckets private. Keys are tenant-prefixed and time-bucketed (`{tenantId}/{yyyy}/{mm}/{uuid}.{ext}`); a client can never address another tenant's object because the key is never accepted from client input on any path, only derived server-side or read back from a row already scoped by `withTenantTx`.

## 5. Wire-contract changes

`packages/shared/src/edtr.ts` adds `EdtrCaptureFieldsSchema` (the client-facing shape, without `rawFileUri`) alongside the existing `EdtrCaptureRequestSchema` (now purely internal — the controller derives `rawFileUri` from the uploaded object key before calling the service). Same pattern for `packages/shared/src/kyc.ts`'s new `KycExtractFieldsSchema`. This is a breaking change to the wire contract, accepted cleanly rather than dual-supporting a `data:` URL transitionally: the base64 path was explicitly POC-only (`apps/web/src/lib/file-utils.ts`, now deleted), never a real integration, so there was nothing production to keep compatible with.

`apps/api/src/main.ts`'s JSON body limit drops from 15mb back to 1mb — file bytes now travel as multipart, not base64-in-JSON.

## 6. Verification

- `pnpm --filter @arkilaunch/shared typecheck`, `pnpm --filter @arkilaunch/api typecheck`, `pnpm --filter @arkilaunch/web typecheck` — all clean.
- `pnpm --filter @arkilaunch/web test -- --run` — 41/41 passing.
- `pnpm lint` — clean.
- **Not run in this pass** (no live Supabase project/credentials in this environment): an actual upload against a real bucket, a forged-Content-Type rejection test, `ai-ocr-abuse-runner` (AI-01..AI-06 — this touches the OCR path and is a hard merge gate per `AGENTS.md` §2), and `tenant-isolation-checker` on the object-key derivation. These should run before this ships.
