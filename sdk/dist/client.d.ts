import type { AdapterRunRequest, AdapterRunResponse, NormalizedAdapterRuntimeEnvelopeMetadata, ConstraintPack, ConstraintPackEvaluateRequest, ConstraintPackEvaluateResponse, ConstraintPackPolicyProfile, ConstraintPackPolicyProfileInput, TrainingTraceRecord } from "./types.js";
export type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
export type CasimirRequestOptions = {
    token?: string;
    tenantId?: string;
    headers?: Record<string, string>;
    traceparent?: string;
    tracestate?: string;
    signal?: AbortSignal;
};
export type CasimirClientOptions = {
    baseUrl?: string;
    adapterUrl?: string;
    trainingTraceExportUrl?: string;
    constraintPacksUrl?: string;
    policyProfilesUrl?: string;
    token?: string;
    tenantId?: string;
    headers?: Record<string, string>;
    fetch?: FetchLike;
};
export declare class CasimirError extends Error {
    status: number;
    url: string;
    body?: string;
    constructor(message: string, options: {
        status: number;
        url: string;
        body?: string;
    });
}
export declare class CasimirClient {
    private readonly baseUrl;
    private readonly adapterUrl;
    private readonly trainingTraceExportUrl;
    private readonly constraintPacksUrl;
    private readonly policyProfilesUrl;
    private readonly token?;
    private readonly tenantId?;
    private readonly headers;
    private readonly fetchImpl;
    constructor(options?: CasimirClientOptions);
    private buildHeaders;
    private request;
    normalizeRunAdapterResponse(response: AdapterRunResponse): AdapterRunResponse & {
        metadata: NormalizedAdapterRuntimeEnvelopeMetadata;
    };
    runAdapter(payload: AdapterRunRequest, options?: CasimirRequestOptions): Promise<AdapterRunResponse & {
        metadata: NormalizedAdapterRuntimeEnvelopeMetadata;
    }>;
    exportTrainingTraceJsonl(options?: CasimirRequestOptions & {
        limit?: number;
        tenantId?: string;
    }): Promise<string>;
    exportTrainingTraces(options?: CasimirRequestOptions & {
        limit?: number;
        tenantId?: string;
    }): Promise<TrainingTraceRecord[]>;
    listConstraintPacks(options?: CasimirRequestOptions): Promise<ConstraintPack[]>;
    getConstraintPack(id: string, options?: CasimirRequestOptions): Promise<ConstraintPack>;
    evaluateConstraintPack(id: string, payload: ConstraintPackEvaluateRequest, options?: CasimirRequestOptions): Promise<ConstraintPackEvaluateResponse>;
    listPolicyProfiles(options?: CasimirRequestOptions & {
        customerId?: string;
        limit?: number;
    }): Promise<ConstraintPackPolicyProfile[]>;
    createPolicyProfile(payload: ConstraintPackPolicyProfileInput, options?: CasimirRequestOptions): Promise<ConstraintPackPolicyProfile>;
}
export declare const createCasimirClient: (options?: CasimirClientOptions) => CasimirClient;
//# sourceMappingURL=client.d.ts.map