// Shared board layout. Units are millimetres. Board centre is the origin, the top
// copper surface is y = 0, +x points right (toward the SMA) and +z toward the viewer.

export const BOARD = { L: 72, W: 46, T: 1.6 };
export const PX = 28;                       // texture pixels per mm on the board top

export const P = {
  esp32:  { x0: -37.5, x1: -12, z0: -9, z1: 9, antX1: -31.5 },       // module footprint; antenna end overhangs the edge
  can:    { x0: -31, x1: -12.5, z0: -8.5, z1: 8.5, h: 2.3 },
  sx:     { x: 26, z: -10, s: 16 },                                   // RFM95W (SX1276)
  sma:    { x: 36, z: -10 },                                          // edge-mount, +x edge
  oled:   { x: 3, z: -11, w: 26.7, d: 19.3 },                         // 0.96" glass
  usbc:   { x: -24, z: 19.3, w: 8.94, d: 7.35, h: 3.26 },
  cp2102: { x: -14, z: 12, s: 5 },
  tp4056: { x: -4, z: 17 },
  ldo:    { x: 8, z: 17 },
  jst:    { x: 24, z: 20.5 },
  leds: {
    pwr:  { x: -8, z: 4,    c: 0x35ff6a, name: 'PWR' },
    tx:   { x: -4, z: 4,    c: 0xff3a2a, name: 'TX' },
    rx:   { x: 0,  z: 4,    c: 0x3a8cff, name: 'RX' },
    chrg: { x: -4, z: 12.5, c: 0xff8a1f, name: 'CHRG' },
    stby: { x: 0,  z: 12.5, c: 0x3a8cff, name: 'STDBY' },
  },
  buttons: { en: { x: -30, z: 12.5 }, boot: { x: -25, z: 12.5 } },
  pads:    { v33: { x: 33, z: 10, label: '3V3' }, gnd: { x: 33, z: 16, label: 'GND' }, dio0: { x: 33, z: 4, label: 'DIO0' } },
  header:  { z: -19, n: 6, x0: -26.85, pitch: 2.54, names: ['GND', '3V3', 'TX', 'RX', 'IO0', 'EN'] },
  holes:   [[-34, -21], [34, -21], [-34, 21], [34, 21]],
  tant:    [{ x: 12.8, z: 17.8 }, { x: 16.8, z: 17.8 }],
  sot23:   [{ x: 2, z: 14.5, rot: 0, name: 'USBLC6 ESD array', desc: 'Transient-voltage suppressor on the USB data pair.' },
            { x: -20, z: 10.8, rot: 0, name: 'Auto-reset transistors', desc: 'Dual NPN driven by DTR/RTS so the flasher can pulse EN and IO0.' }],
  fiducials: [[-31.5, -16], [30, 19.5], [-33.5, 10]],
};

export const HEADER_PINS = Array.from({ length: P.header.n }, (_, i) => P.header.x0 + i * P.header.pitch);

// ---------------------------------------------------------------- copper
const spiPadZ = i => -3.2 + i * 1.27;        // ESP32 right-edge castellations
const busZ    = i => -0.5 + i * 0.45;        // packed bus below the OLED
const turnX   = i => 16.4 + i * 0.28;        // where each line turns north toward the radio
const sxPadZ  = i => -14.5 + i * 1.27;       // RFM95W left-edge pads

export const SPI_NAMES = ['SCK', 'MISO', 'MOSI', 'NSS', 'RST', 'DIO0'];
export const SX_PADS = Array.from({ length: 8 }, (_, i) => sxPadZ(i));

/** @type {{net:'spi'|'power'|'signal'|'rf', w:number, name:string, pts:number[][]}[]} */
export const TRACES = [];
for (let i = 0; i < 6; i++) {
  TRACES.push({ net: 'spi', w: 0.25, name: SPI_NAMES[i],
    pts: [[-12, spiPadZ(i)], [-10.5, spiPadZ(i)], [-8, busZ(i)], [turnX(i), busZ(i)], [turnX(i), sxPadZ(i)], [18, sxPadZ(i)]] });
}
TRACES.push(
  { net: 'power',  w: 1.0, name: 'VBUS 5 V',        pts: [[-22, 15.6], [-19, 16.6], [-6.5, 16.6]] },
  { net: 'power',  w: 0.5, name: 'VBUS → CP2102',   pts: [[-14, 16.6], [-14, 14.5]] },
  { net: 'power',  w: 1.0, name: 'BAT+',            pts: [[-1.5, 18], [4.75, 18]] },
  { net: 'power',  w: 1.0, name: 'BAT+ → JST',      pts: [[-1.5, 19.2], [0.8, 21.5], [20, 21.5]] },
  { net: 'power',  w: 1.0, name: '3V3',             pts: [[8, 15.25], [8, 10], [-9, 10], [-12, 7]] },
  { net: 'power',  w: 1.0, name: '3V3',             pts: [[8, 10], [33, 10]] },
  { net: 'power',  w: 0.8, name: '3V3 → SX1276',    pts: [[26, 10], [26, -2]] },
  { net: 'signal', w: 0.4, name: 'GND',             pts: [[33, 16], [33, 13]] },
  { net: 'rf',     w: 1.2, name: 'RF 50 Ω',         pts: [[34, -10], [36, -10]] },
  { net: 'signal', w: 0.3, name: 'U0TXD',           pts: [[-13.5, 9.5], [-13.5, 8.5], [-12, 6.96]] },
  { net: 'signal', w: 0.3, name: 'U0RXD',           pts: [[-14.5, 9.5], [-14.5, 8.2], [-12.6, 6.3], [-12, 5.69]] },
  { net: 'signal', w: 0.3, name: 'USB D+',          pts: [[-25.2, 15.6], [-25.2, 14.2], [-17.5, 14.2], [-16.5, 13.2]] },
  { net: 'signal', w: 0.3, name: 'USB D−',          pts: [[-26, 15.6], [-26, 13.5], [-18, 13.5], [-16.5, 12.2]] },
  { net: 'signal', w: 0.3, name: 'I²C SDA',         pts: [[-12, -5.74], [-9.5, -5.74]] },
  { net: 'signal', w: 0.3, name: 'I²C SCL',         pts: [[-12, -7.01], [-9.5, -7.01]] },
  { net: 'signal', w: 0.3, name: 'EN',              pts: [[-29.5, 10.5], [-29.5, 9]] },
  { net: 'signal', w: 0.3, name: 'IO0',             pts: [[-24.5, 10.5], [-24.5, 9]] },
);
HEADER_PINS.forEach((x, i) => TRACES.push({ net: 'signal', w: 0.3, name: P.header.names[i], pts: [[x, -17.75], [x, -9]] }));

