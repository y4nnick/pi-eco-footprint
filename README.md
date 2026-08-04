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
# From git
pi install git:github.com/y4nnick/pi-eco-footprint

# From a local checkout
pi install /path/to/pi-eco-footprint
```

Add `-l` to install into the current project's `.pi/settings.json` instead of global settings.

Try it without installing:

```bash
pi -e /path/to/pi-eco-footprint
```

## Methodology

All figures are **rough estimates** derived from public research and hyperscaler disclosures. No provider publishes exact per-token energy telemetry, so the constants below are the best publicly-defensible values as of late 2024 / 2025.

### Formulas

```
E_it     = In * E_in + Out * E_out * thinking_multiplier
E_total  = E_it * PUE        (PUE = 1.15)
Water_mL = E_total_Wh * WUE  (WUE = 1.8 mL/Wh = 1.8 L/kWh)
```

- **PUE** (Power Usage Effectiveness) and **WUE** (Water Usage Effectiveness) are the standard data-center efficiency metrics defined by The Green Grid.
  - PUE — [Wikipedia: Power usage effectiveness](https://en.wikipedia.org/wiki/Power_usage_effectiveness) (summarises The Green Grid's original *PUE: A Comprehensive Examination of the Metric*, 2012)
  - WUE — [Wikipedia: Water usage effectiveness](https://en.wikipedia.org/wiki/Water_usage_effectiveness) (summarises The Green Grid's original *WUE: A Green Grid Data Center Sustainability Metric*, 2011)

### Constants and their sources

| Constant | Value | Source |
|---|---|---|
| PUE (hyperscaler avg.) | **1.15** | [Google 2024 Environmental Report](https://sustainability.google/reports/google-2024-environmental-report/) reports a fleet-wide PUE of 1.10; [Meta 2023 Sustainability Report](https://sustainability.atmeta.com/2024-sustainability-report/) reports 1.08–1.12; [AWS data centers](https://aws.amazon.com/sustainability/data-centers/) sit around 1.15–1.2. We use 1.15 as a conservative hyperscale average. |
| WUE | **1.8 L/kWh** | [Smith, Shehabi et al., *United States Data Center Energy Usage Report: 2025 Update* (LBNL / OSTI, 2024)](https://www.osti.gov/biblio/3374245) reports on-site WUE distributions; [Mytton, *Data centre water consumption*, npj Clean Water (2021)](https://www.nature.com/articles/s41545-021-00101-w) surveys reported WUE values across operators, with a common range of 1.5–2.2 L/kWh for evaporatively-cooled sites. |

### Per-token energy by model class

| Class | E_in (Wh/tok) | E_out (Wh/tok) | Thinking mult. |
|---|---|---|---|
| Small     | 0.000002 | 0.000004 | 1×  |
| Frontier  | 0.002    | 0.007    | 1×  |
| Reasoning | 0.004    | 0.025    | 1.5× |

These coefficients are triangulated from:

- **Luccioni, Jernite & Strubell, *Power Hungry Processing: Watts Driving the Cost of AI Deployment?* (FAccT 2024)** — measures inference energy for a range of open-weight models across tasks. [arXiv:2311.16863](https://arxiv.org/abs/2311.16863)
- **Patterson et al., *Carbon Emissions and Large Neural Network Training* (2021)** — foundational analysis of large-model energy from Google. [arXiv:2104.10350](https://arxiv.org/abs/2104.10350)
- **Epoch AI, *How much energy does ChatGPT use?* (2025)** — models GPT-4o-class inference at roughly 0.3 Wh per short query, informing the frontier output coefficient. [epoch.ai/blog/how-much-energy-does-chatgpt-use](https://epoch.ai/blog/how-much-energy-does-chatgpt-use)
- **Sam Altman, *The Gentle Singularity* (2025)** — reports an average ChatGPT query at ~0.34 Wh and ~0.32 mL of water, used as a sanity check for the frontier class. [blog.samaltman.com/the-gentle-singularity](https://blog.samaltman.com/the-gentle-singularity)
- **De Vries, *The growing energy footprint of AI* (Joule, 2023)** — top-down estimates of AI inference energy at data-center scale. [doi.org/10.1016/j.joule.2023.09.004](https://doi.org/10.1016/j.joule.2023.09.004)

The **1.5× thinking multiplier** for reasoning models accounts for hidden chain-of-thought tokens that aren't billed but still consume compute. See the [OpenAI o1 System Card (PDF)](https://cdn.openai.com/o1-system-card-20240917.pdf) and [DeepSeek-R1 technical report](https://arxiv.org/abs/2501.12948) for descriptions of the extended internal-reasoning phase.

### Classification

- `reasoning`: any model where `model.reasoning === true` (e.g. o1, o3, deepseek-r1)
- `small`: model id matches `/mini|small|haiku|nano|flash|8b|7b|3b|1b|phi|gemma/i`
- `frontier`: everything else

Input tokens include `cache-read` and `cache-write` — cache tokens still traverse the model. For the raw methodology sketch this extension is based on, see [`docs/footprint-docs.html`](../footprint-docs.html) in the parent `.pi/` directory.

## Caveats

These are **estimates**, not measurements. Actual figures depend on hardware, batching, quantisation, and data-center region. The constants are order-of-magnitude values from public papers and hyperscaler disclosures. Real providers rarely publish per-token telemetry.

- PUE 1.15 assumes a modern hyperscaler. Older data centers are 1.4–2.0.
- WUE 1.8 L/kWh reflects evaporative cooling. Air- or seawater-cooled sites can be near 0.
- Only assistant messages contribute — user typing has no direct footprint here.

## Commands

- `/eco` — print a detailed breakdown of energy, water, and real-world comparisons for the current chat.

## License

MIT
