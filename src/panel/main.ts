// Wed Shot 截圖工作頁:
// 左側以 iframe 內嵌目標網頁(尺寸 = 網頁看到的視窗大小),顯示自動 fit 進面板。
// 操作模式自動偵測:畫面外起手拖曳或 Ctrl+拖曳 = 框選截圖;畫面內一般操作 = 直接用網頁。
// 擷取「所見即所得」:以目前預覽畫面成像(1:1 解析度),擷取時自動隱藏 fixed/sticky 浮動元件。
// 右側為擷取片段(勾選制):底部批次列可全選、刪除、合併、儲存(多張自動打包 ZIP,
// ZIP 內的 PNG 檔名跟隨另存對話框輸入的檔名)。

import { applyI18n, t } from './i18n';

// ---------- 型別 ----------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TrayItem {
  id: number;
  dataUrl: string;
  w: number;
  h: number;
}

interface FrameState {
  x: number;
  y: number;
  docW: number;
  docH: number;
  href: string;
  sbW: number; // 內嵌頁的垂直捲軸寬(畫面自動加寬這麼多,內容區 = 輸入尺寸)
  sbH: number; // 內嵌頁的水平捲軸高
}

declare global {
  interface Window {
    showSaveFilePicker?(options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }
}

// ---------- DOM ----------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const inpW = $<HTMLInputElement>('inpW');
const inpH = $<HTMLInputElement>('inpH');
const selZoom = $<HTMLSelectElement>('selZoom');
const stageScroll = $('stageScroll');
const stageOuter = $('stageOuter');
const stage = $('stage');
const stageFrame = $<HTMLIFrameElement>('stageFrame');
const rubber = $('rubber');
const rubberSize = $('rubberSize');
const splitter = $('splitter');
const tray = $('tray');
const chkAll = $<HTMLInputElement>('chkAll');
const btnDelete = $<HTMLButtonElement>('btnDelete');
const btnMerge = $<HTMLButtonElement>('btnMerge');
const btnSaveSel = $<HTMLButtonElement>('btnSaveSel');
const saveToast = $('saveToast');
const stCoord = $('stCoord');
const stSize = $('stSize');
const stMsg = $('stMsg');
const appEl = document.querySelector<HTMLElement>('.app')!;
const trayPane = document.querySelector<HTMLElement>('.tray-pane')!;

// ---------- 狀態 ----------

const DEFAULT_W = 960;
const DEFAULT_H = 960;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 3;
const ZOOM_STEPS = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2,
];

let stageW = DEFAULT_W;
let stageH = DEFAULT_H;
let zoomMode: 'auto' | 'manual' = 'auto';
let zoom = 0.5;
let currentUrl = '';
let items: TrayItem[] = [];
let nextId = 1;
let selectedIds: number[] = []; // 依勾選順序(合併時的拼接順序)
let panelTabId: number | null = null;
let capturing = false;
let frameState: FrameState = {
  x: 0,
  y: 0,
  docW: 0,
  docH: 0,
  href: '',
  sbW: 0,
  sbH: 0,
};

// ---------- 小工具 ----------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('errImageLoad')));
    img.src = url;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

