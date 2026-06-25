// Base server URL — all job endpoints live under /download
const SERVER = 'http://localhost:3333';
const POLL_INTERVAL = 2000;

// Turn a full YouTube URL into a short, readable label
function extractTitle(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const videoId = parsed.searchParams.get('v');
    if (videoId) return 'youtu.be/' + videoId;
  } catch {
    // fall through to truncation below
  }
  return url.length > 40 ? url.slice(0, 40) : url;
}

// Human-readable label for each job status
const STATUS_LABELS = {
  pending: 'Downloading',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// Render the list of jobs into #job-list
function renderJobs(jobs) {
  const list = document.getElementById('job-list');

  // Empty state when there are no jobs
  if (!jobs || jobs.length === 0) {
    list.innerHTML = '<div class="empty-state">No active downloads</div>';
    return;
  }

  list.innerHTML = '';
  jobs.forEach((job) => {
    const card = document.createElement('div');
    card.className = 'job-card';

    // Top row: shortened URL + status badge
    const top = document.createElement('div');
    top.className = 'job-top';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'job-url';
    urlSpan.textContent = extractTitle(job.url);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'job-status status-' + job.status;
    statusSpan.textContent = STATUS_LABELS[job.status] || job.status;

    top.appendChild(urlSpan);
    top.appendChild(statusSpan);

    // Progress bar reflecting job.percent
    const barBg = document.createElement('div');
    barBg.className = 'progress-bar-bg';
    const barFill = document.createElement('div');
    barFill.className = 'progress-bar-fill';
    barFill.style.width = (job.percent || 0) + '%';
    barBg.appendChild(barFill);

    // Meta row: progress detail + cancel button
    const meta = document.createElement('div');
    meta.className = 'job-meta';

    const detail = document.createElement('span');
    detail.className = 'job-detail';
    // Only show speed/ETA detail while the download is in progress
    detail.textContent = job.status === 'pending'
      ? `${job.percent || 0}% · ${job.speed || '—'} · ETA ${job.eta || '—'}`
      : '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = 'Cancel';
    // Cancel only applies to pending jobs — hide it otherwise
    if (job.status === 'pending') {
      cancelBtn.addEventListener('click', () => cancelJob(job.jobId));
    } else {
      cancelBtn.style.display = 'none';
    }

    meta.appendChild(detail);
    meta.appendChild(cancelBtn);

    card.appendChild(top);
    card.appendChild(barBg);
    card.appendChild(meta);
    list.appendChild(card);
  });
}

// Ask the server to cancel a download, then refresh immediately
async function cancelJob(jobId) {
  try {
    await fetch(`${SERVER}/download/${jobId}`, { method: 'DELETE' });
  } catch {
    // ignore — refresh below reflects whatever state the server is in
  }
  fetchAndRender();
}

// Fetch the current job list and render it
async function fetchAndRender() {
  try {
    const res = await fetch(`${SERVER}/download/jobs`);
    if (res.ok) {
      const data = await res.json();
      renderJobs(data.jobs);
    }
  } catch {
    document.getElementById('job-list').innerHTML =
      '<div class="empty-state" style="color:#FF4444">Server not running</div>';
  }
}

// Render once on open, then poll on an interval
fetchAndRender();
setInterval(fetchAndRender, POLL_INTERVAL);
