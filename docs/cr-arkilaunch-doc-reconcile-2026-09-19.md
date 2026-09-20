# Change Record

**Title:** Doc-reconcile pass: registers the audit corpus, folds the hand-edited DESIGN.md back into the Locked DSD, corrects four Locked docs against the code, and back-fills three shipped changes that never got a record
**Project:** ArkiLaunch
**Date:** 2026-09-19
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [audit-docs-drift.md](audit-docs-drift.md) — the docs-vs-code sweep of the 2026-09-19 full-system audit
**Docs touched by this record:** [index.md](index.md) §1/§2/§4/§5, [dsd-arkilaunch.md](dsd-arkilaunch.md) §2/§5/§8 (addenda), `DESIGN.md` (re-materialized), [rfc-arkilaunch-tenancy-rls-auth.md](rfc-arkilaunch-tenancy-rls-auth.md) §3 (addendum), [rfc-arkilaunch-ocr-edtr-reconciliation.md](rfc-arkilaunch-ocr-edtr-reconciliation.md) §2 (addendum), [prd-arkilaunch.md](prd-arkilaunch.md) §5.2/§8, [aia-arkilaunch.md](aia-arkilaunch.md) §1.2, `MODEL_CARD.md` (re-materialized), the four `audit-*.md` findings docs, `README.md`

---

## 1. Why this pass exists

The 2026-09-19 audit produced four findings documents and committed them (`daee28f`) without touching anything else. That was the right call for an audit and the wrong state to leave the registry in: `docs/index.md` is the manifest, and it did not know the four new documents existed. Worse, the same commit range revealed that a Change Record — `cr-arkilaunch-edtr-real-form.md` — had shipped without ever being added to §2. The change log had a hole in it, which is the one defect this documentation system exists to make impossible.

Underneath the registry problem, `audit-docs-drift.md` raised twelve content divergences between Locked docs and the code. Three of them are Locked documents describing a system that does not exist; one is a materialized artifact that has been hand-edited in violation of the rule its own canonical doc states; and three are shipped, user-visible changes with no Change Record at all.

This is a documentation-integrity pass. No application code changes here. The code-side findings from the other three audit documents are addressed in their own commits and are referenced, not repeated.

## 2. What was found

### 2.1 Six documents on disk that the manifest does not list

`docs/index.md` §1 lists 19 suite docs, 3 runbooks and 3 RFCs; §2 lists the Change Records. Unlisted anywhere: `audit-api-surface.md`, `audit-db-tenant-isolation.md`, `audit-docs-drift.md`, `audit-ocr-money-path.md`, `report-figma-route-alignment.md` (named in §2 prose but never linked), and `cr-arkilaunch-edtr-real-form.md`.

The last is the serious one. It is a Change Record for work that shipped; every other CR has a §2 row.

### 2.2 The index's self-reported counts and dates are wrong

