import * as THREE from 'three';
import { GeoBuilder, jitterGeometry, matrix, branchMatrix } from './builder.js';
import { fillMaterial, outlineMaterial } from './toon.js';

import { IS_WINTER, IS_AUTUMN, SEASON_DEF } from './season.js';
import { mulberry32, hash2, fbm, smoothstep, pickWeighted, lerp, clamp } from './noise.js';


const tc = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Painted colours
// ---------------------------------------------------------------------------
// Vertex colours are brightness multipliers: warm on the sun-facing top of a
// crown, cool and dark underneath. The per-tree hue arrives via instance tint.
function leafColor(m, warm) {
  return tc.setRGB(m * (0.9 + 0.17 * warm), m * (0.95 + 0.04 * warm), m * (1.1 - 0.26 * warm));
}

function addBlob(b, rng, cx, cy, cz, rad, o) {
  const geo = new THREE.IcosahedronGeometry(rad, o.detail);
  jitterGeometry(geo, rad * (o.jitter ?? 0.13), o.seed + Math.floor(rng() * 1000));
  const bv = 0.9 + rng() * 0.2;
  const fvSeed = Math.floor(rng() * 999);
  b.add(geo, matrix(cx, cy, cz), {
    tint: 1,
    colorFn: (p, n, tri) => {
      const t = clamp((p.y - o.yMin) / (o.yMax - o.yMin), 0, 1);
      const fv = 0.92 + 0.16 * hash2(tri, fvSeed, o.seed);
      const m = (0.6 + 0.58 * t + 0.14 * Math.max(n.y, 0)) * bv * fv;
      return leafColor(m, clamp(t * 0.85 + 0.25 * Math.max(n.y, 0), 0, 1));
    },
  });
}

const BARK = {
  maple: ['#6f5d4b', '#5c4b3b'],
  oak: ['#54433a', '#443530'],
  pine: ['#7a523a', '#66442f'],
  birch: ['#efe9dc', '#e3dccb'],
};

function addTrunk(b, o) {
  const segs = o.segs ?? 8;
  const h = o.h;
  const rings = o.rings ?? 4;
  const pts = [new THREE.Vector2(o.rBase * (o.flare ?? 1.5), 0), new THREE.Vector2(o.rBase * 1.1, Math.min(0.5, h * 0.1))];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    pts.push(new THREE.Vector2(lerp(o.rBase, o.rTop, Math.pow(t, 0.85)), lerp(Math.min(0.5, h * 0.1), h, t)));
  }
  const geo = new THREE.LatheGeometry(pts, segs);
  jitterGeometry(geo, o.rBase * 0.05, 4);
  const [ca, cb] = o.bark;
  const A = new THREE.Color(ca), B = new THREE.Color(cb);
  const dark = new THREE.Color('#2b2724');
  b.add(geo, matrix(0, 0, 0), {
    tint: 0,
    faceColorFn: (c, n, tri) => {
      const a = Math.atan2(c.z, c.x);
      const stripe = Math.floor(((a + Math.PI) / (Math.PI * 2)) * segs);
      const ring = Math.floor(c.y * (o.birch ? 1.5 : 0.9));
      if (o.birch) {
        // papery white with dark horizontal scars
        const scar = hash2(ring, stripe, 11) < 0.3 && c.y > 0.8;
        if (scar) return tc.copy(dark).multiplyScalar(0.8 + 0.4 * hash2(ring, stripe, 5));
        return tc.copy(stripe % 2 ? A : B).multiplyScalar(0.94 + 0.08 * hash2(ring, stripe, 2));
      }
      const v = 0.82 + 0.3 * hash2(stripe, ring, 3);
      // darker toward the base, moss creeping on the shaded side
      const base = 0.75 + 0.25 * clamp(c.y / 3, 0, 1);
      tc.copy(stripe % 2 ? A : B).multiplyScalar(v * base);
      return tc;
    },
  });
}

function addBranch(b, a, z, rBase, rTip, bark) {
  const geo = new THREE.CylinderGeometry(rTip, rBase, 1, 5, 1, true);
  b.add(geo, branchMatrix(a, z), { color: bark, tint: 0 });
}

