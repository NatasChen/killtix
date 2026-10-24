# 產品需求規格書 (PRD) — TicketDesk 企業級 ITSM 工單管理平台

| 項目 | 內容 |
| --- | --- |
| 文件編號 | PRD-TD-001 |
| 版本 | **v1.0.0** |
| 文件狀態 | 初版發布 (Baseline / Frozen for Dev) |
| 建立日期 | 2026-02-18 |
| 文件擁有者 | 產品需求專案經理 (PM) |
| 審閱者 | 系統架構師 (SAr)、資深全端工程師 (PG)、品質測試與資安工程師 (QA) |
| 關聯文件 | `README.md`、`CHANGELOG.md`、`docs/DEPLOYMENT_GUIDE.md`、`docs/QA_TEST_PLAN.md`、`src/server/db/schema.ts`、`drizzle/`（migrations）、`docs/openapi.json` |

---

> **實作狀態（2026-10-24，v0.2.0）**：本文件是需求基線。Docker 版 MVP 已實作並通過自動化測試；
> AD/LDAP/SAML/OIDC/SCIM、FIDO2、附件、SLA 營業時間與 Cloudflare 方案尚未實作。
> 與本文件不同的決策（預設管理員密碼、403 回應碼、3 天邊界）見 [`specs/DECISIONS.md`](../specs/DECISIONS.md)。


## 1. 文件目的與範圍

### 1.1 目的
本文件定義 TicketDesk 平台 v1.0.0 的完整產品需求，作為開發、測試、佈署與驗收的唯一基準（Single Source of Truth）。內容涵蓋：

1. 身分驗證與資訊安全需求（AD / LDAP / SAML 2.0 / OIDC / SCIM / 2FA）。
2. 工單核心機制（參考 osTicket 成熟模組：Help Topics、SLA Plans、Ticket Threading、Canned Responses、自訂表單欄位）。
3. 報表與儀表板（含「超過 3 天未結案」精確篩選之必備能力）。
4. RBAC 權限模型與多管道通知（Email / Telegram Bot / Microsoft Teams Webhook）。
5. 使用者體驗（Glossary 多語系架構、Light / Dark 主題）。
6. 雙軌佈署方案（Docker 容器化、Cloudflare 邊緣網路）。
7. GitHub 專案門面規範。

### 1.2 範圍界定

| 類別 | 內容 |
| --- | --- |
| **In Scope（v1.0.0 必交付）** | 本文件第 6 章全部 FR 項目、第 9 章全部驗收條件、雙軌佈署、預設臨時管理員與強制改密流程 |
| **Out of Scope（v1.0.0 不交付）** | 完整 CMDB 資產盤點、計費/帳務模組、客服即時交談 (Live Chat)、原生行動 App、AI 自動分派工單、知識庫全文語意檢索 |
| **後續版本候選 (Backlog)** | Slack 通知、工單滿意度調查 (CSAT)、多租戶 (Multi-tenant)、SLA 預警自動升級規則引擎 |

### 1.3 需求優先級定義
- **P0（Must）**：v1.0.0 阻斷性需求，未完成不得發佈。
- **P1（Should）**：v1.0.0 應完成，若時程受限可延至 v1.0.1，但需 PM 書面核准。
- **P2（Could）**：加分項，不影響發佈。

---

## 2. 產品概述

### 2.1 背景與痛點
企業 IT 服務台目前面臨：

1. **入口分散**：資安監控 (SOC)、IT 支援、人資服務各自使用不同表單與信箱，事件無法統一追蹤。
2. **時效不可控**：缺乏 SLA 到期與逾時預警，工單長期滯留，管理層無法掌握「超過 3 天未結案」的積壓量。
3. **權限邊界模糊**：外部廠商與一般使用者可能讀取到非關聯工單，存在 IDOR 越權風險。
4. **通知斷點**：僅有 Email 通知，值班工程師無法即時於 Telegram / Teams 收到指派訊息。
5. **佈署門檻高**：無法同時滿足「地端自架」與「邊緣低成本」兩種客戶情境。

### 2.2 產品定位
TicketDesk 是一套 **API-First、雙軌佈署、企業級權限** 的 ITSM 工單管理平台，提供統一的服務請求入口、可自訂表單、SLA 時效治理、多管道通知與可稽核的安全機制。

### 2.3 產品目標與成功指標 (KPI)

| 目標 | 指標 | v1.0.0 驗收門檻 |
| --- | --- | --- |
| 統一入口 | 外部系統透過 REST API 開單成功率 | ≥ 99.5%（壓測 100 RPS） |
| 時效治理 | SLA 到期前預警觸發率 | 100%（誤差 ≤ 60 秒） |
| 積壓可視化 | 「超過 3 天未結案」篩選結果與 DB 查詢一致率 | 100%（筆數零誤差） |
| 安全合規 | 預設臨時管理員首次登入強制改密執行率 | 100%（不可繞過） |
| 通知可靠度 | 通知投遞成功率（含重試） | ≥ 99%（24 小時觀測） |
| 使用者體驗 | 語系字串覆蓋率 / 主題切換可用性 | 100% / 無閃爍 (FOUC) |

---

## 3. 名詞定義 (Glossary)

| 名詞 | 定義 |
| --- | --- |
| **Help Topic** | 服務類別（如「帳號權限申請」、「資安事件通報」），決定該類工單使用的表單、SLA Plan 與預設指派團隊 |
| **SLA Plan** | 服務時效政策，定義首次回應時間 (First Response) 與結案時間 (Resolution) 的目標與逾時動作 |
| **Ticket Thread** | 工單對話串，區分「對外回覆 (Customer Visible)」與「內部備忘 (Internal Note)」 |
| **Canned Response** | 預先撰寫的回覆範本，支援變數插值（如 `%{ticket.assignee}`） |
| **Custom Field** | 自訂表單欄位，隸屬於 Ticket Form，支援多種型別與可見性控制 |
| **Tag** | 工單標籤，多對多關聯，可作為篩選與報表維度 |
| **RBAC** | 角色為基礎的存取控制 (Role-Based Access Control) |
| **SCIM** | System for Cross-domain Identity Management，用於使用者/群組自動化佈建 |
| **must_change_password** | 使用者旗標，為 `TRUE` 時除改密與登出外，所有功能與 API 均被攔截 |
| **Bootstrap Admin** | 初次佈署時由種子資料 (Seed) 建立的臨時系統管理員 |
| **Aging（工單存續天數）** | 自工單建立時間起算，至查詢當下之經過時間，用於「超過 3 天未結案」判定 |

---

## 4. 使用者角色與權限範圍

| 角色 (Role Key) | 說明 | 工單可見範圍 | 主要權限 |
| --- | --- | --- | --- |
| `super_admin` | 系統管理員（含 Bootstrap Admin） | 全部工單 | 全功能：使用者/角色管理、SLA/Help Topic/表單設計、系統設定、報表全覽、審計日誌 |
| `it_manager` | IT 服務主管 | 全部工單（唯讀 + 指派） | 報表全覽、SLA 監控、指派與升級、不可變更系統設定 |
| `agent` | 內部工程師 | 被指派 + 所屬團隊佇列 + 追蹤中 (CC) 之工單 | 回覆、內部備忘、狀態流轉、使用 Canned Responses |
| `vendor` | 外部廠商 | **僅**被指派或明確關聯（CC/Watcher）之工單 | 回覆（對外）、檢視自身工單、不可見內部備忘、不可見他人工單 |
| `end_user` | 一般使用者 | **僅**自己提出或被關聯之工單 | 開單、回覆、檢視狀態、不可見內部備忘與內部欄位 |
| `api_client` | 外部系統（如 SOC） | 依 API Token 綁定之 Scope | 建立工單、查詢自身建立之工單、不可存取使用者管理 |

