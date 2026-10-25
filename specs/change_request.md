<!--
需求變更單：要讓 CrewAI 產生器進行一次迭代時，在這個檔案寫下變更內容（例如「新增 Slack 通知」），
再執行 `python crewai_ticket_build.py`（維護者本機工具，不在 repo 內，見 README）。HTML 註解不算內容；檔案內容為空時產生器不會做任何事。
執行成功並通過驗證後，產生器會在 crewai/<執行編號> 分支上 commit，並清空這個檔案。
-->
# 工單指派給團隊，儀表板改用多種圖表

分兩部分：A. 團隊指派（需求 1–8）；B. 儀表板圖表（需求 9–13）。B 的「工程師負載」圖會用到 A 的團隊資料。

## A. 團隊指派

### 背景
工單目前已有「團隊」欄位（`tickets.team_id`，詳情頁可改），內部工程師（`ticket:read:team`）看得到自己團隊的工單；
但使用者只能屬於一個團隊（`users.team_id`），新增工單時不能選團隊，指派給團隊時團隊成員不會收到通知，清單也不能依團隊篩選。
這次讓工單可以指派給團隊，同一團隊的成員都能看到並共同處理，再由其中一人認領成為負責人。

### 需求
1. **使用者可屬於多個團隊**：
   - 新增資料表 `team_members`（`team_id`、`user_id`，複合主鍵，兩者皆 `on delete cascade`），在 `src/server/db/schema.ts` 定義；
     migration 由流程自動產生，**不要手寫 SQL**。
   - 既有資料轉移：`users.team_id` 這次**保留但不再使用**（之後的版本再移除）。在 `db/seed.ts` 加一次性回填：
     把 `users.team_id` 不為空的使用者寫入 `team_members`，完成後在 `system_settings` 記錄 `migrations.team_members_backfilled`，
     之後啟動不再執行（不可在管理員移除成員後又被加回來，AGENTS.md 規則 8）。
   - 程式中所有讀寫 `users.team_id` 的地方改用 `team_members`：`rbac.ts` 的 `ticketScope()`、`routes/util.ts` 的 `publicUser`、
     `routes/catalog.ts` 的使用者清單、`routes/admin.ts` 的使用者建立與更新、前端 `auth.tsx` 的型別。
     API 欄位由 `teamId` 改為 `teamIds: number[]`（使用者建立、更新、`/auth/me`、`/catalog` 的使用者）。
2. **可見範圍（授權在 SQL 查詢層，AGENTS.md 規則 1、2）**：
   - `ticketScope()`：有 `ticket:read:team` 的使用者，可看到 `tickets.team_id` 是自己**任一**團隊的工單。
     用 `exists (select 1 from team_members …)` 子查詢寫在查詢條件中，不可先查全部再過濾。
   - 外部廠商（`vendor`）與一般使用者維持現狀：即使被加入團隊，也只看得到被指派、自己開立或被加入關注的工單。
   - 看不到的工單仍回 404。
3. **新增工單可選團隊**：`tickets/new` 在「負責人」旁加「團隊」下拉選單，只有 `ticket:assign` 權限的人看得到；
   API `createTicketSchema` 加 `teamId`（選填，需要 `ticket:assign`，否則 403；不存在的團隊回 400）。
   沒填時沿用服務類別的預設團隊（現有行為）。團隊與負責人可以同時指定，也可以只指定其中一個。
4. **指派給團隊時通知成員**：新增通知事件 `team_assigned`（`services/notify.ts` 的 `TicketEvent`，字典 `notify.team_assigned.subject/body/teams`，兩個語系）。
   - 觸發時機：工單建立時有團隊且**沒有**負責人；或更新時團隊改變且工單**沒有**負責人。
   - 收件者：該團隊所有啟用中、具 `ticket:read:team` 或 `ticket:read:all` 權限的成員（不含執行這個動作的人）；
     廠商與一般使用者不會收到。已有負責人時不發這個通知（照舊只通知負責人）。