let msgTimer: number | undefined;
function setMsg(text: string, isErr = false): void {
  stMsg.textContent = text;
  stMsg.classList.toggle('is-err', isErr);
  window.clearTimeout(msgTimer);
  if (text) {
    msgTimer = window.setTimeout(() => {
      stMsg.textContent = '';
      stMsg.classList.remove('is-err');
    }, 5000);
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ---------- 與內嵌框架的內容腳本通訊 ----------

function sendToFrame<T = FrameState>(msg: object): Promise<T | undefined> {
  if (panelTabId === null) return Promise.resolve(undefined);
  return (chrome.tabs.sendMessage(panelTabId, msg) as Promise<T>).catch(
    () => undefined,
  );
}

function applyFrameState(s: Partial<FrameState> | undefined): void {
  if (!s || typeof s !== 'object') return;
  const prevSbW = frameState.sbW;
  const prevSbH = frameState.sbH;
  frameState = {
    x: s.x ?? frameState.x,
    y: s.y ?? frameState.y,
    docW: s.docW ?? frameState.docW,
    docH: s.docH ?? frameState.docH,
    href: s.href ?? frameState.href,
    sbW: s.sbW ?? frameState.sbW,
    sbH: s.sbH ?? frameState.sbH,
  };
  // 捲軸出現/消失 → 畫面寬高跟著加減,內容區維持輸入尺寸(擷取中不動,拍完再補)
  if (
    !captureFullActive &&
    (frameState.sbW !== prevSbW || frameState.sbH !== prevSbH)
  ) {
    applyStageSize();
  }
}

interface FrameEventMsg extends Partial<FrameState> {
  type?: string;
  shift?: boolean;
  dir?: 1 | -1;
}

chrome.runtime.onMessage.addListener((msg: FrameEventMsg, sender) => {
  if (sender.tab?.id !== panelTabId) return;
  switch (msg?.type) {
    case 'wedshot:scrollpos':
      applyFrameState(msg);
      break;
    // 內嵌頁裡的 Ctrl+拖曳(座標即版面座標)
    case 'wedshot:dragstart':
      beginDrag(clampX(msg.x ?? 0), clampY(msg.y ?? 0));
      break;
    case 'wedshot:dragmove':
      moveDrag(clampX(msg.x ?? 0), clampY(msg.y ?? 0), !!msg.shift);
      break;
    case 'wedshot:dragend':
      moveDrag(clampX(msg.x ?? 0), clampY(msg.y ?? 0), !!msg.shift);
      finishDrag();
      break;
    case 'wedshot:dragcancel':
      endDrag();
      break;
    case 'wedshot:zoomstep':
      stepZoom(msg.dir === -1 ? -1 : 1);
      break;
  }
});

/** 內容腳本可能比 iframe 的 load 事件晚就緒,持續重試直到接上 */
function helloToFrame(attempt = 0): void {
  void sendToFrame({ type: 'wedshot:hello' }).then((res) => {
    if (res) applyFrameState(res);
    else if (attempt < 30) {
      window.setTimeout(() => helloToFrame(attempt + 1), 600);
    }
  });
}

// ---------- 偏好設定 ----------

function loadPrefs(): void {
  try {
    const z = localStorage.getItem('wedshot.zoom2') ?? 'auto';
    if (z === 'auto') {
      zoomMode = 'auto';
    } else {
      const n = Number(z);
      if (Number.isFinite(n) && n > 0) {
        zoomMode = 'manual';
        zoom = Math.min(Math.max(n, ZOOM_MIN), ZOOM_MAX);
      }
    }
    stageW =
      Number(localStorage.getItem('wedshot.vw') ?? String(DEFAULT_W)) ||
      DEFAULT_W;
    stageH =
      Number(localStorage.getItem('wedshot.vh') ?? String(DEFAULT_H)) ||
      DEFAULT_H;
  } catch {
    /* localStorage 不可用時採預設值 */
  }
  inpW.value = String(stageW);
  inpH.value = String(stageH);
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// ---------- 內嵌頁面(允許被 iframe 載入) ----------

async function setupFrameRules(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (!tab?.id) return;
  panelTabId = tab.id;
  const ruleId = tab.id + 1;
  const remove = chrome.declarativeNetRequest.HeaderOperation.REMOVE;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          responseHeaders: [
            { header: 'x-frame-options', operation: remove },
            { header: 'frame-options', operation: remove },
            { header: 'content-security-policy', operation: remove },
            { header: 'content-security-policy-report-only', operation: remove },
          ],
        },
        condition: {
          tabIds: [tab.id],
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
        },
      },
    ],
  });
}

function navigate(raw: string): void {
  let url = raw.trim();
  if (!url) return;
  if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;
  if (!/^https?:/i.test(url)) {
    setMsg(t('errHttpOnly'), true);
    return;
  }
  currentUrl = url;
  // 捲軸尺寸沿用上一頁(系統捲軸寬固定),避免每次載入畫面先縮再撐開
  frameState = { ...frameState, x: 0, y: 0, docW: 0, docH: 0, href: url };
  stageFrame.src = url;
  setMsg(t('loading'));
}

stageFrame.addEventListener('load', () => {
  if (currentUrl) {
    setMsg(t('pageLoaded'));
    helloToFrame();
  }
});

// ---------- 畫面尺寸 / 縮放(auto = 完全 fit 進面板) ----------

let captureFullActive = false;

/** 內嵌畫面實際尺寸 = 輸入尺寸 + 網頁捲軸 → 內容區(可擷取範圍)剛好等於輸入尺寸 */
const frameW = (): number => stageW + frameState.sbW;
const frameH = (): number => stageH + frameState.sbH;

function computeFitZoom(): number {
  const availW = stageScroll.clientWidth - 32;
  const availH = stageScroll.clientHeight - 32;
  if (availW <= 0 || availH <= 0) return zoom;
  const fit = Math.min(availW / frameW(), availH / frameH(), 1);
  return Math.max(fit, ZOOM_MIN);
}

