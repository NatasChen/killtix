# AGENTS.md — TicketDesk 接手指南

給接手的 AI Agent 與開發者。讀完本文件就應該能安全地修改專案，不需要從頭摸索。
使用者面向的介紹在 [README.md](README.md)；本文件只寫「怎麼在這個專案裡工作」。

> **維護規則**：任何改變架構、慣例、指令或「不可破壞的規則」的變更，都要在同一個變更中更新本文件。
> 本文件過時比沒有更糟。

---

## 1. 現況（每次發版時更新）

| 項目 | 內容 |
| --- | --- |
| 目前版本 | **0.10.0**（2026-10-28，git tag `v0.10.0`），見 [CHANGELOG.md](CHANGELOG.md) |
| 支援部署 | Docker Compose（nginx + app + PostgreSQL 16 + Redis 7；只有 nginx 對主機開放 HTTP 埠，DECISIONS D19）。Cloudflare 方案已決定不做（DECISIONS D3） |
| 測試狀態 | 122 個 Vitest 測試、`scripts/validate.sh`、`scripts/smoke.sh`（24 項）、`scripts/ui-e2e.sh` 全部通過 |
| 未實作 | AD/LDAP、SAML、OIDC、SCIM、FIDO2、附件、SLA 營業時間、多副本背景工作 |
| 待客戶確認 | 見 [specs/DECISIONS.md](specs/DECISIONS.md) 中標示 ⏳ 的項目（SSO 時程）；已決定：預設管理員密碼（D1：各部署以 `.env` 設定）、Cloudflare 不做（D3）、移除 `users.team_id`（D14） |
| 下一步建議 | v1.1：SSO（`users.identity_provider` 已預留）→ 附件 → SLA 營業時間 |

### 開始工作前的閱讀順序

1. 本文件
2. [specs/DECISIONS.md](specs/DECISIONS.md)：哪些地方刻意不照原始規格做，不要「修正」回去
3. [CHANGELOG.md](CHANGELOG.md) 的 `[Unreleased]`：別人做到一半的東西
4. 要改的模組（第 3 節的程式碼地圖）與它的測試

### 增量迭代原則

這是已發布、持續維護的專案（版本見上表），每一次工作都是在現有程式碼上的增量修改，不是新專案：

- 不重建骨架、不重新初始化、不更換框架、目錄結構或既有慣例。
- 先讀要改的模組與它的測試，再延伸既有的 service、route、元件與字典；沿用既有的命名與寫法，不另起一套並存的實作。
- 只改需求涉及的檔案；不重寫、重新排版或「順手整理」無關的程式碼與文件。
- 既有功能與測試要保留，不可為了新功能刪除或弱化；`[Unreleased]` 中標示「進行中」的項目要先接續，至少不能與它衝突。
- 文件與測試的篇幅要和變更大小成比例：小變更（樣式、文字、單一欄位）在 CHANGELOG 寫一行，PRD、QA 計畫各加一列或幾行即可，不寫長篇驗證明細，也不改文件本身的版本號；測試只驗證這次的行為與真正可能退化的地方，不比對原始碼字串。
- 測試數量有變時，同步更新本文件第 1、6 節與 README 的測試數（`scripts/validate.sh` 會比對，數字不符就失敗）。

需求來源：[specs/customer_spec.md](specs/customer_spec.md)（客戶原文）→ [docs/PRD_SPEC.md](docs/PRD_SPEC.md)（細化後的需求基線，部分內容尚未實作，以檔案開頭的實作狀態說明為準）。

---

## 2. 技術棧（實際安裝版本）

