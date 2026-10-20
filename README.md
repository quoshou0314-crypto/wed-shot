<p align="center"><img src="docs/logo.svg" alt="Wed Shot" width="320" /></p>

# Wed Shot 1.0

點擊網址列旁的擴充功能圖示,開啟截圖工作頁的 Chrome 擴充功能(Manifest V3 / TypeScript)。

左側以 iframe 內嵌**即時的目標網頁**(wedview),尺寸即網頁看到的視窗大小(預設 960 × 960),
顯示自動縮放至完全 fit 進面板;框選擷取**所見即所得、輸出 1:1 解析度**,
擷取時自動隱藏 fixed/sticky 浮動元件,並排除網頁自己的捲軸。右側「擷取片段」支援多選、合併、批次儲存
(多張自動打包 ZIP,內部檔名跟隨另存對話框輸入的檔名)。

詳細架構見 [docs/architecture.md](docs/architecture.md),
歷次技術決策與被否決的方案見 [docs/decisions.md](docs/decisions.md)。

## 建置與安裝

```bash
npm install
npm run build
```

1. `chrome://extensions` → 開啟「開發人員模式」→「載入未封裝項目」→ 選 `dist/` 資料夾
2. 到目標網頁點擊 Wed Shot 圖示 → 開啟工作頁並自動載入該網址

開發:`npm run watch` 自動重建、`npm run typecheck` 型別檢查。
只改 `panel.*` 時重新整理工具頁即可;改 `content.ts` / `background.ts` / `manifest.json`
需要在 `chrome://extensions` 重新載入擴充功能。

## 操作模式(自動偵測,無切換按鈕)

| 操作 | 行為 |
| --- | --- |
| 畫面**內**一般點擊 / 拖曳 / 滾輪 | 網頁模式:直接操作網頁(點連結、捲動、填表單) |
| 畫面**內**按住 <kbd>Ctrl</kbd> | 拖曳模式:游標變十字,拖曳即框選擷取 |
| 畫面**外**(灰色區)按下拖曳 | 拖曳模式:起點自動夾進畫面內 |

框選進行中滾輪不會捲動網頁(也不會捲動灰色區),<kbd>Ctrl</kbd>+滾輪縮放照常。

## 功能

- **尺寸**:網頁看到的視窗大小(決定版面配置);輸入框 focus 即全選
- **縮放**:「自動」= 整個畫面 fit 進面板(只影響顯示,**不影響輸出解析度**);
  <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd> 或 <kbd>Ctrl</kbd>+滾輪手動縮放、<kbd>Ctrl</kbd>+<kbd>0</kbd> 回自動
- **圖片網址**:直接開圖片網址時自動改版 —— 白底、置中,
  畫面比圖窄就把圖**縮到剛好滿寬**、比圖寬就維持原尺寸置中(不放大);
  不必為了對齊原圖寬度反覆調「尺寸」。樣式在載入當下就套,不等圖片下載完
- **擷取**:放開框選即成像,輸出一律清晰的 1:1;縮放不是 100% 時擷取瞬間畫面會閃一下 100%
  (內嵌網頁只以顯示尺寸點陣化,必須這樣才不會糊);fixed 元件一律隱藏、
  sticky 元件在頁面已捲動時隱藏,拍完自動還原;
  網頁自己的捲軸不在可框選範圍內,截圖必不含捲軸
- **擷取片段**:點卡片切換選取,左上角顯示**選取順序徽章**(同時是合併/儲存順序);
  底部批次列常駐:`全選 / 刪除 / 合併 / 儲存`
- **合併**:依選取順序由上而下拼接成一個片段(取代原片段)
- **儲存**:單張存 PNG;多張自動打包 ZIP —— 先開另存對話框輸入檔名,
  ZIP 內即為 `檔名 (1).png` ~ `檔名 (n).png`。
  存檔走 File System Access(直接寫檔),**不會**跳下載通知、
  也不會出現在 `chrome://downloads`;寫檔時片段欄中央**轉圈**,
  成功後轉成**打勾**並自動淡出(不需按確定),同時清掉勾選

## 快捷鍵

| 鍵 | 功能 |
| --- | --- |
| <kbd>Ctrl</kbd>+拖曳 | 框選擷取(<kbd>Shift</kbd> 鎖正方形、<kbd>Esc</kbd> 取消) |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | 儲存選取的片段 |
| <kbd>Delete</kbd> | 刪除選取的片段 |
| <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> | 縮放 / 回自動 fit |
| <kbd>R</kbd> | 重新載入頁面 |

## 偵錯提示列

擷取使用 `chrome.debugger`(唯一能對擴充頁成像的 API),Chrome 會強制顯示
「Wed Shot 已開始對這個瀏覽器進行偵錯」提示列。已做的緩解:

- 工作頁**開啟時**即附加並保持連線 → 提示列只在開頁時出現一次,之後版面不再跳動
- 提示列是瀏覽器全域的:工具頁**退到背景會自動拆除連線**(逛其他網頁時不顯示),
  切回工具頁再自動附加
- 底部批次列加高,即使被提示列擠壓也點得到
- **徹底移除**:用 `--silent-debugger-extension-api` 旗標啟動 Chrome
  (桌面捷徑「Chrome (Wed Shot)」已設定好;需先完全關閉 Chrome 再用它啟動)

## 已知限制

- 少數網站以 JavaScript 偵測被嵌入(frame busting)時可能拒絕顯示
- 直接開 SVG 等非 HTML 圖片文件時不套用上述改版(沒有 `<img>` 可改),
  維持瀏覽器原本的顯示方式
- 擋掉 content script 的頁面上,畫面內 Ctrl+拖曳無效(改用畫面外起手),
  捲軸尺寸也無從回報,截圖右/下緣可能帶到捲軸
- 工具頁分頁長時間退到背景會被 Chrome 凍結(前景使用不受影響)
- 若目標框架已被其他 DevTools 附加,擷取會失敗並提示

## 多語系

介面跟隨瀏覽器語言自動切換,支援 10 種語言(無對應時用英文):
English、繁體中文、简体中文、Español、Português (Brasil)、日本語、Deutsch、Français、Русский、한국어。

字串在 `public/_locales/<語系>/messages.json`;參數以 `{0}`、`{1}` 代入(見 `src/panel/i18n.ts`)。
新增語系:複製 `en/messages.json` 到新資料夾翻譯即可。

## 自動化測試

`panel.html?autotest=1&url=<目標網址>` 會自動執行擷取驗證,
進度與結果(尺寸、非白像素比例、顏色數)寫入**分頁標題**,供外部輪詢讀取。
`panel.html?devhook=1&url=<目標網址>` 則提供 `window.__wedshot.capture(zoom | 'auto')`,
供 CDP `Runtime.evaluate` 指定縮放擷取(比對各縮放下的清晰度用)。
