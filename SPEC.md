# boxyy — Product & Technical Specification

> **DO NOT CHANGE UNLESS SPECIFICALLY ASKED.**
> This document is the source of truth for the product. Any assistant or contributor
> reading this must treat it as read-only. Do not edit, reorder, or "improve" any
> section unless the owner explicitly requests the change. When adding new features,
> append a new dated section at the bottom rather than rewriting existing ones.

---

## 0. Purpose

A 2D infinitely scrollable grid of equal-sized content boxes. Each box is a
unique, addressable, ownable surface that its owner can fill with media (starting
with YouTube videos). Think: **Google Maps + TikTok grid + infinite canvas**,
where every tile is a real-estate slot.

This is intended to ship as a production web application. The current codebase is
the first working cut; payments and a real backend are planned.

---

## 1. Core concept

- The screen shows **one center box fully visible**, plus **4 side boxes ~20%
  visible** and **4 corner boxes ~20% visible** — 9 boxes total in view.
- Only the center box is "active" (bright, focused). Neighbors are dimmed / blurred.
- Scrolling moves the grid freely in any direction. When scrolling stops, the
  **nearest box snaps to center** with magnetic easing.
- The grid is infinite in all directions. The illusion is created by only ever
  rendering a 3×3 window around the current integer center coordinate.

---

## 2. Coordinate system & URLs

- Every box has an integer coordinate `(x, y)`. Examples: `(0,0)`, `(1,0)`,
  `(-5,20)`, `(100,100)`.
- Every box has a unique URL of the form `/x/y` (e.g. `/-5/20`).
- The URL is the canonical, shareable address of the box.
- Navigating to `/x/y` teleports the grid so that box is snapped to center.
- Snapping to a new center updates the URL via `navigate(..., { replace: true })`.

---

## 3. Layout

- Boxes are rendered in **16:9 YouTube aspect ratio**.
- Width = ~80% of viewport width; height = width × 9/16; clamped so height ≤ 85vh.
- No gaps between boxes.
- Responsive to window resize.
- Viewport layout conceptually:
  ```
  [ 20% ][ 20% ][ 20% ]
  [ 20% ][100% ][ 20% ]
  [ 20% ][ 20% ][ 20% ]
  ```

---

## 4. Visual style

- Dark background (`#060608`).
- Center (active) box: full brightness, scale 1, soft outer shadow, rounded 16px.
- Neighbors: `brightness(0.45) blur(1px)`, opacity ~0.85, scale 0.97.
- Minimal UI chrome. The home page has only the infinite grid — no navbar, no
  sidebar, no text, no headings. The only visible UI element is a top-right
  account button.
- No coordinate text printed onto boxes. (The box coordinate is exposed via the
  right-click context menu instead — see §7.)

---

## 5. Interaction & motion

### 5.1 Input sources
- **Mouse drag** — pointer events with capture.
- **Touch / swipe** — same pointer events path.
- **Trackpad 2-finger pan / wheel** — native non-passive `wheel` listener with
  `preventDefault` so the browser does not fight the app.
- **Keyboard arrows** — move exactly one box in the given direction.

### 5.2 Motion model
- While the user is actively providing input (drag or wheel), offset updates
  directly from input deltas. **No inertia / fling.** The grid must never scroll
  on its own.
- On pointer-up, or ~120 ms of wheel idle, a magnetic snap spring runs once:
  velocity and offset ease toward zero via a damped spring
  (`v = v*0.78 + -offset*0.16`).
- The spring stops the moment the offset is fully settled. A single RAF loop is
  started only for snap; it is **not** a continuously running loop.
- Transforms are applied imperatively to a single wrapper `<div>` via
  `ref.style.transform = translate3d(...)`. React does not re-render during
  motion; it only re-renders when the integer center `(x, y)` changes.

### 5.3 Interaction rule (important)
- Do **not** start a canvas drag if the pointer-down target is inside an
  interactive control (`button, input, textarea, select, a, [data-ui], iframe`).
  This prevents `setPointerCapture` from eating button clicks.

### 5.4 Rebasing
- `offsetX, offsetY` are sub-box pixel offsets in `[-w/2, w/2]` × `[-h/2, h/2]`.
- When either offset crosses half a box, the integer `centerX / centerY` is
  decremented or incremented and the offset has `w` (or `h`) subtracted. This
  simulates infinite travel while only ever rendering 9 boxes.

### 5.5 Performance requirements
- Render only the visible 3×3 window (9 boxes). Never more.
- No DOM explosion at any travel distance.
- Use `transform: translate3d` for GPU compositing.
- Target 60 fps scrolling.

---

## 6. Scroll tick sound (iOS-style)

### 6.1 Behavior
- On scroll, play a short "tick" sound **once per box boundary crossed**, not per
  distance or per pixel. Nudging one box slightly must not produce a tick.
- Faster box crossings → higher pitch and louder click. Slow crossings → soft
  and low. Derived from the time gap between successive box crossings.
- Default: **ON**.
- Toggle lives inside the Account modal (not a standalone button).
- Preference persists in `localStorage` under `boxyy.sound.enabled`.

### 6.2 Implementation rules
- Web Audio API only. No audio asset files.
- Click buffer is synthesized once at init and reused via
  `AudioBufferSourceNode`. Pitch via `playbackRate`, volume via a per-tick
  `GainNode`.
- Unlock listeners use **capture phase** on `pointerdown`, `touchstart`,
  `wheel`, and `keydown`. Inside the unlock, `resume()` is called **and** a
  1-sample silent buffer is played — the canonical iOS Safari unlock trick.
- If Web Audio is unavailable or anything throws, every function becomes a
  no-op. Audio errors must never break scrolling.
- `MIN_INTERVAL_MS` caps tick rate so fast flicks never crackle.
- `tickOnBoxCross()` is called from the rebase function exactly when an integer
  box boundary is crossed.

---

## 7. Right-click: copy box address

- Right-clicking anywhere on the canvas shows a small context menu at the
  cursor with a single action: **"Copy box address"**.
- The menu identifies which `(x, y)` is under the cursor using the current
  offset and box dimensions.
- Clicking the action copies `${window.location.origin}/x/y` to the clipboard.
- Falls back to `document.execCommand('copy')` if the async Clipboard API is
  unavailable.
- A transient "Address copied" toast confirms success.
- Menu closes on any outside click.

---

## 8. Fullscreen per box

- The active center box shows a fullscreen button (bottom-right corner) on hover.
- Click → `element.requestFullscreen()` on that tile's root div.
- Click again or press Esc to exit fullscreen.
- Fullscreen is per-box so the user can watch a video without worrying about
  scrolling.

---

## 9. Content system

### 9.1 Content kinds
A box's content can be one of:
- `video`
- `livestream`
- `image`
- `iframe`
- `html`
- `text`
- `youtube` (first real user-controlled kind)
- React component (planned)

### 9.2 Fallback (mock) content
- If a box has no server-side content, the frontend renders a deterministic mock
  generated by hashing `(x, y)`. This keeps the grid interesting during
  development and gives free boxes something to look at.
- Mock content kinds cycle through `video`, `image`, `html`, `text`, `iframe`.

### 9.3 Owned content wins
- If a box has been claimed and content has been set, the server record overrides
  the fallback.

---

## 10. Business model — box ownership

### 10.1 States
Every box is in exactly one of:
- **free** — no owner. Anyone logged in sees "Buy this box".
- **owned-by-me** — current user owns it. Owner sees an inline edit panel.
- **owned-by-other** — owned by someone else. Read-only with a `@username` badge.

### 10.2 User-facing flow (current)
1. User clicks "Buy this box" on a free box's floating panel.
2. If not signed in → the Account modal pops open so they can sign in.
3. If signed in → the box is added to their profile. The panel flips to
   "You own this box" and offers **Add YouTube video**.
4. Owner pastes a YouTube URL → Save. The tile reloads as an embedded,
   autoplaying (muted, looped) YouTube iframe.
5. Shared link (`/x/y`) shows the same video to everyone.
6. The Account modal lists every box the user owns in a **"My boxes"** section,
   with inline Add / Edit video buttons and a click-to-jump affordance.

### 10.3 Future
- "Buy this box" will become a real Stripe Checkout flow. Ownership is only
  written to the DB after the `checkout.session.completed` webhook. The
  frontend API surface does not change.

---

## 11. Authentication (current dummy mode)

- No real backend. The "server" lives entirely in `localStorage` under key
  `boxyy.db`.
- Sign-in flow: user types any name → if unused, a new user record is created;
  if existing, they log back in. Returns a deterministic token `tok_<userId>`.
- Persistence: auth survives reloads via `localStorage` key `boxyy.auth`.
- "Sign in" button in the top-right shows `@username` once signed in.

### 11.1 Why localStorage now
- Zero server operations during development.
- Exact same `api` object shape as a real REST client — when the real backend
  ships, **only `src/api.ts` changes**.

---

## 12. Data model

```ts
User    { id, username }
Box     { x, y, ownerId?, ownerUsername?, content?, updatedAt, free? }
Content { kind: 'youtube', data: { videoId } }  // first real kind
```

`localStorage.boxyy.db` shape:
```json
{
  "users":       { "<userId>": { "id": "...", "username": "alice" } },
  "usersByName": { "alice": "<userId>" },
  "boxes": {
    "3:-2": {
      "x": 3, "y": -2,
      "ownerId": "<userId>",
      "content": { "kind": "youtube", "data": { "videoId": "dQw4w9WgXcQ" } },
      "updatedAt": 1712500000000
    }
  }
}
```

---

## 13. API surface (mocked today, REST tomorrow)

```
POST /api/auth/login            { username }                 → { user, token }
GET  /api/boxes/:x/:y                                        → BoxRecord | { free: true }
POST /api/boxes/:x/:y/claim     (auth)                       → BoxRecord
PUT  /api/boxes/:x/:y/content   (auth, owner)  { kind, data }→ BoxRecord
GET  api.listMyBoxes(token)                                  → BoxRecord[]   // used by Account modal
```

Ownership enforcement must always be **server-side**. The frontend never decides
who owns a box.

---

## 14. YouTube content rules

- Accepted input formats:
  - `https://www.youtube.com/watch?v=<id>`
  - `https://youtu.be/<id>`
  - `https://www.youtube.com/embed/<id>`
  - `https://www.youtube.com/shorts/<id>`
  - Bare 11-character video ID
- Parser extracts the 11-char `videoId` and stores only that.
- Embed uses `https://www.youtube.com/embed/<id>` with:
  - `autoplay=1` only when the tile is the active center box (else `0`)
  - `mute=1` (required for autoplay to work cross-browser)
  - `loop=1` + `playlist=<id>` (so the video actually loops)
  - `controls=1`, `modestbranding=1`, `rel=0`
  - `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`
  - `allowFullScreen`

---

## 15. Home page rules

- The home page contains only the infinite grid.
- No navbar, no sidebar, no headings, no filler text.
- The **only** visible chrome is:
  - Top-right **account button** (shows "Sign in" when logged out, `@username`
    when logged in). Clicking opens the Account modal.
  - The floating box control panel (visible only for the active box).
  - The right-click context menu, when triggered.
  - The transient "Address copied" toast, when triggered.
  - The fullscreen button on hover of the active box.

---

## 16. Account modal contents (in this order)

1. **Sign-in** section (only if logged out): username input + Sign in button.
2. **Signed-in-as** row with Log out button (only if logged in).
3. **My boxes** section (only if logged in):
   - Header with count.
   - Empty state: instructions to scroll and buy a box.
   - List of owned boxes sorted by most-recently-updated first.
   - Each row: `(x,y)` mono label, truncated content label
     (`▶ youtu.be/<id>` or `Empty`), click to navigate, Edit / Add video
     button, inline YouTube URL input on edit.
4. **Scroll sound** toggle row. Default ON. Persisted in `localStorage`.
5. **Close** button.

---

## 17. Component structure (current)

```
src/
  main.tsx              Router setup. Routes "/" and "/:x/:y" → <App/>.
  App.tsx               Home page chrome: account button, Account modal, mounts <InfiniteCanvas/>.
  InfiniteCanvas.tsx    Scroll engine: input, snap spring, rebasing, 3x3 render window, URL sync.
  BoxTile.tsx           Renders one tile. Fetches box record, chooses server content or mock,
                        shows owner badge, fullscreen button.
  BoxControlPanel.tsx   Floating panel over the active box: Buy / Edit / YouTube URL form.
  boxStore.ts           Zustand cache of BoxRecords keyed by "x:y" with in-flight dedup.
  store.ts              Zustand store for grid center {centerX, centerY}.
  auth.ts               Zustand auth store {user, token, login, logout}; persists to localStorage.
  uiStore.ts            Tiny zustand store for cross-component UI state (accountOpen).
  api.ts                Local mock backend in localStorage. Same shape as a real REST client.
  content.ts            Mock content generator; deterministic hash of (x,y) → content kind.
  tickSound.ts          Web Audio synthesized click + box-cross tick driver.
  index.css             Tailwind entry.
server/
  index.js              Optional Express implementation of the same API (not required to run).
```

