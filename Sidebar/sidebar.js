const path = document.getElementById('sidebar-path');
const trigger = document.getElementById('hover-trigger');

const SIDEBAR_WIDTH = 200;
const HANDLE_WIDTH = 45;
const HANDLE_HEIGHT = 90;

let isHovered = false;
let progress = 0;
let lastTime = 0;
let animationId = null;

function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

function drawFrame(time) {
    if (!lastTime) lastTime = time;
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    const speed = 1.2;

    if (isHovered) progress = Math.min(1, progress + dt * speed);
    else progress = Math.max(0, progress - dt * speed);

    const eased = easeOutQuart(progress);
    const h = window.innerHeight;
    const cy = h / 2;

    // 1. VERTICAL EXPANSION
    let vertical_progress = Math.min(1, eased * 2);

    const start_curve_y = (cy - (HANDLE_HEIGHT / 2)) * (1 - vertical_progress);
    const end_curve_y = (cy + (HANDLE_HEIGHT / 2)) + ((h - (cy + (HANDLE_HEIGHT / 2))) * vertical_progress);

    // 2. HORIZONTAL EXPANSION
    let base_x = eased * SIDEBAR_WIDTH;
    let ctrl_x;

    if (eased < 0.5) {
        const p = eased * 2;
        ctrl_x = HANDLE_WIDTH + p * (SIDEBAR_WIDTH + 80 - HANDLE_WIDTH);
        base_x = p * p * SIDEBAR_WIDTH * 0.3;
    } else {
        const p = (eased - 0.5) * 2;
        ctrl_x = (SIDEBAR_WIDTH + 80) - p * 80;
        base_x = (SIDEBAR_WIDTH * 0.3) + p * (SIDEBAR_WIDTH * 0.7);
    }

    const offset = 0;

    const d = `
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

trigger.addEventListener('mouseenter', () => {
    isHovered = true;
    trigger.style.width = SIDEBAR_WIDTH + 'px';
    if (!lastTime) animationId = requestAnimationFrame(drawFrame);
});

trigger.addEventListener('mouseleave', () => {
    isHovered = false;
    trigger.style.width = HANDLE_WIDTH + 'px';
    if (!lastTime) animationId = requestAnimationFrame(drawFrame);
});

window.addEventListener('resize', () => {
    if (!lastTime && progress === 0) {
        lastTime = performance.now();
        drawFrame(performance.now());
    }
});

requestAnimationFrame(drawFrame);