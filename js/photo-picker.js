/**
 * js/photo-picker.js — photo and document choosers for blog posts (Blog page + Admin).
 *
 *   var picker = PhotoPicker.create(element, { max: 4 });
 *   picker.setImages(post.images);           // photos already on a post
 *   picker.uploadAll(onProgress)             // -> Promise<[{ id, caption, src? }]>
 *   picker.reset();
 *
 *   var docs = FilePicker.create(element, { max: 2 });
 *   docs.setFiles(post.files);               // documents already on a post
 *   docs.uploadAll(onProgress)               // -> Promise<[{ id, name, type, size, src? }]>
 *
 * Photos can be picked or dropped, reordered (the first one is the cover),
 * captioned and removed. Documents (PDF, DOC, DOCX up to 3 MB) can be picked,
 * dropped, reordered and removed. Nothing is uploaded until uploadAll() runs,
 * through SiteStore.uploadImage / uploadFile (js/site-store.js).
 * Styling follows the page's --bg, --border, --accent and --muted colours.
 */
(function(window) {
    'use strict';

    var CSS = [
        '.pp{display:grid;gap:12px}',
        '.pp .pp-drop{position:relative;display:flex;align-items:center;gap:14px;margin:0;padding:16px 18px;border:1px dashed var(--border);border-radius:8px;background:var(--bg);color:inherit;cursor:pointer;transition:border-color .2s,background .2s}',
        '.pp .pp-drop:hover,.pp .pp-drop.is-over{border-color:var(--accent)}',
        '.pp .pp-drop:focus-within{outline:2px solid var(--accent);outline-offset:2px}',
        '.pp .pp-drop.is-full{opacity:.55;cursor:default}',
        '.pp .pp-file{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;padding:0;border:0}',
        '.pp .pp-file:disabled{cursor:default}',
        '.pp .pp-plus{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--accent);color:var(--accent);display:grid;place-items:center;font-size:1.3rem;line-height:1}',
        '.pp .pp-drop-text{display:grid;gap:2px;font-size:.9rem}',
        '.pp .pp-drop-text strong{font-weight:500;color:var(--heading,inherit)}',
        '.pp .pp-hint{color:var(--muted);font-size:.8rem}',
        '.pp .pp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}',
        '.pp .pp-grid:empty{display:none}',
        '.pp .pp-tile{position:relative;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg)}',
        '.pp .pp-thumb{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#000}',
        '.pp .pp-badge{position:absolute;top:8px;left:8px;background:var(--accent);color:#0e0e0f;font-size:.64rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:3px 7px;border-radius:4px}',
        '.pp .pp-new{position:absolute;bottom:42px;left:8px;background:rgba(0,0,0,.65);color:#fff;font-size:.66rem;padding:2px 6px;border-radius:4px}',
        '.pp .pp-tools{position:absolute;top:6px;right:6px;display:flex;gap:4px}',
        '.pp .pp-tool{width:28px;height:28px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.66);color:#fff;font:inherit;font-size:.95rem;line-height:1;cursor:pointer;display:grid;place-items:center}',
        '.pp .pp-tool:hover{background:rgba(0,0,0,.88)}',
        '.pp .pp-tool.pp-remove:hover{background:#b9503f}',
        '.pp .pp-tool:disabled{opacity:.3;cursor:default}',
        '.pp .pp-caption{width:100%;margin:0;padding:8px 10px;border:0;border-top:1px solid var(--border);border-radius:0;background:transparent;color:inherit;font:inherit;font-size:.82rem;box-shadow:none}',
        '.pp .pp-caption:focus{outline:none;background:rgba(255,255,255,.04);box-shadow:inset 0 -2px 0 var(--accent)}',
        '.pp .pp-error{color:#d97f72;font-size:.85rem}',
        '.pp .pp-error:empty{display:none}',
        '.pp .pp-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}',
        '.pp .pp-list:empty{display:none}',
        '.pp .pp-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}',
        '.pp .pp-ext{flex:none;width:42px;height:42px;border-radius:6px;display:grid;place-items:center;font-size:.7rem;font-weight:600;letter-spacing:.06em;color:#0e0e0f;background:var(--accent)}',
        '.pp .pp-ext.is-doc{background:#7fa6d9}',
        '.pp .pp-fmeta{flex:1;min-width:0;display:grid;gap:1px}',
        '.pp .pp-fname{color:var(--heading,inherit);font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.pp .pp-fsize{color:var(--muted);font-size:.76rem}',
        '.pp .pp-row .pp-tool{flex:none;background:transparent;color:var(--muted);border:1px solid var(--border)}',
        '.pp .pp-row .pp-tool:hover{color:#fff;background:rgba(255,255,255,.08)}',
        '.pp .pp-row .pp-tool.pp-remove:hover{background:#b9503f;border-color:#b9503f}'
    ].join('\n');

    function formatSize(bytes) {
        if (!(bytes >= 0)) return '';
        if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    }

    // a drop area with a hidden file input; calls onFiles(FileList)
    function dropArea(title, hint, accept, onFiles) {
        var drop = el('label', 'pp-drop');
        var file = el('input', 'pp-file');
        file.type = 'file';
        file.accept = accept;
        file.multiple = true;
        file.setAttribute('aria-label', title);
        var text = el('span', 'pp-drop-text');
        text.append(el('strong', '', title), el('span', 'pp-hint', hint));
        drop.append(file, el('span', 'pp-plus', '+'), text);
        file.addEventListener('change', function() {
            onFiles(file.files);
            file.value = '';
        });
        drop.addEventListener('dragover', function() { drop.classList.add('is-over'); });
        ['dragleave', 'drop'].forEach(function(t) {
            drop.addEventListener(t, function() { drop.classList.remove('is-over'); });
        });
        return { el: drop, input: file };
    }

    function injectCss() {
        if (document.getElementById('photo-picker-css')) return;
        var s = document.createElement('style');
        s.id = 'photo-picker-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function el(tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text != null) e.textContent = text;
        return e;
    }

    function create(root, opts) {
        opts = opts || {};
        var max = opts.max || 6;
        var store = window.SiteStore;
        // each item: { img: {id, caption, src?} | null, file: File | null, preview: url, caption: '' }
        var items = [];
        var busy = false;

        injectCss();
        root.classList.add('pp');
        root.innerHTML = '';

        var area = dropArea('Add photos',
            'Click or drop JPEG, PNG or WebP · up to ' + max + ' · the first photo is the cover',
            'image/jpeg,image/png,image/webp', add);
        var drop = area.el;
        var file = area.input;

        var grid = el('div', 'pp-grid');
        var error = el('div', 'pp-error');
        error.setAttribute('role', 'alert');
        root.append(drop, grid, error);

        function add(files) {
            error.textContent = '';
            var list = Array.prototype.slice.call(files || []);
            var skipped = [];
            list.forEach(function(f) {
                if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
                    skipped.push('"' + f.name + '" is not a JPEG, PNG or WebP photo.');
                    return;
                }
                if (items.length >= max) {
                    skipped.push('Only ' + max + ' photos per post.');
                    return;
                }
                items.push({ img: null, file: f, preview: URL.createObjectURL(f), caption: '' });
            });
            error.textContent = skipped.filter(function(m, i) { return skipped.indexOf(m) === i; }).join(' ');
            render();
        }

        function release(item) {
            if (item.file && item.preview) URL.revokeObjectURL(item.preview);
        }

        function render() {
            grid.innerHTML = '';
            items.forEach(function(item, i) {
                var tile = el('div', 'pp-tile');

                var thumb = el('img', 'pp-thumb');
                thumb.src = item.preview;
                thumb.alt = item.caption || 'Photo ' + (i + 1);
                thumb.onerror = function() {
                    if (!item.file) return; // an existing photo that can't load right now: keep it
                    error.textContent = '"' + item.file.name + '" could not be read. Use a JPEG, PNG or WebP photo.';
                    remove(item);
                };
                tile.appendChild(thumb);

                if (i === 0) tile.appendChild(el('span', 'pp-badge', 'Cover'));
                if (item.file) tile.appendChild(el('span', 'pp-new', 'New'));

                var tools = el('div', 'pp-tools');
                var left = el('button', 'pp-tool', '‹');
                left.type = 'button';
                left.title = i === 1 ? 'Make cover' : 'Move earlier';
                left.setAttribute('aria-label', left.title);
                left.disabled = busy || i === 0;
                left.addEventListener('click', function() { move(i, -1); });
                var right = el('button', 'pp-tool', '›');
                right.type = 'button';
                right.title = 'Move later';
                right.setAttribute('aria-label', right.title);
                right.disabled = busy || i === items.length - 1;
                right.addEventListener('click', function() { move(i, 1); });
                var rm = el('button', 'pp-tool pp-remove', '×');
                rm.type = 'button';
                rm.title = 'Remove photo';
                rm.setAttribute('aria-label', 'Remove photo ' + (i + 1));
                rm.disabled = busy;
                rm.addEventListener('click', function() { error.textContent = ''; remove(item); });
                if (items.length > 1) tools.append(left, right);
                tools.appendChild(rm);
                tile.appendChild(tools);

                var cap = el('input', 'pp-caption');
                cap.type = 'text';
                cap.maxLength = 200;
                cap.placeholder = 'Caption (optional)';
                cap.setAttribute('aria-label', 'Caption for photo ' + (i + 1));
                cap.value = item.caption;
                cap.disabled = busy;
                cap.addEventListener('input', function() { item.caption = cap.value; });
                tile.appendChild(cap);

                grid.appendChild(tile);
            });
            var full = items.length >= max;
            file.disabled = busy || full;
            drop.classList.toggle('is-full', full);
        }

        function remove(item) {
            var i = items.indexOf(item);
            if (i === -1) return;
            release(item);
            items.splice(i, 1);
            render();
        }

        function move(i, dir) {
            var j = i + dir;
            if (j < 0 || j >= items.length) return;
            var t = items[i];
            items[i] = items[j];
            items[j] = t;
            render();
        }

        return {
            // photos already on a post: [{ id, caption, src? }]
            setImages: function(images) {
                items.forEach(release);
                items = (images || []).map(function(img) {
                    return { img: img, file: null, preview: store.imageUrl(img), caption: img.caption || '' };
                });
                error.textContent = '';
                render();
            },
            reset: function() {
                this.setImages([]);
            },
            count: function() {
                return items.length;
            },
            setBusy: function(on) {
                busy = !!on;
                render();
            },
            // upload new photos one by one; onProgress(n, total) before each
            uploadAll: function(onProgress) {
                var total = items.filter(function(it) { return it.file; }).length;
                var done = 0;
                var chain = Promise.resolve();
                items.forEach(function(item) {
                    if (!item.file) return;
                    chain = chain.then(function() {
                        if (onProgress) onProgress(done + 1, total);
                        return store.uploadImage(item.file).then(function(img) {
                            done++;
                            // remember the upload so a retry after a failed save doesn't send it again
                            URL.revokeObjectURL(item.preview);
                            item.img = img;
                            item.file = null;
                            item.preview = store.imageUrl(img);
                        });
                    });
                });
                return chain.then(function() {
                    render();
                    return items.map(function(item) {
                        var out = { id: item.img.id, caption: item.caption.trim() };
                        if (item.img.src) out.src = item.img.src;
                        return out;
                    });
                });
            }
        };
    }

    function createFiles(root, opts) {
        opts = opts || {};
        var max = opts.max || 4;
        var store = window.SiteStore;
        // each item: { att: {id, name, type, size, src?} | null, file: File | null }
        var items = [];
        var busy = false;

        injectCss();
        root.classList.add('pp');
        root.innerHTML = '';
        var area = dropArea('Attach documents',
            'Click or drop PDF, DOC or DOCX · up to 3 MB each · up to ' + max,
            '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            add);
        var list = el('ul', 'pp-list');
        var error = el('div', 'pp-error');
        error.setAttribute('role', 'alert');
        root.append(area.el, list, error);

        function add(files) {
            var problems = [];
            Array.prototype.slice.call(files || []).forEach(function(f) {
                if (!store.docKind(f.name)) return problems.push('"' + f.name + '" is not a PDF, DOC or DOCX file.');
                if (f.size > store.MAX_FILE_BYTES) return problems.push('"' + f.name + '" is larger than 3 MB.');
                if (items.length >= max) return problems.push('Only ' + max + ' documents per post.');
                items.push({ att: null, file: f });
            });
            error.textContent = problems.filter(function(m, i) { return problems.indexOf(m) === i; }).join(' ');
            render();
        }

        function info(item) {
            return item.file ? { name: item.file.name, size: item.file.size } : item.att;
        }

        function tool(label, title, onClick, disabled, extra) {
            var b = el('button', 'pp-tool' + (extra ? ' ' + extra : ''), label);
            b.type = 'button';
            b.title = title;
            b.setAttribute('aria-label', title);
            b.disabled = disabled;
            b.addEventListener('click', onClick);
            return b;
        }

        function render() {
            list.innerHTML = '';
            items.forEach(function(item, i) {
                var f = info(item);
                var kind = store.docKind(f.name) || 'file';
                var row = el('li', 'pp-row');
                row.appendChild(el('span', 'pp-ext' + (kind === 'pdf' ? '' : ' is-doc'), kind.toUpperCase()));
                var meta = el('span', 'pp-fmeta');
                var name = el('span', 'pp-fname', f.name);
                name.title = f.name;
                meta.append(name, el('span', 'pp-fsize', formatSize(f.size) + (item.file ? ' · new' : '')));
                row.appendChild(meta);
                if (items.length > 1) {
                    row.appendChild(tool('‹', 'Move up', function() { move(i, -1); }, busy || i === 0));
                    row.appendChild(tool('›', 'Move down', function() { move(i, 1); }, busy || i === items.length - 1));
                }
                row.appendChild(tool('×', 'Remove ' + f.name, function() {
                    error.textContent = '';
                    items.splice(items.indexOf(item), 1);
                    render();
                }, busy, 'pp-remove'));
                list.appendChild(row);
            });
            var full = items.length >= max;
            area.input.disabled = busy || full;
            area.el.classList.toggle('is-full', full);
        }

        function move(i, dir) {
            var j = i + dir;
            if (j < 0 || j >= items.length) return;
            var t = items[i];
            items[i] = items[j];
            items[j] = t;
            render();
        }

        return {
            setFiles: function(files) {
                items = (files || []).map(function(f) { return { att: f, file: null }; });
                error.textContent = '';
                render();
            },
            reset: function() {
                this.setFiles([]);
            },
            count: function() {
                return items.length;
            },
            setBusy: function(on) {
                busy = !!on;
                render();
            },
            // upload new documents one by one; onProgress(n, total) before each
            uploadAll: function(onProgress) {
                var total = items.filter(function(it) { return it.file; }).length;
                var done = 0;
                var chain = Promise.resolve();
                items.forEach(function(item) {
                    if (!item.file) return;
                    chain = chain.then(function() {
                        if (onProgress) onProgress(done + 1, total);
                        return store.uploadFile(item.file).then(function(att) {
                            done++;
                            item.att = att; // a retry after a failed save won't send it again
                            item.file = null;
                        });
                    });
                });
                return chain.then(function() {
                    render();
                    return items.map(function(item) { return item.att; });
                });
            }
        };
    }

    window.PhotoPicker = { create: create };
    window.FilePicker = { create: createFiles, formatSize: formatSize };
})(window);
