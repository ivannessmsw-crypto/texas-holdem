# 帳號登入與驗證後恢復 — 2026-10-27

## 真實查核（不公開玩家帳號資訊）

- 由使用者提供的指定帳號，在 Supabase Authentication Users 中查到唯一帳號。
- Confirmed at 與 Last signed in 均顯示 2026-10-27 20:38（香港時間）。因此該帳號已驗證，不需要重新註冊。
- Auth 日誌在 20:43:39 顯示 `400: Invalid login credentials`；這不能用郵件驗證問題代替說明，也不能判定使用者具體輸錯哪個欄位。
- 20:43:02 記錄 `429: email rate limit exceeded`；驗證日誌也有 `One-time token not found`。驗證跳轉本身不能證明驗證成功。
- Site URL 原本為 localhost:3000；使用者明確授權後已修正至正式 Render 首頁，並增加首頁及 /online 兩個精確允許網址，沒有 wildcard。
- 已驗證帳號狀態只是管理台只讀查核，並非本次替該帳號完成真實密碼登入。未替使用者更換密碼、人工標記已驗證或停用 RLS。

## 修改

- 好友房加入重寄驗證信、忘記密碼、輸入兩次新密碼的恢復表單。
- 使用官方 SDK resend、resetPasswordForEmail、updateUser；帳密不經過遊戲後端。
- 新寄出的好友房帳號信明確指定 /online 返回路徑，處理 PASSWORD_RECOVERY 與失效驗證錯誤。
- 恢復工作階段使用獨立的 storage key，重新整理仍顯示重設表單，不覆寫正常遊戲 session；完成後清除恢復 session，要求重新登入。
- 恢復期間清空桌面私有資料並停止交換遊戲 cookie，不建立房間或自動加入牌局。
- 寄信成功只表示請求已被接受；不宣稱信件送達。429 如實顯示，加入 60 秒本機防重寄提示，並明示不代表伺服器額度已恢復。
- 原單機 HTML、AI、範圍、EV、收藏、排位與回放未修改；原有帳號提示的已審核兩處差異仍由 checksum 測試限制。

## 執行與結果

```sh
node scripts/check-offline.cjs
node server/tests/run-postgres.cjs --browser
```

- 原單機程式核對：通過。
- PostgreSQL 後端：14/14。
- 好友房瀏覽器回歸：10/10、90 個封包。
- 原 Auth UI：8/8。
- 新恢復流程：5/5（重寄與忘記密碼的精確返回網址／重新整理後防重寄、429、不把失效連結當成功、官方 SDK 恢復及重新整理、密碼不一致不提交、更新一次後登出、密碼不進入日誌）。
- 完整測試 exit 0，詳見 auth-recovery-tests.log 與 auth-recovery-browser.json。
- 測試使用本機攔截的 Auth 回覆，沒有寄真人郵件或更改真人密碼。首次執行通過；檢查發現恢復後 client 需切回普通 storage key，已修正並重跑完整測試通過。

## 尚待使用者完成／外部條件

- 使用者自行透過最新重設信設定密碼，並以新密碼在正式環境登入。
- 目前真實 SMTP 寄信額度仍受限制，程式不能解除。預設寄信服務目前 2 封／小時且僅限團隊地址；公共註冊需正式 SMTP。
- 未完成真人 A/B 跨帳號雲端驗收。

參考：[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[密碼重設](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)。
