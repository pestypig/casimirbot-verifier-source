import crypto from "node:crypto";
const stableStringify = (value) => {
    const seen = new WeakSet();
    const normalize = (input) => {
        if (input === undefined)
            return null;
        if (input === null)
            return null;
        if (typeof input === "bigint")
            return input.toString();
        if (input instanceof Date)
            return input.toISOString();
        if (typeof input !== "object")
            return input;
        if (seen.has(input))
            return "[Circular]";
        seen.add(input);
        if (Array.isArray(input)) {
            return input.map((entry) => normalize(entry));
        }
        const obj = input;
        const sorted = {};
        for (const key of Object.keys(obj).sort()) {
            sorted[key] = normalize(obj[key]);
        }
        return sorted;
    };
    return JSON.stringify(normalize(value));
};
const defaultHashPayload = (value) => {
    try {
        const payload = stableStringify(value);
        return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
    }
    catch {
        return "unknown";
    }
};
const normalizeError = (error) => {
    if (!error)
        return undefined;
    if (typeof error === "string")
        return error;
    if (error instanceof Error)
        return error.message;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
};
const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};
const normalizeUsage = (value) => {
    if (!value || typeof value !== "object")
        return undefined;
    const obj = value;
    const promptTokens = toNumber(obj.promptTokens ?? obj.prompt_tokens ?? obj.input_tokens);
    const completionTokens = toNumber(obj.completionTokens ?? obj.completion_tokens ?? obj.output_tokens);
    const totalTokens = toNumber(obj.totalTokens ?? obj.total_tokens ?? obj.total);
    const derivedTotal = totalTokens ??
        (promptTokens !== undefined && completionTokens !== undefined
            ? promptTokens + completionTokens
            : undefined);
    if (promptTokens === undefined &&
        completionTokens === undefined &&
        derivedTotal === undefined) {
        return undefined;
    }
    return {
        promptTokens,
        completionTokens,
        totalTokens: derivedTotal,
    };
};
const extractUsageFromResult = (result) => {
    if (!result || typeof result !== "object")
        return undefined;
    const obj = result;
    const data = obj.data;
    const response = obj.response;
    return normalizeUsage(obj.usage) ?? normalizeUsage(data?.usage) ?? normalizeUsage(response?.usage);
};
const normalizeRuntimeClaimTier = (value) => {
    if (value === "reduced-order" || value === "certified") {
        return value;
    }
    return "diagnostic";
};
const normalizeRuntimeEnvelopeMetadata = (metadata) => {
    const source = metadata && typeof metadata === "object"
        ? metadata
        : {};
    const claimTier = normalizeRuntimeClaimTier(source.claim_tier);
    const provenance = typeof source.provenance === "string" && source.provenance.trim().length > 0
        ? source.provenance.trim()
        : "diagnostic";
    const certifying = source.certifying === true;
    return {
        claim_tier: claimTier,
        provenance,
        certifying,
    };
};
const toCount = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    return value ? 1 : 0;
};
const resolveCostUsd = (input) => {
    if (typeof input.costUsd === "number" && Number.isFinite(input.costUsd)) {
        return input.costUsd;
    }
    const usage = input.usage;
    const pricing = input.pricing;
    if (!usage || !pricing)
        return undefined;
    const promptTokens = usage.promptTokens;
    const completionTokens = usage.completionTokens;
    const totalTokens = usage.totalTokens ??
        (promptTokens !== undefined && completionTokens !== undefined
            ? promptTokens + completionTokens
            : undefined);
    if (totalTokens !== undefined &&
        typeof pricing.per1kUsd === "number" &&
        Number.isFinite(pricing.per1kUsd)) {
        return (totalTokens / 1000) * pricing.per1kUsd;
    }
    let cost = 0;
    let hasComponent = false;
    if (promptTokens !== undefined &&
        typeof pricing.inputPer1kUsd === "number" &&
        Number.isFinite(pricing.inputPer1kUsd)) {
        cost += (promptTokens / 1000) * pricing.inputPer1kUsd;
        hasComponent = true;
    }
    if (completionTokens !== undefined &&
        typeof pricing.outputPer1kUsd === "number" &&
        Number.isFinite(pricing.outputPer1kUsd)) {
        cost += (completionTokens / 1000) * pricing.outputPer1kUsd;
        hasComponent = true;
    }
    return hasComponent ? cost : undefined;
};
const resolveApprovalMissing = (policy, approval, defaultRequired) => {
    if (policy?.approvalMissing !== undefined) {
        return toCount(policy.approvalMissing);
    }
    const required = approval?.required ?? defaultRequired;
    if (!required)
        return 0;
    return approval?.granted ? 0 : 1;
};
const resolveProvenanceMissing = (policy, provenance, defaultRequired) => {
    if (policy?.provenanceMissing !== undefined) {
        return toCount(policy.provenanceMissing);
    }
    const required = provenance?.required ?? defaultRequired;
    if (!required)
        return 0;
    const tags = provenance?.tags ?? [];
    return tags.length > 0 ? 0 : 1;
};
const resolveOptions = (options, input, result, error) => {
    if (typeof options === "function") {
        return options(input, result, error);
    }
    return options;
};
export class RuntimeTelemetry {
    constructor(options = {}) {
        this.events = [];
        this.seq = 0;
        this.totals = {
            steps: 0,
            toolCalls: 0,
            costUsd: 0,
            forbidden: 0,
            approvalMissing: 0,
            provenanceMissing: 0,
        };
        this.clock = options.clock ?? (() => Date.now());
        this.hashPayload = options.hashPayload ?? defaultHashPayload;
        this.pricing = options.pricing ?? {};
        this.defaultApprovalRequired = options.defaultApprovalRequired ?? false;
        this.defaultProvenanceRequired = options.defaultProvenanceRequired ?? false;
        this.startMs = this.clock();
    }
    wrapTool(tool, handler, options = {}) {
        return async (input) => {
            const startedAtMs = this.clock();
            let result;
            let error;
            try {
                result = await handler(input);
                return result;
            }
            catch (err) {
                error = err;
                throw err;
            }
            finally {
                const endedAtMs = this.clock();
                const resolvedOptions = resolveOptions(options, input, result, error);
                const paramsHash = resolvedOptions.paramsHash ?? this.safeHashPayload(input);
                this.recordToolEvent({
                    tool,
                    paramsHash,
                    durationMs: Math.max(0, endedAtMs - startedAtMs),
                    ok: !error,
                    error: normalizeError(error),
                    approval: resolvedOptions.approval,
                    provenance: resolvedOptions.provenance,
                    policy: resolvedOptions.policy,
                    costUsd: resolvedOptions.costUsd,
                    startedAtMs,
                    endedAtMs,
                });
            }
        };
    }
    wrapLlm(model, handler, options = {}) {
        return async (input) => {
            const startedAtMs = this.clock();
            let result;
            let error;
            try {
                result = await handler(input);
                return result;
            }
            catch (err) {
                error = err;
                throw err;
            }
            finally {
                const endedAtMs = this.clock();
                const resolvedOptions = resolveOptions(options, input, result, error);
                const paramsHash = resolvedOptions.paramsHash ?? this.safeHashPayload(input);
                const usage = normalizeUsage(resolvedOptions.usage) ??
                    (resolvedOptions.extractUsage
                        ? resolvedOptions.extractUsage(result)
                        : undefined) ??
                    extractUsageFromResult(result);
                const costUsd = resolveCostUsd({
                    costUsd: resolvedOptions.costUsd,
                    usage,
                    pricing: resolvedOptions.pricing ?? this.pricing[model],
                });
                this.recordLlmEvent({
                    model,
                    paramsHash,
                    durationMs: Math.max(0, endedAtMs - startedAtMs),
                    ok: !error,
                    error: normalizeError(error),
                    approval: resolvedOptions.approval,
                    provenance: resolvedOptions.provenance,
                    policy: resolvedOptions.policy,
                    costUsd,
                    usage,
                    startedAtMs,
                    endedAtMs,
                });
            }
        };
    }
    recordToolCall(input) {
        const startedAtMs = input.startedAtMs ?? this.clock();
        const endedAtMs = input.endedAtMs ?? startedAtMs + (input.durationMs ?? 0);
        this.recordToolEvent({
            tool: input.tool,
            paramsHash: input.paramsHash ?? this.safeHashPayload(input.params ?? null),
            durationMs: Math.max(0, input.durationMs ?? endedAtMs - startedAtMs),
            ok: input.ok !== false,
            error: normalizeError(input.error),
            approval: input.approval,
            provenance: input.provenance,
            policy: input.policy,
            costUsd: input.costUsd,
            startedAtMs,
            endedAtMs,
        });
    }
    recordLlmCall(input) {
        const startedAtMs = input.startedAtMs ?? this.clock();
        const endedAtMs = input.endedAtMs ?? startedAtMs + (input.durationMs ?? 0);
        const costUsd = resolveCostUsd({
            costUsd: input.costUsd,
            usage: input.usage,
            pricing: input.pricing ?? this.pricing[input.model],
        }) ?? input.costUsd;
        this.recordLlmEvent({
            model: input.model,
            paramsHash: input.paramsHash ?? this.safeHashPayload(input.params ?? null),
            durationMs: Math.max(0, input.durationMs ?? endedAtMs - startedAtMs),
            ok: input.ok !== false,
            error: normalizeError(input.error),
            approval: input.approval,
            provenance: input.provenance,
            policy: input.policy,
            costUsd,
            usage: input.usage,
            startedAtMs,
            endedAtMs,
        });
    }
    buildToolUseBudgetTelemetry() {
        return {
            steps: { used: this.totals.steps },
            cost: { usd: this.totals.costUsd },
            ops: {
                forbidden: this.totals.forbidden,
                approvalMissing: this.totals.approvalMissing,
            },
            provenance: { missing: this.totals.provenanceMissing },
            runtime: { ms: this.resolveRuntimeMs() },
            tools: { calls: this.totals.toolCalls },
        };
    }
    toToolTelemetryPayload(options) {
        const payload = {
            tool: this.buildToolUseBudgetTelemetry(),
        };
        if (options?.includeEvents) {
            payload.events = this.getEvents();
        }
        return payload;
    }
    toToolTelemetryJson(options) {
        const payload = this.toToolTelemetryPayload({
            includeEvents: options?.includeEvents,
        });
        return JSON.stringify(payload, null, options?.pretty ? 2 : 0);
    }
    async writeToolTelemetry(filePath, options) {
        const fs = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await fs.mkdir(dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `${this.toToolTelemetryJson(options)}\n`, "utf8");
    }
    normalizeResponseEnvelopeMetadata(metadata) {
        return normalizeRuntimeEnvelopeMetadata(metadata);
    }
    finalize() {
        this.endMs = this.clock();
    }
    reset() {
        this.events = [];
        this.seq = 0;
        this.totals = {
            steps: 0,
            toolCalls: 0,
            costUsd: 0,
            forbidden: 0,
            approvalMissing: 0,
            provenanceMissing: 0,
        };
        this.startMs = this.clock();
        this.endMs = undefined;
        this.firstStartMs = undefined;
        this.lastEndMs = undefined;
    }
    getEvents() {
        return [...this.events];
    }
    safeHashPayload(value) {
        try {
            return this.hashPayload(value);
        }
        catch {
            return "unknown";
        }
    }
    recordToolEvent(input) {
        const event = {
            seq: ++this.seq,
            kind: "tool",
            ...input,
        };
        this.pushEvent(event);
    }
    recordLlmEvent(input) {
        const event = {
            seq: ++this.seq,
            kind: "llm",
            ...input,
        };
        this.pushEvent(event);
    }
    pushEvent(event) {
        this.events.push(event);
        this.totals.steps += 1;
        if (event.kind === "tool") {
            this.totals.toolCalls += 1;
        }
        if (typeof event.costUsd === "number" && Number.isFinite(event.costUsd)) {
            this.totals.costUsd += event.costUsd;
        }
        this.totals.forbidden += toCount(event.policy?.forbidden);
        this.totals.approvalMissing += resolveApprovalMissing(event.policy, event.approval, this.defaultApprovalRequired);
        this.totals.provenanceMissing += resolveProvenanceMissing(event.policy, event.provenance, this.defaultProvenanceRequired);
        this.firstStartMs =
            this.firstStartMs === undefined
                ? event.startedAtMs
                : Math.min(this.firstStartMs, event.startedAtMs);
        this.lastEndMs =
            this.lastEndMs === undefined
                ? event.endedAtMs
                : Math.max(this.lastEndMs, event.endedAtMs);
    }
    resolveRuntimeMs() {
        const start = this.firstStartMs ?? this.startMs;
        const end = this.endMs ?? this.lastEndMs ?? this.clock();
        return Math.max(0, end - start);
    }
}
export const createRuntimeTelemetry = (options) => new RuntimeTelemetry(options);
