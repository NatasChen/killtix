# TicketDesk

企業 IT 服務台與資安營運中心（SOC）用的工單管理系統。內部人員、外部廠商與一般使用者在同一個入口處理工單；
SOC、SIEM 等外部系統可以透過 API 自動開單。

## 版本資訊

| 項目 | 內容 |
| --- | --- |
| 目前版本 | **v0.6.0**，2026-10-26 |
| 狀態 | Docker 版可部署；99 個自動化測試、部署後 API 檢查與瀏覽器端到端測試皆通過 |
| 本版重點 | 儀表板統計期間（目前狀態與期間統計分開，可選起訖日）；工單清單可依建立日期篩選；所有頁面延遲載入，首頁 JS 減少約三成，一般使用者不再下載管理頁 |
| 尚未實作 | AD/LDAP、SAML、OIDC、SCIM、FIDO2、附件、SLA 營業時間（只支援 Docker 部署，Cloudflare 方案不做，見 DECISIONS D3） |
| 完整變更 | [CHANGELOG.md](CHANGELOG.md) |
| 與原始規格的差異 | [specs/DECISIONS.md](specs/DECISIONS.md)（含待客戶確認事項） |
| 接手開發 | 人或 AI Agent 請先讀 [AGENTS.md](AGENTS.md) |

## 功能

**帳號與安全**
- 本機帳號登入，密碼以 bcrypt 雜湊；連續失敗 5 次鎖定 15 分鐘；登入錯誤不透露帳號是否存在
- 預設管理員 `admin@ticket.local` 首次登入**強制改密**，改密前所有業務 API 都被拒絕
- 密碼政策：≥ 12 字元、四種字元、不可重複最近 5 次；改密後其他 session 全部失效
- TOTP 兩步驟驗證（含 10 組一次性復原碼），管理員可一鍵**全域強制**
- 稽核日誌：登入、改密、2FA、權限、工單異動、報表匯出

**工單**
- 5 級優先度、狀態機（`new → open → pending_user → resolved → closed`，非法轉換回 409）
- 服務類別（Help Topic）綁定表單、SLA、預設團隊與自動標籤
- 自訂欄位：9 種型別、必填、正規表示式驗證、公開／僅內部可見、可篩選
- 對話串：回覆對能看到工單的人公開，回覆時可選擇是否寄送 Email 通知；新增工單時可直接指派負責人
- 團隊指派：使用者可屬於多個團隊；工單可指派給團隊（沒有負責人時通知團隊成員），成員在詳情頁按「我來處理」認領；清單可依「我的團隊」篩選並顯示團隊欄
- 回覆範本（可插入工單編號、主旨、申請人）
- 多標籤，可依「符合任一／全部符合」篩選
- SLA：首次回應與解決期限、等待使用者期間暫停計時、即將逾時／已逾時自動標記

**權限（RBAC）**
- 角色：系統管理員、IT 服務主管、內部工程師、外部廠商、一般使用者、外部系統
- 權限在 **SQL 查詢層**套用：工程師看得到自己任一團隊（`team_members`）的工單；廠商只看得到被指派或被加入關注的工單，越權存取一律 404

**報表與儀表板**
- 儀表板分兩區：**目前狀態**（未結案、**超過 3 天未結案**、SLA 逾時／即將逾時、未結案天數直條圖、優先度長條圖，內部人員另有工程師負載與各團隊未結案）與**期間統計**（可選起訖日，預設近 30 天、最長 366 天：期間新增／解決、SLA 達標率儀表盤、新增與解決趨勢折線圖、狀態環形圖、熱門標籤 tag cloud、服務類別長條圖）；點圖表可下鑽到對應篩選的工單清單
- 工單清單可依狀態、優先度、負責人、標籤、SLA、建立日期、自訂欄位、「超過 3 天未結案」篩選
- CSV 匯出（含自訂欄位、Excel 可直接開啟中文、防公式注入）

**通知**：Email、Telegram Bot、Microsoft Teams；outbox 佇列、失敗重試、可在介面查看與重送。Email 的寄信方式由系統管理員在「系統設定 → 郵件設定」選擇：沿用 `SMTP_*` 環境變數（預設）、介面填寫的 SMTP，或 Resend API；儲存後立即生效，密碼與 API Key 加密儲存、只寫不讀，並可寄送測試信

**外部 API**：API Token（權限範圍 `tickets:write` / `tickets:read`）、`Idempotency-Key` 防重複開單、每 Token 速率限制，規格見 [docs/openapi.json](docs/openapi.json)

**介面**：繁體中文／English（所有文字來自 glossary 字典，可在系統設定中線上覆寫），淺色／深色／跟隨系統主題，支援手機寬度；系統管理員可上傳企業標誌（PNG，可另設深色背景版），顯示在登入頁與側邊欄

## 技術

