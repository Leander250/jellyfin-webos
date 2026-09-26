/* Injected into Jellyfin by the webOS wrapper. */
(function () {
    'use strict';

    var miniPlayer = null;
    var miniVideo = null;
    var miniItemId = null;
    var miniToken = null;
    var miniOriginalUrl = null;
    var miniMediaSourceId = null;
    var miniSourceMode = 'mp4';
    var miniDurationSeconds = NaN;
    var miniMetadataRequest = null;
    var miniWatchdog = null;
    var miniRecoveryCount = 0;
    var miniStreamStartSeconds = 0;
    var miniLastProgress = 0;
    var miniLastProgressAt = 0;
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

    function playerVideo() {
        var videos = document.querySelectorAll('video');
        for (var i = 0; i < videos.length; i++) {
            if (videos[i] !== miniVideo && !videos[i].classList.contains('webos-video-preview-player')) {
                return videos[i];
            }
        }
        return null;
    }

    function isPlayerView() {
        var players = document.querySelectorAll('.videoPlayerContainer, .videoOsdBottom, .videoOsdTop');
        for (var i = 0; i < players.length; i++) {
            if (players[i].offsetWidth && players[i].offsetHeight) {
                return true;
            }
        }
        return false;
    }

    function queryValue(url, name) {
        var match = new RegExp('[?&#]' + name + '=([^&#]+)', 'i').exec(url || '');
        return match ? decodeURIComponent(match[1]) : null;
    }

    function getItemId(video) {
        var source = video.currentSrc || video.src || '';
        var match = /\/Videos\/([^/?#]+)/i.exec(source);
        return queryValue(window.location.href, 'itemId') ||
            queryValue(window.location.href, 'id') ||
            (match ? decodeURIComponent(match[1]) : null);
    }

    function getToken(video) {
        var sourceToken = queryValue(video.currentSrc || video.src, 'api_key');
        if (sourceToken) {
            return sourceToken;
        }
        try {
            var credentials = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var servers = credentials.Servers || [];
            for (var i = 0; i < servers.length; i++) {
                if (servers[i].AccessToken &&
                    (!servers[i].ManualAddress || servers[i].ManualAddress === window.location.origin)) {
                    return servers[i].AccessToken;
                }
            }
            return servers.length ? servers[0].AccessToken : null;
        } catch (error) {
            report('could not read Jellyfin credentials');
            return null;
        }
    }

    function releaseMiniVideo() {
        if (miniVideo) {
            var oldVideo = miniVideo;
            miniVideo = null;
            oldVideo.onended = null;
            oldVideo.onerror = null;
            oldVideo.pause();
            oldVideo.removeAttribute('src');
            oldVideo.load();
            if (oldVideo.parentNode) {
                oldVideo.parentNode.removeChild(oldVideo);
            }
        }
    }

    function closeMiniPlayer() {
        var wasOpen = !!miniVideo;
        releaseMiniVideo();
        if (miniMetadataRequest) {
            var pendingRequest = miniMetadataRequest;
            miniMetadataRequest = null;
            pendingRequest.abort();
        }
        if (miniWatchdog) {
            clearInterval(miniWatchdog);
            miniWatchdog = null;
        }
        miniItemId = null;
        miniToken = null;
        miniOriginalUrl = null;
        miniMediaSourceId = null;
        miniSourceMode = 'mp4';
        miniDurationSeconds = NaN;
        miniRecoveryCount = 0;
        if (miniPlayer) {
            miniPlayer.style.display = 'none';
        }
        if (wasOpen) {
            var closedEvent = document.createEvent('Event');
            closedEvent.initEvent('webos-mini-player-closed', false, false);
            document.dispatchEvent(closedEvent);
        }
    }

    function createMiniPlayer() {
        if (miniPlayer) {
            return miniPlayer;
        }

        miniPlayer = document.createElement('div');
        miniPlayer.id = 'webos-mini-player';
        miniPlayer.style.cssText = 'position:fixed;top:2%;right:2%;width:36vw;height:20.25vw;max-height:36vh;z-index:2147483646;pointer-events:none;display:none;';

        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close mini-player');
        closeButton.textContent = '×';
        closeButton.style.cssText = 'position:absolute;top:4px;right:6px;z-index:2;width:42px;height:42px;border:0;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;font-size:30px;line-height:38px;cursor:pointer;pointer-events:auto;';
        closeButton.onclick = function () {
            closeMiniPlayer();
            report('closed by user');
        };

        miniPlayer.appendChild(closeButton);
        document.body.appendChild(miniPlayer);
        return miniPlayer;
    }

    function absolutePosition(video, startSeconds) {
        var position = isFinite(video.currentTime) ? video.currentTime : 0;
        return miniSourceMode === 'mp4' ? startSeconds + position : position;
    }

    function loadItemDuration(itemId, token) {
        var lookup = new XMLHttpRequest();
        miniMetadataRequest = lookup;
        lookup.open('GET', '/Items/' + encodeURIComponent(itemId), true);
        lookup.setRequestHeader('Authorization', 'MediaBrowser Token="' + token + '"');
        lookup.onreadystatechange = function () {
            if (miniMetadataRequest !== lookup || lookup.readyState !== 4) {
                return;
            }
            miniMetadataRequest = null;
            if (lookup.status >= 200 && lookup.status < 300) {
                try {
                    var item = JSON.parse(lookup.responseText);
                    if (miniMediaSourceId === miniItemId && item.MediaSources && item.MediaSources.length) {
                        miniMediaSourceId = item.MediaSources[0].Id;
                    }
                    if (item.RunTimeTicks > 0) {
                        miniDurationSeconds = item.RunTimeTicks / 10000000;
                        report('item duration=' + Math.floor(miniDurationSeconds) + 's');
                        return;
                    }
                } catch (error) {
                    // The mini-player can continue without the item duration.
                }
            }
            report('item duration unavailable; HTTP ' + lookup.status);
        };
        lookup.send();
    }

    function recoverMiniStream(reason, position) {
        if (miniSourceMode === 'mp4') {
            report(reason + '; MP4 stream position cannot be verified for a restart');
            return false;
        }
        if (miniRecoveryCount >= 3 ||
            (isFinite(miniDurationSeconds) && position >= miniDurationSeconds - 5)) {
            report(reason + '; recovery limit or item end reached at ' + Math.floor(position) + 's');
            return false;
        }
        if (position < miniStreamStartSeconds + 2) {
            return fallbackMiniSource(reason + '; seek did not advance', miniStreamStartSeconds);
        }
        miniRecoveryCount++;
        report(reason + '; resuming at ' + Math.floor(position) + 's');
        startMiniStream(position, 350);
        return true;
    }

    function fallbackMiniSource(reason, position) {
        if (miniSourceMode === 'original') {
            miniSourceMode = 'hls';
        } else if (miniSourceMode === 'hls') {
            miniSourceMode = 'mp4';
        } else {
            return false;
        }
        miniRecoveryCount++;
        report(reason + '; trying ' + miniSourceMode + ' at ' + Math.floor(position) + 's');
        startMiniStream(position, 350);
        return true;
    }

    function startMiniStream(startSeconds, delay) {
        releaseMiniVideo();
        miniStreamStartSeconds = startSeconds;
        miniLastProgress = 0;
        miniLastProgressAt = Date.now();
        var startTicks = Math.floor(startSeconds * 10000000);
        var streamUrl;
        if (miniSourceMode === 'original') {
            streamUrl = miniOriginalUrl;
        } else if (miniSourceMode === 'hls') {
            streamUrl = '/Videos/' + encodeURIComponent(miniItemId) + '/master.m3u8' +
                '?VideoCodec=h264&AudioCodec=aac&MaxWidth=640&SegmentContainer=ts&api_key=' +
                encodeURIComponent(miniToken);
            if (miniMediaSourceId) {
                streamUrl += '&MediaSourceId=' + encodeURIComponent(miniMediaSourceId);
            }
        } else {
            streamUrl = '/Videos/' + encodeURIComponent(miniItemId) + '/stream.mp4' +
                '?VideoCodec=h264&AudioCodec=aac&MaxWidth=640&api_key=' + encodeURIComponent(miniToken) +
                '&StartTimeTicks=' + startTicks;
        }
        var player = createMiniPlayer();
        var nextVideo = document.createElement('video');
        nextVideo.className = 'webos-mini-player-video';
        // webOS renders video most reliably when the element is directly on
        // the document, without borders, clipping, or transformed ancestors.
        nextVideo.style.cssText = 'position:fixed;top:2%;right:2%;width:36vw;height:20.25vw;max-height:36vh;z-index:2147483645;background:#000;';
        nextVideo.setAttribute('playsinline', '');
        nextVideo.setAttribute('webkit-playsinline', '');
        nextVideo.autoplay = false;
        nextVideo.controls = true;
        nextVideo.src = streamUrl;
        nextVideo.onloadedmetadata = function () {
            if (miniVideo !== nextVideo || miniSourceMode === 'mp4') {
                return;
            }
            if (isFinite(nextVideo.duration) && nextVideo.duration > 0 &&
                nextVideo.duration + 5 < startSeconds) {
                fallbackMiniSource('source is shorter than the seek position', startSeconds);
                return;
            }
            try {
                nextVideo.currentTime = startSeconds;
            } catch (error) {
                fallbackMiniSource('source could not seek', startSeconds);
            }
        };
        nextVideo.onseeked = function () {
            if (miniVideo === nextVideo && miniSourceMode !== 'mp4') {
                report('seeked to ' + Math.floor(nextVideo.currentTime) + 's');
            }
        };
        nextVideo.onplaying = function () {
            if (miniVideo === nextVideo) {
                miniLastProgressAt = Date.now();
                report('playing ' + miniSourceMode + ' at ' + Math.floor(absolutePosition(nextVideo, startSeconds)) +
                    's (requested ' + Math.floor(startSeconds) + 's); duration=' +
                    (isFinite(nextVideo.duration) ? Math.floor(nextVideo.duration) : 'unknown') + 's');
                if (miniSourceMode !== 'mp4') {
                    setTimeout(function () {
                        if (miniVideo === nextVideo && nextVideo.currentTime < startSeconds - 5) {
                            fallbackMiniSource('source resumed at the wrong time', startSeconds);
                        }
                    }, 4000);
                }
            }
        };
        nextVideo.onwaiting = function () {
            if (miniVideo === nextVideo) {
                report('buffering at ' + Math.floor(absolutePosition(nextVideo, startSeconds)) + 's');
            }
        };
        nextVideo.onstalled = function () {
            if (miniVideo === nextVideo) {
                report('stream stalled at ' + Math.floor(absolutePosition(nextVideo, startSeconds)) + 's');
            }
        };
        nextVideo.onpause = function () {
            if (miniVideo === nextVideo) {
                report('mini-player paused at ' + Math.floor(absolutePosition(nextVideo, startSeconds)) + 's');
            }
        };
        nextVideo.onerror = function () {
            if (miniVideo === nextVideo) {
                var errorCode = nextVideo.error ? nextVideo.error.code : 'unknown';
                var position = absolutePosition(nextVideo, startSeconds);
                report('mini-player media error=' + errorCode + ' at ' + Math.floor(position) + 's');
                if (!fallbackMiniSource('media error ' + errorCode, Math.max(position, startSeconds)) &&
                    !recoverMiniStream('media error ' + errorCode, position)) {
                    closeMiniPlayer();
                    report('mini-player could not recover from media error');
                }
            }
        };
        nextVideo.onended = function () {
            if (miniVideo === nextVideo) {
                var position = absolutePosition(nextVideo, startSeconds);
                if (isFinite(miniDurationSeconds) && position < miniDurationSeconds - 5) {
                    if (recoverMiniStream('stream ended early', position)) {
                        return;
                    }
                    closeMiniPlayer();
                    report('stream ended early at ' + Math.floor(position) + 's');
                    return;
                }
                closeMiniPlayer();
                report('video ended at ' + Math.floor(position) + 's' +
                    (isFinite(miniDurationSeconds) ? ' of ' + Math.floor(miniDurationSeconds) + 's' : ' (item duration unknown)'));
            }
        };

        miniVideo = nextVideo;
        document.body.appendChild(nextVideo);
        player.style.display = 'block';
        // Jellyfin closes its own video in response to Back. Start the new
        // stream after that player has released the TV's video decoder.
        setTimeout(function () {
            if (miniVideo !== nextVideo) {
                return;
            }
            var result = nextVideo.play();
            if (result && typeof result.catch === 'function') {
                result.catch(function (error) {
                    if (miniVideo === nextVideo) {
                        report('mini-player play failed: ' + error.name);
                    }
                });
            }
        }, delay);
    }

    function openMiniPlayer(video) {
        if (!video || video.paused || video.ended) {
            report('Back: no playing video to continue');
            return;
        }

        var itemId = getItemId(video);
        var token = getToken(video);
        if (!itemId || !token) {
            report('Back: cannot start stream; itemId=' + !!itemId + '; token=' + !!token);
            return;
        }

        var startSeconds = isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
        var source = video.currentSrc || video.src || '';
        closeMiniPlayer();
        miniItemId = itemId;
        miniToken = token;
        miniOriginalUrl = /^(https?:\/\/|\/)/i.test(source) ? source : null;
        miniMediaSourceId = queryValue(source, 'MediaSourceId') || itemId;
        miniSourceMode = miniOriginalUrl ? 'original' : 'hls';
        miniDurationSeconds = isFinite(video.duration) && video.duration > 0 ? video.duration : NaN;
        loadItemDuration(itemId, token);
        startMiniStream(startSeconds, 350);
        var openedEvent = document.createEvent('Event');
        openedEvent.initEvent('webos-mini-player-opened', false, false);
        document.dispatchEvent(openedEvent);
        report('Back: opening ' + miniSourceMode + ' from ' + Math.floor(startSeconds) + 's');
        miniWatchdog = setInterval(function () {
            if (!miniVideo || miniVideo.paused || miniVideo.ended) {
                return;
            }
            var current = miniVideo.currentTime;
            if (!isFinite(current)) {
                return;
            }
            if (current > miniLastProgress + 0.5) {
                miniLastProgress = current;
                miniLastProgressAt = Date.now();
            } else if (Date.now() - miniLastProgressAt > 8000) {
                var position = absolutePosition(miniVideo, miniStreamStartSeconds);
                if (!recoverMiniStream('playback stopped advancing', position)) {
                    closeMiniPlayer();
                    report('mini-player could not recover stalled playback');
                }
            }
        }, 2000);
    }

    document.addEventListener('keydown', function (event) {
        if (event.keyCode === 461 || event.key === 'Back') {
            var video = playerVideo();
            report('Back key received; playerView=' + isPlayerView() + '; video=' + !!video + '; playing=' + !!(video && !video.paused));
            if (isPlayerView()) {
                openMiniPlayer(video);
            }
        }
    }, true);

    function checkNavigation() {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            var video = playerVideo();
            report('URL changed; playerView=' + isPlayerView() + '; video=' + !!video + '; mini=' + !!miniVideo);
            if (isPlayerView() && miniVideo) {
                closeMiniPlayer();
                report('returned to playback view');
            }
        }
    }

    window.addEventListener('hashchange', checkNavigation);
    window.addEventListener('popstate', checkNavigation);
    setInterval(checkNavigation, 500);
    report('script loaded; playerView=' + isPlayerView() + '; video=' + !!playerVideo());
})();
