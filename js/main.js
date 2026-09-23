// ABLE — concept redesign
// One fixed WebGL canvas, directed by scroll. Everything that moves is driven by a
// procedural sagittal-plane gait model, so the figure, the Marey ghosts, the
// footprints, the HUD and the gait chart all read from the same numbers.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import Lenis from 'lenis';
import { LAND } from './land.js';

/* ============================================================
   Utilities
   ============================================================ */
const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const mod = (x, m = 1) => ((x % m) + m) % m;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => innerWidth < 760;

const loader = {
  bar: $('#loader-bar'), pct: $('#loader-pct'),
  set(v) { this.bar.style.transform = `scaleX(${v})`; this.pct.textContent = Math.round(v * 100) + '%'; },
  done() { $('#loader').classList.add('done'); },
};
loader.set(0.15);

/* ============================================================
   Gait model
   Periodic cubic-Hermite curves through typical sagittal joint
   angles (degrees) over one gait cycle, right leg; left = +50%.
   ============================================================ */
function periodic(keys) {
  const n = keys.length, xs = keys.map(k => k[0]), ys = keys.map(k => k[1] * D2R);
  const X = i => xs[mod(i, n)] + Math.floor(i / n);
  const Y = i => ys[mod(i, n)];
  const m = ys.map((_, i) => {
    const d0 = (Y(i) - Y(i - 1)) / (X(i) - X(i - 1));
    const d1 = (Y(i + 1) - Y(i)) / (X(i + 1) - X(i));
    return (d0 + d1) / 2;
  });
  return p => {
    p = mod(p);
    let i = 0;
    for (let j = 0; j < n; j++) if (xs[j] <= p) i = j;
    const x1 = X(i), x2 = X(i + 1), h = x2 - x1, t = (p - x1) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y(i) + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * Y(i + 1) + (t3 - t2) * h * m[(i + 1) % n];
  };
}
const HIP = periodic([[0, 20], [.1, 18], [.3, 3], [.5, -8], [.6, -1], [.7, 15], [.87, 22]]);
const KNEE = periodic([[0, 4], [.14, 15], [.3, 6], [.42, 5], [.6, 34], [.71, 60], [.8, 50], [.9, 18], [.97, 5]]);
const ANK = periodic([[0, 0], [.08, -5], [.3, 5], [.46, 8], [.6, -10], [.7, 4], [.8, 9], [.9, 4]]);
const HIP_MEAN = 6 * D2R, KNEE_MIN = 5 * D2R;

// Segment dimensions (m)
const L1 = .44, L2 = .43, AH = .075, HEEL = .06, TOE = .19, HIPW = .1, SOLE = .012;
const UA = .30, FA = .30, CR = .84, XPLANT = .42;

function legAngles(p, amp, out) {
  out[0] = HIP_MEAN + (HIP(p) - HIP_MEAN) * amp;
  out[1] = KNEE_MIN + (KNEE(p) - KNEE_MIN) * amp;
  out[2] = ANK(p) * amp;
  return out;
}
function leg2D(ang, o) {
  const [h, k, a] = ang;
  o.kx = L1 * Math.sin(h); o.ky = -L1 * Math.cos(h);
  const s = h - k;
  o.ax = o.kx + L2 * Math.sin(s); o.ay = o.ky - L2 * Math.cos(s);
  const f = s + a, c = Math.cos(f), sn = Math.sin(f);
  o.hx = o.ax - HEEL * c + AH * sn; o.hy = o.ay - HEEL * sn - AH * c;
  o.tx = o.ax + TOE * c + AH * sn; o.ty = o.ay + TOE * sn - AH * c;
  o.h = h; o.k = k; o.a = a; o.f = f;
  return o;
}
const _ang = [0, 0, 0], _R = {}, _L = {};
function legsAt(p, amp) {
  leg2D(legAngles(p, amp, _ang), _R);
  leg2D(legAngles(p + .5, amp, _ang), _L);
}
function contactCode(p, amp) {
  legsAt(p, amp);
  let m = _R.hy, c = 0;
  if (_R.ty < m) { m = _R.ty; c = 1; }
  if (_L.hy < m) { m = _L.hy; c = 2; }
  if (_L.ty < m) { c = 3; }
  return c;
}
function contactX(p, amp, c) {
  legsAt(p, amp);
  return c === 0 ? _R.hx : c === 1 ? _R.tx : c === 2 ? _L.hx : _L.tx;
}
// Ground displacement between two phases: the planted point must not skate.
function groundDelta(p0, p1, amp) {
  const n = Math.max(1, Math.ceil(Math.abs(p1 - p0) / .01));
  let d = 0;
  for (let i = 0; i < n; i++) {
    const a = p0 + (p1 - p0) * i / n, b = p0 + (p1 - p0) * (i + 1) / n;
    const c = contactCode(b, amp);
    d += contactX(b, amp, c) - contactX(a, amp, c);
  }
  return d;
}
// Cumulative ground-displacement table for one cycle (used by ghosts & crutches).
const DT = { amp: -1, N: 200, tab: new Float32Array(201), tot: 0 };
function ensureDTable(amp) {
  if (Math.abs(DT.amp - amp) < .004) return;
  DT.amp = amp; DT.tab[0] = 0;
  for (let i = 0; i < DT.N; i++) DT.tab[i + 1] = DT.tab[i] + groundDelta(i / DT.N, (i + 1) / DT.N, amp);
  DT.tot = DT.tab[DT.N];
}
function Dfun(q) {
  const f = Math.floor(q), r = (q - f) * DT.N, i = Math.floor(r), t = r - i;
  return f * DT.tot + lerp(DT.tab[i], DT.tab[Math.min(i + 1, DT.N)], t);
}

/* ---------- full-body pose ---------- */
const V3 = () => new THREE.Vector3();
function makePose() {
  const leg = () => ({ hip: V3(), knee: V3(), ankle: V3(), heel: V3(), toe: V3(), f: 0, h: 0, k: 0, a: 0 });
  const cr = () => ({ tip: V3(), handle: V3(), elbow: V3(), cuff: V3(), dir: V3() });
  return { py: 0, lean: 0, pelvis: V3(), neck: V3(), head: V3(), shL: V3(), shR: V3(), L: leg(), R: leg(), cL: cr(), cR: cr() };
}
function setLeg(o, l, py, z) {
  o.hip.set(0, py, z); o.knee.set(l.kx, py + l.ky, z); o.ankle.set(l.ax, py + l.ay, z);
  o.heel.set(l.hx, py + l.hy, z); o.toe.set(l.tx, py + l.ty, z);
  o.f = l.f; o.h = l.h; o.k = l.k; o.a = l.a;
}
const _v = V3(), _w = V3(), _d = V3(), _pp = V3(), _pole = V3();
function ik(S, T, a, b, pole, outE) {
  _d.subVectors(T, S);
  let d = _d.length();
  const dir = _d.divideScalar(d || 1);
  d = clamp(d, .05, a + b - .002);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  outE.copy(S).addScaledVector(dir, a * cosA).addScaledVector(_pp, a * sinA);
}
// Four-point crutch pattern: each crutch plants and rides the ground, then swings ahead.
function crutch(p, C, sh, side, ws, we) {
  const q = we + mod(p - we), lift = ws + 1;
  let x, y = 0;
  if (q < lift) x = XPLANT + (Dfun(q) - Dfun(we));
  else {
    const t = (q - lift) / (we - ws);
    const xl = XPLANT + (Dfun(lift) - Dfun(we));
    x = lerp(xl, XPLANT, easeIO(t)); y = .09 * Math.sin(Math.PI * t);
  }
  C.tip.set(x, y, side * .31);
  _v.set(sh.x + .03, sh.y - .55, side * .27).sub(C.tip).normalize();
  C.dir.copy(_v);
  C.handle.copy(C.tip).addScaledVector(_v, CR);
  ik(sh, C.handle, UA, FA, _pole.set(-1, -.3, side * .8), C.elbow);
  _w.subVectors(C.elbow, C.handle).normalize();
  C.cuff.copy(C.handle).addScaledVector(_w, .19);
}
function computePose(p, amp, P) {
  legsAt(p, amp);
  const py = -Math.min(_R.hy, _R.ty, _L.hy, _L.ty) + SOLE;
  P.py = py;
  setLeg(P.R, _R, py, -HIPW);
  setLeg(P.L, _L, py, HIPW);
  const lean = (7 + 1.5 * Math.sin(TAU * 2 * p + 1.2)) * D2R;
  P.lean = lean;
  const ux = Math.sin(lean), uy = Math.cos(lean);
  const pc = P.pelvis.set(0, py + .05, 0);
  P.neck.set(pc.x + ux * .46, pc.y + uy * .46, 0);
  P.head.set(pc.x + ux * .66 + .01, pc.y + uy * .66, 0);
  P.shL.set(pc.x + ux * .42, pc.y + uy * .42, .19);
  P.shR.set(pc.x + ux * .42, pc.y + uy * .42, -.19);
  crutch(p, P.cL, P.shL, 1, .4, .7);
  crutch(p, P.cR, P.shR, -1, .9, 1.2);
  return P;
}