// ---------------------------------------------------------------------------
// Species geometry builders. lod: 0 = full detail, 1 = cheap far version
// ---------------------------------------------------------------------------
function buildMaple(variant, lod) {
  const rng = mulberry32(100 + variant * 13 + lod);
  const b = new GeoBuilder();
  const H = 5.4 + variant * 0.55;
  const rBase = 0.34 + variant * 0.02;
  addTrunk(b, { h: H + 2.6, rBase, rTop: 0.12, bark: BARK.maple, segs: lod ? 5 : 8, rings: lod ? 2 : 4 });
  const cy = H + 2.3;
  const rx = 3.4 + rng() * 0.6, ry = 2.4 + rng() * 0.5;
  const yMin = cy - ry - 1.4, yMax = cy + ry + 2.0;
  if (!lod) {
    for (let k = 0; k < 3; k++) {
      const ang = k * 2.1 + rng();
      addBranch(b, new THREE.Vector3(0, H * 0.7, 0),
        new THREE.Vector3(Math.cos(ang) * 1.9, H + 1.6 + rng(), Math.sin(ang) * 1.9), 0.17, 0.06, BARK.maple[1]);
    }
  }
  const count = lod ? 4 : 7 + variant;
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.88;
    const rad = (1.9 + rng() * 0.85) * (lod ? 1.18 : 1);
    addBlob(b, rng, Math.cos(ang) * rx * rr, cy + (rng() - 0.4) * ry, Math.sin(ang) * rx * rr, rad,
      { detail: lod ? 0 : 1, seed: 7 + variant, yMin, yMax });
  }
  addBlob(b, rng, 0, cy + ry * 0.75, 0, lod ? 2.3 : 2.1, { detail: lod ? 0 : 1, seed: 9, yMin, yMax });
  return { geo: b.build({ smoothNormals: !lod }), H: cy + ry + 1.6, rBase };
}

function buildOak(variant, lod) {
  const rng = mulberry32(200 + variant * 29 + lod);
  const b = new GeoBuilder();
  const H = 4.0 + variant * 0.5;
  const rBase = 0.52;
  addTrunk(b, { h: H + 1.2, rBase, rTop: 0.26, flare: 1.7, bark: BARK.oak, segs: lod ? 5 : 8, rings: lod ? 2 : 3 });
  const cy = H + 2.4;
  const rx = 5.0 + rng() * 0.6, ry = 1.9 + rng() * 0.4;
  const yMin = cy - ry - 1.6, yMax = cy + ry + 2.2;
  if (!lod) {
    for (let k = 0; k < 4; k++) {
      const ang = k * 1.6 + rng() * 0.6;
      addBranch(b, new THREE.Vector3(0, H * 0.8, 0),
        new THREE.Vector3(Math.cos(ang) * 3.4, H + 1.5 + rng() * 1.2, Math.sin(ang) * 3.4), 0.26, 0.08, BARK.oak[1]);
    }
  }
  const count = lod ? 5 : 9;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rng() * 0.8;
    const rr = 0.35 + rng() * 0.6;
    const rad = (2.1 + rng() * 0.8) * (lod ? 1.15 : 1);
    addBlob(b, rng, Math.cos(ang) * rx * rr, cy + (rng() - 0.45) * ry, Math.sin(ang) * rx * rr, rad,
      { detail: lod ? 0 : 1, seed: 21 + variant, yMin, yMax });
  }
  addBlob(b, rng, 0, cy + ry * 0.6, 0, 2.5, { detail: lod ? 0 : 1, seed: 24, yMin, yMax });
  return { geo: b.build({ smoothNormals: !lod }), H: cy + ry + 1.8, rBase };
}

