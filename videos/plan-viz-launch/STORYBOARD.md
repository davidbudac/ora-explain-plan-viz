---
format: 1920x1080
message: "Reading raw Oracle plans is painful — this makes the bottleneck obvious in seconds."
arc: Problem → Promise → Feature×5 → Close
audience: Oracle DBAs, SQL performance engineers, backend devs
mode: collaborative
fps: 30
total_duration: 30s
captions: disabled (text-only video; on-screen kinetic text is authored directly in each frame)
---

## Video direction

The whole film is one continuous dark-blueprint shot — one camera, one motion feel. Per-frame Scene
lines below carry only the delta.

- **Palette (from `frame.md`, never invented):** ground `paper` deep-navy #0b1220 with the faint blue
  `grid`; type in `ink` near-white #e6edf7; the scarce voltage is `ink-soft` electric-blue #5b9dff (kickers,
  key words, the wordmark glyph, chip borders). Data-semantic accents are rationed to numbers/badges that
  mirror the app UI ONLY: `hot` red #ef4444 (the problem word, the hotspot ring/chip), `warn` amber #f59e0b
  (cardinality), `good` emerald #34d399 (positive delta). Never a decorative hue; base frames stay
  navy + near-white + one blue.
- **Surface grammar:** feature captures (frames 3,4,6,7,8) live inside ONE recurring "floating window"
  — rounded corners, a faint `ink-soft` hairline frame, soft depth — sitting on the grid. Same window
  every time so the app feels like one place. Frames 1/2/5/9 are full-canvas type/data on the bare grid.
- **Motion grammar + reveal model:** long-tail decel (`power3` default — smooth over bouncy; overshoot
  never). Every frame is VO-paced: at t=0 only what the cue line is saying enters; each further piece
  (a word, a chip, a pill, a number) reveals on its spoken cue across the back ~50%. Cuts inside a frame
  are velocity-matched (`cut-catalog.md`), not slideshow cuts.
- **Rhythm / held frames:** frames 2 (tagline settle), 5 (the 634.9× lock), and 9 (the close) end on a
  deliberate still hold — the climax beats. Aliveness during a hold is subtle jitter at most; no lazy
  breathing, no back-half pan/push.
- **Negative list:** no bouncy/elastic/`back.out`; no lazy breathing or drifting camera as fake life;
  no `repeat`/`yoyo`/`Math.random`/`Date.now`; no all-at-once entrances; no browser chrome/cursors/scrollbars
  except the intentional in-app captures; no purple-blue "AI" gradients or floating bokeh. The two failure
  modes to avoid: slideshow (front-load then freeze) and screensaver (everything floating independently).

## Frame 1 — The problem (cold open)

- type: pain_point
- scene: Dense DBMS_XPLAN ASCII table fills the frame, scrolling; desaturates and freezes as the line punches in
- duration: 3s
- transition_in: cut
- status: animated
- blueprint: kinetic-type-beats (Adapt)
- asset_candidates: rawplan.png
- focal: rawplan.png
- roles: rawplan.png = background (full-bleed, cold-tinted, dim ~55%)
- on_screen_text: "You read Oracle plans like THIS?"
- voiceover: "You read Oracle plans like this?"
- sfx: riser, impact-bass-1
- src: compositions/frames/01-problem.html

Adapt: keep kinetic-type's "the words are the shot" spine, but ground it on the real raw-dump asset so
the pain is literal. Crop `rawplan.png` to the plan-text region (hide the app chrome).
Scene 1 (0.0–1.2s): `rawplan.png` fills the frame as a cold, low-contrast full-bleed background on a
slow upward scroll (`multi-phase-camera`, gentle drift) — layered-depth, dim ~55%. Nothing else on screen.
Scene 2 (1.2–3.0s): the scroll halts and the background darkens/desaturates further; centered `display-hero`
line lands via per-word staggered reveal (`dynamic-content-sequencing`) on a smooth long-tail (`power3`):
"You read Oracle plans like THIS?" — "THIS?" set in `mono`, entering `ink-soft` blue then flicking to
`hot` red on the beat. Centered ~60% width, upper-middle; settles and holds (subtle jitter only).

