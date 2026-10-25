# Promo reel (15 s)

A standalone motion-graphics piece that sells the app. It's one canvas scene in `scene.html`. Every frame is a pure function of time `t`, so a render is deterministic.

| t | beat |
| --- | --- |
| 0.0–2.3 | DBMS_XPLAN wall streams in, counter ticks to 1,412 — *"Somewhere in here is the reason it is slow."* |
| 2.3–5.0 | nine plan rows fly out and morph into tree cards, edges draw, row flow pulses — *"Paste it. See it."* |
| 5.0–7.8 | push into the hotspot, advisor findings, 898 → 997,412 = **1,110×** — *"The problem finds you."* |
| 7.8–10.2 | flame graph, sankey, ASH timeline, calibration scatter — *"Ten views of one plan."* |
| 10.2–12.3 | Plan A vs Plan B, matched-node ties, COST −82% / A-TIME 9.2× / BUFFERS −99% |
| 12.3–15.0 | end card: brand glyph, wordmark, tagline, URL |

## Preview

Open `scene.html?play` in Chrome (serve the folder or open it as a file). Use space to pause, ←/→ to step a frame, and the slider to scrub. `scene.html?t=6.9` shows a single still.

## Render

```bash
# stills (fast; out/snap-*.png)
SAMPLES=1 node scripts/promo-reel/render.mjs --snap 1.3,4.5,7.3

# full render → out/promo-reel.mp4 (16 Mbps cap), promo-reel.webm, promo-reel-poster.png, promo-reel-master.mp4 (CRF 14, ~300 MB)
FFMPEG=/path/to/ffmpeg node scripts/promo-reel/render.mjs
```

The render needs `puppeteer-core` (already in `node_modules`), Chrome (`CHROME=`, default `/usr/bin/google-chrome`) and an ffmpeg built with libx264 and libvpx-vp9. The output is 1920×1080 at 60 fps. Each frame averages `SAMPLES` sub-frames (default 4, 180° shutter) to get motion blur.

Palette: ink black `#07080B`, acid lime `#C8FF4D` for flow and good news, signal `#FF4A1C` for the problem, violet `#9D8CFF` for structure. Fonts (OFL, in `fonts/`): Instrument Serif, Inter Tight, JetBrains Mono.
