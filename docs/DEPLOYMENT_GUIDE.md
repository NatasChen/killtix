# 雙軌佈署指南 (DEPLOYMENT GUIDE) — TicketDesk 企業級 ITSM 工單管理平台

| 項目 | 內容 |
| --- | --- |
| 文件編號 | DEP-TD-001 |
| 版本 | **v1.0.0** |
| 文件狀態 | 初版發布 (Baseline) |
| 建立日期 | 2026-02-18 |
| 文件擁有者 | 系統架構師 (SAr) |
| 審閱者 | 產品需求專案經理 (PM)、資深全端工程師 (PG)、品質測試與資安工程師 (QA) |
| 關聯文件 | `docs/PRD_SPEC.md`（PRD-TD-001）、`README.md`、`CHANGELOG.md`、`src/schema.sql`、`src/api_spec.json`、`docs/QA_TEST_PLAN.md` |
| 適用版本 | TicketDesk v1.0.0（SemVer） |

---

## 0. 閱讀指引

本手冊提供 **兩條完整可執行的佈署軌道**，並在兩軌之上共用同一套 **身分驗證架構** 與 **多管道通知佇列** 設計。

| 章節 | 內容 | 主要讀者 |
| --- | --- | --- |
| §1 | 架構總覽、元件對照、環境策略、選型建議 | 全體 |
| §2 | 身分驗證架構（AD / LDAP / SAML 2.0 / OIDC / SCIM / 2FA / Session / Bootstrap Admin） | SAr、PG、資安 |
| §3 | 多管道通知佇列（Email / Telegram / Teams）設計與設定 | SAr、PG、維運 |
| §4 | **方案 A：Docker 容器化** step-by-step 佈署 | 維運、PG |
| §5 | **方案 B：Cloudflare Workers** step-by-step 佈署 | 維運、PG |
| §6 | 共通安全性規範（零信任、機密、標頭、備份、監控） | 資安、維運 |
| §7 | 上線檢查清單 (Go-Live Checklist) | PM、維運 |
| §8 | 驗收條件對照（AC-DEPLOY-01 / AC-DEPLOY-02） | QA |
| §9 | 附錄：環境變數總表、指令速查、故障排除矩陣 | 全體 |

> **重要前提**：兩軌皆共用同一份 `src/schema.sql` 之 **邏輯結構**。D1 與 PostgreSQL 的方言差異（`JSONB` → `TEXT`/`JSON`、`SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`、`now()` → `CURRENT_TIMESTAMP`、`INTERVAL '3 days'` → `datetime('now','-3 days')`、`BOOLEAN` → `INTEGER 0/1`）一律以 **migration 腳本** 處理，**禁止** 直接改動 `src/schema.sql` 的 PostgreSQL 主體。

---

## 1. 架構總覽

### 1.1 元件清單與雙軌對照

| # | 元件 | 職責 | 方案 A（Docker） | 方案 B（Cloudflare） |
| --- | --- | --- | --- | --- |
| 1 | Web 前端 (SPA) | 工單 UI、Dashboard、Light/Dark、i18n | 容器內靜態服務（Nginx / Node static） | **Cloudflare Pages** |
| 2 | API / BFF | RESTful API、Auth Guard、RBAC Policy Engine | App 容器（Node.js / Python） | **Cloudflare Workers** |
| 3 | 主資料庫 | 工單、使用者、SLA、審計、字典 | **PostgreSQL 16**（Volume 持久化） | **Cloudflare D1**（SQLite 相容） |
| 4 | 佇列 / 快取 | 非同步通知、Session、去重鍵、速率限制 | **Redis 7**（BullMQ / Celery） | **Cloudflare Queues** + **KV** |
| 5 | 排程 | SLA 掃描、積壓報表、自動結案 | 容器內 Cron / Worker Process | **Cron Triggers** |
| 6 | 身分連接器 | AD / LDAP / SAML / OIDC / SCIM | 直連企業內網 | 需 **Cloudflare Tunnel** 或內部中繼 |
| 7 | 通知出口 | SMTP / Telegram Bot API / Teams Webhook | 容器直出 | Workers `fetch` 直出 |
| 8 | 可觀測性 | 結構化日誌、健康檢查、指標 | JSON Log + `/healthz` + `/metrics` | Workers Analytics + Logpush |

### 1.2 邏輯架構圖

```
                    ┌──────────────────────────────────────────────────────┐
                    │            Clients / Integrations                    │
                    │  Web UI │ SOC 系統 │ Email 回覆 │ Telegram / Teams   │
                    └───────┬──────────────┬───────────────────────────────┘
                            │              │
              ┌─────────────▼──────┐  ┌────▼──────────────────┐
              │  REST API / BFF    │  │  Webhook Dispatcher   │
              │  ─ Auth Guard      │  │  ─ Retry + Idempotent │
              │  ─ must_change_pwd │  └────┬──────────────────┘
              │  ─ RBAC Policy     │       │
              └─────────┬──────────┘       │
                        │                  │
   ┌────────────────────▼──────────────────▼───────────────────────┐
   │                     Application Services                      │
   │  Auth(AD/LDAP/SAML/OIDC/SCIM/2FA) │ Ticket │ SLA │ Report     │
   │  RBAC Engine │ i18n Glossary │ Notification Service           │
   └──────────┬──────────────────────────────────┬────────────────┘
              │                                  │
     ┌────────▼─────────┐              ┌─────────▼──────────────┐
     │ PostgreSQL / D1  │              │ Redis / Queues         │
     │ (src/schema.sql) │              │ (notification.job)     │
     └──────────────────┘              └─────────┬──────────────┘
                                                 │
                              ┌──────────────────┼──────────────────┐
                              ▼                  ▼                  ▼
                        ┌──────────┐      ┌────────────┐     ┌──────────────┐
                        │ SMTP     │      │ Telegram   │     │ MS Teams     │
                        │ (Email)  │      │ Bot API    │     │ Webhook      │
                        └──────────┘      └────────────┘     └──────────────┘
```

### 1.3 關鍵請求流

**(A) SOC 自動開單（同步路徑，P95 ≤ 300ms）**

```
SOC ──POST /api/v1/tickets──▶ Auth Guard (API Token + Scope)
    ──▶ 冪等檢查 (Idempotency-Key / external_id)
    ──▶ Schema 驗證 (Help Topic → Ticket Form → Custom Fields)
    ──▶ 工單服務 (SLA 計算、Tag 關聯、Thread system_event)
    ──▶ DB 交易寫入
    ──▶ 佇列 enqueue(notification.job)   ← 不阻塞回應
    ◀── 201 Created (number + sla due)
```

**(B) 通知投遞（非同步路徑）**

```
Queue Consumer ──▶ 取 job ──▶ 冪等鍵檢查 (event_id+channel+recipient)
              ──▶ 渲染範本 (Glossary + 變數插值 + 敏感遮罩)
              ──▶ 呼叫管道 API ──▶ 成功：notification_logs(status=sent)
                                └─ 失敗：指數退避重試 (≤3) → status=failed → 告警
```

**(C) 登入與強制改密（安全關鍵路徑）**

```
POST /auth/login ──▶ 連接器解析 (local | ldap | saml | oidc)
                 ──▶ 密碼驗證 (bcrypt) / 斷言驗證
                 ──▶ 2FA 驗證 (TOTP / WebAuthn)  ← 若啟用且角色受強制
                 ──▶ 檢查 must_change_password
                       ├─ TRUE  → 簽發「受限權杖」(scope: password:change, auth:logout)
                       │          → 302 /change-password 或 422 password_change_required
                       └─ FALSE → 簽發完整權杖 → Dashboard
```

### 1.4 環境策略

| 環境 | 用途 | 資料庫 | 機密來源 | 網域 |
| --- | --- | --- | --- | --- |
| `development` | 本機開發 | Docker Postgres / D1 local (`--local`) | `.env`（本機） | `localhost:8080` |
| `staging` | 驗收與回歸 | 獨立 Postgres / D1 `ticketdesk-db-staging` | Secret Manager / `wrangler secret` | `staging.ticket.example.com` |
| `production` | 正式營運 | 正式 Postgres（HA）/ D1 `ticketdesk-db` | Secret Manager / `wrangler secret` | `ticket.example.com` |

> **鐵則**：`staging` 與 `production` **不得共用** 資料庫、Redis/Queues、SMTP 寄件帳號與 Telegram Bot Token。`APP_ENV` 必須明確設定，系統依此切換 Cookie `Secure`、HSTS、除錯訊息與速率限制。

### 1.5 選型建議

| 情境 | 建議軌道 | 理由 |
| --- | --- | --- |
| 需 LDAP/AD 直連、資料落地、內網隔離 | **方案 A：Docker** | 可直連 DC、資料完全自持、可自訂備份策略 |
| 全球分散使用者、免維運、成本敏感 | **方案 B：Cloudflare** | 邊緣低延遲、免伺服器維運、按用量計費 |
| 需高度自訂 SLA 排程與長時報表匯出 | **方案 A**（或 B + Queues 非同步） | Workers 有 CPU / 執行時間限制 |
| 已有 Cloudflare 企業帳號與 Zero Trust | **方案 B** | 可整合 Access / Tunnel / WAF |

---

## 2. 身分驗證架構設計

### 2.1 連接器模型 (Connector Model)

所有身分來源以「連接器」形式存在，管理介面可獨立啟用/停用，**本地帳號 (Local Auth) 與外部 IdP 可並存**。

**概念資料表 `identity_connectors`**

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | UUID | 主鍵 |
| `type` | enum | `local` / `ldap` / `ad` / `saml` / `oidc` |
| `key` | text | 唯一識別（如 `corp-ad`、`azure-oidc`） |
| `display_name` | text | 登入頁顯示名稱 |
| `config` | JSONB | 連線參數（**機密欄位加密儲存**） |
| `is_enabled` | boolean | 啟用狀態 |
| `is_default` | boolean | 登入頁預設導向 |
| `priority` | int | 多連接器時的解析順序 |
| `created_at` / `updated_at` | timestamptz | 稽核 |

**使用者身分綁定規則**

- `users.identity_provider` 記錄來源（`local` / `corp-ad` / `azure-oidc` …）。
- 同一 Email 若來自多來源，**以 `identity_provider` 區分為不同身分**，**禁止自動合併覆蓋**（避免 IdP 覆寫本地管理員權限）。
- 外部身分首次登入採 **JIT Provisioning**（即時建立），預設角色由連接器 `default_role` 決定（建議 `end_user`）。
- 登入失敗訊息統一為「帳號或密碼錯誤」，**不得洩漏帳號是否存在**。

### 2.2 認證決策流程

```
[登入請求]
   │
   ├─ 1. 解析連接器（依 email 網域 / 使用者選擇 / 預設連接器）
   │
   ├─ 2. 認證
   │     ├─ local  → bcrypt 比對 + 失敗計數 + 鎖定檢查
   │     ├─ ldap/ad→ LDAPS bind（服務帳號搜尋 → 使用者 DN bind）
   │     ├─ saml   → 驗證 Assertion 簽章 / Audience / NotOnOrAfter / InResponseTo
   │     └─ oidc   → Code 交換 + id_token 驗證（iss/aud/exp/nonce/alg）
   │
   ├─ 3. 帳號狀態檢查（is_active、locked_until、SCIM active=false）
   │
   ├─ 4. 2FA 檢查（security.2fa.enabled 且角色受強制 → 驗證 TOTP/WebAuthn）
   │
   ├─ 5. 角色解析（Group→Role 映射 / SCIM 群組 / 本地指派）
   │
   ├─ 6. must_change_password 檢查
   │     ├─ TRUE  → 受限權杖 + 導向改密
   │     └─ FALSE → 完整權杖
   │
   └─ 7. 審計日誌（成功/失敗/鎖定/2FA 變更）
```

### 2.3 Active Directory / LDAP 設計

**連線參數（對應 §9.1 環境變數）**

| 參數 | 範例 | 說明 |
| --- | --- | --- |
| `LDAP_URL` | `ldaps://dc01.corp.example.com:636` | **必須 LDAPS**；若用 389 必須 StartTLS |
| `LDAP_BIND_DN` | `CN=svc-ticketdesk,OU=ServiceAccounts,DC=corp,DC=example,DC=com` | 服務帳號，僅需「讀取」權限 |
| `LDAP_BASE_DN` | `DC=corp,DC=example,DC=com` | 搜尋基準 |
| `LDAP_USER_FILTER` | `(&(objectClass=user)(sAMAccountName={{username}})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` | 內含「停用帳號排除」條件 |
| `LDAP_GROUP_FILTER` | `(member={{dn}})` | 查詢使用者所屬群組 |
| `LDAP_ATTR_EMAIL` | `mail` | Email 屬性映射 |
| `LDAP_ATTR_DISPLAY_NAME` | `displayName` | 顯示名稱映射 |
| `LDAP_ATTR_UPN` | `userPrincipalName` | UPN 登入支援 |
| `LDAP_GROUP_ROLE_MAP` | JSON | 群組 DN → 角色 key |
| `LDAP_SYNC_INTERVAL_MINUTES` | `60` | 群組/屬性同步週期 |
| `LDAP_TLS_VERIFY` | `true` | **正式環境禁止設 false** |
| `LDAP_CA_CERT_PATH` | `/run/secrets/ldap_ca.pem` | 企業根憑證（自簽 CA 必要） |

