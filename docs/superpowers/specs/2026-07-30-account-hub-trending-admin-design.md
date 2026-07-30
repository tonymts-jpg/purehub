# PureHub Account Hub, Trending Rail, and Admin Information Architecture

Date: 2026-07-30
Status: Approved design

## Summary

This iteration improves the post-Phase-7 product without reopening the approved
channels, search, ACL, or entitlement decisions. It adds a role-aware account
navigation, separates a fan's saved, liked, unlocked, followed, viewed, and
purchased content, adds hot posts above hot creators on the home right rail, and
splits the independent administration site into domain-specific pages.

Approved creators retain every fan capability and gain a separate creator
workspace. Channel bookmarks remain organizational metadata only: they never
grant channel membership, post access, subscription access, purchase
entitlements, or private-media access.

## Goals

- Show hot posts above hot creators in the home right rail.
- Make public and account navigation depend on the authenticated user's state.
- Rename Library to Favorites and separate unlocked content from favorites.
- Support favorite posts and favorite channels in one Favorites page.
- Add dedicated pages for liked posts, viewing history, buyer orders, followed
  creators, and unlocked content.
- Retain authenticated viewing history for a rolling 90-day window.
- Give approved creators every fan feature while removing Become a Creator from
  their navigation.
- Split the independent admin site by business domain.
- Add cross-domain work-queue shortcuts to the admin overview.
- Preserve session identity, channel ACLs, paid entitlements, and private-media
  boundaries.

## Non-goals

- WebSocket, chat, presence, Web3, vector search, or an external search service.
- Paid channel membership or channel bookmarks that grant access.
- A new entitlement or payment system.
- Refund or cancellation actions in the buyer-facing order history.
- A second media-preview implementation.
- Linking the admin site from the public site.

## Navigation and Page Architecture

### Guest

Guest navigation contains:

- Home
- Explore
- Channels
- Search
- Become a Creator

Guests do not see account pages or the creator workspace. When a guest attempts
to like, favorite, follow, purchase, or perform another authenticated action,
the application sends the guest to sign-in with a validated same-origin return
location.

### Authenticated Fan

The authenticated account section contains:

- Favorites: `/favorites`
- Unlocked Content: `/unlocked`
- Likes: `/likes`
- Viewing History: `/history`
- Order History: `/orders`
- Following: `/following`
- Notifications: `/notifications`

`/favorites` contains Post and Channel tabs. The legacy `/library` route
redirects to `/favorites` so existing links do not break.

### Approved Creator

An approved, active creator receives every fan account capability. The public
Become a Creator entry is removed. A separate Creator Space contains:

- Dashboard
- Posts
- Publish Post
- Channels
- Members
- Wallet and Earnings

An applicant who is not yet approved may still open Become a Creator to see or
continue the application state.

### Responsive Navigation

Desktop uses grouped sidebar sections for public navigation, account navigation,
and Creator Space. Mobile retains a small bottom navigation and exposes the
account destinations from a single My page or menu rather than placing every
destination in the bottom bar.

### Admin Entry

The admin site remains an independent layout under `/admin`. The public site
does not render an admin link. `/admin/sign-in` is the dedicated admin sign-in
entry. Authenticated non-admin users cannot see admin content.

## Home Right Rail

The home right rail renders Hot Posts above Hot Creators.

Hot Posts displays four entries. Each entry includes:

- post thumbnail;
- post title;
- creator identity;
- a compact popularity indicator.

Only published, publicly discoverable posts may appear. Ranking uses the
production post popularity score already maintained for search rather than a
new client-only formula. Selecting an entry opens the post page. The section
footer links to the complete Hot Posts page.

The existing Hot Creators section remains below Hot Posts. Both sections use
consistent spacing, headings, entry density, and footer treatment.

## Account Page User Experience

All account pages provide loading, empty, error, and retry states. List APIs use
cursor pagination and pages append or replace results without losing a stable
sort.

### Favorites

The Post tab renders the existing shared post card and the existing post
bookmark state. The Channel tab renders channel cover or avatar, name, kind,
visibility, description, and favorite time.

Favoriting a channel is separate from joining it. Removing a channel favorite
does not alter channel membership.

### Unlocked Content

The page contains:

- posts with a permanent single-purchase entitlement; and
- member posts currently accessible through an active subscription.

Each item labels its access source as Single Purchase or Active Subscription.
Subscription-sourced items disappear after access expires. Purchased
entitlements remain. Channel membership alone never makes a post appear here.

