# PureHub Account Hub, Trending Rail, and Admin IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved role-aware account hub, home Hot Posts rail, and domain-split independent administration site without weakening Phase 7 ACL or entitlement boundaries.

**Architecture:** Add two narrowly scoped Prisma models and a session-owned account repository, then expose cursor-paginated `/api/me` resources to reusable account-list pages. Reuse the PostgreSQL search index for Hot Posts. Replace the monolithic admin client with an independent protected route group whose pages load only their own domain APIs and whose server authorization distinguishes read and write capabilities.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.9, Prisma 6/PostgreSQL, Better Auth, Tailwind CSS, Playwright.

## Global Constraints

- Work only in `C:\Users\tonym\Desktop\Codex Project\Purehub Plan`.
- Do not modify, delete, stage, or commit `README.md` or `start-local-demo.cmd`.
- Never commit real `.env` files, credentials, payment secrets, or SSH material.
- Use `npm run db:generate`; do not use `npx prisma generate`.
- Reuse `tests/auth-helpers.ts` for authenticated tests.
- Body, query, route, and header user IDs cannot replace session identity.
- `x-admin-role` has no authorization effect.
- Channel bookmarks and memberships never grant post purchase, subscription, entitlement, or private-media access.
- Do not add WebSocket, chat, Web3, vector search, or an external search service.
- Deployed Playwright uses exactly one worker.
- Before every commit run `git diff --cached --name-only` and confirm the protected files are absent.

---

## Milestone A: Account Data and APIs

### Task 1: Add Channel Bookmark and Post View History Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730000000_account_hub/migration.sql`
- Create: `lib/account/types.ts`
- Create: `lib/account/cursor.ts`
- Test: `tests/account-hub-data.spec.ts`

**Interfaces:**
- Produces: Prisma clients `channelBookmark` and `postViewHistory`.
- Produces: `AccountListScope`, `AccountCursor`, `encodeAccountCursor(cursor)`, and `parseAccountCursor(value, scope)`.
- Consumes: existing `User`, `Post`, and `Channel` relations.

- [ ] **Step 1: Write failing schema and cursor tests**

Add tests that assert Prisma exposes both models and that cursors are
scope-bound:

```ts
import { expect, test } from "@playwright/test";
import { prisma } from "../lib/prisma";
import { encodeAccountCursor, parseAccountCursor } from "../lib/account/cursor";

test("account cursors are opaque and scope-bound", () => {
  const encoded = encodeAccountCursor({
    scope: "history",
    occurredAt: "2026-07-30T00:00:00.000Z",
    id: "view-1"
  });
  expect(parseAccountCursor(encoded, "history").id).toBe("view-1");
  expect(() => parseAccountCursor(encoded, "likes")).toThrow(
    "Account cursor does not belong to this resource."
  );
  expect(() => parseAccountCursor("not-a-cursor", "history")).toThrow(
    "Account cursor is invalid."
  );
});

test("account persistence models are available", () => {
  expect(prisma.channelBookmark).toBeDefined();
  expect(prisma.postViewHistory).toBeDefined();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx playwright test tests/account-hub-data.spec.ts --project=desktop --workers=1
```

Expected: compilation fails because `lib/account/cursor.ts` and the generated
Prisma delegates do not exist.

- [ ] **Step 3: Add relations and models**

Add `channelBookmarks` and `postViewHistory` relations to `User`, a
`channelBookmarks` relation to `Channel`, and a `viewHistory` relation to
`Post`. Define:

```prisma
model ChannelBookmark {
  id        String   @id @default(cuid())
  userId    String
  channelId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  channel   Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([userId, channelId])
  @@index([userId, createdAt, id])
}

model PostViewHistory {
  id            String   @id @default(cuid())
  userId        String
  postId        String
  firstViewedAt DateTime @default(now())
  lastViewedAt  DateTime @default(now())
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post          Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([userId, postId])
  @@index([userId, lastViewedAt, id])
}
```

Create the matching SQL tables, unique indexes, listing indexes, and cascading
foreign keys in the migration.

- [ ] **Step 4: Implement typed opaque cursors**

Define exact scopes in `lib/account/types.ts`:

```ts
export type AccountListScope =
  | "favorite-posts"
  | "favorite-channels"
  | "unlocked"
  | "likes"
  | "history"
  | "orders"
  | "following";

export type AccountCursor = {
  scope: AccountListScope;
  occurredAt: string;
  id: string;
};
```

Encode JSON with `Buffer.from(JSON.stringify(cursor)).toString("base64url")`.
Decode only objects with an allowed scope, a valid ISO timestamp, and a
non-empty string ID. A scope mismatch throws
`Account cursor does not belong to this resource.`.

- [ ] **Step 5: Generate Prisma and verify GREEN**

Run:

```powershell
npm run db:generate
npx playwright test tests/account-hub-data.spec.ts --project=desktop --workers=1
```

