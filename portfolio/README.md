# Jordan Banh — Interactive Portfolio ("The Bench")

A single-page, self-contained 3D portfolio. No build step — it's plain HTML/CSS/JS.

## What it is

A grassy, tree-scattered island floating above a sea of clouds, backlit by
a low sun. Three stone monoliths stand close together around a central
DNA-and-gear sculpture: **About Me**, **Work Experience**, and
**Projects**. Each monolith is crowned by its own sculpture so they read
differently at a glance — a face in glass for About, an anatomical heart
for Work Experience, a robotic hand holding a flower for Projects — plus a
standalone sign on a post beside it (angled like exhibit/museum signage).
All three sculptures are generated in code, not loaded as model files. The hub sculpture itself is purely
atmospheric, not clickable. Click any monolith (or the matching nav button,
or Tab + Enter) to fly the camera over and open a detail panel with the real
content, an animated count-up of a few real numbers, and a brief wireframe
"blueprint" flash across the stone.

A day/night toggle (top right, "Night Mode") crossfades the whole scene over
a couple of seconds — sky, lighting, and fog all shift together, and at
night each monolith's base glow and its sign's lettering both light up
brighter so everything stays readable in the dark. A few other ambient
touches run underneath: a warm light follows the cursor across the terrain,
a light scatter of particles drifts upward across the landscape, the cloud
deck drifts in parallax layers, and crepuscular rays fan out from the sun.
On load the page plays a **blueprint-to-real** intro: it opens as a CAD
sheet that draws its own frame and title block while the three monoliths
appear as wireframe linework, then the world renders in around them as the
camera pulls from a straight-on elevation out to the overview. A soft
vignette at the screen edges keeps focus on the center.

Clicking a monolith pops the detail panel out as a centered card over a
dimmed backdrop (not a side drawer). Each panel has an expand button (top
right, next to close) for more room, and includes a small photo gallery —
click any thumbnail to see it larger in a lightbox.

Sections are deep-linkable: `yoursite.com/#projects` (or `#about`,
`#work-experience`, `#contact`, `#resume`) jumps straight there on load,
skipping the intro panel — handy for sending a hiring manager directly to
one section.

There's a small exploration game layered on top: a progress tracker in the
top-left fills in as you visit each of the three monoliths, a toast pops up the
first time you unlock one, and finding all three triggers a three-beat
completion sequence (below).
Progress resets on every page load by design — each visit starts fresh at
0/3.

Everything also exists as a plain-text version (the "View as text" button,
top right) — this is what screen readers, very old browsers, or anyone who'd
rather just scroll gets automatically if WebGL isn't available.

## Files

```
portfolio/
  index.html      structure + UI markup
  css/style.css   all styling (edit colors/spacing here)
  js/data.js      ALL the written content — edit this to change any text
  js/scene.js     Three.js scene: terrain, monoliths, camera, interaction, game feedback
  js/model-viewer.js  embedded 360° STL viewers used inside panel content
  js/model-data.js    base64-embedded .stl model data (see below)
  js/ui.js        panel/nav/modal/text-fallback/game wiring
  images/         gallery photos (currently placeholders — see below)
  models/         .stl files shown by the 360° viewer
```

## Adding it to your existing site (Trame Archives)

1. Copy the whole `portfolio/` folder into your site, e.g. as `yoursite.com/portfolio/`.
2. Link to it from wherever you want (`<a href="/portfolio/">`), or set it as a
   dedicated subdomain/page.
3. That's it — no npm install, no build step. It loads Three.js from a CDN
   (cdnjs + jsdelivr) at runtime, so the page needs an internet connection to
   render the 3D scene; the text fallback still works offline if you inline it
   into a page that doesn't depend on the CDN scripts.

If your site already has its own header/nav, you can drop `#hud-top` from
`index.html` and let your site's real nav link into anchors instead — the
`data-node="..."` buttons in `#hud-nav` are just calling
`window.selectPortfolioNode('id')`, so any element (a link in your existing
nav, for instance) can call that same function.

## Editing content

Everything written — titles, descriptions, tags, meta lines — lives in
`js/data.js`. You don't need to touch the 3D code to change text.

Each entry in `PORTFOLIO_DATA.nodes` is one monolith:

- `id` — must stay unique; add a matching `data-node="id"` button in
  `index.html`'s `#hud-nav`, and add it to the `SECTIONS` array in `ui.js`
  if you want it tracked by the progress/achievement game
