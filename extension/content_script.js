const DOWNLOAD_ENDPOINT = 'http://localhost:3333/download';
const STATUS_ENDPOINT = 'http://localhost:3333/download/status';

// Guards against firing a second download while one is already running
let downloadInProgress = false;

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
  panel.style.width = '240px';
  panel.style.background = '#1a0f2e';
  panel.style.border = '1px solid #4c1d95';
  panel.style.borderRadius = '10px';
  panel.style.padding = '14px';
  panel.style.zIndex = '9999';
  panel.style.fontFamily = 'sans-serif';
  panel.style.fontSize = '13px';

  const header = document.createElement('div');
  header.textContent = 'Choose format';
  header.style.fontSize = '13px';
  header.style.fontWeight = '500';
  header.style.color = '#c4b5fd';
  header.style.marginBottom = '10px';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#c4b5fd';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '13px';
  closeBtn.style.opacity = '0.5';
  closeBtn.style.lineHeight = '1';
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
    btn.style.background = 'rgba(124,58,237,0.15)';
    btn.style.border = '1px solid rgba(124,58,237,0.3)';
    btn.style.borderRadius = '6px';
    btn.style.color = '#ddd6fe';
    btn.style.fontSize = '13px';
    btn.style.padding = '7px 10px';
    btn.style.marginBottom = '6px';
    btn.style.cursor = 'pointer';
    btn.style.textAlign = 'left';
    btn.style.fontFamily = 'sans-serif';
    // The audio-only option gets a brighter purple accent to stand out
    if (format.type === 'audio') {
      btn.style.borderColor = '#7C3AED';
      btn.style.color = '#a78bfa';
    }
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
    el.style.fontWeight = '500';
    el.style.marginLeft = '10px';
    el.style.fontFamily = 'sans-serif';
    el.style.padding = '4px 10px';
    el.style.borderRadius = '12px';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = '4px';
    // Insert immediately after the Sur3aa button
    const btn = document.getElementById('sur3aa-btn');
    if (btn && btn.parentNode) {
      btn.parentNode.insertBefore(el, btn.nextSibling);
    }
  }
  el.textContent = message;
  if (type === 'pending') {
    el.style.background = 'rgba(124,58,237,0.15)';
    el.style.color = '#c4b5fd';
  }
  if (type === 'done') {
    el.style.background = 'rgba(0,200,100,0.15)';
    el.style.color = '#86efac';
  }
  if (type === 'failed') {
    el.style.background = 'rgba(239,68,68,0.15)';
    el.style.color = '#fca5a5';
  }
}

function clearStatus() {
  document.getElementById('sur3aa-status')?.remove();
}

// onEnd is called on every terminal path so the caller can release its lock
async function pollStatus(jobId, onEnd) {
  let polls = 0;
  const MAX_POLLS = 60;

  async function tick() {
    if (polls >= MAX_POLLS) {
      showStatus('✗ Timed out', 'failed');
      onEnd();
      return;
    }
    polls++;

    let data;
    try {
      const res = await fetch(STATUS_ENDPOINT + '/' + jobId);
      if (!res.ok) {
        showStatus('✗ Could not reach server', 'failed');
        onEnd();
        return;
      }
      data = await res.json();
    } catch {
      showStatus('✗ Could not reach server', 'failed');
      onEnd();
      return;
    }

    if (data.status === 'pending') {
      showStatus('⏳ Downloading...', 'pending');
      setTimeout(tick, 2000);
    } else if (data.status === 'done') {
      showStatus('✓ Done', 'done');
      onEnd();
      setTimeout(clearStatus, 5000);
    } else if (data.status === 'failed') {
      showStatus('✗ Failed', 'failed');
      onEnd();
      setTimeout(clearStatus, 5000);
    }
  }

  tick();
}

function injectButton() {
  // Tabler icon font isn't on YouTube by default — inject it once per page load
  if (!document.getElementById('sur3aa-icons')) {
    const link = document.createElement('link');
    link.id = 'sur3aa-icons';
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css';
    document.head.appendChild(link);
  }

  if (document.getElementById('sur3aa-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'sur3aa-btn';
  btn.style.marginLeft = '10px';
  btn.style.padding = '6px 14px';
  btn.style.background = '#7C3AED';
  btn.style.color = '#ffffff';
  btn.style.border = 'none';
  btn.style.borderRadius = '18px';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '13px';
  btn.style.fontWeight = '500';
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '6px';
  btn.style.fontFamily = 'sans-serif';

  const icon = document.createElement('i');
  icon.className = 'ti ti-download';
  icon.style.fontSize = '14px';
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);
  const label = document.createTextNode('Download');
  btn.appendChild(label);

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
  // Refuse to start a second download while one is still running
  if (downloadInProgress) {
    console.log('[Sur3aa] download already in progress');
    return;
  }
  downloadInProgress = true;

  // Disable the button while the download runs
  const btn = document.getElementById('sur3aa-btn');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.45';
    btn.style.cursor = 'not-allowed';
  }

  // Release the lock and re-enable the button — runs on every terminal path
  function endDownload() {
    downloadInProgress = false;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }

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
      pollStatus(jobId, endDownload);
    } else {
      showStatus('✗ Server error', 'failed');
      endDownload();
    }
  } catch {
    showStatus('✗ Could not reach server', 'failed');
    endDownload();
  }
}

function onVideoPage() {
  console.log('[Sur3aa] video page detected:', window.location.href);

  injectButton();

  // YouTube renders lazily — retry injection on DOM mutations until it succeeds
  let attempts = 0;
  const observer = new MutationObserver(function () {
    attempts++;
    // Give up after 50 mutations so we don't observe forever on non-video pages
    if (attempts > 50) {
      observer.disconnect();
      console.log('[Sur3aa] gave up waiting for injection target');
      return;
    }
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
    // Reset the lock so a mid-download navigation doesn't leave a stuck state
    downloadInProgress = false;
  }
});
