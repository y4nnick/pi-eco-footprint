# pi-eco-footprint

Show estimated **⚡ energy** and **💧 water** usage of each pi chat in the footer, based on the active model class and cumulative token counts.

![footer example](./docs/screenshot.png)

```
↑12k ↓3.4k R8k $0.042              claude-sonnet-4
⚡28.5Wh 💧  0.051L
```

## What it does

- Adds a status line to pi's footer with cumulative energy (Wh / kWh) and water (L) for the current chat
- Classifies the current model as `small` / `frontier` / `reasoning` (based on `model.reasoning` and the model id)
- Recomputes on every assistant message, model switch, and session start
- Provides a `/eco` command showing a detailed breakdown with tangible comparisons

## Install

```bash
# From npm (once published)
pi install npm:pi-eco-footprint

# From git
pi install git:github.com/YOUR_USER/pi-eco-footprint

# From a local checkout
pi install /path/to/pi-eco-footprint
```

Add `-l` to install into the current project's `.pi/settings.json` instead of global settings.

Try it without installing:

```bash
pi -e /path/to/pi-eco-footprint
```

## Methodology

Standard hyperscale data-center formulas:

```
E_it     = In * E_in + Out * E_out * thinking_multiplier
E_total  = E_it * PUE        (PUE = 1.15)
Water_mL = E_total_Wh * WUE  (WUE = 1.8 mL/Wh = 1.8 L/kWh)
```

Per-token constants by model class:

| Class     | E_in (Wh/tok) | E_out (Wh/tok) | Thinking mult. |
|-----------|---------------|----------------|----------------|
| Small     | 0.000002      | 0.000004       | 1×             |
| Frontier  | 0.002         | 0.007          | 1×             |
| Reasoning | 0.004         | 0.025          | 1.5×           |

Classification:

- `reasoning`: any model where `model.reasoning === true` (e.g. o1, o3, deepseek-r1)
- `small`: model id matches `/mini|small|haiku|nano|flash|8b|7b|3b|1b|phi|gemma/i`
- `frontier`: everything else

Input tokens include `cache-read` and `cache-write` — cache tokens still traverse the model.

## Caveats

These are **estimates**, not measurements. Actual figures depend on hardware, batching, quantisation, and data-center region. The constants are order-of-magnitude values from public papers and hyperscaler disclosures. Real providers rarely publish per-token telemetry.

- PUE 1.15 assumes a modern hyperscaler. Older data centers are 1.4–2.0.
- WUE 1.8 L/kWh reflects evaporative cooling. Air- or seawater-cooled sites can be near 0.
- Only assistant messages contribute — user typing has no direct footprint here.

## Commands

- `/eco` — print a detailed breakdown of energy, water, and real-world comparisons for the current chat.

## License

MIT
