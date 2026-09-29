// DOM bindings: control panel, serial monitor, tooltip, thermal legend. Pure UI; no three.js.

const $ = id => document.getElementById(id);

export class UI {
  /** handlers: { tx, continuous(bool), sf(n), freq(n), bw(n), dist(km), power('usb'|'lipo'), thermal(bool), rotate(bool), view(name), shot() } */
  constructor(h) {
    this.h = h;
    this.logEl = $('log'); this.tip = $('tip'); this.t0 = performance.now();

    $('tx').addEventListener('click', () => h.tx());
    $('cont').addEventListener('change', e => h.continuous(e.target.checked));
    $('sf').addEventListener('input', e => { const v = +e.target.value; $('sfVal').textContent = 'SF' + v; h.sf(v); });
    $('dist').addEventListener('input', e => { const km = UI.sliderToKm(+e.target.value); $('distVal').textContent = UI.fmtKm(km); h.dist(km); });
    this.seg('freq', v => h.freq(+v)); this.seg('bw', v => h.bw(+v)); this.seg('pwr', v => h.power(v));
    $('thermal').addEventListener('change', e => h.thermal(e.target.checked));
    $('rotate').addEventListener('change', e => h.rotate(e.target.checked));
    document.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => h.view(b.dataset.view)));
    $('shot').addEventListener('click', () => h.shot());
    $('clear').addEventListener('click', () => { this.logEl.textContent = ''; });
    $('collapse').addEventListener('click', e => {
      const s = $('serial'); s.classList.toggle('collapsed'); e.target.textContent = s.classList.contains('collapsed') ? 'show' : 'hide';
    });

    window.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // sliders/checkboxes keep focus after a click; keys must still work
      const k = e.key.toLowerCase();
      if (k === 't') h.tx();
      else if (k === 'c') { $('cont').checked = !$('cont').checked; h.continuous($('cont').checked); }
      else if (k === 'h') { $('thermal').checked = !$('thermal').checked; h.thermal($('thermal').checked); }
      else if ('12345'.includes(k)) h.view(['iso', 'top', 'bench', 'ant', 'oled'][+k - 1]);
    });
    $('distVal').textContent = UI.fmtKm(UI.sliderToKm(+$('dist').value));
  }
  seg(id, fn) {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v);
    }));
  }
  static sliderToKm(v) { return 0.1 * Math.pow(300, v); }          // 0.1 … 30 km, log scale
  static fmtKm(km) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`; }

  setTxBusy(busy) { $('tx').disabled = busy; $('tx').style.opacity = busy ? 0.6 : 1; }
  setPowerSource(src) { $('pwr').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === src)); }
  setThermalChecked(on) { $('thermal').checked = on; }
  setContinuousChecked(on) { $('cont').checked = on; }

  /** s: {toa, dr, sens, range, margin, rssi, snr, tx, ack, rail, vin} */
  setStats(s) {
    $('st-toa').textContent = s.toa >= 1 ? `${s.toa.toFixed(2)} s` : `${(s.toa * 1000).toFixed(1)} ms`;
    $('st-dr').textContent = s.dr >= 1000 ? `${(s.dr / 1000).toFixed(2)} kb/s` : `${s.dr.toFixed(0)} b/s`;
    $('st-sens').textContent = `${s.sens.toFixed(1)} dBm`;
    $('st-range').textContent = `≈ ${UI.fmtKm(s.range)}`;
    const m = $('st-margin'); m.textContent = `${s.margin >= 0 ? '+' : ''}${s.margin.toFixed(1)} dB`;
    m.className = s.margin >= 3 ? 'ok' : s.margin >= 0 ? '' : 'bad';
    $('st-rssi').textContent = s.rssi == null ? '–' : `${s.rssi.toFixed(0)} dBm / ${s.snr >= 0 ? '+' : ''}${s.snr.toFixed(1)} dB`;
    const p = $('st-pdr'); p.textContent = s.tx ? `${s.ack}/${s.tx} (${Math.round(100 * s.ack / s.tx)} %)` : '0/0';
    p.className = s.tx && s.ack / s.tx < 0.7 ? 'bad' : '';
    $('st-cur').textContent = `3.30 V · ${(s.rail * 1000).toFixed(0)} mA`;
    $('st-vin').textContent = `${s.vin.toFixed(2)} V`;
  }
  setThermal(on, temps) {
    $('thermalLegend').classList.toggle('hidden', !on);
    if (on) this.updateThermal(temps);
  }
  updateThermal(t, lo, hi) {
    $('tl-esp').textContent = `${t.esp32.toFixed(1)} °C`; $('tl-ldo').textContent = `${t.ldo.toFixed(1)} °C`;
    $('tl-sx').textContent = `${t.sx.toFixed(1)} °C`; $('tl-chg').textContent = `${t.charger.toFixed(1)} °C`;
    if (lo != null) { $('tl-lo').textContent = `${lo.toFixed(0)} °C`; $('tl-hi').textContent = `${hi.toFixed(0)} °C`; }
  }
  setPowerDot(on) { $('dot').classList.toggle('on', on); }

  log(msg, cls = '') {
    const ts = ((performance.now() - this.t0) / 1000).toFixed(3).padStart(9, ' ');
    const line = document.createElement('span');
    if (cls) line.className = cls;
    line.textContent = `[${ts}] ${msg}\n`;
    this.logEl.appendChild(line);
    while (this.logEl.childNodes.length > 400) this.logEl.removeChild(this.logEl.firstChild);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  showTip(x, y, info) {
    this.tip.style.display = 'block';
    this.tip.innerHTML = `<b></b><span></span>${info.desc ? '<small></small>' : ''}`;
    this.tip.querySelector('b').textContent = info.name;
    if (info.desc) this.tip.querySelector('small').textContent = info.desc;
    const r = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.min(x, innerWidth - r.width - 30)}px`;
    this.tip.style.top = `${Math.min(y, innerHeight - r.height - 30)}px`;
  }
  hideTip() { this.tip.style.display = 'none'; }
}
