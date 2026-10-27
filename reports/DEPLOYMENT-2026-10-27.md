# Render 部署紀錄 — 2026-10-27（香港）

## 已完成並實際確認

- 現有 Web Service：texas-holdem，Ohio，免費方案。
- 公開網址：https://texas-holdem-f8r6.onrender.com
- 好友房：https://texas-holdem-f8r6.onrender.com/online
- Root Directory 留空。
- Build Command：`npx --yes pnpm@11.25.0 install --prod --frozen-lockfile --ignore-scripts`
- Start Command：`node server/main.cjs`
- Health Check Path：`/healthz`
- 環境：NODE_ENV=production、NODE_VERSION=24；DATABASE_URL 已私密儲存，不記錄於本檔。
- 使用者確認建立 midnight-poker-db，PostgreSQL 18，與服務同區域，免費 $0／月。
- 使用者確認關閉資料庫外部連線；資料庫頁明確顯示 External traffic not allowed，只供 Render 私有網路連線。
- Render 部署 eeaa2e2 顯示 Deploy succeeded / Live；日誌顯示 Node 24.22.1、資料庫 migration 與權威服務成功啟動。
- 從實際瀏覽器開啟 /healthz，看到 {"ok":true}。
- 從實際瀏覽器開啟 /online，看到正常的 Email／Password 登入介面。
- 將原首頁好友入口的公開設定連接至此後端網址；單機內嵌程式仍保持原樣。

## 本次遇到並修復的問題

1. 舊部署 c225def 只有靜態頁，沒有 package.json：已將完整後端推送到 main。
2. Render 預設 yarn start 與本專案 pnpm 不相容：明確改用 node server/main.cjs。
3. 未指定 Node 版本時平台選到 26：改以 NODE_VERSION=24 固定已測試的主要版本。
4. 沒有資料庫連線：建立獲使用者授權的免費 PostgreSQL，再將 Internal Database URL 直接儲存在 Render 服務環境。

## 限制及仍待驗收

- Render 顯示此免費資料庫於 **2026-11-26 到期**；它是測試用途，長期使用須在到期前自行決定升級／遷移及備份。
- 免費 Web Service 會休眠，重新喚醒可能等待 50 秒或更久。
- 沒有使用真實帳密自動登入，沒有把先前本機測試誤當作真實 Supabase A/B 驗收。
- 真實已驗證帳號 A/B 的登入、兩台裝置同桌、實際 WSS 全押／重連、Supabase 確認信返回網址仍待人工驗收。
- 沒有宣稱整體多人模式已完成全部真實玩家驗收。

## 實際重部署問題及修復

更新公開入口的 a7125b8 已成功建置，但 Render 顯示 Application exited early：新程序啟動後收到平台重啟的舊程序通知，雙方反覆交接。原先只有兩個新程序的交接測試未覆蓋「平台會重啟已交接退出的舊 instance」這個條件。

修復：新增 003_authority_instances.sql，以 RENDER_INSTANCE_ID 綁定持久遞增世代。相同 instance 重啟保留舊世代，只接受較新世代的交接；舊版 UUID 通知不會令新 leader 退出。舊版升級期間仍可收到新協定通知並讓出原 advisory lock。沒有停用單權威鎖，也沒有改動洗牌、規則、AI、資金或玩家可見資訊。

本機真實 PostgreSQL 驗證：12/12 測試、0 失敗；10/10 真實 Chromium 檢查通過，90 個封包。包含相同舊 instance 重啟、真正 legacy main 程式升級後重新啟動、All-in 中途接手與單次結算。完整輸出：render-handoff-tests.log。

正式平台修復後的最終狀態仍須在 Render 部署頁、/healthz 與 /online 核對，不能把本機回歸當作平台部署已成功。
