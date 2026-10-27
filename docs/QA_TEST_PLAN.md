# 品質與資安測試計畫 (QA & SECURITY TEST PLAN) — TicketDesk 企業級 ITSM 工單管理平台

| 項目 | 內容 |
| --- | --- |
| 文件編號 | QA-TD-001 |
| 版本 | **v1.0.0** |
| 文件狀態 | 初版發布 (Baseline for M5 測試與資安審查) |
| 建立日期 | 2026-02-18 |
| 文件擁有者 | 品質測試與資安工程師 (QA) |
| 審閱者 | 系統架構師 (SAr)、資深全端工程師 (PG)、產品需求專案經理 (PM) |
| 關聯文件 | `docs/PRD_SPEC.md`（PRD-TD-001）、`docs/DEPLOYMENT_GUIDE.md`（DEP-TD-001）、`README.md`、`CHANGELOG.md`、`src/server/db/schema.ts`、`drizzle/`（migrations）、`docs/openapi.json` |
| 適用版本 | TicketDesk v1.0.0（SemVer） |
| 測試範圍 | 身分認證繞過防護、RBAC 權限邊界、IDOR 越權、2FA、外部 API 速率限制、資料過濾（>3 天未結案）、系統回歸 |

---

> **實作狀態（2026-10-24，v0.2.0）**：本計畫中的 P0 安全情境已有對應的自動化測試（`tests/*.test.ts`，執行 `npm test`；
> 設定 `TEST_DATABASE_URL` 可改用真實 PostgreSQL），端到端煙霧測試為 `scripts/smoke.sh`。
> 改密前的業務 API 一律回 `403`（`code=password_change_required`），不是原計畫的 422，見 [`specs/DECISIONS.md`](../specs/DECISIONS.md)。
> 尚未實作的功能（SSO、FIDO2、附件、`/users` 端點等）相關案例暫不適用。


## 0. 閱讀指引

本計畫為 TicketDesk v1.0.0 的 **唯一測試權威文件**，所有測試案例皆可追溯至 `docs/PRD_SPEC.md` 的驗收條件（AC）與功能需求（FR）。

| 章節 | 內容 | 主要讀者 |
| --- | --- | --- |
| §1 | 測試策略、層級、環境矩陣、測試資料、進出條件、缺陷嚴重度 | 全體 |
| §2 | 測試矩陣總覽（案例數、自動化比例、優先級分佈） | PM、QA |
| §3 | **預設臨時管理員安全性驗證**（強制改密、防暴力破解、2FA 開啟） | QA、資安、PG |
| §4 | **外部廠商 IDOR 越權讀取工單防護** | QA、資安、PG |
| §5 | **外部 SOC API Rate Limiting 與資料過濾（>3 天未結案）** | QA、PG、維運 |
| §6 | **系統回歸測試矩陣**（RBAC / 2FA / 預設密碼 / API / 報表 / 通知 / 雙軌佈署） | QA、PM |
| §7 | 自動化與 CI 管線設計 | QA、PG |
| §8 | 缺陷管理、測試報告格式、發佈建議 | PM、QA |
| §9 | 需求追溯矩陣 (RTM) | PM、QA |
| §10 | 附錄：測試指令、基準 SQL、k6 腳本、檢查清單 | QA、PG |

### 0.1 測試案例格式定義

每個測試案例包含以下欄位：

| 欄位 | 說明 |
| --- | --- |
| **ID** | 唯一識別碼（`SEC-BA-001`、`SEC-IDOR-001`、`API-RL-001`、`REG-AUTH-001` …） |
| **標題** | 測試目的 |
| **對應需求** | PRD 章節 / 驗收條件編號 |
| **優先級** | P0（阻斷性，必測）/ P1（應測）/ P2（加分） |
| **類型** | 功能 / 安全 / 效能 / 回歸 / 相容性 |
| **前置條件** | 環境、資料、帳號狀態 |
| **步驟** | 可重複執行的操作序列 |
| **預期結果** | 可驗證的客觀結果（HTTP 碼、DB 值、日誌、UI 行為） |
| **自動化** | ✅ 自動化 / ⚠️ 半自動 / ❌ 手動 |

### 0.2 測試帳號與角色代號（全文件共用）

| 代號 | 角色 | Email | 說明 |
| --- | --- | --- | --- |
| `U-BA` | `super_admin` | `admin@ticket.local` | Bootstrap Admin（初始 `must_change_password=TRUE`） |
| `U-SA2` | `super_admin` | `sa2@ticket.local` | 第二位系統管理員（測試「最後管理員保護」用） |
| `U-IM` | `it_manager` | `itm@ticket.local` | IT 服務主管（2FA 強制角色） |
| `U-AG1` | `agent` | `agent1@ticket.local` | 內部工程師（Team A） |
| `U-AG2` | `agent` | `agent2@ticket.local` | 內部工程師（Team B） |
| `U-VD1` | `vendor` | `vendor1@ext-vendor.example.com` | 外部廠商 A（被指派 TCK-A） |
| `U-VD2` | `vendor` | `vendor2@ext-vendor.example.com` | 外部廠商 B（僅 Watcher TCK-B） |
| `U-EU1` | `end_user` | `user1@example.com` | 一般使用者（請求者 TCK-A） |
| `U-EU2` | `end_user` | `user2@example.com` | 一般使用者（無關聯） |
| `T-SOC` | `api_client` | — | SOC 系統 API Token（Scope：`ticket:create`、`ticket:read:own`） |
| `T-VD` | `api_client` | — | 廠商整合 API Token（Scope：`ticket:read:own`、`ticket:reply:own`） |

### 0.3 測試資料集（Fixture）

| 工單 | 請求者 | 指派對象 | Watcher | 狀態 | `created_at`（相對 now） | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `TCK-A` | `U-EU1` | `U-VD1` | `U-AG1` | `open` | −10 天 | 廠商 A 合法可見 |
| `TCK-B` | `U-EU1` | `U-AG1` | `U-VD2` | `open` | −5 天 | 廠商 B 僅 Watcher 可見 |
| `TCK-C` | `U-EU2` | `U-AG2` | — | `open` | −4 天 | 廠商 A **不可見**（IDOR 目標） |
| `TCK-D` | `U-EU2` | `U-VD1` | — | `pending_user` | −3 天 1 小時 | 含 `internal_note`（隔離測試） |
| `TCK-E` | `U-EU1` | `U-VD1` | — | `resolved` | −20 天 | 已結案（不列入 >3 天積壓） |
| `TCK-F` | `U-EU2` | `U-AG2` | — | `open` | **恰好 −72 小時 0 分 0 秒** | 邊界值（**不計入** >3 天） |
| `TCK-G` | `U-EU2` | `U-AG2` | — | `open` | −72 小時 1 秒 | 邊界值（**計入** >3 天） |
| `TCK-H` | `U-EU2` | `U-AG2` | — | `closed` | −100 天 | 已結案（不列入） |

> **時間控制**：測試環境必須能以「回填 `created_at`」或「凍結資料庫時鐘（`now()` 注入）」方式建立精確邊界資料；**禁止** 以 sleep 等待 72 小時。

---

## 1. 測試策略與範圍

### 1.1 測試目標

1. **認證繞過零容忍**：`must_change_password=TRUE` 期間，除改密與登出外，**任何** 業務端點皆不可存取（含 API、UI 路由、WebSocket/SSE、檔案下載）。
2. **RBAC 權限邊界可證明**：`vendor` / `end_user` 之物件層級授權在 **查詢層** 生效，越權一律 `404`（非 `403`），且無存在性洩漏。
3. **2FA 可強制、可停用、可復原**：全域開關切換不破壞既有綁定；TOTP 抗重放；復原碼單次使用且僅存雜湊。
4. **外部 API 抗濫用**：速率限制精確（60 req/min 預設）、`429` 附 `Retry-After`、分散式一致性、不可經標頭偽造繞過。
5. **資料過濾口徑一致**：「超過 3 天未結案」在 Dashboard、列表、匯出、排程報表 **筆數零誤差**，且 72 小時整邊界 **不計入**。
6. **回歸零破壞**：v1.0.0 全 P0 需求在雙軌（Docker / Cloudflare）皆通過回歸。

> **Cloudflare 不做**（2026-10-26，DECISIONS D3）：本計畫中 `qa-cf` 環境、D1／`wrangler` 相關案例（SEC-BA-008、SEC-BA-052、REG-DEPLOY-004～005 等）與「雙軌」要求都不適用，只驗證 Docker。

### 1.2 測試層級、工具與覆蓋目標

| 層級 | 範圍 | 工具 | 覆蓋目標 |
| --- | --- | --- | --- |
| **單元測試 (UT)** | 密碼政策、SLA 計算、aging 邊界、權杖版本比對、速率限制演算法、RBAC 條件產生器 | Jest / Vitest（Node）、pytest（Python）、`pytest-cov` | 語句 ≥ 80%、分支 ≥ 75%；**aging 邊界與密碼政策必須 100% 分支覆蓋** |
| **整合測試 (IT)** | API + DB + Redis/Queues（Testcontainers） | Supertest、Testcontainers、`pg-mem`（輔助） | 所有 `/api/v1/*` 端點至少 1 正向 + 1 負向 |
| **E2E 測試** | 登入 → 改密 → 2FA → 工單流程 → 報表 | Playwright（Chromium / Firefox / WebKit） | 12 條關鍵使用者旅程 |
| **安全測試 (SEC)** | 認證繞過、IDOR、2FA、速率限制、注入、標頭 | OWASP ZAP（baseline + active）、自製腳本（Python `requests` / `httpx`）、Burp Suite（手動） | 零 Critical / 零 High 未解 |
| **效能測試 (PERF)** | 100 RPS 開單、列表查詢 10 萬筆、Dashboard 首屏 | k6、Artillery、Lighthouse | P95 ≤ 300ms（API）、≤ 500ms（列表）、首屏 ≤ 2s |
| **回歸測試 (REG)** | 全 P0 驗收條件 | Playwright + API 契約測試（Schemathesis / Dredd） | 100% P0 案例通過 |
| **相容性** | Chrome / Edge / Safari / Firefox 最新兩版；≥375px | Playwright projects、BrowserStack（選用） | 無阻斷性版面/功能缺陷 |

### 1.3 環境矩陣

| 環境 | 軌道 | 資料庫 | 用途 | 備註 |
| --- | --- | --- | --- | --- |
| `qa-docker` | 方案 A（Docker Compose） | PostgreSQL 16 | 主要功能 / 安全 / 回歸 | 可自由重置 Volume、回填 `created_at` |
| `qa-cf` | 方案 B（Cloudflare） | D1（`ticketdesk-db-staging`） | 雙軌一致性、Cron、Queues | 需 `wrangler dev --local` + 遠端 staging 各一輪 |
| `qa-perf` | 方案 A（獨立資源） | PostgreSQL 16（10 萬筆種子） | 效能與速率限制壓測 | 與功能環境隔離，避免污染 |
| `qa-idp` | 輔助 | — | LDAP（OpenLDAP）、SAML（Keycloak）、OIDC（Keycloak） | 驗證外部 IdP 與 SCIM |

**環境鐵則**

1. `qa-*` 環境 **不得** 指向 production 資料庫、SMTP 或 Telegram Bot。
2. 通知測試使用 **MailHog / Mailpit**（SMTP 攔截）與 **測試專用 Telegram 群組 / Teams 頻道**。
3. 每個測試案例執行前以 `fixture reset` 還原資料集（TRUNCATE + 重新種子），確保可重複。
4. 雙軌環境的 `APP_ENV` 分別為 `staging`，且 `SESSION_COOKIE_SECURE=true`（需本機 TLS 或 `localhost` 例外設定）。

### 1.4 測試資料策略

| 類別 | 策略 |
| --- | --- |
| 使用者 | 依 §0.2 建立固定帳號；密碼統一 `Qa!Passw0rd#2026`（符合政策），Bootstrap Admin 例外 |
| 工單 | 依 §0.3 建立 8 張控制工單；`created_at` 以 SQL 回填 |
| 自訂欄位 | 建立 `affected_host`（public, filterable）、`internal_ref`（internal, filterable）、`asset_id`（agent_only） |
| Tag | `ransomware`、`edr`、`p1`、`vendor-a` |
| API Token | `T-SOC`（60 req/min）、`T-VD`（30 req/min）、`T-NOLIMIT`（測試用高額度） |
| 敏感資料 | 工單描述含測試用身分證號 `A123456789`、電話 `0912345678`，用於遮罩驗證 |
| 清理 | 測試結束執行 `fixture teardown`；審計日誌保留供查驗 |

### 1.5 進入條件 (Entry Criteria)

- [ ] `src/schema.sql`、`docker-compose.yml`、`wrangler.toml`、`src/api_spec.json` 已凍結（v1.0.0）
- [ ] `qa-docker` 環境 `docker compose up -d` 成功且 `/healthz` 回 `status=ok`
- [ ] Bootstrap Admin 種子資料存在且旗標正確（`must_change_password=TRUE`）
- [ ] 測試資料集（§0.3）已建立完成
- [ ] OpenAPI 規格可通過 `spectral lint`（無 error）
- [ ] 測試帳號與 Token 已配發，權限符合 §0.2

### 1.6 退出條件 (Exit Criteria)

1. **零** 未解 Critical（S1）與 High（S2）缺陷。
2. 所有 **P0** 測試案例 100% 通過；P1 ≥ 95% 通過（未通過者需 PM 書面接受風險）。
3. 安全測試（ZAP active scan + 自製 IDOR/繞過腳本）零 High 以上告警。
4. 效能指標達標：API P95 ≤ 300ms、列表 ≤ 500ms、100 RPS 開單成功率 ≥ 99.5%。
5. 雙軌（Docker / Cloudflare）皆完成一輪端到端回歸。
6. 測試報告與缺陷清單已交付 PM，並完成 Go/No-Go 會議。