function buildPine(variant, lod, snow = IS_WINTER) {
  const rng = mulberry32(300 + variant * 7 + lod);
  const b = new GeoBuilder();
  const H = 16.5 + variant * 3;
  const rBase = 0.4 + variant * 0.04;
  addTrunk(b, { h: H, rBase, rTop: 0.08, flare: 1.35, bark: BARK.pine, segs: lod ? 5 : 8, rings: lod ? 3 : 6 });
  const tiers = lod ? 4 : 7 + variant;
  const y0 = 4.4, y1 = H - 3.2;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = lerp(y0, y1, t);
    const R = lerp(3.2, 0.95, Math.pow(t, 0.85)) * (0.88 + rng() * 0.24);
    const hc = lerp(3.5, 2.3, t) * (lod ? 1.5 : 1);
    const geo = new THREE.ConeGeometry(R, hc, lod ? 6 : 9, 1, false);
    jitterGeometry(geo, R * 0.12, 31 + i + variant * 5);
    const bv = 0.92 + rng() * 0.16;
    const yBot = y, yTop = y + hc;
    b.add(geo, matrix(rng() * 0.5 - 0.25, y + hc * 0.5, rng() * 0.5 - 0.25, 0, rng() * 6.28, 0), {
      tint: 1,
      colorFn: (p, n) => {
        const k = clamp((p.y - yBot) / hc, 0, 1);
        const m = (0.5 + 0.62 * k + 0.12 * Math.max(n.y, 0)) * bv * (0.85 + 0.3 * smoothstep(0, 1, t));
        return tc.setRGB(m * 0.95, m, m * 1.04);
      },
    });
    if (snow) {   // a cap of snow on the upper half of each tier
      const cap = new THREE.ConeGeometry(R * 0.6, hc * 0.46, lod ? 6 : 9, 1, false);
      b.add(cap, matrix(0, y + hc * 0.77, 0, 0, rng() * 6.28, 0), {
        tint: 0, colorFn: (p, n) => tc.setRGB(0.88 + 0.1 * Math.max(n.y, 0), 0.92 + 0.07 * Math.max(n.y, 0), 0.97),
      });
    }
  }
  // leader
  const top = new THREE.ConeGeometry(0.55, lod ? 3.2 : 2.6, lod ? 5 : 6);
  b.add(top, matrix(0, H - 0.2, 0), { tint: 1, colorFn: (p) => tc.setRGB(1.0, 1.05, 1.0) });
  return { geo: b.build({ smoothNormals: !lod }), H: H + 1, rBase };
}

function buildBirch(variant, lod) {
  const rng = mulberry32(400 + variant * 19 + lod);
  const b = new GeoBuilder();
  const H = 8.8 + variant * 1.4;
  const rBase = 0.17 + variant * 0.015;
  addTrunk(b, { h: H + 1.4, rBase, rTop: 0.05, flare: 1.35, birch: true, bark: BARK.birch,
    segs: lod ? 5 : 7, rings: lod ? 4 : Math.round((H + 1.4) / 0.7) });
  const cy = H - 0.3;
  const yMin = cy - 2.6, yMax = cy + 2.8;
  if (!lod) {
    for (let k = 0; k < 4; k++) {
      const ang = k * 1.7 + rng();
      addBranch(b, new THREE.Vector3(0, H * 0.62, 0),
        new THREE.Vector3(Math.cos(ang) * 1.5, H + 0.4 + rng() * 1.2, Math.sin(ang) * 1.5), 0.07, 0.03, '#d8d1c0');
    }
  }
  const count = lod ? 3 : 6;
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * 0.95;
    const rad = (1.25 + rng() * 0.6) * (lod ? 1.2 : 1);
    addBlob(b, rng, Math.cos(ang) * 1.9 * rr, cy + (rng() - 0.35) * 2.6, Math.sin(ang) * 1.9 * rr, rad,
      { detail: lod ? 0 : 1, seed: 41 + variant, yMin, yMax, jitter: 0.18 });
  }
  return { geo: b.build({ smoothNormals: !lod }), H: cy + 3, rBase };
}


