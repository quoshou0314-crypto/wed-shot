// Wed Shot 內容腳本:只在被工具頁內嵌的「第一層」框架中作用
// (工具頁透過 chrome.tabs.sendMessage 對它下指令;收到 hello 前完全靜默)
(() => {
  const isFirstLevelFrame =
    window !== window.top && window.parent === window.top;
  if (!isFirstLevelFrame) return;

  let active = false;
  let hiddenEls: { el: HTMLElement; vis: string }[] = [];

  function docSize(): { docW: number; docH: number } {
    const de = document.documentElement;
    const body = document.body;
    return {
      docW: Math.max(de?.scrollWidth ?? 0, body?.scrollWidth ?? 0),
      docH: Math.max(de?.scrollHeight ?? 0, body?.scrollHeight ?? 0),
    };
  }

  /** 頁面捲軸在版面內佔掉的寬 / 高(覆蓋式捲軸為 0) */
  function scrollbarSize(): { sbW: number; sbH: number } {
    const de = document.documentElement;
    const fit = (v: number): number =>
      Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), 40) : 0;
    return {
      sbW: fit(window.innerWidth - (de?.clientWidth ?? window.innerWidth)),
      sbH: fit(window.innerHeight - (de?.clientHeight ?? window.innerHeight)),
    };
  }

  function snapshot() {
    return {
      type: 'wedshot:scrollpos',
      x: window.scrollX,
      y: window.scrollY,
      href: location.href,
      ...docSize(),
      ...scrollbarSize(),
    };
  }

  function post(msg: object): void {
    if (!active) return;
    try {
      void chrome.runtime.sendMessage(msg).catch(() => {
        /* 工具頁不在時忽略 */
      });
    } catch {
      /* 擴充功能重載後的孤兒腳本 */
    }
  }

  function report(): void {
    post(snapshot());
  }

  let raf = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        report();
      });
    },
    { passive: true },
  );

  // 捲軸出現/消失(內容載入後才變長等)時回報,工具頁據此加寬畫面,內容區維持輸入尺寸
  let lastSb = '';
  function watchScrollbar(): void {
    const de = document.documentElement;
    if (!de) return;
    new ResizeObserver(() => {
      const { sbW, sbH } = scrollbarSize();
      const key = `${sbW},${sbH}`;
      if (key === lastSb) return;
      lastSb = key;
      report();
    }).observe(de);
  }
  if (document.documentElement) watchScrollbar();
  else document.addEventListener('DOMContentLoaded', watchScrollbar, { once: true });

  // ---- 直接開圖片網址:白底、寬度 fit、置中 ----
  // Chrome 在 iframe 裡不會 shrink-to-fit(那是頂層分頁才有的行為):
  // 圖比畫面寬就直接被截斷 + 長出捲軸,得手動把「尺寸」調成原圖寬度才拍得到滿版。
  // 覆寫成:畫面寬 < 圖片寬 → 縮到剛好滿寬;畫面寬 > 圖片寬 → 原尺寸置中(不放大)。
  //
  // 時機要快:等 hello 才套會晚到 iframe 的 load 之後(大圖=整張下載完),
  // 畫面會先閃一次原尺寸。改成 document_start 就地判斷 —— 樣式先進場,
  // <img> 之後才被解析出來也照樣套得到,零重排閃動。
  function styleImageDocument(): void {
    const ct = document.contentType || '';
    if (!/^image\//i.test(ct) || /svg/i.test(ct)) return; // SVG 文件沒有 <img>
    if (document.getElementById('__wedshot-imgdoc')) return;
    const root = document.head ?? document.documentElement;
    if (!root) return;
    const st = document.createElement('style');
    st.id = '__wedshot-imgdoc';
    st.textContent = [
      'html, body { background: #fff !important; margin: 0 !important; }',
      // safe center:圖比畫面高時,一般的 center 會把溢出的部分推到捲不到的上方
      'body { min-height: 100vh; display: flex;',
      '       align-items: safe center; justify-content: safe center; }',
      // !important 蓋掉檢視頁寫在 img 內嵌樣式上的縮放(含點擊放大);
      // margin 歸零,置中一律交給 safe center(auto margin 沒有 safe 行為)
      'body > img { display: block !important; margin: 0 !important;',
      '             max-width: 100% !important; width: auto !important;',
      '             height: auto !important; cursor: default !important; }',
    ].join('\n');
    root.appendChild(st);
  }

  /** 是否被本擴充的工具頁內嵌 —— ancestorOrigins 是同步的,不必等 hello */
  function embeddedByPanel(): boolean {
    try {
      const origins = location.ancestorOrigins;
      if (!origins || origins.length === 0) return false;
      return origins[0] === chrome.runtime.getURL('').replace(/\/$/, '');
    } catch {
      return false; // 取不到就退回:等 hello 再套
    }
  }

  if (embeddedByPanel()) styleImageDocument();

  // ---- 按住 Ctrl:游標改為十字(表示可框選) ----
  const crossStyle = document.createElement('style');
  crossStyle.textContent =
    '.__wedshot-cross, .__wedshot-cross * { cursor: crosshair !important; }';

  function setCross(on: boolean): void {
    const root = document.documentElement;
    if (on) {
      if (!crossStyle.isConnected) {
        (document.head ?? root).appendChild(crossStyle);
      }
      root.classList.add('__wedshot-cross');
    } else {
      root.classList.remove('__wedshot-cross');
    }
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (active && e.key === 'Control') setCross(true);
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Control') setCross(false);
    },
    true,
  );
  window.addEventListener('blur', () => setCross(false));

  // ---- Ctrl+拖曳框選:攔截並把座標轉發給工具頁 ----
  let fwdDragging = false;
  // 工具頁那邊正在框選(灰色區起手):框選期間網頁不可捲動
  let scrollLocked = false;

  window.addEventListener(
    'mousedown',
    (e) => {
      if (!active || !e.ctrlKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      fwdDragging = true;
      post({
        type: 'wedshot:dragstart',
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
      });
    },
    true,
  );

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!fwdDragging) return;
      e.preventDefault();
      e.stopPropagation();
      post({
        type: 'wedshot:dragmove',
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
      });
    },
    true,
  );

  window.addEventListener(
    'mouseup',
    (e) => {
      if (!fwdDragging) return;
      fwdDragging = false;
      e.preventDefault();
      e.stopPropagation();
      post({
        type: 'wedshot:dragend',
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
      });
    },
    true,
  );

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && fwdDragging) {
        fwdDragging = false;
        post({ type: 'wedshot:dragcancel' });
      }
    },
    true,
  );

  // Ctrl+滾輪 → 工具頁縮放(並阻止瀏覽器縮放整個分頁);
  // 框選中的一般滾輪 → 擋掉,網頁不捲動(框選是版面座標,捲了會對不上內容)
  window.addEventListener(
    'wheel',
    (e) => {
      if (!active) return;
      if (e.ctrlKey) {
        e.preventDefault();
        post({ type: 'wedshot:zoomstep', dir: e.deltaY < 0 ? 1 : -1 });
      } else if (fwdDragging || scrollLocked) {
        e.preventDefault();
      }
    },
    { passive: false, capture: true },
  );

  chrome.runtime.onMessage.addListener(
    (
      msg: {
        type?: string;
        dx?: number;
        dy?: number;
        x?: number;
        y?: number;
        on?: boolean;
      },
      _sender,
      sendResponse,
    ) => {
      if (msg?.type === 'wedshot:scrolllock') {
        scrollLocked = !!msg.on;
        sendResponse({ ok: true });
      } else if (msg?.type === 'wedshot:cross') {
        // 焦點在工具頁時,由面板代為通知 Ctrl 按下/放開
        setCross(!!msg.on);
        sendResponse({ ok: true });
      } else if (msg?.type === 'wedshot:hello') {
        active = true;
        styleImageDocument(); // 備援:ancestorOrigins 取不到時才輪到這裡
        report();
        sendResponse(snapshot());
      } else if (msg?.type === 'wedshot:scroll') {
        window.scrollBy(msg.dx ?? 0, msg.dy ?? 0);
        report();
        sendResponse(snapshot());
      } else if (msg?.type === 'wedshot:scrollto') {
        window.scrollTo(msg.x ?? 0, msg.y ?? 0);
        report();
        sendResponse(snapshot());
      } else if (msg?.type === 'wedshot:hidefixed') {
        // 擷取時隱藏浮動元件:fixed 一律隱藏;sticky 在頁面已捲動時隱藏
        hiddenEls = [];
        const scrolled = window.scrollY > 0 || window.scrollX > 0;
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>('body *'),
        )) {
          const cs = getComputedStyle(el);
          if (
            cs.position === 'fixed' ||
            (cs.position === 'sticky' && scrolled)
          ) {
            if (cs.visibility !== 'hidden') {
              hiddenEls.push({ el, vis: el.style.visibility });
              el.style.visibility = 'hidden';
            }
          }
        }
        // 一併回報最新捲軸尺寸:擷取範圍要排除捲軸那一條
        sendResponse({
          ok: true,
          hidden: hiddenEls.length,
          ...scrollbarSize(),
        });
      } else if (msg?.type === 'wedshot:showfixed') {
        for (const h of hiddenEls) h.el.style.visibility = h.vis;
        hiddenEls = [];
        sendResponse({ ok: true });
      } else if (msg?.type === 'wedshot:info') {
        sendResponse(snapshot());
      }
      return false;
    },
  );
})();
