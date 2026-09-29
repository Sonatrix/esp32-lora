// Builds the ESP32 + SX1276 LoRa node PCB. Everything is procedural; units are mm, board top = y 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BOARD, P, PASSIVES, HEADER_PINS, SX_PADS } from './layout.js';
import { buildBoardTextures, moduleTopTexture, labelTexture, brushedRoughness, OledScreen } from './textures.js';

const std = o => new THREE.MeshStandardMaterial(o);
export const MAT = {
  gold:       std({ color: 0xd9b74a, metalness: 1, roughness: 0.25 }),
  brass:      std({ color: 0xc9a14a, metalness: 1, roughness: 0.42 }),
  tin:        std({ color: 0xcfd1d0, metalness: 1, roughness: 0.38 }),
  steel:      std({ color: 0xb4b8bd, metalness: 0.95, roughness: 0.32 }),
  can:        std({ color: 0xc2c6cb, metalness: 1, roughness: 0.32 }),
  aluminum:   std({ color: 0x9da2a8, metalness: 0.9, roughness: 0.4 }),
  epoxy:      std({ color: 0x15161a, roughness: 0.5 }),
  resistor:   std({ color: 0x1a1a1c, roughness: 0.45 }),
  ceramic:    std({ color: 0xb59b74, roughness: 0.6 }),
  tant:       std({ color: 0xd7a53d, roughness: 0.55 }),
  tantStripe: std({ color: 0x6b3a1a, roughness: 0.55 }),
  white:      std({ color: 0xf2f0e8, roughness: 0.6 }),
  ledBody:    std({ color: 0xe8e4d4, roughness: 0.5 }),
  rubber:     std({ color: 0x0f0f11, roughness: 0.9 }),
  blackMetal: std({ color: 0x2a2c30, metalness: 0.9, roughness: 0.45 }),
  modulePcb:  std({ color: 0x10151d, roughness: 0.5 }),
  plastic:    std({ color: 0x1c1c1e, roughness: 0.6 }),
  black:      std({ color: 0x050506, roughness: 0.7 }),
  foam:       std({ color: 0x2a2a2e, roughness: 0.95 }),
  kapton:     std({ color: 0xb8651c, roughness: 0.4, transparent: true, opacity: 0.85 }),
  glass:      new THREE.MeshPhysicalMaterial({ color: 0x06070a, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }),
  instrument: std({ color: 0x3a3d43, roughness: 0.6 }),
  instrumentFront: std({ color: 0x4a4e55, roughness: 0.55 }),
  cableRed:   std({ color: 0xd42a1e, roughness: 0.75 }),
  cableBlack: std({ color: 0x151515, roughness: 0.75 }),
  cableGrey:  std({ color: 0x6a6d72, roughness: 0.7 }),
  pouch:      std({ color: 0x8f949b, metalness: 0.35, roughness: 0.45 }),
  tape:       std({ color: 0xe8c23a, roughness: 0.5 }),
};
MAT.can.roughnessMap = brushedRoughness();

/* ------------------------------------------------------------------ helpers */
export function box(w, h, d, mat, x, z, y = 0, { r = 0, ry = 0, shadow = true } = {}) {
  const geo = r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + h / 2, z); m.rotation.y = ry;
  m.castShadow = m.receiveShadow = shadow;
  return m;
}
/** axis 'y': y is the base; axis 'x' | 'z': (x,y,z) is the centre. */
export function cyl(r, h, mat, x, z, y = 0, { seg = 32, axis = 'y', rt = r } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, r, h, seg), mat);
  if (axis === 'x') { m.rotation.z = Math.PI / 2; m.position.set(x, y, z); }
  else if (axis === 'z') { m.rotation.x = Math.PI / 2; m.position.set(x, y, z); }
  else m.position.set(x, y + h / 2, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
/** Thin textured plane laid on a surface. `lit` uses a shaded material for opaque labels so they do not overexpose / bloom. */
export function decal(texture, w, d, x, y, z, rz = 0, lit = false) {
  const opts = { map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    lit ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.85, metalness: 0 }) : new THREE.MeshBasicMaterial(opts));
  m.rotation.set(-Math.PI / 2, 0, rz); m.position.set(x, y, z);
  m.userData.decal = true; m.renderOrder = 2;
  return m;
}
export function tag(obj, name, desc, heat) {
  obj.userData.info = { name, desc };
  if (heat) obj.traverse(o => { if (o.isMesh) o.userData.heat = heat; });
  return obj;
}
function gullwing(x, z, dir, len = 1.2, w = 0.6) {
  const g = new THREE.Group();
  g.add(box(w, 0.22, len, MAT.tin, x, z + dir * len / 2, 0));
  g.add(box(w, 0.9, 0.22, MAT.tin, x, z, 0.15));
  return g;
}