// ---------------------------------------------------------------------------
// Mature trees: the century-old second growth that makes Ashland's canopy (about 20 m, with older pines above).
// Long clear trunks, crowns high overhead; the young models above are the understory and the middle layer.
// ---------------------------------------------------------------------------
function crownBlobs(b, rng, n, cx, cy, rx, ry, rad0, rad1, o) {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rng() * 0.9;
    const rr = Math.sqrt(0.15 + rng() * 0.85);
    const yy = cy + (rng() * 2 - 1) * ry * 0.72 * (1 - 0.35 * rr);   // fuller in the middle, rounder at the edges
    addBlob(b, rng, Math.cos(ang) * rx * rr, yy, Math.sin(ang) * rx * rr, rad0 + rng() * (rad1 - rad0), o);
  }
}
function buildMatureMaple(variant, lod) {
  const rng = mulberry32(150 + variant * 17 + lod);
  const b = new GeoBuilder();
  const clear = 10.5 + variant * 1.2, top = 21.5 + variant * 1.8;   // bare trunk up to `clear`, crown to `top`
  const rBase = 0.36 + variant * 0.03;
  addTrunk(b, { h: top - 4, rBase, rTop: 0.13, bark: BARK.maple, segs: lod ? 5 : 8, rings: lod ? 3 : 6 });
  const ry = (top - clear) / 2, cy = clear + ry + 0.4, rx = 4.6 + rng() * 0.9;
  const yMin = clear - 1, yMax = top + 1;
  if (!lod) for (let k = 0; k < 4; k++) {   // a few big limbs climbing into the crown
    const ang = k * 1.75 + rng();
    addBranch(b, new THREE.Vector3(0, clear - 0.6 + rng(), 0), new THREE.Vector3(Math.cos(ang) * rx * 0.55, cy + rng() * 1.5, Math.sin(ang) * rx * 0.55), 0.2, 0.07, BARK.maple[1]);
  }
  crownBlobs(b, rng, lod ? 6 : 10, 0, cy, rx, ry, 2.6 * (lod ? 1.2 : 1), 3.3 * (lod ? 1.2 : 1), { detail: lod ? 0 : 1, seed: 57 + variant, yMin, yMax });
  addBlob(b, rng, 0, top - 1.8, 0, lod ? 3.0 : 2.7, { detail: lod ? 0 : 1, seed: 59, yMin, yMax });
  return { geo: b.build({ smoothNormals: !lod }), H: top, rBase };
}
function buildMatureOak(variant, lod) {
  const rng = mulberry32(250 + variant * 23 + lod);
  const b = new GeoBuilder();
  const clear = 9.5 + variant * 1.0, top = 22 + variant * 1.5;
  const rBase = 0.46 + variant * 0.03;
  addTrunk(b, { h: clear + 3.5, rBase, rTop: 0.26, flare: 1.6, bark: BARK.oak, segs: lod ? 5 : 8, rings: lod ? 3 : 5 });
  const rx = 6.6 + rng() * 1.0, ry = (top - clear) / 2 - 1.0, cy = top - ry - 1.0;   // broad and spreading, flatter than a maple
  const yMin = clear - 1, yMax = top + 1;
  const limbs = lod ? 3 : 5;
  for (let k = 0; k < limbs; k++) {   // heavy limbs reaching out sideways, the oak's signature
    const ang = k * (Math.PI * 2 / limbs) + rng() * 0.6;
    addBranch(b, new THREE.Vector3(0, clear + rng() * 2.2, 0), new THREE.Vector3(Math.cos(ang) * rx * 0.72, cy - 0.5 + rng() * 2, Math.sin(ang) * rx * 0.72), 0.3, 0.1, BARK.oak[1]);
  }
  crownBlobs(b, rng, lod ? 7 : 11, 0, cy, rx, ry, 2.9 * (lod ? 1.2 : 1), 3.6 * (lod ? 1.2 : 1), { detail: lod ? 0 : 1, seed: 63 + variant, yMin, yMax });
  addBlob(b, rng, 0, top - 2.2, 0, 3.0, { detail: lod ? 0 : 1, seed: 66, yMin, yMax });
  return { geo: b.build({ smoothNormals: !lod }), H: top, rBase };
}
/** eastern white pine, grown up: a tall straight trunk, the lower half bare but for dead stubs, and above it uneven
 *  layered plumes, flat and offset to one side or another, under a leader that leans a little */
