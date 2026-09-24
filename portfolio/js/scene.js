/* 3D scene for the portfolio bench.
   Depends on THREE (r128) + THREE.OrbitControls, and PORTFOLIO_DATA from data.js.

   Three clickable rock monoliths (About Me / Work Exp / Projects), each with
   a distinct topper (DNA helix / gear / hex-nut) and a standalone placard
   sign, standing on a grassy, tree-scattered landscape around a purely
   decorative DNA-and-gear sculpture. The ground is locally flattened under
   each monolith and under the hub so nothing clips into a slope.

   Also: day/night mode (window.setPortfolioTheme), a cursor-following
   lantern light, drifting motes, and a click-triggered wireframe
   "blueprint" flash. */

(function () {
  "use strict";

  const canvas = document.getElementById("bench-canvas");
  if (!canvas) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let scene, camera, renderer, controls, raycaster, pointer;
  let hub, terrainMesh, sky, stars, lantern;
  let ambientLight, keyLight, rimLight, rimLight2, hemiLight;
  let composer, bloomPass;
  let cloudDeck, sunDisc, godRays;

  // Blueprint-to-real intro. `blueprint` is the master dial: 1.0 is a blank
  // CAD sheet with only wireframe linework on it, 0.0 is the finished
  // rendered scene. Everything the intro touches reads this one value, so
  // the sequence can be scrubbed, skipped or reversed from a single place.
  let blueprint = 0;
  let introActive = false;
  let introStart = 0;
  const INTRO_SHEET_MS = 1500;  // linework only, holding on the sheet
  const INTRO_RENDER_MS = 2400; // the world materialising around it
  const CLOUD_LAYER_OPACITY = [0.72, 0.54, 0.38];

  // Live tuning multipliers. The render loop rewrites exposure and every
  // light intensity from scratch each frame (they're driven by the day/night
  // blend and the intro), so a one-off tweak from the console would be
  // stamped out immediately — these are read inside that loop instead.
  // Adjust from devtools, e.g. benchTune.exposure = 0.7, then keep the
  // numbers you like by editing the defaults in this file.
  const benchTune = { exposure: 1, key: 1, fill: 1, bloom: 1, sun: 1 };
  window.benchTune = benchTune;
  const PAPER = new THREE.Color(0xf2f0ea);
  const INK = new THREE.Color(0x1e2228);
  const nodeGroups = [];
  let activeNodeId = null;

  // ---------------------------------------------------------------------
  // Terrain height field
  // ---------------------------------------------------------------------
  // rawTerrainHeight is the raw rolling-hills noise. terrainHeight wraps it
  // with "clearings" — flat, smoothstep-blended discs under the hub and
  // each monolith — computed BEFORE the ground mesh is built, so both the
  // mesh and every object's placement agree exactly and nothing clips.

  function rawTerrainHeight(x, z) {
    return (
      Math.sin(x * 0.16) * 0.8 +
      Math.cos(z * 0.19) * 0.6 +
      Math.sin((x + z) * 0.09) * 1.0 +
      Math.sin(x * 0.045 + z * 0.06) * 1.4
    ) * 0.55;
  }

  const flattenAnchors = []; // { x, z, innerRadius, outerRadius } — from computeAnchors()
  const ORBIT_RADIUS = 9; // distance from the hub to each monolith — kept tight on purpose

  // Floating-island geometry. Ground is flat out to ISLAND_RIM, curls over
  // between RIM and RADIUS, then falls away into the cloud sea. Nothing is
  // ever placed past ISLAND_RIM, so no prop can end up hanging off the edge.
  const ISLAND_RIM = 38;
  const ISLAND_RADIUS = 46;

  // Grass field tunables — GRASS_BLADE_HEIGHT is the main "blade length"
  // knob; each blade also gets random per-instance variation around it.
  const GRASS_BLADE_HEIGHT = 0.76; // world units, average blade length
  const GRASS_BLADE_HEIGHT_VARIANCE = 0.55; // +/- fraction, randomized per blade
  const GRASS_BLADE_WIDTH = 0.025;
  const GRASS_BLADE_COUNT = 900000;
  const GRASS_FIELD_RADIUS = 36; // grass grows within this radius of the hub (inside the island rim)
  const grassUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: reducedMotion ? 0 : 0.09 }
  };

  // Other scene population counts — all cheap to raise now that trees are
  // instanced and particles are GPU-animated (see buildTrees/buildParticles
  // below), but see the reply for realistic ranges before going wild here.
  const TREE_COUNT = 700;
  const STAR_COUNT = 500;
  const PARTICLE_COUNT = 600;
  const particleUniforms = { uTime: { value: 0 } };

  function terrainHeight(x, z) {
    const raw = rawTerrainHeight(x, z);
    for (let i = 0; i < flattenAnchors.length; i++) {
      const a = flattenAnchors[i];
      const d = Math.hypot(x - a.x, z - a.z);
      const flat = rawTerrainHeight(a.x, a.z);
      if (d <= a.innerRadius) {
        return flat; // fully flat core — guaranteed, not just at the exact center point
      }
      if (d < a.outerRadius) {
        const t = (d - a.innerRadius) / (a.outerRadius - a.innerRadius);
        const smooth = t * t * (3 - 2 * t); // smoothstep
        return flat + (raw - flat) * smooth;
      }
    }
    return raw;
  }

  function computeAnchors() {
    flattenAnchors.length = 0;
    flattenAnchors.push({ x: 0, z: 0, innerRadius: 2.6, outerRadius: 5.0 }); // clearing under the hub
    const nodes = PORTFOLIO_DATA.nodes;
    const count = nodes.length;
    nodes.forEach(function (node, i) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * ORBIT_RADIUS;
      const z = Math.sin(angle) * ORBIT_RADIUS;
      node._angle = angle;
      node._x = x;
      node._z = z;
      flattenAnchors.push({ x: x, z: z, innerRadius: 1.2, outerRadius: 3.0 }); // clearing under this monolith
    });
  }

  const defaultCamPos = new THREE.Vector3(0, 6, 21);
  const defaultLookAt = new THREE.Vector3(0, 2 + rawTerrainHeight(0, 0), 0);
  const cameraTarget = defaultCamPos.clone();
  const lookAtTarget = defaultLookAt.clone();
  let flying = false; // true only while a programmatic camera transition is in flight
  let userInteracted = false; // true once the user has manually dragged the camera even once

  // ---------------------------------------------------------------------
  // Day / night theme
  // ---------------------------------------------------------------------

  let themeTarget = 0; // 0 = day, 1 = night
  let themeBlend = 0;

  window.setPortfolioTheme = function (mode) {
    themeTarget = mode === "night" ? 1 : 0;
    if (reducedMotion) themeBlend = themeTarget;
  };

  const AMBIENT_DAY = new THREE.Color(0xf3efdc), AMBIENT_NIGHT = new THREE.Color(0x2c3760);
  const KEY_DAY = new THREE.Color(0xfff6df), KEY_NIGHT = new THREE.Color(0x9db2e8);
  const FOG_DAY = new THREE.Color(0xdfe7ea), FOG_NIGHT = new THREE.Color(0x121830);
  const tmpColor = new THREE.Color();

  function init() {
    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xdfe7ea);
      // Light fog only — enough for aerial perspective on the cliff and the
      // far trees, not enough to swallow the island rim.
      scene.fog = new THREE.FogExp2(0xdfe7ea, 0.0095);

      camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 220);

      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);

      // --- The "rendered, not drawn" pipeline -----------------------------
      // Three things do most of the heavy lifting here:
      //   1. sRGB output encoding — without it every colour is written to the
      //      screen in linear space, which is what makes untuned WebGL look
      //      washed out and chalky.
      //   2. ACES filmic tone mapping — rolls off highlights instead of
      //      clipping them to flat white, so a bright backlit sun reads as
      //      bright rather than as a white hole.
      //   3. Real shadows — flat ambient light with no shadowing is the
      //      single biggest "this is a web demo" tell.
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.78;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minDistance = 6;
      controls.maxDistance = 40;
      controls.maxPolarAngle = Math.PI * 0.5;
      controls.autoRotate = !reducedMotion;
      controls.autoRotateSpeed = 0.35;

      controls.addEventListener("start", function () {
        userInteracted = true;
        flying = false; // hand full control to the drag immediately, don't fight it
      });

      raycaster = new THREE.Raycaster();
      pointer = new THREE.Vector2();

      computeAnchors();
      addLights();
      buildEnvironment();
      sky = buildSky();
      stars = buildStars();
      terrainMesh = buildTerrain();
      buildIslandSkirt();
      cloudDeck = buildCloudDeck();
      sunDisc = buildSunDisc();
      godRays = buildGodRays();
      buildTrees();
      buildGrass();
      buildParticles();
      hub = buildHub();
      hub.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      hub.position.y = terrainHeight(0, 0);
      hub.scale.setScalar(0.85);
      scene.add(hub);
      buildNodes();

      // The cursor lantern — a warm light that follows wherever the
      // pointer is over the landscape, like exploring with a light in
      // hand. Starts off; fades in on first movement.
      lantern = new THREE.PointLight(0xffdca8, 0, 8, 2);
      lantern.position.set(0, 3, 0);
      lantern.userData.targetIntensity = 0;
      scene.add(lantern);
      canvas.addEventListener("pointermove", onPointerMove);

      // The opening move belongs to the intro sequence (see startIntro),
      // which is kicked off below once everything is built.
      camera.position.copy(defaultCamPos);
      controls.target.copy(defaultLookAt);

      buildComposer();

      window.addEventListener("resize", onResize);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);

      if (!reducedMotion) startIntro();

      requestAnimationFrame(animate);
      document.dispatchEvent(new CustomEvent("bench-ready"));

      // Reduced motion gets no sequence at all — the scene is simply there.
      if (reducedMotion) document.dispatchEvent(new CustomEvent("bench-intro-done"));
    } catch (err) {
      console.error("WebGL scene failed to start:", err);
      document.dispatchEvent(new CustomEvent("bench-unavailable"));
    }
  }

  // ---------------------------------------------------------------------
  // Lighting, sky, ground, trees
  // ---------------------------------------------------------------------

  // The sun sits low and BEHIND the island, so the monoliths are rim-lit
  // and the cloud deck is lit from within — the lighting setup from the
  // reference photo. SUN_DIR is the direction from the origin toward the
  // sun; everything else (key light, sun disc, god rays, lens flare) is
  // derived from it so they can never drift out of agreement.
  const SUN_DIR = new THREE.Vector3(-0.34, 0.20, -0.92).normalize();
  const SUN_DISTANCE = 96;
  const sunPosition = SUN_DIR.clone().multiplyScalar(SUN_DISTANCE);

  function addLights() {
    // A very low ambient term only — it exists to keep deep shadows from
    // going fully black, not to light the scene. The actual soft fill comes
    // from the environment map (see buildEnvironment), which is directional
    // and therefore still produces form.
    ambientLight = new THREE.AmbientLight(AMBIENT_DAY.getHex(), 0.09);
    scene.add(ambientLight);

    // Sky/ground hemisphere bounce — cool light from above, warm bounce off
    // the cloud deck below. This is what stops the undersides of the island
    // and the models from reading as dead black.
    hemiLight = new THREE.HemisphereLight(0xbcd7ef, 0xffd9a8, 0.28);
    scene.add(hemiLight);

    keyLight = new THREE.DirectionalLight(KEY_DAY.getHex(), 0.95);
    keyLight.position.copy(sunPosition);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    // A tight ortho frustum around the island only. Shadow quality is
    // resolution-per-world-unit, so shrinking this box is worth far more
    // than raising mapSize.
    const sc = keyLight.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26;
    sc.near = 40; sc.far = 190;
    keyLight.shadow.bias = -0.0009;
    keyLight.shadow.normalBias = 0.035;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);
    scene.add(keyLight.target); // target defaults to the origin

    // Warm kicker just off the sun axis, and a cool counter-rim on the
    // camera side — classic three-point staging so silhouettes separate
    // from the cloud deck instead of blending into it.
    rimLight = new THREE.DirectionalLight(0xffb066, 0.30);
    rimLight.position.set(-18, 6, -14);
    scene.add(rimLight);

    rimLight2 = new THREE.DirectionalLight(0x8fb4e8, 0.16);
    rimLight2.position.set(14, 5, 16);
    scene.add(rimLight2);
  }

  // ---------------------------------------------------------------------
  // Image-based lighting
  // ---------------------------------------------------------------------
  // Renders a throwaway gradient-sky scene into a prefiltered cubemap and
  // uses it as scene.environment. Every MeshStandardMaterial then samples
  // it for ambient and specular, which is what gives glass and polished
  // ceramic something to actually reflect. Without this, the hand/face/
  // heart would look like matte plastic no matter how they are shaded.
  function buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();

    const skyGeo = new THREE.SphereGeometry(60, 32, 24);
    const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
    const zenith = new THREE.Color(0x35536f);
    const horizon = new THREE.Color(0xbdb6a6);
    const below = new THREE.Color(0x8b949e);
    for (let i = 0; i < skyGeo.attributes.position.count; i++) {
      const y = skyGeo.attributes.position.getY(i) / 60;
      if (y >= 0) tmpColor.copy(horizon).lerp(zenith, Math.pow(y, 0.7));
      else tmpColor.copy(horizon).lerp(below, Math.pow(-y, 0.8));
      skyColors[i * 3] = tmpColor.r; skyColors[i * 3 + 1] = tmpColor.g; skyColors[i * 3 + 2] = tmpColor.b;
    }
    skyGeo.setAttribute("color", new THREE.BufferAttribute(skyColors, 3));
    envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide
    })));

    // A bright disc standing in for the sun, so reflective surfaces get a
    // real specular hit and not just flat ambient.
    const sunProxy = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xdcd2c0 })
    );
    sunProxy.position.copy(SUN_DIR).multiplyScalar(48);
    envScene.add(sunProxy);

    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;

    skyGeo.dispose();
    sunProxy.geometry.dispose();
    pmrem.dispose();
  }

  // ---------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------
  // Bloom only, and deliberately restrained. The threshold is set high
  // enough that ordinary lit surfaces never bloom — only the sun disc, the
  // god rays and the emissive model highlights cross it, which is what
  // keeps it reading as a lens response rather than a glow filter.
  function buildComposer() {
    if (typeof THREE.EffectComposer === "undefined" || typeof THREE.UnrealBloomPass === "undefined") {
      return; // post-processing scripts failed to load — fall back to direct render
    }
    composer = new THREE.EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new THREE.RenderPass(scene, camera));

    bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.30, // strength
      0.60, // radius
      1.05  // threshold
    );
    composer.addPass(bloomPass);
  }

  // A greyscale value-noise texture, softened with a blur pass so it reads
  // as organic grain/mottling rather than static. Used as a bumpMap (and
  // sometimes roughnessMap) so flat-shaded surfaces pick up real surface
  // irregularity instead of looking like smooth plastic. Reused across
  // many materials rather than regenerated per-instance.
  function makeNoiseTexture(size, blurPx, contrastPct) {
    const raw = document.createElement("canvas");
    raw.width = size; raw.height = size;
    const rctx = raw.getContext("2d");
    const img = rctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = Math.floor(Math.random() * 255);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    rctx.putImageData(img, 0, 0);

    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    const octx = out.getContext("2d");
    octx.filter = "blur(" + blurPx + "px) contrast(" + (contrastPct || 140) + "%)";
    octx.drawImage(raw, 0, 0);

    const tex = new THREE.CanvasTexture(out);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function buildSky() {
    const geo = new THREE.SphereGeometry(130, 24, 16);
    const pos = geo.attributes.position;
    const count = pos.count;
    const dayColors = new Float32Array(count * 3);
    const nightColors = new Float32Array(count * 3);
    const dayTop = new THREE.Color(0x6f9ec4), dayBottom = new THREE.Color(0xdfe7ea);
    const dayGlow = new THREE.Color(0xfff2d2); // hot band around the sun's bearing
    const nightTop = new THREE.Color(0x070b16), nightBottom = new THREE.Color(0x1b2440);
    const nightGlow = new THREE.Color(0x4b5c8c);
    const sunColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = Math.min(Math.max((y / 130 + 1) / 2, 0), 1);
      const e = Math.pow(t, 0.55);

      // How closely this point on the dome lines up with the sun. Raised to
      // a high power so the warm bloom stays a tight band around the sun's
      // bearing rather than tinting the whole sky.
      const len = Math.hypot(x, y, z) || 1;
      const align = (x / len) * SUN_DIR.x + (y / len) * SUN_DIR.y + (z / len) * SUN_DIR.z;
      const glow = Math.pow(Math.max(0, align), 3.2);

      tmpColor.copy(dayBottom).lerp(dayTop, e);
      sunColor.copy(tmpColor).lerp(dayGlow, glow);
      dayColors[i * 3] = sunColor.r; dayColors[i * 3 + 1] = sunColor.g; dayColors[i * 3 + 2] = sunColor.b;

      tmpColor.copy(nightBottom).lerp(nightTop, e);
      sunColor.copy(tmpColor).lerp(nightGlow, glow * 0.7);
      nightColors[i * 3] = sunColor.r; nightColors[i * 3 + 1] = sunColor.g; nightColors[i * 3 + 2] = sunColor.b;
    }

    const colors = new Float32Array(count * 3);
    colors.set(dayColors);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const cloudTex = makeNoiseTexture(256, 11, 118);
    cloudTex.repeat.set(2, 1);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, map: cloudTex, side: THREE.BackSide, fog: false, depthWrite: false,
      transparent: true, opacity: 1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;
    mesh.userData.dayColors = dayColors;
    mesh.userData.nightColors = nightColors;
    scene.add(mesh);
    return mesh;
  }

  function buildStars() {
    const count = STAR_COUNT;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const r = 122;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.0, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = -9;
    scene.add(points);
    return points;
  }

  function buildTerrain() {
    const size = 150;
    const segments = 110;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    const pos = geo.attributes.position;
    const count = pos.count;
    const heights = new Float32Array(count);
    let minH = Infinity, maxH = -Infinity;

    const drops = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // mesh.rotation.x = -90° maps local (x, y) -> world (x, -y) for this
      // plane, so the height at world Z must be sampled at local Y = -Z.
      const wx = pos.getX(i), wz = -pos.getY(i);
      const drop = islandDrop(wx, wz);
      drops[i] = drop;
      const h = terrainHeight(wx, wz) + drop;
      heights[i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }

    const range = Math.max(maxH - minH, 0.0001);
    const low = new THREE.Color(0xdfe2e6); // shaded grass / dirt in hollows
    const high = new THREE.Color(0xdfe2e6); // sunlit grass on the rises
    const tmp = new THREE.Color();
    const colors = new Float32Array(count * 3);

    // The cliff band gets its own darker rock colour, blended in by how far
    // that vertex has fallen — so the ground reads as turf on top and bare
    // rock down the sides, with no hard seam between them.
    const cliffRock = new THREE.Color(0x5d5f63);

    for (let i = 0; i < count; i++) {
      pos.setZ(i, heights[i]);
      const t = (heights[i] - minH) / range;
      tmp.copy(low).lerp(high, t);
      // Fine speckle so the grass reads as mottled/organic rather than a
      // flat two-tone gradient.
      const speck = pseudoNoise(pos.getX(i) * 3.4, pos.getY(i) * 3.4, 7.7) * 0.045;
      const cliffT = Math.min(-drops[i] / 7, 1);
      if (cliffT > 0) tmp.lerp(cliffRock, cliffT);
      colors[i * 3] = Math.min(1, Math.max(0, tmp.r + speck));
      colors[i * 3 + 1] = Math.min(1, Math.max(0, tmp.g + speck));
      colors[i * 3 + 2] = Math.min(1, Math.max(0, tmp.b + speck * 0.6));
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const grainTex = makeNoiseTexture(256, 1.4, 150);
    grainTex.repeat.set(28, 28);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0,
      bumpMap: grainTex, bumpScale: 0.045, roughnessMap: grainTex
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------------
  // Floating island: the rim, the rock underside, and the cloud sea
  // ---------------------------------------------------------------------

  // How far below its natural height a ground vertex is pushed, as a
  // function of distance from the hub. Flat out to ISLAND_RIM, then it
  // curves over and falls away into the cliff. Applied to the ground mesh
  // ONLY — terrainHeight() stays untouched so every placement calculation
  // in the rest of the file keeps agreeing with itself.
  function islandDrop(x, z) {
    const r = Math.hypot(x, z);
    if (r <= ISLAND_RIM) return 0;
    const t = Math.min((r - ISLAND_RIM) / (ISLAND_RADIUS - ISLAND_RIM), 1);
    const curve = t * t * t; // flat at the lip, then falls hard — reads as an overhang
    // Past the rim the mesh just plunges; it is never seen, because the
    // orbit controls stop at the horizon and the cloud deck covers it.
    return -curve * 24 - Math.max(0, r - ISLAND_RADIUS) * 3.0;
  }

  // The rock mass hanging below the island — the thing that actually sells
  // "floating" rather than "hill". Built as a lathe-style cone from the rim
  // down to a ragged point, with noise pushed into every ring.
  function buildIslandSkirt() {
    const rings = 16, radial = 48;
    const geo = new THREE.CylinderGeometry(ISLAND_RADIUS, 3, 40, radial, rings, true);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rockTop = new THREE.Color(0x63666b);
    const rockDeep = new THREE.Color(0x24272e);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const t = (vy + 20) / 40; // 0 at the tip, 1 at the rim
      // Vertical striations plus lumpy noise — stone erodes in columns, so
      // the high-frequency variation is stronger around the axis than along it.
      const n = pseudoNoise(vx * 0.18, vy * 0.09, vz * 0.18);
      const n2 = pseudoNoise(vx * 0.55, vy * 0.2, vz * 0.55);
      const len = Math.hypot(vx, vz) || 1;
      const push = (n * 2.6 + n2 * 1.1) * (0.35 + t * 0.65);
      pos.setX(i, vx + (vx / len) * push);
      pos.setZ(i, vz + (vz / len) * push);
      pos.setY(i, vy + n2 * 0.9);

      c.copy(rockDeep).lerp(rockTop, Math.pow(t, 0.8));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const grain = makeNoiseTexture(256, 1.2, 160);
    grain.repeat.set(10, 10);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.98, metalness: 0.0, flatShading: true,
      bumpMap: grain, bumpScale: 0.09, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Seat the cone so its top ring (local +20, since the cylinder is
    // 40 tall and centred) lands just under where the ground mesh has
    // fallen to at the rim, with a little overlap so no gap can show.
    const rimY = rawTerrainHeight(ISLAND_RADIUS, 0) + islandDrop(ISLAND_RADIUS, 0);
    mesh.position.y = rimY - 20 + 2.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  // A soft, tiling cloud alpha map built from stacked value-noise octaves.
  // Returning alpha rather than colour means one texture can be tinted per
  // layer instead of baking a colour choice in.
  function makeCloudTexture(size) {
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(size, size);

    // Four octaves of seeded value noise, sampled with wrap so the result
    // tiles cleanly across the deck.
    function octave(x, y, freq) {
      const xi = Math.floor(x * freq), yi = Math.floor(y * freq);
      const xf = x * freq - xi, yf = y * freq - yi;
      const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
      const f = Math.ceil(freq);
      function v(a, b) {
        const s = Math.sin(((a % f) + f) % f * 127.1 + ((b % f) + f) % f * 311.7) * 43758.5453;
        return s - Math.floor(s);
      }
      const a = v(xi, yi), b = v(xi + 1, yi), cc = v(xi, yi + 1), d = v(xi + 1, yi + 1);
      return (a + (b - a) * sx) + ((cc + (d - cc) * sx) - (a + (b - a) * sx)) * sy;
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        let n = octave(u, v, 4) * 0.5 + octave(u, v, 8) * 0.26 +
                octave(u, v, 16) * 0.15 + octave(u, v, 32) * 0.09;
        // Bias hard so the field breaks into distinct banks with clear air
        // between them, instead of uniform haze.
        n = Math.max(0, n - 0.42) / 0.58;
        const a = Math.floor(Math.min(1, Math.pow(n, 1.35)) * 255);
        const i = (y * size + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Single soft puff — a radial falloff with a slightly flattened core, so
  // stacked sprites build up mass instead of a ring of hotspots.
  function makePuffTexture(size) {
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.00, "rgba(255,255,255,0.92)");
    g.addColorStop(0.35, "rgba(255,255,255,0.62)");
    g.addColorStop(0.70, "rgba(255,255,255,0.18)");
    g.addColorStop(1.00, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // The cloud sea the island hangs over. Two systems working together:
  // stacked tiling planes give the endless "floor", and scattered sprite
  // puffs give it depth and a lumpy top surface near the island so it
  // doesn't read as a flat sheet of texture.
  function buildCloudDeck() {
    const group = new THREE.Group();
    const cloudTex = makeCloudTexture(512);

    const layers = [
      { y: -26, repeat: 2.2, opacity: CLOUD_LAYER_OPACITY[0], tint: 0xf4f2ee, drift: 0.0016 },
      { y: -33, repeat: 3.4, opacity: CLOUD_LAYER_OPACITY[1], tint: 0xe8ddcd, drift: -0.0011 },
      { y: -41, repeat: 5.0, opacity: CLOUD_LAYER_OPACITY[2], tint: 0xc9d0da, drift: 0.0007 }
    ];
    const planes = [];
    layers.forEach(function (L) {
      const tex = cloudTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(L.repeat, L.repeat);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: L.tint, transparent: true, opacity: L.opacity,
        depthWrite: false, fog: false, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(460, 460, 1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = L.y;
      mesh.renderOrder = -6;
      mesh.userData.drift = L.drift;
      mesh.userData.tex = tex;
      group.add(mesh);
      planes.push(mesh);
    });

    // Sprite puffs, thickest near the island and thinning outward. Puffs on
    // the sun side are tinted warm and pushed brighter — light scattering
    // through a cloud bank from behind, which is the whole look of the
    // reference photo.
    const puffTex = makePuffTexture(256);
    const puffs = [];
    const warm = new THREE.Color(0xfff1d6);
    const cool = new THREE.Color(0xb9c6d8);
    const PUFF_COUNT = reducedMotion ? 60 : 130;
    for (let i = 0; i < PUFF_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 34 + Math.pow(Math.random(), 0.65) * 165;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      // Facing = how aligned this puff is with the sun as seen from origin.
      const facing = (Math.cos(ang) * SUN_DIR.x + Math.sin(ang) * SUN_DIR.z);
      const lit = Math.pow(Math.max(0, facing) * 0.5 + 0.5, 2.2);
      const mat = new THREE.SpriteMaterial({
        map: puffTex,
        color: cool.clone().lerp(warm, lit),
        transparent: true,
        opacity: (0.16 + Math.random() * 0.2) * (0.6 + lit * 0.8),
        depthWrite: false,
        fog: false
      });
      const sprite = new THREE.Sprite(mat);
      const s = 26 + Math.random() * 62;
      sprite.scale.set(s, s * (0.42 + Math.random() * 0.22), 1);
      sprite.position.set(x, -20 - Math.random() * 22, z);
      sprite.renderOrder = -5;
      sprite.userData.baseX = x;
      sprite.userData.baseZ = z;
      sprite.userData.phase = Math.random() * Math.PI * 2;
      sprite.userData.baseOpacity = mat.opacity;
      group.add(sprite);
      puffs.push(sprite);
    }

    group.userData.planes = planes;
    group.userData.puffs = puffs;
    scene.add(group);
    return group;
  }

  // The sun itself: a small hot core inside a much wider warm halo. Both
  // are additive and sit above the bloom threshold, so the bloom pass is
  // what actually spreads the light across the frame.
  function buildSunDisc() {
    const group = new THREE.Group();
    group.position.copy(sunPosition);

    const coreTex = makePuffTexture(256);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: coreTex, color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    core.scale.set(7, 7, 1);
    core.renderOrder = -4;
    group.add(core);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: coreTex, color: 0xffd9a0, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    halo.scale.set(30, 30, 1);
    halo.renderOrder = -4;
    group.add(halo);

    group.userData.core = core;
    group.userData.halo = halo;
    scene.add(group);
    return group;
  }

  // Crepuscular rays. A fan of long, thin additive blades anchored at the
  // sun; the whole fan is turned to face the camera every frame, so the
  // shafts always read edge-on to the viewer the way real light shafts do.
  function buildGodRays() {
    const group = new THREE.Group();
    group.position.copy(sunPosition);

    const SHAFTS = 15;
    for (let i = 0; i < SHAFTS; i++) {
      const angle = (i / SHAFTS) * Math.PI * 2 + Math.random() * 0.22;
      const length = 70 + Math.random() * 120;
      const width = 1.4 + Math.random() * 5.5;

      // A triangle narrowing to a point at the sun end, so each shaft
      // fades out rather than terminating in a hard edge.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        -width / 2, length, 0,
        width / 2, length, 0
      ]), 3));
      // Alpha carried in vertex colour: opaque at the sun, gone at the tip.
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array([
        1, 1, 1,
        0, 0, 0,
        0, 0, 0
      ]), 3));

      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, color: 0xffe2b4,
        transparent: true, opacity: 0.022 + Math.random() * 0.03,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false
      });
      const shaft = new THREE.Mesh(geo, mat);
      shaft.rotation.z = angle;
      shaft.renderOrder = -3;
      shaft.userData.baseOpacity = mat.opacity;
      shaft.userData.phase = Math.random() * Math.PI * 2;
      shaft.userData.speed = 0.18 + Math.random() * 0.3;
      group.add(shaft);
    }
    scene.add(group);
    return group;
  }

  // Trees are instanced: every tree shares the same trunk geometry and the
  // same 3 tier-cone geometries, varying only by transform (and one of a
  // few color variants). This is the main fix for tree-count lag — the
  // previous version built a brand-new CylinderGeometry + 3 ConeGeometry
  // objects (4 separate GPU buffers, 4 draw calls) for EVERY tree, so 700
  // trees meant 2,800 draw calls. Instanced, it's 10 draw calls no matter
  // how many trees there are.
  function buildTrees() {
    const barkTex = makeNoiseTexture(128, 0.8, 160);
    barkTex.repeat.set(1, 4);
    const leafTex = makeNoiseTexture(128, 1.0, 135);
    leafTex.repeat.set(4, 4);

    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.11, 1, 6);
    trunkGeo.translate(0, 0.5, 0); // base at local y=0, top at y=1 (unit height)
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x474b52, roughness: 0.97, metalness: 0.0, bumpMap: barkTex, bumpScale: 0.05
    });

    // Tier y-offsets assume a unit-height trunk; each tree's own random
    // scale (applied to the whole instance transform) sizes everything —
    // trunk, tiers, and the gaps between them — together and consistently.
    const tiers = [
      { r: 0.78, h: 0.95, yOffset: 1.38 },
      { r: 0.59, h: 0.79, yOffset: 1.836 },
      { r: 0.40, h: 0.63, yOffset: 2.292 }
    ];
    const tierGeos = tiers.map(function (tr) { return new THREE.ConeGeometry(tr.r, tr.h, 7); });

    // A handful of foliage color variants (instead of one continuously
    // varied hue per tree) — this is what lets foliage be instanced at
    // all, since InstancedMesh in this three.js version instances
    // transform, not per-instance color.
    const hueShifts = [-0.045, 0, 0.045];
    const foliageMats = hueShifts.map(function (hs) {
      const c = new THREE.Color(0x474b52);
      c.offsetHSL(hs, 0, 0);
      return new THREE.MeshStandardMaterial({
        color: c, roughness: 0.96, metalness: 0.0, flatShading: true,
        bumpMap: leafTex, bumpScale: 0.07
      });
    });

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    const foliageMeshes = hueShifts.map(function (hs, v) {
      return tierGeos.map(function (tg) { return new THREE.InstancedMesh(tg, foliageMats[v], TREE_COUNT); });
    });

    const dummy = new THREE.Object3D();
    const variantCounts = [0, 0, 0];
    let placed = 0, attempts = 0;
    const maxAttempts = Math.min(TREE_COUNT * 15, 60000); // bounded regardless of TREE_COUNT
    while (placed < TREE_COUNT && attempts < maxAttempts) {
      attempts++;
      const ang = Math.random() * Math.PI * 2;
      const rad = 10.5 + Math.random() * 26; // kept inside ISLAND_RIM so no tree hangs off the cliff
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      let tooClose = false;
      for (let i = 0; i < flattenAnchors.length; i++) {
        const a = flattenAnchors[i];
        if (Math.hypot(x - a.x, z - a.z) < a.outerRadius + 2.0) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const y = terrainHeight(x, z);
      const rotY = Math.random() * Math.PI * 2;
      const scale = 0.75 + Math.random() * 0.75;
      const variant = Math.floor(Math.random() * hueShifts.length);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(placed, dummy.matrix);

      for (let ti = 0; ti < tiers.length; ti++) {
        dummy.position.set(x, y + tiers[ti].yOffset * scale, z);
        dummy.updateMatrix();
        foliageMeshes[variant][ti].setMatrixAt(variantCounts[variant], dummy.matrix);
      }
      variantCounts[variant]++;
      placed++;
    }

    trunkMesh.count = placed;
    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    scene.add(trunkMesh);

    hueShifts.forEach(function (hs, v) {
      tiers.forEach(function (tr, ti) {
        const mesh = foliageMeshes[v][ti];
        mesh.count = variantCounts[v];
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      });
    });

    return trunkMesh;
  }

  // ---------------------------------------------------------------------
  // Grass — instanced, tapered blades with a wind-sway vertex shader
  // patched into the normal lit material via onBeforeCompile (so it still
  // responds to the scene's day/night lighting like everything else).
  // Blade length is controlled by GRASS_BLADE_HEIGHT above; each blade's
  // final length/width comes from its own instance scale, not the
  // geometry, so that one constant resizes the whole field.
  // ---------------------------------------------------------------------

  function buildGrassBladeGeometry() {
    const heightSegments = 4;
    const geo = new THREE.PlaneGeometry(1, 1, 1, heightSegments);
    geo.translate(0, 0.5, 0); // base at local y=0, tip at y=1

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rootColor = new THREE.Color(0x474b52);
    const tipColor = new THREE.Color(0x474b52);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i); // 0 at base, 1 at tip
      const taper = 1 - t * 0.82; // narrows toward the tip
      pos.setX(i, pos.getX(i) * taper);
      tmp.copy(rootColor).lerp(tipColor, t);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function buildGrass() {
    const geo = buildGrassBladeGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide
    });

    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = grassUniforms.uTime;
      shader.uniforms.uWindStrength = grassUniforms.uWindStrength;
      shader.vertexShader = "uniform float uTime;\nuniform float uWindStrength;\n" + shader.vertexShader;
      // Patched in AFTER the per-instance matrix is applied (not before),
      // so the sway is a consistent world-space amount regardless of any
      // individual blade's own scale — otherwise a short, narrow blade
      // would sway a totally different amount than a tall one for the
      // same shader math.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        [
          "vec4 mvPosition = vec4( transformed, 1.0 );",
          "#ifdef USE_INSTANCING",
          "  mvPosition = instanceMatrix * mvPosition;",
          "#endif",
          "float heightFactor = position.y;",
          "float windPhase = uTime * 1.7 + (mvPosition.x * 0.6 + mvPosition.z * 0.6);",
          "float sway = sin(windPhase) * uWindStrength * heightFactor * heightFactor;",
          "mvPosition.x += sway;",
          "mvPosition.z += sway * 0.55;",
          "mvPosition = modelViewMatrix * mvPosition;",
          "gl_Position = projectionMatrix * mvPosition;"
        ].join("\n")
      );
    };

    const mesh = new THREE.InstancedMesh(geo, mat, GRASS_BLADE_COUNT);
    const dummy = new THREE.Object3D();
    let placed = 0, attempts = 0;
    // Bounded independently of GRASS_BLADE_COUNT — without this, setting
    // the count very high (six figures+) turns this into millions of
    // synchronous iterations and freezes the page on load before a single
    // frame renders.
    const maxAttempts = Math.min(GRASS_BLADE_COUNT * 3, 250000);
    while (placed < GRASS_BLADE_COUNT && attempts < maxAttempts) {
      attempts++;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * GRASS_FIELD_RADIUS; // uniform over the disc's area
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;

      let tooClose = false;
      for (let i = 0; i < flattenAnchors.length; i++) {
        const a = flattenAnchors[i];
        if (Math.hypot(x - a.x, z - a.z) < a.outerRadius + 1.2) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Clamped to a small positive floor — a variance of 1.0 or higher
      // would otherwise let this go zero or negative, which inverts the
      // blade (it renders flipped through the ground instead of just short).
      const heightMul = Math.max(0.15, 1 + (Math.random() * 2 - 1) * GRASS_BLADE_HEIGHT_VARIANCE);
      const h = GRASS_BLADE_HEIGHT * heightMul;
      const w = GRASS_BLADE_WIDTH * (0.8 + Math.random() * 0.4);
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function buildParticles() {
    const count = PARTICLE_COUNT;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 70;
      positions[i * 3 + 1] = Math.random() * 11 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 70;
      speeds[i] = 0.25 + Math.random() * 0.4; // units/sec, GPU-side now (was per-frame CPU)
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xf3f0e8, size: 0.09, transparent: true, opacity: 0.32,
      sizeAttenuation: true, depthWrite: false
    });
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = particleUniforms.uTime;
      shader.vertexShader =
        "attribute float aSpeed;\nattribute float aPhase;\nuniform float uTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "float riseRange = 11.0;",
          "float y0 = mod(position.y - 0.5, riseRange);",
          "transformed.y = mod(y0 + uTime * aSpeed, riseRange) + 0.5;",
          "transformed.x += sin(uTime * 0.15 + aPhase) * 0.6;",
          "transformed.z += cos(uTime * 0.15 + aPhase) * 0.6;"
        ].join("\n")
      );
    };
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    return points;
  }

  // ---------------------------------------------------------------------
  // Hub — gear ring + DNA helix (mechanical + biomedical). Purely
  // decorative — About Me has its own monolith like everything else.
  // ---------------------------------------------------------------------

  // The centrepiece: a glass double helix turning inside a driven gear ring.
  //
  // Three things make it hold the eye, and they only work together:
  //   1. The strands are swept tubes, not strings of beads, so they refract
  //      the environment map the way the toppers do.
  //   2. It is a light source rather than a lit object — a warm core lamp
  //      throws the clearing's shadows outward toward the three monoliths,
  //      which is what makes the circular layout read as deliberate.
  //   3. Light pulses climb the strands. Motion at dead centre is what the
  //      eye actually latches onto, and the bloom pass flares each pulse as
  //      it passes.
  function buildHub() {
    const group = new THREE.Group();
    const ringY = 0.22; // clears the torus tube radius so it doesn't sit half-buried

    const HELIX_TURNS = 3;
    const HELIX_RADIUS = 1.5;
    const HELIX_HEIGHT = 6;
    const RUNG_COUNT = 26;

    // --- Gear ring ------------------------------------------------------
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: 0xb9bec4, metalness: 0.85, roughness: 0.28,
      clearcoat: 0.4, envMapIntensity: 1.5,
      emissive: 0x10171a, emissiveIntensity: 0.35,
      transparent: true, opacity: 1
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.16, 16, 96), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ringY;
    group.add(ring);

    // Teeth are split into three arcs, one per section, so the exploration
    // tracker can light them independently (see setHubProgress).
    const TEETH = 24;
    const toothGeo = new THREE.BoxGeometry(0.34, 0.34, 0.5);
    const arcMats = [];
    const arcMeshes = [];
    for (let arc = 0; arc < 3; arc++) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xb9bec4, metalness: 0.85, roughness: 0.28,
        clearcoat: 0.4, envMapIntensity: 1.5,
        emissive: 0xffd9a0, emissiveIntensity: 0,
        transparent: true, opacity: 1
      });
      const per = TEETH / 3;
      const teeth = new THREE.InstancedMesh(toothGeo, mat, per);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < per; i++) {
        const a = ((arc * per + i) / TEETH) * Math.PI * 2;
        dummy.position.set(Math.cos(a) * 3.1, ringY, Math.sin(a) * 3.1);
        dummy.rotation.y = -a;
        dummy.updateMatrix();
        teeth.setMatrixAt(i, dummy.matrix);
      }
      teeth.castShadow = true;
      teeth.receiveShadow = true;
      group.add(teeth);
      arcMats.push(mat);
      arcMeshes.push(teeth);
    }

    // A ring of inspection marks on the ground, like a datum circle drawn
    // around the assembly — ties the sculpture to the drafting language.
    const datum = new THREE.Mesh(
      new THREE.RingGeometry(3.52, 3.58, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6f757c, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    datum.rotation.x = -Math.PI / 2;
    datum.position.y = 0.02;
    group.add(datum);

    // --- Helix ----------------------------------------------------------
    const helixGroup = new THREE.Group();

    // Swept glass ribbons. Sampling the curve densely matters more than tube
    // segments here — too few control points and the helix visibly faceted.
    function strandCurve(phase) {
      const pts = [];
      const SAMPLES = 160;
      for (let i = 0; i <= SAMPLES; i++) {
        const t = i / SAMPLES;
        const angle = t * Math.PI * 2 * HELIX_TURNS + phase;
        pts.push(new THREE.Vector3(
          Math.cos(angle) * HELIX_RADIUS,
          t * HELIX_HEIGHT - HELIX_HEIGHT / 2,
          Math.sin(angle) * HELIX_RADIUS
        ));
      }
      return new THREE.CatmullRomCurve3(pts);
    }

    const strandMatA = new THREE.MeshPhysicalMaterial({
      color: 0xdfe6ec, metalness: 0.0, roughness: 0.07,
      clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 2.6,
      emissive: 0xbfd2dd, emissiveIntensity: 0.10,
      transparent: true, opacity: 1
    });
    const strandMatB = new THREE.MeshPhysicalMaterial({
      color: 0x8e979f, metalness: 0.55, roughness: 0.22,
      clearcoat: 0.7, envMapIntensity: 2.0,
      emissive: 0x6d7a84, emissiveIntensity: 0.10,
      transparent: true, opacity: 1
    });

    [{ phase: 0, mat: strandMatA }, { phase: Math.PI, mat: strandMatB }].forEach(function (s) {
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(strandCurve(s.phase), 320, 0.085, 16, false),
        s.mat
      );
      tube.castShadow = true;
      helixGroup.add(tube);
    });

    // --- Base pairs -------------------------------------------------------
    // Each rung gets its own material so a pulse can travel the helix by
    // lighting them in sequence. 26 extra materials is a real cost, but it
    // buys the one piece of motion at the centre of the composition.
    const rungMats = [];
    const rungs = [];
    for (let i = 0; i < RUNG_COUNT; i++) {
      const t = i / (RUNG_COUNT - 1);
      const angle = t * Math.PI * 2 * HELIX_TURNS;
      const y = t * HELIX_HEIGHT - HELIX_HEIGHT / 2;
      const xA = Math.cos(angle) * HELIX_RADIUS, zA = Math.sin(angle) * HELIX_RADIUS;
      const xB = -xA, zB = -zA;

      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xd8d2c4, metalness: 0.3, roughness: 0.35,
        emissive: 0xffc98a, emissiveIntensity: 0.12,
        envMapIntensity: 1.2, transparent: true, opacity: 0.85
      });
      const rungLen = Math.hypot(xA - xB, zA - zB);
      const rung = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, rungLen, 10), mat
      );
      rung.position.set(0, y, 0);
      rung.lookAt(new THREE.Vector3(xB, y, zB));
      rung.rotateX(Math.PI / 2);
      helixGroup.add(rung);
      rungMats.push(mat);
      rungs.push(rung);
    }

    helixGroup.position.y = ringY + HELIX_HEIGHT / 2 + 0.15;
    group.add(helixGroup);

    // --- The hub as a light source ---------------------------------------
    // This is the change that makes the clearing read as composed rather
    // than merely occupied: shadows now radiate outward from the centre
    // toward the three monoliths.
    const coreLight = new THREE.PointLight(0xffd2a0, 2.4, 22, 2);
    coreLight.position.y = ringY + 2.4;
    coreLight.castShadow = true;
    coreLight.shadow.mapSize.set(1024, 1024);
    coreLight.shadow.bias = -0.004;
    coreLight.shadow.camera.near = 0.4;
    coreLight.shadow.camera.far = 24;
    group.add(coreLight);

    // A soft glow sprite at the base so the light has a visible source
    // instead of appearing to come from nowhere.
    const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makePuffTexture(128), color: 0xffd9a8,
      transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    glowSprite.scale.set(4.2, 4.2, 1);
    glowSprite.position.y = ringY + 1.2;
    group.add(glowSprite);

    group.userData.helix = helixGroup;
    group.userData.ring = ring;
    group.userData.arcMats = arcMats;
    group.userData.arcMeshes = arcMeshes;
    group.userData.rungMats = rungMats;
    group.userData.coreLight = coreLight;
    group.userData.glowSprite = glowSprite;
    group.userData.datumMat = datum.material;
    group.userData.glowMats = [
      { mat: ringMat, base: 0.35 },
      { mat: strandMatA, base: 0.10 },
      { mat: strandMatB, base: 0.10 }
    ];
    return group;
  }

  // Lights one third of the gear ring per section explored, and winds the
  // whole assembly up as the visitor gets closer to 3/3. Called from ui.js.
  let hubProgress = 0;
  let hubCelebrateUntil = 0;
  window.setHubProgress = function (count, total) {
    hubProgress = total ? count / total : 0;
    if (count >= total && total > 0) hubCelebrateUntil = performance.now() + 4000;
  };

  // Drives everything time-based about the hub. Split out of animate() only
  // because the render loop was getting hard to read.
  function updateHub(time) {
    if (!hub) return;
    const ud = hub.userData;

    // Spin rate rises with exploration progress, and briefly surges when
    // the last section is found.
    const celebrating = performance.now() < hubCelebrateUntil;
    const speed = (1 + hubProgress * 1.6) * (celebrating ? 2.6 : 1);

    if (!reducedMotion) {
      // The ring drives the helix: they counter-rotate, and the ratio is
      // fixed, so the two halves read as one mechanism instead of two props.
      hub.rotation.y += 0.0022 * speed;
      if (ud.helix) ud.helix.rotation.y -= 0.0035 * speed;
    }

    // Base pairs light in sequence, a pulse climbing the helix. Two pulses
    // are in flight at once so the motion never fully stops.
    if (ud.rungMats) {
      const n = ud.rungMats.length;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        let lit = 0;
        for (let p = 0; p < 2; p++) {
          const head = ((time * 0.22 * speed) + p * 0.5) % 1;
          let d = t - head;
          if (d < -0.5) d += 1; else if (d > 0.5) d -= 1;
          // Sharp leading edge, long trailing tail — reads as travel
          // direction rather than a symmetrical blob.
          const tail = d < 0 ? Math.exp(d * 26) : Math.exp(-d * 90);
          lit = Math.max(lit, tail);
        }
        const base = 0.12 + hubProgress * 0.15;
        ud.rungMats[i].emissiveIntensity = base + lit * (1.9 + (celebrating ? 1.6 : 0));
      }
    }

    // Gear arcs light one per section explored.
    if (ud.arcMats) {
      const litArcs = hubProgress * ud.arcMats.length;
      ud.arcMats.forEach(function (mat, i) {
        const target = (i < Math.floor(litArcs + 0.0001) ? 0.55 : 0.0) *
          (celebrating ? 1.8 : 1);
        mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.06;
      });
    }

    if (ud.coreLight) {
      const flicker = reducedMotion ? 1 :
        1 + Math.sin(time * 1.7) * 0.05 + Math.sin(time * 4.3) * 0.025;
      const target = (2.4 + hubProgress * 1.8) * (celebrating ? 1.7 : 1);
      ud.coreLight.intensity = target * flicker * (1 - blueprint);
    }
    if (ud.glowSprite) {
      ud.glowSprite.material.opacity = (0.55 + hubProgress * 0.25) * (1 - blueprint);
    }
    if (ud.datumMat) {
      ud.datumMat.opacity = 0.28 * (1 - blueprint);
    }
  }

  // ---------------------------------------------------------------------
  // Monoliths — rough-hewn standing stones with a standalone placard sign
  // ---------------------------------------------------------------------

  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
    return h % 97;
  }

  function pseudoNoise(x, y, z) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1; // -1..1
  }

  function hexString(num) {
    return "#" + num.toString(16).padStart(6, "0");
  }

  function makePlacardTexture(text, colorHex) {
    const w = 512, h = 240;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    // Solid plate — a real sign, not a decal on the rock, so it's never
    // occluded by the rock's own (irregular, jittered) surface.
    ctx.fillStyle = "#242420";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(226, 217, 190, 0.45)";
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.font = "700 62px 'Libre Caslon Display', 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(10, 9, 7, 0.65)";
    ctx.fillText(text, w / 2 + 2, h * 0.42 + 2);
    ctx.fillStyle = "#ece3ca";
    ctx.fillText(text, w / 2, h * 0.42);

    // A thin accent rule beneath, tying the sign to this totem's color.
    const accent = hexString(colorHex);
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.3, h * 0.68, w * 0.4, 5);

    const tex = new THREE.CanvasTexture(c);
    // Colour maps must be flagged sRGB now that the renderer writes sRGB,
    // or the artwork comes out washed out relative to everything else.
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    return tex;
  }

  // A second, letters-only texture used as the emissive map, so only the
  // text itself glows (at night) rather than the whole plate.
  function makeGlowTexture(text) {
    const w = 512, h = 240;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.font = "700 62px 'Libre Caslon Display', 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, w / 2, h * 0.42);
    return new THREE.CanvasTexture(c);
  }

  function buildPlacard(node) {
    const g = new THREE.Group();

    const postMat = new THREE.MeshStandardMaterial({
      color: 0x2a2b26, roughness: 0.55, metalness: 0.4, transparent: true, opacity: 1
    });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.85, 8), postMat);
    post.position.y = 0.425;
    g.add(post);

    const tex = makePlacardTexture(node.engraving, node.color);
    const glowTex = makeGlowTexture(node.engraving);
    const plateMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.5, metalness: 0.25, transparent: true, opacity: 1,
      emissiveMap: glowTex, emissive: node.color, emissiveIntensity: 0.08
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.29), plateMat);
    plate.position.set(0, 0.87, 0.01);
    plate.rotation.x = -Math.PI / 7; // angled like museum/exhibit signage
    g.add(plate);

    const backMat = new THREE.MeshStandardMaterial({
      color: 0x1b1c19, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 1
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.29), backMat);
    back.position.set(0, 0.87, -0.01);
    back.rotation.x = -Math.PI / 7;
    back.rotation.y = Math.PI;
    g.add(back);

    g.position.set(0.95, 0, 0.55);
    g.userData.materials = [postMat, plateMat, backMat];
    g.userData.plateMat = plateMat;
    return g;
  }

  function buildMonolith(color, node, rockGrainTex) {
    const g = new THREE.Group();
    const seed = hashSeed(node.id);
    const height = 3.5 + (seed % 11) * 0.09; // 3.5–4.5, varied per totem

    const geo = new THREE.CylinderGeometry(0.4, 0.56, height, 6, 5, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const n = pseudoNoise(vx * 2.6 + seed, vy * 1.8 + seed, vz * 2.6 + seed);
      const jitter = 0.1 + 0.05 * Math.abs(Math.sin(vy * 1.6 + seed));
      const len = Math.hypot(vx, vz) || 1;
      pos.setX(i, vx + (vx / len) * n * jitter);
      pos.setZ(i, vz + (vz / len) * n * jitter);
    }
    geo.computeVertexNormals();

    const colorArr = new Float32Array(pos.count * 3);
    const stoneA = new THREE.Color(0x454f50); // dark slate
    const stoneB = new THREE.Color(0x97a49c); // pale sage-grey
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i);
      const band = 0.5 + 0.5 * Math.sin(vy * 2.2 + seed * 3 + pos.getX(i) * 1.2);
      tmp.copy(stoneA).lerp(stoneB, band);
      // Fine mineral-grain speckle so the stone doesn't read as a smooth
      // two-tone gradient.
      const speck = pseudoNoise(pos.getX(i) * 4.2 + seed, vy * 4.2 + seed, pos.getZ(i) * 4.2) * 0.06;
      colorArr[i * 3] = Math.min(1, Math.max(0, tmp.r + speck));
      colorArr[i * 3 + 1] = Math.min(1, Math.max(0, tmp.g + speck));
      colorArr[i * 3 + 2] = Math.min(1, Math.max(0, tmp.b + speck));
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));

    const stoneMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.02, flatShading: true,
      transparent: true, opacity: 1,
      bumpMap: rockGrainTex, bumpScale: 0.032
    });
    const rock = new THREE.Mesh(geo, stoneMat);
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.position.y = height / 2;
    rock.rotation.y = pseudoNoise(seed, 1, 1) * 0.6;
    rock.rotation.z = pseudoNoise(seed, 2, 2) * 0.04;
    g.add(rock);

    // A wireframe "blueprint" twin of the same rock, hidden until clicked —
    // it flashes over the solid stone like a CAD X-ray view.
    const wireMat = new THREE.MeshBasicMaterial({
      color: color, wireframe: true, transparent: true, opacity: 0, depthWrite: false,
      // fog:false is load-bearing. The blueprint intro drives the fog white
      // and dense to hide the world; this linework has to survive that.
      fog: false
    });
    const wireMesh = new THREE.Mesh(geo, wireMat);
    wireMesh.position.copy(rock.position);
    wireMesh.rotation.copy(rock.rotation);
    g.add(wireMesh);

    // The glowing aura — a soft, short-range light at the base, like
    // ground-level landscape lighting under each stone. Brighter at night.
    const glow = new THREE.PointLight(color, 1.1, 6.5, 2);
    glow.position.set(0, 0.35, 0.5);
    g.add(glow);

    g.userData.stoneMat = stoneMat;
    g.userData.wireMat = wireMat;
    g.userData.glowLight = glow;
    g.userData.height = height;
    return g;
  }

  // ---------------------------------------------------------------------
  // Toppers — one sculpture per pillar, each standing for what that
  // section is about: a face in glass (About), an anatomical heart (Work
  // Experience), a robotic hand holding a flower (Projects).
  //
  // All three are generated here rather than loaded as assets. The face and
  // the heart share a technique — sculpt an ellipsoid by summing signed
  // gaussian "features" over its surface — while the hand is an articulated
  // rig of parented segments.
  // ---------------------------------------------------------------------

  // Shared look for the three sculptures. These read as glass/ceramic
  // rather than shaded plastic because of scene.environment — almost
  // everything you see on them is reflected sky and sun, so envMapIntensity
  // is the main "how expensive does this look" dial here.
  //
  // Every one of these is transparent:true on purpose: the focus system in
  // animate() dims non-active nodes by lerping material.opacity, so an
  // opaque material here would simply refuse to fade.
  function sculptureMaterial(opts) {
    const o = opts || {};
    return new THREE.MeshPhysicalMaterial({
      color: o.color !== undefined ? o.color : 0xffffff,
      roughness: o.roughness !== undefined ? o.roughness : 0.12,
      metalness: o.metalness !== undefined ? o.metalness : 0.0,
      clearcoat: o.clearcoat !== undefined ? o.clearcoat : 0.9,
      clearcoatRoughness: o.clearcoatRoughness !== undefined ? o.clearcoatRoughness : 0.06,
      envMapIntensity: o.envMapIntensity !== undefined ? o.envMapIntensity : 1.6,
      emissive: o.emissive !== undefined ? o.emissive : 0x000000,
      emissiveIntensity: o.emissiveIntensity !== undefined ? o.emissiveIntensity : 0,
      transmission: o.transmission !== undefined ? o.transmission : 0,
      ior: o.ior !== undefined ? o.ior : 1.5,
      reflectivity: o.reflectivity !== undefined ? o.reflectivity : 0.6,
      transparent: true,
      opacity: 1,
      side: o.side !== undefined ? o.side : THREE.FrontSide,
      flatShading: false
    });
  }

  // Frosted glass — the look of the face and the heart's outer shell.
  // Kept slightly opaque rather than fully transmissive so the silhouette
  // still reads at pillar-top scale against a bright sky.
  function glassMaterial(tint) {
    return sculptureMaterial({
      color: tint !== undefined ? tint : 0xeef4f7,
      roughness: 0.06,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 2.4,
      reflectivity: 0.85
    });
  }

  // Polished white shell — the hand, and the heart's inner core.
  function ceramicMaterial(tint) {
    return sculptureMaterial({
      color: tint !== undefined ? tint : 0xf6f7f8,
      roughness: 0.22,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.3
    });
  }

  // Dark machined metal — joints, pivots, vessel lips.
  function metalMaterial(tint) {
    return sculptureMaterial({
      color: tint !== undefined ? tint : 0x3a3f47,
      roughness: 0.32,
      metalness: 0.95,
      clearcoat: 0.3,
      envMapIntensity: 1.8
    });
  }

  // Walks a built model, hands every mesh over to the shadow system and
  // collects one entry per unique material for the focus-fade system.
  function finishModel(group) {
    const mats = [];
    group.traverse(function (obj) {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material && mats.indexOf(obj.material) === -1) mats.push(obj.material);
    });
    group.userData.materials = mats;
    return group;
  }

  // A rounded segment — cylinder with hemispherical caps. Stands in for the
  // capsule primitive, which this version of three.js predates. Used for
  // every bone of the hand.
  function roundedSegment(rBottom, rTop, length, mat, radialSegments) {
    const g = new THREE.Group();
    const rs = radialSegments || 16;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, length, rs, 1), mat);
    body.position.y = length / 2;
    g.add(body);
    const capA = new THREE.Mesh(new THREE.SphereGeometry(rBottom, rs, Math.round(rs / 2)), mat);
    g.add(capA);
    const capB = new THREE.Mesh(new THREE.SphereGeometry(rTop, rs, Math.round(rs / 2)), mat);
    capB.position.y = length;
    g.add(capB);
    return g;
  }

  // Angular falloff used to sculpt features onto a sphere: 1 at the feature's
  // own direction, tapering to 0 by roughly `sigma` radians away. Summing a
  // few dozen of these is how both the face and the heart get their form.
  function featureWeight(nx, ny, nz, dir, sigma) {
    const dot = Math.min(1, Math.max(-1, nx * dir.x + ny * dir.y + nz * dir.z));
    const ang = Math.acos(dot);
    const t = ang / sigma;
    return Math.exp(-t * t);
  }

  function dirOf(x, y, z) {
    return new THREE.Vector3(x, y, z).normalize();
  }

  // ---------------------------------------------------------------------
  // ABOUT — a face in glass
  // ---------------------------------------------------------------------
  // Built by sculpting an ellipsoid rather than modelling a head: a base
  // ellipsoid with a jaw taper, then ~20 signed gaussian features (brow,
  // sockets, nose ridge, lips, chin, temples) pushed in and out along the
  // normal. At this scale the silhouette in profile is what sells it, so
  // the nose, lips and chin carry the strongest amplitudes.
  function buildFaceMarker() {
    const g = new THREE.Group();

    const geo = new THREE.SphereGeometry(1, 128, 96);
    const pos = geo.attributes.position;

    // Semi-axes: narrower than tall, slightly flattened front to back.
    const AX = 0.30, AY = 0.40, AZ = 0.33;

    const features = [
      // Nose, built as a ridge of overlapping bumps from bridge to tip.
      { d: dirOf(0, 0.34, 0.94), s: 0.30, a: 0.010 },
      { d: dirOf(0, 0.20, 1.00), s: 0.26, a: 0.020 },
      { d: dirOf(0, 0.06, 1.04), s: 0.24, a: 0.032 },
      { d: dirOf(0, -0.07, 1.04), s: 0.22, a: 0.038 },
      { d: dirOf(0, -0.17, 0.98), s: 0.18, a: 0.026 },
      // Nostril wings and the shadow under the tip.
      { d: dirOf(0.13, -0.22, 0.95), s: 0.15, a: 0.012 },
      { d: dirOf(-0.13, -0.22, 0.95), s: 0.15, a: 0.012 },
      { d: dirOf(0, -0.26, 0.92), s: 0.13, a: -0.012 },
      // Brow ridge.
      { d: dirOf(0.30, 0.34, 0.88), s: 0.34, a: 0.026 },
      { d: dirOf(-0.30, 0.34, 0.88), s: 0.34, a: 0.026 },
      { d: dirOf(0, 0.32, 0.95), s: 0.22, a: 0.012 },
      // Eye sockets — the deepest negatives on the model; without them the
      // brow and cheek read as one continuous bulge.
      { d: dirOf(0.34, 0.14, 0.86), s: 0.30, a: -0.034 },
      { d: dirOf(-0.34, 0.14, 0.86), s: 0.30, a: -0.034 },
      // Cheekbones, and the hollow beneath them.
      { d: dirOf(0.54, -0.06, 0.74), s: 0.38, a: 0.024 },
      { d: dirOf(-0.54, -0.06, 0.74), s: 0.38, a: 0.024 },
      { d: dirOf(0.52, -0.40, 0.62), s: 0.32, a: -0.018 },
      { d: dirOf(-0.52, -0.40, 0.62), s: 0.32, a: -0.018 },
      // Mouth: upper lip, the line between, lower lip, then the crease.
      { d: dirOf(0, -0.40, 0.88), s: 0.17, a: 0.018 },
      { d: dirOf(0, -0.455, 0.89), s: 0.085, a: -0.016 },
      { d: dirOf(0, -0.52, 0.86), s: 0.15, a: 0.016 },
      { d: dirOf(0, -0.60, 0.80), s: 0.13, a: -0.012 },
      // Chin.
      { d: dirOf(0, -0.74, 0.68), s: 0.26, a: 0.030 },
      // Temples pulled in, cranium pushed out — stops the skull reading
      // as a perfect egg.
      { d: dirOf(0.92, 0.36, 0.14), s: 0.40, a: -0.020 },
      { d: dirOf(-0.92, 0.36, 0.14), s: 0.40, a: -0.020 },
      { d: dirOf(0, 0.58, -0.78), s: 0.55, a: 0.022 },
      { d: dirOf(0, 0.96, 0.10), s: 0.45, a: 0.012 }
    ];

    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const nx = v.x, ny = v.y, nz = v.z; // already unit length on a unit sphere

      let disp = 0;
      for (let f = 0; f < features.length; f++) {
        const ft = features[f];
        disp += ft.a * featureWeight(nx, ny, nz, ft.d, ft.s);
      }

      // Jaw taper — narrow the head below the cheekbones so the chin comes
      // to a point instead of a sphere bottom.
      let taperX = 1, taperZ = 1;
      if (ny < 0) {
        const k = Math.min(1, -ny);
        taperX = 1 - 0.34 * Math.pow(k, 1.4);
        taperZ = 1 - 0.16 * Math.pow(k, 1.8);
      }

      pos.setXYZ(
        i,
        nx * (AX * taperX + disp),
        ny * AY + disp * ny * 0.4,
        nz * (AZ * taperZ + disp)
      );
    }
    geo.computeVertexNormals();

    const faceMat = glassMaterial(0xe9f1f6);
    const face = new THREE.Mesh(geo, faceMat);
    // Presented in a three-quarter turn with a slight upward tilt — the
    // profile reads best from the pillar's approach side.
    face.rotation.y = -0.62;
    face.rotation.z = 0.06;
    face.rotation.x = -0.10;
    face.position.y = 0.06;
    g.add(face);

    // A thin glass collar under the head so it reads as a bust rather than
    // a severed head floating in the air.
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.20, 0.13, 40, 1, true),
      glassMaterial(0xdfe9ef)
    );
    collar.material.side = THREE.DoubleSide;
    collar.position.y = -0.40;
    g.add(collar);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.235, 0.05, 40),
      metalMaterial(0x2f343b)
    );
    plinth.position.y = -0.47;
    g.add(plinth);

    return finishModel(g);
  }

  // ---------------------------------------------------------------------
  // WORK EXPERIENCE — an anatomical heart
  // ---------------------------------------------------------------------
  // Same sculpting technique as the face: an ellipsoid tapered to an apex,
  // with the coronary grooves cut in as negative gaussians. The great
  // vessels are swept tubes. A smaller opaque core sits inside the glass
  // shell so the piece has visible internal structure.
  function buildHeartMarker() {
    const g = new THREE.Group();

    function heartShell(scale, segments) {
      const geo = new THREE.SphereGeometry(1, segments, Math.round(segments * 0.75));
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();

      const grooves = [
        // Interventricular groove — runs diagonally down the front face.
        { d: dirOf(0.30, -0.25, 0.92), s: 0.30, a: -0.030 },
        { d: dirOf(0.20, -0.55, 0.80), s: 0.26, a: -0.026 },
        // Coronary sulcus — the horizontal band where atria meet ventricles.
        { d: dirOf(0.85, 0.42, 0.30), s: 0.28, a: -0.024 },
        { d: dirOf(-0.85, 0.40, 0.25), s: 0.28, a: -0.024 },
        { d: dirOf(0, 0.46, -0.88), s: 0.30, a: -0.022 },
        // Right ventricle bulges forward and left; left ventricle is the
        // heavier mass behind it.
        { d: dirOf(0.55, -0.10, 0.82), s: 0.45, a: 0.022 },
        { d: dirOf(-0.72, -0.18, -0.30), s: 0.50, a: 0.030 },
        // Atrial appendages at the top.
        { d: dirOf(0.62, 0.70, 0.35), s: 0.32, a: 0.020 },
        { d: dirOf(-0.60, 0.72, 0.20), s: 0.32, a: 0.018 }
      ];

      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const nx = v.x, ny = v.y, nz = v.z;

        let disp = 0;
        for (let f = 0; f < grooves.length; f++) {
          const gr = grooves[f];
          disp += gr.a * featureWeight(nx, ny, nz, gr.d, gr.s);
        }

        // Radial taper: full width through the middle, drawn to a point at
        // the apex. The squared term is what makes the apex a cone rather
        // than a hemisphere.
        let rs;
        if (ny >= 0) {
          rs = 1.0 + 0.06 * (1 - ny);
        } else {
          const k = -ny;
          rs = 1.06 * (1 - 0.94 * k * k);
        }

        // The apex leans forward and to the anatomical left, which is what
        // stops it reading as a symmetrical cartoon heart.
        const lean = ny < 0 ? ny * ny : 0;
        const leanX = -0.13 * lean;
        const leanZ = 0.055 * lean;

        pos.setXYZ(
          i,
          (nx * rs * 0.42 + disp * nx + leanX) * scale,
          (ny * 0.46 + disp * ny * 0.3) * scale,
          (nz * rs * 0.37 + disp * nz + leanZ) * scale
        );
      }
      geo.computeVertexNormals();
      return geo;
    }

    const shellMat = glassMaterial(0xe4eef4);
    const shell = new THREE.Mesh(heartShell(1.0, 112), shellMat);
    g.add(shell);

    // The opaque inner mass, sitting proud of the glass on the left side —
    // the same read as a clear casing over a solid component.
    const coreMat = ceramicMaterial(0xf7f8fa);
    const core = new THREE.Mesh(heartShell(0.80, 72), coreMat);
    core.position.set(-0.035, -0.01, -0.01);
    g.add(core);

    // --- Great vessels -------------------------------------------------
    // Each is a swept tube with a machined lip at the cut end, so they read
    // as sectioned rather than simply stopping.
    const vesselMat = glassMaterial(0xdfeaf1);
    const lipMat = metalMaterial(0x40454d);

    function vessel(points, radius, taper) {
      const curve = new THREE.CatmullRomCurve3(points.map(function (p) {
        return new THREE.Vector3(p[0], p[1], p[2]);
      }));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, radius, 18, false),
        vesselMat
      );
      g.add(tube);

      const end = curve.getPoint(1);
      const tangent = curve.getTangent(1);
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(radius * (taper || 1), radius * 0.16, 10, 24),
        lipMat
      );
      lip.position.copy(end);
      lip.lookAt(end.clone().add(tangent));
      g.add(lip);
    }

    // Aorta — the big one, arching up and over toward the back.
    vessel([[0.01, 0.30, 0.00], [0.03, 0.44, -0.02], [0.02, 0.56, -0.08],
            [-0.07, 0.62, -0.16], [-0.17, 0.58, -0.22]], 0.070);
    // Pulmonary trunk, crossing in front of the aorta.
    vessel([[-0.10, 0.28, 0.10], [-0.14, 0.42, 0.12], [-0.20, 0.52, 0.08],
            [-0.29, 0.56, 0.00]], 0.060);
    // Superior vena cava.
    vessel([[0.20, 0.26, -0.04], [0.23, 0.40, -0.05], [0.25, 0.54, -0.04]], 0.046);
    // Inferior vena cava, dropping away below.
    vessel([[0.19, 0.06, -0.10], [0.24, -0.06, -0.14], [0.27, -0.16, -0.16]], 0.044);
    // A pair of pulmonary veins entering from behind.
    vessel([[-0.18, 0.22, -0.20], [-0.26, 0.28, -0.30], [-0.33, 0.30, -0.38]], 0.032);
    vessel([[0.10, 0.20, -0.24], [0.15, 0.26, -0.34], [0.19, 0.27, -0.42]], 0.030);

    // Coronary arteries tracing the grooves — thin, warm, and the only
    // emissive element, so they catch the bloom pass and read as lit
    // filament against the glass.
    const coronaryMat = sculptureMaterial({
      color: 0xd8613f, roughness: 0.35, metalness: 0.1,
      emissive: 0xc2452a, emissiveIntensity: 0.55, envMapIntensity: 1.0
    });
    function coronary(points, radius) {
      const curve = new THREE.CatmullRomCurve3(points.map(function (p) {
        return new THREE.Vector3(p[0], p[1], p[2]);
      }));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 10, false), coronaryMat));
    }
    coronary([[0.14, 0.26, 0.34], [0.20, 0.10, 0.38], [0.17, -0.08, 0.36],
              [0.08, -0.24, 0.30], [-0.02, -0.34, 0.20]], 0.011);
    coronary([[-0.22, 0.24, 0.26], [-0.30, 0.10, 0.22], [-0.34, -0.06, 0.14]], 0.009);

    g.position.y = 0.04;
    g.rotation.y = -0.45;
    g.rotation.z = 0.12;

    return finishModel(g);
  }

  // ---------------------------------------------------------------------
  // PROJECTS — a robotic hand holding a flower
  // ---------------------------------------------------------------------
  // Local frame: palm centred on the origin, fingers running toward +Y,
  // back of the hand facing +Z, thumb on the +X side. Every finger is built
  // from the knuckle outward, each phalanx parented to the previous one, so
  // posing is a matter of setting three rotations per finger rather than
  // computing positions by hand.
  function buildHandMarker() {
    const g = new THREE.Group();
    const hand = new THREE.Group();
    g.add(hand);

    const shellMat = ceramicMaterial(0xf2f3f5);
    const jointMat = metalMaterial(0x41464e);
    const pinMat = metalMaterial(0x8c9198);

    // --- Palm ----------------------------------------------------------
    const palmGeo = new THREE.SphereGeometry(1, 40, 28);
    const ppos = palmGeo.attributes.position;
    for (let i = 0; i < ppos.count; i++) {
      const nx = ppos.getX(i), ny = ppos.getY(i), nz = ppos.getZ(i);
      // Wider at the knuckles than at the wrist, and thinner at the edges
      // than through the middle — a slab would read as a block of soap.
      const widen = 0.175 + 0.045 * Math.max(0, ny);
      const thin = 0.072 * (1 - 0.35 * nx * nx);
      ppos.setXYZ(i, nx * widen, ny * 0.205, nz * thin);
    }
    palmGeo.computeVertexNormals();
    const palm = new THREE.Mesh(palmGeo, shellMat);
    hand.add(palm);

    // Knuckle housings — the row of pivot blocks along the top of the palm.
    const FINGERS = [
      { x: 0.118, len: 0.290, splay: -0.10, curl: [-0.30, -0.42, -0.30] }, // index
      { x: 0.030, len: 0.320, splay: -0.02, curl: [-0.24, -0.38, -0.28] }, // middle
      { x: -0.058, len: 0.292, splay: 0.05, curl: [-0.28, -0.44, -0.32] }, // ring
      { x: -0.140, len: 0.232, splay: 0.14, curl: [-0.36, -0.50, -0.34] }  // little
    ];
    const PHALANX = [0.42, 0.33, 0.25]; // proximal / middle / distal share of length

    function buildFinger(spec) {
      const root = new THREE.Group();
      root.position.set(spec.x, 0.196, 0);
      root.rotation.z = spec.splay;

      let parent = root;
      let r = 0.036;
      for (let j = 0; j < 3; j++) {
        const seg = new THREE.Group();
        seg.rotation.x = spec.curl[j];
        parent.add(seg);

        const len = spec.len * PHALANX[j];
        const rTop = r * 0.86;
        seg.add(roundedSegment(r, rTop, len, shellMat, 18));

        // Pivot hardware at the base of every phalanx: a dark collar with a
        // bright pin through it, echoing the reference's visible joints.
        const collar = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.02, r * 0.26, 10, 22), jointMat
        );
        collar.rotation.y = Math.PI / 2;
        seg.add(collar);

        const pin = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.30, r * 0.30, r * 2.5, 14), pinMat
        );
        pin.rotation.z = Math.PI / 2;
        seg.add(pin);

        const next = new THREE.Group();
        next.position.y = len;
        seg.add(next);
        parent = next;
        r = rTop;
      }
      return root;
    }

    FINGERS.forEach(function (spec) {
      hand.add(buildFinger(spec));
      // Knuckle block sunk into the top edge of the palm.
      const block = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.042, 0.062, 18), jointMat
      );
      block.rotation.z = Math.PI / 2;
      block.position.set(spec.x, 0.192, 0);
      hand.add(block);
    });

    // --- Thumb ---------------------------------------------------------
    // Swung out and rotated toward the palm so it opposes the fingers.
    const thumb = new THREE.Group();
    thumb.position.set(0.170, -0.010, 0.020);
    thumb.rotation.z = -0.95;
    thumb.rotation.y = -0.55;
    thumb.rotation.x = -0.30;
    hand.add(thumb);

    let tParent = thumb;
    let tr = 0.044;
    const THUMB_SEGS = [0.125, 0.100, 0.076];
    for (let j = 0; j < 3; j++) {
      const seg = new THREE.Group();
      seg.rotation.x = j === 0 ? -0.18 : -0.40;
      tParent.add(seg);
      const rTop = tr * 0.87;
      seg.add(roundedSegment(tr, rTop, THUMB_SEGS[j], shellMat, 18));
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(tr * 1.02, tr * 0.26, 10, 22), jointMat
      );
      collar.rotation.y = Math.PI / 2;
      seg.add(collar);
      const next = new THREE.Group();
      next.position.y = THUMB_SEGS[j];
      seg.add(next);
      tParent = next;
      tr = rTop;
    }

    // --- Wrist and forearm ---------------------------------------------
    const wrist = new THREE.Mesh(
      new THREE.CylinderGeometry(0.098, 0.088, 0.075, 30), jointMat
    );
    wrist.position.y = -0.212;
    hand.add(wrist);

    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.086, 0.079, 0.40, 30, 1, true), shellMat
    );
    forearm.material.side = THREE.DoubleSide;
    forearm.position.y = -0.450;
    hand.add(forearm);

    // Two machined bands around the forearm.
    [-0.33, -0.60].forEach(function (y) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.086, 0.010, 10, 34), jointMat
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      hand.add(band);
    });

    // Loose brass wiring spilling out of the wrist — the detail that makes
    // the reference read as a cutaway prosthetic rather than a mannequin.
    const wireMat = sculptureMaterial({
      color: 0xc9a227, roughness: 0.28, metalness: 1.0, envMapIntensity: 2.0
    });
    for (let w = 0; w < 9; w++) {
      const a = (w / 9) * Math.PI * 2;
      const rr = 0.070 + Math.random() * 0.022;
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        const wobble = Math.sin(a * 3 + t * 6.0) * 0.024;
        pts.push(new THREE.Vector3(
          Math.cos(a) * rr * (1 + t * 0.35) + wobble,
          -0.24 - t * 0.42,
          Math.sin(a) * rr * (1 + t * 0.35) + wobble * 0.6
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      hand.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 26, 0.0055, 7, false), wireMat));
    }

    // --- The flower ------------------------------------------------------
    // Rests across the gap between index and middle finger, angled so the
    // bloom sits above the fingertips and catches the key light.
    const flower = new THREE.Group();
    hand.add(flower);

    const stemMat = sculptureMaterial({
      color: 0x6f8f52, roughness: 0.55, metalness: 0.0, clearcoat: 0.4, envMapIntensity: 0.9
    });
    const stemPts = [
      new THREE.Vector3(0.150, 0.130, 0.090),
      new THREE.Vector3(0.130, 0.280, 0.070),
      new THREE.Vector3(0.108, 0.430, 0.052),
      new THREE.Vector3(0.094, 0.570, 0.040),
      new THREE.Vector3(0.088, 0.690, 0.034)
    ];
    const stemCurve = new THREE.CatmullRomCurve3(stemPts);
    flower.add(new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 40, 0.0075, 10, false), stemMat));

    // Leaves: a pointed lens outline, given a saddle curve so each one has
    // a spine and cups slightly — a flat plane would read as paper.
    function buildLeaf(length, width) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(width, length * 0.28, width * 0.72, length * 0.78, 0, length);
      shape.bezierCurveTo(-width * 0.72, length * 0.78, -width, length * 0.28, 0, 0);
      const geo = new THREE.ShapeGeometry(shape, 18);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        const t = y / length;
        // Cup across the width, droop along the length.
        p.setZ(i, -Math.abs(x) * 0.55 - Math.sin(t * Math.PI) * length * 0.10);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const leafMat = sculptureMaterial({
      color: 0x5f8a4a, roughness: 0.5, metalness: 0.0, clearcoat: 0.35,
      envMapIntensity: 0.9, side: THREE.DoubleSide
    });
    [
      { t: 0.30, rotY: 0.6, rotZ: -1.05, s: 1.0 },
      { t: 0.46, rotY: -2.3, rotZ: 1.15, s: 0.86 },
      { t: 0.62, rotY: 1.9, rotZ: -0.95, s: 0.72 }
    ].forEach(function (L) {
      const leaf = new THREE.Mesh(buildLeaf(0.17, 0.052), leafMat);
      const at = stemCurve.getPoint(L.t);
      leaf.position.copy(at);
      leaf.rotation.set(0.25, L.rotY, L.rotZ);
      leaf.scale.setScalar(L.s);
      flower.add(leaf);
    });

    // Bloom: six petals swept out from the head, each cupped inward.
    const head = new THREE.Group();
    head.position.copy(stemCurve.getPoint(1));
    head.rotation.set(-0.42, 0.3, 0.12);
    flower.add(head);

    function buildPetal(length, width) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(width * 1.15, length * 0.34, width * 0.95, length * 0.84, 0, length);
      shape.bezierCurveTo(-width * 0.95, length * 0.84, -width * 1.15, length * 0.34, 0, 0);
      const geo = new THREE.ShapeGeometry(shape, 16);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        const t = y / length;
        // Cupped at the base, flaring open and curling back at the tip.
        p.setZ(i, -Math.abs(x) * (0.9 - t * 0.55) + Math.pow(t, 2.2) * length * 0.42);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const petalMat = sculptureMaterial({
      color: 0xfbfaf6, roughness: 0.34, metalness: 0.0, clearcoat: 0.7,
      clearcoatRoughness: 0.2, envMapIntensity: 1.5, side: THREE.DoubleSide
    });
    const PETALS = 6;
    for (let i = 0; i < PETALS; i++) {
      const petal = new THREE.Mesh(buildPetal(0.105, 0.042), petalMat);
      const a = (i / PETALS) * Math.PI * 2;
      petal.rotation.y = a;
      petal.rotateX(-1.15 - Math.random() * 0.12); // lay the petal outward from the axis
      petal.position.y = 0.004;
      head.add(petal);
    }

    // Stamens: a ring of fine filaments with pollen tips. Emissive, so they
    // stay visible as a warm point inside the white bloom.
    const stamenMat = sculptureMaterial({
      color: 0xe8c45a, roughness: 0.45, emissive: 0xd9a52c, emissiveIntensity: 0.4
    });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const rr = 0.010 + (i % 2) * 0.005;
      const fil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0016, 0.0016, 0.030, 6), stamenMat
      );
      fil.position.set(Math.cos(a) * rr, 0.015, Math.sin(a) * rr);
      fil.rotation.z = -Math.cos(a) * 0.4;
      fil.rotation.x = Math.sin(a) * 0.4;
      head.add(fil);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 8, 6), stamenMat);
      tip.position.set(Math.cos(a) * rr * 1.5, 0.030, Math.sin(a) * rr * 1.5);
      head.add(tip);
    }

    // Present the whole assembly tipped back and turned, the way the
    // reference photograph frames it.
    hand.rotation.set(-0.30, 0.55, 0.22);
    hand.position.y = 0.12;

    return finishModel(g);
  }

  function buildMarker(node) {
    let model, scale;
    if (node.markerType === "heart") { model = buildHeartMarker(); scale = 1.15; }
    else if (node.markerType === "hand") { model = buildHandMarker(); scale = 1.05; }
    else { model = buildFaceMarker(); scale = 1.15; }

    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.scale.setScalar(scale);
    wrapper.userData.materials = model.userData.materials;
    return wrapper;
  }

  // ---------------------------------------------------------------------
  // Node placement — three monoliths evenly spaced around the hub, seated
  // in their flattened clearings
  // ---------------------------------------------------------------------

  function buildNodes() {
    const nodes = PORTFOLIO_DATA.nodes;
    const rockGrainTex = makeNoiseTexture(256, 1.6, 150);
    rockGrainTex.repeat.set(3, 2);

    nodes.forEach(function (node) {
      const x = node._x, z = node._z, angle = node._angle;
      const groundY = terrainHeight(x, z);

      const group = new THREE.Group();
      group.position.set(x, groundY, z);
      group.rotation.y = -angle + Math.PI / 2;
      group.userData.nodeId = node.id;

      const model = buildMonolith(node.color, node, rockGrainTex);
      group.add(model);

      group.updateMatrixWorld(true);

      const bounds = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      bounds.getSize(size);
      bounds.getCenter(center);
      const hitBox = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(size.x, 0.6) * 1.2, Math.max(size.y, 0.6) * 1.05, Math.max(size.z, 0.6) * 1.2),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitBox.position.copy(group.worldToLocal(center.clone()));
      hitBox.userData.nodeId = node.id;
      group.add(hitBox);

      const marker = buildMarker(node);
      marker.position.set(0, model.userData.height + 0.78, 0);
      group.add(marker);
      // Cached so the float in animate() has a baseline to oscillate around
      // instead of drifting.
      node.markerBaseY = marker.position.y;

      const placard = buildPlacard(node);
      group.add(placard);

      const materials = [model.userData.stoneMat]
        .concat(marker.userData.materials)
        .concat(placard.userData.materials);
      node.materials = materials;
      node.wireMat = model.userData.wireMat;
      node.wireAccent = model.userData.wireMat.color.clone();
      node.glowLight = model.userData.glowLight;
      node.glowBaseIntensity = model.userData.glowLight.intensity;
      node.plateMat = placard.userData.plateMat;
      node.hotspotPosition = marker.position;
      node.markerGroup = marker;
      node.markerPhase = hashSeed(node.id);

      nodeGroups.push(group);

      node.position = new THREE.Vector3(x, groundY, z);
      node.group = group;
      scene.add(group);
    });
  }

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
  }

  const CLICK_MOVE_THRESHOLD = 6; // px
  const CLICK_TIME_THRESHOLD = 500; // ms
  let downX = 0, downY = 0, downTime = 0, pointerDownOnCanvas = false;

  function onPointerDown(e) {
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
    pointerDownOnCanvas = true;
  }

  function onPointerCancel() {
    pointerDownOnCanvas = false;
  }

  function onPointerMove(e) {
    if (!terrainMesh) return;
    const rect = canvas.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ly = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: lx, y: ly }, camera);
    const hits = raycaster.intersectObject(terrainMesh);
    if (hits.length) {
      lantern.position.set(hits[0].point.x, hits[0].point.y + 1.4, hits[0].point.z);
      lantern.userData.targetIntensity = reducedMotion ? 0 : 0.9;
    }
  }

  function onPointerUp(e) {
    if (!pointerDownOnCanvas) return;
    pointerDownOnCanvas = false;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = performance.now() - downTime;
    if (dist > CLICK_MOVE_THRESHOLD || dt > CLICK_TIME_THRESHOLD) return; // was a drag, not a click

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(nodeGroups, true);
    if (hits.length && window.selectPortfolioNode) {
      window.selectPortfolioNode(resolveNodeId(hits[0].object));
    }
  }

  function resolveNodeId(object) {
    let o = object;
    while (o) {
      if (o.userData && o.userData.nodeId) return o.userData.nodeId;
      o = o.parent;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Click feedback: an expanding ring at the clicked monolith's marker
  // ---------------------------------------------------------------------

  const pings = [];
  const PING_DURATION = 700;

  function spawnPing(position, colorHex) {
    const geo = new THREE.RingGeometry(0.01, 0.16, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(position);
    scene.add(ring);
    pings.push({ mesh: ring, start: performance.now() });
  }

  function updatePings() {
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const t = Math.min((performance.now() - p.start) / PING_DURATION, 1);
      if (reducedMotion || t >= 1) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        pings.splice(i, 1);
        continue;
      }
      p.mesh.lookAt(camera.position);
      const scale = 1 + t * 9;
      p.mesh.scale.set(scale, scale, scale);
      p.mesh.material.opacity = 0.9 * (1 - t);
    }
  }

  function focusNode(id) {
    activeNodeId = id;
    startFlight();
    const node = PORTFOLIO_DATA.nodes.find(function (n) { return n.id === id; });
    if (!node || !node.position) return;

    const dir = new THREE.Vector3(node.position.x, 0, node.position.z).normalize();
    cameraTarget.copy(node.position).addScaledVector(dir, 5.2);
    cameraTarget.y = node.position.y + 3.1;
    lookAtTarget.copy(node.position);
    lookAtTarget.y = node.position.y + 1.5;

    node.group.userData.popStart = performance.now();
    if (!reducedMotion) {
      const worldPos = node.hotspotPosition.clone();
      node.group.localToWorld(worldPos);
      spawnPing(worldPos, node.color);
      if (node.wireMat) node.wireMat.userData.flashStart = performance.now();
    }
  }

  function resetFocus() {
    activeNodeId = null;
    startFlight();
    cameraTarget.copy(defaultCamPos);
    lookAtTarget.copy(defaultLookAt);
  }

  window.focusPortfolioNode = focusNode;
  window.resetPortfolioFocus = resetFocus;

  // ---------------------------------------------------------------------
  // Camera flight: eased, duration-based (not frame-rate-dependent lerp)
  // ---------------------------------------------------------------------

  const FLIGHT_DURATION_DEFAULT = 900; // ms
  let currentFlightDuration = FLIGHT_DURATION_DEFAULT;
  const flightStartCam = new THREE.Vector3();
  const flightStartLook = new THREE.Vector3();
  let flightStartTime = 0;

  function startFlight(duration) {
    flightStartCam.copy(camera.position);
    flightStartLook.copy(controls.target);
    flightStartTime = performance.now();
    currentFlightDuration = duration || FLIGHT_DURATION_DEFAULT;
    flying = true;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  const FLASH_DURATION = 650; // ms
  function flashEnvelope(t) {
    if (t < 0.15) return t / 0.15;
    if (t < 0.55) return 1;
    return Math.max(0, 1 - (t - 0.55) / 0.45);
  }

  // ---------------------------------------------------------------------
  // Blueprint-to-real intro
  // ---------------------------------------------------------------------
  // The scene is always fully built and lit; the intro only suppresses it.
  // At blueprint = 1 the fog is driven white and dense enough to swallow
  // the world, the sky and clouds are faded out, the lights are pulled down
  // and the monoliths' wireframe twins — the same meshes the click X-ray
  // flash uses — are held at full opacity. Easing that one value to 0 is
  // what "renders" the scene in.

  function startIntro() {
    introActive = true;
    blueprint = 1;
    introStart = performance.now();

    // Open on a straight-on elevation, the way a drawing sheet would show
    // it, then fly out to the three-quarter overview as it renders in.
    camera.position.set(0, 4.6, 34);
    controls.target.set(0, 2.6, 0);
    controls.autoRotate = false;

    startFlight(INTRO_SHEET_MS + INTRO_RENDER_MS);
    cameraTarget.copy(defaultCamPos);
    lookAtTarget.copy(defaultLookAt);
  }

  function updateIntro() {
    const elapsed = performance.now() - introStart;
    if (elapsed < INTRO_SHEET_MS) {
      blueprint = 1;
      return;
    }
    const t = Math.min((elapsed - INTRO_SHEET_MS) / INTRO_RENDER_MS, 1);
    blueprint = 1 - easeInOutCubic(t);
    if (t >= 1) endIntro();
  }

  function endIntro() {
    if (!introActive) return;
    introActive = false;
    blueprint = 0;
    document.dispatchEvent(new CustomEvent("bench-intro-done"));
  }

  // Called by the skip control, by deep links, and by reduced-motion.
  window.skipBenchIntro = function () {
    if (!introActive) return;
    introActive = false;
    blueprint = 0;
    flying = false;
    camera.position.copy(defaultCamPos);
    controls.target.copy(defaultLookAt);
    document.dispatchEvent(new CustomEvent("bench-intro-done"));
  };

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------

  function animate(t) {
    requestAnimationFrame(animate);
    const time = (t || 0) * 0.001;

    if (introActive) updateIntro();
    const solid = 1 - blueprint; // how "rendered" the world currently is

    // Day/night blend — a slow, deliberate transition, not an instant swap.
    themeBlend += (themeTarget - themeBlend) * (reducedMotion ? 1 : 0.02);

    grassUniforms.uTime.value = time;

    updateHub(time);

    if (hub.userData.glowMats) {
      hub.userData.glowMats.forEach(function (gm) {
        // Rungs and gear arcs are excluded here on purpose — updateHub owns
        // those, and this would stamp out the pulse every frame.
        gm.mat.emissiveIntensity = gm.base * (1 + themeBlend * 1.6);
      });
    }

    PORTFOLIO_DATA.nodes.forEach(function (node) {
      if (node.markerGroup && !reducedMotion) {
        // A slow turntable plus a gentle float. The old version pulsed the
        // scale, which on a detailed model reads as a bug rather than an
        // invitation — a bob sells "on display" much better.
        node.markerGroup.rotation.y += 0.0045;
        node.markerGroup.position.y = node.markerBaseY +
          Math.sin(time * 0.75 + node.markerPhase) * 0.045;
      }

      const isFocused = !activeNodeId || activeNodeId === node.id;
      const target = isFocused ? 1 : 0.28;
      const rate = reducedMotion ? 1 : 0.12;
      node.materials.forEach(function (mat) {
        mat.opacity += (target - mat.opacity) * rate;
        if (blueprint > 0) mat.opacity *= solid;
      });
      if (node.glowLight) {
        const nightBoost = 1 + themeBlend * 1.8;
        const glowTarget = (isFocused ? node.glowBaseIntensity : node.glowBaseIntensity * 0.15) * nightBoost;
        node.glowLight.intensity += (glowTarget - node.glowLight.intensity) * rate;
      }
      if (node.plateMat) {
        const signTarget = 0.08 + themeBlend * 1.15;
        node.plateMat.emissiveIntensity += (signTarget - node.plateMat.emissiveIntensity) * rate;
      }

      const popStart = node.group.userData.popStart;
      if (popStart !== undefined && !reducedMotion) {
        const elapsed = performance.now() - popStart;
        const dur = 420;
        if (elapsed < dur) {
          const bt = elapsed / dur;
          const bump = Math.sin(bt * Math.PI) * 0.1;
          node.group.scale.setScalar(1 + bump);
        } else {
          node.group.scale.setScalar(1);
          node.group.userData.popStart = undefined;
        }
      }

      if (blueprint > 0 && node.wireMat && node.wireMat.userData.flashStart === undefined) {
        // Linework stays crisp through the hold, then fades as the solid
        // surfaces come up underneath it. It also shifts from drafting ink
        // toward the node's own accent as the scene takes over, so the
        // handover to the normal click-flash colour is already done by the
        // time the intro ends.
        node.wireMat.opacity = Math.min(1, blueprint * 1.35) * 0.95;
        node.wireMat.color.copy(node.wireAccent).lerp(INK, blueprint);
      }
      if (node.wireMat && node.wireMat.userData.flashStart !== undefined) {
        const fElapsed = performance.now() - node.wireMat.userData.flashStart;
        if (fElapsed < FLASH_DURATION) {
          node.wireMat.opacity = 0.85 * flashEnvelope(fElapsed / FLASH_DURATION);
        } else {
          node.wireMat.opacity = 0;
          node.wireMat.userData.flashStart = undefined;
        }
      }
    });

    if (lantern) {
      lantern.intensity += (lantern.userData.targetIntensity - lantern.intensity) * 0.08;
    }

    // Apply the day/night blend to lights, sky, fog and stars.
    if (ambientLight) {
      tmpColor.copy(AMBIENT_DAY).lerp(AMBIENT_NIGHT, themeBlend);
      ambientLight.color.copy(tmpColor);
      ambientLight.intensity = (0.09 - themeBlend * 0.045) * solid * benchTune.fill;
    }
    if (hemiLight) hemiLight.intensity = (0.28 - themeBlend * 0.19) * solid * benchTune.fill;
    if (keyLight) {
      tmpColor.copy(KEY_DAY).lerp(KEY_NIGHT, themeBlend);
      keyLight.color.copy(tmpColor);
      // Night is moonlight, not darkness — keep enough key to hold shadows.
      keyLight.intensity = (0.95 - themeBlend * 0.74) * solid * benchTune.key;
    }
    if (rimLight) rimLight.intensity = (0.30 - themeBlend * 0.21) * solid * benchTune.key;
    if (rimLight2) rimLight2.intensity = (0.16 + themeBlend * 0.22) * solid * benchTune.fill;
    // Exposure drops at night so the tone mapper does the work rather than
    // every light being dimmed independently.
    renderer.toneMappingExposure = (0.78 - themeBlend * 0.20) * benchTune.exposure;
    if (bloomPass) bloomPass.strength = (0.30 + themeBlend * 0.18) * benchTune.bloom;
    if (scene.fog) {
      tmpColor.copy(FOG_DAY).lerp(FOG_NIGHT, themeBlend);
      if (blueprint > 0) tmpColor.lerp(PAPER, blueprint);
      scene.fog.color.copy(tmpColor);
      scene.fog.density = (0.0095 + themeBlend * 0.004) + blueprint * 0.20;
      scene.background.copy(tmpColor);
    }
    if (sky) {
      const colAttr = sky.geometry.attributes.color;
      const day = sky.userData.dayColors, night = sky.userData.nightColors;
      for (let i = 0; i < colAttr.count; i++) {
        colAttr.array[i * 3] = day[i * 3] + (night[i * 3] - day[i * 3]) * themeBlend;
        colAttr.array[i * 3 + 1] = day[i * 3 + 1] + (night[i * 3 + 1] - day[i * 3 + 1]) * themeBlend;
        colAttr.array[i * 3 + 2] = day[i * 3 + 2] + (night[i * 3 + 2] - day[i * 3 + 2]) * themeBlend;
      }
      colAttr.needsUpdate = true;
    }
    if (stars) stars.material.opacity = themeBlend * 0.85 * solid;
    if (sky) sky.material.opacity = solid;

    if (!reducedMotion) particleUniforms.uTime.value = time;

    // --- Cloud sea, sun and shafts ---------------------------------------
    // The deck drifts by scrolling each layer's UVs at a different rate;
    // parallax between the layers is what reads as depth. The puffs bob
    // rather than translate, so the field never visibly repeats.
    if (cloudDeck && !reducedMotion) {
      cloudDeck.userData.planes.forEach(function (plane) {
        plane.userData.tex.offset.x += plane.userData.drift * 0.01;
        plane.userData.tex.offset.y += plane.userData.drift * 0.004;
      });
      cloudDeck.userData.puffs.forEach(function (puff, i) {
        puff.position.y += Math.sin(time * 0.22 + puff.userData.phase) * 0.004;
        puff.position.x = puff.userData.baseX + Math.sin(time * 0.06 + puff.userData.phase) * 2.2;
        puff.position.z = puff.userData.baseZ + Math.cos(time * 0.05 + puff.userData.phase) * 2.0;
      });
    }
    if (cloudDeck) {
      // Clouds are lit by the sun, so they dim with the day/night blend.
      const cloudDim = 1 - themeBlend * 0.62;
      cloudDeck.userData.planes.forEach(function (plane, i) {
        plane.material.opacity = CLOUD_LAYER_OPACITY[i] * cloudDim * solid;
      });
      if (blueprint > 0) {
        cloudDeck.userData.puffs.forEach(function (puff) {
          puff.material.opacity = puff.userData.baseOpacity * solid;
        });
      }
    }

    if (sunDisc) {
      // Sun sinks and cools toward night instead of simply switching off.
      const dim = (1 - themeBlend * 0.94) * solid * benchTune.sun;
      sunDisc.userData.core.material.opacity = dim;
      sunDisc.userData.halo.material.opacity = 0.28 * dim;
      const breathe = reducedMotion ? 1 : 1 + Math.sin(time * 0.5) * 0.03;
      sunDisc.userData.halo.scale.set(30 * breathe, 30 * breathe, 1);
    }

    if (godRays) {
      // Turn the whole fan to face the camera so the shafts always read
      // edge-on, then breathe each blade independently.
      godRays.lookAt(camera.position);
      const rayDim = (1 - themeBlend * 0.9) * solid * benchTune.sun;
      godRays.children.forEach(function (shaft) {
        const u = shaft.userData;
        const puls = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(time * u.speed + u.phase);
        shaft.material.opacity = u.baseOpacity * puls * rayDim;
      });
    }

    updatePings();

    controls.autoRotate = !activeNodeId && !flying && !reducedMotion && !userInteracted;

    if (flying) {
      const elapsed = performance.now() - flightStartTime;
      const t01 = Math.min(elapsed / currentFlightDuration, 1);
      const eased = reducedMotion ? 1 : easeInOutCubic(t01);
      camera.position.lerpVectors(flightStartCam, cameraTarget, eased);
      controls.target.lerpVectors(flightStartLook, lookAtTarget, eased);
      if (t01 >= 1) {
        camera.position.copy(cameraTarget);
        controls.target.copy(lookAtTarget);
        flying = false;
      }
    }
    controls.update();

    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
    document.dispatchEvent(new CustomEvent("bench-unavailable"));
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