/* ============================================================
   Renderer, scene, post
   ============================================================ */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, 1.75);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const BG = new THREE.Color('#07080a');
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 7, 17);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = .38;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, .05, 60);
camera.position.set(3.4, 1.25, 4.6);

const key = new THREE.DirectionalLight('#fff4ea', 1.9);
key.position.set(2.5, 5, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: .5, far: 14 });
key.shadow.bias = -.0004; key.shadow.normalBias = .02; key.shadow.radius = 5;
scene.add(key);
const rim = new THREE.DirectionalLight('#ff8a5c', 2.2);
rim.position.set(-4, 2.4, -3); scene.add(rim);
const rim2 = new THREE.DirectionalLight('#9bb8ff', .9);
rim2.position.set(-2, 3, 4); scene.add(rim2);
scene.add(new THREE.HemisphereLight('#8ea3c4', '#0a0806', .35));

loader.set(.3);

/* ============================================================
   Materials
   ============================================================ */
const ACCENT = new THREE.Color('#ff5b1f');
const MAT = {
  body: new THREE.MeshPhysicalMaterial({ color: '#d8d2c9', roughness: .52, clearcoat: .25, clearcoatRoughness: .5, sheen: .4, sheenColor: '#ffffff', sheenRoughness: .6 }),
  carbon: new THREE.MeshPhysicalMaterial({ color: '#15171b', roughness: .32, metalness: .25, clearcoat: 1, clearcoatRoughness: .12 }),
  alu: new THREE.MeshStandardMaterial({ color: '#a9aeb6', roughness: .28, metalness: 1 }),
  strap: new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: .92, side: THREE.DoubleSide }),
  shoe: new THREE.MeshStandardMaterial({ color: '#16181b', roughness: .75 }),
  accent: new THREE.MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 2.4, roughness: .4 }),
  crutch: new THREE.MeshStandardMaterial({ color: '#8d939c', roughness: .3, metalness: .9 }),
  grip: new THREE.MeshStandardMaterial({ color: '#202226', roughness: .8 }),
};
for (const m of Object.values(MAT)) m.userData.base = m.opacity;

/* ============================================================
   Figure
   ============================================================ */
const figure = new THREE.Group();
scene.add(figure);
const bones = {};
const exoParts = [];
const anchors = {};

const Z = new THREE.Vector3(0, 0, 1);
const _x = V3(), _y = V3(), _z = V3(), _m4 = new THREE.Matrix4();
function setBone(o, A, B, hint = Z) {
  _y.subVectors(A, B).normalize();
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m4.makeBasis(_x, _y, _z);
  o.quaternion.setFromRotationMatrix(_m4);
  o.position.copy(A);
}
function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = false;
  return m;
}
function limb(r1, r2, len, mat) {
  const g = new THREE.CylinderGeometry(r1, r2, len, 32, 1);
  g.translate(0, -len / 2, 0);
  return mesh(g, mat);
}
function ball(r, mat) { return mesh(new THREE.SphereGeometry(r, 28, 18), mat); }
function ellipsoid(sx, sy, sz, mat) { const m = ball(1, mat); m.scale.set(sx, sy, sz); return m; }
function discZ(r, h, mat, seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, h, seg); g.rotateX(Math.PI / 2);
  return mesh(g, mat);
}
function cuff(r, h, mat, start = Math.PI * .75, len = Math.PI * 1.5) {
  return mesh(new THREE.CylinderGeometry(r, r * .97, h, 36, 1, true, start, len), mat);
}
function exo(parent, obj, explode, name) {
  obj.userData.base = obj.position.clone();
  obj.userData.explode = explode;
  parent.add(obj); exoParts.push(obj);
  if (name) anchors[name] = obj;
  return obj;
}
function at(o, x, y, z) { o.position.set(x, y, z); return o; }
function bone(name) { const b = new THREE.Group(); figure.add(b); bones[name] = b; return b; }

function buildLeg(side, tag) {
  const s = side, zo = s * .094;
  // thigh
  const th = bone('thigh' + tag);
  th.add(limb(.079, .056, L1, MAT.body));
  exo(th, at(mesh(new THREE.BoxGeometry(.03, .36, .012), MAT.carbon), 0, -.22, zo), new THREE.Vector3(0, 0, s * .16), tag === 'L' ? 'upright' : null);
  exo(th, at(discZ(.046, .03, MAT.alu), 0, 0, s * .1), new THREE.Vector3(0, 0, s * .26), tag === 'L' ? 'hip' : null);
  const hipRing = at(mesh(new THREE.TorusGeometry(.046, .003, 8, 48), MAT.accent, false), 0, 0, s * .116);
  exo(th, hipRing, new THREE.Vector3(0, 0, s * .26));
  exo(th, at(cuff(.088, .06, MAT.strap), 0, -.11, 0), new THREE.Vector3(.12, 0, s * .06));
  exo(th, at(cuff(.083, .055, MAT.strap), 0, -.32, 0), new THREE.Vector3(.12, 0, s * .06));
  // knee actuator: housing + glowing ring
  exo(th, at(discZ(.062, .048, MAT.carbon), 0, -L1, s * .1), new THREE.Vector3(0, 0, s * .34), tag === 'L' ? 'knee' : null);
  exo(th, at(mesh(new THREE.TorusGeometry(.061, .0045, 10, 64), MAT.accent, false), 0, -L1, s * .125), new THREE.Vector3(0, 0, s * .34));
  // shin
  const sh = bone('shin' + tag);
  sh.add(ball(.057, MAT.body));
  sh.add(limb(.055, .04, L2, MAT.body));
  sh.add(at(ball(.042, MAT.body), 0, -L2, 0));
  exo(sh, at(mesh(new THREE.BoxGeometry(.028, .34, .012), MAT.carbon), 0, -.21, s * .082), new THREE.Vector3(0, 0, s * .18));
  exo(sh, at(cuff(.068, .06, MAT.strap), 0, -.15, 0), new THREE.Vector3(.12, 0, s * .06), tag === 'L' ? 'cuff' : null);
  exo(sh, at(mesh(new THREE.BoxGeometry(.022, .09, .012), MAT.alu), 0, -.4, s * .07), new THREE.Vector3(0, 0, s * .18));
  // rotating dial on the knee: it turns with the shank, so the articulation reads at a glance
  const dial = new THREE.Group(); dial.position.set(0, 0, s * .135);
  dial.add(discZ(.04, .012, MAT.alu));
  const tick = mesh(new THREE.BoxGeometry(.008, .03, .006), MAT.accent, false);
  tick.position.set(0, -.024, s * .007); dial.add(tick);
  exo(sh, dial, new THREE.Vector3(0, 0, s * .42));
  // foot
  const ft = bone('foot' + tag);
  const shoe = mesh(new THREE.CapsuleGeometry(.047, .17, 8, 20), MAT.shoe);
  shoe.rotation.z = Math.PI / 2; shoe.scale.set(.82, 1, 1.12); shoe.position.set(.065, -.036, 0);
  ft.add(shoe);
  exo(ft, at(mesh(new THREE.BoxGeometry(.28, .008, .1), MAT.carbon), .065, -.072, 0), new THREE.Vector3(0, -.08, 0));
  exo(ft, at(mesh(new THREE.BoxGeometry(.05, .07, .01), MAT.alu), 0, -.035, s * .065), new THREE.Vector3(0, 0, s * .18));
}
buildLeg(1, 'L');
buildLeg(-1, 'R');