**Group → Role 映射範例**

```json
{
  "CN=TD-SuperAdmins,OU=Groups,DC=corp,DC=example,DC=com": "super_admin",
  "CN=TD-ITManagers,OU=Groups,DC=corp,DC=example,DC=com": "it_manager",
  "CN=TD-Agents,OU=Groups,DC=corp,DC=example,DC=com": "agent",
  "CN=TD-Vendors,OU=Groups,DC=corp,DC=example,DC=com": "vendor"
}
```

**設計要點**

1. **停用帳號攔截**：AD 的 `userAccountControl` 停用位元（`0x2`）必須納入 Filter；LDAP 通用目錄則以 `nsAccountLock` 或自訂屬性判斷。
2. **群組變更生效時機**：登入時重新解析群組並更新角色；同步週期內以快取（Redis / KV，TTL = `LDAP_SYNC_INTERVAL_MINUTES`）降低 DC 負載。**角色變更必須撤銷既有 Session**（見 §2.8）。
3. **LDAP Filter 注入防護**：使用者輸入（username）必須經 RFC 4515 Escape（`\2a` `\28` `\29` `\5c` `\00`），**禁止** 字串直接拼接。
4. **服務帳號最小權限**：僅授予目標 OU 的讀取權；禁止 Domain Admin。
5. **連線池與逾時**：連線逾時 5s、操作逾時 10s、失敗 3 次即標記連接器 `degraded` 並告警。
6. **多 DC 容錯**：`LDAP_URL` 支援逗號分隔多端點，採輪詢 + 失敗切換。

### 2.4 SAML 2.0 設計

**SP 端設定（TicketDesk 作為 Service Provider）**

| 項目 | 值 |
| --- | --- |
| Entity ID | `https://ticket.example.com/saml/metadata` |
| ACS URL | `https://ticket.example.com/api/v1/auth/saml/acs` |
| SLO URL | `https://ticket.example.com/api/v1/auth/saml/slo` |
| NameID Format | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| 簽章 | 要求 Assertion 簽章（`SAML_WANT_ASSERTIONS_SIGNED=true`） |
| 時鐘偏移容忍 | `SAML_CLOCK_SKEW_SECONDS=120` |

**驗證檢查清單（缺一不可）**

1. `Signature` 以 **IdP 憑證** 驗證通過（正式環境禁止 `wantAssertionsSigned=false`）。
2. `Audience` 等於 SP Entity ID。
3. `Recipient` 等於 ACS URL。
4. `NotBefore` / `NotOnOrAfter` 在容忍範圍內。
5. `InResponseTo` 與 SP 發起的 `AuthnRequest` ID 相符（SP-initiated）。
6. `NameID` 非空且可映射至 Email。
7. **重放防護**：`AssertionID` 寫入一次性快取（Redis SETNX / KV，TTL = Assertion 有效期）。

**憑證輪替（零停機）**

```
T-30 天：IdP 產生新憑證 → 於 TicketDesk 連接器同時設定「現用 + 預備」兩張 IdP 憑證
T-0    ：IdP 切換簽章憑證 → TicketDesk 兩張皆可驗證，登入不中斷
T+7 天 ：確認無異常 → 移除舊憑證
```

> **SP 自身簽章憑證**（用於 AuthnRequest 簽章與 metadata）亦需預留輪替期；私鑰一律以 Secret 掛載（`/run/secrets/saml_sp_key.pem`），**不得** 進版控。

**IdP-initiated 支援**：允許 IdP 直接 POST 至 ACS；此時 `InResponseTo` 為空，改以 **AssertionID 重放防護 + 時間窗** 作為主要防線，並記錄 `auth.saml.idp_initiated` 審計事件。

### 2.5 OIDC 設計

**流程**：Authorization Code + **PKCE（S256）**，適用 Azure AD / Okta / Keycloak / Google Workspace。

| 參數 | 值 |
| --- | --- |
| Issuer | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Redirect URI | `https://ticket.example.com/api/v1/auth/oidc/callback` |
| Scopes | `openid profile email` |
| PKCE | 強制啟用（`code_challenge_method=S256`） |

**`id_token` 驗證清單**

| 檢查項 | 規則 |
| --- | --- |
| 簽章 | 以 IdP JWKS（`/.well-known/openid-configuration` → `jwks_uri`）驗證；**禁止** `alg=none` 與對稱演算法 |
| `iss` | 完全等於設定的 Issuer |
| `aud` | 包含 Client ID |
| `azp` | 多受眾時必須等於 Client ID |
| `exp` / `iat` / `nbf` | 在容忍範圍內（`OIDC_CLOCK_SKEW_SECONDS=60`） |
| `nonce` | 與登入時產生並存入 Session 的值相符（防重放） |
| `email_verified` | 若作為帳號綁定依據，必須為 `true` |
| JWKS 快取 | 依 `Cache-Control` 快取，`kid` 輪替時自動重取 |

> 偽造/過期 token 一律拒絕並寫入審計日誌（`auth.oidc.invalid_token`，含 `reason`、`ip`、`user_agent`）。

### 2.6 SCIM 2.0 設計

**端點**

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/scim/v2/Users` | 列表（支援 `filter`、`startIndex`、`count`） |
| `POST` | `/scim/v2/Users` | 建立使用者 |
| `GET` | `/scim/v2/Users/{id}` | 取得單筆 |
| `PATCH` | `/scim/v2/Users/{id}` | 更新（支援 `active=false` 停用） |
| `DELETE` | `/scim/v2/Users/{id}` | 刪除（建議軟刪除 + 停用） |
| `GET/POST/PATCH/DELETE` | `/scim/v2/Groups` | 群組佈建與成員同步 |

**認證**：`Authorization: Bearer <SCIM_BEARER_TOKEN>`（長隨機字串，僅存雜湊於 DB，可輪替）。

**佈建與撤銷行為**

1. `POST /Users` → 建立 `users` 記錄，`identity_provider='scim'`，預設角色 `end_user`。
2. `PATCH active=false` → `is_active=false` **並立即撤銷該使用者所有 Session / Refresh Token / API Token**（≤ 5 秒內生效）。
3. `DELETE /Users/{id}` → 軟刪除（`deleted_at`），保留工單關聯與審計軌跡。
4. 群組成員變更 → 重新計算角色；若角色降級，撤銷既有 Session。
5. 所有 SCIM 操作寫入 `audit_logs`（`actor='scim:<token_name>'`）。

### 2.7 2FA 全域開關設計

**設定鍵**：`security.2fa.enabled`（管理介面「系統設定 → 安全性」可切換）。

| 方法 | 標準 | 參數 |
| --- | --- | --- |
| **TOTP** | RFC 6238 | 30 秒步長、6 位數、SHA-1、容忍 ±1 步長 |
| **FIDO2 / WebAuthn** | W3C WebAuthn L2 | RP ID = `ticket.example.com`、User Verification = `preferred`、Attestation = `none` |

**強制矩陣**

| 角色 | `security.2fa.enabled=true` | `security.2fa.enabled=false` |
| --- | --- | --- |
| `super_admin` | **強制**（未綁定則導向綁定向導，不可進入後台） | 不要求（既有綁定資料保留） |
| `it_manager` | **強制** | 不要求 |
| `agent` | 依政策（`SECURITY_2FA_ENFORCE_ROLES` 可加入） | 不要求 |
| `vendor` / `end_user` | 選用（可自行啟用） | 不要求 |
| `api_client` | 不適用（以 API Token + Scope 控管） | 不適用 |

**開關行為**

- **啟用時**：受強制角色若尚未綁定 2FA，登入後 **僅能進入綁定向導**（受限權杖 scope 僅 `2fa:enroll`、`auth:logout`）。
- **停用時**：**不刪除** 既有 2FA 綁定資料（`users.two_factor_secret`、`webauthn_credentials`），僅暫停驗證；重新啟用後原綁定 **立即恢復有效**。
- **復原碼**：10 組一次性代碼，僅於綁定時顯示一次；DB 僅存 **雜湊**（bcrypt / SHA-256 + salt），使用後立即失效。
- **重設 2FA**：僅 `super_admin` 可執行，需二次確認並寫入審計日誌（`action='2fa.reset'`、`target_user`、`actor`、`ip`）。

### 2.8 Session / Token 架構

| 類型 | 儲存 | 有效期 | 屬性 / 規則 |
| --- | --- | --- | --- |
| Web Session | HttpOnly Cookie | 依 `JWT_REFRESH_TTL` | `HttpOnly` + `Secure` + `SameSite=Lax` + `Path=/`；`APP_ENV=production` 時 `Secure` 強制 `true` |
| Access Token | 記憶體 / Cookie | ≤ 60 分鐘（`JWT_ACCESS_TTL=3600`） | JWT（HS256/RS256），含 `sub`、`role`、`scopes`、`jti`、`tv` |
| Refresh Token | DB + HttpOnly Cookie | 7 天 | 一次性輪替（Rotation）；重用即撤銷整條鏈 |
| 受限權杖 | 記憶體 | 10 分鐘 | Scope 僅 `password:change` / `2fa:enroll` / `auth:logout` |
| API Token | DB（僅存雜湊） | 依設定（可無到期） | Scope、`last_used_at`、`revoked_at`、速率限制 |

**撤銷觸發條件（必須立即生效，快取失效 ≤ 5 秒）**

1. 使用者改密成功 → 撤銷該使用者 **所有** Session / Refresh Token。
2. 角色或權限變更 → 撤銷該使用者所有 Session。
3. 帳號停用（管理員操作 / SCIM `active=false`）→ 撤銷所有 Session + API Token。
4. 管理員「強制登出使用者」→ 撤銷指定使用者 Session。
5. 使用者「登出所有裝置」→ 撤銷全部。
6. 2FA 重設 → 撤銷所有 Session（強制重新登入並重新綁定）。

**實作機制**：`users.token_version`（整數）遞增 + JWT 內含 `tv` 聲明；驗證時比對 `tv`，不符即拒絕。Redis / KV 快取 `user:{id}:tv`，TTL 300 秒並於變更時主動刪除。

### 2.9 Bootstrap Admin 與強制改密（P0 阻斷性需求）

**種子資料（與 `src/schema.sql`、`README.md`、PRD §9.1 完全一致）**

| 欄位 | 值 |
| --- | --- |
| `email` | `admin@ticket.local` |
| `password_hash` | bcrypt（cost ≥ 10），範例：`$2a$10$wT0E0Zz.6aV99l0Y19zC1O/R4L2o99bU3Jg749Yk9JqHn89oM3WkK` |
| `role` | `super_admin` |
| `must_change_password` | `TRUE` |
| `two_factor_enabled` | `FALSE` |
| `is_bootstrap_admin` | `TRUE` |
| `password_updated_at` | `NULL` |
| `is_active` | `TRUE` |

> **明文密碼 `Admin@InitTemp2026!` 僅出現在本文件與 `README.md` 的說明段落，資料庫與種子腳本內僅存 bcrypt 雜湊。**

**中介層執行順序（安全關鍵，不可調換）**

```
1. TLS / HSTS
2. Rate Limit（依 IP + 帳號）
3. Authentication（驗證權杖 / Session）
4. ★ must_change_password 旗標檢查（在授權之前、業務邏輯之前）
5. Authorization（RBAC + Scope + 物件層級）
6. Business Logic
7. Audit Log
```

> 若將旗標檢查放在授權之後，攻擊者可能透過特定端點繞過；若放在業務邏輯之後，則可能已洩漏資料。**必須在第 4 層攔截**。

**狀態機**

```
[種子建立] must_change_password=TRUE, is_bootstrap_admin=TRUE
      │
      ├─ 登入成功 → 簽發受限權杖（scope: password:change, auth:logout）
      │            → 302 /change-password 或 422 password_change_required
      │
      ├─ 改密成功 → password_hash 更新
      │            → must_change_password=FALSE
      │            → is_bootstrap_admin=FALSE
      │            → password_updated_at=now()
      │            → 撤銷所有舊 Session/Token
      │            → 簽發完整權杖 → Dashboard
      │            → audit: password.changed
      │
      └─ 停用帳號 → is_active=FALSE（保留審計軌跡）
