# Chrome Web Store 上架資料

上傳檔:`release/wed-shot-1.0.0.zip`(`npm run pack` 產生)
素材:`release/store/` —— `screenshot-en.png`、`screenshot-zh_TW.png`(1280×800)、
`promo-440x280.png`(小型宣傳圖)、`icon-128.png`

## 商店資訊(Store listing)

- **類別**:Tools(工具)
- **語言**:English(預設),另加 中文(台灣)

### 說明 — English

```
Wed Shot opens a dedicated capture workspace for the page you are on.

The page is loaded live at an exact viewport size you choose (e.g. 960 × 960), so you see precisely the layout a visitor with that window would see. Hold Ctrl and drag to select any area — the capture is pixel-exact at 1:1 resolution, no matter how far the preview is zoomed out.

• Exact viewport: set the width × height the page renders at; the preview auto-fits your screen
• What you see is what you get: captures are always sharp 1:1, never blurry
• Clean shots: fixed / sticky overlays are hidden automatically and the page's own scrollbars are never included
• Clip tray: collect captures, select them in order, merge them top-to-bottom into one image
• Batch save: one clip saves as PNG; several are packed into a ZIP named after your file name
• Works on image URLs too: images are centered on white and fitted to the viewport width
• 10 languages, light & dark theme

Privacy: everything happens locally in your browser. Wed Shot collects no data and sends nothing anywhere.

Note: capturing uses Chrome's debugger API, so Chrome shows a "Wed Shot started debugging this browser" bar while the workspace is open. It disappears when you switch away from the workspace tab.
```

### 說明 — 中文(台灣)

```
Wed Shot 會為目前的網頁開啟一個專屬的截圖工作頁。

網頁以你指定的視窗尺寸(例如 960 × 960)即時載入,看到的就是該視窗大小的訪客會看到的版面。按住 Ctrl 拖曳即可框選任意區域 —— 不論預覽縮得多小,擷取結果一律是 1:1 的清晰原尺寸。

• 精準視窗尺寸:自訂網頁渲染的寬 × 高,預覽自動縮放符合畫面
• 所見即所得:擷取一律 1:1 清晰,不會糊
• 乾淨畫面:自動隱藏 fixed / sticky 浮動元件,截圖絕不含網頁捲軸
• 擷取片段:暫存多張截圖,依選取順序由上而下合併成一張
• 批次儲存:單張存 PNG;多張自動打包 ZIP,內部檔名跟隨你輸入的檔名
• 圖片網址也適用:白底置中,自動縮到符合視窗寬度
• 支援 10 種語言、淺色 / 深色主題

隱私:所有處理都在你的瀏覽器本機完成,Wed Shot 不收集任何資料,也不傳送任何東西。

提醒:擷取使用 Chrome 的 debugger API,工作頁開著時 Chrome 會顯示「Wed Shot 已開始對這個瀏覽器進行偵錯」提示列;切到其他分頁時會自動移除。
```

## 隱私權做法(Privacy practices)

### 單一用途(Single purpose)

```
Capture screenshots of web pages at an exact, user-chosen viewport size and save them as PNG or ZIP files.
```

### 權限理由(Permission justification)

| 權限 | 理由(貼到表單) |
| --- | --- |
| `debugger` | `Used only to take the screenshot. Page.captureScreenshot via the debugger API is the only API that can capture the extension's own workspace page (which embeds the target site) at exact 1:1 resolution. It is attached only to the Wed Shot workspace tab while it is in the foreground, and detached when the user switches away.` |
| `tabs` | `Used to read the URL of the tab where the user clicked the toolbar icon (so the workspace opens with that page), to open the workspace tab next to it, and to message the content script in the embedded frame.` |
| `declarativeNetRequest` | `Many sites send X-Frame-Options / CSP frame-ancestors headers that block embedding. A session rule scoped to the Wed Shot workspace tab only (tabIds condition, sub_frame requests only) removes these headers so the page can be previewed inside the workspace. No other tabs or requests are affected.` |
| Host 權限 `<all_urls>` | `The user can capture any website they choose. Host access is needed to embed that site in the workspace, to apply the frame-header rule above, and to run the content script that reports scroll position and temporarily hides fixed/sticky overlays during capture.` |
| 遠端程式碼(Remote code) | 選 **No, I am not using remote code** —— 所有程式都在套件內 |

### 資料使用(Data usage)

- 收集的使用者資料:**全部不勾**(不收集任何類別)
- 三項聲明全部勾選:
  - I do not sell or transfer user data to third parties, outside of the approved use cases
  - I do not use or transfer user data for purposes that are unrelated to my item's single purpose
  - I do not use or transfer user data to determine creditworthiness or for lending purposes

### 隱私權政策網址

不收集資料時非必填;若審查要求,見 [PRIVACY.md](PRIVACY.md),放上公開網址(例如 GitHub)後填入。

## 發布設定(Distribution)

- 付費:免費
- 公開程度:公開(Public)—— 或先選「不公開(Unlisted)」只給有連結的人用
- 地區:所有地區