- `engraving` — the short text on the sign beside the monolith. Keep this
  SHORT (a word or two) — it's a small placard, not a billboard. `title` is
  separate and can be longer; it's what shows as the panel heading once
  someone clicks in.
- `markerType` — which sculpture sits above this monolith: `"face"`
  (About), `"heart"` (Work Experience), or `"hand"` (Projects). Defaults to
  `"face"` if omitted. Add a new one by writing a `buildXMarker()` function
  next to the existing ones in `scene.js`, ending it with `finishModel()`
  (which registers shadows and collects materials for the focus-fade
  system), then wiring it into `buildMarker()`.
- `color` — hex number for this monolith's glow: it tints the small light
  glowing at its base, its topper, and the sign's accent rule and (at
  night) its glowing lettering, e.g. `0xe8862b`
- `stats` — optional array of `{ value, decimals, prefix, suffix, label }`,
  rendered as animated count-up numbers at the top of the panel. Omit it
  (or leave the array empty) for a node with no headline numbers.
- `gallery` — optional array of `{ src, caption, alt }`, rendered as a
  small photo grid in the panel; click any photo to enlarge it. `src` is a
  path relative to `index.html` (the placeholders are all under `images/`).
- `kicker` / `title` / `meta` / `body` (HTML string) / `tags` (array)

### Replacing the placeholder photos

`images/` currently holds SVG placeholders (dashed border, camera icon, a
label saying what should go there) so the gallery layout is fully wired up
and ready — swap them for real photos:

1. Drop your photo into `images/` (any format — `.jpg`, `.png`, `.webp` all
   work).
2. Either name it to match the placeholder it replaces (e.g. `work-1.jpg`
   over `work-1.svg`) and update that one `src` in `data.js`, or just point
   the `src` at whatever you named it.
3. No code changes needed beyond that one `src` string — the gallery grid,
   captions, and lightbox all work the same regardless of file type.

Current slots: `about-1/2` (profile + workspace) and `work-1/2/3` (plant
floor, KPI dashboard, an SOP page) are still placeholders — swap them in
whenever you have real photos. The Projects chopper-frame photos
(`chopper-frame-before.jpg` / `chopper-frame-after.jpg`) are real, showing
the original frame versus the four-post/added-truss redesign. Add more by
adding entries to a node's `gallery` array — the grid reflows automatically.

## 360° model viewer

The Projects panel embeds a live, drag-to-rotate 3D viewer of the burner
bushing wall & nozzle, instead of a photo — this is what `js/model-viewer.js`
does. To add one anywhere in any node's `body` HTML:

```html
<div class="model-viewer" data-model-key="your-key"
     role="img" aria-label="Describe the model here">
  <span class="model-viewer-hint">drag to rotate</span>
</div>
```

`ui.js` calls `window.initModelViewers(panelBody)` every time panel content
renders, which scans for `.model-viewer` elements and spins up a small
Three.js scene for each — lit and materialed like brushed steel,
auto-rotating gently until dragged. Only one panel's worth of viewers run
at a time; opening a different node or closing the panel disposes the
previous one automatically, so nothing keeps rendering in the background.

**Models are embedded as base64 data, not loaded from a file path.**
`js/model-data.js` holds `window.MODEL_DATA = { "your-key": "<base64...>" }`;
`model-viewer.js` decodes it and calls `THREE.STLLoader.parse()` directly —
no network request at all. This is deliberate: loading a `.stl` by URL
(`data-model="models/file.stl"`) only works when the page is served over
`http(s)`; opening `index.html` straight from disk (double-click, drag into
a browser) makes the browser block that fetch as a local-file security
restriction, and the viewer would show "Couldn't load model" even though
nothing is actually wrong with the file. Embedding sidesteps that
completely — it works identically whether you're previewing locally or
it's live on Trame Archives.

To add another model:

1. Get the file's base64: `python3 -c "import base64; print(base64.b64encode(open('yourfile.stl','rb').read()).decode())"`
2. Add an entry to `window.MODEL_DATA` in `js/model-data.js`.
3. Reference that key with `data-model-key="..."` in the relevant node's
   `body` in `data.js`.