### 1.7 缺陷嚴重度與優先級

| 嚴重度 | 定義 | 範例 | 處理時限 |
| --- | --- | --- | --- |
| **S1 Critical** | 可繞過認證/授權、可讀取他人工單、預設密碼未強制更換、權限提升 | 受限權杖可呼叫 `GET /tickets`；vendor 讀取非指派工單成功 | 24 小時內修復並回歸 |
| **S2 High** | 高風險資料洩漏、速率限制失效、2FA 可繞過、內部備忘外洩 | `internal_note` 出現在 vendor API 回應；`429` 未觸發 | 3 個工作日 |
| **S3 Medium** | 功能錯誤但有替代路徑、邊界筆數誤差、UI 導向錯誤 | 72 小時整邊界被計入積壓 | 5 個工作日 |
| **S4 Low** | 文案、樣式、非阻斷性 UX | 錯誤訊息用字不一致 | 次版修復 |

**優先級**：P0 = 阻斷發佈；P1 = 應修；P2 = 可延。

---

## 2. 測試矩陣總覽

| 測試套件 | 章節 | 案例數 | P0 | P1 | P2 | 自動化 |
| --- | --- | --- | --- | --- | --- | --- |
| 預設臨時管理員安全性 | §3 | 34 | 26 | 7 | 1 | 28 ✅ / 4 ⚠️ / 2 ❌ |
| 外部廠商 IDOR 越權 | §4 | 28 | 22 | 5 | 1 | 24 ✅ / 3 ⚠️ / 1 ❌ |
| SOC API Rate Limiting | §5.1 | 18 | 12 | 5 | 1 | 16 ✅ / 2 ⚠️ |
| SOC API 資料過濾（>3 天） | §5.2 | 22 | 16 | 5 | 1 | 20 ✅ / 2 ⚠️ |
| 系統回歸 | §6 | 68 | 38 | 26 | 4 | 59 ✅ / 7 ⚠️ / 2 ❌ |
| **合計** | — | **170** | **114** | **48** | **8** | **147 ✅ / 18 ⚠️ / 5 ❌** |

> 自動化比例約 **85%**；手動案例集中於 UI 視覺、瀏覽器相容性與需人工判讀的資安探索。

---

## 3. 預設臨時管理員安全性驗證（SEC-BA / SEC-BF / SEC-2FA）

> **對應需求**：PRD §FR-1.2、§FR-1.3、§FR-1.4、§FR-1.5、§FR-1.6、§9.1（AC-SEC-01.1 ~ AC-SEC-01.9）、AC-2FA-01 ~ AC-2FA-03。
> **風險等級**：極高（預設帳密外洩 = 全系統接管）。

### 3.1 種子資料與旗標驗證（AC-SEC-01.1）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-001 | Bootstrap Admin 種子存在且唯一 | 全新 `qa-docker`（空 Volume） | 1. `docker compose up -d` 2. 查詢 `SELECT count(*) FROM users WHERE email='admin@ticket.local'` | 回傳 **1**（不得為 0 或 2） | ✅ | P0 |
| SEC-BA-002 | 角色與旗標正確 | 同上 | 查詢 `email, role, must_change_password, is_bootstrap_admin, two_factor_enabled, password_updated_at` | `role='super_admin'`、`must_change_password=TRUE`、`is_bootstrap_admin=TRUE`、`two_factor_enabled=FALSE`、`password_updated_at IS NULL` | ✅ | P0 |
| SEC-BA-003 | 密碼僅存 bcrypt 雜湊 | 同上 | 1. 查詢 `password_hash` 2. 驗證前綴與格式 | 前綴為 `$2a$` 或 `$2b$`；`password_hash <> 'Admin@InitTemp2026!'`；`password_hash` 長度 ≥ 55 | ✅ | P0 |
| SEC-BA-004 | bcrypt cost ≥ 10 | 同上 | 以 `bcrypt.getRounds(hash)` 或 `htpasswd -vb` 解析 | cost ∈ [10, 14]（建議 12） | ✅ | P0 |
| SEC-BA-005 | 明文密碼未出現於版控與種子腳本 | 原始碼樹 | 1. `grep -rn "Admin@InitTemp2026" --exclude-dir=node_modules --exclude-dir=.git .` 2. 檢視 `src/schema.sql` | 僅出現在 **文件說明**（`README.md`、`docs/*.md`）與測試案例；`src/schema.sql`、`src/migrations/*`、`docker-compose.yml`、`wrangler.toml` **零命中** | ✅ | P0 |
| SEC-BA-006 | 種子冪等性（容器重啟） | 已完成 SEC-BA-001 | 1. `docker compose restart postgres web` 2. 重新查詢 count 與 `password_hash` | count 仍為 1；`password_hash` **未變更**；`must_change_password` 仍為 `TRUE` | ✅ | P0 |
| SEC-BA-007 | 種子冪等性（migration 重跑） | 同上 | 1. 重複執行 `src/schema.sql`（`psql -f`）2. 查詢 | 無錯誤；count=1；密碼未被重置 | ✅ | P0 |
| SEC-BA-008 | D1 軌道種子冪等性 | `qa-cf` | 1. `wrangler d1 execute ... --file=./src/schema.sql` 執行兩次 2. 查詢 count | count=1；`must_change_password=1`；`password_hash` 未變 | ✅ | P0 |
| SEC-BA-009 | 已改密後重啟不回復初始密碼 | 已完成改密（SEC-BA-020） | 1. 重啟容器 / 重跑 migration 2. 以 **新密碼** 登入 3. 以 **初始密碼** 登入 | 新密碼成功；初始密碼 **失敗**（`401`）；`must_change_password=FALSE` 維持 | ✅ | P0 |

### 3.2 首次登入強制導向改密頁（AC-SEC-01.2）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-010 | 首次登入取得受限權杖 | `must_change_password=TRUE` | `POST /api/v1/auth/login`（`admin@ticket.local` / `Admin@InitTemp2026!`） | HTTP `200`；回應含 `status='password_change_required'`、`restricted_token`、`change_password_url='/change-password'`；**不含** `access_token` / `refresh_token` | ✅ | P0 |
| SEC-BA-011 | 受限權杖 Scope 僅含改密與登出 | 同上 | 1. 解碼 JWT（`jwt.decode`）2. 檢視 `scope` / `scp` 聲明 | Scope 集合 **等於** `{password:change, auth:logout}`（不得含 `ticket:*`、`user:*`、`report:*`） | ✅ | P0 |
| SEC-BA-012 | 受限權杖有效期 ≤ 10 分鐘 | 同上 | 解碼 `exp - iat` | ≤ 600 秒 | ✅ | P0 |
| SEC-BA-013 | 瀏覽器登入導向改密頁 | 同上 | Playwright：登入 → 觀察 URL | 導向 `/change-password`；**未** 進入 `/dashboard`；無 Dashboard DOM 元素 | ✅ | P0 |
| SEC-BA-014 | 登入頁顯示高風險提示 | 同上 | 檢視登入頁 | 顯示「首次登入必須變更密碼」提示（Glossary 字串，非硬編碼） | ⚠️ | P1 |

### 3.3 改密前功能全面封鎖（AC-SEC-01.3）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-015 | 業務 API 全面回 403 | 持有受限權杖 | 逐一呼叫：`GET /tickets`、`POST /tickets`、`GET /tickets/{id}`、`PATCH /tickets/{id}`、`GET /users`、`GET /reports/tickets`、`GET /help-topics`、`POST /notifications/{id}/resend` | **全部** 回 `403 password_change_required`（RFC 7807）；回應 body **不含** 任何業務資料 | ✅ | P0 |
| SEC-BA-016 | 無業務資料洩漏 | 同上 | 檢查每個 `403` 回應 body 與 headers | 僅含 `type`/`title`/`status`/`detail`/`instance`/`trace_id`；無 `data`、無工單欄位、無使用者清單 | ✅ | P0 |
| SEC-BA-017 | 前端路由守衛 | 受限權杖 | Playwright 直接輸入 `/dashboard`、`/tickets`、`/reports`、`/settings` | 全部導回 `/change-password`；不發出業務 API 請求（以 network log 驗證） | ✅ | P0 |
| SEC-BA-018 | 檔案下載端點封鎖 | 受限權杖 | `GET /api/v1/attachments/{id}/download` | `403 password_change_required`（不得回 `302` 到預簽 URL） | ✅ | P0 |
| SEC-BA-019 | 中介層順序驗證（旗標在授權前） | 受限權杖 + 無效 Scope | 1. 以受限權杖呼叫需 `ticket:read` 的端點 2. 觀察錯誤碼 | 回 `403` 且 `code=password_change_required`（**非** `code=forbidden`）→ 證明旗標檢查在授權之前 | ✅ | P0 |

### 3.4 改密流程與密碼政策（AC-SEC-01.4）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-020 | 合法改密成功 | 受限權杖 | `POST /api/v1/auth/change-password`，`new_password='Qa!Str0ngPass#2026'` | HTTP `200`；回傳 `must_change_password=false`、`is_bootstrap_admin=false`、`access_token`、`refresh_token` | ✅ | P0 |
| SEC-BA-021 | 長度不足被拒 | 受限權杖 | `new_password='Ab1!xyz'`（7 字元） | `400 validation_error`；`errors[].field='new_password'`；DB `password_hash` **未變** | ✅ | P0 |
| SEC-BA-022 | 缺少大寫 | 同上 | `new_password='qa!str0ngpass#2026'` | `400`；明確指出需大寫 | ✅ | P0 |
| SEC-BA-023 | 缺少小寫 | 同上 | `new_password='QA!STR0NGPASS#2026'` | `400` | ✅ | P0 |
| SEC-BA-024 | 缺少數字 | 同上 | `new_password='Qa!StrongPass#abc'` | `400` | ✅ | P0 |
| SEC-BA-025 | 缺少特殊符號 | 同上 | `new_password='QaStr0ngPass2026'` | `400` | ✅ | P0 |
| SEC-BA-026 | 與初始密碼相同被拒 | 同上 | `new_password='Admin@InitTemp2026!'` | `400`；訊息指出不得與初始密碼相同 | ✅ | P0 |
| SEC-BA-027 | 與前 5 次密碼重複被拒 | 已完成 5 次改密 | 依序改為 P1…P5，再嘗試設回 P1 | 前 5 次成功；第 6 次（重用 P1）回 `400 password_reuse` | ✅ | P0 |
| SEC-BA-028 | 確認密碼不一致被拒 | 受限權杖 | `new_password` 與 `confirm_password` 不同 | `400`；DB 未變更 | ✅ | P0 |
| SEC-BA-029 | 改密成功後旗標與時間戳 | 完成 SEC-BA-020 | 查詢 `must_change_password, is_bootstrap_admin, password_updated_at` | `FALSE`、`FALSE`、非 NULL（UTC，誤差 ≤ 5 秒） | ✅ | P0 |
| SEC-BA-030 | 改密寫入審計日誌 | 同上 | 查詢 `audit_logs WHERE action='password.changed'` | 1 筆；`actor_email='admin@ticket.local'`；含 `ip`、`user_agent`、`trace_id`；`diff` **不含** 明文密碼 | ✅ | P0 |
| SEC-BA-031 | 改密後舊密碼失效 | 同上 | 以 `Admin@InitTemp2026!` 登入 | `401 unauthenticated`；失敗計數 +1 | ✅ | P0 |
| SEC-BA-032 | 弱密碼字典攻擊防護 | 受限權杖 | 以常見弱密碼清單（`Password123!`、`Qwerty123456!`）嘗試 | 全部 `400`（若啟用弱密碼黑名單）；至少不得低於政策 | ⚠️ | P1 |

### 3.5 改密後權杖輪替（AC-SEC-01.5）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-033 | 舊 Session 立即撤銷 | 改密前先以另一瀏覽器登入取得受限權杖 | 1. 完成改密 2. 以舊受限權杖呼叫 `GET /tickets` | `401`（權杖已撤銷）；不得回 `403` 或成功 | ✅ | P0 |
| SEC-BA-034 | 舊 Refresh Token 失效 | 改密前持有 refresh token（若簽發） | 改密後 `POST /auth/refresh` | `401`；不得簽發新 Access Token | ✅ | P0 |
| SEC-BA-035 | 新權杖可正常使用 | 完成改密 | `GET /api/v1/tickets`（新 access token） | `200`；回傳可見工單 | ✅ | P0 |
| SEC-BA-036 | 權杖版本 (`tv`) 遞增 | 改密前後 | 解碼新舊 JWT 的 `tv` 聲明 | 新 `tv` > 舊 `tv`；Redis/KV `user:{id}:tv` 已更新 | ✅ | P0 |
| SEC-BA-037 | 快取失效 ≤ 5 秒 | 改密後 | 於 5 秒內以舊權杖重試 | 全部 `401`（不得因快取而放行） | ⚠️ | P1 |

### 3.6 不可繞過性（AC-SEC-01.6）

