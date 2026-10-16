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
 *   Public:  public_posts (GET), submit_contact (POST), submit_post (POST)
 *   Admin:   login, logout (POST), admin_data (GET), set_contact_read,
 *            delete_contact, set_post_status, update_post, delete_post (POST)
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

function sha256(s) {
    return crypto.createHash('sha256').update(String(s)).digest();
}

/* ---------- admin session ---------- */

async function requireAdmin(req) {
    let token = req.headers['x-admin-token'] || '';
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7).trim();
    }
    if (!token) {
        token = readCookie(req, SESSION_COOKIE);
    }
    if (!/^[0-9a-f]{64}$/.test(token) || !(await redis(['GET', 'session:' + token]))) {
        throw new HttpError(401, 'Please log in.');
    }
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
                category: p.category || 'Field Notes'
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
            title: text(b, 'title', 90, 'a title'),
            author: text(b, 'author', 50, 'your name'),
            body: text(b, 'body', 20000, 'the post text'),
            category: text(b, 'category', 50, 'a category', true) || 'Guest Post',
            status: 'pending',
            date: now.slice(0, 10),
            createdAt: now
        };
        await rateLimit(req, 'post', 3, 10 * 60);
        await put(POSTS, post);
        return {};
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
            title: text(b, 'title', 90, 'a title'),
            author: text(b, 'author', 50, "the author's name"),
            body: text(b, 'body', 20000, 'the post text'),
            category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
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
                    title: text(b, 'title', 90, 'a title'),
                    author: text(b, 'author', 50, "the author's name", true) || 'Sanjay Patil',
                    body: text(b, 'body', 20000, 'the post text'),
                    category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
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
        try {
            post = await getOne(POSTS, b.id);
            post.title = text(b, 'title', 90, 'a title');
            post.author = text(b, 'author', 50, "the author's name");
            post.body = text(b, 'body', 20000, 'the post text');
            if (b.category != null) post.category = text(b, 'category', 50, 'a category', true);
            if (b.date) post.date = b.date;
            if (b.status) post.status = b.status;
        } catch (e) {
            const now = new Date().toISOString();
            post = {
                id: String(b.id || crypto.randomUUID()),
                title: text(b, 'title', 90, 'a title'),
                author: text(b, 'author', 50, "the author's name", true) || 'Sanjay Patil',
                body: text(b, 'body', 20000, 'the post text'),
                category: text(b, 'category', 50, 'a category', true) || 'Field Notes',
                status: b.status || 'approved',
                date: b.date || now.slice(0, 10),
                createdAt: now
            };
        }
        await put(POSTS, post);
        return { post };
    },

    async delete_post(req) {
        await requireAdmin(req);
        await redis(['HDEL', POSTS, String(body(req).id)]);
        return {};
    },

    async sync_posts(req) {
        await requireAdmin(req);
        const b = body(req);
        const incoming = Array.isArray(b.posts) ? b.posts : [];
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
            await put(POSTS, record);
            count++;
        }
        const allPosts = await getAll(POSTS);
        return { synced: count, posts: allPosts };
    }
};

const GET_ACTIONS = ['public_posts', 'admin_data'];

module.exports = async function handler(req, res) {
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
