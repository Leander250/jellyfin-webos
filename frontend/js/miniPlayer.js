/* Injected into Jellyfin by the webOS wrapper. */
(function () {
    'use strict';

    var miniPlayer = null;
    var activeVideo = null;
    var originalParent = null;
    var originalNextSibling = null;
    var wasInPlayerView = false;
    var restoreTimer = null;
    var lastStatus = '';
    var lastUrl = window.location.href;

    function report(message) {
        if (message === lastStatus) {
            return;
        }
        lastStatus = message;
        console.log('Mini-player: ' + message);
        window.top.postMessage({ type: 'videoPreviewStatus', data: 'Mini-player: ' + message }, '*');
    }

    function isPlayerView() {
        // Jellyfin versions and playback modes use different player wrappers.
        var players = document.querySelectorAll('.videoPlayerContainer, .videoOsdBottom, .videoOsdTop');
        for (var i = 0; i < players.length; i++) {
            if (players[i].offsetWidth && players[i].offsetHeight) {
                return true;
            }
        }
        return false;
    }

    function createMiniPlayer() {
        if (miniPlayer) {
            return miniPlayer;
        }

        miniPlayer = document.createElement('div');
        miniPlayer.id = 'webos-mini-player';
        miniPlayer.style.cssText = 'position:fixed;top:2%;right:2%;width:36vw;height:20.25vw;max-height:36vh;z-index:2147483646;background:#000;border:2px solid rgba(255,255,255,.8);border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.7);overflow:hidden;display:none;';

        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close mini-player');
        closeButton.textContent = '×';
        closeButton.style.cssText = 'position:absolute;top:4px;right:6px;z-index:2;width:42px;height:42px;border:0;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;font-size:30px;line-height:38px;cursor:pointer;';
        closeButton.onclick = function () {
            if (activeVideo) {
                activeVideo.pause();
            }
            restoreVideo();
            miniPlayer.style.display = 'none';
            activeVideo = null;
            report('closed by user');
        };

        miniPlayer.appendChild(closeButton);
        document.body.appendChild(miniPlayer);
        return miniPlayer;
    }

    function rememberVideo(video) {
        if (!video || video === activeVideo) {
            return;
        }
        activeVideo = video;
        originalParent = video.parentNode;
        originalNextSibling = video.nextSibling;
        report('video found; paused=' + video.paused + '; duration=' + video.duration);
    }

    function showMiniPlayer(video) {
        rememberVideo(video);
        if (!activeVideo || activeVideo.paused || activeVideo.ended) {
            report('cannot open: video is paused or ended');
            return;
        }

        var player = createMiniPlayer();
        player.style.display = 'block';
        player.insertBefore(activeVideo, player.firstChild);
        activeVideo.style.setProperty('width', '100%', 'important');
        activeVideo.style.setProperty('height', '100%', 'important');
        activeVideo.style.setProperty('object-fit', 'contain', 'important');
        activeVideo.style.setProperty('position', 'absolute', 'important');
        activeVideo.style.setProperty('inset', '0', 'important');
        activeVideo.style.setProperty('z-index', '1', 'important');
        report('opened; playback continues in top-right mini-player');
    }

    function restoreVideo() {
        if (!activeVideo || !originalParent || !originalParent.isConnected) {
            report('cannot restore video to its original view');
            return;
        }

        activeVideo.style.removeProperty('width');
        activeVideo.style.removeProperty('height');
        activeVideo.style.removeProperty('object-fit');
        activeVideo.style.removeProperty('position');
        activeVideo.style.removeProperty('inset');
        activeVideo.style.removeProperty('z-index');
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
            originalParent.insertBefore(activeVideo, originalNextSibling);
        } else {
            originalParent.appendChild(activeVideo);
        }
        if (miniPlayer) {
            miniPlayer.style.display = 'none';
        }
        activeVideo = null;
        originalParent = null;
        originalNextSibling = null;
        report('returned to playback view');
    }

    function checkPlaybackView() {
        var inPlayerView = isPlayerView();
        var video = document.querySelector('video');
        var playingVideo = video && !video.paused && !video.ended ? video : null;

        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            report('URL changed; playerView=' + inPlayerView + '; video=' + !!video + '; playing=' + !!playingVideo);
        }

        if (inPlayerView && playingVideo) {
            rememberVideo(playingVideo);
            wasInPlayerView = true;
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            return;
        }

        if (wasInPlayerView && !inPlayerView && activeVideo && !activeVideo.paused && !activeVideo.ended) {
            wasInPlayerView = false;
            report('left player view; opening mini-player');
            restoreTimer = setTimeout(function () {
                restoreTimer = null;
                if (!isPlayerView() && activeVideo && !activeVideo.paused && !activeVideo.ended) {
                    showMiniPlayer(activeVideo);
                } else {
                    report('player view returned or video stopped before opening');
                }
            }, 150);
        }

        if (inPlayerView && miniPlayer && miniPlayer.style.display !== 'none') {
            restoreVideo();
            wasInPlayerView = true;
        }
    }

    document.addEventListener('keydown', function (event) {
        if (event.keyCode === 461 || event.key === 'Back') {
            var video = document.querySelector('video');
            report('Back key received; playerView=' + isPlayerView() + '; video=' + !!video + '; playing=' + !!(video && !video.paused));
            setTimeout(checkPlaybackView, 300);
        }
    }, true);
    document.addEventListener('play', checkPlaybackView, true);
    document.addEventListener('pause', checkPlaybackView, true);
    window.addEventListener('hashchange', checkPlaybackView);
    window.addEventListener('popstate', checkPlaybackView);
    new MutationObserver(checkPlaybackView).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(checkPlaybackView, 500);
    report('script loaded; playerView=' + isPlayerView() + '; video=' + !!document.querySelector('video'));
})();
