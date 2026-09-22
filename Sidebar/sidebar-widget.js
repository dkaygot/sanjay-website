/*!
 * sidebar-widget.js
 * Self-contained hover sidebar. Same "liquid" SVG-path shape and reveal
 * animation as sidebar.html / sidebar.css / sidebar.js, packaged as a
 * single drop-in script. Drop into any page with:
 *   <script src="sidebar-widget.js"></script>
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
        { label: 'Home', path: 'media-home/chapter-two.html' },
        { label: 'Gallery', path: 'Gallery/Gallery.html' },
        { label: 'Services', path: 'Services/Services.html' },
        { label: 'Artist', path: 'Artist/Artist.html' },
        { label: 'Awards', path: 'Awards/Awards.html' },
        { label: 'Blog', path: 'Blog/Blog.html' },
        { label: 'Contact', path: 'Contact/Contact.html' }
    ];

    // The script lives at <root>/Sidebar/sidebar-widget.js, so going one
    // directory up from the script's own URL gives us the site root —
    // this works no matter which page (root or subfolder) loaded it.
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
    // live from the page's :root if defined there (per the theme's own
    // "change --accent to reskin" convention); every other token is
    // fixed to the palette since no variable names were given for them.
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

    // Shape geometry — same numbers/roles as sidebar.js, widened slightly
    // so the longest label ("Services") has room to breathe.
    var SIDEBAR_WIDTH = 220;
    var HANDLE_WIDTH = 22.5;
    var HANDLE_HEIGHT = 45;

    /* ---------------------------------------------------------------- */
    /* 1. Inject CSS (same visual language as sidebar.css)               */
    /* ---------------------------------------------------------------- */
    var css = `
#sidebar-widget-root {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
}

#sidebar-svg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483000;
}

#sidebar-hover-trigger {
    position: fixed;
    top: 0;
    left: 0;
    width: ${HANDLE_WIDTH}px;
    height: 100vh;
    z-index: 2147483001;
    cursor: pointer;
}

#sidebar-content {
    position: fixed;
    top: 0;
    left: 0;
    width: ${SIDEBAR_WIDTH}px;
    height: 100vh;
    z-index: 2147483001;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-20px);
    transition: opacity 0.4s ease, transform 0.4s ease;

    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-left: 50px;
    box-sizing: border-box;
}

#sidebar-hover-trigger:hover ~ #sidebar-content,
#sidebar-content:hover {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
    transition-delay: 0.1s;
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
    width: fit-content;
    margin: 10px -14px;
    padding: 8px 14px;
    border-radius: 999px;
    background: transparent;
    transition: background-color 0.25s ease, color 0.2s ease;
}

.sidebar-menu-item:hover {
    background: rgba(201, 169, 106, 0.14);
    color: var(--accent, ${THEME.accent});
}

.sidebar-menu-item.active {
    color: var(--accent, ${THEME.accent});
    text-decoration: underline;
    text-underline-offset: 4px;
}

/* Closed-state handle: styled with the site's card + gold-accent
   palette so it reads as part of the site rather than a floating
   generic control. Dimensions/geometry are unchanged — only the
   paint changes between the closed handle and the open panel. */
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

/* Three dots inside the closed handle, in the accent gold. */
#handle-dots {
    position: fixed;
    top: 50%;
    left: 0;
    width: ${HANDLE_WIDTH}px;
    transform: translateY(-50%) translateX(-4px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    z-index: 2147483002;
    pointer-events: none;
    transition: opacity 0.25s ease;
}

.handle-dot {
    width: 4px;
    height: 4px;
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
`;

    var styleEl = document.createElement('style');
    styleEl.setAttribute('id', 'sidebar-widget-styles');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    /* ---------------------------------------------------------------- */
    /* 2. Inject markup (SVG blob + trigger + real links)                 */
    /* ---------------------------------------------------------------- */
    var currentPath = window.location.pathname.replace(/\\/g, '/');

    var menuItemsHtml = MENU_ITEMS.map(function(item) {
        var href = new URL(item.path, SITE_ROOT).href;
        var isCurrent = currentPath.indexOf(item.path.replace(/\\/g, '/')) !== -1;
        var cls = 'sidebar-menu-item' + (isCurrent ? ' active' : '');
        return '<a class="' + cls + '" href="' + href + '">' + item.label + '</a>';
    }).join('');

    var markup =
        '<svg id="sidebar-svg">' +
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
        '<div id="handle-dots">' +
        '<span class="handle-dot"></span>' +
        '<span class="handle-dot"></span>' +
        '<span class="handle-dot"></span>' +
        '</div>' +
        '<div id="sidebar-hover-trigger"></div>' +
        '<div id="sidebar-content">' + menuItemsHtml + '</div>';

    var container = document.createElement('div');
    container.setAttribute('id', 'sidebar-widget-root');
    container.innerHTML = markup;

    function mount() {
        document.body.appendChild(container);
        initBehavior();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    /* ---------------------------------------------------------------- */
    /* 3. Behavior — same curve-drawing animation as sidebar.js           */
    /* ---------------------------------------------------------------- */
    function initBehavior() {
        var root = document.getElementById('sidebar-widget-root');
        var path = document.getElementById('sidebar-path');
        var trigger = document.getElementById('sidebar-hover-trigger');
        var content = document.getElementById('sidebar-content');

        var isHovered = false;
        var progress = 0;
        var lastTime = 0;
        var animationId = null;

        function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

        function ensureAnimating() {
            if (!lastTime) animationId = requestAnimationFrame(drawFrame);
        }

        function setHovered(hovered) {
            isHovered = hovered;
            root.classList.toggle('open', hovered);
            trigger.style.width = (hovered ? SIDEBAR_WIDTH : HANDLE_WIDTH) + 'px';
            ensureAnimating();
        }

        function drawFrame(time) {
            if (!lastTime) lastTime = time;
            var dt = (time - lastTime) / 1000;
            lastTime = time;

            var speed = 1.2;

            if (isHovered) progress = Math.min(1, progress + dt * speed);
            else progress = Math.max(0, progress - dt * speed);

            var eased = easeOutQuart(progress);
            var h = window.innerHeight;
            var cy = h / 2;

            // 1. VERTICAL EXPANSION
            var vertical_progress = Math.min(1, eased * 2);

            var start_curve_y = (cy - (HANDLE_HEIGHT / 2)) * (1 - vertical_progress);
            var end_curve_y = (cy + (HANDLE_HEIGHT / 2)) + ((h - (cy + (HANDLE_HEIGHT / 2))) * vertical_progress);

            // 2. HORIZONTAL EXPANSION
            var base_x = eased * SIDEBAR_WIDTH;
            var ctrl_x;

            if (eased < 0.5) {
                var p1 = eased * 2;
                ctrl_x = HANDLE_WIDTH + p1 * (SIDEBAR_WIDTH + 80 - HANDLE_WIDTH);
                base_x = p1 * p1 * SIDEBAR_WIDTH * 0.3;
            } else {
                var p2 = (eased - 0.5) * 2;
                ctrl_x = (SIDEBAR_WIDTH + 80) - p2 * 80;
                base_x = (SIDEBAR_WIDTH * 0.3) + p2 * (SIDEBAR_WIDTH * 0.7);
            }

            var offset = 0;
            var d;

            if (progress === 0) {
                // Exact rest state: a true semicircle (two 90° arcs, via the
                // standard circle-bezier kappa constant) bulging to the right
                // from the flat page edge — a proper quarter-circle profile
                // top and bottom, not an approximation.
                var R = HANDLE_WIDTH;
                var kappa = 0.5522847498;
                d = `
                    M 0, ${cy - R}
                    C ${kappa * R}, ${cy - R} ${R}, ${cy - kappa * R} ${R}, ${cy}
                    C ${R}, ${cy + kappa * R} ${kappa * R}, ${cy + R} 0, ${cy + R}
                    L 0, ${cy - R}
                    Z
                `;
            } else {
                d = `
                    M ${offset}, ${offset}
                    L ${base_x}, ${offset}
                    L ${base_x}, ${start_curve_y}
                    C ${ctrl_x}, ${start_curve_y} ${ctrl_x}, ${end_curve_y} ${base_x}, ${end_curve_y}
                    L ${base_x}, ${h - offset}
                    L ${offset}, ${h - offset}
                    Z
                `;
            }

            path.setAttribute('d', d);

            if ((isHovered && progress < 1) || (!isHovered && progress > 0)) {
                animationId = requestAnimationFrame(drawFrame);
            } else {
                lastTime = 0;
            }
        }

        trigger.addEventListener('mouseenter', function() { setHovered(true); });
        trigger.addEventListener('mouseleave', function() { setHovered(false); });

        // Keep the shape open while the pointer is over the menu itself
        // (the content area extends beyond the trigger's hit box).
        content.addEventListener('mouseenter', function() { setHovered(true); });
        content.addEventListener('mouseleave', function() { setHovered(false); });

        window.addEventListener('resize', function() {
            if (!lastTime && progress === 0) {
                lastTime = performance.now();
                drawFrame(performance.now());
            }
        });

        requestAnimationFrame(drawFrame);
    }
})();