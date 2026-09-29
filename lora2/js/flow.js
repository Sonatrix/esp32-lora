// "Packet journey" panel: follows one sensor transaction through every layer, explains each step
// with the live numbers, optionally freezes the simulation at each step, and decodes the frame
// bytes that are on the air right now.

import { TYPE, BCAST, GW_ID, TTL_MAX, MAX_ATTEMPTS, HEADER_BYTES, DATA_PAYLOAD, FIELDS, hex, frameKind, decodePayload } from './network.js';
import { SNR_LIMIT, dataRate, timeOnAir } from './phy.js';

export const STAGES = [
  { id: 'wake', t: 'Wake & sense', d: 'RTC timer → I²C sensor' },
  { id: 'build', t: 'Build frame', d: 'binary header + payload' },
  { id: 'spi', t: 'SPI → SX1276', d: 'FIFO, SF/BW, TX mode' },
  { id: 'cad', t: 'Listen before talk', d: 'channel activity detection' },
  { id: 'air', t: 'Chirps on air', d: 'preamble · header · payload · CRC' },
  { id: 'hear', t: 'Neighbours demodulate', d: 'RSSI, SNR, collisions' },
  { id: 'relay', t: 'Mesh relay', d: 'dedupe · TTL − 1 · jitter' },
  { id: 'gw', t: 'Gateway → Wi-Fi → MQTT', d: 'CRC, dedupe, publish' },
  { id: 'ack', t: 'ACK downlink', d: 'reverse route to sensor' },
  { id: 'sleep', t: 'Back to deep sleep', d: 'done, or retry' },
];

const ms = s => s >= 1 ? `${s.toFixed(2)} s` : s >= 0.01 ? `${(s * 1000).toFixed(0)} ms` : `${(s * 1000).toFixed(1)} ms`;
const db = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
const FIELD_INFO = {
  dst: ['Destination', v => v === GW_ID ? 'gateway' : null],
  src: ['Source (originating sensor)'],
  id: ['Message id — duplicate-cache key with src'],
  type: ['Type', v => v === TYPE.DATA ? 'DATA' : 'ACK'],
  ttl: ['TTL — hops left; relays decrement, drop at 0'],
  from: ['Sender of this hop (reverse-route learning)'],
  next: ['Next hop', v => v === BCAST ? 'flood / broadcast' : null],
  temp: ['Temperature, int16 × 100'], hum: ['Relative humidity, %'], batt: ['Battery, mV'],
};

export class Flow {
  constructor(net, root) {
    this.net = net;
    this.el = {
      txn: root.querySelector('#flowTxn'), list: root.querySelector('#stages'), title: root.querySelector('#exTitle'),
      text: root.querySelector('#exText'), phy: root.querySelector('#phy'), bytes: root.querySelector('#bytes'),
      field: root.querySelector('#field'), next: root.querySelector('#next'), hint: root.querySelector('#stepHint'),
    };
    this.stepMode = false; this.follow = true;
    this.txn = null; this.entries = new Map(); this.current = null; this.viewing = null; this.pending = [];
    this.onChange = () => {};
    this._renderList();
    this._bind();
  }

  /* ---------------------------------------------------------------- tracking */
  track(txn) {
    this.txn = txn; this.entries = new Map(); this.current = null; this.viewing = null; this.frame = null; this.pending = [];
    this.el.txn.textContent = `${txn.node.name} · report #${txn.seq}`;
    this._renderList(); this._renderExplain(); this._renderFrame();
    this.onChange();
  }
  mine(f) { return !!this.txn && !!f && f.txn === this.txn; }
  setStep(on) {
    this.stepMode = on;
    if (!on) { while (this.pending.length) this._apply(...this.pending.shift()); this.release(); }
    this._renderHold();
  }
  /** Next step: show the next step that happened in the same instant, otherwise let time run. */
  release() {
    if (this.pending.length) this._apply(...this.pending.shift());
    else this.net.hold = false;
    this._renderHold();
  }
  resume() { this.pending = []; this.net.hold = false; this._renderHold(); }
  _break() { if (this.stepMode) { this.net.hold = true; this._renderHold(); } }

