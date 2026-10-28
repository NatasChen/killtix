# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Added
- 開源授權：GNU Affero General Public License v3.0（`AGPL-3.0-only`）。新增 `LICENSE`，`package.json`、OpenAPI `info.license` 與 README 標示授權；Docker 映像內附 `LICENSE`。
- docker compose 新增 `nginx` 服務（`nginx:1.30-alpine`，設定 `deploy/nginx/default.conf`）：監聽 HTTP（`HTTP_BIND`/`HTTP_PORT`，預設 `0.0.0.0:80`）並轉送到 `app:8080`，以用戶端位址覆寫 `X-Forwarded-For`；`scripts/validate.sh` 新增 `nginx -t` 檢查（DECISIONS D19）。TLS 尚未內建。
- API Token 開單可指定團隊：`POST /tickets` 新增 `team`（團隊名稱，不分大小寫）與 `teamId`（擇一），覆寫服務類別的預設團隊並通知團隊成員；新增 `GET /api/v1/teams`（`tickets:write`）列出團隊。Token 仍不能指定負責人（DECISIONS D21）。OpenAPI 同步更新。
- 通知總開關（「系統設定 → 通知設定 → 啟用通知」，`notificationsEnabled`），**預設關閉**：關閉時通知記為「通知已停用」（`disabled`）、不發送，重新開啟後不補寄，可在通知紀錄逐筆重送。
- Telegram Bot Token 與 Teams Webhook URL 改在「通知設定」填寫（`GET/PUT /admin/settings/channels`），加密儲存、只寫不讀，可移除；寫入稽核 `admin.notify_channels_updated`（不含值）。
- 側邊欄的管理頁分成可摺疊的「使用者管理」「工單設定」「系統相關」三個群組，目前頁面的群組自動展開，展開狀態記在瀏覽器；每個項目改用圖示（Ant Design Icons，依群組著色）取代色塊。

### Changed
- 主題改為側邊欄的太陽／月亮開關，只有淺色與深色，預設淺色，取消「跟隨系統」（DECISIONS D20）。`PATCH /auth/me` 的 `theme` 不再接受 `system`；migration 0005／0006 把既有的 `system` 改為 `light` 並收緊 `chk_users_theme`。
- 所有通知管道只在介面設定（DECISIONS D13）：移除 `SMTP_*`、`TELEGRAM_BOT_TOKEN`、`TEAMS_WEBHOOK_URL` 環境變數與郵件設定的「環境變數（SMTP）」選項；先前存成 `env` 的郵件設定視為未設定。`scripts/seed-sample-tickets.py` 改為在通知開啟時停止。
  **升級時**：在「系統設定」重新填寫 Email／Telegram／Teams，寄出測試信後再開啟「啟用通知」。
- app 不再對主機發布連接埠，只有 nginx 連得到；`APP_BIND`、`APP_PORT` 移除。compose 的預設值 `TRUST_PROXY` 改為 `true`、`APP_URL` 改為 `http://localhost`。
  **升級時**：把 `.env` 的 `APP_BIND`/`APP_PORT` 換成 `HTTP_BIND`/`HTTP_PORT`，`TRUST_PROXY` 設為 `true`（否則稽核日誌記錄的是 nginx 的位址），`APP_URL` 改成經 nginx 的網址；原本指向 `127.0.0.1:8080` 的外部反向代理改指向 nginx 的埠。
- 部署指南第 4 節補上完整的 API 開單說明：欄位表、最小範例、查詢服務類別與團隊、錯誤碼；README 的 API 範例連結過去。

## [0.9.0] - 2026-10-27

系統名稱可自訂，上傳標誌後名稱不再消失。沒有資料表、環境變數或部署變更。

### Added
- 系統名稱可自訂（系統設定的「標誌與名稱」，預設 TicketDesk，1–40 字），顯示在登入頁、側邊欄標誌旁與瀏覽器分頁標題；`GET /branding` 回應新增 `name`，新增 `PUT /admin/branding/name`（`admin:settings`，寫入稽核 `admin.brand_name_updated`）。存在 `system_settings`，沒有 migration（DECISIONS D11）。

### Fixed
- 上傳企業標誌後登入頁與側邊欄的 TicketDesk 名稱消失：標誌與名稱改為兩個元素，標誌高度縮為 32 像素並排在名稱左側。

### Changed
- `specs/DECISIONS.md` 精簡：D1、D14 只留結論（過程見 CHANGELOG），D8 移除已不適用的 CSS 變數規則，D17（實作慣例）移到 AGENTS.md 第 3 節；編號不變。