§5's doc-count note says "the filesystem now holds 44 `docs/*.md` files"; it holds 53. `README.md` says 42. The §1 table's `Last Updated` column disagrees with git for five rows (AIA 2026-09-07 vs 09-16; OPS and UES 2026-08-20 vs 09-13; RFC-2 2026-09-16 vs 09-18; BUILD's row also trails). The file's own header date is 2026-09-07 while it was last edited 09-17.

This is the same "dead `Last Updated` dates" class `cr-arkilaunch-repo-cleanup-audit.md` fixed once already on 2026-09-13, three months of drift later. Recording the recurrence rather than presenting it as new: a registry that has to be hand-reconciled drifts again between passes, and nothing in this repo checks it.

### 2.3 to 2.7 — see the audit, not this record

The remaining ten divergences are written up in
[audit-docs-drift.md](audit-docs-drift.md) findings #1 to #12, with code citations, and each now
carries its disposition there. They are deliberately **not** restated here: a second copy would
have to be kept in sync with the first by hand, which is the failure mode this very pass exists to
correct. In short: `DESIGN.md` hand-edited away from the Locked DSD (#3); RFC-1's frozen permission
catalog, `owner` grant and `/app/kyc` path (#1, #5, #6); PRD §5.2's two non-existent checkout
routes (#7); the DSD font spec contradicting both its artifact and the code (#9); the
breakdown-status extraction claim reaching the AI dossier (#2); RFC-2 still describing the
superseded query-fields strategy (#8); and three shipped changes with no record (#4, #10, #11).
§3 below states what changed for each, and §4 carries the three back-filled records.

## 3. Changes made

1. **`index.md` §1** gains an **Audits** subsection listing the four `audit-*.md` documents with their status (`Findings`, not Locked) and a **Reports** row for `report-figma-route-alignment.md`. The materialized-artifacts paragraph stops claiming the other three artifacts are current and states DESIGN.md's position accurately.
2. **`index.md` §2** gains the missing `cr-arkilaunch-edtr-real-form` row and a row for this record.
3. **`index.md` §1/§5 and `README.md`** have their counts and `Last Updated` cells corrected against git, and the index header date bumped.
4. **DESIGN.md is reconciled toward the DSD, not away from it.** The hand-added content describes real shipped behaviour, so it is written into the Locked DSD — the five build-status annotations as a §5 implementation-status note, and the `weather-stale` rule as a §2 behavioural rule — and DESIGN.md is then re-materialized from the DSD. The artifact rule holds again and nothing is lost. The DSD's font spec is corrected to what ships in the same pass, since it contradicted both its own artifact and the code.
5. **RFC-1 §3 gains an addendum** reconciling the frozen permission catalog to the real `PERMISSION_CODES`, recording the `owner` grant deviation with the reasoning already in the seed, and correcting `/app/kyc` to `/app/registration`.
6. **RFC-2 §2 gains an addendum** narrowing the EDTR extraction description to `prebuilt-layout` tables and scoping `queryFields` to KYC.
7. **PRD §5.2** drops the two checkout routes that do not exist. **PRD §8, SDD §5 and AIA §1.2** drop breakdown status from what extraction produces, and `MODEL_CARD.md` is re-materialized from the corrected AIA.
8. **The three unrecorded changes are back-filled** as §4 entries below rather than as three new files, following the combined-record precedent of `cr-arkilaunch-doc-reconcile-2026-08-20.md`.
9. **The four audit documents are updated in place** as their findings close, and `audit-ocr-money-path.md`'s banner — which tells the reader to merge `fix/edtr-ocr-claim-and-stale-locks` as "the highest-value action in this document" — is corrected: that branch merged in PR #36 and its fixes are on `dev`.

## 4. Back-filled Change Records

These describe work already shipped. They are recorded now, late, rather than left unrecorded.

### 4.1 Pagination on the fleet, sites, incidents and rate-card reads (PR #26, 2026-09-15)

Four already-shipped endpoints changed response shape from a bare array to `{ items, total }`, with `limit`/`offset` query DTOs capped at 100, and the web app gained a `Pagination` component. **Not claimed:** the same pass left `GET /bookings` and `GET /tenants/applications` with no query DTO at all while the UI already sent `?limit=&offset=`, so those two lists silently returned page 1 for every page — found by `audit-api-surface.md` #4/#5 and fixed separately. SDD §4's endpoint contracts were not updated at the time; the paged shape is now the shipped one for these four.

### 4.2 Toast, modal and confirm-dialog primitives (PR #24, 2026-09-15)

`toast.tsx`, `modal.tsx` and `confirm-dialog.tsx` shipped with a confirmation step in front of consequential actions, and user-facing labels were rewritten across shipped screens. DSD §6 does not describe these primitives; they are Console-tier components and should be read as such until the DSD names them. **Not claimed:** no accessibility audit of the modal's focus trap is recorded.

### 4.3 The `/app` dashboard rebuilt as a control-room board (`79c432e`, 2026-09-17)

S4 Dashboard, a Locked-PRD screen, was rebuilt from a gauge row plus flat link grid into the console layout, with the nav config reorganised alongside it. The screen's identity and route are unchanged; its composition is not. **Not claimed:** PRD §5.1's frozen S1-S25 inventory is not renumbered, and the prototype alignment recorded in `cr-arkilaunch-figma-ia-alignment.md` covers routes that pass *added*, not this rebuild.

## 5. Deferred (explicit scope cuts, not gaps)

- **SDD §4 endpoint contracts are not rewritten** for the paged response shape beyond noting it in §4.1 above. The SDD is Locked and a full contract pass over four endpoints is its own record.
- **DSD §6 does not gain component specs** for toast/modal/confirm-dialog. Naming them in a CR is the honest minimum; specifying them properly is design work, not a reconciliation.
- **The `audit-api-surface.md` #11/#12 backlog** (2FA enrolment UI, and eight modules of write surface with no client) stays recorded and unbuilt. These are missing features, not defects, and each needs its own record plus an SDD §5 addition.
- **No automated check is added** for this class of drift. It has now been found by manual review three times (2026-08-20, 2026-09-13, and this pass). That is a finding about the process, and it is recorded in §4's Health Check rather than papered over with a claim that it will not recur.

## 6. Verification

- Every `docs/*.md` file is referenced from `index.md`; every relative link in `docs/` and in the four root artifacts resolves. Re-checked after this pass, not assumed.
- The doc count in `index.md` §5 and `README.md` matches `ls docs/*.md | wc -l`.
- `DESIGN.md` diffs clean against the DSD once the documented link-prefix rewrite is normalised, with no content living only in the artifact.
- `MODEL_CARD.md` diffs clean against AIA §1.
- Each finding in the four audit documents is marked with its disposition, and no finding is marked closed that is not closed in code on `dev`.
