# Changelog

本專案所有重要變更皆記錄於此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [Unreleased]

### Planned
- Slack 通知管道（Incoming Webhook / Bot Token）。
- 工單滿意度調查 (CSAT) 與品質評分報表。
- 多租戶 (Multi-tenant) 隔離與租戶層級計費。
- SLA 預警規則引擎（可自訂多段式升級規則）。
- 知識庫 (Knowledge Base) 與工單關聯建議。

---

## [v1.0.0] - 2026-02-18

### 初版發布 (Initial Release)

TicketDesk 企業級 ITSM 工單管理平台首個正式版本，完成需求基線凍結（Baseline），
涵蓋身分驗證、工單核心機制、報表治理、權限與通知、多語系、雙軌佈署與 GitHub 專案門面。

### Added — 身分驗證與安全
- 支援 **Active Directory / LDAP** 身分驗證（LDAPS、Base DN、Attribute Mapping、Group→Role 映射）。
- 支援 **SAML 2.0**（SP-initiated / IdP-initiated、簽章憑證輪替）。
- 支援 **OIDC**（Authorization Code + PKCE、`id_token` 驗證 iss/aud/exp/nonce）。
- 支援 **SCIM 2.0** 使用者/群組自動佈建（`/scim/v2/Users`、`/scim/v2/Groups`），離職即時停用。
- **2FA 全域開關**：管理員可一鍵啟用/停用；支援 **TOTP**（RFC 6238）與 **FIDO2 / WebAuthn**。
- 2FA 一次性 **復原碼** 10 組（僅存雜湊、單次使用）。
- **預設臨時系統管理員 (Bootstrap Admin)**：`admin@ticket.local`，具 `must_change_password=TRUE` 旗標，
  供初次佈署後登入驗證與細部設定；密碼以 bcrypt 雜湊儲存，種子資料冪等（重啟不覆蓋已改密碼）。
- 密碼政策（長度 ≥ 12、四類字元、不可重用前 5 次）與登入失敗鎖定機制。
- Session / Token 管理：短效 Access Token + Refresh Token、登出所有裝置、改密即撤銷既有權杖。
- 審計日誌 (Audit Log)：登入、改密、2FA 變更、權限變更、工單操作、報表匯出全紀錄，保存 365 天。

### Added — 工單核心機制
- **Help Topics（服務類別）**：兩層分類、可見性控制、綁定表單/SLA/預設指派/自動 Tag。
- **Ticket Form 與自訂欄位 (Custom Fields)**：12 種欄位型別（text/textarea/select/multiselect/radio/checkbox/date/datetime/number/email/url/file），
  支援必填、預設值、Regex 驗證、三階可見性（public/internal/agent_only）、可篩選與可匯出旗標、軟刪除治理。
- **SLA Plans（時效管理）**：首次回應與結案目標、營業時間行事曆、時區支援、逾時標記與自動升級、等待客戶期間暫停計時。
- **Ticket Threading（對話串）**：`customer_message` / `agent_reply` / `internal_note` / `system_event` 四類型，
  內部備忘永不對外部角色顯示；支援 Email 主旨 `[#TCK-...]` 執行緒歸併。
- **Canned Responses（回覆範本）**：變數插值（`%{ticket.number}`、`%{sla.resolution_due_at}` 等）、團隊範圍、版本審計。
- **Tag 標籤系統**：工單與 Tag 多對多關聯，支援 `tags_mode=any|all` 篩選與報表 Group By。
- **緊急程度 5 級**（Level 1 極低 ~ Level 5 緊急），支援數字與語意別名兩種 API 表達。
- **工單狀態機**：`new → open → pending_user → resolved → closed`，非法轉移回傳 `409`，支援 Reopen 計數。
- **RESTful API（`/api/v1/*`，OpenAPI 3.1）**：供 SOC 資安監控系統自動開單；支援 `Idempotency-Key` / `external_id` 冪等、
  Scope 權杖、速率限制（預設 60 req/min）、RFC 7807 錯誤格式。

### Added — 報表與儀表板
- **Overview Dashboard** 9 項 Widget：待處理總數、今日新增/結案、SLA 達標率、**超過 3 天未結案積壓**、
  優先級分佈、Help Topic Top 10、Tag Top 10、平均 FRT/MTTR、通知失敗告警。
- **報表查詢與匯出**：CSV（UTF-8 BOM）/ XLSX / PDF；大量匯出採非同步任務 + 24 小時有效下載連結。
- **自訂欄位過濾**：7 種運算子（equals/not_equals/contains/in/between/is_empty/is_not_empty），可儲存為「我的最愛檢視」。
- **「超過 3 天未結案」精確篩選**（必備條件）：`status NOT IN ('resolved','closed') AND created_at <= now() - INTERVAL '3 days'`，
  嚴格大於 72 小時（邊界不計入），支援 `aging_basis=created_at|last_updated_at`，並提供每日 09:00 排程報表。

