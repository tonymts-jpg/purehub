# Phase 7 Acceptance Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the anonymous staging acceptance defects, unify media and unlock overlays, make navigation session-derived, add safe search thumbnails and public comments, and prevent test data from leaking into the feed.

**Architecture:** Split the neutral root, frontend site shell, and admin shell with URL-transparent Next.js route groups. Mount reusable media and unlock overlays through React portals, extend the public search projection with an entitlement-safe preview DTO, and keep comment reads public while deriving every write identity from the authenticated session.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.9, Better Auth, Prisma 6/PostgreSQL, Tailwind CSS, Playwright.

## Global Constraints

- Work only in `C:\Users\tonym\Desktop\Codex Project\Purehub Plan` or its existing linked Phase 7 worktree; never use the similarly named displayed folder as a separate repository.
- Do not modify, delete, stage, or commit `README.md` or `start-local-demo.cmd`.
- Do not stage or commit `.superpowers/`, `.env*`, generated secrets, real credentials, or server-only tokens.
- Use `npm run db:generate`; do not use `npx prisma generate`.
- All behavior changes follow TDD: write the focused assertion, observe the expected failure, implement the minimum behavior, and observe the passing result.
- Deployed Playwright uses exactly one worker and an explicit timeout/fail-fast bound.
- Auth tests reuse `tests/auth-helpers.ts`.
- `x-admin-role` has no authorization effect.
- Body or query user IDs cannot override session identity.
- Channel membership cannot bypass payment, subscription, or private-media entitlement.
- Do not add WebSocket, chat, Web3, vector search, or external search services.
- The admin entry remains `/admin` on the current origin until a domain exists; the frontend exposes no link to it.
- Videos open paused without sound autoplay and retain native controls.
- Public search previews expose only `src`, `alt`, and `kind` for a ready public asset belonging to an already eligible free post.
- Every long-running test, build, SSH, or deployment command has an explicit timeout.

---

## File and Responsibility Map

### New files

- `app/(site)/layout.tsx`: frontend-only shell boundary.
- `components/admin-shell.tsx`: admin-only presentation and sign-out control.
- `components/overlay-portal.tsx`: body portal, scroll lock, Escape handling, and focus restoration.
- `components/media-viewer.tsx`: controlled image/video viewer and Fullscreen API behavior.
- `components/unlock-dialog.tsx`: anonymous sign-in and authenticated unlock presentation.
- `tests/phase7-acceptance-corrections.spec.ts`: focused correction acceptance tests.

### Moved files

- Move every non-admin, non-API user-facing route currently directly under `app/` into `app/(site)/` without changing its public URL.
- Keep `app/api/**` and `app/admin/**` at their existing URLs and filesystem responsibilities.

### Modified files

- `app/layout.tsx`: neutral document root only.
- `app/admin/layout.tsx`: server ACL plus `AdminShell`.
- `components/app-shell.tsx`: session-derived visitor/fan/approved-creator navigation.
- `components/post-card.tsx`: stable card test IDs and shared unlock behavior.
- `components/media-gallery.tsx`: shared viewer instead of a private overlay implementation.
- `components/payment-modal.tsx`: remove after all callers use `UnlockDialog`.
- `app/(site)/post/[id]/page.tsx`: shared hero/gallery viewer, anonymous comment call to action, authenticated editor.
- `components/search/search-results.tsx`: safe preview row and shared viewer.
- `lib/types.ts`: media `kind`.
- `lib/db-repository.ts`: preserve media `kind`.
- `lib/channels/types.ts`: optional `SearchMediaPreview`.
- `lib/search/repository.ts`: safe preview projection.
- `prisma/seed.ts`: real visible comments and existing staging acceptance identities.
- `tests/phase6-identity-social.spec.ts`: deterministic cleanup of created posts and search documents.
- Existing Phase 3/6/7 and production-readiness tests as needed to preserve exact contracts.

---

