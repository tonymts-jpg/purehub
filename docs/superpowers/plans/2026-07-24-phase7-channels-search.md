# PureHub Phase 7 Channels And Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reviewed official/creator channels, explicit Owner/Editor/Member ACLs, private invitations and applications, mixed curation, and PostgreSQL full-text/trigram search as a staging-deployable Phase 7 release.

**Architecture:** Extend the existing Prisma/PostgreSQL data layer with a unified channel aggregate, durable idempotent worker jobs, and a relational search projection. Route handlers continue to use Phase 6 database sessions and `AdminAccount` authorization; all channel state changes and audit/job records are transactional. Public, creator-dashboard, and admin interfaces consume focused repository modules rather than embedding Prisma logic in components.

**Tech Stack:** Next.js 15 App Router, TypeScript, React, Prisma, PostgreSQL 16, `pg_trgm`, Better Auth database sessions, Redis rate limiting, Playwright, Docker Compose.

## Global Constraints

- Work only in `C:\Users\tonym\Desktop\Codex Project\Purehub Plan`.
- Keep `README.md` and `start-local-demo.cmd` out of every Phase 7 commit.
- Use the approved design in `docs/superpowers/specs/2026-07-24-phase7-channels-search-design.md`.
- Approved creators receive level 1/2/3 default quotas of 1/3/5 channels.
- All creator channels, public or private, require admin review before activation.
- Private discoverability is exactly `discoverable | hidden`.
- Roles are exactly `owner | editor | member`.
- Manual exclusions override manual inclusion and every automatic rule.
- Channel membership never grants post purchase, subscription, or private-media entitlement.
- Search uses PostgreSQL `tsvector` plus `pg_trgm`; do not add an external search service.
- Use `npm run db:generate`, never `npx prisma generate`.
- Keep real auth, storage, payment, invitation, and admin secrets out of Git.
- Run deployed Playwright with one worker because the suite mutates shared seeded state.

---

## File Map

Create:

- `lib/channels/types.ts`: channel enums, DTOs, cursor types, and validation constants.
- `lib/channels/auth.ts`: channel ACL resolution and role assertions.
- `lib/channels/repository.ts`: channel lifecycle, quota, membership, invitation, curation, and audit transactions.
- `lib/channels/jobs.ts`: durable job enqueue/claim/complete/fail and curation materialization.
- `lib/search/repository.ts`: search-document synchronization and ranked PostgreSQL queries.
- `app/api/channels/route.ts`
- `app/api/channels/[slug]/route.ts`
- `app/api/channels/[slug]/join-requests/route.ts`
- `app/api/channels/[slug]/membership/route.ts`
- `app/api/channels/invitations/[token]/route.ts`
- `app/api/search/route.ts`
- `app/api/dashboard/channels/route.ts`
- `app/api/dashboard/channels/[id]/route.ts`
- `app/api/dashboard/channels/[id]/submit/route.ts`
- `app/api/dashboard/channels/[id]/members/route.ts`
- `app/api/dashboard/channels/[id]/members/[membershipId]/route.ts`
- `app/api/dashboard/channels/[id]/invitations/route.ts`
- `app/api/dashboard/channels/[id]/posts/route.ts`
- `app/api/dashboard/channels/[id]/posts/[channelPostId]/route.ts`
- `app/api/dashboard/channels/[id]/rules/route.ts`
- `app/api/dashboard/channels/[id]/rules/[ruleId]/route.ts`
- `app/api/dashboard/channels/[id]/exclusions/route.ts`
- `app/api/dashboard/channels/[id]/exclusions/[exclusionId]/route.ts`
- `app/api/admin/channels/route.ts`
- `app/api/admin/channels/[id]/route.ts`
- `app/api/admin/channels/[id]/review/route.ts`
- `app/api/admin/channels/[id]/suspend/route.ts`
- `app/api/admin/channels/[id]/restore/route.ts`
- `app/api/admin/channels/[id]/takeover/route.ts`
- `app/api/admin/channels/quotas/[userId]/route.ts`
- `app/api/admin/search/reindex/route.ts`
- `app/api/internal/phase7/run/route.ts`
- `app/channels/page.tsx`
- `app/channels/[slug]/page.tsx`
- `app/search/page.tsx`
- `app/dashboard/channels/page.tsx`
- `components/channels/channel-card.tsx`
- `components/channels/channel-membership-action.tsx`
- `components/channels/channel-feed.tsx`
- `components/channels/channel-manager.tsx`
- `components/search/search-results.tsx`
- `tests/phase7-channels-search.spec.ts`
- `prisma/migrations/20260724000000_phase7_channels_search/migration.sql`