| 用途 | 套件 | 版本 | 備註 |
| --- | --- | --- | --- |
| Runtime | Node.js | 24（本機 nvm 24.22.1，映像 `node:24-alpine`） | ESM（`"type": "module"`） |
| 語言 | TypeScript | 7.0.2 | 原生編譯器版本；伺服器端 `module: NodeNext`，相對匯入必須寫 `.js` 副檔名 |
| HTTP | hono / @hono/node-server | 4.13.13 / 2.1.5 | 當初為 Cloudflare Workers 選的框架；D3 已決定不做，但不需要更換 |
| 驗證 | zod | 4.6.7 | **v4 API**：`z.email()`、`z.url()`，不是 `z.string().email()` |
| ORM | drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | |
| DB 驅動 | postgres（postgres-js） | 3.4.9 | 正式環境 |
| 測試 DB | @electric-sql/pglite | 0.5.11 | 程序內 PostgreSQL（WASM） |
| Redis | ioredis | 6.0.0 | 只用在速率限制；`import { Redis } from 'ioredis'` |
| 密碼 | bcryptjs | 3.0.3 | 純 JS，內建型別 |
| TOTP | otpauth | 9.5.2 | |
| Email | nodemailer | 10.2.1 | |
| 前端 | react / react-router-dom / vite | 19.3.1 / 7.18.4 / 8.3.5 | |
| UI 元件 | antd / @ant-design/icons | 6.6.5 / 6.3.4 | **UI 一律用 Ant Design**；顏色在 `src/web/palette.ts`，經 `theme.ts` 的 `antdTheme()` 給 ConfigProvider |
| 儀表板網格 | react-grid-layout | 2.3.0 | 只用在儀表板的拖曳與調整大小（DECISIONS D22）；Ant Design 沒有的功能才例外引入 |
| 字型 | @fontsource-variable/noto-sans-display / noto-sans-tc | 5.3.0 / 5.3.0 | 自架 Google Noto 可變字型，見第 5 節「新增前端頁面」 |
| 測試 | vitest | 5.0.5 | |

升級主要版本前先跑完第 6 節的全部驗證。

---

## 3. 程式碼地圖