function buildArm(tag) {
  const ua = bone('upper' + tag);
  ua.add(ball(.056, MAT.body)); ua.add(limb(.05, .04, UA, MAT.body));
  const fa = bone('fore' + tag);
  fa.add(ball(.042, MAT.body)); fa.add(limb(.04, .031, FA, MAT.body));
  fa.add(at(ball(.038, MAT.body), 0, -FA, 0));
  // forearm crutch
  const shaft = bone('shaft' + tag);
  shaft.add(limb(.011, .011, CR, MAT.crutch));
  shaft.add(at(limb(.017, .02, .05, MAT.grip), 0, -CR + .05, 0));
  const grip = mesh(new THREE.CylinderGeometry(.014, .014, .12, 12), MAT.grip);
  grip.rotation.z = Math.PI / 2; grip.position.set(.05, 0, 0); shaft.add(grip);
  const cuffB = bone('cuff' + tag);
  cuffB.add(limb(.009, .009, .19, MAT.crutch));
  const ring = cuff(.05, .05, MAT.grip, Math.PI * .6, Math.PI * 1.3);
  cuffB.add(ring);
  if (tag === 'L') anchors.crutch = ring;
}
buildArm('L');
buildArm('R');

// torso (pelvis group does not rotate, torso group leans)
const pelvisG = new THREE.Group(); figure.add(pelvisG);
pelvisG.add(ellipsoid(.135, .12, .175, MAT.body));
const belt = new THREE.Group();
exo(pelvisG, belt, new THREE.Vector3(-.18, 0, 0));
const beltM = cuff(.17, .075, MAT.carbon, Math.PI / 2 + .95, TAU - 1.9);
beltM.scale.set(1, 1, 1.18); beltM.position.y = -.01; belt.add(beltM);
const ctrl = mesh(new THREE.BoxGeometry(.05, .11, .15), MAT.carbon);
ctrl.position.set(-.18, .0, 0); belt.add(ctrl);
const led = mesh(new THREE.BoxGeometry(.004, .012, .09), MAT.accent, false);
led.position.set(-.206, .03, 0); belt.add(led);

const torso = new THREE.Group(); figure.add(torso);
torso.add(at(ellipsoid(.125, .15, .155, MAT.body), 0, .17, 0));
torso.add(at(ellipsoid(.14, .16, .2, MAT.body), .005, .33, 0));
torso.add(at(limb(.045, .05, .12, MAT.body), 0, .56, 0));
const head = ellipsoid(.098, .115, .096, MAT.body); head.position.set(.012, .66, 0); torso.add(head);

// contact shadow + floor glow
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: .55, transparent: true }));
shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.receiveShadow = true; shadowPlane.position.y = .001;
scene.add(shadowPlane);

function radialTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: radialTex('rgba(255,120,70,.55)', 'rgba(255,120,70,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .35 }));
pool.rotation.x = -Math.PI / 2; pool.position.y = .002; scene.add(pool);

/* ---------- ground grid (scrolls with the stance foot) ---------- */
const gridMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uOffset: { value: 0 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color('#d9d4cc') }, uAccent: { value: ACCENT } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `
    uniform float uOffset, uOpacity; uniform vec3 uColor, uAccent; varying vec3 vW;
    float gridLine(vec2 p, float s){ vec2 q = p/s; vec2 g = abs(fract(q-.5)-.5)/fwidth(q); return 1.-min(min(g.x,g.y),1.); }
    void main(){
      vec2 p = vec2(vW.x - uOffset, vW.z);
      float minor = gridLine(p, .25), major = gridLine(p, 1.);
      float d = length(vW.xz*vec2(.8,1.));
      float fade = smoothstep(8.5, 1.2, d);
      // walkway edges + metre ticks
      float near = smoothstep(4.5, 1.5, abs(vW.x));
      float edge = (1.-smoothstep(0.,fwidth(vW.z)*1.5, abs(abs(vW.z)-.55))) * near;
      float tick = near * step(abs(abs(vW.z)-.55), .06) * (1.-min(abs(fract(p.x-.5)-.5)/fwidth(p.x),1.));
      vec3 col = mix(uColor, uAccent, clamp(edge+tick,0.,1.));
      float a = (minor*.05 + major*.13 + edge*.22 + tick*.5) * fade * uOpacity;
      gl_FragColor = vec4(col, a);
    }`,
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), gridMat);
grid.rotation.x = -Math.PI / 2; grid.position.y = .0015; scene.add(grid);

/* ---------- gait lab backdrop + angle arcs ---------- */
const labMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uOpacity: { value: 0 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `
    uniform float uOpacity; varying vec3 vW;
    float gl(vec2 p,float s){ vec2 q=p/s; vec2 g=abs(fract(q-.5)-.5)/fwidth(q); return 1.-min(min(g.x,g.y),1.); }
    void main(){
      vec2 p = vW.xy;
      float a = gl(p,.1)*.05 + gl(p,.5)*.16;
      float fade = smoothstep(3.2,.6,abs(p.x)) * smoothstep(2.3,1.6,p.y);
      float axis = (1.-min(abs(p.x)/fwidth(p.x),1.))*.35;
      gl_FragColor = vec4(vec3(.85,.82,.78), (a+axis)*fade*uOpacity);
    }`,
});
const lab = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), labMat);
lab.position.set(0, 1.3, -.9); scene.add(lab);

const lineMats = [];
function fatLine(nSeg, opts) {
  const g = new LineSegmentsGeometry();
  g.setPositions(new Float32Array(nSeg * 6));
  if (opts.vertexColors) g.setColors(new Float32Array(nSeg * 6));
  const m = new LineMaterial({ linewidth: 1.5, transparent: true, depthWrite: false, ...opts });
  m.resolution.set(innerWidth, innerHeight);
  lineMats.push(m);
  const l = new LineSegments2(g, m);
  l.frustumCulled = false;
  return l;
}
function linePositions(l) { return l.geometry.attributes.instanceStart.data; }
function lineColors(l) { return l.geometry.attributes.instanceColorStart.data; }

