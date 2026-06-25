const DOWNLOAD_ENDPOINT = 'http://localhost:3333/download';

function injectButton() {
  // Avoid injecting a second button if one already exists
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
  btn.addEventListener('click', triggerDownload);

  const target = document.querySelector('#above-the-fold #top-row');
  if (!target) {
    console.log('[Sur3aa] could not find injection target');
    return;
  }
  target.appendChild(btn);
}

async function triggerDownload() {
  const url = window.location.href;
  console.log('[Sur3aa] sending download request for:', url);
  try {
    const res = await fetch(DOWNLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      console.log('[Sur3aa] download started');
    } else {
      console.log('[Sur3aa] server error:', res.status);
    }
  } catch {
    console.log('[Sur3aa] could not reach server — is it running?');
  }
}

function onVideoPage() {
  console.log('[Sur3aa] video page detected:', window.location.href);

  // Try immediately in case the DOM is already ready
  injectButton();

  // YouTube renders lazily — observe mutations until the button is injected
  const observer = new MutationObserver(function () {
    injectButton();
    if (document.getElementById('sur3aa-btn')) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Handle the case where the extension loads directly on a /watch URL
if (window.location.href.includes('/watch')) {
  onVideoPage();
}

// YouTube is a single-page app — navigating between pages does not reload the
// extension, so we listen for YouTube's internal navigation event instead
window.addEventListener('yt-navigate-finish', function () {
  if (window.location.href.includes('/watch')) {
    onVideoPage();
  } else {
    // Remove the button when leaving a video page
    const btn = document.getElementById('sur3aa-btn');
    if (btn) btn.remove();
  }
});
