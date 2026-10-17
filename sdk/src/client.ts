import type {
  AdapterRunRequest,
  AdapterRunResponse,
  NormalizedAdapterRuntimeEnvelopeMetadata,
  ConstraintPack,
  ConstraintPackEvaluateRequest,
  ConstraintPackEvaluateResponse,
  ConstraintPackPolicyProfile,
  ConstraintPackPolicyProfileInput,
  TrainingTraceRecord,
} from "./types.js";

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

const DEFAULT_BASE_URL = "http://localhost:5173";


const normalizeClaimTier = (
  value: unknown,
): NormalizedAdapterRuntimeEnvelopeMetadata["claim_tier"] => {
  if (value === "reduced-order" || value === "certified") {
    return value;
  }
  return "diagnostic";
};

const normalizeAdapterRuntimeEnvelopeMetadata = (
  value: unknown,
): NormalizedAdapterRuntimeEnvelopeMetadata => {
  const metadata =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    claim_tier: normalizeClaimTier(metadata.claim_tier),
    provenance:
      typeof metadata.provenance === "string" && metadata.provenance.trim().length > 0
        ? metadata.provenance.trim()
        : "diagnostic",
    certifying: metadata.certifying === true,
  };
};

const isHttpUrl = (value?: string): boolean =>
  typeof value === "string" && /^https?:\/\//i.test(value);

const normalizeBaseUrl = (input?: string): string => {
  if (!input) return DEFAULT_BASE_URL;
  if (!isHttpUrl(input)) {
    throw new Error(`baseUrl must be an absolute URL: ${input}`);
  }
  return input.replace(/\/+$/, "");
};

const joinUrl = (baseUrl: string, path: string): string => {
  if (isHttpUrl(path)) return path;
  if (!path.startsWith("/")) {
    return `${baseUrl}/${path}`;
  }
  return `${baseUrl}${path}`;
};

const normalizeToken = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
};