Modify:

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `lib/platform-config.ts`
- `lib/admin-auth.ts`
- `lib/types.ts`
- `scripts/worker.mjs`
- `scripts/smoke-test.mjs`
- `app/api/health/route.ts`
- `app/api/platform/rules/route.ts`
- `app/admin/page.tsx`
- `.env.example`
- `docker-compose.yml`
- `tests/production-readiness.spec.ts`

## Shared Interfaces

Define these once in `lib/channels/types.ts` and import them everywhere:

```ts
export const CHANNEL_KINDS = ["official", "creator"] as const;
export const CHANNEL_VISIBILITIES = ["public", "private"] as const;
export const CHANNEL_DISCOVERABILITY = ["discoverable", "hidden"] as const;
export const CHANNEL_STATUSES = ["draft", "pending", "active", "rejected", "suspended", "archived"] as const;
export const CHANNEL_ROLES = ["owner", "editor", "member"] as const;
export const CHANNEL_MEMBER_STATUSES = ["invited", "pending", "active", "rejected", "removed"] as const;
export const CHANNEL_POST_POLICIES = ["direct", "approval_required"] as const;
export const CHANNEL_RULE_KINDS = ["category", "tag", "creator"] as const;
export const CHANNEL_QUOTAS = { "level-1": 1, "level-2": 3, "level-3": 5 } as const;

export type ChannelRole = (typeof CHANNEL_ROLES)[number];
export type ChannelAccess = {
  canRead: boolean;
  canManage: boolean;
  canCurate: boolean;
  canManageMembers: boolean;
  role: ChannelRole | null;
};
export type ChannelCursor = { pinnedAt: string | null; position: number | null; createdAt: string; id: string };
export type SearchCursor = { rank: number; publishedAt: string; entityType: "post" | "creator" | "channel"; entityId: string };
```

Repository functions used by route handlers:

```ts
getChannelAccess(userId: string | null, channelId: string): Promise<ChannelAccess>
getCreatorChannelQuota(userId: string): Promise<{ used: number; limit: number; levelId: string; overridden: boolean }>
createChannel(actorUserId: string, input: CreateChannelInput, admin?: AdminContext): Promise<ChannelDto>
submitChannel(actorUserId: string, channelId: string): Promise<ChannelDto>
reviewChannel(admin: AdminContext, channelId: string, decision: "approved" | "rejected", note: string): Promise<ChannelDto>
listChannels(input: ListChannelsInput, viewerUserId: string | null): Promise<{ channels: ChannelDto[]; nextCursor: string | null }>
getChannelBySlug(slug: string, viewerUserId: string | null, cursor?: string): Promise<ChannelDetailDto>
enqueueChannelJob(tx: Prisma.TransactionClient, input: ChannelJobInput): Promise<void>
runPhase7Jobs(limit: number): Promise<{ claimed: number; completed: number; failed: number }>
searchEntities(input: SearchInput, viewerUserId: string | null): Promise<{ results: SearchResult[]; nextCursor: string | null }>
```

### Task 1: Phase 7 Capability Contract

