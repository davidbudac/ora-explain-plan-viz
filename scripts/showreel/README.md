# Showreel

A 15-second motion-graphics promo for the Oracle Execution Plan Visualizer,
rendered from a single deterministic canvas timeline.

```
scene.html   the film — one canvas, one pure draw(t) function
render.mjs   frame-by-frame renderer (Chrome + ffmpeg) → mp4 / webm / poster
fonts/       Inter + JetBrains Mono, latin subsets (SIL OFL 1.1)
```

## Watch / edit

Open `scene.html` through any static server (fonts need HTTP, not `file://`)
and it loops live:

```bash
npx --yes http-server scripts/showreel -p 8080 -s   # then open localhost:8080/scene.html
```

The frame counter in the corner is hidden in render mode (`?render=1`).

## Render

```bash
node scripts/showreel/render.mjs [outDir] [fps] [supersample]
node scripts/showreel/render.mjs site/assets 60 2      # what ships
```

Writes `showreel.mp4` (H.264, CRF 17, faststart), `showreel.webm` (VP9) and
`showreel-poster.png` into `outDir`. Needs Chrome (`CHROME=` to override the
path) and ffmpeg (`FFMPEG=`). Rendering at `supersample 2` draws the canvas at
3840x2160 and lets ffmpeg downsample with Lanczos — that is where the crisp
type comes from; `1` is roughly 4x faster and fine for previewing.

## Why it is not a screen recording

Nothing in `scene.html` reads a clock. `window.__seek(t)` draws the frame at
time `t` and every random value comes from one frozen seeded pool, so the
renderer can walk `t = 0, 1/60, 2/60, …` and the output is identical run to
run — no dropped frames, no recording jitter, and re-rendering after an edit
changes only what you edited.

## The cut

| t | beat |
|---|------|
| 0.0 – 2.3 | a wall of DBMS_XPLAN text streams in — "Somewhere in here is the reason it is slow." |
| 2.3 – 5.0 | the nine plan rows fly out of the text and become the tree — "Paste it. See it." |
| 5.0 – 7.8 | camera pushes into the hotspot; advisor findings and the 1,110x cardinality miss — "The problem finds you." |
| 7.8 – 10.2 | flame graph, sankey, ASH timeline, calibration scatter — "Ten views of one plan." |
| 10.2 – 12.3 | plan A vs plan B with per-metric deltas |
| 12.3 – 15.0 | end card: mark, wordmark, tagline, URL |

The plan used throughout is a real-shaped star-schema query whose `SALES` full
scan is estimated at 898 rows and returns 997,412 — the same story the app's
cardinality-mismatch rule tells.

## Editing

Times are plain seconds in `frame(t)` and in each `scene*(t)`. `seg(t, t0, d)`
is "local progress of a `d`-second window starting at `t0`", which is most of
the animation logic. Colors come from the app's own category palette in
`src/lib/types.ts`; keep them in sync if that file changes.