const ARC_N = 28;
const kneeArc = fatLine(ARC_N + 2, { color: ACCENT, linewidth: 2 });
const hipArc = fatLine(ARC_N + 2, { color: new THREE.Color('#8fb7ff'), linewidth: 2 });
scene.add(kneeArc, hipArc);
function writeArc(line, c, a0, a1, r, z) {
  const buf = linePositions(line), arr = buf.array;
  let o = 0;
  const push = (x1, y1, x2, y2) => { arr[o++] = x1; arr[o++] = y1; arr[o++] = z; arr[o++] = x2; arr[o++] = y2; arr[o++] = z; };
  for (let i = 0; i < ARC_N; i++) {
    const t0 = lerp(a0, a1, i / ARC_N), t1 = lerp(a0, a1, (i + 1) / ARC_N);
    push(c.x + Math.cos(t0) * r, c.y + Math.sin(t0) * r, c.x + Math.cos(t1) * r, c.y + Math.sin(t1) * r);
  }
  // the two rays
  push(c.x, c.y, c.x + Math.cos(a0) * r * 1.7, c.y + Math.sin(a0) * r * 1.7);
  push(c.x, c.y, c.x + Math.cos(a1) * r * 1.7, c.y + Math.sin(a1) * r * 1.7);
  buf.needsUpdate = true;
}

/* ---------- Marey ghosts ---------- */
const GHOSTS = 7, GHOST_DP = .1, GHOST_SPREAD = .2;
const SEGS = P => [
  [P.pelvis, P.neck], [P.neck, P.head], [P.shL, P.shR],
  [P.shL, P.cL.elbow], [P.cL.elbow, P.cL.handle], [P.shR, P.cR.elbow], [P.cR.elbow, P.cR.handle],
  [P.L.hip, P.R.hip],
  [P.L.hip, P.L.knee], [P.L.knee, P.L.ankle], [P.L.ankle, P.L.heel], [P.L.heel, P.L.toe], [P.L.toe, P.L.ankle],
  [P.R.hip, P.R.knee], [P.R.knee, P.R.ankle], [P.R.ankle, P.R.heel], [P.R.heel, P.R.toe], [P.R.toe, P.R.ankle],
];
const JOINTS = P => [P.head, P.neck, P.shL, P.shR, P.cL.elbow, P.cR.elbow, P.cL.handle, P.cR.handle, P.L.hip, P.R.hip, P.L.knee, P.R.knee, P.L.ankle, P.R.ankle, P.L.toe, P.R.toe];
const NSEG = 18, NJ = 16;
const dotTex = radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
const ghosts = [];
const ghostPose = makePose();
for (let i = 0; i < GHOSTS; i++) {
  const l = fatLine(NSEG, { color: new THREE.Color('#f3efe8'), linewidth: 1.6, blending: THREE.AdditiveBlending });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NJ * 3), 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: ACCENT, size: 7, sizeAttenuation: false, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  scene.add(l, pts);
  ghosts.push({ l, pts });
}
function writeGhost(g, P, dx, op) {
  const buf = linePositions(g.l), a = buf.array;
  let o = 0;
  for (const [A, B] of SEGS(P)) { a[o++] = A.x + dx; a[o++] = A.y; a[o++] = A.z; a[o++] = B.x + dx; a[o++] = B.y; a[o++] = B.z; }
  buf.needsUpdate = true;
  const pa = g.pts.geometry.attributes.position; o = 0;
  for (const J of JOINTS(P)) { pa.array[o++] = J.x + dx; pa.array[o++] = J.y; pa.array[o++] = J.z; }
  pa.needsUpdate = true;
  g.l.material.opacity = op; g.pts.material.opacity = op * 1.3;
  g.l.visible = g.pts.visible = op > .003;
}

/* ---------- motion trails (ankle + knee paths, in ground coordinates) ---------- */
const TRAIL_N = 110;
const trails = [
  { get: P => P.L.ankle, pts: [], line: fatLine(TRAIL_N - 1, { vertexColors: true, linewidth: 2.2, blending: THREE.AdditiveBlending }), col: new THREE.Color('#ff5b1f') },
  { get: P => P.L.knee, pts: [], line: fatLine(TRAIL_N - 1, { vertexColors: true, linewidth: 1.4, blending: THREE.AdditiveBlending }), col: new THREE.Color('#ffc2a6') },
];
trails.forEach(t => scene.add(t.line));

/* ---------- footprints (progress over sessions) ---------- */
const printTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 160;
  const g = c.getContext('2d'); g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(32, 52, 22, 44, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(32, 128, 17, 26, 0, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); return t;
})();
const prints = [];
const printGeo = new THREE.PlaneGeometry(.11, .27);
for (let i = 0; i < 44; i++) {
  const m = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ map: printTex, color: ACCENT, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.PI / 2; m.position.y = .003; m.visible = false;
  scene.add(m); prints.push({ m, xg: 0, z: 0, s: 1, born: 0 });
}
let printIdx = 0;

loader.set(.5);

/* ============================================================
   Globe
   ============================================================ */
const SITES = [
  { n: 'Barcelona, ES', s: 'ABLE Human Motion HQ', lat: 41.389, lon: 2.17, t: 'HQ', label: true, off: [14, -4] },
  { n: 'Badalona, ES', s: 'Institut Guttmann', lat: 41.45, lon: 2.247, t: 'Clinical study' },
  { n: 'Heidelberg, DE', s: 'Heidelberg University Hospital', lat: 49.418, lon: 8.67, t: 'Clinical study', label: true, off: [16, -2] },
  { n: 'Netherlands', s: 'Neurorehabilitation hospital', lat: 52.09, lon: 5.12, t: 'Validation', label: true, tbc: true, off: [10, -58] },
  { n: 'United Kingdom', s: 'Neurorehabilitation hospital', lat: 52.48, lon: -1.9, t: 'Validation', label: true, tbc: true, off: [-196, -30] },
];
function ll2v(lat, lon, r = 1) {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
const globe = new THREE.Group(); globe.position.set(0, 1, 0); scene.add(globe);
const gTilt = new THREE.Group(), gSpin = new THREE.Group();
globe.add(gTilt); gTilt.add(gSpin);
const globeMats = [];
{
  const bin = atob(LAND), bits = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
  const land = (lat, lon) => {
    const x = clamp(Math.floor(lon + 180), 0, 359), y = clamp(Math.floor(90 - lat), 0, 179), i = y * 360 + x;
    return (bits[i >> 3] >> (7 - (i & 7))) & 1;
  };
  const pos = [], hi = [];
  const sitesV = SITES.map(s => ll2v(s.lat, s.lon));
  for (let lat = -58; lat <= 80; lat += 1.15) {
    const step = 1.15 / Math.max(.2, Math.cos(lat * D2R));
    for (let lon = -180; lon < 180; lon += step) {
      if (!land(lat, lon)) continue;
      const v = ll2v(lat, lon);
      pos.push(v.x, v.y, v.z);
      let h = 0;
      for (const s of sitesV) h = Math.max(h, 1 - clamp(v.distanceTo(s) / .09));
      hi.push(h);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aHi', new THREE.Float32BufferAttribute(hi, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uSize: { value: 10 * DPR }, uOpacity: { value: 0 }, uC1: { value: new THREE.Color('#cfcac2') }, uC2: { value: ACCENT } },
    vertexShader: `attribute float aHi; varying float vA; varying float vHi; uniform float uSize;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vec3 n = normalize(normalMatrix*position);
        vA = smoothstep(-.05,.45,n.z); vHi = aHi; gl_PointSize = uSize*(1.+aHi*.7)/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; varying float vHi; uniform float uOpacity; uniform vec3 uC1, uC2;
      void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard;
        float a = smoothstep(.5,.15,d)*vA*uOpacity*(.5+vHi*.5); gl_FragColor = vec4(mix(uC1,uC2,vHi), a); }`,
  });
  globeMats.push(m);
  gSpin.add(new THREE.Points(g, m));

  const core = new THREE.Mesh(new THREE.SphereGeometry(.985, 64, 48), new THREE.MeshBasicMaterial({ color: '#0b0d10', transparent: true, opacity: 0 }));
  globeMats.push(core.material); core.material.userData.max = .95;
  globe.add(core);
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vN; void main(){ float d = abs(vN.z); float i = pow(smoothstep(0.,.5,d), 4.)*(1.-smoothstep(.5,.62,d)); gl_FragColor = vec4(vec3(1.,.5,.3)*i*uOpacity*.3, 1.); }`,
  }));
  globeMats.push(atm.material);
  globe.add(atm);

  // pins + arcs
  const hq = ll2v(SITES[0].lat, SITES[0].lon);
  SITES.forEach((s, i) => {
    const n = ll2v(s.lat, s.lon);
    const pin = new THREE.Group(); pin.position.copy(n);
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.0025, .0025, .07, 6), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }));
    stem.position.y = .035; pin.add(stem);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(.011, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd2bf', transparent: true, opacity: 0 }));
    headM.position.y = .07; pin.add(headM);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.018, .022, 48), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .002; pin.add(ring);
    gSpin.add(pin);
    s.pin = pin; s.ring = ring; s.mats = [stem.material, headM.material, ring.material]; s.head = headM; s.normal = n;
    if (i > 1) {
      const pts = [];
      for (let k = 0; k <= 64; k++) {
        const t = k / 64;
        const v = hq.clone().lerp(n, t).normalize().multiplyScalar(1 + Math.sin(Math.PI * t) * .09 * hq.distanceTo(n) * 3);
        pts.push(v);
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, .0028, 6), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
      tube.userData.count = tube.geometry.index.count;
      tube.geometry.setDrawRange(0, 0);
      gSpin.add(tube); s.arc = tube;
    }
  });
}
globe.visible = false;

loader.set(.7);

/* ============================================================
   Post-processing
   ============================================================ */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .55, .5, .93);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uStrength: { value: .5 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float v = smoothstep(.95,.2,length((vUv-.5)*vec2(1.1,1.25)));
      c.rgb *= mix(1.-uStrength, 1., v); gl_FragColor = c; }`,
});
composer.addPass(vignette);

