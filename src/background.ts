// 點擊網址列旁的擴充功能圖示 → 開啟截圖工作頁,並帶入目前分頁的網址
chrome.action.onClicked.addListener((tab) => {
  const url = tab.url && /^https?:/i.test(tab.url) ? tab.url : '';
  const page =
    chrome.runtime.getURL('panel.html') +
    (url ? `?url=${encodeURIComponent(url)}` : '');
  void chrome.tabs.create({
    url: page,
    index: tab.index + 1,
  });
});
