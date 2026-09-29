// Glue: builds the network, the 3D world, the journey panel and the timeline, wires the controls
// and runs the main loop (slow motion while anything is on the air, fast-forward when idle).

import { createNetwork, DEFAULT_NODES } from './network.js';
import { World, BOUNDS } from './scene.js';
import { Flow } from './flow.js';
import { Timeline } from './timeline.js';
import { $, Log, renderDash, renderCard, renderStats, tooltip } from './ui.js';

const IDLE_RATE = 12;                                        // sim seconds per real second when nothing is happening
const speedOf = v => 0.02 * Math.pow(50, v);                 // slider 0..1 → 0.02×..1×
const q = new URLSearchParams(location.search);

const net = createNetwork();
if (q.has('sf')) net.cfg.sf = Math.max(7, Math.min(12, +q.get('sf') || 7));
if (q.get('star') === '1') net.cfg.topology = 'star';
if (q.get('auto') === '0') net.cfg.auto = false;

const world = new World($('#c'), net);
const flow = new Flow(net, $('#flow')); flow.bind(net);
const timeline = new Timeline($('#timeline'), net, () => flow.txn);
const log = new Log($('#log'), net);

let paused = false, selected = null, tab = 'timeline', dashFresh = null, dashDirty = true;

/* ------------------------------------------------------------------ network → visuals */
net.on('txStart', a => world.onTxStart(a));
net.on('txEnd', e => world.onTxEnd(e));
net.on('drop', e => world.onDrop(e));
net.on('relay', e => world.onRelay(e));
net.on('wifi', e => world.onWifi(e));
net.on('cloud', e => { dashFresh = e.sensor; dashDirty = true; });
net.on('txnEnd', () => { dashDirty = true; });
net.on('nodes', () => { world.syncNodes(); renderStats(net); dashDirty = true; });
flow.onChange = () => {};

/* ------------------------------------------------------------------ selection */
function select(n) {
  selected = n;
  world.select(n);
  $('#card').classList.toggle('hidden', !n);
  if (n) renderCard(net, n);
  const s = n && n.kind === 'sensor' ? n : null;
  $('#sendName').textContent = s ? s.name : 'a sensor';
  $('#send').disabled = !s;
}
function sendFrom(n) {
  if (!n || n.kind !== 'sensor') return;
  if (net.hold) flow.resume();
  if (!n.online) net.setOnline(n, true);
  const t = net.report(n, true);
  if (!t && n.txn) flow.track(n.txn);
  paused && togglePause(false);
}
function burst() {
  const sensors = net.nodes.filter(n => n.kind === 'sensor' && n.online);
  const first = selected && sensors.includes(selected) ? selected : sensors[0];
  if (net.hold) flow.resume();
  if (first) net.report(first, true);
  sensors.filter(s => s !== first).forEach(s => net.report(s, false));
  paused && togglePause(false);
}
world.onSelect = n => select(n);
world.onDouble = n => sendFrom(n);
world.onMove = n => { world.updateLinks(); renderStats(net); if (n === selected) renderCard(net, n); };
world.onHover = (n, x, y) => {
  const tip = $('#tip');
  if (!n) { tip.style.display = 'none'; return; }
  tip.innerHTML = tooltip(net, n); tip.style.display = 'block'; tip.style.left = `${x}px`; tip.style.top = `${y}px`;
};

/* ------------------------------------------------------------------ controls */
function seg(id, key, apply) {
  const el = $(id);
  el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(net.cfg[key])));
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    net.cfg[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    apply && apply();
    radioChanged();
  });
}
function radioChanged() {
  $('#sfVal').textContent = `SF${net.cfg.sf}`;
  $('#pwrVal').textContent = `${net.cfg.txPower} dBm`;
  world.updateLinks(); renderStats(net); flow._renderList();
  if (selected) renderCard(net, selected);
}
seg('#topo', 'topology'); seg('#env', 'env'); seg('#band', 'band'); seg('#bw', 'bw');
$('#sf').value = net.cfg.sf;
$('#sf').addEventListener('input', e => { net.cfg.sf = +e.target.value; radioChanged(); });
$('#pwr').addEventListener('input', e => { net.cfg.txPower = +e.target.value; radioChanged(); });
$('#interval').addEventListener('input', e => {
  net.cfg.interval = +e.target.value; $('#intVal').textContent = `${net.cfg.interval} s`;
  for (const s of net.nodes) if (s.kind === 'sensor') s.nextReport = Math.min(s.nextReport, net.time + net.cfg.interval * Math.random());
});
const auto = $('#auto'); auto.checked = net.cfg.auto;
auto.addEventListener('change', () => { net.cfg.auto = auto.checked; });
$('#send').addEventListener('click', () => sendFrom(selected));
$('#burst').addEventListener('click', burst);

const step = $('#step');
step.addEventListener('change', () => flow.setStep(step.checked));
$('#follow').addEventListener('change', e => { flow.follow = e.target.checked; });