5. **認領（「我來處理」）**：工單詳情頁在「負責人」欄位旁加「我來處理」按鈕，條件為：目前使用者有 `ticket:assign`、
   工單沒有負責人或負責人不是自己、工單未結案。按下後以既有的 `PATCH /tickets/{id}` 把負責人設為自己
   （沿用既有行為：狀態為「新建立」時改為「處理中」，並通知負責人）。不新增 API。
6. **清單依團隊篩選**：工單清單的篩選列加「團隊」下拉選單，選項為「全部」、「我的團隊」與各團隊名稱。
   API 的 `teamId` 篩選參數接受團隊編號或 `mine`（目前使用者的任一團隊；沒有團隊時結果為空）。清單加「團隊」欄。
7. **管理介面**：「使用者」頁的團隊欄位與新增使用者表單改為多選（antd `Select mode="multiple"`，label 綁定控制項）。
   「團隊」頁每一列顯示成員數。
8. 所有新文字走 glossary（兩個語系）；UI 一律用 Ant Design 元件與 `palette.ts`，送出按鈕同時設 `loading` 與 `disabled`。

## B. 儀表板圖表

### 背景
儀表板（`pages/Dashboard.tsx`、`routes/reports.ts` 的 `GET /reports/dashboard`）目前除了數字卡，四張圖都是同一種水平長條，而且沒有時間趨勢。
這次改用多種圖表。**不新增任何套件**：圖表用 SVG 自己畫（方案 A），SLA 用 antd 內建的 `Progress type="dashboard"`。

### 需求
9. **API 新增資料**（`GET /reports/dashboard`，全部沿用既有的 `buildTicketConditions()`，每個人只統計自己看得到的工單，AGENTS.md 規則 1）：
   - `trend30d: { date: 'YYYY-MM-DD', created: number, resolved: number }[]`：最近 30 天（含今天，依 `config.timezone` 切日），
     每天都有一筆，沒有資料的日子為 0；時間用 `deps.clock()`。raw `sql` 中的日期寫成 `${date.toISOString()}::timestamptz`（AGENTS.md 陷阱 1）。
   - `agingBuckets: { key: '0-1' | '1-3' | '3-7' | '7-14' | '14+', n: number }[]`：未結案工單依已開立天數分組。
     「超過 3 天」的界線必須用 `agingCondition()`（AGENTS.md 規則 7），`3-7`、`7-14`、`14+` 三組加總必須等於 `olderThan3Days`。
   - `workload: { assigneeId: number | null, name: string | null, n: number }[]`：未結案工單依負責人統計（前 10 名，另加「未指派」一筆）；
     `byTeam: { teamId: number | null, name: string | null, n: number }[]`：未結案工單依團隊統計。
     這兩項只回給內部人員（`isStaff()`），其他人為 `null`（同 `failedNotifications`）。
10. **圖表元件**：新增 `src/web/components/charts.tsx`，用 SVG 實作下列元件，顏色只取自 `palette.ts`（`usePalette()`、`tone()`），
    深淺色主題都正確，以 `viewBox` 縮放，375px 寬不可出現水平捲軸：
    - `Donut`：環形圖，中間顯示總數，旁邊有圖例（名稱＋數字）。
    - `LineChart`：兩條折線（新增、解決），有 X 軸日期刻度、Y 軸刻度與圖例；滑過或聚焦資料點時顯示當天數字（antd `Tooltip` 即可）。
    - `Columns`：直條圖，柱上或柱下標示數字。
    - `TagCloud`：標籤依數量決定字級（至少 4 級），顏色輪流使用 sticker 色，用 antd `Tag` 或連結呈現。
    - 既有的 `Bars`（水平長條）搬到這個檔案共用。
    每個圖表都要有文字替代：SVG 加 `role="img"` 與描述內容的 `aria-label`，數字同時以文字呈現（不單靠顏色或圖形傳達，DESIGN 規範）。
11. **儀表板版面**（數字卡保留不變）：
    - 第一列：「近 30 天新增與解決」折線圖（全寬）。
    - 第二列：狀態分布環形圖、未結案天數直條圖（超過 3 天的三組用警示色）、SLA 達標率儀表盤（antd `Progress type="dashboard"`）。
    - 第三列：優先度長條圖、熱門標籤 tag cloud（取代標籤長條圖）、服務類別長條圖。
    - 第四列（只有內部人員）：工程師負載長條圖、各團隊未結案長條圖。
    - 窄螢幕時每張圖一列。
