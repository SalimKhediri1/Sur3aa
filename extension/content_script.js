const DOWNLOAD_ENDPOINT = 'http://localhost:3333/download';
const STATUS_ENDPOINT = 'http://localhost:3333/download/status';
const FORMATS_ENDPOINT = 'http://localhost:3333/download/formats';
const PICK_FOLDER_ENDPOINT = 'http://localhost:3333/download/pick-folder';

// Guards against firing a second download while one is already running
let downloadInProgress = false;

// Per-page format cache so the panel can open instantly with real formats
let cachedFormats = null;
let formatsLoading = false;
// Tracks which URL the in-flight prefetch is for — used to discard stale results
let prefetchingForUrl = null;

// Single source of truth for the injected progress panel: jobId -> job data.
// progressPollInterval holds the poll loop so it can be cleared when idle.
const activeJobs = {};
let progressPollInterval = null;

// Static format list — yt-dlp resolves the best match at download time
const STATIC_FORMATS = [
  { format_id: 'bestvideo[height<=2160]+bestaudio/best', label: '4K (best available)', type: 'video' },
  { format_id: 'bestvideo[height<=1080]+bestaudio/best', label: '1080p', type: 'video' },
  { format_id: 'bestvideo[height<=720]+bestaudio/best',  label: '720p',  type: 'video' },
  { format_id: 'bestvideo[height<=480]+bestaudio/best',  label: '480p',  type: 'video' },
  { format_id: 'bestvideo[height<=360]+bestaudio/best',  label: '360p',  type: 'video' },
  { format_id: 'bestaudio/best', label: 'Audio only (mp3)', type: 'audio' },
];

// Ask the server for the real formats available for this specific video.
// Returns an array of format objects, or null if the server can't be reached.
async function fetchFormats(url) {
  try {
    const res = await fetch(FORMATS_ENDPOINT + '?url=' + encodeURIComponent(url));
    if (!res.ok) return null;
    const data = await res.json();
    return data.formats || null;
  } catch {
    return null;
  }
}

// Placeholder shown in the panel while formats are still being fetched
function showLoadingState(contentDiv) {
  contentDiv.innerHTML = '';
  const msg = document.createElement('div');
  msg.textContent = 'Loading formats…';
  msg.style.color = '#888';
  msg.style.fontSize = '13px';
  msg.style.padding = '8px 4px';
  contentDiv.appendChild(msg);
}

// Fetch formats ahead of the user clicking, so the panel opens instantly.
// Stores the URL being fetched so results from a previous video are discarded
// if the user navigated away before the fetch finished.
async function prefetchFormats(url) {
  prefetchingForUrl = url;
  formatsLoading = true;
  const formats = await fetchFormats(url);
  // Navigation happened while this was in flight — throw the result away
  if (prefetchingForUrl !== url) return;
  if (formats) cachedFormats = formats;
  formatsLoading = false;
}

function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'sur3aa-panel';
  panel.style.position = 'fixed';
  panel.style.bottom = '80px';
  panel.style.right = '24px';
  panel.style.width = '240px';
  panel.style.background = '#1C2033';
  panel.style.border = '1px solid #8B0000';
  panel.style.borderRadius = '10px';
  panel.style.padding = '14px';
  panel.style.zIndex = '9999';
  panel.style.fontFamily = 'sans-serif';
  panel.style.fontSize = '13px';

  const header = document.createElement('div');
  header.textContent = 'Choose format';
  header.style.fontSize = '13px';
  header.style.fontWeight = '500';
  header.style.color = '#FF4444';
  header.style.marginBottom = '10px';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#FF4444';
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