function buildWhitePine(variant, lod, snow = IS_WINTER) {
  const rng = mulberry32(350 + variant * 11 + lod);
  const b = new GeoBuilder();
  const H = 26 + variant * 2.5, rBase = 0.48 + variant * 0.04;
  addTrunk(b, { h: H, rBase, rTop: 0.1, flare: 1.4, bark: BARK.pine, segs: lod ? 5 : 8, rings: lod ? 3 : 7 });
  if (!lod) for (let k = 0; k < 7; k++) {   // dead lower branches, grey stubs
    const y = 3 + rng() * (H * 0.4), ang = rng() * 6.28, l = 0.6 + rng() * 1.1;
    addBranch(b, new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(ang) * l, y - 0.15 + rng() * 0.3, Math.sin(ang) * l), 0.05, 0.02, '#6b625a');
  }
  const y0 = H * (0.42 + rng() * 0.06), y1 = H - 2.6, tiers = lod ? 5 : 8 + variant;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), y = lerp(y0, y1, t) + (rng() - 0.5) * 0.8;
    const R = lerp(4.2, 1.6, Math.pow(t, 0.9)) * (0.75 + rng() * 0.45), hc = lerp(1.9, 1.5, t) * (lod ? 1.4 : 1);
    const off = (0.35 + rng() * 0.9) * (1 - t * 0.5), oa = rng() * 6.28;   // plumes sit off-centre: the pine's ragged layers
    const geo = new THREE.ConeGeometry(R, hc, lod ? 6 : 9, 1, false);
    geo.scale(1, 1, 0.75 + rng() * 0.35);
    jitterGeometry(geo, R * 0.16, 71 + i + variant * 5);
    const bv = 0.9 + rng() * 0.18, yBot = y, cx = Math.cos(oa) * off, cz = Math.sin(oa) * off;
    b.add(geo, matrix(cx, y + hc * 0.5, cz, 0, rng() * 6.28, 0), {
      tint: 1,
      colorFn: (p, n) => { const k = clamp((p.y - yBot) / hc, 0, 1); const m = (0.48 + 0.6 * k + 0.12 * Math.max(n.y, 0)) * bv * (0.85 + 0.3 * t); return tc.setRGB(m * 0.95, m, m * 1.04); },
    });
    if (!lod && i < tiers - 2) addBranch(b, new THREE.Vector3(0, y + 0.3, 0), new THREE.Vector3(cx * 1.6, y + 0.5, cz * 1.6), 0.09, 0.04, BARK.pine[1]);
    if (snow) {
      const cap = new THREE.ConeGeometry(R * 0.62, hc * 0.42, lod ? 6 : 9, 1, false);
      b.add(cap, matrix(cx, y + hc * 0.78, cz, 0, rng() * 6.28, 0), { tint: 0, colorFn: (p, n) => tc.setRGB(0.88 + 0.1 * Math.max(n.y, 0), 0.92 + 0.07 * Math.max(n.y, 0), 0.97) });
    }
  }
  const lead = new THREE.ConeGeometry(0.6, lod ? 3.4 : 2.8, lod ? 5 : 6);
  b.add(lead, matrix(0.3, H - 0.6, 0.1, 0.06, 0, 0.04), { tint: 1, colorFn: () => tc.setRGB(1.0, 1.05, 1.0) });
  return { geo: b.build({ smoothNormals: !lod }), H: H + 1, rBase };
}
function buildMatureBirch(variant, lod) {
  const rng = mulberry32(450 + variant * 13 + lod);
  const b = new GeoBuilder();
  const H = 16 + variant * 1.5, rBase = 0.21;
  addTrunk(b, { h: H, rBase, rTop: 0.05, flare: 1.35, birch: true, bark: BARK.birch, segs: lod ? 5 : 7, rings: lod ? 5 : Math.round(H / 0.7) });
  const clear = H * 0.55, cy = (clear + H) / 2 + 0.6, yMin = clear - 1, yMax = H + 2;
  if (!lod) for (let k = 0; k < 4; k++) { const ang = k * 1.6 + rng(); addBranch(b, new THREE.Vector3(0, clear + rng() * 2, 0), new THREE.Vector3(Math.cos(ang) * 2.0, cy + rng() * 2, Math.sin(ang) * 2.0), 0.08, 0.03, '#d8d1c0'); }
  crownBlobs(b, rng, lod ? 4 : 7, 0, cy, 2.4, (H - clear) / 2, 1.5 * (lod ? 1.2 : 1), 2.1 * (lod ? 1.2 : 1), { detail: lod ? 0 : 1, seed: 81 + variant, yMin, yMax, jitter: 0.18 });
  return { geo: b.build({ smoothNormals: !lod }), H: H + 1.5, rBase };
}