Logical name → file mapping required by the original spec:
| Spec component    | File                                |
| ----------------- | ----------------------------------- |
| InfiniteCanvas    | `src/InfiniteCanvas.tsx`            |
| GridRenderer      | inside `InfiniteCanvas.tsx`         |
| BoxTile           | `src/BoxTile.tsx`                   |
| SnapController    | snap loop in `InfiniteCanvas.tsx`   |
| CoordinateRouter  | `main.tsx` + URL effects in canvas  |
| ContentLoader     | `src/content.ts` + `api.ts`         |
| ViewportManager   | `getBoxDims()` + resize hook        |

---

## 18. Tech stack

- **Frontend:** Vite + React 18 + TypeScript, Tailwind CSS, Zustand, React Router.
- **State:** All app state in small Zustand stores. No Redux. No context soup.
- **Persistence (today):** `localStorage` under `boxyy.db` and `boxyy.auth`
  and `boxyy.sound.enabled`.
- **Audio:** Web Audio API, no external assets.
- **Backend (planned):** Node + Express + Postgres/Supabase. `src/api.ts` is the
  only file that changes when the real backend lands.

---

## 19. Run instructions

```bash
npm install
npm run dev        # frontend on :5173 — this is all you need
npm run server     # optional Express mock backend on :3001
```

Default route redirects / resolves to `/0/0` by way of the router.

---

## 20. Feature checklist (current state)

- [x] Infinite scrollable 2D grid
- [x] Magnetic snap to nearest box on scroll stop
- [x] Inertia removed (no auto-motion)
- [x] 16:9 YouTube-aspect boxes
- [x] 3×3 virtual window, 9 DOM nodes max
- [x] URL `/x/y` per box, two-way sync
- [x] Mouse, touch, trackpad, wheel, keyboard input
- [x] Right-click → Copy box address
- [x] Fullscreen button per active box
- [x] iOS-style tick sound, one per box crossing, pitch/volume by speed
- [x] Tick sound toggle inside Account modal, default ON
- [x] Dummy username login (localStorage)
- [x] "Buy this box" claim flow, including login prompt when signed out
- [x] Owner badge on tiles
- [x] Inline "Add/Change YouTube video" on active box panel
- [x] "My boxes" list in Account modal with inline edit
- [x] `localStorage`-backed mock backend with same shape as real REST API
- [x] Pointer capture does not eat button clicks (canvas skips drag on UI targets)

---

## 21. Pre-launch checklist (before going live)

1. Replace `localStorage` mock in `src/api.ts` with real REST client.
2. Implement real backend (Postgres/Supabase) following §12 schema.
3. Replace dummy username login with real auth (Clerk / Auth.js / Supabase Auth).
4. Implement Stripe Checkout on `POST /api/boxes/:x/:y/claim`. Finalize
   ownership only on `checkout.session.completed` webhook.
5. Rate limits + Helmet + CORS allowlist on the Express app.
6. CSP: `frame-src https://www.youtube.com` (and any future embed origins).
7. Validate all YouTube URLs server-side (already done in `server/index.js`).
8. Set `VITE_API_URL` env var for production deploys.
9. Test on iOS Safari, Android Chrome, desktop Safari/Chrome/Firefox/Edge.
10. Verify audio unlock works on iOS Safari with the silent switch both on and
    off (Web Audio ignores the silent switch; HTMLAudio does not).

---

## 22. Non-negotiables (rules for future changes)

- The home page stays empty chrome. No text, no headings, no navbar, no sidebar.
- The grid must never scroll on its own. Ever.
- Only one box is active at any time — the one snapped at center.
- Only 9 boxes are ever rendered in the DOM for the grid.
- Every box has a unique `(x, y)` and a unique `/x/y` URL.
- Ownership is enforced server-side. The frontend must never decide.
- Audio errors must never break scrolling.
- Pointer capture must never eat clicks on UI controls layered over the canvas.
- The tick sound fires **once per box boundary crossed**, never per pixel.
- The tick sound default is ON and lives in the Account modal.
- Sign-in, ownership, and "My boxes" all flow through `src/api.ts`. No component
  talks directly to storage.

---

## 23. Change log

- **2026-04-07** — Initial spec written. Covers everything built in the first
  working cut: scroll engine, snap, 16:9 boxes, fullscreen, right-click copy,
  iOS-style tick sound, dummy auth, box ownership, YouTube content, My boxes
  list, pointer-capture fix.
- **2026-04-07** — Added production architecture blueprint (sections 24–35):
  Supabase + Cloudflare R2 + Cloudflare CDN + Upstash Redis + Stripe. Capacity
  target: 10k creators, 50k+ concurrent viewers.
- **2026-04-07** — Added Part 3 (Activity-ranked layout). Address `(x,y)` is
  decoupled from grid position. Grid renders a server-ranked feed of owned
  boxes; hottest boxes appear first. Scroll engine, snap, tick sound, and
  right-click copy address are unchanged.
- **2026-04-07** — Added Part 4 (Production architecture impact of activity
  ranking). Same Supabase + R2 + Cloudflare + Redis + Stripe stack; deltas
  cover the new `/feed` hot endpoint, pre-rendered top-500 Redis cache,
  heartbeat ingestion, and the rank recompute worker.
- **2026-04-08** — Brand rename **infgrid → boxyy** across the entire repo
  (source, page title, package name, README, this spec, localStorage keys,
  R2 bucket placeholder).
- **2026-04-08** — Added Part 5 (Phase 1 shipped: Supabase integration). Real
  Supabase Postgres + Auth replaces the localStorage mock. Google sign-in is
  the only entry point. The app is now a hard sign-in gate: nothing renders
  until the user is signed in *and* has claimed a unique username. RLS +
  SECURITY DEFINER RPCs enforce ownership server-side.
- **2026-04-08** — Pushed the project to GitHub (`chotazombie/Boxyy`). First
  Cloudflare Pages deploy attempted; failed because the new unified
  Workers + Pages flow uses the Cloudflare Vite plugin which requires
  Vite ≥ 6. Bumped Vite from 5.4 → 6.4 in `package.json`. Build succeeded
  on the second attempt.
- **2026-04-08** — Removed `public/_redirects`. The Cloudflare Workers asset
  config (`assets.not_found_handling: "single-page-application"` in the
  auto-generated `wrangler.json`) handles SPA fallback now; the old
  `_redirects` file caused an "infinite loop" validation error and is
  unnecessary.
- **2026-04-08** — boxyy is **live** at
  `https://boxyy.sameersinghwork.workers.dev/`. End-to-end flow verified:
  Google sign-in → username claim → claim a box → set YouTube content →
  multi-user reads.
- **2026-04-08** — First production glitch reported: "stuck on one box". Root
  cause identified as a hard browser security boundary — wheel/pointer
  events over a cross-origin YouTube iframe are routed to YouTube's own
  document and cannot be intercepted by the parent page. Two fix attempts
  pushed (`f800a4b` pointer-events:none, `0699630` click-to-interact
  toggle), both rolled back locally because the toggle UX was rejected.
  Local working directory currently sits at the original glitchy state of
  commit `dd1a8d7`. Production (Cloudflare) and remote `main` still have
  the toggle. Decision pending — see Part 6 §80.
- **2026-04-08** — Added Part 6 (Production deployment & the cross-origin
  iframe constraint). Documents today's deployment work end-to-end and the
  four UX options for solving the iframe constraint, with a clear "current
  state vs decision pending" snapshot so this work can be picked up by
  any future contributor (or me, in a fresh chat) without losing context.

---

# PART 2 — PRODUCTION ARCHITECTURE BLUEPRINT

> This part is forward-looking. It describes the target production system, not
> the current prototype. Treat it as the execution plan. The same
> **DO NOT CHANGE UNLESS SPECIFICALLY ASKED** rule from the top of the file
> applies here.

## 24. Capacity target

The system is being designed to comfortably handle:

- **10,000+ creators** uploading photos, videos, and media to their boxes.
- **50,000+ concurrent viewers** scrolling the grid and streaming media.
- ~**2 TB** of user-uploaded media in year one, growing.
- Peak of roughly:
  - ~1.35M box metadata reads/sec un-cached → **<5k req/sec at origin** after CDN.
  - Tens of Gbps of media egress.
  - 5–20k writes/sec at peak (views, likes, edits), buffered and batched.

Design rule: every hot path must be able to absorb traffic spikes via caching
or buffering. The origin database is never in the hot path for reads or for
high-frequency writes.

---

## 25. High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare (DNS + WAF + CDN + Workers)                      │
│  • SPA static assets (cached forever via hashed filenames)   │
│  • API edge cache (10–30s TTL, stale-while-revalidate)       │
│  • Media CDN in front of R2 (global, zero-egress-fee)        │
└──────┬──────────────────────────────────────┬────────────────┘
       │                                      │
       ▼                                      ▼
┌──────────────┐                      ┌──────────────────┐
│ Vercel or    │                      │ Cloudflare R2    │
│ Fly.io       │                      │ bucket (media)   │
│ Backend API  │                      │ • direct upload  │
│ Node + Hono  │                      │ • presigned URLs │
└──────┬───────┘                      └──────────────────┘
       │
       ├──► Supabase Postgres     (users, boxes, likes, purchases, view aggregates)
       ├──► Supabase Auth         (Google sign-in, sessions, JWT)
       ├──► Upstash Redis         (view counters, rate limits, short-TTL cache)
       ├──► Stripe                (checkout, webhooks, billing)
       ├──► Cloudflare Stream     (video transcoding + HLS playback)  [optional, for video]
       └──► Sentry / Axiom        (errors, structured logs)
```

**Responsibility split — non-negotiable:**

- **Supabase is Postgres + Auth.** Nothing else. Never serve media from Supabase
  Storage to end users.
- **Cloudflare R2 + CDN** is the *only* media path.
- **Redis** is the only place high-frequency counters and rate limits live
  before being batched into Postgres.
- **Cloudflare CDN** is in front of all public reads (SPA, API GETs, media).

---

## 26. Services & roles

| Service              | Role                                                     | Why this one |
| -------------------- | -------------------------------------------------------- | ------------ |
| Cloudflare (CDN/DNS) | Edge cache for SPA, API GETs, and media                  | Free egress, global POPs, best-in-class cache controls |
| Cloudflare R2        | Media object storage                                     | S3-compatible, **zero egress fees**, cheap storage |
| Cloudflare Stream    | Video transcoding + adaptive HLS playback (later)        | Handles ABR without building a pipeline |
| Supabase Postgres    | Source of truth for users, boxes, likes, purchases       | Real Postgres, PgBouncer, RLS, backups, point-in-time recovery |
| Supabase Auth        | Google OAuth, sessions, JWT issue/refresh                | Built-in Google provider, JWT works with RLS |
| Upstash Redis        | View counters, rate limits, short-TTL cache              | Serverless, pay-per-request, global replication |
| Stripe               | Payments (box purchases) + webhooks                      | Standard |
| Backend host         | Hono/Express API, presign + webhook + cron workers       | Vercel for simplicity, Fly.io/Railway if long-running workers needed |
| Sentry               | Error tracking (frontend + backend)                      | Standard |
| Axiom / Better Stack | Structured logs + uptime                                 | Cheap, good DX |

**Do not use Supabase Storage for user-facing media.** Avatars or tiny static
assets are OK; box content is not.

---

## 27. Database schema (Postgres / Supabase)

```sql
-- Users
create table users (
  id            uuid primary key default gen_random_uuid(),
  username      citext unique not null,
  email         citext unique not null,
  google_sub    text unique,
  avatar_url    text,
  created_at    timestamptz not null default now()
);
create index on users (lower(username));

-- Boxes (one row per OWNED box; free boxes do not exist in this table)
create table boxes (
  x             integer not null,
  y             integer not null,
  owner_id      uuid not null references users(id) on delete cascade,
  content_kind  text,                        -- 'youtube' | 'image' | 'video' | 'iframe' | 'html'
  content_data  jsonb,                       -- kind-specific payload (videoId, r2_key, etc.)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (x, y)
);
create index on boxes (owner_id);

-- Likes / saves
create table box_likes (
  user_id       uuid not null references users(id) on delete cascade,
  box_x         integer not null,
  box_y         integer not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, box_x, box_y),
  foreign key (box_x, box_y) references boxes(x, y) on delete cascade
);
create index on box_likes (box_x, box_y);

-- Aggregate view counts (written by periodic Redis → Postgres flush)
create table box_views (
  box_x         integer not null,
  box_y         integer not null,
  total_views   bigint  not null default 0,
  unique_views  bigint  not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (box_x, box_y)
);

-- Raw view events (30–90 day retention, for per-user history and analytics)
create table box_view_events (
  id            bigserial primary key,
  box_x         integer not null,
  box_y         integer not null,
  user_id       uuid references users(id),
  session_hash  text,                        -- sha256(ip + ua + daily_salt)
  viewed_at     timestamptz not null default now()
);
create index on box_view_events (box_x, box_y, viewed_at);
create index on box_view_events (user_id, viewed_at);

