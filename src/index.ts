import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@mariozechner/pi-coding-agent";

/**
 * pi-eco-footprint
 * ----------------
 * Adds ⚡ energy and 💧 water usage estimates to the pi footer,
 * based on the currently-active model class and cumulative token counts.
 *
 * Formulas (standard hyperscale methodology):
 *   E_it    = In_fresh * E_in
 *           + CacheWrite * E_in
 *           + CacheRead  * E_in * CACHE_READ_FACTOR
 *           + Out        * E_out * thinkingMultiplier
 *   E_total = E_it * PUE                (PUE = 1.15)
 *   Water   = E_total_Wh * WUE          (WUE = 1.8 mL/Wh)
 */

const PUE = 1.15;
const WUE_ML_PER_WH = 1.8;
// Cache-read tokens skip most of the prefill compute; providers price them
// at roughly 10% of fresh input, which is a reasonable energy proxy.
const CACHE_READ_FACTOR = 0.1;

type ModelClass = "small" | "frontier" | "reasoning";

interface Coeffs {
	eIn: number;
	eOut: number;
	thinkMul: number;
}

const COEFFS: Record<ModelClass, Coeffs> = {
	small: { eIn: 0.000002, eOut: 0.000004, thinkMul: 1 },
	frontier: { eIn: 0.002, eOut: 0.007, thinkMul: 1 },
	reasoning: { eIn: 0.004, eOut: 0.025, thinkMul: 1.5 },
};

// Deliberately conservative: names like "flash", "haiku", "mini" now cover
// frontier-tier models (Gemini 2.5 Flash, Claude Haiku 3.5, GPT-5 mini) so we
// only match unambiguously small/local models here.
const SMALL_MODEL_REGEX = /(nano|8b|7b|3b|1b|phi|gemma)/i;

interface ModelLike {
	id?: string;
	reasoning?: boolean;
}

function classifyModel(model: ModelLike | undefined, thinkingActive: boolean): ModelClass {
	if (!model) return "frontier";
	// `model.reasoning` only means the model *supports* reasoning; treat it as
	// the reasoning class only when a thinking level is actually engaged.
	if (model.reasoning && thinkingActive) return "reasoning";
	if (model.id && SMALL_MODEL_REGEX.test(model.id)) return "small";
	return "frontier";
}

function formatWh(wh: number): string {
	// Show raw energy + smartphone-charge equivalent (1 full charge ≈ 15 Wh, ~5000 mAh @ 3.7V).
	const charges = wh / 15;
	let raw: string;
	if (wh < 1) raw = `${wh.toFixed(2)}Wh`;
	else if (wh < 1000) raw = `${wh.toFixed(1)}Wh`;
	else raw = `${(wh / 1000).toFixed(2)}kWh`;
	let chargesStr: string;
	if (charges < 0.1) chargesStr = charges.toFixed(2);
	else if (charges < 10) chargesStr = charges.toFixed(1);
	else chargesStr = Math.round(charges).toString();
	return `${raw} (${chargesStr}📱)`;
}

function formatLiters(ml: number): string {
	const L = ml / 1000;
	if (L < 1) return `${L.toFixed(3)}L`;
	if (L < 100) return `${L.toFixed(2)}L`;
	return `${L.toFixed(1)}L`;
}

function formatDurationMinutes(minutes: number): string {
	if (minutes < 1) return `${(minutes * 60).toFixed(1)} seconds`;
	if (minutes < 60) return `${minutes.toFixed(1)} minutes`;
	return `${(minutes / 60).toFixed(1)} hours`;
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Sum usage over the *current branch* only (leaf → root), so forked siblings
 * don't inflate the footer.
 */
function sumTotals(ctx: ExtensionContext): Totals {
	const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant") continue;
		const usage = (msg as { usage?: Partial<Totals> }).usage;
		if (!usage) continue;
		totals.input += usage.input ?? 0;
		totals.output += usage.output ?? 0;
		totals.cacheRead += usage.cacheRead ?? 0;
		totals.cacheWrite += usage.cacheWrite ?? 0;
	}
	return totals;
}