function applyStageSize(): void {
  stageW = Math.min(Math.max(Number(inpW.value) || DEFAULT_W, 200), 4000);
  stageH = Math.min(Math.max(Number(inpH.value) || DEFAULT_H, 200), 8000);
  inpW.value = String(stageW);
  inpH.value = String(stageH);
  if (zoomMode === 'auto') zoom = computeFitZoom();
  stage.style.width = `${frameW()}px`;
  stage.style.height = `${frameH()}px`;
  stage.style.transform = `scale(${zoom})`;
  // 框選尺寸標籤反向縮放,任何縮放下字都一樣大
  stage.style.setProperty('--inv-zoom', String(1 / zoom));
  stage.style.transformOrigin = 'top left';
  stageOuter.style.width = `${frameW() * zoom}px`;
  stageOuter.style.height = `${frameH() * zoom}px`;
  stSize.textContent =
    `${stageW}×${stageH} @${Math.round(zoom * 100)}%` +
    (zoomMode === 'auto' ? t('statusAuto') : '');
  savePref('wedshot.vw', String(stageW));
  savePref('wedshot.vh', String(stageH));
  savePref('wedshot.zoom2', zoomMode === 'auto' ? 'auto' : String(zoom));
  syncZoomSelect();
}

function syncZoomSelect(): void {
  const autoOpt = selZoom.querySelector<HTMLOptionElement>(
    'option[value="auto"]',
  );
  if (autoOpt) {
    autoOpt.textContent =
      zoomMode === 'auto'
        ? t('zoomAutoPct', Math.round(zoom * 100))
        : t('zoomAuto');
  }
  if (zoomMode === 'auto') {
    selZoom.querySelector('option[data-custom]')?.remove();
    selZoom.value = 'auto';
    return;
  }
  const val = String(zoom);
  const exists = [...selZoom.options].some(
    (o) => !o.dataset['custom'] && o.value === val,
  );
  let custom = selZoom.querySelector<HTMLOptionElement>('option[data-custom]');
  if (exists) {
    custom?.remove();
  } else {
    if (!custom) {
      custom = document.createElement('option');
      custom.dataset['custom'] = '1';
      selZoom.appendChild(custom);
    }
    custom.value = val;
    custom.textContent = `${Math.round(zoom * 100)}%`;
  }
  selZoom.value = val;
}

function setZoomManual(z: number): void {
  zoomMode = 'manual';
  zoom = Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);
  applyStageSize();
}

function setZoomAuto(): void {
  zoomMode = 'auto';
  applyStageSize();
}

/** Ctrl+加減 / Ctrl+滾輪:沿級距手動縮放(Ctrl+0 回到自動 fit) */
function stepZoom(dir: 1 | -1): void {
  let idx = 0;
  let best = Infinity;
  ZOOM_STEPS.forEach((v, i) => {
    const d = Math.abs(v - zoom);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  idx = Math.min(Math.max(idx + dir, 0), ZOOM_STEPS.length - 1);
  setZoomManual(ZOOM_STEPS[idx]!);
}

// 回呼內同步改版面會觸發「ResizeObserver loop completed with undelivered
// notifications」警告:延後到下一影格,且縮放值有變才重算,避免循環
let fitRaf = 0;
new ResizeObserver(() => {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    if (captureFullActive || zoomMode !== 'auto') return;
    const z = computeFitZoom();
    if (Math.abs(z - zoom) > 0.001) applyStageSize();
  });
}).observe(stageScroll);

// ---------- 拖曳框選(版面座標,所見即所得) ----------
// 兩條入口:1) 畫面外(灰色區)起手,滑鼠事件由面板處理;
//           2) 畫面內 Ctrl+拖曳,由內容腳本轉發座標。

interface DragState {
  startX: number;
  startY: number;
  rect: Rect;
}
let drag: DragState | null = null;

// 可擷取範圍 = 輸入尺寸(畫面已另外加上捲軸寬高,捲軸在這個範圍之外),
// 框選與成像共用同一個上限 → 選不到捲軸、也拍不進捲軸
const shotW = (): number => stageW;
const shotH = (): number => stageH;

const clampX = (v: number): number => Math.min(Math.max(v, 0), shotW());
const clampY = (v: number): number => Math.min(Math.max(v, 0), shotH());

/** 滑鼠座標 → 版面座標,並夾進畫面內(畫面外起手自動夾回) */
function stagePointAt(
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const r = stage.getBoundingClientRect(); // 已含 scale
  return {
    x: clampX((clientX - r.left) / zoom),
    y: clampY((clientY - r.top) / zoom),
  };
}

/** 避免點在捲軸上誤觸框選 */
function onScrollbar(e: PointerEvent): boolean {
  const r = stageScroll.getBoundingClientRect();
  return (
    e.clientX - r.left > stageScroll.clientWidth ||
    e.clientY - r.top > stageScroll.clientHeight
  );
}

function beginDrag(x: number, y: number): void {
  drag = { startX: x, startY: y, rect: { x, y, w: 0, h: 0 } };
  rubber.hidden = false;
  updateRubber();
  void sendToFrame({ type: 'wedshot:scrolllock', on: true });
}