-- Stripe purchases
create table purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id),
  box_x                 integer not null,
  box_y                 integer not null,
  stripe_session_id     text unique not null,
  stripe_payment_intent text,
  amount_cents          integer not null,
  currency              text not null,
  status                text not null,       -- 'pending' | 'paid' | 'refunded'
  created_at            timestamptz not null default now()
);
create index on purchases (user_id);
```

**Row-Level Security rules:**
- `boxes`: `select` is public; `update` only when `owner_id = auth.uid()`.
- `box_likes`: users can only insert/delete rows where `user_id = auth.uid()`.
- `box_views`: `select` is public; writes only via service-role backend.
- `purchases`: users can `select` their own rows; writes only via service-role.
- `users`: users can `select` public columns on anyone; can only update their own row.

---

## 28. Media pipeline (R2 + Cloudflare)

**Uploads are always direct-to-R2 via presigned URLs. Uploads never pass through
the API server.**

### 28.1 Upload flow
```
Browser               Backend               R2                 Postgres
   │   POST /uploads/presign                                      │
   │   ─────────────────►                                          │
   │                    validate size/mime/quota                   │
   │                    create presigned PUT URL                   │
   │   ◄─────────────────                                          │
   │                                                                │
   │   PUT <presigned url>                                          │
   │   ───────────────────────────►                                 │
   │                                                                │
   │   POST /boxes/:x/:y/content                                    │
   │   ─────────────────►                                          │
   │                    HEAD r2_key (verify it exists)              │
   │                    insert/update boxes row ──────────────────► │
   │   ◄─────────────────                                          │
```

### 28.2 Rules
- Presign returns: `{ uploadUrl, r2_key, expiresAt }`. URL valid 5 minutes.
- Max size per file: 100 MB for images, 500 MB for videos (tune later).
- Allowed MIME types allowlisted server-side.
- Per-user upload quota enforced at presign time (e.g. 5 GB free tier, higher for paid boxes).
- Object key pattern: `boxes/<x>/<y>/<uuid>-<slug>.<ext>`.
- On successful content set, the previous object (if any) is enqueued for deletion.

### 28.3 Delivery
- All media is served from `https://media.yourdomain.com/<r2_key>`, which is a
  Cloudflare-cached R2 custom domain.
- Cache headers: `Cache-Control: public, max-age=31536000, immutable`
  (filenames contain a UUID so content is effectively immutable).
- No signed URLs for public boxes. (If private boxes are ever added, switch to
  short-lived signed URLs per request.)

### 28.4 Video
- Raw video uploads go through **Cloudflare Stream** instead of raw R2.
- `POST /uploads/video/presign` returns a Stream direct-upload URL.
- Box `content_data` stores `{ kind: 'video', streamId, playbackUrl }`.
- Player uses Stream's HLS playback URL for adaptive bitrate.
- Image content continues to use R2 directly.

### 28.5 Image processing
- On upload completion, a background worker (Cloudflare Worker or backend job)
  generates compressed derivatives (thumbnail, medium, full) using `sharp` or
  Cloudflare Images, stored alongside the original in R2.
- `content_data` stores all derivative keys: `{ key, keyThumb, keyMedium }`.

---

## 29. API surface (production)

All endpoints are under `https://api.yourdomain.com`. Auth is an HttpOnly
cookie issued by Supabase Auth, or `Authorization: Bearer <jwt>`.

### Auth
```
GET  /api/auth/me                                   → { user } | 401
POST /api/auth/google/start                         → { url }
GET  /api/auth/google/callback?code=...             → sets cookie, redirects
POST /api/auth/logout                               → 204
POST /api/users/username        { username }       → { user }
```

### Boxes
```
GET  /api/boxes/:x/:y                               → BoxRecord | { free: true }
GET  /api/boxes/batch?coords=0:0,1:0,...           → BoxRecord[]
POST /api/boxes/:x/:y/checkout                     → { checkoutUrl }     // Stripe
POST /api/webhooks/stripe                           → 200                 // ownership finalize
PUT  /api/boxes/:x/:y/content   { kind, data }     → BoxRecord           // owner only
```

### Uploads
```
POST /api/uploads/presign       { filename, mime, size } → { uploadUrl, r2_key }
POST /api/uploads/video/presign                          → { uploadUrl, streamId }
```

### Likes / Saved
```
POST   /api/boxes/:x/:y/like                        → { liked: true }
DELETE /api/boxes/:x/:y/like                        → { liked: false }
GET    /api/me/likes?cursor=...                     → { items, nextCursor }
```

### Views
```
POST /api/boxes/:x/:y/view                          → 204                // fire-and-forget
GET  /api/boxes/:x/:y/views                         → { total, unique }
GET  /api/me/boxes                                  → BoxRecord[]        // includes per-box view counts
```

### Rules
- Every write endpoint runs through an auth middleware.
- `PUT /content` re-verifies ownership against the DB; never trusts client state.
- `POST /view` is rate-limited per `(IP, box)` to 1 per 30s.
- `POST /webhooks/stripe` verifies the Stripe signature against
  `STRIPE_WEBHOOK_SECRET` and is idempotent on `stripe_session_id`.
- All request bodies validated with **Zod**.

---

## 30. Caching & read hot path

Goal: 95%+ of box reads must be served from Cloudflare edge cache without ever
hitting the origin backend.

### 30.1 Layered cache
```
Browser in-memory (Zustand boxStore, per-session)
  ↓
Cloudflare edge cache  (public API GETs, 10–30s TTL, SWR 60s)
  ↓
Backend API (Hono/Express)
  ↓
Upstash Redis  (60–120s TTL, cache of Postgres rows)
  ↓
Supabase Postgres  (source of truth)
```

### 30.2 Invalidation
- When a box's content or ownership changes:
  1. Write to Postgres inside a transaction.
  2. `DEL` the Redis cache key for that box.
  3. Call Cloudflare cache purge API for
     `https://api.yourdomain.com/api/boxes/:x/:y` and the relevant
     `/batch` permutations.
  4. Bump a global `box_version` counter so the frontend can force-refetch the
     active viewport after a mutation it just made.

### 30.3 Batch fetch
- Frontend prefetches the full 3×3 window in one request:
  `GET /api/boxes/batch?coords=0:0,1:0,-1:0,0:1,0:-1,1:1,1:-1,-1:1,-1:-1`.
- Batch endpoint is also edge-cacheable, keyed on the full sorted coordinate
  list.

---

## 31. Write hot path — views and likes

### 31.1 View counting (Redis-first, never direct to Postgres)
- `POST /boxes/:x/:y/view`:
  1. Rate-limit per `(IP, box)` — 1/30s — via Redis `SET NX EX 30`.
  2. `INCR box:views:total:{x}:{y}` in Redis.
  3. If authenticated: `PFADD box:views:users:{x}:{y} {user_id}` (HyperLogLog
     for cheap unique approximation). Also insert an event row into
     `box_view_events` asynchronously for per-user history.
  4. If anonymous: `PFADD box:views:sessions:{x}:{y} sha256(ip+ua+daily_salt)`.
  5. Return 204 immediately.

### 31.2 Batched flush (cron, every 30–60s)
- Worker reads all dirty `box:views:*` keys.
- For each box, computes `total` delta and `unique` count (`PFCOUNT`).
- Single batched SQL:
  ```sql
  insert into box_views (box_x, box_y, total_views, unique_views)
  values ...
  on conflict (box_x, box_y) do update
    set total_views = box_views.total_views + excluded.total_views,
        unique_views = greatest(box_views.unique_views, excluded.unique_views),
        updated_at = now();
  ```
- Reset counters and HLL sets after successful flush.
- Result: Postgres sees ~10–50 batched UPSERTs per minute instead of
  thousands of writes per second.

### 31.3 Per-user view history
- `box_view_events` is written directly (not buffered) but rate-limited so the
  volume is bounded.
- `GET /api/me/boxes` joins `boxes` with a subquery counting events for the
  current user, so owners see how many times *their* boxes were viewed and by
  whom (at aggregate level; individual identities are not exposed).
- Consider rolling daily aggregates into `box_view_daily(box_x, box_y, day,
  total, unique)` for cheap per-box charts.

### 31.4 Likes
- Write straight to `box_likes`; this volume is low enough that Postgres is
  fine.
- `GET /api/me/likes` paginates by `created_at DESC`.
- Optional denormalized `likes_count` on `boxes` maintained by a trigger or
  recomputed periodically.

---

## 32. Payments flow (Stripe Checkout)

```
Browser → POST /boxes/:x/:y/checkout
Backend:
  1. BEGIN; SELECT … FROM boxes WHERE (x,y) FOR UPDATE;
  2. If already owned → 409.
  3. INSERT purchases (status='pending', stripe_session_id=null)
  4. Create Stripe Checkout Session:
       metadata: { box_x, box_y, user_id, purchase_id }
       success_url: https://yourdomain.com/x/y?purchased=1
       cancel_url:  https://yourdomain.com/x/y
  5. Save stripe_session_id on the purchase row.
  6. COMMIT;
  7. Return { checkoutUrl }.

Browser redirects to Stripe.

Stripe → POST /webhooks/stripe  (checkout.session.completed)
Backend:
  1. Verify signature with STRIPE_WEBHOOK_SECRET.
  2. Idempotent on stripe_session_id.
  3. BEGIN;
  4. UPDATE purchases SET status='paid' WHERE stripe_session_id=...;
  5. INSERT INTO boxes (x, y, owner_id) ON CONFLICT DO UPDATE ...;
     (double-check no other owner has been written in the meantime)
  6. Purge CDN cache for /boxes/:x/:y.
  7. COMMIT;

Browser returns to /x/y?purchased=1, re-fetches box, sees ownership.
```

Rules:
- Ownership is **only** assigned on webhook. Never from the success redirect.
- Every step is idempotent.
- Refund handling flips ownership back and records the reversal on the
  `purchases` row.

---

## 33. Security hardening

- **Transport:** HTTPS everywhere. HSTS header on the apex domain.
- **Auth cookies:** `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.yourdomain.com`.
- **CSRF:** same-origin API + SameSite=Lax handles most; add a double-submit
  token on state-changing routes that can be triggered cross-site.
- **CORS:** allowlist production SPA origin only. No wildcards.
- **CSP:**
  ```
  default-src 'self';
  frame-src https://www.youtube.com https://www.youtube-nocookie.com https://iframe.videodelivery.net;
  img-src 'self' https://media.yourdomain.com https://i.ytimg.com data:;
  media-src 'self' https://media.yourdomain.com https://videodelivery.net;
  connect-src 'self' https://api.yourdomain.com https://*.supabase.co https://*.ingest.sentry.io;
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  ```
- **Rate limits (Redis-backed):**
  - `/view`: 30/min/IP, 1/30s per `(IP, box)`.
  - `/checkout`: 5/min/user.
  - `/uploads/presign`: 30/min/user.
  - `/username`: 10/day/user.
  - Global per-IP: 600/min.
- **Input validation:** Zod on every endpoint. Reject unknown fields.
- **YouTube URLs:** parsed and allowlisted server-side to a single 11-char ID.
- **HTML content** (if ever exposed): sanitize via `sanitize-html` with a strict
  allowlist. Never trust client-provided HTML.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, R2 access keys,
  `GOOGLE_CLIENT_SECRET` — backend only, never shipped to the browser.
- **Headers:** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Stripe webhook:** reject unsigned; idempotency on `stripe_session_id`.
- **Audit log table** for sensitive actions (ownership transfers, refunds,
  username changes) — append-only.

---

## 34. Observability & ops

- **Error tracking:** Sentry on frontend and backend. Release tagging tied to
  git SHA.
- **Logs:** structured JSON via pino → Axiom or Better Stack. Log every write,
  every auth event, every Stripe webhook.
- **Uptime:** Better Stack pinging `/healthz` every 30s from multiple regions.
- **Metrics dashboard:**
  - Box views per minute
  - Box sales per hour
  - Conversion: viewers → buyers
  - Auth success/failure ratio
  - p50/p95/p99 latency on `/boxes/:x/:y`, `/batch`, `/checkout`
  - Redis hit/miss ratio
  - Stripe webhook success rate
  - Cloudflare cache hit ratio (should be >90%)
- **Backups:** Supabase nightly + point-in-time recovery (Team tier).
- **Migrations:** `drizzle-kit` or `prisma migrate`. Never hand-edit prod.
- **Feature flags:** basic kill switches in Redis
  (`flag:uploads_enabled`, `flag:purchases_enabled`) so features can be
  disabled without a deploy.
- **Staging environment:** separate Supabase project, separate R2 bucket,
  separate Stripe test account. Same infra shape.

---

## 35. Environment variables

```
# Frontend (VITE_ prefix = public, bundled into the SPA)
VITE_API_URL=https://api.yourdomain.com
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_MEDIA_BASE=https://media.yourdomain.com
VITE_SENTRY_DSN=...

# Backend (secrets, never shipped)
DATABASE_URL=postgres://...                    # via Supabase PgBouncer :6543
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
REDIS_URL=rediss://...                          # Upstash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=boxyy-media
R2_PUBLIC_BASE=https://media.yourdomain.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...                       # flat price if applicable
CLOUDFLARE_STREAM_TOKEN=...                     # optional, for video uploads
CLOUDFLARE_API_TOKEN=...                        # for cache purge API
CORS_ORIGIN=https://yourdomain.com
SESSION_COOKIE_DOMAIN=.yourdomain.com
SENTRY_DSN=...
DAILY_VIEW_SALT=...                             # rotated daily, for session hashing
```