Expected: both tests pass.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- prisma/schema.prisma prisma/migrations/20260730000000_account_hub/migration.sql lib/account/types.ts lib/account/cursor.ts tests/account-hub-data.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add account hub persistence"
```

### Task 2: Implement Favorite Posts and ACL-safe Favorite Channels

**Files:**
- Create: `lib/account/repository.ts`
- Create: `lib/account/http.ts`
- Modify: `lib/db-repository.ts`
- Create: `app/api/me/favorites/route.ts`
- Create: `app/api/channels/[slug]/bookmark/route.ts`
- Modify: `app/api/channels/[slug]/route.ts`
- Test: `tests/account-hub-api.spec.ts`

**Interfaces:**
- Consumes: Task 1 cursor functions and Prisma delegates.
- Consumes: `getChannelBySlug(slug, viewerUserId, cursor?)` as the canonical
  visibility check.
- Produces: `setChannelBookmark(userId, slug, bookmarked)`.
- Produces: `listFavoritePosts(userId, input)` and
  `listFavoriteChannels(userId, input)`.
- Produces: account list response `{ items, nextCursor }`.

- [ ] **Step 1: Write failing favorites identity and ACL tests**

Use `registerFan` and seeded channel fixtures:

```ts
async function requireAccountDatabase(
  request: APIRequestContext,
  testInfo: TestInfo
) {
  test.skip(testInfo.project.name === "mobile", "Account API database coverage runs once.");
  test.skip(!(await hasDatabase(request)), "Account APIs require PostgreSQL.");
}

test("favorites are session-owned and channel bookmarks grant no access", async ({ request }, testInfo) => {
  await requireAccountDatabase(request, testInfo);
  const fan = await registerFan(request, "account-favorites");
  await signIn(request, fan.email);
  const fanId = (await (await request.get("/api/me")).json()).user.id as string;

  expect((await request.get("/api/me/favorites?type=posts")).ok()).toBeTruthy();
  expect((await request.post(`/api/channels/${hiddenChannel.slug}/bookmark`, {
    data: { userId: "c1" }
  })).status()).toBe(404);

  const response = await request.post("/api/channels/purehub-official/bookmark", {
    data: { userId: "c1" }
  });
  expect(response.ok()).toBeTruthy();
  expect(await prisma.channelBookmark.findUnique({
    where: { userId_channelId: { userId: fanId, channelId: "channel-purehub-official" } }
  })).not.toBeNull();
  expect(await prisma.channelMembership.findUnique({
    where: { channelId_userId: { channelId: "channel-purehub-official", userId: fanId } }
  })).toBeNull();
});
```

Create `hiddenChannel` in the test with `visibility: "private"`,
`discoverability: "hidden"`, `status: "active"`, and seeded creator `c1` as
owner, then delete it in `finally`. Also test unauthenticated `401`, invalid
`type` and cursor `400`, repeated POST/DELETE idempotency, and query/header
user-ID override attempts.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx playwright test tests/account-hub-api.spec.ts --project=desktop --workers=1 -g "favorites"
```

Expected: `404` because the new routes do not exist.

- [ ] **Step 3: Export canonical post mapping**

Rename the internal `mapPost` and `addViewerState` helpers to exported
`mapDatabasePost` and `addPostViewerState`. Keep all existing callers on the
same behavior so account lists return the existing `Post` DTO rather than a
second post shape.

- [ ] **Step 4: Implement favorites repository methods**

Use deterministic descending `(createdAt, id)` predicates. Fetch `take + 1`,
return only `take`, and encode the last returned relation row as the next
cursor.

`setChannelBookmark` must:

```ts
export async function setChannelBookmark(
  userId: string,
  slug: string,
  bookmarked: boolean
): Promise<{ bookmarked: boolean }> {
  const visible = await getChannelBySlug(slug, userId);
  if (!visible) throw new AccountRepositoryError("Channel not found.", 404);
  if (bookmarked) {
    await prisma.channelBookmark.upsert({
      where: { userId_channelId: { userId, channelId: visible.channel.id } },
      update: {},
      create: { userId, channelId: visible.channel.id }
    });
  } else {
    await prisma.channelBookmark.deleteMany({
      where: { userId, channelId: visible.channel.id }
    });
  }
  return { bookmarked };
}
```

Translate channel visibility failures to the same `404` response. Do not read
or write `ChannelMembership`.

- [ ] **Step 5: Implement strict HTTP parsing and routes**

`lib/account/http.ts` accepts each query parameter at most once, rejects fields
outside the route's allow-list, parses `limit` from 1 through 50, and maps
`AccountRepositoryError` or `TypeError` to JSON status codes.

`GET /api/me/favorites` requires a session and accepts exactly
`type=posts|channels`, `cursor`, and `limit`.

Bookmark POST/DELETE applies `enforceSameOrigin`, `requireUser`, normalized
channel slugs, and ignores body identity by rejecting identity fields rather
than using them.

- [ ] **Step 6: Add `bookmarked` to channel detail**

For an authenticated viewer, `GET /api/channels/[slug]` includes a boolean
`channel.bookmarked` based on `ChannelBookmark`. It does not change the
existing channel `access` object.

- [ ] **Step 7: Run focused and Phase 7 ACL regression tests**