const mergeHeaders = (
  base: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> => ({
  ...base,
  ...(extra ?? {}),
});

const parseJson = async <T>(res: Response, url: string): Promise<T> => {
  const text = await res.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON from ${url}: ${message}`);
  }
};

export class CasimirError extends Error {
  status: number;
  url: string;
  body?: string;

  constructor(message: string, options: { status: number; url: string; body?: string }) {
    super(message);
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
  }
}

export class CasimirClient {
  private readonly baseUrl: string;
  private readonly adapterUrl: string;
  private readonly trainingTraceExportUrl: string;
  private readonly constraintPacksUrl: string;
  private readonly policyProfilesUrl: string;
  private readonly token?: string;
  private readonly tenantId?: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: CasimirClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.adapterUrl = joinUrl(
      this.baseUrl,
      options.adapterUrl ?? "/api/agi/adapter/run",
    );
    this.trainingTraceExportUrl = joinUrl(
      this.baseUrl,
      options.trainingTraceExportUrl ?? "/api/agi/training-trace/export",
    );
    this.constraintPacksUrl = joinUrl(
      this.baseUrl,
      options.constraintPacksUrl ?? "/api/agi/constraint-packs",
    );
    this.policyProfilesUrl = joinUrl(
      this.baseUrl,
      options.policyProfilesUrl ?? "/api/agi/constraint-packs/policies",
    );
    this.token = options.token ? normalizeToken(options.token) : undefined;
    this.tenantId = options.tenantId;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  private buildHeaders(options?: CasimirRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = normalizeToken(options?.token ?? this.token);
    const tenantId = options?.tenantId ?? this.tenantId;
    if (token) headers.Authorization = token;
    if (tenantId) headers["X-Tenant-Id"] = tenantId;
    if (options?.traceparent) headers.traceparent = options.traceparent;
    if (options?.tracestate) headers.tracestate = options.tracestate;
    return mergeHeaders(mergeHeaders(headers, this.headers), options?.headers);
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    options?: CasimirRequestOptions,
  ): Promise<T> {
    const headers = this.buildHeaders(options);
    if (body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new CasimirError(`Request failed: ${response.status} ${url}`, {
        status: response.status,
        url,
        body: text,
      });
    }
    return parseJson<T>(response, url);
  }


  normalizeRunAdapterResponse(
    response: AdapterRunResponse,
  ): AdapterRunResponse & { metadata: NormalizedAdapterRuntimeEnvelopeMetadata } {
    return {
      ...response,
      metadata: normalizeAdapterRuntimeEnvelopeMetadata(response.metadata),
    };
  }

  async runAdapter(
    payload: AdapterRunRequest,
    options?: CasimirRequestOptions,
  ): Promise<AdapterRunResponse & { metadata: NormalizedAdapterRuntimeEnvelopeMetadata }> {
    const response = await this.request<AdapterRunResponse>(
      "POST",
      this.adapterUrl,
      payload,
      options,
    );
    return this.normalizeRunAdapterResponse(response);
  }

  async exportTrainingTraceJsonl(
    options?: CasimirRequestOptions & { limit?: number; tenantId?: string },
  ): Promise<string> {
    const url = new URL(this.trainingTraceExportUrl);
    if (options?.limit) {
      url.searchParams.set("limit", String(options.limit));
    }
    const tenantId = options?.tenantId ?? this.tenantId;
    if (tenantId) {
      url.searchParams.set("tenantId", tenantId);
    }
    const headers = this.buildHeaders(options);
    headers.Accept = "application/x-ndjson";
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers,
      signal: options?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new CasimirError(`Request failed: ${response.status} ${url}`, {
        status: response.status,
        url: url.toString(),
        body: text,
      });
    }
    return response.text();
  }

  async exportTrainingTraces(
    options?: CasimirRequestOptions & { limit?: number; tenantId?: string },
  ): Promise<TrainingTraceRecord[]> {
    const jsonl = await this.exportTrainingTraceJsonl(options);
    const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as TrainingTraceRecord);
  }

  async listConstraintPacks(
    options?: CasimirRequestOptions,
  ): Promise<ConstraintPack[]> {
    const response = await this.request<{ packs: ConstraintPack[] }>(
      "GET",
      this.constraintPacksUrl,
      undefined,
      options,
    );
    return response.packs ?? [];
  }

  async getConstraintPack(
    id: string,
    options?: CasimirRequestOptions,
  ): Promise<ConstraintPack> {
    const url = joinUrl(this.constraintPacksUrl, `/${id}`);
    const response = await this.request<{ pack: ConstraintPack }>(
      "GET",
      url,
      undefined,
      options,
    );
    return response.pack;
  }

  async evaluateConstraintPack(
    id: string,
    payload: ConstraintPackEvaluateRequest,
    options?: CasimirRequestOptions,
  ): Promise<ConstraintPackEvaluateResponse> {
    const url = joinUrl(this.constraintPacksUrl, `/${id}/evaluate`);
    return this.request<ConstraintPackEvaluateResponse>("POST", url, payload, options);
  }

  async listPolicyProfiles(
    options?: CasimirRequestOptions & { customerId?: string; limit?: number },
  ): Promise<ConstraintPackPolicyProfile[]> {
    const url = new URL(this.policyProfilesUrl);
    const customerId = options?.customerId ?? this.tenantId;
    if (customerId) url.searchParams.set("customerId", customerId);
    if (options?.limit) url.searchParams.set("limit", String(options.limit));
    const response = await this.request<{ profiles: ConstraintPackPolicyProfile[] }>(
      "GET",
      url.toString(),
      undefined,
      options,
    );
    return response.profiles ?? [];
  }

  async createPolicyProfile(
    payload: ConstraintPackPolicyProfileInput,
    options?: CasimirRequestOptions,
  ): Promise<ConstraintPackPolicyProfile> {
    const response = await this.request<{ profile: ConstraintPackPolicyProfile }>(
      "POST",
      this.policyProfilesUrl,
      payload,
      options,
    );
    return response.profile;
  }
}

export const createCasimirClient = (options?: CasimirClientOptions): CasimirClient =>
  new CasimirClient(options);