// Convert seconds to HH:MM:SS string
function secondsToTimecode(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

// Dual-handle range slider for choosing a video segment.
// Returns { wrapper, getStartTime(), getEndTime() }.
// getStartTime/getEndTime return an HH:MM:SS string, or '' when at the boundary
// (meaning "no trim" — download the full video).
function createRangeSlider(duration) {
  // Inject thumb styles once per page so YouTube's global CSS doesn't clobber them
  if (!document.getElementById('sur3aa-slider-styles')) {
    const style = document.createElement('style');
    style.id = 'sur3aa-slider-styles';
    style.textContent = [
      '.sur3aa-range{-webkit-appearance:none;appearance:none;position:absolute;',
      'left:0;width:100%;height:4px;background:transparent;pointer-events:none;outline:none;}',
      '.sur3aa-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;',
      'width:14px;height:14px;background:#FF4444;border-radius:50%;',
      'cursor:pointer;pointer-events:auto;border:none;}',
      '.sur3aa-range::-moz-range-thumb{width:14px;height:14px;background:#FF4444;',
      'border-radius:50%;cursor:pointer;pointer-events:auto;border:none;box-sizing:border-box;}',
    ].join('');
    document.head.appendChild(style);
  }

  const max = Math.floor(duration);

  const wrapper = document.createElement('div');
  wrapper.style.marginBottom = '10px';

  // Time labels — start on the left, end on the right
  const timeRow = document.createElement('div');
  timeRow.style.display = 'flex';
  timeRow.style.justifyContent = 'space-between';
  timeRow.style.fontSize = '11px';
  timeRow.style.color = '#aaa';
  timeRow.style.marginBottom = '6px';

  const startLabel = document.createElement('span');
  startLabel.textContent = '00:00:00';
  const endLabel = document.createElement('span');
  endLabel.textContent = secondsToTimecode(max);

  timeRow.appendChild(startLabel);
  timeRow.appendChild(endLabel);

  // Track container — must be relative so the absolute inputs stack inside it
  const trackContainer = document.createElement('div');
  trackContainer.style.position = 'relative';
  trackContainer.style.height = '20px';
  trackContainer.style.display = 'flex';
  trackContainer.style.alignItems = 'center';

  const track = document.createElement('div');
  track.style.position = 'absolute';
  track.style.left = '0';
  track.style.right = '0';
  track.style.height = '4px';
  track.style.background = 'rgba(255,255,255,0.1)';
  track.style.borderRadius = '2px';

  // Red fill between the two handles
  const fill = document.createElement('div');
  fill.style.position = 'absolute';
  fill.style.height = '4px';
  fill.style.background = '#CC0000';
  fill.style.borderRadius = '2px';

  const startInput = document.createElement('input');
  startInput.type = 'range';
  startInput.className = 'sur3aa-range';
  startInput.min = 0;
  startInput.max = max;
  startInput.value = 0;

  const endInput = document.createElement('input');
  endInput.type = 'range';
  endInput.className = 'sur3aa-range';
  endInput.min = 0;
  endInput.max = max;
  endInput.value = max;

  function updateFill() {
    const s = parseInt(startInput.value);
    const e = parseInt(endInput.value);
    fill.style.left = (s / max * 100) + '%';
    fill.style.width = ((e - s) / max * 100) + '%';
    startLabel.textContent = secondsToTimecode(s);
    endLabel.textContent = secondsToTimecode(e);
    // Keep the rightmost handle on top so it stays reachable
    startInput.style.zIndex = s >= e ? '3' : '2';
    endInput.style.zIndex = e >= s ? '3' : '2';
  }

  startInput.addEventListener('input', () => {
    if (parseInt(startInput.value) >= parseInt(endInput.value)) {
      startInput.value = Math.max(0, parseInt(endInput.value) - 1);
    }
    updateFill();
  });

  endInput.addEventListener('input', () => {
    if (parseInt(endInput.value) <= parseInt(startInput.value)) {
      endInput.value = Math.min(max, parseInt(startInput.value) + 1);
    }
    updateFill();
  });

  updateFill();

  trackContainer.appendChild(track);
  trackContainer.appendChild(fill);
  trackContainer.appendChild(startInput);
  trackContainer.appendChild(endInput);

  wrapper.appendChild(timeRow);
  wrapper.appendChild(trackContainer);

  return {
    wrapper,
    // Return '' when at the natural boundary — the server skips --download-sections
    getStartTime: () => {
      const s = parseInt(startInput.value);
      return s > 0 ? secondsToTimecode(s) : '';
    },
    getEndTime: () => {
      const e = parseInt(endInput.value);
      return e < max ? secondsToTimecode(e) : '';
    },
  };
}

function showFormats(contentDiv, formats) {
  contentDiv.innerHTML = '';

  // Try to read the video duration so the slider knows its range
  const video = document.querySelector('video');
  const duration = video && isFinite(video.duration) && video.duration > 0 ? video.duration : null;

  // Slider only shown when we know the video length
  const slider = duration ? createRangeSlider(duration) : null;
  if (slider) contentDiv.appendChild(slider.wrapper);

  formats.forEach((format) => {
    const btn = document.createElement('button');
    btn.textContent = format.label;
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.style.background = 'rgba(204,0,0,0.12)';
    btn.style.border = '1px solid rgba(204,0,0,0.35)';
    btn.style.borderRadius = '6px';
    btn.style.color = '#FFAAAA';
    btn.style.fontSize = '13px';
    btn.style.padding = '7px 10px';
    btn.style.marginBottom = '6px';
    btn.style.cursor = 'pointer';
    btn.style.textAlign = 'left';
    btn.style.fontFamily = 'sans-serif';
    // The audio-only option gets a brighter red accent to stand out
    if (format.type === 'audio') {
      btn.style.borderColor = '#CC0000';
      btn.style.color = '#FF4444';
    }
    btn.addEventListener('click', async () => {
      // Read slider values before the panel is removed
      const startTime = slider ? slider.getStartTime() : '';
      const endTime = slider ? slider.getEndTime() : '';

      document.getElementById('sur3aa-panel')?.remove();

      // Disable the button while the native picker is open so a second
      // download can't be started at the same time
      const btn = document.getElementById('sur3aa-btn');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.45';
        btn.style.cursor = 'not-allowed';
      }

      const outputPath = await pickFolder();

      // User cancelled the picker — restore the button silently
      if (outputPath === null) {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
        }
        return;
      }

      // Server unreachable or zenity failed — show a visible error
      if (outputPath === false) {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
        }
        showStatus('✗ Server not running', 'failed');
        setTimeout(clearStatus, 4000);
        return;
      }

      triggerDownload(format, outputPath, startTime, endTime);
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
    el.style.background = 'rgba(204,0,0,0.15)';
    el.style.color = '#FF4444';
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
    } else if (data.status === 'cancelled') {
      // User cancelled — remove the inline status badge right away
      clearStatus();
      onEnd();
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
  btn.style.background = '#CC0000';
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
    const contentDiv = document.getElementById('sur3aa-panel-content');

    // Use prefetched formats if ready; otherwise fetch now, falling back to static
    if (cachedFormats) {
      showFormats(contentDiv, cachedFormats);
    } else {
      showLoadingState(contentDiv);
      fetchFormats(window.location.href).then((formats) => {
        if (formats) {
          cachedFormats = formats;
          showFormats(contentDiv, formats);
        } else {
          showFormats(contentDiv, STATIC_FORMATS);
        }
      });
    }
  });

  const target = document.querySelector('#above-the-fold #top-row');
  if (!target) {
    console.log('[Sur3aa] could not find injection target');
    return;
  }
  target.appendChild(btn);
}