**Files:**
- Modify: `lib/platform-config.ts`
- Modify: `app/api/health/route.ts`
- Modify: `app/api/platform/rules/route.ts`
- Modify: `tests/production-readiness.spec.ts`

**Produces:** `CHANNEL_RULES` and externally testable Phase 7 capability markers.

- [ ] **Step 1: Write the failing readiness assertions**

Extend `tests/production-readiness.spec.ts`:

```ts
expect(body.capabilities).toMatchObject({
  channels: true,
  channelAcl: true,
  postgresSearch: true
});
expect(body.channels).toEqual({
  kinds: ["official", "creator"],
  visibilities: ["public", "private"],
  discoverability: ["discoverable", "hidden"],
  roles: ["owner", "editor", "member"],
  creatorLevelQuotas: { "level-1": 1, "level-2": 3, "level-3": 5 }
});
```

- [ ] **Step 2: Verify the assertions fail**

Run: `npm run test:e2e -- tests/production-readiness.spec.ts --project=desktop`

Expected: failure because `channels`, `channelAcl`, `postgresSearch`, and `body.channels` are absent.

- [ ] **Step 3: Add the shared platform contract**

Add `CHANNEL_RULES` to `lib/platform-config.ts` with the exact values above.
Expose the three capability booleans from `/api/health` and expose
`channels: CHANNEL_RULES` from `/api/platform/rules`.

- [ ] **Step 4: Verify readiness**

Run: `npm run test:e2e -- tests/production-readiness.spec.ts --project=desktop`

Expected: all production-readiness tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/platform-config.ts app/api/health/route.ts app/api/platform/rules/route.ts tests/production-readiness.spec.ts
git commit -m "Add Phase 7 channel capability contract"
```

### Task 2: Channel Schema, PostgreSQL Search Projection, And Seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724000000_phase7_channels_search/migration.sql`
- Modify: `prisma/seed.ts`
- Create: `tests/phase7-channels-search.spec.ts`

**Produces:** Prisma clients for channel aggregates and PostgreSQL search tables.

- [ ] **Step 1: Add failing seed/schema acceptance**

Create `tests/phase7-channels-search.spec.ts` with a phase guard matching Phase 6
and an initial test that signs in as admin, requests `GET /api/admin/channels`,
and expects seeded slugs `purehub-official`, `yuki-studio`, and
`private-curators`.

- [ ] **Step 2: Verify the endpoint/schema is absent**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop`

Expected: `404` from `/api/admin/channels`.

- [ ] **Step 3: Add Prisma relations and models**

Add User relations for owned/created channels, memberships, invitations,
channel actions, quota override, and jobs. Add Post relations for channel posts,
exclusions, and search synchronization. Implement the exact models and states
from the design spec:

```prisma
model Channel {
  id                 String   @id @default(cuid())
  slug               String   @unique
  name               String
  description        String
  avatarAssetId      String?
  coverAssetId       String?
  kind               String
  visibility         String
  discoverability    String
  status             String   @default("draft")
  ownerUserId        String
  createdByUserId    String
  memberPostPolicy   String   @default("approval_required")
  reviewNote         String?
  reviewedByAdminId  String?
  reviewedAt         DateTime?
  suspendedAt        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  owner              User     @relation("ChannelOwner", fields: [ownerUserId], references: [id])
  createdBy          User     @relation("ChannelCreator", fields: [createdByUserId], references: [id])
  memberships        ChannelMembership[]
  posts              ChannelPost[]
  rules              ChannelRule[]
  exclusions         ChannelPostExclusion[]
  invitations        ChannelInvitation[]
  jobs               ChannelJob[]
  @@index([status, visibility, createdAt])
  @@index([ownerUserId, status])
}
```

Add `ChannelMembership`, `ChannelPost`, `ChannelRule`,
`ChannelPostExclusion`, `ChannelQuotaOverride`, `ChannelInvitation`,
`ChannelJob`, and `SearchDocument` with every field and unique/index constraint
specified by the design spec. Add `ChannelPost @@unique([channelId, postId])`,
`ChannelMembership @@unique([channelId, userId])`,
`ChannelPostExclusion @@unique([channelId, postId])`,
`ChannelQuotaOverride.userId @unique`, `ChannelInvitation.tokenHash @unique`,
`ChannelJob.idempotencyKey @unique`, and
`SearchDocument @@unique([entityType, entityId])`.

- [ ] **Step 4: Generate and customize the migration**

Run: `npm run db:migrate:dev -- --name phase7_channels_search`

Then add to the generated SQL:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "SearchDocument"
  ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("keywords", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("body", '')), 'C')
  ) STORED;
CREATE INDEX "SearchDocument_searchVector_idx" ON "SearchDocument" USING GIN ("searchVector");
CREATE INDEX "SearchDocument_title_trgm_idx" ON "SearchDocument" USING GIN (lower("title") gin_trgm_ops);
```