function moveDrag(x: number, y: number, shift: boolean): void {
  if (!drag) return;
  stCoord.textContent = `${Math.round(x)}, ${Math.round(y)}`;
  let w = x - drag.startX;
  let h = y - drag.startY;
  if (shift) {
    const s = Math.min(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  drag.rect = {
    x: Math.min(drag.startX, drag.startX + w),
    y: Math.min(drag.startY, drag.startY + h),
    w: Math.abs(w),
    h: Math.abs(h),
  };
  updateRubber();
}

function updateRubber(): void {
  if (!drag) return;
  const r = drag.rect;
  rubber.style.left = `${r.x}px`;
  rubber.style.top = `${r.y}px`;
  rubber.style.width = `${r.w}px`;
  rubber.style.height = `${r.h}px`;
  rubberSize.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
}

function endDrag(): Rect | null {
  const rect = drag?.rect ?? null;
  if (drag) void sendToFrame({ type: 'wedshot:scrolllock', on: false });
  drag = null;
  rubber.hidden = true;
  return rect;
}

function finishDrag(): void {
  const rect = endDrag();
  if (rect && rect.w >= 6 && rect.h >= 6) void addCapture(rect);
}

// 入口 1:畫面外(灰色區)起手;Ctrl+點灰色區也算
stageScroll.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || onScrollbar(e)) return;
  e.preventDefault();
  stageScroll.setPointerCapture(e.pointerId);
  const p = stagePointAt(e.clientX, e.clientY);
  beginDrag(p.x, p.y);
});

stageScroll.addEventListener('pointermove', (e) => {
  const p = stagePointAt(e.clientX, e.clientY);
  stCoord.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  if (drag) moveDrag(p.x, p.y, e.shiftKey);
});

stageScroll.addEventListener('pointerleave', () => {
  stCoord.textContent = '—';
});

stageScroll.addEventListener('pointerup', (e) => {
  if (!drag) return;
  stageScroll.releasePointerCapture(e.pointerId);
  const p = stagePointAt(e.clientX, e.clientY);
  moveDrag(p.x, p.y, e.shiftKey);
  finishDrag();
});

// 焦點在工具頁時,Ctrl 按下/放開 → 通知框架切換十字游標
let crossOn = false;
function setFrameCross(on: boolean): void {
  if (crossOn === on) return;
  crossOn = on;
  void sendToFrame({ type: 'wedshot:cross', on });
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Control') setFrameCross(true);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Control') setFrameCross(false);
});
window.addEventListener('blur', () => setFrameCross(false));

// Ctrl+滾輪(在工具 UI 上):縮放內嵌畫面,並阻止瀏覽器縮放整個擴充頁;
// 框選中的一般滾輪(灰色區):擋掉,畫面不捲動
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    } else if (drag) {
      e.preventDefault();
    }
  },
  { passive: false },
);

// ---------- 截圖(所見即所得,1:1 解析度) ----------

/** 暫時性的分頁列鎖定會讓 attach 失敗,重試幾次 */
async function dbgAttach(target: chrome.debugger.Debuggee): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.debugger.attach(target, '1.3', () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
      return;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (i < 4 && /cannot be edited/i.test(m)) {
        await sleep(400);
        continue;
      }
      throw e;
    }
  }
}

// 附加一次後保持連線重複使用:「開始偵錯」提示列整個工作階段只出現一次,
// 不會每次擷取都彈出/收回造成視窗跳動。
let dbgAttached = false;

async function ensureDbgAttached(): Promise<chrome.debugger.Debuggee> {
  const dbg: chrome.debugger.Debuggee = { tabId: panelTabId! };
  if (!dbgAttached) {
    await dbgAttach(dbg);
    dbgAttached = true;
  }
  return dbg;
}

// 使用者按提示列「取消」或被其他偵錯工具搶走時,標記失效,下次擷取自動重附加
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === panelTabId) dbgAttached = false;
});

function dbgDetachNow(): void {
  if (dbgAttached && panelTabId !== null) {
    dbgAttached = false;
    chrome.debugger.detach({ tabId: panelTabId }, () => {
      void chrome.runtime.lastError;
    });
  }
}

// 關閉工具頁時拆除連線,讓提示列消失
window.addEventListener('pagehide', dbgDetachNow);

// 提示列是整個瀏覽器全域的:工具頁退到背景就拆除(逛其他網頁時不顯示),
// 回到前景再自動附加 —— 提示列只在「正在用工具」時存在。
// 注意:拆除後提示列還會停留數秒才消失,那是 Chrome 的防閃爍緩衝,無法控制。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!capturing) dbgDetachNow();
  } else {
    void ensureDbgAttached().catch(() => {
      /* 首次擷取會再重試 */
    });
  }
});

// 視窗失焦也提早拆除(點到別的視窗當下就觸發,比分頁切換事件更早)
window.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (document.activeElement === stageFrame) return; // 焦點只是進到內嵌頁
    if (!capturing) dbgDetachNow();
  }, 0);
});
window.addEventListener('focus', () => {
  void ensureDbgAttached().catch(() => {
    /* 首次擷取會再重試 */
  });
});