> **權限設計原則**：預設拒絕 (Deny by Default)、最小權限 (Least Privilege)、物件層級授權 (Object-Level Authorization) 必須在 **查詢層** 即施加 `WHERE` 條件，嚴禁僅依賴前端隱藏。

---

## 5. 系統架構總覽

### 5.1 邏輯分層
1. **Edge / Presentation**：Web 前端（SPA，Light/Dark 主題）、REST API Gateway。
2. **Application**：身分驗證服務、工單服務、SLA 引擎、報表服務、通知服務、i18n Glossary 服務。
3. **Data**：主資料庫（PostgreSQL 16 / Cloudflare D1）、快取與佇列（Redis 7 / Cloudflare Queues）、物件儲存（附件）。
4. **Integration**：AD/LDAP/SAML/OIDC/SCIM 連接器、Email SMTP、Telegram Bot API、Microsoft Teams Incoming Webhook。

### 5.2 雙軌佈署對照

| 構面 | 方案 A：Docker 容器化 | 方案 B：Cloudflare 邊緣網路 |
| --- | --- | --- |
| 運算 | App 容器（Node.js / Python 皆可，依實作） | Cloudflare Workers |
| 前端 | 容器內靜態服務 | Cloudflare Pages |
| 資料庫 | PostgreSQL 16（Volume 持久化） | Cloudflare D1（SQLite 相容） |
| 佇列/快取 | Redis 7（BullMQ / Celery） | Cloudflare Queues + KV |
| 排程 | 容器內 Cron / Worker Process | Cron Triggers |
| 適用情境 | 地端、內網、需 LDAP 直連、資料落地要求 | 全球低延遲、免維運、成本敏感 |
| 限制 | 需自行維運與備份 | Workers 執行時間/連線限制；LDAP 需經由 Tunnel 或中繼服務 |

### 5.3 架構圖概念

```
                    ┌──────────────────────────────────────────┐
                    │        Clients / Integrations            │
                    │  Web UI │ SOC 系統 │ Email │ Telegram/Teams│
                    └───────┬─────────────┬────────────────────┘
                            │             │
              ┌─────────────▼───┐   ┌─────▼──────────────┐
              │  REST API / BFF │   │  Webhook Dispatcher │
              │  (Auth Guard)   │   │  (Retry + Idempotent)│
              └────────┬────────┘   └──────┬─────────────┘
                       │                   │
   ┌───────────────────▼───────────────────▼───────────────────┐
   │                    Application Services                    │
   │  Auth(AD/LDAP/SAML/OIDC/SCIM/2FA) │ Ticket │ SLA │ Report  │
   │  RBAC Policy Engine │ i18n Glossary │ Notification Service │
   └───────────┬───────────────────────────────┬───────────────┘
               │                               │
      ┌────────▼────────┐            ┌─────────▼─────────┐
      │ PostgreSQL / D1 │            │ Redis / Queues    │
      │ (schema.sql)    │            │ (async jobs)      │
      └─────────────────┘            └───────────────────┘
```

---

## 6. 功能需求 (Functional Requirements)

### FR-1 身分驗證與安全

#### FR-1.1 多協定身分驗證（P0）
系統必須支援以下身分來源，且可於管理介面以「連接器 (Connector)」形式啟用/停用：

| 協定 | 用途 | 關鍵需求 | 驗收要點 |
| --- | --- | --- | --- |
| **Active Directory** | 企業內部網域帳號 | 支援 LDAP over TLS (LDAPS 636)、以 sAMAccountName / UPN 綁定 | 網域帳號可登入；停用帳號 (disabled) 登入被拒 |
| **LDAP** | 通用目錄服務 | 可設定 Base DN、Filter、Attribute Mapping、Group→Role 映射 | 群組變更後於下次登入生效 |
| **SAML 2.0** | 企業 SSO（IdP 發起/SP 發起） | 支援 SP-initiated 與 IdP-initiated、簽章憑證輪替、Attribute 映射 | 憑證過期時有明確錯誤訊息且不誤放行 |
| **OIDC** | 現代 SSO（Azure AD / Okta / Keycloak） | 支援 Authorization Code + PKCE、`id_token` 驗證 (iss/aud/exp/nonce) | 偽造 token 被拒並記錄審計 |
| **SCIM 2.0** | 使用者/群組自動佈建 | 提供 `/scim/v2/Users`、`/scim/v2/Groups` 之 GET/POST/PATCH/DELETE；支援離職自動停用 | 停用 (active=false) 後該使用者 session 立即失效 |

**共通規則**
- 本地帳號 (Local Auth) 與外部 IdP 可並存；同一 Email 若來自多來源，須以 `identity_provider` 區分，禁止自動合併覆蓋。
- 登入失敗訊息不得洩漏帳號是否存在（統一為「帳號或密碼錯誤」）。
- 所有登入、登出、失敗、鎖定事件須寫入審計日誌。

#### FR-1.2 2FA 全域開關（P0）
- 管理員可於「系統設定 → 安全性」切換 **全域 2FA 開關**（`security.2fa.enabled`）。
- 支援方法：**TOTP**（RFC 6238，30 秒步長、6 位數）與 **FIDO2 / WebAuthn**（平台/漫遊金鑰）。
- 開關行為：
  - **啟用時**：所有具管理權限之角色（`super_admin`、`it_manager`）**強制**完成 2FA 綁定後方可進入後台；其他角色可依政策設為「強制」或「選用」。
  - **停用時**：不刪除既有 2FA 綁定資料，僅暫停驗證；重新啟用後原綁定立即恢復有效。
- 提供 **一次性復原碼 (Recovery Codes)** 10 組，僅於綁定時顯示一次，資料庫僅存雜湊。
- 管理員可對單一使用者執行「重設 2FA」（需 `super_admin` 權限並寫入審計日誌）。

#### FR-1.3 預設臨時系統管理員帳號（Bootstrap Admin）（P0）
> **【關鍵初始設定】本項為 v1.0.0 阻斷性需求，驗收條件見 §9.1。**

- 後端程式碼與資料庫 **必須** 於初次初始化時預設一組暫時系統管理員帳號：

| 欄位 | 值 |
| --- | --- |
| Email | `admin@ticket.local` |
| 初始密碼 | `Admin@InitTemp2026!` |
| 角色 | `super_admin` |
| `must_change_password` | `TRUE` |
| `two_factor_enabled` | `FALSE` |
| `is_bootstrap_admin` | `TRUE` |
| `password_updated_at` | `NULL` |

