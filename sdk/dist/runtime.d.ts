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
type ToolCallOptionsInput<TInput, TResult> = ToolCallOptions | ((input: TInput, result?: TResult, error?: unknown) => ToolCallOptions);
type LlmCallOptionsInput<TInput, TResult> = LlmCallOptions | ((input: TInput, result?: TResult, error?: unknown) => LlmCallOptions);
export declare class RuntimeTelemetry {
    private events;
    private seq;
    private totals;
    private startMs;
    private endMs?;
    private firstStartMs?;
    private lastEndMs?;
    private clock;
    private hashPayload;
    private pricing;
    private defaultApprovalRequired;
    private defaultProvenanceRequired;
    constructor(options?: RuntimeTelemetryOptions);
    wrapTool<TInput, TResult>(tool: string, handler: (input: TInput) => Promise<TResult>, options?: ToolCallOptionsInput<TInput, TResult>): (input: TInput) => Promise<TResult>;
    wrapLlm<TInput, TResult>(model: string, handler: (input: TInput) => Promise<TResult>, options?: LlmCallOptionsInput<TInput, TResult>): (input: TInput) => Promise<TResult>;
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
    }): void;
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
    }): void;
    buildToolUseBudgetTelemetry(): ToolUseBudgetTelemetry;
    toToolTelemetryPayload(options?: {
        includeEvents?: boolean;
    }): {
        tool: ToolUseBudgetTelemetry;
        events?: RuntimeEvent[];
    };
    toToolTelemetryJson(options?: {
        includeEvents?: boolean;
        pretty?: boolean;
    }): string;
    writeToolTelemetry(filePath: string, options?: {
        includeEvents?: boolean;
        pretty?: boolean;
    }): Promise<void>;
    normalizeResponseEnvelopeMetadata(metadata?: unknown): RuntimeResponseEnvelopeMetadata;
    finalize(): void;
    reset(): void;
    getEvents(): RuntimeEvent[];
    private safeHashPayload;
    private recordToolEvent;
    private recordLlmEvent;
    private pushEvent;
    private resolveRuntimeMs;
}
export declare const createRuntimeTelemetry: (options?: RuntimeTelemetryOptions) => RuntimeTelemetry;
export {};
//# sourceMappingURL=runtime.d.ts.map