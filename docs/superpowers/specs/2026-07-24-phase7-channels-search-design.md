# PureHub Phase 7: Channels, Curation, and PostgreSQL Search

Date: 2026-07-24
Status: Approved design

## Summary

Phase 7 introduces a unified channel system, explicit channel ACLs, mixed manual
and rule-based curation, private channel membership, and PostgreSQL-backed
search. It builds on Phase 6 database sessions and role authorization.

Platform administrators create official channels. Approved creators may create
creator channels within level-based quotas, but every creator channel requires
admin review before activation. Administrators may suspend or take over any
channel.

Real-time chat, live presence, Web3, external search services, and recommendation
ranking are outside this phase.

## Product Decisions

- Use one `Channel` model for official and creator channels.
- Official channels are created by platform administrators.
- Approved creators may create channels, subject to quota and review.
- Creator channels are reviewed before activation, whether public or private.
- Channels support mixed curation:
  - manual inclusion, ordering, pinning, and exclusion;
  - automatic category, tag, and creator rules;
  - manual exclusions always win.
- Channels may curate any published platform post without changing authorship,
  ownership, pricing, or entitlement rules.
- Channels may be public or private.
- Private channels may be `discoverable` or `hidden`.
- Private membership supports invitations and join requests.
- Channel roles are `owner`, `editor`, and `member`.
- Channel owners choose whether members may post directly or require approval.
- Creator channel quotas default to level 1/2/3 limits of 1/3/5 channels.
- Administrators may set a per-user quota override.
- Search uses PostgreSQL full-text search and `pg_trgm`.

## Architecture

Channel authorization is enforced by server route handlers through Phase 6
session helpers. Middleware may redirect users, but it is not an authorization
boundary. Client-supplied user IDs, owner IDs, creator IDs, and role headers
never grant access.

Channel mutations and their audit records are committed in the same Prisma
transaction. Rule expansion and search indexing are retryable, idempotent worker
jobs. Reads continue from the last completed materialization or index while a
worker job is pending.

## Data Model

### Channel

Required fields:

- `id`, globally unique `slug`, `name`, `description`
- `avatarAssetId`, `coverAssetId`
- `kind`: `official | creator`
- `visibility`: `public | private`
- `discoverability`: `discoverable | hidden`
- `status`: `draft | pending | active | rejected | suspended | archived`
- `ownerUserId`, `createdByUserId`
- `memberPostPolicy`: `direct | approval_required`
- `reviewNote`, `reviewedByAdminId`, `reviewedAt`, `suspendedAt`
- `createdAt`, `updatedAt`

Every channel has exactly one active owner. Official channels use the creating
administrator's user as owner. Administrative takeover atomically changes
`ownerUserId` and membership roles while preserving the previous owner in the
audit log.

Creator channels remain `draft` while being edited, become `pending` on
submission, and may become `active` only after admin approval. Rejected channels
retain their review note and may be edited as drafts before resubmission.

### ChannelMembership

Required fields:

- `id`, `channelId`, `userId`
- `role`: `owner | editor | member`
- `status`: `invited | pending | active | rejected | removed`
- `invitedByUserId`, `reviewedByUserId`, `reviewedAt`
- `createdAt`, `updatedAt`

Use a unique constraint on `(channelId, userId)`. Invite, application, approval,
rejection, removal, and role changes are idempotent state transitions.

### ChannelPost

Required fields:

- `id`, `channelId`, `postId`
- `source`: `manual | rule`
- `status`: `pending | active | rejected | removed`
- `position`, `pinnedAt`, `addedByUserId`, `reviewedByUserId`
- `createdAt`, `updatedAt`

Use a unique constraint on `(channelId, postId)`. Manual inclusion takes
precedence over rule inclusion. Removing a manual inclusion does not create an
exclusion unless the user explicitly excludes the post.

### ChannelRule

Required fields:

- `id`, `channelId`
- `kind`: `category | tag | creator`
- `value`, `enabled`, `createdByUserId`, `createdAt`, `updatedAt`

Rules are OR-combined in the first release. A post matching any enabled rule may
be materialized into the channel. Only published posts are eligible.

### ChannelPostExclusion

Required fields:

- `id`, `channelId`, `postId`, `excludedByUserId`, `reason`, `createdAt`

Use a unique constraint on `(channelId, postId)`. Exclusion has higher priority
than manual inclusion and all automatic rules until explicitly removed.

### ChannelQuotaOverride

Required fields:

