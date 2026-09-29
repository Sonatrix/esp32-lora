// Entry point: scene, lighting, post-processing, simulation loop and glue between the modules.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildPCB } from './pcb.js';
import { buildBench } from './bench.js';
import { RFWaves, Thermal } from './effects.js';
import { LoraLink, PowerModel, timeOnAir, dataRate, sensitivity, maxRange, linkBudget } from './lora-sim.js';
import { HeatMap } from './textures.js';
import { UI } from './ui.js';

/* ------------------------------------------------------------------ renderer / scene */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b12);
scene.fog = new THREE.Fog(0x080b12, 450, 1500);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 1, 4000);
camera.position.set(95, 72, 128);
const controls = new OrbitControls(camera, canvas);
controls.target.set(8, 4, -4);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.03; controls.minDistance = 15; controls.maxDistance = 900;
controls.autoRotateSpeed = 0.6;

/* ------------------------------------------------------------------ lighting */
scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x1a1410, 0.35));
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(150, 260, 180); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 50; key.shadow.camera.far = 800;
Object.assign(key.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
scene.add(key);
const fill = new THREE.DirectionalLight(0xb8d0ff, 0.7); fill.position.set(-200, 120, -60); scene.add(fill);
const back = new THREE.DirectionalLight(0xffa23c, 0.35); back.position.set(-60, 60, -260); scene.add(back);

/* ------------------------------------------------------------------ post-processing */
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 4, type: THREE.HalfFloatType }));
composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
// Threshold sits above anything a lit white surface reaches, so only emissive LEDs, trace glow and RF domes bloom.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ world */
const pcb = buildPCB(); scene.add(pcb.group);
const bench = buildBench(pcb.refs.pads); scene.add(bench.group);
// The room environment is bright; soften reflections on every PBR material so pale surfaces stay below the bloom threshold.
scene.traverse(o => {
  if (!o.isMesh) return;
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.isMeshStandardMaterial) m.envMapIntensity = 0.7;
});
const waves = new RFWaves(scene, pcb.refs.rfOrigin);
const heat = new HeatMap();
const thermal = new Thermal(scene, pcb.refs.boardMesh, heat);

const link = new LoraLink();
const power = new PowerModel();

/* ------------------------------------------------------------------ camera presets */
const VIEWS = {
  iso:   { p: [95, 72, 128], t: [8, 4, -4] },
  top:   { p: [4, 175, 6],   t: [4, 0, 5] },
  bench: { p: [-60, 120, 330], t: [0, 40, -120] },
  ant:   { p: [140, 60, 60], t: [55, 35, -10] },
  oled:  { p: [12, 42, 32],  t: [3, 0, -11] },
};
let fly = null;
function flyTo(name) {
  const v = VIEWS[name]; if (!v) return;
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.p), t1: new THREE.Vector3(...v.t), k: 0 };
}

/* ------------------------------------------------------------------ UI */
let rxFlash = 0, oledDirty = true, thermalOn = false;
const ui = new UI({
  tx: () => link.requestTx(),
  continuous: v => { link.continuous = v; ui.log(`lora: continuous transmit ${v ? 'ON  (duty-cycle limits ignored on the bench)' : 'OFF'}`, 'app'); },
  sf: v => { link.cfg.sf = v; waves.setRange(v); refreshStats(); oledDirty = true; ui.log(`lora: setSpreadingFactor(${v})  Tsym=${(timeOnAir({ sf: v, bw: link.cfg.bw }).ts * 1000).toFixed(2)} ms`, 'app'); },
  freq: v => { link.cfg.freq = v; waves.setBand(v); refreshStats(); oledDirty = true; ui.log(`lora: setFrequency(${v}E6)  RegFrf=0x${Math.round(v * 1e6 / 61.035).toString(16).toUpperCase()}  PLL lock`, 'app'); },
  bw: v => { link.cfg.bw = v; refreshStats(); oledDirty = true; ui.log(`lora: setSignalBandwidth(${v}E3)${v === 125 && link.cfg.sf >= 11 ? '  LowDataRateOptimize=1' : ''}`, 'app'); },
  dist: km => { link.cfg.dist = km; refreshStats(); },
  power: src => setPower(src),
  thermal: on => setThermal(on),
  rotate: on => { controls.autoRotate = on; },
  view: name => flyTo(name),
  shot: () => screenshot(),
});

