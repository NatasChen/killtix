# 部署指南（Docker）

本文件說明 TicketDesk 的部署與維運方式。**只支援 Docker**；Cloudflare Workers 方案已決定不做（[DECISIONS D3](../specs/DECISIONS.md)）。

## 1. 架構

```
            瀏覽器 / SOC 系統
                   │  HTTP :80（HTTPS 需另外在前面終結 TLS，見第 3 節）
                   ▼
   ┌───────────────────────────────┐
   │ nginx（唯一對主機開放的服務）   │
   └──────────────┬────────────────┘
                  │ app:8080（internal network）
   ┌──────────────▼────────────────┐
   │ app（Node 24，單一容器）        │
   │  • Hono REST API  /api/v1/*    │
   │  • React 前端（靜態檔）         │
   │  • 背景工作：通知發送、SLA 掃描、 │
   │    每日 3 天積壓報告            │
   └──────┬──────────────────┬─────┘
          │ internal network │
   ┌──────▼──────┐    ┌──────▼──────┐
   │ PostgreSQL 16│    │  Redis 7    │
   │ 資料、通知佇列 │    │ 速率限制計數 │
   └─────────────┘    └─────────────┘
```

- **資料庫結構**由 app 啟動時自動執行 migration（`drizzle/` 目錄）建立與升級，不需手動執行 SQL。
- **種子資料**（角色、預設 SLA、服務類別、預設管理員）每次啟動都會執行，但具冪等性：既有資料不會被覆寫，已改過的密碼不會被重設。
- **通知**採 outbox 模式：事件先寫入 `notification_logs`，背景工作每 5 秒發送一次；失敗時以指數退避重試，超過 `NOTIFY_MAX_ATTEMPTS` 次標記為失敗，可在「通知紀錄」頁面重送。
- 只有 nginx 對主機開放連接埠（`HTTP_PORT`，預設 80）。app、PostgreSQL 與 Redis **都不對主機開放**：app 只有 nginx 連得到，資料庫與 Redis 只有 app 能存取。

## 2. 首次部署

### 2.1 前置需求

- Docker Engine 24+ 與 Docker Compose v2
- 主機的 80 埠（或 `HTTP_PORT` 指定的埠）未被占用
- 正式環境：一個網域與 TLS 憑證，以及在內建 nginx 前面終結 TLS 的元件（第 3 節）

### 2.2 設定環境變數

```bash
scripts/init-env.sh
```

腳本會在 `.env` 不存在時從 `.env.example` 複製，並以 `openssl rand -hex 32` 填入**空白的** `APP_SECRET`、`POSTGRES_PASSWORD`、`REDIS_PASSWORD`；已有值的不會覆蓋，可重複執行；最後把 `.env` 權限設為 600。其他變數請依下表手動調整。

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `APP_SECRET` | ✅ | ≥ 32 字元。用來加密 2FA 金鑰，**部署後不可更換**，否則已啟用的 2FA 會失效 |
| `POSTGRES_PASSWORD` | ✅ | 資料庫密碼 |
| `REDIS_PASSWORD` | ✅ | Redis 密碼 |
| `APP_URL` | | 使用者開啟的網址，用於通知中的連結，預設 `http://localhost`；`HTTP_PORT` 不是 80 時要帶埠號。以 `https://` 開頭時自動啟用 Secure Cookie 與 HSTS |
| `HTTP_BIND` / `HTTP_PORT` | | 內建 nginx 對外的綁定位址與連接埠（HTTP），預設 `0.0.0.0:80`。app 本身不對主機開放 |
| `TRUST_PROXY` | | compose 預設 `true`：採用 nginx 設定的 `X-Forwarded-For` 作為用戶端 IP（影響登入速率限制與稽核日誌）。nginx 以用戶端位址**覆寫**這個標頭，用戶端自帶的值不會被採用。設為 `false` 時記錄的會是 nginx 容器的位址 |
| `BOOTSTRAP_ADMIN_EMAIL` | | 預設 `admin@ticket.local` |
| `BOOTSTRAP_ADMIN_PASSWORD` | | 留空：首次啟動隨機產生並印在 log 一次。填入：使用指定密碼（例如 `admin@password`，DECISIONS D1；初始密碼不檢查密碼政策）。兩種情況首次登入都必須改成符合政策的密碼。只在資料庫還沒有管理員時生效 |
| `TZ` / `DEFAULT_LOCALE` | | 預設 `Asia/Taipei` / `zh-TW` |
| `AGING_DIGEST_HOUR` | | 每天幾點（app 時區）之後發送「超過 3 天未結案」報告到 Teams，預設 9 |

