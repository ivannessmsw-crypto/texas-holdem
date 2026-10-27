# 午夜牌局 · 單機與好友房

原有單機遊戲保留在 `index.html`；新增可部署的 **2–3 人真人好友房**。好友房使用原有 Supabase 帳號、獨立線上籌碼及伺服器發牌／結算。

**2026-10-27：Render 已上線，健康檢查與好友房登入頁已驗證；真實 Supabase 雙帳號及兩名真人公開對戰仍待驗收。**

[開啟好友房](https://texas-holdem-f8r6.onrender.com/online) · [本次部署紀錄](reports/DEPLOYMENT-2026-10-27.md)

- [部署與使用步驟](DEPLOY.md)
- [實際測試報告](reports/ACCEPTANCE.md)
- [後端與資料庫說明](server/README.md)
- [訊息協定](server/PROTOCOL.md)

## 本機試玩好友房

需要 Node.js 22+、pnpm。首次安裝測試瀏覽器只用於測試，試玩不用。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

開啟 `http://127.0.0.1:3000/online`，在不同瀏覽器工作階段註冊兩個本機測試帳號，建立房間後分享 8 位房間碼。測試帳號名稱為 3–24 個英文小寫／數字／底線，密碼至少 12 字元。這是 loopback 開發模式，與 Supabase 正式登入分開。

原有單機仍可直接開啟 `index.html`。公開好友對戰須部署後端；GitHub Pages 只負責單機頁面與好友房入口。

## 自動測試

```sh
pnpm test:offline
pnpm test
pnpm test:simulation
pnpm exec playwright install chromium
pnpm test:acceptance
```

`test:acceptance` 在臨時原生 PostgreSQL 執行交易、重啟及真實 Chromium 測試；結束刪除測試資料庫。Auth 外部端點使用可控測試資料，不代表真實 Supabase 帳號驗證已通過。
