# Wed Shot 架構說明

## 元件總覽

```
┌─ Chrome ──────────────────────────────────────────────────────┐
│                                                               │
│  background.js(service worker)                               │
│    └─ action.onClicked → 開啟 panel.html?url=<目前分頁網址>    │
│                                                               │
│  panel.html / panel.js(工具頁,chrome-extension:// 分頁)      │
│    ├─ 左欄:工具列(尺寸/縮放)+ stage(iframe wedview)+ 狀態列 │
│    ├─ 右欄:擷取片段(全高)+ 批次列(全選/刪除/合併/儲存)     │
│    ├─ declarativeNetRequest session 規則(允許 iframe 內嵌)    │
│    └─ chrome.debugger(附加自身分頁,擷取成像)                 │
│                                                               │
│  content.js(注入 wedview 框架的內容腳本)                     │
│    ├─ 回報捲動位置 / 文件大小 / 捲軸尺寸                       │
│    ├─ Ctrl+拖曳、Ctrl+滾輪 攔截並轉發座標                      │
│    ├─ Ctrl 十字游標切換                                        │
│    ├─ 圖片檢視頁改版(白底、寬度 fit,document_start 即套)   │
│    └─ 擷取時隱藏 fixed / sticky 元件                           │
└───────────────────────────────────────────────────────────────┘
```

## 內嵌 wedview

- 工具頁以 `<iframe>` 載入目標網址;iframe 的 CSS 尺寸(預設 960×960)
  就是網頁看到的視窗大小,決定版面配置。
- 一般網站以 `X-Frame-Options` / CSP `frame-ancestors` 拒絕內嵌,
  工具頁載入時透過 `chrome.declarativeNetRequest.updateSessionRules`
  掛一條**只作用於本分頁子框架**(`tabIds` + `sub_frame`)的規則移除這些標頭,
  不影響其他分頁。
- 顯示縮放以 `transform: scale()` 實現;「自動」模式用 `ResizeObserver`
  監聽面板尺寸,把整個 stage fit 進面板。顯示縮放與輸出解析度無關。

## 操作模式偵測

跨網域 iframe 內的滑鼠事件,父頁面**收不到**,所以:

- 畫面外(灰色區)的拖曳:工具頁自己處理,`setPointerCapture` 讓拖曳
  跨過 iframe 上方也持續收到事件;起點以 clamp 夾進畫面內。
- 畫面內的 Ctrl+拖曳:由 content script 以 capture phase 攔截
  `mousedown/mousemove/mouseup`(`preventDefault` 阻止頁面反應),
  把座標(iframe 視埠座標 = 版面座標)經 `chrome.runtime.sendMessage`
  轉發給工具頁,由工具頁繪製選取框並觸發擷取。
- Ctrl 十字游標:焦點在 iframe 時由 content script 偵測 Ctrl;
  焦點在工具頁時由工具頁偵測後以 `wedshot:cross` 訊息通知框架。

## 擷取管線(所見即所得、1:1)

```
放開框選(版面座標 rect)
  → ensureDbgAttached()           附加自身分頁(常駐,不重複附加)
  → wedshot:hidefixed             隱藏 fixed(+已捲動時的 sticky);
                                  回應帶回最新捲軸尺寸
  → rect 夾進 shotW/shotH          扣掉內嵌頁捲軸 → 成像不含捲軸
  → 釘住畫面(縮放 ≠ 100% 或框選超出視窗時)
      .stage → position: fixed 左上角、最上層、transform: none
      ← OOPIF 只以顯示尺寸點陣化,必須真的以 100% 顯示才清晰(見決策 9)
  → 仍超出視窗時                  setDeviceMetricsOverride 暫時擴大視埠
  → Page.captureScreenshot
      clip = stage 螢幕位置 + rect(頁面 CSS px),scale = 1
  → 還原 .stage 樣式、清除視埠模擬
  → wedshot:showfixed             還原浮動元件
  → 存入擷取片段
```

- `chrome.debugger` + `Page.captureScreenshot` 是**唯一**能對
  `chrome-extension://` 頁面成像的 API(`captureVisibleTab` 對擴充頁無權限)。