| 層 | 使用 |
| --- | --- |
| 後端 | Node.js 24、TypeScript、[Hono](https://hono.dev)、Zod |
| 資料庫 | PostgreSQL 16，[Drizzle ORM](https://orm.drizzle.team) 與 migration |
| 快取 | Redis 7（速率限制） |
| 前端 | React 19、React Router、Vite |
| 測試 | Vitest + PGlite（程序內 PostgreSQL），可切換為真實 PostgreSQL |
| 部署 | Docker Compose（app + postgres + redis） |

```
瀏覽器 / SOC ──HTTPS──▶ 反向代理 ──▶ app 容器（API + 前端 + 背景工作）
                                        ├──▶ PostgreSQL（資料、通知佇列）
                                        └──▶ Redis（速率限制）
```

## 快速開始（Docker）

```bash
scripts/init-env.sh          # 建立 .env 並自動產生 APP_SECRET、POSTGRES_PASSWORD、REDIS_PASSWORD
docker compose up -d --build --wait
docker compose logs app | grep -A4 "bootstrap administrator"   # 取得預設管理員的一次性密碼
```

開啟 <http://localhost:8080>，以 `admin@ticket.local` 與 log 中的密碼登入，依畫面指示改密。

- 一次性密碼**只在第一次建立資料庫時**印出。容器重建（`down` / `up`）後 log 裡就沒有了；忘記或錯過時，用維運指令重設：
  `docker compose exec app node dist/server/cli.js reset-password admin@ticket.local`（會印出新的一次性密碼，登入後須改密）。
- `scripts/init-env.sh` 只填入空白的密鑰，已有值的不會覆蓋，可以重複執行。`.env` 權限會設為 600。
- 啟動時若出現 `required variable APP_SECRET is missing a value`，代表 `.env` 的密鑰還是空的，執行上面的 `scripts/init-env.sh` 即可。
- `APP_SECRET` 與 `POSTGRES_PASSWORD` 在首次啟動後**不要再更改**（前者會讓已啟用的 2FA 失效，後者會讓 app 連不上既有資料庫）。

- 想使用固定的初始密碼，在**第一次啟動前**於 `.env` 設定，例如 `BOOTSTRAP_ADMIN_PASSWORD=admin@password`（DECISIONS D1；初始密碼不檢查密碼政策，首次登入仍會強制改成符合政策的密碼）。資料庫已經有管理員時這個設定不會生效，請改用上面的 `reset-password`。
- 想先看有資料的畫面（展示、測試）：`TD_PASSWORD='<改過的密碼>' python3 scripts/seed-sample-tickets.py http://localhost:8080 --psql "docker compose exec -T postgres psql -U ticketdesk -d ticketdesk"`
  會建立 30 張範例工單（各種狀態、優先度、標籤，部分日期往前推，標籤 `sample`）。只用 Python 標準函式庫；Email 已設定時會停止，避免寄信給範例申請人。不要在正式環境執行。
- 正式環境設定（TLS、反向代理、備份、通知管道）見 [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)。

## API 範例（SOC 自動開單）

```bash
curl -X POST http://localhost:8080/api/v1/tickets \
  -H "Authorization: Bearer $TICKETDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: SOC-2026-0001" \
  -d '{
    "subject": "[SOC] EDR-0421 疑似勒索軟體行為",
    "description": "EDR 於 09:12 偵測到大量檔案加密行為，已隔離主機。",
    "helpTopic": "security-incident",
    "priority": 5,
    "requester": { "email": "soc@example.com", "name": "SOC Bot" },
    "tags": ["ransomware", "edr"]
  }'
```

回應 `201 Created`，內容包含工單編號（如 `TCK-2026-000123`）與 SLA 期限。以相同的 `Idempotency-Key` 重送會回 `200` 與同一張工單。

## 開發

需要 Node.js 24。

```bash
npm install
npm test                    # 單元與整合測試（PGlite，不需要資料庫）
npm run typecheck
npm run validate            # 完整品質檢查：型別、migration 一致性、測試、建置、文件連結、compose 設定

# 用真實 PostgreSQL 跑測試
docker run -d --rm --name td-testpg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm test

# 本機開發（需要 PostgreSQL）
export DATABASE_URL=postgres://... APP_SECRET=$(openssl rand -base64 48)
npm run dev:server          # API on :8080
npm run dev:web             # 前端 on :5173（代理 /api 到 :8080）
```

修改程式前請先讀 [AGENTS.md](AGENTS.md)：裡面有程式碼地圖、不可破壞的規則（授權、內部備忘、glossary、migration 等）、
常見任務的做法、完整驗證流程與已知陷阱。

### 目錄

```
├── src/server/            後端（Hono）
│   ├── routes/            API 路由：auth、tickets、reports、catalog、admin
│   ├── services/          工單、通知、SLA 工作、速率限制、稽核
│   ├── auth/              密碼、session、TOTP
│   ├── db/                Drizzle schema、連線、種子資料
│   ├── i18n/locales/      glossary 字典
│   ├── rbac.ts            角色權限與查詢層授權條件
│   └── cli.ts             維運指令（重設密碼）
├── src/web/               前端（React）
├── drizzle/               資料庫 migration（自動產生）
├── tests/                 Vitest 測試
├── scripts/               init-env.sh（產生 .env 密鑰）、validate.sh（品質檢查）、smoke.sh（部署後 API 檢查）、ui-e2e.sh（瀏覽器測試）、seed-sample-tickets.py（範例工單）
├── docs/                  PRD、部署指南、QA 測試計畫、OpenAPI
├── specs/                 客戶需求、實作決策、需求變更單
├── AGENTS.md              接手指南：程式碼地圖、規則、常見任務、已知陷阱
└── CLAUDE.md              讓 Claude Code 自動載入 AGENTS.md
```

## AI 輔助迭代（CrewAI，本機工具）

`crewai_ticket_build.py` 讓 PM／架構師／工程師／UI 設計師／QA 五個 AI agent 依需求變更修改專案（架構師只在部署設定有變時執行；UI 設計師只在畫面有變且根目錄有 `DESIGN.md` 時執行）。
它是**維護者本機的選用工具，不在 repo 內**（已列入 `.gitignore`）；沒有這個檔案不影響建置、測試與部署。
需要使用時向專案維護者取得，放在專案根目錄，並準備好 CrewAI 的 Python 環境（`~/crewai-env`）。

1. 在 [specs/change_request.md](specs/change_request.md) 寫下變更內容
2. 確認 git 工作目錄乾淨，執行 `~/crewai-env/bin/python crewai_ticket_build.py`（需要 `.env` 中的 `OPENROUTER_API_KEY`；`--check` 只檢查設定、不呼叫 LLM）
3. 先驗證目前狀態，再切到新分支 `crewai/<執行編號>`；agent 以 [AGENTS.md](AGENTS.md) 為工作規則，並會拿到執行前的專案現況（版本、最近的 commit、CHANGELOG `[Unreleased]`），在既有進度上接續修改；每個角色只能寫自己負責的路徑（讀不到 `.env`）
4. 完成後自動產生 migration 並執行 `scripts/validate.sh`；失敗會交回工程師 agent 修正（最多 2 次）。通過才在分支上 commit，確認後再合併回 `main`
5. 各角色的輸出與驗證紀錄存在 `.crewai/runs/<執行編號>/`

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | 部署、環境變數、反向代理、通知、備份、維運 |
| [docs/openapi.json](docs/openapi.json) | 外部 API 規格（OpenAPI 3.1） |
| [docs/PRD_SPEC.md](docs/PRD_SPEC.md) | 產品需求規格（需求基線） |
| [docs/QA_TEST_PLAN.md](docs/QA_TEST_PLAN.md) | 品質與資安測試計畫 |
| [specs/DECISIONS.md](specs/DECISIONS.md) | 與原始規格不同的實作決策（含待客戶確認事項） |
| [CHANGELOG.md](CHANGELOG.md) | 版本紀錄 |
| [AGENTS.md](AGENTS.md) | 接手指南（給 AI Agent 與開發者） |

## 安全注意事項

- 預設管理員只用於首次設定；改密後請另建具名的管理員帳號。
- `.env` 含所有密鑰，已列入 `.gitignore`，不要提交。`APP_SECRET` 部署後不可更換（用於加密 2FA 金鑰）。
- 正式環境務必使用 HTTPS（`APP_URL=https://...`），系統會自動啟用 Secure Cookie 與 HSTS。
- 瀏覽器端的寫入請求需帶 `X-Requested-With` 標頭（防 CSRF），並設有嚴格的 Content-Security-Policy。
- API Token 只在建立時顯示一次，資料庫只存雜湊；不再使用時請撤銷。
- 背景工作在 app 程序內執行，v0.1 請只執行一個 app 副本。

## 規劃

| 版本 | 內容 |
| --- | --- |
| v0.1.0 | ✅ Docker 版 MVP |
| v0.2.0 | ✅ UI 視覺規範 DESIGN.md、Google Noto 字型 |
| v0.3.0 | ✅ UI 重新設計第 1 批：設計 token、共用元件、登入頁與 sidebar |
| v0.4.0 | ✅ UI 改用 Ant Design 與第 2 批配色、企業 Logo、郵件設定（Resend）、建立時指派與回覆通知勾選、範例工單腳本 |
| v0.5.0 | ✅ 工單指派給團隊（多團隊、認領）、儀表板圖表與下鑽、淺色側邊欄選單與趨勢圖修正 |
| v0.6.0 | ✅ 儀表板統計期間、建立日期篩選、頁面延遲載入與首頁大小檢查（本版） |
| v1.1 | AD/LDAP、SAML、OIDC、SCIM、FIDO2；附件；SLA 營業時間 |
| 待定 | 背景工作獨立服務化、Slack 通知 |
