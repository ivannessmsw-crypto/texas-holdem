# 部署好友對戰

## 目前交付與範圍

這份程式已具備可運行的好友房：2–3 人、房間碼／邀請連結、伺服器發牌及合法下注、30 秒行動限時、120 秒斷線保留、重連快照、主池／邊池與冪等結算。單機遊戲及其存檔保留。

2026-10-27 已在 Render 完成公開部署；`/healthz` 回傳 `{"ok":true}`，`/online` 登入頁可開啟。兩名真人公開對戰仍待驗收。實際部署紀錄見 `reports/DEPLOYMENT-2026-10-27.md`，以下步驟保留供重建與維護使用。

## 已建立 Web Service，但出現找不到 package.json

這表示 Render 仍在抓只有單機 HTML 的舊提交（例如 `c225def`）。先確認新版後端已推送至 GitHub 的 main；不要只重試同一個舊提交。

在該 Web Service 的 Settings 中設定：

- Root Directory：留空（package.json 就在倉庫根目錄）。
- Build Command：`npx --yes pnpm@11.25.0 install --prod --frozen-lockfile --ignore-scripts`
- Start Command：`node server/main.cjs`
- Health Check Path：`/healthz`

在 Environment 設定 `NODE_ENV=production`、`NODE_VERSION=24` 與 `DATABASE_URL`。資料庫連線不能使用 Supabase publishable key。

如果尚未建立 PostgreSQL，先在 Render New → Postgres 建立，選擇與 Web Service 相同區域並確認方案。複製它的 **Internal Database URL** 到 Web Service 的 `DATABASE_URL`；這是後端秘密，不能貼到聊天或放入 GitHub。免費資料庫的 30 天限制見下文。使用 Render 預設網址時，程式自動讀取 `RENDER_EXTERNAL_URL`，不需手動填 PUBLIC_ORIGIN。

儲存後，選 Manual Deploy → Deploy latest commit。這裡要選 latest commit，不要選「重新部署舊版本」。成功後依下方步驟驗證 `/healthz`、`/online`、Supabase 登入及兩人對戰。

## 方案 A：Render Blueprint（初次試玩）

1. 建立 Render 帳號並連接 GitHub。
2. 選 **New → Blueprint**，選擇包含這份 `render.yaml` 的倉庫與分支。
3. 檢查將建立一個 Node Web Service 及一個 PostgreSQL，兩者在 Singapore。這份設定明確選免費方案；部署前檢查平台顯示的資格與費用，不要直接改為付費方案。
4. 套用 Blueprint。`DATABASE_URL` 由內部連線自動綁定；`RENDER_EXTERNAL_URL` 自動提供 HTTPS 網址。啟動時在獨立 `midnight_online` schema 執行 migration。
5. Web Service 顯示 Live 後，開啟 `https://你的服務.onrender.com/healthz`，應回傳 `{"ok":true}`；再開 `/online`。
6. Supabase 的 Authentication → URL Configuration 加入 `https://你的服務.onrender.com` 與 `/online` 作為允許的確認信返回網址；若已有原單機網站設定請保留。若要確認信直接返回新網站，再調整 Site URL。
7. 使用原有已驗證的 Email 帳號登入。後端會向 Supabase 核對正常用戶 JWT，再發出本站 HttpOnly、Secure、SameSite=Strict cookie。這是新網站來源，首次需要重新登入屬正常。
8. 在另一個獨立瀏覽器或裝置使用另一個已驗證帳號登入。A 建房、分享邀請連結；B 點開、登入、按「加入房間」。兩人連線後按「開始下一手」。

原本 `index.html` 已含公開 Supabase 專案設定，後端預設沿用。若有更換專案，在 Render Environment 設定 `SUPABASE_URL` 與 `SUPABASE_PUBLISHABLE_KEY`，並同步單機頁面的公開設定；不能填 secret／service-role key。

這份 Blueprint 關閉自動部署；後續更新在 Render 手動 Deploy latest commit。維持單一服務實例，不要開啟自動擴容。

### 免費方案的實際限制

