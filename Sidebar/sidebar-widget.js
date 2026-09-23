/*!
 * sidebar-widget.js
 * Self-contained sidebar. Same "liquid" SVG-path shape and reveal
 * animation as sidebar.html / sidebar.css / sidebar.js, packaged as a
 * single drop-in script. Drop into any page with:
 *   <script src="sidebar-widget.js"></script>
 *
 * Desktop: hover the left-edge handle to open, move away to close.
 *          Keyboard: Tab to the handle, Enter to open, Escape to close.
 * Mobile:  a slim header bar at the top with a three-dots button on the
 *          right. Tap it to open the sidebar; tap the dimmed backdrop,
 *          a link, or press Escape to close.
 */
(function() {
    'use strict';

    if (window.__sidebarWidgetInitialized) return;
    window.__sidebarWidgetInitialized = true;

    // Capture this synchronously, before any async work, so it reliably
    // points at THIS <script> tag regardless of which page included it.
    var __thisScript = document.currentScript;

    /* ---------------------------------------------------------------- */
    /* Edit this list to change the menu — everything else adapts.       */
    /* `path` is relative to the SITE ROOT (where index.html lives).     */
    /* ---------------------------------------------------------------- */
    var MENU_ITEMS = [
        { label: 'Home', path: 'media-home/lens.html' },
        { label: 'Gallery', path: 'Gallery/Gallery.html' },
        { label: 'Services', path: 'Services/Services.html' },
        { label: 'Artist', path: 'Artist/Artist.html' },
        { label: 'Awards', path: 'Awards/Awards.html' },
        { label: 'Blog', path: 'Blog/Blog.html' },
        { label: 'Contact', path: 'Contact/Contact.html' }
    ];

    // The script lives at <root>/Sidebar/sidebar-widget.js, so going one
    // directory up from the script's own URL gives us the site root.
    function getSiteRoot() {
        try {
            var scriptUrl = new URL(__thisScript.src, window.location.href);
            return new URL('../', scriptUrl);
        } catch (e) {
            return new URL('./', window.location.href);
        }
    }

    var SITE_ROOT = getSiteRoot();

    // Theme tokens — matches the site's dark palette. --accent is read
    // live from the page's :root if defined there.
    var THEME = {
        card: '#1b1b1d',
        cardAlt: '#151516',
        border: '#2d2d30',
        body: '#d9d6d0',
        muted: '#9a978f',
        heading: '#f4f1ea',
        accent: '#c9a96a'
    };

    if (!document.getElementById('sidebar-widget-font')) {
        var fontLink = document.createElement('link');
        fontLink.setAttribute('id', 'sidebar-widget-font');
        fontLink.setAttribute('rel', 'stylesheet');
        fontLink.setAttribute('href', 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        document.head.appendChild(fontLink);
    }

    // Shape geometry.
    var SIDEBAR_WIDTH = 220;
    var HANDLE_WIDTH = 33.75;
    var HANDLE_HEIGHT = 67.5;

    // Mobile header height (kept minimal; 44px is the smallest
    // comfortable tap target for the button inside it).
    var MOBILE_HEADER_HEIGHT = 48;

    // When this matches, the edge handle is swapped for the top header.
    var MOBILE_QUERY = '(max-width: 768px), (hover: none), (pointer: coarse)';

    /* ---------------------------------------------------------------- */
    /* 1. Inject CSS                                                      */
    /* ---------------------------------------------------------------- */
    var css = `
#sidebar-widget-root,
#sidebar-mobile-header {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

#sidebar-svg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    pointer-events: none;
    z-index: 2147483000;
}

/* Dim layer behind the open panel. Only shown when the sidebar was
   opened by tap or keyboard, never on mouse hover. */
#sidebar-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
    transition: opacity 0.3s ease;
    z-index: 2147482999;
}

#sidebar-widget-root.open.modal #sidebar-backdrop {
    opacity: 1;
    pointer-events: auto;
}

/* ---------- Desktop edge handle ---------- */
#sidebar-hover-trigger {
    position: fixed;
    top: 0;
    left: 0;
    width: ${HANDLE_WIDTH}px;
    height: 100vh;
    height: 100dvh;
    z-index: 2147483001;
    cursor: pointer;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    font: inherit;
    color: inherit;
}

#sidebar-hover-trigger:focus {
    outline: none;
}

#sidebar-hover-trigger:focus-visible ~ #handle-dots .handle-dot {
    animation: none;
    opacity: 1;
    box-shadow: 0 0 0 3px rgba(201, 169, 106, 0.35);
}

#handle-dots {
    position: fixed;
    top: 50%;
    left: 0;
    width: ${HANDLE_WIDTH}px;
    transform: translateY(-50%) translateX(-6px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    z-index: 2147483002;
    pointer-events: none;
    transition: opacity 0.25s ease;
}

.handle-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent, ${THEME.accent});
    opacity: 0.5;
    animation: sidebar-dot-pulse 2.4s ease-in-out infinite;
}

.handle-dot:nth-child(2) { animation-delay: 0.3s; }
.handle-dot:nth-child(3) { animation-delay: 0.6s; }

@keyframes sidebar-dot-pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
}

#sidebar-widget-root.open #handle-dots {
    opacity: 0;
}

/* ---------- Panel ---------- */
#sidebar-content {
    position: fixed;
    top: 0;
    left: 0;
    width: ${SIDEBAR_WIDTH}px;
    height: 100vh;
    height: 100dvh;
    z-index: 2147483001;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transform: translateX(-20px);
    transition: opacity 0.4s ease, transform 0.4s ease, visibility 0s linear 0.4s;

    display: flex;
    flex-direction: column;
    justify-content: center;
    justify-content: safe center;
    padding: 24px 0 24px 50px;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
}

#sidebar-content::-webkit-scrollbar {
    display: none;
}

#sidebar-widget-root.open #sidebar-content {
    opacity: 1;
    visibility: visible;
    transform: translateX(0);
    pointer-events: auto;
    transition: opacity 0.4s ease 0.1s, transform 0.4s ease 0.1s, visibility 0s linear 0s;
}

.sidebar-menu-item,
.sidebar-menu-item:visited {
    color: ${THEME.muted};
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 0.02em;
    cursor: pointer;
    text-decoration: none;
    display: block;
    flex-shrink: 0;
    width: fit-content;
    margin: 10px -14px;
    padding: 8px 14px;
    border-radius: 999px;
    background: transparent;
    -webkit-tap-highlight-color: transparent;
    transition: background-color 0.25s ease, color 0.2s ease;
}

.sidebar-menu-item:hover {
    background: rgba(201, 169, 106, 0.14);
    color: var(--accent, ${THEME.accent});
}

.sidebar-menu-item:focus {
    outline: none;
}

.sidebar-menu-item:focus-visible {
    outline: 2px solid var(--accent, ${THEME.accent});
    outline-offset: 2px;
}

.sidebar-menu-item.active {
    color: var(--accent, ${THEME.accent});
    text-decoration: underline;
    text-underline-offset: 4px;
}

#sidebar-path {
    fill: ${THEME.card};
    stroke: var(--accent, ${THEME.accent});
    stroke-width: 1.5;
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.45));
    transition: fill 0.25s ease, stroke-width 0.25s ease;
}

#sidebar-widget-root.open #sidebar-path {
    fill: url(#sidebar-panel-gradient);
    stroke: ${THEME.border};
    stroke-width: 1;
    filter: url(#sidebar-shadow);
}

/* ---------- Mobile header (hidden on desktop) ---------- */
#sidebar-mobile-header {
    display: none;
}

#sidebar-page-title {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
    margin: 0;
    padding: 0;
    line-height: 1.2;
    color: ${THEME.heading};
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

#sidebar-page-title::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 10px;
    border-radius: 50%;
    background: var(--accent, ${THEME.accent});
    vertical-align: middle;
    transform: translateY(-1px);
}

#sidebar-menu-button {
    flex: 0 0 44px;
    width: 44px;
    min-width: 44px;
    max-width: 44px;
    height: 44px;
    min-height: 0;
    box-sizing: border-box;
    position: static;
    box-shadow: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: background-color 0.2s ease;
}

#sidebar-menu-button:active,
#sidebar-menu-button[aria-expanded="true"] {
    background: rgba(201, 169, 106, 0.14);
}

#sidebar-menu-button:focus {
    outline: none;
}

#sidebar-menu-button:focus-visible {
    outline: 2px solid var(--accent, ${THEME.accent});
    outline-offset: 2px;
}

.menu-button-dot {
    display: block;
    flex: 0 0 auto;
    margin: 0;
    padding: 0;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent, ${THEME.accent});
}

@media ${MOBILE_QUERY} {
    /* Fixed to the viewport, so the page's own body layout (flex/grid,
       padding, margins, wide content) can't stretch, shift or squeeze it. */
    #sidebar-mobile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        width: auto;
        max-width: 100vw;
        min-width: 0;
        margin: 0;
        z-index: 2147482998;
        box-sizing: border-box;
        height: calc(${MOBILE_HEADER_HEIGHT}px + env(safe-area-inset-top, 0px));
        padding: env(safe-area-inset-top, 0px)
                 calc(6px + env(safe-area-inset-right, 0px))
                 0
                 calc(16px + env(safe-area-inset-left, 0px));
        overflow: hidden;
        background: ${THEME.card};
        border: 0;
        border-bottom: 1px solid ${THEME.border};
        transform: none;
        float: none;
    }

    /* Reserve space for the fixed header so it doesn't cover the top of
       the page. Applied to <html> so it works whatever layout <body> uses. */
    html.sidebar-has-mobile-header {
        padding-top: calc(${MOBILE_HEADER_HEIGHT}px + env(safe-area-inset-top, 0px));
        scroll-padding-top: calc(${MOBILE_HEADER_HEIGHT}px + env(safe-area-inset-top, 0px));
    }

    /* On mobile the panel slides in from the right. */
    #sidebar-content {
        left: auto;
        right: 0;
        transform: translateX(20px);
        padding: 24px 24px 24px 44px;
    }

    /* The edge handle is replaced by the header button. */
    #sidebar-hover-trigger,
    #handle-dots {
        display: none;
    }

    /* Avoid "sticky" hover highlights after a tap; use :active instead. */
    .sidebar-menu-item:not(.active):hover {
        background: transparent;
        color: ${THEME.muted};
    }

    .sidebar-menu-item:active {
        background: rgba(201, 169, 106, 0.14);
        color: var(--accent, ${THEME.accent});
    }
}

/* ---------- Short screens (phones in landscape) ---------- */
@media (max-height: 520px) {
    .sidebar-menu-item,
    .sidebar-menu-item:visited {
        font-size: 18px;
        margin: 4px -14px;
        padding: 7px 14px;
    }
}

/* ---------- Reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
    .handle-dot {
        animation: none;
        opacity: 0.8;
    }

    #sidebar-content,
    #sidebar-widget-root.open #sidebar-content,
    #sidebar-backdrop {
        transition-duration: 0.01s;
        transition-delay: 0s;
    }
}
`;

    var styleEl = document.createElement('style');
    styleEl.setAttribute('id', 'sidebar-widget-styles');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    /* ---------------------------------------------------------------- */
    /* 2. Inject markup                                                   */
    /* ---------------------------------------------------------------- */
    var currentPath = window.location.pathname.replace(/\\/g, '/');

    var currentLabel = '';

    var menuItemsHtml = MENU_ITEMS.map(function(item) {
        var href = new URL(item.path, SITE_ROOT).href;
        var isCurrent = currentPath.indexOf(item.path.replace(/\\/g, '/')) !== -1;
        if (isCurrent && !currentLabel) currentLabel = item.label;
        var cls = 'sidebar-menu-item' + (isCurrent ? ' active' : '');
        var current = isCurrent ? ' aria-current="page"' : '';
        return '<a class="' + cls + '" href="' + href + '"' + current + '>' + item.label + '</a>';
    }).join('');

    var markup =
        '<svg id="sidebar-svg" aria-hidden="true" focusable="false">' +
        '<defs>' +
        '<linearGradient id="sidebar-panel-gradient" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="' + THEME.card + '" stop-opacity="0.94" />' +
        '<stop offset="55%" stop-color="' + THEME.cardAlt + '" stop-opacity="0.94" />' +
        '<stop offset="100%" stop-color="#0e0e0f" stop-opacity="0.94" />' +
        '</linearGradient>' +
        '<filter id="sidebar-shadow" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feDropShadow dx="5" dy="0" stdDeviation="15" flood-color="#000000" flood-opacity="0.45" />' +
        '</filter>' +
        '</defs>' +
        '<path id="sidebar-path" fill="' + THEME.card + '" />' +
        '</svg>' +
        '<div id="sidebar-backdrop" aria-hidden="true"></div>' +
        '<button type="button" id="sidebar-hover-trigger" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar-content"></button>' +
        '<div id="handle-dots" aria-hidden="true">' +
        '<span class="handle-dot"></span>' +
        '<span class="handle-dot"></span>' +
        '<span class="handle-dot"></span>' +
        '</div>' +
        '<nav id="sidebar-content" aria-label="Site">' + menuItemsHtml + '</nav>';

    var container = document.createElement('div');
    container.setAttribute('id', 'sidebar-widget-root');
    container.innerHTML = markup;

    // Mobile header lives at the very top of <body> so it takes up real
    // space and pushes the page down, rather than covering content.
    var mobileHeader = document.createElement('div');
    mobileHeader.setAttribute('id', 'sidebar-mobile-header');
    // Current page name on the left of the header. Falls back to the
    // page's <title> when the page isn't in MENU_ITEMS.
    var pageTitle = document.createElement('span');
    pageTitle.setAttribute('id', 'sidebar-page-title');
    pageTitle.textContent = currentLabel || (document.title || '').trim();

    mobileHeader.innerHTML =
        '<button type="button" id="sidebar-menu-button" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar-content">' +
        '<span class="menu-button-dot"></span>' +
        '<span class="menu-button-dot"></span>' +
        '<span class="menu-button-dot"></span>' +
        '</button>';
    mobileHeader.insertBefore(pageTitle, mobileHeader.firstChild);

    function mount() {
        document.body.insertBefore(mobileHeader, document.body.firstChild);
        document.documentElement.classList.add('sidebar-has-mobile-header');
        document.body.appendChild(container);
        initBehavior();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    /* ---------------------------------------------------------------- */
    /* 3. Behavior                                                        */
    /* ---------------------------------------------------------------- */
    function initBehavior() {
        var root = document.getElementById('sidebar-widget-root');
        var svg = document.getElementById('sidebar-svg');
        var path = document.getElementById('sidebar-path');
        var trigger = document.getElementById('sidebar-hover-trigger');
        var content = document.getElementById('sidebar-content');
        var backdrop = document.getElementById('sidebar-backdrop');
        var menuButton = document.getElementById('sidebar-menu-button');

        // mode: 'hover' (opened by mouse, closes on mouse leave)
        //       'modal' (opened by tap/keyboard, closes on backdrop/Escape)
        var isOpen = false;
        var mode = null;
        var lastPointerType = '';

        var progress = 0;
        var lastTime = 0;
        var animationId = null;

        var mobileMq = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
        var reduceMotion = window.matchMedia ?
            window.matchMedia('(prefers-reduced-motion: reduce)') :
            null;

        function isMobile() { return !!(mobileMq && mobileMq.matches); }

        function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

        function setOpen(open, how) {
            isOpen = open;
            mode = open ? how : null;
            root.classList.toggle('open', open);
            root.classList.toggle('modal', open && how === 'modal');

            var label = open ? 'Close menu' : 'Open menu';
            [trigger, menuButton].forEach(function(btn) {
                btn.setAttribute('aria-expanded', String(open));
                btn.setAttribute('aria-label', label);
            });

            // Widen the desktop hit box only for mouse hover, so the
            // pointer can travel across the panel without it closing.
            trigger.style.width = (open && how === 'hover') ? SIDEBAR_WIDTH + 'px' : '';
            ensureAnimating();
        }

        function focusFirstLink() {
            var first = content.querySelector('a');
            if (first) first.focus();
        }

        function ensureAnimating() {
            if (animationId === null) animationId = requestAnimationFrame(tick);
        }

        function buildPath(p) {
            var eased = easeOutQuart(p);
            var h = window.innerHeight;
            var cy = h / 2;

            if (p === 0) {
                // On mobile the header button replaces the edge handle,
                // so nothing is drawn at rest.
                if (isMobile()) return '';

                // Rest state: a true semicircle bulging right from the page
                // edge. Left open (no Z) so the flat edge has no stroke.
                var R = HANDLE_WIDTH;
                var kappa = 0.5522847498;
                return `
                    M 0, ${cy - R}
                    C ${kappa * R}, ${cy - R} ${R}, ${cy - kappa * R} ${R}, ${cy}
                    C ${R}, ${cy + kappa * R} ${kappa * R}, ${cy + R} 0, ${cy + R}
                `;
            }

            // 1. Vertical expansion
            var vertical_progress = Math.min(1, eased * 2);
            var start_curve_y = (cy - (HANDLE_HEIGHT / 2)) * (1 - vertical_progress);
            var end_curve_y = (cy + (HANDLE_HEIGHT / 2)) + ((h - (cy + (HANDLE_HEIGHT / 2))) * vertical_progress);

            // 2. Horizontal expansion
            var base_x, ctrl_x;
            if (eased < 0.5) {
                var p1 = eased * 2;
                ctrl_x = HANDLE_WIDTH + p1 * (SIDEBAR_WIDTH + 80 - HANDLE_WIDTH);
                base_x = p1 * p1 * SIDEBAR_WIDTH * 0.3;
            } else {
                var p2 = (eased - 0.5) * 2;
                ctrl_x = (SIDEBAR_WIDTH + 80) - p2 * 80;
                base_x = (SIDEBAR_WIDTH * 0.3) + p2 * (SIDEBAR_WIDTH * 0.7);
            }

            return `
                M 0, 0
                L ${base_x}, 0
                L ${base_x}, ${start_curve_y}
                C ${ctrl_x}, ${start_curve_y} ${ctrl_x}, ${end_curve_y} ${base_x}, ${end_curve_y}
                L ${base_x}, ${h}
                L 0, ${h}
            `;
        }

        function render() {
            path.setAttribute('d', buildPath(progress));
            // On mobile, flip the shape horizontally so it grows from the
            // right edge instead of the left.
            if (isMobile()) {
                var w = svg.getBoundingClientRect().width || window.innerWidth;
                path.setAttribute('transform', 'matrix(-1 0 0 1 ' + w + ' 0)');
            } else {
                path.removeAttribute('transform');
            }
        }

        function tick(time) {
            if (!lastTime) lastTime = time;
            // Clamp dt so a backgrounded tab doesn't make the shape jump.
            var dt = Math.min(0.1, (time - lastTime) / 1000);
            lastTime = time;

            var speed = (reduceMotion && reduceMotion.matches) ? 8 : 1.2;

            if (isOpen) progress = Math.min(1, progress + dt * speed);
            else progress = Math.max(0, progress - dt * speed);

            render();

            if ((isOpen && progress < 1) || (!isOpen && progress > 0)) {
                animationId = requestAnimationFrame(tick);
            } else {
                animationId = null;
                lastTime = 0;
            }
        }

        /* --- Desktop: hover to open (pointer events ignore touch/pen) --- */
        function onPointerEnter(e) {
            if (e.pointerType !== 'mouse' || isMobile()) return;
            if (isOpen && mode === 'modal') return; // don't downgrade a keyboard open
            setOpen(true, 'hover');
        }

        function onPointerLeave(e) {
            if (e.pointerType !== 'mouse') return;
            if (mode === 'hover') setOpen(false);
        }

        trigger.addEventListener('pointerenter', onPointerEnter);
        trigger.addEventListener('pointerleave', onPointerLeave);
        content.addEventListener('pointerenter', onPointerEnter);
        content.addEventListener('pointerleave', onPointerLeave);

        /* --- Desktop: click / keyboard on the edge handle --- */
        trigger.addEventListener('pointerdown', function(e) {
            lastPointerType = e.pointerType;
        });

        trigger.addEventListener('click', function(e) {
            var viaKeyboard = e.detail === 0;
            var viaMouse = !viaKeyboard && lastPointerType === 'mouse';
            lastPointerType = '';

            if (viaMouse) {
                setOpen(true, 'hover');
                return;
            }

            if (isOpen && mode === 'modal') {
                setOpen(false);
                return;
            }

            setOpen(true, 'modal');
            if (viaKeyboard) focusFirstLink();
        });

        /* --- Mobile: three-dots button in the header --- */
        menuButton.addEventListener('click', function(e) {
            if (isOpen) {
                setOpen(false);
                return;
            }
            setOpen(true, 'modal');
            if (e.detail === 0) focusFirstLink();
        });

        /* --- Closing a tap/keyboard-opened sidebar --- */
        backdrop.addEventListener('click', function() {
            setOpen(false);
        });

        content.addEventListener('click', function(e) {
            if (mode === 'modal' && e.target.closest('a')) setOpen(false);
        });

        document.addEventListener('keydown', function(e) {
            if (!isOpen || (e.key !== 'Escape' && e.key !== 'Esc')) return;
            var focusInside = root.contains(document.activeElement);
            setOpen(false);
            if (focusInside)(isMobile() ? menuButton : trigger).focus();
        });

        // Tabbing out of the menu closes it (moving back to the header
        // button is allowed so it can be used to close the menu).
        root.addEventListener('focusout', function(e) {
            var to = e.relatedTarget;
            if (mode === 'modal' && to && !root.contains(to) && to !== menuButton) {
                setOpen(false);
            }
        });

        /* --- Switching between mobile and desktop layouts --- */
        if (mobileMq) {
            var onLayoutChange = function() {
                if (isOpen) setOpen(false);
                trigger.style.width = '';
                if (animationId === null) render();
            };
            if (mobileMq.addEventListener) mobileMq.addEventListener('change', onLayoutChange);
            else if (mobileMq.addListener) mobileMq.addListener(onLayoutChange);
        }

        /* --- Redraw on resize (incl. mobile address bar show/hide) --- */
        window.addEventListener('resize', function() {
            if (animationId === null) render();
        });

        render();
    }
})();