// ---------------------------------------------------------------------------
// Winter: bare, branching deciduous trees (recursive limbs, a line of snow along the near-level ones)
// ---------------------------------------------------------------------------
function growLimb(b, rng, a, dir, len, rad, depth, o) {
  const tip = a.clone().addScaledVector(dir, len);
  const rTip = rad * o.taper;
  addBranch(b, a, tip, rad, rTip, depth >= 2 ? o.twig : o.bark);
  if (o.snow && depth <= 2 && Math.abs(dir.y) < 0.6 && len > 0.9) {
    const up = new THREE.Vector3(0, rad * 0.8, 0);
    addBranch(b, a.clone().add(up), tip.clone().add(up), rad * 0.5, rTip * 0.5, '#f1f5f9');
  }
  if (depth >= o.maxDepth) return;
  const kids = depth === 0 ? o.fan : o.kids;
  for (let i = 0; i < kids; i++) {
    const d = dir.clone();
    const ax = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
    const perp = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    if (!isFinite(perp.x)) perp.set(1, 0, 0);
    const spin = (i / kids) * Math.PI * 2 + rng() * 1.6;
    d.applyAxisAngle(perp, (i === 0 && depth > 0 ? 0.25 : o.spread) * (0.7 + rng() * 0.6));
    d.applyAxisAngle(dir, spin);
    d.y += o.up - (depth >= 2 ? o.droop : 0);
    d.normalize();
    growLimb(b, rng, tip.clone(), d, len * o.lenK * (0.82 + rng() * 0.36), rTip * o.radK, depth + 1, o);
  }
}