---

## 36. Execution plan (step-by-step rollout)

This is the order to build. Each step should be deployable and testable on its
own.

### Phase 0 — Accounts & domains
- [ ] Register production domain.
- [ ] Create Cloudflare account, add domain, enable proxy.
- [ ] Create Supabase project (Pro tier minimum).
- [ ] Create Google Cloud OAuth client, add redirect URIs.
- [ ] Create Stripe account, generate test keys.
- [ ] Create Upstash Redis database.
- [ ] Create Cloudflare R2 bucket + custom domain `media.yourdomain.com`.
- [ ] Create Sentry + Axiom projects.

### Phase 1 — Database & auth
- [ ] Write migrations for the schema in §27.
- [ ] Apply to Supabase.
- [ ] Configure Row-Level Security policies.
- [ ] Enable Google provider in Supabase Auth.
- [ ] Add `/auth/callback` route in the SPA.
- [ ] Replace `src/api.ts` mock with a real client using `@supabase/supabase-js`.
- [ ] Add "choose your username" modal after first Google sign-in.

### Phase 2 — Backend skeleton
- [ ] New `api/` service: Hono/Express, Zod, pino, Sentry.
- [ ] Deploy to Vercel or Fly.io.
- [ ] Implement `/healthz`, auth middleware, CORS, helmet, rate limit.
- [ ] Wire PgBouncer connection via `DATABASE_URL`.
- [ ] Implement `/boxes/:x/:y` and `/boxes/batch` (read-only).
- [ ] Add Cloudflare edge cache rules for both.
- [ ] Swap frontend `boxStore.fetch` to hit the real API.

### Phase 3 — Ownership & content
- [ ] Implement `PUT /boxes/:x/:y/content` with server-side ownership check.
- [ ] Implement YouTube URL parsing + allowlist.
- [ ] Keep the existing YouTube `content.kind` working end-to-end against the
      real backend.

### Phase 4 — Payments
- [ ] Implement `POST /boxes/:x/:y/checkout` (transactional, writes pending
      purchase row, creates Stripe Checkout Session).
- [ ] Implement `POST /webhooks/stripe` (signature verify, idempotent, writes
      ownership).
- [ ] Wire the "Buy this box" button to redirect to Stripe.
- [ ] Test end-to-end with Stripe CLI (`stripe listen`).
- [ ] Purge CDN cache on ownership change.

### Phase 5 — Uploads (R2)
- [ ] Implement `POST /uploads/presign` (validates, returns presigned PUT URL).
- [ ] Add image upload UI to BoxControlPanel (drag/drop + file picker).
- [ ] Add image content kind: `{ kind: 'image', r2_key, keyThumb, keyMedium }`.
- [ ] Background worker to generate derivatives via `sharp`.
- [ ] Configure R2 → `media.yourdomain.com` with long-TTL cache headers.
- [ ] Enforce per-user upload quota at presign time.

### Phase 6 — Video (Cloudflare Stream)
- [ ] Implement `POST /uploads/video/presign` using Stream direct-upload API.
- [ ] Add video content kind: `{ kind: 'video', streamId, playbackUrl }`.
- [ ] Update BoxTile to render Stream HLS player for video kind.

### Phase 7 — Likes & Saved boxes
- [ ] Implement `POST/DELETE /boxes/:x/:y/like`.
- [ ] Implement `GET /me/likes` with cursor pagination.
- [ ] Add heart button on the active box.
- [ ] Add **Saved boxes** tab to the Account modal (same UI shape as My boxes).

### Phase 8 — View counting
- [ ] Implement `POST /boxes/:x/:y/view` (Redis-first, rate-limited).
- [ ] Implement Redis → Postgres flush worker (cron every 60s).
- [ ] Implement `box_view_events` writes for authenticated users.
- [ ] Expose per-box view counts on `GET /me/boxes` (owner-visible).
- [ ] Show view count on the owner's box in BoxControlPanel.
- [ ] Optional: daily rollup table + small chart in the Account modal.

### Phase 9 — Hardening
- [ ] CSP in production.
- [ ] Rate limits tuned against real traffic.
- [ ] Sentry release tagging.
- [ ] Load test with k6 against `/boxes/:x/:y`, `/batch`, `/view`.
- [ ] Verify Cloudflare cache hit ratio >90%.
- [ ] Chaos test: kill Redis and confirm view endpoint fails closed (rate limit)
      without breaking reads.

### Phase 10 — Soft launch → public launch
- [ ] Invite-only soft launch with ~100 users.
- [ ] Watch Sentry + Stripe + logs for 48 hours.
- [ ] Fix whatever breaks.
- [ ] Public launch.
- [ ] Announce.

---

## 37. Cost envelope (rough, monthly, at target scale)

| Service                | Est. cost (USD)      |
| ---------------------- | -------------------- |
| Supabase Pro/Team      | $25 – $600+          |
| Cloudflare R2 storage  | ~$30 @ 2 TB          |
| Cloudflare R2 egress   | **$0**               |
| Cloudflare (CDN/WAF)   | $20 – $200           |
| Cloudflare Stream      | variable w/ video    |
| Upstash Redis          | $10 – $100           |
| Backend host (Fly/etc) | $20 – $200           |
| Stripe                 | 2.9% + 30¢ per txn   |
| Sentry / Axiom         | ~$50                 |
| **Total**              | **~$800 – $2500**    |

Most of the cost is compute + CDN, not storage. Egress is the single biggest
thing R2 saves us on compared to S3 or Supabase Storage.

---

## 38. Non-negotiables for production

- **Media never passes through the API server.** Presigned PUT to R2, direct
  GET from the CDN.
- **Supabase Storage is not used for user-facing media.** R2 + Cloudflare only.
- **Writes to `box_view_events` are rate-limited.** Aggregate counters live in
  Redis and flush in batches.
- **Ownership is written only from the Stripe webhook**, never from the
  browser's success redirect.
- **Every write endpoint re-verifies ownership in the DB.** The frontend never
  decides.
- **Cloudflare edge cache must be the primary read layer.** Origin handles
  <10% of box reads at steady state.
- **All secrets live only on the backend.** The only keys shipped to the SPA
  are the Supabase anon key, the public Sentry DSN, and the public media base
  URL.
- **Every mutation purges its cache keys** (Redis + Cloudflare) in the same
  transaction path.
- **Staging mirrors production** — separate Supabase project, R2 bucket, and
  Stripe account. No test data ever touches production.

---

# PART 3 — ACTIVITY-RANKED LAYOUT

> Same DO NOT CHANGE rule applies. This part redefines what occupies each cell
> of the visible 3×3 viewport. The scroll engine, snap, tick sound, fullscreen,
> right-click copy, ownership, payments, and media pipeline are all unchanged.

## 39. Concept

`(x, y)` is no longer the grid position. It is now **only** the box's permanent
address — its unique ID and its shareable URL `/x/y`. The grid is rendered from
a **ranked feed** of boxes. The hottest box (most live views, then engagement,
then recency) is at feed index 0; the next hottest at index 1; and so on.

The 3×3 viewport always shows a 9-item slice of that feed. Scrolling moves the
center index through the feed instead of through coordinate space. Two users
scrolling at the same time may see slightly different orderings as activity
shifts — that's the whole point.

| Before (Part 1) | After (Part 3) |
| --- | --- |
| `centerX, centerY` are coordinates on an infinite plane | `centerIndex` is a position in a ranked feed array |
| Render: `box at (centerX+dx, centerY+dy)` | Render: `feed[centerIndex - 4 .. centerIndex + 4]` laid out in the same 3×3 pattern |
| Address = `(x,y)` from grid position | Address = `(x,y)` from the box record itself |
| URL `/x/y` teleports to that grid coordinate | URL `/x/y` finds that box's current rank in the feed and seeks to it |
| New box claims write at the user's chosen coordinate | New box claims are server-assigned the next free `(x,y)` in spiral order |

## 40. Scroll → feed mapping

- The 3×3 viewport shows nine consecutive feed positions, laid out reading-order:
  ```
  [c-4][c-3][c-2]
  [c-1][ c ][c+1]
  [c+2][c+3][c+4]
  ```
  where `c` is `centerIndex`.
- **Scroll right by one box** → `centerIndex += 1`. Visual right neighbor becomes the new center.
- **Scroll down by one box** → `centerIndex += 3`. The whole row advances.
- Negative directions are symmetric.
- Snap, inertia rules, tick sound, and fullscreen behavior are identical to Part 1.
  "Box crossed" now means `centerIndex` changed.

## 41. Empty / placeholder slots

- The feed contains only **owned** boxes. Free coordinates are not in the feed.
- Any visible slot whose feed index is `>= feed.items.length` (or `< 0`) renders
  a **placeholder tile**: dark, centered "+" icon, label "Claim a new box".
- Clicking a placeholder calls `claimNewBox()` which assigns the next free
  `(x,y)` and inserts the new box into the feed in front of the placeholder.
- Placeholders are not addressable. Right-click "Copy box address" is hidden on
  placeholders.

## 42. Live views & ranking

### 42.1 Live view definition
- A user is "watching" the box that is currently their **active center**.
- Frontend opens a heartbeat: `POST /api/boxes/:x/:y/heartbeat` every 10s while
  that box is the center, and stops when the user scrolls away or the tab is hidden.
- Backend stores the heartbeat in Redis with a 30s TTL — automatic cleanup.

### 42.2 Score formula (time-decayed, Hacker News style)
```
score = (live_views * 50
       + hourly_views * 5
       + daily_views
       + likes_count * 10)
      / pow((hours_since_last_activity + 2), 1.5)
```
- Recomputed by a worker every 15s.
- Stored on `box_activity.rank_score`.
- `live_views * 50` keeps the feed feeling alive; small changes in concurrent
  viewers visibly reorder the top.
- Tie-breaker for two boxes with equal score: most recently updated first.

### 42.3 Boost (future, not built)
- Owners may pay to boost their box rank for a limited window. This is a
  planned revenue lever. Implementation TBD; expected: a `boost_until` column
  on `box_activity` and a fixed multiplier added to `score` while active.
- **Do not implement until explicitly asked.**

## 43. Schema additions

```sql
-- Activity & ranking
create table box_activity (
  box_x          integer not null,
  box_y          integer not null,
  live_views     integer not null default 0,    -- count of active heartbeats (last 30s)
  hourly_views   integer not null default 0,
  daily_views    integer not null default 0,
  likes_count    integer not null default 0,
  rank_score     double precision not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (box_x, box_y),
  foreign key (box_x, box_y) references boxes(x, y) on delete cascade
);
create index on box_activity (rank_score desc);

-- Counter for the next free coordinate when assigning new claims
create table box_coord_cursor (
  id      int primary key default 1,
  next_n  bigint not null default 0
);
insert into box_coord_cursor (id, next_n) values (1, 0)
  on conflict do nothing;
```

The spiral coordinate from `next_n` is computed in code (see §45).

## 44. New API endpoints

```
GET  /api/feed?cursor=<rank>&limit=200          → { items, nextCursor, version }
GET  /api/boxes/:x/:y/rank                      → { rank: number | null }
POST /api/boxes/claim-next                      → BoxRecord       // assigns next free (x,y)
POST /api/boxes/:x/:y/heartbeat                 → 204             // 10s interval while watching
```

- `/feed` is edge-cached for 10s with stale-while-revalidate. `version`
  increments whenever the global ordering changes meaningfully.
- `/rank` is Redis-cached for ~30s.
- `/heartbeat` is rate-limited per `(IP, box)` to one per 8s.
- `/claim-next` is transactional: locks `box_coord_cursor`, computes next
  spiral coord, increments cursor, inserts the box (or kicks off Stripe
  checkout when payments are live), commits.

## 45. Coordinate assignment (spiral)

New box claims are assigned the next free coordinate in spiral order from the
origin: `(0,0), (1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1), (2,-1), …`
This is purely cosmetic — the position no longer affects layout — but a spiral
keeps the assigned coordinates compact and aesthetically pleasing.

The assigner is a pure function `nthSpiralCoord(n) → (x, y)`. The DB cursor
stores only `n`; the server (and the mock) computes `(x, y)` on demand.

## 46. Frontend changes

### 46.1 New store: `feedStore.ts`
```ts
interface FeedState {
  items: (BoxRecord | null)[];     // sliding window; null = placeholder slot
  centerIndex: number;
  version: number;
  loaded: boolean;
  refresh: () => Promise<void>;
  seekToBox: (x: number, y: number) => Promise<void>;
  setCenterIndex: (i: number) => void;
}
```
- Pulls from `api.getFeed()`.
- During active scrolling, the items array is **frozen** — no reorders.
- On idle (no input for 5s), `refresh()` re-fetches the feed; if the user's
  current center box still exists, `centerIndex` is rebased to its new rank so
  the user stays on the same box.

### 46.2 InfiniteCanvas
- Replaces `centerX/centerY` with `centerIndex`.
- The render loop maps each `(dx, dy)` in the 3×3 to a feed index:
  `idx = centerIndex + dy * 3 + dx`.
