/* api/api.js — the site's small backend, run by Vercel at /api/api
 *
 * Stores contact messages and blog posts in an Upstash Redis database and
 * lets the admin page (Admin.html) read and manage them.
 *
 * Setup in the Vercel dashboard (Project → Settings):
 *   1. Storage / Marketplace → add "Upstash for Redis" (free) and connect it
 *      to this project. That adds KV_REST_API_URL and KV_REST_API_TOKEN.
 *   2. Environment Variables → add ADMIN_PASSWORD (the admin login password).
 *   3. Redeploy.
 *
 * Every call is  /api/api?action=<name>  and answers JSON: { ok: true, ... }
 * or { ok: false, error: "..." }.
 *
 *   Public:  public_posts (GET), image and file (GET, return the file itself),
 *            submit_contact, submit_post, upload_image, upload_file (POST)
 *   Admin:   login, logout (POST), admin_data (GET), set_contact_read,
 *            delete_contact, create_post, set_post_status, update_post,
 *            delete_post, sync_posts (POST)
 *
 * Blog photos: the browser shrinks each photo to a JPEG of at most ~600 KB
 * and sends it to upload_image, which stores it under img:<id> with a 24-hour
 * expiry and returns the id. A post lists its photos as [{ id, caption }];
 * saving the post keeps those photos for good, and removing a photo from a
 * post or deleting the post deletes the photo too. Photos uploaded but never
 * attached to a post expire on their own. Photos are served from
 * /api/api?action=image&id=<id>.
 *
 * Blog documents (PDF, DOC, DOCX, up to 3 MB) work the same way through
 * upload_file: each is a hash file:<id> holding its details ("meta") and the
 * file in pieces of 512 KB ("c0", "c1", …) so no single storage request gets
 * too large. A post lists them as [{ id, name, type, size }]. They are served
 * from /api/api?action=file&id=<id>: PDFs open in the browser, Word files
 * download (add &download=1 to download a PDF too).
 */
'use strict';

const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL || process.env.STORAGE_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.STORAGE_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const CONTACTS = 'contacts'; // hash: id -> JSON message
const POSTS = 'posts'; // hash: id -> JSON post
const SESSION_COOKIE = 'admin_session';
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds an admin stays logged in

const IMG = 'img:'; // string: img:<id> -> "<mime>;<base64>"
const UNATTACHED_TTL = 24 * 60 * 60; // seconds an uploaded photo waits to be attached to a post
const MAX_IMAGE_BYTES = 640 * 1024; // per photo, after the browser has shrunk it
const MAX_ADMIN_IMAGES = 12; // photos per post written by the admin
const MAX_GUEST_IMAGES = 4; // photos per guest submission
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const FILE = 'file:'; // hash: meta -> JSON { name, type, size, chunks }, c0..cN -> base64 pieces
const MAX_FILE_BYTES = 3 * 1024 * 1024; // Vercel accepts request bodies up to 4.5 MB; base64 adds a third
const FILE_CHUNK = 512 * 1024;
const MAX_ADMIN_FILES = 6; // documents per post written by the admin
const MAX_GUEST_FILES = 2; // documents per guest submission
const DOC_TYPES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/* ---------- Redis (Upstash REST) ---------- */

async function redis(command) {
    if (!REDIS_URL || !REDIS_TOKEN) {
        throw new HttpError(500, 'Storage is not set up yet: connect "Upstash for Redis" to this project in Vercel, then redeploy.');
    }
    const r = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(command)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error('Storage error: ' + (data.error || r.status));
    return data.result;
}

// several commands in one round trip; returns each command's result
async function redisPipeline(commands) {
    if (!commands.length) return [];
    if (!REDIS_URL || !REDIS_TOKEN) {
        throw new HttpError(500, 'Storage is not set up yet: connect "Upstash for Redis" to this project in Vercel, then redeploy.');
    }
    const r = await fetch(REDIS_URL.replace(/\/+$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands)
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(data)) throw new Error('Storage error: ' + ((data && data.error) || r.status));
    return data.map((d) => {
        if (d && d.error) throw new Error('Storage error: ' + d.error);
        return d ? d.result : null;
    });
}

