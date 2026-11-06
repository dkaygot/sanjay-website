/**
 * api/site-store.js — Client-Side Storage & Server Sync Engine
 * 
 * Manages form submissions for Sanjay Patil's Photography site:
 * - Contact Form (inquiries, prints, bookings, workshop requests)
 * - Blog Form (guest submissions, articles, admin-created posts)
 * - Form Settings (recipient email, topics, submission permissions)
 *
 * Works in two complementary modes:
 * 1. Server Mode: Connects to /api/api (Vercel + Upstash Redis) when deployed.
 * 2. Local/Offline Mode: Operates seamlessly via localStorage with full CRUD,
 *    live search, filtering, and exports, so Admin, Blog, and Contact forms
 *    are 100% operational in any environment.
 */
(function(window) {
    'use strict';

    var STORAGE_KEYS = {
        CONTACTS: 'sp_site_contacts',
        POSTS: 'sp_site_posts',
        SETTINGS: 'sp_site_settings',
        AUTH: 'sp_admin_session',
        TOKEN: 'sp_admin_token'
    };

    var DEFAULT_SETTINGS = {
        contactEmail: 'sanarpan@gmail.com',
        contactPhone: '+91 98333 56131',
        contactTopics: [
            'Learn Photography',
            'Printing services',
            'Get a quote',
            'Ask a question',
            'Something else'
        ],
        allowPublicBlogSubmissions: true,
        defaultAuthor: 'Sanjay Patil',
        adminPassword: 'admin' // local fallback admin password
    };

    var DEMO_CONTACTS = [
        {
            id: 'demo-msg-1',
            name: 'Ananya Sharma',
            email: 'ananya.sharma@artgallery.in',
            phone: '+91 98201 44521',
            topic: 'Printing services',
            message: 'Hello Sanjay, I recently viewed your Lonar crater series and was amazed by the micro-contrasts and textures. We are curating a photography showcase for our Mumbai gallery and would like to order three archival pigment prints in 24x36 inches on 310gsm museum cotton rag. Could you share your pricing and delivery timeframe?',
            read: false,
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString()
        },
        {
            id: 'demo-msg-2',
            name: 'Vikramaditya Roy',
            email: 'v.roy@wildlifephoto.org',
            phone: '+91 94140 18273',
            topic: 'Learn Photography',
            message: 'Dear Mr. Patil, I would love to register for your upcoming monsoon landscape masterclass in the Western Ghats. Do you offer practical field guidance for medium format setups as well as full-frame mirrorless? Looking forward to the curriculum and batch dates.',
            read: true,
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 68).toISOString()
        },
        {
            id: 'demo-msg-3',
            name: 'Meera Deshmukh',
            email: 'meera.d@studioarch.com',
            phone: '+91 99300 88219',
            topic: 'Get a quote',
            message: 'Hi Sanjay, We are designing the lobby and private suites of a heritage boutique resort in Pune. We are interested in licensing 8 of your large panoramic monochrome landscape prints. Please let us know your availability for a consultation.',
            read: false,
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 110).toISOString()
        }
    ];

    var DEMO_POSTS = [
        {
            id: 'demo-post-1',
            title: 'The Alchemy of Morning Light at Lonar Crater',
            author: 'Sanjay Patil',
            category: 'Field Notes',
            date: '2026-09-12',
            body: 'There is an ethereal silence that descends upon the crater rim an hour before dawn. As the saline mist rises and refracts the first golden amber rays, the landscape shifts from monochromatic mystery into profound geological grandeur. In landscape photography, patience is not merely waiting—it is learning to breathe in harmony with the changing light.',
            status: 'approved',
            createdAt: '2026-09-12T06:30:00.000Z'
        },
        {
            id: 'demo-post-2',
            title: 'Mastering Fine Art Printing: Archival Cotton Rag vs Satin',
            author: 'Sanjay Patil',
            category: 'Printing',
            date: '2026-08-28',
            body: 'A photograph is never truly complete until it exists as physical ink on archival paper. When choosing between 100% cotton rag smooth matte and barium sulfate (baryta) papers, consider the tonal depth of your shadows and how ambient gallery lighting interacts with the surface texture.',
            status: 'approved',
            createdAt: '2026-08-28T14:15:00.000Z'
        },
        {
            id: 'demo-post-3',
            title: 'Chasing the Sahyadri Monsoon Waterfalls',
            author: 'Rahul Kulkarni',
            category: 'Guest Submission',
            date: '2026-10-10',
            body: 'During my recent trek through the Western Ghats under torrential downpours, protecting the gear was as much of a discipline as finding the composition. The cascading waterfalls amidst heavy cloud cover offered breathtaking dynamic range and taught me how water creates natural leading lines.',
            status: 'pending',
            createdAt: '2026-10-10T11:20:00.000Z'
        }
    ];

    function safeParse(str, fallback) {
        if (!str) return fallback;
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    }

    // An API reply as JSON. null means there is no API here at all (a 404 from a plain
    // file server, i.e. local preview), so local mode applies. Any other reply that
    // isn't JSON (a Vercel timeout or size-limit page) is a real error, not "offline".
    function readApi(r) {
        return r.json().catch(function() {
            if (r.status === 404) return null;
            return { ok: false, error: 'The server had a problem (error ' + r.status + '). Please try again.' };
        });
    }

    function generateId() {
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 7);
    }

    var memoryStore = {};
    var storage = {
        getItem: function(key) {
            try {
                if (typeof window !== 'undefined' && window.localStorage) {
                    return window.localStorage.getItem(key);
                }
            } catch (e) {}
            return memoryStore[key] || null;
        },
        setItem: function(key, val) {
            try {
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.setItem(key, val);
                    return;
                }
            } catch (e) {}
            memoryStore[key] = String(val);
        },
        removeItem: function(key) {
            try {
                if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.removeItem(key);
                    return;
                }
            } catch (e) {}
            delete memoryStore[key];
        }
    };

    var SiteStore = {
        readApi: readApi,

        // Initialize default storage if empty
        init: function() {
            if (!storage.getItem(STORAGE_KEYS.SETTINGS)) {
                storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
            }
            if (!storage.getItem(STORAGE_KEYS.CONTACTS)) {
                storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(DEMO_CONTACTS));
            }
            if (!storage.getItem(STORAGE_KEYS.POSTS)) {
                storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(DEMO_POSTS));
            }
        },

        // Helper to construct authenticated headers for server calls
        getAuthHeaders: function() {
            var h = { 'Content-Type': 'application/json' };
            var token = storage.getItem(STORAGE_KEYS.TOKEN);
            if (token) {
                h['X-Admin-Token'] = token;
                h['Authorization'] = 'Bearer ' + token;
            }
            return h;
        },

        // Test if server API endpoint is responding
        checkServer: function(apiUrl) {
            var endpoint = apiUrl || '/api/api';
            if (typeof fetch === 'undefined') return Promise.resolve(false);
            return fetch(endpoint + '?action=public_posts', {
                method: 'GET',
                cache: 'no-store'
            }).then(function(res) {
                return res.ok;
            }).catch(function() {
                return false;
            });
        },

        /* ---------- LIVE SERVER DATA FETCHING ---------- */

        fetchAdminData: function(apiUrl) {
            var self = this;
            var endpoint = apiUrl || '/api/api';
            return fetch(endpoint + '?action=admin_data', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: self.getAuthHeaders()
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(data) {
                    if (!r.ok || !data.ok) {
                        var err = new Error(data.error || 'Server returned status ' + r.status);
                        err.status = r.status; // 401: the server login has expired
                        throw err;
                    }
                    if (Array.isArray(data.contacts)) {
                        storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(data.contacts));
                    }
                    if (Array.isArray(data.posts)) {
                        storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(data.posts));
                    }
                    return {
                        ok: true,
                        contacts: data.contacts || [],
                        posts: data.posts || [],
                        isLive: true
                    };
                });
            });
        },

        syncAllToLiveServer: function(apiUrl) {
            var self = this;
            var endpoint = apiUrl || '/api/api';
            var posts = this.getPosts('all');
            return fetch(endpoint + '?action=sync_posts', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify({ posts: posts })
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(res) {
                    if (!r.ok || !res.ok) {
                        throw new Error(res.error || 'Server returned status ' + r.status);
                    }
                    if (res.posts && Array.isArray(res.posts)) {
                        storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(res.posts));
                    }
                    return res;
                });
            });
        },

        /* ---------- SETTINGS ---------- */

        getSettings: function() {
            var raw = safeParse(storage.getItem(STORAGE_KEYS.SETTINGS), {});
            return Object.assign({}, DEFAULT_SETTINGS, raw);
        },

        saveSettings: function(newSettings) {
            var current = this.getSettings();
            var merged = Object.assign({}, current, newSettings);
            storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
            return merged;
        },

        /* ---------- CONTACTS (INBOX) ---------- */

        getContacts: function() {
            var contacts = safeParse(storage.getItem(STORAGE_KEYS.CONTACTS), []);
            return contacts.sort(function(a, b) {
                return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
        },

        addContact: function(contact) {
            var self = this;
            var contacts = this.getContacts();
            var record = {
                id: contact.id || generateId(),
                name: (contact.name || '').trim(),
                email: (contact.email || '').trim(),
                phone: (contact.phone || '').trim(),
                topic: (contact.topic || '').trim() || 'General Inquiry',
                message: (contact.message || '').trim(),
                read: false,
                createdAt: contact.createdAt || new Date().toISOString()
            };
            contacts.unshift(record);
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));

            // Also attempt remote server sync
            return fetch('/api/api?action=submit_contact', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            }).then(function(r) {
                return r.json().catch(function() { return {}; });
            }).then(function() {
                return record;
            }).catch(function() {
                return record;
            });
        },

        setContactRead: function(id, isRead) {
            var self = this;
            var contacts = this.getContacts();
            var target = null;
            contacts.forEach(function(c) {
                if (c.id === id) {
                    c.read = !!isRead;
                    target = c;
                }
            });
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));

            return fetch('/api/api?action=set_contact_read', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify({ id: id, read: !!isRead })
            }).then(function(r) {
                return r.json().catch(function() { return {}; });
            }).then(function(res) {
                return target;
            }).catch(function() {
                return target;
            });
        },

        markAllContactsRead: function() {
            var contacts = this.getContacts();
            contacts.forEach(function(c) {
                c.read = true;
            });
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));
            return contacts;
        },

        deleteContact: function(id) {
            var self = this;
            var contacts = this.getContacts().filter(function(c) {
                return c.id !== id;
            });
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));

            return fetch('/api/api?action=delete_contact', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify({ id: id })
            }).then(function(r) {
                return r.json().catch(function() { return {}; });
            }).then(function() {
                return contacts;
            }).catch(function() {
                return contacts;
            });
        },

        clearReadContacts: function() {
            var contacts = this.getContacts().filter(function(c) {
                return !c.read;
            });
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));
            return contacts;
        },

        /* ---------- BLOG PHOTOS ---------- */

        // Where to load a post photo from: photos kept only in this browser
        // carry their own data URL, uploaded ones are served by the API.
        imageUrl: function(img, apiUrl) {
            if (!img) return '';
            if (img.src) return img.src;
            return (apiUrl || '/api/api') + '?action=image&id=' + encodeURIComponent(img.id);
        },

        // Shrink a photo to a JPEG data URL of at most opts.maxBytes, with its
        // long edge at most opts.maxEdge pixels. Resolves { dataUrl, bytes, width, height }.
        compressImage: function(file, opts) {
            opts = opts || {};
            var maxEdge = opts.maxEdge || 2000;
            var maxBytes = opts.maxBytes || 560 * 1024;
            return new Promise(function(resolve, reject) {
                var name = (file && file.name) ? '"' + file.name + '"' : 'That file';
                if (!file || !/^image\//.test(file.type || '')) {
                    return reject(new Error(name + ' is not a photo. Use a JPEG, PNG or WebP image.'));
                }
                if (file.size > 40 * 1024 * 1024) {
                    return reject(new Error(name + ' is larger than 40 MB.'));
                }
                var url = URL.createObjectURL(file);
                var img = new Image();
                img.onload = function() {
                    URL.revokeObjectURL(url);
                    var w0 = img.naturalWidth;
                    var h0 = img.naturalHeight;
                    if (!w0 || !h0) return reject(new Error(name + ' could not be read.'));
                    var edge = Math.min(maxEdge, Math.max(w0, h0));
                    var quality = 0.86;
                    var canvas = document.createElement('canvas');
                    var ctx = canvas.getContext('2d');
                    // step quality down first, then size, until the file fits
                    for (;;) {
                        var scale = edge / Math.max(w0, h0);
                        canvas.width = Math.max(1, Math.round(w0 * scale));
                        canvas.height = Math.max(1, Math.round(h0 * scale));
                        ctx.fillStyle = '#ffffff'; // transparent PNG areas become white, not black
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        var dataUrl = canvas.toDataURL('image/jpeg', quality);
                        var bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
                        if (bytes <= maxBytes || edge <= 480) {
                            return resolve({ dataUrl: dataUrl, bytes: bytes, width: canvas.width, height: canvas.height });
                        }
                        if (quality > 0.68) quality -= 0.08;
                        else edge = Math.round(edge * 0.82);
                    }
                };
                img.onerror = function() {
                    URL.revokeObjectURL(url);
                    reject(new Error(name + ' could not be read. Use a JPEG, PNG or WebP photo.'));
                };
                img.src = url;
            });
        },

        // Shrink and upload one photo. Resolves { id, caption } for a photo
        // stored on the server, or { id, caption, src } for one kept only in
        // this browser when no server is reachable (local / offline mode).
        uploadImage: function(file, apiUrl) {
            var self = this;
            var endpoint = apiUrl || '/api/api';
            return this.compressImage(file).then(function(c) {
                return fetch(endpoint + '?action=upload_image', {
                    method: 'POST',
                    credentials: 'include',
                    headers: self.getAuthHeaders(),
                    body: JSON.stringify({ data: c.dataUrl })
                }).then(function(r) {
                    return readApi(r);
                }, function() {
                    return null;
                }).then(function(res) {
                    if (res && res.ok && res.image && res.image.id) return { id: res.image.id, caption: '' };
                    if (res && res.error) throw new Error(res.error);
                    // no API here: keep a smaller copy in this browser instead
                    return self.compressImage(file, { maxEdge: 1400, maxBytes: 220 * 1024 }).then(function(small) {
                        return { id: 'local-' + generateId(), caption: '', src: small.dataUrl };
                    });
                });
            });
        },

        /* ---------- BLOG DOCUMENTS (PDF / DOC / DOCX) ---------- */

        MAX_FILE_BYTES: 3 * 1024 * 1024,

        // 'pdf' | 'doc' | 'docx' from a file name, or ''
        docKind: function(name) {
            var m = /\.(pdf|docx?)$/i.exec(name || '');
            return m ? m[1].toLowerCase() : '';
        },

        // Where to load a document from; `download` asks for a download even for a PDF.
        fileUrl: function(f, apiUrl, download) {
            if (!f) return '';
            if (f.src) return f.src;
            return (apiUrl || '/api/api') + '?action=file&id=' + encodeURIComponent(f.id) + (download ? '&download=1' : '');
        },

        // Upload one document. Resolves { id, name, type, size } for a file
        // stored on the server, or the same plus `src` (a data URL) for one
        // kept only in this browser when no server is reachable.
        uploadFile: function(file, apiUrl) {
            var self = this;
            var endpoint = apiUrl || '/api/api';
            var name = (file && file.name) || 'document';
            if (!this.docKind(name)) return Promise.reject(new Error('"' + name + '" is not a PDF, DOC or DOCX file.'));
            if (file.size > this.MAX_FILE_BYTES) return Promise.reject(new Error('"' + name + '" is larger than 3 MB.'));
            return new Promise(function(resolve, reject) {
                var reader = new FileReader();
                reader.onload = function() { resolve(reader.result); };
                reader.onerror = function() { reject(new Error('"' + name + '" could not be read.')); };
                reader.readAsDataURL(file);
            }).then(function(dataUrl) {
                return fetch(endpoint + '?action=upload_file', {
                    method: 'POST',
                    credentials: 'include',
                    headers: self.getAuthHeaders(),
                    body: JSON.stringify({ name: name, data: dataUrl })
                }).then(function(r) {
                    return readApi(r);
                }, function() {
                    return null;
                }).then(function(res) {
                    if (res && res.ok && res.file && res.file.id) return res.file;
                    if (res && res.error) throw new Error(res.error);
                    // no API here: keep it in this browser, which only has room for small files
                    if (file.size > 1024 * 1024) {
                        throw new Error('"' + name + '" is over 1 MB, which can only be attached when the site is online.');
                    }
                    return { id: 'local-' + generateId(), name: name, type: file.type || '', size: file.size, src: dataUrl };
                });
            });
        },

        /* ---------- BLOG POSTS ---------- */

        getPosts: function(filterStatus) {
            var posts = safeParse(storage.getItem(STORAGE_KEYS.POSTS), []);
            var sorted = posts.sort(function(a, b) {
                return (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '');
            });
            if (filterStatus && filterStatus !== 'all') {
                return sorted.filter(function(p) {
                    return p.status === filterStatus;
                });
            }
            return sorted;
        },

        // opts.localOnly: save in this browser without sending it to the server
        addPost: function(post, opts) {
            var self = this;
            var posts = safeParse(storage.getItem(STORAGE_KEYS.POSTS), []);
            var now = new Date().toISOString();
            var record = {
                id: post.id || generateId(),
                title: (post.title || '').trim(),
                author: (post.author || this.getSettings().defaultAuthor).trim(),
                category: (post.category || 'Field Notes').trim(),
                date: post.date || now.slice(0, 10),
                body: (post.body || '').trim(),
                images: Array.isArray(post.images) ? post.images : [],
                files: Array.isArray(post.files) ? post.files : [],
                status: post.status || 'pending', // 'approved', 'pending', or 'draft'
                createdAt: post.createdAt || now
            };
            posts.unshift(record);
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
            if (opts && opts.localOnly) return Promise.resolve(record);

            // Sync to server
            // the admin saves through create_post whatever the status (guest limits don't apply)
            var action = (self.isLoggedIn() || record.status === 'approved' || record.status === 'draft') ? 'create_post' : 'submit_post';
            return fetch('/api/api?action=' + action, {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify(record)
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(res) {
                    if (!r.ok || !res.ok) {
                        throw new Error(res.error || 'Server error saving article');
                    }
                    if (res.post && res.post.id) {
                        record.id = res.post.id;
                        record.createdAt = res.post.createdAt || record.createdAt;
                        posts[0] = Object.assign({}, record, res.post);
                        storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
                    }
                    return record;
                });
            }).catch(function(err) {
                // If offline / local fallback, return local record
                return record;
            });
        },

        updatePost: function(id, data) {
            var self = this;
            var posts = safeParse(storage.getItem(STORAGE_KEYS.POSTS), []);
            var target = null;
            posts.forEach(function(p) {
                if (p.id === id) {
                    if (data.title != null) p.title = data.title.trim();
                    if (data.author != null) p.author = data.author.trim();
                    if (data.category != null) p.category = data.category.trim();
                    if (data.date != null) p.date = data.date;
                    if (data.body != null) p.body = data.body.trim();
                    if (Array.isArray(data.images)) p.images = data.images;
                    if (Array.isArray(data.files)) p.files = data.files;
                    if (data.status != null) p.status = data.status;
                    target = p;
                }
            });
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));

            return fetch('/api/api?action=update_post', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify(Object.assign({ id: id }, data))
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(res) {
                    if (!r.ok || !res.ok) {
                        throw new Error(res.error || 'Failed to update article on server.');
                    }
                    if (res.post && target) {
                        Object.assign(target, res.post);
                        storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
                    }
                    return target;
                });
            }).catch(function() {
                return target;
            });
        },

        setPostStatus: function(id, status) {
            var self = this;
            var posts = safeParse(storage.getItem(STORAGE_KEYS.POSTS), []);
            var target = null;
            posts.forEach(function(p) {
                if (p.id === id) {
                    p.status = status;
                    target = p;
                }
            });
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));

            var payload = { id: id, status: status };
            if (target) {
                payload.title = target.title;
                payload.author = target.author;
                payload.body = target.body;
                payload.category = target.category;
                payload.date = target.date;
                payload.images = target.images || [];
                payload.files = target.files || [];
            }

            return fetch('/api/api?action=set_post_status', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify(payload)
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(res) {
                    if (!r.ok || !res.ok) {
                        throw new Error(res.error || 'Failed to update post status on server.');
                    }
                    if (res.post && target) {
                        Object.assign(target, res.post);
                        storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
                    }
                    return target;
                });
            }).catch(function(err) {
                // If offline / local fallback, return local target
                return target;
            });
        },

        deletePost: function(id) {
            var self = this;
            var posts = safeParse(storage.getItem(STORAGE_KEYS.POSTS), []).filter(function(p) {
                return p.id !== id;
            });
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));

            return fetch('/api/api?action=delete_post', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify({ id: id })
            }).then(function(r) {
                return r.json().catch(function() { return {}; }).then(function(res) {
                    if (!r.ok || !res.ok) {
                        throw new Error(res.error || 'Failed to delete article on server.');
                    }
                    return posts;
                });
            }).catch(function() {
                return posts;
            });
        },

        /* ---------- AUTH & SESSION ---------- */

        login: function(password, apiUrl) {
            var self = this;
            var endpoint = apiUrl || '/api/api';
            // First try server login
            return fetch(endpoint + '?action=login', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            }).then(function(r) {
                return readApi(r);
            }, function() {
                return null; // no server reachable
            }).then(function(data) {
                if (data && data.ok) {
                    if (data.token) {
                        storage.setItem(STORAGE_KEYS.TOKEN, data.token);
                    }
                    storage.setItem(STORAGE_KEYS.AUTH, 'server:' + Date.now());
                    return { ok: true, mode: 'server', token: data.token };
                }
                // The server answered (wrong password, rate limit, setup problem): never fall
                // back to local mode, or the dashboard would show stale browser data as if live.
                if (data && data.error) throw new Error(data.error);
                // No server at all (local preview / offline): use the local password
                var settings = self.getSettings();
                var expected = settings.adminPassword || 'admin';
                if (password === expected) {
                    storage.setItem(STORAGE_KEYS.AUTH, 'local:' + Date.now());
                    return { ok: true, mode: 'local' };
                }
                throw new Error('Incorrect password. (Local default: admin)');
            });
        },

        logout: function(apiUrl) {
            var self = this;
            storage.removeItem(STORAGE_KEYS.AUTH);
            storage.removeItem(STORAGE_KEYS.TOKEN);
            return fetch((apiUrl || '/api/api') + '?action=logout', {
                method: 'POST',
                credentials: 'include',
                headers: self.getAuthHeaders(),
                body: JSON.stringify({})
            }).catch(function() {
                return { ok: true };
            });
        },

        isLoggedIn: function() {
            return !!storage.getItem(STORAGE_KEYS.AUTH);
        },

        /* ---------- BACKUP & EXPORTS ---------- */

        exportData: function() {
            var payload = {
                site: 'Sanjay Patil Photography Admin',
                exportedAt: new Date().toISOString(),
                contacts: this.getContacts(),
                posts: this.getPosts('all'),
                settings: this.getSettings()
            };
            return JSON.stringify(payload, null, 2);
        },

        importData: function(jsonStr) {
            try {
                var data = JSON.parse(jsonStr);
                if (data.contacts && Array.isArray(data.contacts)) {
                    storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(data.contacts));
                }
                if (data.posts && Array.isArray(data.posts)) {
                    storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(data.posts));
                }
                if (data.settings && typeof data.settings === 'object') {
                    this.saveSettings(data.settings);
                }
                return { ok: true };
            } catch (e) {
                throw new Error('Invalid JSON backup file: ' + e.message);
            }
        },

        exportContactsCSV: function() {
            var contacts = this.getContacts();
            var headers = ['ID', 'Name', 'Email', 'Phone', 'Topic', 'Message', 'Read', 'Created At'];
            var rows = contacts.map(function(c) {
                return [
                    c.id,
                    '"' + (c.name || '').replace(/"/g, '""') + '"',
                    '"' + (c.email || '').replace(/"/g, '""') + '"',
                    '"' + (c.phone || '').replace(/"/g, '""') + '"',
                    '"' + (c.topic || '').replace(/"/g, '""') + '"',
                    '"' + (c.message || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"',
                    c.read ? 'Yes' : 'No',
                    c.createdAt
                ].join(',');
            });
            return [headers.join(',')].concat(rows).join('\r\n');
        },

        exportPostsCSV: function() {
            var posts = this.getPosts('all');
            var headers = ['ID', 'Title', 'Author', 'Category', 'Date', 'Status', 'Body'];
            var rows = posts.map(function(p) {
                return [
                    p.id,
                    '"' + (p.title || '').replace(/"/g, '""') + '"',
                    '"' + (p.author || '').replace(/"/g, '""') + '"',
                    '"' + (p.category || '').replace(/"/g, '""') + '"',
                    p.date,
                    p.status,
                    '"' + (p.body || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"'
                ].join(',');
            });
            return [headers.join(',')].concat(rows).join('\r\n');
        },

        resetDemoData: function() {
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(DEMO_CONTACTS));
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(DEMO_POSTS));
            storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
            return { contacts: DEMO_CONTACTS, posts: DEMO_POSTS };
        },

        clearAllData: function() {
            storage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify([]));
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify([]));
            return { contacts: [], posts: [] };
        }
    };

    // Auto initialize store
    SiteStore.init();

    window.SiteStore = SiteStore;
})(typeof window !== 'undefined' ? window : this);