function dbgCommand<T>(
  target: chrome.debugger.Debuggee,
  method: string,
  params?: object,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as T);
    });
  });
}

/** 擷取目前預覽畫面上的框選範圍(版面座標),輸出 1:1 */
async function debuggerCapture(rect: Rect): Promise<string | null> {
  if (panelTabId === null) return null;

  const dbg = await ensureDbgAttached();
  captureFullActive = true;
  let emulated = false;
  let hidFixed = false;
  try {
    // 隱藏內嵌頁的浮動元件(fixed / 捲動後的 sticky),只留內容本身;
    // 回應順便帶回最新的捲軸尺寸(捲軸可能載入後才出現/消失)
    const hid = await sendToFrame<{ ok?: boolean } & Partial<FrameState>>({
      type: 'wedshot:hidefixed',
    });
    hidFixed = !!hid?.ok;
    applyFrameState(hid);

    // 以最新的捲軸尺寸夾住取像範圍 → 輸出不含頁面捲軸
    const x0 = clampX(rect.x);
    const y0 = clampY(rect.y);
    const w = Math.max(1, Math.min(rect.w, shotW() - x0));
    const h = Math.max(1, Math.min(rect.h, shotH() - y0));

    // 一律以 100% 拍:內嵌網頁(跨程序 OOPIF)只以畫面上的顯示尺寸點陣化,
    // clip.scale 只是把那張點陣放大/縮小 → 縮小顯示時糊、放大顯示時重新取樣變軟。
    // 縮放不是 100%、或框選超出視窗時,擷取瞬間把畫面以 100% 釘在視窗左上角
    // (position: fixed,不佔版面、蓋過所有工具 UI;網頁本身尺寸不變,不重排),
    // 拍完立刻還原。沒釘住時擴大視埠,底部會拍進工具自己的狀態列。
    const flat = Math.abs(zoom - 1) > 0.001;
    const r0 = stage.getBoundingClientRect();
    const pin =
      flat ||
      r0.left + x0 < 0 ||
      r0.top + y0 < 0 ||
      r0.left + x0 + w > window.innerWidth ||
      r0.top + y0 + h > window.innerHeight;
    const saved = stage.style.cssText;
    if (pin) {
      Object.assign(stage.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        zIndex: '2147483647',
      });
      if (flat) stage.style.transform = 'none';
    }
    try {
      let sr = stage.getBoundingClientRect();
      const clipL = sr.left + x0;
      const clipT = sr.top + y0;
      const clipR = clipL + w;
      const clipB = clipT + h;
      const M = 2; // 容差
      if (
        clipL < -M ||
        clipT < -M ||
        clipR > window.innerWidth + M ||
        clipB > window.innerHeight + M
      ) {
        // 框選範圍超出實際視窗時,暫時擴大視埠讓 OOPIF 點陣化
        const needW = Math.ceil(sr.left + window.scrollX + x0 + w) + 4;
        const needH = Math.ceil(sr.top + window.scrollY + y0 + h) + 4;
        await dbgCommand(dbg, 'Emulation.setDeviceMetricsOverride', {
          width: Math.min(Math.max(needW, window.innerWidth), 9000),
          height: Math.min(Math.max(needH, window.innerHeight), 9000),
          deviceScaleFactor: 1,
          mobile: false,
        });
        emulated = true;
        await sleep(300);
        sr = stage.getBoundingClientRect();
      } else {
        await sleep(120); // 等重繪(隱藏浮動元件 / 切到 100%)
      }

      const px = sr.left + window.scrollX;
      const py = sr.top + window.scrollY;
      const res = await dbgCommand<{ data?: string }>(
        dbg,
        'Page.captureScreenshot',
        {
          format: 'png',
          clip: {
            x: px + x0,
            y: py + y0,
            width: w,
            height: h,
            scale: 1, // CDP 必填;畫面已是 100%,不再縮放
          },
          fromSurface: true,
        },
      );
      return res?.data ? `data:image/png;base64,${res.data}` : null;
    } finally {
      stage.style.cssText = saved;
    }
  } finally {
    if (emulated) {
      await dbgCommand(dbg, 'Emulation.clearDeviceMetricsOverride').catch(
        () => {},
      );
    }
    if (hidFixed) void sendToFrame({ type: 'wedshot:showfixed' });
    captureFullActive = false;
    if (
      parseFloat(stage.style.width) !== frameW() ||
      parseFloat(stage.style.height) !== frameH()
    ) {
      applyStageSize(); // 擷取中捲軸尺寸有變,拍完再補重排
    }
    // 不 detach:保持偵錯連線,避免提示列反覆彈出
  }
}