其他可調整項目（皆有預設值）：`BCRYPT_COST`（12）、`SESSION_TTL_HOURS`（12）、`LOGIN_MAX_FAILED_ATTEMPTS`（5）、
`LOCKOUT_MINUTES`（15）、`RATE_LIMIT_PER_MIN`（每個 API Token 每分鐘 60 次）、`NOTIFY_MAX_ATTEMPTS`（5）。

### 2.3 啟動

```bash
docker compose up -d --build --wait
docker compose ps                 # 四個服務（nginx、app、postgres、redis）都應為 healthy
docker compose logs app | grep -A4 "bootstrap administrator"
```

若 `BOOTSTRAP_ADMIN_PASSWORD` 留空，log 中會出現：

```
 TicketDesk bootstrap administrator created
   e-mail:   admin@ticket.local
   password: <隨機密碼>
 You must change this password at first login.
```

這段訊息只在建立帳號的那次啟動出現。之後重啟或重建容器（只要資料庫 volume 還在）都不會再印出；
錯過的話用第 6 節的 `reset-password` 指令重設即可，不需要刪除資料庫。

### 2.4 首次登入

1. 開啟 `APP_URL`，以預設管理員登入。
2. 系統只允許變更密碼：所有業務 API 都回 `403 password_change_required`，直到密碼變更完成。
   新密碼需 ≥ 12 字元，並包含大寫、小寫、數字與符號，且不可與最近 5 次的密碼相同。
3. 改密後，該帳號所有舊的 session 都會失效。
4. 依序完成設定：
   - **系統設定**：是否全域強制兩步驟驗證
   - **團隊**、**SLA 方案**、**表單與自訂欄位**、**服務類別**
   - **使用者**：新增使用者時系統會產生一次性密碼，使用者首次登入必須變更
   - **API Token**：給 SOC 等外部系統使用（見第 4 節）

### 2.5 驗證部署

```bash
curl -fsS http://localhost/healthz          # {"status":"ok"}（經 nginx）
scripts/smoke.sh http://localhost '<預設管理員密碼>'
```

`smoke.sh` 會實際走完改密、開單、不通知的回覆、狀態轉換、API Token 冪等開單、3 天篩選、CSV 匯出等流程（共 24 項檢查）。
**它會變更預設管理員密碼並建立測試資料**，請只在新環境或測試環境執行。

## 3. 反向代理與 TLS

compose 內建 nginx（`nginx:1.30-alpine`，設定檔 `deploy/nginx/default.conf`），監聽 HTTP 並轉送到 `app:8080`：

- 以用戶端位址覆寫 `X-Forwarded-For`（不是附加），app 在 `TRUST_PROXY=true` 時採用它的第一個值。
- `client_max_body_size 2m`（標誌上傳以 base64 JSON 傳送，512 KB 的 PNG 約 700 KB）。
- 每次請求經 Docker DNS 解析 `app`，app 容器重建、IP 改變後不需要重啟 nginx。
- CSP、HSTS 等安全標頭由 app 送出，nginx 不另外加。

