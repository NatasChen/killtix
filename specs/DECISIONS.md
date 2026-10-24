# 實作決策紀錄

與 [客戶需求規格](customer_spec.md) 不同、或需要客戶確認的決策。每項都標示狀態。

| # | 主題 | 規格原文 | 實際做法 | 理由 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| D1 | 預設管理員密碼 | 固定 `Admin@InitTemp2026!` | 帳號仍為 `admin@ticket.local`、強制改密；密碼由 `BOOTSTRAP_ADMIN_PASSWORD` 指定，未指定則首次啟動隨機產生並只在 log 顯示一次 | 固定密碼寫在公開文件中，每個部署都是已知憑證。若客戶堅持，設定 `BOOTSTRAP_ADMIN_PASSWORD=Admin@InitTemp2026!` 即完全符合原規格 | ⏳ 待客戶確認 |
| D2 | SSO（AD/LDAP/SAML/OIDC/SCIM）、FIDO2 | v1 必備 | 延至 v1.1；v0.1 提供本機帳號 + TOTP | 沒有實際 IdP 無法驗證；資料表已預留 `identity_provider` 欄位 | ⏳ 待客戶確認時程 |
| D3 | Cloudflare 部署（方案 B） | 雙軌並行 | 標示為實驗性、未實作，見 `deploy/cloudflare/README.md` | D1(SQLite)、SMTP、LDAP、bcrypt CPU 限制與現行架構差異大 | ⏳ 待客戶確認是否仍需要 |
| D4 | 改密前呼叫業務 API 的回應碼 | 原文件寫 `422`（或 403） | `403`，`code=password_change_required` | 語意上是「已認證但無權限」 | ✅ 已採用 |
| D5 | 「超過 3 天未結案」定義 | 原文件 SQL 與文字矛盾（`<=` vs 嚴格大於） | `status NOT IN (resolved, closed) AND created_at < now() - 72h`；剛好 72 小時不計入 | 與原文件文字一致；有邊界測試 | ✅ 已採用 |
| D6 | 附件上傳 | 原文件提及 | v0.1 未實作 | 需要儲存與病毒掃描設計 | ⏳ v1.1 |
| D7 | SLA 營業時間 | 原文件提及營業時間行事曆 | v0.1 以 24x7 計算；等待使用者期間暫停計時 | 營業時間/假日需另行設計 | ⏳ v1.1 |
| D8 | UI 視覺規範的套用方式（UI 重新設計第 1 批） | 客戶規格只要求 Light/Dark 主題與 WCAG AA，沒有指定色彩系統 | 依根目錄 `DESIGN.md` 套用設計 token，但只取風格：①`DESIGN.md` 只定義淺色，深色值由淺色推導並自行驗證 AA；②裝飾用的 sticker 色盤不進結構色，語意色（danger/warning/success、SLA、優先度 badge）維持獨立 CSS 變數；③hero、pricing 等行銷區塊不套用；④既有 CSS 變數名稱只增不改不刪（`tests/styles.test.ts` 依賴）；⑤若 `DESIGN.md` 的主色藍（#0075de）作為連結文字在暖白底上未達 4.5:1，新增較深的連結變數（如 `--accent-strong`）而不改 `--accent` 名稱 | 需求變更單明確要求依 `DESIGN.md` 重做樣式，但同時要求保留既有變數名稱與語意色；兩者只能靠「新增變數、不改名」調和 | ✅ 已採用；②的 sticker 色盤限制由 D9 放寬 |
| D9 | sticker 色盤與側邊欄色彩（UI 重新設計第 2 批） | `DESIGN.md` 規定介面只有黑白灰加一個藍，sticker 色盤只用於裝飾；深靛藍只用於單一 hero 區塊 | sticker 色盤（sky、purple、pink、orange、teal）可用於有意義的資料色：狀態 badge、儀表板色帶與長條圖、選單群組色塊；側邊欄使用深靛藍（`--nav-*`）。主要動作、連結與焦點仍只用主色藍；顏色都搭配文字標籤，不單靠顏色傳達 | 使用者認為介面過於單調；工單系統以資料為主，顏色帶有資訊（狀態、優先度、分類）比全部灰藍更好辨識。`DESIGN.md` 是行銷網站的風格參考，不改它，例外記在這裡與 AGENTS.md | ✅ 已採用 |
