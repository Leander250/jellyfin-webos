/*
 * Shows trickplay frames, or a muted video when trickplay is unavailable,
 * after focus settles on a playable media card.
 * This script is injected into the Jellyfin Web iframe by the webOS wrapper.
 */
(function () {
    'use strict';

    var activeCard = null;
    var previewTimer = null;
    var request = null;
    var previewPlayer = null;
    var trickplayCanvas = null;
    var trickplayInterval = null;
    var previewDelay = 1000;
    var previewStartTicks = 2400000000;
    var statusElement = null;

    function setStatus(message) {
        if (!window.WebOSPreviewDebug) {
            return;
        }
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'webos-video-preview-status';
            statusElement.style.position = 'fixed';
            statusElement.style.right = '1em';
            statusElement.style.bottom = '1em';
            statusElement.style.zIndex = '2147483647';
            statusElement.style.maxWidth = '70vw';
            statusElement.style.padding = '0.45em 0.7em';
            statusElement.style.borderRadius = '0.3em';
            statusElement.style.background = 'rgba(0, 0, 0, 0.82)';
            statusElement.style.color = '#ffffff';
            statusElement.style.fontFamily = 'sans-serif';
            statusElement.style.fontSize = '18px';
            statusElement.style.lineHeight = '1.3';
            statusElement.style.pointerEvents = 'none';
            document.body.appendChild(statusElement);
        }

        statusElement.textContent = 'Preview debug: ' + message;
        console.log('Preview debug: ' + message);
        window.top.postMessage({
            type: 'videoPreviewStatus',
            data: message
        }, '*');
    }

    function getClosestCard(target) {
        if (!target || typeof target.closest !== 'function') {
            return null;
        }
        return target.closest('.card');
    }

    function getCredentials() {
        try {
            var credentials = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var servers = credentials.Servers || [];
            var server;
            var i;

            for (i = 0; i < servers.length; i++) {
                server = servers[i];
                if (server.AccessToken && (!server.ManualAddress || server.ManualAddress === window.location.origin)) {
                    return server.AccessToken;
                }
            }

            return servers.length && servers[0].AccessToken ? servers[0].AccessToken : null;
        } catch (error) {
            console.warn('Video preview: could not read Jellyfin credentials.', error);
            return null;
        }
    }

    function isMiniPlayerActive() {
        var miniPlayer = document.getElementById('webos-mini-player');
        return !!miniPlayer && miniPlayer.style.display !== 'none';
    }

    function positionPreview(element, container) {
        var bounds = container.getBoundingClientRect();
        element.style.position = 'fixed';
        element.style.top = bounds.top + 'px';
        element.style.left = bounds.left + 'px';
        element.style.width = bounds.width + 'px';
        element.style.height = bounds.height + 'px';
        element.style.zIndex = '11';
        element.style.pointerEvents = 'none';
        return bounds;
    }

    function stopPreview() {
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }

        if (request) {
            var pendingRequest = request;
            request = null;
            pendingRequest.abort();
        }

        if (trickplayInterval) {
            clearInterval(trickplayInterval);
            trickplayInterval = null;
        }

        if (trickplayCanvas) {
            if (trickplayCanvas.parentNode) {
                trickplayCanvas.parentNode.removeChild(trickplayCanvas);
            }
            trickplayCanvas = null;
        }

        if (previewPlayer) {
            previewPlayer.pause();
            previewPlayer.removeAttribute('src');
            previewPlayer.load();
            if (previewPlayer.parentNode) {
                previewPlayer.parentNode.removeChild(previewPlayer);
            }
            previewPlayer = null;
        }

        activeCard = null;
        setStatus('idle');
    }

    function typeFromCard(card) {
        return card.getAttribute('data-type') ||
            (card.dataset && card.dataset.type) ||
            (card.getAttribute('data-item-type')) || '';
    }

    function isPreviewableType(itemType) {
        itemType = String(itemType || '').toLowerCase();
        return itemType === 'movie' || itemType === 'episode' || itemType === 'video';
    }

    function getTrickplayInfo(item) {
        var sources = item.Trickplay || {};
        for (var sourceId in sources) {
            if (!Object.prototype.hasOwnProperty.call(sources, sourceId)) {
                continue;
            }
            var widths = sources[sourceId];
            var best = null;
            for (var width in widths) {
                if (!Object.prototype.hasOwnProperty.call(widths, width)) {
                    continue;
                }
                var info = widths[width];
                if (info && info.Width > 0 && info.Height > 0 &&
                    info.TileWidth > 0 && info.TileHeight > 0 &&
                    info.ThumbnailCount > 0 && info.Interval > 0 &&
                    (!best || info.Width < best.Width)) {
                    best = info;
                }
            }
            if (best) {
                return { sourceId: sourceId, info: best };
            }
        }
        return null;
    }

    function showTrickplay(card, itemId, token, trickplay) {
        if (activeCard !== card) {
            return;
        }
        var container = card.querySelector('.cardImageContainer');
        if (!container) {
            return;
        }

        var info = trickplay.info;
        var canvas = document.createElement('canvas');
        var bounds = positionPreview(canvas, container);
        canvas.width = Math.max(1, Math.round(bounds.width));
        canvas.height = Math.max(1, Math.round(bounds.height));
        canvas.className = 'webos-trickplay-preview';
        trickplayCanvas = canvas;
        document.body.appendChild(canvas);

        var frameIndex = Math.min(
            info.ThumbnailCount - 1,
            Math.floor((previewStartTicks / 10000) / info.Interval)
        );
        var tileIndex = -1;
        var tile = null;
        var framesPerTile = info.TileWidth * info.TileHeight;

        function drawFrame() {
            if (activeCard !== card || trickplayCanvas !== canvas) {
                return;
            }
            var nextTileIndex = Math.floor(frameIndex / framesPerTile);
            if (nextTileIndex !== tileIndex) {
                tileIndex = nextTileIndex;
                tile = new Image();
                var loadingTile = tile;
                loadingTile.onload = function () {
                    if (tile === loadingTile) {
                        drawFrame();
                    }
                };
                loadingTile.onerror = function () {
                    if (activeCard === card && trickplayCanvas === canvas) {
                        stopPreview();
                        activeCard = card;
                        setStatus('trickplay image failed; using video fallback');
                        startVideoFallback(card, itemId, token);
                    }
                };
                loadingTile.src = '/Videos/' + encodeURIComponent(itemId) +
                    '/Trickplay/' + encodeURIComponent(info.Width) + '/' + tileIndex +
                    '.jpg?api_key=' + encodeURIComponent(token) +
                    '&MediaSourceId=' + encodeURIComponent(trickplay.sourceId);
                return;
            }
            if (!tile || !tile.complete || !tile.naturalWidth) {
                return;
            }
            var frameInTile = frameIndex % framesPerTile;
            var x = (frameInTile % info.TileWidth) * info.Width;
            var y = Math.floor(frameInTile / info.TileWidth) * info.Height;
            var context = canvas.getContext('2d');
            context.drawImage(tile, x, y, info.Width, info.Height,
                0, 0, canvas.width, canvas.height);
        }

        drawFrame();
        trickplayInterval = setInterval(function () {
            frameIndex = (frameIndex + 1) % info.ThumbnailCount;
            drawFrame();
        }, 1000);
        setStatus('showing trickplay at one frame per second');
    }

    function playPreview(card, itemId, token) {
        if (activeCard !== card || isMiniPlayerActive()) {
            return;
        }

        var container = card.querySelector('.cardImageContainer');
        if (!container) {
            return;
        }

        var video = document.createElement('video');
        var streamUrl = '/Videos/' + encodeURIComponent(itemId) + '/stream.mp4' +
            '?VideoCodec=h264&AudioCodec=aac&MaxWidth=400&api_key=' + encodeURIComponent(token) +
            '&StartTimeTicks=' + previewStartTicks;

        video.src = streamUrl;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.preload = 'auto';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.className = 'webos-video-preview-player';
        // webOS cannot reliably render video within a transformed or
        // transparent ancestor. Jellyfin scales the focused card, so put the
        // video directly on the document and match the card's screen bounds.
        positionPreview(video, container);
        video.oncanplay = function () {
            if (activeCard === card && previewPlayer === video) {
                setStatus('buffered; waiting for playback');
            }
        };
        video.onplaying = function () {
            if (activeCard === card && previewPlayer === video) {
                setStatus('playing preview');
            }
        };
        video.onerror = function () {
            if (previewPlayer === video) {
                stopPreview();
                setStatus('video stream failed');
            }
        };

        previewPlayer = video;
        document.body.appendChild(video);
        var playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(function () {
                if (previewPlayer === video) {
                    stopPreview();
                }
            });
        }

        setTimeout(function () {
            if (activeCard === card && previewPlayer === video && video.paused) {
                setStatus('playback did not start');
            }
        }, 3000);
    }

    function startVideoFallback(card, itemId, token) {
        if (isMiniPlayerActive()) {
            setStatus('no trickplay; video preview skipped while mini-player is active');
            return;
        }
        setStatus('no trickplay; starting video preview');
        playPreview(card, itemId, token);
    }

    function checkItemType(card, itemId, token) {
        var itemType = typeFromCard(card);
        if (itemType && !isPreviewableType(itemType)) {
            setStatus('skipping non-video card: ' + itemType);
            return;
        }

        setStatus('checking item and trickplay');
        var lookup = new XMLHttpRequest();
        request = lookup;
        lookup.open('GET', '/Items/' + encodeURIComponent(itemId) +
            '?Fields=Trickplay&api_key=' + encodeURIComponent(token), true);
        lookup.onreadystatechange = function () {
            if (request !== lookup || lookup.readyState !== 4) {
                return;
            }
            request = null;
            if (activeCard !== card) {
                return;
            }
            if (lookup.status < 200 || lookup.status >= 300) {
                setStatus('item lookup failed: HTTP ' + lookup.status);
                if (isPreviewableType(itemType)) {
                    startVideoFallback(card, itemId, token);
                }
                return;
            }
            try {
                var item = JSON.parse(lookup.responseText);
                if (!isPreviewableType(item.Type || itemType)) {
                    setStatus('skipping non-video item: ' + item.Type);
                    return;
                }
                var trickplay = getTrickplayInfo(item);
                if (trickplay) {
                    showTrickplay(card, itemId, token, trickplay);
                } else {
                    startVideoFallback(card, itemId, token);
                }
            } catch (error) {
                setStatus('item metadata could not be read');
                console.warn('Video preview: could not read item metadata.', error);
                if (isPreviewableType(itemType)) {
                    startVideoFallback(card, itemId, token);
                }
            }
        };
        lookup.send();
    }

    function selectCard(card) {
        if (!card) {
            if (activeCard) {
                stopPreview();
            }
            return;
        }

        if (activeCard === card) {
            return;
        }

        stopPreview();
        activeCard = card;

        var itemId = card.getAttribute('data-id');
        if (!itemId) {
            stopPreview();
            setStatus('selected card has no item ID');
            return;
        }

        setStatus('selected item; waiting 1 second');
        previewTimer = setTimeout(function () {
            previewTimer = null;
            if (activeCard !== card) {
                return;
            }

            var token = getCredentials();
            if (!token) {
                console.warn('Video preview: Jellyfin access token was not found.');
                stopPreview();
                setStatus('access token was not found');
                return;
            }

            checkItemType(card, itemId, token);
        }, previewDelay);
    }

    function onFocusIn(event) {
        selectCard(getClosestCard(event.target));
    }

    function getSelectedCard() {
        var focused = getClosestCard(document.activeElement);
        if (focused) {
            return focused;
        }

        // Some Jellyfin TV views update a selection class after processing the
        // arrow-key event instead of moving browser focus immediately.
        return document.querySelector('.card.focused, .card.focus, .card:focus');
    }

    function refreshSelection() {
        selectCard(getSelectedCard());
    }

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('webos-mini-player-opened', function () {
        if (previewPlayer) {
            stopPreview();
        }
    });
    document.addEventListener('webos-mini-player-closed', function () {
        if (activeCard && !trickplayCanvas && !previewPlayer) {
            var card = activeCard;
            activeCard = null;
            selectCard(card);
        } else {
            refreshSelection();
        }
    });
    document.addEventListener('keydown', function (event) {
        if (event.keyCode < 37 || event.keyCode > 40) {
            return;
        }

        // Jellyfin handles directional navigation after this listener runs.
        // Recheck on the next event turn, after its selection has settled.
        setTimeout(refreshSelection, 0);
    }, true);
    document.addEventListener('focusout', function () {
        setTimeout(function () {
            if (!activeCard) {
                return;
            }
            var focusedCard = getClosestCard(document.activeElement);
            if (focusedCard !== activeCard) {
                stopPreview();
            }
        }, 0);
    }, true);

    window.addEventListener('pagehide', stopPreview);
    window.addEventListener('beforeunload', stopPreview);
    setStatus('script loaded; move selection to a card');
})();