### Likes

The page lists every post liked by the current user. The user may unlike an
item directly; after a successful mutation, it leaves the list. The existing
like counter and notification behavior remain authoritative.

### Viewing History

Viewing history records only an authenticated visit to a post detail page.
Home cards, search results, and media-preview opens do not create history.

Entries are ordered by the most recent view and show thumbnail, creator, and
last-viewed time. Selecting an entry returns to the post page.

The same user and post have one row. A repeat visit updates `lastViewedAt`.
History is available for a rolling 90 days.

### Order History

Order History lists orders where the current user is the buyer, including
single-post purchases and creator subscriptions. It displays:

- order number;
- post or plan;
- creator;
- amount and currency;
- non-sensitive payment method label;
- creation time;
- normalized order or payment status.

Desktop uses a table and mobile uses cards. The first version is read-only and
does not add buyer refund or cancellation controls.

### Following

Following lists the current user's followed creators with avatar, name,
category, biography, and follow time. The user may unfollow directly; after a
successful mutation, the creator leaves the list.

### Shared Media Preview

All post images and videos continue to use the shared site-wide preview
component, including Close and Fullscreen actions. Account pages must not
introduce a separate preview implementation.

## Data Model

### ChannelBookmark

Add a `ChannelBookmark` model with:

- `id`
- `userId`
- `channelId`
- `createdAt`

Required constraints and indexes:

- unique `(userId, channelId)`;
- user and channel relations cascade on deletion;
- index supporting newest-first favorites for a user.

This row conveys no ACL, membership, subscription, entitlement, ownership, or
moderation privilege.

### PostViewHistory

Add a `PostViewHistory` model with:

- `id`
- `userId`
- `postId`
- `firstViewedAt`
- `lastViewedAt`

Required constraints and indexes:

- unique `(userId, postId)`;
- index `(userId, lastViewedAt)`;
- user and post relations cascade on deletion.

Recording a view uses an idempotent upsert. The first timestamp is retained and
the last timestamp advances on later visits.

Queries apply a 90-day cutoff even if cleanup has not yet run. An idempotent
scheduled cleanup deletes rows older than the rolling cutoff.

### Existing Models

The feature reuses:

- `Bookmark` for post favorites;
- `PostLike` for liked posts;
- `Follow` for followed creators;
- `Entitlement` plus active `Subscription` for unlocked content;
- `Order` and its payment relations for buyer order history.

No duplicate ACL, entitlement, like, follow, bookmark, or order source of truth
is introduced.

## Account APIs

The account read surface is:

- `GET /api/me/favorites?type=posts|channels`
- `GET /api/me/unlocked`
- `GET /api/me/likes`
- `GET /api/me/history`
- `GET /api/me/orders`
- `GET /api/me/following`

New mutations are:

- `POST /api/channels/[slug]/bookmark`
- `DELETE /api/channels/[slug]/bookmark`
- `POST /api/posts/[id]/view`

Existing post bookmark, post like, and creator follow mutations remain the
authoritative write paths.

All list endpoints use opaque cursor pagination and deterministic newest-first
ordering with an ID tie-breaker. Invalid cursors return `400`.

## Identity, ACL, and Privacy

- Account APIs derive the user only from the authenticated session.
- Body, query, route, and header user IDs cannot replace session identity.
- Missing authentication returns `401`.
- Channel bookmark reads and writes re-run channel visibility checks.
- A channel that is not visible to the current user returns `404`, preventing
  private-channel enumeration.
- A channel bookmark never changes `ChannelMembership`.
- Channel membership and bookmarks never bypass paid, subscription, post
  entitlement, or private-media checks.
- Unlocked Content calls the existing canonical access evaluation.
- Order History returns only orders whose `buyerUserId` equals the session user.
- Payment tokens, provider payloads, credentials, and other sensitive payment
  details are not serialized to the client.
- Posts that are deleted, unpublished, moderated out, or no longer accessible
  do not appear in account lists.
- View recording failure does not prevent the post detail page from rendering.

## Administration Information Architecture

### Routes

- `/admin`: Overview
- `/admin/members`: Member Management
- `/admin/creators`: Creator Management
- `/admin/content`: Content Management
- `/admin/channels`: Channel Management
- `/admin/finance`: Orders and Finance
- `/admin/settings`: Platform Settings
- `/admin/audit`: Audit Log
- `/admin/sign-in`: independent admin sign-in