function buildBare(spName, variant, lod) {
  const rng = mulberry32(900 + variant * 17 + ({ oak: 40, birch: 80, maple_m: 120, oak_m: 160, birch_m: 200 }[spName] || 0) + lod);
  const b = new GeoBuilder();
  const P = {
    maple: { th: 6.0 + variant * 0.5, rB: 0.34 + variant * 0.02, rT: 0.14, y0: 2.8, y1: 6.0, n: 6, elev: [0.5, 0.85], len: 2.7, rad: 0.17, o: { fan: 2, kids: 2, spread: 0.6, lenK: 0.74, radK: 0.62, up: 0.22, droop: 0, maxDepth: 4 } },
    oak: { th: 3.7, rB: 0.52, rT: 0.3, y0: 2.5, y1: 3.9, n: 5, elev: [0.95, 1.3], len: 3.7, rad: 0.27, o: { fan: 3, kids: 3, spread: 0.8, lenK: 0.72, radK: 0.6, up: 0.08, droop: 0.05, maxDepth: 3 } },
    maple_m: { th: 14.5 + variant * 1.2, rB: 0.37, rT: 0.14, y0: 9.5, y1: 13.5, n: 7, elev: [0.35, 0.7], len: 4.4, rad: 0.24, o: { fan: 2, kids: 2, spread: 0.55, lenK: 0.72, radK: 0.62, up: 0.25, droop: 0, maxDepth: 4 } },
    oak_m: { th: 11.5 + variant, rB: 0.47, rT: 0.28, y0: 9, y1: 11.8, n: 6, elev: [0.8, 1.15], len: 6.2, rad: 0.34, o: { fan: 3, kids: 3, spread: 0.75, lenK: 0.7, radK: 0.6, up: 0.12, droop: 0.05, maxDepth: 3 } },
    birch_m: { th: 15 + variant, rB: 0.21, rT: 0.05, y0: 8.5, y1: 15, n: 9, elev: [0.35, 0.6], len: 2.5, rad: 0.065, o: { fan: 2, kids: 2, spread: 0.55, lenK: 0.78, radK: 0.6, up: 0.0, droop: 0.5, maxDepth: 3 } },
    birch: { th: 10.2 + variant * 1.4, rB: 0.17, rT: 0.05, y0: 4.8, y1: 10, n: 8, elev: [0.35, 0.6], len: 2.0, rad: 0.055, o: { fan: 2, kids: 2, spread: 0.55, lenK: 0.78, radK: 0.6, up: 0.0, droop: 0.5, maxDepth: 3 } },
  }[spName];
  const bark = BARK[spName.replace('_m', '')], isBirch = spName.startsWith('birch');
  addTrunk(b, { h: P.th + 0.6, rBase: P.rB, rTop: P.rT, flare: 1.5, birch: isBirch, bark, segs: lod ? 5 : 8, rings: lod ? 2 : isBirch ? Math.round(P.th / 0.7) : 4 });
  const depthCut = lod ? 1 : 0;
  const o = { ...P.o, maxDepth: P.o.maxDepth - depthCut, taper: 0.62, bark: isBirch ? '#d8d1c0' : bark[1], twig: isBirch ? '#5a4a3e' : '#3b2f29', snow: true };
  const count = lod ? Math.max(4, P.n - 2) : P.n;
  for (let i = 0; i < count; i++) {
    const t = (i + rng() * 0.6) / count;
    const y = lerp(P.y0, P.y1, t);
    const ang = i * 2.4 + rng();
    const el = lerp(P.elev[1], P.elev[0], t) * (0.85 + rng() * 0.3);   // lower limbs spread wider, upper ones climb
    const d = new THREE.Vector3(Math.cos(ang) * Math.sin(el), Math.cos(el), Math.sin(ang) * Math.sin(el)).normalize();
    growLimb(b, rng, new THREE.Vector3(0, y, 0), d, P.len * (1.25 - 0.45 * t), P.rad, 0, o);
  }
  growLimb(b, rng, new THREE.Vector3(0, P.th + 0.5, 0), new THREE.Vector3(0.05, 1, 0.05).normalize(), P.len * 0.8, P.rad * 0.7, 1, { ...o, fan: 2 });
  return b.build({ smoothNormals: false });
}

const SPECIES = {
  maple: {
    variants: 2, build: buildMaple, mature: 2, buildMature: buildMatureMaple, hpBase: 4,
    palette: [['#d4341c', 3], ['#e8721c', 4], ['#f2b229', 3], ['#a42a2c', 1.6], ['#7f9a2c', 0.7]],
  },
  oak: {
    variants: 1, build: buildOak, mature: 2, buildMature: buildMatureOak, hpBase: 6,
    palette: [['#a8481f', 3], ['#8a3a1c', 2], ['#c07a2a', 2], ['#7d2b22', 1]],
  },
  pine: {
    variants: 2, build: buildPine, mature: 2, buildMature: buildWhitePine, hpBase: 5,
    palette: [['#2c5a3e', 3], ['#254b3b', 2], ['#356b43', 2]],
  },
  birch: {
    variants: 1, build: buildBirch, mature: 1, buildMature: buildMatureBirch, hpBase: 2,
    palette: [['#f1c13a', 3], ['#f7dd6b', 2], ['#cfc24a', 1.2]],
  },
};

