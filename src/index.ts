import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * pi-eco-footprint
 * ----------------
 * Adds ⚡ energy and 💧 water usage estimates to the pi footer,
 * based on the currently-active model class and cumulative token counts.
 *
 * Formulas (standard hyperscale methodology):
 *   E_it    = In * E_in + Out * E_out * thinkingMultiplier
 *   E_total = E_it * PUE                (PUE = 1.15)
 *   Water   = E_total_Wh * WUE          (WUE = 1.8 mL/Wh)
 */

const PUE = 1.15;
const WUE_ML_PER_WH = 1.8;

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

const SMALL_MODEL_REGEX = /(mini|small|haiku|nano|flash|8b|7b|3b|1b|phi|gemma)/i;

function classifyModel(model: { id?: string; reasoning?: boolean } | undefined): ModelClass {
	if (!model) return "frontier";
	if (model.reasoning) return "reasoning";
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
	return `${raw} (${chargesStr} 📱)`;
}

function formatLiters(ml: number): string {
	const L = ml / 1000;
	if (L < 1) return `${L.toFixed(3)}L`;
	if (L < 100) return `${L.toFixed(2)}L`;
	return `${L.toFixed(1)}L`;
}

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function sumTotals(ctx: ExtensionContext): Totals {
	const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message") continue;
		const msg = (entry as { message: { role: string; usage?: Totals } }).message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		totals.input += msg.usage.input ?? 0;
		totals.output += msg.usage.output ?? 0;
		totals.cacheRead += msg.usage.cacheRead ?? 0;
		totals.cacheWrite += msg.usage.cacheWrite ?? 0;
	}
	return totals;
}

function computeFootprint(
	model: { id?: string; reasoning?: boolean } | undefined,
	totals: Totals,
): { energyWh: number; waterMl: number; cls: ModelClass } {
	const cls = classifyModel(model);
	const c = COEFFS[cls];
	const inputTokens = totals.input + totals.cacheRead + totals.cacheWrite;
	const eIt = inputTokens * c.eIn + totals.output * c.eOut * c.thinkMul;
	const eTotal = eIt * PUE;
	return { energyWh: eTotal, waterMl: eTotal * WUE_ML_PER_WH, cls };
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const totals = sumTotals(ctx);
	if (totals.input + totals.output + totals.cacheRead + totals.cacheWrite === 0) {
		ctx.ui.setStatus("eco", "");
		return;
	}
	const model = ctx.model as { id?: string; reasoning?: boolean } | undefined;
	const { energyWh, waterMl } = computeFootprint(model, totals);
	ctx.ui.setStatus("eco", `⚡${formatWh(energyWh)} 💧 ${formatLiters(waterMl)}`);
}

export default function (pi: ExtensionAPI) {
	// Refresh on session start / resume / fork / reload
	pi.on("session_start", async (event, ctx) => {
		updateStatus(ctx);
		// Show a friendly intro on brand-new chats + first startup, but not on
		// reload/resume/fork where the user already knows what the icons mean.
		if (!ctx.hasUI) return;
		const reason = (event as { reason?: string }).reason;
		if (reason === "new" || reason === "startup") {
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

	// Detailed breakdown on demand
	pi.registerCommand("eco", {
		description: "Show detailed energy & water footprint for this chat",
		handler: async (_args, ctx) => {
			const totals = sumTotals(ctx);
			const inputTokens = totals.input + totals.cacheRead + totals.cacheWrite;
			const model = ctx.model as { id?: string; reasoning?: boolean } | undefined;
			const { energyWh, waterMl, cls } = computeFootprint(model, totals);

			const lines = [
				`Model: ${model?.id ?? "unknown"} (class: ${cls})`,
				`Input tokens:  ${inputTokens.toLocaleString()}  (fresh ${totals.input.toLocaleString()}, cache-read ${totals.cacheRead.toLocaleString()}, cache-write ${totals.cacheWrite.toLocaleString()})`,
				`Output tokens: ${totals.output.toLocaleString()}`,
				``,
				`⚡ Energy: ${formatWh(energyWh)}   (PUE ${PUE}; 📱 ≈ full smartphone charges @ 15 Wh)`,
				`💧 Water:  ${formatLiters(waterMl)}   (WUE ${WUE_ML_PER_WH} mL/Wh)`,
				``,
				`≈ running a 10W LED bulb for ${(energyWh / 10 * 60).toFixed(1)} minutes`,
				`≈ ${(waterMl / 5).toFixed(1)} teaspoons of water`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