```
src/server/
  index.ts            進入點：載入設定 → 連線並 migrate → seed → 啟動 HTTP → 背景工作（setInterval）
  app.ts              createApp(deps)：安全標頭、錯誤處理（RFC 7807）、/healthz、掛載 /api/v1 路由
  config.ts           所有環境變數的唯一入口（loadConfig）。新增環境變數要同時更新 .env.example、docker-compose.yml、docs/DEPLOYMENT_GUIDE.md
  context.ts          Deps（db/config/glossary/rateLimiter/secretBox/clock）、AuthContext、AppEnv 型別
  errors.ts           ApiError(status, code)；code 對應 glossary 的 error.<code>
  rbac.ts             ROLE_DEFINITIONS（角色→權限）、can()、isStaff()、ticketScope()（查詢層授權；團隊範圍經 `team_members` 子查詢，一人可屬多個團隊）
  cli.ts              維運指令：reset-password <email>
  auth/crypto.ts      sha256、隨機 token、bcrypt、密碼政策、隨機密碼、AES-GCM secretBox
  auth/session.ts     session cookie、API token 驗證（authenticate）、csrfGuard、guard()、nextStage()
  auth/totp.ts        TOTP 與復原碼
  db/schema.ts        Drizzle schema：唯一的資料表定義來源
  db/client.ts        postgres-js 連線 + migrate；DB 型別（兩種驅動共用）
  db/seed.ts          冪等種子：角色、SLA、服務類別、預設管理員
  i18n/index.ts       Glossary：內建字典 + DB 覆寫，缺字回退 en-US
  i18n/locales/*.ts   zh-TW / en-US 字典（伺服器錯誤、通知、整個前端介面）
  routes/auth.ts      登入、登出、me、改密、2FA
  routes/branding.ts  企業標誌與系統名稱的公開讀取（唯一不掛 guard() 的業務路由，DECISIONS D11）；上傳、改名在 routes/admin.ts
  routes/tickets.ts   工單 CRUD、對話、關注者（API Token 可用的路由在這裡）
  routes/reports.ts   儀表板、CSV 匯出
  routes/catalog.ts   下拉選單資料（服務類別＋欄位、團隊、使用者、範本）
  routes/admin.ts     使用者、團隊（含成員管理）、SLA、表單/欄位、服務類別、標籤、範本、API Token、設定、glossary、通知紀錄、稽核
  routes/util.ts      parseJson/parseWith（zod）、rateLimit、publicUser
  services/tickets.ts 工單核心：建立（冪等）、篩選條件、詳情、狀態機、SLA 暫停、自訂欄位驗證、對話、關注者
  services/notify.ts  outbox：notifyTicketEvent（決定誰收到什麼）、enqueue、dispatchPending（重試/退避）、各管道發送
  services/jobs.ts    scanSla（逾時/即將逾時）、agingDigest（每日 3 天積壓報告）
  services/settings.ts system_settings 讀寫：2FA 全域開關、digest 執行日、系統名稱、通知總開關與所有通知管道（秘密以 secretBox 加密、只寫不讀，DECISIONS D13）
  services/branding.ts 企業標誌：PNG 檢查（檔頭、512 KB）、brand_logos 讀寫、帶版本的公開網址
  services/audit.ts   稽核日誌
  services/rateLimit.ts 記憶體 / Redis 固定視窗計數
src/web/
  main.tsx            路由；依 session stage 切換登入/改密/2FA 頁面。所有頁面（含登入頁、每個管理頁）都以 lazyPage() 延遲載入
  lazy.ts             lazyPage(load, name)：具名匯出的 React.lazy()；Suspense 在 Layout 內容區（載入圖示）與 main.tsx（登入頁）。
                      React 拆成獨立的 `react` 檔（很少變動，可跨版本快取）；antd **不要**合成單一檔案：實測合成後首頁 JS
                      350 KB（gzip），交給自動拆分為 259 KB，因為合成會把只有部分頁面用到的元件（Table、Upload、DatePicker…）放進首頁
  api.ts              fetch 包裝：自動帶 X-Requested-With、錯誤轉 ApiError、401/stage 錯誤觸發重新整理 auth
  auth.tsx / i18n.tsx / theme.ts   全域狀態；theme.ts 另有 useThemeMode() 與 antdTheme()（Ant Design 主題）
  branding.tsx        企業標誌網址與系統名稱（BrandingProvider，名稱也是分頁標題）與 <Brand>（標誌＋名稱兩個元素）：側邊欄用深色背景版，登入頁依主題選擇
  dashboardLayout.ts  儀表板網格的預設版面、卡片尺寸上下限、瀏覽器中保存的版面（讀取時驗證，tests/dashboardLayout.test.ts）
  palette.ts          唯一的顏色來源：兩種主題的色票、tone()、狀態/優先度/SLA 對應的色相（tests/styles.test.ts 檢查對比）
  components/common.tsx 共用元件：Field（label 綁定控制項）、Choice（下拉選單）、PageHeader、各種 badge、ErrorBanner、useLoad/useAction
  components/charts.tsx 儀表板圖表（Donut、LineChart、Columns、TagCloud、Bars）：SVG 自繪、顏色只取自 palette.ts、viewBox 縮放、role="img" + aria-label
  styles.css          只放版面與首次繪製的底色，元件樣式來自 Ant Design
  pages/…             各頁面；Dashboard.tsx 分「目前狀態」與「期間統計」兩區（期間在網址 ?from=&to=，DECISIONS D16）
  pages/admin/        AdminRoutes.tsx 只放路由與 lazyPage()；每頁一個檔：UsersPage、CatalogPages（團隊／SLA／服務類別／回覆範本，
                      皆為 Crud.tsx 的 CrudPage 設定）、FormsPage、ApiTokensPage、SettingsPage（LogoSettings、NotifySettingsCard、MailSettingsCard）、
                      NotificationsPage、AuditPage；shared.tsx 放共用的 useOptions、OneTimeSecret、tableProps、sectionTitle；
                      TeamMembers.tsx 是團隊頁展開列的成員管理（CrudPage 的 expand，DECISIONS D18）
  public/theme-init.js 首次繪製前套用主題（CSP 不允許 inline script，所以是外部檔）
drizzle/              自動產生的 migration，不要手改
deploy/nginx/         compose 的 nginx 設定：HTTP 轉送到 app:8080、覆寫 X-Forwarded-For（validate.sh 以 `nginx -t` 檢查）
tests/                Vitest：helpers.ts（測試環境工廠）、auth / tickets / teams / dashboard / notify / i18n 測試；e2e/ui.mjs（瀏覽器）
scripts/              init-env.sh（建立 .env、只填空白密鑰）、validate.sh、smoke.sh、ui-e2e.sh、check-links.mjs、
                      bundle-check.mjs（首頁 JS ≤ 300 KB gzip、首頁不含管理頁程式碼）、
                      seed-sample-tickets.py（經 API 建立 30 張範例工單，只用 Python 標準函式庫）
specs/                客戶需求、決策紀錄、CrewAI 需求變更單
crewai_ticket_build.py CrewAI 迭代工具（PM → SAr → PG → UI 設計師 → QA，全部以本文件為規則）。維護者本機工具，
                      與其設計紀錄 crewai_fix.md、執行紀錄 .crewai/ 都列入 .gitignore，不在 repo 內；
                      clone 下來的環境沒有它們是正常的，不要重新建立或提交
```