- `rebase()` shifts `centerIndex` by ±1 horizontally or ±3 vertically when
  offset crosses ±boxW/2 or ±boxH/2.
- URL sync: on `centerIndex` change, read `feed.items[centerIndex]?.x/y` and
  write `/x/y` via `replace`.
- On mount with `/x/y` in the URL, call `feed.seekToBox(x, y)`.

### 46.3 BoxTile
- Accepts `box: BoxRecord | null`. If `null`, renders a placeholder card with a
  "+" icon and "Claim a new box" label.
- Active placeholder also exposes the same `Buy this box` flow but routed
  through `claimNewBox()`.
- New live-view badge on the active tile: `🔴 N watching`. Driven by data
  bundled in the feed response.

### 46.4 BoxControlPanel
- If the active slot is a placeholder → show "Claim a new box" button (calls
  `claimNewBox`).
- Else → unchanged (Buy / You own this / YouTube URL form).

### 46.5 Account modal
- "My boxes" section unchanged; per-box rows now also show `▶ live N` badges.
- New button at the top: **Claim a new box** — alternative entry point that
  doesn't require scrolling to a placeholder slot.

## 47. URL & address rules (unchanged in spirit)

- `/x/y` is still the canonical, shareable address of every owned box.
- Right-click → Copy box address still copies `${origin}/x/y`. Unchanged.
- The only difference: navigating to `/x/y` no longer "teleports" through
  coordinate space — it resolves the box's current rank and seeks the feed.

## 48. Mock backend rules (dev mode)

- The localStorage mock implements the same endpoints listed in §44.
- Activity tracking is approximated: every time a box becomes the active center
  for ≥1s, its `daily_views` and `hourly_views` are incremented and
  `lastActiveAt` is bumped. Live views are not simulated multi-user; for the
  local mock, `live_views` is always either 0 or 1 (the current viewer).
- `claim-next` uses an in-localStorage cursor and the same `nthSpiralCoord`
  function as production.
- Feed ordering uses the same score formula as production but with mock inputs.

## 49. Non-negotiables (Part 3)

- The address `(x, y)` is permanent. Changing rank must never change a box's
  address.
- The frontend never decides ranking. It renders whatever order the server
  returns.
- Feed re-ordering is **frozen** during active scrolling. New orderings only
  apply when the user is idle, and the user's current center box must remain
  in place when rebasing.
- Placeholder slots are not addressable. They cannot be linked to, copied, or
  claimed by URL — only by clicking.
- Heartbeats are best-effort and rate-limited; they must never block input or
  affect scrolling.

---

# PART 4 — PRODUCTION ARCHITECTURE IMPACT OF ACTIVITY RANKING

> Same DO NOT CHANGE rule. This part is a delta on Part 2. The full stack
> (Supabase Postgres + Auth, Cloudflare R2 + CDN, Upstash Redis, Stripe,
> Cloudflare Stream) is unchanged. Only the things below change. Read this
> alongside Parts 2 and 3, not instead of them.

## 50. Why the stack is still right

- The ranked feed model **simplifies caching**, it does not complicate it.
- In the coordinate model, viewers could request any `(x, y)` in the infinite
  plane, so the cache key space was effectively unbounded.
- In the ranked feed model, almost every viewer requests the same first page of
  `/feed`. The active cache key space collapses to ~50–100 distinct cursors at
  any moment. Cloudflare absorbs nearly all of it at the edge.
- Net effect at the 50k concurrent viewer target: **fewer requests reach
  origin**, not more. Supabase consultation on the read path actually goes
  down.

## 51. Component responsibility deltas

| Component             | Coordinate model role                       | Ranked feed role |
| --------------------- | ------------------------------------------- | ---------------- |
| Supabase Postgres     | Source of truth + hot reads via `/boxes/:x/:y` | Source of truth + activity table; reads mostly bypass it via the pre-rendered feed cache |
| Cloudflare CDN        | Caches 9 box URLs per viewport              | Caches the single `/feed` URL keyed by `(cursor, version)` |
| Upstash Redis         | View counters + rate limits                 | View counters + rate limits + **heartbeat store** + **pre-rendered top-500 feed cache** |
| Backend API           | Stateless request handlers                  | Stateless handlers + **rank recompute worker** running every 15s |
| Cloudflare R2 + media | Media delivery (unchanged)                  | Media delivery (unchanged) |
| Stripe                | Box purchases at user-chosen `(x,y)`        | Box purchases at server-assigned next spiral coord (`claim-next`) |
| Cloudflare Stream     | Video transcoding (unchanged)               | Video transcoding (unchanged) |

The headline shift: **Postgres is consulted less on the read path.** The feed
cache absorbs almost everything. Postgres's role narrows to "write-side source
of truth + occasional miss reads", which is exactly where it shines.

## 52. The new hot endpoint: GET /feed

`GET /feed` replaces `GET /boxes/:x/:y` and `/boxes/batch` as the dominant read
endpoint. At 50k concurrent viewers it is the single hottest URL in the
system.

### 52.1 Contract
```
GET /api/feed?cursor=<opaque>&limit=200
  → {
      items: [
        { x, y, ownerUsername, content, activity: { liveViews, ... }, rankScore }
      ],
      nextCursor: <opaque> | null,
      version: <int>
    }
```

### 52.2 Cursor format
- **Do not paginate by raw rank index.** Indices shift constantly as scores move.
- Cursor is an opaque base64 of `(rank_score, box_x, box_y)`. The next page is
  `WHERE (rank_score, box_x, box_y) < (cursorScore, cursorX, cursorY)
   ORDER BY rank_score DESC, box_x DESC, box_y DESC LIMIT 200`.
- This survives small reorderings without users seeing duplicates or gaps.

### 52.3 Caching
- **Cloudflare edge cache** with key = full URL (so `cursor` and `limit` are
  part of the key). Headers:
  ```
  Cache-Control: public, max-age=10, stale-while-revalidate=30
  ```
- Target hit ratio at the edge: **>95%**.
- The `version` field in the response lets the frontend detect when its
  in-memory feed snapshot is stale.

### 52.4 Origin path
When a request misses the edge cache, the backend responds in this order:
1. **Pre-rendered top-500 in Redis.** A backend worker keeps the first 500
   ranked boxes serialized as a single JSON blob in Redis at
   `feed:top500:v<version>`. ~99% of cursors live inside this slice. Origin
   serves it in O(1) with no DB query.
2. **Cursor beyond top 500.** Fall through to a paginated DB query against the
   `box_activity` table joined with `boxes`. Index on `(rank_score desc, box_x
   desc, box_y desc)` is mandatory.
3. **Cold start of pre-rendered cache.** If `feed:top500:v<version>` is missing
   for any reason, run the recompute job inline (single-flighted via a Redis
   lock) and populate it.

## 53. The rank recompute worker

A new background workload, persistent process, single instance per region (or
sharded by box range). Runs every **15 seconds**.

### 53.1 Job
```
1. Read live view counts from Redis:
   - For each active box, PFCOUNT box:live:{x}:{y}
2. Compute new rank_score for each owned box using the §42.2 formula.
3. Batched UPSERT into box_activity:
     insert into box_activity (..., rank_score, updated_at)
     values (...)
     on conflict (box_x, box_y) do update set ...
4. Increment global feed version (Redis INCR feed:version).
5. Pre-render the new top 500 from box_activity:
     select * from box_activity
     join boxes using (box_x, box_y)
     order by rank_score desc, box_x desc, box_y desc
     limit 500
6. Serialize and SET feed:top500:v<newVersion> in Redis (with EX 60s, refreshed
   every 15s, so it never actually expires under load).
7. Purge Cloudflare cache for /api/feed* via the Cloudflare API.
8. Emit metrics: job duration, top-500 hash, score distribution.
```

### 53.2 Where it runs
- **Day 1:** a long-running Node process on the same Fly.io / Railway host as
  the API. `setInterval(15_000)` with a single-flight lock in Redis so multiple
  API replicas can't all run it.
- **Scale-out:** dedicated worker dyno separate from the API. Same code, just
  isolated process boundaries.
- **Do not use Supabase Edge Functions on a cron** — they're cold-started per
  invocation, capped at 10s, and add latency.
- **Do not use Cloudflare Cron Triggers for the worker itself** — the 10s
  execution cap is too tight as the box count grows. Cron Triggers are fine
  for *triggering* a worker that runs elsewhere.

### 53.3 Health & failure
- Worker writes a `worker:rank:last_run_at` Redis key on success. Alert if
  stale > 60s.
- Worker is single-flighted via `SET worker:rank:lock NX EX 30`.
- If the worker is down, the API still serves stale `feed:top500` from Redis
  indefinitely. Reads never fail because of worker failure.

## 54. Heartbeat ingestion (the new write hot path)

`POST /api/boxes/:x/:y/heartbeat` is fired by every viewer, every 10s, while
the box is their active center.

### 54.1 Volume estimate
- 50k concurrent viewers × 1 heartbeat / 10s = **5,000 writes/sec sustained**.
- Bursts during global content drops can be higher.
- **None of this can hit Postgres.** All of it goes to Redis.

### 54.2 Endpoint behavior
```
POST /api/boxes/:x/:y/heartbeat
  → 204 (fire-and-forget; client never waits)

Backend:
  1. Rate-limit per (IP, box) to 1 per 8s using SET NX EX 8.
     If the key exists, return 204 immediately without doing work.
  2. Compute session_hash = sha256(user_id || ip+ua || daily_salt)
  3. PFADD box:live:{x}:{y} <session_hash>          (HyperLogLog, ~12KB max per box)
  4. EXPIRE box:live:{x}:{y} 60                      (auto-clean idle boxes)
  5. Return 204.
```

### 54.3 Counting
- The recompute worker reads `PFCOUNT box:live:{x}:{y}` for every box that has
  a live key. This gives an approximate (1.6% error) live viewer count.
- Inactive boxes auto-expire from Redis after 60s of no heartbeats.
- Postgres never participates in this loop.

### 54.4 Scaling Redis
- **Day 1:** Upstash Redis Pay-as-you-go. ~$10–30/mo at this volume.
- **At higher scale:** Upstash Global Database for multi-region replication so
  heartbeats from users on different continents stay sub-50ms.
- **At still higher scale:** push heartbeats to **Cloudflare Workers + Durable
  Objects**. A Worker `INCR`s a Durable Object counter at the edge, and the
  backend reads aggregated counts every 15s. Sub-50ms globally, no
  origin round-trip. This is the architecture to evolve toward only when
  heartbeat traffic becomes a bottleneck.

## 55. Updated API surface

Replace §29 with this set as the production target. Endpoints not listed are
unchanged from §29.

```
# Reads (hot path)
GET  /api/feed?cursor=<opaque>&limit=200            → { items, nextCursor, version }
GET  /api/boxes/:x/:y                               → BoxRecord            // direct URL navigation
GET  /api/boxes/:x/:y/rank                          → { rank: number|null }

# Heartbeats (hot path)
POST /api/boxes/:x/:y/heartbeat                     → 204                  // every 10s while watching

# Ownership
POST /api/boxes/claim-next                          → { checkoutUrl }      // server picks next spiral coord
POST /api/webhooks/stripe                           → 200                  // finalizes ownership
PUT  /api/boxes/:x/:y/content   { kind, data }      → BoxRecord            // owner only

# Likes
POST   /api/boxes/:x/:y/like                        → { liked: true }
DELETE /api/boxes/:x/:y/like                        → { liked: false }
GET    /api/me/likes?cursor=...                     → { items, nextCursor }

# Profile
GET  /api/me                                        → { user }
GET  /api/me/boxes                                  → BoxRecord[]          // includes per-box view counts
POST /api/users/username   { username }             → { user }

# Auth (unchanged, see §29)
```

Notable changes vs §29:
- `POST /api/boxes/:x/:y/checkout` → `POST /api/boxes/claim-next`. The user no
  longer chooses a coordinate; the server assigns it from the spiral cursor.
- `GET /api/feed` is added as the dominant read endpoint.
- `POST /api/boxes/:x/:y/heartbeat` is added.
- `GET /api/boxes/:x/:y/rank` is added so the SPA can resolve a shared `/x/y`
  link to a feed position.

## 56. Schema additions vs Part 2

The Part 2 schema (§27) is unchanged. The Part 3 additions (§43) apply: add
`box_activity` and `box_coord_cursor`. Also add this index for the feed query:

```sql
create index box_activity_rank_desc
  on box_activity (rank_score desc, box_x desc, box_y desc);
```

And this index for `/rank` lookups:

```sql
-- Already covered by the primary key (box_x, box_y); explicit for clarity.
```

## 57. Caching layer deltas vs §30

Replace the "API edge cache" bullet in §30 with this layered model:

```
Browser in-memory (feedStore items snapshot)
  ↓
Cloudflare edge cache (/feed?cursor=…&v=…, 10s TTL, SWR 30s)
  ↓
Backend API
  ↓ (in priority order)
  1. Redis pre-rendered top-500 blob (feed:top500:v<n>)
  2. Postgres paginated query against box_activity (cold cursors only)
```

Invalidation:
- The recompute worker bumps `feed:version` and purges `/api/feed*` from
  Cloudflare. The next request rebuilds the cache.