/* ============================================================
   DOM: labels, leaders, gait panel, outcomes, calculator, sites
   ============================================================ */
const labelsEl = $('#labels'), leadersEl = $('#leaders');
function mkLabel(html, cls = '') { const d = document.createElement('div'); d.className = 'lbl3d ' + cls; d.innerHTML = html; d.style.opacity = 0; labelsEl.appendChild(d); return d; }
const kneeLbl = mkLabel('Knee <b>0°</b>'), hipLbl = mkLabel('Hip <b>0°</b>');
SITES.forEach(s => { if (s.label) s.el = mkLabel(`${s.n}<small>${s.s}</small>`, 'site'); });

const SVGNS = 'http://www.w3.org/2000/svg';
const callouts = $$('#callouts li').map(li => {
  const line = document.createElementNS(SVGNS, 'line');
  const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', 3.5);
  const halo = document.createElementNS(SVGNS, 'circle'); halo.setAttribute('r', 9); halo.setAttribute('class', 'halo');
  leadersEl.append(line, halo, dot);
  return { li, anchor: li.dataset.anchor, line, dot, halo };
});

// gait panel
const PHASES = [
  [0, 'Initial contact', 'The heel meets the floor. The powered knee is held near full extension so the leg is ready to take weight.'],
  [.02, 'Loading response', 'Body weight moves onto the leading leg and the knee gives a few controlled degrees to absorb it.'],
  [.12, 'Mid-stance', 'The body passes over a stable, supported limb. The crutches share the load through the arms.'],
  [.31, 'Terminal stance', 'The heel rises and the body moves ahead of the foot, ready to push off.'],
  [.5, 'Pre-swing', 'Weight transfers to the other leg and the knee starts to bend.'],
  [.62, 'Initial swing', 'The knee motor drives flexion so the foot clears the ground.'],
  [.75, 'Mid-swing', 'The leg swings through beneath the body, with the knee near its peak bend.'],
  [.87, 'Terminal swing', 'The knee motor extends the leg, ready for the next heel contact.'],
];
const phaseIdx = c => { let i = 0; PHASES.forEach((p, j) => { if (c >= p[0]) i = j; }); return i; };
const gp = { phase: $('#gp-phase'), pct: $('#gp-pct'), desc: $('#gp-desc'), cursor: $('#gp-cursor'), kdot: $('#gp-kdot'), hdot: $('#gp-hdot'), kv: $('#gp-knee-v'), hv: $('#gp-hip-v'), scrub: $('#gp-scrub'), list: $('#gp-phases'), last: -1 };
const cx = c => 10 + c * 300, cy = deg => 118 - deg * (100 / 60);
{
  let dk = '', dh = '';
  for (let i = 0; i <= 200; i++) {
    const c = i / 200, x = cx(c).toFixed(1);
    dk += (i ? 'L' : 'M') + x + ',' + cy(KNEE(c) * R2D).toFixed(1);
    dh += (i ? 'L' : 'M') + x + ',' + cy(HIP(c) * R2D).toFixed(1);
  }
  $('#gp-knee').setAttribute('d', dk);
  $('#gp-hip').setAttribute('d', dh);
  $('#gp-stance').setAttribute('d', `M${cx(0)},8H${cx(.6)}V128H${cx(0)}Z`);
  const gg = $('.gp-grid');
  for (const deg of [0, 20, 40, 60]) { const l = document.createElementNS(SVGNS, 'line'); l.setAttribute('x1', 10); l.setAttribute('x2', 310); l.setAttribute('y1', cy(deg)); l.setAttribute('y2', cy(deg)); gg.appendChild(l); }
  PHASES.forEach((p, i) => {
    const li = document.createElement('li'); li.textContent = p[1]; li.dataset.i = i;
    li.addEventListener('click', () => scrollToGait(p[0] + .01));
    gp.list.appendChild(li);
  });
}

// outcomes ticks
const ticks = $('#sess-ticks');
for (let i = 0; i < 12; i++) ticks.appendChild(document.createElement('i'));
const tickEls = [...ticks.children];
const metricEls = $$('.out-metrics b');

// sites list
$('#sites').innerHTML = SITES.map((s, i) => `<li class="${s.tbc ? 'tbc' : ''}" ${s.tbc ? 'data-note="Needs ABLE input: site name"' : ''}><i>${String(i + 1).padStart(2, '0')}</i><div>${s.n}<small>${s.s}</small></div><em>${s.t}</em></li>`).join('');
const siteLis = $$('#sites li');

// manifesto words
const manifestoEl = $('[data-words]');
const HL = new Set(['eye', 'level', 'hug', 'first', 'step', 'thousandth.']);
manifestoEl.innerHTML = manifestoEl.textContent.trim().split(/\s+/).map(w => `<span class="w${HL.has(w.replace(/[,]/g, '')) ? ' hl' : ''}">${w}</span>`).join(' ');
const words = [...manifestoEl.querySelectorAll('.w')];

// throughput calculator
{
  const ids = ['hours', 'sess', 'fit', 'buf'];
  const inp = Object.fromEntries(ids.map(k => [k, $('#c-' + k)]));
  const out = Object.fromEntries(ids.map(k => [k, $('#o-' + k)]));
  const bar = $('#r-bar');
  const nf = new Intl.NumberFormat('en-GB');
  const calc = () => {
    const h = +inp.hours.value, s = +inp.sess.value, f = +inp.fit.value, b = +inp.buf.value;
    out.hours.textContent = h + ' h'; out.sess.textContent = s + ' min'; out.fit.textContent = f + ' min'; out.buf.textContent = b + ' min';
    const slot = s + f + b, day = Math.floor(h * 60 / slot);
    $('#r-day').textContent = day;
    $('#r-year').textContent = nf.format(day * 5 * 46);
    $('#r-prog').textContent = Math.floor(day * 20 / 12);
    bar.innerHTML = '';
    const total = h * 60;
    for (let i = 0; i < day; i++) {
      const el = document.createElement('i'); el.style.flex = `0 0 calc(${slot / total * 100}% - 3px)`;
      el.innerHTML = `<s style="left:0;width:${f / slot * 100}%"></s><b style="left:${f / slot * 100}%;width:${s / slot * 100}%"></b>`;
      bar.appendChild(el);
    }
  };
  ids.forEach(k => inp[k].addEventListener('input', calc));
  calc();
}

