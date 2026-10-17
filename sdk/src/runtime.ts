import crypto from "node:crypto";

type MetricValue = number | boolean | string | null;

export type ToolUseBudgetTelemetry = {
  steps?: {
    used?: number;
    total?: number;
  };
  cost?: {
    usd?: number;
  };
  ops?: {
    forbidden?: number;
    approvalMissing?: number;
  };
  provenance?: {
    missing?: number;
  };
  runtime?: {
    ms?: number;
  };
  tools?: {
    calls?: number;
    total?: number;
  };
  metrics?: Record<string, MetricValue>;
};

export type RuntimePolicyFlags = {
  forbidden?: boolean | number;
  approvalMissing?: boolean | number;
  provenanceMissing?: boolean | number;
};

export type RuntimeApproval = {
  required?: boolean;
  granted?: boolean;
  id?: string;
  note?: string;
};

export type RuntimeProvenance = {
  required?: boolean;
  tags?: string[];
};

export type RuntimeTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ModelPricing = {
  inputPer1kUsd?: number;
  outputPer1kUsd?: number;
  per1kUsd?: number;
};

export type RuntimeToolEvent = {
  seq: number;
  kind: "tool";
  tool: string;
  paramsHash: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  approval?: RuntimeApproval;
  provenance?: RuntimeProvenance;
  policy?: RuntimePolicyFlags;
  costUsd?: number;
  usage?: RuntimeTokenUsage;
  startedAtMs: number;
  endedAtMs: number;
};

export type RuntimeLlmEvent = {
  seq: number;
  kind: "llm";
  model: string;
  paramsHash: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  approval?: RuntimeApproval;
  provenance?: RuntimeProvenance;
  policy?: RuntimePolicyFlags;
  costUsd?: number;
  usage?: RuntimeTokenUsage;
  startedAtMs: number;
  endedAtMs: number;
};

export type RuntimeEvent = RuntimeToolEvent | RuntimeLlmEvent;


export type RuntimeClaimTier = "diagnostic" | "reduced-order" | "certified";

export type RuntimeResponseEnvelopeMetadata = {
  claim_tier: RuntimeClaimTier;
  provenance: string;
  certifying: boolean;
};

export type RuntimeTelemetryOptions = {
  clock?: () => number;
  hashPayload?: (value: unknown) => string;
  pricing?: Record<string, ModelPricing>;
  defaultApprovalRequired?: boolean;
  defaultProvenanceRequired?: boolean;
};

export type ToolCallOptions = {
  paramsHash?: string;
  policy?: RuntimePolicyFlags;
  approval?: RuntimeApproval;
  provenance?: RuntimeProvenance;
  costUsd?: number;
};

export type LlmCallOptions = {
  paramsHash?: string;
  policy?: RuntimePolicyFlags;
  approval?: RuntimeApproval;
  provenance?: RuntimeProvenance;
  costUsd?: number;
  usage?: RuntimeTokenUsage | Record<string, unknown>;
  pricing?: ModelPricing;
  extractUsage?: (result: unknown) => RuntimeTokenUsage | undefined;
};

type ToolCallOptionsInput<TInput, TResult> =
  | ToolCallOptions
  | ((input: TInput, result?: TResult, error?: unknown) => ToolCallOptions);

type LlmCallOptionsInput<TInput, TResult> =
  | LlmCallOptions
  | ((input: TInput, result?: TResult, error?: unknown) => LlmCallOptions);

type Totals = {
  steps: number;
  toolCalls: number;
  costUsd: number;
  forbidden: number;
  approvalMissing: number;
  provenanceMissing: number;
};

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === undefined) return null;
    if (input === null) return null;
    if (typeof input === "bigint") return input.toString();
    if (input instanceof Date) return input.toISOString();
    if (typeof input !== "object") return input;
    if (seen.has(input as object)) return "[Circular]";
    seen.add(input as object);
    if (Array.isArray(input)) {
      return input.map((entry) => normalize(entry));
    }
    const obj = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalize(obj[key]);
    }
    return sorted;
  };
  return JSON.stringify(normalize(value));
};