async function addCapture(rect: Rect): Promise<void> {
  if (capturing) return;
  capturing = true;
  try {
    setMsg(t('capturing'));
    const dataUrl = await debuggerCapture(rect);
    if (!dataUrl) throw new Error(t('errNoImage'));
    const img = await loadImage(dataUrl);
    const item: TrayItem = {
      id: nextId++,
      dataUrl,
      w: img.naturalWidth,
      h: img.naturalHeight,
    };
    items.push(item);
    renderTray();
    setMsg(t('captured', item.id, img.naturalWidth, img.naturalHeight));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    setMsg(
      /attach|debugger/i.test(m)
        ? t('captureFailedDevtools', m)
        : t('captureFailed', m),
      true,
    );
  } finally {
    capturing = false;
  }
}

// ---------- 擷取片段(勾選制) ----------

function renderTray(): void {
  selectedIds = selectedIds.filter((id) => items.some((i) => i.id === id));

  tray.textContent = '';
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset['id'] = String(item.id);
    const order = selectedIds.indexOf(item.id);
    if (order >= 0) card.classList.add('is-active');

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = `#${item.id}`;
    img.draggable = false; // 避免原生圖片拖曳吃掉點擊
    card.appendChild(img);

    if (order >= 0) {
      // 選取順序徽章(同時代表已選取,不另設勾選框)
      const badge = document.createElement('span');
      badge.className = 'card-order';
      badge.textContent = String(order + 1);
      card.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const idSpan = document.createElement('span');
    idSpan.textContent = `#${item.id}`;
    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = `${item.w}×${item.h}`;
    meta.append(idSpan, sizeSpan);
    card.appendChild(meta);

    card.addEventListener('click', () => toggleSelect(item.id));
    tray.appendChild(card);
  }
  updateBatchBar();
}

function toggleSelect(id: number): void {
  const idx = selectedIds.indexOf(id);
  if (idx >= 0) selectedIds.splice(idx, 1);
  else selectedIds.push(id);
  renderTray();
}

function updateBatchBar(): void {
  const n = selectedIds.length;
  btnDelete.disabled = n === 0;
  btnMerge.disabled = n < 2;
  btnSaveSel.disabled = n === 0;
  chkAll.checked = n > 0 && n === items.length;
  chkAll.indeterminate = n > 0 && n < items.length;
}

// ---- 存檔進度圈:寫檔中轉圈 → 完成變打勾 → 自動淡出(不需按確定) ----
const TOAST_MIN_SPIN = 450; // 寫檔太快時也讓「轉圈」看得到,打勾才有前因
const TOAST_HOLD = 800; // 打勾停留時間
let toastStart = 0;
let toastTimer: number | undefined;

function toastReset(): void {
  window.clearTimeout(toastTimer);
  saveToast.classList.remove('is-busy', 'is-done', 'is-out');
}

function toastBusy(): void {
  toastReset();
  toastStart = performance.now();
  saveToast.setAttribute('aria-label', t('saving'));
  saveToast.classList.add('is-busy');
  saveToast.hidden = false;
}

function toastHide(): void {
  toastReset();
  saveToast.hidden = true;
}

function toastDone(): void {
  const wait = Math.max(0, TOAST_MIN_SPIN - (performance.now() - toastStart));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    saveToast.classList.remove('is-busy');
    saveToast.classList.add('is-done');
    saveToast.setAttribute('aria-label', t('saved'));
    toastTimer = window.setTimeout(() => {
      saveToast.classList.add('is-out');
      toastTimer = window.setTimeout(toastHide, 260);
    }, TOAST_HOLD);
  }, wait);
}

/** 存檔完成:清掉勾選,進度圈轉成打勾後自動消失 */
function finishSave(message: string): void {
  selectedIds = [];
  renderTray();
  setMsg(message);
  toastDone();
}

/** 勾選的片段(依勾選順序) */
function pickedItems(): TrayItem[] {
  return selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is TrayItem => !!i);
}

function deleteChecked(): void {
  if (selectedIds.length === 0) return;
  const n = selectedIds.length;
  items = items.filter((i) => !selectedIds.includes(i.id));
  selectedIds = [];
  renderTray();
  setMsg(t('deleted', n));
}

/** 把勾選的片段依勾選順序「由上而下」拼接成一個片段 */
async function mergeSelected(): Promise<void> {
  const picked = pickedItems();
  if (picked.length < 2) return;
  try {
    const images = await Promise.all(picked.map((i) => loadImage(i.dataUrl)));
    const width = Math.max(...images.map((i) => i.naturalWidth));
    const height = images.reduce((s, i) => s + i.naturalHeight, 0);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    let y = 0;
    for (const img of images) {
      ctx.drawImage(img, 0, y);
      y += img.naturalHeight;
    }
    const merged: TrayItem = {
      id: nextId++,
      dataUrl: c.toDataURL('image/png'),
      w: width,
      h: height,
    };
    const insertAt = items.findIndex((i) => i.id === picked[0]!.id);
    items = items.filter((i) => !selectedIds.includes(i.id));
    items.splice(Math.min(insertAt, items.length), 0, merged);
    selectedIds = [];
    renderTray();
    setMsg(t('merged', merged.id, width, height));
  } catch (e) {
    setMsg(t('mergeFailed', e instanceof Error ? e.message : String(e)), true);
  }
}