- 密碼以 **bcrypt (cost ≥ 10)** 雜湊儲存，資料庫與種子腳本中 **不得** 出現明文密碼。
- 種子資料 (Seed) 必須 **冪等 (Idempotent)**：重複執行 migration / 容器重啟不得覆蓋已被修改的密碼，亦不得產生重複帳號。
- 該帳號用途僅限「初次登入驗證與細部設定」，不得作為長期營運帳號；系統須於 Dashboard 顯示高風險提示，直到該帳號完成改密或停用。

#### FR-1.4 密碼政策與帳號保護（P0）
- 密碼複雜度：長度 ≥ 12，需包含大寫、小寫、數字、特殊符號至少各一；不得與前 5 次密碼重複。
- 登入失敗連續 5 次鎖定 15 分鐘（可設定）；支援 CAPTCHA 或指數退避 (Exponential Backoff)。
- 密碼重設流程須以一次性、具時效（≤ 30 分鐘）之 Token 執行，Token 使用後立即失效。

#### FR-1.5 工作階段與權杖管理（P0）
- Web 端採用 HttpOnly + Secure + SameSite 之 Session Cookie；API 端採用短效 Access Token（≤ 60 分鐘）搭配 Refresh Token。
- 支援「登出所有裝置」與管理員「強制登出使用者」；改密、角色變更、帳號停用時 **必須** 撤銷所有既有 Session/Token。
- API Token 需具備 Scope、到期日、可撤銷，並記錄 `last_used_at`。

#### FR-1.6 審計日誌（P0）
- 記錄欄位：時間 (UTC)、操作者、來源 IP、User-Agent、動作類型、目標物件、變更前後差異 (Diff)、結果。
- 涵蓋事件：登入/登出/失敗、改密、2FA 變更、角色與權限變更、工單建立/指派/狀態變更/刪除、報表匯出、API Token 操作、系統設定變更。
- 日誌 **不可由一般管理介面刪除**，保存期預設 365 天。

#### FR-1.7 資料保護（P0）
- 傳輸：全站 TLS 1.2+；HSTS 啟用。
- 儲存：資料庫磁碟加密（或欄位級加密處理敏感欄位）；附件需病毒掃描與型別白名單。
- 輸出：API 與匯出檔需依角色遮罩敏感欄位（如電話、身分證號）。

---

### FR-2 工單核心機制

#### FR-2.1 Help Topics 服務類別（P0）
- 管理員可建立/編輯/停用 Help Topic，欄位包含：名稱、代碼 (slug)、描述、父層（支援兩層分類）、可見性（公開/內部）、預設表單 (Ticket Form)、預設 SLA Plan、預設指派團隊/人員、自動 Tag。
- 前端開單頁依 Help Topic 動態載入對應表單與 SLA。
- 停用 Topic 後不得再被新工單選用，但既有工單保留關聯。

#### FR-2.2 Ticket Form 與自訂欄位 (Custom Fields)（P0）
- 支援多表單 (Multiple Ticket Forms)，每張表單可綁定多個 Help Topic。
- 欄位型別：`text`、`textarea`、`select`、`multiselect`、`radio`、`checkbox`、`date`、`datetime`、`number`、`email`、`url`、`file`。
- 欄位屬性：必填、預設值、排序、可見性（`public` / `internal` / `agent_only`）、驗證規則（Regex / 長度 / 數值範圍）、是否可作為篩選維度、是否可匯出。
- 欄位值儲存需支援查詢與索引（採 `ticket_field_values` 明細表 + JSONB 快照雙軌設計）。
- **變更治理**：欄位刪除採軟刪除 (`is_active=false`)，不得破壞歷史工單資料。

#### FR-2.3 SLA Plans 時效管理（P0）
- SLA Plan 欄位：名稱、適用 Help Topic / 優先級、首次回應目標、結案目標、營業時間行事曆 (Business Hours)、逾時動作。
- 支援 **營業時間 (Business Hours)** 與 **24x7** 兩種時鐘；跨時區以租戶時區計算。
- 逾時動作：標記 `overdue`、通知負責人與主管、可設定自動升級 (Escalation) 至 `it_manager`。
- 工單層級需記錄：`first_response_due_at`、`resolution_due_at`、`first_responded_at`、`resolved_at`、`sla_status`（`on_track` / `at_risk` / `overdue` / `met` / `breached`）。
- SLA 暫停 (Pause) 條件：等待客戶回覆 (`pending_user`) 期間可設定暫停計時。

#### FR-2.4 Ticket Threading 對話串（P0）
- 每張工單具備多筆 Thread Entry，型別：
  - `customer_message`（客戶來訊）
  - `agent_reply`（對外回覆，客戶可見）
  - `internal_note`（內部備忘，**永不**對 `end_user` / `vendor` 顯示）
  - `system_event`（狀態變更、指派、SLA 事件，供稽核）
- Thread Entry 需記錄作者、時間、來源管道（Web / Email / API）、是否含附件、是否已讀。
- Email 回覆需支援以 `[#TICKET-<id>]` 標記於主旨進行執行緒歸併 (Thread Matching)。
- 內部備忘與對外回覆在 API 回應中須以 `visibility` 欄位區分，並於查詢層過濾。

#### FR-2.5 Canned Responses 回覆範本（P1）
- 管理員/主管可建立範本：名稱、所屬團隊、內容（支援變數插值）、可用 Help Topic 範圍。
- 變數範例：`%{ticket.number}`、`%{ticket.subject}`、`%{ticket.assignee.name}`、`%{user.first_name}`、`%{sla.resolution_due_at}`。
- 代理 (Agent) 於回覆編輯器可一鍵插入；插入後仍可編輯。
- 範本變更需記錄版本與審計。

#### FR-2.6 Tag 標籤系統（P0）
- 工單與 Tag 為 **多對多** 關聯（`ticket_tags`）。
- Tag 具備：名稱、顏色、所屬分類、是否可由 API 建立。
- 建立工單時可由 Help Topic 自動附加預設 Tag；亦可由 API 傳入 `tags: ["ransomware","p1"]`。
- Tag 必須可作為：列表篩選維度、報表 Group By 維度、API 查詢參數 (`?tags=a,b&tags_mode=any|all`)。

#### FR-2.7 緊急程度 5 級（P0）
| 等級 | 名稱 | 說明 | 預設 SLA 傾向 |
| --- | --- | --- | --- |
| Level 1 | 極低 (Lowest) | 諮詢、建議事項 | 5 個工作日 |
| Level 2 | 低 (Low) | 非阻斷性問題 | 3 個工作日 |
| Level 3 | 中 (Normal) | 一般功能異常 | 1 個工作日 |
| Level 4 | 高 (High) | 影響多人作業 | 4 小時 |
| Level 5 | 緊急 (Critical) | 服務中斷、資安事件 | 1 小時（24x7） |

- 優先級可由使用者選擇（受 Help Topic 限制）或由管理員調整；調整須寫入 Thread 與審計日誌。
- API 需接受 `priority: 1..5` 或 `priority: "critical"` 兩種表達。

#### FR-2.8 工單狀態機（P0）
```
new ──▶ open ──▶ pending_user ──▶ open
 │        │            │
 │        ├──▶ resolved ──▶ closed
 │        └──▶ overdue(旗標，非狀態)
 └──▶ closed (重複/垃圾單)
```
- 合法轉移由後端狀態機強制；非法轉移回傳 `409 Conflict`。
- `resolved` → `closed` 可由排程自動執行（預設 7 天後）。
- 重新開啟 (Reopen)：`resolved`/`closed` 之工單可由客戶或代理重新開啟，並記錄次數 `reopen_count`。

