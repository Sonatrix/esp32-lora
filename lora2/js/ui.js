// DOM helpers: event log, MQTT dashboard, node card, hover tooltip and the radio stats block.

import { frameKind, hex, TTL_MAX } from './network.js';
import { dataRate, SNR_LIMIT } from './phy.js';

export const $ = s => document.querySelector(s);
export const ms = s => s >= 1 ? `${s.toFixed(2)} s` : `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms`;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export const KIND_INFO = {
  gateway: 'ESP32 + SX1276 on a mast, mains-powered and on Wi-Fi. Always listening; publishes reports to MQTT and sends ACKs.',
  repeater: 'ESP32 + SX1276 on a solar pole. Always listening; rebroadcasts reports it hasn\'t seen (TTL-limited flood) and forwards ACKs along reverse routes.',
  sensor: 'ESP32 + SX1276 + BME280 on a LiPo. Deep-sleeps between reports and only listens for its own ACK — so it never relays.',
};
const RADIO_INFO = { rx: 'listening', cad: 'channel activity detection', tx: 'transmitting', standby: 'awake, radio standby', sleep: 'deep sleep', off: 'powered off' };

/* ------------------------------------------------------------------ event log */
export class Log {
  constructor(el, net) {
    this.el = el; this.net = net; this.lines = [];
    const N = id => net.name(id), L = f => `${N(f.src)}#${f.id}`;
    net.on('txn', t => this.add('data', `${t.node.name} wakes · report #${t.seq}${t.manual ? ' (manual)' : ''}`));
    net.on('cad', ({ node, frame, busy, by }) => { if (busy) this.add('warn', `${node.name} CAD busy (${by.name} on air) → random back-off · ${L(frame)}`); });
    net.on('txStart', a => {
      const f = a.frame, k = frameKind(f);
      this.add(k, `${a.from.name} TX ${k.toUpperCase().padEnd(5)} ${L(f)} ttl ${f.ttl} → ${N(f.next)} · ${f.bytes.length} B · ${ms(a.toa)}`);
    });
    net.on('txEnd', ({ air, results }) => {
      if (!results.length) return this.add('bad', `   ↳ nobody in range of ${air.from.name}`);
      const parts = results.map(r => ({
        ok: `<span class="ok">${r.node.name} ✓ ${Math.round(r.rssi)} dBm</span>`, weak: `<span class="warn">${r.node.name} weak</span>`,
        collision: `<span class="bad">${r.node.name} ✗ collision${r.jam ? ` (${r.jam.name})` : ''}</span>`, deaf: `<span class="dup">${r.node.name} deaf</span>`,
      })[r.status]);
      this.add('', `   ↳ ${parts.join(' · ')}`, true);
    });
    net.on('relay', ({ node, frame, delay, ttl, next }) => this.add('relay', `${node.name} relays ${L(frame)} ${frame.type === 2 ? `ACK → ${N(next)}` : ''} ttl→${ttl} in ${ms(delay)}`));
    net.on('drop', ({ node, frame, reason }) => { if (reason !== 'not for me' && reason !== 'overheard') this.add('dup', `${node.name} drops ${L(frame)}: ${reason}`); });
    net.on('gwRx', ({ frame, hops, meta }) => this.add('gw', `GW ← ${L(frame)} via ${N(frame.from)} · ${hops} hop${hops > 1 ? 's' : ''} · ${Math.round(meta.rssi)} dBm / ${meta.snr.toFixed(1)} dB`));
    net.on('wifi', ({ json }) => this.add('gw', `GW → Wi-Fi → MQTT lora/${json.node}/up ${esc(JSON.stringify(json))}`, true));
    net.on('ackRx', ({ node, txn }) => this.add('ok', `${node.name} ✓ ACK received · round trip ${ms(this.net.time - txn.start)}`));
    net.on('retry', ({ txn, backoff }) => this.add('warn', `${txn.node.name} no ACK → retry ${txn.attempt + 1} in ${ms(backoff)}`));
    net.on('txnEnd', t => { if (!t.ok) this.add('bad', `${t.node.name} report #${t.seq} failed (${t.why})${t.delivered ? ' — gateway had it, ACK lost' : ''}`); });
  }
  add(cls, text, html = false) {
    const t = this.net.time.toFixed(3).padStart(8);
    this.lines.push(`<span class="t">${t}</span> <span class="${cls}">${html ? text : esc(text)}</span>`);
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty || this.el.offsetParent === null) return;
    const stick = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 30;
    this.el.innerHTML = this.lines.join('\n');
    if (stick) this.el.scrollTop = this.el.scrollHeight;
    this.dirty = false;
  }
}