### 請求處理順序

`secureHeaders` → 注入 deps → `authenticate`（cookie 或 `Bearer td_…`，決定 `c.var.auth` 與語系）→ `csrfGuard` → 路由上的 `guard({ stages, permission, tokenScope })` → handler → service。

- `guard()` 預設只允許 `stage = 'full'`；未完成改密/2FA 的 session 會得到 403 與對應的 `code`。
- API Token 只能使用**有設定 `tokenScope` 的路由**，其他路由一律 `403 insufficient_scope`。

---

## 4. 不可破壞的規則

違反任何一條都視為安全或資料正確性問題，必須有測試保護。

1. **授權在 SQL 查詢層套用**：讀取工單一律透過 `loadVisibleTicket()` 或 `buildTicketConditions()`，兩者都使用 `ticketScope()`。不可以先查全部再在程式中過濾。
   團隊成員資格只看 `team_members`（`users.team_id` 已在 migration 0004 移除，DECISIONS D14）；廠商與一般使用者即使在團隊中也不會因此看到團隊工單。
2. **看不到的工單回 404**，不是 403（不洩漏存在性）。
3. **`visibility='internal'` 的自訂欄位、系統事件與既有的內部備忘**永遠不回傳給非 staff（`isStaff()` = 有 `ticket:note` 權限），也**永遠不觸發通知**。
   新的回覆一律公開，不可再新增內部備忘（DECISIONS D12）；回覆是否通知由 `POST /tickets/{id}/threads` 的 `notify` 決定。
4. **改密前、2FA 前不能使用任何業務 API**：由 `guard()` 的 stage 檢查保證。新增路由一定要加 `guard()`。唯一例外是 `routes/branding.ts` 的企業標誌與系統名稱讀取（登入前就要顯示，DECISIONS D11），不可再加其他資料到這裡。
5. **所有使用者可見文字走 glossary**：前端 `t('ui.…')`、後端錯誤 `ApiError` code → `error.<code>`、通知 `notify.*`。新 key 必須**同時**加到 `zh-TW.ts` 與 `en-US.ts`（`tests/i18n.test.ts` 會檢查）。動態 key（`` t(`ui.role.${x}`) ``）要把前綴與可能值登記到該測試的 `DYNAMIC` 表。
6. **資料表只在 `src/server/db/schema.ts` 定義**，改完執行 `npm run db:generate`，連同 `drizzle/` 一起提交。不要手寫或修改已發布的 migration。
   搬資料（例如刪欄位前把值移到新表）用 `npx drizzle-kit generate --custom --name <名稱>` 產生空白的 migration，只在裡面寫資料 SQL，排在改結構的 migration 之前。
7. **「超過 N 天未結案」只有一個定義**：`services/tickets.ts` 的 `agingCondition()`（嚴格小於，剛好 72 小時不算）。清單、儀表板、CSV、每日報告都必須用它。
8. **種子資料冪等**：`seed()` 每次啟動都會跑，不可以覆寫使用者已修改的資料（尤其是管理員密碼）。角色權限是例外，以程式碼為準同步。
9. **秘密不進 log、不進回應**：密碼、token 只存雜湊；API Token 與一次性密碼只在建立的那個回應中出現一次。唯一例外是首次啟動時印出的預設管理員隨機密碼。
10. **建立工單的冪等性**：同一個 API Token 的 `Idempotency-Key`/`externalId` 只會產生一張工單（`uq_tickets_external` + 衝突時回傳既有工單）。
11. **時間一律可注入**：用 `deps.clock()`，不要在服務程式碼中直接 `new Date()` 取「現在」，否則測試無法控制時間。

---

## 5. 常見任務作法

### 新增 API 端點
1. 在對應的 `routes/*.ts` 加路由，**一定要掛 `guard({...})`**；需要外部系統呼叫才加 `tokenScope`。
2. 輸入用 `parseJson(c, zodSchema)` 驗證；錯誤用 `ApiError`／`badRequest()`／`notFound()`／`forbidden()`。
3. 商業邏輯放 `services/`，路由只負責解析與回應；會改資料的動作呼叫 `audit()`。
4. 新的錯誤 code → 兩個語系各加 `error.<code>`。
5. 在 `tests/` 加測試（用 `ctx.login()`／`ctx.adminClient()`／`ctx.tokenClient()`）；外部 API 要更新 `docs/openapi.json`。