## [0.8.0] - 2026-10-26

團隊頁管理成員。沒有資料表、環境變數或部署變更。

### Added
- 「團隊」頁每一列可展開，顯示成員與目前狀態：名稱與 email、角色（廠商與一般使用者註明「不會因團隊看到工單」）、帳號狀態（啟用／停用／鎖定）、指派給他的未結案工單數（連到工單清單）；同一處可加入（多選）與移除成員，成員數即時更新（PRD FR-2.12，DECISIONS D18）。
- API：`GET /admin/teams/{id}/members`（`members`、可加入的 `candidates`）、`POST /admin/teams/{id}/members`（`userIds`，只接受啟用中、非外部系統的帳號）、`DELETE /admin/teams/{id}/members/{userId}`；需要 `catalog:manage`（系統管理員、IT 服務主管），寫入稽核 `admin.team_members_added`／`admin.team_member_removed`。
- `CrudPage` 新增選用的 `expand`（可展開的列）；新增 `pages/admin/TeamMembers.tsx`。
- `tests/teams.test.ts` 新增 2 項（成員狀態與候選名單；加入／移除、可見範圍、無效輸入、權限、稽核），e2e 新增團隊頁展開、加入與移除步驟。

## [0.7.0] - 2026-10-26

移除 `users.team_id` 與 Cloudflare 方案。升級時啟動會自動套用 migration `0003_team_members_backfill`、`0004_drop_users_team_id`；不需新增環境變數，沒有部署變更。**升級後無法退回 v0.4 以前的版本**（DECISIONS D14）。

### Removed
- `users.team_id`（DECISIONS D14）：團隊成員資格只存在 `team_members`。migration 0003（drizzle-kit `--custom`）在刪欄位前用 SQL 把仍有值的使用者搬到 `team_members`，已在 v0.5／v0.6 啟動時回填過的部署略過（管理員移除的成員不會被加回），並刪除 `system_settings` 的回填旗標；0004 刪除欄位與索引。`db/seed.ts` 的啟動回填一併移除。
- Cloudflare Workers 方案（DECISIONS D3：不做）：刪除 `deploy/cloudflare/` 與 `.gitignore` 的 Wrangler 項目；README、部署指南、AGENTS.md 改為只支援 Docker，PRD FR-6.2 與 QA 計畫的 Cloudflare 項目標示不適用。

### Changed
- 預設管理員密碼（DECISIONS D1）、Cloudflare（D3）、`users.team_id`（D14）改為已決定。
- 測試：團隊回填測試改為實際升級測試（`tests/helpers.ts` 新增 `databaseAt()`：建出指定 migration 時的結構、放入舊資料，再套用其餘 migration；PGlite 與真實 PostgreSQL 皆可），分別驗證從 v0.4 與從 v0.5／v0.6 升級。AGENTS.md 補上搬資料用 `--custom` migration 的做法。

## [0.6.0] - 2026-10-26

儀表板統計期間與前端延遲載入。沒有資料表、環境變數或部署變更；`GET /reports/dashboard` 的回應欄位有變動（只有本系統前端使用，見 DECISIONS D16）。

### Added
- 儀表板統計期間（DECISIONS D16）：「期間統計」區可選起訖日（快捷選項：今天、近 7／30／90 天、本月、今年；最長 366 天，不可選未來日期），期間記在網址（`/?from=&to=`）。期間新增、期間解決、SLA 達標率、新增與解決趨勢（超過 92 天改為每週一點）、狀態分佈、常見標籤、服務類別依期間計算；「目前狀態」區（未結案、超過 3 天、SLA 逾時／即將逾時、通知失敗、未結案天數、優先度、工程師負載、各團隊）不受期間影響。`GET /reports/dashboard` 接受 `from`、`to`（`config.timezone` 的日曆日，含頭尾），格式錯誤、起日晚於迄日或超過 366 天回 400。
- 工單清單與 CSV 匯出新增 `createdFrom`／`createdTo` 篩選（日曆日、含頭尾），清單的篩選表單新增「建立日期」區間；儀表板期間圖表的下鑽連結帶上同一段日期。`docs/openapi.json` 同步。
- `scripts/bundle-check.mjs`（`validate.sh` 執行）：首頁 JS 超過 300 KB（gzip），或首頁含有只在管理頁使用的字典 key 時失敗。
- `tests/dashboard.test.ts` 新增 2 項（期間計算與當地午夜邊界、每週彙總與無效期間），e2e 新增儀表板期間步驟（快捷選項、區段標題、7 個資料點、下鑽後清單顯示建立日期）。