```powershell
npx playwright test tests/account-hub-api.spec.ts --project=desktop --workers=1 -g "favorites"
npx playwright test tests/phase7-channels-search.spec.ts --project=desktop --workers=1 -g "membership|entitlement|private media|channel detail"
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit only Task 2 files**

```powershell
git add -- lib/account/repository.ts lib/account/http.ts lib/db-repository.ts app/api/me/favorites/route.ts 'app/api/channels/[slug]/bookmark/route.ts' 'app/api/channels/[slug]/route.ts' tests/account-hub-api.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add post and channel favorites APIs"
```

### Task 3: Add Session-owned Viewing History and 90-day Cleanup

**Files:**
- Modify: `lib/account/repository.ts`
- Create: `app/api/posts/[id]/view/route.ts`
- Create: `app/api/me/history/route.ts`
- Create: `app/api/internal/account-maintenance/run/route.ts`
- Modify: `app/(site)/post/[id]/page.tsx`
- Modify: `scripts/worker.mjs`
- Test: `tests/account-hub-api.spec.ts`
- Test: `tests/worker-runtime.spec.ts`

**Interfaces:**
- Produces: `recordPostView(userId, postId, now?)`.
- Produces: `listPostHistory(userId, input, now?)`.
- Produces: `deleteExpiredPostViews(now?)`.
- Consumes: existing worker token validation used by internal Phase 5/7 routes.

- [ ] **Step 1: Write failing view-history tests**

Test one row per user/post, first timestamp preservation, last timestamp
advancement, exact 90-day exclusion, deletion, and session ownership:

```ts
const first = new Date("2026-04-30T00:00:00.000Z");
const second = new Date("2026-07-30T00:00:00.000Z");
await recordPostView(fanId, post.id, first);
await recordPostView(fanId, post.id, second);
const row = await prisma.postViewHistory.findUniqueOrThrow({
  where: { userId_postId: { userId: fanId, postId: post.id } }
});
expect(row.firstViewedAt).toEqual(first);
expect(row.lastViewedAt).toEqual(second);
```

At the route level, test anonymous POST returns `401`, body `userId` cannot
replace the session, and a missing post returns `404`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/account-hub-api.spec.ts --project=desktop --workers=1 -g "view history"
```

Expected: missing exports and routes fail.

- [ ] **Step 3: Implement history repository methods**

Use:

```ts
const HISTORY_RETENTION_DAYS = 90;
const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 86_400_000);
```

`recordPostView` verifies the post exists and upserts
`userId_postId`, updating only `lastViewedAt`. `listPostHistory` filters
`lastViewedAt >= cutoff`, includes the post/media, applies canonical post
mapping and viewer state, and orders descending by `(lastViewedAt, id)`.
`deleteExpiredPostViews` deletes `lastViewedAt < cutoff` and returns
`{ deleted: count }`.

- [ ] **Step 4: Implement history routes**

`POST /api/posts/[id]/view` applies same-origin enforcement, requires the
session, rejects identity override fields, and returns `204`.

`GET /api/me/history` requires the session and accepts only `cursor` and
`limit`.

The internal cleanup route accepts only the configured worker token and invokes
`deleteExpiredPostViews`.

- [ ] **Step 5: Record views only from post detail**

After both session and post ID are available, fire one best-effort request:

```ts
useEffect(() => {
  if (!session?.user || !post?.id) return;
  void fetch(`/api/posts/${post.id}/view`, { method: "POST" }).catch(() => undefined);
}, [post?.id, session?.user]);
```

Do not add this call to `PostCard`, search results, `MediaGallery`, or media
preview.

- [ ] **Step 6: Schedule cleanup in the worker**

Add `accountMaintenance` health state and a guarded call to
`/api/internal/account-maintenance/run`. Run it on worker startup and on the
existing periodic cycle without blocking Phase 5 or Phase 7 task reporting.

- [ ] **Step 7: Verify history and worker behavior**

```powershell
npx playwright test tests/account-hub-api.spec.ts tests/worker-runtime.spec.ts --project=desktop --workers=1 -g "view history|account maintenance"
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit only Task 3 files**

```powershell
git add -- lib/account/repository.ts 'app/api/posts/[id]/view/route.ts' app/api/me/history/route.ts app/api/internal/account-maintenance/run/route.ts 'app/(site)/post/[id]/page.tsx' scripts/worker.mjs tests/account-hub-api.spec.ts tests/worker-runtime.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add ninety day viewing history"
```

### Task 4: Add Likes, Following, Unlocked Content, and Buyer Order Lists

**Files:**
- Modify: `lib/account/types.ts`
- Modify: `lib/account/repository.ts`
- Modify: `lib/payments/repository.ts`
- Create: `app/api/me/likes/route.ts`
- Create: `app/api/me/following/route.ts`
- Create: `app/api/me/unlocked/route.ts`
- Create: `app/api/me/orders/route.ts`
- Test: `tests/account-hub-api.spec.ts`

**Interfaces:**
- Produces: `listLikedPosts`, `listFollowingCreators`,
  `listUnlockedPosts`, and `listBuyerOrders`.
- Produces DTO source `"purchase" | "subscription"` for unlocked entries.
- Produces buyer order DTO without provider secrets or provider payloads.

- [ ] **Step 1: Write failing list and privacy tests**

Seed one like, follow, purchase entitlement, active subscription, expired
subscription, and orders for two buyers. Assert:

```ts
expect((await meLikes.json()).items.map((item: { post: { id: string } }) => item.post.id))
  .toContain(likedPost.id);
expect((await meUnlocked.json()).items).toEqual(expect.arrayContaining([
  expect.objectContaining({ post: expect.objectContaining({ id: purchased.id }), source: "purchase" }),
  expect.objectContaining({ post: expect.objectContaining({ id: memberPost.id }), source: "subscription" })
]));
expect(JSON.stringify((await meOrders.json()).items)).not.toContain("clientSecret");
expect(JSON.stringify((await meOrders.json()).items)).not.toContain("manualInstructions");
```

Assert the other buyer's order never appears and all anonymous requests return
`401`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/account-hub-api.spec.ts --project=desktop --workers=1 -g "account lists"
```

Expected: missing routes return `404`.

- [ ] **Step 3: Implement relationship-backed lists**

For Likes and Following, order by relation `(createdAt, id)` descending and
return the relation time as `occurredAt`.

For Unlocked Content:

- include purchase-source entitlements;
- include posts from creators with an active subscription;
- deduplicate a post that qualifies from both sources in favor of `purchase`;
- never use channel membership;
- apply canonical post access and visibility checks.

