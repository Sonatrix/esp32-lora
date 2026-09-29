// Workbench environment: ESD mat, oscilloscope, lab PSU with leads, LiPo pack, USB-C cable.
import * as THREE from 'three';
import { P, MAT_TOP, BENCH_TOP } from './layout.js';
import { woodTexture, matTexture, labelTexture, ScopeScreen, PsuDisplay } from './textures.js';
import { MAT, box, cyl, decal, tag } from './pcb.js';

function wire(points, radius, mat, seg = 90) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'catmullrom', 0.5);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 12, false), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Spring-hook test clip standing on a pad; returns the group and the world point where the lead attaches. */
function clip(pad, mat, name, desc, tilt = [0.15, 0.3]) {
  const g = new THREE.Group();
  g.add(cyl(0.3, 2.4, MAT.steel, 0, 0, 0, { seg: 10 }));
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.22, 8, 20, Math.PI * 1.2), MAT.steel);
  hook.position.set(0, 0.9, 0); hook.rotation.z = Math.PI / 2; hook.castShadow = true; g.add(hook);
  g.add(cyl(1.6, 9.5, mat, 0, 0, 2.4, { seg: 24 }));
  g.add(cyl(1.8, 1.4, mat, 0, 0, 11.9, { seg: 24 }));
  g.position.copy(pad); g.rotation.set(tilt[0], 0, tilt[1]);
  tag(g, name, desc);
  const top = new THREE.Vector3(0, 13.2, 0).applyEuler(g.rotation).add(pad);
  return { group: g, top };
}

function frontLabel(text, w, h, x, y, z, color = '#d8dde3') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: labelTexture(w, h, text, { color, ppm: 8 }), transparent: true, depthWrite: false }));
  m.position.set(x, y, z); m.userData.decal = true; m.renderOrder = 2;
  return m;
}

function powerSupply(refs) {
  const g = new THREE.Group();
  const px = -190, pz = -260, W = 230, H = 100, D = 170, F = pz + D / 2;
  g.add(box(W, H, D, MAT.instrument, px, pz, BENCH_TOP, { r: 3 }));
  g.add(box(W - 6, H - 6, 1.2, MAT.instrumentFront, px, F + 0.2, BENCH_TOP + 3));
  g.add(box(128, 60, 1.6, MAT.black, px - 30, F + 1.2, BENCH_TOP + 32, { r: 0.7 }));
  const psu = new PsuDisplay(); refs.psu = psu;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(120, 55), new THREE.MeshBasicMaterial({ map: psu.tex }));
  disp.position.set(px - 30, BENCH_TOP + 62, F + 2.05); disp.userData.screen = true; g.add(disp);
  g.add(frontLabel([{ t: 'BENCH PSU · 0–30 V · 0–5 A', s: 4, w: 700 }], 120, 6, px - 30, BENCH_TOP + 96, F + 1.5));
  for (const [x, lbl] of [[px + 70, 'VOLTAGE'], [px + 96, 'CURRENT']]) {
    g.add(cyl(9, 10, MAT.plastic, x, F + 5, BENCH_TOP + 70, { axis: 'z', seg: 32 }));
    g.add(cyl(1, 1, MAT.white, x, F + 10.1, BENCH_TOP + 76, { axis: 'z', seg: 8 }));
    g.add(frontLabel([{ t: lbl, s: 3.2 }], 26, 5, x, BENCH_TOP + 57, F + 1.5));
  }
  for (let i = 0; i < 4; i++) g.add(box(9, 6, 3, i === 1 ? MAT.cableRed : MAT.plastic, px + 62 + i * 13, F + 1.5, BENCH_TOP + 40));
  g.add(frontLabel([{ t: 'OUTPUT   LOCK   OVP   OCP', s: 2.6 }], 60, 4, px + 82, BENCH_TOP + 36, F + 1.5));
  const jack = (x, mat, name) => {
    const j = cyl(4.2, 9, mat, x, F + 4.5, BENCH_TOP + 24, { axis: 'z', seg: 24 });
    j.add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 16), MAT.black)).children[0].position.y = 4.6;
    tag(j, name, '4 mm banana jack.'); g.add(j);
    return new THREE.Vector3(x, BENCH_TOP + 24, F + 9);
  };
  const red = jack(px + 65, MAT.cableRed, 'PSU + output (3.30 V)');
  const blk = jack(px + 90, MAT.cableBlack, 'PSU − output');
  g.add(frontLabel([{ t: '+        −', s: 4, w: 700 }], 40, 6, px + 77, BENCH_TOP + 12, F + 1.5));
  for (const dx of [-100, 100]) g.add(cyl(6, 3, MAT.rubber, px + dx, pz, BENCH_TOP - 3));
  tag(g, 'Laboratory power supply', 'Linear bench supply set to 3.30 V (CV). Leads are clipped to the 3V3 / GND test pads; the ammeter shows the live 3V3 rail current.');
  return { group: g, red, blk };
}