### Changed
- 前端依頁面延遲載入（DECISIONS D17）：`AdminRoutes.tsx`（原本近 1,000 行）拆成 `pages/admin/` 下的 `UsersPage`、`CatalogPages`（團隊、SLA、服務類別、回覆範本）、`FormsPage`、`ApiTokensPage`、`SettingsPage`（`LogoSettings`、`MailSettingsCard`）、`NotificationsPage`、`AuditPage` 與共用的 `shared.tsx`；所有頁面（含登入頁）經 `src/web/lazy.ts` 的 `lazyPage()` 延遲載入，React 獨立成 `react` 檔案。首頁 JS 由 1,195 KB（gzip 376 KB）降為 797 KB（gzip 259 KB）；一般使用者與廠商不再下載管理頁。頁面載入中側邊欄保留，內容區顯示載入圖示。行為、路由與文字不變。
- 儀表板改為「目前狀態」與「期間統計」兩區；「今日新增」「今日解決」改為「期間新增」「期間解決」，「SLA 達標率」「常見標籤」「服務類別」「狀態分佈」改依期間計算。`GET /reports/dashboard` 回應新增 `range`、`trend`、`newInRange`、`resolvedInRange`、`slaMetRate`，移除 `trend30d`、`slaMetRate30d`、`newToday`、`resolvedToday`。
- 趨勢圖的日期標籤依資料點數自動調整為約 6 個；未結案天數直條圖限制最大寬度，兩欄版面下不會被放大。
- `dayjs` 列入 `devDependencies`（與 antd 使用的版本相同，沒有新增下載），供日期區間選擇使用。

## [0.5.0] - 2026-10-26

工單指派給團隊：使用者可屬於多個團隊，工單可指派給團隊由成員共同處理並認領。升級時啟動會自動套用 migration（新增 `team_members`）並一次性回填既有 `users.team_id`；不需新增環境變數，沒有部署變更。

儀表板圖表：四張同型水平長條改為折線圖、環形圖、直條圖、tag cloud 與 SLA 儀表盤，並可點擊下鑽到工單清單。圖表以 SVG 自繪、不新增套件；沒有環境變數、部署或資料表變更。

### Added
- 使用者可屬於多個團隊：新增 `team_members`（`team_id`、`user_id`，複合主鍵，皆 `on delete cascade`）。`users.team_id` 保留但不再使用，下一版移除（DECISIONS D14）。啟動時一次性把 `users.team_id` 有值的使用者回填到 `team_members`，完成後在 `system_settings` 記錄 `migrations.team_members_backfilled`，之後不再執行（管理員移除成員後不會被加回）。
- 使用者 API 的團隊欄位改為 `teamIds: number[]`（建立、更新、`/auth/me`、`/catalog` 的使用者清單）；「使用者」頁的團隊欄位與新增使用者表單改為多選，「團隊」頁每列顯示成員數。
- 新增工單時可選團隊（`tickets/new` 的「團隊」下拉選單，只有 `ticket:assign` 權限者看得到）；`createTicketSchema` 新增選填 `teamId`，沒有 `ticket:assign` 回 403、團隊不存在回 400；未填時沿用服務類別的預設團隊。團隊與負責人可同時或只指定其中一個。
- 通知事件 `team_assigned`：工單建立時有團隊且沒有負責人，或更新時團隊改變且沒有負責人時，通知該團隊所有啟用中、具 `ticket:read:team` 或 `ticket:read:all` 權限的成員（不含操作者；廠商與一般使用者不會收到）。已有負責人時不發此通知。
- 工單詳情頁「負責人」欄位旁新增「我來處理」按鈕：有 `ticket:assign`、工單未結案且沒有負責人或負責人不是自己時顯示；按下後沿用 `PATCH /tickets/{id}` 把自己設為負責人（狀態為「新建立」時改為「處理中」並通知負責人），不新增 API。
- 工單清單新增「團隊」篩選（全部／我的團隊／各團隊）與「團隊」欄；API 的 `teamId` 篩選參數接受團隊編號或 `mine`（目前使用者的任一團隊；沒有團隊時結果為空）。
- 新增 `tests/teams.test.ts`（8 項：回填、多團隊 API、可見範圍與 404、廠商／一般使用者隔離、`teamId=mine`、建立時指定團隊、團隊通知收件者、認領）與 e2e 團隊步驟。
- 儀表板改用多種圖表（PRD FR-3.5、DECISIONS D15）：近 30 天新增與解決折線圖、狀態環形圖、未結案天數直條圖（超過 3 天的三組用警示色）、SLA 達標率儀表盤、熱門標籤 tag cloud，內部人員另有工程師負載與各團隊未結案。圖表在新的 `components/charts.tsx` 以 SVG 自繪，不新增套件；點圖表會進入對應篩選的工單清單（狀態、標籤、優先度、超過 3 天、團隊、負責人，「未指派」為 `assignee=none`）。
- `GET /reports/dashboard` 新增 `trend30d`（30 天、依 `config.timezone` 切日、沒有資料補 0）、`agingBuckets`（超過 3 天的三組沿用 `agingCondition()`，加總等於 `olderThan3Days`）、`workload` 與 `byTeam`（只給內部人員，其他人為 `null`），都只統計自己看得到的工單。新增 `tests/dashboard.test.ts`（5 項）與 e2e 儀表板步驟。