## Frame 2 — The promise (brand)

- type: product_intro
- scene: The dump collapses into a single glowing node; wordmark assembles; tagline pops
- duration: 2.5s
- transition_in: cut
- status: animated
- blueprint: logo-assemble-lockup (Reproduce)
- asset_candidates: (none — typographic lockup on the grid)
- focal: (none — typographic)
- roles: n/a
- on_screen_text: "Oracle Plan Visualizer  ·  Paste. See. Fix."
- voiceover: "Oracle Plan Visualizer. Paste, see, fix."
- sfx: whoosh-cinematic, pop
- src: compositions/frames/02-promise.html

Reproduce logo-assemble-lockup: the mark builds from parts and resolves to a centered lockup + tagline.
Scene 1 (0.0–0.9s): hard cut to the bare navy grid; residual bright fragments streak inward and converge
to one bright `ink-soft` node dead-center via depth scatter-assemble (`depth-scatter-assemble`) with a
motion-blur streak on arrival (`motion-blur-streak`). Centered.
Scene 2 (0.9–1.8s): the node blooms into the wordmark — small blue doc glyph + "Oracle Plan Visualizer"
in `display` Inter — assembling left→right per-chunk (`dynamic-content-sequencing`); an ambient glow blooms
behind it (`ambient-glow-bloom`). Centered, upper-third anchor.
Scene 3 (1.8–2.5s): the `ed-callout` tagline "Paste. See. Fix." lands beneath as three quick beats
(`kinetic-beat-slam`), then settles and HOLDS still (a deliberate breather).

## Frame 3 — Paste anything (product surface)

- type: feature_showcase
- scene: The tree view rises into the floating app "window"; format chips cascade in
- duration: 3.5s
- transition_in: cut
- status: animated
- blueprint: device-surface-showcase (Adapt)
- asset_candidates: hero.png
- focal: hero.png
- roles: hero.png = cutout (the window hero)
- on_screen_text: "Paste any plan."  +  chips: DBMS_XPLAN · SQL Monitor · XML · JSON
- voiceover: "Paste any plan — and it maps itself."
- sfx: whoosh, click-soft
- src: compositions/frames/03-paste.html

Adapt: keep device-surface-showcase's "window held as hero + slow push" signature; the screen is the real
`hero.png` capture, not a mockup.
Scene 1 (0.0–1.0s): `hero.png` rises from below and scales up into the recurring floating window (faint
`ink-soft` hairline frame, soft depth) onto the grid via a smooth spring-pop settle (`spring-pop-entrance`);
a slow continuous push-in begins (`multi-phase-camera`). A `micro` kicker "Paste any plan." fades in
top-left. Asymmetric, window ~70% of frame, 3 depth layers.
Scene 2 (1.0–2.4s): four format chips cascade in along the lower third via staggered reveal
(`center-outward-expansion`), one per beat: `DBMS_XPLAN · SQL Monitor · XML · JSON` — small pills with
`ink-soft` borders. The tree keeps arriving under the push.
Scene 3 (2.4–3.5s): the push eases to rest; the tree's red hotspot rings catch a faint glow; hold
(subtle jitter). Keep the chips clear of the very bottom edge.

## Frame 4 — Hotspot detection

- type: feature_showcase
- scene: Camera pushes to the red-ringed node; everything else dims; "Hotspot" chip snaps on
- duration: 3.5s
- transition_in: cut
- status: animated
- blueprint: cursor-ui-demo (Adapt)
- asset_candidates: hotspot.png
- focal: hotspot.png
- roles: hotspot.png = cutout
- on_screen_text: "The bottleneck — ringed automatically."  +  badge "HOTSPOT · by A-Time"
- voiceover: "It rings your bottleneck automatically."
- sfx: whoosh-short, impact-bass-1
- src: compositions/frames/04-hotspot.html

