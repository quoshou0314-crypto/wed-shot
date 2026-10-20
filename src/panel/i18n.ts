// 多語系:字串放在 public/_locales/<locale>/messages.json,由 Chrome 依瀏覽器語言挑選
// 訊息內以 {0}、{1}… 代入參數(不用 Chrome 的 $1 placeholder,免得每則都要宣告)

export function t(key: string, ...subs: (string | number)[]): string {
  const raw = globalThis.chrome?.i18n?.getMessage(key) || key;
  return raw.replace(/\{(\d)\}/g, (_, i: string) => String(subs[Number(i)] ?? ''));
}

/** 套用 HTML 上的 data-i18n(文字)、data-i18n-title、data-i18n-aria */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset['i18n']!);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset['i18nTitle']!);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset['i18nAria']!));
  }
  const lang = globalThis.chrome?.i18n?.getUILanguage();
  if (lang) document.documentElement.lang = lang;
}