function computeFootprint(
	model: ModelLike | undefined,
	totals: Totals,
	thinkingActive: boolean,
): { energyWh: number; waterMl: number; cls: ModelClass } {
	const cls = classifyModel(model, thinkingActive);
	const c = COEFFS[cls];
	const eIt =
		totals.input * c.eIn +
		totals.cacheWrite * c.eIn +
		totals.cacheRead * c.eIn * CACHE_READ_FACTOR +
		totals.output * c.eOut * c.thinkMul;
	const eTotal = eIt * PUE;
	return { energyWh: eTotal, waterMl: eTotal * WUE_ML_PER_WH, cls };
}

export default function (pi: ExtensionAPI) {
	// Track whether we've shown the intro this pi session; avoids re-notifying
	// every time the user starts a new chat.
	let introShown = false;

	const isThinkingActive = (): boolean => {
		try {
			return pi.getThinkingLevel() !== "off";
		} catch {
			return false;
		}
	};

	const updateStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		const totals = sumTotals(ctx);
		if (totals.input + totals.output + totals.cacheRead + totals.cacheWrite === 0) {
			ctx.ui.setStatus("eco", undefined);
			return;
		}
		const { energyWh, waterMl } = computeFootprint(ctx.model, totals, isThinkingActive());
		ctx.ui.setStatus("eco", `⚡${formatWh(energyWh)} 💧 ${formatLiters(waterMl)}`);
	};

	// Refresh on session start / resume / fork / reload
	pi.on("session_start", async (event: SessionStartEvent, ctx) => {
		updateStatus(ctx);
		if (!ctx.hasUI) return;
		// Only intro on brand-new chats or startup, and only once per pi run.
		if (!introShown && (event.reason === "new" || event.reason === "startup")) {
			introShown = true;
			ctx.ui.notify(
				"🌱 eco-footprint active — the footer shows this chat's estimated energy (⚡ Wh) and water (💧 L). " +
					"The 📱 number is how many full smartphone charges (~15 Wh each) that energy is equivalent to. Type /eco for a detailed breakdown.",
				"info",
			);
		}
	});

	// Refresh when a new assistant message finishes (new usage numbers)
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		updateStatus(ctx);
	});

	// Refresh on model switch (changes classification)
	pi.on("model_select", async (_event, ctx) => {
		updateStatus(ctx);
	});

	// Refresh when the thinking level changes (may re-classify as reasoning)
	pi.on("thinking_level_select", async (_event, ctx) => {
		updateStatus(ctx);
	});

	// Clear our footer slot when pi is tearing down our runtime
	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setStatus("eco", undefined);
	});

	// Detailed breakdown on demand
	pi.registerCommand("eco", {
		description: "Show detailed energy & water footprint for this chat",
		handler: async (_args, ctx) => {
			const totals = sumTotals(ctx);
			const inputTokens = totals.input + totals.cacheRead + totals.cacheWrite;
			const thinkingActive = isThinkingActive();
			const { energyWh, waterMl, cls } = computeFootprint(ctx.model, totals, thinkingActive);

			const lines = [
				`Model: ${ctx.model?.id ?? "unknown"} (class: ${cls}${thinkingActive ? ", thinking on" : ""})`,
				`Input tokens:  ${inputTokens.toLocaleString()}  (fresh ${totals.input.toLocaleString()}, cache-read ${totals.cacheRead.toLocaleString()}, cache-write ${totals.cacheWrite.toLocaleString()})`,
				`Output tokens: ${totals.output.toLocaleString()}`,
				``,
				`⚡ Energy: ${formatWh(energyWh)}   (PUE ${PUE}; cache-read weighted ${CACHE_READ_FACTOR}× ; 📱 ≈ full smartphone charges @ 15 Wh)`,
				`💧 Water:  ${formatLiters(waterMl)}   (WUE ${WUE_ML_PER_WH} mL/Wh)`,
				``,
				`≈ running a 10W LED bulb for ${formatDurationMinutes((energyWh / 10) * 60)}`,
				`≈ ${(waterMl / 5).toFixed(1)} teaspoons of water`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
