/* ── globe ─────────────────────────────────────────────────────────────────
   The deck's 3D hero: Italy extruded from real (simplified) Natural Earth
   geometry, with the trip's route drawn on top as a glowing arc and each
   city's name projected onto the model as it turns.
   ------------------------------------------------------------------------ */

import * as THREE from 'three';

/** Web Mercator → shape space. x follows longitude, y follows latitude. */
const merc = (lat, lng) => [lng, (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

const PALETTE = {
  land:      0xE7DAC4,
  landDeep:  0xBFA983,
  sea:       0x1B2A30,
  terracotta:0xC25A3A,
  olive:     0x8B9C63,
  gold:      0xD6B166,
  cream:     0xF6EFE2,
};

export function createGlobe(canvas, opts) {
  const { cities, routes, geo, reduced } = opts;

  /* ── centring: fit all of Italy, then bias toward the trip's latitudes ── */
  const allPts = geo.italy.flat().map(([lng, lat]) => merc(lat, lng));
  const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const S = 11 / (Math.max(...ys) - Math.min(...ys));

  const toWorld = (lat, lng, y = 0) => {
    const [mx, my] = merc(lat, lng);
    return new THREE.Vector3((mx - cx) * S, y, -(my - cy) * S);
  };

  /* ── renderer / scene ─────────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.sea, 26, 62);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

  /* ── lights ───────────────────────────────────────────────────────────── */
  scene.add(new THREE.AmbientLight(0xfff2e0, 0.55));

  const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
  key.position.set(-9, 15, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  const d = 14;
  Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0012;
  scene.add(key);

  // Cool rim from the far side so the coastline edge reads against the dark sea.
  const rim = new THREE.DirectionalLight(0x8fc4d4, 0.9);
  rim.position.set(8, 5, -12);
  scene.add(rim);

  /* ── the sea ──────────────────────────────────────────────────────────── */
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: PALETTE.sea, roughness: 0.35, metalness: 0.15 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.02;
  sea.receiveShadow = true;
  scene.add(sea);

  /* ── the land ─────────────────────────────────────────────────────────── */
  const landGroup = new THREE.Group();
  const DEPTH = 0.42;

  const landMat = new THREE.MeshStandardMaterial({
    color: PALETTE.land, roughness: 0.82, metalness: 0.02, flatShading: false,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: PALETTE.landDeep, roughness: 0.95, metalness: 0.0,
  });

  for (const ring of geo.italy) {
    const shape = new THREE.Shape();
    ring.forEach(([lng, lat], i) => {
      const [mx, my] = merc(lat, lng);
      const x = (mx - cx) * S, y = (my - cy) * S;
      i ? shape.lineTo(x, y) : shape.moveTo(x, y);
    });
    shape.closePath();

    const g = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH, bevelEnabled: true,
      bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 1,
    });
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, [landMat, sideMat]);
    m.rotation.x = -Math.PI / 2;   // lay the shape flat; extrusion becomes +Y
    m.castShadow = true;
    m.receiveShadow = true;
    landGroup.add(m);
  }
  scene.add(landGroup);

  const TOP = DEPTH + 0.02;

  /* ── city markers ─────────────────────────────────────────────────────── */
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  const markers = new Map();

  for (const [key_, c] of Object.entries(cities)) {
    const p = toWorld(c.center[0], c.center[1], TOP);
    const g = new THREE.Group();
    g.position.copy(p);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 16),
      new THREE.MeshStandardMaterial({
        color: PALETTE.cream, emissive: 0xFF6B3D,
        emissiveIntensity: 0.25, roughness: 0.3,
      }),
    );
    dot.position.y = 0.14;
    g.add(dot);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 32),
      new THREE.MeshBasicMaterial({
        color: PALETTE.gold, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    g.add(ring);

    markerGroup.add(g);
    markers.set(key_, { group: g, dot, ring, pulse: 0 });
  }

  /* ── route arcs ───────────────────────────────────────────────────────── */

  function buildArc(aKey, bKey, colour) {
    const a = cities[aKey].center, b = cities[bKey].center;
    const p0 = toWorld(a[0], a[1], TOP);
    const p1 = toWorld(b[0], b[1], TOP);
    const dist = p0.distanceTo(p1);
    const mid = p0.clone().lerp(p1, 0.5);
    mid.y += Math.min(2.6, 0.5 + dist * 0.4); // taller bow for longer hops

    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

    // Core ribbon plus a wider translucent sheath — the glow is what makes the
    // route legible against a sunlit tan landmass.
    const core = new THREE.TubeGeometry(curve, 80, 0.085, 10, false);
    const glow = new THREE.TubeGeometry(curve, 80, 0.22, 10, false);

    const coreMesh = new THREE.Mesh(core, new THREE.MeshStandardMaterial({
      color: colour, emissive: colour, emissiveIntensity: 1.5,
      roughness: 0.35, metalness: 0.1,
    }));
    const glowMesh = new THREE.Mesh(glow, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));

    const group = new THREE.Group();
    group.add(glowMesh, coreMesh);

    core.setDrawRange(0, 0);
    glow.setDrawRange(0, 0);
    return { mesh: group, geos: [core, glow], totals: [core.index.count, glow.index.count], curve };
  }

  const arcSets = {};
  for (const [name, seq] of Object.entries(routes)) {
    const colour = 0xFF6B3D;
    const group = new THREE.Group();
    group.visible = false;
    const arcs = [];
    for (let i = 1; i < seq.length; i++) {
      const a = buildArc(seq[i - 1], seq[i], colour);
      group.add(a.mesh);
      arcs.push(a);
    }
    scene.add(group);
    arcSets[name] = { group, arcs, seq };
  }

  /* ── modes ────────────────────────────────────────────────────────────── */

  // `look` is offset left of the landmass so the model sits in the right half
  // of the frame, clear of the text panel.
  const VIEWS = {
    hero:    { pos: new THREE.Vector3(6.5, 12.5, 17),  look: new THREE.Vector3(-0.8, 0, 1.2),  spin: 0.028 },
    closing: { pos: new THREE.Vector3(-8, 16, 20),     look: new THREE.Vector3(0, 0, 0),       spin: 0.02 },
  };

  let mode = 'hero';
  let activeSet = 'new';
  let progress = 0;          // 0→1 draw-on of the active route
  let routeT0 = 0;           // when the current draw-on began
  const DRAW_SECONDS = 2.4;
  const camPos = VIEWS.hero.pos.clone();
  const camLook = VIEWS.hero.look.clone();
  let spinT = 0;

  function setMode(next, which = 'new') {
    if (next === mode && which === activeSet) return;
    mode = next;
    if (which !== activeSet) restartRoute();
    activeSet = which;
    for (const [name, set] of Object.entries(arcSets)) set.group.visible = name === which;
    markers.forEach((m) => { m.pulse = 0; });
  }

  function restartRoute() {
    routeT0 = clock.getElapsedTime();
    progress = 0;
  }

  /* ── loop ─────────────────────────────────────────────────────────────── */

  const clock = new THREE.Clock();
  let running = false;
  let raf = 0;

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();

    const view = VIEWS[mode] || VIEWS.hero;

    // Ease the camera toward the target of the current mode.
    spinT += dt * view.spin;
    const target = view.pos.clone();
    if (view.spin) {
      const r = Math.hypot(view.pos.x, view.pos.z);
      target.x = Math.sin(spinT) * r;
      target.z = Math.cos(spinT) * r;
    }
    camPos.lerp(target, 1 - Math.pow(0.0015, dt));
    camLook.lerp(view.look, 1 - Math.pow(0.0015, dt));
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    // Draw the active route on, one leg after another.
    const set = arcSets[activeSet];
    if (set) {
      // Wall-clock driven, so a slow GPU shortens nothing and stalls nothing.
      progress = reduced ? 1 : Math.min(1, (t - routeT0) / DRAW_SECONDS);
      const n = set.arcs.length;
      set.arcs.forEach((a, i) => {
        const legFrom = i / n, legTo = (i + 1) / n;
        const p = THREE.MathUtils.clamp((progress - legFrom) / (legTo - legFrom), 0, 1);
        const eased = p * p * (3 - 2 * p);
        a.geos.forEach((g, k) => g.setDrawRange(0, Math.floor(a.totals[k] * eased)));
      });

      // A marker lights up as the route reaches its city.
      set.seq.forEach((k, i) => {
        const m = markers.get(k);
        if (!m) return;
        const arrive = i / n;
        if (progress >= arrive) m.pulse = Math.min(1, m.pulse + dt * 2.2);
      });
    }

    markers.forEach((m) => {
      const lit = m.pulse;
      m.dot.material.emissiveIntensity = 0.2 + lit * 2.2;
      m.dot.scale.setScalar(0.8 + lit * 0.55);
      // Expanding halo, restarting every couple of seconds.
      const cyc = (t * 0.55) % 1;
      m.ring.material.opacity = lit * (1 - cyc) * 0.5;
      m.ring.scale.setScalar(1 + cyc * 2.2);
    });

    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 1;
    const hgt = canvas.clientHeight || canvas.parentElement.clientHeight || 1;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }

  /** Project each named city marker's world position through the live camera,
   *  so an HTML label can be positioned over the canvas at that screen point. */
  function labelPoints(keys) {
    camera.updateMatrixWorld();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const out = [];
    for (const key of keys) {
      const m = markers.get(key);
      if (!m) continue;
      const world = m.group.position.clone();
      const inFront = world.clone().sub(camera.position).dot(camDir) > 0;
      const ndc = world.project(camera);
      out.push({
        key,
        x: (ndc.x + 1) / 2,
        y: (1 - ndc.y) / 2,
        visible: inFront && ndc.z > -1 && ndc.z < 1,
      });
    }
    return out;
  }

  return {
    setMode,
    resize,
    getLabelPoints: labelPoints,
    replay() { restartRoute(); markers.forEach((m) => { m.pulse = 0; }); },
    start() { if (running) return; running = true; clock.getDelta(); frame(); },
    stop()  { running = false; cancelAnimationFrame(raf); },
    dispose() {
      this.stop();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
      renderer.dispose();
    },
  };
}