```

**冪等性要求（AC-SEC-01.7）**

種子腳本必須使用 **`INSERT ... ON CONFLICT (email) DO NOTHING`**（PostgreSQL）或 **`INSERT OR IGNORE`**（D1），確保：

- 容器重啟 / migration 重跑 **不會** 將密碼重置回初始值。
- **不會** 將 `must_change_password` 重新設為 `TRUE`。
- **不會** 產生第二筆 `admin@ticket.local`。

**高風險橫幅**：當 `is_bootstrap_admin=TRUE` 且 `is_active=TRUE` 時，任一管理員登入 Dashboard 皆顯示持續性橫幅：「偵測到預設臨時管理員帳號，請立即變更密碼或停用」。

**停用保護（AC-SEC-01.9）**：系統中僅剩一位 `super_admin` 時，停用/刪除該帳號必須回傳 `409 Conflict`。

### 2.10 審計日誌設計

| 欄位 | 說明 |
| --- | --- |
| `created_at` | UTC 時間（`timestamptz`） |
| `actor_id` / `actor_email` | 操作者 |
| `action` | 動作代碼（如 `auth.login.success`、`password.changed`、`ticket.deleted`） |
| `target_type` / `target_id` | 目標物件 |
| `diff` | JSONB 變更前後差異（敏感欄位遮罩） |
| `ip` / `user_agent` | 來源資訊 |
| `result` | `success` / `failure` / `denied` |
| `trace_id` | 貫穿請求追蹤 |

**必須記錄的事件**：登入/登出/失敗/鎖定、改密、2FA 變更與重設、角色與權限變更、工單建立/指派/狀態變更/刪除、報表匯出、API Token 操作、系統設定變更、SCIM 佈建/撤銷。

**保存策略**：預設 **365 天**；不可由一般管理介面刪除；歸檔至冷儲存（S3 / R2）後方可清理。

### 2.11 認證相關環境變數

見 §9.1（第 4~10 區塊）。**所有機密（`JWT_SECRET`、`LDAP_BIND_PASSWORD`、`OIDC_CLIENT_SECRET`、`SCIM_BEARER_TOKEN`、SAML 私鑰）一律不得進版控**。

---

## 3. 多管道通知佇列設計

### 3.1 佇列架構

**方案 A（Docker）**

```
API 容器 ──enqueue──▶ Redis (BullMQ: notification.job)
                              │
                    ┌─────────▼──────────┐
                    │ Worker 容器        │
                    │ concurrency=5      │
                    │ ├─ email.sender    │
                    │ ├─ telegram.sender │
                    │ └─ teams.sender    │
                    └─────────┬──────────┘
                              │
                    notification_logs (PostgreSQL)
```

**方案 B（Cloudflare）**

```
Worker (API) ──NOTIFY_QUEUE.send()──▶ Cloudflare Queues
                                          │
                              ┌───────────▼────────────┐
                              │ Queue Consumer Worker  │
                              │ max_batch_size=10      │
                              │ max_retries=3          │
                              │ dead_letter_queue=DLQ  │
                              └───────────┬────────────┘
                                          │
                              D1: notification_logs
```

**設計原則**

1. **非同步**：通知一律經佇列，**不得** 在 API 請求執行緒內同步發送（保證 P95 ≤ 300ms）。
2. **冪等**：`event_id + channel + recipient` 為去重鍵，TTL 24 小時（Redis SETNX / KV / D1 unique index）。
3. **隔離**：單一管道失敗不影響其他管道（每個 channel 為獨立 job）。
4. **可觀測**：每個 job 記錄 `attempts`、`last_error`、`sent_at`、`trace_id`。
5. **內容安全**：通知範本 **不得** 包含 `internal_note` 或內部欄位；外部收件者僅見對外資訊。

### 3.2 事件與路由表

| 事件 (`event_type`) | Email | Telegram | Teams | 優先級 | 備註 |
| --- | --- | --- | --- | --- | --- |
| `ticket.created` | ✅ 請求者 | ⬜ | ⬜ | normal | 確認信 |
| `ticket.assigned` | ✅ 被指派者 | ✅ 被指派者 | ✅ 團隊頻道 | high | 指派即時通知 |
| `ticket.replied` | ✅ 請求者 / 被指派者 | ⬜ | ⬜ | normal | 對外回覆才寄 |
| `ticket.status_changed` | ✅ 請求者 | ⬜ | ⬜ | normal | |
| `ticket.priority_critical` | ✅ 值班主管 | ✅ 值班群組 | ✅ 團隊頻道 | **critical** | Level 4/5 開單 |
| `sla.at_risk` | ✅ 負責人 + 主管 | ✅ 負責人 | ⬜ | high | 到期前 20% 時間 |
| `sla.overdue` | ✅ 負責人 + 主管 | ✅ 值班群組 | ✅ 團隊頻道 | **critical** | 逾時 |
| `sla.escalated` | ✅ `it_manager` | ✅ 值班群組 | ✅ 團隊頻道 | **critical** | 自動升級 |
| `report.aging_daily` | ✅ `it_manager` | ⬜ | ✅ 團隊頻道 | normal | 每日 09:00 積壓摘要 |
| `notification.failed_alert` | ✅ 系統管理員 | ✅ 系統管理員 | ⬜ | **critical** | 連續失敗 5 次 |

> **強制通知**：`ticket.priority_critical`、`sla.overdue`、`notification.failed_alert` 為 **全域強制**，不受使用者通知偏好關閉（管理員可調整清單，但 Level 5 預設不可關）。

### 3.3 訊息結構（Job Envelope）

```json
{
  "event_id": "evt_01HZX9A2B3C4D5",
  "event_type": "ticket.assigned",
  "occurred_at": "2026-02-18T01:12:00Z",
  "trace_id": "trc_9f8e7d6c",
  "tenant_id": "tn_default",
  "ticket": {
    "id": "tkt_01HZX8K3",
    "number": "TCK-2026-000123",
    "subject": "[SOC] 偵測到端點 EDR-0421 疑似勒索軟體行為",
    "priority": 5,
    "status": "open",
    "url": "https://ticket.example.com/tickets/tkt_01HZX8K3"
  },
  "channels": [
    { "channel": "email",    "recipient": "agent01@example.com", "template": "ticket_assigned_email" },
    { "channel": "telegram", "recipient": "-1001234567890",      "template": "ticket_assigned_tg", "topic_id": 42 },
    { "channel": "teams",    "recipient": "https://<tenant>.webhook.office.com/...", "template": "ticket_assigned_card" }
  ],
  "payload": {
    "assignee_name": "王小明",
    "sla_resolution_due_at": "2026-02-18T03:12:00Z",
    "help_topic": "security-incident"
  },
  "dedup_key": "evt_01HZX9A2B3C4D5:telegram:-1001234567890"
}
```

> **注意**：`payload` 僅能包含對外可見欄位；`internal_note`、內部自訂欄位（`visibility=internal`）**禁止** 進入 envelope。

### 3.4 冪等與去重

| 軌道 | 機制 | 實作 |
| --- | --- | --- |
| Docker | Redis `SET key NX EX 86400` | `SET dedup:{event_id}:{channel}:{recipient} 1 NX EX 86400` |
| Cloudflare | KV `put` + `get` 檢查 / D1 unique index | `notification_logs(dedup_key)` UNIQUE |

**規則**

1. 去重鍵 = `event_id + channel + recipient`（recipient 需正規化：Email 小寫、Telegram chat_id 字串、Teams URL 去除尾端斜線）。
2. 若鍵已存在 → **跳過發送**，記錄 `notification_logs.status='skipped_duplicate'`。
3. 使用者主動「重送 (Resend)」時，使用 **新的 `event_id`**（`evt_..._resend_1`），避免被去重阻擋。

### 3.5 重試與退避策略

| 嘗試次數 | 延遲 | 條件 |
| --- | --- | --- |
| 第 1 次 | 立即 | — |
| 第 2 次 | 30 秒 ± jitter | 5xx / 連線逾時 / 429（依 `Retry-After`） |
| 第 3 次 | 120 秒 ± jitter | 同上 |
| 失敗終結 | — | `status='failed'`，寫入 `last_error`，觸發告警 |

**管道特例**

- **Telegram**：HTTP `429` 時讀取 `parameters.retry_after`（秒），**依該值等待**後重送，不套用固定退避；`403`（Bot 被踢出）視為永久失敗，不重試。
- **Teams**：HTTP `429` 讀取 `Retry-After`；連續失敗 **5 次**（跨事件累計，滑動 15 分鐘窗）→ 觸發 `notification.failed_alert` 給系統管理員。
- **SMTP**：`4xx`（暫時性）重試；`5xx`（永久性，如信箱不存在）不重試，記錄失敗原因。

### 3.6 Email (SMTP) 設定

| 變數 | 說明 |
| --- | --- |
| `SMTP_HOST` / `SMTP_PORT` | 例：`smtp.example.com:587` |
| `SMTP_SECURE` | `false` = 587 STARTTLS；`true` = 465 直連 TLS |
| `SMTP_USER` / `SMTP_PASSWORD` | 寄件帳號（建議專用 `no-reply`） |
| `SMTP_FROM_NAME` / `SMTP_FROM_ADDRESS` | 寄件者顯示名稱與位址 |
| `SMTP_REPLY_TO` | 回覆信箱（如 `support@example.com`） |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | 正式環境 **必須 `true`** |

**DNS 與送達率（必要）**

1. **SPF**：`v=spf1 include:<provider> -all`
2. **DKIM**：由郵件服務商提供，於 DNS 發布 `selector._domainkey` TXT
3. **DMARC**：`v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`
4. **PTR / HELO**：寄件 IP 需有對應反解
5. **主旨執行緒歸併**：回覆通知主旨必須包含 `[#TCK-2026-000123]`，供 Email 回覆自動歸併至原工單

**測試指令**

```bash
docker compose exec app node dist/cli/notify-test.js --channel=email --to=you@example.com
```

### 3.7 Telegram Bot 設定

**建立步驟**

1. 於 Telegram 搜尋 `@BotFather` → `/newbot` → 取得 **Bot Token**（格式 `123456789:AA...`）。
2. 將 Bot 加入目標群組，並設為 **管理員**（若需發送至 Topic）。
3. 取得 `chat_id`：
   - 群組：`https://api.telegram.org/bot<TOKEN>/getUpdates` 觀察 `chat.id`（負數，如 `-1001234567890`）。
   - 或將 Bot 加入群組後發一則訊息，再查 `getUpdates`。
4. 若使用 **Forum Topic**（討論串），取得 `message_thread_id`（即 `TELEGRAM_CRITICAL_TOPIC_ID`）。

**發送範例**

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": "-1001234567890",
    "message_thread_id": 42,
    "parse_mode": "HTML",
    "disable_web_page_preview": true,
    "text": "<b>🔴 緊急工單指派</b>\n<b>單號：</b>TCK-2026-000123\n<b>主旨：</b>[SOC] 端點 EDR-0421 疑似勒索軟體\n<b>結案期限：</b>2026-02-18 11:12 (UTC+8)\n<a href=\"https://ticket.example.com/tickets/tkt_01HZX8K3\">前往處理</a>"
  }'