// ---------- 儲存(勾選的片段;多張打包 ZIP,內部檔名跟隨輸入) ----------

// ---- 極簡 ZIP 打包(STORE,不壓縮;PNG 本身已壓縮) ----

let crcTable: Uint32Array | null = null;

function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const u16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
  const u32 = (v: number) =>
    new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let cdSize = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);
    const common = [
      u16(20),
      u16(0x0800), // UTF-8 檔名
      u16(0), // STORE
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(nameB.length),
      u16(0),
    ];
    const local = [u32(0x04034b50), ...common, nameB];
    const localLen = local.reduce((s, a) => s + a.length, 0);
    parts.push(...local, f.data);

    const cd = [
      u32(0x02014b50),
      u16(20),
      ...common,
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameB,
    ];
    for (const a of cd) cdSize += a.length;
    central.push(...cd);
    offset += localLen + f.data.length;
  }

  const eocd = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(cdSize),
    u32(offset),
    u16(0),
  ];
  return new Blob([...parts, ...central, ...eocd] as BlobPart[], {
    type: 'application/zip',
  });
}

async function saveChecked(): Promise<void> {
  const picked = pickedItems();
  if (picked.length === 0) {
    setMsg(t('selectToSave'), true);
    return;
  }
  const ts = timestamp();
  const multi = picked.length > 1;

  if (typeof window.showSaveFilePicker !== 'function') {
    // 桌面 Chrome 一定有;真的沒有時明講,不做假備援
    setMsg(t('errNoFsAccess'), true);
    return;
  }

  // 先開另存對話框拿到「檔名」,ZIP 內的 PNG 也用這個檔名編號
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: multi ? `wed-shot-${ts}.zip` : `wed-shot-${ts}.png`,
      types: multi
        ? [{ description: t('zipFile'), accept: { 'application/zip': ['.zip'] } }]
        : [{ description: t('pngImage'), accept: { 'image/png': ['.png'] } }],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      setMsg(t('saveCanceled'));
      return;
    }
    // 例:企業政策 DefaultFileSystemWriteGuardSetting 封鎖寫入
    setMsg(t('saveFailed', e instanceof Error ? e.message : String(e)), true);
    return;
  }

  toastBusy(); // 對話框選完才開始轉:取消另存不會閃出轉圈
  try {
    const base = handle.name.replace(/\.(zip|png)$/i, '');
    let blob: Blob;
    if (multi) {
      const files = await Promise.all(
        picked.map(async (it, i) => ({
          name: `${base} (${i + 1}).png`,
          data: new Uint8Array(await (await fetch(it.dataUrl)).arrayBuffer()),
        })),
      );
      blob = buildZip(files);
    } else {
      blob = await (await fetch(picked[0]!.dataUrl)).blob();
    }
    const ws = await handle.createWritable();
    await ws.write(blob);
    await ws.close();
    finishSave(
      multi
        ? t('savedMulti', picked.length, base)
        : t('savedOne', handle.name),
    );
  } catch (e) {
    toastHide();
    setMsg(t('saveFailed', e instanceof Error ? e.message : String(e)), true);
  }
}

// ---------- 分隔線拖曳 ----------

splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    const rect = appEl.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.right - ev.clientX, 160),
      rect.width * 0.6,
    );
    trayPane.style.flexBasis = `${width}px`;
  };
  const onUp = (ev: PointerEvent) => {
    splitter.releasePointerCapture(ev.pointerId);
    splitter.removeEventListener('pointermove', onMove);
    splitter.removeEventListener('pointerup', onUp);
  };
  splitter.addEventListener('pointermove', onMove);
  splitter.addEventListener('pointerup', onUp);
});

// ---------- 事件繫結 ----------

inpW.addEventListener('change', applyStageSize);
inpH.addEventListener('change', applyStageSize);
// 進入尺寸輸入框時全選文字,直接輸入新值
inpW.addEventListener('focus', () => inpW.select());
inpH.addEventListener('focus', () => inpH.select());
selZoom.addEventListener('change', () => {
  if (selZoom.value === 'auto') setZoomAuto();
  else setZoomManual(Number(selZoom.value) || 1);
});

chkAll.addEventListener('change', () => {
  selectedIds = chkAll.checked ? items.map((i) => i.id) : [];
  renderTray();
});
btnDelete.addEventListener('click', deleteChecked);
btnMerge.addEventListener('click', () => void mergeSelected());
btnSaveSel.addEventListener('click', () => void saveChecked());