function togglePause(v = !paused) { paused = v; $('#play').innerHTML = paused ? 'Play <kbd>P</kbd>' : 'Pause <kbd>P</kbd>'; }
$('#play').addEventListener('click', () => togglePause());
const speed = $('#speed'), skip = $('#skip');
const showSpeed = () => { $('#speedVal').textContent = `${speedOf(+speed.value).toFixed(speedOf(+speed.value) < 0.1 ? 3 : 2)}×`; };
speed.addEventListener('input', showSpeed); showSpeed();

$('#links').addEventListener('change', e => { world.showLinks = e.target.checked; world.updateLinks(); });
$('#range').addEventListener('change', e => { world.showRange = e.target.checked; world.updateRange(); });
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => world.view(b.dataset.view)));

function addNode(kind) {
  const id = net.nextId(kind), count = net.nodes.filter(n => n.kind === kind).length + 1;
  let name = `${kind === 'sensor' ? 'S' : 'R'}${count}`;
  while (net.nodes.some(n => n.name === name)) name += "'";
  const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.2;
  const x = Math.max(BOUNDS.x0 + 0.3, Math.min(BOUNDS.x1 - 0.3, Math.cos(a) * r));
  const y = Math.max(BOUNDS.y0 + 0.3, Math.min(BOUNDS.y1 - 0.3, Math.sin(a) * r));
  select(net.addNode({ id, kind, name, x, y }));
}
$('#addS').addEventListener('click', () => addNode('sensor'));
$('#addR').addEventListener('click', () => addNode('repeater'));
$('#reset').addEventListener('click', () => {
  net.hold = false; net.queue.length = 0; net.airs.length = 0;
  [...net.nodes].forEach(n => net.removeNode(n));
  DEFAULT_NODES.forEach(s => net.addNode(s));
  timeline.clear();
  select(net.nodes.find(n => n.name === 'S3'));
});

$('#cClose').addEventListener('click', () => select(null));
$('#cSend').addEventListener('click', () => sendFrom(selected));
$('#cPower').addEventListener('click', () => { if (selected) { net.setOnline(selected, !selected.online); renderCard(net, selected); } });
$('#cDel').addEventListener('click', () => { if (selected && selected.kind !== 'gateway') { net.removeNode(selected); select(null); } });

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== tab));
  dashDirty = true; log.dirty = true;
}));
const zoomSteps = [1, 2, 4, 0.5];
$('#zoomT').addEventListener('click', e => {
  timeline.windowScale = zoomSteps[(zoomSteps.indexOf(timeline.windowScale) + 1) % zoomSteps.length];
  e.target.textContent = `window ×${timeline.windowScale}`;
});

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const k = e.key.toLowerCase();
  const act = {
    ' ': () => net.hold ? flow.release() : sendFrom(selected),
    n: () => flow.release(),
    s: () => { step.checked = !step.checked; flow.setStep(step.checked); },
    p: () => togglePause(),
    b: burst,
    a: () => { auto.checked = !auto.checked; net.cfg.auto = auto.checked; },
    1: () => world.view('iso'), 2: () => world.view('top'), 3: () => world.view('low'),
    delete: () => { if (selected && selected.kind !== 'gateway') { net.removeNode(selected); select(null); } },
    escape: () => select(null),
  }[k];
  if (!act) return;
  e.preventDefault();
  document.activeElement?.blur?.();
  act();
});

/* ------------------------------------------------------------------ main loop */
let last = performance.now(), slowTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused && !net.hold) {
    if (net.busy() || !skip.checked) net.step(dt * speedOf(+speed.value));
    else net.step(dt * IDLE_RATE, true);
  }
  world.update(net.time, dt, flow.txn);
  if (tab === 'timeline') timeline.draw(net.time);
  if (tab === 'log') log.flush();
  if ((slowTick += dt) > 0.25) {
    slowTick = 0;
    $('#clock').textContent = `${net.time.toFixed(2)} s`;
    const T = net.totals;
    $('#totals').innerHTML = `reports <b>${T.txns}</b> · delivered <b class="ok">${T.delivered}</b> · acked <b>${T.acked}</b> · relays <b>${T.relays}</b> · collisions <b class="bad">${T.collisions}</b>`;
    if (selected) renderCard(net, selected);
    if (tab === 'dash' && dashDirty) { renderDash(net, $('#dash'), $('#mqtt'), dashFresh); dashDirty = false; dashFresh = null; }
  }
}

select(net.nodes.find(n => n.name === 'S3'));
radioChanged();
if (q.get('step') === '1') { step.checked = true; flow.setStep(true); }
requestAnimationFrame(frame);
setTimeout(() => sendFrom(net.nodes.find(n => n.name === 'S3')), 700);

window.__lora2Ready = true;
window.__lora2 = { net, world, flow, timeline };
const loading = $('#loading'); loading.style.opacity = 0; setTimeout(() => loading.remove(), 650);

if (q.get('smoke') === '1') setTimeout(() => console.log('[lora2 smoke]', JSON.stringify({
  time: +net.time.toFixed(2), totals: net.totals, nodes: net.nodes.length, effects: world.effects.length,
  tracked: flow.txn && `${flow.txn.node.name}#${flow.txn.seq}`, stage: flow.current,
})), 8000);