#### FR-2.9 RESTful API（SOC 自動開單）（P0）
- 提供版本化 API：`/api/v1/*`，格式 JSON，認證採 `Authorization: Bearer <API_TOKEN>`。
- 必要端點：

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `POST` | `/api/v1/tickets` | 建立工單（支援 `external_id` 冪等鍵） |
| `GET` | `/api/v1/tickets` | 查詢列表（分頁、篩選、排序） |
| `GET` | `/api/v1/tickets/{id}` | 取得單筆（含 thread） |
| `PATCH` | `/api/v1/tickets/{id}` | 更新狀態/指派/優先級/Tag |
| `POST` | `/api/v1/tickets/{id}/threads` | 新增回覆或內部備忘 |
| `GET` | `/api/v1/reports/tickets` | 報表查詢與匯出 |
| `GET` | `/api/v1/help-topics` | 取得服務類別清單 |
| `POST` | `/api/v1/webhooks` | 註冊外部事件回呼（選用） |

- **冪等性**：`POST /tickets` 支援 `Idempotency-Key` 標頭或 `external_id`，重複請求回傳原工單（`200`）而非建立新單。
- **速率限制**：依 API Token 設定（預設 60 req/min，可調）；超限回傳 `429` 並附 `Retry-After`。
- **錯誤格式**：RFC 7807 `application/problem+json`（`type`、`title`、`status`、`detail`、`instance`）。
- 完整規格見 `src/api_spec.json`（OpenAPI 3.1）。

#### FR-2.10 指派與協作（P0）
- 指派對象可為個人或團隊 (Team)；支援「搶單 (Claim)」與「轉派 (Transfer)」。
- 支援 Watcher / CC 名單；被加入者依角色取得可見權限。
- 工單合併 (Merge) 與子工單 (Linked Tickets) 為 P1。

---

### FR-3 報表與儀表板

#### FR-3.1 Overview Dashboard（P0）
必備 Widget：
1. 待處理工單總數（依狀態分堆）。
2. 今日新增 / 今日結案 / 淨成長。
3. SLA 達標率與逾時件數（本週 / 本月）。
4. **超過 3 天未結案** 積壓件數（可點擊下鑽至篩選後列表）。
5. 依優先級 (Level 1~5) 分佈。
6. 依 Help Topic 分佈 Top 10。
7. 依 Tag 分佈 Top 10。
8. 平均首次回應時間 (FRT) 與平均結案時間 (MTTR)。
9. 通知投遞失敗告警（近 24 小時）。

#### FR-3.2 報表查詢與匯出（P0）
- 支援篩選維度：日期區間、狀態、優先級、Help Topic、指派對象/團隊、Tag、自訂欄位值、SLA 狀態、存續天數。
- 匯出格式：CSV（UTF-8 BOM）、XLSX、PDF（管理層摘要）。
- 匯出需遵守 RBAC 可見範圍；匯出動作寫入審計日誌；大量匯出採非同步任務 + 下載連結（有效期 24 小時）。

#### FR-3.3 自訂欄位過濾（P0）
- 報表查詢必須支援以 **自訂欄位** 作為篩選條件，運算子包含：`equals`、`not_equals`、`contains`、`in`、`between`（日期/數值）、`is_empty`、`is_not_empty`。
- 僅 `is_filterable=true` 之欄位可作為篩選；`internal` 欄位僅具管理權限者可用。
- 篩選條件需可儲存為「我的最愛檢視 (Saved View)」。

#### FR-3.4 「超過 3 天未結案」精確篩選（P0，必備條件）
**定義（單一權威定義，全系統一致）**
> 未結案 = `status NOT IN ('resolved','closed')`；超過 3 天 = `now() - created_at > 72 小時`（以租戶時區計算，並以 UTC 儲存）。

**查詢語意（PostgreSQL 範例）**
```sql
SELECT t.*, EXTRACT(EPOCH FROM (now() - t.created_at)) / 86400 AS aging_days
FROM tickets t
WHERE t.status NOT IN ('resolved','closed')
  AND t.created_at < now() - INTERVAL '72 hours'   -- 嚴格小於：剛好 72 小時不計入
  AND t.tenant_id = :tenant_id
ORDER BY t.created_at ASC;
```

**需求細則**
1. 篩選器需提供預設選項「超過 3 天未結案 (Aging > 3d)」，並允許調整門檻（1/3/7/14/30 天）。
2. 需提供 `aging_basis` 參數：`created_at`（預設）或 `last_updated_at`，供不同治理口徑使用。
3. 邊界條件：**恰好 72 小時 0 分 0 秒** 之工單 **不計入**（採嚴格大於 `>`）；此規則須有單元測試覆蓋。
4. 列表頁顯示「存續天數」欄位，並以顏色標示（>3 天黃、>7 天紅）。
5. 匯出檔之筆數與畫面筆數必須完全一致（同一查詢語意、同一時區基準）。
6. Dashboard 之積壓數字與列表查詢結果必須一致（共用同一 Service 方法，禁止重複實作）。
7. 支援排程報表：每日 09:00 自動寄送「超過 3 天未結案」清單給 `it_manager`。

---

### FR-4 權限與通知

#### FR-4.1 RBAC 角色權限管理（P0）
- 權限以「資源 + 動作」定義（如 `ticket:read`、`ticket:assign`、`report:export`、`setting:write`）。
- 角色可自訂（除 `super_admin` 為系統內建不可刪除），並可指派給使用者或群組。
- **可見範圍強制規則**：
  - `super_admin` / `it_manager`：全功能 / 全工單。
  - `agent`：所屬團隊佇列 + 被指派 + Watcher。
  - `vendor` / `end_user`：**僅**被指派或關聯之工單；查詢層必須施加 `assignee_id = :uid OR EXISTS(watchers)` 條件。
- 所有物件層級存取需防止 **IDOR**：以 `GET /tickets/{id}` 存取非授權工單須回傳 `404`（而非 `403`，避免存在性洩漏）。
- 權限變更立即生效（快取失效機制 ≤ 5 秒）。

#### FR-4.2 多管道通知（P0）
| 管道 | 觸發事件 | 設定 | 可靠度要求 |
| --- | --- | --- | --- |
| **Email (SMTP)** | 開單、指派、回覆、狀態變更、SLA 預警/逾時 | SMTP host/port/TLS、寄件者、範本 | 失敗重試 3 次（指數退避），記錄 `notification_logs` |
| **Telegram Bot** | 指派、Level 4/5 開單、SLA 逾時 | Bot Token、Chat ID / Topic ID、訊息範本 | 429 時依 `retry_after` 重送 |
| **Microsoft Teams Webhook** | 指派、Level 4/5 開單、每日積壓摘要 | Incoming Webhook URL、Adaptive Card 範本 | 失敗重試 3 次，連續失敗 5 次觸發管理員告警 |

