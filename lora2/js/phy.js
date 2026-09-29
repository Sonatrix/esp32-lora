// LoRa PHY arithmetic (Semtech SX1276 datasheet §4.1.1.6) and a log-distance link model.
// Pure functions, no DOM: shared by the network engine, the UI and the headless smoke test.

export const SNR_LIMIT = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };   // dB, demod floor per SF
const SENS_125 = { 7: -123, 8: -126, 9: -129, 10: -132, 11: -134.5, 12: -137 };          // dBm at BW 125 kHz
export const ENV = { rural: 2.7, suburban: 3.0, urban: 3.4 };                             // path-loss exponent n
export const BANDS = { EU868: 868, US915: 915 };

export const symbolTime = (sf, bw) => Math.pow(2, sf) / (bw * 1000);                     // seconds
export const cadTime = (sf, bw) => 2 * symbolTime(sf, bw);                                // ≈ 2 symbols

export function timeOnAir({ sf, bw, payload, preamble = 8, cr = 1, crc = true, header = true }) {
  const ts = symbolTime(sf, bw);
  const de = bw === 125 && sf >= 11 ? 1 : 0;                                              // low data-rate optimisation
  const tPre = (preamble + 4.25) * ts;
  const num = 8 * payload - 4 * sf + 28 + 16 * (crc ? 1 : 0) - 20 * (header ? 0 : 1);
  const nSym = 8 + Math.max(Math.ceil(num / (4 * (sf - 2 * de))) * (cr + 4), 0);
  return { ts, tPre, tPay: nSym * ts, total: tPre + nSym * ts, nSym, preSym: preamble + 4.25 };
}
export const dataRate = (sf, bw, cr = 1) => sf * (4 / (4 + cr)) / symbolTime(sf, bw);   // bit/s
export const sensitivity = (sf, bw) => SENS_125[sf] + 10 * Math.log10(bw / 125);         // dBm
export const noiseFloor = bw => -174 + 10 * Math.log10(bw * 1000) + 6;                   // dBm, NF 6 dB

const pl0 = fMHz => 20 * Math.log10((4 * Math.PI * fMHz * 1e6) / 3e8);                   // free-space loss at 1 m
export const pathLoss = (dKm, fMHz, n) => pl0(fMHz) + 10 * n * Math.log10(Math.max(1, dKm * 1000));

/** Mean link budget. `gains` = both antennas together (2 × 2 dBi). */
export function linkBudget({ dist, sf, bw, freq, txPower, n, gains = 4 }) {
  const rssi = txPower + gains - pathLoss(dist, freq, n);
  const snr = rssi - noiseFloor(bw);
  return { rssi, snr, margin: snr - SNR_LIMIT[sf] };
}
/** Distance (km) at which the mean link margin reaches 0 dB. */
export function maxRange({ sf, bw, freq, txPower, n, gains = 4 }) {
  const plMax = txPower + gains - (noiseFloor(bw) + SNR_LIMIT[sf]);
  return Math.pow(10, (plMax - pl0(freq)) / (10 * n)) / 1000;
}