For orders, select only:

```ts
{
  id: true,
  kind: true,
  itemId: true,
  amount: true,
  currency: true,
  status: true,
  provider: true,
  createdAt: true,
  paidAt: true,
  creator: { select: { id: true, name: true, handle: true, avatar: true } },
  metadata: true
}
```

Derive a safe `itemLabel` only from `postTitle` or `planName` metadata strings.
Do not include payment intents, transactions, client secrets, raw provider
payloads, or manual instructions.

- [ ] **Step 4: Implement the four GET routes**

Each route requires `requireUser`, accepts only `cursor` and `limit`, and calls
the repository with `session.user.id`. Reject `userId` in query parameters with
`400`; never accept it as input.

- [ ] **Step 5: Verify account APIs**

```powershell
npx playwright test tests/account-hub-api.spec.ts --project=desktop --workers=1
```

Expected: all account data and API tests pass.

- [ ] **Step 6: Commit only Task 4 files**

```powershell
git add -- lib/account/types.ts lib/account/repository.ts lib/payments/repository.ts app/api/me/likes/route.ts app/api/me/following/route.ts app/api/me/unlocked/route.ts app/api/me/orders/route.ts tests/account-hub-api.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add account activity list APIs"
```

---

## Milestone B: Account and Home User Interface

### Task 5: Make Site Navigation Role-aware

**Files:**
- Modify: `components/app-shell.tsx`
- Create: `components/account-nav.tsx`
- Create: `app/(site)/me/page.tsx`
- Modify: `app/(site)/library/page.tsx`
- Test: `tests/account-hub-ui.spec.ts`

**Interfaces:**
- Consumes: Better Auth session fields `role`, `creatorStatus`, and `status`.
- Produces: grouped desktop public/account/creator navigation.
- Produces: mobile `/me` account menu.

- [ ] **Step 1: Write failing guest, fan, and creator navigation tests**

```ts
async function signInCreatorPage(page: Page) {
  await signInCreator(page.request);
}

test("guest sees public navigation only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "成為博主" })).toBeVisible();
  await expect(page.getByRole("link", { name: "收藏" })).toHaveCount(0);
});

test("approved creator gets fan links and creator space without become creator", async ({ page }) => {
  await signInCreatorPage(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "收藏" })).toBeVisible();
  await expect(page.getByRole("link", { name: "訂單記錄" })).toBeVisible();
  await expect(page.getByText("博主空間")).toBeVisible();
  await expect(page.getByRole("link", { name: "成為博主" })).toHaveCount(0);
});
```

Also cover fan and pending creator states plus mobile My navigation.

- [ ] **Step 2: Run focused UI tests and verify RED**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --workers=1 -g "navigation"
```

Expected: account links are absent and approved creators still see Become a
Creator.

- [ ] **Step 3: Split navigation definitions by audience**

`components/account-nav.tsx` exports:

```ts
export type NavItem = { href: string; label: string };
export const publicNav: NavItem[] = [
  { href: "/", label: "首頁" },
  { href: "/explore", label: "探索" },
  { href: "/channels", label: "頻道" },
  { href: "/search", label: "搜尋" }
];
export const accountNav: NavItem[] = [
  { href: "/favorites", label: "收藏" },
  { href: "/unlocked", label: "已解鎖內容" },
  { href: "/likes", label: "喜歡" },
  { href: "/history", label: "觀看歷史" },
  { href: "/orders", label: "訂單記錄" },
  { href: "/following", label: "關注" },
  { href: "/notifications", label: "通知" }
];
export const creatorNav: NavItem[] = [
  { href: "/dashboard", label: "博主工作台" },
  { href: "/dashboard/posts", label: "作品管理" },
  { href: "/dashboard/posts/new", label: "發布作品" },
  { href: "/dashboard/channels", label: "頻道" },
  { href: "/dashboard/members", label: "會員" },
  { href: "/dashboard/wallet", label: "錢包與收益" }
];
export type SessionUserLike = {
  role?: string;
  creatorStatus?: string;
  status?: string;
};
export function canApplyAsCreator(user: SessionUserLike | null): boolean;
export function isApprovedCreator(user: SessionUserLike | null): boolean;
```

`canApplyAsCreator` is false only for an active approved creator. Pending or
rejected applicants keep the entry.

- [ ] **Step 4: Render grouped desktop and compact mobile navigation**

Guests render public links plus Become a Creator. Authenticated users render an
Account section. Approved creators render Creator Space. Mobile bottom
navigation links to `/me`; `/me` renders the complete account and creator menus.

- [ ] **Step 5: Redirect legacy Library**

Replace the client Library page with a server redirect:

```ts
import { redirect } from "next/navigation";
export default function LegacyLibraryPage() {
  redirect("/favorites");
}
```

- [ ] **Step 6: Run navigation tests**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --project=mobile --workers=1 -g "navigation|legacy library"
```

Expected: all selected cases pass.

- [ ] **Step 7: Commit only Task 5 files**

```powershell
git add -- components/app-shell.tsx components/account-nav.tsx 'app/(site)/me/page.tsx' 'app/(site)/library/page.tsx' tests/account-hub-ui.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add role aware account navigation"
```

### Task 6: Build Favorites and Unlocked Content Pages

**Files:**
- Create: `components/account/account-list-state.tsx`
- Create: `components/account/account-post-grid.tsx`
- Create: `components/account/channel-favorite-card.tsx`
- Create: `app/(site)/favorites/page.tsx`
- Create: `app/(site)/unlocked/page.tsx`
- Modify: `components/channels/channel-membership-action.tsx`
- Test: `tests/account-hub-ui.spec.ts`