**TLS 目前不在內建 nginx 中處理**。正式環境請在它前面放一個終結 TLS 的元件，並把 nginx 綁在本機（`HTTP_BIND=127.0.0.1`、`HTTP_PORT=8081`），例如 Caddy：

```
ticket.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

前面多一層代理時，nginx 看到的用戶端位址是那一層（本例為主機本身），稽核日誌的 IP 也會是它；
要記錄真實用戶端 IP，需在 `deploy/nginx/default.conf` 加上 `set_real_ip_from` / `real_ip_header`（nginx realip 模組）。

並在 `.env` 設定：

```
APP_URL=https://ticket.example.com
```

## 4. 外部系統（SOC）串接

1. 在「API Token」頁面建立 Token，勾選 `tickets:write`（開單）與 `tickets:read`（查詢）。Token 只會顯示一次。
2. （選用）查詢服務類別與團隊：

```bash
# 服務類別：slug、名稱，以及該類別表單的自訂欄位（key、型別、是否必填、選項）
curl -s https://ticket.example.com/api/v1/help-topics -H "Authorization: Bearer td_xxxxxxxx_..."
# 團隊：id 與名稱
curl -s https://ticket.example.com/api/v1/teams -H "Authorization: Bearer td_xxxxxxxx_..."
```

3. 建立工單：

```bash
curl -X POST https://ticket.example.com/api/v1/tickets \
  -H "Authorization: Bearer td_xxxxxxxx_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: SOC-2026-0001" \
  -d '{
    "subject": "[SOC] EDR-0421 疑似勒索軟體行為",
    "description": "主機 FIN-PC-023 於 09:12 偵測到大量檔案加密行為，已自動隔離。",
    "priority": "critical",
    "helpTopic": "security-incident",
    "team": "資安組",
    "tags": ["ransomware", "edr"],
    "requester": { "email": "soc@example.com", "name": "SOC Bot" },
    "customFields": { "host": "FIN-PC-023" }
  }'