function oscilloscope(refs) {
  const g = new THREE.Group();
  const sx = 150, sz = -250, W = 340, H = 150, D = 130, F = sz + D / 2;
  g.add(box(W, H, D, MAT.instrument, sx, sz, BENCH_TOP, { r: 3 }));
  g.add(box(W - 6, H - 6, 1.2, MAT.instrumentFront, sx, F + 0.2, BENCH_TOP + 3));
  g.add(box(212, 132, 1.6, MAT.black, sx - 55, F + 1.2, BENCH_TOP + 16, { r: 0.7 }));
  const scope = new ScopeScreen(); refs.scope = scope;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(200, 125), new THREE.MeshBasicMaterial({ map: scope.tex }));
  disp.position.set(sx - 55, BENCH_TOP + 82, F + 2.05); disp.userData.screen = true; g.add(disp);
  g.add(frontLabel([{ t: 'DSO 2000 · 200 MHz · 2 GSa/s · 4 CH', s: 4, w: 700 }], 130, 6, sx + 100, BENCH_TOP + 10, F + 1.5));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    g.add(cyl(6, 8, MAT.plastic, sx + 85 + c * 32, F + 4, BENCH_TOP + 120 - r * 34, { axis: 'z', seg: 24 }));
    g.add(cyl(0.8, 1, MAT.white, sx + 85 + c * 32, F + 8.1, BENCH_TOP + 124 - r * 34, { axis: 'z', seg: 8 }));
  }
  for (let i = 0; i < 6; i++) g.add(box(8, 5, 2.5, i === 2 ? MAT.cableRed : MAT.plastic, sx + 75 + i * 14, F + 1.2, BENCH_TOP + 40));
  const bncs = [];
  for (let i = 0; i < 4; i++) {
    const x = sx - 135 + i * 36;
    const b = cyl(4.6, 9, MAT.steel, x, F + 4.5, BENCH_TOP + 14, { axis: 'z', seg: 24 });
    b.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.6, 16), MAT.black)).children[0].position.y = 4.6;
    tag(b, `Channel ${i + 1} BNC`, '1 MΩ / 50 Ω input.'); g.add(b);
    g.add(frontLabel([{ t: `${i + 1}`, s: 4, w: 700, c: ['#ffd23f', '#3fd8ff', '#ff7dd6', '#7fff7f'][i] }], 8, 6, x, BENCH_TOP + 26, F + 1.5));
    bncs.push(new THREE.Vector3(x, BENCH_TOP + 14, F + 9));
  }
  for (const dx of [-150, 150]) g.add(cyl(6, 3, MAT.rubber, sx + dx, sz, BENCH_TOP - 3));
  tag(g, 'Digital oscilloscope', 'CH1 (yellow) is on an RF detector after the antenna coupler and shows the LoRa chirp during TX. CH2 (cyan) probes the SPI clock between the ESP32 and the SX1276.');
  return { group: g, bncs };
}

function battery() {
  const g = new THREE.Group();
  const bx = 10, bz = 44;
  g.add(box(50, 6, 34, MAT.pouch, bx, bz, MAT_TOP, { r: 1.5 }));
  g.add(box(50.4, 6.3, 8, MAT.tape, bx, 30.5, MAT_TOP - 0.15));
  g.add(decal(labelTexture(40, 18, [
    { t: 'Li-Po 3.7 V', s: 4.2, w: 800, c: '#222' }, { t: '1200 mAh · 4.44 Wh', s: 2.6, c: '#333' },
    { t: 'protected · do not puncture', s: 1.9, c: '#a33' }], { bg: '#f0f0ee', ppm: 12 }), 40, 18, bx, MAT_TOP + 6.02, 47, 0, true));
  g.add(wire([[6, MAT_TOP + 3, 27], [10, 0, 26.5], [20, 3, 25], [23, 2.6, 22.9]], 0.6, MAT.cableRed, 40));
  g.add(wire([[9, MAT_TOP + 3, 27], [14, 0.5, 27.5], [23.5, 3.2, 25.5], [25, 2.6, 22.9]], 0.6, MAT.cableBlack, 40));
  return tag(g, 'LiPo cell · 3.7 V 1200 mAh', 'Single-cell pouch with a protection PCB under the tape, JST-PH lead to J2. Charged by the TP4056 whenever USB is present; powers the node through the LDO in LiPo mode.');
}

