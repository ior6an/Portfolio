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
  let ambientLight, keyLight, rimLight, rimLight2;
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

  // Grass field tunables — GRASS_BLADE_HEIGHT is the main "blade length"
  // knob; each blade also gets random per-instance variation around it.
  const GRASS_BLADE_HEIGHT = 0.76; // world units, average blade length
  const GRASS_BLADE_HEIGHT_VARIANCE = 0.55; // +/- fraction, randomized per blade
  const GRASS_BLADE_WIDTH = 0.025;
  const GRASS_BLADE_COUNT = 900000;
  const GRASS_FIELD_RADIUS = 48; // grass grows within this radius of the hub
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
  const FOG_DAY = new THREE.Color(0xcfe6ea), FOG_NIGHT = new THREE.Color(0x151b30);
  const tmpColor = new THREE.Color();

  function init() {
    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xcfe6ea);
      scene.fog = new THREE.FogExp2(0xcfe6ea, 0.02);

      camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 220);

      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);

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
      sky = buildSky();
      stars = buildStars();
      terrainMesh = buildTerrain();
      buildTrees();
      buildGrass();
      buildParticles();
      hub = buildHub();
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

      // Open on a close-up of the hub, then pull back to the full overview
      // — one deliberate camera move instead of any overlay/text intro.
      if (reducedMotion) {
        camera.position.copy(defaultCamPos);
        controls.target.copy(defaultLookAt);
      } else {
        camera.position.set(0, hub.position.y + 2.1, 5.2);
        controls.target.set(0, hub.position.y + 2, 0);
      }

      window.addEventListener("resize", onResize);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);

      requestAnimationFrame(animate);
      document.dispatchEvent(new CustomEvent("bench-ready"));

      if (!reducedMotion) {
        startFlight(2400);
        cameraTarget.copy(defaultCamPos);
        lookAtTarget.copy(defaultLookAt);
      }
    } catch (err) {
      console.error("WebGL scene failed to start:", err);
      document.dispatchEvent(new CustomEvent("bench-unavailable"));
    }
  }

  // ---------------------------------------------------------------------
  // Lighting, sky, ground, trees
  // ---------------------------------------------------------------------

  function addLights() {
    ambientLight = new THREE.AmbientLight(AMBIENT_DAY.getHex(), 0.95);
    scene.add(ambientLight);

    keyLight = new THREE.DirectionalLight(KEY_DAY.getHex(), 0.85);
    keyLight.position.set(8, 20, 10);
    scene.add(keyLight);

    rimLight = new THREE.PointLight(0xe8862b, 0.22, 60);
    rimLight.position.set(-14, 9, -9);
    scene.add(rimLight);

    rimLight2 = new THREE.PointLight(0x33d9c7, 0.18, 60);
    rimLight2.position.set(11, 7, 11);
    scene.add(rimLight2);
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
    const dayTop = new THREE.Color(0x7fbde6), dayBottom = new THREE.Color(0xeef6f4);
    const nightTop = new THREE.Color(0x0c1220), nightBottom = new THREE.Color(0x232d4c);

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const t = Math.min(Math.max((y / 130 + 1) / 2, 0), 1);
      const e = Math.pow(t, 0.55);
      tmpColor.copy(dayBottom).lerp(dayTop, e);
      dayColors[i * 3] = tmpColor.r; dayColors[i * 3 + 1] = tmpColor.g; dayColors[i * 3 + 2] = tmpColor.b;
      tmpColor.copy(nightBottom).lerp(nightTop, e);
      nightColors[i * 3] = tmpColor.r; nightColors[i * 3 + 1] = tmpColor.g; nightColors[i * 3 + 2] = tmpColor.b;
    }

    const colors = new Float32Array(count * 3);
    colors.set(dayColors);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const cloudTex = makeNoiseTexture(256, 11, 118);
    cloudTex.repeat.set(2, 1);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, map: cloudTex, side: THREE.BackSide, fog: false, depthWrite: false
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

    for (let i = 0; i < count; i++) {
      // mesh.rotation.x = -90° maps local (x, y) -> world (x, -y) for this
      // plane, so the height at world Z must be sampled at local Y = -Z.
      const h = terrainHeight(pos.getX(i), -pos.getY(i));
      heights[i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }

    const range = Math.max(maxH - minH, 0.0001);
    const low = new THREE.Color(0xdfe2e6); // shaded grass / dirt in hollows
    const high = new THREE.Color(0xdfe2e6); // sunlit grass on the rises
    const tmp = new THREE.Color();
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos.setZ(i, heights[i]);
      const t = (heights[i] - minH) / range;
      tmp.copy(low).lerp(high, t);
      // Fine speckle so the grass reads as mottled/organic rather than a
      // flat two-tone gradient.
      const speck = pseudoNoise(pos.getX(i) * 3.4, pos.getY(i) * 3.4, 7.7) * 0.045;
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
    scene.add(mesh);
    return mesh;
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
      const rad = 10.5 + Math.random() * 45;
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
    scene.add(trunkMesh);

    hueShifts.forEach(function (hs, v) {
      tiers.forEach(function (tr, ti) {
        const mesh = foliageMeshes[v][ti];
        mesh.count = variantCounts[v];
        mesh.instanceMatrix.needsUpdate = true;
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

  function buildHub() {
    const group = new THREE.Group();
    const ringY = 0.22; // clears the torus tube radius so it doesn't sit half-buried

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xdfe2e6, metalness: 0.55, roughness: 0.4,
      emissive: 0x10171a, emissiveIntensity: 0.35
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.16, 12, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ringY;
    group.add(ring);

    const toothGeo = new THREE.BoxGeometry(0.34, 0.34, 0.5);
    const teeth = new THREE.InstancedMesh(toothGeo, ringMat, 16);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * 3.1, ringY, Math.sin(a) * 3.1);
      dummy.rotation.y = -a;
      dummy.updateMatrix();
      teeth.setMatrixAt(i, dummy.matrix);
    }
    group.add(teeth);

    const helixGroup = new THREE.Group();
    const strandMatA = new THREE.MeshStandardMaterial({
      color: 0x15171c, emissive: 0x15171c, emissiveIntensity: 0.5, metalness: 0.15, roughness: 0.4
    });
    const strandMatB = new THREE.MeshStandardMaterial({
      color: 0x5b6b74, emissive: 0x5b6b74, emissiveIntensity: 0.3, metalness: 0.25, roughness: 0.4
    });
    const rungMat = new THREE.MeshStandardMaterial({ color: 0x9a9280, transparent: true, opacity: 0.4 });

    const turns = 3, pointsPerTurn = 14, radius = 1.5, height = 6;
    const totalPoints = turns * pointsPerTurn;
    const sphereGeo = new THREE.SphereGeometry(0.11, 10, 10);

    for (let i = 0; i < totalPoints; i++) {
      const t = i / totalPoints;
      const angle = t * Math.PI * 2 * turns;
      const y = t * height - height / 2;
      const xA = Math.cos(angle) * radius, zA = Math.sin(angle) * radius;
      const xB = Math.cos(angle + Math.PI) * radius, zB = Math.sin(angle + Math.PI) * radius;

      const sA = new THREE.Mesh(sphereGeo, strandMatA);
      sA.position.set(xA, y, zA);
      helixGroup.add(sA);

      const sB = new THREE.Mesh(sphereGeo, strandMatB);
      sB.position.set(xB, y, zB);
      helixGroup.add(sB);

      if (i % 2 === 0) {
        const rungLen = Math.hypot(xA - xB, zA - zB);
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, rungLen, 6), rungMat);
        rung.position.set((xA + xB) / 2, y, (zA + zB) / 2);
        rung.lookAt(new THREE.Vector3(xB, y, zB));
        rung.rotateX(Math.PI / 2);
        helixGroup.add(rung);
      }
    }
    // Lowest coil (local y = -height/2) must clear the ring's ground line.
    helixGroup.position.y = ringY + height / 2 + 0.15;
    group.add(helixGroup);
    group.userData.helix = helixGroup;
    group.userData.glowMats = [
      { mat: ringMat, base: 0.35 },
      { mat: strandMatA, base: 0.5 },
      { mat: strandMatB, base: 0.3 }
    ];
    return group;
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

    return new THREE.CanvasTexture(c);
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
    rock.position.y = height / 2;
    rock.rotation.y = pseudoNoise(seed, 1, 1) * 0.6;
    rock.rotation.z = pseudoNoise(seed, 2, 2) * 0.04;
    g.add(rock);

    // A wireframe "blueprint" twin of the same rock, hidden until clicked —
    // it flashes over the solid stone like a CAD X-ray view.
    const wireMat = new THREE.MeshBasicMaterial({
      color: color, wireframe: true, transparent: true, opacity: 0, depthWrite: false
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
  // Toppers — a distinct little marker per section so each pillar reads
  // differently at a glance: DNA helix (About), gear (Work Exp), hex nut
  // (Projects).
  // ---------------------------------------------------------------------

  function markerMaterial(color, intensity) {
    return new THREE.MeshStandardMaterial({
      color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: intensity,
      metalness: 0.3, roughness: 0.4, transparent: true, opacity: 1
    });
  }

  function buildHelixMarker(color) {
    const g = new THREE.Group();
    const strandMatA = markerMaterial(0x15171c, 0.55);
    const strandMatB = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.3,
      metalness: 0.2, roughness: 0.4, transparent: true, opacity: 1
    });
    const rungMat = new THREE.MeshStandardMaterial({ color: 0x15171c, transparent: true, opacity: 0.4 });

    const turns = 1.6, pointsPerTurn = 8, radius = 0.22, height = 1.05;
    const totalPoints = Math.round(turns * pointsPerTurn);
    const sphereGeo = new THREE.SphereGeometry(0.045, 8, 8);

    for (let i = 0; i < totalPoints; i++) {
      const t = i / totalPoints;
      const angle = t * Math.PI * 2 * turns;
      const y = t * height - height / 2;
      const xA = Math.cos(angle) * radius, zA = Math.sin(angle) * radius;
      const xB = Math.cos(angle + Math.PI) * radius, zB = Math.sin(angle + Math.PI) * radius;

      const sA = new THREE.Mesh(sphereGeo, strandMatA);
      sA.position.set(xA, y, zA);
      g.add(sA);
      const sB = new THREE.Mesh(sphereGeo, strandMatB);
      sB.position.set(xB, y, zB);
      g.add(sB);

      if (i % 2 === 0) {
        const rungLen = Math.hypot(xA - xB, zA - zB);
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, rungLen, 5), rungMat);
        rung.position.set((xA + xB) / 2, y, (zA + zB) / 2);
        rung.lookAt(new THREE.Vector3(xB, y, zB));
        rung.rotateX(Math.PI / 2);
        g.add(rung);
      }
    }
    g.userData.materials = [strandMatA, strandMatB, rungMat];
    return g;
  }

  function buildGearMarker(color) {
    const g = new THREE.Group();
    const mat = markerMaterial(color, 0.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 8, 20), mat);
    g.add(ring);

    const toothGeo = new THREE.BoxGeometry(0.1, 0.1, 0.14);
    const teeth = new THREE.InstancedMesh(toothGeo, mat, 8);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0);
      dummy.rotation.z = a;
      dummy.updateMatrix();
      teeth.setMatrixAt(i, dummy.matrix);
    }
    g.add(teeth);

    const centerHub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.15, 12), mat);
    centerHub.rotation.x = Math.PI / 2;
    g.add(centerHub);

    g.userData.materials = [mat];
    return g;
  }

  function buildToolMarker(color) {
    const g = new THREE.Group();
    const mat = markerMaterial(0xFFFFFF, 0.5);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.17, 6), mat);
    g.add(nut);

    const boreMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a26, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 1
    });
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 12), boreMat);
    g.add(bore);

    g.userData.materials = [mat, boreMat];
    return g;
  }

  function buildMarker(node) {
    if (node.markerType === "gear") return buildGearMarker(node.color);
    if (node.markerType === "tool") return buildToolMarker(node.color);
    return buildHelixMarker(node.color);
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
      marker.position.set(0, model.userData.height + 0.75, 0);
      group.add(marker);

      const placard = buildPlacard(node);
      group.add(placard);

      const materials = [model.userData.stoneMat]
        .concat(marker.userData.materials)
        .concat(placard.userData.materials);
      node.materials = materials;
      node.wireMat = model.userData.wireMat;
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
  // Render loop
  // ---------------------------------------------------------------------

  function animate(t) {
    requestAnimationFrame(animate);
    const time = (t || 0) * 0.001;

    // Day/night blend — a slow, deliberate transition, not an instant swap.
    themeBlend += (themeTarget - themeBlend) * (reducedMotion ? 1 : 0.02);

    grassUniforms.uTime.value = time;

    if (!reducedMotion) {
      hub.rotation.y += 0.0022;
      if (hub.userData.helix) hub.userData.helix.rotation.y -= 0.0035;
    }

    if (hub.userData.glowMats) {
      hub.userData.glowMats.forEach(function (gm) {
        gm.mat.emissiveIntensity = gm.base * (1 + themeBlend * 1.6);
      });
    }

    PORTFOLIO_DATA.nodes.forEach(function (node) {
      if (node.markerGroup && !reducedMotion) {
        node.markerGroup.rotation.y += 0.018;
        const pulse = 1 + Math.sin(time * 1.6 + node.markerPhase) * 0.08;
        node.markerGroup.scale.setScalar(pulse);
      }

      const isFocused = !activeNodeId || activeNodeId === node.id;
      const target = isFocused ? 1 : 0.28;
      const rate = reducedMotion ? 1 : 0.12;
      node.materials.forEach(function (mat) {
        mat.opacity += (target - mat.opacity) * rate;
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
      ambientLight.intensity = 0.95 - themeBlend * 0.48;
    }
    if (keyLight) {
      tmpColor.copy(KEY_DAY).lerp(KEY_NIGHT, themeBlend);
      keyLight.color.copy(tmpColor);
      keyLight.intensity = 0.85 - themeBlend * 0.55;
    }
    if (rimLight) rimLight.intensity = 0.22 + themeBlend * 0.35;
    if (rimLight2) rimLight2.intensity = 0.18 + themeBlend * 0.35;
    if (scene.fog) {
      tmpColor.copy(FOG_DAY).lerp(FOG_NIGHT, themeBlend);
      scene.fog.color.copy(tmpColor);
      scene.fog.density = 0.02 + themeBlend * 0.008;
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
    if (stars) stars.material.opacity = themeBlend * 0.85;

    if (!reducedMotion) particleUniforms.uTime.value = time;

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

    renderer.render(scene, camera);
  }

  if (typeof THREE === "undefined" || typeof THREE.OrbitControls === "undefined") {
    document.dispatchEvent(new CustomEvent("bench-unavailable"));
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