12. **點擊導向清單**：點環形圖的狀態 → `/tickets?status=<狀態>`；點標籤 → `/tickets?tags=<標籤>`；點優先度 → `/tickets?priority=<n>`；
    點未結案天數「超過 3 天」的任一組 → `/tickets?olderThanDays=3`；點團隊 → `/tickets?teamId=<id>`。可點的元素要能用鍵盤操作（連結或按鈕）。
13. 所有新文字走 glossary（兩個語系）。

## 不在範圍（A、B 共同）
- 工單同時指派給多個團隊；團隊主管、團隊層級的權限或 SLA；依團隊的報表。
- 廠商透過團隊看到工單（維持只看被指派的）。
- 移除 `users.team_id` 欄位（下一版再做）。
- SLA 逾時通知的收件者（維持現狀）。
- 新的環境變數或部署變更。
- 儀表板：word cloud（主旨斷詞）、任何圖表套件（包括 `@ant-design/charts`）、日期區間選擇、匯出圖片。

## 驗收條件（A、B 共同）
- 既有使用者的團隊在升級後保留：`users.team_id` 有值的使用者啟動後出現在 `team_members`；管理員把他移出團隊、重新啟動後不會被加回。
- 屬於兩個團隊的工程師看得到兩個團隊的工單；不屬於該團隊的工程師讀取該團隊工單回 404，清單中也看不到；被移出團隊後立即看不到。
- 屬於某團隊的廠商與一般使用者，看不到該團隊中未指派給他、非他開立、未關注的工單（回 404）。
- 新增工單時指定團隊：有 `ticket:assign` 的使用者成功，一般使用者回 403，不存在的團隊回 400；只指定團隊時狀態維持「新建立」。
- 指派給團隊且沒有負責人時，通知寄給該團隊具內部權限的啟用中成員（不含操作者、廠商、一般使用者、停用的使用者）；有負責人時不寄團隊通知。測試用 `dispatchPending(deps, fakeSenders)` 或檢查 outbox，不連外。
- 清單 `teamId=mine` 只回傳自己任一團隊的工單；沒有團隊的使用者結果為空。
- 使用者 API 以 `teamIds` 讀寫多個團隊；`/auth/me` 與 `/catalog` 回傳 `teamIds`。
- e2e（`tests/e2e/ui.mjs` 新增團隊步驟）：管理員在「新增工單」選擇團隊建立工單 → 工單清單選「團隊」篩選可看到該工單、團隊欄顯示團隊名稱 → 進入詳情按「我來處理」後負責人顯示為自己、狀態變為「處理中」 → 「使用者」頁可為使用者選擇兩個團隊並在重新整理後仍顯示兩個團隊。
- `trend30d` 固定 30 筆、日期連續、沒有資料的日子為 0；用 `ctx.clock` 控制時間的測試中，各日的新增與解決數正確（含時區切日）；用真實 PostgreSQL 也通過。
- `agingBuckets` 的 `3-7`、`7-14`、`14+` 加總等於 `olderThan3Days`；剛好 72 小時的工單不算超過 3 天。
- 一般使用者的儀表板只統計自己看得到的工單，`workload` 與 `byTeam` 為 `null`；工程師只統計自己範圍內的工單。
- e2e（新增儀表板步驟）：儀表板顯示折線圖、環形圖、未結案天數圖、tag cloud（以 `aria-label` 或圖例文字找到）；點環形圖的某個狀態會進入工單清單且狀態篩選為該狀態；點 tag cloud 的標籤會進入清單且標籤篩選為該標籤；深色主題與 375px 寬度的截圖沒有水平捲軸。
- 文件依 AGENTS.md「增量迭代原則」：CHANGELOG 一段；PRD、QA 計畫各加幾列；DECISIONS 記錄「使用者可屬於多個團隊、`users.team_id` 暫時保留」；AGENTS.md 程式碼地圖（`components/charts.tsx`、`team_members`）與規則 1 的說明同步；測試數同步（validate 會檢查）。