function usbCable() {
  const g = new THREE.Group(); const { x, z, d } = P.usbc;
  const yC = P.usbc.h / 2;
  g.add(box(12, 6.5, 26, MAT.aluminum, x, z + d / 2 + 14, yC - 3.25, { r: 2 }));
  g.add(box(8.2, 2.4, 10, MAT.steel, x, z + d / 2 - 4, yC - 1.2));
  g.add(cyl(3.2, 10, MAT.rubber, x, z + d / 2 + 32, yC, { axis: 'z', rt: 2.2 }));
  g.add(wire([[x, yC, z + d / 2 + 36], [x, -1, 80], [x - 2, -4.6, 115], [x - 8, -4.6, 150], [x - 21, BENCH_TOP + 2, 200],
    [x - 51, BENCH_TOP + 2, 290], [x - 96, BENCH_TOP + 2, 380]], 1.9, MAT.cableBlack, 120));
  g.add(decal(labelTexture(8, 4, [{ t: 'USB-C', s: 2.2, w: 700, c: '#444' }], { ppm: 30 }), 8, 4, x, yC + 3.27, z + d / 2 + 14));
  return tag(g, 'USB-C cable', 'Bench USB-C cable providing 5 V VBUS and the serial console. Pulled out when the node runs on the LiPo.');
}

function tweezers() {
  const g = new THREE.Group();
  const a = box(2.6, 1, 118, MAT.steel, 0, 0, MAT_TOP); a.rotation.y = 0.06;
  const b = box(2.6, 1, 118, MAT.steel, 0, 0, MAT_TOP); b.rotation.y = -0.06;
  g.add(a, b); g.add(box(4, 3, 14, MAT.steel, 0, -55, MAT_TOP));
  g.position.set(-120, 0, 70); g.rotation.y = 0.55;
  return tag(g, 'ESD-safe tweezers', 'For flipping over 0603 parts you definitely did not just drop.');
}

export function buildBench(pads) {
  const g = new THREE.Group(); g.name = 'bench';
  const refs = { scope: null, psu: null, usb: null };

  const bench = box(1800, 40, 1100, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }), 0, -180, BENCH_TOP - 40);
  bench.castShadow = false; g.add(tag(bench, 'Workbench', 'Oiled walnut top. Please do not solder directly on it.'));
  const mat = box(440, 2, 300, new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.92 }), 12, 2, MAT_TOP - 2, { r: 0.9 });
  mat.castShadow = false; g.add(tag(mat, 'ESD mat', 'Dissipative rubber mat, 10⁷ Ω/sq, grounded to the bench.'));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1000), new THREE.MeshStandardMaterial({ color: 0x0a0e15, roughness: 1 }));
  wall.position.set(0, 400, -700); wall.receiveShadow = true; g.add(wall);

  const psu = powerSupply(refs); g.add(psu.group);
  const scope = oscilloscope(refs); g.add(scope.group);
  g.add(battery(), tweezers());
  refs.usb = usbCable(); g.add(refs.usb);

  const c33 = clip(pads.v33, MAT.cableRed, 'Test clip · 3V3', 'Bench supply positive lead on the 3V3 rail.', [0.1, 0.35]);
  const cgnd = clip(pads.gnd, MAT.cableBlack, 'Test clip · GND', 'Bench supply return.', [0.25, 0.3]);
  const cdio = clip(pads.dio0, MAT.cableGrey, 'Scope probe · DIO0', 'Passive 10:1 probe on the SX1276 DIO0 interrupt line.', [-0.2, 0.28]);
  g.add(c33.group, cgnd.group, cdio.group);

  g.add(tag(wire([psu.red, [-95, 22, -140], [-20, 16, -105], [55, 12, -70], [78, 9, -15], [62, 9, 22], c33.top], 1.5, MAT.cableRed),
    'PSU lead (+)', 'Silicone 18 AWG test lead, banana to spring hook.'));
  g.add(tag(wire([psu.blk, [-72, 24, -150], [0, 18, -118], [66, 13, -80], [86, 9, -12], [68, 9, 30], cgnd.top], 1.5, MAT.cableBlack),
    'PSU lead (−)', 'Silicone 18 AWG test lead, banana to spring hook.'));
  g.add(tag(wire([scope.bncs[0], [60, 25, -150], [95, 20, -80], [92, 12, -5], [70, 12, 40], cdio.top], 1.0, MAT.cableGrey),
    'Scope probe cable (CH1)', 'Coax to the passive probe on DIO0.'));

  return { group: g, refs };
}