### Changed
- 可見範圍：有 `ticket:read:team` 的使用者改為可看到 `tickets.team_id` 是自己**任一**團隊的工單，條件以 `exists (select 1 from team_members …)` 子查詢寫在查詢層（`ticketScope()`）。外部廠商與一般使用者維持現狀：即使被加入團隊，仍只看得到被指派、自己開立或被加入關注的工單；看不到的工單一律回 404。
- `rbac.ts` 的 `ticketScope()`、`routes/util.ts` 的 `publicUser`、`routes/catalog.ts` 的使用者清單、`routes/admin.ts` 的使用者建立與更新、前端 `auth.tsx` 的型別都改讀寫 `team_members`，不再讀寫 `users.team_id`。

### Fixed
- 淺色主題下，側邊欄「主題」「語言」下拉選單的選項是白底白字而無法辨識：選單改用側邊欄自己的深色底色與滑過、選取色。e2e 新增對比檢查（≥ 4.5:1）。
- 儀表板「近 30 天新增與解決」折線圖在寬螢幕被限制在固定大小、兩側留白，手機上軸文字縮得過小：圖表寬度改為跟隨卡片實際寬度，高度與 11px 文字固定。e2e 新增寬度檢查。

## [0.4.0] - 2026-10-25

升級：啟動時自動套用 migration `0001_brand_logos`；不需新增環境變數，Email 預設沿用既有的 `SMTP_*`。

### Added
- `scripts/seed-sample-tickets.py`：經 API 建立 30 張範例工單（各種服務類別、優先度、狀態、負責人與回覆，標籤 `sample`），可用 `--psql` 把部分工單日期往前推以填滿「超過 3 天未結案」與報表；只用 Python 標準函式庫，Email 已設定時預設停止。
- 新增工單時可直接指派負責人（有 `ticket:assign` 權限的系統管理員、IT 主管、工程師才看得到這個欄位）；指派後工單直接為「處理中」，並通知負責人，與事後指派相同。
- 企業標誌（PRD FR-5.5，DECISIONS D11）：系統管理員可在「系統設定」上傳 PNG 標誌（512 KB 以內，伺服器檢查 PNG 檔頭），顯示在登入頁與側邊欄頂端並依比例縮放；可另外上傳深色背景用的標誌，側邊欄與深色主題的登入頁使用，沒有時改用淺色的。標誌存在新的 `brand_logos` 資料表（migration `0001_brand_logos`），由公開的 `GET /api/v1/branding` 與 `/api/v1/branding/logo/{light|dark}` 提供；新增 `tests/branding.test.ts`（5 項）與 e2e 的上傳步驟。
- 郵件設定（PRD FR-4.3，DECISIONS D13）：系統管理員可在「系統設定 → 郵件設定」選擇寄信方式：`env`（沿用 `SMTP_*` 環境變數，預設，升級後行為不變）、`smtp`（介面填寫）或 `resend`（以 `fetch` 呼叫 Resend API，不新增套件）。設定存在 `system_settings`，SMTP 密碼與 API Key 以 `secretBox` 加密、只寫不讀，留空表示不變更，無法解密時視為未設定並提示重新輸入；頁面顯示目前實際使用的寄信方式。可寄送測試信（每人每分鐘 5 次，結果直接顯示）。新增 `tests/mailSettings.test.ts`（8 項）與 e2e 步驟。