| ID | 標題 | 繞過向量 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-038 | URL 直接存取 Dashboard | 前端路由 | 受限權杖下直接輸入 `/dashboard`、`/#/tickets` | 導回 `/change-password`；無業務 API 請求 | ✅ | P0 |
| SEC-BA-039 | API Token 呼叫業務端點 | 以 `T-SOC` Bearer 呼叫 | `GET /api/v1/tickets`（`T-SOC`） | `403 password_change_required`（旗標檢查在授權中介層之後、業務邏輯之前） | ✅ | P0 |
| SEC-BA-040 | 重複登入取得新權杖 | 多次 `POST /auth/login` | 連續登入 3 次 | 每次皆回受限權杖；**不得** 因重複登入而升級為完整權杖 | ✅ | P0 |
| SEC-BA-041 | 走「忘記密碼」流程 | 密碼重設 | 1. `POST /auth/forgot-password`（寄至 admin 信箱）2. 以重設 Token 設新密碼 3. 登入 | 重設後仍須完成「首次改密」流程（旗標未被清除）；或系統明確拒絕 Bootstrap Admin 使用自助重設 | ✅ | P0 |
| SEC-BA-042 | 前端儲存竄改 | localStorage / Cookie | 1. 手動改 `localStorage.role='super_admin'`、`must_change_password=false` 2. 重新載入 3. 呼叫 API | 後端仍回 `403`；UI 仍導回改密頁（前端狀態不具授權效力） | ✅ | P0 |
| SEC-BA-043 | JWT 竄改（alg=none） | 權杖偽造 | 1. 將 header `alg` 改 `none`、payload `must_change_password=false` 2. 呼叫 API | `401`；審計記錄 `auth.token.invalid`（`reason=alg_not_allowed`） | ✅ | P0 |
| SEC-BA-044 | JWT 竄改（簽章錯誤 / kid 注入） | 權杖偽造 | 1. 改 payload 並以錯誤密鑰重簽 2. 改 `kid` 為路徑穿越字串（`../../etc/passwd`） | 全部 `401`；不得發生檔案讀取或 500 洩漏堆疊 | ✅ | P0 |
| SEC-BA-045 | 受限權杖提權（Scope 擴張） | 權杖偽造 | 1. 解碼受限權杖 2. 將 `scope` 改為 `ticket:read` 並重簽（錯誤密鑰） | `401`；不得回業務資料 | ✅ | P0 |
| SEC-BA-046 | 直接呼叫改密端點繞過舊密碼驗證 | 邏輯缺陷 | `POST /auth/change-password` 省略 `current_password` 或填入錯誤值 | `400`；不得更新密碼 | ✅ | P0 |
| SEC-BA-047 | 以 PATCH /users/{id} 直接清除旗標 | 邏輯缺陷 | 受限權杖 `PATCH /api/v1/users/{id}` body `{"must_change_password": false}` | `403`（旗標攔截）或 `403`；DB 旗標仍為 `TRUE` | ✅ | P0 |
| SEC-BA-048 | HTTP 方法 / 路徑變形繞過 | 路徑混淆 | 嘗試 `GET /api/v1/tickets/`、`//api/v1/tickets`、`/api/v1/tickets?x=1`、`X-HTTP-Method-Override: GET`、大小寫變形 `/API/V1/TICKETS` | 全部 `403` 或 `404`；**不得** 回 `200` 業務資料 | ✅ | P0 |
| SEC-BA-049 | 快取層繞過 | 快取污染 | 1. 以受限權杖請求 `GET /tickets`（預期 403）2. 以完整權杖請求同一 URL 3. 再以受限權杖請求 | 受限權杖仍 `403`；回應 `Cache-Control: no-store`；不得命中他人快取 | ⚠️ | P1 |

### 3.7 冪等性與容器重啟（AC-SEC-01.7）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-050 | 容器重啟不重置密碼 | 已完成改密 | `docker compose down && docker compose up -d`（保留 Volume） | 新密碼可登入；初始密碼失敗；`must_change_password=FALSE` | ✅ | P0 |
| SEC-BA-051 | 不產生重複帳號 | 同上 | `SELECT count(*) FROM users WHERE email='admin@ticket.local'` | 1 | ✅ | P0 |
| SEC-BA-052 | D1 重跑不重置 | `qa-cf` | 重複 `wrangler d1 execute --file=./src/schema.sql` | 密碼未變；count=1 | ✅ | P0 |

### 3.8 高風險提示與文件一致性（AC-SEC-01.8）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-053 | Dashboard 高風險橫幅 | `is_bootstrap_admin=TRUE` 且 `is_active=TRUE` | 以 `U-SA2` 登入 Dashboard | 顯示持續性橫幅「偵測到預設臨時管理員帳號，請立即變更密碼或停用」；不可關閉 | ⚠️ | P1 |
| SEC-BA-054 | 改密後橫幅消失 | 完成改密 | 重新登入 | 橫幅消失 | ⚠️ | P1 |
| SEC-BA-055 | 文件與種子一致 | 文件審查 | 比對 `README.md`、`docs/DEPLOYMENT_GUIDE.md`、`src/schema.sql` 的帳號/密碼/旗標 | 三者完全一致（`admin@ticket.local` / `Admin@InitTemp2026!` / `super_admin` / `must_change_password=TRUE`） | ✅ | P0 |

### 3.9 停用與刪除保護（AC-SEC-01.9）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BA-056 | 最後一位 super_admin 不可停用 | 僅 `U-BA` 一位 `super_admin` | `PATCH /users/{U-BA}` body `{"is_active": false}` | `409 Conflict`；`is_active` 仍 `TRUE` | ✅ | P0 |
| SEC-BA-057 | 最後一位 super_admin 不可刪除 | 同上 | `DELETE /users/{U-BA}` | `409 Conflict`；使用者仍存在 | ✅ | P0 |
| SEC-BA-058 | 有第二位 super_admin 時可停用 | 已建立 `U-SA2` | 停用 `U-BA` | `200`；`is_active=FALSE`；審計日誌記錄 | ✅ | P1 |
| SEC-BA-059 | 停用後 Session 立即失效 | 同上 | 以 `U-BA` 既有 Session 呼叫 API | `401`；≤ 5 秒內生效 | ✅ | P0 |

### 3.10 防暴力破解（Brute-force Protection）

> **對應需求**：PRD §FR-1.4（連續失敗 5 次鎖定 15 分鐘、CAPTCHA 或指數退避）、§FR-1.1（不洩漏帳號存在性）、§FR-1.6（審計）。

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-BF-001 | 連續 5 次失敗鎖定 | `U-AG1` 未鎖定 | 以錯誤密碼登入 5 次（第 6 次用正確密碼） | 第 1~4 次 `401`；第 5 次後 `locked_until` 設為 now+15min；第 6 次（正確密碼）仍 `423 Locked` 或 `429`，且**不得**簽發權杖 | ✅ | P0 |
| SEC-BF-002 | 鎖定時間精確度 | 同上 | 查詢 `locked_until - now()` | 14 分 55 秒 ~ 15 分 5 秒 | ✅ | P0 |
| SEC-BF-003 | 鎖定期間不驗證密碼 | 已鎖定 | 以正確密碼登入 | 拒絕；`failed_login_count` **不再增加**（避免延長/探測） | ✅ | P0 |
| SEC-BF-004 | 鎖定到期自動解鎖 | 已鎖定 | 將 `locked_until` 回填為過去時間 → 以正確密碼登入 | `200`；`failed_login_count` 歸零 | ✅ | P0 |
| SEC-BF-005 | 成功登入重置失敗計數 | 失敗 3 次後成功 | 查詢 `failed_login_count` | `0` | ✅ | P0 |
| SEC-BF-006 | 帳號存在性不洩漏（訊息） | — | 1. 不存在帳號登入 2. 存在帳號錯誤密碼登入 | 兩者 HTTP 碼與訊息 **完全一致**（「帳號或密碼錯誤」）；不得出現「帳號不存在」 | ✅ | P0 |
| SEC-BF-007 | 帳號存在性不洩漏（時間） | — | 以 100 次請求量測兩種情境回應時間 | 統計中位數差異 ≤ 50ms（避免 timing oracle）；建議固定 bcrypt dummy hash 比對 | ⚠️ | P1 |
| SEC-BF-008 | 大小寫 / 空白變形不繞過鎖定 | 已鎖定 `U-AG1` | 以 `AGENT1@ticket.local`、` agent1@ticket.local `、`agent1@ticket.local\t` 嘗試 | 全部視為同一帳號並拒絕（Email 正規化：trim + lowercase + CITEXT） | ✅ | P0 |
| SEC-BF-009 | 分散式鎖定一致性（多實例） | 2 個 App 實例 + Redis | 交替向 instance-1 / instance-2 發送失敗登入 | 累計 5 次後兩實例皆拒絕（Redis 共享計數）；不得各自計數 | ✅ | P0 |
| SEC-BF-010 | 鎖定狀態寫入審計 | 觸發鎖定 | 查詢 `audit_logs WHERE action='auth.login.locked'` | 1 筆；含 `actor_email`、`ip`、`user_agent`、`result='failure'` | ✅ | P0 |
| SEC-BF-011 | 登入失敗審計（每次） | 失敗 3 次 | 查詢 `action='auth.login.failure'` | 3 筆；`diff`/`detail` **不含** 密碼 | ✅ | P0 |
| SEC-BF-012 | 指數退避 / CAPTCHA 觸發 | 失敗 2~3 次 | 觀察第 3 次後是否要求 CAPTCHA 或延遲增加 | 依設定（`LOGIN_BACKOFF_ENABLED=true`）回應延遲遞增或要求 CAPTCHA；不得直接放行 | ⚠️ | P1 |
| SEC-BF-013 | 鎖定不影響其他帳號 | `U-AG1` 已鎖定 | 以 `U-AG2` 正確密碼登入 | `200`（鎖定為帳號層級，非全域） | ✅ | P0 |
| SEC-BF-014 | 密碼重設 Token 一次性 | 觸發忘記密碼 | 1. 使用重設 Token 改密 2. 重複使用同一 Token | 第 2 次 `400/410`（已失效） | ✅ | P0 |
| SEC-BF-015 | 密碼重設 Token 30 分鐘效期 | 觸發忘記密碼 | 將 Token `expires_at` 回填為過去 → 使用 | `410 Gone`；密碼未變更 | ✅ | P0 |
| SEC-BF-016 | 重設 Token 僅存雜湊 | 觸發忘記密碼 | 查詢 DB `password_reset_tokens` | 僅存 `token_hash`（不得存明文 Token） | ✅ | P0 |
| SEC-BF-017 | 鎖定計數器不可由客戶端重置 | 失敗 4 次 | 1. 清除 Cookie / 換 IP（`X-Forwarded-For` 偽造）2. 再失敗 1 次 | 仍觸發鎖定（計數以帳號為鍵，不依賴 Cookie/IP） | ✅ | P0 |
| SEC-BF-018 | 大量併發暴力嘗試（速率） | 壓測工具 | 以 50 併發對同一帳號嘗試 200 次 | 於第 5 次後即拒絕；不得出現 bcrypt 資源耗盡（CPU/記憶體告警）；回應時間可控 | ⚠️ | P1 |
| SEC-BF-019 | 登入端點速率限制 | — | 對 `/auth/login` 以 120 req/min 發送 | 超過閾值回 `429` + `Retry-After`（與 API Token 限制分開計算） | ✅ | P0 |
| SEC-BF-020 | 鎖定解除需管理員或到期 | 已鎖定 | 1. `super_admin` 執行「解鎖使用者」2. 使用者登入 | 解鎖成功並寫入審計（`action='user.unlocked'`） | ⚠️ | P1 |

### 3.11 2FA 開啟測試（2FA Enablement）

> **對應需求**：PRD §FR-1.2、AC-2FA-01 ~ AC-2FA-03、DEP §2.7。

#### 3.11.1 全域開關行為

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-2FA-001 | 全域開關預設值 | 全新環境 | 查詢 `security.2fa.enabled` | 依 `.env` / `wrangler.toml` 設定（文件預設 `true`）；值可經 API 讀取 | ✅ | P0 |
| SEC-2FA-002 | 啟用後管理角色強制綁定 | `security.2fa.enabled=true`、`U-IM` 未綁定 | 以 `U-IM` 登入 | 僅取得受限權杖（Scope 僅 `2fa:enroll`、`auth:logout`）；導向 `/2fa/enroll`；不得進入 Dashboard | ✅ | P0 |
| SEC-2FA-003 | 啟用後 super_admin 強制綁定 | 同上、`U-SA2` 未綁定 | 以 `U-SA2` 登入 | 同上（強制綁定） | ✅ | P0 |
| SEC-2FA-004 | 非強制角色可選用 | `U-AG1`（agent） | 登入 | 直接進入 Dashboard；可於個人設定自行啟用 2FA | ✅ | P1 |
| SEC-2FA-005 | 停用開關不刪除綁定 | `U-SA2` 已綁定 TOTP | 1. 關閉 `security.2fa.enabled` 2. 查詢 `two_factor_secret`、`webauthn_credentials` | 資料 **仍存在**；登入不再要求 2FA | ✅ | P0 |
| SEC-2FA-006 | 重新啟用後綁定立即恢復 | 同上 | 重新開啟開關 → 登入 | 要求輸入 TOTP；原綁定有效（無需重新綁定） | ✅ | P0 |
| SEC-2FA-007 | 開關變更寫入審計 | — | 切換開關 | `audit_logs` 記錄 `action='setting.security.2fa.changed'`，含變更前後值 | ✅ | P0 |
| SEC-2FA-008 | 非 super_admin 不可切換開關 | `U-IM` | `PATCH /settings/security` body `{"2fa_enabled": false}` | `403 forbidden`；設定未變 | ✅ | P0 |

#### 3.11.2 TOTP（RFC 6238）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-2FA-009 | 綁定流程與 QR Code | `U-SA2` 未綁定 | 1. `POST /auth/2fa/enroll` 2. 取得 `otpauth://` URI | URI 含 `issuer=TicketDesk`、`digits=6`、`period=30`、`algorithm=SHA1`；`secret` 為 Base32 | ✅ | P0 |
| SEC-2FA-010 | 正確 TOTP 完成綁定 | 同上 | 以 `oathtool --totp -b <secret>` 產生碼 → `POST /auth/2fa/verify` | `200`；`two_factor_enabled=TRUE`；回傳 10 組復原碼 | ✅ | P0 |
| SEC-2FA-011 | 錯誤 TOTP 拒絕 | 同上 | 輸入 `000000` | `400 invalid_otp`；`two_factor_enabled` 仍 `FALSE` | ✅ | P0 |
| SEC-2FA-012 | ±1 步長容忍 | 已綁定 | 使用前一步 / 後一步的 TOTP | 前一步與後一步皆接受（依設定）；**兩步之前** 拒絕 | ✅ | P0 |
| SEC-2FA-013 | TOTP 重放拒絕 | 已綁定 | 同一組 TOTP 連續使用 2 次 | 第 1 次成功；第 2 次 `400 otp_replayed`（需記錄已使用 `jti`/時間步） | ✅ | P0 |
| SEC-2FA-014 | 登入需 2FA | 已綁定 | 1. 密碼登入 2. 觀察 | 回 `status='2fa_required'` + 臨時 `2fa_token`（Scope 僅 `2fa:verify`）；未驗證前不得取得完整權杖 | ✅ | P0 |
| SEC-2FA-015 | 2FA 暴力嘗試限制 | 已綁定 | 連續輸入錯誤 TOTP 10 次 | 第 5 次後鎖定 / 退避；不得無限嘗試；寫入審計 | ✅ | P0 |
| SEC-2FA-016 | 時鐘偏移處理 | 已綁定 | 將伺服器時間偏移 +90 秒 | 驗證失敗並回明確錯誤；不得放行；NTP 偏移告警 | ⚠️ | P1 |

