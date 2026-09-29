// Visual effects: expanding RF domes from the antenna, and the IR "thermal camera" material swap.
import * as THREE from 'three';
import { ironbow, tNorm } from './textures.js';

/* ------------------------------------------------------------------ RF propagation domes */
const DOME_VS = /* glsl */`
  varying vec3 vN; varying vec3 vW;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const DOME_FS = /* glsl */`
  uniform vec3 uColor; uniform float uAlpha; uniform float uPhase;
  varying vec3 vN; varying vec3 vW;
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
    // faint chirp ripples travelling over the shell
    float ripple = 0.5 + 0.5 * sin(vW.y * 0.35 - uPhase * 18.0);
    float a = (0.05 + 0.85 * fres) * (0.75 + 0.25 * ripple) * uAlpha;
    gl_FragColor = vec4(uColor * (1.0 + 1.5 * fres), a);
  }`;

export class RFWaves {
  constructor(scene, origin) {
    this.scene = scene; this.origin = origin.clone();
    this.geo = new THREE.SphereGeometry(1, 64, 40);
    this.color = new THREE.Color(0xff9a3c);
    this.maxR = 120; this.dur = 1.7;
    this.pool = []; this.active = [];
    this.emitTimer = 0;
  }
  setBand(freq) { this.color.set(freq === 868 ? 0x3cc8ff : 0xff9a3c); }
  setRange(sf) { this.maxR = 95 + (sf - 7) * 26; this.dur = 1.6 + (sf - 7) * 0.12; }
  emit() {
    let w = this.pool.pop();
    if (!w) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: DOME_VS, fragmentShader: DOME_FS, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uPhase: { value: 0 } },
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.userData.noThermal = true; mesh.renderOrder = 5; mesh.frustumCulled = false;
      w = { mesh, t: 0 };
      this.scene.add(mesh);
    }
    w.t = 0; w.mesh.visible = true; w.mesh.position.copy(this.origin);
    w.mesh.material.uniforms.uColor.value.copy(this.color);
    this.active.push(w);
  }
  /** Call every frame; `transmitting` spawns a new shell every 130 ms. */
  update(dt, transmitting) {
    if (transmitting) { this.emitTimer -= dt; if (this.emitTimer <= 0) { this.emit(); this.emitTimer = 0.13; } }
    else this.emitTimer = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const w = this.active[i]; w.t += dt;
      const p = w.t / this.dur;
      if (p >= 1) { w.mesh.visible = false; this.active.splice(i, 1); this.pool.push(w); continue; }
      const r = 3 + (this.maxR - 3) * (1 - Math.pow(1 - p, 2.2));
      w.mesh.scale.setScalar(r);
      w.mesh.material.uniforms.uAlpha.value = Math.pow(1 - p, 1.6) * 0.9;
      w.mesh.material.uniforms.uPhase.value = p;
    }
  }
}

/* ------------------------------------------------------------------ thermal camera */
export class Thermal {
  /**
   * @param root      scene node to recolour
   * @param board     the PCB box mesh (array material; index 2 is the top face)
   * @param heatMap   HeatMap instance whose texture replaces the board top
   */
  constructor(root, board, heatMap) {
    this.root = root; this.board = board; this.heat = heatMap;
    this.enabled = false;
    this.mats = new Map();
    this.saved = [];
    this.heatMat = new THREE.MeshBasicMaterial({ map: heatMap.tex });
    this.redrawT = 0;
    this.lo = 20; this.hi = 45;          // auto-ranged palette span (°C), smoothed so the picture does not flicker
  }
  /** Span the palette from just below ambient to a little above the hottest part, like an auto-ranging IR camera. */
  range(temps, dt) {
    const hottest = Math.max(temps.esp32, temps.ldo, temps.sx, temps.charger);
    const lo = temps.ambient - 4, hi = Math.max(hottest + 3, temps.ambient + 14);
    const k = Math.min(1, dt * 2.5);
    this.lo += (lo - this.lo) * k; this.hi += (hi - this.hi) * k;
  }
  matFor(key) {
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    return this.mats.get(key);
  }
  setEnabled(on, temps) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.saved = [];
      this.root.traverse(o => {
        if (!o.isMesh || o.userData.noThermal) return;
        const rec = { o, mat: o.material, vis: o.visible };
        this.saved.push(rec);
        if (o.userData.decal || o.userData.glow) { o.visible = false; return; }
        if (o === this.board) { o.material = [this.matFor('board'), this.matFor('board'), this.heatMat, this.matFor('board'), this.matFor('board'), this.matFor('board')]; return; }
        if (o.userData.screen) { o.material = this.matFor('screen'); return; }
        o.material = this.matFor(o.userData.heat || (o.userData.pcb ? 'ambient' : 'bench'));
      });
      this.update(temps, 1);
    } else {
      for (const r of this.saved) { r.o.material = r.mat; r.o.visible = r.vis; }
      this.saved = [];
    }
  }
  update(temps, dt) {
    if (!this.enabled) return;
    this.range(temps, dt);
    const set = (key, T) => { const c = ironbow(tNorm(T, this.lo, this.hi)); this.matFor(key).color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); };
    set('esp32', temps.esp32); set('ldo', temps.ldo); set('sx', temps.sx); set('charger', temps.charger); set('cp', temps.cp);
    set('ambient', temps.ambient + 2.5); set('board', temps.ambient + 3); set('bench', temps.ambient - 2.5); set('screen', temps.ambient + 2);
    this.redrawT -= dt;
    if (this.redrawT <= 0) { this.heat.draw(temps, this.lo, this.hi); this.redrawT = 0.12; }
  }
}
