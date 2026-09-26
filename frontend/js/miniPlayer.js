/* Injected into Jellyfin by the webOS wrapper. */
(function () {
    'use strict';

    var miniPlayer = null;
    var miniVideo = null;
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

    function closeMiniPlayer() {
        var wasOpen = !!miniVideo;
        if (miniVideo) {
            miniVideo.pause();
            miniVideo.removeAttribute('src');
            miniVideo.load();
            if (miniVideo.parentNode) {
                miniVideo.parentNode.removeChild(miniVideo);
            }
            miniVideo = null;
        }
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
        miniPlayer.style.cssText = 'position:fixed;top:2%;right:2%;width:36vw;height:20.25vw;max-height:36vh;z-index:2147483646;background:#000;border:2px solid rgba(255,255,255,.8);border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.7);overflow:hidden;display:none;';

        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close mini-player');
        closeButton.textContent = '×';
        closeButton.style.cssText = 'position:absolute;top:4px;right:6px;z-index:2;width:42px;height:42px;border:0;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;font-size:30px;line-height:38px;cursor:pointer;';
        closeButton.onclick = function () {
            closeMiniPlayer();
            report('closed by user');
        };

        miniPlayer.appendChild(closeButton);
        document.body.appendChild(miniPlayer);
        return miniPlayer;
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
        var startTicks = Math.floor(startSeconds * 10000000);
        var streamUrl = '/Videos/' + encodeURIComponent(itemId) + '/stream.mp4' +
            '?VideoCodec=h264&AudioCodec=aac&MaxWidth=640&api_key=' + encodeURIComponent(token) +
            '&StartTimeTicks=' + startTicks;

        closeMiniPlayer();
        var player = createMiniPlayer();
        var nextVideo = document.createElement('video');
        nextVideo.className = 'webos-mini-player-video';
        nextVideo.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;';
        nextVideo.setAttribute('playsinline', '');
        nextVideo.setAttribute('webkit-playsinline', '');
        nextVideo.autoplay = false;
        nextVideo.controls = true;
        nextVideo.src = streamUrl;
        nextVideo.onplaying = function () {
            if (miniVideo === nextVideo) {
                report('playing mini-player from ' + Math.floor(startSeconds) + 's');
            }
        };
        nextVideo.onerror = function () {
            if (miniVideo === nextVideo) {
                report('mini-player stream failed; media error=' + (nextVideo.error ? nextVideo.error.code : 'unknown'));
            }
        };
        nextVideo.onended = function () {
            if (miniVideo === nextVideo) {
                closeMiniPlayer();
                report('video ended');
            }
        };

        miniVideo = nextVideo;
        player.insertBefore(nextVideo, player.firstChild);
        player.style.display = 'block';
        var openedEvent = document.createEvent('Event');
        openedEvent.initEvent('webos-mini-player-opened', false, false);
        document.dispatchEvent(openedEvent);
        report('Back: opening stream from ' + Math.floor(startSeconds) + 's');
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
        }, 350);
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
