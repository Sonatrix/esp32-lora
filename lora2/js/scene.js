// three.js world: a procedural city map, node models (gateway mast, solar repeaters, sensor boxes),
// link lines, range rings, RF domes, packet comets flying along arcs, receive pops and the
// Wi-Fi hop to an MQTT cloud. Airtime effects run on simulated time, pops on wall-clock time.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { frameKind } from './network.js';

export const KM = 10;                                             // scene units per km
const NODE_SCALE = 1.6;                                           // node models are not to map scale
export const BOUNDS = { x0: -4.0, x1: 3.2, y0: -2.8, y1: 2.4 };   // km
const CX = (BOUNDS.x0 + BOUNDS.x1) / 2, CY = (BOUNDS.y0 + BOUNDS.y1) / 2;
const MW = (BOUNDS.x1 - BOUNDS.x0) * KM, MH = (BOUNDS.y1 - BOUNDS.y0) * KM;
export const toScene = (x, y, h = 0) => new THREE.Vector3((x - CX) * KM, h, -(y - CY) * KM);
export const fromScene = v => ({ x: v.x / KM + CX, y: -v.z / KM + CY });

export const COLORS = { data: 0xffa23c, relay: 0xb48cff, ack: 0x37c6ff, gateway: 0x37c6ff, repeater: 0xb48cff,
  sensor: 0xffa23c, ok: 0x3ddc84, bad: 0xff6b6b, warn: 0xffd166, dim: 0x8b98a8, dup: 0x7f93b8 };
const RADIO_RING = { rx: [0x3ddc84, 0.38], cad: [0xffd166, 0.8], tx: [0xffffff, 0.95], standby: [0x8b98a8, 0.5],
  sleep: [0x33456e, 0.35], off: [0xff6b6b, 0.25] };
const RADIO_TEXT = { rx: 'RX', cad: 'CAD', tx: 'TX', standby: 'awake', sleep: 'zz', off: 'OFF' };
const POP = { ok: ['ok', '✓'], collision: ['bad', '✗ collision'], weak: ['warn', 'too weak'], deaf: ['dim', 'deaf (TX)'],
  duplicate: ['dup', 'dup'], 'TTL expired': ['dup', 'TTL 0'], 'no route': ['bad', 'no route'] };

const easeOut = t => 1 - Math.pow(1 - t, 3);
const clamp01 = t => Math.max(0, Math.min(1, t));