Binary STL files stay small this way (the current one is ~90 KB for ~1,800
triangles, ~119 KB once base64-encoded) and load instantly. For a much
larger, high-poly export where embedding would bloat the JS noticeably,
`data-model="models/file.stl"` (URL loading) still works as a fallback —
just remember it needs a real web server, not a `file://` preview. A copy
of the current model also lives at `models/burner-bushing-wall.stl` for
this reason, even though the embedded version is what's actually used.

The Projects panel nests two write-ups inside one monolith using
`<div class="sub-project">` + `<p class="sub-project-label">` — copy that
pattern if you want to group more than one thing under a single monolith. The
`<span class="wip-badge">WIP</span>` label is reusable anywhere you want to
flag something as in-progress.

To add a fourth monolith, add an entry to `PORTFOLIO_DATA.nodes` in `data.js`
and a matching nav button in `index.html` — the circular layout in
`scene.js` spaces monoliths automatically based on how many are in the array,
and seats each one on the terrain at its own elevation.

## Customizing look

Color tokens and fonts are CSS custom properties at the top of
`css/style.css` (`:root { --cyan, --amber, --red, --bg, ... }`). The fonts
(Libre Caslon Display for headlines, Libre Caslon Text for body copy, IBM
Plex Mono for data/labels) are loaded from Google Fonts in `index.html`'s
`<head>`.

## Rendering pipeline (scene.js)

The scene is lit as a backlit exterior, not with flat ambient. Four things
do most of the work, and they only look right together:

- **sRGB output + ACES filmic tone mapping** (`renderer.outputEncoding`,
  `renderer.toneMapping`). Without the first, every colour is written to
  the screen in linear space, which is what makes untuned WebGL look
  chalky. Without the second, the bright sun clips to flat white instead of
  rolling off. Any texture used as a *colour* map must be flagged
  `encoding = THREE.sRGBEncoding` or it will look washed out next to
  everything else — the placard art and the cloud puffs both do this.
- **Image-based lighting** (`buildEnvironment()`). A throwaway gradient-sky
  scene is rendered into a prefiltered cubemap via `PMREMGenerator` and
  assigned to `scene.environment`. This is what the glass and polished
  ceramic sculptures actually reflect; without it they read as matte
  plastic no matter how they're shaded. `envMapIntensity` on each material
  is the main dial.
- **Real shadows** — `PCFSoftShadowMap`, cast by a single directional key
  light whose ortho frustum is deliberately tight around the island.
  Shadow quality is resolution *per world unit*, so shrinking that frustum
  is worth far more than raising `mapSize`.
- **Bloom** (`buildComposer()`) — an `EffectComposer` with a single
  `UnrealBloomPass`, threshold set high enough that ordinary lit surfaces
  never bloom. Only the sun disc, the god rays and the emissive details
  cross it, which keeps it reading as a lens response rather than a glow
  filter. If the post-processing scripts fail to load, `composer` stays
  undefined and `animate()` falls back to a direct render.

`SUN_DIR` near `addLights()` is the single source of truth for the sun:
the key light, the sun sprite, the god-ray fan and the sky's warm horizon
band are all derived from it, so they can't drift out of agreement.

## The island and the cloud sea

`terrainHeight()` is still the authority for *placement* — every prop asks
it where the ground is. The floating-island shape is applied separately, in
`islandDrop()`, and only to the ground mesh's vertices: flat out to
`ISLAND_RIM`, then curling over and falling away by `ISLAND_RADIUS`. Keeping
the two apart is why nothing clips or floats. Trees and grass are clamped
well inside `ISLAND_RIM` for the same reason.

`buildIslandSkirt()` hangs a noisy rock cone below the rim — the part that
actually sells "floating" rather than "hill". `buildCloudDeck()` layers
three tiling cloud planes (scrolled at different rates for parallax) with
~130 sprite puffs scattered over them; puffs on the sun's side are tinted
warm and brightened, which is where most of the backlit look comes from.

## The completion sequence

Fired once all three sections have been opened. Three beats, deliberately
under four seconds total, because progress resets on every page load and
this re-fires on each visit:

1. **The machine completes** (`scene.js`). The helix rises out of the gear
   ring, the travelling pulses surge, and `fireShockwave()` sends a ring of
   light racing outward across the ground, tripping each monolith's
   blueprint flash as it passes. It reuses the same wireframe twins the
   intro and the click X-ray use, so the site keeps one visual vocabulary
   for revealing a thing.