const RES_CODES = ['103', '472', '221', '000', '512', '1R0', '104'];
const resLabels = RES_CODES.map(c => labelTexture(1.0, 0.7, [{ t: c, s: 0.42, c: '#e8e8e8', w: 700 }], { ppm: 90 }));

/* ------------------------------------------------------------------ components */
function passive(p, i) {
  const g = new THREE.Group();
  const L = 1.6, W = 0.8, H = 0.45;
  g.add(box(L - 0.6, H, W, p.t === 'R' ? MAT.resistor : MAT.ceramic, 0, 0, 0.02));
  g.add(box(0.3, H, W, MAT.tin, -(L / 2 - 0.15), 0, 0), box(0.3, H, W, MAT.tin, L / 2 - 0.15, 0, 0));
  if (p.t === 'R') g.add(decal(resLabels[i % resLabels.length], 1.0, 0.7, 0, H + 0.03, 0));
  g.position.set(p.x, 0, p.z); g.rotation.y = p.r ? Math.PI / 2 : 0;
  const what = p.t === 'R' ? `0603 resistor · ${RES_CODES[i % RES_CODES.length]}` : '0603 MLCC capacitor';
  return tag(g, `${p.d} · ${what}`,
    p.t === 'R' ? 'Thick-film chip resistor (1.6 × 0.8 mm). LED series, pull-ups, USB CC pull-downs and the reset RC.'
                : 'X7R ceramic decoupling capacitor (1.6 × 0.8 mm) close to a supply pin.');
}

function esp32Module() {
  const g = new THREE.Group();
  const L = P.esp32.x1 - P.esp32.x0, D = P.esp32.z1 - P.esp32.z0, cx = (P.esp32.x0 + P.esp32.x1) / 2;
  g.add(box(L, 0.8, D, MAT.modulePcb, cx, 0, 0));
  g.add(decal(moduleTopTexture(), L, D, cx, 0.815, 0));
  for (let x = P.esp32.antX1 + 0.9; x < P.esp32.x1 - 0.4; x += 1.27)
    for (const s of [-1, 1]) g.add(box(0.6, 0.85, 1.0, MAT.gold, x, s * (D / 2 - 0.45), 0));
  for (let z = -8.3; z <= 8.3; z += 1.27) g.add(box(1.0, 0.85, 0.6, MAT.gold, P.esp32.x1 - 0.45, z, 0));
  const canCx = (P.can.x0 + P.can.x1) / 2;
  g.add(box(P.can.x1 - P.can.x0, P.can.h, P.can.z1 - P.can.z0, MAT.can, canCx, 0, 0.8, { r: 0.35 }));
  g.add(decal(labelTexture(18, 16, [
    { t: 'ESP32-WROOM-32', s: 1.7, w: 700 }, { t: '', s: 0.5 },
    { t: 'FCC ID: 2AC7Z-ESPWROOM32', s: 0.8 }, { t: 'IC: 21098-ESPWROOM32', s: 0.8 }, { t: '', s: 0.4 },
    { t: 'espressif', s: 1.4, w: 800 }], { color: '#eef1f4' }), 18, 16, canCx, 0.8 + P.can.h + 0.02, 0));
  return tag(g, 'ESP32-WROOM-32 (U1)',
    'Dual-core Xtensa LX6 @ 240 MHz, 4 MB flash, Wi-Fi + BT under a tin-plated RF shield. Meander PCB antenna hangs over the board edge in a copper keep-out. Drives the radio over SPI at 8 MHz.', 'esp32');
}