**共通規則**
1. 通知採 **非同步佇列** 發送，不得阻塞 API 回應（P95 API 回應 ≤ 300ms）。
2. 冪等鍵：`event_id + channel + recipient`，避免重複轟炸。
3. 使用者可設定「通知偏好」（訂閱哪些事件、哪些管道）；管理員可設定全域強制通知（如 Level 5 必發）。
4. 通知內容不得包含內部備忘；外部收件者僅能看到對外資訊。
5. 提供 `notification_logs` 查詢與重送 (Resend) 功能。

---

### FR-5 使用者體驗

#### FR-5.1 多語系 Glossary 字典架構（P0）
- 後端 **不得** 硬編碼任何使用者可見字串；一律透過 Glossary 查詢：`t('ticket.status.open')`。
- 字典結構：
```json
{
  "locale": "zh-TW",
  "namespace": "ticket",
  "entries": {
    "ticket.status.open": "待處理",
    "ticket.status.pending_user": "等待使用者回覆",
    "ticket.priority.5": "緊急"
  }
}
```
- 資料表 `glossary_terms`：`locale`、`namespace`、`key`、`value`、`version`、`updated_by`、`updated_at`。
- 支援語系：`zh-TW`（預設）、`en-US`；新增語系僅需匯入字典檔，**不需重新編譯程式**。
- 缺字 (Missing Key) 處理：回退至 `en-US`，並記錄缺字清單供翻譯補齊；缺字不得顯示原始 key 於正式環境（顯示 fallback 值）。
- 支援使用者語系偏好與 `Accept-Language` 協商；日期/時間/數字依 locale 格式化。
- 提供匯出/匯入翻譯檔 (JSON/CSV) 與翻譯進度儀表。

#### FR-5.2 前端 Theme 主題切換（P1）
- 支援 `Light` / `Dark` / `System (跟隨作業系統)` 三種模式。
- 選擇儲存於使用者偏好（登入後同步）與 `localStorage`（未登入時）。
- 切換不得造成頁面閃爍 (FOUC)：須於 HTML 載入前以 inline script 套用 `data-theme`。
- 色彩需符合 WCAG 2.1 AA 對比度 (≥ 4.5:1)；表單、表格、圖表、狀態標籤皆需雙主題驗證。


#### FR-5.3 優先度標籤色彩區分（P2，v0.2.0 之後）
- L3（中）的優先度 badge 使用 accent 系列 CSS 變數（`--accent-soft` 背景、`--accent` 文字），與 L1／L2 的中性灰區分；L4 警告色、L5 危險色不變。
- 只使用 CSS 變數、不寫死色碼；淺色與深色主題的文字／背景對比皆 ≥ 4.5:1（WCAG 2.1 AA）。

#### FR-5.4 UI 重新設計（P1，v0.2.0 之後；第 1 批在 `[Unreleased]` 進行中）
依根目錄 `DESIGN.md` 把視覺規範套用到 `src/web/styles.css`，分兩批進行；第 1 批只做設計 token、共用元件、登入頁與 sidebar，第 2 批再處理各頁面版面細節。
- **設計 token（淺色）**：暖白頁面底色（canvas-soft）、白色卡片、hairline 邊框、ink 文字層級、單一主色藍（primary）用於主要按鈕、連結與焦點。
- **深色主題**：由淺色值推導（`DESIGN.md` 只定義淺色），文字與背景對比 ≥ 4.5:1。
- **語意色**：danger / warning / success、SLA、優先度 badge 維持獨立的 CSS 變數，兩種主題對比皆達 AA。
- **共用元件**：按鈕（主要、次要、危險）、輸入框與下拉選單、卡片、表格、badge、modal、toast、空狀態、錯誤訊息，圓角／間距／陰影使用 `DESIGN.md` 的尺度；登入、改密、2FA 頁面用 `ex-auth-form-card` 風格；左側 sidebar 保留，改用新色彩與間距。
- **限制**：既有 CSS 變數名稱保留（可新增，不可改名或刪除，`tests/styles.test.ts` 依賴 `--accent`、`--accent-soft`、`--surface-2` 等）；不改元件行為、API 呼叫、路由或文字，不新增字典 key；不引入外部資源（CSP 只允許同源）；不出現原品牌名稱；sidebar 不改成頂部導覽列；字型維持 Noto。

---

### FR-6 雙軌佈署方案

#### FR-6.1 方案 A：Docker 容器化（P0）
- `docker-compose.yml` 需包含：`app`、`postgres:16`、`redis:7`，並以 `./src/schema.sql` 掛載至 `/docker-entrypoint-initdb.d` 完成初始化。
- 需提供 `.env.example`（DB 連線、JWT Secret、SMTP、Telegram、Teams、2FA 設定）。
- 啟動後首次登入即使用 Bootstrap Admin；系統須於登入頁與文件明確提示「首次登入必須改密」。
- 需提供健康檢查 (`/healthz`)、資料持久化 Volume、備份與還原指令。

#### FR-6.2 方案 B：Cloudflare 邊緣網路（P0）
- 元件：**Workers**（API）、**Pages**（前端）、**D1**（資料庫）、**Queues**（非同步通知）、**KV**（Session/快取）、**Cron Triggers**（SLA 掃描、積壓報表）。
- `wrangler.toml` 需宣告 D1 binding、Queues producer/consumer、環境變數與環境區分 (`dev` / `staging` / `prod`)。
- D1 初始化：`wrangler d1 execute <DB> --file=./src/schema.sql`；需提供 migration 執行順序文件。
- 限制說明：LDAP/AD 直連需透過 Cloudflare Tunnel 或內部中繼服務；Workers 單次執行時間與 D1 查詢限制需於文件中載明。

#### FR-6.3 共通要求
- 兩軌需共用同一份 `src/schema.sql` 之邏輯結構（D1 相容語法差異以 migration 處理）。
- 環境變數與機密不得進版控；`.gitignore` 必須排除 `.env`、`.wrangler/`、`node_modules/`、`*.log`。
- 提供 `docs/DEPLOYMENT_GUIDE.md` 之 step-by-step 操作手冊。

---

### FR-7 GitHub 專案規範（P0）
1. 根目錄必須具備專業 `README.md`，包含：專案簡介、主要特點、技術棧、架構圖概念、目錄結構、快速啟動（Docker / Cloudflare）、預設管理員帳密與首次登入改密說明、文件索引、安全注意事項、授權條款。
2. 必須具備 `CHANGELOG.md`（遵循 Keep a Changelog 格式與 Semantic Versioning）。
3. 必須具備 `.gitignore`，排除機密與快取。
4. 建議提供 `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`、Issue/PR 模板。
5. README 中之預設帳密須附 **高風險警示**，並要求佈署後立即改密或停用。

---

## 7. 資料模型（概念）

### 7.1 主要資料表