- Single-box mutations (`PUT /content`, ownership change) purge their own
  `/api/boxes/:x/:y` cache key, plus they trigger an out-of-band recompute job
  hint so the next worker tick picks up the change immediately.

## 58. Updated execution plan (replaces §36 Phase 8)

The Phase 0–7 plan in §36 is unchanged. Replace Phase 8 with this expanded
version, and renumber the rest.

### Phase 8 — View counting + heartbeats
- [ ] Implement `POST /boxes/:x/:y/view` (Redis-first, rate-limited).
- [ ] Implement `POST /boxes/:x/:y/heartbeat` (Redis HyperLogLog, rate-limited).
- [ ] Implement Redis → Postgres aggregate flush worker for `box_views`.
- [ ] Implement `box_view_events` writes for authenticated users.
- [ ] Surface per-box view counts on `GET /me/boxes`.
- [ ] Show view count on the owner's box in BoxControlPanel.

### Phase 8b — Activity ranking & feed
- [ ] Apply schema additions for `box_activity` and `box_coord_cursor`.
- [ ] Implement the rank recompute worker (15s interval, single-flighted).
- [ ] Implement the pre-rendered top-500 Redis cache (`feed:top500:v<n>`).
- [ ] Implement `GET /api/feed` with opaque cursor pagination and edge caching.
- [ ] Implement `GET /api/boxes/:x/:y/rank`.
- [ ] Implement `POST /api/boxes/claim-next` (server-assigned spiral coords).
- [ ] Wire frontend `feedStore` to the real `/api/feed` endpoint (replace mock).
- [ ] Wire frontend heartbeat to the real `/heartbeat` endpoint.
- [ ] Cloudflare cache rule: `/api/feed*` cached 10s, SWR 30s.
- [ ] Cloudflare cache purge on every recompute tick.
- [ ] Sentry breadcrumb on every worker run; alert if stale >60s.

### Phase 9 — Hardening (renumbered, content unchanged from §36)
### Phase 10 — Soft launch → public launch (renumbered, content unchanged)

## 59. Updated environment variables

Add to §35:

```
# Feed / ranking
RANK_WORKER_INTERVAL_MS=15000
FEED_TOP_N=500
HEARTBEAT_RATE_LIMIT_SECONDS=8
HEARTBEAT_TTL_SECONDS=60
DAILY_HEARTBEAT_SALT=...           # rotated daily, for session_hash
CLOUDFLARE_API_TOKEN=...           # for /feed* cache purge
CLOUDFLARE_ZONE_ID=...
```

## 60. Cost envelope deltas vs §37

| Item                                   | Delta              |
| -------------------------------------- | ------------------ |
| Supabase compute                       | **slightly lower** (read load on Postgres drops because the feed cache absorbs it) |
| Cloudflare CDN bandwidth               | roughly unchanged (feed payload is small JSON, gzips well, served from edge) |
| Cloudflare cache purge API calls       | +$0 (free at this volume) |
| Upstash Redis ops                      | **+$10–30/mo** (heartbeat ingestion at ~5k ops/sec peak) |
| Backend host (worker process)          | +$0–20/mo (the worker is one extra `setInterval`; no new dyno needed at first) |
| **Net change**                         | **roughly flat**, possibly slightly cheaper at scale |

The ranked feed does not move the cost envelope materially. It moves load
*within* the stack: less Postgres, more Redis, same CDN, same R2.

## 61. Non-negotiables (Part 4)

- **The `/feed` endpoint must be edge-cached.** Hit ratio target >95%.
- **The rank recompute worker is single-flighted via a Redis lock.** Multiple
  API replicas must not race.
- **Heartbeats never touch Postgres.** Redis only.
- **Heartbeats are rate-limited per (IP, box) at 1 per 8s.** Excess heartbeats
  return 204 immediately without doing work.
- **The recompute worker runs every 15s, not faster.** Faster runs add cost
  without improving perceived freshness.
- **The pre-rendered top-500 blob in Redis is always available.** Cold start
  triggers an inline single-flighted recompute. Reads never fail because of
  worker failure.
- **Cursor pagination uses `(rank_score, box_x, box_y)`, not raw indices.** Raw
  indices would shift under users mid-pagination.
- **Worker code lives in the backend repo, not in Edge Functions.** Persistent
  process, not invocation-based.
- **Scaling beyond 50k concurrent viewers** is the trigger to evaluate
  Cloudflare Workers + Durable Objects for heartbeat ingestion. Until then,
  Upstash Redis is sufficient.

---

# PART 5 — PHASE 1 SHIPPED: SUPABASE INTEGRATION

> Same DO NOT CHANGE rule. This part documents what is *actually built and
> running today* against a real Supabase project. It is not aspirational. It
> covers the why, the what, and the how of the Phase 1 work so any future
> contributor (human or AI) has the full picture.

## 62. What changed conceptually

The prototype's `localStorage` mock backend has been **replaced** with a real
Supabase project. Auth, persistence, and ownership enforcement now run
server-side in Postgres + Supabase Auth. The frontend no longer owns any
business logic about who can do what.

The user-facing change is twofold:

1. **The app is now a hard sign-in gate.** Nothing about the grid, the boxes,
   the feed, the account button — *nothing* — renders until the user is
   signed in via Google **and** has claimed a unique username. This was an
   explicit product call: viewing must require an account.
2. **Sign-in is Google-only.** No usernames, no passwords, no magic links. The
   first thing every user sees is the Google sign-in button. After Google
   consent, they must immediately claim a permanent username before they can
   access the app.

The architecture targets in Parts 2–4 are unchanged. Phase 1 implements the
foundation: real DB, real auth, real ownership enforcement, no payments yet,
no CDN yet, no rank worker yet.

## 63. Brand rename

The product is now called **boxyy**. Every reference to the previous working
name has been replaced:

- Page `<title>` → `boxyy`
- `package.json` `name` → `boxyy`
- README heading → `boxyy`
- Sign-in screen logo text → `boxyy`
- localStorage keys → `boxyy.sound.enabled`, `boxyy.db`, `boxyy.auth`
- R2 bucket placeholder → `boxyy-media`
- This spec's title → `boxyy`

## 64. Frontend state machine (the sign-in gate)

`App.tsx` is the gate. It renders exactly one of four states based on auth:

```
loading             → centered "Loading…" splash
!user               → <SignInGate />          (Google button only, fullscreen)
user && no username → <UsernameClaim />       (username input only, fullscreen, no escape)
user && username    → <SignedInApp />         (the real app: grid + account button)
```

Rules:

- The grid (`<InfiniteCanvas />`) is **only mounted in the final state**. It
  cannot be reached by URL manipulation. Even visiting `/3/-2` directly while
  signed out shows the sign-in gate.
- `<UsernameClaim />` cannot be dismissed. There is no close button, no
  outside-click handler. The only escape is **Sign out**, which sends the
  user back to the sign-in gate.
- The username input is validated client-side and server-side against
  `^[a-zA-Z0-9_]{3,20}$` and is unique (case-insensitive via `citext`).
  Conflicts return a clear error message.
- After a successful username claim, the gate transitions to `<SignedInApp />`
  in the same render — no extra navigation.

## 65. Authentication flow (end-to-end)

```
Browser                            Supabase                 Google
   │                                  │                        │
   │  click "Sign in with Google"     │                        │
   │  ─ supabase.auth.signInWithOAuth ┼──► consent URL ───────►│
   │                                                            │
   │  ◄──────────── redirect to https://<proj>.supabase.co/auth/v1/callback?code=…
   │                                  │                        │
   │  ◄────────── redirect to http://localhost:5173/auth/callback#access_token=…
   │                                  │
   │  AuthCallback mounts             │
   │  • supabase.auth.getSession()    │
   │  • Supabase parses URL fragment, stores session in localStorage
   │  • bootstrap() → api.getMyProfile()
   │  • navigate('/')
   │
   │  App.tsx re-renders:
   │  • user is set
   │  • user.username may be empty (first time) → <UsernameClaim />
   │  • or already set → <SignedInApp />
   │
   │  on first sign-in:
   │  • Postgres trigger handle_new_user() created the public.users row
   │    automatically when auth.users got the new row.
   │  • That row has no username yet → frontend gates on UsernameClaim.
   │
   │  user types username → submitUsername()
   │  • supabase.rpc('set_username', { p_username }) → updates public.users
   │  • bootstrap() refreshes profile
   │  • App transitions to <SignedInApp />
```

Key points:

- **Session persistence** is handled by Supabase JS with
  `persistSession: true` and `autoRefreshToken: true`. Users stay signed in
  across reloads and tabs.
- **`detectSessionInUrl: true`** lets Supabase parse the OAuth fragment
  automatically on the callback page. We don't manually extract tokens.
- **`supabase.auth.onAuthStateChange`** is subscribed once at module load
  in `auth.ts` and triggers a profile refresh on every sign-in / sign-out /
  token refresh. The store stays in sync without explicit polling.
- The `AuthCallback` page surfaces failures visibly (red error + back button).
  Silent "Signing you in…" with no progress is not allowed — it always
  resolves to either success or a visible error.

## 66. Database schema (as deployed)

Defined in `supabase/migrations/0001_init.sql`. Live in the user's Supabase
project under the `public` schema.

### 66.1 Tables

```sql
public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      citext unique,                          -- nullable until claimed
  email         citext,
  avatar_url    text,
  created_at    timestamptz not null default now()
)

public.boxes (
  x             integer not null,
  y             integer not null,
  owner_id      uuid not null references public.users(id) on delete cascade,
  content_kind  text,                                   -- 'youtube' for now
  content_data  jsonb,                                  -- { videoId: '...' }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (x, y)
)
index boxes_owner_idx on public.boxes (owner_id)

public.box_activity (
  box_x          integer not null,
  box_y          integer not null,
  live_views     integer not null default 0,
  hourly_views   integer not null default 0,
  daily_views    integer not null default 0,
  likes_count    integer not null default 0,
  last_active_at timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (box_x, box_y),
  foreign key (box_x, box_y) references public.boxes(x, y) on delete cascade
)

public.box_coord_cursor (
  id      integer primary key default 1,           -- singleton (id = 1)
  next_n  bigint not null default 0
)
```

### 66.2 View

```sql
public.box_feed                 -- joined view used as the ranked feed source
```

Returns box rows enriched with owner username, owner avatar, activity counters,
and a **time-decayed `rank_score`** computed inline using:

```
score = (live_views * 50
       + hourly_views * 5
       + daily_views
       + likes_count * 10)
      / power((seconds_since_last_active / 3600) + 2, 1.5)
```

Phase 1 reads `box_feed` directly, sorted by `rank_score desc, updated_at desc`.
Phase 8b will replace this with a Redis pre-rendered top-500 cache and a
recompute worker, but the formula is identical.

### 66.3 Trigger: auto-create profile on signup

```sql
public.handle_new_user()  -- security definer
on auth.users insert → inserts public.users row with id, email, avatar_url
```

This runs the moment Supabase Auth creates a new `auth.users` row (i.e. on
first Google sign-in), so a profile row always exists by the time the
frontend's `getMyProfile()` runs. The `username` column is left null for the
gate to enforce.

## 67. SECURITY DEFINER RPC functions

The frontend never inserts into `boxes` directly, never modifies
`box_coord_cursor`, and never updates `box_activity`. All writes go through
RPC functions that run with elevated privileges and enforce business rules.

| Function | Role | Caller |
| --- | --- | --- |
| `claim_next_box()` | Locks the cursor row, finds the next free spiral coord, inserts the box, advances the cursor. Atomic. | authenticated users |
| `set_box_content(x, y, kind, data)` | Owner-checked content update. Validates `kind ∈ {youtube}`. | authenticated users |
| `box_heartbeat(x, y)` | Bumps `box_activity` counters. Phase 1 only — production buffers in Redis. | anon + authenticated |
| `set_username(name)` | Validates against regex, sets `public.users.username` for `auth.uid()`. | authenticated users |
| `nth_spiral_coord(n)` | Pure helper. Returns `(x, y)` for the nth cell in a square spiral from origin. | anon + authenticated |
| `handle_new_user()` | Trigger function. Creates `public.users` on `auth.users` insert. | trigger only |

`claim_next_box()` is the most subtle one. It does:

```sql
1. Lock public.box_coord_cursor row (FOR UPDATE)
2. Loop: compute (x, y) = nth_spiral_coord(next_n); if (x,y) is free, exit; else next_n++
3. INSERT INTO boxes (x, y, owner_id) VALUES (x, y, auth.uid())
4. INSERT INTO box_activity (...) ON CONFLICT DO NOTHING
5. UPDATE box_coord_cursor SET next_n = (last value + 1)
```

The `FOR UPDATE` lock means concurrent claims are serialized — two users
clicking "Claim a new box" at the same instant always get distinct
coordinates.

## 68. Row Level Security policies

RLS is **enabled on every table**. The defaults are deny-all; the only
allowances are:

