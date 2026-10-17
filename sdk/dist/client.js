const DEFAULT_BASE_URL = "http://localhost:5173";
const normalizeClaimTier = (value) => {
    if (value === "reduced-order" || value === "certified") {
        return value;
    }
    return "diagnostic";
};
const normalizeAdapterRuntimeEnvelopeMetadata = (value) => {
    const metadata = value && typeof value === "object" ? value : {};
    return {
        claim_tier: normalizeClaimTier(metadata.claim_tier),
        provenance: typeof metadata.provenance === "string" && metadata.provenance.trim().length > 0
            ? metadata.provenance.trim()
            : "diagnostic",
        certifying: metadata.certifying === true,
    };
};
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);
const normalizeBaseUrl = (input) => {
    if (!input)
        return DEFAULT_BASE_URL;
    if (!isHttpUrl(input)) {
        throw new Error(`baseUrl must be an absolute URL: ${input}`);
    }
    return input.replace(/\/+$/, "");
};
const joinUrl = (baseUrl, path) => {
    if (isHttpUrl(path))
        return path;
    if (!path.startsWith("/")) {
        return `${baseUrl}/${path}`;
    }
    return `${baseUrl}${path}`;
};
const normalizeToken = (value) => {
    if (!value)
        return undefined;
    return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
};
const mergeHeaders = (base, extra) => ({
    ...base,
    ...(extra ?? {}),
});
const parseJson = async (res, url) => {
    const text = await res.text();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse JSON from ${url}: ${message}`);
    }
};
export class CasimirError extends Error {
    constructor(message, options) {
        super(message);
        this.status = options.status;
        this.url = options.url;
        this.body = options.body;
    }
}
export class CasimirClient {
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.adapterUrl = joinUrl(this.baseUrl, options.adapterUrl ?? "/api/agi/adapter/run");
        this.trainingTraceExportUrl = joinUrl(this.baseUrl, options.trainingTraceExportUrl ?? "/api/agi/training-trace/export");
        this.constraintPacksUrl = joinUrl(this.baseUrl, options.constraintPacksUrl ?? "/api/agi/constraint-packs");
        this.policyProfilesUrl = joinUrl(this.baseUrl, options.policyProfilesUrl ?? "/api/agi/constraint-packs/policies");
        this.token = options.token ? normalizeToken(options.token) : undefined;
        this.tenantId = options.tenantId;
        this.headers = options.headers ?? {};
        this.fetchImpl = options.fetch ?? fetch;
    }
    buildHeaders(options) {
        const headers = {};
        const token = normalizeToken(options?.token ?? this.token);
        const tenantId = options?.tenantId ?? this.tenantId;
        if (token)
            headers.Authorization = token;
        if (tenantId)
            headers["X-Tenant-Id"] = tenantId;
        if (options?.traceparent)
            headers.traceparent = options.traceparent;
        if (options?.tracestate)
            headers.tracestate = options.tracestate;
        return mergeHeaders(mergeHeaders(headers, this.headers), options?.headers);
    }
    async request(method, url, body, options) {
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
        return parseJson(response, url);
    }
    normalizeRunAdapterResponse(response) {
        return {
            ...response,
            metadata: normalizeAdapterRuntimeEnvelopeMetadata(response.metadata),
        };
    }
    async runAdapter(payload, options) {
        const response = await this.request("POST", this.adapterUrl, payload, options);
        return this.normalizeRunAdapterResponse(response);
    }
    async exportTrainingTraceJsonl(options) {
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
    async exportTrainingTraces(options) {
        const jsonl = await this.exportTrainingTraceJsonl(options);
        const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return lines.map((line) => JSON.parse(line));
    }
    async listConstraintPacks(options) {
        const response = await this.request("GET", this.constraintPacksUrl, undefined, options);
        return response.packs ?? [];
    }
    async getConstraintPack(id, options) {
        const url = joinUrl(this.constraintPacksUrl, `/${id}`);
        const response = await this.request("GET", url, undefined, options);
        return response.pack;
    }
    async evaluateConstraintPack(id, payload, options) {
        const url = joinUrl(this.constraintPacksUrl, `/${id}/evaluate`);
        return this.request("POST", url, payload, options);
    }
    async listPolicyProfiles(options) {
        const url = new URL(this.policyProfilesUrl);
        const customerId = options?.customerId ?? this.tenantId;
        if (customerId)
            url.searchParams.set("customerId", customerId);
        if (options?.limit)
            url.searchParams.set("limit", String(options.limit));
        const response = await this.request("GET", url.toString(), undefined, options);
        return response.profiles ?? [];
    }
    async createPolicyProfile(payload, options) {
        const response = await this.request("POST", this.policyProfilesUrl, payload, options);
        return response.profile;
    }
}
export const createCasimirClient = (options) => new CasimirClient(options);