function sxModule() {
  const g = new THREE.Group(); const { x, z, s } = P.sx;
  g.add(box(s, 0.8, s, MAT.modulePcb, x, z, 0));
  g.add(box(s - 0.6, 1.9, s - 0.6, MAT.tin, x, z, 0.8, { r: 0.3 }));
  SX_PADS.forEach(pz => {
    g.add(box(0.6, 0.85, 0.9, MAT.gold, x - s / 2 + 0.3, pz, 0));
    g.add(box(0.6, 0.85, 0.9, MAT.gold, x + s / 2 - 0.3, pz, 0));
  });
  g.add(decal(labelTexture(14, 14, [{ t: 'RFM95W', s: 2.4, w: 800 }, { t: '915S2', s: 1.7 }, { t: '', s: 0.6 }, { t: 'HOPERF', s: 1.1 }],
    { color: '#2b3036' }), 14, 14, x, 0.8 + 1.9 + 0.02, z));
  return tag(g, 'SX1276 LoRa transceiver · RFM95W (U2)',
    'Semtech SX1276 chirp-spread-spectrum radio, +20 dBm PA, 137–1020 MHz. SPI slave (SCK/MISO/MOSI/NSS) plus RST and DIO0 (TxDone / RxDone IRQ). 50 Ω RF out feeds the SMA through stitched ground vias.', 'sx');
}

function smaAndAntenna(refs) {
  const g = new THREE.Group(); const { x, z } = P.sma; const y = -BOARD.T / 2;
  const sma = new THREE.Group();
  sma.add(box(4, 0.4, 5, MAT.gold, x - 2, z, 0));
  sma.add(box(4, 0.4, 5, MAT.gold, x - 2, z, -BOARD.T - 0.4));
  sma.add(box(1.6, 0.35, 1.2, MAT.gold, x - 1.4, z, 0));
  sma.add(cyl(3.45, 5.5, MAT.gold, x + 2.75, z, y, { seg: 6, axis: 'x' }));
  sma.add(cyl(3.1, 6, MAT.gold, x + 8.5, z, y, { axis: 'x' }));
  for (let k = 0; k < 5; k++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.13, 8, 40), MAT.brass);
    t.rotation.y = Math.PI / 2; t.position.set(x + 6.3 + k * 1.1, y, z); sma.add(t);
  }
  sma.add(cyl(0.65, 6.6, MAT.gold, x + 8.6, z, y, { seg: 16, axis: 'x' }));
  tag(sma, 'SMA edge connector (J3)', 'Gold-plated 50 Ω SMA jack straddling the board edge. Centre pin lands on the 1.2 mm RF trace from the SX1276 ANT pad.');
  g.add(sma);

  const ant = new THREE.Group();
  ant.add(cyl(4.0, 6.5, MAT.blackMetal, x + 14.75, z, y, { seg: 24, axis: 'x' }));      // knurled SMA nut
  ant.add(cyl(4.3, 6.5, MAT.rubber, x + 21, z, y, { axis: 'x' }));                       // elbow stub
  ant.add(cyl(4.3, 8.8, MAT.rubber, x + 24, z, y, { axis: 'z' }));                       // hinge
  const profile = [[0, 0], [4.3, 0], [4.6, 4], [4.6, 14], [4.2, 58], [3.6, 74], [2.4, 79], [0, 80]].map(([r, h]) => new THREE.Vector2(r, h));
  const duck = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), MAT.rubber);
  duck.position.set(x + 24, y, z); duck.castShadow = duck.receiveShadow = true; ant.add(duck);
  const band = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.35, 8, 40), MAT.steel);
  band.rotation.x = Math.PI / 2; band.position.set(x + 24, y + 5, z); ant.add(band);
  tag(ant, '915 MHz rubber-duck antenna', 'Half-wave sleeve dipole in a flexible TPU jacket, ~2 dBi, articulated SMA male elbow. Simulated RF domes expand from its centre.');
  g.add(ant);
  refs.rfOrigin = new THREE.Vector3(x + 24, y + 42, z);
  return g;
}