```sql
public.users:
  select using (true)                          -- public profiles
  update using (id = auth.uid())               -- only your own row

public.boxes:
  select using (true)                          -- public reads
  update using (owner_id = auth.uid())         -- only owners can edit
  -- NO insert policy → boxes can ONLY be created via claim_next_box()

public.box_activity:
  select using (true)                          -- public counters
  -- NO write policies → only via box_heartbeat()

public.box_coord_cursor:
  -- NO policies → no client access at all
  -- Only SECURITY DEFINER functions touch it
```

This is the "frontend never decides" rule from §38 made literal: even if a
malicious client crafts a raw INSERT against `boxes` or `box_coord_cursor`,
the database rejects it. The only writes that succeed go through the audited
RPC functions.

## 69. Frontend ↔ Supabase wiring

| File | Role |
| --- | --- |
| `src/lib/supabase.ts` | Singleton Supabase JS client. Reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from env. `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`. |
| `src/api.ts` | Thin layer over the Supabase client. Same exported function shapes as the old mock so the rest of the app didn't need to change. Reads go through the `box_feed` view; writes go through the RPC functions. Maps DB rows ↔ `BoxRecord` objects. |
| `src/auth.ts` | Zustand auth store: `{ user, loading, needsUsername, bootstrap, signInWithGoogle, signOut, setUsername, refreshProfile }`. Subscribes once to `supabase.auth.onAuthStateChange` so the store auto-syncs on every auth event. |
| `src/AuthCallback.tsx` | The `/auth/callback` route component. Waits for the session, calls `bootstrap()`, navigates home. Shows visible errors instead of hanging. |
| `src/main.tsx` | Routes: `/`, `/:x/:y`, and `/auth/callback`. |
| `src/App.tsx` | The gate state machine described in §64. Renders `SignInGate`, `UsernameClaim`, or `SignedInApp` based on auth state. The grid is only mounted in `SignedInApp`. |
| `src/vite-env.d.ts` | TypeScript types for `import.meta.env.VITE_*`. |
| `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `DATABASE_URL`. Gitignored. |
| `.gitignore` | Excludes `.env*`, `node_modules`, `dist`, `server/data.json`. |

The token plumbing has been removed from `BoxControlPanel`, `InfiniteCanvas`,
and `App` — Supabase manages the session implicitly, so RPC calls just work
when there's a logged-in session.

## 70. What is real vs. what is still mocked

| Concern | Status |
| --- | --- |
| Auth (Google OAuth) | ✅ real (Supabase Auth) |
| User profile + username claim | ✅ real (`public.users` + `set_username` RPC) |
| Box ownership | ✅ real (`public.boxes` + `claim_next_box` RPC) |
| Content updates (YouTube only) | ✅ real (`set_box_content` RPC) |
| Ranked feed | ✅ real (the `box_feed` view, computed on the fly) |
| Per-user box list | ✅ real (`listMyBoxes` reads `box_feed` filtered by `owner_id`) |
| Heartbeats / live views | ⚠ writes straight to Postgres via `box_heartbeat` RPC. Works at low scale; will be replaced with Redis buffering in Phase 8b. |
| Box price / payments | ❌ not implemented. `claim_next_box` is currently free. Phase 4 adds Stripe Checkout. |
| Image / video uploads | ❌ not implemented. YouTube only. Phase 5 adds R2 + presigned uploads. |
| Likes / Saved boxes | ❌ not implemented. Phase 7. |
| CDN / edge cache | ❌ not implemented. Phase 9 + 8b. |
| Rate limiting | ❌ not implemented. Phase 9. |
| Sentry / observability | ❌ not implemented. Phase 9. |

## 71. Dev workflow

### 71.1 Run locally
```bash
npm install
npm run dev          # http://localhost:5173
```

The Vite dev server reads `.env.local` automatically. No backend needs to run
separately — the frontend talks directly to Supabase.

### 71.2 Apply or re-apply the schema
1. Open the `boxyy` Supabase project → **SQL Editor** → **+ New query**
2. Paste the contents of `supabase/migrations/0001_init.sql`
3. Run.

The migration is idempotent: every `CREATE` uses `IF NOT EXISTS` /
`OR REPLACE` / `ON CONFLICT DO NOTHING`, so re-running is safe.

### 71.3 Full reset for testing

In Supabase SQL Editor:
```sql
truncate table public.box_activity, public.boxes, public.users restart identity cascade;
update public.box_coord_cursor set next_n = 0 where id = 1;
delete from auth.users;   -- optional: also wipes signed-in users
```

In the browser DevTools Console:
```js
localStorage.clear(); sessionStorage.clear(); location.reload();
```

After both, the app returns to a totally fresh state: no users, no boxes,
spiral cursor back at 0, no client-side session.

## 72. Required Supabase project configuration

For sign-in to work end-to-end, three things must be configured in the
Supabase dashboard (one-time setup per environment):

1. **Authentication → Providers → Google** must be enabled with a valid
   Google Cloud OAuth client ID + secret pasted in.
2. **Authentication → URL Configuration** must include:
   - **Site URL:** `http://localhost:5173` (for dev) / production domain (later)
   - **Redirect URLs:** `http://localhost:5173/**` and the production
     equivalent
3. The **Google Cloud OAuth client's Authorized redirect URIs** must include
   the Supabase callback URL (looks like
   `https://<project-ref>.supabase.co/auth/v1/callback`).

Without all three, the Google flow either errors out at consent time or
silently bounces back with no session. The `AuthCallback` page now surfaces
this with a visible error so it never hangs.

## 73. Non-negotiables (Part 5)

- **The app is a hard sign-in gate.** No box, no grid, no feed, no
  coordinate, no content is ever rendered to a signed-out user. The
  `<InfiniteCanvas />` only mounts inside `<SignedInApp />`.
- **Username is required before access.** A signed-in user without a
  `public.users.username` row sees only the username claim screen and cannot
  bypass it.
- **Username is unique** (case-insensitive via `citext`) and validated by
  `set_username()` against `^[a-zA-Z0-9_]{3,20}$`. The frontend never trusts
  client-side validation alone.
- **The frontend never inserts into `boxes` directly.** All writes go through
  `claim_next_box()` and `set_box_content()`. RLS blocks direct INSERTs at
  the database level as a second line of defense.
- **`box_coord_cursor` is never accessible from the client.** No RLS policies
  exist for it; only SECURITY DEFINER functions can touch it.