#### 3.11.3 FIDO2 / WebAuthn

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-2FA-017 | WebAuthn 註冊 | 支援平台驗證器（Playwright CDP 虛擬驗證器） | 1. `POST /auth/webauthn/register/options` 2. 完成 `navigator.credentials.create()` 3. `POST /auth/webauthn/register/verify` | `200`；`webauthn_credentials` 新增 1 筆；`sign_count=0` | ✅ | P0 |
| SEC-2FA-018 | WebAuthn 登入 | 已註冊 | 完成 `navigator.credentials.get()` → 驗證 | `200`；`sign_count` 遞增 | ✅ | P0 |
| SEC-2FA-019 | RP ID / Origin 不符拒絕 | 已註冊 | 以不同 origin（`https://evil.example.com`）發起 | `400`；拒絕；審計記錄 | ✅ | P0 |
| SEC-2FA-020 | sign_count 回退偵測 | 已註冊 | 重放舊 assertion（較小 `sign_count`） | `400`；視為克隆驗證器；可標記憑證為可疑 | ⚠️ | P1 |

#### 3.11.4 復原碼（Recovery Codes）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-2FA-021 | 10 組復原碼、僅顯示一次 | 完成綁定 | 1. 觀察綁定回應 2. 重新整理頁面 | 首次顯示 10 組；重新載入後 **不再顯示**；DB `recovery_codes_hash` 為 10 筆雜湊 | ✅ | P0 |
| SEC-2FA-022 | 復原碼僅存雜湊 | 同上 | 查詢 `recovery_codes_hash` | 每筆為 bcrypt/argon2 雜湊；**不得** 等於明文碼 | ✅ | P0 |
| SEC-2FA-023 | 復原碼單次使用 | 同上 | 以同一組復原碼登入 2 次 | 第 1 次成功；第 2 次 `400 invalid_recovery_code` | ✅ | P0 |
| SEC-2FA-024 | 復原碼使用後標記 | 同上 | 查詢該碼狀態 | 已標記 `used_at` 或自陣列移除；剩餘 9 組 | ✅ | P0 |
| SEC-2FA-025 | 復原碼錯誤不洩漏 | 同上 | 輸入不存在的復原碼 | 統一錯誤訊息；不提示「剩餘 N 組」給未驗證者 | ⚠️ | P1 |

#### 3.11.5 2FA 重設與管理

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-2FA-026 | super_admin 可重設他人 2FA | `U-SA2` 已綁定 | `POST /users/{U-SA2}/2fa/reset`（以 `U-BA`） | `200`；`two_factor_enabled=FALSE`；綁定資料清除；審計 `action='2fa.reset'` | ✅ | P0 |
| SEC-2FA-027 | 非 super_admin 不可重設 | `U-IM` | 同上 | `403`；未變更 | ✅ | P0 |
| SEC-2FA-028 | 重設後撤銷 Session | 同上 | 以 `U-SA2` 舊 Session 呼叫 API | `401`；需重新登入並重新綁定 | ✅ | P0 |
| SEC-2FA-029 | 2FA 綁定期間業務封鎖 | `U-IM` 未綁定且開關啟用 | 以受限權杖（`2fa:enroll`）呼叫 `GET /tickets` | `403` 或 `403`；不得回業務資料 | ✅ | P0 |
| SEC-2FA-030 | 2FA 狀態不可由使用者自行關閉（強制角色） | `U-SA2` 已綁定 | `PATCH /users/me` body `{"two_factor_enabled": false}` | `403`（強制角色不可自行停用）；或需 super_admin 重設 | ✅ | P0 |

---

## 4. 外部廠商 IDOR 越權讀取工單防護（SEC-IDOR）

> **對應需求**：PRD §FR-4.1（RBAC 可見範圍、物件層級授權、`404` 策略）、AC-RBAC-01、AC-RBAC-02、§11 風險（外部廠商越權）。
> **攻擊者模型**：已合法登入的 `vendor`（`U-VD1`）或廠商 API Token（`T-VD`），嘗試以 ID 枚舉、參數竄改、路徑變形讀取 **非指派** 工單。

### 4.1 單筆工單讀取（GET /tickets/{id}）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-IDOR-001 | 廠商讀取被指派工單（正向） | `U-VD1` 被指派 `TCK-A` | `GET /api/v1/tickets/{TCK-A}` | `200`；回傳 `TCK-A` | ✅ | P0 |
| SEC-IDOR-002 | 廠商讀取 Watcher 工單（正向） | `U-VD2` 為 `TCK-B` Watcher | `GET /tickets/{TCK-B}` | `200` | ✅ | P0 |
| SEC-IDOR-003 | 廠商讀取非關聯工單（負向） | `U-VD1` 與 `TCK-C` 無關 | `GET /tickets/{TCK-C}` | **`404 not_found`**（**不得** `403`）；body 為 RFC 7807；**不得** 洩漏 `TCK-C` 任何欄位 | ✅ | P0 |
| SEC-IDOR-004 | 錯誤碼一致性（存在 vs 不存在） | — | 1. `GET /tickets/{TCK-C}`（存在但無權）2. `GET /tickets/99999999`（不存在） | 兩者 HTTP 碼、`title`、`detail` 結構 **完全一致**；回應時間差異 ≤ 50ms | ✅ | P0 |
| SEC-IDOR-005 | 以工單編號枚舉 | `U-VD1` | 連續請求 `TCK-2026-000001` ~ `TCK-2026-000050` | 僅被指派/關聯者 `200`；其餘全 `404`；**不得** 出現 `403` 或 `500` | ✅ | P0 |
| SEC-IDOR-006 | 以內部 ID 枚舉 | 同上 | 連續請求 `id=1..50` | 同上；無速率限制繞過（超過閾值 `429`） | ✅ | P0 |
| SEC-IDOR-007 | 路徑變形繞過 | 同上 | 嘗試 `/tickets/{TCK-C}/`、`/tickets//{TCK-C}`、`/tickets/{TCK-C}?id={TCK-A}`、`/tickets/%7B...%7D`、大小寫變形 | 全部 `404` 或 `400`；**不得** 回 `200` | ✅ | P0 |
| SEC-IDOR-008 | HTTP 方法變形 | 同上 | `POST /tickets/{TCK-C}`、`PUT`、`HEAD`、`OPTIONS` | `404` / `405`；不得洩漏存在性 | ✅ | P0 |
| SEC-IDOR-009 | 巢狀資源越權 | `U-VD1` | `GET /tickets/{TCK-C}/threads`、`/tickets/{TCK-C}/attachments` | `404`；不得回傳任何 thread/附件 | ✅ | P0 |
| SEC-IDOR-010 | 查詢層授權驗證（SQL 層） | 同上 | 以 `EXPLAIN` 或查詢日誌檢視 `GET /tickets` 產生的 SQL | 必須含 `assignee_id = :uid OR EXISTS (SELECT 1 FROM ticket_watchers ...)` 條件；**禁止** 先全量查詢再於應用層過濾 | ⚠️ | P0 |

### 4.2 列表 / 搜尋 / 篩選洩漏

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-IDOR-011 | 列表僅回可見工單 | `U-VD1` | `GET /tickets?per_page=100` | 僅含 `TCK-A`、`TCK-D`、`TCK-E`（被指派）；**不含** `TCK-B`、`TCK-C`、`TCK-F`、`TCK-G`、`TCK-H` | ✅ | P0 |
| SEC-IDOR-012 | `total` 筆數不洩漏 | 同上 | 檢視 `meta.total` | 等於可見筆數（3），**非** 全庫筆數 | ✅ | P0 |
| SEC-IDOR-013 | 篩選參數不擴大範圍 | 同上 | `GET /tickets?assignee_id={U-AG2}`、`?team_id={TeamB}`、`?status=open&per_page=100` | 仍僅回可見集合；`assignee_id` 篩選 **不得** 覆蓋授權條件（授權為 AND，非 OR） | ✅ | P0 |
| SEC-IDOR-014 | Tag 篩選不洩漏 | 同上 | `GET /tickets?tags=vendor-a&tags_mode=any` | 僅回可見且帶該 Tag 者；不得因 Tag 查詢繞過授權 | ✅ | P0 |
| SEC-IDOR-015 | 自訂欄位篩選不洩漏 | 同上 | `GET /tickets?custom_fields[affected_host]=EDR-0421` | 僅回可見集合；`internal` 欄位篩選對 vendor 回 `403` 或忽略 | ✅ | P0 |
| SEC-IDOR-016 | 排序欄位注入 | 同上 | `?sort=created_at;DROP TABLE tickets--`、`?sort=(SELECT pg_sleep(5))` | `400 validation_error`；無 SQL 執行；無延遲 ≥ 5 秒 | ✅ | P0 |
| SEC-IDOR-017 | 分頁遍歷不越界 | 同上 | 遍歷 `page=1..20` | 每頁皆僅含可見工單；總和不超過可見筆數 | ✅ | P0 |
| SEC-IDOR-018 | 匯出端點越權 | `U-VD1` | `GET /reports/tickets?format=csv` | 僅匯出可見工單；筆數與列表一致；**不得** 匯出 `TCK-C` | ✅ | P0 |
| SEC-IDOR-019 | 大量匯出非同步任務隔離 | 同上 | 觸發非同步匯出 → 取得下載連結 | 連結綁定使用者/Token；他人使用該連結 `403/404`；有效期 ≤ 24 小時 | ⚠️ | P1 |
| SEC-IDOR-024 | 團隊可見範圍 | 工程師屬於兩個團隊、另一位只屬於其中一個（`tests/teams.test.ts`） | 讀取兩個團隊的工單；把成員移出團隊後再讀 | 兩個團隊的工單都看得到；非成員 `404`、清單不含；移出後下一個請求即 `404` | ✅ | P0 |
| SEC-IDOR-025 | 團隊不開放給廠商與一般使用者 | `vendor`、`end_user` 被加入團隊 | 讀取該團隊未指派給他們的工單與清單 | `404`；清單不含（只看被指派、自己開立、被關注的） | ✅ | P0 |

### 4.3 對話串與內部備忘隔離（AC-RBAC-02）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-IDOR-020 | 內部備忘不可見（API） | `TCK-D` 含 `internal_note`，`U-VD1` 被指派 | `GET /tickets/{TCK-D}` | `200`；`threads` **不含** `type='internal_note'` 或 `visibility='internal'` 之項目 | ✅ | P0 |
| SEC-IDOR-021 | 內部備忘不可見（UI） | 同上 | Playwright 開啟 `TCK-D` | 畫面無內部備忘內容；DOM 不含該文字 | ✅ | P0 |
| SEC-IDOR-022 | 直接以 thread id 讀取 | 取得 `internal_note` 的 thread id（由管理員查得） | `GET /threads/{internal_thread_id}` | `404`；不得回傳內容 | ✅ | P0 |
| SEC-IDOR-023 | 以舊格式新增內部備忘 | 任何角色 | `POST /tickets/{TCK-A}/threads` body `{"type":"internal_note","body":"..."}` | `400`（D12 起不再接受內部備忘）；不得建立，也不得當成公開回覆 | ✅ | P0 |
| SEC-IDOR-024 | 回覆可見性強制 | 同上 | `POST .../threads` body `{"type":"agent_reply","visibility":"internal"}` | `403` 或自動降級為 `public`；不得產生內部可見項目 | ✅ | P0 |
| SEC-IDOR-025 | 通知內容不含內部備忘 | 觸發 `ticket.assigned` 給 `U-VD1` | 檢視 Mailpit / Telegram 測試訊息 | 訊息不含 `internal_note` 內容；不含 `visibility=internal` 欄位 | ✅ | P0 |
| SEC-IDOR-026 | 附件下載越權 | `TCK-C` 有附件 | `GET /attachments/{id}/download`（`U-VD1`） | `404`；不得回 `302` 預簽 URL | ✅ | P0 |

