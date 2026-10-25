<!--
需求變更單：要讓 CrewAI 產生器進行一次迭代時，在這個檔案寫下變更內容（例如「新增 Slack 通知」），
再執行 `python crewai_ticket_build.py`（維護者本機工具，不在 repo 內，見 README）。HTML 註解不算內容；檔案內容為空時產生器不會做任何事。
執行成功並通過驗證後，產生器會在 crewai/<執行編號> 分支上 commit，並清空這個檔案。
-->
# 郵件設定：在系統設定頁設定寄信方式，新增 Resend

## 背景
目前 Email 只能用環境變數 `SMTP_*` 設定，改設定要重新部署；寄信只支援 SMTP。
這次讓系統管理員在「系統設定」頁設定寄信方式，並新增 Resend（HTTP API）作為第二種寄信方式。

## 需求
1. **寄信方式**有三種，存在 `system_settings`（`services/settings.ts`），預設為「環境變數」：
   - `env`：沿用現在的 `SMTP_*` 環境變數，行為與現在完全相同（既有部署升級後不需要任何設定）。
   - `smtp`：使用介面上填寫的 host、port、secure、帳號、密碼、寄件者。
   - `resend`：使用介面上填寫的 Resend API Key 與寄件者，以 `fetch` 呼叫
     `POST https://api.resend.com/emails`（`Authorization: Bearer <key>`，JSON：`from`、`to`、`subject`、`text`）。
     **不安裝 Resend SDK，也不新增任何套件。**
2. **立即生效**：儲存後下一次寄信就用新設定，不需要重新啟動。現在 `index.ts` 在啟動時建立一次 `defaultSenders()`，
   要改成寄信時依目前的設定決定 email 的寄送方式；`notify.ts` 的 `channelConfigured('email')` 也要依目前設定判斷。
   Telegram、Teams 維持環境變數，不在這次範圍。
3. **秘密只寫不讀**：SMTP 密碼與 Resend API Key 用既有的 `deps.secretBox` 加密後存入；任何 API 回應、稽核紀錄、log 都不可出現原文或密文。
   - 讀取設定時只回傳「是否已設定」（例如 `hasPassword: true`）。
   - 儲存時密碼欄位留空或省略表示「不變更」。
   - 解密失敗（例如更換了 `APP_SECRET`）時不可讓程式中止：該寄信方式視為未設定，設定頁顯示需要重新輸入的提示。
4. **測試寄信**：設定頁有「寄送測試信」按鈕與收件者欄位（預設為目前登入者的 Email）。
   用**目前已儲存**的設定同步寄出一封測試信，成功或失敗都直接顯示在頁面上；失敗訊息不可包含密碼或 API Key。
   這個端點要有速率限制（每位使用者每分鐘 5 次）。
5. **權限**：讀取、儲存、測試寄信都只有系統管理員可以使用（`admin:settings`）。儲存與測試寄信要寫稽核紀錄（不含秘密）。
6. **設定頁**（`pages/admin/AdminRoutes.tsx` 的 SettingsPage）新增「郵件設定」卡片，放在「企業標誌」之後：
   - 用 antd 元件與既有的 `Field`／`Choice`，送出按鈕同時設 `loading` 與 `disabled`。
   - 選 `env` 時唯讀顯示目前環境變數的 host 與寄件者（不顯示密碼）；選 `smtp`／`resend` 時顯示對應欄位。
   - 頁面上要看得出目前實際使用的來源（環境變數或系統設定）。
   - 所有文字走 glossary，兩個語系都要加。
7. **輸入驗證**（zod v4）：寄件者為 Email 或 `名稱 <email>` 格式；port 為 1–65535；host 必填（smtp）；API Key 必填（resend，第一次設定時）。

## 不在範圍
- Telegram、Teams 的介面設定；HTML 郵件、附件；寄信佇列與重試的邏輯（沿用現有 outbox）。
- 新增環境變數或修改 `docker-compose.yml`：這次**沒有部署變更**。
- 新的視覺樣式：沿用 Ant Design 既有元件與 `palette.ts`，不需要新的設計。

## 驗收條件
- 未做任何設定時，寄信行為與現在相同（`env`），既有測試全部通過。
- 非系統管理員讀取、儲存、測試寄信都回 403。
- 讀取設定的回應中沒有密碼與 API Key；資料庫中存的是密文，不是原文；密碼留空儲存時保留原本的值。
- 切換到 `resend` 後，outbox 寄信會以正確的 payload 呼叫 Resend；切回 `env` 後改用 SMTP。測試中用假的 `fetch`／sender，不可呼叫真實外部服務。
- 用另一個 `APP_SECRET` 讀取時不會出錯，回應表示秘密需要重新輸入。
- 測試寄信成功與失敗都回傳可顯示的結果；第 6 次（同一分鐘）回 429。
- 文件依 AGENTS.md「增量迭代原則」：CHANGELOG 一段、PRD 與 QA 計畫各加幾列、新的 API 不需要寫入 `docs/openapi.json`（不是外部 API）；測試數同步更新。