- **The Postgres trigger `handle_new_user`** is the canonical way profile
  rows are created. The frontend does not insert into `public.users`. (The
  one exception is `claim_next_box`'s defensive `INSERT … ON CONFLICT DO
  NOTHING` for the calling user, which is a no-op when the trigger has
  already done its job.)
- **`AuthCallback` must always resolve** to either success-redirect or a
  visible error. It must never hang on "Signing you in…".
- **Secrets stay out of the client.** Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` are shipped to the browser. The anon key is safe
  to ship because RLS, not key secrecy, is what protects the data. The
  `service_role` key, the database password, and any other secret stays
  backend-only when the backend exists.
- **`.env.local` is gitignored** and must never be committed. Database
  passwords pasted in chat or any other public surface must be rotated
  immediately.
- **Phase 1 completes when the full sign-in → username → claim → edit →
  reload flow works end-to-end against real Supabase**, with no localStorage
  fallback paths in any of the production-relevant code. As of 2026-04-08
  this is the case.

## 74. What's next (pointer back to §36)

Phase 1 is done. The execution plan in §36 still applies. Pick up from:

- **Phase 2 — Backend skeleton.** Stand up a Hono/Express service for the
  things RLS can't safely handle: Stripe webhooks (Phase 4), R2 presigned
  upload URLs (Phase 5), the rank recompute worker (Phase 8b),
  cache-purge orchestration (Phase 9).

Until Phase 2 lands, everything continues to work directly against Supabase
from the browser. The dev experience is "edit, save, test in the browser" —
no servers to restart.

---

# PART 6 — PRODUCTION DEPLOYMENT & THE CROSS-ORIGIN IFRAME CONSTRAINT

> Same DO NOT CHANGE rule. This part captures everything that happened on
> 2026-04-08 around going live: the deployment pipeline, the Cloudflare-
> specific quirks we hit, the live URL, and the most important new
> architectural finding (the cross-origin iframe wheel/pointer constraint).
> If you are reading this in a fresh chat with no history, you can pick up
> from §80 — that section captures the open decision and the exact state of
> the working directory.

## 75. Quick reference

| Thing | Value |
| --- | --- |
| GitHub repo | `https://github.com/chotazombie/Boxyy` |
| Production URL | `https://boxyy.sameersinghwork.workers.dev/` |
| Hosting | Cloudflare Workers (unified Workers + Pages) via the Workers Vite plugin |
| Auto-deploy trigger | Push to `main` |
| Build command | `npm run build` (`tsc -b && vite build`) |
| Output directory | `dist/` |
| Vite version | ≥ 6.0 (required by the Cloudflare Vite plugin) |
| Node version on build | 22.16 (Cloudflare default) |
| Frontend env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (set in Cloudflare dashboard → Settings → Build) |
| Local env file | `.env.local` (gitignored) |
| Supabase project URL | `https://hmhpszttdqfjmybcmend.supabase.co` |
| SQL migration | `supabase/migrations/0001_init.sql` (applied via Supabase SQL Editor) |

## 76. Deployment pipeline

```
You                       GitHub                  Cloudflare
 │                          │                          │
 │  git push origin main ──►│                          │
 │                          │ ── webhook ─────────────►│
 │                          │                          │
 │                          │   1. clone repo          │
 │                          │   2. npm clean-install   │
 │                          │   3. npm run build       │
 │                          │      (tsc + vite build)  │
 │                          │   4. wrangler deploy     │
 │                          │      (uploads dist/ to   │
 │                          │       Workers asset CDN) │
 │                          │                          │
 │                          │   ~3 min total           │
 │                          │                          │
 │  https://boxyy.sameersinghwork.workers.dev/ ◄────── live
```

The build runs entirely on Cloudflare's machines. Your laptop is not in the
loop after `git push`. Cloudflare reads its own copy of `package.json`,
installs dependencies fresh, runs the build, and serves the resulting
`dist/` from their global edge network.

### 76.1 Why Cloudflare Workers, not Cloudflare Pages

Cloudflare merged Pages and Workers into a single product during their
2025 platform migration. New deployments of static SPAs go through the
**Workers Vite plugin** by default, which:

- Requires Vite ≥ 6.0
- Auto-generates a `wrangler.json` with `assets.not_found_handling:
  "single-page-application"` so unknown routes fall back to `index.html`.
- Uses `wrangler deploy` instead of the old "upload `dist/` to Pages" flow.
- Gives you a `*.workers.dev` subdomain instead of the old `*.pages.dev`.

Functionally it's still a static-asset deploy on Cloudflare's CDN — the URL
ends in `.workers.dev` but no actual Worker script runs. It's just the
serving layer that's been renamed.

### 76.2 The two pitfalls we hit (read this before re-deploying)

**Pitfall A — Vite 5 is rejected by the Workers Vite plugin.**

Symptom (from build log):
```
✘ [ERROR] The version of Vite used in the project ("5.4.21") cannot be
automatically configured. Please update the Vite version to at least
"6.0.0" and try again.
```

Fix: bump `vite` to `^6.0.0` (currently resolves to 6.4.x) and bump
`@vitejs/plugin-react` to `^4.3.4` (which supports Vite 6). Done in commit
`8138c92`.

**Pitfall B — `_redirects` file conflicts with Workers SPA fallback.**

Symptom (from build log):
```
✘ [ERROR] Invalid _redirects configuration:
Line 1: Infinite loop detected in this rule. This would cause a redirect to
strip `.html` or `/index` and end up triggering this rule again. [code: 10021]
```

What happened: I had added `public/_redirects` containing `/* /index.html 200`
based on the legacy Cloudflare Pages flow. But Workers handles SPA fallback
via `wrangler.json` (`assets.not_found_handling: "single-page-application"`),
which the plugin auto-generates, and Cloudflare validates `_redirects` more
strictly when both are present, treating the catch-all as a self-loop.

Fix: delete `public/_redirects`. The Workers plugin handles SPA fallback on
its own. Done in commit `dd1a8d7`.

**Rule for the future:** do not add a `_redirects` file to this project.
SPA fallback is handled by `wrangler.json` automatically.

## 77. Environment variables on Cloudflare

This is the trip-up that almost everyone hits. Cloudflare distinguishes:

- **Runtime variables and secrets** — for actual Worker scripts that execute
  on the edge. Set in: Settings → **Variables and Secrets**. Useless to us
  because we don't have a runtime Worker, only static assets.
- **Build environment variables** — passed into the `npm run build` step.
  Vite reads `VITE_*` vars from this environment and **bakes them into the
  bundle at build time**. Set in: Settings → **Build** → "Build variables
  and secrets" (or similar wording — the dashboard layout has been moving).

Variables we need on Cloudflare (Build environment, Production):

| Name | Value | Type |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://hmhpszttdqfjmybcmend.supabase.co` | Plaintext |
| `VITE_SUPABASE_ANON_KEY` | (the anon key from `.env.local`) | Plaintext |

**The anon key is safe to ship publicly.** RLS in Postgres is what protects
the data, not the secrecy of this key. It is designed to live in browser
bundles. Treat it like a public identifier.

**Never** put on Cloudflare (or anywhere browser-accessible):

- `DATABASE_URL` (contains the DB password)
- Supabase `service_role` key (bypasses RLS)
- Any future Stripe secret key
- Any future R2 access key
- Any future Google OAuth client *secret* (as opposed to client ID)

These will only ever exist on the backend (Phase 2's Hono service on Fly.io),
never in a Cloudflare Workers static-assets project.

## 78. Required configuration outside the repo

For the live URL to actually work, three things outside the codebase had to
be configured (one-time setup, already done):

1. **Supabase Auth → URL Configuration** has the production URL whitelisted:
   - **Site URL:** `http://localhost:5173` (kept for dev)
   - **Redirect URLs:** must include `https://boxyy.sameersinghwork.workers.dev/**`
     (the `/**` wildcard catches `/auth/callback`)

2. **Google Cloud Console → OAuth client → Authorized JavaScript origins**
   has `https://boxyy.sameersinghwork.workers.dev`. The Authorized
   Redirect URIs field still only contains the Supabase callback
   (`https://hmhpszttdqfjmybcmend.supabase.co/auth/v1/callback`) — Google
   redirects to Supabase, Supabase redirects to wherever the SPA asked for.

3. **Database password** was rotated after being accidentally pasted in chat
   on 2026-04-08. The new password is in `.env.local` only.

When a future environment is added (staging, custom domain, etc.) the same
three steps must be repeated for that origin.

## 79. The cross-origin iframe constraint (the most important new finding)

This is the architectural finding from today that anyone working on boxyy in
the future MUST internalize. Embedding YouTube — and any cross-origin video
or interactive content — into a scrollable feed introduces a hard browser
security boundary that no clever code can defeat.

### 79.1 What the constraint actually says

When the user's mouse wheel turns over physical pixels that belong to a
cross-origin iframe, the browser delivers the `wheel` event to the iframe's
document, **not** to the parent document. Same for `pointerdown`,
`pointermove`, `touchstart`, etc.

This is a security boundary, not a bug or an oversight. It exists so that an
embedded ad cannot snoop on the host page's scroll behavior, click locations,
or input. Every modern browser enforces it. There is **no** API that lets the
parent page "see" or "intercept" or "preview" those events.

Implications for boxyy:

- Wheel-scroll over a YouTube tile does not move the canvas. The wheel
  event goes to YouTube; YouTube does nothing useful with vertical scrolls,
  so the page appears stuck.
- Pointer-down over a YouTube tile, with the iframe interactive, also goes
  to YouTube. We can't start a canvas drag.
- Same is true for any future cross-origin embed (Twitch, Vimeo, Spotify
  player, etc.).

So at any given moment, over any given pixel of an iframe-rendered tile,
**either** the iframe is interactive (YouTube sees the events, we don't)
**or** it isn't (we see the events, YouTube doesn't). Both at once is
physically impossible.

### 79.2 The four real options

These are the only patterns that work. Every video-in-feed product on the
web is doing some variant of one of these.

#### Option A — Click-to-interact toggle

- Default: iframe is `pointer-events: none`. Scroll, drag, and right-click
  pass through to the canvas. Video plays muted + looped. Browsing works.
- A small **▶ Controls** button on the active tile (corner). Click → flip
  iframe to `pointer-events: auto`. Now YouTube controls work, scrolling
  pauses.
- Click **✕ Done** (or scroll away → tile becomes inactive → state resets) →
  back to default.
- **Pros:** scroll works everywhere by default; explicit and discoverable;
  same pattern as Twitter, Reddit, TikTok web.
- **Cons:** two clicks to use controls; the toggle button is visible UI
  clutter; user pushed back on this in this session.

This was implemented in commit `0699630` and rolled back from the local
working directory. It still exists on remote `main` and in the live
production deployment as of 2026-04-08.

#### Option B — Edge scroll gutter

- Iframe stays interactive by default (current rolled-back state). YouTube
  controls work.
- Each tile is rendered with a **transparent scroll-catcher strip** along
  its top, bottom, left, and right edges (~10–15px each).
- The strips have `pointer-events: auto` and forward wheel/pointer events
  to the canvas drag handler.
- **Pros:** YouTube controls work without any toggle; no extra UI.
- **Cons:** discoverability is poor (users have to know the strips exist);
  with 80vw boxes the strips are the only scrollable area in the viewport;
  on touch devices, ~12px is too thin to find reliably; doesn't address
  the wheel-over-iframe problem at all (only the drag-over-iframe one).
- **Verdict:** insufficient on its own. Could be combined with Option A as a
  "scroll on margins" hint. Not viable as the only solution.

#### Option C — Custom controls overlay (the production answer)

- Iframe is permanently `pointer-events: none`. Scroll works everywhere.
- We render **our own** play/pause/seek/volume/unmute/quality controls
  overlaid on top of the active tile (HTML/SVG, fully inside our document).
- We drive the actual playback by sending `postMessage` commands to YouTube
  via the **YouTube IFrame API**. YouTube explicitly opts in to this
  protocol, so it works across origins. We listen for
  `onPlayerStateChange` events to keep our overlay in sync with the
  underlying player state.
- **Pros:** scroll works everywhere AND controls work everywhere AND no
  toggle needed. Best UX. Same approach Twitter, Instagram, TikTok web,
  YouTube Shorts use for their own video feeds.
- **Cons:** ~half a day to a full day of implementation work. Have to build
  the controls UI, wire up `postMessage`, handle scrubber drag, volume
  slider, fullscreen, mute state, loading/buffering states, error states.
  More code to maintain. Need to add the YouTube IFrame API script tag
  (`https://www.youtube.com/iframe_api`) to `index.html`.
- **Verdict:** this is the right answer for production. Should be built
  before any real launch.

#### Option D — Hover-to-interact (auto-toggle)

- Iframe is `pointer-events: none` by default.
- When the user has hovered the active tile and stayed still for ~700ms,
  flip iframe to `pointer-events: auto` automatically. Show a brief
  "controls active" hint.
- The moment the user moves the cursor outside the tile, or starts a
  wheel/drag on the margin, flip back.
- **Pros:** no explicit button; feels seamless when it works.
- **Cons:** "magic" UX that not all users will discover; on touch devices
  there's no hover, so falls back to Option A's button anyway; the
  intermittent state ("sometimes interactive, sometimes not, depending on
  how still I am") is genuinely confusing in usability tests.
- **Verdict:** clever but unreliable across input modalities. Skip.

### 79.3 Recommendation

**Build Option C.** It's the only one without trade-offs. The other three are
all compromises around the constraint; Option C *uses* the YouTube API to
work *with* the constraint. It's also exactly what every production-grade
video-in-feed product does.

If we want to ship something today and revisit later, the next-best is
**Option A with a much smaller toggle button** (e.g. a hover-only icon in
the top-right corner that only appears on the active tile after 300ms, no
text label). That gives most of Option C's UX benefits without writing the
controls overlay.

The "do nothing" version (current rolled-back state) is **not viable for
production**. The grid is unusable as soon as a user has any video boxes,
because they can't scroll past their own video.

## 80. Current state and open decision (as of 2026-04-08, end of session)

### 80.1 Where the code physically is

**Local working directory** (`/Users/sameersingh/Projects/999ideas`):
- `src/BoxTile.tsx` and `src/InfiniteCanvas.tsx` are restored to their state
  at commit `dd1a8d7`. This is the original glitchy state — iframe is fully
  interactive by default, scroll over a YouTube tile does not work.
- These files are **staged but not committed and not pushed**. A
  `git diff --cached` will show the rollback.
- All other files are unchanged.

**Remote `main` on GitHub** (`chotazombie/Boxyy`):
- HEAD is at `0699630` — the click-to-interact toggle version.
- This is what GitHub sees and what Cloudflare deploys.

**Production** (`https://boxyy.sameersinghwork.workers.dev/`):
- Running the toggle version from `0699630`.
- Functional: scroll works, video plays, "Controls" button reveals YouTube
  controls when clicked.

**Recent commits, oldest first:**
```
9313288  Initial commit: boxyy Phase 1
8138c92  chore: bump vite to 6 for cloudflare pages compatibility
dd1a8d7  fix: remove _redirects, Workers Vite plugin handles SPA fallback
f800a4b  fix: youtube iframe was eating scroll/drag events, blocking grid scroll
0699630  feat: click-to-interact toggle for youtube boxes (scroll + controls)
```

### 80.2 The decision pending

Pick one of the four options in §79.2 and ship it. Recommendation: **Option C
(custom controls overlay)**. Acceptable interim: **Option A with a smaller
button**.

Once the decision is made, the implementation steps differ based on the
choice. For Option C specifically:

1. Add `<script src="https://www.youtube.com/iframe_api"></script>` to
   `index.html`, or load it dynamically in `BoxTile`.
2. Replace the bare `<iframe>` with one that uses `enablejsapi=1` in the
   embed URL and gives the iframe a stable ID.
3. On mount, instantiate `new YT.Player(iframeId, { events: { ... } })` to
   get a handle to the player.
4. Build a controls overlay div (positioned absolute on the active tile)
   with: play/pause button, scrubber (mouse-down + drag), current time +
   duration, volume button + slider, mute button.
5. Wire each control to `player.playVideo()`, `player.pauseVideo()`,
   `player.seekTo(seconds, true)`, `player.setVolume(0..100)`,
   `player.unMute()`, etc.
6. Subscribe to `onStateChange` and `onPlaybackQualityChange` to keep the
   overlay state synced (e.g. play/pause icon flips when YouTube buffers).
7. Iframe stays `pointer-events: none` always. Controls overlay is a
   separate sibling div with `pointer-events: auto`.
8. Roll forward: revert local rollback (so we're back at `0699630`), build
   on top of that, push.

For Option A-smaller-button: take `0699630`, change the toggle button to a
hover-only corner icon, remove the text label, push.

### 80.3 What is broken right now (production)

Nothing is broken in production. The toggle version (`0699630`) is live and
functional. Users can:
- Sign in with Google
- Claim a username
- Claim a box
- Add a YouTube video
- Scroll the grid (click "Controls" to interact with YouTube; click "Done"
  to resume scrolling)

The "broken" state is only the local working directory, which intentionally
sits at the rolled-back glitchy version while we discuss the right fix.

### 80.4 What to do in a fresh chat

If this conversation is lost and you're picking it up cold:

1. Read this whole spec, especially Parts 1, 5, and 6.
2. Check `git log --oneline -10` to see where the repo is.
3. Check `git status` to see whether the local rollback is still in place.
4. Confirm the production URL is still alive: open
   `https://boxyy.sameersinghwork.workers.dev/`.
5. Resume from §80.2 — the decision is which iframe-handling option to ship.

## 81. Things to remember about Cloudflare deployment

A grab-bag of facts that will save time on the next deploy:

- **Push to `main` triggers a deploy automatically.** No CI config needed.
- **First deploy of a fresh repo takes ~3 minutes.** Subsequent deploys are
  faster because dependency cache is warm.
- **Build env vars are in Settings → Build, NOT Settings → Variables and
  Secrets.** The latter is for runtime Worker scripts.
- **The build runs `npm clean-install` (not `npm install`)** so
  `package-lock.json` must be committed and accurate.
- **Node version on Cloudflare** is whatever they default to (currently
  Node 22). To pin it, set `NODE_VERSION=22` as a build env var.
- **`wrangler.json` is auto-generated by the Workers Vite plugin** during
  the build. We don't commit it. If the auto-generated config ever needs
  customization, we'd commit a `wrangler.jsonc` and the plugin would merge
  it. Right now we don't need this.
- **The only Cloudflare-specific file in the repo is nothing.** Vite config
  + package.json + the SPA itself are enough. The plugin handles the rest.
- **Logs from a failed deploy** are visible in: Cloudflare Dashboard →
  Workers & Pages → boxyy → Deployments → click the failed deployment → see
  full build log.
- **Rollbacks** can be done from: Cloudflare Dashboard → boxyy →
  Deployments → click any previous successful deployment → "Rollback to
  this deployment". This is the fastest emergency fix if a bad commit ships.

## 82. Non-negotiables (Part 6)

- **The cross-origin iframe constraint is permanent.** No future "fix" will
  let scroll and iframe controls coexist over the same pixels. Stop trying.
  Pick a pattern from §79.2 and accept the trade-offs.
- **Do not add a `_redirects` file.** Workers handles SPA fallback via
  `wrangler.json` automatically.
- **Vite must stay at ≥ 6.0.** The Cloudflare Vite plugin requires it.
- **Build env vars on Cloudflare go in Settings → Build**, not Variables
  and Secrets.
- **`.env.local` is gitignored and must stay that way.** Never commit it.
- **The anon Supabase key is fine to ship to the browser.** Do not treat
  it as a secret. RLS protects the data, not key secrecy.
- **The DB password, service role key, Stripe secrets, R2 secrets, and
  Google OAuth client secret never go into Cloudflare or the browser.**
  They live only on the backend that doesn't exist yet.
- **Production rollback path is built in.** Use Cloudflare's
  Deployments → Rollback button instead of force-pushing or reverting in
  git when something is on fire. Force-push only if truly necessary.
- **Push to `main` is a deploy.** Treat every commit on `main` as
  production. Use feature branches when in doubt.