### 4.4 寫入 / 狀態變更越權

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-IDOR-027 | 廠商不可改非指派工單 | `U-VD1` | `PATCH /tickets/{TCK-C}` body `{"status":"closed"}` | `404`；`TCK-C` 狀態不變 | ✅ | P0 |
| SEC-IDOR-028 | 廠商不可改指派對象 | `U-VD1` 對 `TCK-A` | `PATCH /tickets/{TCK-A}` body `{"assignee_id": {U-VD2}}` | `403`（vendor 無 `ticket:assign`）；指派不變 | ✅ | P0 |
| SEC-IDOR-029 | 廠商不可提升優先級 | 同上 | `PATCH ... {"priority":5}` | `403`；優先級不變 | ✅ | P0 |
| SEC-IDOR-030 | 廠商不可刪除工單 | 同上 | `DELETE /tickets/{TCK-A}` | `403` / `405`；工單仍存在 | ✅ | P0 |
| SEC-IDOR-031 | Watcher 移除後立即失權 | `U-VD2` 為 `TCK-B` Watcher | 1. 管理員移除 Watcher 2. `U-VD2` 於 5 秒內 `GET /tickets/{TCK-B}` | `404`；權限快取失效 ≤ 5 秒 | ✅ | P0 |
| SEC-IDOR-032 | 轉派後權限同步 | `TCK-A` 由 `U-VD1` 轉派給 `U-VD2` | 1. 轉派 2. `U-VD1` 讀取 `TCK-A` | `404`（原廠商失權）；`U-VD2` `200` | ✅ | P0 |
| SEC-IDOR-033 | API Token Scope 越權 | `T-VD`（Scope 僅 `ticket:read:own`） | `GET /users`、`GET /reports/tickets`、`POST /tickets` | `403 forbidden`（Scope 不足）；不得回資料 | ✅ | P0 |
| SEC-IDOR-034 | API Token 讀取他人工單 | `T-VD` | `GET /tickets/{TCK-C}` | `404`（與使用者路徑一致） | ✅ | P0 |
| SEC-IDOR-035 | 越權嘗試寫入審計 | 完成 SEC-IDOR-003 | 查詢 `audit_logs` | 記錄 `action='ticket.read.denied'`（或等價）；含 `actor`、`target_id`、`ip`、`result='denied'` | ⚠️ | P1 |
| SEC-IDOR-036 | 回應快取不跨使用者 | 1. `U-AG1` 請求 `TCK-C`（200）2. `U-VD1` 請求同一 URL | `U-VD1` 回 `404`；回應 `Cache-Control: no-store` / `Vary: Authorization` | ⚠️ | P1 |
| SEC-IDOR-037 | 錯誤訊息不洩漏內部結構 | 觸發 `404` | 檢查 body | 不含 SQL、堆疊、資料表名稱、內部 ID 格式；僅 RFC 7807 標準欄位 | ✅ | P0 |
| SEC-IDOR-038 | 大量枚舉觸發速率限制 | `U-VD1` | 1 分鐘內請求 200 個不同 ID | 超過閾值回 `429` + `Retry-After`；不因枚舉而洩漏存在性 | ✅ | P0 |

---

## 5. 外部 SOC API：Rate Limiting 與資料過濾

> **對應需求**：PRD §FR-2.9（速率限制 60 req/min、`429` + `Retry-After`、冪等）、AC-API-01、AC-API-02、§FR-3.4（>3 天未結案精確篩選）、AC-REPORT-01。