// review mode (highlights copy that still needs ABLE's input)
$('#review-toggle').addEventListener('click', e => {
  const on = document.body.classList.toggle('review');
  e.target.textContent = on ? 'Hide content gaps' : 'Show content gaps';
});

// reveal on view + counters
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  if (e.target.classList.contains('count')) countUp(e.target);
  io.unobserve(e.target);
}), { threshold: .2 });
$$('.reveal, .count').forEach(el => io.observe(el));
function countUp(el) {
  const to = +el.dataset.to, nf = new Intl.NumberFormat('en-GB'), t0 = performance.now(), dur = 2200;
  const tick = now => {
    const t = clamp((now - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - t, 4)));
    el.textContent = nf.format(v);
    if (t < 1) requestAnimationFrame(tick);
  };
  REDUCED ? (el.textContent = nf.format(to)) : requestAnimationFrame(tick);
}

/* ============================================================
   Scroll director
   ============================================================ */
const lenis = new Lenis({ lerp: .09, wheelMultiplier: .9, smoothWheel: !REDUCED });
$$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  if (id.length < 2) { e.preventDefault(); lenis.scrollTo(0); return; }
  const t = $(id); if (!t) return;
  e.preventDefault(); lenis.scrollTo(t, { offset: id === '#contact' ? -100 : 0, duration: 1.8 });
}));

const MODES = { hero: 'walk', manifesto: 'walk', gait: 'scrub', device: 'pose', outcomes: 'session', clinic: 'walk', network: 'walk', impact: 'walk' };
let sections = [];
function measure() {
  const vh = innerHeight;
  sections = $$('.stage').map((el, i) => {
    const top = el.offsetTop, h = el.offsetHeight;
    return { el, i, name: el.dataset.stage, title: el.dataset.title, top, h, holdEnd: Math.max(top, top + h - vh), bottom: top + h };
  });
}
function progressOf(name, y) {
  const s = sections.find(q => q.name === name); if (!s) return 0;
  return clamp((y - s.top) / Math.max(1, s.holdEnd - s.top));
}
function scrollToGait(c) {
  const s = sections.find(q => q.name === 'gait');
  lenis.scrollTo(s.top + (c * .92 + .04) * (s.holdEnd - s.top), { duration: 1.2 });
}
gp.scrub.addEventListener('input', () => {
  const s = sections.find(q => q.name === 'gait');
  lenis.scrollTo(s.top + (gp.scrub.value / 1000 * .92 + .04) * (s.holdEnd - s.top), { immediate: true });
});

const KEYS = ['cx', 'cy', 'cz', 'tx', 'ty', 'tz', 'fov', 'fig', 'ghost', 'trail', 'lab', 'explode', 'xray', 'globe', 'dim', 'prints', 'grid', 'pool'];
function params(name, t, o = {}) {
  Object.assign(o, { cx: 3.4, cy: 1.25, cz: 4.6, tx: -.75, ty: .95, tz: 0, fov: 30, fig: 1, ghost: 0, trail: 0, lab: 0, explode: 0, xray: 0, globe: 0, dim: 0, prints: 0, grid: 1, pool: 1 });
  const mob = isMobile();
  switch (name) {
    case 'hero':
      Object.assign(o, { cx: 3.9, cy: mob ? .7 : 1.4, cz: 5.4, tx: mob ? -.4 : -.95, ty: mob ? .1 : .92, ghost: 1, trail: 1 });
      break;
    case 'manifesto': {
      const e = smooth(t);
      Object.assign(o, { cx: lerp(3.0, 2.1, e), cy: lerp(1.1, .8, e), cz: lerp(3.9, 2.8, e), tx: lerp(-.3, -.1, e), ty: lerp(.85, .6, e), ghost: .3 * (1 - e), trail: 1, dim: .5 });
      break;
    }
    case 'gait':
      Object.assign(o, { cx: mob ? 0 : .15, cy: mob ? .6 : 1.0, cz: 6.6, tx: mob ? 0 : .15, ty: mob ? .45 : .92, fov: 26, lab: 1, pool: .4 });
      break;
    case 'device': {
      const a = lerp(-.25, 1.05, easeIO(t)), R = 3.5;
      const tx = mob ? 0 : .05;
      Object.assign(o, { cx: tx + Math.sin(a) * R, cy: 1.1 + Math.sin(t * Math.PI) * .25, cz: Math.cos(a) * R, tx, ty: .8, fov: 30,
        explode: smooth(clamp((t - .04) / .32)), xray: clamp(t * 5) * .82, pool: .6 });
      break;
    }
    case 'outcomes':
      Object.assign(o, { cx: -.7, cy: 2.0, cz: 5.3, tx: mob ? .5 : .05, ty: mob ? .35 : .62, prints: 1, trail: .35, ghost: 0 });
      break;
    case 'clinic':
      Object.assign(o, { cx: 2.6, cy: 1.2, cz: 4.4, tx: 0, ty: .95, dim: .9 });
      break;
    case 'network': {
      Object.assign(o, { cx: 0, cy: 1.0, cz: mob ? 6.8 : 5.6, tx: mob ? 0 : -1.25, ty: mob ? 2.0 : 1.0, fig: 0, globe: 1, grid: 0, pool: 0 });
      break;
    }
    case 'impact':
      Object.assign(o, { cx: 4.6, cy: 1.1, cz: mob ? 1.5 : 3.2, tx: 0, ty: 1.0, tz: mob ? -.7 : 1.45, ghost: 1, dim: .55, trail: 1 });
      break;
  }
  if (mob) { o.cx = o.tx + (o.cx - o.tx) * 1.45; o.cz = o.tz + (o.cz - o.tz) * 1.45; o.cy = o.ty + (o.cy - o.ty) * 1.2; }
  return o;
}
const _pa = {}, _pb = {}, cur = {};
params('hero', 0, cur);
function directorAt(y) {
  const vh = innerHeight;
  let s = sections[0];
  for (const q of sections) if (y >= q.top - 1) s = q;
  const next = sections[s.i + 1];
  if (y <= s.holdEnd || !next) return params(s.name, clamp((y - s.top) / Math.max(1, s.holdEnd - s.top)), _pa);
  const t = smooth(clamp((y - s.holdEnd) / Math.max(1, next.top - s.holdEnd)));
  params(s.name, 1, _pa); params(next.name, 0, _pb);
  for (const k of KEYS) _pa[k] = lerp(_pa[k], _pb[k], t);
  return _pa;
}

/* ============================================================
   Main loop
   ============================================================ */
const pose = makePose();
const state = { phase: .12, amp: 1, cadence: .5, ground: 0, speed: 0, mode: 'walk', section: null, sess: 1 };
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });

const clock = new THREE.Clock();
const _tmp = V3();
let W = innerWidth, H = innerHeight, frame = 0;
function toScreen(v) { _tmp.copy(v).project(camera); return [(_tmp.x * .5 + .5) * W, (-_tmp.y * .5 + .5) * H, _tmp.z]; }
function nearest(target, current) { return target + Math.round(current - target); }

