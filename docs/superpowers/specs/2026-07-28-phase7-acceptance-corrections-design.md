# PureHub Phase 7 Acceptance Corrections Design

Date: 2026-07-28

Status: Approved in conversation; awaiting written-spec review

## Goal

Correct the Phase 7 staging acceptance issues reported from an anonymous visitor session without reopening the approved Phase 7 product model.

The work covers:

- top-level unlock and media overlays;
- removal and prevention of leaked test content;
- safe post thumbnails in search results;
- public comment reading with authenticated participation;
- an independent admin presentation at the existing `/admin` entry;
- session-derived visitor, fan, and approved-creator navigation;
- removal of the public Demo identity surface; and
- staging acceptance accounts and deployment verification.

This work does not add WebSocket, chat, Web3, vector search, or an external search service.

## Confirmed Product Decisions

### Admin entry

Until a domain is available, the admin site continues to use the direct `/admin` URL on the same origin. No desktop or mobile frontend navigation links to `/admin`.

The admin route has an independent layout and does not render the frontend shell. Direct knowledge of the URL is not an authorization mechanism: the existing server session, active `AdminAccount`, role, and section permissions remain authoritative. `x-admin-role` has no authorization effect.

### Anonymous unlock flow

An anonymous visitor who selects paid or member-only media sees content information, price or membership benefits, and a primary `Sign in to unlock` action. Anonymous visitors do not see a Demo card number or simulated-payment confirmation.

After authentication, a fan continues through the existing staging payment or membership flow. The callback URL returns the user to the originating page.

### Media viewer

All actual post images and videos use one viewer. Videos open paused without sound autoplay and expose native playback controls. The viewer provides close and fullscreen controls. Images also provide previous, next, and position controls.

### Comments

Anonymous visitors can read visible comments. They see a clear sign-in call to action instead of a comment field. Authenticated users see the editor and publish action.

## Page and Shell Architecture

The root layout becomes presentation-neutral and retains only the document shell, metadata, and global styles.

Frontend pages move under a URL-transparent `(site)` route group with a site layout that renders `AppShell`. The `/api` routes remain unchanged.

The `/admin` page uses an admin-only layout and `AdminShell`. It must not import or render frontend navigation, creator links, the Demo identity surface, or the frontend mobile navigation.

The admin layout performs server-side session and active-admin-account checks before rendering. Unauthenticated requests redirect to sign-in with `/admin` as the callback. Authenticated non-admin users are denied entry without gaining information or authority through request headers.

## Identity-Derived Navigation

Frontend navigation derives identity from the authenticated session:

- Visitor: show sign-in; do not show a fake fan identity, Demo mode, creator space, creator dashboard, or publish action.
- Fan: show the real account name and a fan identity label; do not show creator tools.
- Approved creator: a user with `role=creator`, `creatorStatus=approved`, and `status=active` sees creator space, creator dashboard, and publish action.
- Other creator states: pending, rejected, suspended, or inactive accounts do not receive approved-creator navigation.

Desktop and mobile navigation apply the same rules. The fixed mobile dashboard item must not remain visible to visitors or fans.

The frontend contains no admin link for any identity, including administrators.

## Overlay Architecture

### Portal boundary

`MediaViewer` and `UnlockDialog` mount through React portals under `document.body`. They must never remain descendants of a post card, gallery, transformed element, backdrop-filter element, or overflow-clipping container.

Opening either overlay:

- covers the current viewport;
- locks background scrolling;
- moves focus into the overlay;
- closes on Escape;
- restores focus to the invoker when closed; and
- supplies dialog semantics and accessible names.

The confirmed unlock bug is caused by the current fixed dialog remaining inside a `glass overflow-hidden` post card. The card establishes the containing and clipping boundary, reducing the fixed overlay to the card rectangle. Raising z-index cannot correct that boundary; portaling the dialog removes it.

### MediaViewer behavior

`MediaViewer` accepts a safe list of accessible media assets and an initial index.

For images it renders:

- contain-fit media;
- previous and next controls when more than one accessible item exists;
- current index and total count;
- fullscreen/exit-fullscreen; and
- close.

For videos it renders:

- a `<video>` element with native controls;
- no autoplay;
- no implicit unmute;
- metadata preloading only;
- fullscreen/exit-fullscreen; and
- close.

Fullscreen uses the browser Fullscreen API on the viewer surface. If the API is unavailable or rejected, the existing viewport overlay remains usable.

The same viewer is used by:

- homepage post-card accessible media;
- the post-detail hero;
- the post-detail gallery; and
- post thumbnails in search results.

Clicking locked media does not add the locked asset to the viewer. It opens `UnlockDialog`. Client rendering does not grant an entitlement.

### UnlockDialog behavior

The dialog receives the post, creator, visibility, price, session state, and callback location.

- Anonymous purchase: show the post and price with `Sign in to unlock`.
- Anonymous membership: show the creator membership requirement with `Sign in to view membership`.
- Authenticated purchase: expose the existing staging order/intent confirmation flow.
- Authenticated membership: navigate to the creator membership page.