Add a database check constraint for invitation expiry/status-independent data
shape and indexes for pending jobs, channel feed order, and membership lookup.
Owner uniqueness remains a transactional invariant because ownership transfer
updates both `Channel.ownerUserId` and membership roles atomically.

- [ ] **Step 5: Seed representative Phase 7 data**

At the top of the seed deletion transaction, delete Phase 7 rows in dependency
order. Seed:

- active official public `purehub-official`, owner `admin-demo`;
- active creator public `yuki-studio`, owner `c1`;
- active creator private discoverable `private-curators`, owner `c2`;
- one active owner membership per channel;
- editor and member examples on `private-curators`;
- one category rule, one manual channel post, and one exclusion;
- search documents for seeded public posts, creators, and eligible channels.

Use `DEMO_ACCOUNT_PASSWORD` only for existing credential accounts; add no new
secret.

- [ ] **Step 6: Generate client, reset seed, and inspect constraints**

Run:

```bash
npm run db:generate
npm run db:migrate:dev
npm run db:seed
```

Expected: Prisma generation, migration, and seed all exit `0`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts tests/phase7-channels-search.spec.ts
git commit -m "Add Phase 7 channel and search schema"
```

### Task 3: Channel ACL And Repository Core

**Files:**
- Create: `lib/channels/types.ts`
- Create: `lib/channels/auth.ts`
- Create: `lib/channels/repository.ts`
- Modify: `lib/admin-auth.ts`
- Modify: `lib/types.ts`
- Modify: `tests/phase7-channels-search.spec.ts`

**Consumes:** Phase 7 Prisma models.

**Produces:** Shared ACL, quota, lifecycle, DTO, and cursor functions listed in
Shared Interfaces.

- [ ] **Step 1: Add failing ACL/quota tests**

Cover:

- anonymous cannot create;
- fan receives `403`;
- approved `c1` creator receives level-2 limit `3`;
- quota override changes the returned limit;
- body `ownerUserId`, `createdByUserId`, and `x-admin-role` cannot spoof access;
- owner, editor, member, and non-member receive the expected permissions.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "ACL|quota"`

Expected: route-not-found or assertion failures.

- [ ] **Step 3: Implement types, validation, and cursor helpers**

Implement all Shared Interfaces constants. Add strict helpers:

```ts
parseChannelCursor(value?: string): ChannelCursor | null
encodeChannelCursor(value: ChannelCursor): string
normalizeChannelSlug(value: string): string
validateChannelInput(input: unknown): CreateChannelInput
```

Slug validation is lowercase ASCII letters, digits, and hyphens, 3-50
characters. Name is 3-80 characters; description is at most 1000 characters.

- [ ] **Step 4: Implement ACL and transactional repository operations**

`getChannelAccess` grants:

- active admin: all management permissions;
- active owner: manage, curate, manage members;
- active editor: curate only;
- active member: private read plus configured submission;
- anonymous/non-member: active public read only.