function setFigureOpacity(f, xray) {
  for (const [k, m] of Object.entries(MAT)) {
    const o = f * (k === 'body' ? 1 - xray : 1);
    const tr = o < .999;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    m.opacity = o;
    m.depthWrite = k === 'body' ? o > .6 : true;
  }
  figure.visible = f > .01;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 20), time = clock.elapsedTime;
  lenis.raf(time * 1000);
  const y = lenis.scroll;
  const P = directorAt(y);
  for (const k of KEYS) cur[k] = damp(cur[k] ?? P[k], P[k], 5.5, dt);

  // which section owns the viewport centre
  let sec = sections[0];
  for (const q of sections) if (y + H * .5 >= q.top) sec = q;
  if (sec !== state.section) onSection(sec);
  const mode = MODES[sec.name];

  // ---- phase control
  const prevPhase = state.phase;
  let ampT = 1, cadT = .5;
  if (mode === 'scrub') {
    const g = clamp((progressOf('gait', y) - .04) / .92);
    state.phase = damp(state.phase, nearest(g - .5, state.phase), 9, dt);
  } else if (mode === 'pose') {
    state.phase = damp(state.phase, nearest(.18 + Math.sin(time * .9) * .025, state.phase), 3, dt);
  } else if (mode === 'session') {
    const t = clamp((progressOf('outcomes', y) - .03) / .85);
    state.sess = 1 + t * 11;
    ampT = lerp(.58, 1, t); cadT = lerp(.2, .46, t);
    state.phase += dt * state.cadence;
  } else {
    if (!REDUCED) state.phase += dt * state.cadence;
  }
  state.amp = damp(state.amp, ampT, 3, dt);
  state.cadence = damp(state.cadence, cadT, 3, dt);
  ensureDTable(state.amp);

  const gd = groundDelta(prevPhase, state.phase, state.amp);
  state.ground += gd;
  state.speed = damp(state.speed, dt > 0 ? -gd / dt : 0, 4, dt);

  // ---- figure pose
  computePose(state.phase, state.amp, pose);
  for (const [tag, leg, cr] of [['L', pose.L, pose.cL], ['R', pose.R, pose.cR]]) {
    setBone(bones['thigh' + tag], leg.hip, leg.knee);
    setBone(bones['shin' + tag], leg.knee, leg.ankle);
    bones['foot' + tag].position.copy(leg.ankle);
    bones['foot' + tag].rotation.set(0, 0, leg.f);
    const sh = tag === 'L' ? pose.shL : pose.shR, side = tag === 'L' ? 1 : -1;
    setBone(bones['upper' + tag], sh, cr.elbow, _v.set(side * .3, 0, 1).normalize());
    setBone(bones['fore' + tag], cr.elbow, cr.handle, _v.set(side * .3, 0, 1).normalize());
    setBone(bones['shaft' + tag], cr.handle, cr.tip, Z);
    setBone(bones['cuff' + tag], cr.cuff, cr.handle, Z);
  }
  pelvisG.position.copy(pose.pelvis);
  torso.position.copy(pose.pelvis);
  torso.rotation.z = -pose.lean;

  // exploded view
  for (const o of exoParts) o.position.copy(o.userData.base).addScaledVector(o.userData.explode, cur.explode);
  setFigureOpacity(cur.fig, cur.xray);
  shadowPlane.material.opacity = .55 * cur.fig;
  shadowPlane.visible = pool.visible = cur.fig > .01;
  pool.material.opacity = .16 * cur.fig * cur.pool;

  // ---- ground
  gridMat.uniforms.uOffset.value = state.ground;
  gridMat.uniforms.uOpacity.value = cur.grid;
  grid.visible = cur.grid > .01;

  // ---- ghosts (chronophotograph)
  const gOn = cur.ghost * cur.fig;
  for (let i = 0; i < GHOSTS; i++) {
    const k = i + 1, lag = k * GHOST_DP;
    const op = gOn * .5 * Math.pow(1 - i / GHOSTS, 1.5);
    if (op > .003) {
      computePose(state.phase - lag, state.amp, ghostPose);
      writeGhost(ghosts[i], ghostPose, Dfun(state.phase) - Dfun(state.phase - lag) - k * GHOST_SPREAD * cur.ghost, op);
    } else writeGhost(ghosts[i], ghostPose, 0, 0);
  }

  // ---- trails
  for (const tr of trails) {
    const p = tr.get(pose);
    tr.pts.push(p.x - state.ground, p.y, p.z);
    if (tr.pts.length > TRAIL_N * 3) tr.pts.splice(0, 3);
    const n = tr.pts.length / 3;
    const pos = linePositions(tr.line), col = lineColors(tr.line);
    const on = cur.trail * cur.fig;
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = Math.min(i, n - 1), b = Math.min(i + 1, n - 1);
      const o = i * 6;
      pos.array[o] = tr.pts[a * 3] + state.ground; pos.array[o + 1] = tr.pts[a * 3 + 1]; pos.array[o + 2] = tr.pts[a * 3 + 2];
      pos.array[o + 3] = tr.pts[b * 3] + state.ground; pos.array[o + 4] = tr.pts[b * 3 + 1]; pos.array[o + 5] = tr.pts[b * 3 + 2];
      const fa = Math.pow(a / (TRAIL_N - 1), 2) * on, fb = Math.pow(b / (TRAIL_N - 1), 2) * on;
      col.array[o] = tr.col.r * fa; col.array[o + 1] = tr.col.g * fa; col.array[o + 2] = tr.col.b * fa;
      col.array[o + 3] = tr.col.r * fb; col.array[o + 4] = tr.col.g * fb; col.array[o + 5] = tr.col.b * fb;
    }
    pos.needsUpdate = col.needsUpdate = true;
    tr.line.visible = on > .01;
  }

  // ---- footprints: spawn at each heel strike during the outcomes chapter
  if (mode === 'session' && cur.prints > .5) {
    for (const [leg, off] of [[pose.R, 0], [pose.L, .5]]) {
      const a = mod(prevPhase + off), b = mod(state.phase + off);
      if (b < a && state.phase > prevPhase) {
        const pr = prints[printIdx++ % prints.length];
        pr.xg = (leg.heel.x + leg.toe.x) / 2 - state.ground; pr.z = leg.hip.z; pr.born = time; pr.s = state.sess;
        pr.m.visible = true;
      }
    }
  }
  for (const pr of prints) {
    if (!pr.m.visible) continue;
    pr.m.position.set(pr.xg + state.ground, .003, pr.z);
    const age = pr.m.position.x;
    const intensity = lerp(.25, 1, (pr.s - 1) / 11);
    pr.m.material.opacity = clamp(1 + age / 5) * cur.prints * intensity;
    pr.m.material.color.setRGB(lerp(.55, 1, intensity), lerp(.55, .36, intensity), lerp(.55, .12, intensity));
    if (age < -6) pr.m.visible = false;
  }

  // ---- lab overlays
  const labOn = cur.lab * cur.fig;
  labMat.uniforms.uOpacity.value = labOn;
  lab.visible = labOn > .01;
  kneeArc.visible = hipArc.visible = labOn > .02;
  kneeArc.material.opacity = hipArc.material.opacity = labOn;
  const kneeDeg = pose.L.k * R2D, hipDeg = pose.L.h * R2D;
  if (labOn > .02) {
    const thighA = Math.atan2(pose.L.knee.y - pose.L.hip.y, pose.L.knee.x - pose.L.hip.x);
    const shinA = Math.atan2(pose.L.ankle.y - pose.L.knee.y, pose.L.ankle.x - pose.L.knee.x);
    writeArc(kneeArc, pose.L.knee, thighA, shinA, .14, .3);
    writeArc(hipArc, pose.L.hip, -Math.PI / 2, thighA, .2, .3);
  }

  // ---- globe
  globe.visible = cur.globe > .01;
  if (globe.visible) {
    const gp_ = progressOf('network', y);
    for (const m of globeMats) { const v = cur.globe * (m.userData.max ?? 1); if (m.uniforms) m.uniforms.uOpacity.value = v; else m.opacity = v; }
    globe.scale.setScalar(lerp(.7, 1, smooth(cur.globe)));
    gTilt.rotation.x = 47 * D2R;
    gSpin.rotation.y = -Math.PI / 2 - (lerp(-14, 10, gp_) + Math.sin(time * .15) * 2) * D2R;
    SITES.forEach((s, i) => {
      const reveal = smooth(clamp((gp_ - .06 - i * .09) / .12)) * cur.globe;
      s.mats[0].opacity = s.mats[1].opacity = reveal;
      const pulse = mod(time * .6 + i * .2);
      s.ring.scale.setScalar(1 + pulse * 2.4); s.mats[2].opacity = reveal * (1 - pulse);
      if (s.arc) s.arc.geometry.setDrawRange(0, Math.floor(s.arc.userData.count * smooth(clamp((gp_ - .1 - i * .09) / .2))) * (cur.globe > .5 ? 1 : 0));
      siteLis[i].classList.toggle('on', reveal > .5);
      if (s.el) {
        s.head.getWorldPosition(_w);
        const [sx, sy] = toScreen(_w);
        const facing = _v.copy(_w).sub(globe.position).normalize().dot(_d.copy(camera.position).sub(_w).normalize());
        s.el.style.transform = `translate(${sx + s.off[0]}px, ${sy + s.off[1]}px)`;
        s.el.style.opacity = reveal * clamp(facing * 3) * (isMobile() ? 0 : 1);
      }
    });
  } else SITES.forEach(s => s.el && (s.el.style.opacity = 0));

  // ---- camera
  mouse.sx = damp(mouse.sx, REDUCED ? 0 : mouse.x, 2.5, dt);
  mouse.sy = damp(mouse.sy, REDUCED ? 0 : mouse.y, 2.5, dt);
  camera.position.set(cur.cx + mouse.sx * .22, cur.cy - mouse.sy * .12, cur.cz);
  camera.lookAt(cur.tx, cur.ty, cur.tz);
  if (Math.abs(camera.fov - cur.fov) > .01) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
  $('#dim').style.opacity = cur.dim;

  // ---- DOM sync
  updateDOM(y, sec, kneeDeg, hipDeg, labOn);

  composer.render();
  frame++;
  if (frame === 2) { loader.set(1); setTimeout(() => loader.done(), 450); }
  requestAnimationFrame(tick);
}

