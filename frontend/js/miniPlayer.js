/*
 * Keeps the active Jellyfin video available in a compact player after leaving
 * the playback view. Injected into the Jellyfin document by the webOS wrapper.
 */
(function () {
    'use strict';

    var miniPlayer = null;
    var activeVideo = null;
    var originalParent = null;
    var originalNextSibling = null;
    var wasInPlayerView = false;
    var restoreTimer = null;

    function isPlayerView() {
        return !!document.querySelector('.videoPlayerContainer, .videoOsdBottom, .videoOsdTop');
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
    }

    function showMiniPlayer(video) {
        rememberVideo(video);
        if (!activeVideo || activeVideo.paused || activeVideo.ended) {
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
    }

    function restoreVideo() {
        if (!activeVideo || !originalParent || !originalParent.isConnected) {
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
    }

    function checkPlaybackView() {
        var inPlayerView = isPlayerView();
        var video = document.querySelector('video');

        if (inPlayerView && video && !video.paused) {
            rememberVideo(video);
            wasInPlayerView = true;
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            return;
        }

        if (wasInPlayerView && !inPlayerView && activeVideo && !activeVideo.paused && !activeVideo.ended) {
            wasInPlayerView = false;
            // Let Jellyfin complete its view transition before moving the video.
            restoreTimer = setTimeout(function () {
                restoreTimer = null;
                if (!isPlayerView() && activeVideo && !activeVideo.paused && !activeVideo.ended) {
                    showMiniPlayer(activeVideo);
                }
            }, 150);
        }

        if (inPlayerView && miniPlayer && miniPlayer.style.display !== 'none') {
            restoreVideo();
            wasInPlayerView = true;
        }
    }

    var observer = new MutationObserver(checkPlaybackView);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', checkPlaybackView, true);
    document.addEventListener('pause', checkPlaybackView, true);
    window.addEventListener('hashchange', checkPlaybackView);
    window.addEventListener('popstate', checkPlaybackView);
    setInterval(checkPlaybackView, 500);
})();
