#!/usr/bin/env python3
"""Create sample tickets in a running TicketDesk through the API (Python standard library only).

    python3 scripts/seed-sample-tickets.py <base-url> [--email admin@ticket.local] [--count 30]
        [--psql "<command that runs psql on the TicketDesk database>"] [--seed N] [--allow-email]

Signs in as a system administrator (password from TD_PASSWORD, or prompted) and creates up to 30 tickets with
a mix of help topics, priorities, tags, assignees, replies and statuses. Every sample ticket gets the tag
`sample`, so they are easy to filter. Requesters are fictional `@example.com` accounts.

The account must be fully set up (password changed, 2FA done if required). Assignees are the existing active
staff and vendor accounts, so create a few agents first for a more varied list.

Ticket dates: the API always stamps "now". To fill the "older than 3 days" filter and the SLA report, some
tickets are moved 1–20 days into the past with SQL. Pass --psql with a command that reads SQL on stdin, e.g.
    --psql "docker compose -p ticketdesk exec -T postgres psql -U ticketdesk -d ticketdesk"
Without --psql the SQL is printed at the end so it can be run by hand.

Notifications: tickets and replies queue notifications. To avoid messaging anyone, the script stops when
notifications are switched on (Settings → Notifications) unless --allow-email is given. Leave the switch off
(the default) while seeding a demo system; what is queued meanwhile is logged as "Notifications off" and is
not sent later.
"""
import argparse
import getpass
import http.cookiejar
import json
import os
import random
import shlex
import subprocess
import sys
import urllib.error
import urllib.request

# (subject, description, help topic slug, priority 1-5, tags)
TICKETS = [
    ("VPN 連線後一直斷線", "在家用 VPN 連公司網路，約 5 分鐘就會斷一次，重新連線後又正常。", "general", 3, ["vpn", "network"]),
    ("新進同仁開通 ERP 帳號", "業務部新同仁下週一報到，需要 ERP 查詢與下單權限。", "account-access", 3, ["erp", "onboarding"]),
    ("會議室投影機無法顯示筆電畫面", "3F 大會議室 HDMI 接上後投影機顯示無訊號，換線也一樣。", "general", 2, ["hardware", "meeting-room"]),
    ("Outlook 收不到外部信件", "從昨天下午開始收不到客戶寄來的信，內部信件正常。", "general", 4, ["email"]),
    ("可疑登入告警：海外 IP 嘗試登入", "SIEM 偵測到同一帳號在 10 分鐘內從兩個國家登入。", "security-incident", 5, ["siem", "account"]),
    ("申請共用資料夾寫入權限", "需要財務部共用資料夾 \\\\fs01\\finance\\2026 的寫入權限，主管已同意。", "account-access", 2, ["file-share"]),
    ("印表機卡紙且顯示錯誤 E-302", "2F 影印室的多功能事務機一直卡紙，清掉之後還是顯示 E-302。", "general", 2, ["printer", "hardware"]),
    ("筆電電池膨脹", "筆電底部明顯鼓起，觸控板按不下去，擔心有安全疑慮。", "general", 4, ["hardware", "laptop"]),
    ("釣魚郵件通報：假冒供應商要求變更匯款帳戶", "收到假冒供應商的信件，要求更改匯款帳號，附件為 .html 檔。", "security-incident", 4, ["phishing", "email"]),
    ("離職人員帳號停用", "倉管部同仁本週五離職，請停用 AD、Email 與 VPN 帳號。", "account-access", 3, ["offboarding"]),
    ("Teams 會議無法分享螢幕", "使用 Teams 開會時按分享螢幕沒有反應，重開也一樣。", "general", 2, ["teams"]),
    ("網站憑證即將到期", "官網 TLS 憑證將在 14 天後到期，需要更新。", "general", 4, ["certificate", "website"]),
    ("端點防護偵測到惡意程式", "EDR 在會計部一台電腦上偵測並隔離了木馬程式，需要確認影響範圍。", "security-incident", 5, ["edr", "malware"]),
    ("申請第二台螢幕", "設計部需要多一台 27 吋螢幕做排版。", "general", 1, ["hardware", "request"]),
    ("Wi-Fi 在 5F 訊號很弱", "5F 東側座位 Wi-Fi 常常只有一格，視訊會議會卡。", "general", 3, ["network", "wifi"]),
    ("忘記密碼且帳號被鎖定", "連續輸入錯誤密碼後帳號被鎖，無法登入電腦。", "account-access", 3, ["password", "account"]),
    ("CRM 匯出報表格式錯亂", "從 CRM 匯出的 CSV 用 Excel 開啟後中文變成亂碼。", "general", 2, ["crm"]),
    ("防火牆規則申請：開放廠商遠端連線", "設備廠商需要每週二遠端維護，請開放指定 IP 連到 10.10.20.15:443。", "account-access", 3, ["firewall", "vendor"]),
    ("伺服器磁碟空間不足告警", "監控系統顯示 db02 的 /var 分割區使用率 92%。", "general", 4, ["server", "monitoring"]),
    ("軟體安裝申請：統計分析工具", "研發部需要安裝統計分析軟體，已取得授權。", "general", 1, ["software", "request"]),
    ("大量登入失敗：疑似密碼噴灑攻擊", "過去一小時有 300 個帳號各登入失敗 1–2 次，來源 IP 相同。", "security-incident", 5, ["siem", "brute-force"]),
    ("手機無法收公司信", "換新手機後設定公司信箱一直顯示驗證失敗。", "general", 2, ["email", "mobile"]),
    ("申請 Git 儲存庫存取權限", "新專案需要讀寫 payment-service 儲存庫。", "account-access", 2, ["git", "developer"]),
    ("備份工作連續兩天失敗", "檔案伺服器的夜間備份連續兩天顯示失敗，錯誤為目的端空間不足。", "general", 4, ["backup", "server"]),
    ("電話分機無法撥出", "分機 2318 可以接聽但無法撥出，顯示無權限。", "general", 3, ["phone"]),
    ("USB 隨身碟被封鎖無法使用", "需要用隨身碟把展示檔帶去客戶端，目前插上會被封鎖。", "account-access", 2, ["usb", "policy"]),
    ("內部網站回應很慢", "內部知識庫網站從今天早上開始每頁都要 10 秒以上才開得出來。", "general", 3, ["website", "performance"]),
    ("弱點掃描發現高風險漏洞", "季度弱點掃描在兩台對外主機發現高風險漏洞，需要安排修補。", "security-incident", 4, ["vulnerability"]),
    ("新會議室需要網路孔", "4F 新會議室裝修完成，需要兩個有線網路孔。", "general", 1, ["network", "facility"]),
    ("Excel 巨集被封鎖", "從共用資料夾開啟的 Excel 檔巨集被封鎖，無法跑月報。", "general", 2, ["office", "policy"]),
]

