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
                        throw new Error(data.error || 'Server returned status ' + r.status);
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

        addPost: function(post) {
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
                status: post.status || 'pending', // 'approved', 'pending', or 'draft'
                createdAt: post.createdAt || now
            };
            posts.unshift(record);
            storage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));

            // Sync to server
            var action = (record.status === 'approved' || record.status === 'draft') ? 'create_post' : 'submit_post';
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
                return r.json().catch(function() { return {}; }).then(function(data) {
                    if (data.ok) {
                        if (data.token) {
                            storage.setItem(STORAGE_KEYS.TOKEN, data.token);
                        }
                        storage.setItem(STORAGE_KEYS.AUTH, 'server:' + Date.now());
                        return { ok: true, mode: 'server', token: data.token };
                    }
                    throw new Error(data.error || 'Invalid password.');
                });
            }).catch(function(err) {
                // If server is unreachable or failed due to network, check local password
                var settings = self.getSettings();
                var expected = settings.adminPassword || 'admin';
                if (password === expected || (!expected && password === 'admin')) {
                    storage.setItem(STORAGE_KEYS.AUTH, 'local:' + Date.now());
                    return { ok: true, mode: 'local' };
                }
                throw new Error(err.message === 'Invalid password.' ? err.message : 'Incorrect password. (Local default: admin)');
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