### 新增或修改資料表欄位
1. 改 `src/server/db/schema.ts` → `npm run db:generate` → 檢查產生的 SQL。
2. 已有資料的表新增 `NOT NULL` 欄位要給 default。
3. `npm run validate` 會檢查 schema 與 migration 是否一致。
4. 刪除或改名欄位前，先用 `--custom` migration 搬資料（規則 6），並用 `tests/helpers.ts` 的 `databaseAt('<前一個 migration>')` 測試升級：
   建出舊結構、放入舊資料，再 `upgrade()` 套用其餘 migration（範例：`tests/teams.test.ts` 的 upgrade 測試）。

### 新增權限或角色
- 修改 `rbac.ts` 的 `ROLE_DEFINITIONS`（啟動時會同步到 `roles` 表）。
- 新角色要加 `ui.role.<key>` 字典、`tests/i18n.test.ts` 的 `DYNAMIC['ui.role.']`、`routes/admin.ts` 的 `ROLE_KEYS`、前端 `pages/admin/UsersPage.tsx` 的 `ROLES`。

### 新增通知事件或管道
- 事件：在 `services/notify.ts` 的 `TicketEvent` 加型別，在 `notifyTicketEvent()` 決定收件者，字典加 `notify.<event>.subject/body/teams`。
- 管道：`Channel` 型別、`channelConfigured()`、`defaultSenders()`、`dispatchPending()` 的分派。管道的設定**不放環境變數**（DECISIONS D13）：
  存在 `system_settings`，由 `settings.ts` 的 `notifyTransports()` 在每次 enqueue／dispatch 時讀取，秘密用 `secretBox` 加密、只寫不讀；
  介面在 `pages/admin/NotifySettingsCard.tsx`（Email 在 `MailSettingsCard.tsx`）。
- 總開關 `notify.enabled` 預設關閉：關閉時 `enqueue()` 記為 `disabled`、`dispatchPending()` 不發送。測試要先 `setSetting(db, 'notify.enabled', true)`。
- 測試用 `dispatchPending(deps, fakeSenders)`，不要打真實外部服務。

### 新增前端頁面
- 頁面放 `src/web/pages/`（管理頁放 `pages/admin/`，一頁一個檔，共用的小工具放 `shared.tsx`），在 `main.tsx`（一般）或
  `pages/admin/AdminRoutes.tsx`（管理）用 `lazyPage(() => import('./X'), 'XPage')` 註冊，**不要靜態 import 頁面**
  （`scripts/bundle-check.mjs` 會因首頁變大或含管理頁程式碼而失敗）。導覽在 `components/Layout.tsx`。
- **UI 一律用 Ant Design 元件**（Card、Table、Form、Input、Select、Button、Tag、Alert…），不手刻 HTML 控制項。
  只有 Ant Design 沒有的功能才可另加套件，且要先經維護者同意並記入 DECISIONS（目前只有儀表板網格 `react-grid-layout`，D22）；
  套件的 CSS 若含 `data:` 資源或寫死的顏色，不要匯入那一份，改在 `styles.css` 用 `palette.ts` 的顏色重畫。
  表單欄位用 `common.tsx` 的 `<Field label>`（label 會綁定控制項，螢幕閱讀器與 e2e 的 `getByLabel()` 才找得到），下拉選單用 `<Choice>`；
  值放在元件 state，antd `Form` 只用來排版與送出。
