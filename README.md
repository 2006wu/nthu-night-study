# 清大夜讀空位查詢

使用 Node.js 22+ 執行 `node server.mjs`，開啟 http://127.0.0.1:4317 。Mac 也可以雙擊「啟動夜讀查詢.command」。

1. 選日期與開始時間。
2. 點「更新圖片」，輸入圖書館帳密與驗證碼，再登入。
3. 點「查看空位」。可篩選分區、最少可坐時間、晚點有位及收藏。
4. 點座位卡片的「預約」，選結束時間，再按「下一步」核對。只有按「確認預約」才向官方送出。

5. 展開「我的預約」查看夜讀區預約，點「取消」核對座位與時段，再按「確認取消」。只有官方狀態允許的預約才能取消；已簽到不提供取消功能。取消前會重查本人預約，逾時不會自動重送。

送出前會重新查空位，預約僅限登入者本人、連續半小時、單次最多 8 小時及官方當下限制。若送出逾時，先到「官方預約現況」確認，再重新登入，不會自動重送。重新啟動程式後沒有預約紀錄快取，請以官方現況為準。

已移除自動辨識，不再依賴 macOS Vision、Swift 或 OCR 套件。程式可在支援 Node.js 22 的雲端主機執行，並提供 Render 部署設定。

密碼不儲存，官方 cookies 與認證資料只保留在伺服器記憶體；停止程式或閒置 30 分鐘即清除。瀏覽器儲存查詢偏好、收藏及本機工作階段 cookie。

資料取自官方可預約狀態，每半小時一格；只把 canbook=1 視為可用。午夜後會查前一營業日與當日。空檔限於官方回傳的範圍，單次最多預約 8 小時，實際以官方送出時為準。

`node --test test.mjs booking.test.mjs cancellation.test.mjs` 驗證跨午夜、空檔中斷、開始時間與資料格式。官方手動登入與實際查詢已經使用者操作確認可用。使用者已確認實際預約成功。取消接口依官方前端核對，20 項測試通過；尚未實際取消使用者預約，最後確認由使用者操作。


## 發布到 Render

1. 將本目錄的程式檔與 render.yaml 放在 GitHub 儲存庫根目錄。
2. 開啟 https://render.com/deploy?repo=https://github.com/2006wu/nthu-night-study ，登入並依畫面建立 Blueprint。
3. 確認服務名稱為 nthu-night-study、方案為 Free，再部署。
4. 成功後開啟 Render 提供的 HTTPS 網址。
5. 網站入口帳號為 `owner`。入口密碼是 Render 服務 Environment 裡自動產生的 `APP_ACCESS_PASSWORD`，也可自行換成長密碼。這個密碼與圖書館密碼不同。
6. 通過入口後，才在網頁輸入圖書館帳密及驗證碼。

若用手動 Web Service：Runtime 選 Node，Build Command 填 `npm test`、Start Command 填 `npm start`，設定 NODE_ENV=production 及 APP_ACCESS_PASSWORD（長密碼）。Render 的 RENDER_EXTERNAL_URL 會自動作為網站網址；自訂網域時另外設定 PUBLIC_ORIGIN=https://你的網域。

只需單一服務實例。官方登入狀態僅在記憶體：服務重啟、更新或免費方案休眠後，需重新登入；官方已建立的預約不會消失。免費服務閒置 15 分鐘可能休眠，重新開啟需要等待啟動。部署後還需實測雲端到圖書館的連線，部分學校服務可能限制資料中心 IP。

雲端啟動需 HTTPS 網址及網站入口密碼，缺少設定會拒絕啟動。Cookie 使用 Secure、HttpOnly、SameSite=Strict，請求只接受設定的網站來源。不要把任何實際帳密放進程式、GitHub 或 render.yaml。