function usbc() {
  const g = new THREE.Group(); const { x, z, w, d, h } = P.usbc;
  g.add(box(w, h, d, MAT.steel, x, z, 0, { r: 1.2 }));
  g.add(box(w - 1.4, h - 1.2, 0.3, MAT.black, x, z + d / 2 - 0.05, 0.6));
  g.add(box(6.6, 0.7, 4, MAT.plastic, x, z + d / 2 - 2.2, h / 2 - 0.35));
  return tag(g, 'USB-C receptacle (J1)', 'USB 2.0 Type-C, 16-pin mid-mount. 5.1 kΩ CC pull-downs (R20/R21) advertise a 5 V sink; VBUS feeds the TP4056 and the CP2102N bridge.');
}

function oled(refs) {
  const g = new THREE.Group(); const { x, z, w, d } = P.oled;
  g.add(box(w - 2, 1.0, d - 2, MAT.foam, x, z, 0));
  g.add(box(w, 1.4, d, MAT.glass, x, z, 1.0));
  const screen = new OledScreen(); refs.oled = screen;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(21.7, 10.9), new THREE.MeshBasicMaterial({ map: screen.tex }));
  scr.rotation.x = -Math.PI / 2; scr.position.set(x, 2.415, z + 1.6); scr.userData.screen = true; scr.renderOrder = 2; g.add(scr);
  g.add(box(13, 0.12, 4, MAT.kapton, x, z - d / 2 - 2, 0.05));
  g.add(box(13, 2.4, 0.12, MAT.kapton, x, z - d / 2 - 0.06, 0.05));
  g.add(box(9, 0.4, 1.4, MAT.epoxy, x, z - d / 2 - 2.5, 0.17));
  return tag(g, '0.96" OLED · SSD1306 (DISP1)', '128 × 64 two-colour PMOLED on I²C (SDA/SCL from the ESP32). Shows live RSSI, SNR, packet counters and the active power source.');
}

function led(def, key, refs) {
  const g = new THREE.Group();
  g.add(box(1.6, 0.55, 0.8, MAT.ledBody, def.x, def.z, 0));
  const lensMat = std({ color: 0x1d1d1f, emissive: def.c, emissiveIntensity: 0, roughness: 0.3 });
  const lens = box(0.9, 0.25, 0.55, lensMat, def.x, def.z, 0.55); lens.castShadow = false; g.add(lens);
  refs.leds[key] = { mat: lensMat };
  const desc = { pwr: 'Green: 3V3 rail present.', tx: 'Red: pulses while the SX1276 PA is keyed.', rx: 'Blue: flashes on RxDone (ACK received).',
    chrg: 'Orange: TP4056 constant-current / constant-voltage charge in progress.', stby: 'Blue: charge terminated, battery full.' }[key];
  return tag(g, `${def.name} status LED (0603)`, desc);
}

function ldo() {
  const g = new THREE.Group(); const { x, z } = P.ldo;
  g.add(box(6.5, 1.6, 3.5, MAT.epoxy, x, z, 0.02));
  [-2.3, 0, 2.3].forEach(dx => g.add(gullwing(x + dx, z + 1.75, 1, 1.2, 0.7)));
  g.add(box(3.0, 0.3, 1.6, MAT.tin, x, z - 2.5, 0));
  g.add(decal(labelTexture(6, 3, [{ t: 'AMS1117', s: 0.95, w: 700 }, { t: '3.3', s: 0.9 }], { color: '#cfd3d8' }), 6, 3, x, 1.64, z));
  return tag(g, 'AMS1117-3.3 LDO (U3)', 'SOT-223 linear regulator: 5 V (USB) or VBAT in, 3.3 V out. Dissipates (Vin − 3.3 V) × I as heat, so it runs hottest on USB during TX.', 'ldo');
}

