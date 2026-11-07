/**
 * js/rich-text.js — bold / italic / underline for blog titles and bodies.
 *
 * Stored format: plain text in which only <b>, <i>, <u> (and their closing
 * tags) and the entities &amp; &lt; &gt; have meaning. It is never inserted
 * as HTML: render() rebuilds it from text nodes and those three elements, so
 * nothing else in a post can turn into markup. Old plain-text posts read the
 * same as before.
 *
 *   RichText.render(markup, element, { paragraphs: true })   // show a post
 *   RichText.toPlain(markup)                                // text for search, alt text, counts
 *   var ed = RichText.editor(element, { label, placeholder, multiline, maxPlain, minHeight, onInput })
 *   ed.setValue(markup); ed.getValue(); ed.getPlain(); ed.clear(); ed.focus(); ed.setDisabled(on)
 *
 * The editor is a small contenteditable box with B / I / U buttons
 * (Ctrl+B / Ctrl+I / Ctrl+U also work). Pasted text arrives unformatted.
 */
(function(window) {
    'use strict';

    var TOKEN_RE = /<(\/?)([biu])>|&(amp|lt|gt);/g;
    var ENTITIES = { amp: '&', lt: '<', gt: '>' };

    // markup -> [{ text, b, i, u }]
    function parse(markup) {
        var s = String(markup == null ? '' : markup);
        var depth = { b: 0, i: 0, u: 0 };
        var runs = [];
        var buf = '';
        var last = 0;
        var m;
        function flush() {
            if (buf) runs.push({ text: buf, b: depth.b > 0, i: depth.i > 0, u: depth.u > 0 });
            buf = '';
        }
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(s))) {
            buf += s.slice(last, m.index);
            last = m.index + m[0].length;
            if (m[3]) {
                buf += ENTITIES[m[3]];
                continue;
            }
            flush();
            if (m[1]) {
                if (depth[m[2]] > 0) depth[m[2]]--;
            } else {
                depth[m[2]]++;
            }
        }
        buf += s.slice(last);
        flush();
        return runs;
    }

    function escapeText(t) {
        return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function sameFormat(a, b) {
        return a.b === b.b && a.i === b.i && a.u === b.u;
    }

    // [{ text, b, i, u }] -> markup (adjacent runs with the same formatting merged)
    function serialize(runs) {
        var merged = [];
        runs.forEach(function(r) {
            if (!r.text) return;
            var prev = merged[merged.length - 1];
            if (prev && sameFormat(prev, r)) prev.text += r.text;
            else merged.push({ text: r.text, b: !!r.b, i: !!r.i, u: !!r.u });
        });
        return merged.map(function(r) {
            // bold / italic don't show on spaces, but an underline does: keep only that
            if (!r.text.trim()) return r.u ? '<u>' + escapeText(r.text) + '</u>' : escapeText(r.text);
            var open = (r.b ? '<b>' : '') + (r.i ? '<i>' : '') + (r.u ? '<u>' : '');
            var close = (r.u ? '</u>' : '') + (r.i ? '</i>' : '') + (r.b ? '</b>' : '');
            return open + escapeText(r.text) + close;
        }).join('');
    }

    // drop leading / trailing whitespace across the whole list of runs
    function trimRuns(runs) {
        runs = runs.filter(function(r) { return r.text; });
        while (runs.length && !runs[0].text.replace(/^\s+/, '')) runs.shift();
        while (runs.length && !runs[runs.length - 1].text.replace(/\s+$/, '')) runs.pop();
        if (runs.length) {
            runs[0] = Object.assign({}, runs[0], { text: runs[0].text.replace(/^\s+/, '') });
            var n = runs.length - 1;
            runs[n] = Object.assign({}, runs[n], { text: runs[n].text.replace(/\s+$/, '') });
        }
        return runs;
    }

    function toPlain(markup) {
        return parse(markup).map(function(r) { return r.text; }).join('');
    }

    // append runs to `parent` as text inside <strong>/<em>/<u> (or <b>/<i>/<u> for the editor)
    function appendRuns(parent, runs, editorTags) {
        runs.forEach(function(r) {
            var node = document.createTextNode(r.text);
            if (r.u) node = wrap('u', node);
            if (r.i) node = wrap(editorTags ? 'i' : 'em', node);
            if (r.b) node = wrap(editorTags ? 'b' : 'strong', node);
            parent.appendChild(node);
        });
    }

    function wrap(tag, child) {
        var e = document.createElement(tag);
        e.appendChild(child);
        return e;
    }

    // Show markup inside `container`. With { paragraphs: true }, blank lines
    // start a new <p>; single line breaks stay as they are (use white-space: pre-line).
    function render(markup, container, opts) {
        var runs = parse(markup);
        if (!(opts && opts.paragraphs)) {
            appendRuns(container, trimRuns(runs));
            return container;
        }
        var paras = [
            []
        ];
        runs.forEach(function(r) {
            r.text.split(/\n[ \t]*\n\s*/).forEach(function(piece, k) {
                if (k > 0) paras.push([]);
                if (piece) paras[paras.length - 1].push({ text: piece, b: r.b, i: r.i, u: r.u });
            });
        });
        paras.forEach(function(p) {
            p = trimRuns(p);
            if (!p.length) return;
            var el = document.createElement('p');
            appendRuns(el, p);
            container.appendChild(el);
        });
        return container;
    }

    /* ---------- editor ---------- */

    var CSS = [
        '.rt{border:1px solid var(--border);border-radius:6px;background:var(--bg);transition:border-color .2s,box-shadow .2s}',
        '.rt:focus-within{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}',
        '.rt.is-over{border-color:#d97f72}',
        '.rt.is-disabled{opacity:.6}',
        '.rt-bar{display:flex;align-items:center;gap:2px;padding:4px 6px;border-bottom:1px solid var(--border)}',
        '.rt-btn{width:30px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted);font:inherit;font-size:.95rem;line-height:1;cursor:pointer;transition:color .15s,background .15s}',
        '.rt-btn:hover{color:var(--heading,#fff);background:rgba(255,255,255,.06)}',
        '.rt-btn[aria-pressed="true"]{color:var(--accent);background:rgba(201,169,106,.16)}',
        '.rt-btn:disabled{opacity:.4;cursor:default}',
        '.rt-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
        '.rt-bold{font-weight:700}',
        '.rt-italic{font-style:italic;font-family:Georgia,"Times New Roman",serif}',
        '.rt-underline{text-decoration:underline;text-underline-offset:.15em}',
        '.rt-count{margin-left:auto;padding-right:4px;color:var(--muted);font-size:.75rem}',
        '.rt.is-over .rt-count{color:#d97f72}',
        '.rt-area{position:relative;padding:11px 14px;min-height:1.6em;line-height:1.6;outline:none;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text}',
        '.rt-area.rt-multi{min-height:150px;max-height:440px;overflow-y:auto}',
        '.rt-area.is-empty::before{content:attr(data-placeholder);position:absolute;left:14px;top:11px;right:14px;color:var(--muted);opacity:.8;pointer-events:none}',
        '.rt-area b,.rt-area strong{font-weight:700}',
        '.rt-area u{text-underline-offset:.15em}'
    ].join('\n');

    function injectCss() {
        if (document.getElementById('rich-text-css')) return;
        var s = document.createElement('style');
        s.id = 'rich-text-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    var BLOCK_RE = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TR)$/;

    // editor DOM -> runs (handles the <div> / <br> lines browsers create on Enter)
    function readRuns(root) {
        var out = [];
        var lastChar = '';
        function push(text, f) {
            if (!text) return;
            out.push({ text: text, b: f.b, i: f.i, u: f.u });
            lastChar = text.charAt(text.length - 1);
        }
        function walk(node, f) {
            for (var c = node.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) {
                    push(c.nodeValue.replace(/ /g, ' ').replace(/​/g, ''), f);
                    continue;
                }
                if (c.nodeType !== 1) continue;
                var tag = c.nodeName;
                if (tag === 'BR') {
                    push('\n', f);
                    continue;
                }
                if (BLOCK_RE.test(tag) && lastChar && lastChar !== '\n') push('\n', f);
                var st = c.style || {};
                var deco = st.textDecorationLine || st.textDecoration || '';
                walk(c, {
                    b: f.b || tag === 'B' || tag === 'STRONG' || st.fontWeight === 'bold' || parseInt(st.fontWeight, 10) >= 600,
                    i: f.i || tag === 'I' || tag === 'EM' || st.fontStyle === 'italic',
                    u: f.u || tag === 'U' || /underline/.test(deco)
                });
            }
        }
        walk(root, { b: false, i: false, u: false });
        return out;
    }

    function editor(host, opts) {
        opts = opts || {};
        injectCss();
        try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* older browsers */ }

        var multiline = !!opts.multiline;
        host.classList.add('rt');
        host.innerHTML = '';

        var bar = document.createElement('div');
        bar.className = 'rt-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', (opts.label || 'Text') + ' formatting');

        var area = document.createElement('div');
        area.className = 'rt-area' + (multiline ? ' rt-multi' : '');
        area.contentEditable = 'true';
        area.spellcheck = true;
        area.setAttribute('role', 'textbox');
        area.setAttribute('aria-label', opts.label || 'Text');
        if (multiline) area.setAttribute('aria-multiline', 'true');
        area.dataset.placeholder = opts.placeholder || '';
        if (opts.minHeight) area.style.minHeight = opts.minHeight + 'px';

        var buttons = [
            ['bold', 'B', 'Bold (Ctrl+B)'],
            ['italic', 'I', 'Italic (Ctrl+I)'],
            ['underline', 'U', 'Underline (Ctrl+U)']
        ].map(function(def) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'rt-btn rt-' + def[0];
            b.textContent = def[1];
            b.title = def[2];
            b.setAttribute('aria-label', def[2]);
            b.setAttribute('aria-pressed', 'false');
            // keep the text selection when the button is pressed
            b.addEventListener('mousedown', function(e) { e.preventDefault(); });
            b.addEventListener('click', function() {
                if (document.activeElement !== area) area.focus();
                document.execCommand(def[0], false, null);
                syncButtons();
                changed();
            });
            bar.appendChild(b);
            return { cmd: def[0], el: b };
        });

        var count = null;
        if (opts.maxPlain) {
            count = document.createElement('span');
            count.className = 'rt-count';
            bar.appendChild(count);
        }

        host.append(bar, area);

        function syncButtons() {
            var sel = window.getSelection();
            var inside = sel && sel.anchorNode && area.contains(sel.anchorNode);
            buttons.forEach(function(b) {
                var on = false;
                if (inside) {
                    try { on = document.queryCommandState(b.cmd); } catch (e) { /* unsupported */ }
                }
                b.el.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }

        // fromCode: a value set by setValue() — refresh the look, but don't report it as typing
        function changed(fromCode) {
            var plain = api.getPlain();
            area.classList.toggle('is-empty', !plain);
            if (count) {
                count.textContent = plain.length + ' / ' + opts.maxPlain;
                host.classList.toggle('is-over', plain.length > opts.maxPlain);
            }
            if (opts.onInput && fromCode !== true) opts.onInput(plain);
        }

        area.addEventListener('input', function() { changed(); });
        area.addEventListener('keyup', syncButtons);
        area.addEventListener('mouseup', syncButtons);
        area.addEventListener('focus', syncButtons);
        document.addEventListener('selectionchange', function() {
            if (document.activeElement === area) syncButtons();
        });

        area.addEventListener('keydown', function(e) {
            if (!multiline && e.key === 'Enter') e.preventDefault(); // a title is one line
        });

        // pasted text comes in without outside formatting, colours or links
        area.addEventListener('paste', function(e) {
            e.preventDefault();
            var t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
            t = t.replace(/\r\n?/g, '\n');
            if (!multiline) t = t.replace(/\s*\n\s*/g, ' ');
            document.execCommand('insertText', false, t);
        });
        area.addEventListener('drop', function(e) { e.preventDefault(); });

        var api = {
            getValue: function() {
                return serialize(trimRuns(readRuns(area)));
            },
            getPlain: function() {
                return toPlain(this.getValue());
            },
            setValue: function(markup) {
                area.innerHTML = '';
                appendRuns(area, parse(markup), true);
                changed(true);
            },
            clear: function() {
                this.setValue('');
            },
            focus: function() {
                area.focus();
            },
            isTooLong: function() {
                return !!opts.maxPlain && this.getPlain().length > opts.maxPlain;
            },
            setDisabled: function(on) {
                area.contentEditable = on ? 'false' : 'true';
                host.classList.toggle('is-disabled', !!on);
                buttons.forEach(function(b) { b.el.disabled = !!on; });
            }
        };

        // clicking a <label for> the host's id focuses the box, like a normal field
        if (host.id) {
            document.querySelectorAll('label[for="' + host.id + '"]').forEach(function(l) {
                l.addEventListener('click', function(e) {
                    e.preventDefault();
                    area.focus();
                });
            });
        }

        api.setValue(opts.value || '');
        return api;
    }

    window.RichText = {
        parse: parse,
        serialize: serialize,
        toPlain: toPlain,
        render: render,
        editor: editor
    };
})(window);