- 用 `useLoad()` 載入、`useAction()` 送出、`ErrorBanner` 顯示錯誤；送出按鈕同時設 `loading` 與 `disabled`（只有 loading 時點擊會被吞掉）。
- 顏色只從 `palette.ts` 取（`usePalette()`、`tone()`），不寫死色碼；新的顏色兩種主題都要定義並通過 `tests/styles.test.ts` 的對比檢查。
- 視覺規範：[DESIGN.md](DESIGN.md)（色彩、字級、間距、圓角、陰影、元件樣式）。由維護者提供，agent 只讀不改；
  它與本文件衝突時以本文件為準。DESIGN.md 是以行銷網站分析出的風格參考，套用到 TicketDesk 時：
  - 只取風格，不取品牌：不可在介面、字典或程式碼中出現原品牌的名稱、標誌、字型名稱或文案。
  - 必須同時有深色主題：DESIGN.md 只定義淺色，深色值由設計者在 `palette.ts` 中推導，對比達 WCAG AA；Ant Design 深色用 `darkAlgorithm` 加上這組色票。
  - 字型依 DESIGN.md 的 Typography：英文 Noto Sans Display、中文 Noto Sans TC（Google Noto，OFL）。用 Fontsource 套件自架
    （`main.tsx` 匯入，Vite 打包成同源檔案），**不要改成 Google Fonts CDN**：CSP 只允許同源，而且內網部署連不到外部。
    CSS 的 family 名稱是 `'Noto Sans Display Variable', 'Noto Sans TC Variable'`（英文在前，中文字自動落到 TC）。
  - 工單系統需要語意色（錯誤、成功、警告、SLA 逾時、優先度）：在 `palette.ts` 獨立定義，不受「裝飾色不能用在結構」的限制。
  - sticker 色盤可用於有意義的資料色（`palette.sticker`：狀態 badge、儀表板色帶與長條圖、側邊欄圖示），側邊欄用深靛藍（`palette.nav`），
    見 [specs/DECISIONS.md](specs/DECISIONS.md) D9。主要動作、連結與焦點仍只用主色藍；顏色一定要搭配文字，不單靠顏色傳達。
  - DESIGN.md 的應用程式元件（app shell、data table、auth form card、modal、toast、empty state、text input、button、badge-pill）
    對應到 Ant Design 的 Layout/Menu、Table、Card、Modal、message、Empty、Input、Button、Tag；hero、pricing 等行銷區塊不適用。
- 不可以用 inline `<script>`（CSP 禁止）；CSP 只允許同源資源，不可引入外部字型或 CDN。Ant Design 的 CSS-in-JS 靠 CSP 既有的
  `style-src 'unsafe-inline'` 運作，不需要也不可以再放寬 CSP。

### 新增語系
1. 新增 `src/server/i18n/locales/<locale>.ts`（複製 `en-US.ts`，key 要完全一致）。
2. 在 `i18n/index.ts` 的 `BUILTIN` 註冊。
3. 兩個字典加 `ui.locale.<locale>`，並更新 `tests/i18n.test.ts` 的 `DYNAMIC['ui.locale.']`。

### 發布新版本
1. `CHANGELOG.md`：把 `[Unreleased]` 改為 `[x.y.z] - 日期`，再開一個新的空 `[Unreleased]`。
2. `package.json` 的 `version`、`docs/openapi.json` 的 `info.version`、README 的「版本資訊」、本文件第 1 節。
3. 跑完第 6 節全部驗證。
4. 版本變更獨立成一個 commit（`chore(release): vX.Y.Z`），再打附註 tag：`git tag -a vX.Y.Z -m "TicketDesk vX.Y.Z"`。
   tag 一旦建立就不要移動；發現問題就發下一個修補版本。比對版本差異：`git diff vX.Y.Z..HEAD`。

---

## 6. 驗證（完成任何變更前）

| 指令 | 內容 | 需要 |
| --- | --- | --- |
| `npm test` | 122 個單元/整合測試（PGlite） | Node |
| `TEST_DATABASE_URL=postgres://… npm test` | 同上，改用真實 PostgreSQL + 正式驅動 | 一個 Postgres（見下） |
| `npm run validate` | 型別、schema/migration 一致、測試、文件中的測試數、建置、首頁 JS 大小（bundle-check）、OpenAPI JSON、Markdown 連結、compose 與 nginx 設定 | Node（Docker 可選） |
| `scripts/smoke.sh <url> <預設管理員密碼>` | 部署後 API 端到端 24 項（會改管理員密碼為 `Smoke-Test-Passw0rd!`） | 執行中的系統 |
| `scripts/ui-e2e.sh <url> <管理員密碼>` | 瀏覽器操作主要流程、截圖到 `tests/e2e/shots/` | Docker |

**測試只用 PGlite 是不夠的**：PGlite 與 postgres-js 的參數序列化不同（見第 7 節第 1 點）。動到 SQL 時務必用真實 PostgreSQL 再跑一次：

```bash
docker run -d --rm --name td-testpg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm test
```

完整部署驗證（用暫存 env 檔，不要動專案的 `.env`）：