function charger() {
  const g = new THREE.Group(); const { x, z } = P.tp4056;
  g.add(box(4.9, 1.5, 3.9, MAT.epoxy, x, z, 0.1));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.add(gullwing(x - 1.905 + i * 1.27, z + s * 1.95, s, 0.95, 0.42));
  g.add(decal(labelTexture(4.5, 3, [{ t: 'TP4056', s: 0.85, w: 700 }, { t: '2026', s: 0.6 }], { color: '#cfd3d8' }), 4.5, 3, x, 1.62, z));
  return tag(g, 'TP4056 Li-ion charger (U4)', 'Linear 1 A single-cell charger, 4.2 V termination. Active when VBUS is present; CHRG and STDBY open-drain outputs drive the two LEDs.', 'charger');
}

function usbBridge() {
  const g = new THREE.Group(); const { x, z, s } = P.cp2102;
  g.add(box(s, 0.9, s, MAT.epoxy, x, z, 0.05, { r: 0.15 }));
  g.add(decal(labelTexture(4.5, 4.5, [{ t: 'CP2102N', s: 0.8, w: 700 }, { t: 'A02', s: 0.6 }, { t: '●', s: 0.5 }], { color: '#cfd3d8' }), 4.5, 4.5, x, 0.96, z));
  return tag(g, 'CP2102N USB-UART bridge (U5)', 'QFN-28 USB to UART; DTR/RTS drive the auto-reset transistors so esptool can enter the bootloader.', 'cp');
}

function jst() {
  const g = new THREE.Group(); const { x, z } = P.jst;
  g.add(box(7.9, 6, 4.5, MAT.white, x, z, 0, { r: 0.3 }));
  g.add(box(6.3, 3.4, 0.3, MAT.black, x, z + 2.15, 1.4));
  for (const dx of [-1, 1]) g.add(box(0.6, 3.0, 0.6, MAT.tin, x + dx, z + 1.6, 1.5));
  return tag(g, 'JST-PH 2-pin battery connector (J2)', '2.0 mm pitch LiPo input. BAT+ goes to the TP4056 BAT pin and on to the LDO input.');
}

function button(def, name) {
  const g = new THREE.Group();
  g.add(box(3.5, 1.4, 3.5, MAT.steel, def.x, def.z, 0, { r: 0.2 }));
  g.add(cyl(0.9, 0.6, MAT.black, def.x, def.z, 1.4, { seg: 24 }));
  return tag(g, `${name} tactile switch`, name === 'EN' ? 'Pulls the ESP32 EN pin low: hardware reset.' : 'Holds IO0 low at reset to enter the serial bootloader.');
}

function tantalum(pos, i) {
  const g = new THREE.Group();
  g.add(box(3.5, 1.9, 2.8, MAT.tant, pos.x, pos.z, 0.02));
  g.add(box(0.6, 1.92, 2.82, MAT.tantStripe, pos.x - 1.3, pos.z, 0.02));
  for (const s of [-1, 1]) g.add(box(0.5, 0.3, 2.2, MAT.tin, pos.x + s * 1.9, pos.z, 0));
  return tag(g, `C${30 + i} · 3528 tantalum 22 µF`, 'Bulk capacitance on the regulator input/output. Stripe marks the anode (+).');
}

function sot23(def) {
  const g = new THREE.Group();
  g.add(box(2.9, 1.1, 1.3, MAT.epoxy, 0, 0, 0.1));
  [[-0.95, 1], [0.95, 1], [0, -1]].forEach(([dx, dir]) => g.add(gullwing(dx, dir * 0.65, dir, 0.55, 0.4)));
  g.position.set(def.x, 0, def.z); g.rotation.y = def.rot;
  return tag(g, `${def.name} (SOT-23)`, def.desc);
}