`getCreatorChannelQuota` reads `CreatorProfile.levelId`, maps level-1/2/3 to
1/3/5, applies `ChannelQuotaOverride`, and counts all non-archived creator
channels owned by that user.

Add `"channels"` to `ADMIN_SECTIONS`: super/ops/content admins may mutate;
support and analyst may only receive read endpoints when the route explicitly
allows it. Finance admin receives no channel mutation permission.

- [ ] **Step 5: Run focused tests and lint**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "ACL|quota"
npm run lint
```

Expected: focused tests and lint pass.

- [ ] **Step 6: Commit**

```bash
git add lib/channels lib/admin-auth.ts lib/types.ts tests/phase7-channels-search.spec.ts
git commit -m "Add channel ACL and quota rules"
```

### Task 4: Channel Lifecycle And Admin Review APIs

**Files:**
- Create the dashboard and admin lifecycle route files listed in File Map.
- Modify: `tests/phase7-channels-search.spec.ts`

**Consumes:** `createChannel`, `submitChannel`, `reviewChannel`,
`getCreatorChannelQuota`, and `requireAdmin`.

**Produces:** Reviewed creator channels and admin-controlled official channels.

- [ ] **Step 1: Add failing lifecycle tests**

Test:

- admin creates active official channel;
- approved creator creates draft only within quota;
- creator submits draft to pending;
- pending/rejected/suspended channel is absent from public listing;
- content admin approves with note and channel becomes active;
- owner cannot self-approve or self-restore;
- admin suspend, restore, archive, and takeover are idempotent;
- takeover leaves exactly one active owner membership and an audit log.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "lifecycle"`

Expected: route-not-found or non-success statuses.

- [ ] **Step 3: Implement lifecycle routes**

Every state-changing route:

1. calls `enforceSameOrigin`;
2. resolves `requireCreator` or `requireAdmin(request, "channels")`;
3. rejects identity fields in the body;
4. validates current status in the Prisma transaction;
5. writes `AuditLog`;
6. enqueues `index_entity` or `delete_index` with a deterministic
   idempotency key.

Return `201` for creation, `200` for transitions, `400` for invalid input,
`403` for ACL failure, `404` for missing channel, and `409` for invalid state or
quota conflict.

- [ ] **Step 4: Verify lifecycle behavior**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "lifecycle"
npm run lint
```

Expected: focused suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/channels app/api/admin/channels lib/channels tests/phase7-channels-search.spec.ts
git commit -m "Add reviewed channel lifecycle"
```

### Task 5: Private Membership, Invitations, And Join Requests

**Files:**
- Create membership/invitation route files listed in File Map.
- Modify: `lib/channels/repository.ts`
- Modify: `tests/phase7-channels-search.spec.ts`

**Produces:** Hashed expiring invitations and idempotent membership review.

- [ ] **Step 1: Add failing private-channel tests**

Test:

- hidden private channel does not appear in directory/search;
- discoverable private channel exposes only safe summary fields;
- non-member cannot read private posts/member list;
- join request creates one pending membership after repeated requests;
- owner approves/rejects request;
- owner invitation stores no raw token;
- wrong-email, expired, revoked, and replayed invitations fail;
- accepted invitation activates one membership;
- editor cannot change member roles; owner can;
- leaving removes active member access;
- membership still does not unlock paid media.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "private|invitation|membership"`

Expected: relevant tests fail before implementation.

- [ ] **Step 3: Implement invitation and membership transactions**

Generate raw invitation tokens with `randomBytes(32).toString("base64url")`,
store `createHash("sha256").update(token).digest("hex")`, and default expiry to
seven days. Normalize invitation email with lowercase/trim. Return the raw token
only from the create response.

Use `consumeRateLimit` scopes:

- `channel-join:<userId>`: 10 per hour;
- `channel-invite:<ownerId>`: 50 per hour;
- `channel-invite-accept:<userId>`: 20 per hour.

- [ ] **Step 4: Verify private flows**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "private|invitation|membership"
npm run lint
```

