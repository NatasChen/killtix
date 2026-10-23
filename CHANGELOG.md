# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Changed
- README 與部署指南補充：容器重建後 log 不會再出現一次性密碼，改用 `reset-password` 指令重設。

## [0.1.0] - 2026-10-23

第一個可以實際部署的版本。先前標示為「v1.0.0 已發布」的內容只有設計文件，沒有程式碼，已改正為本版本。

### Added
- Docker 部署：app（Node 24 + Hono + React）、PostgreSQL 16、Redis 7；啟動時自動執行 migration 與冪等種子資料。
- 預設管理員 `admin@ticket.local`：密碼來自 `BOOTSTRAP_ADMIN_PASSWORD`，未設定則隨機產生並只在 log 顯示一次；首次登入強制改密，改密前業務 API 回 `403 password_change_required`。
- 密碼政策、失敗鎖定、登入速率限制、session 撤銷、TOTP 兩步驟驗證與復原碼、全域強制 2FA 開關。
- 工單：服務類別、表單與 9 種自訂欄位、5 級優先度、狀態機、對話串（內部備忘隔離）、回覆範本、標籤、關注者。
- SLA：首次回應／解決期限、等待使用者時暫停、即將逾時／逾時掃描與通知。
- RBAC 六種角色，權限在 SQL 查詢層套用（防 IDOR）。
- 儀表板、工單篩選（含「超過 3 天未結案」與自訂欄位）、CSV 匯出。
- 通知：Email、Telegram、Microsoft Teams（outbox、重試、介面查看與重送）；每日 3 天積壓報告。
- 外部 API：API Token 權限範圍、`Idempotency-Key`、每 Token 速率限制；OpenAPI 文件 `docs/openapi.json`。
- 繁中／英文 glossary 字典（可線上覆寫）、淺色／深色主題、手機版面。
- 維運指令 `node dist/server/cli.js reset-password <email>`。
- 測試：43 個 Vitest 測試（PGlite 或真實 PostgreSQL）、`scripts/validate.sh` 品質檢查、`scripts/smoke.sh` 部署後檢查、`scripts/ui-e2e.sh` 瀏覽器端到端測試（Playwright in Docker）。
- `scripts/init-env.sh`：建立 `.env` 並自動產生必填密鑰（只填空白值，不覆蓋既有值）。
- `AGENTS.md` 接手指南（程式碼地圖、不可破壞的規則、常見任務作法、驗證流程、已知陷阱、交接規範）與引用它的 `CLAUDE.md`；README「版本資訊」區塊。

### Changed
- CrewAI 產生器改為以 `specs/change_request.md` 驅動的迭代工具：限制可讀寫路徑、要求乾淨的 git 工作目錄、以 `AGENTS.md` 作為所有 agent 的工作規則、自動驗證並在失敗時回饋修正，通過才 commit。
- 「超過 3 天未結案」統一定義為 `created_at < now() - 72 小時`（剛好 72 小時不計入）。
- 部署指南依實際實作重寫；PRD 與 QA 測試計畫修正與實作矛盾之處。

### Removed
- `src/schema.sql`（改由 Drizzle migration 管理；其中的管理員密碼雜湊無法對應宣稱的密碼）。
- `src/api_spec.json`（描述的端點與實作不符，改為 `docs/openapi.json`）。

### Known limitations
- 尚未實作：AD/LDAP、SAML、OIDC、SCIM、FIDO2、附件、SLA 營業時間、Cloudflare 部署。見 `specs/DECISIONS.md`。
- 背景工作在 app 程序內執行，只支援單一 app 副本。
