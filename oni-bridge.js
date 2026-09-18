/* oni-bridge.js — DEBUG BUILD
   Add near the end of <body> in every page listed in
   scroll-slide-pages.html's "pages" array:
     <script src="oni-bridge.js"></script>   (same folder)
     <script src="../oni-bridge.js"></script> (one folder down)

   This build logs to the browser console so we can see exactly
   what it's detecting. Open DevTools (F12) → Console tab on the
   scroll-slide-pages.html tab (the messages from child iframes show
   up there too) to see the log lines while you test.
*/
(function() {
    console.log('[oni-bridge] script loaded on', location.pathname);

    if (window.top === window.self) {
        console.log('[oni-bridge] not inside an iframe, doing nothing');
        return;
    }

    const WHEEL_THRESHOLD = 4;
    const EDGE_TOLERANCE = 6;

    function scroller() {
        return document.scrollingElement || document.documentElement;
    }

    function atBottom() {
        const el = scroller();
        return el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_TOLERANCE;
    }

    function atTop() {
        return scroller().scrollTop <= EDGE_TOLERANCE;
    }

    // one-time sanity check: does scrollY ever move at all?
    let sawScrollMove = false;
    window.addEventListener('scroll', function() {
        if (!sawScrollMove) {
            sawScrollMove = true;
            console.log('[oni-bridge] native scroll detected, scrollTop =', scroller().scrollTop);
        }
    }, { passive: true });

    let stuckUpCount = 0;
    let stuckDownCount = 0;
    let warnedNoScroll = false;
    let touchStartY = null;

    // While true, this page ignores wheel/touch nav triggers. Set right
    // after we get jumped to an edge by the parent, so leftover momentum
    // scroll (trackpad inertia) landing on the newly-active page can't
    // immediately fire another navigate and bounce back where we came from.
    let navCooldown = false;

    window.addEventListener('wheel', function(e) {
        if (navCooldown) return;
        if (Math.abs(e.deltaY) < WHEEL_THRESHOLD) return;
        const before = scroller().scrollTop;

        if (!sawScrollMove && !warnedNoScroll) {
            warnedNoScroll = true;
            console.warn('[oni-bridge] wheel events are firing but native scrollTop never changed. ' +
                'This page likely uses a custom smooth-scroll library (Locomotive Scroll / Lenis / GSAP ' +
                'ScrollSmoother / etc.) that does not use real browser scrolling — top/bottom detection ' +
                'will not work here without extra integration for that library.');
        }

        if (e.deltaY > 0) {
            stuckUpCount = 0;
            stuckDownCount = atBottom() ? stuckDownCount + 1 : 0;
            if (stuckDownCount >= 1) {
                console.log('[oni-bridge] at bottom, sending "next"');
                requestAnimationFrame(function() {
                    if (scroller().scrollTop === before || atBottom()) {
                        window.parent.postMessage({ source: 'oni-bridge', type: 'navigate', direction: 'next' }, '*');
                    }
                });
            }
        } else {
            stuckDownCount = 0;
            stuckUpCount = atTop() ? stuckUpCount + 1 : 0;
            console.log('[oni-bridge] wheel up, scrollTop =', scroller().scrollTop, 'atTop =', atTop());
            if (stuckUpCount >= 1) {
                console.log('[oni-bridge] at top, sending "prev"');
                requestAnimationFrame(function() {
                    if (scroller().scrollTop === before || atTop()) {
                        window.parent.postMessage({ source: 'oni-bridge', type: 'navigate', direction: 'prev' }, '*');
                    }
                });
            }
        }
    }, { passive: true }); // passive:true here on purpose, see note below

    // ---- receive "land here" commands from the parent when this page
    // becomes active after a prev/next navigation ----
    window.addEventListener('message', function(e) {
        const data = e.data;
        if (!data || data.source !== 'oni-parent' || data.type !== 'scrollTo') return;
        if (e.source !== window.parent) return; // only trust the top frame

        const el = scroller();
        if (data.position === 'bottom') {
            el.scrollTop = el.scrollHeight;
        } else if (data.position === 'top') {
            el.scrollTop = 0;
        }
        console.log('[oni-bridge] parent requested scrollTo', data.position, '-> scrollTop now', el.scrollTop);

        // this jump itself can look like "at the edge" to leftover wheel/touch
        // events still queued from the gesture that triggered navigation —
        // reset the counters and briefly ignore nav triggers so it doesn't
        // immediately send another navigate and bounce back
        stuckUpCount = 0;
        stuckDownCount = 0;
        touchStartY = null;
        navCooldown = true;
        setTimeout(function() { navCooldown = false; }, 500);
    }, false);

    window.addEventListener('touchstart', function(e) {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener('touchmove', function(e) {
        if (navCooldown) return;
        if (touchStartY === null) return;
        const dy = touchStartY - e.touches[0].clientY;
        if (dy > 40 && atBottom()) {
            touchStartY = null;
            window.parent.postMessage({ source: 'oni-bridge', type: 'navigate', direction: 'next' }, '*');
        } else if (dy < -40 && atTop()) {
            touchStartY = null;
            window.parent.postMessage({ source: 'oni-bridge', type: 'navigate', direction: 'prev' }, '*');
        }
    }, { passive: true });
})();