Expected: focused suite passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/channels app/api/dashboard/channels lib/channels tests/phase7-channels-search.spec.ts
git commit -m "Add private channel membership flows"
```

### Task 6: Mixed Curation And Durable Worker Jobs

**Files:**
- Create curation route files listed in File Map.
- Create: `lib/channels/jobs.ts`
- Create: `app/api/internal/phase7/run/route.ts`
- Modify: `scripts/worker.mjs`
- Modify: `tests/phase7-channels-search.spec.ts`

**Produces:** Manual/rule curation and retryable Phase 7 jobs.

- [ ] **Step 1: Add failing curation tests**

Test:

- owner/editor can curate another creator's published post;
- member direct policy activates submission;
- approval policy creates pending submission;
- manual ordering and pinning produce stable feed order;
- category, tag, and creator rules are OR-combined;
- duplicate rule matches produce one `ChannelPost`;
- exclusion removes manual and rule matches;
- removing exclusion allows rematerialization;
- repeated worker calls do not duplicate posts;
- suspended channel blocks curation mutations.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "curation|worker"`

Expected: curation endpoints are absent.

- [ ] **Step 3: Implement curation repository and routes**

Upsert `ChannelPost` by `(channelId, postId)`. A manual add changes `source` to
`manual`; rule materialization never downgrades a manual source. Before every
active upsert, check `ChannelPostExclusion`. Limit positions to signed 32-bit
integers and normalize reorder requests transactionally.

- [ ] **Step 4: Implement durable job execution**

`enqueueChannelJob` upserts deterministic keys:

```ts
materialize:${channelId}:${channelUpdatedAt.toISOString()}
index:${entityType}:${entityId}:${sourceUpdatedAt.toISOString()}
delete-index:${entityType}:${entityId}:${sourceUpdatedAt.toISOString()}
reindex-all:${requestedAt.toISOString()}
```

`runPhase7Jobs(25)` claims pending/failed jobs whose `availableAt <= now`,
increments attempts, executes, marks completed, and on failure records
`lastError` with backoff `min(3600, 2 ** attempts * 15)` seconds. Stop retrying
automatically after 8 attempts but retain the failed row for admin inspection.

Add `POST /api/internal/phase7/run` protected by the existing
`WORKER_ACCESS_TOKEN`. Update `scripts/worker.mjs` to call Phase 5 and Phase 7
internal runs separately so one subsystem failure does not suppress the other.

- [ ] **Step 5: Verify curation and retries**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "curation|worker"
npm run lint
```

Expected: focused suite passes.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/channels app/api/internal/phase7 lib/channels/jobs.ts lib/channels/repository.ts scripts/worker.mjs tests/phase7-channels-search.spec.ts
git commit -m "Add mixed channel curation jobs"
```

### Task 7: PostgreSQL Full-Text And Trigram Search

**Files:**
- Create: `lib/search/repository.ts`
- Create: `app/api/search/route.ts`
- Create: `app/api/admin/search/reindex/route.ts`
- Modify: `lib/channels/jobs.ts`
- Modify: `tests/phase7-channels-search.spec.ts`

**Produces:** Safe ranked search across posts, creators, and channels.

- [ ] **Step 1: Add failing search tests**

Test:

