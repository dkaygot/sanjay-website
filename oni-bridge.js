/* oni-bridge.js
   Add near the end of <body> in every page listed in index.html's "pages" array:
     <script src="oni-bridge.js"></script>    (same folder)
     <script src="../oni-bridge.js"></script> (one folder down)

   Production build: logging is off. Set DEBUG = true below (or add ?onidebug
   to the page URL) to get the old console output back while testing.
*/
(function() {
    'use strict';

    var DEBUG = false || /[?&]onidebug\b/.test(location.search);
    var log = DEBUG ? console.log.bind(console, '[oni-bridge]') : function() {};

    if (window.top === window.self) {
        log('not inside an iframe, doing nothing');
        return;
    }

    var WHEEL_THRESHOLD = 4;
    var EDGE_TOLERANCE = 6;
    var SWIPE_DISTANCE = 40;

    function scroller() {
        return document.scrollingElement || document.documentElement;
    }

    function atBottom() {
        var el = scroller();
        return el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_TOLERANCE;
    }

    function atTop() {
        return scroller().scrollTop <= EDGE_TOLERANCE;
    }

    function send(direction) {
        log('sending', direction);
        window.parent.postMessage({ source: 'oni-bridge', type: 'navigate', direction: direction }, '*');
    }

    if (DEBUG) {
        var sawScrollMove = false;
        window.addEventListener('scroll', function() {
            if (!sawScrollMove) {
                sawScrollMove = true;
                log('native scroll detected, scrollTop =', scroller().scrollTop);
            }
        }, { passive: true });
    }

    var touchStartY = null;

    // Set right after the parent jumps us to an edge, so leftover momentum
    // (trackpad inertia / a finishing swipe) can't bounce straight back.
    var navCooldown = false;

    window.addEventListener('wheel', function(e) {
        if (navCooldown || Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
        var before = scroller().scrollTop;

        if (e.deltaY > 0) {
            if (!atBottom()) return;
            requestAnimationFrame(function() {
                if (scroller().scrollTop === before || atBottom()) send('next');
            });
        } else {
            if (!atTop()) return;
            requestAnimationFrame(function() {
                if (scroller().scrollTop === before || atTop()) send('prev');
            });
        }
    }, { passive: true });

    // "land here" commands from the parent when this page becomes active
    window.addEventListener('message', function(e) {
        var data = e.data;
        if (!data || data.source !== 'oni-parent' || data.type !== 'scrollTo') return;
        if (e.source !== window.parent) return; // only trust the top frame

        var el = scroller();
        el.scrollTop = data.position === 'bottom' ? el.scrollHeight : 0;
        log('parent requested scrollTo', data.position, '-> scrollTop now', el.scrollTop);

        touchStartY = null;
        navCooldown = true;
        setTimeout(function() { navCooldown = false; }, 500);
    }, false);

    window.addEventListener('touchstart', function(e) {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', function(e) {
        if (navCooldown || touchStartY === null) return;
        var dy = touchStartY - e.touches[0].clientY;
        if (dy > SWIPE_DISTANCE && atBottom()) {
            touchStartY = null;
            send('next');
        } else if (dy < -SWIPE_DISTANCE && atTop()) {
            touchStartY = null;
            send('prev');
        }
    }, { passive: true });

    window.addEventListener('touchend', function() {
        touchStartY = null;
    }, { passive: true });
})();