### Task 1: Separate Site and Admin Shells and Derive Navigation from Session

**Files:**
- Create: `app/(site)/layout.tsx`
- Create: `components/admin-shell.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/admin/layout.tsx`
- Modify: `components/app-shell.tsx`
- Move: `app/page.tsx`, `app/become-creator/**`, `app/channels/**`, `app/creator/**`, `app/dashboard/**`, `app/demo/**`, `app/explore/**`, `app/library/**`, `app/membership/**`, `app/notifications/**`, `app/post/**`, `app/register/**`, `app/search/**`, `app/sign-in/**`, `app/trending/**` to equivalent paths below `app/(site)/`
- Create: `tests/phase7-acceptance-corrections.spec.ts`
- Modify: `tests/phase3-admin.spec.ts`

**Interfaces:**
- Consumes: Better Auth inferred fields `session.user.role`, `session.user.creatorStatus`, and `session.user.status`.
- Produces: `AppShell` with `data-testid="site-shell"` and `AdminShell` with `data-testid="admin-shell"`.
- Produces: approved creator predicate equivalent to `role === "creator" && creatorStatus === "approved" && status === "active"`.

- [ ] **Step 1: Write failing visitor, fan, creator, and admin-shell tests**

Add focused tests using `signInFan`, `signInCreator`, and `signInAdmin` from `tests/auth-helpers.ts`:

```ts
test("frontend navigation derives visitor fan and approved creator states from the session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("site-shell")).toBeVisible();
  await expect(page.getByText("Demo 模式")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "站务后台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "博主工作台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "发布作品" })).toHaveCount(0);

  await signInFan(page.request);
  await page.reload();
  await expect(page.getByText("Pure 粉丝", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "博主工作台" })).toHaveCount(0);

  await signInCreator(page.request);
  await page.reload();
  await expect(page.getByText("博主", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "博主工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "发布作品" })).toBeVisible();
});

test("admin uses an independent shell without frontend navigation", async ({ page }) => {
  await signInAdmin(page.request);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-shell")).toBeVisible();
  await expect(page.getByTestId("site-shell")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "首页" })).toHaveCount(0);
  await expect(page.getByText("Demo 模式")).toHaveCount(0);
});
```

Also update the existing Phase 3 admin UI test to assert the independent shell while retaining its ACL assertions.

- [ ] **Step 2: Run the focused tests and verify the intended failures**

Run:

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts tests/phase3-admin.spec.ts --grep "frontend navigation|independent shell|admin UI" --workers=1 --max-failures=1
```

Expected: FAIL because the test IDs do not exist, visitor navigation exposes Demo/admin/creator links, and `/admin` remains wrapped by `AppShell`.

- [ ] **Step 3: Move frontend routes under `(site)`**

Use `git mv` for each listed route. Create:

```tsx
// app/(site)/layout.tsx
import { AppShell } from "@/components/app-shell";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

Change `app/layout.tsx` so its body renders `{children}` directly and does not import `AppShell`.

- [ ] **Step 4: Add the admin-only shell and preserve server ACL**

Create a focused client component:

```tsx
"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="admin-shell" className="min-h-screen bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <span className="flex items-center gap-2 font-black"><ShieldCheck size={20} />PureHub Admin</span>
        <button
          type="button"
          aria-label="登出站务后台"
          onClick={() => authClient.signOut().then(() => window.location.assign("/sign-in"))}
          className="rounded-full border border-[var(--line)] p-2"
        >
          <LogOut size={18} />
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

Wrap the authorized children in `app/admin/layout.tsx` with `<AdminShell>`. Keep the server-side `auth.api.getSession` and active `AdminAccount` lookup. Do not add header fallbacks.

- [ ] **Step 5: Make frontend navigation session-derived**

Remove `ShieldCheck`, `/admin`, `/demo`, fake `role`, and the fake Demo identity card from `AppShell`.

Derive:

```ts
const user = session?.user;
const approvedCreator =
  user?.role === "creator"
  && user.creatorStatus === "approved"
  && user.status === "active";