**Interfaces:**
- Consumes: Task 2 and Task 4 account APIs.
- Produces: reusable loading, empty, error, retry, and load-more UI.
- Produces: Favorites Post/Channel tabs driven by `?type=posts|channels`.

- [ ] **Step 1: Write failing page-state and favorite-tab tests**

Mock the APIs for deterministic UI states and verify:

```ts
await page.goto("/favorites?type=channels");
await expect(page.getByRole("tab", { name: "頻道" })).toHaveAttribute("aria-selected", "true");
await expect(page.getByTestId("channel-favorite-card")).toBeVisible();
await page.getByRole("button", { name: "取消收藏頻道" }).click();
await expect(page.getByTestId("channel-favorite-card")).toHaveCount(0);
```

Add tests for loading, empty, failed request plus Retry, pagination, source
labels Single Purchase and Active Subscription, and unauthenticated return URL.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --workers=1 -g "favorites|unlocked"
```

Expected: page routes are missing.

- [ ] **Step 3: Implement shared account list state**

The component accepts:

```ts
type AccountListStateProps = {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  children: React.ReactNode;
};
```

Render accessible `role="status"` for loading, `role="alert"` for errors, and
a real Retry button.

- [ ] **Step 4: Implement Favorites**

Use URL-backed tabs. Post rows render `PostCard`; channel rows render
`ChannelFavoriteCard`. Mutations update the list only after a successful
DELETE. On failure retain the item and expose an error.

- [ ] **Step 5: Implement Unlocked Content**

Render shared post cards with an access-source badge. Do not infer access from
channel membership in the client. The API-provided source is authoritative.

- [ ] **Step 6: Add channel favorite action**

On visible channel detail, authenticated users can POST or DELETE the bookmark
route. Guests go to sign-in with the current safe callback URL. Keep this action
separate from Join/Leave.

- [ ] **Step 7: Verify the pages**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --project=mobile --workers=1 -g "favorites|unlocked"
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit only Task 6 files**

```powershell
git add -- components/account/account-list-state.tsx components/account/account-post-grid.tsx components/account/channel-favorite-card.tsx 'app/(site)/favorites/page.tsx' 'app/(site)/unlocked/page.tsx' components/channels/channel-membership-action.tsx tests/account-hub-ui.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add favorites and unlocked pages"
```

### Task 7: Build Likes, History, Orders, and Following Pages

**Files:**
- Create: `components/account/activity-list.tsx`
- Create: `components/account/order-history.tsx`
- Create: `components/account/following-card.tsx`
- Create: `app/(site)/likes/page.tsx`
- Create: `app/(site)/history/page.tsx`
- Create: `app/(site)/orders/page.tsx`
- Create: `app/(site)/following/page.tsx`
- Modify: `components/post-card.tsx`
- Test: `tests/account-hub-ui.spec.ts`

**Interfaces:**
- Consumes: Task 3 and Task 4 account APIs.
- Consumes: existing post unlike and creator unfollow endpoints.
- Produces: responsive table/card order history.

- [ ] **Step 1: Write failing interaction and responsive tests**

Verify unlike and unfollow remove items only after successful responses, history
shows last-viewed time, and orders expose the approved fields:

```ts
await page.goto("/orders");
await expect(page.getByRole("columnheader", { name: "訂單編號" })).toBeVisible();
await expect(page.getByText("已付款")).toBeVisible();
await expect(page.getByText(/clientSecret|manualInstructions/)).toHaveCount(0);
```

On the mobile project, assert order cards are visible and the desktop table is
hidden.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --project=mobile --workers=1 -g "likes|history|orders|following"
```

Expected: routes are missing.

- [ ] **Step 3: Allow PostCard removal callbacks**

Add optional props:

```ts
type PostCardProps = {
  post: Post;
  onUnlike?: (postId: string) => void;
  onUnbookmark?: (postId: string) => void;
};
```

Invoke callbacks only after successful server mutations. Existing pages that do
not pass callbacks keep current behavior.

- [ ] **Step 4: Implement Likes and Following**

Likes uses `PostCard` and removes a row through `onUnlike`. Following renders
creator data and removes a row only after successful DELETE to the existing
follow route.

- [ ] **Step 5: Implement Viewing History**

Render thumbnail, title, creator, and localized `lastViewedAt`, linking only to
the post detail. Do not emit a view-recording request from the history card.

- [ ] **Step 6: Implement responsive Order History**

Map canonical statuses to Pending Payment, Paid, Failed, and Refunded labels.
Render the same DTO in a desktop table and mobile cards. Do not add refund or
cancel controls.

- [ ] **Step 7: Verify all account activity pages**