async function getAll(hash) {
    const flat = (await redis(['HGETALL', hash])) || [];
    const items = [];
    for (let i = 1; i < flat.length; i += 2) {
        try { items.push(JSON.parse(flat[i])); } catch (e) { /* skip a damaged entry */ }
    }
    return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function getOne(hash, id) {
    const raw = await redis(['HGET', hash, String(id)]);
    if (!raw) throw new HttpError(404, 'That item no longer exists. Refresh the page.');
    return JSON.parse(raw);
}

function put(hash, item) {
    return redis(['HSET', hash, item.id, JSON.stringify(item)]);
}

/* ---------- blog photos ---------- */

// the post's photo list as sent by the browser -> [{ id, caption }], ids checked
function cleanImages(raw, max) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const im of raw) {
        const id = im && typeof im.id === 'string' ? im.id.trim().toLowerCase() : '';
        if (!UUID_RE.test(id) || seen.has(id)) continue; // photos kept only in a browser have no server id
        seen.add(id);
        out.push({ id, caption: typeof im.caption === 'string' ? im.caption.trim().slice(0, 200) : '' });
    }
    if (out.length > max) throw new HttpError(400, 'A post can have up to ' + max + ' photos.');
    return out;
}

// make the photos permanent and drop any that have already expired
async function keepImages(images) {
    if (!images.length) return [];
    const results = await redisPipeline(
        images.map((im) => ['PERSIST', IMG + im.id]).concat(images.map((im) => ['EXISTS', IMG + im.id]))
    );
    return images.filter((im, i) => results[images.length + i] === 1);
}

async function deleteImages(ids) {
    const keys = ids.filter((id) => UUID_RE.test(String(id))).map((id) => IMG + id);
    if (keys.length) await redis(['DEL'].concat(keys));
}

// the file's real type from its first bytes, whatever the browser claimed
function sniffImage(buf) {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return '';
}

async function serveImage(req, res) {
    const fail = (status, message) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(message);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET');
        return fail(405, 'Use GET for this action.');
    }
    const id = String((req.query && req.query.id) || '').toLowerCase();
    if (!UUID_RE.test(id)) return fail(404, 'Photo not found.');
    try {
        const raw = await redis(['GET', IMG + id]);
        const cut = raw ? raw.indexOf(';') : -1;
        if (cut < 1) return fail(404, 'Photo not found.');
        const buf = Buffer.from(raw.slice(cut + 1), 'base64');
        res.statusCode = 200;
        res.setHeader('Content-Type', raw.slice(0, cut));
        res.setHeader('Content-Length', buf.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // an id always points at the same photo: browsers keep it a year; the
        // Vercel CDN re-checks daily so a deleted photo stops being served
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=86400, immutable');
        res.end(req.method === 'HEAD' ? undefined : buf);
    } catch (err) {
        console.error(err);
        fail(500, 'The photo could not be loaded.');
    }
}

/* ---------- blog documents ---------- */

// the post's document list as sent by the browser -> checked ids
function cleanFileIds(raw, max) {
    if (!Array.isArray(raw)) return [];
    const ids = [];
    for (const f of raw) {
        const id = f && typeof f.id === 'string' ? f.id.trim().toLowerCase() : '';
        if (UUID_RE.test(id) && !ids.includes(id)) ids.push(id); // files kept only in a browser have no server id
    }
    if (ids.length > max) throw new HttpError(400, 'A post can have up to ' + max + ' documents.');
    return ids;
}

// make the documents permanent; name, type and size come from what was stored, not the browser
async function keepFiles(ids) {
    if (!ids.length) return [];
    const metas = await redisPipeline(ids.map((id) => ['HGET', FILE + id, 'meta']));
    const out = [];
    ids.forEach((id, i) => {
        try {
            const m = JSON.parse(metas[i]);
            if (m && m.name) out.push({ id, name: m.name, type: m.type, size: m.size });
        } catch (e) { /* expired or damaged: leave it out */ }
    });
    if (out.length) await redisPipeline(out.map((f) => ['PERSIST', FILE + f.id]));
    return out;
}

async function deleteFiles(ids) {
    const keys = ids.filter((id) => UUID_RE.test(String(id))).map((id) => FILE + id);
    if (keys.length) await redis(['DEL'].concat(keys));
}

// the document's real type from its first bytes -> 'pdf' | 'doc' | 'docx' | ''
function sniffDoc(buf) {
    if (buf.length > 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'doc';
    // a .docx is a zip whose entries live under word/
    if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50 && buf.includes('word/')) return 'docx';
    return '';
}

// a safe display / download name ending in the file's real extension
function cleanFileName(raw, ext) {
    let name = String(raw || '').split(/[\\/]/).pop();
    name = name.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim();
    name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 110).trim() || 'document';
    return name + '.' + ext;
}