/* ------------------------------------------------------------------ dashboard */
export function renderDash(net, table, mqtt, fresh) {
  const rows = net.nodes.filter(n => n.kind === 'sensor').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  table.innerHTML = `<tr><th>Node</th><th>Temp</th><th>RH</th><th>Battery</th><th>RSSI / SNR @ GW</th><th>Hops</th><th>Delivered</th><th>ACKed</th><th>Last seen</th></tr>` +
    rows.map(s => {
      const d = s.dash, l = d.last, pdr = d.sent ? d.delivered / d.sent : 0;
      return `<tr class="${fresh === s ? 'fresh' : ''}"><td>${s.name}</td>
        <td>${l ? `${l.t.toFixed(1)} °C` : '–'}</td><td>${l ? `${l.rh} %` : '–'}</td><td>${l ? `${l.bat.toFixed(2)} V` : '–'}</td>
        <td>${l ? `${l.rssi} dBm / ${l.snr} dB` : '–'}</td><td>${l ? l.hops : '–'}</td>
        <td><span class="bar"><i style="width:${(pdr * 100).toFixed(0)}%"></i></span>${d.delivered}/${d.sent}</td><td>${d.acked}/${d.sent}</td>
        <td>${l ? `${(net.time - l.time).toFixed(0)} s ago` : 'never'}</td></tr>`;
    }).join('');
  if (fresh && fresh.dash.last) mqtt.textContent = `last publish → lora/${fresh.name}/up  ${JSON.stringify(fresh.dash.last, (k, v) => k === 'time' ? undefined : v)}`;
}

/* ------------------------------------------------------------------ node card */
export function renderCard(net, n) {
  $('#cName').textContent = n.name;
  $('#cKind').textContent = `${n.kind} · 0x${hex(n.id)}`;
  const dc = net.dutyCycle(n) * 100;
  const cells = [
    ['Radio', RADIO_INFO[n.radio] ?? n.radio],
    ['Position', `${n.x.toFixed(2)}, ${n.y.toFixed(2)} km`],
    ['TX / RX', `${n.stats.tx} / ${n.stats.rx}`],
    ['Duty cycle 60 s', `<b class="${dc > 1 ? 'bad' : dc > 0.5 ? 'warn' : ''}">${dc.toFixed(2)} %</b>`],
  ];
  if (n.kind === 'sensor') cells.push(['Battery', `${n.batt.toFixed(2)} V`], ['Delivered / sent', `${n.dash.delivered} / ${n.dash.sent}`]);
  else cells.push(['Relayed', `${n.stats.relayed}`], ['Routes known', `${n.routes.size}`]);
  $('#cStats').innerHTML = cells.map(([k, v]) => `<div><span>${k}</span>${v.startsWith('<b') ? v : `<b>${v}</b>`}</div>`).join('');
  const nb = net.neighbours(n);
  $('#cNb').innerHTML = nb.length ? nb.map(l => `<li><b>${l.node.name}</b><span>${l.dist.toFixed(2)} km</span><span>${Math.round(l.rssi)} dBm</span>
    <span class="${l.margin > 8 ? 'ok' : l.margin > 0 ? 'warn' : 'bad'}">${l.margin >= 0 ? '+' : ''}${l.margin.toFixed(1)} dB</span></li>`).join('')
    : '<li class="muted">nobody within range</li>';
  $('#cSend').disabled = n.kind !== 'sensor' || !n.online || !!n.txn;
  $('#cPower').textContent = n.online ? 'Power off' : 'Power on';
  $('#cDel').disabled = n.kind === 'gateway';
}

export function tooltip(net, n) {
  const hops = n.kind === 'sensor' && n.dash.last ? ` · last report ${n.dash.last.hops} hop(s)` : '';
  return `<b>${n.name} · ${n.kind}</b>${KIND_INFO[n.kind]}<small>0x${hex(n.id)} · ${RADIO_INFO[n.radio]}${hops}</small>`;
}

/* ------------------------------------------------------------------ radio stats */
export function renderStats(net) {
  const c = net.cfg, toa = net.phy(12).total;
  const reach = net.reachable(), sensors = net.nodes.filter(n => n.kind === 'sensor' && n.online);
  const r = sensors.filter(s => reach.has(s)).length;
  $('#st-toa').textContent = ms(toa);
  $('#st-ack').textContent = ms(net.phy(7).total);
  $('#st-dr').textContent = `${(dataRate(c.sf, c.bw) / 1000).toFixed(2)} kb/s`;
  $('#st-snr').textContent = `${SNR_LIMIT[c.sf]} dB`;
  $('#st-range').textContent = `${net.range().toFixed(2)} km`;
  const re = $('#st-reach'); re.textContent = `${r} / ${sensors.length} sensors`; re.className = r === sensors.length ? 'ok' : r ? 'warn' : 'bad';
  const notes = [];
  if (c.band === 'US915' && toa > 0.4) notes.push(`<span class="bad">ToA ${ms(toa)} exceeds the FCC 400 ms dwell time.</span>`);
  if (c.band === 'EU868') {
    notes.push(`1 % duty cycle → each node may send at most once per ${ms(toa * 100)}.`);
    if (c.txPower > 14) notes.push('<span class="warn">EU868 allows 14 dBm ERP on this sub-band.</span>');
  }
  if (c.topology === 'star') notes.push(`Star: sensors must reach the gateway directly. Up to ${TTL_MAX} hops in mesh.`);
  $('#st-note').innerHTML = notes.join('<br>');
}