### Changed
- 測試防護：`tests/setup.ts` 擋下測試中的對外連線（`fetch`、DNS、非 loopback socket），即使錯誤被程式吞掉也會讓測試失敗；`scripts/validate.sh` 比對 AGENTS.md 與 README 記載的測試數與實際執行數。
- Email 的寄送方式改為每次寄信時讀取目前設定，儲存後立即生效、不需重新啟動；Telegram、Teams 仍由環境變數設定。沒有部署變更。
- 回覆不再區分對外回覆與內部備忘（DECISIONS D12）：所有新回覆都對能看到工單的人公開，回覆時用「寄送 Email 通知」勾選框（預設勾選）決定是否通知對方（工程師回覆通知申請人，申請人回覆通知負責人）。API 的 `POST /tickets/{id}/threads` 改為 `{ body, notify }`，舊的 `type: "internal_note"` 回 400；已存在的內部備忘仍只有內部人員看得到。
- 介面改用 Ant Design（antd 6.6.5，DECISIONS D10）：所有頁面改用 antd 的 Layout、Menu、Card、Table、Form、Select、Tag、Alert 等元件；顏色集中在 `src/web/palette.ts`，以 theme token 傳給 antd，深色主題用 `darkAlgorithm`。D9 的配色（深靛藍側邊欄、狀態色、sticker 色盤）與文字、行為、路由不變。`styles.css` 只剩版面；`tests/styles.test.ts` 改為檢查 `palette.ts` 與 antd 主題（25 項），e2e 改用 antd 下拉選單的操作方式。
- UI 重新設計第 2 批（PRD FR-5.4）：介面加入色彩。側邊欄改為深靛藍；選單項目依功能群組加上色塊；狀態 badge 各用一種色相，不再與 L3 優先度撞色；儀表板統計卡依意義加上色帶，數字統一為內文色；長條圖依狀態、優先度上色，標籤與服務類別輪流使用 sticker 色。sticker 色盤改為可用於有意義的資料色（`specs/DECISIONS.md` D9）。
- 版面修正：工單清單的編號、badge、負責人、已開立不再折行；表格內容垂直置中；使用者表格操作欄的框線對齊；儀表板卡片每列 4 張、圖表每列 2 張；工單詳情右欄加寬，「加入關注者」選單與按鈕在同一列。

### Fixed
- 工單詳情右欄：負責人名稱較長時，下拉選單會把面板撐寬，手機寬度出現水平捲軸；改為截斷顯示（滑過可看完整名稱）。
- 未登入時 `/auth/me` 的 401 會觸發重新整理登入狀態，而重新整理又呼叫 `/auth/me`，登入頁因此不斷輪詢伺服器；`/auth/me` 本身的 401 不再觸發重新整理。

## [0.3.0] - 2026-10-24

介面重新設計第 1 批：依 `DESIGN.md` 更新設計 token、共用元件、登入頁與 sidebar；優先度 L3 badge 加上區分色。API、資料庫與設定沒有變更。

### Changed
- AGENTS.md 新增「增量迭代原則」：每次工作都是在現有程式碼上的增量修改，不重建骨架、延伸既有模組、只改需求涉及的檔案、保留既有功能與測試、先接續 `[Unreleased]` 中進行中的項目。
- CrewAI 產生器（本機工具）：每個角色的 prompt 加入執行前的專案現況（版本、最近的 commit、CHANGELOG `[Unreleased]`），讓 agent 接續既有進度；驗證失敗的修正回合也會拿到 AGENTS.md、專案現況與 PM 的驗收條件。README 相應更新。
- AGENTS.md「增量迭代原則」補充：文件與測試的篇幅要和變更大小成比例；測試數量有變時同步更新 AGENTS.md 與 README。CrewAI 產生器（本機工具）相應調整：PM 只在需求有變時更新 PRD、QA 只為新增的案例更新測試計畫並負責更新測試數（可寫 README）、QA 只回報自己實際執行的結果；commit 標題去掉變更單開頭的 Markdown `#`。
- 優先度 badge：L3（中）改用 accent 系列 CSS 變數，與 L1／L2 的中性灰區分；L4、L5 與狀態、SLA badge 不變，兩種主題的對比皆達 WCAG AA。新增 `tests/styles.test.ts` 檢查 badge 只使用兩種主題都有定義的變數，且對比達標。
- UI 重新設計第 1 批（PRD FR-5.4）：依 `DESIGN.md` 更新 `src/web/styles.css` 的設計 token（暖白 canvas-soft、白卡片、hairline、ink 文字層級、單一主色藍）、由淺色推導深色主題、語意色維持獨立變數，並調整共用元件（按鈕、輸入框、卡片、表格、badge、modal、toast、空狀態、錯誤訊息）與登入／改密／2FA 頁面（`ex-auth-form-card`）、左側 sidebar 的色彩與間距。既有 CSS 變數名稱只增不改不刪；不改元件行為、API、路由與文字，不新增字典 key。第 2 批（各頁面版面細節）在下一版進行。

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