- exact post/creator/channel terms return expected entity types;
- misspelled short name returns trigram match;
- `type=post|creator|channel` filters;
- stable cursor has no duplicate/omitted row;
- hidden/suspended/private data is absent;
- discoverable private channel exposes safe summary only;
- malformed cursor returns `400`;
- query shorter than 2 or longer than 100 characters returns `400`;
- reindex is admin-only and idempotent.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "search"`

Expected: `/api/search` is `404`.

- [ ] **Step 3: Implement search synchronization**

Upsert SearchDocument projections from source records. Delete the document when
an entity becomes ineligible. Serialize channel keywords from kind and safe
metadata only. Never include email, member identity, KYC, finance, auth, storage
keys, or private post text.

- [ ] **Step 4: Implement ranked SQL query**

Use parameterized `prisma.$queryRaw` with:

```sql
ts_rank_cd("searchVector", websearch_to_tsquery('simple', $query)) * 1.0
+ similarity(lower("title"), lower($query)) * 0.35
+ LEAST("popularityScore", 100000) / 100000.0 * 0.05
```

Order by `rank DESC, "publishedAt" DESC, "entityType" ASC, "entityId" ASC`.
Filter eligible entity types and apply the decoded cursor with the complete
after-cursor predicate:

```sql
rank < $cursorRank
OR (rank = $cursorRank AND "publishedAt" < $cursorPublishedAt)
OR (rank = $cursorRank AND "publishedAt" = $cursorPublishedAt AND "entityType" > $cursorEntityType)
OR (rank = $cursorRank AND "publishedAt" = $cursorPublishedAt AND "entityType" = $cursorEntityType AND "entityId" > $cursorEntityId)
```

Fetch `take + 1`, with default 20 and maximum 50.

- [ ] **Step 5: Verify search**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "search"
npm run lint
```

Expected: search suite passes.

- [ ] **Step 6: Commit**

```bash
git add lib/search app/api/search app/api/admin/search lib/channels/jobs.ts tests/phase7-channels-search.spec.ts
git commit -m "Add PostgreSQL channel search"
```

### Task 8: Public Channel And Search UI

**Files:**
- Create public pages/components listed in File Map.
- Modify: `components/app-shell.tsx`
- Modify: `tests/phase7-channels-search.spec.ts`

**Produces:** Responsive public channel directory/detail and unified search.

- [ ] **Step 1: Add failing desktop/mobile UI tests**

Test both projects for:

- `/channels` renders official and creator cards;
- discoverable private card shows request action without posts;
- hidden private channel returns not-found for anonymous user;
- active member sees private feed;
- `/search?q=yuki` renders typed result tabs;
- cursor load-more appends without layout shift;
- channel cards and controls fit Pixel 5 viewport without overlap.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --grep "channel UI|search UI"`

Expected: pages return `404`.

- [ ] **Step 3: Implement UI**

Use existing app shell, CSS variables, Lucide icons, <=8px card radius, stable
image aspect ratios, explicit loading/empty/error states, and icon tooltips.
Public server pages fetch safe channel/search APIs. Membership actions use
optimistic state with rollback on non-2xx responses.

- [ ] **Step 4: Verify responsive UI**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --grep "channel UI|search UI"
npm run lint
npm run build
```

Expected: desktop/mobile UI tests, lint, and build pass.

- [ ] **Step 5: Commit**

```bash
git add app/channels app/search components/channels components/search components/app-shell.tsx tests/phase7-channels-search.spec.ts
git commit -m "Add public channel and search UI"
```

### Task 9: Creator Dashboard And Admin Operations UI

**Files:**
- Create: `app/dashboard/channels/page.tsx`
- Create: `components/channels/channel-manager.tsx`
- Modify: `app/admin/page.tsx`
- Modify: `tests/phase7-channels-search.spec.ts`

**Produces:** Creator channel management and admin review/override/takeover.

- [ ] **Step 1: Add failing protected UI tests**

Test:

- fan is redirected away from `/dashboard/channels`;
- approved creator sees quota usage and review status;
- owner can manage membership, rules, exclusions, order, and policy;
- editor UI omits ownership/member-role controls;
- active channel admin sees pending review queue;
- support/finance admin cannot mutate channel lifecycle;
- content/super admin can review, suspend, restore, takeover, override quota,
  trigger rematerialization, and reindex.

- [ ] **Step 2: Verify failures**

Run: `npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "dashboard|admin channel"`

