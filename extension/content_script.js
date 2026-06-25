// Called whenever we confirm the current page is a YouTube video page
function onVideoPage() {
  console.log('[Sur3aa] video page detected:', window.location.href);
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
  }
});