```

**注意事項**

- 全 Bot 發送速率上限約 **30 msg/s**；單一群組約 **20 msg/min**。大量通知需節流（佇列 `concurrency` 控制 + 令牌桶）。
- `parse_mode=HTML` 時，使用者輸入內容必須 **HTML Escape**（`&` `<` `>`），避免格式破壞或注入。
- Bot Token 視為 **高敏感機密**，洩漏即等於群組發言權被接管；輪替時先建立新 Bot 再切換。

### 3.8 Microsoft Teams Incoming Webhook 設定

**建立步驟**

1. 於目標 Teams 頻道 → `⋯` → **Workflows**（或舊版 Connectors）→ 選擇 **Incoming Webhook**。
2. 命名（如 `TicketDesk 通知`）→ 建立 → 複製 **Webhook URL**。
3. 將 URL 設為 `TEAMS_WEBHOOK_URL`（**視為機密**，不進版控）。

**Adaptive Card 範例**

```json
{
  "type": "message",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
          { "type": "TextBlock", "size": "Medium", "weight": "Bolder",
            "text": "🔴 緊急工單指派 — TCK-2026-000123", "wrap": true },
          { "type": "FactSet", "facts": [
            { "title": "主旨", "value": "[SOC] 端點 EDR-0421 疑似勒索軟體" },
            { "title": "優先級", "value": "Level 5 緊急" },
            { "title": "指派給", "value": "王小明" },
            { "title": "結案期限", "value": "2026-02-18 11:12 (UTC+8)" }
          ]}
        ],
        "actions": [
          { "type": "Action.OpenUrl", "title": "前往處理",
            "url": "https://ticket.example.com/tickets/tkt_01HZX8K3" }
        ]
      }
    }
  ]
}
```

**注意事項**

- Webhook 速率限制約 **4 req/s**（每個 Webhook）；超限回 `429`，需依 `Retry-After` 重送。
- Webhook URL 一旦洩漏，任何人皆可對頻道發言；**輪替流程**：建立新 Webhook → 更新 Secret → 驗證 → 刪除舊 Webhook。
- 通知內容 **不得** 包含內部備忘；卡片僅放對外可見欄位。

### 3.9 通知偏好與強制通知

| 層級 | 設定位置 | 說明 |
| --- | --- | --- |
| 全域 | 系統設定 → 通知 | 啟用哪些管道、強制事件清單、速率上限 |
| 角色 | 角色管理 | 該角色預設訂閱事件 |
| 使用者 | 個人設定 → 通知偏好 | 訂閱事件 × 管道矩陣；可關閉非強制事件 |
| 工單 | Watcher / CC | 被加入者自動訂閱該工單事件 |

**優先序**：強制事件 > 使用者偏好 > 角色預設 > 全域預設。

### 3.10 `notification_logs` 與重送

**資料表重點欄位**

| 欄位 | 說明 |
| --- | --- |
| `id` | 主鍵 |
| `event_id` | 事件識別 |
| `event_type` | 事件類型 |
| `channel` | `email` / `telegram` / `teams` |
| `recipient` | 收件者（Email / chat_id / Webhook URL 之 **雜湊**） |
| `dedup_key` | 去重鍵（UNIQUE） |
| `status` | `queued` / `sending` / `sent` / `failed` / `skipped_duplicate` |
| `attempts` | 嘗試次數 |
| `last_error` | 最後錯誤訊息（截斷 500 字元） |
| `provider_message_id` | 供應商回傳 ID |
| `sent_at` | 發送成功時間 |
| `trace_id` | 追蹤 ID |

**重送 API**

```bash
curl -X POST https://ticket.example.com/api/v1/notifications/{log_id}/resend \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# 201 Created → 產生新 event_id，重新入佇列
```

### 3.11 監控指標與告警門檻

| 指標 | 告警門檻 | 動作 |
| --- | --- | --- |
| 佇列深度 (`queue_depth`) | > 1,000 持續 5 分鐘 | 擴充 consumer / 檢查管道 |
| 通知失敗率（24h） | > 1% | 通知系統管理員 |
| 單一管道連續失敗 | ≥ 5 次 | `notification.failed_alert` |
| 佇列最舊訊息年齡 | > 10 分鐘 | 檢查 consumer 健康 |
| DLQ 訊息數 | > 0 | 人工檢視並重送 |
| Email 退信率 | > 2% | 檢查 SPF/DKIM/DMARC |

---

## 4. 方案 A：Docker 容器化佈署（Step-by-Step）

### 4.1 前置需求

| 項目 | 最低 | 建議（正式環境） |
| --- | --- | --- |
| Docker Engine | 24.x | 26.x |
| Docker Compose | v2.20+ | v2.27+ |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| 磁碟 | 20 GB | 100 GB SSD（資料庫 + 附件 + 備份） |
| 連接埠 | `8080`（App）、`5432`（Postgres，僅本機）、`6379`（Redis，僅本機） | 僅對外開放 `443`（經反向代理） |
| 作業系統 | Linux（Ubuntu 22.04 / RHEL 9） | 同左 |
| 其他 | 可連線 SMTP、Telegram、Teams | 企業 CA 憑證（LDAPS）、TLS 憑證 |

> **安全建議**：Postgres 與 Redis 的 `ports` 一律綁定 `127.0.0.1`（如 `127.0.0.1:5432:5432`），**禁止** 直接對外暴露。

### 4.2 Step 1 — 取得程式碼

```bash
git clone https://github.com/<your-org>/ticketdesk.git
cd ticketdesk
git checkout v1.0.0        # 建議以 Release Tag 佈署，避免追隨 main
```

### 4.3 Step 2 — 建立環境變數檔

```bash
cp .env.example .env
chmod 600 .env             # 僅擁有者可讀寫
```

**`.env.example` 完整內容（請依實際環境修改）**

```dotenv
# ============================================================
# TicketDesk v1.0.0 — 環境變數範本
# 使用方式：cp .env.example .env 後填入真實值；.env 永不進版控
# 注意：若您的 dotenv 解析器不支援行內註解，請自行移除 # 之後的文字
# ============================================================

# ---------- 1. 執行環境 ----------
APP_ENV=production
APP_NAME=TicketDesk
APP_URL=https://ticket.example.com
APP_PORT=8080
TZ=Asia/Taipei
LOG_LEVEL=info
TRACE_ENABLED=true

# ---------- 2. 資料庫 (PostgreSQL 16) ----------
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=ticketdesk
POSTGRES_USER=ticketdesk
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DATABASE_URL=postgresql://ticketdesk:CHANGE_ME_STRONG_PASSWORD@postgres:5432/ticketdesk
DB_POOL_MIN=2
DB_POOL_MAX=20

# ---------- 3. Redis 7 (佇列 / 快取 / Session) ----------
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD
REDIS_URL=redis://:CHANGE_ME_REDIS_PASSWORD@redis:6379/0
QUEUE_PREFIX=ticketdesk
QUEUE_CONCURRENCY=5

# ---------- 4. 認證與權杖 ----------
JWT_SECRET=CHANGE_ME_64_CHARS_RANDOM
JWT_ACCESS_TTL=3600
JWT_REFRESH_TTL=604800
SESSION_COOKIE_NAME=td_session
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=lax
SESSION_COOKIE_DOMAIN=
CSRF_SECRET=CHANGE_ME_32_CHARS_RANDOM
BCRYPT_COST=12

# ---------- 5. 2FA 全域開關 ----------
SECURITY_2FA_ENABLED=true
SECURITY_2FA_ENFORCE_ROLES=super_admin,it_manager
SECURITY_2FA_TOTP_ISSUER=TicketDesk
SECURITY_2FA_RECOVERY_CODE_COUNT=10
SECURITY_2FA_WEBAUTHN_RP_ID=ticket.example.com
SECURITY_2FA_WEBAUTHN_RP_NAME=TicketDesk
SECURITY_2FA_WEBAUTHN_ORIGIN=https://ticket.example.com

# ---------- 6. 密碼政策與帳號保護 ----------
PASSWORD_MIN_LENGTH=12
PASSWORD_HISTORY_COUNT=5
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
LOGIN_BACKOFF_ENABLED=true