```

最小範例（只有 `subject` 必填）：`-d '{"subject":"印表機無法列印","helpTopic":"general"}'`

| 欄位 | 說明 |
| --- | --- |
| `subject` | **必填**，1–512 字 |
| `description` | 內文，最多 100,000 字 |
| `priority` | 1–5 或別名 `lowest`／`low`／`normal`／`high`／`critical`，預設 3 |
| `helpTopic`／`helpTopicId` | 服務類別（slug 或 id），決定 SLA、預設團隊與自動標籤 |
| `team`／`teamId` | 團隊名稱（不分大小寫）或 id，擇一；省略時用服務類別的預設團隊。團隊改名後舊名稱會回 400，需要穩定時用 `teamId` |
| `tags` | 最多 20 個、每個最多 64 字；不存在的會自動建立，服務類別的自動標籤也會加上 |
| `requester`／`requesterId` | 代誰開單；省略時是建立 Token 的人。`requester.email` 沒有對應帳號時會建立外部的一般使用者 |
| `customFields` | 以欄位 key 為鍵（見 `GET /help-topics` 的 `fields`），依該表單的必填、型別、選項與格式檢查；表單上沒有的 key 回 400 |
| `externalId` | 外部系統的單號，與 `Idempotency-Key` 標頭作用相同（兩者都有時以標頭為準） |
| `assigneeId` | Token **不可用**，會回 403；工單只能送到團隊，由團隊指派負責人 |

- 成功回 `201` 與工單摘要（`id`、`number`、`status`、`priority`、`sla` 期限等）。
- 相同的 `Idempotency-Key` 重送會回傳同一張工單（HTTP 200，標頭 `Idempotent-Replayed: true`），不會重複開單；逾時可以放心重試。
- 錯誤為 RFC 7807（`application/problem+json`），`errors[].path` 指出欄位：
  `400` 欄位格式錯誤、服務類別或團隊不存在、`team` 與 `teamId` 同時給、自訂欄位不符；`401` Token 錯誤、過期或已撤銷；
  `403` Token 沒有所需範圍或帶了 `assigneeId`；`429` 超過速率限制。
- 每個 Token 預設每分鐘 60 次，超過回 `429` 並附 `Retry-After`。
- 完整規格：[docs/openapi.json](openapi.json)。

## 5. 通知管道

所有通知管道都在「系統設定」設定，**不使用環境變數**（DECISIONS D13）；儲存後立即生效，不需重新部署。
「通知設定」的**啟用通知**開關預設關閉：關閉時不寄送任何通知，期間的通知在「通知紀錄」標示為「通知已停用」，重新開啟後也不會補寄（需要時可在通知紀錄逐筆重送）。
設定好管道、寄出測試信確認後再開啟。

| 管道 | 設定位置 | 收件者 |
| --- | --- | --- |
| Email | 「郵件設定」：SMTP（主機、連接埠、TLS、帳號、密碼、寄件者）或 Resend（API Key、寄件者），可寄送測試信 | 被指派者（指派、使用者回覆、SLA 逾時）、申請人（對外回覆） |
| Telegram | 「通知設定」的 Bot Token；使用者在「個人設定」填入自己的 Chat ID | 被指派者 |
| Microsoft Teams | 「通知設定」的 Webhook URL（Teams Workflows 的 https 網址，送出 Adaptive Card） | 頻道：新工單、SLA 逾時、每日 3 天積壓報告 |

密碼、API Key、Bot Token 與 Webhook URL 以 `APP_SECRET` 加密存在資料庫，只寫不讀；更換 `APP_SECRET` 後需要重新輸入。

回覆者取消勾選「寄送 Email 通知」時該則回覆不會發出任何通知；通知只包含該則回覆的內容。既有的內部備忘不會觸發通知。

## 6. 日常維運

```bash
docker compose logs -f app                 # JSON 格式的應用日誌
docker compose restart app
docker compose pull && docker compose up -d --build   # 升級：migration 會在啟動時自動執行
docker compose down                        # 停止（保留資料）
docker compose down -v                     # ⚠️ 停止並刪除所有資料
```

### 6.1 備份與還原

```bash
# 備份
docker compose exec -T postgres pg_dump -U ticketdesk -Fc ticketdesk > backup_$(date +%F).dump

# 還原到空資料庫（先停止 app）
docker compose stop app
docker compose exec -T postgres pg_restore -U ticketdesk -d ticketdesk --clean --if-exists < backup_2026-10-23.dump
docker compose start app
```

請將備份排程化（例如每日 cron），並定期演練還原。Redis 只存速率限制計數，不需要備份。

### 6.2 忘記管理員密碼 / 帳號被鎖定

```bash
docker compose exec app node dist/server/cli.js reset-password admin@ticket.local
```

指令會產生一次性密碼、解除鎖定並登出該帳號所有 session；下次登入時必須改密。

## 7. 擴充限制（v0.1）

- 背景工作（通知、SLA 掃描）在 app 程序內執行，**請只執行一個 app 副本**。多副本部署需要將背景工作拆成獨立服務，列入後續版本規劃。
- 速率限制使用 Redis，多副本時仍正確。

## 8. 安全檢查清單（上線前）

- [ ] 預設管理員已改密，並已另外建立具名的管理員帳號
- [ ] `.env` 中三組密鑰皆為隨機值，且 `.env` 未進版控
- [ ] `APP_URL` 為 `https://`，nginx 前已終結 TLS，`TRUST_PROXY=true`；`docker compose ps` 只有 nginx 有對外連接埠
- [ ] 視需求開啟「全域強制兩步驟驗證」
- [ ] Email / Telegram / Teams 已在「系統設定」設定並測試，「啟用通知」已開啟（「通知紀錄」頁面顯示「已發送」）
- [ ] 已排程資料庫備份並演練還原
- [ ] 已執行 `scripts/smoke.sh`（測試環境）確認流程正常