- CDP 只允許對 top-level target 截圖,所以附加的是工具頁自身分頁,
  iframe 內容作為頁面的一部分被一併點陣化。
- 以 100% 釘住後 clip 仍超出實際視窗時(畫面比視窗大),才動用
  `Emulation.setDeviceMetricsOverride` 暫時擴大視埠,拍完即還原。
- debugger 連線在**開頁時**即建立並常駐:偵錯提示列只出現一次、
  版面之後不再跳動;`onDetach` 時標記失效,下次擷取自動重附加;
  `pagehide` 時拆除。

## 儲存

- 存檔進度:另存對話框選完才開始在片段欄中央轉圈(取消另存不會閃出),
  寫檔成功 → 清空勾選 + 轉成打勾 → 停 800ms 後淡出;失敗則直接收起並在狀態列報錯。
  寫檔太快時仍至少轉 450ms,讓「轉圈 → 打勾」看得出前後關係。
- 單張:`showSaveFilePicker` 另存 PNG。
- 多張:先開 `showSaveFilePicker` 取得使用者輸入的檔名,
  再以該檔名打包 ZIP(內部為 `檔名 (1).png` ~ `檔名 (n).png`,依選取順序)。
- File System Access 是直接寫檔、不經 Chrome 下載器:**沒有**下載氣泡,
  也不會進 `chrome://downloads`(無 API 能把既有檔案補登進去);
  完成訊息只出現在狀態列。
- ZIP 為自製極簡打包器(STORE 不壓縮、CRC-32、UTF-8 檔名旗標),
  無外部相依;PNG 本身已壓縮,STORE 幾乎零成本。
- 沒有 `chrome.downloads` 備援:桌面 Chrome(本擴充的唯一目標)一定有
  `showSaveFilePicker`,該分支永遠不會執行;真的取不到時直接回報錯誤。

## 訊息協定(panel ↔ content script)

| 訊息 | 方向 | 用途 |
| --- | --- | --- |
| `wedshot:hello` | panel → frame | 啟用內容腳本(啟用前完全靜默);回傳捲動快照 |
| `wedshot:scrollpos` | frame → panel | 捲動位置 / 文件大小 / 捲軸尺寸 / href 回報 |
| `wedshot:scroll` / `scrollto` | panel → frame | 捲動頁面(自動化測試用) |
| `wedshot:dragstart/move/end/cancel` | frame → panel | Ctrl+拖曳座標轉發 |
| `wedshot:zoomstep` | frame → panel | Ctrl+滾輪縮放 |
| `wedshot:cross` | panel → frame | Ctrl 十字游標切換 |
| `wedshot:hidefixed` / `showfixed` | panel → frame | 擷取時隱藏/還原浮動元件(hidefixed 回應含捲軸尺寸) |
| `wedshot:info` | panel → frame | 索取捲動快照 |

內容腳本注入所有 http(s) 框架(`all_frames`),但只在
「第一層框架」(`parent === top`)且收到 hello 後才動作,
一般瀏覽分頁完全不受影響。唯一的例外是圖片檢視頁改版:
以 `location.ancestorOrigins[0]` 同步認出「父層是本擴充的工具頁」,
在 `document_start` 就套用樣式(等 hello 會晚到 `load` 之後),
認不出來時才退回收到 hello 再套。

## 專案結構

```
public/            靜態檔(manifest、工具頁 HTML/CSS)
src/background.ts  service worker:點圖示開啟工作頁
src/panel/main.ts  工具頁主邏輯(wedview、框選、擷取、片段、儲存)
src/content.ts     內容腳本(捲動回報、Ctrl 偵測、浮動元件隱藏)
build.mjs          esbuild 建置(iife;content script 不能是 ESM)
docs/              本文件與決策記錄
```

## 自動化測試

工具頁支援 `?autotest=1`:等待內嵌頁就緒後自動執行整版擷取與
「捲動後擷取」驗證,把結果(輸出尺寸、非白像素比例 ink%、量化顏色數)
寫入 `document.title`,外部以分頁標題輪詢讀取。
這是因為瀏覽器自動化工具無法操作其他擴充功能的頁面
(無法截圖、注入、點擊),分頁標題是唯一可靠的對外通道。
