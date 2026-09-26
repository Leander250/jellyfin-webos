/*
 * Starts a muted video preview when focus settles on a playable media card.
 * This script is injected into the Jellyfin Web iframe by the webOS wrapper.
 */
(function () {
    'use strict';

    var activeCard = null;
    var previewTimer = null;
    var request = null;
    var previewPlayer = null;
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

    function stopPreview() {
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }

        if (request) {
            request.abort();
            request = null;
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

    function playPreview(card, itemId, token) {
        if (activeCard !== card) {
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

        var bounds = container.getBoundingClientRect();

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
        video.style.position = 'fixed';
        video.style.top = bounds.top + 'px';
        video.style.left = bounds.left + 'px';
        video.style.width = bounds.width + 'px';
        video.style.height = bounds.height + 'px';
        video.style.zIndex = '11';
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

    function checkItemType(card, itemId, token) {
        var itemType = typeFromCard(card);
        if (itemType) {
            setStatus('card type: ' + itemType);
            if (isPreviewableType(itemType)) {
                setStatus('starting preview');
                playPreview(card, itemId, token);
            } else {
                setStatus('skipping non-video card: ' + itemType);
            }
            return;
        }

        setStatus('checking item type');
        request = new XMLHttpRequest();
        request.open('GET', '/Items/' + encodeURIComponent(itemId) + '?api_key=' + encodeURIComponent(token), true);
        request.onreadystatechange = function () {
            if (request && request.readyState === 4) {
                var response = request;
                request = null;
                if (activeCard !== card || response.status < 200 || response.status >= 300) {
                    setStatus('item lookup failed: HTTP ' + response.status);
                    return;
                }
                try {
                    var item = JSON.parse(response.responseText);
                    setStatus('item type: ' + item.Type);
                    if (isPreviewableType(item.Type)) {
                        setStatus('starting preview');
                        playPreview(card, itemId, token);
                    } else {
                        setStatus('skipping non-video item: ' + item.Type);
                    }
                } catch (error) {
                    setStatus('item metadata could not be read');
                    console.warn('Video preview: could not read item metadata.', error);
                }
            }
        };
        request.send();
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