```bash
cat > /tmp/td.env <<EOF
APP_URL=http://localhost:18080
HTTP_PORT=18080
APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
EOF
docker compose --env-file /tmp/td.env -p tdtest up -d --build --wait   # --wait：等到 app 與 nginx 健康檢查通過才返回
PW=$(docker compose -p tdtest logs app | grep -oP 'password: \K\S+')
scripts/smoke.sh http://localhost:18080 "$PW"
scripts/ui-e2e.sh http://localhost:18080 'Smoke-Test-Passw0rd!'
docker compose --env-file /tmp/td.env -p tdtest down -v
```

### 測試寫法
- `createTestContext(env?)` 建立獨立的 DB 與 app；`ctx.clock.advance(ms)` 控制時間；`ctx.createUser(email, role)` 建立已可登入的使用者（密碼 `STRONG_PASSWORD`）。
- 測試共用一個 context 時（`beforeAll`），資料會累積，斷言不要假設表是空的；需要乾淨狀態就另開 context。
- **測試不可連到外部服務**：`tests/setup.ts` 會擋下真正的 `fetch`、對外的 DNS 查詢與 socket 連線（loopback 除外，真實 PostgreSQL 測試用得到），即使程式自己吞掉錯誤，該測試仍會失敗。
  通知用 `dispatchPending(deps, fakeSenders)`；要測 `defaultSenders()` 就用 `vi.stubGlobal('fetch', …)` 或 `vi.spyOn(nodemailer, 'createTransport')`。
- 測試環境的登入速率限制已調高為 1000/分；要測速率限制請自己開一個 `createTestContext({ LOGIN_RATE_LIMIT_PER_MIN: '3' })`。

---

## 7. 已知陷阱（都實際踩過）

1. **raw `sql` 模板中不要直接放 `Date`**：postgres-js 會送出 `Date.toString()`（`Fri Oct 23 2026 …`），PostgreSQL 解析失敗；PGlite 卻能接受，所以只用 PGlite 測不出來。寫成 `${date.toISOString()}::timestamptz`。透過欄位比較（`lt(tickets.createdAt, date)`）則沒問題。
2. **drizzle-kit 的 `--out` 不能用絕對路徑**：會變成 `.//tmp/...` 而失敗，且 exit code 仍是 0。`validate.sh` 因此改用相對路徑，並檢查輸出中的 `No schema changes`。
3. **shell 腳本中的 `[ … ] && ok` 會吞掉失敗**（`set -e` 不作用在 `&&` 串列）。`smoke.sh` 一律用 `check` 函式。
4. **非互動 shell 沒有載入 nvm**：先執行 `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`，否則找不到 `node`。
5. **Docker 群組**：如果目前的 shell 是在使用者加入 docker 群組前啟動的，`docker` 會 permission denied，用 `sg docker -c "docker …"`。
6. **專案根目錄的 `.env` 同時給 CrewAI 本機工具（`OPENROUTER_API_KEY`）與 docker compose 使用**。測試部署請用 `--env-file` 指定其他檔案，不要覆寫它。`.dockerignore` 已排除 `.env`。
7. **加密欄位長度**：AES-GCM 加密後的 TOTP 金鑰約 90 字元，`varchar(64)` 放不下（曾因此出錯，已改為 255）。新增加密欄位要預留長度。
8. **瀏覽器 console 的 4xx**：未登入時 `/auth/me` 回 401 是正常的，瀏覽器會記為 console error；`tests/e2e/ui.mjs` 只忽略 4xx 資源錯誤，JS 例外、CSP 違規與 5xx 仍會失敗。
9. **改版面一定要看截圖**（`scripts/ui-e2e.sh`）：型別與單元測試抓不到錯位與溢出（例如舊版 `.card + .card` 的 margin 曾讓 grid 卡片錯位，已隨 Ant Design 改版移除）。
10. **Vite 會把小於 4KB 的資源內嵌成 `data:` URI**：字型被內嵌後 CSP（`default-src 'self'`）會擋下，`scripts/ui-e2e.sh` 會報 `Refused to load the font 'data:…'`。
    `vite.config.ts` 的 `assetsInlineLimit` 已排除 `.woff/.woff2`；新增其他資源類型時注意同樣的問題，不要用放寬 CSP 來解決。
