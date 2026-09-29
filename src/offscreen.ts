import { isExtensionMessage } from './lib/messages';

// Offscreen documents never have focus, so navigator.clipboard is unusable here; execCommand still works.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: { ok: boolean }) => void) => {
  if (!isExtensionMessage(message) || message.type !== 'offscreen-copy') {
    return false;
  }
  const textarea = document.querySelector('textarea');
  if (!textarea) {
    sendResponse({ ok: false });
    return false;
  }
  textarea.value = message.text;
  textarea.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard API available without focus
  const ok = document.execCommand('copy');
  textarea.value = '';
  sendResponse({ ok });
  return false;
});