2. **The drawing annotates itself** (`ui.js`). Dimension callouts draw on,
   pinned to the monoliths in screen space via `window.getBenchAnchors()`,
   which projects the hub, the three nodes and the island extents into CSS
   pixels. `positionDimensions()` re-runs each frame so the callouts track
   the orbiting camera. Points behind the camera — and points that project
   to NaN by landing exactly on the camera plane — are marked not visible
   and their callouts hidden.
3. **The sheet hands over contact details** (`ui.js`). `#complete-card` is
   laid out as a drawing's revision block. Its contact list is *cloned from
   the existing contact modal* rather than duplicated in the markup, so
   there is one place to edit an email address.

Under `prefers-reduced-motion` the first beat is skipped entirely and the
other two appear immediately without draw-on — the annotated drawing and
the contact block are the actual payload, and both read fine static.

This replaced a confetti burst, which was gold squares falling through an
otherwise strictly monochrome drafting site.

## Ambient systems (scene.js)

A few things run continuously in the background, all skipped automatically
under `prefers-reduced-motion`:

- **Cursor lantern** — `onPointerMove` raycasts the pointer against the
  terrain mesh and moves a warm `PointLight` there; it fades in on first
  movement (`lantern.userData.targetIntensity`).
- **Ambient drift** — a slow sine wave (~5-minute period) nudges the key
  light's color and the sky/fog color; barely perceptible on purpose.
- **Particles** — `buildParticles()` scatters ~200 points that drift upward
  and wrap back to the ground; purely decorative.
- **Blueprint flash** — each monolith has an invisible wireframe twin
  (`node.wireMat`) sharing its geometry. `focusNode()` triggers a brief
  fade-in/hold/fade-out (`flashEnvelope`) over the solid rock on click.
- **Blueprint intro** — driven by one module-level dial, `blueprint`, that
  runs 1 → 0 over `INTRO_SHEET_MS + INTRO_RENDER_MS`. At 1 the fog is
  forced white and dense enough to swallow the world, the sky/clouds/sun
  fade out, the lights drop to zero and the monoliths' wireframe twins are
  held at full opacity as drafting linework; easing it to 0 renders the
  scene in. The CSS sheet overlay (`#intro-screen`) draws in parallel and
  is dismissed when `scene.js` dispatches `bench-intro-done`.
  `window.skipBenchIntro()` ends it immediately — that's what the skip
  button, deep links and the 7-second backstop in `ui.js` all call.

## The exploration game

`js/ui.js` tracks which of the three sections (`about`, `work-experience`,
`projects`) a visitor has opened, in an in-memory `Set` — deliberately not
persisted, so it resets on every reload. `markExplored(id)` is called every
time a section opens; it's a no-op if that section was already unlocked. The
`.progress-dot` elements in the title block, the toast pop-ups, and the
completion sequence are all driven from that one function — see
`SECTIONS`, `ACHIEVEMENT_LABELS`, `showToast`, and `runCompletionSequence` near the
top of `ui.js` if you want to change the copy or add more milestones.

## Notes

- A "Resume" button in the nav opens a pop-out with a scrollable, native
  in-browser PDF preview (a plain `<iframe>` pointed at the file — no PDF.js
  or other library needed) plus a "Download PDF" button. To update the
  résumé, just replace `resume/Jordan-Banh-Resume.pdf` with a new file of
  the same name — no code changes needed. If you rename the file, update
  the `RESUME_PATH` constant near the top of `ui.js` (used by the button,
  the `#resume` deep link, and the text-fallback version) and the two
  `href`/`src` references to it in `index.html`. The preview iframe only
  loads the PDF the first time someone opens it, not on page load.

- Respects `prefers-reduced-motion` (disables auto-rotate, pulsing markers,
  hub rotation, the click pop/ping effects, the completion shockwave, and the day/night
  crossfade — theme switches snap instantly instead; camera moves jump
  instead of easing).
- Every 3D interaction has a keyboard-reachable equivalent via the nav
  buttons — nothing is only reachable by clicking inside the canvas.
- If WebGL fails to initialize for any reason, the site automatically falls
  back to the text version rather than showing a blank canvas.
- Auto-rotate only runs before the visitor's first manual drag; once they've
  orbited by hand, it stays off so the camera never fights their input.
