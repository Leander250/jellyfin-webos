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
    var imageContainer = null;
    var originalPosition = null;
    var previewDelay = 1000;
    var previewStartTicks = 3000000000;

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

        if (imageContainer && originalPosition !== null) {
            imageContainer.style.position = originalPosition;
        }

        imageContainer = null;
        originalPosition = null;
        activeCard = null;
    }

    function typeFromCard(card) {
        return card.getAttribute('data-type') ||
            (card.dataset && card.dataset.type) ||
            (card.getAttribute('data-item-type')) || '';
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

        originalPosition = container.style.position;
        if (!originalPosition || originalPosition === 'static') {
            container.style.position = 'relative';
        }
        imageContainer = container;

        video.src = streamUrl;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.setAttribute('playsinline', '');
        video.className = 'webos-video-preview-player';
        video.style.position = 'absolute';
        video.style.top = '0';
        video.style.right = '0';
        video.style.bottom = '0';
        video.style.left = '0';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.zIndex = '10';
        video.style.borderRadius = 'inherit';
        video.style.transition = 'opacity 0.4s ease-in';
        video.style.opacity = '0';
        video.oncanplay = function () {
            if (activeCard === card && previewPlayer === video) {
                video.style.opacity = '1';
            }
        };
        video.onerror = function () {
            if (previewPlayer === video) {
                stopPreview();
            }
        };

        previewPlayer = video;
        container.appendChild(video);
        var playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(function () {
                if (previewPlayer === video) {
                    stopPreview();
                }
            });
        }
    }

    function checkItemType(card, itemId, token) {
        var itemType = typeFromCard(card);
        if (itemType) {
            if (itemType === 'Movie' || itemType === 'Episode') {
                playPreview(card, itemId, token);
            }
            return;
        }

        request = new XMLHttpRequest();
        request.open('GET', '/Items/' + encodeURIComponent(itemId) + '?api_key=' + encodeURIComponent(token), true);
        request.onreadystatechange = function () {
            if (request && request.readyState === 4) {
                var response = request;
                request = null;
                if (activeCard !== card || response.status < 200 || response.status >= 300) {
                    return;
                }
                try {
                    var item = JSON.parse(response.responseText);
                    if (item.Type === 'Movie' || item.Type === 'Episode') {
                        playPreview(card, itemId, token);
                    }
                } catch (error) {
                    console.warn('Video preview: could not read item metadata.', error);
                }
            }
        };
        request.send();
    }

    function onFocusIn(event) {
        var card = getClosestCard(event.target);
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
            return;
        }

        previewTimer = setTimeout(function () {
            previewTimer = null;
            if (activeCard !== card) {
                return;
            }

            var token = getCredentials();
            if (!token) {
                console.warn('Video preview: Jellyfin access token was not found.');
                stopPreview();
                return;
            }

            checkItemType(card, itemId, token);
        }, previewDelay);
    }

    document.addEventListener('focusin', onFocusIn, true);
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
})();