export const VIAS = [
  [33, 13], [-9.5, -5.74], [-9.5, -7.01], [8, 10], [26, 10], [-29.5, 10.5], [-24.5, 10.5], [-14, 16.6],
  [34.6, -8.6], [35.4, -8.6], [34.6, -11.4], [35.4, -11.4],          // RF ground stitching
  [-6.5, 16.6], [20, 21.5],
];

// ------------------------------------------------------------- passives
// r = 0 → long axis along x, r = 90 → along z. t = 'R' resistor | 'C' capacitor.
export const PASSIVES = [
  { x: -10, z: 6, r: 90, t: 'C', d: 'C1' }, { x: -10, z: 8.2, r: 90, t: 'C', d: 'C2' },
  { x: -8, z: 6, r: 0, t: 'R', d: 'R1' }, { x: -4, z: 6, r: 0, t: 'R', d: 'R2' }, { x: 0, z: 6, r: 0, t: 'R', d: 'R3' },
  { x: -6.5, z: 12.5, r: 90, t: 'R', d: 'R4' }, { x: 2.5, z: 12.5, r: 90, t: 'R', d: 'R5' },
  { x: 19.5, z: 0.5, r: 0, t: 'C', d: 'C3' }, { x: 21.5, z: 0.5, r: 0, t: 'C', d: 'C4' }, { x: 23.5, z: 0.5, r: 0, t: 'R', d: 'R6' },
  { x: 19.5, z: 2.2, r: 0, t: 'R', d: 'R7' }, { x: 21.5, z: 2.2, r: 0, t: 'C', d: 'C5' },
  { x: 29, z: 0.5, r: 0, t: 'C', d: 'C6' }, { x: 31, z: 0.5, r: 0, t: 'C', d: 'C7' }, { x: 29, z: 2.2, r: 0, t: 'R', d: 'R8' }, { x: 31, z: 2.2, r: 0, t: 'R', d: 'R9' },
  { x: 12.5, z: 12.5, r: 0, t: 'C', d: 'C8' }, { x: 14.5, z: 12.5, r: 0, t: 'C', d: 'C9' }, { x: 16.5, z: 12.5, r: 0, t: 'R', d: 'R10' }, { x: 18.5, z: 12.5, r: 0, t: 'R', d: 'R11' },
  { x: 12.5, z: 14.2, r: 0, t: 'R', d: 'R12' }, { x: 14.5, z: 14.2, r: 0, t: 'C', d: 'C10' }, { x: 16.5, z: 14.2, r: 0, t: 'C', d: 'C11' }, { x: 18.5, z: 14.2, r: 0, t: 'R', d: 'R13' },
  ...[-25.6, -23.05, -20.5, -17.95, -15.4].flatMap((x, i) => [
    { x, z: -12.3, r: 90, t: i % 2 ? 'R' : 'C', d: (i % 2 ? 'R' : 'C') + (14 + i) },
    { x, z: -15.8, r: 90, t: i % 2 ? 'C' : 'R', d: (i % 2 ? 'C' : 'R') + (14 + i) }]),
  { x: -31.5, z: 17, r: 0, t: 'R', d: 'R20' }, { x: -31.5, z: 19.5, r: 0, t: 'R', d: 'R21' },
  { x: 20, z: -20.5, r: 0, t: 'C', d: 'C20' }, { x: 22, z: -20.5, r: 0, t: 'C', d: 'C21' }, { x: 24, z: -20.5, r: 0, t: 'R', d: 'R22' },
  { x: -27.5, z: 10.8, r: 0, t: 'C', d: 'C22' }, { x: -22.5, z: 10.8, r: 0, t: 'R', d: 'R23' },
];

// Hot spots used by the IR overlay: gaussian radius s (mm) and which simulated temperature drives them.
export const HOTSPOTS = [
  { key: 'esp32',   x: -21.5, z: 0,   s: 5.5 },
  { key: 'ldo',     x: 8,     z: 17,  s: 2.4 },
  { key: 'sx',      x: 26,    z: -10, s: 3.6 },
  { key: 'charger', x: -4,    z: 17,  s: 2.0 },
  { key: 'cp',      x: -14,   z: 12,  s: 1.6 },
];

// World-space bench levels (board top = 0, board sits on 5 mm brass standoffs).
export const MAT_TOP = -6.6;
export const BENCH_TOP = -8.6;