Channel membership does not satisfy post payment, subscription, or private-media entitlement checks.

## Search Thumbnails

`SearchResult` adds an optional media preview:

```ts
type SearchMediaPreview = {
  src: string;
  alt: string;
  kind: "image" | "video";
};
```

Search repository projection fetches previews only for post results already eligible for public search. The selected asset must:

- belong to the result post;
- have `status=ready`;
- have `visibility=public`;
- be the first asset by stable media order; and
- expose only the public delivery URL, alt text, and kind.

Storage keys, derivative keys, uploader identity, processing fields, and paid or member-only media are never returned.

Post result presentation order is:

1. title;
2. one media preview row when available; and
3. summary.

The preview opens `MediaViewer`. The title and summary remain a normal link to the post. Results without a safe preview retain the existing post-type icon. Creator and channel results retain their current type icons and never borrow a post thumbnail.

## Public Comments

`GET /api/posts/[id]/comments` remains public and returns only `status=visible` comments in deterministic cursor order.

Seed data creates real `PostComment` rows associated with existing seeded users. The legacy `Post.comments` JSON may remain for compatibility with existing counters during this correction, but it is not the source for the rendered comment list.

The post-detail page:

- fetches and renders visible comments for visitors and authenticated users;
- shows visitors a `Sign in to join the conversation` action;
- shows the input and publish action only to authenticated users; and
- retains the current page as the sign-in callback.

`POST /api/posts/[id]/comments` continues to require:

- an authenticated active session;
- same-origin validation;
- the existing comment rate limit; and
- server-derived author identity.

Body or query user identifiers cannot override session identity.

## Test-Artifact Cleanup

The staging artifact:

- post ID: `custom-1785224228010`
- title prefix: `Phase 6 ownership`

is deleted explicitly with its cascade-related data and search document.

The Phase 6 identity test that creates the ownership post must retain the created ID and clean it in `finally` or an equivalent fixture teardown. Cleanup runs after success, assertion failure, and bounded timeout handling.

A regression assertion verifies that the test-created post and search document no longer exist after the test. Production feed behavior must not hide records based on a `Phase 6` title pattern; the database is cleaned at the source.

## Staging Acceptance Accounts

Staging provides:

- one active fan account; and
- one active, approved creator account.

Credentials use a staging-only temporary password. The password is not committed, printed in build logs, or included in repository documentation. The delivered account identities are verified through the public `:99` origin.

## Testing Strategy

All behavior changes follow test-driven development with a witnessed failing assertion before production changes.

Focused coverage includes:

### Overlay and media

- unlock dialog is a child of `document.body`, not `article`;
- overlay rectangle covers the viewport;
- visitor dialog omits Demo card data and links to sign-in;
- image navigation, Escape, focus restoration, and body-scroll locking;
- video opens paused with controls;
- fullscreen request and fallback behavior; and
- homepage, post hero, post gallery, and search preview use the same viewer contract.

### Identity and admin

- visitor navigation has no Demo, creator, dashboard, publish, or admin entries;
- fan navigation shows the actual fan identity without creator tools;
- approved creator navigation shows creator tools;
- non-approved creator states do not;
- mobile navigation matches desktop authorization; and
- `/admin` renders the admin shell without frontend navigation while preserving server ACL.

### Search

- public free post results include only eligible preview fields;
- preview ordering is stable;
- member, purchase, private, suspended, and otherwise ineligible assets do not leak;
- creator and channel result contracts remain compatible; and
- no-preview post results render safely.

### Comments

- anonymous GET returns visible comments;
- hidden comments are excluded;
- visitor page renders comments and sign-in action without an editor;
- authenticated page renders the editor;
- anonymous POST returns 401;
- forged body/query identity cannot select the author; and
- authenticated POST uses the session user.

### Cleanup

- Phase 6 ownership test cleanup executes;
- the created post and search document are absent after cleanup; and
- staging feed no longer contains the known artifact.

## Verification and Delivery

Before each commit, exclude `README.md`, `start-local-demo.cmd`, `.superpowers/`, `.env*`, and real secrets.

Verification sequence:

1. focused red/green tests;
2. `npm run db:generate`;
3. lint;
4. typecheck;
5. production build;
6. complete local Playwright;
7. intentional commit and push;
8. staging migration/seed/deployment;
9. deployed Playwright with one worker and bounded failure/timeout settings;
10. public `http://183.6.3.174:99` visitor, fan, creator, and admin acceptance;
11. Web/Worker health, container status, runtime commit, and post-deploy log checks.

Every long-running command has an explicit timeout. Search pagination tests retain repeated-cursor fail-fast guards.

## Out of Scope

- a separate admin hostname before a domain exists;
- TLS enablement for external port 999;
- real payment-provider credential activation;
- WebSocket or chat;
- Web3;
- vector search;
- external search services; and
- changes that weaken channel, payment, subscription, private-media, session, or admin ACL boundaries.