| 資料表 | 說明 | 關鍵欄位 |
| --- | --- | --- |
| `users` | 使用者 | `id`、`email`(unique)、`password_hash`、`role_id`、`identity_provider`、`must_change_password`、`two_factor_enabled`、`is_bootstrap_admin`、`is_active`、`failed_login_count`、`locked_until` |
| `roles` | 角色 | `id`、`key`(unique)、`name`、`permissions`(JSONB) |
| `teams` | 團隊 | `id`、`name`、`manager_id` |
| `help_topics` | 服務類別 | `id`、`slug`、`name`、`parent_id`、`form_id`、`sla_plan_id`、`is_public`、`is_active` |
| `ticket_forms` | 表單 | `id`、`name`、`help_topic_id` |
| `custom_fields` | 自訂欄位定義 | `id`、`form_id`、`key`、`label`、`type`、`is_required`、`visibility`、`is_filterable`、`validation`(JSONB)、`is_active` |
| `ticket_field_values` | 欄位值 | `ticket_id`、`field_id`、`value_text`、`value_json` |
| `tickets` | 工單主表 | `id`、`number`(unique)、`subject`、`description`、`status`、`priority`(1~5)、`help_topic_id`、`sla_plan_id`、`requester_id`、`assignee_id`、`team_id`、`external_id`、`created_at`、`updated_at`、`resolved_at`、`closed_at`、`first_responded_at`、`first_response_due_at`、`resolution_due_at`、`sla_status`、`reopen_count` |
| `ticket_threads` | 對話串 | `id`、`ticket_id`、`author_id`、`type`、`visibility`、`body`、`source_channel`、`created_at` |
| `ticket_attachments` | 附件 | `id`、`thread_id`、`filename`、`mime_type`、`size`、`storage_key`、`scan_status` |
| `tags` | 標籤 | `id`、`name`(unique)、`color`、`category` |
| `ticket_tags` | 工單-標籤關聯 | `ticket_id`、`tag_id`（複合主鍵） |
| `sla_plans` | SLA 政策 | `id`、`name`、`first_response_minutes`、`resolution_minutes`、`business_hours_id`、`escalation_role_id` |
| `business_hours` | 營業時間 | `id`、`timezone`、`weekly_schedule`(JSONB)、`holidays`(JSONB) |
| `canned_responses` | 回覆範本 | `id`、`name`、`team_id`、`body`、`variables`(JSONB)、`is_active` |
| `glossary_terms` | 多語系字典 | `id`、`locale`、`namespace`、`key`、`value`、`version` |
| `notification_logs` | 通知紀錄 | `id`、`event_id`、`channel`、`recipient`、`status`、`attempts`、`last_error`、`sent_at` |
| `audit_logs` | 審計日誌 | `id`、`actor_id`、`action`、`target_type`、`target_id`、`diff`(JSONB)、`ip`、`user_agent`、`created_at` |
| `api_tokens` | API 權杖 | `id`、`name`、`token_hash`、`scopes`、`expires_at`、`last_used_at`、`revoked_at` |

### 7.2 關聯摘要
```
users ──< tickets(requester/assignee) >── help_topics ──> ticket_forms ──< custom_fields
tickets ──< ticket_threads ──< ticket_attachments
tickets >──< tags (via ticket_tags)
tickets ──> sla_plans ──> business_hours
users >──< roles
```

### 7.3 索引建議
- `tickets(status, created_at)`、`tickets(assignee_id, status)`、`tickets(team_id, status)`、`tickets(external_id)` unique、`ticket_tags(tag_id)`、`ticket_field_values(field_id, value_text)`、`audit_logs(created_at)`、`notification_logs(status, created_at)`。

---

## 8. API 規格摘要

### 8.1 建立工單範例（SOC 整合）
```bash
curl -X POST https://ticket.example.com/api/v1/tickets \
  -H "Authorization: Bearer $TICKET_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: soc-alert-20260218-0001" \
  -d '{
    "subject": "[SOC] 偵測到端點 EDR-0421 疑似勒索軟體行為",
    "description": "EDR 於 09:12 偵測到大量檔案加密行為，已隔離主機。",
    "help_topic": "security-incident",
    "priority": 5,
    "requester": { "email": "soc@example.com", "name": "SOC Bot" },
    "tags": ["ransomware", "edr", "p1"],
    "custom_fields": {
      "affected_host": "EDR-0421",
      "detection_source": "CrowdStrike"
    },
    "external_id": "SOC-2026-0001"
  }'
```

### 8.2 回應範例（201 Created）
```json
{
  "id": "tkt_01HZX8K3",
  "number": "TCK-2026-000123",
  "status": "new",
  "priority": 5,
  "sla": { "first_response_due_at": "2026-02-18T02:12:00Z", "resolution_due_at": "2026-02-18T03:12:00Z", "sla_status": "on_track" },
  "tags": ["ransomware", "edr", "p1"],
  "created_at": "2026-02-18T01:12:00Z"
}
```

### 8.3 錯誤碼
| HTTP | 代碼 | 說明 |
| --- | --- | --- |
| 400 | `validation_error` | 欄位驗證失敗（附 `errors[]`） |
| 401 | `unauthenticated` | 未提供或無效權杖 |
| 403 | `forbidden` | 權限不足（Scope 不足） |
| 404 | `not_found` | 資源不存在或無權存取（防 IDOR） |
| 409 | `conflict` | 狀態機非法轉移 / 重複資源 |
| 403 | `password_change_required` | **`must_change_password=true`，僅允許改密端點** |
| 429 | `rate_limited` | 超過速率限制（附 `Retry-After`） |
| 500 | `internal_error` | 系統錯誤（附 `trace_id`） |

---

## 9. 驗收條件 (Acceptance Criteria)

### 9.1 【P0 阻斷性】預設臨時管理員首次登入必須強制改密（AC-SEC-01）

**前置條件**
- 已完成資料庫初始化（Docker 首次啟動或 D1 執行 `schema.sql`）。
- `users` 表中存在 `admin@ticket.local`，`must_change_password = TRUE`，`is_bootstrap_admin = TRUE`。

**AC-SEC-01.1 帳號存在性與旗標**
- **Given** 資料庫初始化完成
- **When** 查詢 `SELECT email, role, must_change_password, is_bootstrap_admin FROM users WHERE email='admin@ticket.local'`
- **Then** 必須回傳 1 筆資料，`role='super_admin'`、`must_change_password=TRUE`、`is_bootstrap_admin=TRUE`
- **And** `password_hash` 必須為 bcrypt 格式（`$2a$`/`$2b$` 開頭），且 **不得** 等於明文 `Admin@InitTemp2026!`

**AC-SEC-01.2 首次登入成功後強制導向改密頁**
- **Given** 使用者以 `admin@ticket.local` / `Admin@InitTemp2026!` 登入
- **When** 認證成功
- **Then** 系統 **不得** 直接進入 Dashboard，必須導向 `/change-password`（API 回傳 `403`，`code=password_change_required`）
- **And** 僅簽發「受限權杖 (restricted token)」，其 Scope 僅含 `password:change` 與 `auth:logout`

**AC-SEC-01.3 改密前功能全面封鎖**
- **Given** 使用者持有受限權杖
- **When** 呼叫任一業務 API（如 `GET /api/v1/tickets`、`POST /api/v1/tickets`、`GET /api/v1/users`）
- **Then** 一律回傳 `403`（`code=password_change_required`），且 **不得** 回傳任何業務資料
- **And** 前端所有路由（除改密/登出）皆被路由守衛攔截

**AC-SEC-01.4 改密流程與密碼政策**
- **Given** 使用者在改密頁
- **When** 提交新密碼
- **Then** 系統必須驗證：長度 ≥ 12、含大小寫/數字/符號、不得與初始密碼相同、不得與前 5 次重複
- **And** 驗證失敗時回傳明確錯誤訊息且不更新資料庫
- **And** 驗證成功時：`password_hash` 更新、`must_change_password` 設為 `FALSE`、`password_updated_at` 設為當前時間、`is_bootstrap_admin` 設為 `FALSE`