const defaultHashPayload = (value: unknown): string => {
  try {
    const payload = stableStringify(value);
    return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  } catch {
    return "unknown";
  }
};

const normalizeError = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const normalizeUsage = (value: unknown): RuntimeTokenUsage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const promptTokens = toNumber(
    obj.promptTokens ?? obj.prompt_tokens ?? obj.input_tokens,
  );
  const completionTokens = toNumber(
    obj.completionTokens ?? obj.completion_tokens ?? obj.output_tokens,
  );
  const totalTokens = toNumber(obj.totalTokens ?? obj.total_tokens ?? obj.total);
  const derivedTotal =
    totalTokens ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    derivedTotal === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: derivedTotal,
  };
};

const extractUsageFromResult = (result: unknown): RuntimeTokenUsage | undefined => {
  if (!result || typeof result !== "object") return undefined;
  const obj = result as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  const response = obj.response as Record<string, unknown> | undefined;
  return normalizeUsage(obj.usage) ?? normalizeUsage(data?.usage) ?? normalizeUsage(response?.usage);
};


const normalizeRuntimeClaimTier = (value: unknown): RuntimeClaimTier => {
  if (value === "reduced-order" || value === "certified") {
    return value;
  }
  return "diagnostic";
};

const normalizeRuntimeEnvelopeMetadata = (
  metadata: unknown,
): RuntimeResponseEnvelopeMetadata => {
  const source = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
  const claimTier = normalizeRuntimeClaimTier(source.claim_tier);
  const provenance =
    typeof source.provenance === "string" && source.provenance.trim().length > 0
      ? source.provenance.trim()
      : "diagnostic";
  const certifying = source.certifying === true;
  return {
    claim_tier: claimTier,
    provenance,
    certifying,
  };
};

const toCount = (value?: boolean | number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return value ? 1 : 0;
};

const resolveCostUsd = (input: {
  costUsd?: number;
  usage?: RuntimeTokenUsage;
  pricing?: ModelPricing;
}): number | undefined => {
  if (typeof input.costUsd === "number" && Number.isFinite(input.costUsd)) {
    return input.costUsd;
  }
  const usage = input.usage;
  const pricing = input.pricing;
  if (!usage || !pricing) return undefined;
  const promptTokens = usage.promptTokens;
  const completionTokens = usage.completionTokens;
  const totalTokens =
    usage.totalTokens ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);
  if (
    totalTokens !== undefined &&
    typeof pricing.per1kUsd === "number" &&
    Number.isFinite(pricing.per1kUsd)
  ) {
    return (totalTokens / 1000) * pricing.per1kUsd;
  }
  let cost = 0;
  let hasComponent = false;
  if (
    promptTokens !== undefined &&
    typeof pricing.inputPer1kUsd === "number" &&
    Number.isFinite(pricing.inputPer1kUsd)
  ) {
    cost += (promptTokens / 1000) * pricing.inputPer1kUsd;
    hasComponent = true;
  }
  if (
    completionTokens !== undefined &&
    typeof pricing.outputPer1kUsd === "number" &&
    Number.isFinite(pricing.outputPer1kUsd)
  ) {
    cost += (completionTokens / 1000) * pricing.outputPer1kUsd;
    hasComponent = true;
  }
  return hasComponent ? cost : undefined;
};

const resolveApprovalMissing = (
  policy: RuntimePolicyFlags | undefined,
  approval: RuntimeApproval | undefined,
  defaultRequired: boolean,
): number => {
  if (policy?.approvalMissing !== undefined) {
    return toCount(policy.approvalMissing);
  }
  const required = approval?.required ?? defaultRequired;
  if (!required) return 0;
  return approval?.granted ? 0 : 1;
};

const resolveProvenanceMissing = (
  policy: RuntimePolicyFlags | undefined,
  provenance: RuntimeProvenance | undefined,
  defaultRequired: boolean,
): number => {
  if (policy?.provenanceMissing !== undefined) {
    return toCount(policy.provenanceMissing);
  }
  const required = provenance?.required ?? defaultRequired;
  if (!required) return 0;
  const tags = provenance?.tags ?? [];
  return tags.length > 0 ? 0 : 1;
};