11. **背景工作在程序內執行**：開兩個 app 副本會重複發送通知與重複掃描 SLA。要水平擴充得先把 `index.ts` 的計時器拆成獨立 worker 並加分散式鎖。
12. **Ant Design 的行為差異**（改版時都踩過）：
    - 兩個中文字的按鈕會被自動插入空格（「登入」變「登 入」），文字就和字典不一致；`main.tsx` 的 ConfigProvider 已設 `button={{ autoInsertSpace: false }}`。
    - `Button` 只有 `loading` 時點擊會被吞掉，但不是 disabled，Playwright 不會等它；送出按鈕要同時設 `disabled`。
    - `Select` 不是原生 `<select>`：e2e 用 `tests/e2e/ui.mjs` 的 `pick()`（點開後依 title 點選項），選項要帶 `title`（`<Choice>` 已處理）。
    - `Input.TextArea` 的 `autoSize` 會在頁面放一個隱藏的量測用 textarea，e2e 要用 `textarea:visible`。
    - `Layout.Sider` 的 `breakpoint` 要等第一次量測後才收合，手機上第一個畫面會被撐寬；`Layout.tsx` 用 `matchMedia` 決定初始的 `collapsed`。
    - 巢狀 `ConfigProvider` 換了 `algorithm` 仍會繼承外層的 token：側邊欄的深色選單曾繼承淺色主題的白色 `colorBgElevated`，變成白底白字。
      巢狀主題要自己設定會用到的底色（`Layout.tsx` 的 `navControls`）。
13. **頁面延遲載入後，舊頁面會留到新頁面的程式下載完**（React Router 以 transition 導覽）：e2e 點連結後要先等新頁面的標題
    （`getByRole('heading', …).waitFor()`）再操作，否則 `getByLabel()` 可能抓到舊頁面上同名的元素（曾抓到儀表板的「服務類別」圖表）。
14. **Playwright 的 `waitForFunction` 在本系統不能用**：它需要 eval，CSP（`script-src 'self'`）會擋下。改用 locator 或以 `evaluate` 輪詢。
15. **nginx 的 `X-Forwarded-For` 必須覆寫，不能附加**：`clientIp()` 在 `TRUST_PROXY=true` 時取第一個值；改成 `$proxy_add_x_forwarded_for`
    會讓用戶端自帶的標頭成為第一個值，可偽造登入速率限制與稽核日誌的 IP。app 不對主機開放連接埠，除錯請用
    `docker compose exec app wget -qO- http://127.0.0.1:8080/healthz` 或經 nginx。
16. **側邊欄收合時 antd `Menu` 的展開群組**：收合時 antd 會呼叫 `onOpenChange([])`，而且仍展開的群組會變成浮動子選單蓋住頁面。
    `Layout.tsx` 把收合時的浮動子選單（`popupKeys`）與展開時的群組（`openKeys`，存在瀏覽器）分開記錄，收合不會清掉使用者的選擇。
    手機（`matchMedia`）與桌面的收合狀態也分開：手機完全隱藏，桌面是圖示列並記在瀏覽器，縮放視窗不會改掉使用者的選擇。
17. **頁面在 `.main` 內捲動，不是 window**（`.app-shell` 固定為視窗高度）：Playwright 的 `fullPage` 截圖只會拍到視窗高度，
    e2e 要用 `tests/e2e/ui.mjs` 的 `fullShot()`；檢查水平溢出也要看 `.main`（`overflowOf()`），因為它會裁掉溢出，只看 document 測不到。
18. **react-grid-layout 的寬度與動畫**：`useContainerWidth()` 預設先以 1280px 排版，量到實際寬度後再以動畫移動每張卡片，手機上會短暫溢出、截圖錯位；
    `Dashboard.tsx` 用 `measureBeforeMount: true`。e2e 量卡片位置前要等動畫（200ms）結束，拖曳前要先 `scrollIntoViewIfNeeded()`，視窗外的把手拖不到。

---

## 8. 交接規範（每次結束工作前）

- [ ] `npm run validate` 通過；動到 SQL 時，真實 PostgreSQL 的測試也通過
- [ ] `CHANGELOG.md` 的 `[Unreleased]` 記錄了這次的變更（Added / Changed / Fixed / Removed / Security）
- [ ] 偏離 `specs/customer_spec.md` 或 PRD 的決定已寫入 `specs/DECISIONS.md`
- [ ] 架構、指令、規則、陷阱有變化時已更新本文件；使用方式有變化時已更新 README 與 `docs/DEPLOYMENT_GUIDE.md`
- [ ] 新的環境變數已同步到 `config.ts`、`.env.example`、`docker-compose.yml`、部署指南
- [ ] 做到一半的工作：在 `[Unreleased]` 標明「進行中」與下一步，不要讓下一位猜
