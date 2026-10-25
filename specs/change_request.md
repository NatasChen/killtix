<!--
需求變更單：要讓 CrewAI 產生器進行一次迭代時，在這個檔案寫下變更內容（例如「新增 Slack 通知」），
再執行 `python crewai_ticket_build.py`（維護者本機工具，不在 repo 內，見 README）。HTML 註解不算內容；檔案內容為空時產生器不會做任何事。
執行成功並通過驗證後，產生器會在 crewai/<執行編號> 分支上 commit，並清空這個檔案。
-->
# 儀表板改用多種圖表

## 背景
儀表板（`pages/Dashboard.tsx`、`routes/reports.ts` 的 `GET /reports/dashboard`）目前除了數字卡，四張圖都是同一種水平長條，而且沒有時間趨勢。
這次改用多種圖表。**不新增任何套件**：圖表用 SVG 自己畫（方案 A），SLA 用 antd 內建的 `Progress type="dashboard"`。

## 需求
1. **API 新增資料**（`GET /reports/dashboard`，全部沿用既有的 `buildTicketConditions()`，每個人只統計自己看得到的工單，AGENTS.md 規則 1）：
   - `trend30d: { date: 'YYYY-MM-DD', created: number, resolved: number }[]`：最近 30 天（含今天，依 `config.timezone` 切日），
     每天都有一筆，沒有資料的日子為 0；時間用 `deps.clock()`。raw `sql` 中的日期寫成 `${date.toISOString()}::timestamptz`（AGENTS.md 陷阱 1）。
   - `agingBuckets: { key: '0-1' | '1-3' | '3-7' | '7-14' | '14+', n: number }[]`：未結案工單依已開立天數分組。
     「超過 3 天」的界線必須用 `agingCondition()`（AGENTS.md 規則 7），`3-7`、`7-14`、`14+` 三組加總必須等於 `olderThan3Days`。
   - `workload: { assigneeId: number | null, name: string | null, n: number }[]`：未結案工單依負責人統計（前 10 名，另加「未指派」一筆）；
     `byTeam: { teamId: number | null, name: string | null, n: number }[]`：未結案工單依 `tickets.team_id` 統計（含「沒有團隊」一筆）。
     這兩項只回給內部人員（`isStaff()`），其他人為 `null`（同 `failedNotifications`）。
2. **圖表元件**：新增 `src/web/components/charts.tsx`，用 SVG 實作下列元件，顏色只取自 `palette.ts`（`usePalette()`、`tone()`），
    深淺色主題都正確，以 `viewBox` 縮放，375px 寬不可出現水平捲軸：
    - `Donut`：環形圖，中間顯示總數，旁邊有圖例（名稱＋數字）。
    - `LineChart`：兩條折線（新增、解決），有 X 軸日期刻度、Y 軸刻度與圖例；滑過或聚焦資料點時顯示當天數字（antd `Tooltip` 即可）。
    - `Columns`：直條圖，柱上或柱下標示數字。
    - `TagCloud`：標籤依數量決定字級（至少 4 級），顏色輪流使用 sticker 色，用 antd `Tag` 或連結呈現。
    - 既有的 `Bars`（水平長條）搬到這個檔案共用。
    每個圖表都要有文字替代：SVG 加 `role="img"` 與描述內容的 `aria-label`，數字同時以文字呈現（不單靠顏色或圖形傳達，DESIGN 規範）。
3. **儀表板版面**（數字卡保留不變）：
    - 第一列：「近 30 天新增與解決」折線圖（全寬）。
    - 第二列：狀態分布環形圖、未結案天數直條圖（超過 3 天的三組用警示色）、SLA 達標率儀表盤（antd `Progress type="dashboard"`）。
    - 第三列：優先度長條圖、熱門標籤 tag cloud（取代標籤長條圖）、服務類別長條圖。
    - 第四列（只有內部人員）：工程師負載長條圖、各團隊未結案長條圖。
    - 窄螢幕時每張圖一列。
4. **點擊導向清單**：點環形圖的狀態 → `/tickets?status=<狀態>`；點標籤 → `/tickets?tags=<標籤>`；點優先度 → `/tickets?priority=<n>`；
    點未結案天數「超過 3 天」的任一組 → `/tickets?olderThanDays=3`；點團隊 → `/tickets?teamId=<id>`；點工程師負載的某人 → `/tickets?assignee=<id>`（「未指派」→ `assignee=none`）。可點的元素要能用鍵盤操作（連結或按鈕）。
5. 所有新文字走 glossary（兩個語系）。

## 不在範圍
- word cloud（主旨斷詞）、任何圖表套件（包括 `@ant-design/charts`）、日期區間選擇、匯出圖片。
- 數字卡（KPI）的內容與計算方式不變；CSV 匯出不變。
- 新的環境變數或部署變更；資料表變更。

## 驗收條件
- `trend30d` 固定 30 筆、日期連續、沒有資料的日子為 0；用 `ctx.clock` 控制時間的測試中，各日的新增與解決數正確（含時區切日）；用真實 PostgreSQL 也通過。
- `agingBuckets` 的 `3-7`、`7-14`、`14+` 加總等於 `olderThan3Days`；剛好 72 小時的工單不算超過 3 天。
- 一般使用者的儀表板只統計自己看得到的工單，`workload` 與 `byTeam` 為 `null`；工程師只統計自己範圍內（含所屬團隊）的工單。
- `workload` 依未結案數由多到少、最多 10 人另加「未指派」；`byTeam` 含「沒有團隊」；兩者的數字與清單篩選（`assignee`、`teamId`）的筆數一致。
- 圖表元件可在淺色與深色主題正確顯示（顏色取自 `palette.ts`，`tests/styles.test.ts` 通過）；每個圖表都有 `role="img"` 與描述內容的 `aria-label`。
- e2e（`tests/e2e/ui.mjs` 新增儀表板步驟）：儀表板顯示折線圖、環形圖、未結案天數圖、tag cloud（以 `aria-label` 或圖例文字找到）；點環形圖的某個狀態會進入工單清單且狀態篩選為該狀態；點 tag cloud 的標籤會進入清單且標籤篩選為該標籤；深色主題與 375px 寬度的截圖沒有水平捲軸。
- 文件依 AGENTS.md「增量迭代原則」：CHANGELOG 一段；PRD、QA 計畫各加幾列；AGENTS.md 程式碼地圖加入 `components/charts.tsx`；測試數同步（validate 會檢查）。
