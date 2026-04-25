// Grant content scripts direct read/write access to session storage
chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
});

// Provide tabId to content scripts (sender.tab.id is populated by Chrome)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTabId') {
    if (!sender.tab) {
      sendResponse({ tabId: null });
      return true;
    }
    sendResponse({ tabId: sender.tab.id });
    return true;
  }
});
