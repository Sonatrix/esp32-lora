# lora2/ — ESP32 LoRa Network · Communication Flow Explorer

An interactive three.js map of a small ESP32 + SX1276 LoRa network: six battery **sensors**, three solar
mesh **repeaters** and a Wi-Fi **gateway** that publishes to an MQTT broker. Send a report and follow it
through every layer (firmware → SPI → radio → air → relays → gateway → Wi-Fi/MQTT → ACK → sleep), step by
step, with the real numbers for the current radio settings. Nothing is pre-scripted: a discrete-event
simulator decides what each radio hears, so collisions, hidden nodes and lost ACKs happen on their own.

## Run it

The app is split into ES modules, so it must be served over HTTP (module scripts are blocked on `file://`).

```sh
# from the repo root
npx serve .
# then open http://localhost:3000/lora2/
```

three.js 0.160 is loaded from unpkg, so the first load needs an internet connection.

## Things to try

| Try this | What you'll see |
|---|---|
| Turn on **Step** (`S`), press **Space** | The journey panel freezes at each stage; **Next** (`N`) advances. Stages that happen at the same instant (e.g. "who heard it" and "R1 relays") queue up |
| Switch **Star ↔ Mesh** | Star: only S1 and S2 reach the gateway at SF7. Mesh: repeaters flood the report (TTL 3) and route the ACK back along the reverse path |
| Watch **S1** in mesh | The gateway hears it directly *and* via R1/R3 — duplicates are dropped by the dedupe cache |
| Look at **S2** | A marginal direct link (~1 dB). Fading makes it fail some of the time; SF8 fixes it |
| **S6** says "no path" | Raise SF to 10–11, raise TX power, or drag a repeater (or S6) closer |
| **Burst** (`B`) at SF10–12 | CAD back-offs, collisions (✕ in the timeline), lost ACKs and retries |
| Band **US915** + SF11/12 | The 400 ms FCC dwell-time warning |
| Hover the **frame bytes** | Each header/payload field decoded |

## Controls

| Control | Effect |
|---|---|
| Click / drag / double-click a node | Select (shows range circle and node card) / move it (links and routes update live) / send a report |
| **Send** (`Space`), **Burst** (`B`) | One tracked report from the selected sensor / every sensor at once |
| **Automatic reports** (`A`), interval | Each sensor wakes on its own timer (±30 % jitter) |
| Topology · Environment · Band | Star/Mesh · path-loss exponent 2.7 / 3.0 / 3.4 · EU868 / US915 |
| SF 7–12 · BW 125/250/500 · TX power 2–20 dBm | Time-on-air, sensitivity, range, links and reachability all follow |
| **Pause** (`P`), slow motion, fast-forward idle | Airtime plays in slow motion (default 0.15×); idle time between reports runs at 12× |
| **Step** (`S`), **Next** (`N`), Follow auto | Break at every stage of the tracked report; follow automatic reports when idle |
| Links · range · camera `1`–`3` · + Sensor · + Repeater · Reset | View toggles and layout editing; `Delete` removes the selected node |
| Dock tabs | **Airtime timeline** (per-node lanes: TX bars, CAD, listening, decode outcomes), **Event log**, **Dashboard (MQTT)** |

Deep links: `?step=1`, `?star=1`, `?sf=10`, `?auto=0`, `?smoke=1` (prints a status line to the console after 8 s).

## What is simulated

- **PHY** (`js/phy.js`): SX1276 datasheet time-on-air (preamble, explicit header, CRC, LDRO), bit rate, SNR demod floor per SF,
  noise floor, log-distance path loss and max range.
- **Radio/MAC** (`js/network.js`): half-duplex radios; CAD listen-before-talk with random back-off; per-receiver
  fading (±6 dB); reception needs SNR above the SF floor, no overlapping signal within 6 dB (capture effect) and the receiver
  not transmitting or asleep.
- **Network layer**: 12-byte frame `dst · src · id · type · ttl · from · next` + `temp(int16×100) · RH · batt(mV)`;
  flooding through repeaters with a duplicate cache and TTL; the gateway and repeaters learn reverse routes from the uplink
  and the ACK is unicast hop by hop along them. Sensors sleep, listen only for their own ACK, and retry up to 3 times.
- **Gateway**: dedupe, JSON publish over Wi-Fi to `lora/<node>/up`, ACK scheduled after the relay window.

## Files

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Markup and glass-panel UI |
| `js/phy.js` | LoRa arithmetic and link model (no DOM) |
| `js/network.js` | Discrete-event network engine, frame format, default layout (no DOM; runs in Node too) |
| `js/scene.js` | three.js map, node models, links, range ring, RF domes, packet comets, pops, MQTT cloud, drag/select |
| `js/flow.js` | Packet-journey stepper, per-stage explanations, frame inspector |
| `js/timeline.js` | Canvas airtime timeline |
| `js/ui.js` | Event log, dashboard, node card, tooltip, radio stats |
| `js/main.js` | Controls, keyboard, main loop, glue |

`js/phy.js` is a trimmed copy of the maths in `../lora/js/lora-sim.js`, so each app can be served on its own.
The link model is deliberately simple (no terrain or antenna height); the layout is tuned so each default node teaches one thing.