### 5.1 Rate Limiting（API-RL）

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| API-RL-001 | 預設限制 60 req/min | `T-SOC`（預設額度） | 1 分鐘內發送 60 次 `GET /tickets` | 前 60 次 `200`；第 61 次 `429` | ✅ | P0 |
| API-RL-002 | `429` 附 `Retry-After` | 同上 | 檢視第 61 次回應 | `Retry-After` 為整數秒（1~60）；body 為 RFC 7807 `type=.../rate_limited` | ✅ | P0 |
| API-RL-003 | 邊界值 59 / 60 / 61 | 重置計數器 | 依序發送 59、60、61 次 | 59 → `200`；60 → `200`；61 → `429`（不得提前封鎖） | ✅ | P0 |
| API-RL-004 | 視窗重置後恢復 | 已觸發 `429` | 等待 `Retry-After` 秒後再請求 | `200`；計數器重置 | ✅ | P0 |
| API-RL-005 | 速率限制標頭 | — | 檢視 `200` 回應 headers | 含 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`（或 `RateLimit-*` 標準）；數值遞減正確 | ✅ | P0 |
| API-RL-006 | 不同 Token 獨立計數 | `T-SOC`、`T-VD` | `T-SOC` 用盡額度後，以 `T-VD` 請求 | `T-VD` 仍 `200`（限制以 Token 為鍵） | ✅ | P0 |
| API-RL-007 | 不同端點共享或分開計算 | `T-SOC` | 交替請求 `GET /tickets` 與 `POST /tickets` | 依設計（文件需載明）；若共享則合計 60 次後 `429`；若分開則各自 60 次 | ⚠️ | P1 |
| API-RL-008 | 分散式一致性（多實例） | 2 個 App 實例 + Redis | 交替向 instance-1 / instance-2 發送 70 次 | 合計第 61 次 `429`（Redis 共享計數）；不得各自放行 60 次 | ✅ | P0 |
| API-RL-009 | D1 軌道一致性 | `qa-cf` | 同上（Workers + KV/D1） | 合計第 61 次 `429` | ✅ | P0 |
| API-RL-010 | `X-Forwarded-For` 偽造不繞過 | `T-SOC` | 每次請求更換 `X-Forwarded-For` | 仍以 Token 為鍵計數；第 61 次 `429` | ✅ | P0 |
| API-RL-011 | Bearer 大小寫 / 空白變形 | 同上 | `authorization: bearer <token>`、`Bearer  <token>`（雙空白）、`Bearer <token> ` | 依 RFC 7235 正規化後仍計入同一 Token；不得因格式差異重置計數 | ✅ | P0 |
| API-RL-012 | 無效 Token 不消耗他人額度 | — | 以隨機 Token 發送 100 次 | 全部 `401`；`T-SOC` 額度不受影響 | ✅ | P0 |
| API-RL-013 | 併發突發（burst） | `T-SOC` | 以 50 併發瞬間發送 100 次 | 允許額度內成功；超出部分 `429`；無 `500`；Redis 計數無競態（最終值正確） | ✅ | P0 |
| API-RL-014 | 100 RPS 壓測成功率 | `T-NOLIMIT`（高額度） | k6 以 100 RPS 持續 5 分鐘 `POST /tickets` | 成功率 ≥ **99.5%**；P95 ≤ 300ms；無 `5xx` 超過 0.5% | ✅ | P0 |
| API-RL-015 | 冪等 + 速率限制互動 | `T-SOC` | 同一 `Idempotency-Key` 重複 10 次（在額度內） | 第 1 次 `201`；其餘 `200`（回原工單）；**每次仍計入速率額度**（避免以冪等繞過限制） | ✅ | P0 |
| API-RL-016 | 超限不建立工單 | `T-SOC` 已超限 | 發送 `POST /tickets` | `429`；DB `tickets` 筆數不增加 | ✅ | P0 |
| API-RL-017 | 超限寫入審計 / 指標 | 同上 | 查詢 `audit_logs` / `/metrics` | 記錄 `api.rate_limited`（含 token_id、path）；`rate_limit_hits_total` 遞增 | ⚠️ | P1 |
| API-RL-018 | 登入端點與 API 限制分離 | — | 同時對 `/auth/login` 與 `/tickets` 施壓 | 兩者獨立計數；登入限制不因 API 額度而放寬 | ✅ | P1 |

### 5.2 資料過濾：「超過 3 天未結案」（API-FLT）

> **權威定義**（PRD §FR-3.4）：未結案 = `status NOT IN ('resolved','closed')`；超過 3 天 = `now() - created_at > 72 小時`（**嚴格大於**，恰好 72 小時 **不計入**）。

| ID | 標題 | 前置條件 | 步驟 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| API-FLT-001 | 預設篩選筆數正確 | 資料集 §0.3 | `GET /tickets?aging_gt_days=3&per_page=100` | 回傳 `TCK-A`、`TCK-B`、`TCK-C`、`TCK-D`、`TCK-G`；**不含** `TCK-E`（resolved）、`TCK-F`（恰好 72h）、`TCK-H`（closed） | ✅ | P0 |
| API-FLT-002 | 恰好 72 小時不計入（邊界） | `TCK-F` `created_at = now() - 72h` | 同上 | `TCK-F` **不在** 結果中（嚴格 `>`） | ✅ | P0 |
| API-FLT-003 | 72 小時 + 1 秒計入 | `TCK-G` | 同上 | `TCK-G` **在** 結果中 | ✅ | P0 |
| API-FLT-004 | 已結案排除 | `TCK-E`（resolved）、`TCK-H`（closed） | 同上 | 兩者皆不在結果 | ✅ | P0 |
| API-FLT-005 | `aging_basis=created_at`（預設） | — | 同上 | 依 `created_at` 計算 | ✅ | P0 |
| API-FLT-006 | `aging_basis=last_updated_at` | 將 `TCK-C.updated_at` 設為 now−1h | `?aging_gt_days=3&aging_basis=last_updated_at` | `TCK-C` **不在** 結果（因 `updated_at` 新）；`TCK-A` 等仍在 | ✅ | P0 |
| API-FLT-007 | 非法 `aging_basis` 值 | — | `?aging_basis=foo` | `400 validation_error` | ✅ | P0 |
| API-FLT-008 | 非法 `aging_gt_days` | — | `?aging_gt_days=0`、`?aging_gt_days=-1`、`?aging_gt_days=abc` | 全部 `400` | ✅ | P0 |
| API-FLT-009 | 自訂門檻 1/7/14/30 | 資料集 | 分別查詢 `aging_gt_days=1,7,14,30` | 筆數與基準 SQL 完全一致（見 §10.2） | ✅ | P0 |
| API-FLT-010 | 與狀態篩選組合 | — | `?aging_gt_days=3&status=open` | 僅 `TCK-A`、`TCK-B`、`TCK-C`、`TCK-G`（`TCK-D` 為 `pending_user` 被排除） | ✅ | P0 |
| API-FLT-011 | 與優先級 / Tag 組合 | — | `?aging_gt_days=3&priority=5`、`?aging_gt_days=3&tags=p1` | 結果為交集；筆數與基準 SQL 一致 | ✅ | P0 |
| API-FLT-012 | 分頁總數一致 | — | `?aging_gt_days=3&per_page=2` 遍歷所有頁 | 各頁筆數合計 = `meta.total` = 基準 SQL 筆數 | ✅ | P0 |
| API-FLT-013 | 排序穩定（無重複/遺漏） | — | `?aging_gt_days=3&sort=created_at&per_page=2` 遍歷 | 無重複、無遺漏；`created_at` 相同時以 `id` 決勝（穩定排序） | ✅ | P0 |
| API-FLT-014 | 匯出筆數 = 畫面筆數 | — | 1. 列表查詢（JSON）2. `GET /reports/tickets?aging_gt_days=3&format=csv` | CSV 資料列數 = JSON `meta.total`；欄位值一致 | ✅ | P0 |
| API-FLT-015 | Dashboard 積壓數 = 列表數 | — | 1. 讀取 Dashboard Widget「超過 3 天未結案」2. 點擊下鑽 | 數字與列表 `meta.total` **完全一致**（共用同一 Service 方法） | ✅ | P0 |
| API-FLT-016 | 排程報表筆數一致 | Cron 觸發（或手動） | 檢視 09:00 寄送之積壓清單 | 筆數與列表一致；收件者為 `it_manager` | ⚠️ | P1 |
| API-FLT-017 | 時區一致性 | 租戶時區 `Asia/Taipei` | 建立 `created_at` 為 UTC 邊界值（如 `2026-02-15T00:00:00Z`）之工單 | 篩選結果與基準 SQL（UTC 比較）一致；不得因本地時區換算偏移 8 小時 | ✅ | P0 |
| API-FLT-018 | 夏令時間 / 閏年邊界 | 租戶時區含 DST | 建立 DST 切換前後之工單 | 以 UTC 儲存與比較；結果與基準 SQL 一致 | ⚠️ | P1 |
| API-FLT-019 | 敏感欄位遮罩 | `T-SOC`（`api_client`） | `GET /tickets?aging_gt_days=3` | 回應不含 `internal_note`；電話/身分證號依角色遮罩（如 `0912***678`、`A12****789`） | ✅ | P0 |
| API-FLT-020 | `internal` 自訂欄位不可見 | `T-SOC` | 檢視回應 `custom_fields` | 不含 `visibility=internal` / `agent_only` 欄位（如 `internal_ref`、`asset_id`） | ✅ | P0 |
| API-FLT-021 | 篩選參數注入 | — | `?aging_gt_days=3;DROP TABLE tickets--`、`?status=open' OR '1'='1` | `400`；無 SQL 執行；DB 完好 | ✅ | P0 |
| API-FLT-022 | 大量資料效能 | `qa-perf`（10 萬筆） | `GET /tickets?aging_gt_days=3&per_page=25` | P95 ≤ 500ms；查詢計畫使用 `idx_tickets_status_created`（`EXPLAIN` 驗證，無 Seq Scan） | ✅ | P0 |

---

## 6. 系統回歸測試矩陣（REG）

> **目的**：確保 v1.0.0 全 P0 需求在每次變更後不被破壞。**每次 Release Candidate 必跑**；Hotfix 至少跑 Smoke 子集。

### 6.1 回歸套件分層

| 套件 | 內容 | 執行時機 | 預估時間 | 自動化 |
| --- | --- | --- | --- | --- |
| **SMOKE** | 登入 → 改密 → 2FA → 開單 → 列表 → 登出（Docker + CF 各一輪） | 每次 PR / 每日 | 15 分鐘 | ✅ |
| **CORE** | 認證、工單核心、SLA、報表、RBAC、通知 | 每次 RC | 3 小時 | ✅ |
| **FULL** | CORE + 相容性 + 效能 + 安全掃描 | 發佈前 | 1 個工作日 | ⚠️ 混合 |

### 6.2 認證與授權回歸（REG-AUTH / REG-RBAC）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-AUTH-001 | 本地帳號登入/登出 | AC-AUTH-01 | 登入 → 登出 → 重登 | 成功；Session 正確撤銷 | ✅ | P0 |
| REG-AUTH-002 | LDAP 登入 | AC-AUTH-01 | 以 OpenLDAP 帳號登入 | `200`；角色依群組映射 | ✅ | P0 |
| REG-AUTH-003 | LDAP 停用帳號拒絕 | AC-AUTH-01 | 停用帳號登入 | `401`；審計記錄 | ✅ | P0 |
| REG-AUTH-004 | SAML SP-initiated | AC-AUTH-02 | 發起登入 → IdP 斷言 | `200`；`NameID` 映射正確 | ✅ | P0 |
| REG-AUTH-005 | SAML IdP-initiated | AC-AUTH-02 | 由 IdP 發起 POST 至 ACS | `200`；重放防護生效 | ✅ | P0 |
| REG-AUTH-006 | SAML 過期斷言拒絕 | AC-AUTH-02 | 使用 `NotOnOrAfter` 過期之斷言 | `401`；審計 `auth.saml.invalid` | ✅ | P0 |
| REG-AUTH-007 | OIDC Code + PKCE | AC-AUTH-02 | 完成授權碼流程 | `200`；`id_token` 驗證通過 | ✅ | P0 |
| REG-AUTH-008 | OIDC 偽造 token 拒絕 | AC-AUTH-02 | 以錯誤簽章 / `alg=none` | `401`；審計 | ✅ | P0 |
| REG-AUTH-009 | SCIM 建立使用者 | AC-AUTH-03 | `POST /scim/v2/Users` | `201`；使用者可登入 | ✅ | P0 |
| REG-AUTH-010 | SCIM 停用即時失效 | AC-AUTH-03 | `PATCH active=false` → 既有 Session 呼叫 API | `401`（≤ 5 秒） | ✅ | P0 |
| REG-AUTH-011 | 登出所有裝置 | FR-1.5 | 登入 2 裝置 → 登出所有 | 兩裝置皆 `401` | ✅ | P0 |
| REG-AUTH-012 | 角色變更撤銷 Session | FR-1.5 | 變更角色 → 舊 Session 呼叫 API | `401` | ✅ | P0 |
| REG-RBAC-001 | super_admin 全功能 | AC-RBAC-01 | 存取使用者管理、設定、全工單 | 全部 `200` | ✅ | P0 |
| REG-RBAC-002 | it_manager 唯讀 + 指派 | AC-RBAC-01 | 嘗試修改系統設定 | `403`；指派成功 | ✅ | P0 |
| REG-RBAC-003 | agent 團隊佇列可見 | AC-RBAC-01 | `U-AG1` 查詢列表 | 僅 Team A + 被指派 + Watcher | ✅ | P0 |
| REG-RBAC-004 | vendor 可見範圍 | AC-RBAC-01 | 見 §4 | 僅被指派/關聯；其餘 `404` | ✅ | P0 |
| REG-RBAC-005 | end_user 可見範圍 | AC-RBAC-01 | `U-EU2` 查詢 | 僅自身請求或關聯 | ✅ | P0 |
| REG-RBAC-006 | 內部備忘隔離 | AC-RBAC-02 | vendor/end_user 讀取含內部備忘工單 | 不可見 | ✅ | P0 |
| REG-RBAC-007 | 權限快取失效 ≤ 5 秒 | FR-4.1 | 變更權限 → 5 秒內重試 | 新權限生效 | ⚠️ | P1 |

### 6.3 工單核心回歸（REG-TICKET）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-TICKET-001 | 依 Help Topic 載入表單與 SLA | AC-TICKET-02 | 選擇 `security-incident` 開單 | 表單欄位與 SLA 正確 | ✅ | P0 |
| REG-TICKET-002 | 停用 Topic 不可選 | AC-TICKET-02 | 停用 Topic → 開單頁 | 選項消失；API 回 `400` | ✅ | P0 |
| REG-TICKET-003 | 12 種自訂欄位型別 | AC-TICKET-01 | 逐一建立/驗證/儲存/查詢 | 全部成功；驗證規則生效 | ✅ | P0 |
| REG-TICKET-004 | 自訂欄位軟刪除 | AC-TICKET-01 | 刪除欄位 → 查詢歷史工單 | `is_active=false`；歷史值仍可讀 | ✅ | P0 |
| REG-TICKET-005 | 狀態機合法轉移 | FR-2.8 | `new→open→pending_user→open→resolved→closed` | 全部 `200` | ✅ | P0 |
| REG-TICKET-006 | 非法狀態轉移 | FR-2.8 | `closed→new`、`new→resolved` | `409 Conflict` | ✅ | P0 |
| REG-TICKET-007 | Reopen 計數 | FR-2.8 | `resolved→open` | `reopen_count` +1 | ✅ | P0 |
| REG-TICKET-008 | Thread 類型與可見性 | AC-TICKET-04 | 回覆、系統事件、既有內部備忘 | 新回覆為 `public`；既有內部備忘隔離 | ✅ | P0 |
| REG-TICKET-009 | Email 執行緒歸併 | AC-TICKET-04 | 寄送主旨含 `[#TCK-...]` 之郵件 | 歸併至原工單；不建立新單 | ⚠️ | P1 |
| REG-TICKET-010 | Canned Response 變數插值 | AC-TICKET-05 | 插入範本 | `%{ticket.number}` 等正確替換 | ✅ | P0 |
| REG-TICKET-011 | Tag any/all 篩選 | AC-TICKET-06 | `tags=a,b&tags_mode=any/all` | 結果符合集合語意 | ✅ | P0 |
| REG-TICKET-012 | 優先級 1~5 驗證 | AC-TICKET-07 | `priority=0,6,abc` | `400` | ✅ | P0 |
| REG-TICKET-013 | 優先級語意別名 | FR-2.7 | `priority="critical"` | 映射為 5 | ✅ | P0 |
| REG-TICKET-014 | 附件型別白名單 | FR-1.7 | 上傳 `.exe` | `400`；不儲存 | ✅ | P0 |
| REG-TICKET-015 | 附件病毒掃描狀態 | FR-1.7 | 上傳測試惡意樣本 | `scan_status='infected'`；不可下載 | ⚠️ | P1 |
| REG-TICKET-016 | 新增工單時指派 | FR-2.10 | 系統管理員開單並指定工程師；一般使用者帶 `assigneeId`；指派給一般使用者 | 工單為 `open`、負責人正確並通知負責人；一般使用者 `403`；不可指派的對象 `400` | ✅ | P1 |
| REG-TICKET-017 | 回覆的通知勾選 | AC-TICKET-04 | 回覆 `notify:false`，再以預設值回覆 | 第一則不產生任何通知；第二則通知申請人且只含該則內容 | ✅ | P0 |
| REG-TICKET-018 | 建立時指定團隊、認領 | FR-2.11 | `POST /tickets` 帶 `teamId`；成員 `PATCH {assigneeId: 自己}`；e2e「我來處理」 | 只有團隊時維持「新建立」；一般使用者 403、不存在的團隊 400；認領後負責人為自己、狀態「處理中」 | ✅ | P1 |
| REG-TICKET-019 | 依團隊篩選 | FR-2.11 | `GET /tickets?teamId=mine`；e2e 清單「團隊」篩選 | 只回傳自己任一團隊的工單；沒有團隊時為空 | ✅ | P1 |
| REG-TICKET-020 | 團隊成員回填與移除 `users.team_id` | FR-2.11 | `tests/teams.test.ts` 的 upgrade 測試：0002 結構放入舊資料 → 套用其餘 migration | v0.4 資料寫入 `team_members`；v0.5／v0.6 已移出的成員不會加回；欄位與旗標已刪除 | ✅ | P1 |
| REG-TICKET-021 | 團隊頁管理成員 | FR-2.12 | `tests/teams.test.ts`（team members on the teams page）；`scripts/ui-e2e.sh`：展開團隊、加入、移除 | 成員狀態正確、候選名單正確、可見範圍立即反映、權限 403、稽核紀錄；畫面成員數同步 | ✅ | P1 |

### 6.4 SLA 回歸（REG-SLA）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-SLA-001 | 首次回應期限計算 | AC-TICKET-03 | 建立 Level 5 工單 | `first_response_due_at = created_at + 60min`（24x7） | ✅ | P0 |
| REG-SLA-002 | 營業時間計算 | AC-TICKET-03 | 非 24x7 SLA，於週五 18:00 開單 | 期限落在下一個工作日（排除週末/假日） | ✅ | P0 |
| REG-SLA-003 | 逾時標記 overdue | AC-TICKET-03 | 將 `resolution_due_at` 回填為過去 → 執行 SLA 掃描 | `sla_status='overdue'`；通知發送 | ✅ | P0 |
| REG-SLA-004 | at_risk 判定 | FR-2.3 | 期限前 20% 時間 | `sla_status='at_risk'`；通知 | ✅ | P0 |
| REG-SLA-005 | pending_user 暫停計時 | FR-2.3 | 轉 `pending_user` → 等待 → 轉回 `open` | 暫停期間不計入 SLA；期限順延 | ✅ | P0 |
| REG-SLA-006 | 自動升級 | FR-2.3 | 逾時且設定 escalation | 指派/通知 `it_manager` | ⚠️ | P1 |
| REG-SLA-007 | 自動結案（7 天） | FR-2.8 | `resolved_at` 回填 −8 天 → 執行排程 | 狀態轉 `closed` | ✅ | P0 |

### 6.5 報表與匯出回歸（REG-REPORT）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-REPORT-001 | 7 種自訂欄位運算子 | AC-REPORT-02 | `equals/not_equals/contains/in/between/is_empty/is_not_empty` | 結果與基準 SQL 一致 | ✅ | P0 |
| REG-REPORT-002 | `internal` 欄位僅管理角色 | AC-REPORT-02 | vendor 使用 `internal_ref` 篩選 | `403` 或忽略；不洩漏 | ✅ | P0 |
| REG-REPORT-003 | CSV UTF-8 BOM | AC-REPORT-03 | 匯出 CSV | 開頭含 BOM；Excel 正確顯示中文 | ✅ | P0 |
| REG-REPORT-004 | XLSX / PDF 匯出 | AC-REPORT-03 | 匯出兩種格式 | 檔案可開啟；筆數一致 | ⚠️ | P1 |
| REG-REPORT-005 | 匯出寫入審計 | AC-REPORT-03 | 匯出後查詢 `audit_logs` | `action='report.exported'`；含格式、筆數、篩選條件 | ✅ | P0 |
| REG-REPORT-006 | 非同步匯出連結有效期 | FR-3.2 | 取得連結 → 25 小時後重試 | `410 Gone` | ⚠️ | P1 |
| REG-REPORT-007 | Dashboard 9 項 Widget | FR-3.1 | 載入 Dashboard | 9 項皆顯示且資料非空 | ⚠️ | P1 |
| REG-REPORT-008 | 排程報表 09:00 | FR-3.4 | 檢視 Cron 執行 | 寄送給 `it_manager`；筆數一致 | ⚠️ | P1 |
| REG-REPORT-009 | 儀表板 30 天趨勢 | AC-REPORT-04 | `ctx.clock` 固定時間，在台北／洛杉磯時區的午夜前後建立、解決工單 | `trend30d` 固定 30 筆、日期連續、空白日為 0，各日數字依 `config.timezone` 切日；真實 PostgreSQL 亦通過 | ✅ | P0 |
| REG-REPORT-010 | 未結案天數分組 | AC-REPORT-05 | 建立剛好 24h／72h／7d／14d 與多 1 秒的未結案工單 | 剛好 72h 屬 `1-3`；`3-7`+`7-14`+`14+` = `olderThan3Days` = `olderThanDays=3` 清單筆數 | ✅ | P0 |
| REG-REPORT-011 | 儀表板可見範圍 | AC-REPORT-06 | 工程師（團隊成員）、廠商、一般使用者各自讀取儀表板 | 只統計自己看得到的工單；廠商與一般使用者的 `workload`／`byTeam` 為 `null` | ✅ | P0 |
| REG-REPORT-012 | 工程師負載與各團隊 | AC-REPORT-06 | 12 位工程師、未指派與沒有團隊的工單 | `workload` 前 10 名由多到少另加「未指派」；`byTeam` 含「沒有團隊」；數字與 `assignee`／`teamId` 篩選筆數一致 | ✅ | P1 |
| REG-REPORT-013 | 儀表板圖表 UI | AC-REPORT-07~08 | e2e：開儀表板、點環形圖圖例的狀態與 tag cloud 的標籤；375px 淺色／深色截圖 | 圖表以 `role="img"` 的 `aria-label` 找到；進入清單且篩選已套用；沒有水平捲軸 | ✅ | P1 |

### 6.6 通知回歸（REG-NOTIFY）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-NOTIFY-001 | Email 送達 | AC-NOTIFY-01 | 觸發 `ticket.assigned` | Mailpit 收到；`notification_logs.status='sent'` | ✅ | P0 |
| REG-NOTIFY-002 | Telegram 送達 | AC-NOTIFY-01 | 同上 | 測試群組收到；含 Topic | ✅ | P0 |
| REG-NOTIFY-003 | Teams 送達 | AC-NOTIFY-01 | 同上 | 測試頻道收到 Adaptive Card | ✅ | P0 |
| REG-NOTIFY-004 | 失敗重試 3 次 | AC-NOTIFY-01 | 停用 SMTP → 觸發 | `attempts=3`；`status='failed'`；`last_error` 有值 | ✅ | P0 |
| REG-NOTIFY-005 | 冪等去重 | AC-NOTIFY-02 | 同一 `event_id` 重送 | 僅 1 筆 `sent`；其餘 `skipped_duplicate` | ✅ | P0 |
| REG-NOTIFY-006 | 內容不含其他回覆 | AC-NOTIFY-02 | 先回覆 `notify:false`，再回覆並通知 | 通知只含該則回覆，不含未通知的回覆 | ✅ | P0 |
| REG-NOTIFY-007 | 連續失敗 5 次告警 | FR-4.2 | 模擬 Teams 連續失敗 | 觸發 `notification.failed_alert` 給管理員 | ⚠️ | P1 |
| REG-NOTIFY-008 | 重送 API | FR-4.2 | `POST /notifications/{id}/resend` | 新 `event_id`；重新入佇列 | ✅ | P1 |
| REG-NOTIFY-009 | 郵件設定權限與秘密 | AC-MAIL-02 | `tests/mailSettings.test.ts`：IT 主管讀取／儲存／測試寄信；儲存 SMTP 密碼後讀取、留空再儲存；換 `APP_SECRET` 讀取 | 非系統管理員 403；回應與稽核不含密碼／API Key，DB 為密文，留空保留原值；無法解密時回報需重新輸入且不寄信 | ✅ | P0 |
| REG-NOTIFY-010 | 切換寄信方式 | AC-MAIL-01 | 切到 `resend` 後 dispatch，再切回 `env`（假 `fetch`／假 SMTP） | 以正確 payload 呼叫 Resend；切回後改走 `SMTP_*`；不需重啟 | ✅ | P0 |
| REG-NOTIFY-011 | 測試寄信 | AC-MAIL-03 | 設定頁「寄送測試信」（`scripts/ui-e2e.sh`）；API 成功、失敗、第 6 次 | 頁面顯示成功或失敗原因（不含秘密）；同一分鐘第 6 次 429 | ✅ | P1 |
| REG-NOTIFY-012 | 指派給團隊的通知 | FR-2.11 | 建立或改團隊、沒有負責人（`tests/teams.test.ts`） | 通知團隊中啟用、具內部權限的成員，不含操作者、廠商、一般使用者、停用者；有負責人時不寄團隊通知 | ✅ | P0 |

### 6.7 多語系與主題回歸（REG-I18N / REG-THEME）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-I18N-001 | zh-TW / en-US 切換 | AC-I18N-01 | 切換語系 | 全站字串生效；無硬編碼殘留 | ✅ | P0 |
| REG-I18N-002 | 缺字回退 en-US | AC-I18N-01 | 刪除某 zh-TW key | 顯示 en-US 值；不顯示原始 key | ✅ | P0 |
| REG-I18N-003 | 新增 ja-JP 無需重編譯 | AC-I18N-02 | 匯入字典檔 | 語系可選；字串生效 | ⚠️ | P1 |
| REG-THEME-001 | Light/Dark/System 切換 | AC-THEME-01 | 切換三模式 | 即時生效；偏好持久化 | ✅ | P0 |
| REG-THEME-002 | 無 FOUC | AC-THEME-01 | 重新載入頁面（Dark） | 無白閃；`data-theme` 於首屏前套用 | ⚠️ | P1 |
| REG-THEME-003 | WCAG AA 對比度 | AC-THEME-01 | axe-core 掃描 | 無 contrast 違規（≥ 4.5:1） | ✅ | P1 |
| REG-THEME-004 | 優先度 badge 色彩與對比 | AC-THEME-02 | 檢查 `palette.ts` 兩種主題的色票（`tests/styles.test.ts`） | L3 有獨立的 accent 樣式；L1／L2 為中性灰；所有 badge 在淺色與深色下對比 ≥ 4.5:1 | ✅ | P1 |
| REG-THEME-005 | 優先度 badge 目視確認 | AC-THEME-02 | `scripts/ui-e2e.sh` 截圖 | L1~L5 在兩種主題下可分辨、文字可讀 | ⚠️ | P2 |
| REG-THEME-006 | 資料色與側邊欄對比 | AC-THEME-05 | 檢查 `palette.ts`（`tests/styles.test.ts`） | 狀態 badge 互不同色且不同於 L3～L5；sticker 與 `--nav-*` 變數在兩種主題達 AA（非文字 3:1） | ✅ | P1 |
| REG-THEME-007 | Ant Design 主題 | AC-THEME-05 | 檢查 `antdTheme()` 的 token（`tests/styles.test.ts`）；`scripts/ui-e2e.sh` 走完主要流程 | antd 的主色、底色、文字、側邊欄色取自 `palette.ts`；兩種主題的主要按鈕文字 ≥ 4.5:1 | ✅ | P1 |
| REG-THEME-008 | 側邊欄下拉選單在淺色主題可讀 | AC-THEME-05 | `scripts/ui-e2e.sh`：淺色主題展開側邊欄「主題」選單 | 選項文字與選單底色對比 ≥ 4.5:1（截圖 `05e-sidebar-theme-menu-light`） | ✅ | P1 |
| REG-DASH-RWD-01 | 趨勢折線圖隨寬度縮放 | FR-3.5 | `scripts/ui-e2e.sh`：1360px 寬的儀表板 | 「新增與解決趨勢」圖寬度 ≥ 卡片內容寬度 90%；軸文字維持 11px | ✅ | P2 |
| REG-DASH-RANGE-01 | 儀表板統計期間 | AC-REPORT-08 | `tests/dashboard.test.ts`（period）；`scripts/ui-e2e.sh`：選「近 7 天」 | 網址帶 `from`/`to`、標題顯示期間、趨勢 7 點；「期間新增」下鑽後清單的建立日期篩選相同 | ✅ | P1 |
| REG-PERF-01 | 首頁載入大小 | FR-5（非功能） | `scripts/bundle-check.mjs`（`npm run validate`） | 首頁 JS ≤ 300 KB（gzip）；首頁不含只在管理頁使用的程式碼 | ✅ | P2 |
| REG-BRAND-001 | 企業標誌權限與檔案檢查 | AC-BRAND-01 | `tests/branding.test.ts`：IT 主管上傳／移除；上傳 SVG、超過 512 KB、截斷的 PNG、非 base64 | 非系統管理員 403；其餘皆 400 `invalid_logo`，資料表不變 | ✅ | P0 |
| REG-BRAND-002 | 企業標誌顯示 | AC-BRAND-01 | 系統設定上傳淺色標誌（`scripts/ui-e2e.sh`），檢查側邊欄與未登入的登入頁；`tests/branding.test.ts` 讀取圖檔 | 側邊欄與登入頁顯示「公司標誌」圖片；未登入可讀取 `image/png`，帶版本的網址可長期快取、ETag 相符回 304 | ✅ | P1 |
| REG-BRAND-003 | 系統名稱 | AC-BRAND-01 | `tests/branding.test.ts`；`scripts/ui-e2e.sh` 上傳標誌後改名為「ACME 服務台」 | 預設 TicketDesk、未登入可讀；非系統管理員 403；空白、超過 40 字、含換行回 400；前後空白去除、寫入稽核；標誌旁仍有名稱，改名後側邊欄、登入頁、分頁標題立即更新 | ✅ | P1 |

### 6.8 雙軌佈署回歸（REG-DEPLOY）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-DEPLOY-001 | Docker 冷啟動 | AC-DEPLOY-01 | 空 Volume `docker compose up -d` | 3 分鐘內可登入；`/healthz` ok | ✅ | P0 |
| REG-DEPLOY-002 | Docker 種子冪等 | AC-DEPLOY-01 | 重啟容器 | 密碼未重置；count=1 | ✅ | P0 |
| REG-DEPLOY-003 | Docker 備份/還原 | FR-6.1 | `pg_dump` → `pg_restore` | 資料完整；可登入 | ⚠️ | P1 |
| REG-DEPLOY-004 | Cloudflare 部署 | AC-DEPLOY-02 | `wrangler deploy` | API 可用；`/healthz` ok | ✅ | P0 |
| REG-DEPLOY-005 | D1 migration | AC-DEPLOY-02 | `wrangler d1 migrations apply` | 無錯誤；資料表齊備 | ✅ | P0 |
| REG-DEPLOY-006 | Queues 通知 | AC-DEPLOY-02 | 觸發測試通知 | `notification_logs.status='sent'` | ✅ | P0 |
| REG-DEPLOY-007 | Cron Triggers | AC-DEPLOY-02 | 等待/手動觸發 | SLA 掃描與積壓報表執行 | ⚠️ | P1 |
| REG-DEPLOY-008 | 雙軌 API 契約一致 | FR-6.3 | 對兩軌執行 Schemathesis | 皆符合 `src/api_spec.json`；無 schema 偏差 | ✅ | P0 |

### 6.9 安全標頭與傳輸回歸（REG-SEC）

| ID | 標題 | 對應 AC | 步驟摘要 | 預期結果 | 自動化 | 優先級 |
| --- | --- | --- | --- | --- | --- | --- |
| REG-SEC-001 | HSTS | FR-1.7 | `curl -I` | `Strict-Transport-Security: max-age=31536000` | ✅ | P0 |
| REG-SEC-002 | CSP | DEP §6.3 | 檢視標頭 | 含 `default-src 'self'`、`frame-ancestors 'none'` | ✅ | P0 |
| REG-SEC-003 | X-Content-Type-Options / X-Frame-Options | DEP §6.3 | 檢視標頭 | `nosniff` / `DENY` | ✅ | P0 |
| REG-SEC-004 | TLS 版本 | FR-1.7 | `nmap --script ssl-enum-ciphers` | 僅 TLS 1.2 / 1.3；無 SSLv3/TLS1.0/1.1 | ✅ | P0 |
| REG-SEC-005 | Cookie 屬性 | FR-1.5 | 檢視 `Set-Cookie` | `HttpOnly`、`Secure`、`SameSite=Lax` | ✅ | P0 |
| REG-SEC-006 | API 回應 `no-store` | DEP §6.3 | 檢視敏感 API | `Cache-Control: no-store` | ✅ | P0 |
| REG-SEC-007 | 錯誤不洩漏堆疊 | FR-2.9 | 觸發 `500` | 僅 `trace_id`；無堆疊/SQL | ✅ | P0 |
| REG-SEC-008 | 明文密碼掃描 | DEP §6.2 | `gitleaks detect` | 零命中（除文件說明） | ✅ | P0 |

---

## 7. 自動化與 CI 管線設計

### 7.1 管線階段

```
[PR 觸發]
  ├─ 1. Lint & 型別檢查（eslint / tsc / spectral lint api_spec.json）
  ├─ 2. 單元測試（UT，含 aging 邊界與密碼政策 100% 分支）
  ├─ 3. 整合測試（Testcontainers：Postgres + Redis）
  ├─ 4. 安全掃描（gitleaks、npm audit、CodeQL）
  ├─ 5. API 契約測試（Schemathesis 對 api_spec.json）
  └─ 6. SMOKE E2E（Playwright，Docker 軌道）

[每日 / Nightly]
  ├─ 7. CORE 回歸（Docker + Cloudflare 雙軌）
  ├─ 8. ZAP baseline scan
  └─ 9. 效能基線（k6 短時）

[Release Candidate]
  ├─ 10. FULL 回歸（含相容性、效能、ZAP active scan）
  ├─ 11. 雙軌端到端演練（乾淨環境）
  └─ 12. 安全專項（§3、§4、§5 全案例）
```

### 7.2 關鍵自動化腳本骨架

**A. 受限權杖封鎖驗證（Python / httpx）**

```python
import httpx, pytest

BASE = "http://localhost:8080/api/v1"

@pytest.fixture(scope="session")
def restricted_token():
    r = httpx.post(f"{BASE}/auth/login", json={
        "email": "admin@ticket.local",
        "password": "Admin@InitTemp2026!",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "password_change_required"
    assert "access_token" not in body
    return body["restricted_token"]

@pytest.mark.parametrize("method,path", [
    ("GET", "/tickets"),
    ("POST", "/tickets"),
    ("GET", "/tickets/1"),
    ("PATCH", "/tickets/1"),
    ("GET", "/users"),
    ("GET", "/reports/tickets"),
    ("GET", "/help-topics"),
])
def test_restricted_token_blocked(restricted_token, method, path):
    r = httpx.request(method, f"{BASE}{path}",
                      headers={"Authorization": f"Bearer {restricted_token}"},
                      json={} if method in ("POST", "PATCH") else None)
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"
    assert r.json()["title"] == "password_change_required"
    assert "data" not in r.text
```

**B. IDOR 枚舉（Python）**

```python
def test_vendor_idor_enumeration(vendor_token):
    visible = {"TCK-A", "TCK-D", "TCK-E"}
    for i in range(1, 51):
        number = f"TCK-2026-{i:06d}"
        r = httpx.get(f"{BASE}/tickets/{number}",
                      headers={"Authorization": f"Bearer {vendor_token}"})
        if number in visible:
            assert r.status_code == 200
        else:
            assert r.status_code == 404, f"{number} leaked with {r.status_code}"
            assert "subject" not in r.text
```

**C. 速率限制（k6）**

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    rate_limit_boundary: {
      executor: 'constant-arrival-rate',
      rate: 61, timeUnit: '1m', duration: '1m',
      preAllocatedVUs: 10, maxVUs: 20,
    },
  },
  thresholds: { http_req_duration: ['p(95)<300'] },
};

