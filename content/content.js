// 监听来自 popup 或 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'execute') {
    executeOnPage();
    sendResponse({ success: true });
  }
  return true;
});

// 在页面上执行的操作
function executeOnPage() {
  console.log('[Trade View] 执行操作');
  // 示例：高亮页面上的所有链接
  const links = document.querySelectorAll('a');
  links.forEach((link) => {
    link.style.backgroundColor = 'yellow';
  });
}

// 初始化
function initContentScript() {
  console.log('[Trade View] Content script 已加载');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContentScript);
} else {
  initContentScript();
}