function onSection(sec) {
  state.section = sec;
  $('#chapter-n').textContent = String(sec.i + 1).padStart(2, '0');
  $('#chapter-t').textContent = sec.title;
  document.body.classList.toggle('hud-off', !['hero', 'manifesto'].includes(sec.name));
  $$('.nav-links a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + sec.name));
  $('#hud-mode').textContent = { gait: 'Gait lab: scroll-driven', device: 'Device: exploded view', outcomes: 'Training: session model' }[sec.name] || 'Live gait model';
}

function updateDOM(y, sec, kneeDeg, hipDeg, labOn) {
  const c = mod(state.phase + .5); // left (near) leg gait cycle
  if (frame % 3 === 0) {
    $('#hud-cycle').textContent = Math.round(c * 100) + '%';
    $('#hud-knee').textContent = kneeDeg.toFixed(0) + '°';
    $('#hud-hip').textContent = hipDeg.toFixed(0) + '°';
    $('#hud-speed').textContent = Math.max(0, state.speed).toFixed(2) + ' m/s';
  }

  // manifesto
  if (sec.name === 'manifesto' || sec.name === 'hero') {
    const t = progressOf('manifesto', y), n = Math.floor(t * 1.25 * words.length);
    words.forEach((w, i) => w.classList.toggle('on', i < n));
  }

  // gait panel + joint labels
  if (labOn > .02) {
    const pi = phaseIdx(c);
    if (pi !== gp.last) {
      gp.last = pi; gp.phase.textContent = PHASES[pi][1]; gp.desc.textContent = PHASES[pi][2];
      [...gp.list.children].forEach((li, i) => li.classList.toggle('on', i === pi));
    }
    gp.pct.textContent = Math.round(c * 100) + '%';
    const x = cx(c);
    gp.cursor.setAttribute('x1', x); gp.cursor.setAttribute('x2', x);
    gp.kdot.setAttribute('cx', x); gp.kdot.setAttribute('cy', cy(kneeDeg));
    gp.hdot.setAttribute('cx', x); gp.hdot.setAttribute('cy', cy(hipDeg));
    gp.kv.textContent = kneeDeg.toFixed(0) + '°'; gp.hv.textContent = hipDeg.toFixed(0) + '°';
    if (document.activeElement !== gp.scrub) gp.scrub.value = Math.round(c * 1000);
    const [kx, ky] = toScreen(_v.copy(pose.L.knee).setZ(.3));
    const [hx, hy] = toScreen(_v.copy(pose.L.hip).setZ(.3));
    kneeLbl.style.transform = `translate(${kx + 26}px, ${ky - 10}px)`;
    hipLbl.style.transform = `translate(${hx + 30}px, ${hy - 28}px)`;
    kneeLbl.innerHTML = `Knee <b>${kneeDeg.toFixed(0)}°</b>`; hipLbl.innerHTML = `Hip <b>${hipDeg.toFixed(0)}°</b>`;
  }
  kneeLbl.style.opacity = hipLbl.style.opacity = labOn > .5 ? clamp((labOn - .5) * 2) : 0;

  // device callouts
  const devT = progressOf('device', y);
  const devOn = sec.name === 'device' ? clamp(cur.explode * 3) : 0;
  let curIdx = -1;
  callouts.forEach((co, i) => {
    const on = devT > .08 + i * .15 && sec.name === 'device';
    co.li.classList.toggle('on', on);
    if (on) curIdx = i;
    const vis = on && devOn > .05 && !isMobile();
    co.line.style.opacity = co.dot.style.opacity = co.halo.style.opacity = vis ? devOn : 0;
    if (!vis) return;
    anchors[co.anchor].getWorldPosition(_w);
    const [ax, ay] = toScreen(_w);
    const r = co.li.getBoundingClientRect();
    const lx = r.left - 14, ly = r.top + 16;
    co.line.setAttribute('x1', ax); co.line.setAttribute('y1', ay); co.line.setAttribute('x2', lx); co.line.setAttribute('y2', ly);
    co.dot.setAttribute('cx', ax); co.dot.setAttribute('cy', ay);
    co.halo.setAttribute('cx', ax); co.halo.setAttribute('cy', ay);
  });
  callouts.forEach((co, i) => co.li.classList.toggle('cur', i === curIdx));

  // outcomes
  if (sec.name === 'outcomes') {
    const s = Math.floor(state.sess + .0001);
    $('#sess-n').textContent = String(Math.min(12, s)).padStart(2, '0');
    tickEls.forEach((t, i) => t.classList.toggle('on', i < s));
    const k = clamp((state.sess - 2) / 9);
    metricEls.forEach(el => { el.textContent = (1 + (+el.dataset.to - 1) * k).toFixed(1); });
  }
}

/* ============================================================
   Resize + boot
   ============================================================ */
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H);
  composer.setSize(W, H);
  bloom.setSize(W / 2, H / 2);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  lineMats.forEach(m => m.resolution.set(W, H));
  globeMats[0].uniforms.uSize.value = 10 * DPR * (H / 900);
  measure();
}
addEventListener('resize', resize);
document.fonts.ready.then(measure);
resize();
loader.set(.9);
requestAnimationFrame(tick);