### Added — 權限與通知
- **RBAC 角色權限管理**：`super_admin` / `it_manager` / `agent` / `vendor` / `end_user` / `api_client`；
  權限以「資源 + 動作」定義，角色可自訂（`super_admin` 為內建不可刪除）。
- 物件層級授權：`vendor` / `end_user` 僅見被指派或關聯工單；越權存取回傳 `404` 防 IDOR。
- **多管道通知**：Email (SMTP)、**Telegram Bot**、**Microsoft Teams Incoming Webhook**；
  非同步佇列發送、冪等鍵去重、失敗指數退避重試 3 次、`notification_logs` 可查詢與重送。

### Added — 使用者體驗
- **多語系 Glossary 字典架構**：`glossary_terms(locale, namespace, key, value)`，後端零硬編碼；
  內建 `zh-TW`（預設）與 `en-US`，新增語系僅需匯入字典檔；缺字自動回退 `en-US`。
- **Theme 主題切換**：Light / Dark / System 三模式，偏好持久化、無 FOUC、符合 WCAG 2.1 AA 對比度。

### Added — 雙軌佈署
- **方案 A：Docker 容器化** — `docker-compose.yml`（App + PostgreSQL 16 + Redis 7），
  自動掛載 `src/schema.sql` 至 `/docker-entrypoint-initdb.d` 完成初始化，含健康檢查與資料持久化 Volume。
- **方案 B：Cloudflare 邊緣網路** — Workers（API）+ Pages（前端）+ D1（資料庫）+ Queues（非同步通知）+ KV + Cron Triggers；
  提供 `wrangler.toml` 與 D1 migration 執行說明。
- 提供 `.env.example`、`.gitignore`（排除 `.env`、`.wrangler/`、`node_modules/`、`*.log`）。

### Added — 專案文件與 GitHub 門面
- `README.md`：專案簡介、主要特點、技術棧、架構圖概念、目錄結構樹、雙軌快速啟動、
  **預設管理員帳密與首次登入改密說明**、文件索引、安全注意事項。
- `docs/PRD_SPEC.md`：完整產品需求規格書（PRD-TD-001），含 13 章、需求追溯矩陣 (RTM)。
- `CHANGELOG.md`：本版本歷程文件。
- `src/schema.sql`：完整 DDL 與 Bootstrap Admin 種子資料。
- `src/api_spec.json`：OpenAPI 3.1 規格。

### Security
- 預設臨時管理員 `admin@ticket.local` 具 `must_change_password=TRUE`，**首次登入強制改密**；
  改密前僅簽發受限權杖（Scope 僅 `password:change`、`auth:logout`），所有業務 API 回傳 `422 password_change_required`。
- 改密成功後立即撤銷所有舊 Session/Token，並清除 `must_change_password` 與 `is_bootstrap_admin` 旗標。
- 種子資料冪等設計：容器重啟或 migration 重跑 **不會** 將密碼重置回初始值。
- 登入失敗訊息不洩漏帳號存在性；連續失敗 5 次鎖定 15 分鐘。
- 全站 TLS 1.2+ 與 HSTS；密碼 bcrypt (cost ≥ 10)；API Token 僅存雜湊。
- 審計日誌不可由一般管理介面刪除。

### Documentation
- 建立需求基線與版本控制機制：後續需求變更將以增量方式更新 `docs/PRD_SPEC.md`、`README.md` 並於本文件追加版本紀錄。

### Known Limitations
- LDAP / AD 直連於 Cloudflare 邊緣環境需透過 Cloudflare Tunnel 或內部中繼服務。
- Cloudflare Workers 單次執行時間與 D1 查詢限制可能影響大量報表匯出，已改採非同步任務處理。
- v1.0.0 尚未支援 Slack 通知、CSAT 滿意度調查、多租戶與知識庫全文檢索。

### Notes
- 本版本為 **初版發布 (v1.0.0)**，需求已凍結為開發基線。
- 升級指引：首次佈署請依 `docs/DEPLOYMENT_GUIDE.md` 操作；佈署完成後 **請立即變更預設管理員密碼**。

---

<!--
版本紀錄撰寫規範：
1. 新增條目一律置於最上方（[Unreleased] 之下）。
2. 分類使用：Added / Changed / Deprecated / Removed / Fixed / Security / Documentation。
3. 破壞性變更 (Breaking Change) 須標註 ⚠️ 並說明遷移方式。
4. 每次版本迭代須同步更新 docs/PRD_SPEC.md 與 README.md。
-->