# ---------- 7. AD / LDAP 連接器 ----------
LDAP_ENABLED=false
LDAP_URL=ldaps://dc01.corp.example.com:636
LDAP_BIND_DN=CN=svc-ticketdesk,OU=ServiceAccounts,DC=corp,DC=example,DC=com
LDAP_BIND_PASSWORD=CHANGE_ME
LDAP_BASE_DN=DC=corp,DC=example,DC=com
LDAP_USER_FILTER=(&(objectClass=user)(sAMAccountName={{username}})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
LDAP_GROUP_FILTER=(member={{dn}})
LDAP_ATTR_EMAIL=mail
LDAP_ATTR_DISPLAY_NAME=displayName
LDAP_ATTR_UPN=userPrincipalName
LDAP_GROUP_ROLE_MAP={"CN=TD-SuperAdmins,OU=Groups,DC=corp,DC=example,DC=com":"super_admin","CN=TD-Agents,OU=Groups,DC=corp,DC=example,DC=com":"agent"}
LDAP_SYNC_INTERVAL_MINUTES=60
LDAP_TLS_VERIFY=true
LDAP_CA_CERT_PATH=/run/secrets/ldap_ca.pem

# ---------- 8. SAML 2.0 ----------
SAML_ENABLED=false
SAML_ENTITY_ID=https://ticket.example.com/saml/metadata
SAML_ACS_URL=https://ticket.example.com/api/v1/auth/saml/acs
SAML_IDP_ENTITY_ID=https://idp.corp.example.com/metadata
SAML_IDP_SSO_URL=https://idp.corp.example.com/sso/saml
SAML_IDP_SLO_URL=https://idp.corp.example.com/slo/saml
SAML_IDP_CERT_PATH=/run/secrets/saml_idp_cert.pem
SAML_SP_PRIVATE_KEY_PATH=/run/secrets/saml_sp_key.pem
SAML_SP_CERT_PATH=/run/secrets/saml_sp_cert.pem
SAML_CLOCK_SKEW_SECONDS=120
SAML_WANT_ASSERTIONS_SIGNED=true
SAML_NAMEID_FORMAT=urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress

# ---------- 9. OIDC ----------
OIDC_ENABLED=false
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=CHANGE_ME
OIDC_CLIENT_SECRET=CHANGE_ME
OIDC_REDIRECT_URI=https://ticket.example.com/api/v1/auth/oidc/callback
OIDC_SCOPES=openid profile email
OIDC_PKCE_ENABLED=true
OIDC_CLOCK_SKEW_SECONDS=60

# ---------- 10. SCIM 2.0 ----------
SCIM_ENABLED=true
SCIM_BASE_PATH=/scim/v2
SCIM_BEARER_TOKEN=CHANGE_ME_LONG_RANDOM_TOKEN

# ---------- 11. Email (SMTP) ----------
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@example.com
SMTP_PASSWORD=CHANGE_ME
SMTP_FROM_NAME=TicketDesk 服務台
SMTP_FROM_ADDRESS=no-reply@example.com
SMTP_REPLY_TO=support@example.com
SMTP_TLS_REJECT_UNAUTHORIZED=true

# ---------- 12. Telegram Bot ----------
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=CHANGE_ME
TELEGRAM_DEFAULT_CHAT_ID=-1001234567890
TELEGRAM_CRITICAL_TOPIC_ID=42
TELEGRAM_PARSE_MODE=HTML

# ---------- 13. Microsoft Teams ----------
TEAMS_ENABLED=true
TEAMS_WEBHOOK_URL=https://<tenant>.webhook.office.com/webhookb2/CHANGE_ME
TEAMS_DAILY_DIGEST_CRON=0 1 * * *

# ---------- 14. 通知佇列與重試 ----------
NOTIFY_MAX_ATTEMPTS=3
NOTIFY_BACKOFF_BASE_SECONDS=30
NOTIFY_BACKOFF_JITTER=true
NOTIFY_DEDUP_TTL_SECONDS=86400
NOTIFY_FAILURE_ALERT_THRESHOLD=5

# ---------- 15. 排程 ----------
SLA_SCAN_CRON=*/5 * * * *
AGING_REPORT_CRON=0 1 * * *
AUTO_CLOSE_RESOLVED_DAYS=7

# ---------- 16. 安全標頭與 CORS ----------
CORS_ALLOWED_ORIGINS=https://ticket.example.com
HSTS_MAX_AGE=31536000
RATE_LIMIT_DEFAULT_PER_MIN=60
```

### 4.4 Step 3 — 產生機密值

```bash
# JWT_SECRET（64 字元）
openssl rand -base64 48 | tr -d '\n' | cut -c1-64

# CSRF_SECRET（32 字元）
openssl rand -hex 16

# SCIM_BEARER_TOKEN（長隨機）
openssl rand -hex 32

# Postgres / Redis 密碼
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24
```

將產出值填入 `.env`，並確認：

```bash
grep -E '^(JWT_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|SCIM_BEARER_TOKEN)=' .env | \
  awk -F= '{print $1" length="length($2)}'
# 確認無 CHANGE_ME 殘留
grep -n 'CHANGE_ME' .env && echo "⚠️ 仍有未替換的機密！" || echo "✅ 機密已全部替換"
```

### 4.5 Step 4 — 檢視 `docker-compose.yml`

```yaml
name: ticketdesk

services:
  postgres:
    image: postgres:16-alpine
    container_name: ticketdesk-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      TZ: ${TZ}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./src/schema.sql:/docker-entrypoint-initdb.d/01_schema.sql:ro
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [tdnet]

  redis:
    image: redis:7-alpine
    container_name: ticketdesk-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [tdnet]

  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: ticketdesk/app:1.0.0
    container_name: ticketdesk-app
    restart: unless-stopped
    env_file: [.env]
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/healthz"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s
    networks: [tdnet]

  worker:
    image: ticketdesk/app:1.0.0
    container_name: ticketdesk-worker
    restart: unless-stopped
    command: ["node", "dist/worker.js"]
    env_file: [.env]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [tdnet]

volumes:
  pgdata:
  redisdata:

networks:
  tdnet:
    driver: bridge
```

**重點說明**

| 設定 | 目的 |
| --- | --- |
| `./src/schema.sql:/docker-entrypoint-initdb.d/01_schema.sql:ro` | **僅在資料目錄為空時** 執行，完成建表 + Bootstrap Admin 種子 |
| `pgdata` / `redisdata` Volume | 資料持久化；`docker compose down` 不會刪除 |
| `127.0.0.1:5432` / `127.0.0.1:6379` | 僅本機可連，避免資料庫對外暴露 |
| `depends_on: condition: service_healthy` | 確保 App 啟動前 DB/Redis 已就緒 |
| `worker` 服務 | 佇列消費者 + SLA 掃描，與 API 分離部署 |

### 4.6 Step 5 — 啟動服務

```bash
# 建置並啟動
docker compose up -d --build

# 觀察啟動狀態（等待 healthy）
docker compose ps

# 追蹤日誌（確認 migration 與種子資料執行結果）
docker compose logs -f postgres | head -n 60
docker compose logs -f app
```

**預期輸出（Postgres 首次啟動）**

```
ticketdesk-postgres  | ... running /docker-entrypoint-initdb.d/01_schema.sql
ticketdesk-postgres  | ... CREATE TABLE
ticketdesk-postgres  | ... INSERT 0 1        ← Bootstrap Admin 種子
ticketdesk-postgres  | database system is ready to accept connections
```

### 4.7 Step 6 — 資料庫初始化與 Migration

**機制說明**

1. **首次啟動**：Postgres 容器偵測資料目錄為空 → 依檔名順序執行 `/docker-entrypoint-initdb.d/*.sql`（此處為 `01_schema.sql`）。
2. **後續啟動**：資料目錄已存在 → **不再執行** initdb 腳本（這是冪等性的第一道保障）。
3. **版本升級**：以 **migration 腳本** 執行增量變更，**禁止** 手動改線上資料庫。

**Migration 執行方式（二選一）**

```bash
# 方式 1：使用應用內建 migration runner（建議）
docker compose exec app npm run migrate
# 或
docker compose exec app node dist/cli/migrate.js --dir=./src/migrations

# 方式 2：直接以 psql 依序執行
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk \
  -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01_schema.sql
```

**Migration 檔案命名規範**

```
src/migrations/
├── 0001_init.sql              # 對應 schema.sql 之基準結構（首次由 initdb 執行）
├── 0002_add_scim_tables.sql
├── 0003_add_notification_dedup.sql
└── 0004_...
```

> **雙軌相容**：每支 migration 需提供 PostgreSQL 版（`*.sql`）與 D1 版（`*.d1.sql`），或使用條件語法；CI 必須雙軌測試。

**驗證資料庫初始化結果**

```bash
# 1) 確認資料表數量
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "\dt"

# 2) 確認 Bootstrap Admin 種子資料（AC-SEC-01.1）
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT email, role, must_change_password, is_bootstrap_admin,
       two_factor_enabled, password_updated_at,
       left(password_hash, 7) AS hash_prefix
FROM users WHERE email = 'admin@ticket.local';"
```

**預期結果**

```
     email          |    role     | must_change_password | is_bootstrap_admin | two_factor_enabled | password_updated_at | hash_prefix
--------------------+-------------+----------------------+--------------------+--------------------+---------------------+-------------
 admin@ticket.local | super_admin | t                    | t                  | f                  |                     | $2a$10$
```

**冪等性驗證（AC-SEC-01.7）**

```bash
# 重啟容器（不刪 Volume），確認種子不覆蓋
docker compose restart postgres app

docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT count(*) AS admin_count FROM users WHERE email='admin@ticket.local';"
# 期望：1（不得為 2）
```

### 4.8 Step 7 — 健康檢查

```bash
curl -fsS http://localhost:8080/healthz | jq .
```

**預期回應**

```json
{
  "status": "ok",
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "queue": "ok"
  },
  "timestamp": "2026-02-18T01:12:00Z"
}
```

若 `status != ok`，依 `checks` 欄位定位問題（見 §9.3 故障排除矩陣）。

### 4.9 Step 8 — 首次登入與強制改密（關鍵步驟）

> ⚠️ **高風險**：`admin@ticket.local` / `Admin@InitTemp2026!` 僅供初次佈署驗證。**請於登入後立即改密**，並於設定完成後停用或改為正式管理帳號。

**(1) 登入（取得受限權杖）**

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ticket.local","password":"Admin@InitTemp2026!"}'
```

**預期回應（HTTP 200）**

```json
{
  "status": "password_change_required",
  "restricted_token": "eyJhbGciOi...",
  "expires_in": 600,
  "change_password_url": "/change-password",
  "message": "首次登入必須變更密碼後方可使用系統"
}
```

> 若回傳 `422 password_change_required` 亦屬正確行為（依實作端點設計）；重點是 **不會** 直接取得完整權杖。

**(2) 驗證改密前功能封鎖（AC-SEC-01.3）**

```bash
export RESTRICTED_TOKEN="<上一步取得的 restricted_token>"

curl -i http://localhost:8080/api/v1/tickets \
  -H "Authorization: Bearer $RESTRICTED_TOKEN"
# 期望：HTTP 422，body: {"type":"...","title":"password_change_required",...}
```

**(3) 變更密碼**

```bash
curl -i -X POST http://localhost:8080/api/v1/auth/change-password \
  -H "Authorization: Bearer $RESTRICTED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "current_password": "Admin@InitTemp2026!",
    "new_password": "<NEW_STRONG_PASSWORD_12+>",
    "confirm_password": "<NEW_STRONG_PASSWORD_12+>"
  }'
```

**密碼規則**：長度 ≥ 12、含大寫/小寫/數字/特殊符號各一、不得與初始密碼相同、不得與前 5 次重複。

**預期回應（HTTP 200）**

```json
{
  "status": "ok",
  "must_change_password": false,
  "is_bootstrap_admin": false,
  "access_token": "eyJhbGciOi...",
  "refresh_token": "rt_...",
  "expires_in": 3600
}
```

**(4) 驗證旗標已清除**

```bash
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT email, must_change_password, is_bootstrap_admin, password_updated_at
FROM users WHERE email='admin@ticket.local';"
# 期望：must_change_password=f, is_bootstrap_admin=f, password_updated_at 非空
```

**(5) 驗證審計日誌**

```bash
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT action, actor_email, ip, created_at FROM audit_logs
WHERE action IN ('auth.login.success','password.changed')
ORDER BY created_at DESC LIMIT 5;"
```

**(6) 瀏覽器登入**

1. 開啟 `http://localhost:8080`。
2. 以新密碼登入 → 應直接進入 Dashboard。
3. 確認 **高風險橫幅已消失**（因 `is_bootstrap_admin=false`）。

### 4.10 Step 9 — 啟用 2FA

1. 以 `super_admin` 登入 → **系統設定 → 安全性**。
2. 開啟 **2FA 全域開關**（`security.2fa.enabled=true`）。
3. 設定 **強制角色**：`super_admin`、`it_manager`。
4. 為自身帳號完成 **TOTP 綁定**：
   - 掃描 QR Code（`otpauth://totp/TicketDesk:admin@ticket.local?secret=...&issuer=TicketDesk&digits=6&period=30`）。
   - 輸入 6 位驗證碼完成綁定。
   - **立即保存 10 組復原碼**（僅顯示一次）。
5. （選用）註冊 **FIDO2 / WebAuthn** 安全金鑰。
6. 登出再登入，確認 2FA 驗證生效。

**驗證指令**

```bash
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT email, two_factor_enabled, two_factor_method FROM users WHERE role IN ('super_admin','it_manager');"
```

### 4.11 Step 10 — 設定通知管道並測試

**(1) Email**

```bash
docker compose exec app node dist/cli/notify-test.js --channel=email --to=you@example.com
```

**(2) Telegram**

```bash
docker compose exec app node dist/cli/notify-test.js --channel=telegram --chat-id=-1001234567890
```

**(3) Teams**

```bash
docker compose exec app node dist/cli/notify-test.js --channel=teams
```

**(4) 驗證通知紀錄**

```bash
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "
SELECT channel, recipient, status, attempts, last_error, sent_at
FROM notification_logs ORDER BY sent_at DESC NULLS LAST LIMIT 10;"
```

**(5) 端到端驗證**：建立一張 Level 5 工單，確認 Email + Telegram + Teams 三管道皆收到，且 `notification_logs` 皆為 `sent`。

### 4.12 Step 11 — 反向代理與 TLS

**Nginx 範例（`/etc/nginx/conf.d/ticketdesk.conf`）**

```nginx
server {
    listen 80;
    server_name ticket.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ticket.example.com;

    ssl_certificate     /etc/letsencrypt/live/ticket.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ticket.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 安全標頭
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    client_max_body_size 25m;   # 附件上傳上限

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

> **重要**：`APP_URL` 必須為 `https://` 開頭，否則 Cookie `Secure` 與 SAML/OIDC 回呼會失敗。若位於反向代理後方，應用需信任 `X-Forwarded-Proto`（設定 `TRUST_PROXY=true`）。

### 4.13 Step 12 — 備份與還原

**備份（建議每日 + 每次升級前）**

```bash
# 資料庫
docker compose exec -T postgres pg_dump -U ticketdesk -Fc ticketdesk \
  > backup_$(date +%F_%H%M).dump

# Redis（AOF 已持久化，可選）
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" SAVE

# 附件（若使用 Volume）
docker run --rm -v ticketdesk_uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
```

**還原**

```bash
docker compose stop app worker
docker compose exec -T postgres dropdb -U ticketdesk ticketdesk
docker compose exec -T postgres createdb -U ticketdesk ticketdesk
docker compose exec -T postgres pg_restore -U ticketdesk -d ticketdesk < backup_2026-02-18_0300.dump
docker compose start app worker
```

**排程備份（crontab）**

```cron
0 3 * * * cd /opt/ticketdesk && docker compose exec -T postgres pg_dump -U ticketdesk -Fc ticketdesk > /backup/td_$(date +\%F).dump && find /backup -name 'td_*.dump' -mtime +30 -delete
```

**RPO / RTO 目標**：RPO ≤ 15 分鐘（建議開啟 WAL 歸檔）、RTO ≤ 1 小時。

### 4.14 Step 13 — 版本升級（Migration）

```bash
# 1) 備份
docker compose exec -T postgres pg_dump -U ticketdesk -Fc ticketdesk > pre_upgrade_$(date +%F).dump

# 2) 取得新版
git fetch --tags && git checkout v1.0.1

# 3) 檢視 migration 變更
ls -1 src/migrations/

# 4) 執行 migration（先 dry-run 若支援）
docker compose exec app npm run migrate -- --dry-run
docker compose exec app npm run migrate

# 5) 重建並滾動重啟
docker compose up -d --build
docker compose ps

# 6) 驗證
curl -fsS http://localhost:8080/healthz
```

> **向下相容性**：migration 必須遵循 **Expand-Contract** 模式（先新增欄位/表 → 部署新程式 → 再移除舊結構），確保升級期間舊版本程式仍可運作。

### 4.15 常見問題排除（Docker）

| 症狀 | 可能原因 | 處理 |
| --- | --- | --- |
| `app` 容器不斷重啟 | `.env` 缺值 / DB 未就緒 | `docker compose logs app`；確認 `DATABASE_URL` 與 `depends_on` |
| 首次啟動未建表 | `pgdata` Volume 已存在（非空） | `docker compose down -v` 後重啟（**會刪資料，請先備份**） |
| 登入後未導向改密頁 | 旗標檢查中介層順序錯誤 | 確認 §2.9 中介層順序；檢查 `must_change_password` 值 |
| 改密後仍被攔截 | 權杖未輪替 / 快取未失效 | 確認改密流程撤銷舊 Session；清除 `user:{id}:tv` 快取 |
| 通知未送達 | SMTP/Token/Webhook 設定錯誤 | 查 `notification_logs.last_error`；用 `notify-test` 驗證 |
| Telegram 429 | 發送過快 | 降低 `QUEUE_CONCURRENCY`；依 `retry_after` 重送 |
| LDAP 登入失敗 | 憑證/Filter/服務帳號權限 | 確認 LDAPS 636、CA 憑證掛載、Filter Escape |
| `healthz` 回 503 | Redis 連線失敗 | 檢查 `REDIS_PASSWORD` 與 `redis` healthcheck |

### 4.16 停機與清除

```bash
docker compose stop                 # 停止（保留資料）
docker compose down                 # 移除容器與網路（保留 Volume）
docker compose down -v              # ⚠️ 連 Volume 一併刪除（資料庫資料全毀）
```

---

## 5. 方案 B：Cloudflare Workers 邊緣網路佈署（Step-by-Step）

### 5.1 前置需求與配額

| 項目 | 需求 |
| --- | --- |
| Node.js | 20 LTS 以上 |
| Wrangler CLI | 3.x 以上（`npm i -D wrangler`） |
| Cloudflare 帳號 | 已啟用 **Workers**、**Pages**、**D1**、**Queues**、**KV** |
| 網域 | 已接入 Cloudflare（供 Workers Custom Domain / Pages） |
| 權限 | API Token 需含 `Workers Scripts:Edit`、`D1:Edit`、`Queues:Edit`、`KV:Edit`、`Pages:Edit` |

**主要限制（務必理解）**

| 限制 | 數值（依方案而異） | 影響 |
| --- | --- | --- |
| Worker CPU 時間 | 付費方案較寬（免費方案 10ms/請求） | 大量報表計算需改非同步 |
| Worker 記憶體 | 128 MB | 大檔匯出需分塊 |
| D1 單次查詢 | 有時間與大小限制 | 複雜 JOIN 需拆分 |
| D1 資料庫大小 | 依方案（免費 5GB 級） | 長期歸檔需外移（R2） |
| Queue 訊息大小 | 128 KB | 通知 envelope 需精簡 |
| Queue 批次 | `max_batch_size` / `max_batch_timeout` | 影響延遲 |
| 子請求數 | 每請求有上限 | 批次通知需注意 |

> **AD/LDAP 無法從 Workers 直連企業內網**，必須透過 **Cloudflare Tunnel**（`cloudflared`）或內部中繼 (Relay) 服務（見 §5.14）。

### 5.2 Step 1 — 安裝依賴與登入

```bash
cd ticketdesk
npm install
npx wrangler --version          # 確認 ≥ 3.x
npx wrangler login              # 瀏覽器授權
npx wrangler whoami             # 確認帳號與權限
```

### 5.3 Step 2 — 設定 `wrangler.toml`

```toml
name = "ticketdesk-api"
main = "src/worker/index.ts"
compatibility_date = "2026-01-15"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

# ---------- 非機密環境變數（機密一律用 wrangler secret） ----------
[vars]
APP_ENV = "production"
APP_NAME = "TicketDesk"
APP_URL = "https://ticket.example.com"
LOG_LEVEL = "info"
TRACE_ENABLED = "true"

# 認證
JWT_ACCESS_TTL = "3600"
JWT_REFRESH_TTL = "604800"
SESSION_COOKIE_NAME = "td_session"
SESSION_COOKIE_SECURE = "true"
SESSION_COOKIE_SAMESITE = "lax"
BCRYPT_COST = "12"

# 2FA
SECURITY_2FA_ENABLED = "true"
SECURITY_2FA_ENFORCE_ROLES = "super_admin,it_manager"
SECURITY_2FA_TOTP_ISSUER = "TicketDesk"
SECURITY_2FA_RECOVERY_CODE_COUNT = "10"
SECURITY_2FA_WEBAUTHN_RP_ID = "ticket.example.com"
SECURITY_2FA_WEBAUTHN_RP_NAME = "TicketDesk"
SECURITY_2FA_WEBAUTHN_ORIGIN = "https://ticket.example.com"

# 密碼政策
PASSWORD_MIN_LENGTH = "12"
PASSWORD_HISTORY_COUNT = "5"
LOGIN_MAX_FAILED_ATTEMPTS = "5"
LOGIN_LOCKOUT_MINUTES = "15"

# SCIM
SCIM_ENABLED = "true"
SCIM_BASE_PATH = "/scim/v2"

# 通知
SMTP_ENABLED = "true"
SMTP_HOST = "smtp.example.com"
SMTP_PORT = "587"
SMTP_SECURE = "false"
SMTP_FROM_NAME = "TicketDesk 服務台"
SMTP_FROM_ADDRESS = "no-reply@example.com"
SMTP_REPLY_TO = "support@example.com"
TELEGRAM_ENABLED = "true"
TELEGRAM_DEFAULT_CHAT_ID = "-1001234567890"
TELEGRAM_CRITICAL_TOPIC_ID = "42"
TELEGRAM_PARSE_MODE = "HTML"
TEAMS_ENABLED = "true"
NOTIFY_MAX_ATTEMPTS = "3"
NOTIFY_BACKOFF_BASE_SECONDS = "30"
NOTIFY_DEDUP_TTL_SECONDS = "86400"
NOTIFY_FAILURE_ALERT_THRESHOLD = "5"

# 排程
AUTO_CLOSE_RESOLVED_DAYS = "7"
RATE_LIMIT_DEFAULT_PER_MIN = "60"

# ---------- D1 資料庫 ----------
[[d1_databases]]
binding = "DB"
database_name = "ticketdesk-db"
database_id = "<D1_DATABASE_ID>"
migrations_dir = "src/migrations"

# ---------- Queues（非同步通知） ----------
[[queues.producers]]
binding = "NOTIFY_QUEUE"
queue = "ticketdesk-notifications"

[[queues.consumers]]
queue = "ticketdesk-notifications"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "ticketdesk-notifications-dlq"

# ---------- KV（Session / 快取 / 去重） ----------
[[kv_namespaces]]
binding = "KV"
id = "<KV_NAMESPACE_ID>"

# ---------- Cron Triggers（UTC） ----------
[triggers]
crons = ["*/5 * * * *", "0 1 * * *"]

# ---------- 環境區分 ----------
[env.staging]
name = "ticketdesk-api-staging"
vars = { APP_ENV = "staging", APP_URL = "https://staging.ticket.example.com" }

[[env.staging.d1_databases]]
binding = "DB"
database_name = "ticketdesk-db-staging"
database_id = "<STAGING_D1_DATABASE_ID>"
migrations_dir = "src/migrations"

[[env.staging.queues.producers]]
binding = "NOTIFY_QUEUE"
queue = "ticketdesk-notifications-staging"

[[env.staging.queues.consumers]]
queue = "ticketdesk-notifications-staging"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3

[[env.staging.kv_namespaces]]
binding = "KV"
id = "<STAGING_KV_NAMESPACE_ID>"
```

> **鐵則**：`wrangler.toml` **只放非機密**。`JWT_SECRET`、`SMTP_PASSWORD`、`TELEGRAM_BOT_TOKEN`、`TEAMS_WEBHOOK_URL`、`SCIM_BEARER_TOKEN`、`LDAP_BIND_PASSWORD`、`OIDC_CLIENT_SECRET` 一律用 `wrangler secret put`。

### 5.4 Step 3 — 建立 D1 資料庫

```bash
# 建立正式資料庫
npx wrangler d1 create ticketdesk-db
```

**輸出範例**

```
✅ Successfully created DB 'ticketdesk-db' in region APAC
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "ticketdesk-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

將 `database_id` 填入 `wrangler.toml` 的 `[[d1_databases]]`。

```bash
# 建立 staging 資料庫（選用）
npx wrangler d1 create ticketdesk-db-staging
```

### 5.5 Step 4 — 執行 D1 SQL（Schema / Seed / Migration）

**(1) 本機開發（`--local`，使用 Miniflare 本機 SQLite）**

```bash
npx wrangler d1 execute ticketdesk-db --local --file=./src/schema.sql
```

**(2) 遠端正式環境**

```bash
npx wrangler d1 execute ticketdesk-db --remote --file=./src/schema.sql
```

**(3) 使用 migration 機制（建議）**

```bash
# 檢視待套用的 migration
npx wrangler d1 migrations list ticketdesk-db --remote

# 套用
npx wrangler d1 migrations apply ticketdesk-db --remote

# staging
npx wrangler d1 migrations apply ticketdesk-db-staging --env staging --remote
```

**(4) 驗證 Bootstrap Admin 種子資料**

```bash
npx wrangler d1 execute ticketdesk-db --remote --command="
SELECT email, role, must_change_password, is_bootstrap_admin,
       two_factor_enabled, password_updated_at,
       substr(password_hash, 1, 7) AS hash_prefix
FROM users WHERE email = 'admin@ticket.local';"
```

**預期結果**

```
┌────────────────────┬─────────────┬──────────────────────┬────────────────────┬────────────────────┬─────────────────────┬───────────┐
│ email              │ role        │ must_change_password │ is_bootstrap_admin │ two_factor_enabled │ password_updated_at │ hash_prefix│
├────────────────────┼─────────────┼──────────────────────┼────────────────────┼────────────────────┼─────────────────────┼───────────┤
│ admin@ticket.local │ super_admin │ 1                    │ 1                  │ 0                  │ NULL                │ $2a$10$   │
└────────────────────┴─────────────┴──────────────────────┴────────────────────┴────────────────────┴─────────────────────┴───────────┘
```

> **D1 方言注意**：SQLite 無 `BOOLEAN`，以 `INTEGER 0/1` 表示；`now()` 改 `CURRENT_TIMESTAMP`；`JSONB` 改 `TEXT`（JSON 字串）；`SERIAL` 改 `INTEGER PRIMARY KEY AUTOINCREMENT`；`INTERVAL '3 days'` 改 `datetime('now','-3 days')`。這些差異由 `src/migrations/*.d1.sql` 處理。

**(5) 冪等性驗證**

```bash
# 重複執行 schema（種子採 INSERT OR IGNORE）
npx wrangler d1 execute ticketdesk-db --remote --file=./src/schema.sql

npx wrangler d1 execute ticketdesk-db --remote --command="
SELECT count(*) AS admin_count FROM users WHERE email='admin@ticket.local';"
# 期望：1
```

### 5.6 Step 5 — 建立 Queues

```bash
# 主要通知佇列
npx wrangler queues create ticketdesk-notifications

# 死信佇列（DLQ）
npx wrangler queues create ticketdesk-notifications-dlq

# staging
npx wrangler queues create ticketdesk-notifications-staging

# 檢視
npx wrangler queues list
```

> **Consumer 設定**：`max_batch_size=10`、`max_batch_timeout=5`、`max_retries=3`、`dead_letter_queue=ticketdesk-notifications-dlq`。超過 3 次失敗的訊息進入 DLQ，需人工檢視並重送。

### 5.7 Step 6 — 建立 KV Namespace

```bash
npx wrangler kv namespace create KV
# 輸出 id → 填入 wrangler.toml 的 [[kv_namespaces]]

npx wrangler kv namespace create KV --env staging
```

**用途**：Session 快取、`user:{id}:tv`（權杖版本）、通知去重鍵、速率限制計數、JWKS 快取。

### 5.8 Step 7 — 設定 Secrets 與環境變數

```bash
# 逐一設定機密（互動式輸入，不會寫入 wrangler.toml）
npx wrangler secret put JWT_SECRET
npx wrangler secret put CSRF_SECRET
npx wrangler secret put SMTP_PASSWORD
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TEAMS_WEBHOOK_URL
npx wrangler secret put SCIM_BEARER_TOKEN

# 若啟用 LDAP / OIDC / SAML
npx wrangler secret put LDAP_BIND_PASSWORD
npx wrangler secret put OIDC_CLIENT_SECRET
npx wrangler secret put SAML_SP_PRIVATE_KEY

# 檢視已設定的 secret 名稱（不含值）
npx wrangler secret list

# staging 環境
npx wrangler secret put JWT_SECRET --env staging
```

**非機密變數**：直接寫在 `wrangler.toml` 的 `[vars]`，或使用 `wrangler secret bulk` 批次匯入（適用大量變數）。

```bash
# 批次匯入範例（secrets.json 不進版控）
npx wrangler secret bulk ./secrets.json
```

### 5.9 Step 8 — 部署 Workers

```bash
# 先本機驗證（wrangler dev + local D1）
npx wrangler dev --local

# 部署至正式環境
npx wrangler deploy

# 部署至 staging
npx wrangler deploy --env staging

# 檢視部署狀態
npx wrangler deployments list
```

**輸出範例**

```
Uploaded ticketdesk-api (2.34 sec)
Deployed ticketdesk-api triggers
  https://ticketdesk-api.<subdomain>.workers.dev
  Cron Triggers: */5 * * * *, 0 1 * * *
  D1: ticketdesk-db
  Queues: ticketdesk-notifications (producer + consumer)
```

**綁定 Custom Domain（建議）**

```bash
npx wrangler deployments list
# 於 Dashboard → Workers & Pages → ticketdesk-api → Settings → Triggers → Custom Domains
# 新增 ticket.example.com（需該網域已接入 Cloudflare）
```

### 5.10 Step 9 — 部署前端（Cloudflare Pages）

```bash
# 建置前端
npm run build            # 產出 ./dist

# 首次建立 Pages 專案並部署
npx wrangler pages project create ticketdesk --production-branch=main
npx wrangler pages deploy ./dist --project-name=ticketdesk --branch=main

# 後續更新
npx wrangler pages deploy ./dist --project-name=ticketdesk
```

**環境變數（Pages）**：於 Dashboard → Pages → ticketdesk → Settings → Environment variables 設定 `VITE_API_BASE_URL=https://ticket.example.com`（前端僅能放 **非機密** 變數）。

**SPA 路由**：需設定 `_redirects` 或 `_routes.json`，將非 API 路徑導向 `index.html`：

```
# dist/_redirects
/*    /index.html   200
```

### 5.11 Step 10 — Cron Triggers

`wrangler.toml` 已宣告：

```toml
[triggers]
crons = ["*/5 * * * *", "0 1 * * *"]
```

| Cron (UTC) | 台北時間 | 任務 |
| --- | --- | --- |
| `*/5 * * * *` | 每 5 分鐘 | SLA 掃描（`at_risk` / `overdue` 判定與通知） |
| `0 1 * * *` | 每日 09:00 | 「超過 3 天未結案」積壓報表寄送 `it_manager` + Teams 摘要 |

**Worker 內排程處理（示意）**

```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(runSlaScan(env));          // SLA 掃描
    } else if (event.cron === "0 1 * * *") {
      ctx.waitUntil(sendAgingDigest(env));     // 積壓報表
    }
  },
  async fetch(req: Request, env: Env) { /* API 路由 */ },
  async queue(batch: MessageBatch<NotifyJob>, env: Env) { /* 通知消費者 */ }
};
```

> **注意**：Cron 時間為 **UTC**；`0 1 * * *` = 台北 09:00（無日光節約）。若客戶位於其他時區，請調整 cron 或於程式中換算。

### 5.12 Step 11 — 驗證部署

```bash
# 1) 健康檢查
curl -fsS https://ticket.example.com/healthz | jq .

# 2) 登入頁可存取
curl -I https://ticket.example.com/

# 3) 安全標頭檢查
curl -sI https://ticket.example.com/ | grep -Ei 'strict-transport|content-security|x-frame|x-content-type'

# 4) D1 連線（透過 API 查詢健康端點）
curl -fsS https://ticket.example.com/healthz | jq '.checks.database'

# 5) Queue 測試（送一則測試通知）
curl -X POST https://ticket.example.com/api/v1/admin/notifications/test \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"telegram"}'

# 6) 檢視 Queue 指標
npx wrangler queues info ticketdesk-notifications
```

### 5.13 Step 12 — 首次登入與強制改密（Cloudflare）

流程與 §4.9 完全相同，僅網域不同：

```bash
# 登入（取得受限權杖）
curl -i -X POST https://ticket.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ticket.local","password":"Admin@InitTemp2026!"}'

# 驗證改密前封鎖
curl -i https://ticket.example.com/api/v1/tickets \
  -H "Authorization: Bearer $RESTRICTED_TOKEN"
# 期望 422 password_change_required

# 變更密碼
curl -i -X POST https://ticket.example.com/api/v1/auth/change-password \
  -H "Authorization: Bearer $RESTRICTED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password":"Admin@InitTemp2026!","new_password":"<NEW_STRONG_PASSWORD>","confirm_password":"<NEW_STRONG_PASSWORD>"}'

# 驗證旗標
npx wrangler d1 execute ticketdesk-db --remote --command="
SELECT email, must_change_password, is_bootstrap_admin, password_updated_at
FROM users WHERE email='admin@ticket.local';"
```

### 5.14 AD / LDAP 於邊緣環境的連線方案

Workers **無法** 直接連線企業內網的 LDAP/AD。提供兩種方案：

**方案 1：Cloudflare Tunnel（建議）**

```
[Workers] ──HTTPS──▶ [Cloudflare Edge] ──Tunnel──▶ [cloudflared] ──LDAPS──▶ [Domain Controller]
```

1. 於內網部署 `cloudflared`：

```bash
cloudflared tunnel login
cloudflared tunnel create ticketdesk-ldap
cloudflared tunnel route dns ticketdesk-ldap ldap-relay.ticket.example.com
```

2. `config.yml`：

```yaml
tunnel: ticketdesk-ldap
credentials-file: /etc/cloudflared/<tunnel-id>.json
ingress:
  - hostname: ldap-relay.ticket.example.com
    service: tcp://dc01.corp.example.com:636
  - service: http_status:404
```

3. 啟動：

```bash
cloudflared tunnel run ticketdesk-ldap
```

4. Worker 端以 **LDAP over TLS 中繼** 呼叫（需自訂 TCP 轉 HTTP 中繼，或使用內部 Relay 服務）。

**方案 2：內部 Relay 服務（LDAP Gateway）**

於 DMZ 部署一支輕量 LDAP Gateway（Node.js / Go），提供 `POST /ldap/authenticate` 與 `GET /ldap/users/{id}`，僅允許來自 Cloudflare 的 IP 範圍（或使用 mTLS + Cloudflare Access Service Token）。Worker 以 HTTPS 呼叫此 Gateway。

> **安全要求**：Relay 必須 (1) 僅允許 Cloudflare IP / Service Token；(2) 強制 TLS；(3) 限制查詢範圍（Base DN 白名單）；(4) 記錄所有查詢審計日誌；(5) 速率限制。

### 5.15 Cloudflare 限制與注意事項

| 限制 | 影響 | 緩解 |
| --- | --- | --- |
| Worker CPU 時間 | 大量報表計算可能逾時 | 改走 Queue 非同步任務；分頁處理 |
| D1 查詢限制 | 複雜 JOIN / 大結果集受限 | 拆分查詢、加索引、預先聚合 |
| D1 大小上限 | 長期資料成長 | 審計日誌/通知紀錄歸檔至 R2 |
| Queue 訊息 128 KB | envelope 過大 | 僅傳 ID + 必要欄位，Consumer 回查 D1 |
| 無長連線 | 無法維持 WebSocket 長連線 | 改用 SSE / 輪詢 |
| 無本地檔案系統 | 附件儲存 | 使用 **R2** 物件儲存 + 預簽 URL |
| LDAP 無法直連 | 認證受限 | Tunnel / Relay（§5.14） |
| Cron 為 UTC | 時區換算 | 程式內換算或調整 cron |

### 5.16 常見問題排除（Cloudflare）

| 症狀 | 可能原因 | 處理 |
| --- | --- | --- |
| `wrangler deploy` 失敗：`database_id` 無效 | 未填入 D1 ID | 執行 `wrangler d1 list` 取得正確 ID |
| API 回 500 `D1_ERROR: no such table` | 未執行 schema | `wrangler d1 execute ... --remote --file=./src/schema.sql` |
| 登入 500 | `JWT_SECRET` 未設定 | `wrangler secret put JWT_SECRET` |
| 通知未送達 | Queue consumer 未部署 / secret 缺 | `wrangler queues info`；`wrangler tail` 檢視錯誤 |
| `wrangler tail` 無日誌 | 未啟用 observability | 於 `wrangler.toml` 加 `[observability] enabled = true` |
| Cookie 未設定 | `APP_URL` 非 https / 網域不符 | 確認 Custom Domain 與 `SESSION_COOKIE_SECURE=true` |
| Cron 未觸發 | cron 語法錯誤 / 未部署 | `wrangler deployments list` 確認 triggers |
| D1 查詢逾時 | 缺索引 / 全表掃描 | 依 PRD §7.3 建立索引；改用 `EXPLAIN QUERY PLAN` |

---

## 6. 共通安全性規範

### 6.1 零信任與網路

1. **預設拒絕**：所有端點預設需認證；僅 `/healthz`、`/api/v1/auth/*`、`/scim/v2/*`（需 Bearer）為公開或半公開。
2. **網路分段**：資料庫與 Redis 僅內網可達；對外僅開放 443。
3. **反向代理 / WAF**：正式環境必須置於反向代理（Nginx / Cloudflare）之後，啟用 WAF 與 DDoS 防護。
4. **管理介面保護**：`/admin` 路徑建議加 IP 白名單或 Cloudflare Access。
5. **最小權限**：容器以非 root 使用者執行；資料庫帳號僅授予必要權限（禁 `SUPERUSER`）。

### 6.2 機密管理

| 項目 | 要求 |
| --- | --- |
| 儲存 | Docker：`.env`（`chmod 600`）或 Docker Secrets；Cloudflare：`wrangler secret` |
| 版控 | `.env`、`.wrangler/`、`secrets.json`、`*.pem`、`*.key` **一律列入 `.gitignore`** |
| 掃描 | CI 加入 `gitleaks` / `trufflehog`，偵測明文密碼與金鑰 |
| 輪替 | JWT_SECRET 每 90 天；SMTP/Telegram/Teams 憑證每 180 天或洩漏即換 |
| 權限 | 僅維運與 SAr 可讀取正式環境機密；操作需留審計 |

### 6.3 應用安全標頭

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cache-Control: no-store   (僅限 API 回應與敏感頁面)
```

### 6.4 認證與授權

1. **密碼**：bcrypt（cost ≥ 10，建議 12）；長度 ≥ 12；四類字元；歷史 5 次不可重用。
2. **鎖定**：連續失敗 5 次鎖定 15 分鐘；啟用指數退避。
3. **2FA**：`super_admin` / `it_manager` 強制；復原碼僅存雜湊。
4. **Session**：HttpOnly + Secure + SameSite；改密/角色變更/停用即撤銷。
5. **RBAC**：Deny by Default；物件層級授權必須在 **查詢層** 施加 `WHERE` 條件。
6. **IDOR 防護**：越權存取一律回傳 `404`（非 `403`），避免存在性洩漏。
7. **內部備忘隔離**：`internal_note` 永不對 `end_user` / `vendor` 顯示；API 以 `visibility` 過濾。
8. **API Token**：Scope 最小化、設定到期日、記錄 `last_used_at`、可撤銷。
9. **速率限制**：預設 60 req/min（依 Token / IP）；超限 `429` + `Retry-After`。
10. **冪等**：`POST /tickets` 支援 `Idempotency-Key` / `external_id`。

### 6.5 資料保護

1. **傳輸**：全站 TLS 1.2+；HSTS 啟用；內部服務間亦建議 TLS。
2. **儲存**：資料庫磁碟加密；敏感欄位（電話、身分證號）欄位級加密或遮罩。
3. **附件**：型別白名單（PDF/DOCX/XLSX/PNG/JPG）、大小上限 25MB、**病毒掃描**（ClamAV / 雲端掃描）、儲存於非 Web 根目錄（Docker）或 R2（Cloudflare）。
4. **匯出**：依角色遮罩敏感欄位；匯出動作寫入審計；下載連結有效期 24 小時。
5. **備份**：加密備份（`pg_dump` + GPG / R2 加密）；異地保存；定期還原演練。

### 6.6 審計與監控

| 項目 | 要求 |
| --- | --- |
| 審計日誌 | 保存 365 天；不可由一般介面刪除；含 `trace_id` |
| 應用日誌 | 結構化 JSON；敏感欄位遮罩；集中收集（Loki / CloudWatch / Logpush） |
| 指標 | `/metrics`（Prometheus）或 Workers Analytics；佇列深度、失敗率、API 延遲 |
| 告警 | 通知失敗 ≥ 5 次、佇列深度 > 1000、5xx 率 > 1%、憑證到期前 30 天 |
| 健康檢查 | `/healthz` 供 LB / 監控探測 |

### 6.7 備份與災難復原

| 項目 | 目標 |
| --- | --- |
| RPO | ≤ 15 分鐘（Postgres WAL 歸檔 / D1 Time Travel） |
| RTO | ≤ 1 小時 |
| 備份頻率 | 每日全量 + 每 15 分鐘增量（或 WAL） |
| 保留 | 每日 30 天、每月 12 個月 |
| 演練 | 每季一次還原演練並記錄 |

**D1 備份**：使用 **Time Travel**（`wrangler d1 time-travel`）或定期 `wrangler d1 export` 匯出 SQL。

```bash
npx wrangler d1 export ticketdesk-db --remote --output=backup_$(date +%F).sql
```

### 6.8 弱點管理與 CI 檢查

```yaml
# .github/workflows/security.yml（示意）
name: security
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Secret scan
        uses: gitleaks/gitleaks-action@v2
      - name: Dependency audit
        run: npm audit --audit-level=high
      - name: SAST
        uses: github/codeql-action/analyze@v3
```

**必檢項目**：明文密碼、依賴高風險 CVE、SQL Injection、LDAP Filter Injection、XSS、SSRF（Webhook URL 驗證）、IDOR。

### 6.9 合規檢查表

- [ ] 全站 TLS 1.2+ 與 HSTS
- [ ] 密碼 bcrypt（cost ≥ 10）
- [ ] 2FA 對管理角色強制
- [ ] 審計日誌保存 ≥ 365 天且不可刪除
- [ ] 預設管理員已改密或停用
- [ ] 機密未進版控（CI 掃描通過）
- [ ] 資料庫與 Redis 未對外暴露
- [ ] 備份與還原演練完成
- [ ] 弱點掃描零 Critical / 零 High 未解
- [ ] 通知內容不含內部備忘

---

## 7. 上線檢查清單 (Go-Live Checklist)

### 7.1 共通

- [ ] `APP_ENV=production`、`APP_URL` 為 `https://`
- [ ] 所有 `CHANGE_ME` 已替換（`grep -n 'CHANGE_ME' .env`）
- [ ] `JWT_SECRET` ≥ 64 字元隨機值
- [ ] TLS 憑證有效（到期日 > 30 天）且 HSTS 啟用
- [ ] 資料庫與 Redis 僅內網可達
- [ ] 備份排程已設定並完成一次還原演練
- [ ] 監控與告警已接入（佇列深度、失敗率、5xx）
- [ ] 審計日誌可查詢且保存期 ≥ 365 天

### 7.2 身分驗證

- [ ] Bootstrap Admin 已改密（`must_change_password=false`）
- [ ] Bootstrap Admin 已停用或改為正式管理帳號（`is_bootstrap_admin=false`）
- [ ] 2FA 全域開關已啟用，`super_admin` / `it_manager` 已綁定
- [ ] 復原碼已列印/保存於安全位置
- [ ] AD/LDAP 連接器測試通過（停用帳號被拒）
- [ ] SAML / OIDC 登入測試通過（SP 與 IdP 發起）
- [ ] SCIM 佈建測試通過（`active=false` 後 session 立即失效）
- [ ] 密碼政策與鎖定機制驗證通過
- [ ] 登入失敗訊息不洩漏帳號存在性

### 7.3 工單與報表

- [ ] Help Topics 與 Ticket Forms 已建立並綁定 SLA
- [ ] 自訂欄位（12 種型別）驗證通過
- [ ] SLA 掃描 Cron 正常運作（`at_risk` / `overdue` 通知）
- [ ] 「超過 3 天未結案」篩選筆數與 SQL 基準查詢一致（72 小時邊界不計入）
- [ ] 報表匯出（CSV/XLSX/PDF）筆數與畫面一致
- [ ] Dashboard 9 項 Widget 資料正確

### 7.4 權限與通知

- [ ] RBAC 角色與團隊已建立，多餘 `super_admin` 已移除
- [ ] `vendor` / `end_user` 越權存取回傳 `404`（IDOR 測試通過）
- [ ] `internal_note` 對外部角色不可見
- [ ] Email 測試信送達（SPF/DKIM/DMARC 通過）
- [ ] Telegram 測試訊息送達（含 Topic）
- [ ] Teams 測試卡片送達
- [ ] 通知失敗重試與告警機制驗證
- [ ] 通知內容不含內部備忘

### 7.5 佈署軌道專屬

**Docker**

- [ ] `docker compose ps` 全部 `healthy`
- [ ] `pgdata` / `redisdata` Volume 已建立且持久化
- [ ] `src/schema.sql` 掛載路徑正確
- [ ] 容器重啟後種子資料未被覆蓋（冪等性驗證）
- [ ] 反向代理與安全標頭設定完成

**Cloudflare**

- [ ] `wrangler d1 execute` 成功且資料表存在
- [ ] `wrangler secret list` 顯示所有必要機密
- [ ] `wrangler deploy` 成功且 Custom Domain 生效
- [ ] Pages 部署成功且 SPA 路由正常
- [ ] Queues producer/consumer 綁定正確
- [ ] Cron Triggers 已註冊且測試觸發成功
- [ ] `wrangler tail` 可觀測日誌

---

## 8. 驗收條件對照

### 8.1 AC-DEPLOY-01（Docker）

| 驗收項 | 驗證方式 | 通過標準 |
| --- | --- | --- |
| 啟動後可登入 | `docker compose up -d` → 瀏覽器登入 | **3 分鐘內** 可進入登入頁並完成登入 |
| 健康檢查 | `curl /healthz` | `status=ok`，`database`/`redis`/`queue` 皆 `ok` |
| 種子資料 | SQL 查詢 `admin@ticket.local` | 1 筆、`super_admin`、`must_change_password=TRUE`、`is_bootstrap_admin=TRUE` |
| 冪等性 | 重啟容器後查詢 | 仍 1 筆、密碼未被重置 |
| 強制改密 | 登入後檢查導向 | 導向 `/change-password` 或 `422 password_change_required` |
| 改密前封鎖 | 以受限權杖呼叫業務 API | 一律 `422`，無業務資料 |
| 改密後可用 | 改密後登入 | 進入 Dashboard，旗標已清除 |

### 8.2 AC-DEPLOY-02（Cloudflare）

| 驗收項 | 驗證方式 | 通過標準 |
| --- | --- | --- |
| API 可用 | `curl https://.../healthz` | `status=ok` |
| D1 migration | `wrangler d1 execute` / `migrations apply` | 無錯誤，資料表齊備 |
| 種子資料 | D1 查詢 | 1 筆、旗標正確 |
| Queues 通知 | 觸發測試通知 | `notification_logs.status='sent'` |
| Cron Triggers | 等待或手動觸發 | SLA 掃描與積壓報表執行 |
| 前端 | 瀏覽器開啟 Pages 網址 | 登入頁正常、SPA 路由正常 |
| 強制改密 | 登入後檢查 | 導向改密頁 / `422` |

---

## 9. 附錄

### 9.1 環境變數總表

| 分類 | 變數 | 必填 | 機密 | 說明 |
| --- | --- | --- | --- | --- |
| 執行 | `APP_ENV` | ✅ | ❌ | `development` / `staging` / `production` |
| 執行 | `APP_URL` | ✅ | ❌ | 對外網址（必須 `https://`） |
| 執行 | `APP_PORT` | ✅ | ❌ | 預設 `8080` |
| 執行 | `TZ` | ✅ | ❌ | 例 `Asia/Taipei` |
| 執行 | `LOG_LEVEL` | ✅ | ❌ | `debug`/`info`/`warn`/`error` |
| 資料庫 | `DATABASE_URL` | ✅ | ✅ | Postgres 連線字串 |
| 資料庫 | `POSTGRES_PASSWORD` | ✅ | ✅ | 強密碼 |
| Redis | `REDIS_URL` | ✅ | ✅ | 含密碼 |
| 認證 | `JWT_SECRET` | ✅ | ✅ | ≥ 64 字元隨機 |
| 認證 | `JWT_ACCESS_TTL` | ✅ | ❌ | ≤ 3600 秒 |
| 認證 | `JWT_REFRESH_TTL` | ✅ | ❌ | 預設 604800 秒 |
| 認證 | `SESSION_COOKIE_SECURE` | ✅ | ❌ | 正式環境 `true` |
| 認證 | `BCRYPT_COST` | ✅ | ❌ | ≥ 10（建議 12） |
| 2FA | `SECURITY_2FA_ENABLED` | ✅ | ❌ | 全域開關 |
| 2FA | `SECURITY_2FA_ENFORCE_ROLES` | ✅ | ❌ | 強制角色清單 |
| 2FA | `SECURITY_2FA_WEBAUTHN_RP_ID` | ✅ | ❌ | 網域（不含 scheme） |
| 密碼 | `PASSWORD_MIN_LENGTH` | ✅ | ❌ | ≥ 12 |
| 密碼 | `LOGIN_MAX_FAILED_ATTEMPTS` | ✅ | ❌ | 預設 5 |
| LDAP | `LDAP_URL` | 條件 | ❌ | `ldaps://...:636` |
| LDAP | `LDAP_BIND_PASSWORD` | 條件 | ✅ | 服務帳號密碼 |
| LDAP | `LDAP_GROUP_ROLE_MAP` | 條件 | ❌ | JSON 映射 |
| SAML | `SAML_IDP_CERT_PATH` | 條件 | ❌ | IdP 憑證路徑 |
| SAML | `SAML_SP_PRIVATE_KEY_PATH` | 條件 | ✅ | SP 私鑰路徑 |
| OIDC | `OIDC_CLIENT_SECRET` | 條件 | ✅ | Client Secret |
| SCIM | `SCIM_BEARER_TOKEN` | 條件 | ✅ | 佈建權杖 |
| Email | `SMTP_PASSWORD` | 條件 | ✅ | SMTP 密碼 |
| Telegram | `TELEGRAM_BOT_TOKEN` | 條件 | ✅ | Bot Token |
| Teams | `TEAMS_WEBHOOK_URL` | 條件 | ✅ | Webhook URL |
| 佇列 | `NOTIFY_MAX_ATTEMPTS` | ✅ | ❌ | 預設 3 |
| 佇列 | `NOTIFY_DEDUP_TTL_SECONDS` | ✅ | ❌ | 預設 86400 |
| 安全 | `RATE_LIMIT_DEFAULT_PER_MIN` | ✅ | ❌ | 預設 60 |

### 9.2 指令速查

**Docker**

```bash
docker compose up -d --build            # 建置並啟動
docker compose ps                       # 狀態
docker compose logs -f app              # 追蹤日誌
docker compose exec app npm run migrate # 執行 migration
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk -c "\dt"
docker compose restart app              # 重啟
docker compose down                     # 停止（保留資料）
docker compose down -v                  # 停止並刪資料（危險）
```

**Cloudflare**

```bash
npx wrangler login
npx wrangler d1 create ticketdesk-db
npx wrangler d1 execute ticketdesk-db --remote --file=./src/schema.sql
npx wrangler d1 migrations apply ticketdesk-db --remote
npx wrangler d1 execute ticketdesk-db --remote --command="SELECT count(*) FROM users;"
npx wrangler queues create ticketdesk-notifications
npx wrangler kv namespace create KV
npx wrangler secret put JWT_SECRET
npx wrangler secret list
npx wrangler deploy
npx wrangler pages deploy ./dist --project-name=ticketdesk
npx wrangler tail
npx wrangler d1 export ticketdesk-db --remote --output=backup.sql
```

### 9.3 故障排除矩陣

| 現象 | 檢查順序 | 常見根因 |
| --- | --- | --- |
| 無法登入 | 1. `/healthz` → 2. `users.is_active` → 3. `locked_until` → 4. 連接器設定 | 帳號鎖定 / 連接器停用 / 密碼錯誤 |
| 登入後被導向改密頁 | 1. `must_change_password` → 2. 中介層順序 | 旗標為 TRUE（正常行為） |
| 改密後仍被攔截 | 1. 權杖是否輪替 → 2. `user:{id}:tv` 快取 | 舊權杖未撤銷 / 快取未失效 |
| 2FA 驗證失敗 | 1. 伺服器時間（NTP）→ 2. 步長設定 | 時鐘偏移超過 ±1 步長 |
| 工單列表為空 | 1. RBAC 可見範圍 → 2. `team_id`/`assignee_id` | 權限條件過嚴 / 未指派 |
| 「3 天未結案」筆數不符 | 1. 時區 → 2. 邊界條件（`>` vs `>=`） | 口徑不一致 / 未共用 Service |
| 通知未送達 | 1. `notification_logs.last_error` → 2. 管道設定 → 3. 佇列深度 | 憑證錯誤 / 429 / consumer 停擺 |
| 佇列堆積 | 1. consumer 狀態 → 2. 管道速率限制 | consumer 崩潰 / 外部 API 限流 |
| D1 查詢逾時 | 1. 索引 → 2. 查詢計畫 | 全表掃描 / 缺索引 |
| 附件上傳失敗 | 1. 大小限制 → 2. 型別白名單 → 3. 儲存空間 | 超過 25MB / 非白名單型別 |

### 9.3.1 通知範本可用變數

| 變數 | 說明 |
| --- | --- |
| `%{ticket.number}` | 工單編號（如 `TCK-2026-000123`） |
| `%{ticket.subject}` | 主旨 |
| `%{ticket.status}` | 狀態（經 Glossary 翻譯） |
| `%{ticket.priority}` | 優先級（Level 1~5） |
| `%{ticket.url}` | 工單連結 |
| `%{ticket.assignee.name}` | 指派對象 |
| `%{ticket.requester.name}` | 請求者 |
| `%{sla.first_response_due_at}` | 首次回應期限 |
| `%{sla.resolution_due_at}` | 結案期限 |
| `%{sla.status}` | SLA 狀態 |
| `%{user.first_name}` | 收件者名字 |
| `%{help_topic.name}` | 服務類別 |

> **禁止** 在通知範本中使用 `%{thread.internal_note}` 或任何 `visibility=internal` 欄位。

### 9.4 版本紀錄

| 版本 | 日期 | 變更 |
| --- | --- | --- |
| v1.0.0 | 2026-02-18 | 初版發布：雙軌佈署指南、認證架構、通知佇列設計、安全規範、上線檢查清單 |

---

**文件結束 — DEP-TD-001 v1.0.0**
