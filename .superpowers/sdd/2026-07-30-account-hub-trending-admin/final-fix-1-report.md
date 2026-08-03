# Final Fix 1 Report

Date: 2026-08-03
Branch: `feat/account-hub-trending-admin`
Starting commit: `60729f4f8edd1426c820af8d3b3872b7e02ed7ae`

## Outcome

The final broad-review findings are implemented and locally verified:

- Public feeds, creator posts, direct post reads, private-media authorization,
  favorites, likes, history, and unlocked lists now share the exact canonical
  publishable set: `free`, `members`, and `purchase`. Moderated or workflow-only
  states fail closed even when the viewer retains an entitlement or subscription.
- Favorites and unlocked DTOs now carry their canonical database creator and
  relationship timestamp; account cards no longer substitute demo creator data.
- Sign-in callback consumers use one same-origin path sanitizer. Protocol-relative,
  backslash, encoded separator, malformed encoding, control-character, and external
  callbacks fall back to `/` (or `/admin` for admin sign-in).
- Deployment smoke tests no longer use a server-token bypass. They sign in through
  Better Auth, keep the session in a temporary cookie jar, and permit credentials
  and cookies only to a loopback smoke origin. Smoke secrets are not logged or
  passed to the web container.
- All 25 state-changing admin routes are represented exactly once in the audit
  inventory. The six uncovered finance actions now write one audit record in the
  same transaction as their mutation. Creator-level create/update, pricing
  create/publish, and payment-channel update were also moved from split mutation
  and audit writes into the same transaction.
- The shared `auditAdminMutation` primitive is used by all 11 newly covered or
  hardened flows. Its PostgreSQL-gated rollback test proves one audit for success,
  no audit for a failed mutation, and rollback of both mutation and audit.

## TDD evidence

The first focused runs were red for the intended missing contracts:

- account hardening tests could not resolve `lib/safe-callback` and
  `lib/post-visibility`;
- deployment readiness failed three focused assertions because the deploy and
  smoke flow still depended on the admin token bypass;
- the admin audit inventory test could not resolve `lib/admin-audit-matrix`.

After implementation, the final canonical production-server run was:

```text
npx playwright test \
  tests/account-hub-data.spec.ts \
  tests/account-hub-api.spec.ts \
  tests/account-hub-ui.spec.ts \
  tests/admin-information-architecture.spec.ts \
  tests/final-fix-1-account.spec.ts \
  tests/production-readiness.spec.ts \
  --project=desktop --workers=1

73 passed, 34 skipped, 0 failed (107 total; 56.8 seconds Playwright time)
```

The 34 skips were expected local database/mobile gates. This checkout had no live
`DATABASE_URL`, so the new moderated-content and transactional rollback cases must
execute—not skip—during seeded PostgreSQL staging acceptance.

## Final verification

- `npx tsc --noEmit --incremental false`: exit 0 (27.3 seconds).
- `npm run lint`: exit 0 (15.2 seconds).
- `npm run build`: exit 0 (143.1 seconds), compiled successfully and generated
  all 36 static pages. The only messages were the existing Better Auth warning
  caused by not placing a real staging secret in local build output.
- Shell smoke/deploy syntax and Node smoke syntax: exit 0.
- `git diff --check`: exit 0.
- The first production build attempt timed out because a prior local dev-server
  child remained alive and wrote to `.next`. After stopping the exact process tree,
  validating port closure, and clearing only the ignored worktree cache, the clean
  build above passed. No test server remains on port 3001.

## Staging requirements

- Use a seeded active `AdminAccount` for `SMOKE_ADMIN_EMAIL` and
  `SMOKE_ADMIN_PASSWORD`; never commit real credentials.
- Run the complete deployed suite with one worker and require the PostgreSQL-gated
  visibility, account-pagination, audit rollback, ACL, and finance cases to execute
  with zero unexpected skips or failures.
- Keep `SMOKE_BASE_URL` loopback for the credentialed smoke runners.
- Record the deployed commit and confirm it matches checkout and runtime health.

## Protected scope

`README.md`, `start-local-demo.cmd`, real `.env.staging`/`.env.production` files,
secrets, and `.superpowers/sdd/2026-07-30-account-hub-trending-admin/progress.md`
were not modified.

## Round 2: channel visibility hardening

Starting commit: `b641d7e49df4f2ef9a7f04d9b3463873e786ee57`

### Outcome

- Readable public and member channel feeds apply the canonical post
  publishability predicate (`free`, `members`, or `purchase`) in the Prisma
  `ChannelPost` `where` clause, alongside active status, exclusions, and the
  stable cursor predicate. Hidden rows therefore cannot consume the 21-row
  window or create gaps between cursor pages.
- Manual channel curation looks up the requested post through the same canonical
  predicate. Missing, hidden, unpublished, pending, and removed posts all return
  the same `404` response and no curation row is created.
- Rule materialization filters candidates through the same predicate before
  activation. Existing non-publishable rule rows are removed by the next
  materialization instead of being inserted or reactivated.
- A retained active manual curation becomes unreadable immediately when its post
  is moderated. Its row, order, and pin metadata remain intact; publishing the
  post again makes that same curation row readable automatically. A rule-source
  row is marked removed during materialization and the same row is reactivated
  by the next materialization after republish.
- The authorized dashboard curation list remains unfiltered so curators can see
  and manage retained rows. It serializes curation identity/status and only the
  post creation timestamp, not hidden post title, excerpt, content, visibility,
  media, or entitlement data. Private membership and post-entitlement checks were
  not changed.

### TDD and verification evidence

The focused deterministic contract first failed because
`channelPostFeedWhere` did not exist. After the canonical predicate was wired
through all three paths, that test passed.

- `tests/final-fix-2-channels.spec.ts`, desktop, one worker: `1 passed`,
  `3 expected PostgreSQL skips`, `0 failed` (7.7 seconds, final rerun).
- Targeted Phase 7 channel/search ACL suite, desktop, one worker: `10 passed`,
  `3 expected PostgreSQL skips`, `0 failed` (6.9 seconds).
- `npx tsc --noEmit --incremental false`: exit `0` (25.6 seconds, final rerun).
- Scoped ESLint for both changed channel modules and the new test: exit `0`
  (9.5 seconds, final rerun).
- `npm run build`: exit `0` (127.8 seconds), compiled successfully and generated
  all `36/36` static pages. Output contained only the existing local Better Auth
  default-secret warnings.

The three focused database cases were collected but skipped because this
checkout has no live `DATABASE_URL`. Seeded PostgreSQL staging must run them
without skips: anonymous/public and private/member feed filtering with a hidden
row between cursor pages, identical manual-add refusal for missing and all
non-publishable posts, rule candidate exclusion/reactivation, and
moderation-after-curation disappearance/reappearance.

Round 2 also left `README.md`, `start-local-demo.cmd`, real environment files,
secrets, and `progress.md` untouched.
