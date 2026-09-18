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

    // Shape geometry — same numbers/roles as sidebar.js, widened slightly
    // so the longest label ("Services") has room to breathe.
    var SIDEBAR_WIDTH = 220;
    var HANDLE_WIDTH = 45;
    var HANDLE_HEIGHT = 90;

    /* ---------------------------------------------------------------- */
    /* 1. Inject CSS (same visual language as sidebar.css)               */
    /* ---------------------------------------------------------------- */
    var css = `
#sidebar-widget-root {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
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
    color: #ffffff;
    font-size: 22px;
    font-weight: 600;
    margin: 20px 0;
    cursor: pointer;
    text-decoration: none;
    display: block;
    width: fit-content;
    transition: color 0.2s ease, transform 0.2s ease;
}

.sidebar-menu-item:hover {
    color: #cccccc;
    transform: translateX(5px);
}

.sidebar-menu-item.active {
    color: #cccccc;
    text-decoration: underline;
    text-underline-offset: 4px;
}

/* Closed-state handle: mix-blend-mode makes it render as the visual
   OPPOSITE of whatever is behind it (black on light pages, white on
   dark pages), so it stays visible with no assumptions about the
   page's background. Dimensions/geometry are untouched — only the
   paint changes. The open panel keeps its original tinted-glass look. */
#sidebar-path {
    fill: #ffffff;
    mix-blend-mode: difference;
    filter: none;
    transition: fill 0.25s ease;
}

#sidebar-svg.open #sidebar-path {
    fill: url(#sidebar-black-gradient);
    mix-blend-mode: normal;
    filter: url(#sidebar-shadow);
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
        '<linearGradient id="sidebar-black-gradient" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#000000" stop-opacity="0.30" />' +
        '<stop offset="100%" stop-color="#000000" stop-opacity="0.20" />' +
        '</linearGradient>' +
        '<filter id="sidebar-shadow" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feDropShadow dx="5" dy="0" stdDeviation="15" flood-opacity="0.2" />' +
        '</filter>' +
        '</defs>' +
        '<path id="sidebar-path" fill="url(#sidebar-black-gradient)" filter="url(#sidebar-shadow)" />' +
        '</svg>' +
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
        var svg = document.getElementById('sidebar-svg');
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
            svg.classList.toggle('open', hovered);
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

            var d = `
                M ${offset}, ${offset}
                L ${base_x}, ${offset}
                L ${base_x}, ${start_curve_y}
                C ${ctrl_x}, ${start_curve_y} ${ctrl_x}, ${end_curve_y} ${base_x}, ${end_curve_y}
                L ${base_x}, ${h - offset}
                L ${offset}, ${h - offset}
                Z
            `;

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