/* ------------------------------------------------------------------ textures */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function mapTexture() {
  const PX = 160, { x0, x1, y0, y1 } = BOUNDS;
  const cw = Math.round((x1 - x0) * PX), ch = Math.round((y1 - y0) * PX);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const P = (x, y) => [(x - x0) * PX, (y1 - y) * PX];

  g.fillStyle = '#0a1019'; g.fillRect(0, 0, cw, ch);
  // city blocks, denser towards the centre
  for (let bx = x0; bx < x1; bx += 0.26) for (let by = y0; by < y1; by += 0.26) {
    const dens = Math.exp(-(bx * bx + by * by) / 5);
    if (rand() > 0.18 + 0.7 * dens) continue;
    const [px, py] = P(bx, by + 0.26), s = 0.26 * PX;
    g.fillStyle = rand() < 0.5 ? '#111b2a' : '#132033';
    const inset = 5 + rand() * 4;
    g.fillRect(px + inset, py + inset, s - 2 * inset, s - 2 * inset);
    if (dens > 0.4 && rand() < 0.5) { g.fillStyle = '#17263b'; g.fillRect(px + inset + 6, py + inset + 6, s / 3, s / 3); }
  }
  // parks
  g.fillStyle = 'rgba(14, 40, 30, .9)';
  for (let i = 0; i < 7; i++) {
    const [px, py] = P(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0));
    g.beginPath(); g.ellipse(px, py, (0.25 + rand() * 0.4) * PX, (0.2 + rand() * 0.3) * PX, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  // river
  const river = [P(x0, 1.7), P(-2.2, 2.1), P(-0.6, 0.7), P(0.6, 0.35), P(2.2, -0.3), P(x1, 0.2)];
  const strokePath = (pts, w, col) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(...pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    g.lineTo(...pts[pts.length - 1]); g.stroke();
  };
  strokePath(river, 0.2 * PX, '#0b2440'); strokePath(river, 0.1 * PX, '#0f3155');
  // roads
  const roads = [
    [P(x0, -0.35), P(-1, -0.25), P(1, -0.4), P(x1, -0.2)],
    [P(0.55, y0), P(0.45, -1), P(0.6, 1), P(0.5, y1)],
    [P(-2.6, y0), P(-2.2, -1), P(-2.5, 1), P(-2.1, y1)],
    [P(x0, 2.3), P(-1, 1.8), P(1.5, 2.4), P(x1, 2.0)],
  ];
  for (const r of roads) { strokePath(r, 9, '#1c2a3e'); strokePath(r, 2, '#2a3c55'); }
  g.strokeStyle = '#1c2a3e'; g.lineWidth = 6;
  g.beginPath(); g.ellipse(...P(0, 0), 2.1 * PX, 1.6 * PX, 0.2, 0, Math.PI * 2); g.stroke();
  // 1 km grid + labels
  g.strokeStyle = 'rgba(120, 160, 220, .08)'; g.lineWidth = 1.5;
  g.fillStyle = 'rgba(160, 190, 230, .35)'; g.font = '600 18px system-ui, sans-serif';
  for (let x = Math.ceil(x0); x <= x1; x++) { const [px] = P(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, ch); g.stroke(); g.fillText(`${x} km`, px + 5, ch - 10); }
  for (let y = Math.ceil(y0); y <= y1; y++) { const [, py] = P(0, y); g.beginPath(); g.moveTo(0, py); g.lineTo(cw, py); g.stroke(); if (y) g.fillText(`${y} km`, 8, py - 6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const domeMaterial = color => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
    void main() { float f = pow(1.0 - abs(dot(vN, vV)), 2.4); gl_FragColor = vec4(color * (0.25 + 1.4 * f), (0.05 + f) * opacity); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});

/* ------------------------------------------------------------------ world */
export class World {
  constructor(canvas, net) {
    this.net = net; this.canvas = canvas;
    this.onSelect = () => {}; this.onMove = () => {}; this.onHover = () => {}; this.onDouble = () => {};
    this.selected = null; this.showLinks = true; this.showRange = true;
    this.views = new Map(); this.effects = []; this.pops = [];
    this.glowTex = glowTexture();

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
    canvas.after(this.labels.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a10);
    scene.fog = new THREE.Fog(0x070a10, 160, 360);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    this.camera.position.set(0, 60, 70);

    this._bindPointer();                                           // before OrbitControls so node drags win
    const ctl = this.controls = new OrbitControls(this.camera, canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.maxPolarAngle = 1.36;
    ctl.minDistance = 20; ctl.maxDistance = 240; ctl.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0a0d14, 0.75));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.7);
    sun.position.set(45, 90, 35); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 60, bottom: -60, near: 10, far: 250 });
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
    scene.add(sun);

    this._buildGround();
    this._buildCloud();
    this._buildOverlays();
    this.syncNodes();

    addEventListener('resize', () => this.resize()); this.resize();
  }

  /* ---------------------------------------------------------------- static scene */
  _buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: mapTexture(), roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true; this.scene.add(ground); this.ground = ground;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(MW, 3, MH), new THREE.MeshStandardMaterial({ color: 0x0c121c, roughness: 0.8 }));
    slab.position.y = -1.52; this.scene.add(slab);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(MW, 3, MH)),
      new THREE.LineBasicMaterial({ color: 0x37c6ff, transparent: true, opacity: 0.18 }));
    edge.position.y = -1.5; this.scene.add(edge);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x06080d, roughness: 1 }));
    floor.position.y = -3.05; floor.receiveShadow = true; this.scene.add(floor);
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }
  _buildCloud() {
    const g = this.cloud = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4dcea, emissive: 0x1d2a40, roughness: 0.9, flatShading: true });
    [[0, 0, 0, 2.6], [2.6, -0.4, 0.3, 2], [-2.5, -0.5, 0, 1.9], [1.1, 1.3, -0.3, 1.9], [-1, 1, 0.6, 1.6], [0.3, -0.6, 1.4, 1.7]]
      .forEach(([x, y, z, s]) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat); m.position.set(x, y, z); g.add(m); });
    this.cloudMat = mat;
    const el = document.createElement('div'); el.className = 'nlabel cloud';
    el.innerHTML = '<b>MQTT broker</b><span class="st">cloud</span>';
    const lbl = new CSS2DObject(el); lbl.position.set(0, 4.4, 0); g.add(lbl);
    this.scene.add(g);
    const wifiGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.wifiLine = new THREE.Line(wifiGeo, new THREE.LineDashedMaterial({ color: 0x37c6ff, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.55 }));
    this.scene.add(this.wifiLine);
  }
  _buildOverlays() {
    this.linkSolid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 }));
    this.linkDash = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: 0.8, dashSize: 0.9, gapSize: 0.7 }));
    this.scene.add(this.linkSolid, this.linkDash);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 160).rotateX(-Math.PI / 2), ringMat);
    this.rangeFill = new THREE.Mesh(new THREE.CircleGeometry(1, 160).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false }));
    this.rangeRing.position.y = 0.06; this.rangeFill.position.y = 0.05;
    this.scene.add(this.rangeRing, this.rangeFill);
  }

  /* ---------------------------------------------------------------- node models */
  _makeNode(n) {
    const g = new THREE.Group(), col = COLORS[n.kind];
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.8, roughness: 0.35 });
    const shell = new THREE.MeshStandardMaterial({ color: n.kind === 'gateway' ? 0xdfe6ee : 0x2a3342, roughness: 0.5, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.4 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

    add(new THREE.CylinderGeometry(1.35, 1.5, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0x151c27, roughness: 0.7 }), 0, 0.125, 0).receiveShadow = true;
    let tip;
    if (n.kind === 'gateway') {
      add(new THREE.BoxGeometry(1.7, 2.1, 1.1), shell, 0, 1.3, 0);
      add(new THREE.BoxGeometry(1.72, 0.2, 1.12), accent, 0, 2.1, 0);
      add(new THREE.CylinderGeometry(0.13, 0.2, 8, 12), metal, 0, 6.3, 0);
      add(new THREE.BoxGeometry(0.5, 0.9, 0.12), white, 0.35, 7.4, 0.2);          // Wi-Fi panel
      add(new THREE.CylinderGeometry(0.06, 0.07, 2.2, 8), white, 0, 11.4, 0);       // LoRa collinear
      tip = new THREE.Vector3(0, 12.6, 0);
    } else if (n.kind === 'repeater') {
      add(new THREE.CylinderGeometry(0.1, 0.13, 5.2, 10), metal, 0, 2.6, 0);
      add(new THREE.BoxGeometry(1, 1.3, 0.6), shell, 0, 3.1, 0.38);
      add(new THREE.BoxGeometry(1.02, 0.14, 0.62), accent, 0, 3.6, 0.38);
      const panel = add(new THREE.BoxGeometry(2, 0.07, 1.3), new THREE.MeshStandardMaterial({ color: 0x1b2d52, metalness: 0.6, roughness: 0.25 }), 0, 5.25, 0);
      panel.rotation.x = -0.5;
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), white, 0.7, 6.2, -0.2);
      tip = new THREE.Vector3(0.7, 7.15, -0.2);
    } else {
      add(new THREE.BoxGeometry(1.4, 0.85, 0.95), shell, 0, 0.68, 0);
      add(new THREE.BoxGeometry(1.42, 0.12, 0.97), accent, 0, 0.9, 0);
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), white, 0.5, 1.9, 0);
      tip = new THREE.Vector3(0.5, 2.75, 0);
    }
    const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    led.position.copy(tip); led.scale.setScalar(1.2); g.add(led);

    const ring = new THREE.Mesh(new THREE.RingGeometry(1.65, 2.05, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.4, depthWrite: false }));
    ring.position.y = 0.04; g.add(ring);
    const sel = new THREE.Mesh(new THREE.RingGeometry(2.35, 2.6, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    sel.position.y = 0.05; sel.visible = false; g.add(sel);
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, tip.y + 1.5, 12), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.y = (tip.y + 1.5) / 2; pick.userData.node = n; g.add(pick);

    const el = document.createElement('div'); el.className = `nlabel ${n.kind}`;
    el.innerHTML = `<b>${n.name}</b><span class="st"></span><em class="fl"></em>`;
    const label = new CSS2DObject(el); label.position.set(0, tip.y + 1.3, 0); g.add(label);

    g.scale.setScalar(NODE_SCALE);
    this.scene.add(g);
    return { node: n, g, tip, led, ring, sel, pick, label, el, st: el.querySelector('.st'), fl: el.querySelector('.fl'), flashUntil: 0, txColor: col };
  }
  syncNodes() {
    for (const [n, v] of this.views) if (!this.net.nodes.includes(n)) {
      this.scene.remove(v.g); v.label.element.remove(); this.views.delete(n);
    }
    for (const n of this.net.nodes) if (!this.views.has(n)) this.views.set(n, this._makeNode(n));
    this.updateLinks();
  }
  tipOf(n) { const v = this.views.get(n); return v ? v.g.position.clone().addScaledVector(v.tip, NODE_SCALE) : toScene(n.x, n.y, 3); }

  /* ---------------------------------------------------------------- links, range, reachability */
  updateLinks() {
    const net = this.net, mesh = net.cfg.topology === 'mesh', nodes = net.nodes.filter(n => n.online);
    const sp = [], sc = [], dp = [], dc = [], c = new THREE.Color();
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const relevant = mesh ? !(a.kind === 'sensor' && b.kind === 'sensor') : (a.kind === 'gateway' || b.kind === 'gateway');
      if (!relevant) continue;
      const l = net.link(a, b);
      if (l.margin < 0) continue;
      c.setHex(l.margin > 8 ? COLORS.ok : l.margin > 3 ? 0xb8e05a : COLORS.warn);
      const [P, C] = l.margin > 3 ? [sp, sc] : [dp, dc];
      const pa = toScene(a.x, a.y, 0.35), pb = toScene(b.x, b.y, 0.35);
      P.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z); C.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const set = (line, P, C) => {
      line.geometry.dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      line.geometry = geo;
      if (line.computeLineDistances) line.computeLineDistances();
    };
    set(this.linkSolid, sp, sc); set(this.linkDash, dp, dc);
    this.linkSolid.visible = this.linkDash.visible = this.showLinks;

    const reach = net.reachable();
    for (const [n, v] of this.views) v.el.classList.toggle('isolated', n.online && n.kind !== 'gateway' && !reach.has(n));
    this.updateRange();
  }
  updateRange() {
    const n = this.selected, on = !!n && this.showRange && n.online;
    this.rangeRing.visible = this.rangeFill.visible = on;
    if (!on) return;
    const r = this.net.range() * KM, p = toScene(n.x, n.y);
    for (const m of [this.rangeRing, this.rangeFill]) { m.position.x = p.x; m.position.z = p.z; m.scale.set(r, 1, r); }
    this.rangeRing.material.color.setHex(COLORS[n.kind]);
  }
  select(n) {
    this.selected = n;
    for (const [m, v] of this.views) v.sel.visible = m === n;
    this.updateRange();
  }

  /* ---------------------------------------------------------------- network events → effects */
  onTxStart(air) {
    const kind = frameKind(air.frame), color = COLORS[kind], from = air.from;
    const R = this.net.range() * KM;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial(color));
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 128).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    const p = toScene(from.x, from.y); dome.position.copy(p); ripple.position.set(p.x, 0.08, p.z);
    this.scene.add(dome, ripple);
    const comets = [];
    for (const r of air.rx.values()) {
      if (r.margin < -8 || (r.deaf && r.deafWhy !== 'tx' && r.deafWhy !== 'standby')) continue;
      const sprites = [1, 0.7, 0.5, 0.35].map((s, i) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1 - i * 0.2 }));
        sp.scale.setScalar(2.4 * s); this.scene.add(sp); return sp;
      });
      comets.push({ to: r.node, sprites });
    }
    this.effects.push({ air, dome, ripple, R, comets, endReal: null });
    const v = this.views.get(from); if (v) v.txColor = color;
  }
  onTxEnd({ air, results }) {
    for (const r of results) {
      const [cls, text] = POP[r.status];
      this.pop(r.node, cls, r.status === 'ok' ? `✓ ${Math.round(r.rssi)} dBm` : r.status === 'collision' && r.jam ? `✗ jam ${r.jam.name}` : text);
    }
  }
  onDrop({ node, reason }) {
    if (POP[reason]) this.pop(node, ...POP[reason]);
  }
  onRelay({ node }) { this.pop(node, 'relay', '↻ relay'); }
  onWifi({ node }) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: COLORS.ack, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.setScalar(2.2); this.scene.add(sp);
    this.pops.push({ kind: 'wifi', from: node, sprite: sp, t: 0, dur: 0.7 });
  }
  pop(node, cls, text) {
    const v = this.views.get(node); if (!v) return;
    const color = { ok: COLORS.ok, bad: COLORS.bad, warn: COLORS.warn, dim: COLORS.dim, dup: COLORS.dup, relay: COLORS.relay }[cls];
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(v.g.position).setY(0.12); this.scene.add(m);
    this.pops.push({ kind: 'ring', mesh: m, t: 0, dur: 0.9 });
    v.fl.textContent = text; v.fl.className = `fl show ${cls}`; v.flashUntil = performance.now() + 1700;
  }

  /* ---------------------------------------------------------------- per frame */
  update(simT, dt, trackedTxn) {
    const now = performance.now();
    // nodes
    for (const [n, v] of this.views) {
      v.g.position.copy(toScene(n.x, n.y));
      const [col, op] = RADIO_RING[n.radio] || RADIO_RING.rx;
      const pulse = n.radio === 'rx' ? 0.75 + 0.25 * Math.sin(now / 400 + n.id) : n.radio === 'cad' ? 0.5 + 0.5 * Math.sin(now / 60) : 1;
      v.ring.material.color.setHex(n.radio === 'tx' ? v.txColor : col);
      v.ring.material.opacity = op * pulse;
      v.led.material.color.setHex(n.radio === 'tx' ? v.txColor : COLORS[n.kind]);
      v.led.material.opacity = !n.online ? 0.05 : n.radio === 'tx' ? 1 : n.radio === 'sleep' ? 0.12 : 0.45;
      v.led.scale.setScalar(n.radio === 'tx' ? 3.4 + Math.sin(now / 50) * 0.4 : 1.2);
      v.st.textContent = RADIO_TEXT[n.radio] ?? n.radio;
      v.el.dataset.radio = n.radio;
      v.el.classList.toggle('sel', n === this.selected);
      v.el.classList.toggle('tracked', !!trackedTxn && trackedTxn.node === n && !trackedTxn.end);
      if (v.flashUntil && now > v.flashUntil) { v.fl.className = 'fl'; v.flashUntil = 0; }
      if (n.txn) v.el.dataset.txn = n.txn.attempt > 1 ? `try ${n.txn.attempt}` : ''; else delete v.el.dataset.txn;
    }
    // cloud follows the gateway
    const gw = this.net.gateway;
    if (gw) {
      const p = toScene(gw.x, gw.y);
      this.cloud.position.set(p.x - 13, 21 + Math.sin(now / 1400) * 0.6, p.z - 5);
      this.cloud.rotation.y = now / 9000;
      const a = this.tipOf(gw), b = this.cloud.position.clone().add(new THREE.Vector3(0, -2.2, 0));
      this.wifiLine.geometry.setFromPoints([a, b]); this.wifiLine.computeLineDistances();
      this.wifiLine.visible = gw.online;
    }
    this.cloudMat.emissive.setHex(this._cloudFlash > now ? 0x2f6ea0 : 0x1d2a40);

    // airtime effects (simulated time)
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i], p = clamp01((simT - e.air.start) / e.air.toa);
      const tracked = !!trackedTxn && e.air.frame.txn === trackedTxn;
      const grow = e.R * (0.08 + 0.92 * easeOut(Math.min(1, p * 2.2)));
      e.dome.scale.set(grow, grow * 0.55, grow);
      e.ripple.scale.set(grow, 1, grow);
      if (p >= 1 && e.endReal === null) e.endReal = now;
      const fadeOut = e.endReal === null ? 1 : 1 - (now - e.endReal) / 500;
      e.dome.material.uniforms.opacity.value = (tracked ? 1 : 0.45) * Math.max(0, fadeOut) * (0.85 + 0.15 * Math.sin(now / 70));
      e.ripple.material.opacity = 0.55 * Math.max(0, fadeOut);
      const a = this.tipOf(e.air.from);
      for (const c of e.comets) {
        const b = this.tipOf(c.to), mid = a.clone().add(b).multiplyScalar(0.5);
        mid.y += a.distanceTo(b) * 0.22 + 2;
        c.sprites.forEach((sp, k) => {
          const t = clamp01(p - k * 0.035);
          const u = 1 - t;
          sp.position.set(u * u * a.x + 2 * u * t * mid.x + t * t * b.x, u * u * a.y + 2 * u * t * mid.y + t * t * b.y, u * u * a.z + 2 * u * t * mid.z + t * t * b.z);
          sp.visible = p > 0 && p < 1;
        });
      }
      if (e.endReal !== null && now - e.endReal > 500) {
        this.scene.remove(e.dome, e.ripple); e.dome.geometry.dispose(); e.dome.material.dispose(); e.ripple.geometry.dispose(); e.ripple.material.dispose();
        for (const c of e.comets) for (const sp of c.sprites) { this.scene.remove(sp); sp.material.dispose(); }
        this.effects.splice(i, 1);
      }
    }
    // pops and Wi-Fi hops (wall-clock time)
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const q = this.pops[i]; q.t += dt;
      const k = clamp01(q.t / q.dur);
      if (q.kind === 'ring') {
        q.mesh.scale.setScalar(1.5 + easeOut(k) * 4); q.mesh.material.opacity = 0.9 * (1 - k);
      } else {
        const a = this.tipOf(q.from), b = this.cloud.position.clone().add(new THREE.Vector3(0, -2, 0));
        q.sprite.position.lerpVectors(a, b, easeOut(k));
        if (k >= 1) this._cloudFlash = now + 450;
      }
      if (k >= 1) {
        const obj = q.mesh || q.sprite; this.scene.remove(obj); obj.material.dispose(); q.mesh && q.mesh.geometry.dispose();
        this.pops.splice(i, 1);
      }
    }
    if (this._camAnim) this._stepCam(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /* ---------------------------------------------------------------- camera + input */
  view(name) {
    const V = { iso: [[0, 60, 70], [0, 0, 0]], top: [[0, 100, 0.1], [0, 0, 0]], low: [[-52, 18, 46], [0, 3, 0]] }[name];
    if (!V) return;
    this._camAnim = { t: 0, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: new THREE.Vector3(...V[0]), t1: new THREE.Vector3(...V[1]) };
  }
  _stepCam(dt) {
    const a = this._camAnim; a.t = Math.min(1, a.t + dt / 0.9);
    const k = easeOut(a.t);
    this.camera.position.lerpVectors(a.p0, a.p1, k); this.controls.target.lerpVectors(a.t0, a.t1, k);
    if (a.t >= 1) this._camAnim = null;
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.labels.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  _ray(e) {
    const r = this.canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return ray;
  }
  _pick(e) {
    const hit = this._ray(e).intersectObjects([...this.views.values()].map(v => v.pick), false)[0];
    return hit ? hit.object.userData.node : null;
  }
  _bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      const node = e.button === 0 ? this._pick(e) : null;
      this.down = { x: e.clientX, y: e.clientY, node, moved: false };
      if (node) { e.stopImmediatePropagation(); c.setPointerCapture(e.pointerId); this.onSelect(node); }
    });
    c.addEventListener('pointermove', e => {
      const d = this.down;
      if (d && d.node) {
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
        if (d.moved) {
          const p = this._ray(e).ray.intersectPlane(this.groundPlane, new THREE.Vector3());
          if (p) {
            const k = fromScene(p);
            d.node.x = Math.max(BOUNDS.x0 + 0.15, Math.min(BOUNDS.x1 - 0.15, k.x));
            d.node.y = Math.max(BOUNDS.y0 + 0.15, Math.min(BOUNDS.y1 - 0.15, k.y));
            this.onMove(d.node);
          }
        }
        c.style.cursor = 'grabbing';
        return;
      }
      if (d) return;
      const node = this._pick(e);
      c.style.cursor = node ? 'grab' : '';
      this.onHover(node, e.clientX, e.clientY);
    });
    c.addEventListener('pointerup', e => {
      const d = this.down; this.down = null; c.style.cursor = '';
      if (d && !d.node && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.onSelect(null);
    });
    c.addEventListener('pointerleave', () => this.onHover(null));
    c.addEventListener('dblclick', e => { const n = this._pick(e); if (n) this.onDouble(n); });
  }
}
