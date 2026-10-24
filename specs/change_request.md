<!--
需求變更單：要讓 CrewAI 產生器進行一次迭代時，在這個檔案寫下變更內容（例如「新增 Slack 通知」），
再執行 `python crewai_ticket_build.py`（維護者本機工具，不在 repo 內，見 README）。HTML 註解不算內容；檔案內容為空時產生器不會做任何事。
執行成功並通過驗證後，產生器會在 crewai/<執行編號> 分支上 commit，並清空這個檔案。
-->

## UI 重新設計（第 1 批）：設計 token、共用元件、登入頁與 sidebar

背景：延續目前版本。根目錄 DESIGN.md 是 UI 視覺規範，目前的 src/web/styles.css 只套用了字型，
色彩、間距、圓角、陰影都還是舊樣式。這是 UI 重新設計的第 1 批，第 2 批會再處理各頁面的版面細節。

需求：
- 依 DESIGN.md 更新 src/web/styles.css 的淺色主題 CSS 變數：暖白頁面底色（canvas-soft）、白色卡片、
  hairline 邊框、ink 文字層級、單一主色藍（primary）用於主要按鈕、連結與焦點。
- 深色主題的值由淺色推導（DESIGN.md 只定義淺色），文字與背景的對比達 WCAG AA。
- 語意色（danger / warning / success、SLA、優先度 badge）維持獨立的 CSS 變數，對比達 AA。
- 共用元件依 DESIGN.md 調整：按鈕（主要、次要、危險）、輸入框與下拉選單、卡片、表格、badge、
  modal、toast、空狀態、錯誤訊息；圓角、間距、陰影使用 DESIGN.md 的尺度。
- 登入、改密、2FA 頁面改用 ex-auth-form-card 風格；左側 sidebar 保留，改用新的色彩與間距。

驗收條件：
- 淺色與深色主題的所有畫面都清楚可讀，375px 寬度不出現水平捲軸
- 既有 CSS 變數名稱保留（tests/styles.test.ts 依賴 --accent、--accent-soft、--surface-2 等名稱），
  可以新增變數，不可以改名或刪除
- 不改任何元件的行為、API 呼叫、路由或文字；不新增字典 key
- 不出現原品牌名稱；不引入外部資源（CSP 只允許同源）
- npm run validate 通過

不要改：頁面的資訊架構與功能、sidebar 的位置（不改成頂部導覽列）、字型設定（已經是 Noto）