免費 Web Service 閒置後會休眠，第一次開啟可能等待；免費 PostgreSQL **建立 30 天後到期**，也不提供備份，不適合作為長期玩家資產儲存。要長期使用，請在自行選定方案後升級資料庫或使用方案 B，並安排備份。這些是平台限制，不能用程式保證資料永不遺失。[Render 免費方案](https://render.com/docs/free)

## 方案 B：既有 PostgreSQL／自架

需要支援長連線的 PostgreSQL 帳號，具有建立 `midnight_online` schema、其資料表與 migration 的權限。可以用獨立 PostgreSQL；若用 Supabase Database，使用 Connect 的 direct 或 session 連線，**不要使用 transaction pooler 的 6543 連線**。設定正確的 TLS／CA，勿關閉憑證驗證。

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
cp .env.example .env
# 在本機編輯 .env，填入 DATABASE_URL 與 PUBLIC_ORIGIN；不要提交 .env。
node --env-file=.env server/migrate.cjs
node --env-file=.env server/main.cjs
```

`pnpm start` 讀取作業系統／平台環境；如使用 `.env` 檔，採用上面的 Node 指令。正式服務須由 HTTPS 反向代理轉送 HTTP 及 WebSocket Upgrade 至同一個 Node 埠，PUBLIC_ORIGIN 必須精確相符，不含路徑與尾斜線。

線上資料使用獨立 schema，並不更動現有 `public.profiles`、`public.solo_saves` 或 `auth.users`。不要把 `midnight_online` 加入 Supabase Data API exposed schemas，也不要給 `anon`、`authenticated` 任何直接存取權限。資料庫密碼只存後端環境。

## 把原 GitHub Pages 按鈕接到後端

Render 根目錄本身已可直接玩單機及好友房，不需另行設定。若繼續使用原 GitHub Pages 單機首頁，取得真實後端網址後執行：

```sh
node scripts/configure-online.cjs https://你的服務.onrender.com
```

這只更新 `assets/online-config.js` 中的公開網址。將該檔案及新增的入口修改提交、推送，等待 Pages 更新。首頁按「真人好友房」便開啟後端 `/online`。尚未填網址時，按鈕會明確提示尚未部署，不會顯示已聯機。

## 部署後人工驗收（仍需實做並記錄）

| 操作 | 應看到的結果 |
|---|---|
| A、B 使用已驗證帳號登入不同瀏覽器 | UUID 為各自帳號，登入狀態互不影響 |
| A 建 2 人房；B 經邀請連結加入 | 同一房間碼、不同自己的底牌；第 3 人不能入座 |
| A/B 正常 check/call/raise/fold | 非當前玩家不能操作，底池與籌碼同步 |
| 兩人／三人 All-in，含 100/250/500 入桌 | 依次公開 3、1、1 張；正確主池／邊池，未跟注退回；結算一次 |
| Flop 動畫期間刷新 | 取得當時已公開的牌，不提早出現 River 或輸贏 |
| 關閉網路再開、刷新、重新登入 | 保留期間恢復座位和序號，逾時動作由伺服器執行 |
| 登出並登入另一帳號 | 舊牌局先清空，再顯示新帳號；線上餘額由伺服器讀取 |
| 在瀏覽器修改單機籌碼與勝點 | 真人錢包、真人結算不變 |
| 牌局中手動重部署服務 | 斷線後重連，同一 handId 接續，不重新洗牌、不重複結算 |

可在開發者工具檢查自己的線上事件，但不應看到 `deck`、`seed`、`burn`、`queue`、其他玩家未攤牌的 cards。確認 Application → Cookies 的本站 session 有 Secure、HttpOnly、SameSite=Strict。

線上新帳號固定取得一次 1,000 遊戲籌碼，入桌 100–1,000，盲注 10/20。尚無真人排位、兌獎、補充籌碼、聊天、旁觀及多區擴容。單機排位、收藏與 AI 仍按原版運作。

## 故障排除

- 「帳號服務尚未設定」：檢查 Supabase public URL/key；禁止 secret/service-role。
- 登入失敗：先驗證 Email；檢查 JWT 所屬專案與設定一致。
- 無法 WS／Cookie 未保存：使用 HTTPS 和同一來源；核對 PUBLIC_ORIGIN、代理 Upgrade。
- Migration/資料庫連線失敗：檢查 PostgreSQL 權限、網路、TLS；不要修改已套用 migration 的內容。
- 切換後端網域：更新 PUBLIC_ORIGIN、Supabase 返回網址與 Pages 公開設定。

部署欄位依 [Render Blueprint 文件](https://render.com/docs/blueprint-spec)，WebSocket 連線與重新連線行為依 [Render WebSocket 文件](https://render.com/docs/websocket)。
