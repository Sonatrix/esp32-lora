// Procedural canvas textures: board artwork, chip markings, live screens, IR heat map, bench surfaces.
import * as THREE from 'three';
import { BOARD, PX, P, TRACES, VIAS, PASSIVES, HEADER_PINS, HOTSPOTS } from './layout.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
export function tex(canvas, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

const mx = x => (x + BOARD.L / 2) * PX;
const mz = z => (z + BOARD.W / 2) * PX;
const MONO = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';
const SANS = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/* ------------------------------------------------------------------ 2D helpers */
function chamfer(pts, c) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
    const d1x = bx - ax, d1z = bz - az, l1 = Math.hypot(d1x, d1z);
    const d2x = cx - bx, d2z = cz - bz, l2 = Math.hypot(d2x, d2z);
    const k = Math.min(c, l1 / 2, l2 / 2);
    out.push([bx - d1x / l1 * k, bz - d1z / l1 * k], [bx + d2x / l2 * k, bz + d2z / l2 * k]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function strokeTrace(ctx, pts, wMm, color, c = 0.6) {
  const p = chamfer(pts, c);
  ctx.strokeStyle = color; ctx.lineWidth = wMm * PX; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  p.forEach(([x, z], i) => (i ? ctx.lineTo(mx(x), mz(z)) : ctx.moveTo(mx(x), mz(z))));
  ctx.stroke();
}
function rectMm(ctx, x, z, w, d, color, rot = 0, stroke = false, lw = 0.15) {
  ctx.save(); ctx.translate(mx(x), mz(z)); ctx.rotate(rot);
  if (stroke) { ctx.strokeStyle = color; ctx.lineWidth = lw * PX; ctx.strokeRect(-w / 2 * PX, -d / 2 * PX, w * PX, d * PX); }
  else { ctx.fillStyle = color; ctx.fillRect(-w / 2 * PX, -d / 2 * PX, w * PX, d * PX); }
  ctx.restore();
}
function circleMm(ctx, x, z, r, color, stroke = false, lw = 0.15) {
  ctx.beginPath(); ctx.arc(mx(x), mz(z), r * PX, 0, Math.PI * 2);
  if (stroke) { ctx.strokeStyle = color; ctx.lineWidth = lw * PX; ctx.stroke(); } else { ctx.fillStyle = color; ctx.fill(); }
}
function textMm(ctx, str, x, z, sizeMm, color, { align = 'center', weight = 600, rot = 0, font = SANS } = {}) {
  ctx.save(); ctx.translate(mx(x), mz(z)); ctx.rotate(rot);
  ctx.fillStyle = color; ctx.font = `${weight} ${sizeMm * PX}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(str, 0, 0);
  ctx.restore();
}
function grain(ctx, w, h, amp) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ board artwork */
export function buildBoardTextures() {
  const W = BOARD.L * PX, H = BOARD.W * PX;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');

  // matte black soldermask with fine grain
  ctx.fillStyle = '#0f1013'; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 9);

  // ground pour shows faintly through the mask on the RF side
  ctx.fillStyle = 'rgba(60,52,44,0.10)';
  ctx.fillRect(mx(18), mz(-23), (36 - 18) * PX, (0 - -23) * PX);

  // copper traces (under mask: dark brown-grey)
  const traceColor = { spi: '#2d2721', power: '#302a24', signal: '#282420', rf: '#332c25' };
  TRACES.forEach(t => strokeTrace(ctx, t.pts, t.w, traceColor[t.net]));

  // vias
  VIAS.forEach(([x, z]) => { circleMm(ctx, x, z, 0.36, '#6a6055'); circleMm(ctx, x, z, 0.16, '#050505'); });

  // HASL pads for passives
  const silver = ctx.createLinearGradient(0, 0, 0, H); silver.addColorStop(0, '#d8d6cc'); silver.addColorStop(1, '#bdbbb1');
  PASSIVES.forEach(p => {
    const rot = p.r ? Math.PI / 2 : 0;
    for (const s of [-0.78, 0.78]) {
      const dx = p.r ? 0 : s, dz = p.r ? s : 0;
      rectMm(ctx, p.x + dx, p.z + dz, 0.9, 1.05, silver, rot);
    }
  });
  // header pads, SOT-23 and IC pads
  HEADER_PINS.forEach(x => { circleMm(ctx, x, P.header.z, 0.85, '#d8d6cc'); circleMm(ctx, x, P.header.z, 0.45, '#0a0a0a'); });
  P.sot23.forEach(s => {
    const rot = s.rot;
    [[-0.95, 1.0], [0.95, 1.0], [0, -1.0]].forEach(([dx, dz]) => {
      const x = s.x + dx * Math.cos(rot) - dz * Math.sin(rot), z = s.z + dx * Math.sin(rot) + dz * Math.cos(rot);
      rectMm(ctx, x, z, 0.6, 0.9, silver, rot);
    });
  });
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) rectMm(ctx, P.tp4056.x - 1.905 + i * 1.27, P.tp4056.z + s * 2.6, 0.6, 1.4, silver);
  }
  [-2.3, 0, 2.3].forEach(dx => rectMm(ctx, P.ldo.x + dx, P.ldo.z + 2.9, 1.0, 1.6, silver));
  rectMm(ctx, P.ldo.x, P.ldo.z - 2.9, 3.4, 1.6, silver);
  // test pads (ENIG gold)
  Object.values(P.pads).forEach(p => { circleMm(ctx, p.x, p.z, 1.05, '#d9b74a'); circleMm(ctx, p.x, p.z, 0.75, '#c7a63c'); });
  // mounting holes: annular ring + hole
  P.holes.forEach(([x, z]) => { circleMm(ctx, x, z, 3.0, '#c9a14a'); circleMm(ctx, x, z, 1.6, '#04050a'); });
  // fiducials
  P.fiducials.forEach(([x, z]) => { circleMm(ctx, x, z, 0.9, '#0f1013'); circleMm(ctx, x, z, 0.5, '#c9a14a'); });

  // ---------------- silkscreen
  const S = '#e9ebe6';
  ctx.setLineDash([0.5 * PX, 0.35 * PX]);
  rectMm(ctx, (P.esp32.x0 + P.esp32.x1) / 2, 0, P.esp32.x1 - P.esp32.x0, 18, S, 0, true, 0.12);
  rectMm(ctx, P.oled.x, P.oled.z, P.oled.w, P.oled.d, S, 0, true, 0.12);
  ctx.setLineDash([]);
  // antenna keep-out hatch
  ctx.save(); ctx.strokeStyle = 'rgba(233,235,230,0.55)'; ctx.lineWidth = 0.1 * PX; ctx.beginPath();
  for (let k = -9; k < 9; k += 1.5) { ctx.moveTo(mx(-36), mz(k)); ctx.lineTo(mx(-31.5), mz(k + 2.5)); }
  ctx.stroke(); ctx.restore();
  textMm(ctx, 'ANT KEEP-OUT', -33.7, -8.2, 0.55, S, { rot: -Math.PI / 2 });

  rectMm(ctx, P.sx.x, P.sx.z, P.sx.s + 0.4, P.sx.s + 0.4, S, 0, true, 0.12);
  rectMm(ctx, P.usbc.x, P.usbc.z, P.usbc.w + 0.4, P.usbc.d + 0.4, S, 0, true, 0.12);
  rectMm(ctx, P.jst.x, P.jst.z, 8.3, 4.9, S, 0, true, 0.12);
  rectMm(ctx, P.cp2102.x, P.cp2102.z, 5.4, 5.4, S, 0, true, 0.12);
  rectMm(ctx, P.tp4056.x, P.tp4056.z, 5.3, 4.3, S, 0, true, 0.12);
  rectMm(ctx, P.ldo.x, P.ldo.z, 6.9, 3.9, S, 0, true, 0.12);
  circleMm(ctx, P.cp2102.x - 2.2, P.cp2102.z - 2.2, 0.22, S);
  circleMm(ctx, P.tp4056.x - 2.1, P.tp4056.z + 2.0, 0.22, S);

  textMm(ctx, 'U1', -34.8, -10.2, 0.7, S);
  textMm(ctx, 'U2 RFM95W', 21.5, -19.3, 0.6, S, { align: 'left' });
  textMm(ctx, 'U3', 5.4, 14.4, 0.7, S);
  textMm(ctx, 'U4', -4, 14.4, 0.7, S);
  textMm(ctx, 'U5', -17.6, 12, 0.7, S);
  textMm(ctx, 'J1', -24, 14.9, 0.7, S);
  textMm(ctx, 'J2  BAT', 24, 17.4, 0.7, S);
  textMm(ctx, '+', 21.6, 17.4, 0.9, S); textMm(ctx, '−', 26.6, 17.4, 0.9, S);
  textMm(ctx, 'ANT', 35, -14, 0.6, S);
  textMm(ctx, 'PWR', -8, 5, 0.6, S); textMm(ctx, 'TX', -4, 5, 0.6, S); textMm(ctx, 'RX', 0, 5, 0.6, S);
  textMm(ctx, 'CHRG', -4, 11.3, 0.6, S); textMm(ctx, 'STBY', 0, 11.3, 0.6, S);
  textMm(ctx, 'EN', -31.5, 15.2, 0.7, S); textMm(ctx, 'BOOT', -22.6, 12.5, 0.7, S, { align: 'left' });
  textMm(ctx, '3V3', 33, 8.2, 0.7, S); textMm(ctx, 'DIO0', 33, 6.2, 0.6, S); textMm(ctx, 'GND', 30.3, 16, 0.7, S);
  HEADER_PINS.forEach((x, i) => textMm(ctx, P.header.names[i], x, -21.3, 0.6, S));
  textMm(ctx, 'ESP32 · LoRa NODE   rev 1.2   915 MHz', 3, -21.7, 1.05, S, { weight: 700 });
  textMm(ctx, '4-LAYER · ENIG · RoHS', 3, 20.2, 0.6, S);
  textMm(ctx, '((·))', 29, 6, 1.3, S, { weight: 700, font: MONO });
  PASSIVES.forEach(p => textMm(ctx, p.d, p.x + (p.r ? 1.0 : 0), p.z + (p.r ? 0 : -0.95), 0.5, 'rgba(233,235,230,0.9)',
    { rot: p.r ? -Math.PI / 2 : 0 }));

  const top = tex(c);

  // ---------------- emissive overlays (transparent; drawn white and tinted at run time)
  const glowCanvas = (nets, extra) => {
    const g = makeCanvas(W, H), gc = g.getContext('2d');
    TRACES.filter(t => nets.includes(t.net)).forEach(t => strokeTrace(gc, t.pts, t.w + extra, '#ffffff'));
    return tex(g, { srgb: false });
  };
  const spiGlow = glowCanvas(['spi'], 0.12);
  const powerGlow = glowCanvas(['power'], 0.1);

  // ---------------- board edge: tan FR-4 core with four copper layers
  const sc = makeCanvas(256, 32), sctx = sc.getContext('2d');
  sctx.fillStyle = '#9c8c62'; sctx.fillRect(0, 0, 256, 32);
  grain(sctx, 256, 32, 20);
  sctx.fillStyle = '#d4813a';
  [2, 11, 20, 29].forEach(y => sctx.fillRect(0, y, 256, 1));
  const side = tex(sc, { repeat: [6, 1] });

  // ---------------- bottom
  const bc = makeCanvas(W / 2, H / 2), bctx = bc.getContext('2d');
  bctx.fillStyle = '#0f1013'; bctx.fillRect(0, 0, W / 2, H / 2); grain(bctx, W / 2, H / 2, 9);
  bctx.fillStyle = '#e9ebe6'; bctx.font = `700 ${0.9 * PX / 2}px ${SANS}`; bctx.textAlign = 'center';
  bctx.fillText('ESP32-LoRa NODE  ·  rev 1.2  ·  2026', W / 4, H / 4);
  const bottom = tex(bc);

  return { top, spiGlow, powerGlow, side, bottom };
}

/* ------------------------------------------------------------------ module / chip artwork */
export function moduleTopTexture() {
  const L = P.esp32.x1 - P.esp32.x0, D = P.esp32.z1 - P.esp32.z0;
  const W = L * PX, H = D * PX, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#0d1219'; ctx.fillRect(0, 0, W, H); grain(ctx, W, H, 8);
  // meander PCB antenna (exposed copper under thin mask)
  ctx.strokeStyle = '#b9925a'; ctx.lineWidth = 0.55 * PX; ctx.lineCap = 'square'; ctx.beginPath();
  let x = 0.9, up = false;
  ctx.moveTo(x * PX, 1.4 * PX);
  for (let k = 0; k < 7; k++) {
    ctx.lineTo(x * PX, (up ? 1.4 : D - 1.4) * PX);
    x += 0.75; ctx.lineTo(x * PX, (up ? 1.4 : D - 1.4) * PX); up = !up;
  }
  ctx.lineTo(x * PX, (D / 2) * PX); ctx.lineTo((P.can.x0 - P.esp32.x0) * PX, (D / 2) * PX);
  ctx.stroke();
  ctx.fillStyle = '#e9ebe6'; ctx.font = `600 ${0.7 * PX}px ${SANS}`; ctx.textAlign = 'left';
  ctx.fillText('1', 6.4 * PX, 1.2 * PX);
  return tex(c);
}

/** Transparent label plane texture. lines: [{t, s (mm), w (weight), c (color), font}] */
export function labelTexture(wMm, hMm, lines, { color = '#dfe3e8', ppm = 40, bg = null } = {}) {
  const W = Math.round(wMm * ppm), H = Math.round(hMm * ppm), c = makeCanvas(W, H), ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  const total = lines.reduce((a, l) => a + l.s * 1.35, 0);
  let y = (hMm - total) / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.fillStyle = l.c || color; ctx.font = `${l.w || 600} ${l.s * ppm}px ${l.font || SANS}`;
    ctx.fillText(l.t, W / 2, (y + l.s * 0.7) * ppm);
    y += l.s * 1.35;
  }
  return tex(c);
}

export function brushedRoughness() {
  const c = makeCanvas(512, 512), ctx = c.getContext('2d');
  ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    ctx.strokeStyle = `rgba(${Math.random() > .5 ? 255 : 0},${Math.random() > .5 ? 255 : 0},${Math.random() > .5 ? 255 : 0},${Math.random() * 0.08})`;
    const y = Math.random() * 512; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y + (Math.random() - .5) * 2); ctx.stroke();
  }
  return tex(c, { srgb: false });
}

/* ------------------------------------------------------------------ live screens */
export class OledScreen {
  constructor() { this.c = makeCanvas(512, 256); this.ctx = this.c.getContext('2d'); this.tex = tex(this.c); this.blink = 0; }
  draw(s) {
    const { ctx } = this, W = 512, H = 256;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!s.on) { this.tex.needsUpdate = true; return; }
    this.blink++;
    ctx.font = `700 34px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    // yellow band (classic two-colour 0.96" panel)
    ctx.fillStyle = '#ffd54a';
    ctx.fillText(`${s.freq.toFixed(1)}MHz SF${s.sf} BW${s.bw}`, 8, 30);
    ctx.fillRect(0, 60, W, 3);
    ctx.fillStyle = '#5ab4ff';
    const rssi = s.rssi == null ? ' ---' : String(Math.round(s.rssi)).padStart(4, ' ');
    const snr = s.snr == null ? ' --.-' : (s.snr >= 0 ? '+' : '') + s.snr.toFixed(1);
    ctx.fillText(`RSSI${rssi}dBm SNR${snr}`, 8, 92);
    ctx.fillText(`PKT ${String(s.pkt).padStart(5, '0')}  ACK ${String(s.ack).padStart(5, '0')}`, 8, 138);
    let status = 'IDLE   ';
    if (s.state === 'spi_write') status = 'SPI>FIFO';
    else if (s.state === 'tx') status = 'TX ' + '▮'.repeat(1 + (this.blink >> 1) % 4).padEnd(4, ' ');
    else if (s.state === 'wait') status = 'RX WAIT ';
    else if (s.state === 'rx') status = s.lastOk ? 'RX ACK ✓' : 'RX LOST ';
    ctx.fillText(status, 8, 184);
    ctx.textAlign = 'right';
    if (s.power === 'usb') ctx.fillText(`USB ${s.vbus.toFixed(1)}V`, W - 8, 184);
    else {
      const bars = Math.max(0, Math.min(4, Math.round((s.vbat - 3.4) / 0.2)));
      ctx.fillText(`BAT ${s.vbat.toFixed(2)}V ${'▮'.repeat(bars)}${'▯'.repeat(4 - bars)}`, W - 8, 184);
    }
    ctx.textAlign = 'left'; ctx.font = `600 24px ${MONO}`;
    ctx.fillText(`ToA ${(s.toa * 1000).toFixed(0)}ms  ${s.dr >= 1000 ? (s.dr / 1000).toFixed(1) + 'kb/s' : s.dr.toFixed(0) + 'b/s'}`, 8, 228);
    ctx.textAlign = 'right'; ctx.fillText(s.charging ? 'CHG⚡' : (s.power === 'usb' ? 'FULL' : ''), W - 8, 228);
    // scanline shimmer
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

export class ScopeScreen {
  constructor() { this.c = makeCanvas(640, 400); this.ctx = this.c.getContext('2d'); this.tex = tex(this.c); }
  draw(t, s) {
    const { ctx } = this, W = 640, H = 400;
    ctx.fillStyle = '#060a0e'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,160,180,0.16)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 10; i++) { ctx.moveTo(i * W / 10, 0); ctx.lineTo(i * W / 10, H); }
    for (let i = 1; i < 8; i++) { ctx.moveTo(0, i * H / 8); ctx.lineTo(W, i * H / 8); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,160,180,0.35)'; ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    // CH1: RF envelope after the detector — LoRa up-chirp during TX, down-chirp on RX, noise otherwise
    const base1 = H * 0.38, amp = H * 0.24;
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 6; ctx.beginPath();
    const cycles = 5 + (s.bw / 125) * 3;
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      let y;
      if (s.state === 'tx' || s.state === 'rx') {
        const p = (u + t * 0.9) % 1;
        const q = s.state === 'tx' ? p : 1 - p;
        y = Math.sin(2 * Math.PI * cycles * (q + 1.4 * q * q)) * amp * (0.85 + 0.15 * Math.sin(t * 7 + u * 20));
      } else {
        y = (Math.random() - 0.5) * 5 + Math.sin(u * 60 + t * 4) * 3;
      }
      x ? ctx.lineTo(x, base1 - y) : ctx.moveTo(x, base1 - y);
    }
    ctx.stroke();

    // CH2: SPI SCK bursts between the MCU and the radio
    const base2 = H * 0.78, hi = H * 0.12;
    ctx.strokeStyle = '#3fd8ff'; ctx.shadowColor = '#3fd8ff'; ctx.beginPath();
    const spi = s.state === 'spi_write' || s.state === 'rx';
    for (let x = 0; x <= W; x++) {
      const u = x / W;
      let v = 0;
      if (spi) { const burst = Math.floor((u + t * 0.5) * 8) % 3 !== 2; v = burst ? Math.floor(u * 180) % 2 : 0; }
      const y = base2 - v * hi + (Math.random() - 0.5) * 1.5;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = `600 15px ${MONO}`; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd23f'; ctx.fillText('1  200mV/', 8, 6);
    ctx.fillStyle = '#3fd8ff'; ctx.fillText('2  2.00V/', 120, 6);
    ctx.fillStyle = '#d9e2ea'; ctx.fillText(`M 20.0µs   ${s.state === 'idle' ? 'Auto' : "Trig'd"}`, 232, 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${s.freq.toFixed(3)} MHz  SF${s.sf}  BW${s.bw}k`, W - 8, 6);
    ctx.textAlign = 'left'; ctx.fillStyle = '#9fb3c4';
    const vpp = s.state === 'tx' ? 412 + Math.sin(t * 3) * 6 : 11 + Math.random() * 3;
    ctx.fillText(`Vpp(1) ${vpp.toFixed(0)} mV     f(2) ${spi ? '8.00 MHz' : '---'}     ${s.state === 'tx' ? 'TX ●' : s.state === 'rx' ? 'RX ●' : ''}`, 8, H - 22);
    this.tex.needsUpdate = true;
  }
}

export class PsuDisplay {
  constructor() { this.c = makeCanvas(480, 220); this.ctx = this.c.getContext('2d'); this.tex = tex(this.c); }
  draw(v, i) {
    const { ctx } = this, W = 480, H = 220;
    ctx.fillStyle = '#05080b'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.font = `700 92px ${MONO}`; ctx.shadowBlur = 14;
    ctx.fillStyle = '#5cff7a'; ctx.shadowColor = '#5cff7a'; ctx.fillText(v.toFixed(3), 360, 60);
    ctx.fillStyle = '#ff5f5f'; ctx.shadowColor = '#ff5f5f'; ctx.fillText(i.toFixed(3), 360, 160);
    ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.font = `700 44px ${SANS}`;
    ctx.fillStyle = '#5cff7a'; ctx.fillText('V', 378, 60); ctx.fillStyle = '#ff5f5f'; ctx.fillText('A', 378, 160);
    ctx.font = `600 18px ${SANS}`; ctx.fillStyle = '#9fb3c4';
    ctx.fillText('CV', 12, 16); ctx.fillText('OUTPUT ON', 12, 204); ctx.fillText('OVP 3.60V', 340, 204);
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ IR heat map */
const IRON = [[0, [0, 0, 0]], [0.12, [20, 0, 60]], [0.3, [120, 0, 140]], [0.5, [220, 40, 60]], [0.7, [255, 140, 0]], [0.86, [255, 225, 40]], [1, [255, 255, 255]]];
export function ironbow(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < IRON.length; i++) {
    if (t <= IRON[i][0]) {
      const [t0, a] = IRON[i - 1], [t1, b] = IRON[i], k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return IRON[IRON.length - 1][1];
}
/** Normalise a temperature into the palette span [lo, hi] (the IR camera auto-ranges like a real one). */
export const tNorm = (T, lo = 20, hi = 85) => (T - lo) / (hi - lo);
const LUT = new Uint8ClampedArray(256 * 3);
for (let i = 0; i < 256; i++) { const c = ironbow(i / 255); LUT[i * 3] = c[0]; LUT[i * 3 + 1] = c[1]; LUT[i * 3 + 2] = c[2]; }

export class HeatMap {
  constructor() {
    this.ppm = 6;
    this.w = BOARD.L * this.ppm; this.h = BOARD.W * this.ppm;
    this.c = makeCanvas(this.w, this.h); this.ctx = this.c.getContext('2d');
    this.img = this.ctx.createImageData(this.w, this.h);
    this.tex = tex(this.c);
    this.tex.minFilter = THREE.LinearFilter;
  }
  /** temps: {ambient, esp32, ldo, sx, charger, cp} in °C; lo/hi = palette span */
  draw(temps, lo, hi) {
    const d = this.img.data, { w, h, ppm } = this, amb = temps.ambient;
    const hs = HOTSPOTS.map(hp => ({ x: (hp.x + BOARD.L / 2) * ppm, z: (hp.z + BOARD.W / 2) * ppm, inv: 1 / (2 * (hp.s * ppm) ** 2), dT: temps[hp.key] - amb }));
    let k = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let T = amb + 0.6 * Math.sin(x * 0.05) * Math.cos(y * 0.07);
        for (const s of hs) { const dx = x - s.x, dz = y - s.z; T += s.dT * Math.exp(-(dx * dx + dz * dz) * s.inv); }
        const i = Math.max(0, Math.min(255, Math.round(tNorm(T, lo, hi) * 255))) * 3;
        d[k++] = LUT[i]; d[k++] = LUT[i + 1]; d[k++] = LUT[i + 2]; d[k++] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ bench surfaces */
export function woodTexture() {
  const c = makeCanvas(1024, 1024), ctx = c.getContext('2d');
  ctx.fillStyle = '#4e3626'; ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * 1024, w = 40 + Math.random() * 600, a = 0.04 + Math.random() * 0.12;
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(110,78,52,${a})` : `rgba(40,26,16,${a})`;
    ctx.lineWidth = 1 + Math.random() * 6; ctx.beginPath();
    const x0 = Math.random() * 1024; ctx.moveTo(x0, y); ctx.bezierCurveTo(x0 + w / 3, y + 4, x0 + w * 2 / 3, y - 4, x0 + w, y + (Math.random() - .5) * 3); ctx.stroke();
  }
  grain(ctx, 1024, 1024, 12);
  return tex(c, { repeat: [4, 3] });
}
export function matTexture() {
  const c = makeCanvas(512, 512), ctx = c.getContext('2d');
  ctx.fillStyle = '#243040'; ctx.fillRect(0, 0, 512, 512);
  grain(ctx, 512, 512, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= 512; i += 128) { ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.moveTo(0, i); ctx.lineTo(512, i); }
  ctx.stroke();
  return tex(c, { repeat: [3, 2] });
}
