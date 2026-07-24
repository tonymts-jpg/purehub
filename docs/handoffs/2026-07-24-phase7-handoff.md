# PureHub Phase 7 新對話交接

更新日期：2026-07-24

## Repo 與基線

- GitHub：`https://github.com/tonymts-jpg/purehub.git`
- 本地實際 repo：`C:\Users\tonym\Desktop\Codex Project\Purehub Plan`
- 不要在 Codex 顯示的 `C:\Users\tonym\Desktop\Purehub Plan` 操作，那不是實際
  PureHub repo。
- 分支：`main`
- Phase 7 完整 implementation plan 基線：
  `a528c71cf3cf2e16231f80700833b8194a1c7b69`
- 交接文件會在上述基線之後以獨立 commit 提交，因此新對話應先執行
  `git pull --ff-only` 與 `git rev-parse HEAD`，確認 HEAD 是該基線的後代。

## 已完成內容

### Phase 1

- Docker Compose deployment baseline。
- Web、worker、PostgreSQL、Redis、Nginx healthcheck。
- deploy、rollback、preflight、healthcheck、smoke scripts。

### Phase 2

- Prisma + PostgreSQL 資料層。
- migrations、seed、核心 feed/post/creator/pricing API。

### Phase 3

- 站務後台。
- `AdminAccount` 角色授權。
- creator application 審核、creator level、價格版本化。
- payment channel 配置入口與 audit log。

### Phase 4

- payment provider adapter 架構。
- order、payment intent、webhook event、payment transaction。
- manual-confirm 最小支付閉環。
- entitlement/subscription 履約。
- creator wallet、payout request、finance review。
- 可管理、版本化的 `feeBps` 平台抽成與歷史 snapshot。

### Phase 5

- 雙重記帳 ledger。
- pending/available/reserved/debt wallet cache。
- settlement、full refund、payout clearing、KYC、reconciliation。
- MinIO 私有物件儲存、presigned upload、私有媒體存取。
- worker 媒體與財務工作。

### Phase 6

- Better Auth email/password + Prisma database sessions。
- 正式 `requireUser`、`requireCreator`、`requireAdmin` 授權邊界。
- 管理員權限由 active `AdminAccount` 讀取，`x-admin-role` 無法提權。
- follow、like、bookmark、comment、notification。
- feed cursor pagination。
- 支付、KYC、提現、上傳、發文與媒體存取改用 session identity。
- Phase 6 staging 最終驗收結果：60 tests，52 passed，8 expected skipped，
  0 failed。

### Phase 7 已確定但尚未實作

- 設計規格：
  `docs/superpowers/specs/2026-07-24-phase7-channels-search-design.md`
- 完整實作計畫：
  `docs/superpowers/plans/2026-07-24-phase7-channels-search.md`
- 兩份文件已提交並推送至 GitHub `main`。

已鎖定的 Phase 7 決策：

- 統一 `Channel` 模型與明確 ACL。
- admin 建立官方頻道；approved creator 可建立 creator channel。
- 所有 creator channel 啟用前都要先經 admin 審核。
- 公開與私人頻道。
- 私人頻道為 `discoverable | hidden`。
- 邀請 + 加入申請審核。
- `owner | editor | member`。
- 成員投稿採 `direct | approval_required` 頻道設定。
- creator level 1/2/3 預設配額 1/3/5，可由 admin 個別覆蓋。
- 頻道可策展全平台已發布作品。
- 手動 inclusion/order/pin/exclusion + category/tag/creator 自動規則。
- manual exclusion 優先於所有 inclusion/rule。
- PostgreSQL `tsvector` + `pg_trgm` 搜尋，不引入外部搜尋服務。
- 頻道會員資格不能繞過付費、訂閱或私有媒體 entitlement。
- 即時聊天、WebSocket、Web3、向量搜尋延後。

## 目前 Git 狀態

交接前已確認：

```text
branch: main
Phase 7 plan baseline: a528c71cf3cf2e16231f80700833b8194a1c7b69
uncommitted:
 M README.md
?? start-local-demo.cmd
```

`README.md` 與 `start-local-demo.cmd` 是既有本地不相關／臨時內容。不得
stage、commit、覆蓋或刪除，除非使用者明確要求。