```

Render the creator-space heading and links only when `approvedCreator` is true. Render the mobile dashboard item only for approved creators; use the existing non-creator navigation items for visitors and fans. Add `data-testid="site-shell"` to the outer shell. For authenticated users, render the real user name and the label `approvedCreator ? "博主" : "粉丝"`.

- [ ] **Step 6: Run focused tests and verify they pass**

Run the same command from Step 2.

Expected: all selected desktop tests pass; shared-staging mobile mutation skips remain expected.

- [ ] **Step 7: Verify URL preservation and compile**

Run:

```powershell
npm run lint
npx tsc --noEmit --incremental false
```

Expected: exit 0; public paths remain `/`, `/post/[id]`, `/search`, `/dashboard/**`, and `/admin`.

- [ ] **Step 8: Commit only Task 1 files**

```powershell
git add -- app components/app-shell.tsx components/admin-shell.tsx tests/phase7-acceptance-corrections.spec.ts tests/phase3-admin.spec.ts
git diff --cached --check
git commit -m "Separate admin and identity-aware site navigation"
```

---

### Task 2: Portal the Unlock Dialog and Remove Anonymous Demo Payment

**Files:**
- Create: `components/overlay-portal.tsx`
- Create: `components/unlock-dialog.tsx`
- Modify: `components/post-card.tsx`
- Modify: `app/(site)/post/[id]/page.tsx`
- Delete: `components/payment-modal.tsx`
- Modify: `tests/phase7-acceptance-corrections.spec.ts`
- Modify: `tests/demo.spec.ts`

**Interfaces:**
- Produces:

```ts
type UnlockDialogProps = {
  open: boolean;
  title: string;
  visibility: "members" | "purchase";
  price?: number;
  creatorName: string;
  authenticated: boolean;
  callbackUrl: string;
  onClose(): void;
  onConfirmPurchase(): void;
  membershipHref: string;
};
```

- Produces `OverlayPortal` that portals to `document.body`, locks scroll, closes on Escape, and restores invoker focus.

- [ ] **Step 1: Write failing portal and anonymous unlock tests**

Add:

```ts
test("homepage purchase unlock dialog covers the viewport outside the post card", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("post-card").filter({ has: page.getByText("夜色指令板", { exact: true }) });
  await card.getByRole("button", { name: "解锁图片 3" }).click();
  const dialog = page.getByRole("dialog", { name: "解锁作品" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.parentElement === document.body)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box?.width).toBe(page.viewportSize()?.width);
  expect(box?.height).toBe(page.viewportSize()?.height);
  await expect(dialog.getByRole("link", { name: "登入后解锁" })).toBeVisible();
  await expect(dialog.getByDisplayValue("4242 4242 4242 4242")).toHaveCount(0);
});
```

Add a focused test for Escape close and focus restoration to the invoking locked-media button.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts --grep "purchase unlock dialog|Escape" --workers=1 --max-failures=1
```

Expected: FAIL because the dialog remains inside `article`, occupies the card rectangle, and exposes the Demo card.

- [ ] **Step 3: Implement `OverlayPortal`**

Use `createPortal` from `react-dom`, a mounted-state guard, and effects that:

```ts
const previousOverflow = document.body.style.overflow;
document.body.style.overflow = "hidden";
const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
// Escape calls onClose.
// Cleanup restores overflow and invoker?.focus().
```

Render nothing during SSR or while `open` is false. The portal root is `document.body`.

- [ ] **Step 4: Implement `UnlockDialog` variants**

Anonymous purchase renders a link:

```tsx
<Link href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
  登入后解锁
</Link>
```

Anonymous membership renders `登入后查看会员方案`. Authenticated purchase renders the existing confirm action without collecting or displaying a card number. Authenticated membership links to `membershipHref`.

Give the full-screen portal container `role="dialog"`, `aria-modal="true"`, and `aria-label="解锁作品"`.

- [ ] **Step 5: Replace all `PaymentModal` callers**

In `PostCard`, add `data-testid="post-card"` and `data-post-id={post.id}`. Pass `Boolean(session?.user)` and `window.location.pathname + window.location.search` to `UnlockDialog`.

In the post detail page, preserve the existing server order/intent confirmation callback for authenticated purchase. Anonymous confirmation is no longer a purchase callback; it is a sign-in link.

Delete `components/payment-modal.tsx` after no imports remain.

- [ ] **Step 6: Update legacy payment assertions**

Replace Demo-card expectations in `tests/demo.spec.ts` with the anonymous sign-in action and retain authenticated payment coverage in the existing Phase 4 tests.

- [ ] **Step 7: Run focused overlay and payment tests**

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts tests/demo.spec.ts tests/phase4-payments.spec.ts --grep "unlock|purchase|payment" --workers=1 --max-failures=1
```

Expected: selected tests pass with no unexpected skip or failure.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- components/overlay-portal.tsx components/unlock-dialog.tsx components/post-card.tsx 'app/(site)/post/[id]/page.tsx' components/payment-modal.tsx tests/phase7-acceptance-corrections.spec.ts tests/demo.spec.ts
git diff --cached --check
git commit -m "Portal unlock flows above content cards"
```

---

### Task 3: Unify Image and Video Preview with Fullscreen Support

**Files:**
- Create: `components/media-viewer.tsx`
- Modify: `components/media-gallery.tsx`
- Modify: `components/post-card.tsx`
- Modify: `app/(site)/post/[id]/page.tsx`
- Modify: `lib/types.ts`
- Modify: `lib/data.ts`
- Modify: `lib/db-repository.ts`
- Modify: `tests/phase7-acceptance-corrections.spec.ts`

**Interfaces:**
- Extends:

```ts
export interface MediaAsset {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  order: number;
  kind: "image" | "video";
}
```

- Produces:

```ts
type MediaViewerProps = {
  media: MediaAsset[];
  activeIndex: number | null;
  onActiveIndexChange(index: number | null): void;
};
```

- [ ] **Step 1: Write failing shared-viewer tests**

Cover:

```ts
test("post hero and gallery open the shared top-level image viewer", async ({ page }) => {
  await page.goto("/post/post-1");
  await page.getByTestId("post-hero-media").click();
  await expect(page.getByRole("dialog", { name: "媒体预览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全屏预览" })).toBeVisible();
  await page.getByRole("button", { name: "关闭媒体预览" }).click();
  await page.getByRole("button", { name: "查看图片 2" }).click();
  await expect(page.getByText("2 / 12", { exact: true })).toBeVisible();
});
```

Add a synthetic video test by intercepting the post API response or rendering a seeded test fixture with `kind: "video"`. Assert the viewer contains `<video controls>`, `autoplay === false`, and `muted` is not forced to false through autoplay.

Stub `HTMLElement.prototype.requestFullscreen` before page code and assert the fullscreen button invokes it. Add a no-API case and assert the overlay stays visible.

- [ ] **Step 2: Run the media tests and verify failure**

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts --grep "shared top-level image viewer|video viewer|fullscreen" --workers=1 --max-failures=1
```

Expected: FAIL because the hero is not interactive, the gallery owns a private image-only overlay, media lacks `kind`, and no fullscreen button exists.

- [ ] **Step 3: Preserve media kind end to end**

Set `kind: "image"` in `createPostMedia`. Extend `mapMedia` to accept and normalize Prisma `kind`:

```ts
kind: asset.kind === "video" ? "video" : "image"
```

Do not infer authorization from `kind`, filename, or MIME type.

- [ ] **Step 4: Implement `MediaViewer`**

Portal through `OverlayPortal`. For an image, use `next/image` with `object-contain`. For video:

```tsx
<video
  src={asset.src}
  aria-label={asset.alt}
  controls
  autoPlay={false}
  preload="metadata"
  className="max-h-[88vh] max-w-[92vw]"
/>
```

Implement previous/next for accessible media only. Escape is handled by the portal. Fullscreen calls `viewerRef.current?.requestFullscreen?.()`; failures leave the overlay open. When `document.fullscreenElement` is the viewer, the same button calls `document.exitFullscreen()`.

- [ ] **Step 5: Replace the private `MediaGallery` overlay**

Keep the existing locked-index check. Accessible clicks set `activeIndex`; locked clicks call `onLockedClick`. Render one `MediaViewer` after the grid. Do not pass locked assets to an active index that the visitor cannot access.

- [ ] **Step 6: Make the post hero use the same viewer**

Wrap actual hero media in a button with `data-testid="post-hero-media"` and open index 0. Reuse the same media list and entitlement result as the gallery; if the first asset is accessible, preview it. Do not make CSS-only cover meshes claim media-viewer behavior.

- [ ] **Step 7: Run focused media and existing gallery tests**

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts tests/demo.spec.ts --grep "viewer|gallery|图片|video|fullscreen" --workers=1 --max-failures=1
npx tsc --noEmit --incremental false
```

Expected: pass and exit 0.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- components/media-viewer.tsx components/media-gallery.tsx components/post-card.tsx 'app/(site)/post/[id]/page.tsx' lib/types.ts lib/data.ts lib/db-repository.ts tests/phase7-acceptance-corrections.spec.ts
git diff --cached --check
git commit -m "Unify image and video preview behavior"
```

---

### Task 4: Add Entitlement-Safe Post Thumbnails to Search

**Files:**
- Modify: `lib/channels/types.ts`
- Modify: `lib/search/repository.ts`
- Modify: `components/search/search-results.tsx`
- Modify: `tests/phase7-channels-search.spec.ts`
- Modify: `tests/phase7-acceptance-corrections.spec.ts`

**Interfaces:**
- Produces:

```ts
export type SearchMediaPreview = {
  src: string;
  alt: string;
  kind: "image" | "video";
};

export type SearchResult = {
  // existing fields
  preview: SearchMediaPreview | null;
};
```

- [ ] **Step 1: Write failing repository security tests**

Extend the existing search lifecycle test to create:

- a free indexed post with one ready/public first media;
- a free indexed post whose media is not ready or not public;
- a member or purchase post containing a distinctive secret asset URL.

Assert:

```ts
expect(freeResult.preview).toEqual({
  src: publicAsset.src,
  alt: publicAsset.alt,
  kind: "image"
});
expect(noPreviewResult.preview).toBeNull();
expect(JSON.stringify(results)).not.toContain(secretAsset.src);
```

Also assert creator and channel results have `preview: null`.

- [ ] **Step 2: Write failing search-page presentation test**

For a known free post query, assert `[data-testid="search-result-preview"]` appears between the title and summary in DOM order and opens `媒体预览` without navigating. Assert clicking the title still navigates to `/post/[id]`.

- [ ] **Step 3: Run focused search tests and verify failure**

```powershell
npx playwright test tests/phase7-channels-search.spec.ts tests/phase7-acceptance-corrections.spec.ts --grep "search.*preview|search.*thumbnail" --workers=1 --max-failures=1
```

Expected: FAIL because `SearchResult` has no preview and the UI renders only text/type icons.

- [ ] **Step 4: Project safe previews in one bounded query**

After `pageRows` is known, collect post IDs. Query `MediaAsset` once:

```ts
const media = postIds.length
  ? await prisma.mediaAsset.findMany({
      where: {
        postId: { in: postIds },
        status: "ready",
        visibility: "public"
      },
      select: { postId: true, src: true, alt: true, kind: true, order: true, id: true },
      orderBy: [{ postId: "asc" }, { order: "asc" }, { id: "asc" }]
    })
  : [];
```

Build a first-asset map without per-result queries. Attach a preview only for `entityType === "post"`. Normalize kind to `image | video`. Keep search eligibility unchanged: only free posts can enter search.

- [ ] **Step 5: Render preview as a separate interaction**

Do not place a button inside the existing result `<Link>`. Change the row to an article-like flex container containing:

- a media preview button with `data-testid="search-result-preview"`;
- a content `<Link>` containing title and summary; and
- the existing type icon when `preview` is null.

Use `MediaViewer` with a one-item media array. Stop no events on a nested link because the controls are siblings.

- [ ] **Step 6: Run focused search, ACL, and pagination tests**

```powershell
npx playwright test tests/phase7-channels-search.spec.ts tests/phase7-acceptance-corrections.spec.ts --grep "search" --workers=1 --max-failures=1
```

Expected: all selected tests pass with no repeated cursor.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- lib/channels/types.ts lib/search/repository.ts components/search/search-results.tsx tests/phase7-channels-search.spec.ts tests/phase7-acceptance-corrections.spec.ts
git diff --cached --check
git commit -m "Show safe media previews in search results"
```

---

### Task 5: Seed and Render Public Comments with Authenticated Participation

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `app/(site)/post/[id]/page.tsx`
- Modify: `tests/phase6-identity-social.spec.ts`
- Modify: `tests/phase7-acceptance-corrections.spec.ts`

**Interfaces:**
- Consumes: public `GET /api/posts/[id]/comments` and authenticated `POST /api/posts/[id]/comments`.
- Produces: one deterministic visible seeded `PostComment` per seeded post, authored by `fan-demo`.

- [ ] **Step 1: Write failing API and visitor UI tests**

Add:

```ts
test("visitors read visible comments and see a sign-in action instead of an editor", async ({ page, request }) => {
  const response = await request.get("/api/posts/post-1/comments");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).comments.length).toBeGreaterThan(0);

  await page.goto("/post/post-1");
  await expect(page.getByTestId("comment-list").getByText("小北")).toBeVisible();
  await expect(page.getByRole("link", { name: "登入后参与评论" })).toBeVisible();
  await expect(page.getByPlaceholder("说说你的感受…")).toHaveCount(0);
});
```

Add an authenticated UI assertion showing the editor. Extend the identity test so an anonymous POST is 401 and a body/query `userId` cannot select an author.

- [ ] **Step 2: Run focused comment tests and verify failure**

```powershell
npx playwright test tests/phase7-acceptance-corrections.spec.ts tests/phase6-identity-social.spec.ts --grep "comment|评论" --workers=1 --max-failures=1
```

Expected: FAIL because no real seeded `PostComment` exists and visitors see the editor.

- [ ] **Step 3: Seed real comments**

After users and posts exist, create deterministic rows:

```ts
await prisma.postComment.createMany({
  data: posts.map((post, index) => ({
    id: `seed-comment-${post.id}`,
    postId: post.id,
    authorId: "fan-demo",
    content: post.comments[0]?.text ?? "期待看到更多创作。",
    status: "visible",
    createdAt: new Date(Date.UTC(2026, 6, 1, 0, index))
  }))
});
```

Keep the legacy post JSON for compatibility in this correction. Do not expose hidden comments.

- [ ] **Step 4: Make comment participation explicit**

Always render `<div data-testid="comment-list">` with fetched comments.

When `session?.user` is absent, render:

```tsx
<Link href={`/sign-in?callbackUrl=${encodeURIComponent(`/post/${post.id}`)}`}>
  登入后参与评论
</Link>
```

Only render the input and publish button for authenticated users. Retain server session identity, same-origin enforcement, and rate limiting.

- [ ] **Step 5: Run seed locally against the disposable test database and focused tests**

```powershell
npm run db:seed
npx playwright test tests/phase7-acceptance-corrections.spec.ts tests/phase6-identity-social.spec.ts --grep "comment|评论" --workers=1 --max-failures=1
```

Expected: selected tests pass. Do not run this seed command unless the configured database is the known disposable PureHub local/staging test database.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- prisma/seed.ts 'app/(site)/post/[id]/page.tsx' tests/phase6-identity-social.spec.ts tests/phase7-acceptance-corrections.spec.ts
git diff --cached --check
git commit -m "Expose seeded comments to visitors"
```

---

### Task 6: Guarantee Phase 6 Test Content Cleanup

**Files:**
- Modify: `tests/phase6-identity-social.spec.ts`
- Modify: `tests/phase7-acceptance-corrections.spec.ts`

**Interfaces:**
- Produces:

```ts
async function cleanupPhase6Post(postId: string): Promise<void>
```

that deletes the matching `SearchDocument` before deleting the `Post`; relational child rows cascade from the post.

- [ ] **Step 1: Write the cleanup regression around ownership creation**

Import the repo Prisma client in the test. Store the created ID outside the assertion block:

```ts
let ownedPostId: string | null = null;
try {
  // create and assert session-derived ownership
  ownedPostId = body.post.id;
} finally {
  if (ownedPostId) await cleanupPhase6Post(ownedPostId);
}
expect(await prisma.post.findUnique({ where: { id: ownedPostId! } })).toBeNull();
expect(await prisma.searchDocument.findUnique({
  where: { entityType_entityId: { entityType: "post", entityId: ownedPostId! } }
})).toBeNull();
```

Apply the same cleanup discipline to the Phase 6 social post. Delete generated test users only where existing tests already own and safely clean them; do not delete shared seed accounts.

- [ ] **Step 2: Run the ownership test before the cleanup implementation**

```powershell
npx playwright test tests/phase6-identity-social.spec.ts --grep "server authorization rejects spoofed identities" --workers=1 --max-failures=1
```

Expected: the new absence assertion fails against the uncleaned created post.

- [ ] **Step 3: Implement `cleanupPhase6Post` and `finally` blocks**

Use:

```ts
async function cleanupPhase6Post(postId: string) {
  await prisma.$transaction([
    prisma.searchDocument.deleteMany({ where: { entityType: "post", entityId: postId } }),
    prisma.post.deleteMany({ where: { id: postId } })
  ]);
}
```

Do not add title-based filtering to production feed or search.

- [ ] **Step 4: Add a staging cleanliness assertion**

In `phase7-acceptance-corrections.spec.ts`, database-gate a test that queries:

```ts
const leaked = await prisma.post.findMany({
  where: { title: { startsWith: "Phase 6 ownership" } },
  select: { id: true }
});
expect(leaked).toEqual([]);
```

This is an acceptance assertion, not a production filter.

- [ ] **Step 5: Run cleanup tests twice**

```powershell
npx playwright test tests/phase6-identity-social.spec.ts tests/phase7-acceptance-corrections.spec.ts --grep "server authorization rejects spoofed identities|does not retain Phase 6 ownership" --workers=1 --max-failures=1
npx playwright test tests/phase6-identity-social.spec.ts tests/phase7-acceptance-corrections.spec.ts --grep "server authorization rejects spoofed identities|does not retain Phase 6 ownership" --workers=1 --max-failures=1
```

Expected: both runs pass, proving the first run did not pollute the second.

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- tests/phase6-identity-social.spec.ts tests/phase7-acceptance-corrections.spec.ts
git diff --cached --check
git commit -m "Clean Phase 6 posts after identity tests"
```

---

### Task 7: Full Verification, Push, Staging Reset, and Public Acceptance

**Files:**
- Modify only if verification exposes a real defect: the smallest file and its focused regression test.
- Do not commit server `.env.staging` or acceptance credentials.

**Interfaces:**
- Consumes: commits from Tasks 1–6.
- Produces: matching local, `origin/main`, staging checkout, Web, and Worker commit SHAs.
- Produces: public acceptance at `http://183.6.3.174:99`.

- [ ] **Step 1: Check exclusions and source hygiene**

```powershell
git status --short
git diff --check
git diff --cached --check
git ls-files --error-unmatch README.md
```

Verify no task commit staged or changed `README.md`, `start-local-demo.cmd`, `.superpowers/`, or `.env*`.

- [ ] **Step 2: Run generation and static verification**

```powershell
npm run db:generate
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Expected: all commands exit 0. Build-time Better Auth default-secret warnings may occur during static collection because real runtime secrets are intentionally not passed into Docker build layers; runtime auth must still be verified separately.

- [ ] **Step 3: Run the complete local Playwright suite with a hard bound**

```powershell
npx playwright test --workers=1 --max-failures=1
```

Wrap the command with the environment's explicit bounded command timeout. Expected: zero failures and only documented shared-staging mobile skips.

- [ ] **Step 4: Run broad final code review and address findings**

Use `superpowers:requesting-code-review` against the implementation merge base recorded immediately before Task 1. Any Critical or Important finding gets one focused fix wave, covering tests, and a scoped re-review before push.

- [ ] **Step 5: Push the exact reviewed commit**

```powershell
git status --short
git rev-parse HEAD
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

Expected: local HEAD equals `origin/main`.

- [ ] **Step 6: Reset staging through the approved seed and deploy path**

On `/var/www/purehub`, with SSH and GNU hard timeouts:

```bash
git pull --ff-only origin main
DEPLOY_SEED=true ./scripts/deploy.sh staging
```

The seed removes `custom-1785224228010`, recreates deterministic comments, and preserves the staging fan/creator/admin identities using `DEMO_ACCOUNT_PASSWORD` from `.env.staging`. Never print that value.

- [ ] **Step 7: Run complete deployed Playwright with one worker**

Export `PLAYWRIGHT_BASE_URL=http://183.6.3.174:99`, server-only test tokens, `DEMO_ACCOUNT_PASSWORD`, and the Docker-bridge-adjusted `DATABASE_URL` exactly as documented in `docs/server-acceptance.md`.

Run with a hard timeout:

```bash
npx playwright test --workers=1 --max-failures=1
```

Expected: zero failures. Record total, passed, expected skipped, failed, and duration.

- [ ] **Step 8: Verify the public visitor and identity surfaces**

Through public port 99:

- visitor navigation has no Demo/admin/creator tools;
- paid-media unlock dialog covers the viewport and offers sign-in;
- post comments are readable;
- search post result shows a safe preview and opens the viewer;
- fan account shows fan identity without creator tools;
- `yuki@purehub.local` shows approved-creator tools;
- `admin@purehub.local` reaches the independent admin shell;
- a fan cannot reach `/admin`;
- image/video viewer close and fullscreen controls work.

Use the staging-only password without saving it in browser password storage or repository artifacts.

- [ ] **Step 9: Verify runtime health, logs, and exact commits**

Bounded read-only checks:

```bash
git status --short
git rev-parse HEAD
docker compose --env-file .env.staging ps
curl -fsS http://127.0.0.1/api/health
curl -fsS http://127.0.0.1/worker-health
docker compose --env-file .env.staging logs --since 10m --no-color
```

Verify Web, Worker, Nginx, PostgreSQL, Redis, and MinIO are healthy; post-deploy logs contain no uncaught/unhandled/fatal/panic errors; Web and Worker report the reviewed SHA.

- [ ] **Step 10: Confirm the two staging acceptance identities**

Deliver:

- fan email: `fan@purehub.local`
- approved creator email: `yuki@purehub.local`

The temporary staging password remains the server-side `DEMO_ACCOUNT_PASSWORD`. Provide it to the user only through the agreed delivery channel, never Git, build logs, test reports, or documentation.
