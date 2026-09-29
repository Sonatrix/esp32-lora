// Airtime timeline: one lane per node, scrolling in simulated time. Shows radio state (listening,
// awake, CAD), every transmission as a bar, and what each receiver made of it (✓, collision,
// too weak, deaf, duplicate). This is the view where collisions and hidden nodes become obvious.

import { frameKind } from './network.js';

const KIND = { data: '#ffa23c', relay: '#b48cff', ack: '#37c6ff' };
const STATE = { rx: 'rgba(61,220,132,.10)', standby: 'rgba(139,152,168,.16)', cad: 'rgba(255,209,102,.55)', off: 'rgba(255,107,107,.10)' };
const MARK = { ok: '#3ddc84', collision: '#ff6b6b', weak: '#ffb347', deaf: '#8b98a8', duplicate: '#7f93b8' };
const ORDER = { gateway: 0, repeater: 1, sensor: 2 };
const KEEP = 90;

export class Timeline {
  constructor(canvas, net, getTracked) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.net = net; this.getTracked = getTracked;
    this.segs = new Map(); this.bars = []; this.marks = [];
    this.windowScale = 1;
    net.on('radio', ({ node, state }) => {
      let s = this.segs.get(node); if (!s) this.segs.set(node, s = []);
      s.push([net.time, state]);
    });
    net.on('txStart', air => this.bars.push({ node: air.from, t0: air.start, t1: air.end, kind: frameKind(air.frame), frame: air.frame }));
    net.on('txEnd', ({ air, results }) => results.forEach(r => this.marks.push({ node: r.node, t: air.end, status: r.status })));
    net.on('drop', ({ node, reason }) => { if (reason === 'duplicate') this.marks.push({ node, t: net.time, status: 'duplicate' }); });
  }
  clear() { this.segs.clear(); this.bars = []; this.marks = []; }
  window() {
    const toa = this.net.phy(12).total;
    return Math.min(20, Math.max(1.2, toa * 14)) * this.windowScale;
  }
  draw(now) {
    const c = this.c, g = this.g, dpr = Math.min(devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const W = this.window(), t0 = now - W, gut = 46, axis = 16, right = 8;
    const nodes = [...this.net.nodes].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const laneH = Math.max(10, Math.min(22, (h - axis - 4) / Math.max(1, nodes.length)));
    const X = t => gut + (t - t0) / W * (w - gut - right);
    const tracked = this.getTracked();

    // prune
    const cut = now - KEEP;
    if (this.bars.length && this.bars[0].t1 < cut) this.bars = this.bars.filter(b => b.t1 >= cut);
    if (this.marks.length && this.marks[0].t < cut) this.marks = this.marks.filter(m => m.t >= cut);
    for (const [n, s] of this.segs) { while (s.length > 1 && s[1][0] < cut) s.shift(); if (!this.net.nodes.includes(n)) this.segs.delete(n); }

    // ticks
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    const step = steps.find(s => W / s <= 8) || 10;
    g.font = '10px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'middle';
    for (let t = Math.ceil(t0 / step) * step; t <= now; t += step) {
      const x = X(t);
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, 0, 1, h - axis);
      g.fillStyle = '#6f7f92'; g.fillText(`${t.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)} s`, x + 3, h - axis / 2);
    }

    nodes.forEach((n, i) => {
      const y = i * laneH + 2, mid = y + laneH / 2;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.035)';
      g.fillRect(gut, y, w - gut - right, laneH - 1);
      g.fillStyle = n.online ? { gateway: '#37c6ff', repeater: '#b48cff', sensor: '#ffa23c' }[n.kind] : '#555';
      g.font = '600 11px system-ui, sans-serif'; g.fillText(n.name, 8, mid);
      g.font = '10px ui-monospace, Menlo, Consolas, monospace';

      // radio-state background
      let s = this.segs.get(n);
      if (!s) this.segs.set(n, s = [[-1e9, n.radio]]);
      for (let k = 0; k < s.length; k++) {
        const a = s[k][0], b = k + 1 < s.length ? s[k + 1][0] : now, col = STATE[s[k][1]];
        if (!col || b < t0) continue;
        const xa = Math.max(gut, X(a)), xb = X(b);
        const minW = s[k][1] === 'cad' ? 2 : 0;
        g.fillStyle = col; g.fillRect(xa, y + (s[k][1] === 'cad' ? laneH * 0.2 : 0), Math.max(minW, xb - xa), s[k][1] === 'cad' ? laneH * 0.6 : laneH - 1);
      }
      // transmissions
      for (const b of this.bars) {
        if (b.node !== n || b.t1 < t0) continue;
        const xa = Math.max(gut, X(b.t0)), xb = X(Math.min(b.t1, now));
        const bw = Math.max(2, xb - xa);
        g.fillStyle = KIND[b.kind]; g.globalAlpha = b.t1 > now ? 0.95 : 0.8;
        g.fillRect(xa, y + 2, bw, laneH - 5);
        g.globalAlpha = 1;
        if (tracked && b.frame.txn === tracked) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(xa + 0.5, y + 2.5, bw - 1, laneH - 6); }
        if (bw > 46) {
          g.fillStyle = '#10141c';
          g.fillText(`${this.net.name(b.frame.src)}#${b.frame.id}${b.kind === 'ack' ? ' ack' : ''}`, xa + 4, mid);
        }
      }
      // reception outcomes
      for (const m of this.marks) {
        if (m.node !== n || m.t < t0) continue;
        const x = X(m.t), col = MARK[m.status];
        g.strokeStyle = g.fillStyle = col; g.lineWidth = 1.8;
        if (m.status === 'ok') { g.beginPath(); g.arc(x, mid, 3.2, 0, Math.PI * 2); g.fill(); }
        else if (m.status === 'collision') { g.beginPath(); g.moveTo(x - 4, mid - 4); g.lineTo(x + 4, mid + 4); g.moveTo(x + 4, mid - 4); g.lineTo(x - 4, mid + 4); g.stroke(); }
        else if (m.status === 'weak') { g.beginPath(); g.arc(x, mid, 3.2, 0, Math.PI * 2); g.stroke(); }
        else if (m.status === 'duplicate') { g.fillRect(x - 3, mid - 1, 6, 2); }
        else { g.fillRect(x - 1, mid - 4, 2, 8); }
      }
    });
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(X(now) - 1, 0, 1, h - axis);
  }
}