link.on('spi', d => { ui.setTxBusy(true); ui.log(`spi: NSS↓  RegFifo ← ${d.bytes} B @ 8 MHz   RegOpMode = LoRa|TX`, 'app'); });
link.on('txStart', d => {
  const c = link.cfg;
  ui.log(`lora: TX #${d.seq}  ${c.payload} B  SF${c.sf} BW${c.bw}k CR4/5  ${c.freq}.000 MHz  +${c.txPower} dBm  ToA ${(d.toa * 1000).toFixed(1)} ms`, 'tx');
});
link.on('txEnd', () => ui.log('irq: DIO0 ↑ TxDone   → RegOpMode = RXSINGLE, waiting for ACK', 'rom'));
link.on('rx', d => {
  if (d.ok) {
    rxFlash = 1;
    ui.log(`lora: RX ACK #${d.seq}  RSSI ${d.rssi.toFixed(0)} dBm  SNR ${d.snr >= 0 ? '+' : ''}${d.snr.toFixed(1)} dB  margin +${d.margin.toFixed(1)} dB`, 'rx');
  } else {
    ui.log(`lora: RxTimeout for #${d.seq}  (est. SNR ${d.snr.toFixed(1)} dB, needs > ${(d.snr - d.margin).toFixed(1)} dB at SF${link.cfg.sf}) — raise SF or narrow BW`, 'w');
  }
  refreshStats(); oledDirty = true;
});
link.on('idle', () => { ui.setTxBusy(false); oledDirty = true; });