REQUESTERS = [
    ("lin.meiling@example.com", "林美玲"), ("chen.jianhong@example.com", "陳建宏"), ("wang.yating@example.com", "王雅婷"),
    ("huang.zhiwei@example.com", "黃志偉"), ("chang.shufen@example.com", "張淑芬"), ("li.guanyu@example.com", "李冠宇"),
    ("wu.peishan@example.com", "吳佩珊"), ("tsai.chengen@example.com", "蔡承恩"),
]

AGENT_REPLIES = [
    "已收到，正在確認中，稍後回覆處理進度。",
    "請問問題是從什麼時候開始的？有沒有錯誤畫面的截圖？",
    "已遠端檢查，問題已排除，請再試一次。",
    "這個需求需要主管簽核，已轉交相關單位。",
]
USER_REPLIES = ["補充截圖如附件說明，謝謝。", "剛剛試過還是一樣。", "確認可以了，謝謝！"]

# Final status → how many of the 30; created with an assignee the ticket starts as "open".
STATUS_MIX = ["new"] * 6 + ["open"] * 8 + ["pending_user"] * 5 + ["resolved"] * 6 + ["closed"] * 5


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/") + "/api/v1"
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Requested-With", "XMLHttpRequest")  # CSRF guard
        try:
            with self.opener.open(req, timeout=30) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:300]
            sys.exit(f"{method} {path} → HTTP {err.code}: {detail}")
        except urllib.error.URLError as err:
            sys.exit(f"cannot reach {self.base}: {err.reason}")