async function serveFile(req, res) {
    const fail = (status, message) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(message);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET');
        return fail(405, 'Use GET for this action.');
    }
    const id = String((req.query && req.query.id) || '').toLowerCase();
    if (!UUID_RE.test(id)) return fail(404, 'Document not found.');
    try {
        let meta = null;
        try { meta = JSON.parse(await redis(['HGET', FILE + id, 'meta'])); } catch (e) { /* missing */ }
        if (!meta || !meta.chunks) return fail(404, 'Document not found.');
        const parts = [];
        // one piece per request keeps every storage response small
        for (let i = 0; i < meta.chunks; i++) {
            const piece = await redis(['HGET', FILE + id, 'c' + i]);
            if (!piece) return fail(404, 'Document not found.');
            parts.push(Buffer.from(piece, 'base64'));
        }
        const buf = Buffer.concat(parts);
        const inline = meta.type === DOC_TYPES.pdf && !(req.query && req.query.download);
        const ascii = meta.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
        res.statusCode = 200;
        res.setHeader('Content-Type', meta.type);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') +
            '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(meta.name));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=86400, immutable');
        res.end(req.method === 'HEAD' ? undefined : buf);
    } catch (err) {
        console.error(err);
        fail(500, 'The document could not be loaded.');
    }
}

// allow `limit` calls per `windowSec` for each visitor and kind of action
async function rateLimit(req, kind, limit, windowSec) {
    const key = 'rate:' + kind + ':' + clientIp(req);
    const count = await redis(['INCR', key]);
    if (count === 1) await redis(['EXPIRE', key, windowSec]);
    if (count > limit) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}

/* ---------- request helpers ---------- */

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (fwd ? String(fwd).split(',')[0] : req.headers['x-real-ip'] || 'unknown').trim();
}

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function body(req) {
    // JSON only: a plain cross-site form can't send this content type
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new HttpError(415, 'Send the request as JSON.');
    }
    let b;
    try {
        b = req.body;
    } catch (e) {
        throw new HttpError(400, 'Invalid JSON body in request.');
    }
    if (typeof b === 'string') {
        try { b = JSON.parse(b); } catch (e) { b = null; }
    }
    if (!b || typeof b !== 'object') throw new HttpError(400, 'The request was empty.');
    return b;
}

// trimmed text field; `max` characters, required unless `optional`
function text(b, key, max, label, optional) {
    const v = typeof b[key] === 'string' ? b[key].trim() : '';
    if (!v && !optional) throw new HttpError(400, 'Add ' + label + '.');
    if (v.length > max) throw new HttpError(400, label.charAt(0).toUpperCase() + label.slice(1) + ' is too long (up to ' + max + ' characters).');
    return v;
}

// A post title or body may carry <b>, <i>, <u> and &amp; &lt; &gt; from the
// formatting editor (js/rich-text.js); the pages only ever rebuild those, never
// insert the text as HTML. Limits count the visible text, not the tags.
function plainText(s) {
    return s.replace(/<\/?[biu]>/g, '').replace(/&(?:amp|lt|gt);/g, '&');
}

function richText(b, key, max, label, optional) {
    const v = text(b, key, max * 4, label, optional);
    const visible = plainText(v).trim();
    if (!visible && !optional) throw new HttpError(400, 'Add ' + label + '.');
    if (visible.length > max) throw new HttpError(400, label.charAt(0).toUpperCase() + label.slice(1) + ' is too long (up to ' + max + ' characters).');
    return v;
}

function sha256(s) {
    return crypto.createHash('sha256').update(String(s)).digest();
}

/* ---------- admin session ---------- */

async function isAdmin(req) {
    let token = req.headers['x-admin-token'] || '';
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7).trim();
    }
    if (!token) {
        token = readCookie(req, SESSION_COOKIE);
    }
    return /^[0-9a-f]{64}$/.test(token) && Boolean(await redis(['GET', 'session:' + token]));
}

async function requireAdmin(req) {
    if (!(await isAdmin(req))) throw new HttpError(401, 'Please log in.');
}