**AC-SEC-01.5 改密後權杖輪替**
- **Given** 改密成功
- **When** 系統完成交易
- **Then** 所有舊 Session / Refresh Token **必須** 立即撤銷
- **And** 簽發全新完整權杖，使用者可正常進入 Dashboard
- **And** 寫入審計日誌（`action='password.changed'`、`actor=admin@ticket.local`、`ip`、`user_agent`）

**AC-SEC-01.6 不可繞過性**
- **Given** `must_change_password = TRUE`
- **When** 使用者嘗試以下繞過方式
- **Then** 全部必須失敗：
  1. 直接以 URL 存取 Dashboard 路由 → 導回改密頁。
  2. 使用 API Token 呼叫業務端點 → `403`（旗標檢查須在授權中介層之後、業務邏輯之前）。
  3. 重複登入取得新權杖 → 仍為受限權杖。
  4. 呼叫「重設密碼」流程寄送回自己信箱 → 仍須完成改密，且不得清除旗標以外的狀態。
  5. 直接修改前端 localStorage / Cookie → 後端仍拒絕。

**AC-SEC-01.7 冪等性與容器重啟**
- **Given** 使用者已完成改密
- **When** 容器重啟 / migration 重新執行 / `docker-compose up` 再次執行
- **Then** 種子腳本 **不得** 將密碼重置回 `Admin@InitTemp2026!`，**不得** 將 `must_change_password` 重新設為 `TRUE`
- **And** 不得產生第二筆 `admin@ticket.local`

**AC-SEC-01.8 高風險提示與文件一致性**
- **Given** Bootstrap Admin 尚未改密或停用
- **When** 任一管理員登入 Dashboard
- **Then** 顯示持續性高風險橫幅：「偵測到預設臨時管理員帳號，請立即變更密碼或停用」
- **And** `README.md` 與 `docs/DEPLOYMENT_GUIDE.md` 中之預設帳密說明與實際種子資料完全一致

**AC-SEC-01.9 停用與刪除保護**
- **Given** 系統中僅剩一位 `super_admin`
- **When** 嘗試停用或刪除該帳號
- **Then** 系統必須拒絕（`409 Conflict`），避免系統鎖死

### 9.2 其他關鍵驗收條件

| 編號 | 需求 | 驗收條件（摘要） |
| --- | --- | --- |
| AC-AUTH-01 | AD/LDAP 登入 | 網域帳號可登入；停用帳號被拒；群組→角色映射正確 |
| AC-AUTH-02 | SAML 2.0 / OIDC | SP 與 IdP 發起皆可完成登入；偽造/過期 token 被拒並記錄 |
| AC-AUTH-03 | SCIM 佈建 | `POST /scim/v2/Users` 建立使用者；`active=false` 後 session 立即失效 |
| AC-2FA-01 | 2FA 全域開關 | 管理員關閉後不再要求 2FA；重新開啟後原綁定仍有效 |
| AC-2FA-02 | TOTP / FIDO2 | TOTP 依 RFC 6238 驗證（容許 ±1 步長）；WebAuthn 註冊與登入成功 |
| AC-2FA-03 | 復原碼 | 10 組一次性復原碼，使用後即失效，DB 僅存雜湊 |
| AC-RBAC-01 | 可見範圍 | `vendor` 僅能取得被指派/關聯工單；存取他人工單回傳 `404` |
| AC-RBAC-02 | 內部備忘隔離 | `end_user`/`vendor` 之 API 回應與 UI 皆不含 `internal_note` |
| AC-TICKET-01 | 自訂欄位 | 12 種型別皆可建立、驗證、儲存、查詢；刪除採軟刪除且歷史資料不遺失 |
| AC-TICKET-02 | Help Topics | 依 Topic 載入對應表單與 SLA；停用後不可被新單選用 |
| AC-TICKET-03 | SLA | 首次回應/結案目標依營業時間計算；逾時標記 `overdue` 並通知 |
| AC-TICKET-04 | Threading | 對外回覆與內部備忘分流正確；Email 主旨 `[#TCK-...]` 可歸併 |
| AC-TICKET-05 | Canned Responses | 變數插值正確；非授權團隊不可見該範本 |
| AC-TICKET-06 | Tag | 多對多關聯；`tags_mode=any/all` 篩選結果正確 |
| AC-TICKET-07 | 優先級 5 級 | `priority` 僅接受 1~5；非法值回傳 `400` |
| AC-API-01 | SOC 開單 | 100 RPS 壓測成功率 ≥ 99.5%；`Idempotency-Key` 重複請求不產生重複單 |
| AC-API-02 | 速率限制 | 超過 60 req/min 回傳 `429` 並附 `Retry-After` |
| AC-REPORT-01 | 3 天未結案 | 篩選結果與 SQL 基準查詢筆數零誤差；72 小時整邊界不計入 |
| AC-REPORT-02 | 自訂欄位過濾 | 7 種運算子結果正確；`internal` 欄位僅管理角色可用 |
| AC-REPORT-03 | 匯出 | CSV/XLSX/PDF 筆數與畫面一致；匯出寫入審計日誌 |
| AC-NOTIFY-01 | 多管道 | Email/Telegram/Teams 皆可送達；失敗重試 3 次並記錄 |
| AC-NOTIFY-02 | 冪等與隔離 | 同一事件不重複發送；通知內容不含內部備忘 |
| AC-I18N-01 | Glossary | 切換 `zh-TW`/`en-US` 全站生效；缺字回退 `en-US` 且不顯示原始 key |
| AC-I18N-02 | 擴充語系 | 新增 `ja-JP` 僅需匯入字典檔，無需重新編譯 |
| AC-THEME-01 | Light/Dark | 切換即時生效、無 FOUC、偏好持久化；對比度符合 WCAG AA |
| AC-THEME-02 | 優先度 badge 色彩 | L3 與 L1／L2 可分辨；所有 badge 在兩種主題下對比 ≥ 4.5:1；只使用 CSS 變數 |
| AC-THEME-03 | 設計 token 與共用元件（FR-5.4） | 淺色變數符合 `DESIGN.md`（暖白 canvas-soft、白卡片、hairline、ink 層級、單一 primary）；深色由淺色推導且文字／背景 ≥ 4.5:1；語意色與 badge 兩種主題皆 ≥ 4.5:1；既有變數名稱全數保留（只增不改不刪）；登入／改密／2FA 使用 `ex-auth-form-card` 風格、sidebar 保留左側 |
| AC-THEME-04 | 版面與範圍控制（FR-5.4） | 淺色與深色主題主要畫面可讀；375px 寬度無水平捲軸；無新增字典 key、無外部資源、無原品牌名稱；元件行為、API 呼叫、路由與文字不變；`npm run validate` 通過 |
| AC-DEPLOY-01 | Docker | `docker-compose up -d` 後 3 分鐘內可登入；健康檢查通過 |
| AC-DEPLOY-02 | Cloudflare | `wrangler deploy` 後 API 可用；D1 migration 成功；Queues 通知可送達 |
| AC-GH-01 | GitHub 門面 | `README.md`、`CHANGELOG.md`、`.gitignore` 齊備且內容正確 |