### Overview and Work Queues

Overview contains high-level metrics and cross-domain work-queue shortcuts,
including:

- pending creator applications;
- pending content review;
- pending channel review;
- pending refunds;
- pending payouts;
- reconciliation exceptions.

Overview does not perform the complete workflow. Each shortcut opens its owning
domain page and writes the filter to URL query parameters so the filtered view
is linkable and refresh-safe.

### Domain Responsibilities

Member Management covers fan and creator accounts, search, account state, and
suspension.

Creator Management covers creator applications, qualifications, status, and
creator levels.

Content Management covers posts, comments, media, and moderation state.

Channel Management covers approval, state, membership administration, and
curation rules.

Orders and Finance uses internal tabs for orders, payments, refunds, platform
fees, creator payouts, withdrawals, and reconciliation.

Platform Settings covers pricing, platform fees, settlement windows, and
payment-channel configuration.

Audit Log covers actor, action, time, target, and result.

### Admin Shell and Data Loading

`AdminShell` becomes a complete independent responsive shell. Desktop uses a
sidebar and mobile uses an admin-specific navigation drawer.

Each route loads only its domain data. The current pattern where `/admin`
requests all admin resources at once is removed. Each page has independent
loading, error, empty, retry, and forbidden states.

### Admin Role Matrix

- `super_admin`: every route and action.
- `ops_admin`: overview, members, creators, content, channels, operational
  settings, and audit.
- `content_admin`: overview, creator review, content, channels, and audit.
- `finance_admin`: overview, orders and finance, finance settings, and audit.
- `support_admin`: overview plus read-only member and creator information.
- `analyst`: read-only overview and audit.

Navigation filtering is presentation only. Every page and API repeats
server-side section and action authorization. `x-admin-role` has no
authorization effect.

All successful admin mutations write an audit record. A failed mutation keeps
the previous UI state and exposes a retryable error.

## Error Handling

- Account page `401` responses redirect to sign-in with a safe return location.
- Hidden or inaccessible channels return `404`.
- Invalid pagination cursors return `400`.
- Like, favorite, follow, and view mutations are idempotent.
- List pages do not expose removed or inaccessible resources.
- Admin mutations update client state only after server success.
- Errors preserve already loaded data where possible and provide a retry action.

## Testing Strategy

Implementation follows test-driven development.

### Model and Repository Tests

- Channel bookmark uniqueness and cascade behavior.
- View-history upsert preserves first view and advances last view.
- View-history sorting, exact 90-day boundary, and cleanup idempotency.
- Account list deterministic pagination.
- Unlocked list separates purchase and active-subscription sources.

### API and ACL Tests

- Every account endpoint rejects unauthenticated requests.
- Body, query, and header IDs cannot override session identity.
- Private channels cannot be discovered through bookmark APIs.
- Channel bookmark and membership never bypass content entitlements.
- Order History is buyer-owned and returns no sensitive payment data.
- Repeated mutation requests remain idempotent.
- `x-admin-role` cannot grant admin access.
- Direct admin route and API access obey the full role/action matrix.

Authentication tests reuse `tests/auth-helpers.ts`.

### UI and End-to-End Tests

- Guest, fan, pending creator, and approved creator navigation.
- Approved creators do not see Become a Creator.
- Favorites Post and Channel tabs.
- Loading, empty, error, retry, and pagination states for account pages.
- Unlike and unfollow remove successfully mutated entries.
- Hot Posts appears above Hot Creators and links to the full list.
- View recording occurs on post detail only.
- Admin overview shortcuts open the correct filtered domain page.
- Admin sidebar renders only authorized domains.
- Existing unlock, comment, preview, search, channel ACL, payment, and Phase 7
  coverage remains green.

## Migration, Compatibility, and Delivery

- Add one Prisma migration for `ChannelBookmark` and `PostViewHistory`.
- Run `npm run db:generate`; do not use `npx prisma generate`.
- Preserve `/library` as a redirect to `/favorites`.
- Keep deployed Playwright fixed to one worker.
- Run focused tests, lint, typecheck, build, and the complete Playwright suite.
- Before each commit, explicitly exclude `README.md`,
  `start-local-demo.cmd`, real `.env` files, and secrets.
- Commit and push only after local verification.
- On Ubuntu staging, apply the migration, run seed or data-integrity checks as
  appropriate, check service health, and run the complete deployed acceptance
  suite with one worker.
