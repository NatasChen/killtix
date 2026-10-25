<!--
需求變更單：要讓 CrewAI 產生器進行一次迭代時，在這個檔案寫下變更內容（例如「新增 Slack 通知」），
再執行 `python crewai_ticket_build.py`（維護者本機工具，不在 repo 內，見 README）。HTML 註解不算內容；檔案內容為空時產生器不會做任何事。
執行成功並通過驗證後，產生器會在 crewai/<執行編號> 分支上 commit，並清空這個檔案。
-->
# 工單指派給團隊：團隊成員共同處理

## 背景
工單目前已有「團隊」欄位（`tickets.team_id`，詳情頁可改），內部工程師（`ticket:read:team`）看得到自己團隊的工單；
但使用者只能屬於一個團隊（`users.team_id`），新增工單時不能選團隊，指派給團隊時團隊成員不會收到通知，清單也不能依團隊篩選。
這次讓工單可以指派給團隊，同一團隊的成員都能看到並共同處理，再由其中一人認領成為負責人。

## 需求
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

## 不在範圍
- 工單同時指派給多個團隊；團隊主管、團隊層級的權限或 SLA；依團隊的報表。
- 廠商透過團隊看到工單（維持只看被指派的）。
- 移除 `users.team_id` 欄位（下一版再做）。
- SLA 逾時通知的收件者（維持現狀）。
- 新的環境變數或部署變更。
- 儀表板（下一張變更單）。

## 驗收條件
- 既有使用者的團隊在升級後保留：`users.team_id` 有值的使用者啟動後出現在 `team_members`；管理員把他移出團隊、重新啟動後不會被加回。
- 屬於兩個團隊的工程師看得到兩個團隊的工單；不屬於該團隊的工程師讀取該團隊工單回 404，清單中也看不到；被移出團隊後立即看不到。
- 屬於某團隊的廠商與一般使用者，看不到該團隊中未指派給他、非他開立、未關注的工單（回 404）。
- 新增工單時指定團隊：有 `ticket:assign` 的使用者成功，一般使用者回 403，不存在的團隊回 400；只指定團隊時狀態維持「新建立」。
- 指派給團隊且沒有負責人時，通知寄給該團隊具內部權限的啟用中成員（不含操作者、廠商、一般使用者、停用的使用者）；有負責人時不寄團隊通知。測試用 `dispatchPending(deps, fakeSenders)` 或檢查 outbox，不連外。
- 清單 `teamId=mine` 只回傳自己任一團隊的工單；沒有團隊的使用者結果為空。
- 使用者 API 以 `teamIds` 讀寫多個團隊；`/auth/me` 與 `/catalog` 回傳 `teamIds`。
- e2e（`tests/e2e/ui.mjs` 新增步驟）：管理員在「新增工單」選擇團隊建立工單 → 工單清單選「團隊」篩選可看到該工單、團隊欄顯示團隊名稱 → 進入詳情按「我來處理」後負責人顯示為自己、狀態變為「處理中」 → 「使用者」頁可為使用者選擇兩個團隊並在重新整理後仍顯示兩個團隊。
- 文件依 AGENTS.md「增量迭代原則」：CHANGELOG 一段；PRD、QA 計畫各加幾列；DECISIONS 記錄「使用者可屬於多個團隊、`users.team_id` 暫時保留」；AGENTS.md 程式碼地圖（`team_members`）與規則 1 的說明同步；測試數同步（validate 會檢查）。
