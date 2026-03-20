---
name: Visual Redesign - 3-column layout
description: Creative_FED-style redesign completed — sidebar nav, discovery sidebar, search, link previews, trending posters
type: project
---

Completed full visual redesign. Key changes:

- Replaced top navbar with fixed left nav sidebar (220px desktop, 60px icon-only tablet, hidden mobile)
- Added right discovery sidebar (280px, desktop only) with trending posters + trending tags
- Added global search bar with dropdown (hidden on mobile — bottom nav has 🔍 icon instead)
- Mobile bottom nav: 🏠 🔍 💬 👤 👥 — search opens fullscreen overlay, chat opens fullscreen modal
- Chat widget collapsed by default on all screen sizes
- Link previews via `/api/discovery/link-preview` — rate limited 20/min/IP, 24hr cache, 25KB HTML read limit
- Trending posters via `/api/discovery/trending-posters` — 5min cache
- Post search via `/api/discovery/search` — SQLite LIKE (not ILIKE)
- Profile page uses CSS grid-template-areas: header/friends/posts — friends panel is right column on desktop, horizontal avatar strip on mobile
- Guest banner is position:fixed top, spans feed column only (left: 220px, right: calc(280px + 1rem))

**Why:** Modernize layout to match contemporary social media UX while keeping the brutalist CDE aesthetic.

**Future:** Media/reels page planned — filter posts by media_type video/image, full-screen swipe navigation. Foundation is ready (S3/filesystem storage, media_type column exists).
