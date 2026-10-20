# 好友房後端

## 檔案

| 檔案 | 責任 |
|---|---|
| `engine/poker-engine.cjs`（根目錄） | 從現有單機頁面抽取的同一份純規則 |
| `rules.cjs` | 密碼學亂數洗牌、私有規則狀態保存與恢復 |
| `rooms.cjs` | 2–3 人房間、8 位邀請碼、意圖驗證、公開事件游標、逾時、保留座位與結算 |
| `store.cjs` | PostgreSQL 交易、row lock、migration checksum、收據、資金流水 |
| `supabase-auth.cjs` | 正常 Supabase JWT 核對、UUID 綁定、HttpOnly session |
| `auth.cjs` | session 基礎；本機專用密碼測試帳號（正式 Supabase 模式拒絕此註冊與登入） |
| `http.cjs` | 同源 HTTP/WS、限流、身分過濾、靜態檔白名單、平穩停止 |
| `main.cjs` | 資料庫連線、單權威 advisory lock、重部署交接、恢復與啟動 |
| `public/` | 好友房介面與只接受公開狀態的 Replica |

## 資料模型與 migration

正式連線固定使用 `midnight_online`，非 `public`。兩份 SQL 依序在交易與 advisory lock 中套用，已套用檔案校驗 checksum；再次啟動不會重建或重置資料。

- `001_online.sql`：使用者、設定、錢包、session hash、房間、座位、私有牌局／事件、行動收據、結果、籌碼流水。
- `002_supabase_friends.sql`：Supabase 顯示名稱與來源、房間碼、所有後端表 RLS 啟用與撤銷瀏覽器角色權限。

後端使用這個私有 schema 的受信任資料庫 owner，瀏覽器只能呼叫需要 session 的 API。不能把資料庫連線字串送前端，亦不能把伺服器原始 state/events 當公開 API。

買入、退桌、超時退回與結算都在鎖住房間的交易內，成功收據和資料同時提交。`hand_results(hand_id,user_id)`、流水 entry_id、行動收據的唯一限制防止重複寫入；同一交易失敗會全部 rollback。單機 `localStorage` 與 `solo_saves` 不會影響這些表。

## 時序與恢復

規則可以在 All-in 時立即計算到終局，但房間的 visible、queue、nextAt 與私有規則一起持久化。公開事件逐次送出 Flop／Turn／River，最後才送結果並結算。任何 snapshot 都取 visible，不取私有終局。

行動 30 秒，斷線保留 120 秒，公開街間隔 900ms、結果間隔 500ms。新程序向舊 authority 發 PostgreSQL 通知；舊程序停止接收操作、等在途工作與交易結束後釋放鎖，新程序再接手。若舊程序崩潰，資料庫連線關閉會釋放鎖。新程序從同一手與公開游標恢復，客戶端重連去重。每次只推進一個展示事件；伺服器停機期間不會讓客戶端仍然操作。

只支援單一 active authority，不能自行開啟多副本或跨區水平擴容。transaction pooler 不能保留 LISTEN 與 session advisory lock；使用 direct/session PostgreSQL 連線。

## 登入與隔離

瀏覽器密碼只經官方 Supabase SDK 送 Auth。後端透過 GET `/auth/v1/user` 核對普通 access token，並檢查 sub/UUID、issuer、role、aud、expiry、Email 驗證。後端只保存隨機 session 的 SHA-256，cookie 有 Secure／HttpOnly／SameSite=Strict／Path=/，不含 Domain。session 不長於該 JWT 有效期；SDK 更新 JWT 後可換新 cookie。

切帳號清空畫面及記憶體、取消舊一般請求；交換 cookie 的請求序列執行，避免慢到的 A 回覆蓋掉 B。登出會等交換完成再撤銷本站 session。官方 SDK 繼續管理其正常登入保存；不使用它保存線上籌碼或牌局。

## 測試與限制

見根目錄 `README.md` 的指令與 `reports/ACCEPTANCE.md`。外部 Supabase Auth 在自動化中使用受控端點；實際已驗證帳號 A/B 與公開 HTTPS 仍需照 `DEPLOY.md` 人工驗收。尚無壓力測試／大量併發容量保證、帳號風控、資料保留與自動備份策略。