- `id`, unique `userId`, `maxChannels`, `reason`
- `createdByAdminId`, `createdAt`, `updatedAt`

If no override exists, the active creator level determines the quota. All
non-archived channels count, including suspended channels. Archiving releases
the quota only after the archival mutation is authorized and audited.

### SearchDocument

Search indexing uses a dedicated relational projection:

- `id`, `entityType`: `post | creator | channel`, `entityId`
- `title`, `body`, `keywords`, `searchVector`
- `popularityScore`, `publishedAt`, `updatedAt`

Use a unique constraint on `(entityType, entityId)`, a GIN index on
`searchVector`, and trigram indexes on normalized title, handle, and channel
name fields. Search documents contain only public searchable text, never private
membership, email, KYC, finance, storage, or authentication data.

## ACL

### Platform Administrators

- Create, edit, activate, suspend, restore, archive, and take over any channel.
- Review creator channel submissions and override creator quotas.
- Manage official channel membership and curation.
- Trigger rule rematerialization and search reindexing.
- Read channel audit history.

Sensitive mutations require an active `AdminAccount`. Legacy role headers cannot
grant these permissions.

### Owner

- Edit channel presentation and allowed settings.
- Submit creator channels for review.
- Invite, approve, reject, remove, and assign editor/member roles.
- Transfer ownership only through the controlled transfer endpoint.
- Manage rules, manual posts, exclusions, ordering, and pins.
- Choose private discoverability and member posting policy.

Owners cannot activate, restore, or unsuspend their own channel.

### Editor

- Manage channel posts, ordering, pins, exclusions, and rules.
- Review member post submissions when policy requires approval.
- View member lists needed for moderation.

Editors cannot change ownership, visibility, discoverability, channel status,
quotas, or member roles.

### Member

- Read private channel content while membership is active.
- Submit posts when the channel policy permits.
- Leave the channel unless they are the owner.

### Non-member

- Read active public channels.
- Discover a private channel only when its discoverability is `discoverable`.
- Request access to a discoverable private channel.
- Access no channel posts or membership details before approval.

Post access remains independently protected. Channel membership does not bypass
post purchase, subscription, or private media entitlements.

## Lifecycle And Curation

1. An admin creates an official channel, or an approved creator creates a draft
   within quota.
2. A creator submits the channel for review.
3. An admin approves or rejects it with an audit note.
4. Activating a channel schedules search indexing and rule materialization.
5. Owners and editors curate published posts manually or through rules.
6. Private membership is established by accepted invitation or approved request.
7. Suspension immediately removes a channel from public/search reads and blocks
   member mutations while preserving data for review.
8. Takeover atomically assigns a new owner and records the previous owner.

The resolved channel feed is ordered by pinned status, explicit manual position,
then publication time. Duplicate rule matches produce one `ChannelPost`.
Exclusions remove matching posts from the resolved feed without deleting the
underlying post.

## API Surface

### Public And Member APIs

- `GET /api/channels?cursor=&kind=&visibility=`
- `GET /api/channels/[slug]?cursor=`
- `POST /api/channels/[slug]/join-requests`
- `DELETE /api/channels/[slug]/membership`
- `POST /api/channels/[slug]/invitations/[token]/accept`
- `POST /api/channels/[slug]/invitations/[token]/reject`
- `GET /api/search?q=&type=&cursor=`

### Creator Dashboard APIs

- `GET|POST /api/dashboard/channels`
- `GET|PATCH /api/dashboard/channels/[id]`
- `POST /api/dashboard/channels/[id]/submit`
- `GET|POST /api/dashboard/channels/[id]/members`
- `PATCH /api/dashboard/channels/[id]/members/[membershipId]`
- `POST /api/dashboard/channels/[id]/invitations`
- `GET|POST /api/dashboard/channels/[id]/posts`
- `PATCH|DELETE /api/dashboard/channels/[id]/posts/[channelPostId]`
- `GET|POST /api/dashboard/channels/[id]/rules`
- `PATCH|DELETE /api/dashboard/channels/[id]/rules/[ruleId]`
- `GET|POST /api/dashboard/channels/[id]/exclusions`
- `DELETE /api/dashboard/channels/[id]/exclusions/[id]`

### Admin APIs

- `GET|POST /api/admin/channels`
- `GET|PATCH /api/admin/channels/[id]`
- `POST /api/admin/channels/[id]/review`
- `POST /api/admin/channels/[id]/suspend`
- `POST /api/admin/channels/[id]/restore`
- `POST /api/admin/channels/[id]/takeover`
- `GET|PUT /api/admin/channels/quotas/[userId]`
- `POST /api/admin/search/reindex`

