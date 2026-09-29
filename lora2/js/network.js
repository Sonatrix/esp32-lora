// Discrete-event model of a small ESP32 + SX1276 LoRa network: battery sensors, always-on mesh
// repeaters and a Wi-Fi gateway. Models CAD/listen-before-talk, time-on-air, half-duplex radios,
// per-receiver fading, collisions with capture effect, flooding with TTL + duplicate cache,
// reverse-path ACK routing and retries. No rendering in here; everything is reported as events.

import { timeOnAir, linkBudget, maxRange, cadTime, SNR_LIMIT, ENV, BANDS } from './phy.js';

export const TYPE = { DATA: 1, ACK: 2 };
export const GW_ID = 0x01, BCAST = 0xff, TTL_MAX = 3, MAX_ATTEMPTS = 3;
export const HEADER_BYTES = 7, DATA_PAYLOAD = 5;
export const FIELDS = ['dst', 'src', 'id', 'type', 'ttl', 'from', 'next'];
const T_WAKE = 0.035, T_BUILD = 0.004, T_SPI = 0.002;                  // seconds
const CAPTURE_DB = 6, LOOKAHEAD = 0.08;

const rnd = (a, b) => a + Math.random() * (b - a);
const fade = () => (Math.random() + Math.random() + Math.random() - 1.5) * 4;   // ±6 dB, roughly normal
export const hex = v => (v & 0xff).toString(16).padStart(2, '0').toUpperCase();
export const encode = f => [f.dst, f.src, f.id, f.type, f.ttl, f.from, f.next, ...f.payload];
/** 'data' = original uplink, 'relay' = rebroadcast by a repeater, 'ack' = downlink. */
export const frameKind = f => f.type === TYPE.ACK ? 'ack' : f.from === f.src ? 'data' : 'relay';

export function decodePayload(p) {
  if (p.length < DATA_PAYLOAD) return null;
  let t = (p[0] << 8) | p[1]; if (t & 0x8000) t -= 0x10000;
  return { temp: t / 100, hum: p[2], batt: ((p[3] << 8) | p[4]) / 1000 };
}

export class Node {
  constructor({ id, kind, name, x, y }) {
    Object.assign(this, { id, kind, name, x, y });
    this.online = true;
    this.radio = kind === 'sensor' ? 'sleep' : 'rx';   // sleep | standby | cad | tx | rx | off
    this.txq = []; this.txBusy = false;
    this.seen = new Map();                             // "src:id:type" → time, duplicate cache
    this.routes = new Map();                           // src id → neighbour it was first heard from
    this.stats = { tx: 0, rx: 0, relayed: 0, airLog: [] };
    this.txn = null; this.seq = 0; this.msgId = Math.floor(Math.random() * 256); this.nextReport = 0;
    if (kind === 'sensor') {
      this.batt = rnd(3.78, 4.12); this.baseT = rnd(16, 26); this.baseH = rnd(35, 70);
      this.dash = { sent: 0, delivered: 0, acked: 0, last: null };
    }
  }
  get listening() { return this.online && (this.radio === 'rx' || this.radio === 'cad'); }
  get relays() { return this.kind === 'repeater'; }
}

export class Network {
  constructor() {
    this.cfg = { sf: 7, bw: 125, band: 'EU868', txPower: 14, env: 'urban', topology: 'mesh', auto: true, interval: 20 };
    this.nodes = []; this.time = 0;
    this.queue = []; this.evSeq = 0;
    this.airs = []; this.airSeq = 0; this.txnSeq = 0;
    this.hold = false;                                 // set by the step-through UI to freeze at a breakpoint
    this.handlers = {};
    this.totals = { txns: 0, delivered: 0, acked: 0, collisions: 0, relays: 0 };
  }

