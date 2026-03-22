const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const dns = require('dns').promises;
const { query } = require('../db');

// 20 link preview fetches per IP per minute
const linkPreviewLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many preview requests, slow down.' })
});

// In-memory caches
const trendingPostersCache = { data: null, expiry: 0 };
const linkPreviewCache = new Map(); // url -> { data, expiry }
const POSTERS_TTL = 5 * 60 * 1000; // 5 minutes
const PREVIEW_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PREVIEW_CACHE = 500;

// GET /api/discovery/trending-posters?limit=5
router.get('/trending-posters', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    // Return cached data if still fresh
    if (trendingPostersCache.data && Date.now() < trendingPostersCache.expiry) {
        return res.json(trendingPostersCache.data.slice(0, limit));
    }

    try {
        const result = await query(`
            SELECT u.id, u.username, u.profile_picture,
                   COUNT(pr.id) AS total_reactions
            FROM users u
            JOIN posts p ON p.user_id = u.id
            JOIN post_reactions pr ON pr.post_id = p.id
            WHERE u.is_banned = FALSE
              AND p.deleted_by_mod = FALSE
              AND p.visibility = 'public'
            GROUP BY u.id, u.username, u.profile_picture
            ORDER BY total_reactions DESC
            LIMIT 20
        `);

        const posters = result.rows.map(r => ({
            id: r.id,
            username: r.username,
            profile_picture: r.profile_picture || null,
            total_reactions: parseInt(r.total_reactions)
        }));

        trendingPostersCache.data = posters;
        trendingPostersCache.expiry = Date.now() + POSTERS_TTL;

        res.json(posters.slice(0, limit));
    } catch (error) {
        console.error('Trending posters error:', error);
        res.status(500).json({ error: 'Failed to load trending posters' });
    }
});

// Validate URL for SSRF protection
function isValidPublicUrl(urlStr) {
    let url;
    try {
        url = new URL(urlStr);
    } catch {
        return false;
    }

    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const hostname = url.hostname;

    // Block private/loopback IP ranges
    const privatePatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^192\.168\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^::1$/,
        /^fc00:/i,
        /^fe80:/i,
        /^0\./,
        /^169\.254\./,  // link-local
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT
    ];

    for (const pattern of privatePatterns) {
        if (pattern.test(hostname)) return false;
    }

    return true;
}

// GET /api/discovery/link-preview?url=<encoded>
router.get('/link-preview', linkPreviewLimiter, async (req, res) => {
    const urlStr = req.query.url;
    if (!urlStr) return res.status(400).json({ error: 'url parameter required' });

    if (!isValidPublicUrl(urlStr)) {
        return res.status(400).json({ error: 'Invalid or disallowed URL' });
    }

    // Return cached preview if fresh
    const cached = linkPreviewCache.get(urlStr);
    if (cached && Date.now() < cached.expiry) {
        return res.json(cached.data);
    }

    // Quick DNS sanity check — catches hallucinated/non-existent domains before we open an HTTP connection
    const hostname = new URL(urlStr).hostname;
    try {
        await dns.lookup(hostname);
    } catch {
        return res.status(422).json({ error: 'Could not resolve host' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(urlStr, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; 1socialChat/1.0; +https://chat.wwel.sh)',
                'Accept': 'text/html,application/xhtml+xml,*/*'
            }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return res.status(422).json({ error: 'Could not fetch URL' });
        }

        const rawHtml = await response.text();
        const html = rawHtml.substring(0, 25 * 1024); // only need first 25KB for <head> tags

        // Parse OG tags
        const getOg = (prop) => {
            const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
                || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'));
            return m ? m[1] : null;
        };

        const title = getOg('title')
            || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]
            || null;

        const description = getOg('description')
            || (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1]
            || null;

        const image = getOg('image') || null;
        const siteName = getOg('site_name') || null;

        const preview = {
            title: title ? title.trim().substring(0, 200) : null,
            description: description ? description.trim().substring(0, 500) : null,
            image,
            siteName: siteName || hostname,
            url: urlStr
        };

        // Cache with LRU eviction
        if (linkPreviewCache.size >= MAX_PREVIEW_CACHE) {
            const firstKey = linkPreviewCache.keys().next().value;
            linkPreviewCache.delete(firstKey);
        }
        linkPreviewCache.set(urlStr, { data: preview, expiry: Date.now() + PREVIEW_TTL });

        res.json(preview);
    } catch (error) {
        if (error.name === 'AbortError') {
            return res.status(408).json({ error: 'Request timed out' });
        }
        console.error('Link preview error:', error);
        res.status(500).json({ error: 'Failed to fetch link preview' });
    }
});

// GET /api/discovery/search?q=&type=all|users|posts
router.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    const type = req.query.type || 'all';

    if (!q || q.length < 1) {
        return res.json({ users: [], posts: [] });
    }

    const searchTerm = `%${q}%`;
    const results = { users: [], posts: [] };

    try {
        if (type === 'all' || type === 'users') {
            const userResult = await query(
                `SELECT id, username, profile_picture, bio
                 FROM users
                 WHERE username LIKE $1
                   AND is_banned = FALSE
                 ORDER BY username
                 LIMIT 10`,
                [searchTerm]
            );
            results.users = userResult.rows;
        }

        if (type === 'all' || type === 'posts') {
            const postResult = await query(
                `SELECT p.id, p.content, p.created_at,
                        u.username, u.profile_picture
                 FROM posts p
                 JOIN users u ON u.id = p.user_id
                 WHERE p.content LIKE $1
                   AND p.deleted_by_mod = FALSE
                   AND p.visibility = 'public'
                   AND u.is_banned = FALSE
                 ORDER BY p.created_at DESC
                 LIMIT 10`,
                [searchTerm]
            );
            results.posts = postResult.rows.map(r => ({
                ...r,
                content: r.content.substring(0, 200)
            }));
        }

        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