Adapt: keep cursor-ui-demo's "the surface changes state and lands on the key element" spine, but drive it
with a camera zoom-to-target + selective blur instead of a fake cursor (the surface is a real capture).
Scene 1 (0.0–1.2s): still inside the window, `hotspot.png` held; the camera zoom-to-targets toward the
red-ringed node (`coordinate-target-zoom`) while the rest of the tree sinks under a blue depth-of-field
blur (`depth-of-field-blur`). Rule-of-thirds, focal node upper-right.
Scene 2 (1.2–2.4s): the red ring pulses once — an attack-decay scale glow in the `hot` register
(`asr-keyword-glow`); a red "HOTSPOT · by A-Time" chip spring-pops beside it (`spring-pop-entrance`).
Scene 3 (2.4–3.5s): the line "The bottleneck — ringed automatically." reveals per-word along the lower
third (`dynamic-content-sequencing`); settle and hold.

## Frame 5 — Cardinality blowups

- type: feature_showcase
- scene: Detail-panel callout; a number counts up to 634.9× and flashes amber→red
- duration: 4s
- transition_in: crossfade
- status: animated
- blueprint: dataviz-countup (Reproduce)
- asset_candidates: cardinality.png
- focal: cardinality.png
- roles: cardinality.png = cutout (framed on the NESTED LOOPS node + detail-panel callout)
- on_screen_text: "Estimated 126.  Actually 80,000."  →  count-up "634.9× off"
- voiceover: "Estimated a hundred rows, got eighty thousand — a six-hundred-times miss, flagged."
- sfx: riser, impact-bass-2
- src: compositions/frames/05-cardinality.html

Reproduce dataviz-countup: signature count-up + camera push-THROUGH to a hero metric.
Scene 1 (0.0–1.0s): crossfade in; `cardinality.png` framed on the NESTED LOOPS node and its detail-panel
callout, with a slight push. Two `mono` lines type on behind a caret (`discrete-text-sequence` +
`context-sensitive-cursor`): "Estimated 126" then "Actually 80,000". Asymmetric 60/40, panel to the right.
Scene 2 (1.0–2.8s): the camera pushes THROUGH toward frame-center where a big `vbig-numeral` value-scaled
counter races 1× → 634.9× (`counting-dynamic-scale`), the size growing with the value; color ramps `warn`
amber → `hot` red on landing. Centered hero numeral ~45%.
Scene 3 (2.8–4.0s): the numeral locks; the label "cardinality blowups, caught." glows in beneath
(`asr-keyword-glow`); everything HOLDS dead still — the climax beat, stillness against the prior push.

## Frame 6 — Estimated vs actual (tabular)

- type: feature_showcase
- scene: The dense tabular grid; a sweep runs the rows, the Actual columns light up
- duration: 3s
- transition_in: cut
- status: animated
- blueprint: device-surface-showcase (Adapt)
- asset_candidates: tabular.png
- focal: tabular.png
- roles: tabular.png = cutout
- on_screen_text: "Estimated vs actual — every op."
- voiceover: "Every operation, estimate against reality, in one grid."
- sfx: whoosh-short
- src: compositions/frames/06-tabular.html

Adapt: window-as-hero; the "screens cycle" becomes a top→down sweep that reads the grid. The tabular view
groups **Estimated** (E-Rows, Cost) beside **Actual** (A-Rows, A-Time, Starts, Memory, Card.) with inline
bars, red A-Time bars, a "HOT" badge and a cardinality note — density is the payload.
Scene 1 (0.0–1.2s): hard cut; `tabular.png` in the recurring window (object-position TOP so the column
headers + grid fill it, cropping the empty lower area); the window settles in (`spring-pop-entrance`, power3).
Scene 2 (1.2–2.2s): a soft ink-soft highlight band sweeps top→down across the rows
(`dynamic-content-sequencing` — a masked reveal), letting the eye register the estimated-vs-actual columns,
the red A-Time bars and the "HOT" chip.
Scene 3 (2.2–3.0s): the line "Estimated vs actual — every op." reveals per-word lower-left
(`dynamic-content-sequencing`, "actual" in `ink-soft`); hold (subtle jitter at most).