function refreshStats() {
  const c = link.cfg;
  const lb = linkBudget({ sf: c.sf, bw: c.bw, freq: c.freq, dist: c.dist, txPower: c.txPower });
  ui.setStats({
    toa: timeOnAir({ sf: c.sf, bw: c.bw, payload: c.payload }).total,
    dr: dataRate(c.sf, c.bw), sens: sensitivity(c.sf, c.bw),
    range: maxRange({ sf: c.sf, bw: c.bw, freq: c.freq, txPower: c.txPower }),
    margin: lb.margin, rssi: link.stats.rssi, snr: link.stats.snr,
    tx: link.stats.tx, ack: link.stats.ack, rail: power.rail, vin: power.vin,
  });
}
function setPower(src) {
  if (power.source === src) return;
  power.source = src; ui.setPowerSource(src); oledDirty = true; refreshStats();
  ui.log(src === 'usb'
    ? `pwr: VBUS 5.02 V present — TP4056 ${power.charging ? 'charging (CC 350 mA)' : 'standby, cell full'}; CP2102N enumerated`
    : `pwr: USB removed — LDO fed from LiPo ${power.vbat.toFixed(2)} V, charger idle`, 'i');
}
function setThermal(on) {
  thermalOn = on;
  thermal.setEnabled(on, power.temps);
  ui.setThermalChecked(on); ui.setThermal(on, power.temps);
  bloom.threshold = on ? 1.3 : 1.6;
  ui.log(on ? 'cam: IR overlay ON  (ironbow, 20–85 °C, ε 0.95)' : 'cam: IR overlay OFF', 'rom');
}
function screenshot() {
  composer.render();
  const a = document.createElement('a');
  a.download = `esp32-lora-node-${Date.now()}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
}

/* ------------------------------------------------------------------ hover */
const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let ptrMoved = false, ptrX = 0, ptrY = 0;
canvas.addEventListener('pointermove', e => { ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ptrX = e.clientX; ptrY = e.clientY; ptrMoved = true; });
canvas.addEventListener('pointerleave', () => ui.hideTip());
function hover() {
  ptrMoved = false;
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects([pcb.group, bench.group], true);
  for (const h of hits) {
    if (h.object.userData.glow || !h.object.visible) continue;
    let o = h.object;
    while (o && !o.userData.info) o = o.parent;
    if (o) { ui.showTip(ptrX, ptrY, o.userData.info); return; }
    break;
  }
  ui.hideTip();
}

/* ------------------------------------------------------------------ boot log */
const BOOT = [
  ['rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)', 'rom'],
  ['configsip: 0, SPIWP:0xee   mode:DIO, clock div:1', 'rom'],
  ['load:0x3fff0030,len:1344   load:0x40078000,len:13964   entry 0x400805e4', 'rom'],
  ['I (31) boot: ESP-IDF v5.2 2nd stage bootloader', 'i'],
  ['I (312) cpu_start: Pro cpu up.  App cpu up.  ESP32-D0WD-V3 rev 3, 240 MHz', 'i'],
  ['I (388) spi: SPI2 host, SCK 8 MHz, mode 0, NSS GPIO5', 'app'],
  ['I (392) sx1276: RegVersion = 0x12  (SX1276/RFM95W detected)', 'app'],
  ['I (395) sx1276: 915.000 MHz  SF7  BW125k  CR4/5  +17 dBm PA_BOOST  preamble 8', 'app'],
  ['I (401) oled: SSD1306 128×64 @ 0x3C on I²C 400 kHz', 'app'],
  ['I (405) pwr: VBUS 5.02 V, VBAT 3.87 V, TP4056 CHRG asserted', 'i'],
  ['I (409) lora: node ready — press T to transmit a 24-byte sensor frame', 'i'],
];
BOOT.forEach(([m, c], i) => setTimeout(() => ui.log(m, c), 250 + i * 140));

/* ------------------------------------------------------------------ main loop */
const clock = new THREE.Clock();
let t = 0, spiK = 0, usbZ = 0, oledTimer = 0, screenTimer = 0, statsTimer = 0, thermalUiTimer = 0;
waves.setBand(link.cfg.freq); waves.setRange(link.cfg.sf);
refreshStats(); ui.setPowerDot(true);

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;

  link.update(dt);
  const st = link.state, c = link.cfg;
  const act = { tx: st === 'tx', spi: st === 'spi_write' || st === 'rx', oled: true };
  power.update(dt, act);

  // status LEDs
  const L = pcb.refs.leds;
  L.pwr.mat.emissiveIntensity = 2.2 + 0.08 * Math.sin(t * 31);
  const txTarget = act.tx ? 3 + 2.5 * Math.max(0, Math.sin(t * Math.PI * 2 * 9)) : 0;
  L.tx.mat.emissiveIntensity += (txTarget - L.tx.mat.emissiveIntensity) * Math.min(1, dt * 30);
  rxFlash = Math.max(0, rxFlash - dt * 3.5);
  L.rx.mat.emissiveIntensity = Math.max(st === 'rx' && link.stats.lastOk ? 4.5 : 0, rxFlash * 4);
  L.chrg.mat.emissiveIntensity = power.charging ? 2.6 + 0.6 * Math.sin(t * 3) : 0;
  L.stby.mat.emissiveIntensity = power.source === 'usb' && !power.charging ? 2.2 : 0;

  // trace glow: SPI bus during FIFO transfers, power nets scale with rail current
  spiK += ((act.spi ? 1 : 0) - spiK) * Math.min(1, dt * 18);
  pcb.refs.glow.spi.material.color.setRGB(0.25, 0.9, 1.0).multiplyScalar(spiK * 2.4);
  pcb.refs.glow.power.material.color.setRGB(1.0, 0.55, 0.15).multiplyScalar(0.22 + power.rail * 4 + (act.tx ? 0.25 : 0));

  waves.update(dt, act.tx);

  // USB plug slides out when running on the LiPo
  usbZ += ((power.source === 'usb' ? 0 : 16) - usbZ) * Math.min(1, dt * 4);
  bench.refs.usb.position.z = usbZ;

  // screens
  oledTimer -= dt;
  if (oledDirty || oledTimer <= 0) {
    oledDirty = false; oledTimer = 0.1;
    pcb.refs.oled.draw({ on: true, freq: c.freq, sf: c.sf, bw: c.bw, rssi: link.stats.rssi, snr: link.stats.snr,
      pkt: link.stats.tx, ack: link.stats.ack, state: st, lastOk: link.stats.lastOk, power: power.source,
      vbus: power.vbus, vbat: power.vbat, charging: power.charging, toa: link.toa(), dr: dataRate(c.sf, c.bw) });
  }
  screenTimer -= dt;
  if (screenTimer <= 0) {
    screenTimer = 1 / 30;
    bench.refs.scope.draw(t, { state: st, sf: c.sf, bw: c.bw, freq: c.freq });
    bench.refs.psu.draw(3.3 + (Math.random() - 0.5) * 0.002, power.rail);
  }
  statsTimer -= dt; if (statsTimer <= 0) { statsTimer = 0.5; refreshStats(); }

  // thermal camera
  thermal.update(power.temps, dt);
  if (thermalOn) { thermalUiTimer -= dt; if (thermalUiTimer <= 0) { thermalUiTimer = 0.25; ui.updateThermal(power.temps, thermal.lo, thermal.hi); } }

  // camera
  if (fly) {
    fly.k = Math.min(1, fly.k + dt / 0.9);
    const s = fly.k * fly.k * (3 - 2 * fly.k);
    camera.position.lerpVectors(fly.p0, fly.p1, s); controls.target.lerpVectors(fly.t0, fly.t1, s);
    if (fly.k >= 1) fly = null;
  }
  controls.update();
  if (ptrMoved) hover();

  composer.render();
}
frame();

// Deep links / smoke-test hooks: ?thermal=1 starts in IR mode, ?tx=1 fires a packet, ?cont=1 enables continuous TX,
// ?smoke=1 prints a status line to the console after a few seconds.
const q = new URLSearchParams(location.search);
if (q.get('thermal') === '1') setThermal(true);
if (q.get('cont') === '1') { ui.setContinuousChecked(true); link.continuous = true; }
if (q.get('tx') === '1') setTimeout(() => link.requestTx(), 1200);
if (q.get('smoke') === '1') {
  let frames = 0; const count = () => { frames++; requestAnimationFrame(count); }; count();
  setTimeout(() => console.log(`[smoke] frames=${frames} thermal=${thermal.enabled} swapped=${thermal.saved.length} link=${link.state} tx=${link.stats.tx} ack=${link.stats.ack} ` +
    `temps=${JSON.stringify(Object.fromEntries(Object.entries(power.temps).map(([k, v]) => [k, +v.toFixed(1)])))} waves=${waves.active.length}`), 5000);
}
window.addEventListener('error', e => console.log(`[smoke] uncaught: ${e.message} @ ${e.filename}:${e.lineno}`));

window.__loraReady = true;
const loading = document.getElementById('loading');
loading.style.opacity = '0'; setTimeout(() => loading.remove(), 700);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});
