# lora/ — ESP32 LoRa Node · 3D Bench Simulator

Interactive three.js simulation of a custom 4-layer ESP32 + SX1276 (RFM95W) LoRa PCB under
test on a hardware bench: oscilloscope, lab power supply with probe leads, LiPo pack and USB-C.
Everything (geometry, copper artwork, chip markings, screens) is generated procedurally.

## Run it

The app is split into ES modules, so it must be served over HTTP (module scripts are blocked on `file://`).

```sh
# from the repo root
npx serve .
# then open http://localhost:3000/lora/
```

three.js 0.160 is loaded from unpkg, so the first load needs an internet connection.

## Controls

| Control | Effect |
|---|---|
| **Transmit packet** (`T`) | Loads the FIFO over SPI, keys the PA for the computed time-on-air, waits for an ACK |
| **Continuous TX** (`C`) | Repeats packets back-to-back so the thermal picture develops |
| **Spreading factor** SF7–SF12 | Time-on-air, data rate, sensitivity, estimated range and RF dome radius all follow |
| **Frequency band** 868 / 915 MHz | Retunes the radio; dome colour switches cyan / amber |
| **Bandwidth** 125 / 250 / 500 kHz | Changes symbol time and noise floor; LDRO auto-enables at SF11/12 @ 125 k |
| **Link distance** 0.1–30 km | Log-distance path loss (n = 2.9); packets are lost when SNR drops below the SF demod floor |
| **Power input** USB-C / LiPo | Slides the USB plug out, switches the LDO input, starts/stops the TP4056 charger and its LEDs |
| **Thermal camera** (`H`) | Auto-ranging ironbow IR overlay; board heat map plus per-part temperatures (ESP32, LDO, SX1276 PA, charger) |
| Camera presets `1`–`5` | Iso, top, bench, antenna, OLED |
| Hover | Tooltip for every part: modules, passives, connectors, test clips, instruments |

Deep links: `?thermal=1`, `?tx=1`, `?cont=1`, `?smoke=1` (prints a status line to the console).

## What is simulated

- **LoRa PHY maths** (`js/lora-sim.js`): SX1276 datasheet time-on-air, bit rate, sensitivity per SF/BW,
  noise floor, link budget and maximum range. ACK success uses the SNR demod limit per SF plus random fading.
- **Packet state machine**: `idle → spi_write → tx → wait → rx → cool`. Each phase drives the
  TX/RX LEDs, the SPI-bus trace glow, the RF domes, the oscilloscope traces and the OLED.
- **Electrical/thermal model**: 3V3 rail current, LDO dissipation (Vin − 3.3 V) × I, PA heating,
  charger heating, battery charge/discharge. First-order thermal lag so parts warm up over seconds.
- **RF propagation**: additive Fresnel-shaded spheres expand from the antenna centre every 130 ms while the PA is keyed.
- **Screens**: OLED (two-colour SSD1306 look), scope (CH1 chirp envelope, CH2 SPI SCK bursts), PSU (V / A readout).

## Files

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Markup and glass-panel UI |
| `js/layout.js` | Every component position and copper trace, in mm |
| `js/textures.js` | Canvas painters: board artwork, glow masks, chip labels, OLED/scope/PSU screens, IR heat map, wood/mat |
| `js/pcb.js` | PCB, modules, SMA + antenna, connectors, passives, LEDs, standoffs |
| `js/bench.js` | Bench, ESD mat, oscilloscope, PSU, leads and clips, LiPo, USB-C cable |
| `js/lora-sim.js` | LoRa arithmetic, link model, packet state machine, power/thermal model |
| `js/effects.js` | RF dome shader/pool and the thermal material swap |
| `js/ui.js` | DOM bindings, serial monitor, tooltip, legend |
| `js/main.js` | Renderer, lighting, bloom, main loop, glue |

Layout is plausible rather than a CAD reference: footprints and pitches are real (0603, SOT-223,
SOP-8, QFN-28, JST-PH, 2.54 mm header, 1.27 mm castellations), placement is hand-tuned to look right.