function sessionCookie(token, maxAge, req) {
    const isHttps = Boolean(req && (req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on'));
    return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax;' + (isHttps ? ' Secure;' : '') + ' Max-Age=' + maxAge;
}

/* ---------- actions ---------- */

const actions = {
    /* ----- public ----- */

    async public_posts() {
        const posts = (await getAll(POSTS)).filter((p) => p.status === 'approved');
        return {
            posts: posts.map((p) => ({
                id: p.id,
                title: p.title,
                author: p.author,
                body: p.body,
                date: p.date,
                category: p.category || 'Field Notes',
                images: (p.images || []).map((im) => ({ id: im.id, caption: im.caption || '' })),
                files: (p.files || []).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size }))
            }))
        };
    },

    async submit_contact(req) {
        const b = body(req);
        if (b.website) return {}; // honeypot filled in: a bot, quietly drop it
        const msg = {
            id: crypto.randomUUID(),
            name: text(b, 'name', 100, 'your name'),
            email: text(b, 'email', 200, 'your email address'),
            phone: text(b, 'phone', 40, 'the phone number', true),
            topic: text(b, 'topic', 60, 'the topic', true),
            message: text(b, 'message', 5000, 'a message'),
            read: false,
            createdAt: new Date().toISOString()
        };
        if (!EMAIL_RE.test(msg.email)) throw new HttpError(400, 'Enter a valid email address.');
        await rateLimit(req, 'contact', 5, 10 * 60);
        await put(CONTACTS, msg);
        return {};
    },

    async submit_post(req) {
        const b = body(req);
        if (b.website) return {};
        const now = new Date().toISOString();
        const post = {
            id: crypto.randomUUID(),
            title: richText(b, 'title', 90, 'a title'),
            author: text(b, 'author', 50, 'your name'),
            body: richText(b, 'body', 20000, 'the post text'),
            category: text(b, 'category', 50, 'a category', true) || 'Guest Post',
            images: cleanImages(b.images, MAX_GUEST_IMAGES),
            files: cleanFileIds(b.files, MAX_GUEST_FILES),
            status: 'pending',
            date: now.slice(0, 10),
            createdAt: now
        };
        await rateLimit(req, 'post', 3, 10 * 60);
        post.images = await keepImages(post.images);
        post.files = await keepFiles(post.files);
        await put(POSTS, post);
        return {};
    },

    async upload_file(req) {
        const b = body(req);
        if (!(await isAdmin(req))) await rateLimit(req, 'file', 6, 10 * 60);
        const m = /^data:[^;,]*;base64,([A-Za-z0-9+/]+=*)$/.exec(typeof b.data === 'string' ? b.data : '');
        if (!m) throw new HttpError(400, 'Send the file as a PDF or Word document.');
        if (m[1].length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
            throw new HttpError(413, 'That file is too large (up to ' + MAX_FILE_BYTES / 1024 / 1024 + ' MB).');
        }
        const buf = Buffer.from(m[1], 'base64');
        const ext = sniffDoc(buf);
        if (!ext) throw new HttpError(400, 'Only PDF, DOC and DOCX files can be attached.');
        const meta = {
            name: cleanFileName(b.name, ext),
            type: DOC_TYPES[ext],
            size: buf.length,
            chunks: Math.max(1, Math.ceil(buf.length / FILE_CHUNK))
        };
        const id = crypto.randomUUID();
        const key = FILE + id;
        // the expiry is set before the pieces, so a half-finished upload still cleans itself up
        await redis(['HSET', key, 'meta', JSON.stringify(meta)]);
        await redis(['EXPIRE', key, UNATTACHED_TTL]);
        for (let i = 0; i < meta.chunks; i++) {
            await redis(['HSET', key, 'c' + i, buf.subarray(i * FILE_CHUNK, (i + 1) * FILE_CHUNK).toString('base64')]);
        }
        return { file: { id, name: meta.name, type: meta.type, size: meta.size } };
    },

    async upload_image(req) {
        const b = body(req);
        if (!(await isAdmin(req))) await rateLimit(req, 'image', 12, 10 * 60);
        const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+=*)$/.exec(typeof b.data === 'string' ? b.data : '');
        if (!m) throw new HttpError(400, 'Send the photo as a JPEG, PNG or WebP image.');
        if (m[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
            throw new HttpError(413, 'That photo is too large (up to ' + Math.round(MAX_IMAGE_BYTES / 1024) + ' KB after resizing).');
        }
        const buf = Buffer.from(m[1], 'base64');
        const type = sniffImage(buf);
        if (!type) throw new HttpError(400, 'That file is not a JPEG, PNG or WebP image.');
        const id = crypto.randomUUID();
        await redis(['SET', IMG + id, type + ';' + buf.toString('base64'), 'EX', UNATTACHED_TTL]);
        return { image: { id } };
    },

    /* ----- admin ----- */

    async login(req, res) {
        if (!ADMIN_PASSWORD) {
            throw new HttpError(500, 'No admin password is set: add ADMIN_PASSWORD under Environment Variables in Vercel, then redeploy.');
        }
        const b = body(req);
        await rateLimit(req, 'login', 10, 15 * 60);
        const given = typeof b.password === 'string' ? b.password : '';
        if (!crypto.timingSafeEqual(sha256(given), sha256(ADMIN_PASSWORD))) {
            throw new HttpError(401, 'That password is not right.');
        }
        const token = crypto.randomBytes(32).toString('hex');
        await redis(['SET', 'session:' + token, '1', 'EX', SESSION_TTL]);
        res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL, req));
        return { token };
    },

    async logout(req, res) {
        let token = req.headers['x-admin-token'] || '';
        if (!token) token = readCookie(req, SESSION_COOKIE);
        if (/^[0-9a-f]{64}$/.test(token)) await redis(['DEL', 'session:' + token]);
        res.setHeader('Set-Cookie', sessionCookie('', 0, req));
        return {};
    },

    async admin_data(req) {
        await requireAdmin(req);
        const [contacts, posts] = await Promise.all([getAll(CONTACTS), getAll(POSTS)]);
        return { contacts, posts };
    },

    async set_contact_read(req) {
        await requireAdmin(req);
        const b = body(req);
        const msg = await getOne(CONTACTS, b.id);
        msg.read = !!b.read;
        await put(CONTACTS, msg);
        return {};
    },

    async delete_contact(req) {
        await requireAdmin(req);
        await redis(['HDEL', CONTACTS, String(body(req).id)]);
        return {};
    },

    async create_post(req) {
        await requireAdmin(req);
        const b = body(req);
        const now = new Date().toISOString();
        const post = {
            id: (typeof b.id === 'string' && b.id.trim()) ? b.id.trim() : crypto.randomUUID(),
            title: richText(b, 'title', 90, 'a title'),
            author: text(b, 'author', 50, "the author's name"),
            body: richText(b, 'body', 20000, 'the post text'),
            category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
            images: await keepImages(cleanImages(b.images, MAX_ADMIN_IMAGES)),
            files: await keepFiles(cleanFileIds(b.files, MAX_ADMIN_FILES)),
            status: b.status === 'approved' ? 'approved' : (b.status === 'draft' ? 'draft' : 'pending'),
            date: b.date || now.slice(0, 10),
            createdAt: b.createdAt || now
        };
        await put(POSTS, post);
        return { post };
    },

    async set_post_status(req) {
        await requireAdmin(req);
        const b = body(req);
        if (b.status !== 'pending' && b.status !== 'approved' && b.status !== 'draft') throw new HttpError(400, 'Unknown status.');
        let post;
        try {
            post = await getOne(POSTS, b.id);
            post.status = b.status;
        } catch (e) {
            // Upsert if post wasn't in Redis yet but full post content was provided
            if (b.title && b.body) {
                const now = new Date().toISOString();
                post = {
                    id: String(b.id || crypto.randomUUID()),
                    title: richText(b, 'title', 90, 'a title'),
                    author: text(b, 'author', 50, "the author's name", true) || 'Sanjay Patil',
                    body: richText(b, 'body', 20000, 'the post text'),
                    category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
                    images: await keepImages(cleanImages(b.images, MAX_ADMIN_IMAGES)),
                    files: await keepFiles(cleanFileIds(b.files, MAX_ADMIN_FILES)),
                    status: b.status,
                    date: b.date || now.slice(0, 10),
                    createdAt: b.createdAt || now
                };
            } else {
                throw e;
            }
        }
        await put(POSTS, post);
        return { post };
    },

    async update_post(req) {
        await requireAdmin(req);
        const b = body(req);
        let post;
        let oldImages = [];
        let oldFiles = [];
        try {
            post = await getOne(POSTS, b.id);
            oldImages = post.images || [];
            oldFiles = post.files || [];
            post.title = richText(b, 'title', 90, 'a title');
            post.author = text(b, 'author', 50, "the author's name");
            post.body = richText(b, 'body', 20000, 'the post text');
            if (b.category != null) post.category = text(b, 'category', 50, 'a category', true);
            if (b.date) post.date = b.date;
            if (b.status) post.status = b.status;
        } catch (e) {
            const now = new Date().toISOString();
            post = {
                id: String(b.id || crypto.randomUUID()),
                title: richText(b, 'title', 90, 'a title'),
                author: text(b, 'author', 50, "the author's name", true) || 'Sanjay Patil',
                body: richText(b, 'body', 20000, 'the post text'),
                category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
                images: [],
                files: [],
                status: b.status || 'approved',
                date: b.date || now.slice(0, 10),
                createdAt: now
            };
        }
        // lists left out of the request stay as they are
        const dropImages = [];
        const dropFiles = [];
        if (Array.isArray(b.images)) {
            post.images = await keepImages(cleanImages(b.images, MAX_ADMIN_IMAGES));
            const kept = new Set(post.images.map((im) => im.id));
            oldImages.forEach((im) => { if (!kept.has(im.id)) dropImages.push(im.id); });
        }
        if (Array.isArray(b.files)) {
            post.files = await keepFiles(cleanFileIds(b.files, MAX_ADMIN_FILES));
            const kept = new Set(post.files.map((f) => f.id));
            oldFiles.forEach((f) => { if (!kept.has(f.id)) dropFiles.push(f.id); });
        }
        await put(POSTS, post);
        // photos and documents taken out of the post are deleted once the post no longer points at them
        await deleteImages(dropImages);
        await deleteFiles(dropFiles);
        return { post };
    },

    async delete_post(req) {
        await requireAdmin(req);
        const id = String(body(req).id);
        const raw = await redis(['HGET', POSTS, id]);
        await redis(['HDEL', POSTS, id]);
        if (raw) {
            let old = {};
            try { old = JSON.parse(raw) || {}; } catch (e) { /* damaged entry: nothing to clean up */ }
            await deleteImages((old.images || []).map((im) => im.id));
            await deleteFiles((old.files || []).map((f) => f.id));
        }
        return {};
    },

    async sync_posts(req) {
        await requireAdmin(req);
        const b = body(req);
        const incoming = Array.isArray(b.posts) ? b.posts : [];
        const existing = new Map((await getAll(POSTS)).map((p) => [String(p.id), p]));
        let count = 0;
        for (const p of incoming) {
            if (!p.title || !p.body) continue;
            const now = new Date().toISOString();
            const record = {
                id: String(p.id || crypto.randomUUID()),
                title: String(p.title).trim(),
                author: String(p.author || 'Sanjay Patil').trim(),
                body: String(p.body).trim(),
                category: String(p.category || 'Field Notes').trim(),
                status: (p.status === 'approved' || p.status === 'draft') ? p.status : 'pending',
                date: p.date || now.slice(0, 10),
                createdAt: p.createdAt || now
            };
            // photos kept only in a browser can't be synced, and the server's own photos are never dropped here
            let images = [];
            try { images = await keepImages(cleanImages(p.images, MAX_ADMIN_IMAGES)); } catch (e) { /* bad list: keep the server's */ }
            let files = [];
            try { files = await keepFiles(cleanFileIds(p.files, MAX_ADMIN_FILES)); } catch (e) { /* bad list: keep the server's */ }
            const prev = existing.get(record.id);
            record.images = images.length ? images : ((prev && prev.images) || []);
            record.files = files.length ? files : ((prev && prev.files) || []);
            await put(POSTS, record);
            count++;
        }
        const allPosts = await getAll(POSTS);
        return { synced: count, posts: allPosts };
    }
};

const GET_ACTIONS = ['public_posts', 'admin_data'];

module.exports = async function handler(req, res) {
    // photos and documents are sent as their own bytes, not JSON
    const raw = String((req.query && req.query.action) || '');
    if (raw === 'image') return serveImage(req, res);
    if (raw === 'file') return serveFile(req, res);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, data) => {
        res.statusCode = status;
        res.end(JSON.stringify(data));
    };

    const name = String((req.query && req.query.action) || '');
    const action = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : null;
    if (!action) return send(404, { ok: false, error: 'Unknown action.' });

    const method = GET_ACTIONS.includes(name) ? 'GET' : 'POST';
    if (req.method !== method) {
        res.setHeader('Allow', method);
        return send(405, { ok: false, error: 'Use ' + method + ' for this action.' });
    }

    try {
        const result = await action(req, res);
        send(200, Object.assign({ ok: true }, result));
    } catch (err) {
        if (err instanceof HttpError) return send(err.status, { ok: false, error: err.message });
        console.error(err);
        send(500, { ok: false, error: 'Something went wrong on the server. Please try again.' });
    }
};
