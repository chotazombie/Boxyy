# boxyy

A 2D infinitely scrollable grid of equal-sized content boxes with magnetic snapping. Each box has a unique `(x, y)` coordinate, its own URL (`/x/y`), and independent content (video / image / html / iframe / text).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 — defaults to `/0/0`.

Optional content API:

```bash
npm run server
```

## Architecture

```
src/
  main.tsx           Router setup. Routes "/" and "/:x/:y" both render <App/>.
  App.tsx            Home page: just <InfiniteCanvas/> + top-right profile button + modal.
  InfiniteCanvas.tsx Core engine: pointer/wheel/touch input, inertia, magnetic snap,
                     coordinate rebasing, 3x3 virtual window rendering, URL sync.
  BoxTile.tsx        Renders one box. Memoized. Active box is brighter & larger;
                     neighbors are dimmed/blurred. Uses translate3d for GPU compositing.
  content.ts         ContentLoader. Deterministic mock content per (x,y) via hash.
  store.ts           Zustand store: { centerX, centerY, setCenter }.
server/index.js      Optional Node/Express content API.
```

### Coordinate model

- `centerX`, `centerY` — integer coordinate of the box currently snapped at viewport center.
- `offsetX`, `offsetY` — sub-box pixel offset in `[-boxSize/2, boxSize/2]`.
- When `|offset| > boxSize/2` we **rebase**: shift the integer center by ±1 and subtract `boxSize` from the offset. This gives the illusion of an infinite plane while only ever rendering 9 boxes.

### Render window

A `3x3` (=9) box grid is rendered around `(centerX, centerY)`. Each tile is positioned with `transform: translate3d(...)` based on its grid delta plus the live offset. Only 9 DOM nodes regardless of how far the user travels — no DOM explosion, easy 60fps.

### Movement & snap (SnapController)

`InfiniteCanvas` runs a single `requestAnimationFrame` loop when the user releases input or stops scrolling:

1. **Inertia phase** — while `|velocity| > threshold`, integrate velocity into offset and apply exponential friction (`v *= 0.92`).
2. **Magnetic snap phase** — once velocity decays, ease offset toward `(0,0)` with stiffness `0.18`. This is the magnetic pull centering the nearest box.
3. **Settle** — when offset is below `0.4px`, snap exactly to `(0,0)` and stop the loop.

Rebasing runs every frame, so crossing a box boundary mid-flick simply increments the integer center and the loop continues seamlessly.

### Input

- **Mouse drag** — Pointer Events with pointer capture.
- **Touch / swipe** — same Pointer Events path (works on iOS/Android).
- **Wheel / trackpad pan** — `onWheel` accumulates into offset; an 80ms idle timer triggers snap.
- **Keyboard arrows** — moves exactly one box.

### Routing (CoordinateRouter)

- URL pattern `/:x/:y` (e.g. `/-5/20`).
- On mount or route change → seed `centerX/centerY` from params, reset offset.
- Whenever `centerX/centerY` changes (from snap) → `navigate('/x/y', { replace: true })`.
- Every box is therefore directly shareable.

### Content (ContentLoader)

`getContent(x, y)` returns a deterministic content descriptor based on a hash of the coordinate. Box kinds: `video`, `image`, `iframe`, `html`, `livestream`, `text`. Videos auto-play only on the active center box; everything else lazy-loads.

### Visual style

- Dark `#060608` background.
- Active center box: full brightness, scale 1, soft outer shadow.
- Neighbors: ~85% opacity, `brightness(0.45) blur(1px)`, scale 0.97.
- Each tile shows its `x,y` coordinate badge.

## Components map

| Spec name           | File                          |
| ------------------- | ----------------------------- |
| InfiniteCanvas      | `src/InfiniteCanvas.tsx`      |
| GridRenderer        | inside `InfiniteCanvas.tsx`   |
| BoxTile             | `src/BoxTile.tsx`             |
| SnapController      | `tick()` in `InfiniteCanvas`  |
| CoordinateRouter    | URL effects in `InfiniteCanvas` + `main.tsx` |
| ContentLoader       | `src/content.ts`              |
| ViewportManager     | `getBoxSize()` + resize hook  |