### 9.3 完成定義 (Definition of Done)
1. 所有 P0 需求之自動化測試通過（單元 + 整合 + E2E）。
2. 安全測試（IDOR、認證繞過、預設密碼、速率限制）零 Critical / 零 High 未解。
3. 雙軌佈署皆完成一次「乾淨環境」端到端演練。
4. 文件（PRD、部署指南、測試計畫、README、CHANGELOG）與實作一致。
5. 審計日誌可追溯所有敏感操作。

---

## 10. 非功能需求 (NFR)

| 類別 | 需求 |
| --- | --- |
| **效能** | API P95 ≤ 300ms（不含匯出）；列表查詢 ≤ 500ms（10 萬筆資料量）；Dashboard 首屏 ≤ 2s |
| **吞吐** | 支援 100 RPS 開單；佇列峰值 1,000 訊息不遺失 |
| **可用性** | 月可用率 ≥ 99.9%（Docker 雙副本）；RPO ≤ 15 分鐘、RTO ≤ 1 小時 |
| **擴充性** | 水平擴充 App 執行個體；佇列消費者獨立擴充；資料表分區策略預留 |
| **安全** | OWASP Top 10 防護；TLS 1.2+；密碼 bcrypt；機密以 Secret Manager / 環境變數注入 |
| **可維護性** | 模組化分層；i18n 無硬編碼；Schema 變更一律以 migration 管理 |
| **可觀測性** | 結構化日誌 (JSON)、`trace_id` 貫穿、`/healthz`、`/metrics`（Prometheus 格式） |
| **相容性** | 支援 Chrome / Edge / Safari / Firefox 最新兩版；響應式 (≥ 375px) |
| **無障礙** | WCAG 2.1 AA（鍵盤操作、對比度、語意標籤） |
| **法遵** | 審計日誌保存 365 天；個資欄位可遮罩與刪除請求處理 |

---

## 11. 風險與假設

| 風險 | 影響 | 緩解措施 |
| --- | --- | --- |
| 預設管理員帳密外洩 | 極高 | 強制改密旗標、登入頁警示、部署後自動化檢查腳本、CI 掃描明文密碼 |
| Cloudflare Workers 執行時間限制 | 中 | 長任務改走 Queues；報表匯出非同步化 |
| D1 與 PostgreSQL SQL 方言差異 | 中 | 共用邏輯 schema + 方言 migration；CI 雙軌測試 |
| LDAP 無法直連邊緣環境 | 中 | 提供 Cloudflare Tunnel / 內部中繼服務方案 |
| 「3 天未結案」口徑不一致 | 中 | 單一 Service 方法 + 共用 SQL View + 單元測試鎖定邊界 |
| 通知管道被濫用/轟炸 | 中 | 冪等鍵、速率限制、使用者偏好、管理員告警 |
| 外部廠商越權 (IDOR) | 高 | 查詢層授權、`404` 回應策略、自動化越權測試 |

**假設**
1. 客戶端具備 SMTP 服務或可提供轉寄服務。
2. Telegram Bot Token 與 Teams Webhook URL 由客戶自行申請。
3. 地端環境可開放 443 對外（供 SSO 回呼）。
4. 使用者規模 v1.0.0 預估 ≤ 5,000 人、工單量 ≤ 50 萬筆。

---

## 12. 里程碑與發佈計畫（v1.0.0）

| 階段 | 交付物 | 狀態 |
| --- | --- | --- |
| M1 需求基線 | `docs/PRD_SPEC.md`、`CHANGELOG.md` | ✅ 完成 |
| M2 架構與佈署手冊 | `docs/DEPLOYMENT_GUIDE.md` | 🚧 進行中 |
| M3 資料模型與 API | `src/server/db/schema.ts`、`drizzle/`（migrations）、`docs/openapi.json` | 🚧 進行中 |
| M4 核心功能實作 | 認證、工單、SLA、報表、通知 | ⏳ 待啟動 |
| M5 測試與資安審查 | `docs/QA_TEST_PLAN.md`、測試報告 | ⏳ 待啟動 |
| M6 雙軌佈署演練與發佈 | v1.0.0 Release Tag | ⏳ 待啟動 |

---

## 13. 附錄

### 附錄 A：osTicket 核心模組對照表

| osTicket 模組 | TicketDesk v1.0.0 對應 | 差異與強化 |
| --- | --- | --- |
| Help Topics | `help_topics` + 表單/SLA 綁定 | 支援兩層分類、自動 Tag、API 可查詢 |
| Ticket Forms / Custom Fields | `ticket_forms` + `custom_fields` | 12 種欄位型別、可見性三階、可篩選/可匯出旗標 |
| SLA Plans | `sla_plans` + `business_hours` | 支援時區、暫停計時、逾時自動升級 |
| Ticket Threads | `ticket_threads` | 明確 `visibility` 欄位、來源管道、Email 執行緒歸併 |
| Canned Responses | `canned_responses` | 變數插值、團隊範圍、版本審計 |
| Filters / Queues | Saved Views + 報表篩選器 | 支援自訂欄位運算子與排程報表 |
| API | `/api/v1/*`（OpenAPI 3.1） | 冪等鍵、RFC 7807 錯誤、Scope 權杖、速率限制 |

### 附錄 B：需求追溯矩陣 (RTM)

| 需求編號 | 來源條文 | 驗收條件 | 測試案例歸屬 |
| --- | --- | --- | --- |
| FR-1.1 | 需求 1（AD/LDAP/SAML/OIDC/SCIM） | AC-AUTH-01~03 | `docs/QA_TEST_PLAN.md` §Auth |
| FR-1.2 | 需求 1（2FA 開關） | AC-2FA-01~03 | §2FA |
| FR-1.3 | 需求 1（預設管理員） | **AC-SEC-01.1~01.9** | §Bootstrap Security |
| FR-2.1~2.8 | 需求 2（工單核心 + osTicket 模組） | AC-TICKET-01~07 | §Ticket Core |
| FR-2.9 | 需求 2（SOC REST API） | AC-API-01~02 | §API |
| FR-3.1~3.4 | 需求 3（Dashboard / 報表 / 3 天未結案） | AC-REPORT-01~03 | §Reporting |
| FR-4.1 | 需求 4（RBAC） | AC-RBAC-01~02 | §RBAC/IDOR |
| FR-4.2 | 需求 4（多管道通知） | AC-NOTIFY-01~02 | §Notification |
| FR-5.1 | 需求 5（Glossary 多語系） | AC-I18N-01~02 | §i18n |
| FR-5.2 | 需求 5（Light/Dark） | AC-THEME-01 | §UI |
| FR-5.3 | 需求變更（v0.2.0 之後） | AC-THEME-02 | §UI |
| FR-5.4 | 需求變更（UI 重新設計第 1 批） | AC-THEME-03~04 | §UI |
| FR-6.1~6.3 | 需求 6（雙軌佈署） | AC-DEPLOY-01~02 | §Deployment |
| FR-7 | 需求 7（GitHub 規範） | AC-GH-01 | §Docs Review |

---

**文件結束 — PRD-TD-001 v1.0.0**
