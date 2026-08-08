/**
 * The shopping district in three dimensions.
 *
 * Streets are lifted from the same `streets.json` the day maps use — area a1,
 * Rome — clipped to the Tridente and Monti and drawn as ribbons on a ground
 * plane, with each shop standing on it as a coloured pillar.
 *
 * There are no buildings, and that is deliberate rather than unfinished:
 * fetch-streets.mjs never collects footprints because in a dense centre they
 * outweigh every other layer combined. So this is an abstract terrain of
 * streets, which suits a document that draws everything else flat and
 * illustrative.
 *
 * Conventions follow globe.js: the ground is the XZ plane, height is +Y, and
 * the camera orbit is hand-rolled rather than pulling in OrbitControls — the
 * page is already carrying three.js for the first time and there is no reason
 * to carry more.
 */
import * as THREE from 'three';

const INT_SCALE = 1e5;          // streets.json stores 1e5-degree integers
const AREA = 'a1';              // the Rome town area

/** How far around the shops to draw, in degrees. Enough for context, not the city. */
const PAD = 0.006;

/* Road classes worth drawing here. streets.json class 0-2 are the big roads,
   3+ the small ones; at this scale the small ones are the point — Frattina and
   Borgognona are class 4 — so the filter is generous and the clip is tight. */
const WIDTH = [7, 5.5, 4, 3, 2.2, 1.6];

const COLOR = {
  apparel: 0xc25a3a,   // --terracotta
  jewelry: 0xb08d43,   // --gold
  other:   0x6e7f4a,   // --olive
};

/* One material across every street, so a thousand tubes cost a thousand draw
   calls and not two thousand objects to light. */
const streetMat = new THREE.MeshLambertMaterial({ color: 0xddd1be });

/**
 * Build the view. Returns { select, dispose } or null when WebGL is missing —
 * the caller renders the list either way, so a machine without WebGL loses the
 * picture and nothing else.
 */
export function createShopMap(canvas, streets, places, onPick) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const area = (streets.areas || streets)[AREA];
  if (!area) return null;

  const handheld = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, handheld ? 1.5 : 2));

  /* ── projection ───────────────────────────────────────────────────────── */

  // A patch this small does not need Mercator; flat degrees with a cosine
  // correction on longitude keeps north up and the proportions honest.
  const lats = places.map((p) => p.coord[0]);
  const lngs = places.map((p) => p.coord[1]);
  const mid = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  const box = [Math.min(...lngs) - PAD, Math.min(...lats) - PAD, Math.max(...lngs) + PAD, Math.max(...lats) + PAD];

  const kx = Math.cos((mid[0] * Math.PI) / 180);

  /* Derive the scale from the extent rather than fixing it: the district is
     about 0.02° across, so any constant is either a speck or off-screen. This
     lands the longer side at ~260 units, which the camera distances below are
     written against. */
  const SPAN = 260;
  const SCALE = SPAN / Math.max((box[2] - box[0]) * kx, box[3] - box[1]);

  const X = (lng) => (lng - mid[1]) * kx * SCALE;
  const Z = (lat) => -(lat - mid[0]) * SCALE;
  const inBox = (lng, lat) => lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];

  /* ── scene ────────────────────────────────────────────────────────────── */

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(-60, 120, 80);
  scene.add(key);

  // The ground reads as the paper the rest of the document is printed on.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry((box[2] - box[0]) * kx * SCALE, (box[3] - box[1]) * SCALE),
    new THREE.MeshBasicMaterial({ color: 0xf3ece0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  scene.add(ground);

  /* ── streets ──────────────────────────────────────────────────────────── */

  const [ox, oy] = area.origin;
  const streetGroup = new THREE.Group();
  let drawn = 0;

  for (const [cls, line] of area.roads) {
    if (cls >= WIDTH.length) continue;
    const pts = [];
    let touches = false;
    for (const [qx, qy] of line) {
      const lng = ox + qx / INT_SCALE;
      const lat = oy + qy / INT_SCALE;
      if (inBox(lng, lat)) touches = true;
      pts.push(new THREE.Vector3(X(lng), 0, Z(lat)));
    }
    if (!touches || pts.length < 2) continue;

    // A tube is heavier than a line but takes light, which is what makes the
    // grid read as a surface rather than a wireframe.
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
    const geo = new THREE.TubeGeometry(curve, Math.min(pts.length * 2, 80), WIDTH[cls] * 0.32, 4, false);
    streetGroup.add(new THREE.Mesh(geo, streetMat));
    drawn++;
    if (drawn > 1400) break;   // a hard ceiling; the clip should land far below it
  }
  scene.add(streetGroup);

  /* ── shops ────────────────────────────────────────────────────────────── */

  const pins = [];
  for (const p of places) {
    const h = p.precise ? 15 : 10;   // a street-level pin stands lower than a door
    const mat = new THREE.MeshLambertMaterial({ color: COLOR[p.category] ?? COLOR.other });
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, h, 12), mat);
    pin.position.set(X(p.coord[1]), h / 2, Z(p.coord[0]));
    pin.userData.place = p;
    scene.add(pin);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.1, 16, 12), mat);
    cap.position.set(pin.position.x, h + 1.8, pin.position.z);
    cap.userData.place = p;
    scene.add(cap);

    pins.push(pin, cap);
  }

  /* ── camera orbit, hand-rolled ────────────────────────────────────────── */

  let yaw = -0.45, pitch = 0.95, dist = 300;
  const target = new THREE.Vector3(0, 0, 0);

  function place() {
    camera.position.set(
      target.x + dist * Math.sin(pitch) * Math.sin(yaw),
      target.y + dist * Math.cos(pitch),
      target.z + dist * Math.sin(pitch) * Math.cos(yaw),
    );
    camera.lookAt(target);
  }

  let dragging = false, lx = 0, ly = 0, moved = 0;
  const down = (e) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; };
  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    moved += Math.abs(dx) + Math.abs(dy);
    lx = e.clientX; ly = e.clientY;
    yaw -= dx * 0.006;
    // Clamped short of straight down and of the horizon: past either the scene
    // stops reading as a map.
    pitch = Math.min(1.35, Math.max(0.25, pitch - dy * 0.005));
    place();
  };
  const up = () => { dragging = false; };
  const wheel = (e) => {
    e.preventDefault();
    dist = Math.min(700, Math.max(70, dist * (1 + Math.sign(e.deltaY) * 0.12)));
    place();
  };

  canvas.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });

  /* ── picking ──────────────────────────────────────────────────────────── */

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  canvas.addEventListener('click', (e) => {
    if (moved > 6) return;              // that was a drag, not a click
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pins, false)[0];
    if (hit) onPick(hit.object.userData.place);
  });

  /* ── loop ─────────────────────────────────────────────────────────────── */

  let alive = true;
  let selected = null;

  function frame() {
    if (!alive) return;
    for (const m of pins) {
      const on = selected && m.userData.place.name === selected;
      m.scale.setScalar(on ? 1.45 : 1);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const hgt = canvas.clientHeight || 1;
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    renderer.setSize(w, hgt, false);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  place();
  frame();

  return {
    select(name) { selected = name; },
    dispose() {
      alive = false;
      ro.disconnect();
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      renderer.dispose();
    },
  };
}
