const DOWNLOAD_ENDPOINT = 'http://localhost:3333/download';
const STATUS_ENDPOINT = 'http://localhost:3333/download/status';

// Static format list — yt-dlp resolves the best match at download time
const STATIC_FORMATS = [
  { format_id: 'bestvideo[height<=2160]+bestaudio/best', label: '4K (best available)', type: 'video' },
  { format_id: 'bestvideo[height<=1080]+bestaudio/best', label: '1080p', type: 'video' },
  { format_id: 'bestvideo[height<=720]+bestaudio/best',  label: '720p',  type: 'video' },
  { format_id: 'bestvideo[height<=480]+bestaudio/best',  label: '480p',  type: 'video' },
  { format_id: 'bestvideo[height<=360]+bestaudio/best',  label: '360p',  type: 'video' },
  { format_id: 'bestaudio/best', label: 'Audio only (mp3)', type: 'audio' },
];

function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'sur3aa-panel';
  panel.style.position = 'fixed';
  panel.style.bottom = '80px';
  panel.style.right = '24px';
  panel.style.width = '280px';
  panel.style.background = '#1a1a1a';
  panel.style.color = '#ffffff';
  panel.style.borderRadius = '8px';
  panel.style.padding = '16px';
  panel.style.zIndex = '9999';
  panel.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
  panel.style.fontFamily = 'sans-serif';
  panel.style.fontSize = '14px';

  const header = document.createElement('div');
  header.textContent = 'Sur3aa — Choose format';
  header.style.fontWeight = 'bold';
  header.style.marginBottom = '12px';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.float = 'right';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#ffffff';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '14px';
  closeBtn.addEventListener('click', () => panel.remove());

  const content = document.createElement('div');
  content.id = 'sur3aa-panel-content';

  header.prepend(closeBtn);
  panel.appendChild(header);
  panel.appendChild(content);
  return panel;
}

function showFormats(contentDiv, formats) {
  contentDiv.innerHTML = '';
  formats.forEach((format) => {
    const btn = document.createElement('button');
    btn.textContent = format.label;
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.style.marginBottom = '8px';
    btn.style.padding = '8px';
    btn.style.background = '#333333';
    btn.style.color = '#ffffff';
    btn.style.border = 'none';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.textAlign = 'left';
    btn.addEventListener('click', () => {
      triggerDownload(format);
      document.getElementById('sur3aa-panel')?.remove();
    });
    contentDiv.appendChild(btn);
  });
}

function showStatus(message, type) {
  let el = document.getElementById('sur3aa-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sur3aa-status';
    el.style.fontSize = '12px';
    el.style.marginLeft = '8px';
    el.style.fontFamily = 'sans-serif';
    // Insert immediately after the Sur3aa button
    const btn = document.getElementById('sur3aa-btn');
    if (btn && btn.parentNode) {
      btn.parentNode.insertBefore(el, btn.nextSibling);
    }
  }
  el.textContent = message;
  el.style.color = type === 'done' ? '#00cc66' : type === 'failed' ? '#ff6b6b' : '#aaaaaa';
}

function clearStatus() {
  document.getElementById('sur3aa-status')?.remove();
}

async function pollStatus(jobId) {
  let polls = 0;
  const MAX_POLLS = 60;

  async function tick() {
    if (polls >= MAX_POLLS) {
      showStatus('✗ Timed out', 'failed');
      return;
    }
    polls++;

    let data;
    try {
      const res = await fetch(STATUS_ENDPOINT + '/' + jobId);
      if (!res.ok) {
        showStatus('✗ Could not reach server', 'failed');
        return;
      }
      data = await res.json();
    } catch {
      showStatus('✗ Could not reach server', 'failed');
      return;
    }

    if (data.status === 'pending') {
      showStatus('⏳ Downloading...', 'pending');
      setTimeout(tick, 2000);
    } else if (data.status === 'done') {
      showStatus('✓ Done', 'done');
      setTimeout(clearStatus, 5000);
    } else if (data.status === 'failed') {
      showStatus('✗ Failed', 'failed');
      setTimeout(clearStatus, 5000);
    }
  }

  tick();
}

function injectButton() {
  if (document.getElementById('sur3aa-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'sur3aa-btn';
  btn.textContent = '⬇ Sur3aa';
  btn.style.marginLeft = '8px';
  btn.style.padding = '6px 12px';
  btn.style.background = '#ff0000';
  btn.style.color = '#ffffff';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '13px';
  btn.style.fontWeight = 'bold';

  btn.addEventListener('click', () => {
    const existing = document.getElementById('sur3aa-panel');
    if (existing) {
      existing.remove();
      return;
    }
    const panel = createPanel();
    document.body.appendChild(panel);
    showFormats(document.getElementById('sur3aa-panel-content'), STATIC_FORMATS);
  });

  const target = document.querySelector('#above-the-fold #top-row');
  if (!target) {
    console.log('[Sur3aa] could not find injection target');
    return;
  }
  target.appendChild(btn);
}

async function triggerDownload(format) {
  const url = window.location.href;
  console.log('[Sur3aa] sending download request for:', url);
  try {
    const res = await fetch(DOWNLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format }),
    });
    if (res.ok) {
      const { jobId } = await res.json();
      showStatus('⏳ Downloading...', 'pending');
      pollStatus(jobId);
    } else {
      showStatus('✗ Server error', 'failed');
    }
  } catch {
    showStatus('✗ Could not reach server', 'failed');
  }
}

function onVideoPage() {
  console.log('[Sur3aa] video page detected:', window.location.href);

  injectButton();

  // YouTube renders lazily — retry injection on DOM mutations until it succeeds
  const observer = new MutationObserver(function () {
    if (!document.getElementById('sur3aa-btn')) {
      const target = document.querySelector('#above-the-fold #top-row');
      if (target) injectButton();
    }
    if (document.getElementById('sur3aa-btn')) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (window.location.href.includes('/watch')) {
  onVideoPage();
}

// YouTube is a single-page app — navigating between pages does not reload the
// extension, so we listen for YouTube's internal navigation event instead
window.addEventListener('yt-navigate-finish', function () {
  if (window.location.href.includes('/watch')) {
    onVideoPage();
  } else {
    document.getElementById('sur3aa-btn')?.remove();
    document.getElementById('sur3aa-panel')?.remove();
    clearStatus();
  }
});