// ---------------------------------------------------------------------------
// Stump (shared by all species, scaled per tree)
// ---------------------------------------------------------------------------
function buildStump() {
  const b = new GeoBuilder();
  const side = new THREE.Color('#5b4838');
  const pts = [new THREE.Vector2(1.18, 0), new THREE.Vector2(1.04, 0.14), new THREE.Vector2(0.98, 0.5)];
  const lathe = new THREE.LatheGeometry(pts, 9);
  b.add(lathe, matrix(0, 0, 0), {
    faceColorFn: (c) => {
      const a = Math.atan2(c.z, c.x);
      const s = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 9);
      return tc.copy(side).multiplyScalar(0.8 + 0.3 * hash2(s, 1, 2));
    },
  });
  const top = new THREE.CircleGeometry(0.98, 9);
  top.rotateX(-Math.PI / 2);
  const cream = new THREE.Color('#e3c590'), ring = new THREE.Color('#c79a5e');
  b.add(top, matrix(0, 0.5, 0), {
    colorFn: (p) => {
      const r = Math.hypot(p.x, p.z);
      const band = Math.floor(r * 4.5) % 2;
      return tc.copy(band ? ring : cream);
    },
  });
  return b.build();
}


// ---------------------------------------------------------------------------
// Public API for the streamed forest
// ---------------------------------------------------------------------------
export { SPECIES, buildStump };

/** Build every tree model once: {maple:[{geo, geoFar, H, rBase, mature?}, ...], oak:[...], ...}: the young forms, then the mature */
export function buildTreeModels() {
  const out = {};
  for (const [name, sp] of Object.entries(SPECIES)) {
    out[name] = [];
    for (let v = 0; v < sp.variants; v++) {
      const near = sp.build(v, 0);
      const far = sp.build(v, 1);
      if (IS_WINTER && name !== 'pine') {
        out[name].push({ geo: buildBare(name, v, 0), geoFar: buildBare(name, v, 1), H: near.H, rBase: near.rBase });
        continue;
      }
      out[name].push({ geo: near.geo, geoFar: far.geo, H: near.H, rBase: near.rBase });
    }
    for (let v = 0; v < (sp.mature || 0); v++) {   // the grown-up forms, after the young ones: { mature: true }
      const near = sp.buildMature(v, 0), far = sp.buildMature(v, 1);
      if (IS_WINTER && name !== 'pine') { out[name].push({ geo: buildBare(`${name}_m`, v, 0), geoFar: buildBare(`${name}_m`, v, 1), H: near.H, rBase: near.rBase, mature: true }); continue; }
      out[name].push({ geo: near.geo, geoFar: far.geo, H: near.H, rBase: near.rBase, mature: true });
    }
  }
  return out;
}

/**
 * Pick a tint for a tree. Neighbours share hues (painterly clumps), and the
 * red maples crowd the wet ground around the reservoir where they colour first.
 * wet: 0..1 how close to the water, rng: () => [0,1)
 */
/** a handful of red maples by the water that flare brighter than all the rest in autumn (the leaf-peeping prize) */
export function isPeakMaple(x, z) { const h = Math.abs(Math.sin(Math.round(x * 10) * 12.9898 + Math.round(z * 10) * 78.233) * 43758.5453) % 1; return h > 0.985; }
export function treeColor(sp, x, z, wet, rng) {
  if (sp === 'maple' && IS_AUTUMN && wet > 0.35 && isPeakMaple(x, z)) return new THREE.Color('#ff3018').multiplyScalar(1.1);
  let pal = SEASON_DEF.palette?.[sp] ?? SPECIES[sp].palette;
  if (sp === 'maple' && IS_AUTUMN) {
    // red maples (wet) run scarlet/crimson; sugar maples (dry) run orange/gold
    pal = [
      ['#d4341c', 1.2 + 3.2 * wet], ['#a42a2c', 0.4 + 2.0 * wet], ['#e8721c', 3.2 - 1.8 * wet],
      ['#f2b229', 2.8 - 1.6 * wet], ['#7f9a2c', 0.5],
    ];
  }
  const cn = fbm(x * 0.045 + 31, z * 0.045 - 17, 2, 41);
  const r = clamp(cn * 1.05 + (rng() - 0.5) * 0.35, 0, 0.999);
  let total = 0;
  for (const p of pal) total += p[1];
  let acc = 0, color = pal[0][0];
  for (const p of pal) {
    acc += p[1] / total;
    if (r <= acc) { color = p[0]; break; }
  }
  return new THREE.Color(color).multiplyScalar(0.9 + rng() * 0.2);
}
