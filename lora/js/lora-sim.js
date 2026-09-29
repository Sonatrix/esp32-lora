// LoRa PHY arithmetic (Semtech SX1276 datasheet §4.1.1.6), a simple link model, the packet
// state machine and the electrical / thermal model of the board. No rendering in here.

export const SNR_LIMIT = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };   // dB, demod floor per SF
const SENS_125 = { 7: -123, 8: -126, 9: -129, 10: -132, 11: -134.5, 12: -137 };          // dBm at BW 125 kHz

export const symbolTime = (sf, bwKHz) => Math.pow(2, sf) / (bwKHz * 1000);               // seconds

export function timeOnAir({ sf, bw, payload = 24, preamble = 8, cr = 1, crc = true, header = true }) {
  const ts = symbolTime(sf, bw);
  const de = bw === 125 && sf >= 11 ? 1 : 0;                                              // low data-rate optimisation
  const tPre = (preamble + 4.25) * ts;
  const num = 8 * payload - 4 * sf + 28 + 16 * (crc ? 1 : 0) - 20 * (header ? 0 : 1);
  const nSym = 8 + Math.max(Math.ceil(num / (4 * (sf - 2 * de))) * (cr + 4), 0);
  return { ts, tPre, tPay: nSym * ts, total: tPre + nSym * ts, nSym };
}
export const dataRate = (sf, bw, cr = 1) => sf * (4 / (4 + cr)) / symbolTime(sf, bw);   // bit/s
export const sensitivity = (sf, bw) => SENS_125[sf] + 10 * Math.log10(bw / 125);         // dBm
export const noiseFloor = bw => -174 + 10 * Math.log10(bw * 1000) + 6;                   // dBm, NF 6 dB

const pl0 = fMHz => 20 * Math.log10((4 * Math.PI * fMHz * 1e6) / 3e8);                   // free-space loss at 1 m
export const pathLoss = (dKm, fMHz, n = 2.9) => pl0(fMHz) + 10 * n * Math.log10(Math.max(1, dKm * 1000));

export function linkBudget({ sf, bw, freq, dist, txPower = 17, gains = 4 }) {
  const rssi = txPower + gains - pathLoss(dist, freq);
  const snr = rssi - noiseFloor(bw);
  return { rssi, snr, margin: snr - SNR_LIMIT[sf] };
}
export function maxRange({ sf, bw, freq, txPower = 17, gains = 4, n = 2.9 }) {
  const plMax = txPower + gains - (noiseFloor(bw) + SNR_LIMIT[sf]);
  return Math.pow(10, (plMax - pl0(freq)) / (10 * n)) / 1000;                            // km
}