window.addEventListener('keydown', (e) => {
  // Ctrl+加減:手動縮放;Ctrl+0:回到自動 fit(都不影響擴充頁本身)
  if (e.ctrlKey && !e.altKey) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      stepZoom(1);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      stepZoom(-1);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      setZoomAuto();
      return;
    }
  }

  if (e.key === 'Escape' && drag) {
    endDrag();
    return;
  }

  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void saveChecked();
  } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.altKey) {
    if (currentUrl) navigate(currentUrl);
  } else if (e.key === 'Delete') {
    deleteChecked();
  }
});

// ---------- 自動化自測(?autotest=1;結果寫進分頁標題供外部讀取) ----------

async function runAutoTest(): Promise<void> {
  const report = (s: string): void => {
    document.title = `WEDTEST ${s}`;
  };
  window.addEventListener('error', (e) => report(`ERR ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    report(`REJ ${String(e.reason)}`),
  );
  report('waiting-frame');
  for (let i = 0; i < 60 && frameState.docH === 0; i++) {
    void sendToFrame({ type: 'wedshot:hello' }).then((res) =>
      applyFrameState(res),
    );
    await sleep(500);
    if (i % 4 === 3) report(`waiting-frame ${i + 1}`);
  }
  if (frameState.docH === 0) {
    report('frame-not-ready(content script 未回報)');
    return;
  }
  report(
    `frame-ok doc=${Math.round(frameState.docW)}x${Math.round(frameState.docH)}`,
  );
  await sleep(2500);

  const inkStats = async (dataUrl: string): Promise<string> => {
    const img = await loadImage(dataUrl);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let ink = 0;
    const colors = new Set<number>();
    for (let y = 0; y < c.height; y += 17) {
      for (let x = 0; x < c.width; x += 17) {
        const i = (y * c.width + x) * 4;
        const r = d[i]!;
        const g = d[i + 1]!;
        const b = d[i + 2]!;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
        n++;
        if (r < 245 || g < 245 || b < 245) ink++;
      }
    }
    return `${img.naturalWidth}x${img.naturalHeight} ink=${Math.round((ink * 100) / n)}% colors=${colors.size}`;
  };

  const rect: Rect = { x: 0, y: 0, w: stageW, h: stageH };

  let topRes = '';
  try {
    const d = await debuggerCapture(rect);
    topRes = d ? `ok ${await inkStats(d)}` : 'null';
  } catch (e) {
    topRes = `err:${e instanceof Error ? e.message : e}`;
  }
  report(`top[${topRes}]`);

  // 捲到深處再拍同一個版面位置(WYSIWYG:應拍到捲動後、且 sticky 已隱藏的內容)
  let deepRes = '';
  try {
    await sendToFrame({ type: 'wedshot:scrollto', x: 0, y: 3000 });
    await sleep(1000);
    const d = await debuggerCapture(rect);
    deepRes = d ? `ok ${await inkStats(d)}` : 'null';
    await sendToFrame({ type: 'wedshot:scrollto', x: 0, y: 0 });
  } catch (e) {
    deepRes = `err:${e instanceof Error ? e.message : e}`;
  }
  report(`top[${topRes}] deep[${deepRes}]`);
}

// ---------- 啟動 ----------

async function init(): Promise<void> {
  applyI18n();
  tray.dataset['empty'] = t('emptyHint');
  loadPrefs();
  applyStageSize();
  stageScroll.classList.add('is-selecting'); // 灰色區永遠是框選起手區
  renderTray();

  try {
    await setupFrameRules();
  } catch (e) {
    setMsg(
      t('errFrameRules', e instanceof Error ? e.message : String(e)),
      true,
    );
  }

  // 開頁就先附加 debugger:提示列(若有)一開始就佔好位置,
  // 之後擷取時版面完全不動
  try {
    await ensureDbgAttached();
  } catch {
    /* 附加失敗時,首次擷取會再自動重試 */
  }

  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  if (url) navigate(url);
  if (params.get('autotest')) void runAutoTest();
  if (params.get('devhook')) {
    // 外部驅動用(CDP Runtime.evaluate):指定縮放後擷取整個畫面
    (window as unknown as Record<string, unknown>).__wedshot = {
      capture: async (z: number | 'auto'): Promise<string | null> => {
        if (z === 'auto') zoomMode = 'auto';
        else {
          zoomMode = 'manual';
          zoom = z;
        }
        applyStageSize();
        await sleep(800);
        return debuggerCapture({ x: 0, y: 0, w: stageW, h: stageH });
      },
      info: () => ({
        zoom,
        dpr: window.devicePixelRatio,
        stageW,
        stageH,
        frameY: frameState.y,
        stage: stage.getBoundingClientRect().toJSON() as DOMRect,
        dragging: !!drag,
      }),
    };
  }
}

void init();