// Shorten a YouTube URL to a readable label (mirrors popup.js)
function progressExtractTitle(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get('v');
    if (videoId) return 'youtu.be/' + videoId;
  } catch {
    // fall through to truncation
  }
  return url.length > 40 ? url.slice(0, 40) : url;
}

// Human-readable badge text per job status
const PROGRESS_STATUS_LABELS = {
  pending: 'Downloading',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Builds and returns the persistent progress panel element
function createProgressPanel() {
  const panel = document.createElement('div');
  panel.id = 'sur3aa-progress-panel';
  panel.style.position = 'fixed';
  panel.style.bottom = '24px';
  panel.style.right = '24px';
  panel.style.width = '300px';
  panel.style.zIndex = '10000';
  panel.style.background = '#1C2033';
  panel.style.border = '1px solid #8B0000';
  panel.style.borderRadius = '10px';
  panel.style.fontFamily = 'sans-serif';
  panel.style.fontSize = '13px';
  panel.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '10px 14px';
  header.style.borderBottom = '1px solid rgba(139,0,0,0.4)';
  header.style.color = '#FF4444';
  header.style.fontWeight = '500';
  header.style.fontSize = '13px';

  const title = document.createElement('span');
  title.textContent = 'Sur3aa — Downloads';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#FF4444';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '13px';
  closeBtn.style.opacity = '0.6';
  // Closing cleanly stops all polling and clears the panel's state
  closeBtn.addEventListener('click', () => {
    panel.remove();
    clearInterval(progressPollInterval);
    progressPollInterval = null;
    for (const id in activeJobs) delete activeJobs[id];
  });

  header.appendChild(title);
  header.appendChild(closeBtn);

  const content = document.createElement('div');
  content.id = 'sur3aa-progress-content';
  content.style.padding = '10px 14px';

  panel.appendChild(header);
  panel.appendChild(content);
  return panel;
}

// Re-renders the panel body from activeJobs
function renderProgressPanel() {
  const content = document.getElementById('sur3aa-progress-content');
  if (!content) return;
  content.innerHTML = '';

  Object.keys(activeJobs).forEach((jobId) => {
    const job = activeJobs[jobId];

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '10px';

    // Top row: title + status badge
    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.justifyContent = 'space-between';
    top.style.marginBottom = '5px';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = progressExtractTitle(job.url);
    titleSpan.style.fontSize = '11px';
    titleSpan.style.color = '#aaa';
    titleSpan.style.overflow = 'hidden';
    titleSpan.style.textOverflow = 'ellipsis';
    titleSpan.style.whiteSpace = 'nowrap';
    titleSpan.style.maxWidth = '180px';

    const badge = document.createElement('span');
    badge.textContent = PROGRESS_STATUS_LABELS[job.status] || job.status;
    badge.style.fontSize = '11px';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '10px';
    if (job.status === 'pending') {
      badge.style.background = 'rgba(204,0,0,0.2)';
      badge.style.color = '#FF4444';
    } else if (job.status === 'done') {
      badge.style.background = 'rgba(0,200,100,0.15)';
      badge.style.color = '#86efac';
    } else if (job.status === 'failed') {
      badge.style.background = 'rgba(239,68,68,0.15)';
      badge.style.color = '#fca5a5';
    } else if (job.status === 'cancelled') {
      badge.style.background = 'rgba(100,100,100,0.2)';
      badge.style.color = '#aaa';
    }

    top.appendChild(titleSpan);
    top.appendChild(badge);

    // Progress bar
    const barBg = document.createElement('div');
    barBg.style.height = '4px';
    barBg.style.background = 'rgba(255,255,255,0.1)';
    barBg.style.borderRadius = '2px';
    barBg.style.marginBottom = '5px';
    barBg.style.overflow = 'hidden';

    const fill = document.createElement('div');
    fill.style.height = '100%';
    fill.style.background = '#CC0000';
    fill.style.borderRadius = '2px';
    fill.style.width = (job.percent || 0) + '%';
    barBg.appendChild(fill);

    // Bottom row: detail text + cancel button (pending only)
    const bottom = document.createElement('div');
    bottom.style.display = 'flex';
    bottom.style.justifyContent = 'space-between';
    bottom.style.alignItems = 'center';

    const detail = document.createElement('span');
    detail.style.fontSize = '11px';
    detail.style.color = '#888';
    detail.textContent = job.status === 'pending'
      ? `${job.percent || 0}% · ${job.speed || '—'} · ETA ${job.eta || '—'}`
      : '';
    bottom.appendChild(detail);

    if (job.status === 'pending') {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.background = 'none';
      cancelBtn.style.border = '1px solid #8B0000';
      cancelBtn.style.borderRadius = '4px';
      cancelBtn.style.color = '#FF4444';
      cancelBtn.style.fontSize = '11px';
      cancelBtn.style.padding = '2px 8px';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.fontFamily = 'sans-serif';
      cancelBtn.addEventListener('click', () => cancelDownload(jobId));
      bottom.appendChild(cancelBtn);
    }

    wrapper.appendChild(top);
    wrapper.appendChild(barBg);
    wrapper.appendChild(bottom);
    content.appendChild(wrapper);
  });
}

// Asks the server to cancel a job, then refreshes the panel
async function cancelDownload(jobId) {
  try {
    await fetch('http://localhost:3333/download/' + jobId, { method: 'DELETE' });
  } catch {
    // ignore — the poll below reflects whatever state the server reports
  }
  pollProgressPanel();
}

// Ensures exactly one progress panel is present in the page
function ensureProgressPanel() {
  if (!document.getElementById('sur3aa-progress-panel')) {
    document.body.appendChild(createProgressPanel());
  }
}

// Polls the server's job list, updates activeJobs, and re-renders.
// Stops polling and clears the panel once every job is in a terminal state.
async function pollProgressPanel() {
  let data;
  try {
    const res = await fetch('http://localhost:3333/download/jobs');
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }

  (data.jobs || []).forEach((job) => {
    activeJobs[job.jobId] = job;
  });
  renderProgressPanel();

  const ids = Object.keys(activeJobs);
  const allTerminal = ids.length > 0 && ids.every((id) => {
    const s = activeJobs[id].status;
    return s === 'done' || s === 'failed' || s === 'cancelled';
  });
  if (allTerminal) {
    clearInterval(progressPollInterval);
    progressPollInterval = null;
    setTimeout(() => {
      document.getElementById('sur3aa-progress-panel')?.remove();
      for (const id in activeJobs) delete activeJobs[id];
    }, 5000);
  }
}

// Asks the server to open a native folder picker.
// Returns the chosen path string on success, null if the user cancelled, or
// false if the server could not be reached / zenity failed.
async function pickFolder() {
  try {
    const res = await fetch(PICK_FOLDER_ENDPOINT);
    if (res.status === 204) return null;  // user cancelled in zenity
    if (!res.ok) return false;            // zenity or server error
    const data = await res.json();
    return data.path || false;
  } catch {
    // network error — server is probably not running
    return false;
  }
}

async function triggerDownload(format, outputPath = null, startTime = '', endTime = '') {
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
      body: JSON.stringify({ url, format, outputPath, startTime, endTime }),
    });
    if (res.ok) {
      const { jobId } = await res.json();
      showStatus('⏳ Downloading...', 'pending');

      // Seed and show the injected progress panel for this job
      activeJobs[jobId] = { jobId, status: 'pending', percent: 0, speed: null, eta: null, url: window.location.href };
      ensureProgressPanel();
      renderProgressPanel();
      if (!progressPollInterval) {
        progressPollInterval = setInterval(pollProgressPanel, 2000);
      }

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
  // Invalidate any previous video's cache and cancel the in-flight prefetch
  cachedFormats = null;
  formatsLoading = false;
  prefetchingForUrl = null;
  prefetchFormats(window.location.href);

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
    // Drop cached formats and cancel any in-flight prefetch
    cachedFormats = null;
    formatsLoading = false;
    prefetchingForUrl = null;
    // Tear down the progress panel and its poll loop, but keep activeJobs
    // in memory so a return navigation can re-render if needed
    clearInterval(progressPollInterval);
    progressPollInterval = null;
    const panel = document.getElementById('sur3aa-progress-panel');
    if (panel) panel.remove();
  }
});
