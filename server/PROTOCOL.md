# 聯機協定 v1（測試版）

所有 API 與 WebSocket 使用同一個 PUBLIC_ORIGIN。身分只來自 session cookie；請求不能指定要代替的 userId／seat。WebSocket 位址：`/ws?roomId=<uuid>`，握手要求有效 session、相符 Origin、該使用者已在房間座位。

## 客戶端行動意圖

```json
{
  "type": "action",
  "handId": "server-issued-hand-uuid",
  "actionId": "client-generated-request-uuid",
  "expectedSeq": 42,
  "action": { "type": "raise", "to": 120 }
}
```

- `handId`：目前伺服器的手號；尚未有牌局時為 null。
- `actionId`：客戶端為一次操作產生的 UUID；重傳必須保留原始完整意圖與 ID。
- `expectedSeq`：最後已套用的**房間事件序號**，不是引擎內部事件序號。
- `to`：本輪總投入額，不是額外投入。Fold/Check/Call/All-in 只送 type，不送客戶端計算的輸贏或餘額。
- 另外支援 `start`、`leave`，共用三個必要欄位；`join` 額外帶 `buyIn`（100–1000）。join 經 POST `/api/rooms/:id/commands`，其餘可經同一 HTTP API 或 WS 發送。
- 建立房間：POST `/api/rooms`，帶 `{actionId,maxPlayers}`，maxPlayers 只接受 2 或 3；依建立者與 actionId 冪等。

## 回覆與一致性

```json
{"type":"ack","actionId":"same-request-uuid","handId":"current-hand-uuid","acceptedSeq":43}
```

Ack 不推進客戶端畫面序號。畫面只由 snapshot/event 更新。

- 在交易內鎖住 rooms row，先查 `(room_id,user_id,action_id)` 收據，再驗證 handId/expectedSeq/規則。
- 相同 ID + 相同正規化內容：回傳原收據，無第二次下注、扣款、事件或結算。
- 相同 ID + 不同內容（包含巢狀 action.to）：`ACTION_ID_CONFLICT`。
- 過期序號：`STALE_SEQ`；不同手號：`STALE_HAND`；行動時間已到：`ACTION_EXPIRED`。
- 不合法操作回 `ILLEGAL_ACTION`，沒有任何部分狀態提交。失敗請求不寫成功收據。
- 收到 stale/error 後先取 snapshot。需要再次操作時使用新 ID，不能偷偷把原意圖改成新序號再自動下注。

## 過濾後的狀態與事件

首次連線收到 `snapshot`：roomId、code、maxPlayers、handId、seq、selfSeat、status、deadline、board、street、pot、pots、players、dealer、turn、自己可用的 legal、已公開的 action／payout。

事件為 `{type:"event",roomId,handId,seq,kind,view}`。view 是該事件時刻的完整**個人化公開狀態**，不是私有引擎物件。kind 包括 join/start/blind/action/return/board/end/leave/disconnected/reconnected/seat-expired。

- players 的 cards 只含自己的底牌，或已完成攤牌且未棄牌者的公開底牌。其他底牌為空陣列。
- board 只含伺服器已發出公開事件的牌。All-in 引擎即使在私有狀態內先算到終局，後續 board、winner、payout 也不會提前送出。
- 網路沒有 seed、deck、burn、queue、privateHoles、owners、legalByUser 或私有存檔。原始 `historyFor()` 含種子，禁止直接作線上 API 回應。

## 去重、缺號與重連

```json
{"type":"resume","afterSeq":42}
```

這是唯讀請求，不消耗 actionId。afterSeq=null 要求完整 snapshot。

- `seq <= lastAppliedSeq`：忽略重複事件。
- `seq > lastAppliedSeq+1`：暫停操作，要求從 lastAppliedSeq 補事件，不能直接跳到新畫面。
- 256 個事件範圍內回 `{type:"events",roomId,seq,events:[...]}`；更久以前直接回經身分過濾的完整 snapshot。
- 重新整理以 session 查 `/api/me` 的房間座位，自動重新連線；不從 localStorage 回復線上餘額或手牌。
- 斷線保留座位 120 秒；未建立 WS 的入桌操作也有保留期限。手中斷線者仍保有 All-in 底池資格。
- 行動逾時由伺服器選合法 Check，否則 Fold；客戶端倒數僅供顯示。斷線不能停止行動計時。
- 保留時間到且不在牌局中，交易內返還座位籌碼至錢包；牌局中則等結算後才釋放。

## 伺服器恢復及處理限制

伺服器將私有引擎（含牌堆）、公開游標佇列、期限、收據與可見狀態存在 PostgreSQL。重啟從最後已提交狀態恢復；不重新洗牌。每次只推進一個到期展示事件，保留 Flop/Turn/River 間隔。

目前只支援一個 active 權威服務程序。PostgreSQL advisory lock 防止雙寫；重新部署透過 LISTEN/NOTIFY 要求舊程序先排空在途工作、釋放鎖，再由新程序恢復。尚未實作多個 active 程序事件匯流排或跨區高可用。

## Supabase session 與邀請

- GET `/api/config` 只包含公開 project URL、publishable key、authMode。
- POST `/api/auth/supabase` 帶 `{accessToken}`；後端呼叫 Supabase GET user 核對後設定本站 session cookie，回應不包含 cookie token。正式環境拒絕本機密碼 API。
- GET `/api/me`、`/api/results`、`/api/settings` 只依 session 身分，不接受代替其他玩家的 userId。
- GET `/api/rooms` 只列自己的建立／已入座房間。
- GET `/api/invites/:CODE` 要求登入；只回 roomId/code/seq/handId/status/players/maxPlayers，不回牌局私有資料。
- 建立回 `{roomId,code,maxPlayers}`；分享 URL 為 `/online?room=CODE`，收件者仍須登入並明確加入，房間碼不是登入憑證。
