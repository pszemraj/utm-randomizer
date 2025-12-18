const enableToggle = document.getElementById('enableToggle') as HTMLInputElement;
const urlCountEl = document.getElementById('urlCount') as HTMLElement;
const sessionCountEl = document.getElementById('sessionCount') as HTMLElement;
const statusTextEl = document.getElementById('statusText') as HTMLElement;

async function loadState() {
  const result = await chrome.storage.local.get(['enabled', 'totalCount', 'sessionCount']);

  const enabled = result.enabled !== false; // Default to true
  enableToggle.checked = enabled;
  updateStatusText(enabled);

  urlCountEl.textContent = String(result.totalCount || 0);
  sessionCountEl.textContent = String(result.sessionCount || 0);
}

function updateStatusText(enabled: boolean) {
  if (enabled) {
    statusTextEl.textContent = 'Active and monitoring clipboard';
    statusTextEl.className = 'status-indicator active';
  } else {
    statusTextEl.textContent = 'Paused - URLs will not be modified';
    statusTextEl.className = 'status-indicator inactive';
  }
}

enableToggle.addEventListener('change', async () => {
  const enabled = enableToggle.checked;
  await chrome.storage.local.set({ enabled });
  updateStatusText(enabled);
});

// Listen for storage changes to update stats in real-time
chrome.storage.onChanged.addListener((changes) => {
  if (changes.totalCount) {
    urlCountEl.textContent = String(changes.totalCount.newValue || 0);
  }
  if (changes.sessionCount) {
    sessionCountEl.textContent = String(changes.sessionCount.newValue || 0);
  }
});

loadState();
