/*!
 * sidebar-widget.js
 * Self-contained hover sidebar. The capsule itself grows to wrap tightly
 * around the menu text (closed = small 3-dot rounded rectangle, open =
 * rounded rectangle sized to fit the menu). Drop into any page with:
 *   <script src="sidebar-widget.js"></script>
 */
(function () {
    'use strict';

    if (window.__sidebarWidgetInitialized) return;
    window.__sidebarWidgetInitialized = true;

    // Capture this synchronously, before any async work, so it reliably
    // points at THIS <script> tag regardless of which page included it.
    var __thisScript = document.currentScript;

    /* ---------------------------------------------------------------- */
    /* Edit this list to change the menu — sizing adapts automatically   */
    /* `path` is relative to the SITE ROOT (where index.html lives).     */
    /* ---------------------------------------------------------------- */
    var MENU_ITEMS = [
        { label: 'Home',     path: 'index.html' },
        { label: 'Gallery',  path: 'Gallery/Gallery.html' },
        { label: 'Services', path: 'Services/Services.html' },
        { label: 'Artist',   path: 'Artist/Artist.html' },
        { label: 'Awards',   path: 'Awards/Awards.html' },
        { label: 'Blog',     path: 'Blog/Blog.html' },
        { label: 'Contact',  path: 'Contact/Contact.html' }
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

    var CLOSED_WIDTH = 38;
    var CLOSED_HEIGHT = 100;
    var OPEN_GAP = 38; // gap between the open pill and the page edge
    var SHAPE_RADIUS = 28; // rounded-rectangle corner radius (was 9999px pill)

    /* ---------------------------------------------------------------- */
    /* 1. Inject CSS                                                     */
    /* ---------------------------------------------------------------- */
    var css = `
#sidebar-shape {
    position: fixed;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
    width: ${CLOSED_WIDTH}px;
    height: ${CLOSED_HEIGHT}px;
    border-radius: ${SHAPE_RADIUS}px;
    background: linear-gradient(135deg, rgba(15, 15, 20, 0.55), rgba(15, 15, 20, 0.35));
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    backdrop-filter: blur(16px) saturate(160%);
    border: 2.5px solid rgba(212, 162, 78, 0.85);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), 0 0 10px rgba(212, 162, 78, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    overflow: hidden;
    cursor: pointer;
    z-index: 2147483000;
    box-sizing: border-box;
    transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1),
                height 0.45s cubic-bezier(0.22, 1, 0.36, 1),
                left 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

#sidebar-inner {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

#handle-dots {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    transition: opacity 0.2s ease;
}

#sidebar-shape.open #handle-dots {
    opacity: 0;
}

.handle-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #d4a24e;
    opacity: 0.45;
    animation: sidebar-dot-glow-pulse 2.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.handle-dot:nth-child(2) { animation-delay: 0.4s; }
.handle-dot:nth-child(3) { animation-delay: 0.8s; }

@keyframes sidebar-dot-glow-pulse {
    0%, 100% {
        transform: scale(0.8);
        background: #d4a24e;
        opacity: 0.4;
        filter: drop-shadow(0 0 0px rgba(212, 162, 78, 0));
    }
    35% {
        transform: scale(1.15);
        background: #e9d3ab;
        opacity: 0.85;
        filter: drop-shadow(0 0 2px rgba(230, 200, 140, 0.5)) drop-shadow(0 0 4px rgba(212, 162, 78, 0.3));
    }
    65% {
        transform: scale(1);
        background: #c08f3e;
        opacity: 0.65;
        filter: drop-shadow(0 0 1px rgba(212, 162, 78, 0.25));
    }
}

#sidebar-menu {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 34px;
    padding: 56px 46px;
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
    transition: opacity 0.3s ease 0.1s;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}

#sidebar-shape.open #sidebar-menu {
    opacity: 1;
    pointer-events: auto;
}

.sidebar-menu-item,
.sidebar-menu-item:visited {
    color: #ffffff;
    font-size: 26px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: color 0.2s ease, transform 0.2s ease;
}

.sidebar-menu-item:hover {
    color: #d4a24e;
    transform: translateX(3px);
}

.sidebar-menu-item.active {
    color: #d4a24e;
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

    var menuItemsHtml = MENU_ITEMS.map(function (item) {
        var href = new URL(item.path, SITE_ROOT).href;
        var isCurrent = currentPath.indexOf(item.path.replace(/\\/g, '/')) !== -1 ||
            (item.path === 'index.html' && /\/(index\.html)?$/.test(currentPath));
        var cls = 'sidebar-menu-item' + (isCurrent ? ' active' : '');
        return '<a class="' + cls + '" href="' + href + '">' + item.label + '</a>';
    }).join('');

    var markup =
        '<div id="sidebar-shape">' +
            '<div id="sidebar-inner">' +
                '<div id="handle-dots">' +
                    '<span class="handle-dot"></span>' +
                    '<span class="handle-dot"></span>' +
                    '<span class="handle-dot"></span>' +
                '</div>' +
                '<div id="sidebar-menu">' + menuItemsHtml + '</div>' +
            '</div>' +
        '</div>';

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
    /* 3. Behavior                                                        */
    /* ---------------------------------------------------------------- */
    function initBehavior() {
        var shape = document.getElementById('sidebar-shape');
        var menu = document.getElementById('sidebar-menu');

        var openWidth = 0;
        var openHeight = 0;

        function measure() {
            var rect = menu.getBoundingClientRect();
            openWidth = Math.ceil(rect.width);
            openHeight = Math.ceil(rect.height);
        }

        // Menu is already laid out (opacity 0 still renders geometry), so
        // we can measure its natural size immediately.
        measure();

        shape.addEventListener('mouseenter', function () {
            shape.classList.add('open');
            shape.style.width = openWidth + 'px';
            shape.style.height = openHeight + 'px';
            shape.style.left = OPEN_GAP + 'px';
        });

        shape.addEventListener('mouseleave', function () {
            shape.classList.remove('open');
            shape.style.width = CLOSED_WIDTH + 'px';
            shape.style.height = CLOSED_HEIGHT + 'px';
            shape.style.left = '0px';
        });

        // Re-measure on resize in case of font/layout shifts (e.g. zoom).
        window.addEventListener('resize', function () {
            measure();
            if (shape.classList.contains('open')) {
                shape.style.width = openWidth + 'px';
                shape.style.height = openHeight + 'px';
            }
        });
    }
})();