  /** Record a stage entry. `append` adds a line to the latest entry of that stage instead.
   *  While frozen at a step, further steps from the same instant queue up behind it. */
  _set(stage, title, html, opts = {}) {
    if (this.stepMode && this.net.hold) {
      const queued = [...this.pending].reverse().find(p => p[0] === stage);
      if (opts.append && queued) { queued[2] += html; return; }
      if (!opts.append && opts.brk !== false) { this.pending.push([stage, title, html, opts]); return; }
    }
    this._apply(stage, title, html, opts);
  }
  _apply(stage, title, html, { append = false, brk = true, frame } = {}) {
    let e = this.entries.get(stage);
    if (append && e) e.html += html;
    else {
      e = { count: (e?.count || 0) + 1, title, html };
      this.entries.set(stage, e);
    }
    if (!append) { this.current = stage; this.viewing = null; }
    if (frame) this.frame = frame;
    this._renderList(); this._renderExplain(); if (frame) this._renderFrame();
    if (brk && !append) this._break();
  }

  /* ---------------------------------------------------------------- network events */
  bind(net) {
    const c = () => net.cfg, N = id => net.name(id);
    net.on('txn', t => { if (t.manual || (this.follow && (!this.txn || this.txn.end != null))) this.track(t); });
    net.on('stage', ev => {
      if (ev.txn !== this.txn) return;
      const s = ev.node, t = ev.txn;
      if (ev.stage === 'wake') {
        const r = t.reading;
        this._set('wake', `${s.name} wakes up`, `<p>The ESP32 on <b>${s.name}</b> wakes from deep sleep (≈10 µA asleep, ≈40 mA awake) —
          ${t.manual ? 'woken early because <i>you</i> pressed send' : 'its RTC timer fired'}. It powers the sensor and reads it over I²C:</p>
          <p class="big"><code>${r.temp.toFixed(2)} °C</code> <code>${r.hum} %RH</code> <code>batt ${r.batt.toFixed(2)} V</code></p>
          <p class="muted">Sensors sleep between reports, so they are deaf most of the time and never relay.</p>`);
      } else if (ev.stage === 'build') {
        const len = ev.frame.bytes.length, jsonLen = 44;
        const toaBin = net.phy(len).total, toaJson = net.phy(jsonLen).total;
        this._set('build', t.attempt > 1 ? `Rebuild frame — attempt ${t.attempt}/${MAX_ATTEMPTS}` : 'Build a compact frame',
          `${t.attempt > 1 ? `<p class="warn">No ACK arrived in time, so the node retries with a new message id.</p>` : ''}
          <p>Firmware packs the reading into a <b>${len}-byte</b> binary frame: a ${HEADER_BYTES}-byte network header
          (destination, source, message id, type, TTL, this-hop sender, next hop) plus a ${DATA_PAYLOAD}-byte payload.</p>
          <p>The same reading as JSON is ~${jsonLen} bytes → <b>${ms(toaJson)}</b> on air instead of <b>${ms(toaBin)}</b>. On LoRa every byte costs airtime and battery.</p>
          <p class="muted">Hover the bytes below to decode each field.</p>`, { frame: ev.frame });
      } else if (ev.stage === 'spi') {
        const len = ev.frame.bytes.length;
        this._set('spi', 'ESP32 → SX1276 over SPI', `<p>The ESP32 (SPI master, 8 MHz) writes the ${len} bytes into the radio's 256-byte FIFO
          in ~${((len + 1) * 8 / 8e6 * 1e6).toFixed(0)} µs, then programs <code>SF${c().sf}</code> <code>BW ${c().bw} kHz</code> <code>CR 4/5</code>
          <code>${c().txPower} dBm</code> and switches the SX1276 into TX.</p>
          <p>From here the radio works on its own; <b>DIO0</b> raises an interrupt when it has finished.</p>
          <p class="muted">Typical wiring (TTGO LoRa32): SCK 5 · MISO 19 · MOSI 27 · NSS 18 · RST 14 · DIO0 26.</p>`);
      } else if (ev.stage === 'sleep') {
        if (ev.ok) this._set('sleep', `${s.name} got its ACK`, `<p class="ok">Delivered and confirmed in <b>${ms(t.rtt)}</b> after waking
          (${t.attempt} attempt${t.attempt > 1 ? 's' : ''}, ${t.hops} hop${t.hops > 1 ? 's' : ''}).</p>
          <p>Radio → sleep, ESP32 → deep sleep until the next report in ~${c().interval} s. The sensor was on the air for
          <b>${ms(t.airtime)}</b> in total — at ~120 mA that is where most of its energy goes.</p>`);
        else this._set('sleep', `${s.name} gives up`, `<p class="bad">No ACK after ${MAX_ATTEMPTS} attempts.</p>
          <p>${t.delivered ? 'The reading <b>did</b> reach the gateway — only the ACK got lost on the way back (collision, fading or a hidden node).'
            : 'The reading never reached the gateway.'} The node goes back to sleep and tries again at its next report.</p>
          <p class="muted">Try: more SF, more TX power, a repeater nearer to it (drag one), or Mesh topology.</p>`);
      }
    });
    net.on('cad', ({ node, frame, busy, by, tries }) => {
      if (!this.mine(frame)) return;
      const txt = `<p>Before keying up, the radio runs <b>Channel Activity Detection</b> for ~2 symbols (${ms(net.cad())}),
        listening for a LoRa preamble.</p>
        ${busy ? `<p class="warn">Busy — <b>${by.name}</b> is on the air. ${node.name} backs off for a random time and tries again (try ${tries + 2}).</p>`
          : `<p class="ok">Clear${tries ? ` after ${tries} back-off${tries > 1 ? 's' : ''}` : ''} — nothing audible on the channel.</p>`}
        <p class="muted">LoRa has no built-in MAC: listen-before-talk is the firmware's job, and it can't detect nodes it can't hear (hidden nodes).</p>`;
      const k = frameKind(frame);
      if (k === 'data') this._set('cad', `${node.name}: listen before talk`, txt, { frame });
      else this._set(k === 'ack' ? 'ack' : 'relay', `${node.name}: listen before talk`, txt, { frame, brk: false, append: true });
    });
    net.on('txStart', air => {
      const f = air.frame; if (!this.mine(f)) return;
      const p = timeOnAir({ sf: air.sf, bw: c().bw, payload: f.bytes.length }), k = frameKind(f);
      const duty = c().band === 'EU868' ? `<p class="muted">EU868 1 % duty cycle: after this, ${air.from.name} must stay quiet for ≥ ${ms(air.toa * 99)} on this sub-band.</p>`
        : air.toa > 0.4 ? `<p class="bad">US915: this exceeds the FCC 400 ms dwell-time limit — use SF10 or lower at 125 kHz.</p>` : '';
      const hop = TTL_MAX - f.ttl + 1;
      const html = `<p><b>${air.from.name}</b> transmits ${k === 'ack' ? 'the ACK' : k === 'relay' ? 'the relayed copy' : 'the report'}:
        ${p.preSym} preamble symbols, PHY header, ${f.bytes.length} bytes + CRC → <b>${Math.round(p.preSym + p.nSym)} symbols = ${ms(air.toa)}</b>
        at SF${air.sf} / ${c().bw} kHz (${(dataRate(air.sf, c().bw) / 1000).toFixed(2)} kbit/s).</p>
        <p>Each chirp sweeps the full ${c().bw} kHz. One step up in SF doubles the chirp length: ~2.5 dB more sensitivity, twice the airtime.
        The radio is half-duplex — while it talks it hears nothing.</p>${duty}`;
      if (k === 'ack') this._set('ack', `ACK on the air · ${air.from.name} → ${N(f.next)}`, html, { frame: f });
      else this._set('air', `On the air · hop ${hop} · ${air.from.name}`, html, { frame: f });
    });
    net.on('txEnd', ({ air, results }) => {
      const f = air.frame; if (!this.mine(f)) return;
      const lim = SNR_LIMIT[air.sf];
      const rows = results.map(r => {
        const v = `${Math.round(r.rssi)} dBm · SNR ${db(r.snr)} dB`;
        const why = { ok: `${v} · margin ${db(r.margin)} dB ✓`, weak: `${v} — ${Math.abs(r.margin).toFixed(1)} dB below the SF${air.sf} floor`,
          collision: `${v} — collided with <b>${r.jam?.name}</b> (needs 6 dB capture)`, deaf: `was ${r.why === 'tx' ? 'transmitting' : 'busy'} — half-duplex, heard nothing` }[r.status];
        return `<li class="${r.status}"><b>${r.node.name}</b> ${why}</li>`;
      }).join('');
      const html = `<p>A receiver only has the packet once the last chirp arrives. It decodes if SNR ≥ <b>${lim} dB</b> (SF${air.sf} floor)
        and no overlapping signal is within 6 dB of it.</p><ul class="rx">${rows || '<li class="weak">nobody in range</li>'}</ul>
        ${results.some(r => r.status === 'ok') ? '' : '<p class="bad">Nobody decoded it.</p>'}`;
      if (frameKind(f) === 'ack') this._set('ack', `ACK heard · ${air.from.name}`, html);
      else this._set('hear', `Who heard ${air.from.name}?`, html);
    });
    net.on('drop', ({ node, frame, reason }) => {
      if (!this.mine(frame) || reason === 'not for me' || reason === 'overheard') return;
      const stage = frameKind(frame) === 'ack' ? 'ack' : 'hear';
      const txt = { duplicate: `already seen <code>${N(frame.src)}#${frame.id}</code> → duplicate dropped. This is what stops a flood looping forever.`,
        'TTL expired': 'TTL reached 0 → dropped, the flood stops here.', 'no route': `has no reverse route to ${N(frame.dst)} → dropped.` }[reason];
      this._set(stage, '', `<p class="dup"><b>${node.name}</b> ${txt}</p>`, { append: true });
    });
    net.on('relay', ({ node, frame, delay, via, ttl, next }) => {
      if (!this.mine(frame)) return;
      if (frame.type === TYPE.ACK) {
        this._set('ack', `${node.name} forwards the ACK`, `<p><b>${node.name}</b> is the ACK's next hop. It looks up its reverse route to
          <b>${N(frame.dst)}</b> (learned from the uplink) → next hop <b>${N(next)}</b>, TTL ${ttl + 1}→${ttl}, and forwards after ${ms(delay)}.</p>`);
        return;
      }
      this._set('relay', `${node.name} relays`, `<p><b>${node.name}</b> hasn't seen <code>${N(frame.src)}#${frame.id}</code> before, so it:</p>
        <ul class="steps"><li>caches the id (to drop later copies)</li><li>remembers <b>${N(frame.src)}</b> is reachable ${via === frame.src ? '<b>directly</b>' : `via <b>${N(via)}</b>`} — the reverse route for the ACK</li>
        <li>decrements TTL ${ttl + 1} → ${ttl}</li><li>waits a random <b>${ms(delay)}</b> so neighbouring relays don't all fire at once, then rebroadcasts</li></ul>`);
    });
    net.on('gwRx', ({ node, frame, meta, hops }) => {
      if (!this.mine(frame)) return;
      this._set('gw', 'Gateway accepts the report', `<p>The gateway's SX1276 raises DIO0 → its ESP32 reads the FIFO. CRC ok, not a duplicate → accept.
        Arrived over <b>${hops} hop${hops > 1 ? 's' : ''}</b> via <b>${N(frame.from)}</b>, ${Math.round(meta.rssi)} dBm / SNR ${db(meta.snr)} dB.</p>`, { frame });
    });
    net.on('wifi', ({ frame, json }) => {
      if (!this.mine(frame)) return;
      this._set('gw', '', `<p>It publishes over <b>Wi-Fi</b> (the ESP32's other radio) to the MQTT broker:</p>
        <pre class="json">topic  lora/${json.node}/up\n${JSON.stringify(json)}</pre>`, { append: true });
    });
    net.on('cloud', ({ frame }) => {
      if (!this.mine(frame)) return;
      this._set('gw', '', `<p class="ok">Broker fans it out to subscribers → see the <b>Dashboard</b> tab. Meanwhile the gateway schedules an ACK
        ${ms(net.rxDelay())} after reception${c().topology === 'mesh' ? ', long enough for other relays of this packet to finish' : ''}.</p>`, { append: true });
    });
    net.on('retry', ({ txn, backoff }) => {
      if (txn !== this.txn) return;
      this._set('sleep', `No ACK — retry ${txn.attempt + 1}/${MAX_ATTEMPTS}`, `<p class="warn">The receive window (${ms(net.ackTimeout())}) closed without an ACK.
        ${txn.delivered ? 'The gateway did get it — the ACK was lost.' : 'The report never reached the gateway.'}
        Waiting a random ${ms(backoff)} before trying again.</p>`);
    });
    net.on('await', ({ txn, timeout }) => {
      if (txn !== this.txn) return;
      this._set('hear', '', `<p class="muted">${txn.node.name} keeps its receiver open for ${ms(timeout)} waiting for an ACK.</p>`, { append: true });
    });
    net.on('cadStart', ({ frame }) => {
      if (!this.mine(frame) || frameKind(frame) !== 'ack' || this.entries.has('ack')) return;
      this._set('ack', 'Gateway sends an ACK', `<p>The gateway answers with a <b>${frame.bytes.length}-byte</b> ACK — header only, type = ACK, same message id.
        ${c().topology === 'mesh' ? `Next hop <b>${N(frame.next)}</b>: whichever neighbour delivered the uplink first. It is unicast, so only that node forwards it.`
          : 'In a star every sensor is one hop away, so it goes straight back.'}</p>`, { frame });
    });
  }

