# 客戶需求規格（Base Specification）

> 這是客戶提供的原始需求，CrewAI 產生器（本機工具）與人工開發都以此為基準。
> 與本規格不同的實作決策記錄在 [DECISIONS.md](DECISIONS.md)。

1. 身分驗證與安全：
   - 支援 Active Directory / LDAP / SAML 2.0 / OIDC / SCIM 身分驗證。
   - 具備 2FA 開關（TOTP/FIDO2），由管理員自由決定是否全域啟用。
   - 【關鍵初始設定】：後端程式碼與資料庫必須預設一組暫時系統管理員帳號 (admin@ticket.local / Admin@InitTemp2026!)，
     具備 must_change_password 旗標，供服務初次佈署後登入驗證與細部設定。
2. 工單核心機制：
   - Ticket Form 具備自訂欄位 (Custom Fields) 彈性。
   - 提供 RESTful API 供外部系統（如 SOC 資安監控系統）自動開單。
   - Tag 標籤系統（每個工單可關聯多個 Tag，並支援作為篩選維度）。
   - 緊急程度共 5 級 (Level 1~5)。
   - 參考 osTicket 核心機制補足必要模組：Help Topics (服務類別)、SLA Plans (時效管理)、Ticket Threading (內部備忘與對外回覆對話串)、Canned Responses (範本)。
3. 報表與儀表板：
   - Overview Dashboard。
   - Report 報表匯出與自訂欄位過濾（必備條件：可精確篩選「超過 3 天未結案」之工單）。
4. 權限與通知：
   - RBAC 角色權限管理（系統管理員看全功能；外部廠商/一般使用者僅見被指派或關聯之工單）。
   - 工單指派多管道通知：Email、Telegram Bot、Microsoft Teams Webhook。
5. 使用者體驗：
   - 多語系支援：後端程式碼採用 Glossary 字典架構，便於日後擴充新語系。
   - 前端 Theme 主題切換 (Light / Dark)。
6. 雙軌佈署方案：
   - 方案 A：Docker 容器化佈署 (App + PostgreSQL + Redis)。
   - 方案 B：Cloudflare 邊緣網路佈署 (Workers + Pages + D1 Database + Queues)。
7. GitHub 規範：
   - 專案根目錄必須具備專業的 README.md，包含產品特性、技術棧、架構圖概念、快速啟動步驟與安全注意事項。