```powershell
npx playwright test tests/account-hub-ui.spec.ts --project=desktop --project=mobile --workers=1 -g "likes|history|orders|following"
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit only Task 7 files**

```powershell
git add -- components/account/activity-list.tsx components/account/order-history.tsx components/account/following-card.tsx 'app/(site)/likes/page.tsx' 'app/(site)/history/page.tsx' 'app/(site)/orders/page.tsx' 'app/(site)/following/page.tsx' components/post-card.tsx tests/account-hub-ui.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add account activity pages"
```

### Task 8: Add Hot Posts Above Hot Creators

**Files:**
- Modify: `lib/search/repository.ts`
- Create: `app/api/trending/posts/route.ts`
- Modify: `components/right-rail.tsx`
- Test: `tests/account-hub-ui.spec.ts`
- Test: `tests/account-hub-api.spec.ts`

**Interfaces:**
- Produces: `listTrendingPosts(limit, viewerUserId)` returning canonical post
  DTOs ordered by indexed `popularityScore`.
- Produces: public `GET /api/trending/posts?limit=4`.

- [ ] **Step 1: Write failing ranking and layout tests**

Seed search documents for a public free post, a members post, and a private or
ineligible post. Assert only eligible search-index posts return, sorted by
`popularityScore DESC`, then `publishedAt DESC`, then ID.

For the home page:

```ts
const hotPosts = page.getByTestId("hot-posts");
const hotCreators = page.getByTestId("hot-creators");
expect(await hotPosts.evaluate((node) => node.compareDocumentPosition(
  document.querySelector('[data-testid="hot-creators"]')!
) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
await expect(hotPosts.getByRole("link", { name: "查看全部熱度作品" })).toHaveAttribute(
  "href", "/trending/posts"
);
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/account-hub-api.spec.ts tests/account-hub-ui.spec.ts --project=desktop --workers=1 -g "hot posts"
```

Expected: route and `hot-posts` section do not exist.

- [ ] **Step 3: Implement indexed trending query**

Query `SearchDocument` with `entityType: "post"`, order by
`popularityScore DESC`, `publishedAt DESC`, and `entityId ASC`, take 1 through
12, fetch matching canonical posts, preserve rank order, and discard any post
that is no longer publicly eligible.

- [ ] **Step 4: Implement strict public endpoint**

Accept only one `limit` parameter from 1 through 12; default to 4. Return
`{ posts }`. Invalid or duplicate parameters return `400`.

- [ ] **Step 5: Render Hot Posts before Hot Creators**

Fetch four posts, render thumbnail, title, creator, and likes or popularity
summary. Add `/trending/posts` footer. Keep the existing creator list and follow
behavior in a separate `data-testid="hot-creators"` section.

- [ ] **Step 6: Verify ranking and layout**

```powershell
npx playwright test tests/account-hub-api.spec.ts tests/account-hub-ui.spec.ts --project=desktop --workers=1 -g "hot posts"
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit only Task 8 files**

```powershell
git add -- lib/search/repository.ts app/api/trending/posts/route.ts components/right-rail.tsx tests/account-hub-ui.spec.ts tests/account-hub-api.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add hot posts home rail"
```

---

## Milestone C: Independent Domain-split Administration

### Task 9: Add Domain and Action Admin Authorization

**Files:**
- Modify: `lib/admin-auth.ts`
- Modify: admin route handlers under `app/api/admin/**/route.ts`
- Modify: `app/admin/layout.tsx`
- Create: `app/admin/sign-in/page.tsx`
- Create: `app/admin/(protected)/layout.tsx`
- Modify: `components/admin-shell.tsx`
- Create: `components/admin/admin-nav.tsx`
- Create: `components/admin/admin-ui.tsx`
- Test: `tests/admin-information-architecture.spec.ts`
- Modify: `tests/phase3-admin.spec.ts`
- Modify: `tests/phase7-channels-search.spec.ts`

**Interfaces:**
- Produces: `AdminSection` values `overview`, `members`, `creators`,
  `content`, `channels`, `finance`, `settings`, and `audit`.
- Produces: `AdminAccess = "read" | "write"`.
- Produces: `requireAdmin(request, section, access?)`.
- Produces: independent public `/admin/sign-in` and protected admin layout.

- [ ] **Step 1: Write failing role matrix and sign-in separation tests**

Assert:

```ts
expect(canAdminAccess("support_admin", "members", "read")).toBe(true);
expect(canAdminAccess("support_admin", "members", "write")).toBe(false);
expect(canAdminAccess("finance_admin", "finance", "write")).toBe(true);
expect(canAdminAccess("analyst", "audit", "read")).toBe(true);
expect(canAdminAccess("analyst", "audit", "write")).toBe(false);
```

Verify `/admin/sign-in` renders without an admin session, public pages contain
no Admin link, direct forbidden API access is `403`, and `x-admin-role` cannot
elevate a support user.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts --project=desktop --workers=1 -g "authorization|sign-in"
```

Expected: missing matrix helper and admin sign-in route fail.

- [ ] **Step 3: Replace legacy section arrays with an action matrix**

Implement `canAdminAccess(role, section, access)` from the approved matrix.
Keep `adminPermissions(role)` as a derived list of readable sections for the
overview response. Route handlers that mutate call
`requireAdmin(request, section, "write")`; GET handlers call read access.

Map existing resources:

- users to `members`;
- creator applications and levels to `creators`;
- channels to `channels`;
- finance endpoints to `finance`;
- pricing and payment channels to `settings`;
- audit logs to `audit`.

Finance-only settings mutations additionally require `finance_admin` or
`super_admin`; operational settings mutations require `ops_admin` or
`super_admin`.

- [ ] **Step 4: Separate admin sign-in from the protected route group**

Make root `app/admin/layout.tsx` presentation-neutral. Move session and
`AdminAccount` checks into `app/admin/(protected)/layout.tsx`. The route group
does not change URLs. `/admin/sign-in` uses the existing auth client and a
validated callback of `/admin`.

- [ ] **Step 5: Build permission-filtered independent AdminShell**

`AdminShell` receives `{ role, permissions, children }` from the server layout.
Desktop renders a sidebar; mobile renders an admin-specific drawer. Links are
filtered by readable permissions, but this is not treated as authorization.
Expose shared `AdminPageState`, `AdminTable`, and `AdminStatus` components from
`components/admin/admin-ui.tsx`.

- [ ] **Step 6: Verify authorization regressions**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts tests/phase3-admin.spec.ts tests/phase7-channels-search.spec.ts --project=desktop --workers=1 -g "authorization|admin APIs enforce|ADMIN_SECTIONS|channel admin"
```

Expected: updated and existing selected authorization tests pass.

- [ ] **Step 7: Commit only Task 9 files**

Stage the explicit changed API route paths printed by `git status`; do not use
`git add app/api/admin`.

```powershell
git add -- lib/admin-auth.ts ':(glob)app/api/admin/**/route.ts' app/admin/layout.tsx app/admin/sign-in/page.tsx 'app/admin/(protected)/layout.tsx' components/admin-shell.tsx components/admin/admin-nav.tsx components/admin/admin-ui.tsx tests/admin-information-architecture.spec.ts tests/phase3-admin.spec.ts tests/phase7-channels-search.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: add domain admin authorization"
```

### Task 10: Split Overview, Members, Creators, Content, and Channels

**Files:**
- Modify: `lib/admin-repository.ts`
- Create: `lib/admin-content-repository.ts`
- Modify: `app/api/admin/overview/route.ts`
- Create: `app/api/admin/content/route.ts`
- Create: `app/api/admin/content/[id]/route.ts`
- Delete: `app/admin/page.tsx`
- Create: `app/admin/(protected)/page.tsx`
- Create: `app/admin/(protected)/members/page.tsx`
- Create: `app/admin/(protected)/creators/page.tsx`
- Create: `app/admin/(protected)/content/page.tsx`
- Create: `app/admin/(protected)/channels/page.tsx`
- Create: `components/admin/overview-page.tsx`
- Create: `components/admin/members-page.tsx`
- Create: `components/admin/creators-page.tsx`
- Create: `components/admin/content-page.tsx`
- Reuse/Modify: `components/channels/admin-channel-operations.tsx`
- Test: `tests/admin-information-architecture.spec.ts`

**Interfaces:**
- Produces: overview `{ metrics, queues, admin }`.
- Produces: content list and moderation APIs.
- Consumes: existing users, applications, levels, and channel APIs.
- Consumes: URL filters `status`, `queue`, `q`, and `cursor`.

- [ ] **Step 1: Write failing route-isolation and work-queue tests**

Intercept network requests and assert `/admin` requests only overview, while
domain pages request only their own APIs:

```ts
await page.goto("/admin");
await expect(page.getByTestId("admin-work-queues")).toBeVisible();
await page.getByRole("link", { name: /待審博主/ }).click();
await expect(page).toHaveURL(/\/admin\/creators\?status=pending/);
```

Test analogous shortcuts for content, channels, refunds, payouts, and
reconciliation exceptions.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts --project=desktop --workers=1 -g "overview|members|creators|content|channels"
```

Expected: domain pages and queue links are missing.

- [ ] **Step 3: Expand overview metrics and queues**

Return counts only, including `pendingApplications`, `pendingContent`,
`pendingChannels`, `pendingRefunds`, `pendingPayouts`, and
`reconciliationExceptions`. Do not return domain tables from overview.

- [ ] **Step 4: Add content moderation repository and routes**

List posts with creator, comment count, media count, status-derived visibility,
and cursor pagination. PATCH accepts a strict action enum such as
`publish | unpublish | hide` and writes an audit record in the same transaction.
The route requires `content` write access and never accepts actor IDs.

- [ ] **Step 5: Replace the monolithic overview**

`app/admin/(protected)/page.tsx` renders only metrics and queue links. Each queue
link writes the exact domain filter to the URL. Removing the old
`app/admin/page.tsx` ensures the overview is wrapped by the protected route
group.

- [ ] **Step 6: Build Members and Creators domain pages**

Members calls only `/api/admin/users` and supports `q`, role, and status
filters. Creators calls only creator applications and levels endpoints, with
pending status from the URL. Support admins see the read-only variants because
write buttons are omitted and the API still enforces write access.

- [ ] **Step 7: Build Content and Channels domain pages**

Content calls the new content API. Channels moves
`AdminChannelOperations` from overview and initializes its query from URL
filters. Each page uses the shared loading/error/empty/retry components.

- [ ] **Step 8: Verify domain pages**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts --project=desktop --project=mobile --workers=1 -g "overview|members|creators|content|channels"
```

Expected: all selected tests pass and overview no longer issues the monolithic
`Promise.all`.

- [ ] **Step 9: Commit only Task 10 files**

```powershell
git add -- lib/admin-repository.ts lib/admin-content-repository.ts app/api/admin/overview/route.ts app/api/admin/content/route.ts 'app/api/admin/content/[id]/route.ts' app/admin/page.tsx 'app/admin/(protected)/page.tsx' 'app/admin/(protected)/members/page.tsx' 'app/admin/(protected)/creators/page.tsx' 'app/admin/(protected)/content/page.tsx' 'app/admin/(protected)/channels/page.tsx' components/admin/overview-page.tsx components/admin/members-page.tsx components/admin/creators-page.tsx components/admin/content-page.tsx components/channels/admin-channel-operations.tsx tests/admin-information-architecture.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: split admin operations by domain"
```

### Task 11: Split Finance, Settings, and Audit Domains

**Files:**
- Create: `app/admin/(protected)/finance/page.tsx`
- Create: `app/admin/(protected)/settings/page.tsx`
- Create: `app/admin/(protected)/audit/page.tsx`
- Create: `components/admin/finance-page.tsx`
- Create: `components/admin/settings-page.tsx`
- Create: `components/admin/audit-page.tsx`
- Modify: finance, settings, and audit route handlers under `app/api/admin/**`
- Test: `tests/admin-information-architecture.spec.ts`
- Modify: `tests/phase4-payments.spec.ts`
- Modify: `tests/phase5-commercial-readiness.spec.ts`

**Interfaces:**
- Consumes: existing finance, pricing, payment-channel, and audit endpoints.
- Produces: URL-backed Finance tabs `orders`, `payments`, `refunds`, `payouts`,
  `kyc`, and `reconciliation`.
- Produces: read-only Audit and capability-filtered Settings.

- [ ] **Step 1: Write failing finance/settings/audit isolation tests**

Verify:

- `/admin/finance?tab=payouts&status=pending` loads payout data but not pricing;
- `/admin/settings` loads pricing, fee, settlement, and payment-channel data but
  not audit logs;
- `/admin/audit` loads only audit logs;
- analyst controls are read-only;
- finance admin sees finance settings but not operational channel settings;
- `x-admin-role` cannot unlock hidden controls.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts --project=desktop --workers=1 -g "finance|settings|audit"
```

Expected: the three domain pages are missing.

- [ ] **Step 3: Build URL-backed Finance**

Each tab fetches only its own existing endpoint. Preserve refund, payout, KYC,
settlement, and reconciliation operations, but update visible state only after
the server succeeds. Failed mutations keep the prior row and show a retryable
error.

- [ ] **Step 4: Build capability-filtered Settings**

Group Pricing, Platform Fee, Settlement Window, and Payment Channels. Render
only controls whose write capability is present; retain server checks for every
mutation. Keep finance-only and operational settings distinctions from Task 9.

- [ ] **Step 5: Build read-only Audit**

Render actor, action, time, target, and result with loading, empty, error, retry,
and pagination states. The page has no mutation controls.

- [ ] **Step 6: Verify finance regression tests**

```powershell
npx playwright test tests/admin-information-architecture.spec.ts tests/phase4-payments.spec.ts tests/phase5-commercial-readiness.spec.ts --project=desktop --workers=1 -g "finance|settings|audit|refund|payout|reconciliation"
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit only Task 11 files**

Stage the explicit route handler paths from `git status`, then:

```powershell
git add -- ':(glob)app/api/admin/**/route.ts' 'app/admin/(protected)/finance/page.tsx' 'app/admin/(protected)/settings/page.tsx' 'app/admin/(protected)/audit/page.tsx' components/admin/finance-page.tsx components/admin/settings-page.tsx components/admin/audit-page.tsx tests/admin-information-architecture.spec.ts tests/phase4-payments.spec.ts tests/phase5-commercial-readiness.spec.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor: split admin finance settings and audit"
```

---

## Milestone D: Integrated Verification and Staging Handoff

### Task 12: Complete Regression, Build, Push, and Staging Acceptance

**Files:**
- Modify if required by failures: files already owned by Tasks 1-11
- Modify: `docs/handoffs/2026-07-30-account-hub-trending-admin-handoff.md`
- Test: all `tests/*.spec.ts`

**Interfaces:**
- Consumes: every prior task.
- Produces: verified main branch and Ubuntu staging handoff.

- [ ] **Step 1: Run database generation and focused suites**

```powershell
npm run db:generate
npx playwright test tests/account-hub-data.spec.ts tests/account-hub-api.spec.ts tests/account-hub-ui.spec.ts tests/admin-information-architecture.spec.ts --project=desktop --workers=1
```

Expected: zero failures.

- [ ] **Step 2: Run static verification**

```powershell
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run the complete local Playwright suite**

```powershell
npm run test:e2e
```

Expected: zero unexpected failures; database-dependent skips are only the
existing explicitly expected local skips.

- [ ] **Step 4: Repair regressions with focused RED/GREEN cycles**

For every failure, first rerun the exact failing test by file and `-g` title,
confirm the failure, apply the smallest in-scope fix, rerun the focused test,
then rerun the affected suite. Do not weaken assertions, skip a new feature
test, or broaden ACLs to make a test pass.

- [ ] **Step 5: Write the durable handoff**

Record:

- final commit and branch;
- migration name;
- exact local test totals;
- lint, typecheck, and build results;
- protected dirty files left untouched;
- required staging environment and commands;
- rollback and health-check steps;
- deployed Playwright one-worker requirement.

- [ ] **Step 6: Commit the handoff and any verified repair**

```powershell
git add -- docs/handoffs/2026-07-30-account-hub-trending-admin-handoff.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: hand off account hub staging acceptance"
git status --short
```

Expected status contains only the user's `README.md` and
`start-local-demo.cmd` changes.

- [ ] **Step 7: Push main**

```powershell
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: both hashes match.

- [ ] **Step 8: Deploy to Ubuntu staging**

Connect with the configured key and port:

```powershell
ssh -i C:\Users\tonym\.ssh\ed5519 tonymts@183.6.3.174 -p 2222
```

On staging, pull the verified commit, keep secrets in the existing server-side
environment, run the repository deployment flow, apply
`prisma migrate deploy` through `npm run db:migrate`, and confirm all web,
worker, database, cache, object-storage, and proxy health checks.

- [ ] **Step 9: Run deployed acceptance with one worker**

From the configured acceptance environment:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://183.6.3.174:99'
npx playwright test --workers=1
```

Expected: zero unexpected failures.

- [ ] **Step 10: Reset staging data and record final evidence**

Restore the approved seeded acceptance state, recheck the public URL and health
endpoints, and append the deployed suite totals, commit SHA, and service health
to the handoff in a final documentation-only commit and push.
