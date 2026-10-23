<div align="center">

# 🎫 TicketDesk

**企業級 ITSM 工單管理平台 · API-First · 雙軌佈署 · 零信任安全**

[![Version](https://img.shields.io/badge/version-v1.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#-授權條款)
[![Deploy](https://img.shields.io/badge/deploy-Docker%20%7C%20Cloudflare-orange.svg)](#-快速啟動)
[![API](https://img.shields.io/badge/API-OpenAPI%203.1-6ba539.svg)](src/api_spec.json)
[![Security](https://img.shields.io/badge/security-2FA%20%7C%20RBAC%20%7C%20SCIM-red.svg)](docs/PRD_SPEC.md)

[產品特性](#-主要特點) · [技術棧](#-技術棧) · [架構](#-架構概念) · [快速啟動](#-快速啟動) · [預設帳號](#-預設管理員帳號與首次登入必讀) · [文件索引](#-文件索引)

</div>

---

## 📖 專案簡介

**TicketDesk** 是一套面向企業 IT 服務台與資安營運中心 (SOC) 的現代化工單管理平台。
它將分散的服務請求、資安告警與內部支援統一收斂到單一入口，並以 **API-First** 設計讓外部系統
（如 SOC 監控、SIEM、EDR）能自動開單；同時提供 **SLA 時效治理**、**RBAC 物件層級權限**、
**多管道即時通知** 與 **可稽核的安全機制**。

平台提供 **雙軌佈署**：地端可採 Docker 容器化（App + PostgreSQL + Redis），
雲端可採 Cloudflare 邊緣網路（Workers + Pages + D1 + Queues），
讓同一份程式碼同時滿足「資料落地」與「全球低延遲、免維運」兩種客戶情境。

> 核心模組設計參考 **osTicket** 成熟機制（Help Topics、SLA Plans、Ticket Threading、Canned Responses、自訂表單欄位），
> 並在此基礎上補足現代化 API、邊緣佈署與企業級身分治理能力。

---

## ✨ 主要特點

<table>
<tr>
<td width="50%" valign="top">

### 🔐 身分驗證與安全
- **AD / LDAP** 企業目錄整合（LDAPS、Group→Role 映射）
- **SAML 2.0**（SP / IdP-initiated）與 **OIDC**（Code + PKCE）單一登入
- **SCIM 2.0** 使用者/群組自動佈建，離職即時停用
- **2FA 全域開關**：管理員一鍵啟停，支援 **TOTP** 與 **FIDO2 / WebAuthn**
- 一次性復原碼、密碼政策、登入失敗鎖定、審計日誌

### 🎟️ 工單核心機制
- **Help Topics** 服務類別（兩層分類、綁定表單/SLA/自動 Tag）
- **Ticket Form 自訂欄位**：12 種型別、三階可見性、可篩選/可匯出
- **SLA Plans** 時效管理（營業時間、時區、逾時升級、暫停計時）
- **Ticket Threading**：對外回覆 vs. 內部備忘嚴格隔離
- **Canned Responses** 回覆範本（變數插值）
- **Tag 標籤系統**：多對多關聯、`any/all` 篩選
- **緊急程度 5 級**（Level 1 ~ Level 5）

</td>
<td width="50%" valign="top">

### 📊 報表與儀表板
- **Overview Dashboard** 9 項即時 Widget
- **報表匯出**：CSV / XLSX / PDF
- **自訂欄位過濾**：7 種運算子
- **「超過 3 天未結案」精確篩選**（必備能力，含排程報表）

### 🛡️ 權限與通知
- **RBAC**：`super_admin` / `it_manager` / `agent` / `vendor` / `end_user` / `api_client`
- 外部廠商與一般使用者 **僅見被指派或關聯之工單**（防 IDOR）
- **多管道通知**：Email (SMTP)、**Telegram Bot**、**Microsoft Teams Webhook**
- 非同步佇列、冪等去重、失敗重試

### 🌏 使用者體驗
- **Glossary 字典架構**多語系（`zh-TW` / `en-US`，擴充語系零改碼）
- **Light / Dark / System** 主題切換，無 FOUC、符合 WCAG 2.1 AA

### 🔌 外部整合
- **RESTful API（OpenAPI 3.1）** 供 SOC 自動開單
- `Idempotency-Key` 冪等、Scope 權杖、速率限制、RFC 7807 錯誤格式

</td>
</tr>
</table>

---

## 🧰 技術棧

| 層級 | 方案 A：Docker 容器化 | 方案 B：Cloudflare 邊緣網路 |
| --- | --- | --- |
| **前端** | SPA（Light/Dark 主題、i18n Glossary） | Cloudflare **Pages** |
| **應用/API** | 容器化 App 服務（RESTful API） | Cloudflare **Workers** |
| **資料庫** | **PostgreSQL 16**（Volume 持久化） | Cloudflare **D1**（SQLite 相容） |
| **佇列 / 快取** | **Redis 7**（非同步通知、SLA 排程） | Cloudflare **Queues** + **KV** |
| **排程** | 容器內 Cron / Worker Process | **Cron Triggers** |
| **身分治理** | AD / LDAP / SAML 2.0 / OIDC / SCIM 2.0 | 同左（LDAP 經 Tunnel / 中繼） |
| **通知** | SMTP · Telegram Bot API · MS Teams Webhook | 同左 |
| **可觀測性** | 結構化 JSON Log、`/healthz`、`/metrics` | Workers Analytics、Logpush |

**共通設計原則**
- 後端 **零硬編碼字串**，一律經 Glossary 字典查詢（`t('ticket.status.open')`）。
- Schema 變更一律以 **migration** 管理，禁止手動改線上資料庫。
- 機密僅以環境變數 / Secret Manager 注入，**永不進版控**。

---

## 🏗️ 架構概念

```
                    ┌──────────────────────────────────────────────┐
                    │         Clients / Integrations               │
                    │  Web UI │ SOC 系統 │ Email │ Telegram / Teams │
                    └───────┬─────────────┬────────────────────────┘
                            │             │
              ┌─────────────▼───┐   ┌─────▼────────────────┐
              │  REST API / BFF │   │  Webhook Dispatcher  │
              │  (Auth Guard)   │   │  (Retry + Idempotent)│
              └────────┬────────┘   └──────┬───────────────┘
                       │                   │
   ┌───────────────────▼───────────────────▼───────────────────┐
   │                    Application Services                    │
   │  Auth (AD/LDAP/SAML/OIDC/SCIM/2FA) │ Ticket │ SLA │ Report │
   │  RBAC Policy Engine │ i18n Glossary │ Notification Service  │
   └───────────┬───────────────────────────────┬───────────────┘
               │                               │
      ┌────────▼────────┐            ┌─────────▼─────────┐
      │ PostgreSQL / D1 │            │ Redis / Queues    │
      │ (src/schema.sql)│            │ (async jobs)      │
      └─────────────────┘            └───────────────────┘
```

**請求流（SOC 自動開單）**
```
SOC 系統 ──POST /api/v1/tickets──▶ Auth Guard (API Token + Scope)
        ──▶ 驗證中介層 (Schema / Custom Fields)
        ──▶ 工單服務 (Help Topic → Form → SLA 計算)
        ──▶ DB 寫入 + Thread(system_event)
        ──▶ 佇列 (notification.job) ──▶ Email / Telegram / Teams
        ◀── 201 Created (ticket number + SLA due)
```

---

## 📁 目錄結構

```
ticketdesk/
├── README.md                     # 專案門面（本文件）
├── CHANGELOG.md                  # 版本歷程（Keep a Changelog）
├── LICENSE                       # 授權條款
├── .gitignore                    # 排除機密與快取
├── .env.example                  # 環境變數範本（不含真實機密）
├── docker-compose.yml            # 方案 A：App + PostgreSQL 16 + Redis 7
├── wrangler.toml                 # 方案 B：Workers / D1 / Queues / KV 宣告
│
├── docs/                         # 📚 專案文件
│   ├── PRD_SPEC.md               #   產品需求規格書（PRD-TD-001）
│   ├── DEPLOYMENT_GUIDE.md       #   雙軌佈署 step-by-step 手冊
│   └── QA_TEST_PLAN.md           #   品質與資安測試計畫矩陣
│
└── src/                          # 💻 原始碼與配置
    ├── schema.sql                #   完整 DDL + Bootstrap Admin 種子資料
    ├── api_spec.json             #   OpenAPI 3.1 規格（SOC 開單 API）
    └── ...                       #   應用程式原始碼（依實作分層）
```

---

## 🚀 快速啟動

### 前置需求
| 方案 | 需求 |
| --- | --- |
| **A. Docker** | Docker Engine 24+、Docker Compose v2、可用連接埠 `8080` / `5432` / `6379` |
| **B. Cloudflare** | Node.js 20+、`wrangler` CLI 3+、Cloudflare 帳號（Workers / Pages / D1 / Queues 已啟用） |

---

### 方案 A：Docker 容器化佈署（地端 / 內網推薦）

```bash
# 1) 取得專案
git clone https://github.com/<your-org>/ticketdesk.git
cd ticketdesk

# 2) 建立環境變數檔（請務必修改所有機密值）
cp .env.example .env
#   必填：POSTGRES_PASSWORD / JWT_SECRET / SMTP_* / TELEGRAM_BOT_TOKEN / TEAMS_WEBHOOK_URL

# 3) 啟動服務（App + PostgreSQL 16 + Redis 7）
docker compose up -d

# 4) 確認健康狀態
docker compose ps
curl -fsS http://localhost:8080/healthz

# 5) 開啟瀏覽器
#    http://localhost:8080
#    首次登入請使用下方【預設管理員帳號】，並立即完成強制改密
```

**初始化機制說明**
- `src/schema.sql` 會自動掛載至 PostgreSQL 容器的 `/docker-entrypoint-initdb.d`，
  於 **首次啟動且資料目錄為空** 時執行，建立資料表並寫入 Bootstrap Admin 種子資料。
- 種子腳本為 **冪等 (Idempotent)**：容器重啟或 migration 重跑 **不會** 覆蓋已變更的密碼，
  也 **不會** 產生重複帳號。

**常用維運指令**
```bash
docker compose logs -f app          # 追蹤應用日誌
docker compose restart app          # 重啟應用
docker compose down                 # 停止（保留資料 Volume）
docker compose down -v              # ⚠️ 停止並刪除資料（含資料庫，請先備份）

# 資料庫備份 / 還原
docker compose exec -T postgres pg_dump -U ticketdesk ticketdesk > backup_$(date +%F).sql
docker compose exec -T postgres psql -U ticketdesk -d ticketdesk < backup_2026-02-18.sql
```

---

### 方案 B：Cloudflare 邊緣網路佈署（全球低延遲 / 免維運）

```bash
# 1) 安裝依賴與登入
npm install
npx wrangler login

# 2) 建立 D1 資料庫（記下回傳的 database_id，填入 wrangler.toml）
npx wrangler d1 create ticketdesk-db

# 3) 建立 Queues（非同步通知）
npx wrangler queues create ticketdesk-notifications

# 4) 初始化資料庫結構與種子資料
npx wrangler d1 execute ticketdesk-db --remote --file=./src/schema.sql

# 5) 設定環境變數與機密（勿寫入 wrangler.toml）
npx wrangler secret put JWT_SECRET
npx wrangler secret put SMTP_PASSWORD
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TEAMS_WEBHOOK_URL

# 6) 佈署 API (Workers) 與前端 (Pages)
npx wrangler deploy
npx wrangler pages deploy ./dist --project-name=ticketdesk

# 7) 驗證
curl -fsS https://ticketdesk.<your-subdomain>.workers.dev/healthz
```

> ⚠️ **邊緣環境限制**：AD / LDAP 無法從 Workers 直連企業內網，需透過 **Cloudflare Tunnel**
> 或內部中繼 (Relay) 服務；Workers 單次執行時間與 D1 查詢限制請參閱
> [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)。

---

## 🔑 預設管理員帳號與首次登入（必讀）

> ### ⚠️ 高風險警示
> 下列帳號為 **初次佈署用的臨時系統管理員 (Bootstrap Admin)**，僅供登入驗證與細部設定。
> **請於首次登入後立即變更密碼，並建議完成設定後停用或改為正式管理帳號。**
> 切勿在正式環境長期沿用預設密碼。

### 預設帳密

| 項目 | 值 |
| --- | --- |
| **登入網址** | `http://localhost:8080`（Docker）／ `https://ticketdesk.<your-subdomain>.workers.dev`（Cloudflare） |
| **帳號 (Email)** | `admin@ticket.local` |
| **初始密碼** | `Admin@InitTemp2026!` |
| **角色** | `super_admin`（系統管理員，全功能） |
| **`must_change_password`** | `TRUE`（**強制改密旗標**） |
| **`is_bootstrap_admin`** | `TRUE` |

### 首次登入流程（強制改密，不可跳過）

1. 以 `admin@ticket.local` / `Admin@InitTemp2026!` 登入。
2. 系統偵測到 `must_change_password = TRUE`，**不會** 進入 Dashboard，
   而是導向 `/change-password` 改密頁；此時僅簽發 **受限權杖**（Scope 僅 `password:change`、`auth:logout`）。
3. 設定新密碼，需符合密碼政策：
   - 長度 **≥ 12** 字元
   - 至少包含 **大寫、小寫、數字、特殊符號** 各一
   - **不得** 與初始密碼相同
   - **不得** 與前 5 次使用過的密碼重複
4. 改密成功後：
   - `must_change_password` 設為 `FALSE`、`is_bootstrap_admin` 設為 `FALSE`
   - **所有舊 Session / Token 立即撤銷**，並簽發全新完整權杖
   - 寫入審計日誌（`action = password.changed`）
5. 進入 Dashboard，依需求完成：2FA 全域開關、SLA Plans、Help Topics、通知管道、RBAC 角色設定。

### 改密前的功能封鎖範圍
在 `must_change_password = TRUE` 期間，除「改密」與「登出」外，**所有業務功能與 API 一律被攔截**：

| 嘗試行為 | 結果 |
| --- | --- |
| 直接輸入 Dashboard URL | 導回 `/change-password` |
| 呼叫 `GET /api/v1/tickets` | `422 password_change_required` |
| 呼叫 `POST /api/v1/tickets` | `422 password_change_required` |
| 重複登入取得新權杖 | 仍為受限權杖 |
| 手動修改前端 Cookie / localStorage | 後端仍拒絕 |

### 佈署後安全檢查清單 (Go-Live Checklist)
- [ ] 已變更 `admin@ticket.local` 密碼（`must_change_password` 已為 `FALSE`）
- [ ] 已停用 Bootstrap Admin 或改為正式管理帳號
- [ ] 已啟用 **2FA 全域開關**（`super_admin` / `it_manager` 強制綁定）
- [ ] 已更換 `.env` 中所有預設機密（`JWT_SECRET`、`POSTGRES_PASSWORD`、SMTP 密碼）
- [ ] 已設定 SMTP / Telegram Bot / Teams Webhook 並完成測試發送
- [ ] 已建立正式 RBAC 角色與團隊，並移除多餘的 `super_admin`
- [ ] 已確認全站 TLS 1.2+ 與 HSTS 啟用
- [ ] 已設定資料庫備份排程與還原演練
- [ ] 已確認審計日誌可查詢且保存期 ≥ 365 天
- [ ] 已驗證「超過 3 天未結案」篩選筆數與 SQL 基準查詢一致

---

## 🔌 API 快速範例（SOC 自動開單）

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
    "custom_fields": { "affected_host": "EDR-0421", "detection_source": "CrowdStrike" },
    "external_id": "SOC-2026-0001"
  }'
```

**回應 `201 Created`**
```json
{
  "id": "tkt_01HZX8K3",
  "number": "TCK-2026-000123",
  "status": "new",
  "priority": 5,
  "sla": {
    "first_response_due_at": "2026-02-18T02:12:00Z",
    "resolution_due_at": "2026-02-18T03:12:00Z",
    "sla_status": "on_track"
  },
  "tags": ["ransomware", "edr", "p1"],
  "created_at": "2026-02-18T01:12:00Z"
}
```

完整端點、Schema 與錯誤碼請見 [`src/api_spec.json`](src/api_spec.json)（OpenAPI 3.1）。

---

## 📚 文件索引

| 文件 | 說明 |
| --- | --- |
| 📄 [`docs/PRD_SPEC.md`](docs/PRD_SPEC.md) | **產品需求規格書 (PRD-TD-001)**：13 章完整需求、功能/非功能需求、資料模型、API 摘要、驗收條件、需求追溯矩陣 (RTM) |
| 🚢 [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) | **雙軌佈署手冊**：Docker 與 Cloudflare Workers 的 step-by-step 操作、環境變數、migration、預設帳號登入與安全設定 |
| 🧪 [`docs/QA_TEST_PLAN.md`](docs/QA_TEST_PLAN.md) | **品質與資安測試計畫**：RBAC 權限邊界、2FA、預設密碼變更邏輯、IDOR 越權、API 速率限制、回歸測試矩陣 |
| 📝 [`CHANGELOG.md`](CHANGELOG.md) | **版本歷程**：遵循 Keep a Changelog 與 Semantic Versioning |
| 🗄️ [`src/schema.sql`](src/schema.sql) | **資料庫 DDL**：完整資料表結構 + Bootstrap Admin 種子資料（bcrypt 雜湊、`must_change_password=TRUE`） |
| 🔌 [`src/api_spec.json`](src/api_spec.json) | **OpenAPI 3.1 規格**：SOC 自動開單與報表查詢 API |
| 🐳 [`docker-compose.yml`](docker-compose.yml) | **方案 A 佈署配置**：App + PostgreSQL 16 + Redis 7 |
| ☁️ [`wrangler.toml`](wrangler.toml) | **方案 B 佈署配置**：Workers / D1 / Queues / KV |

---

## 🔒 安全注意事項

1. **預設帳密必須更換**：`admin@ticket.local` 僅供初次佈署驗證；`must_change_password` 旗標會強制改密，
   但 **仍請於上線前確認該帳號已改密或停用**，並檢查 Dashboard 是否仍顯示高風險橫幅。
2. **機密不進版控**：`.env`、`.wrangler/`、`*.log`、`node_modules/` 已列入 `.gitignore`；
   CI 應加入明文密碼掃描（如 gitleaks / trufflehog）。
3. **最小權限原則**：`super_admin` 僅保留給必要人員；外部廠商 (`vendor`) 一律僅授予被指派工單的可見權限。
4. **防 IDOR**：物件層級授權必須在 **查詢層** 施加條件；越權存取一律回傳 `404`（避免存在性洩漏）。
5. **內部備忘隔離**：`internal_note` 永不對 `end_user` / `vendor` 顯示，API 回應須以 `visibility` 過濾。
6. **2FA 建議全域啟用**：至少對 `super_admin` 與 `it_manager` 強制 TOTP / FIDO2。
7. **API 安全**：使用 Scope 受限的 API Token、設定到期日、啟用速率限制（預設 60 req/min）、
   以 `Idempotency-Key` 防重複開單。
8. **傳輸與儲存**：全站 TLS 1.2+ 與 HSTS；密碼 bcrypt (cost ≥ 10)；API Token 僅存雜湊；附件需病毒掃描與型別白名單。
9. **審計不可竄改**：審計日誌不可由一般管理介面刪除，保存期預設 365 天。
10. **備份與還原**：上線前完成一次資料庫備份與還原演練（RPO ≤ 15 分鐘、RTO ≤ 1 小時）。
11. **通知內容外洩風險**：通知範本不得包含內部備忘或敏感欄位；外部收件者僅能看到對外資訊。
12. **弱點回報**：若發現安全問題，請勿開公開 Issue，請依 `SECURITY.md` 管道私下回報。

---

## 🗺️ 產品藍圖 (Roadmap)

| 版本 | 內容 | 狀態 |
| --- | --- | --- |
| **v1.0.0** | 需求基線、雙軌佈署、核心工單與 SLA、RBAC、多管道通知、多語系、Light/Dark | ✅ 發佈 |
| v1.1.0 | Slack 通知、工單合併與子工單、排程報表擴充 | 🔜 規劃中 |
| v1.2.0 | CSAT 滿意度調查、品質評分報表、知識庫關聯建議 | 🔜 規劃中 |
| v2.0.0 | 多租戶隔離、SLA 規則引擎、AI 輔助分派 | 💡 研究中 |

---

## 🤝 貢獻指南

1. Fork 本專案並建立功能分支：`git checkout -b feature/your-feature`
2. 遵循既有程式風格與 i18n 規範（**禁止硬編碼使用者可見字串**）。
3. Schema 變更請一併提供 migration 腳本，並確保 Docker 與 D1 雙軌皆可執行。
4. 提交前請執行測試與 lint，並確認未包含任何機密資訊。
5. 建立 Pull Request，於描述中連結對應需求編號（如 `FR-2.9`）與驗收條件（如 `AC-API-01`）。

---

## 📄 授權條款

本專案採用 **MIT License** 釋出，詳見 [`LICENSE`](LICENSE)。

---

<div align="center">

**TicketDesk v1.0.0** · 讓每一個服務請求都被看見、被追蹤、被準時解決。

[⬆ 回到頂部](#-ticketdesk) · [產品需求規格書](docs/PRD_SPEC.md) · [版本歷程](CHANGELOG.md)

</div>
