# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Changed
- AGENTS.md 新增「增量迭代原則」：每次工作都是在現有程式碼上的增量修改，不重建骨架、延伸既有模組、只改需求涉及的檔案、保留既有功能與測試、先接續 `[Unreleased]` 中進行中的項目。
- CrewAI 產生器（本機工具）：每個角色的 prompt 加入執行前的專案現況（版本、最近的 commit、CHANGELOG `[Unreleased]`），讓 agent 接續既有進度；驗證失敗的修正回合也會拿到 AGENTS.md、專案現況與 PM 的驗收條件。README 相應更新。
- 優先度 badge 色彩區分（`src/web/styles.css`）：新增獨立的 `.badge.p3` 規則，L3（中）改用 accent 系列 CSS 變數（背景 `--accent-soft`、文字 `--accent`），與狀態 badge 的 `new` / `open` 同一語意色系；L1、L2 維持 `.badge` 預設中性灰（`--surface-2` / `--text-muted`），不新增樣式。L4、L5 與狀態、SLA badge 樣式不變。淺色與深色主題的 badge 文字／背景對比皆 ≥ 4.5:1（WCAG 2.1 AA；沿用既有變數值，淺色約 5.2:1、深色約 5.4:1）。純樣式變更：無新增字典 key、無元件行為或 API 變更、無 migration、無新環境變數。需求與驗收條件見 `docs/PRD_SPEC.md` FR-5.3 / AC-THEME-02。

## [0.2.0] - 2026-10-24

介面視覺基礎：加入 UI 視覺規範 `DESIGN.md`，介面字型改為自架的 Google Noto。API、資料庫與部署設定沒有變更，從 0.1.0 升級只需重新建置映像。

### Added
- `DESIGN.md`：UI 視覺規範（風格參考，只定義淺色）；AGENTS.md 加入套用到 TicketDesk 的規則（不取品牌元素、必須有深色主題、字型、語意色、適用的元件）。
- 介面字型改為 Google Noto：英文 Noto Sans Display、中文 Noto Sans TC。DESIGN.md 的 Typography 同步更新；以 Fontsource 套件自架（Vite 打包成同源檔案），CSP 不變，內網部署也能使用；`vite.config.ts` 設定不把字型內嵌成 `data:` URI（否則會被 CSP 擋下）。

### Changed
- `crewai_ticket_build.py` 改為維護者本機工具，不納入版本控制（已從 git 歷史移除並列入 `.gitignore`）；README 與 AGENTS.md 相應說明。
- README 與部署指南補充：容器重建後 log 不會再出現一次性密碼，改用 `reset-password` 指令重設。
- CrewAI 產生器（本機工具）新增 UI 設計師角色（依根目錄 `DESIGN.md`），並改為：每個角色只能寫自己負責的路徑、PM 輸出 IMPACT 決定是否執行架構師／設計師、工程師與 QA 以 typecheck／測試 guardrail 自我修正、先做基準驗證、在 `crewai/<執行編號>` 分支上 commit、執行紀錄存到 `.crewai/runs/`。README 與 AGENTS.md 相應更新。

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
