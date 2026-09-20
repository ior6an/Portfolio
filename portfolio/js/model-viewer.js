/* Embedded 360° STL viewers for the info panel.
   Depends on THREE (r128) + THREE.OrbitControls + THREE.STLLoader.

   Any element matching .model-viewer[data-model="path/to/file.stl"] found
   inside a container passed to window.initModelViewers(container) gets its
   own small Three.js scene: drag to orbit, gentle auto-rotate, lit like a
   fabricated metal part. Only one panel's worth of viewers run at a time —
   initModelViewers() disposes whatever was active before starting fresh,
   so switching or closing panels never leaves an orphaned render loop. */

(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const activeViewers = [];

  function disposeAll() {
    while (activeViewers.length) {
      const v = activeViewers.pop();
      if (v.rafId) cancelAnimationFrame(v.rafId);
      v.controls.dispose();
      v.renderer.dispose();
      if (v.geometry) v.geometry.dispose();
      if (v.material) v.material.dispose();
    }
  }

  function initAll(container) {
    disposeAll();
    if (!container || typeof THREE === "undefined" ||
        typeof THREE.OrbitControls === "undefined" || typeof THREE.STLLoader === "undefined") {
      return;
    }
    const els = container.querySelectorAll(".model-viewer[data-model]");
    els.forEach(initOne);
  }

  function initOne(el) {
    const width = el.clientWidth || 400;
    const height = el.clientHeight || 260;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1d1a);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    el.appendChild(renderer.domElement);

    const loading = document.createElement("div");
    loading.className = "model-viewer-loading";
    loading.textContent = "LOADING MODEL\u2026";
    el.appendChild(loading);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb8ff, 0.45);
    rim.position.set(-4, -1, -3);
    scene.add(rim);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 1.3;
    controls.enablePan = false;

    const viewer = { renderer: renderer, controls: controls, rafId: null, geometry: null, material: null };
    activeViewers.push(viewer);

    function onModelLoaded(geometry) {
      if (loading.parentNode) loading.remove();
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox.getSize(size);
      const center = new THREE.Vector3();
      geometry.boundingBox.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);

      // A brushed-steel look — this is a welded/fabricated metal part.
      const material = new THREE.MeshStandardMaterial({
        color: 0x9aa0a6, metalness: 0.65, roughness: 0.42
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      viewer.geometry = geometry;
      viewer.material = material;

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = maxDim * 1.9;
      camera.position.set(dist * 0.55, dist * 0.45, dist * 0.85);
      camera.near = maxDim / 100;
      camera.far = maxDim * 50;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = maxDim * 0.4;
      controls.maxDistance = maxDim * 6;
      controls.update();
    }

    function onModelError(err) {
      loading.textContent = "Couldn't load model";
      if (window.console) console.error("STL load error:", err);
    }

    const loader = new THREE.STLLoader();
    const modelKey = el.getAttribute("data-model-key");

    if (modelKey && window.MODEL_DATA && window.MODEL_DATA[modelKey]) {
      // Embedded base64 data — parsed synchronously in memory, no network
      // request at all, so this works identically whether the page is
      // opened via file:// or a real web server.
      try {
        const binary = atob(window.MODEL_DATA[modelKey]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        onModelLoaded(loader.parse(bytes.buffer));
      } catch (err) {
        onModelError(err);
      }
    } else {
      // URL-based loading — only works when served over http(s); opening
      // the page directly from disk will fail here due to browser CORS
      // restrictions on local files.
      loader.load(el.getAttribute("data-model"), onModelLoaded, undefined, onModelError);
    }

    function animate() {
      viewer.rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    viewer.rafId = requestAnimationFrame(animate);
  }

  window.initModelViewers = initAll;
  window.disposeModelViewers = disposeAll;
})();