- How far apart the monoliths sit is one constant: `ORBIT_RADIUS` near the
  top of `scene.js` (currently `9`). The flattened "clearing" under the hub
  and under each monolith (so nothing clips into the terrain) is sized
  separately in `computeAnchors()` — if you widen `ORBIT_RADIUS` a lot,
  widen those `outerRadius` values too so the clearings don't overlap.
- Trees are placed randomly at load (`buildTrees()` in `scene.js`), avoiding
  the hub and monolith clearings — refresh the page for a different
  arrangement, or adjust `count` there for more/fewer.
- Day/night is one blended value (`themeBlend`, 0=day/1=night) that every
  light, the sky, the fog, and each monolith's glow read from every frame —
  `window.setPortfolioTheme("day"|"night")` is the only entry point, called
  by the Night Mode button in `ui.js`. It doesn't persist across reloads by
  design; add a `localStorage` read/write in `ui.js` if you'd rather it did.
- Grass, stone, bark, foliage and the sky all use `makeNoiseTexture()` in
  `scene.js` — a small canvas-generated, blurred value-noise pattern used as
  a `bumpMap` (and `roughnessMap` on the terrain) so flat-shaded surfaces
  pick up real grain instead of looking smooth/plastic. Each surface shares
  one texture across all its instances (one rock-grain texture for all
  three monoliths, one bark/leaf pair for all 34 trees) rather than
  generating one per object. Adjust the look via the `blurPx` (grain size)
  and `contrastPct` arguments, or each material's `bumpScale`.
- The ground also grows actual grass — ~9,000 instanced, tapered blades
  (`buildGrass()`) that sway in a gentle wind via a small vertex shader
  patched into the normal lit material with `onBeforeCompile` (so it still
  responds to day/night lighting like everything else). **Blade length is
  one constant**: `GRASS_BLADE_HEIGHT` near the top of `scene.js` (currently
  `0.36`, world units). Each blade also gets random length/width around
  that average — `GRASS_BLADE_HEIGHT_VARIANCE` controls how much (currently
  ±55%; the code clamps the result so a variance of 1.0+ can't flip a blade
  upside down). `GRASS_BLADE_WIDTH`, `GRASS_BLADE_COUNT`, and
  `GRASS_FIELD_RADIUS` (how far from the hub grass grows) are the other
  tunables sitting right next to it. Grass is excluded from the same
  clearings as the hub and monoliths, same as the trees.

## Performance — what's cheap to raise and what isn't

`TREE_COUNT`, `STAR_COUNT`, and `PARTICLE_COUNT` sit together near the top
of `scene.js`, right below the grass constants. All three, plus
`GRASS_BLADE_COUNT`, are now genuinely cheap to raise:

- **Trees** are instanced (`buildTrees()`) — every tree shares one trunk
  geometry and three tier-cone geometries across a few color variants,
  so the whole forest is ~10 draw calls no matter how many trees there
  are. The previous version built a brand-new set of geometries *per tree*,
  which is fine at a few dozen trees but becomes hundreds of draw calls and
  GPU buffer uploads at a few hundred — that was the biggest single cause
  of lag if you'd raised `TREE_COUNT` a lot.
- **Particles** (`buildParticles()`) compute their rise-and-drift motion in
  a vertex shader now, not a per-frame JavaScript loop — the old version
  re-computed every particle's position on the CPU every frame, which
  scales badly. Now the count barely matters; the GPU does the work.
- **Grass** was already instanced. Its placement loop (finding valid spots
  that avoid the hub/monolith clearings) is now bounded to a fixed maximum
  number of attempts regardless of `GRASS_BLADE_COUNT`, so setting the
  count extremely high can't freeze the page while it searches for spots —
  it'll just place as many as it reasonably finds and stop.
- **Stars** were never a real cost (one static point cloud, no per-frame
  work) — raise `STAR_COUNT` freely.

That said, "cheap" isn't "free" — a few realistic ranges for smooth 60fps
on typical laptop hardware: grass in the **low tens of thousands** (say
10,000–40,000, depending on `GRASS_FIELD_RADIUS`), trees in the
**hundreds** (100–400 reads as a proper forest), particles and stars in the
**hundreds** each (they're atmospheric — a few hundred looks the same as
tens of thousands, since they're small and mostly overlapping visually).
Six-figure counts on any of these will still be heavy no matter how the
code is optimized, since it's genuinely that many triangles or shader
invocations for the GPU to push every frame — that's a hardware ceiling,
not a code inefficiency.