  /* ---------------------------------------------------------------- rendering */
  _renderList() {
    const mesh = this.net.cfg.topology === 'mesh';
    this.el.list.innerHTML = STAGES.map((s, i) => {
      const e = this.entries.get(s.id);
      const state = s.id === this.current ? 'cur' : e ? 'done' : !mesh && s.id === 'relay' ? 'skip' : '';
      const view = this.viewing === s.id ? ' view' : '';
      return `<li class="${state}${view}" data-s="${s.id}"><i>${i + 1}</i><span><b>${s.t}</b><small>${!mesh && s.id === 'relay' ? 'star: no relays' : s.d}</small></span>${e && e.count > 1 ? `<em>×${e.count}</em>` : ''}</li>`;
    }).join('');
  }
  _renderExplain() {
    const id = this.viewing || this.current;
    const e = id && this.entries.get(id);
    if (!e) {
      this.el.title.textContent = this.txn ? 'Waiting…' : 'Pick a sensor and send';
      this.el.text.innerHTML = this.txn ? '' : `<p>Click a sensor on the map (or press <kbd>Space</kbd>) to send a report and follow it
        through every layer: firmware, SPI, radio, the air, mesh relays, the gateway, Wi-Fi/MQTT and the ACK back.</p>
        <p class="muted">Turn on <b>Step</b> to pause at each stage.</p>`;
      return;
    }
    this.el.title.textContent = e.title;
    this.el.text.innerHTML = e.html;
  }
  _renderHold() {
    const held = this.net.hold;
    this.el.next.disabled = !held;
    this.el.next.classList.toggle('pulse', held);
    this.el.hint.textContent = this.stepMode ? (held ? `paused${this.pending.length ? ` · ${this.pending.length} more at this instant` : ''}` : 'running to next step…') : '';
  }
  _renderFrame() {
    const f = this.frame, el = this.el;
    if (!f) { el.bytes.innerHTML = '<span class="muted">no frame yet</span>'; el.phy.innerHTML = ''; el.field.textContent = ''; return; }
    const names = [...FIELDS];
    if (f.payload.length) names.push('temp', 'temp', 'hum', 'batt', 'batt');
    el.bytes.innerHTML = f.bytes.map((b, i) => `<span class="b f-${names[i]}" data-f="${names[i]}" data-i="${i}">${hex(b)}</span>`).join('')
      + `<span class="b f-crc" data-f="crc">CRC</span>`;
    const p = timeOnAir({ sf: this.net.cfg.sf, bw: this.net.cfg.bw, payload: f.bytes.length });
    const hdr = 8, rest = Math.max(0, p.nSym - 8), tot = p.preSym + p.nSym, k = frameKind(f);
    el.phy.innerHTML = `<div style="flex:${p.preSym}" class="pre">preamble ${p.preSym}</div><div style="flex:${hdr}" class="hdr">hdr 8</div>
      <div style="flex:${rest}" class="pay">payload + CRC ${rest}</div>`;
    el.phy.title = `${tot.toFixed(2)} symbols × ${ms(p.ts)} = ${ms(p.total)}`;
    el.field.innerHTML = `<b class="k-${k}">${k.toUpperCase()}</b> ${this.net.name(f.from)} → ${this.net.name(f.next)} · ${f.bytes.length} B · ${ms(p.total)} <span class="muted">— hover a byte</span>`;
    this._fieldText = i => {
      const n = names[i];
      if (n === undefined) return 'PHY CRC-16, added and checked by the radio itself';
      const [label, fmt] = FIELD_INFO[n];
      const d = decodePayload(f.payload);
      if (n === 'temp') return `${label}: ${d.temp.toFixed(2)} °C`;
      if (n === 'hum') return `${label}: ${d.hum} %`;
      if (n === 'batt') return `${label}: ${Math.round(d.batt * 1000)} mV`;
      const v = f[n], extra = fmt?.(v) ?? (n === 'ttl' ? v : this.net.name(v));
      return `${label}: 0x${hex(v)} = ${extra}`;
    };
  }
  _bind() {
    this.el.list.addEventListener('click', e => {
      const li = e.target.closest('li'); if (!li || !this.entries.has(li.dataset.s)) return;
      this.viewing = li.dataset.s === this.current ? null : li.dataset.s;
      this._renderList(); this._renderExplain();
    });
    this.el.bytes.addEventListener('mouseover', e => {
      const b = e.target.closest('.b'); if (!b || !this._fieldText) return;
      const f = b.dataset.f;
      this.el.bytes.querySelectorAll('.b').forEach(x => x.classList.toggle('hi', x.dataset.f === f));
      this.el.field.textContent = this._fieldText(b.dataset.i === undefined ? undefined : +b.dataset.i);
    });
    this.el.bytes.addEventListener('mouseleave', () => { this.el.bytes.querySelectorAll('.hi').forEach(x => x.classList.remove('hi')); this._renderFrame(); });
    this.el.next.addEventListener('click', () => this.release());
  }
}