All list endpoints use stable cursor pagination. Mutation endpoints validate
same-origin requests, apply Redis rate limits where exposed to users, and return
structured `400`, `401`, `403`, `404`, `409`, and `429` errors.

## Search

PostgreSQL search combines:

- weighted `tsvector` ranking for titles, handles, names, bodies, tags, and
  categories;
- `pg_trgm` similarity for short or misspelled names;
- a small bounded popularity contribution;
- publication time as a deterministic tie-breaker.

Only active public posts, active public creator profiles, active public
channels, and active private channels marked `discoverable` may appear in global
search. Hidden private channels never appear. Discoverable private channel
results expose only safe summary fields until membership is active.

Search supports `post`, `creator`, and `channel` filters. The cursor encodes the
rank tuple and entity identity rather than an offset. Input length, wildcard
behavior, and result limits are bounded to protect PostgreSQL.

Index updates are queued after committed source mutations. A worker upserts or
deletes the corresponding `SearchDocument` idempotently. The admin reindex
endpoint builds documents in batches and reports progress.

## UI

### User-facing

- `/channels`: searchable, paginated directory of official, creator, public,
  and discoverable private channels.
- `/channels/[slug]`: channel header, membership action, curated feed, and
  private access state.
- `/search`: unified results with tabs for all, posts, creators, and channels.

Hidden private channels are reachable only by direct authorized navigation or
invitation. A discoverable private channel shows its name, avatar, description,
owner, and request button, but not its posts or member list.

### Creator Dashboard

`/dashboard/channels` includes quota usage, channel creation/editing, review
status, membership management, curation controls, rules, and private settings.

### Admin

The admin channel panel includes the review queue, official channel creation,
quota overrides, suspension/restoration/takeover, audit history, rule
rematerialization, and search reindex controls.

## Security And Consistency

- Session identity is the only user authorization source.
- Admin authority comes from active `AdminAccount` data or the fixed deployment
  service-admin mapping.
- Every mutation checks current channel status and ACL in the transaction.
- Ownership transfer and admin takeover cannot leave zero or multiple owners.
- Invitations use random, hashed, expiring tokens; raw tokens are never stored.
- Private channel responses use explicit safe projections.
- Channel membership never grants payment or media entitlement.
- Audit records cover review, suspension, restoration, takeover, quota changes,
  ownership transfer, role changes, visibility changes, and curation changes.
- Rule jobs, search jobs, invitations, join decisions, and lifecycle operations
  are idempotent.

## Testing

Add Phase 7 Playwright coverage for:

- official channel creation by admin;
- creator quota defaults and per-user override;
- creator channel review before public visibility;
- suspension, restoration, and takeover;
- Owner/Editor/Member ACL boundaries;
- forged user IDs and role headers being rejected;
- private hidden versus discoverable behavior;
- invitation and join-request approval flows;
- direct versus approval-required member post submission;
- curation of posts owned by other creators;
- manual inclusion, ordering, pinning, exclusion, and rule precedence;
- idempotent rule materialization;
- PostgreSQL full-text, trigram, type filters, and cursor pagination;
- search privacy for suspended and private entities;
- channel membership not bypassing paid content entitlement;
- search reindex retry behavior.

All Phase 1-6 tests remain green. Verification includes Prisma generation and
migration, seed, lint, typecheck, production build, full local Playwright,
Docker deployment, healthcheck, smoke test, and full staging Playwright.

## Deployment

- Add a Prisma migration enabling `pg_trgm`, channel tables, constraints, and
  search indexes.
- Seed one official public channel, one approved creator channel, one
  discoverable private channel, and representative ACL/curation data.
- Extend the worker for rule materialization and search indexing.
- Update health and platform rules to expose channel and PostgreSQL-search
  capabilities without exposing private data.
- Update the version marker to `phase-7`.
- Deploy and verify the same commit SHA in GitHub, staging checkout, and runtime.
- Do not commit real secrets.
- Exclude local `README.md` and `start-local-demo.cmd` changes from Phase 7
  commits unless explicitly requested.

## Deferred

- Real-time chat, typing indicators, presence, and WebSocket infrastructure.
- Creator-to-fan direct messages.
- Web3 or token-gated channels.
- External search clusters or semantic/vector search.
- Recommendation feeds and machine-learned ranking.
- Nested channel hierarchies.
- Paid channel membership separate from existing post/subscription entitlement.