## Frame 7 — Before vs after (compare)

- type: feature_showcase
- scene: Two plan cards weigh against each other; delta pills spring-pop
- duration: 3.5s
- transition_in: cut
- status: animated
- blueprint: comparison-split (Adapt)
- asset_candidates: compare.png
- focal: compare.png
- roles: compare.png = cutout (cropped to the A/B summary cards + top delta rows)
- on_screen_text: "Before vs after — side by side."  +  pills "Cost +225%" "Rows +2400%"
- voiceover: "Compare two plans side by side — every delta, in green and red."
- sfx: pop, click
- src: compositions/frames/07-compare.html

Adapt: keep comparison-split's side-by-side weighing + the inner-edge pill spring-pop signature; the two
cards live inside the real `compare.png` crop rather than entering as two separate wings.
Scene 1 (0.0–1.0s): cut; `compare.png` (Plan A blue card + Plan B purple card + top delta rows) settles in
on a slight upward scale (`spring-pop-entrance`, smooth). Split-screen framing, ~80% of frame.
Scene 2 (1.0–2.3s): two delta pills spring-pop at the center seam between the cards
(`spring-pop-entrance`), one per beat: "Cost +225%" then "Rows +2400%" — red, echoing the in-app deltas.
Scene 3 (2.3–3.5s): the line "Before vs after — side by side." reveals top-center per-word; hold.

## Frame 8 — Annotate & share

- type: benefit_highlight
- scene: Highlight rings snap onto nodes; a note bubble reads in; three word-beats
- duration: 3s
- transition_in: cut
- status: animated
- blueprint: grid-card-assemble (Adapt)
- asset_candidates: annotations.png
- focal: annotations.png
- roles: annotations.png = cutout
- on_screen_text: "Annotate.  Export.  Share."
- voiceover: "Annotate it, export it, share it."
- sfx: whoosh-short, pop
- src: compositions/frames/08-annotate.html

Adapt: keep the staggered-cascade assemble, but the "items" are the real highlight rings + note snapping on.
Scene 1 (0.0–1.0s): cut; `annotations.png` in the recurring window; the orange circle highlight draws on,
then the blue highlight ring, in a staggered cascade (`css-marker-patterns` circle-draw). Window ~72%.
Scene 2 (1.0–2.2s): the note callout "Full scan — candidate for index on ORDER_DATE" reads in beside its
node (per-word, `dynamic-content-sequencing`).
Scene 3 (2.2–3.0s): three words slam center-bottom as staccato beats (`kinetic-beat-slam`): "Annotate.
Export. Share." — each on its own beat; hold.

## Frame 9 — Close (CTA)

- type: cta
- scene: All clears to the grid; wordmark settles; client-side badge; CTA line
- duration: 4s
- transition_in: crossfade
- status: animated
- blueprint: logo-assemble-lockup (Reproduce)
- asset_candidates: (none — typographic lockup on the grid)
- focal: (none — typographic)
- roles: n/a
- on_screen_text: "100% in your browser. No upload."  +  wordmark  +  "Open it. Paste a plan."
- voiceover: "A hundred percent in your browser. Nothing uploaded. Open it and paste a plan."
- sfx: chime
- src: compositions/frames/09-close.html

Reproduce logo-assemble-lockup as the sign-off; this is the only frame with a real settle-and-hold ending.
Scene 1 (0.0–1.2s): crossfade to the clean navy grid as the prior window clears; the "Oracle Plan
Visualizer" wordmark + blue doc glyph converges to center (`scale-swap-transition` handoff), settles.
Scene 2 (1.2–2.4s): a `mono` badge reveals beneath per-word (`dynamic-content-sequencing`): "100% in your
browser · no upload · open source".
Scene 3 (2.4–4.0s): the final `ed-callout` CTA "Open it. Paste a plan." spring-pops once
(`spring-pop-entrance`) in `ink-soft` blue; everything holds dead still to the end (subtle jitter only).