const resolveOptions = <TInput, TResult, TOptions>(
  options: TOptions | ((input: TInput, result?: TResult, error?: unknown) => TOptions),
  input: TInput,
  result: TResult | undefined,
  error: unknown,
): TOptions => {
  if (typeof options === "function") {
    return (options as (input: TInput, result?: TResult, error?: unknown) => TOptions)(
      input,
      result,
      error,
    );
  }
  return options;
};

export class RuntimeTelemetry {
  private events: RuntimeEvent[] = [];
  private seq = 0;
  private totals: Totals = {
    steps: 0,
    toolCalls: 0,
    costUsd: 0,
    forbidden: 0,
    approvalMissing: 0,
    provenanceMissing: 0,
  };
  private startMs: number;
  private endMs?: number;
  private firstStartMs?: number;
  private lastEndMs?: number;
  private clock: () => number;
  private hashPayload: (value: unknown) => string;
  private pricing: Record<string, ModelPricing>;
  private defaultApprovalRequired: boolean;
  private defaultProvenanceRequired: boolean;

  constructor(options: RuntimeTelemetryOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.hashPayload = options.hashPayload ?? defaultHashPayload;
    this.pricing = options.pricing ?? {};
    this.defaultApprovalRequired = options.defaultApprovalRequired ?? false;
    this.defaultProvenanceRequired = options.defaultProvenanceRequired ?? false;
    this.startMs = this.clock();
  }