開始新對話時重新執行：

```powershell
Set-Location 'C:\Users\tonym\Desktop\Codex Project\Purehub Plan'
git status --short
git branch --show-current
git rev-parse HEAD
git log -5 --oneline
```

## 關鍵目錄

- `app/`：Next.js App Router 頁面與 route handlers。
- `app/api/`：現有身份、社交、支付、財務、上傳與 admin API。
- `components/`：app shell 與前端元件。
- `lib/session.ts`：session user、creator guard、same-origin guard。
- `lib/admin-auth.ts`：active AdminAccount 與 admin section 權限。
- `lib/rate-limit.ts`：Redis + memory fallback rate limit。
- `lib/db-repository.ts`：現有 feed/post/creator/dashboard repository。
- `lib/social-repository.ts`：Phase 6 transactional social interactions。
- `lib/finance/`：ledger。
- `lib/payments/`：payment adapter/repository。
- `lib/storage/`：私有媒體 storage adapter。
- `prisma/schema.prisma`：正式資料模型。
- `prisma/migrations/`：Phase 2-6 migrations。
- `prisma/seed.ts`：完整 demo/staging seed；production-like seed 需要
  `DEMO_ACCOUNT_PASSWORD`。
- `scripts/deploy.sh`：Docker staging/production deployment。
- `scripts/worker.mjs`：Phase 5 worker loop，Phase 7 要擴充。
- `scripts/smoke-test.mjs`：部署 smoke checks。
- `tests/auth-helpers.ts`：Better Auth E2E helpers。
- `tests/phase6-identity-social.spec.ts`：身份/ACL/社交測試參考。
- `tests/production-readiness.spec.ts`：health/platform capability contract。
- `docs/server-acceptance.md`：Ubuntu staging 驗收流程。

## 本地啟動與驗證

本機開發：

```powershell
Set-Location 'C:\Users\tonym\Desktop\Codex Project\Purehub Plan'
npm ci
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run dev
```

Playwright 未設定 `PLAYWRIGHT_BASE_URL` 時會在 `http://localhost:3001`
啟動開發伺服器：

```powershell
npm run test:e2e
```

正式驗證順序：