  /* ------------------------------------------------------------------ events + scheduling */
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  emit(ev, data) { (this.handlers[ev] || []).forEach(fn => fn(data)); }
  at(delay, fn) {
    const ev = { t: this.time + Math.max(0, delay), seq: ++this.evSeq, fn, cancelled: false };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > ev.t)) i--;
    this.queue.splice(i, 0, ev);
    return ev;
  }
  _peek() {
    while (this.queue.length && this.queue[0].cancelled) this.queue.shift();
    return this.queue[0];
  }
  /** Something is on the air or about to happen: the UI plays this part in slow motion. */
  busy() {
    const ev = this._peek();
    return this.airs.length > 0 || (!!ev && ev.t - this.time < LOOKAHEAD);
  }
  /** Advance simulated time by dt seconds. With untilBusy, stop as soon as activity starts. */
  step(dt, untilBusy = false) {
    const end = this.time + dt;
    while (!this.hold) {
      const ev = this._peek();
      const tNext = Math.min(ev ? ev.t : Infinity, end);
      if (this.cfg.auto) {
        const due = this.nodes.filter(s => s.kind === 'sensor' && s.online && s.nextReport <= tNext)
          .sort((a, b) => a.nextReport - b.nextReport)[0];
        if (due) {
          this.time = Math.max(this.time, due.nextReport);
          if (due.txn) due.nextReport = this.time + this.cfg.interval * rnd(0.3, 0.7);
          else this.report(due);
          if (untilBusy && this.busy()) return;
          continue;
        }
      }
      if (!ev || ev.t > end) break;
      this.queue.shift();
      this.time = ev.t;
      ev.fn();
      if (untilBusy && this.busy()) return;
    }
    if (!this.hold) this.time = Math.max(this.time, end);
  }

  /* ------------------------------------------------------------------ configuration + topology */
  get freq() { return BANDS[this.cfg.band]; }
  get n() { return ENV[this.cfg.env]; }
  phy(payload) { return timeOnAir({ sf: this.cfg.sf, bw: this.cfg.bw, payload }); }
  cad() { return cadTime(this.cfg.sf, this.cfg.bw); }
  range() { const c = this.cfg; return maxRange({ sf: c.sf, bw: c.bw, freq: this.freq, txPower: c.txPower, n: this.n }); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  link(a, b) {
    const c = this.cfg;
    return linkBudget({ dist: this.dist(a, b), sf: c.sf, bw: c.bw, freq: this.freq, txPower: c.txPower, n: this.n });
  }
  byId(id) { return this.nodes.find(n => n.id === id); }
  name(id) { return id === BCAST ? 'ALL' : this.byId(id)?.name ?? hex(id); }
  get gateway() { return this.nodes.find(n => n.kind === 'gateway'); }
  neighbours(a) {
    return this.nodes.filter(b => b !== a && b.online).map(b => ({ node: b, dist: this.dist(a, b), ...this.link(a, b) }))
      .filter(l => l.margin > -6).sort((p, q) => q.margin - p.margin);
  }
  /** Nodes that can reach the gateway on mean link margin (relaying only through repeaters in mesh). */
  reachable() {
    const gw = this.gateway, ok = new Set();
    if (!gw || !gw.online) return ok;
    ok.add(gw);
    const frontier = [gw], mesh = this.cfg.topology === 'mesh';
    while (frontier.length) {
      const a = frontier.shift();
      for (const b of this.nodes) {
        if (ok.has(b) || !b.online || this.link(a, b).margin < 0) continue;
        ok.add(b);
        if (mesh && b.relays) frontier.push(b);
      }
    }
    return ok;
  }
  dutyCycle(n, window = 60) {
    const t0 = this.time - window;
    n.stats.airLog = n.stats.airLog.filter(([s, d]) => s + d > t0 - 1);
    let on = 0;
    for (const [s, d] of n.stats.airLog) on += Math.max(0, Math.min(this.time, s + d) - Math.max(t0, s));
    return on / window;
  }
  rxDelay() { return this.cfg.topology === 'mesh' ? 2.5 * this.phy(HEADER_BYTES + DATA_PAYLOAD).total + 0.05 : 0.08; }
  ackTimeout() {
    const hops = this.cfg.topology === 'mesh' ? TTL_MAX : 1;
    const d = this.phy(HEADER_BYTES + DATA_PAYLOAD).total, a = this.phy(HEADER_BYTES).total, cad = this.cad();
    return this.rxDelay() + (hops - 1) * (2 * d + cad + 0.02) + hops * (a + cad + 0.04) + 0.15;
  }

  addNode(spec) {
    const n = new Node(spec);
    n.nextReport = this.time + rnd(1, this.cfg.interval);
    this.nodes.push(n);
    this.emit('nodes', {});
    return n;
  }
  removeNode(n) {
    this.setOnline(n, false);
    this.nodes.splice(this.nodes.indexOf(n), 1);
    this.emit('nodes', {});
  }
  nextId(kind) {
    const base = kind === 'sensor' ? 0x10 : 0x20;
    let id = base + 1; while (this.byId(id)) id++;
    return id;
  }
  setOnline(n, on) {
    if (n.online === on) return;
    n.online = on;
    if (!on) {
      n.txq.length = 0; n.txBusy = false;
      if (n.txn) { n.txn.ok = false; this._finish(n.txn, 'offline'); }
      this.setRadio(n, 'off');
    } else this.setRadio(n, n.kind === 'sensor' ? 'sleep' : 'rx');
    this.emit('nodes', {});
  }
  setRadio(n, state) {
    n.radio = state;
    if (!n.listening) for (const a of this.airs) {
      const r = a.rx.get(n.id);
      if (r && !r.deaf) { r.deaf = true; r.deafWhy = state; }
    }
    this.emit('radio', { node: n, state });
  }

  /* ------------------------------------------------------------------ sensor transaction */
  /** One report: wake → sense → frame → SPI → CAD → TX → (relays) → gateway → ACK → sleep. */
  report(s, manual = false) {
    if (!s || s.kind !== 'sensor' || !s.online || s.txn) return null;
    const txn = { id: ++this.txnSeq, node: s, seq: ++s.seq, attempt: 0, start: this.time, manual,
      airtime: 0, delivered: false, ok: null, hops: null, frame: null, reading: null, timer: null };
    s.txn = txn; s.dash.sent++; this.totals.txns++;
    s.nextReport = this.time + this.cfg.interval * rnd(0.7, 1.3);
    this.emit('txn', txn);
    this._attempt(txn);
    return txn;
  }
  _attempt(txn) {
    const s = txn.node;
    txn.attempt++;
    this.setRadio(s, 'standby');
    const build = () => {
      if (s.txn !== txn) return;
      const f = txn.frame = this._makeData(s, txn);
      this.emit('stage', { stage: 'build', txn, node: s, frame: f });
      this.at(T_BUILD, () => {
        if (s.txn !== txn) return;
        this.emit('stage', { stage: 'spi', txn, node: s, frame: f });
        this.at(T_SPI, () => { if (s.txn === txn) this.send(s, f); });
      });
    };
    if (txn.attempt === 1) {
      txn.reading = this._read(s);
      this.emit('stage', { stage: 'wake', txn, node: s });
      this.at(T_WAKE, build);
    } else build();
  }
  _read(s) {
    s.batt = Math.max(3.3, s.batt - 0.0004);
    return {
      temp: s.baseT + 2.5 * Math.sin(this.time / 240 + s.id) + rnd(-0.15, 0.15),
      hum: Math.max(5, Math.min(99, Math.round(s.baseH + 6 * Math.sin(this.time / 400 + s.id * 2) + rnd(-1, 1)))),
      batt: s.batt,
    };
  }
  _frame(f, txn) { f = { ...f, txn }; f.bytes = encode(f); return f; }
  _makeData(s, txn) {
    const r = txn.reading;
    const t = Math.round(r.temp * 100) & 0xffff, mv = Math.round(r.batt * 1000);
    s.msgId = (s.msgId + 1) & 0xff;
    return this._frame({ dst: GW_ID, src: s.id, id: s.msgId, type: TYPE.DATA, ttl: TTL_MAX, from: s.id,
      next: this.cfg.topology === 'mesh' ? BCAST : GW_ID, payload: [t >> 8, t & 0xff, r.hum, mv >> 8, mv & 0xff] }, txn);
  }
  _awaitAck(txn) {
    this.setRadio(txn.node, 'rx');
    const timeout = this.ackTimeout();
    txn.timer = this.at(timeout, () => this._noAck(txn));
    this.emit('await', { txn, timeout });
  }
  _acked(txn, f) {
    txn.timer && (txn.timer.cancelled = true);
    txn.ok = true; txn.rtt = this.time - txn.start;
    txn.node.dash.acked++; this.totals.acked++;
    this.emit('stage', { stage: 'sleep', txn, node: txn.node, frame: f, ok: true });
    this._finish(txn, 'acked');
  }
  _noAck(txn) {
    if (txn.node.txn !== txn) return;
    if (txn.attempt < MAX_ATTEMPTS) {
      this.setRadio(txn.node, 'standby');
      const backoff = rnd(0.15, 0.6) + this.phy(HEADER_BYTES + DATA_PAYLOAD).total * rnd(1, 4);
      this.emit('retry', { txn, node: txn.node, backoff });
      this.at(backoff, () => { if (txn.node.txn === txn) this._attempt(txn); });
    } else {
      txn.ok = false;
      this.emit('stage', { stage: 'sleep', txn, node: txn.node, ok: false });
      this._finish(txn, 'gave-up');
    }
  }
  _finish(txn, why) {
    const s = txn.node;
    txn.timer && (txn.timer.cancelled = true);
    txn.end = this.time; txn.why = why;
    s.txn = null;
    if (s.online) this.setRadio(s, 'sleep');
    this.emit('txnEnd', txn);
  }

  /* ------------------------------------------------------------------ radio: queue → CAD → air */
  send(n, f) {
    if (!n.online) return;
    n.txq.push(f);
    if (!n.txBusy) this._nextTx(n);
  }
  _nextTx(n) {
    const f = n.txq.shift();
    n.txBusy = !!f;
    if (f) this._cad(n, f, 0);
  }
  _cad(n, f, tries) {
    if (!n.online) { n.txq.length = 0; n.txBusy = false; return; }
    const dur = this.cad();
    this.setRadio(n, 'cad');
    this.emit('cadStart', { node: n, frame: f, dur, tries });
    this.at(dur, () => {
      if (!n.online) return;
      const heard = this.airs.find(a => a.from !== n && (a.rx.get(n.id)?.margin ?? -99) > -3);
      const busy = !!heard && tries < 6;
      this.emit('cad', { node: n, frame: f, busy, by: heard?.from, tries });
      if (busy) {
        this.setRadio(n, n.kind === 'sensor' ? 'standby' : 'rx');
        this.at(0.005 + rnd(0.5, 2) * this.phy(f.bytes.length).total, () => this._cad(n, f, tries + 1));
      } else this._startAir(n, f);
    });
  }
  _startAir(n, f) {
    const toa = this.phy(f.bytes.length).total;
    const air = { id: ++this.airSeq, from: n, frame: f, start: this.time, end: this.time + toa, toa,
      sf: this.cfg.sf, rx: new Map(), overlaps: new Set() };
    for (const m of this.nodes) {
      if (m === n) continue;
      const lb = this.link(n, m), k = fade();
      const snr = Math.min(12, lb.snr + k);
      air.rx.set(m.id, { node: m, rssi: lb.rssi + k, snr, margin: snr - SNR_LIMIT[air.sf],
        deaf: !m.listening, deafWhy: m.listening ? null : m.radio });
    }
    for (const o of this.airs) {
      o.overlaps.add(air); air.overlaps.add(o);
      const r = o.rx.get(n.id);
      if (r && !r.deaf) { r.deaf = true; r.deafWhy = 'tx'; }
    }
    this.airs.push(air);
    this.setRadio(n, 'tx');
    n.stats.tx++; n.stats.airLog.push([this.time, toa]);
    if (f.txn && n === f.txn.node) f.txn.airtime += toa;
    this.emit('txStart', air);
    this.at(toa, () => this._endAir(air));
  }
  _endAir(air) {
    const n = air.from, f = air.frame;
    this.airs.splice(this.airs.indexOf(air), 1);
    if (n.online) this.setRadio(n, n.kind === 'sensor' ? 'standby' : 'rx');

    const results = [];
    for (const r of air.rx.values()) {
      const m = r.node;
      if (!m.online || !this.nodes.includes(m) || r.margin < -8) continue;
      let status, jam = null;
      if (r.deaf) {
        if (r.deafWhy !== 'tx' && r.deafWhy !== 'standby') continue;          // asleep: never listening
        status = 'deaf';
      } else if (r.margin < 0) status = 'weak';
      else {
        for (const o of air.overlaps) {
          const q = o.rx.get(m.id);
          if (q && q.margin > -6 && r.rssi - q.rssi < CAPTURE_DB) { jam = o.from; break; }
        }
        status = jam ? 'collision' : 'ok';
      }
      if (status === 'collision') this.totals.collisions++;
      results.push({ node: m, status, rssi: r.rssi, snr: r.snr, margin: r.margin, jam, why: r.deafWhy });
    }
    results.sort((a, b) => b.margin - a.margin);
    this.emit('txEnd', { air, results });

    if (n.online && f.type === TYPE.DATA && f.txn && n === f.txn.node && n.txn === f.txn) this._awaitAck(f.txn);
    for (const r of results) if (r.status === 'ok') this._receive(r.node, f, r);
    if (n.online) this._nextTx(n);
  }

  /* ------------------------------------------------------------------ MAC / network layer */
  _drop(n, f, reason) { this.emit('drop', { node: n, frame: f, reason }); }
  _receive(n, f, meta) {
    n.stats.rx++;
    const key = `${f.src}:${f.id}:${f.type}`, mesh = this.cfg.topology === 'mesh';
    if (n.seen.size > 200) for (const [k, t] of n.seen) if (this.time - t > 120) n.seen.delete(k);

    if (n.kind === 'sensor') {
      const t = n.txn;
      if (f.type === TYPE.ACK && f.dst === n.id && t && t.frame && f.id === t.frame.id) {
        this.emit('ackRx', { node: n, frame: f, meta, txn: t });
        this._acked(t, f);
      } else this._drop(n, f, 'not for me');
      return;
    }

    if (f.type === TYPE.DATA) {
      if (n.kind === 'gateway') {
        if (n.seen.has(key)) return this._drop(n, f, 'duplicate');
        n.seen.set(key, this.time); n.routes.set(f.src, f.from);
        const hops = TTL_MAX - f.ttl + 1, s = this.byId(f.src), txn = f.txn, d = decodePayload(f.payload);
        const json = { node: s?.name ?? hex(f.src), seq: txn?.seq, t: +d.temp.toFixed(2), rh: d.hum, bat: d.batt,
          rssi: Math.round(meta.rssi), snr: +meta.snr.toFixed(1), hops };
        if (txn && !txn.delivered) { txn.delivered = true; txn.hops = hops; s && s.dash.delivered++; this.totals.delivered++; }
        this.emit('gwRx', { node: n, frame: f, meta, hops, json });
        this.at(rnd(0.02, 0.045), () => {
          this.emit('wifi', { node: n, frame: f, json });
          this.at(rnd(0.03, 0.06), () => {
            if (s) s.dash.last = { ...json, time: this.time };
            this.emit('cloud', { node: n, frame: f, json, sensor: s });
          });
        });
        this.at(this.rxDelay(), () => this.send(n, this._frame({ dst: f.src, src: GW_ID, id: f.id, type: TYPE.ACK,
          ttl: TTL_MAX, from: GW_ID, next: n.routes.get(f.src), payload: [] }, f.txn)));
        return;
      }
      if (!mesh || !n.relays) return this._drop(n, f, 'not for me');
      if (n.seen.has(key)) return this._drop(n, f, 'duplicate');
      n.seen.set(key, this.time); n.routes.set(f.src, f.from);
      if (f.ttl <= 1) return this._drop(n, f, 'TTL expired');
      const delay = 0.01 + Math.random() * this.phy(f.bytes.length).total;
      this.emit('relay', { node: n, frame: f, delay, via: f.from, ttl: f.ttl - 1 });
      n.stats.relayed++; this.totals.relays++;
      this.at(delay, () => this.send(n, this._frame({ ...f, ttl: f.ttl - 1, from: n.id }, f.txn)));
      return;
    }

    // ACK
    if (!mesh || !n.relays || f.next !== n.id) return this._drop(n, f, f.dst === n.id ? 'duplicate' : 'overheard');
    if (n.seen.has(key)) return this._drop(n, f, 'duplicate');
    n.seen.set(key, this.time);
    const hop = n.routes.get(f.dst);
    if (hop == null) return this._drop(n, f, 'no route');
    if (f.ttl <= 1) return this._drop(n, f, 'TTL expired');
    const delay = rnd(0.004, 0.02);
    this.emit('relay', { node: n, frame: f, delay, via: f.from, ttl: f.ttl - 1, next: hop });
    n.stats.relayed++; this.totals.relays++;
    this.at(delay, () => this.send(n, this._frame({ ...f, ttl: f.ttl - 1, from: n.id, next: hop }, f.txn)));
  }
}