Expected: dashboard route is absent and admin panel lacks channel controls.

- [ ] **Step 3: Implement dashboard and admin panels**

Keep channel management in a dedicated component instead of extending the
already large admin component with repository logic. Admin page loads channel
data through the new API and renders a full-width operational section with
compact tables, status filters, review note dialog, quota input, and icon
actions. Do not nest cards inside cards.

- [ ] **Step 4: Verify protected UI**

Run:

```bash
npm run test:e2e -- tests/phase7-channels-search.spec.ts --project=desktop --grep "dashboard|admin channel"
npm run lint
npm run build
```

Expected: tests, lint, and build pass.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/channels app/admin/page.tsx components/channels/channel-manager.tsx tests/phase7-channels-search.spec.ts
git commit -m "Add channel operations UI"
```

### Task 10: Phase 7 Deployment And Full Acceptance

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `scripts/smoke-test.mjs`
- Modify: `docs/server-acceptance.md`
- Modify: `tests/production-readiness.spec.ts`

**Produces:** A repeatable local and Ubuntu staging acceptance path.

- [ ] **Step 1: Add failing smoke/readiness checks**

Add smoke checks for:

- `GET /api/channels` returns seeded `channels` array;
- `GET /api/search?q=yuki&type=creator` returns `results`;
- unauthenticated dashboard channel mutation returns `401`;
- health reports `phase-7` and Phase 7 capabilities.

- [ ] **Step 2: Update deployment configuration**

Set default `PUREHUB_PHASE=phase-7` in `.env.example` and web/worker Compose
environments. Add no new secret. Extend worker health queue/task output with
`channelMaterialization` and `searchIndexing`.

- [ ] **Step 3: Run complete local verification**

Run:

```bash
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
npm run smoke
git diff --check
git status --short
```

Expected:

- every command exits `0`;
- full Playwright passes on desktop/mobile;
- `git status --short` contains no Phase 7 file outside the intended commit;
- `README.md` and `start-local-demo.cmd` remain unstaged.

- [ ] **Step 4: Commit deployment readiness**

```bash
git add .env.example docker-compose.yml scripts/smoke-test.mjs scripts/worker.mjs docs/server-acceptance.md tests/production-readiness.spec.ts
git commit -m "Prepare Phase 7 staging acceptance"
```

- [ ] **Step 5: Push and deploy staging**

```bash
git push origin main
```

On Ubuntu:

```bash
cd /var/www/purehub
git config core.fileMode false
git pull --ff-only
chmod +x scripts/*.sh
sed -i 's/^PUREHUB_PHASE=.*/PUREHUB_PHASE=phase-7/' .env.staging
DEPLOY_SEED=true ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
curl -fsS http://127.0.0.1/api/health
SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
```

Install test dependencies only when absent:

```bash
npm ci --registry=https://registry.npmmirror.com/
npx playwright install --with-deps chromium
```

Then run:

```bash
export PLAYWRIGHT_BASE_URL=http://127.0.0.1
export ADMIN_ACCESS_TOKEN="$(grep '^ADMIN_ACCESS_TOKEN=' .env.staging | tail -1 | cut -d= -f2-)"
export DEMO_ACCOUNT_PASSWORD="$(grep '^DEMO_ACCOUNT_PASSWORD=' .env.staging | tail -1 | cut -d= -f2-)"
npm run test:e2e:deployed
```

Expected: Docker services healthy, migration/seed/health/smoke pass, and deployed
Playwright reports zero failures using one worker.

- [ ] **Step 6: Record acceptance**

Record:

- `git rev-parse HEAD`;
- `git ls-remote origin refs/heads/main`;
- `/api/health` phase/version;
- Docker `ps`;
- migration result;
- smoke result;
- exact Playwright passed/skipped/failed totals.

The local, GitHub, staging checkout, and runtime commit must match before Phase 7
is marked complete.