```powershell
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

## Ubuntu staging 部署

```bash
cd /var/www/purehub
git config core.fileMode false
git pull --ff-only
chmod +x scripts/*.sh
DEPLOY_SEED=true ./scripts/deploy.sh staging
docker compose --env-file .env.staging ps
curl -fsS http://127.0.0.1/api/health
SMOKE_BASE_URL=http://127.0.0.1 ./scripts/smoke-test.sh
```

部署 E2E：

```bash
npm ci --registry=https://registry.npmmirror.com/
npx playwright install --with-deps chromium
export PLAYWRIGHT_BASE_URL=http://127.0.0.1
export ADMIN_ACCESS_TOKEN="$(grep '^ADMIN_ACCESS_TOKEN=' .env.staging | tail -1 | cut -d= -f2-)"
export DEMO_ACCOUNT_PASSWORD="$(grep '^DEMO_ACCOUNT_PASSWORD=' .env.staging | tail -1 | cut -d= -f2-)"
npm run test:e2e:deployed
```

Deployed Playwright 固定 one worker；不要改回兩個 worker，現有整套測試會修改
共用 seed state。

## `.env.staging` 要點

每個 key 只保留一份，不能同時存在 phase-5 與 phase-6/7 重複值。Phase 7
完成部署時至少包含：

```dotenv
NODE_ENV=production
APP_ENV=staging
PUREHUB_PHASE=phase-7
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_APP_URL=http://127.0.0.1
BETTER_AUTH_URL=http://127.0.0.1
BETTER_AUTH_SECURE_COOKIES=false
SERVICE_ADMIN_USER_ID=admin-demo
```

下列值必須是真實隨機值，只存在 server `.env.staging`，不能 commit：

- `BETTER_AUTH_SECRET`
- `DEMO_ACCOUNT_PASSWORD`
- `ADMIN_ACCESS_TOKEN`
- `WORKER_ACCESS_TOKEN`
- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`

中國 server 下載 npm 較慢時：

```dotenv
NPM_REGISTRY=https://registry.npmmirror.com/
```

## 本對話曾發生的錯誤與最終解法

### 1. 操作到錯誤 workspace

問題：Codex workspace 顯示路徑與真正 repo 不同。

解法：每次 shell/tool 都明確指定
`C:\Users\tonym\Desktop\Codex Project\Purehub Plan`，先執行
`git rev-parse --show-toplevel`。

### 2. Server `git pull` 被 scripts 權限變更阻擋

問題：在 Ubuntu 執行 `chmod +x scripts/*.sh` 後，Git 視為本地修改，pull
曾被阻擋。

解法：

```bash
git config core.fileMode false
git pull --ff-only
chmod +x scripts/*.sh
```

不要在 server commit 這些 mode-only 變更。

### 3. `playwright: not found`

問題：Docker runtime 可運行網站，但 host 尚未安裝 dev dependencies。

解法：

```bash
npm ci --registry=https://registry.npmmirror.com/
npx playwright install --with-deps chromium
```

Docker apt source 的缺失 public key warning 若未使 Playwright 安裝退出，可先
完成測試；若 apt 真正失敗，再修正 Docker apt source key。

### 4. Nginx 502 但 web 顯示 healthy

問題：重建 web 後 Nginx 仍持有舊 container IP，log 顯示 upstream
`connection refused`。

解法：先確認 web healthy，再：

```bash
docker compose --env-file .env.staging restart nginx
curl -fsS http://127.0.0.1/api/health
```

### 5. `.env.staging` 有重複 phase 與中文 placeholder

問題：同一檔案同時有 `PUREHUB_PHASE=phase-5`、`phase-6`，且 secret 仍是
「請設定」文字，導致 runtime/test 使用錯值。

解法：刪除重複 key，只保留最後正式設定；所有 placeholder 改成實際隨機值，
重新 deploy/recreate containers。

### 6. Better Auth sign-out 測試先後出現 401 與 415

問題：APIRequestContext 的 cookie/session 傳遞與 sign-out body 不完整；
Better Auth sign-out 要求 JSON Content-Type。

解法：集中使用 `tests/auth-helpers.ts`，保留測試自己的 session，sign-out
送出 JSON body `{}` 與正確 origin/content-type。不要在每個 spec 手寫另一套
登入登出流程。

### 7. 全套 E2E 出現大量 auth/finance 偶發失敗或跳過

問題：desktop/mobile、fan/creator/admin 測試共享 seed 帳戶與可變資料；
兩個 deployed workers 互相登出、重設或改變身份狀態。

解法：

- deployed 模式固定 `workers: 1`；
- 使用 `tests/auth-helpers.ts`；
- 需要隔離的測試註冊唯一 fan；
- seed 後等待服務穩定再跑；
- 正確 export `DEMO_ACCOUNT_PASSWORD` 與 `ADMIN_ACCESS_TOKEN`。

### 8. Phase 5 私有媒體測試錯誤得到 200

問題：測試用 fan 與曾購買內容的共用身份混用，該帳戶已有 entitlement。

解法：commit `c0a777b` 將 Phase 5 media access buyer 隔離；未授權檢查使用
沒有購買記錄的獨立身份。

### 9. UI 支付／gallery 測試 30 秒 timeout

問題：共用測試狀態、重複 reset 與 DOM 重新渲染使 locator detached，並非
支付 API 本身失敗。

解法：測試身份隔離、deployed one worker、在 helper 中重新取得 locator，
避免跨重渲染保存舊 element handle。最終 Phase 6 staging 全套為零失敗。

### 10. GitHub 顯示 already up to date 但 server 沒有新測試

問題：本地改動當時尚未 commit/push。

解法：在要求 server 驗收前必須依序：

```bash
git status --short
git add <only intended files>
git commit
git push origin main
git ls-remote origin refs/heads/main
```

再讓 server `git pull --ff-only`。

### 11. Prisma 與 Docker runner 權限

解法：

- 使用 `npm run db:generate`，不要使用 `npx prisma generate`；
- Docker runner 已將 `node_modules` ownership 設給 `nextjs`；
- migration 用 `npm run db:migrate`；
- 不要撤銷既有 Dockerfile Prisma/OpenSSL 修補。

### 12. 中國 server registry 不穩

解法：

- npm 使用 `NPM_REGISTRY=https://registry.npmmirror.com/`；
- Docker pull/build 依賴 deploy script retry；
- 若 Nginx 502，先判斷 web health，不要直接反覆重建所有服務。

## 不要修改或提交

- 不要修改、刪除或提交本地 `README.md`。
- 不要修改、刪除或提交 `start-local-demo.cmd`。
- 不要提交 `.env.staging`、`.env.production` 或真實 secrets。
- 不要恢復 `x-admin-role` 的授權能力。
- 不要讓 body/query 的 user ID 覆蓋 session identity。
- 不要讓 channel membership 繞過支付 entitlement。
- 不要在 Phase 7 加 WebSocket、聊天、Web3、向量搜尋或外部搜尋服務。
- 不要改回 deployed Playwright 兩個 workers。
- 不要重寫 Phase 4/5 ledger/payment 核心；Phase 7 只讀既有 post entitlement。
- 不要撤銷 Dockerfile 的 OpenSSL、Prisma generate script、runner ownership
  修補。

## 下一步任務

1. 閱讀 Phase 7 design spec 與 implementation plan。
2. 從 implementation plan Task 1 開始，以 TDD 小步實作。
3. 每個 Task 完成 focused tests、lint，按 plan 的 commit 邊界提交。
4. Task 8/9 UI 必須跑 desktop/mobile Playwright，檢查文字與控制項無重疊。
5. Task 10 跑完整 local verification。
6. 排除 `README.md` 和 `start-local-demo.cmd` 後 push。
7. 才通知使用者到 Ubuntu staging deploy/accept。
8. 以 GitHub、staging checkout、runtime 相同 commit SHA 和零失敗 E2E 作為
   Phase 7 完成依據。

## 新對話首發內容

```text
我們要繼續 PureHub 正式版 Phase 7 開發，請直接實作，不要重新做產品選型。

Repo:
https://github.com/tonymts-jpg/purehub.git

本地實際 repo:
C:\Users\tonym\Desktop\Codex Project\Purehub Plan

注意：Codex workspace 可能顯示 C:\Users\tonym\Desktop\Purehub Plan，但那不是
實際 repo。所有操作必須明確在 C:\Users\tonym\Desktop\Codex Project\Purehub Plan。

開始前請依序閱讀：
1. docs/handoffs/2026-07-24-phase7-handoff.md
2. docs/superpowers/specs/2026-07-24-phase7-channels-search-design.md
3. docs/superpowers/plans/2026-07-24-phase7-channels-search.md

Phase 7 implementation plan 基線 commit:
a528c71cf3cf2e16231f80700833b8194a1c7b69

先執行並回報：
- git rev-parse --show-toplevel
- git status --short
- git branch --show-current
- git rev-parse HEAD
- git log -5 --oneline

已知本地未提交且與 Phase 7 無關：
- README.md
- start-local-demo.cmd

不要修改、刪除、stage 或 commit 這兩個檔案。不要提交任何真實 secret。

Phase 1-6 已完成。Phase 6 staging 最終結果為 60 tests、52 passed、
8 expected skipped、0 failed。Phase 7 的所有產品和架構決策已鎖定在 design
spec，完整任務、檔案、介面、測試與 commit 邊界已寫在 implementation plan。

請使用 superpowers:subagent-driven-development（推薦）或
superpowers:executing-plans，從 Task 1 開始按 TDD 逐項實作。不要只提出另一份
計畫；持續完成實作、focused tests、lint、typecheck、build、完整 Playwright
與提交，直到可以交給 Ubuntu staging 部署驗收。

重要既有經驗：
- 必須在實際 repo 路徑操作。
- 使用 npm run db:generate，不用 npx prisma generate。
- deployed Playwright 固定 one worker，避免共享 seed/session race。
- auth 測試沿用 tests/auth-helpers.ts。
- server pull 前 git config core.fileMode false。
- web healthy 但 Nginx 502 時 restart nginx。
- 中國 server npm 可用 registry.npmmirror.com。
- channel membership 絕不能繞過付費/訂閱/私有媒體 entitlement。
- x-admin-role 不得恢復授權作用。

每次正式提交前確認 git status，明確排除 README.md 和
start-local-demo.cmd。完成本地驗證並 push 後，再提供 staging 部署與驗收命令。
```