/* ------------------------------------------------------------------ default layout (km) */
export const DEFAULT_NODES = [
  { id: GW_ID, kind: 'gateway', name: 'GW', x: 0, y: 0 },
  { id: 0x21, kind: 'repeater', name: 'R1', x: 1.05, y: 0.8 },
  { id: 0x22, kind: 'repeater', name: 'R2', x: -1.15, y: -0.7 },
  { id: 0x23, kind: 'repeater', name: 'R3', x: 0.55, y: -1.2 },
  { id: 0x11, kind: 'sensor', name: 'S1', x: 1.1, y: -0.45 },   // direct, and heard by R1 + R3 → duplicates
  { id: 0x12, kind: 'sensor', name: 'S2', x: -1.25, y: 1.2 },   // marginal direct link, no repeater nearby
  { id: 0x13, kind: 'sensor', name: 'S3', x: 2.2, y: 1.55 },    // two hops via R1
  { id: 0x14, kind: 'sensor', name: 'S4', x: -2.3, y: -1.5 },   // two hops via R2
  { id: 0x15, kind: 'sensor', name: 'S5', x: 1.7, y: -2.15 },   // two hops via R3, weaker last mile
  { id: 0x16, kind: 'sensor', name: 'S6', x: -3.3, y: 0.9 },    // out of reach at SF7: raise SF or move a repeater
];
export function createNetwork() {
  const net = new Network();
  DEFAULT_NODES.forEach(spec => net.addNode(spec));
  return net;
}