const TOKEN = __ENV.T_SOC_TOKEN;

export default function () {
  const res = http.get(`${__ENV.BASE}/tickets?per_page=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'retry-after present on 429': (r) =>
      r.status !== 429 || r.headers['Retry-After'] !== undefined,
  });
}
```

**D. Aging 邊界（SQL 基準查詢）**

```sql
-- 基準：超過 3 天未結案（嚴格 > 72 小時）
SELECT count(*) AS aging_over_3d
FROM tickets
WHERE status NOT IN ('resolved','closed')
  AND created_at < now() - INTERVAL '3 days';   -- 注意：嚴格小於 now()-3d

-- 邊界驗證：恰好 72 小時者不計入
SELECT count(*) FROM tickets
WHERE status NOT IN ('resolved','closed')
  AND created_at = now() - INTERVAL '3 days';   -- 期望 0（若存在則需排除）
```

> **實作對照**：PRD §FR-3.4 已修正為 `created_at < now() - INTERVAL '72 hours'`（嚴格小於），實作在 `src/server/services/tickets.ts` 的 `agingCondition()`，邊界由 `tests/tickets.test.ts` 驗證（剛好 72h 不計入、72h+1s 計入）。

### 7.3 測試資料重置腳本

```bash
#!/usr/bin/env bash
# scripts/qa/reset-fixtures.sh
set -euo pipefail
PSQL="docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -v ON_ERROR_STOP=1"

$PSQL <<'SQL'
TRUNCATE ticket_tags, ticket_field_values, ticket_threads, ticket_attachments,
         tickets, notification_logs, audit_logs, api_tokens
  RESTART IDENTITY CASCADE;
DELETE FROM users WHERE email <> 'admin@ticket.local';
UPDATE users SET must_change_password = TRUE, is_bootstrap_admin = TRUE,
                 password_updated_at = NULL, failed_login_count = 0, locked_until = NULL
 WHERE email = 'admin@ticket.local';
SQL

# 重新載入 §0.3 測試資料集
$PSQL -f scripts/qa/fixtures.sql
```

---

## 8. 缺陷管理與測試報告

### 8.1 缺陷單欄位

| 欄位 | 說明 |
| --- | --- |
| 標題 | `[S1][SEC-IDOR] vendor 可讀取非指派工單 TCK-C` |
| 環境 | `qa-docker` / `qa-cf`；版本 `v1.0.0-rc.N` |
| 重現步驟 | 可重複執行的最小步驟（含 curl / Playwright script） |
| 實際結果 | HTTP 碼、回應片段、DB 值、日誌 `trace_id` |
| 預期結果 | 對應測試案例之預期 |
| 影響 | 資料洩漏範圍、受影響角色、是否可遠端利用 |
| 證據 | 截圖、HAR、日誌、SQL 查詢結果 |
| 建議修復 | 例如「在 `TicketRepository.findVisible()` 加入 `assignee_id/watcher` 條件」 |

### 8.2 測試報告結構

1. **摘要**：案例總數 / 通過 / 失敗 / 阻塞；自動化比例；缺陷統計（S1~S4）。
2. **覆蓋率**：需求追溯矩陣完成度（§9）；UT 覆蓋率。
3. **安全結論**：認證繞過、IDOR、2FA、速率限制之測試結果與殘餘風險。
4. **效能結論**：100 RPS、列表 10 萬筆、Dashboard 首屏數據。
5. **雙軌結論**：Docker / Cloudflare 差異與已知限制。
6. **發佈建議**：Go / Conditional Go / No-Go，附條件與風險接受人。

### 8.3 發佈建議準則

| 條件 | 建議 |
| --- | --- |
| 零 S1、零 S2；P0 100% 通過 | **Go** |
| 零 S1；S2 ≤ 2 且有明確緩解與 PM 書面接受 | **Conditional Go** |
| 任一 S1 未解，或 P0 通過率 < 95% | **No-Go** |

---

## 9. 需求追溯矩陣 (RTM)

| 需求 | 驗收條件 | 測試案例 | 套件 |
| --- | --- | --- | --- |
| FR-1.1 多協定認證 | AC-AUTH-01~03 | REG-AUTH-001~010 | §6.2 |
| FR-1.2 2FA 全域開關 | AC-2FA-01~03 | SEC-2FA-001~030 | §3.11 |
| FR-1.3 預設臨時管理員 | **AC-SEC-01.1~01.9** | SEC-BA-001~059 | §3.1~3.9 |
| FR-1.4 密碼政策與帳號保護 | AC-SEC-01.4 | SEC-BA-020~032、SEC-BF-001~020 | §3.4、§3.10 |
| FR-1.5 Session / Token | AC-SEC-01.5 | SEC-BA-033~037、REG-AUTH-011~012 | §3.5、§6.2 |
| FR-1.6 審計日誌 | AC-SEC-01.5 / 01.6 | SEC-BA-030、SEC-BF-010~011、SEC-IDOR-035 | §3、§4 |
| FR-1.7 資料保護 | REG-SEC-001~008 | §6.9 |
| FR-2.1~2.11 工單核心 | AC-TICKET-01~07 | REG-TICKET-001~020 | §6.3 |
| FR-2.9 SOC REST API | AC-API-01~02 | API-RL-001~018 | §5.1 |
| FR-3.1~3.3 報表 | AC-REPORT-02~03 | REG-REPORT-001~008 | §6.5 |
| FR-3.4 >3 天未結案 | **AC-REPORT-01** | API-FLT-001~022 | §5.2 |
| FR-4.1 RBAC / IDOR | **AC-RBAC-01~02** | SEC-IDOR-001~038、REG-RBAC-001~007 | §4、§6.2 |
| FR-4.2 多管道通知 | AC-NOTIFY-01~02 | REG-NOTIFY-001~008 | §6.6 |
| FR-5.1 Glossary | AC-I18N-01~02 | REG-I18N-001~003 | §6.7 |
| FR-5.2 Light/Dark | AC-THEME-01 | REG-THEME-001~003 | §6.7 |
| FR-5.3 優先度 badge 色彩 | AC-THEME-02 | REG-THEME-004~005 | §6.7 |
| FR-5.4 第 2 批 資料色與側邊欄、Ant Design | AC-THEME-05 | REG-THEME-006~007 | §6.7 |
| FR-5.5 企業標誌 | AC-BRAND-01 | REG-BRAND-001~003 | §6.7 |
| FR-6.1~6.3 雙軌佈署 | AC-DEPLOY-01~02 | REG-DEPLOY-001~008 | §6.8 |
| FR-7 GitHub 門面 | AC-GH-01 | 文件審查（SEC-BA-055） | §3.8 |

---

## 10. 附錄

### 10.1 常用測試指令

```bash
# ---------- 環境 ----------
docker compose up -d --build
curl -fsS http://localhost:8080/healthz | jq .

# ---------- 種子驗證 ----------
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT email, role, must_change_password, is_bootstrap_admin,
       two_factor_enabled, password_updated_at, left(password_hash,7) AS prefix
FROM users WHERE email='admin@ticket.local';"

# ---------- 受限權杖封鎖 ----------
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ticket.local","password":"Admin@InitTemp2026!"}' | jq -r .restricted_token)
curl -i http://localhost:8080/api/v1/tickets -H "Authorization: Bearer $TOKEN"
# 期望 403 password_change_required

# ---------- 改密 ----------
curl -i -X POST http://localhost:8080/api/v1/auth/change-password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"current_password":"Admin@InitTemp2026!","new_password":"Qa!Str0ngPass#2026","confirm_password":"Qa!Str0ngPass#2026"}'

# ---------- IDOR ----------
curl -i http://localhost:8080/api/v1/tickets/TCK-2026-000003 \
  -H "Authorization: Bearer $VENDOR_TOKEN"
# 期望 404 not_found

# ---------- 速率限制 ----------
for i in $(seq 1 61); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    http://localhost:8080/api/v1/tickets?per_page=1 \
    -H "Authorization: Bearer $SOC_TOKEN"
done | sort | uniq -c
# 期望：60 個 200、1 個 429

# ---------- Aging 篩選 ----------
curl -s "http://localhost:8080/api/v1/tickets?aging_gt_days=3&per_page=100" \
  -H "Authorization: Bearer $SOC_TOKEN" | jq '.meta.total'
```

### 10.2 基準 SQL（口徑驗證）

```sql
-- A. 超過 3 天未結案（嚴格 > 72 小時；恰好 72h 不計入）
SELECT count(*) AS aging_over_3d
FROM tickets
WHERE status NOT IN ('resolved','closed')
  AND created_at < now() - INTERVAL '3 days';

-- B. 邊界：恰好 72 小時（期望不計入）
SELECT count(*) AS exactly_72h
FROM tickets
WHERE status NOT IN ('resolved','closed')
  AND created_at = now() - INTERVAL '3 days';

-- C. 依 aging_basis=last_updated_at
SELECT count(*) AS aging_over_3d_by_update
FROM tickets
WHERE status NOT IN ('resolved','closed')
  AND updated_at < now() - INTERVAL '3 days';

-- D. 可見範圍（vendor U-VD1）
SELECT t.number
FROM tickets t
WHERE t.assignee_id = (SELECT id FROM users WHERE email='vendor1@ext-vendor.example.com')
   OR EXISTS (
        SELECT 1 FROM ticket_watchers w
        WHERE w.ticket_id = t.id
          AND w.user_id = (SELECT id FROM users WHERE email='vendor1@ext-vendor.example.com')
      )
ORDER BY t.created_at;
```

> **注意**：若 `ticket_watchers` 資料表尚未建立（v1.0.0 schema 以 `tickets.assignee_id` + Watcher 關聯實作），需依實際 schema 調整；測試前應確認 Watcher 關聯表存在，否則 AC-RBAC-01 無法完整驗證。

### 10.3 安全測試檢查清單（手動）

- [ ] 以受限權杖嘗試 **所有** 業務端點（含未文件化端點，如 `/api/v1/admin/*`）
- [ ] 以 vendor 帳號枚舉 1~100 個工單 ID / 編號，確認全數 `404`
- [ ] 以 vendor 帳號嘗試 `PATCH` / `DELETE` 非指派工單
- [ ] 以 vendor 帳號讀取含 `internal_note` 之工單，確認 API 與 UI 皆不可見
- [ ] 以 `T-VD` Token 嘗試 `GET /users`、`GET /reports/tickets`
- [ ] 以 `X-Forwarded-For`、`X-Real-IP` 偽造嘗試繞過速率限制
- [ ] 以 `alg=none`、錯誤簽章、`kid` 注入偽造 JWT
- [ ] 以 `must_change_password=false` 竄改前端 localStorage / Cookie
- [ ] 以 `?sort=`、`?status=`、`?aging_gt_days=` 注入 SQL / NoSQL 語法
- [ ] 以 `//api/v1/tickets`、`/API/V1/TICKETS`、`X-HTTP-Method-Override` 繞過路由
- [ ] 檢查所有 `404` 回應是否洩漏存在性（訊息、時間、`trace_id` 格式）
- [ ] 檢查 `notification_logs` 與通知內容是否含內部備忘
- [ ] 檢查 `audit_logs` 是否記錄所有敏感操作（改密、2FA、權限變更、匯出、越權拒絕）
- [ ] 檢查 `src/schema.sql`、`docker-compose.yml`、`wrangler.toml` 無明文密碼
- [ ] 檢查 `.gitignore` 是否排除 `.env`、`.wrangler/`、`*.pem`、`secrets.json`

### 10.4 測試環境設定範例（`.env.qa`）

```dotenv
APP_ENV=staging
APP_URL=http://localhost:8080
TZ=Asia/Taipei
LOG_LEVEL=debug

POSTGRES_DB=ticketdesk
POSTGRES_USER=ticketdesk
POSTGRES_PASSWORD=QaDb!Passw0rd#2026
REDIS_PASSWORD=QaRedis!Passw0rd#2026

JWT_SECRET=qa_only_64_chars_random_value_do_not_use_in_prod_0123456789abcdef
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=604800
SESSION_COOKIE_SECURE=false          # 本機 HTTP 測試；正式環境必須 true
BCRYPT_COST=12

SECURITY_2FA_ENABLED=true
SECURITY_2FA_ENFORCE_ROLES=super_admin,it_manager
SECURITY_2FA_WEBAUTHN_RP_ID=localhost
SECURITY_2FA_WEBAUTHN_ORIGIN=http://localhost:8080

PASSWORD_MIN_LENGTH=12
PASSWORD_HISTORY_COUNT=5
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
LOGIN_BACKOFF_ENABLED=true

RATE_LIMIT_DEFAULT_PER_MIN=60
NOTIFY_MAX_ATTEMPTS=3
NOTIFY_DEDUP_TTL_SECONDS=86400

SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM_ADDRESS=no-reply@qa.local
TELEGRAM_ENABLED=false
TEAMS_ENABLED=false
```

### 10.5 風險與測試限制

| 風險 / 限制 | 影響 | 緩解 |
| --- | --- | --- |
| 時間相關測試需等待 72 小時 | 無法快速回歸 | 以 SQL 回填 `created_at` / 凍結時鐘；禁止 sleep |
| Cloudflare Workers 無法直連 LDAP | `qa-cf` 無法測 LDAP | 以 `qa-docker` 測 LDAP；`qa-cf` 測 OIDC/SAML |
| D1 與 PostgreSQL 方言差異 | 查詢結果可能不一致 | 雙軌皆跑 API-FLT 套件；CI 雙軌測試 |
| 2FA WebAuthn 需硬體/虛擬驗證器 | 自動化困難 | Playwright CDP 虛擬驗證器 + 手動實體金鑰抽測 |
| 通知管道外部依賴 | 測試不穩定 | Mailpit / 測試群組；失敗重試與冪等測試以 mock 為主 |
| 速率限制分散式競態 | 間歇性誤判 | 以 Redis 原子操作（`INCR` + `EXPIRE`）實作；壓測驗證最終值 |
| 大量資料效能測試成本 | 環境資源 | 獨立 `qa-perf` 環境；10 萬筆種子腳本化 |

---

## 11. 測試排程與角色 (RACI)

| 活動 | QA | PG | SAr | PM | 資安 |
| --- | --- | --- | --- | --- | --- |
| 測試計畫撰寫與維護 | **R/A** | C | C | I | C |
| 單元 / 整合測試實作 | C | **R/A** | I | I | I |
| E2E / 安全測試執行 | **R/A** | C | I | I | C |
| 缺陷分級與修復 | R | **A** | C | I | C |
| 效能測試 | **R/A** | C | C | I | I |
| 雙軌回歸演練 | **R** | R | **A** | I | C |
| Go/No-Go 決策 | R | C | C | **A** | C |

> R = Responsible、A = Accountable、C = Consulted、I = Informed。

### 11.1 里程碑對應（PRD §12）

| 里程碑 | 測試活動 | 交付物 |
| --- | --- | --- |
| M4 核心功能實作 | UT / IT 隨開發進行 | 覆蓋率報告 |
| **M5 測試與資安審查** | 本計畫 §3~§6 全案例 | 測試報告、缺陷清單、安全結論 |
| M6 雙軌佈署演練與發佈 | REG-DEPLOY + FULL 回歸 | Go/No-Go 決策紀錄 |

---

**文件結束 — QA-TD-001 v1.0.0**