/* ------------------------------------------------------------------ packet state machine */
export class LoraLink {
  constructor() {
    this.cfg = { sf: 7, bw: 125, freq: 915, dist: 2, payload: 24, txPower: 17 };
    this.state = 'idle';           // idle → spi_write → tx → wait → rx → cool → idle
    this.t = 0; this.dur = 0;
    this.continuous = false; this.pending = false;
    this.stats = { tx: 0, ack: 0, rssi: null, snr: null, lastOk: null, lastToa: 0 };
    this.handlers = {};
    this.seq = 0;
  }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  emit(ev, data) { (this.handlers[ev] || []).forEach(fn => fn(data)); }
  toa() { return timeOnAir({ sf: this.cfg.sf, bw: this.cfg.bw, payload: this.cfg.payload }).total; }
  requestTx() { if (this.state === 'idle') this.enter('spi_write'); else this.pending = true; }
  enter(state) {
    this.state = state; this.t = 0;
    const c = this.cfg;
    switch (state) {
      case 'spi_write': this.dur = 0.06; this.emit('spi', { dir: 'write', bytes: c.payload + 3 }); break;
      case 'tx': {
        this.dur = this.stats.lastToa = this.toa(); this.stats.tx++; this.seq++;
        this.emit('txStart', { toa: this.dur, seq: this.seq }); break;
      }
      case 'wait': {
        const ackToa = timeOnAir({ sf: c.sf, bw: c.bw, payload: 6 }).total;
        this.dur = 0.12 + Math.random() * 0.12 + ackToa;
        this.emit('txEnd', {}); break;
      }
      case 'rx': {
        const lb = linkBudget({ sf: c.sf, bw: c.bw, freq: c.freq, dist: c.dist, txPower: c.txPower });
        const fade = (Math.random() + Math.random() + Math.random() - 1.5) * 4;            // ±6 dB, roughly Gaussian
        const rssi = lb.rssi + fade, snr = Math.min(lb.snr + fade, 12), margin = snr - SNR_LIMIT[c.sf];
        const ok = margin > 0;
        this.dur = ok ? 0.16 : 0.05;
        this.stats.lastOk = ok;
        if (ok) { this.stats.ack++; this.stats.rssi = rssi; this.stats.snr = snr; }
        this.emit('rx', { ok, rssi, snr, margin, seq: this.seq }); break;
      }
      case 'cool': this.dur = this.continuous ? 0.35 : 0.2; break;
      case 'idle': this.emit('idle', {}); break;
    }
  }
  update(dt) {
    if (this.state === 'idle') {
      if (this.pending || this.continuous) { this.pending = false; this.enter('spi_write'); }
      return;
    }
    this.t += dt;
    if (this.t < this.dur) return;
    const next = { spi_write: 'tx', tx: 'wait', wait: 'rx', rx: 'cool', cool: 'idle' }[this.state];
    this.enter(next);
  }
  get txProgress() { return this.state === 'tx' ? this.t / this.dur : 0; }
}

/* ------------------------------------------------------------------ electrical + thermal */
export class PowerModel {
  constructor() {
    this.source = 'usb';
    this.vbat = 3.87; this.vbus = 5.02;
    this.ambient = 24;
    this.temps = { ambient: 24, esp32: 31, ldo: 30, sx: 27, charger: 33, cp: 28 };
    this.rail = 0.06;        // A on the 3V3 rail (display-filtered)
    this.chargeI = 0;
  }
  get charging() { return this.source === 'usb' && this.vbat < 4.2; }
  get vin() { return this.source === 'usb' ? this.vbus : this.vbat; }
  /** activity: {tx, spi, oled} */
  update(dt, a) {
    const railTarget = (0.042 + (a.oled ? 0.016 : 0) + (a.tx ? 0.12 : a.spi ? 0.012 : 0.002) + 0.0015) * (1 + 0.01 * Math.sin(Date.now() / 90));
    this.rail += (railTarget - this.rail) * Math.min(1, dt * 12);
    if (this.source === 'usb') {
      this.chargeI = this.charging ? 0.35 * Math.min(1, (4.25 - this.vbat) * 4) : 0;
      this.vbat = Math.min(4.2, this.vbat + 0.0035 * dt);
      this.vbus = 5.02 - this.rail * 0.25 - this.chargeI * 0.2;
    } else {
      this.chargeI = 0;
      this.vbat = Math.max(3.3, this.vbat - (0.0009 + (a.tx ? 0.006 : 0)) * dt);
    }
    const T = this.temps, amb = this.ambient, k = Math.min(1, dt / 5);
    const pLdo = Math.max(0, this.vin - 3.3) * this.rail;
    const target = {
      esp32: amb + 15 + (a.tx ? 24 : 0) + (a.spi ? 3 : 0),
      ldo: amb + pLdo * 95 + 2,
      sx: amb + 6 + (a.tx ? 24 : 0),
      charger: amb + (this.chargeI > 0 ? 3 + this.chargeI * 80 : this.source === 'usb' ? 4 : 0),
      cp: amb + (this.source === 'usb' ? 7 : 0),
    };
    for (const key in target) T[key] += (target[key] - T[key]) * (key === 'esp32' ? k * 0.8 : k);
    T.ambient = amb;
  }
}