def backdate_sql(aged: dict[int, int]) -> str:
    """Moves each ticket and its threads `days` into the past (all timestamps, so durations stay consistent)."""
    lines = ["\\set ON_ERROR_STOP on", "BEGIN;"]
    cols = ["created_at", "updated_at", "first_response_due_at", "resolution_due_at", "first_responded_at",
            "sla_paused_at", "resolved_at", "closed_at"]
    for ticket_id, days in sorted(aged.items()):
        shift = f"interval '{int(days)} days'"
        sets = ", ".join(f"{c} = {c} - {shift}" for c in cols)
        lines.append(f"UPDATE tickets SET {sets} WHERE id = {int(ticket_id)};")
        lines.append(f"UPDATE ticket_threads SET created_at = created_at - {shift} WHERE ticket_id = {int(ticket_id)};")
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base_url", help="e.g. http://localhost:8080")
    ap.add_argument("--email", default="admin@ticket.local", help="system administrator account")
    ap.add_argument("--count", type=int, default=30, choices=range(1, len(TICKETS) + 1), metavar="1-30")
    ap.add_argument("--psql", help="command that runs psql on the database, SQL on stdin (for backdating)")
    ap.add_argument("--seed", type=int, help="random seed, for a repeatable mix")
    ap.add_argument("--allow-email", action="store_true", help="seed even though notifications are switched on")
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    api = Api(args.base_url)
    password = os.environ.get("TD_PASSWORD") or getpass.getpass(f"Password for {args.email}: ")
    session = api.call("POST", "/auth/login", {"email": args.email, "password": password})
    if session.get("stage") != "full":
        sys.exit(f"sign-in is not complete (stage: {session.get('stage')}): change the password / set up 2FA in the web UI first")

    if api.call("GET", "/admin/settings").get("notificationsEnabled") and not args.allow_email:
        sys.exit("notifications are switched on: sample tickets would send real notifications. "
                 "Turn off Settings → Notifications → Send notifications, or pass --allow-email.")

    topics = {t["slug"]: t for t in api.call("GET", "/help-topics")}
    catalog = api.call("GET", "/catalog")
    staff = [u for u in catalog["users"] if u["role"] in ("super_admin", "it_manager", "agent", "vendor")]
    if not staff:
        sys.exit("no active staff account to assign tickets to")

    picks = rnd.sample(TICKETS, args.count)
    statuses = rnd.sample(STATUS_MIX, args.count)
    aged: dict[int, int] = {}
    created = []
    for i, ((subject, description, slug, priority, tags), status) in enumerate(zip(picks, statuses), 1):
        topic = topics.get(slug)
        if topic and any(f["isRequired"] for f in topic["fields"]):
            topic = None  # a topic with required custom fields: fall back to no topic
        email, name = rnd.choice(REQUESTERS)
        body = {
            "subject": subject,
            "description": description,
            "priority": priority,
            "tags": tags + ["sample"],
            "requester": {"email": email, "name": name},
        }
        if topic:
            body["helpTopicId"] = topic["id"]
        if status != "new":
            body["assigneeId"] = rnd.choice(staff)["id"]
        ticket = api.call("POST", "/tickets", body)
        number = ticket["number"]

        if status != "new":
            api.call("POST", f"/tickets/{number}/threads", {"body": rnd.choice(AGENT_REPLIES), "notify": False})
        if status in ("pending_user", "resolved", "closed"):
            api.call("PATCH", f"/tickets/{number}", {"status": "pending_user"})
        if status in ("resolved", "closed"):
            api.call("POST", f"/tickets/{number}/threads", {"body": rnd.choice(USER_REPLIES), "notify": False})
            api.call("PATCH", f"/tickets/{number}", {"status": "resolved"})
        if status == "closed":
            api.call("PATCH", f"/tickets/{number}", {"status": "closed"})

        # About a third are older than 3 days (open ones fill the "older than 3 days" filter); the rest 0–2 days.
        days = rnd.randint(4, 20) if rnd.random() < 0.35 else rnd.randint(0, 2)
        if days:
            aged[ticket["id"]] = days
        created.append((number, status, days))
        print(f"[{i:2}/{args.count}] {number}  {status:<12} {days:>2}d  {subject}")

    sql = backdate_sql(aged)
    if aged and args.psql:
        result = subprocess.run(shlex.split(args.psql), input=sql, text=True, capture_output=True)
        if result.returncode != 0:
            sys.exit(f"backdating failed (exit {result.returncode}):\n{result.stderr.strip()}")
        print(f"backdated {len(aged)} tickets")
    elif aged:
        print("\nTickets are dated now. To spread them over the past 20 days, run this SQL on the database:\n")
        print(sql)

    older = sum(1 for _, s, d in created if d > 3 and s not in ("resolved", "closed"))
    print(f"done: {len(created)} tickets tagged 'sample', {older} open for more than 3 days")


if __name__ == "__main__":
    main()