function header() {
  const g = new THREE.Group(); const z = P.header.z;
  const cx = (HEADER_PINS[0] + HEADER_PINS[HEADER_PINS.length - 1]) / 2;
  g.add(box(P.header.n * 2.54, 2.5, 2.54, MAT.plastic, cx, z, 0));
  HEADER_PINS.forEach(x => g.add(box(0.64, 8.5, 0.64, MAT.gold, x, z, 0)));
  return tag(g, 'Programming / debug header', `1×6 at 2.54 mm: ${P.header.names.join(' · ')}. Breakout for a logic analyser or an external UART.`);
}

/* ------------------------------------------------------------------ assembly */
export function buildPCB() {
  const g = new THREE.Group(); g.name = 'pcb';
  const refs = { leds: {}, glow: {}, pads: {}, oled: null, rfOrigin: null, boardMesh: null };

  const bt = buildBoardTextures();
  const topMat = std({ map: bt.top, roughness: 0.55, metalness: 0.05 });
  const sideMat = std({ map: bt.side, roughness: 0.8 });
  const botMat = std({ map: bt.bottom, roughness: 0.6 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD.L, BOARD.T, BOARD.W), [sideMat, sideMat, topMat, botMat, sideMat, sideMat]);
  board.position.y = -BOARD.T / 2; board.receiveShadow = board.castShadow = true;
  board.userData.heat = 'board';
  tag(board, 'Custom 4-layer PCB', '72 × 46 mm, 1.6 mm FR-4, matte black mask, ENIG finish. Stack-up: signal / GND / 3V3 / signal. Traces show faintly through the mask; hover the glowing ones during activity.');
  refs.boardMesh = board;
  g.add(board);

  const mkGlow = t => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.L, BOARD.W),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x000000 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.userData.glow = true; m.renderOrder = 1; return m;
  };
  refs.glow.spi = mkGlow(bt.spiGlow); refs.glow.power = mkGlow(bt.powerGlow);
  g.add(refs.glow.spi, refs.glow.power);

  g.add(esp32Module(), sxModule(), smaAndAntenna(refs), usbc(), oled(refs), ldo(), charger(), usbBridge(), jst(), header());
  Object.entries(P.leds).forEach(([k, d]) => g.add(led(d, k, refs)));
  g.add(button(P.buttons.en, 'EN'), button(P.buttons.boot, 'BOOT'));
  P.tant.forEach((t, i) => g.add(tantalum(t, i)));
  P.sot23.forEach(s => g.add(sot23(s)));
  PASSIVES.forEach((p, i) => g.add(passive(p, i)));

  Object.entries(P.pads).forEach(([k, p]) => {
    const m = cyl(1.0, 0.06, MAT.gold, p.x, p.z, 0, { seg: 24 });
    tag(m, `${p.label} test pad`, k === 'dio0' ? 'Scope probe: SX1276 DIO0 goes high on TxDone / RxDone.' : `Bench-supply lead clipped to ${p.label}.`);
    g.add(m); refs.pads[k] = new THREE.Vector3(p.x, 0, p.z);
  });

  P.holes.forEach(([x, z]) => {
    const so = cyl(2.75, 5, MAT.brass, x, z, -BOARD.T - 5, { seg: 6 });
    const head = cyl(2.6, 1.4, MAT.steel, x, z, 0, { seg: 24 });
    const socket = cyl(1.1, 0.35, MAT.black, x, z, 1.4, { seg: 12 });
    tag(so, 'M3 brass standoff', '5 mm hex standoff lifting the board off the ESD mat.');
    tag(head, 'M3 button-head screw', '');
    g.add(so, head, socket);
  });

  g.traverse(o => { if (o.isMesh) o.userData.pcb = true; });
  return { group: g, refs };
}