  wrapTool<TInput, TResult>(
    tool: string,
    handler: (input: TInput) => Promise<TResult>,
    options: ToolCallOptionsInput<TInput, TResult> = {},
  ): (input: TInput) => Promise<TResult> {
    return async (input: TInput): Promise<TResult> => {
      const startedAtMs = this.clock();
      let result: TResult | undefined;
      let error: unknown;
      try {
        result = await handler(input);
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const endedAtMs = this.clock();
        const resolvedOptions = resolveOptions(
          options,
          input,
          result,
          error,
        );
        const paramsHash =
          resolvedOptions.paramsHash ?? this.safeHashPayload(input);
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

  wrapLlm<TInput, TResult>(
    model: string,
    handler: (input: TInput) => Promise<TResult>,
    options: LlmCallOptionsInput<TInput, TResult> = {},
  ): (input: TInput) => Promise<TResult> {
    return async (input: TInput): Promise<TResult> => {
      const startedAtMs = this.clock();
      let result: TResult | undefined;
      let error: unknown;
      try {
        result = await handler(input);
        return result;
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const endedAtMs = this.clock();
        const resolvedOptions = resolveOptions(
          options,
          input,
          result,
          error,
        );
        const paramsHash =
          resolvedOptions.paramsHash ?? this.safeHashPayload(input);
        const usage =
          normalizeUsage(resolvedOptions.usage) ??
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

  recordToolCall(input: {
    tool: string;
    params?: unknown;
    paramsHash?: string;
    durationMs?: number;
    ok?: boolean;
    error?: unknown;
    approval?: RuntimeApproval;
    provenance?: RuntimeProvenance;
    policy?: RuntimePolicyFlags;
    costUsd?: number;
    startedAtMs?: number;
    endedAtMs?: number;
  }): void {
    const startedAtMs = input.startedAtMs ?? this.clock();
    const endedAtMs =
      input.endedAtMs ?? startedAtMs + (input.durationMs ?? 0);
    this.recordToolEvent({
      tool: input.tool,
      paramsHash:
        input.paramsHash ?? this.safeHashPayload(input.params ?? null),
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

  recordLlmCall(input: {
    model: string;
    params?: unknown;
    paramsHash?: string;
    durationMs?: number;
    ok?: boolean;
    error?: unknown;
    approval?: RuntimeApproval;
    provenance?: RuntimeProvenance;
    policy?: RuntimePolicyFlags;
    costUsd?: number;
    usage?: RuntimeTokenUsage;
    pricing?: ModelPricing;
    startedAtMs?: number;
    endedAtMs?: number;
  }): void {
    const startedAtMs = input.startedAtMs ?? this.clock();
    const endedAtMs =
      input.endedAtMs ?? startedAtMs + (input.durationMs ?? 0);
    const costUsd =
      resolveCostUsd({
        costUsd: input.costUsd,
        usage: input.usage,
        pricing: input.pricing ?? this.pricing[input.model],
      }) ?? input.costUsd;
    this.recordLlmEvent({
      model: input.model,
      paramsHash:
        input.paramsHash ?? this.safeHashPayload(input.params ?? null),
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

  buildToolUseBudgetTelemetry(): ToolUseBudgetTelemetry {
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

  toToolTelemetryPayload(options?: {
    includeEvents?: boolean;
  }): { tool: ToolUseBudgetTelemetry; events?: RuntimeEvent[] } {
    const payload: { tool: ToolUseBudgetTelemetry; events?: RuntimeEvent[] } = {
      tool: this.buildToolUseBudgetTelemetry(),
    };
    if (options?.includeEvents) {
      payload.events = this.getEvents();
    }
    return payload;
  }

  toToolTelemetryJson(options?: {
    includeEvents?: boolean;
    pretty?: boolean;
  }): string {
    const payload = this.toToolTelemetryPayload({
      includeEvents: options?.includeEvents,
    });
    return JSON.stringify(payload, null, options?.pretty ? 2 : 0);
  }

  async writeToolTelemetry(
    filePath: string,
    options?: { includeEvents?: boolean; pretty?: boolean },
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${this.toToolTelemetryJson(options)}\n`, "utf8");
  }


  normalizeResponseEnvelopeMetadata(metadata?: unknown): RuntimeResponseEnvelopeMetadata {
    return normalizeRuntimeEnvelopeMetadata(metadata);
  }

  finalize(): void {
    this.endMs = this.clock();
  }

  reset(): void {
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

  getEvents(): RuntimeEvent[] {
    return [...this.events];
  }

  private safeHashPayload(value: unknown): string {
    try {
      return this.hashPayload(value);
    } catch {
      return "unknown";
    }
  }

  private recordToolEvent(input: Omit<RuntimeToolEvent, "seq" | "kind">): void {
    const event: RuntimeToolEvent = {
      seq: ++this.seq,
      kind: "tool",
      ...input,
    };
    this.pushEvent(event);
  }

  private recordLlmEvent(input: Omit<RuntimeLlmEvent, "seq" | "kind">): void {
    const event: RuntimeLlmEvent = {
      seq: ++this.seq,
      kind: "llm",
      ...input,
    };
    this.pushEvent(event);
  }

  private pushEvent(event: RuntimeEvent): void {
    this.events.push(event);
    this.totals.steps += 1;
    if (event.kind === "tool") {
      this.totals.toolCalls += 1;
    }
    if (typeof event.costUsd === "number" && Number.isFinite(event.costUsd)) {
      this.totals.costUsd += event.costUsd;
    }
    this.totals.forbidden += toCount(event.policy?.forbidden);
    this.totals.approvalMissing += resolveApprovalMissing(
      event.policy,
      event.approval,
      this.defaultApprovalRequired,
    );
    this.totals.provenanceMissing += resolveProvenanceMissing(
      event.policy,
      event.provenance,
      this.defaultProvenanceRequired,
    );
    this.firstStartMs =
      this.firstStartMs === undefined
        ? event.startedAtMs
        : Math.min(this.firstStartMs, event.startedAtMs);
    this.lastEndMs =
      this.lastEndMs === undefined
        ? event.endedAtMs
        : Math.max(this.lastEndMs, event.endedAtMs);
  }

  private resolveRuntimeMs(): number {
    const start = this.firstStartMs ?? this.startMs;
    const end = this.endMs ?? this.lastEndMs ?? this.clock();
    return Math.max(0, end - start);
  }
}

export const createRuntimeTelemetry = (
  options?: RuntimeTelemetryOptions,
): RuntimeTelemetry => new RuntimeTelemetry(options);
