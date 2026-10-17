# Shadow of Intent SDK

Thin client for the Shadow of Intent verification API (adapter runs, traces, and
constraint packs). Requires Node 18+ or a runtime that provides `fetch`.

Install (once published)
```
npm install shadow-of-intent-sdk
```

Basic usage
```ts
import { createCasimirClient } from "shadow-of-intent-sdk";

const client = createCasimirClient({
  baseUrl: "http://localhost:5173",
  tenantId: "acme",
});

const result = await client.runAdapter({
  traceId: "client-run-001",
  actions: [
    { id: "a1", label: "reduce duty", params: { dutyEffectiveFR: 0.0025 } },
  ],
  budget: { maxIterations: 1, maxTotalMs: 60000 },
});

if (!result.pass) {
  console.error("First failing constraint:", result.firstFail);
}

const traces = await client.exportTrainingTraces({ limit: 50 });
console.log(traces.length);
```

Runtime telemetry (drop-in)
```ts
import { createRuntimeTelemetry } from "shadow-of-intent-sdk";

const runtime = createRuntimeTelemetry({
  pricing: {
    "gpt-4o-mini": { inputPer1kUsd: 0.00015, outputPer1kUsd: 0.0006 },
  },
});

const search = runtime.wrapTool(
  "search.web",
  async (input: { query: string }) => {
    return { results: [] };
  },
  {
    approval: { required: true, granted: true },
    provenance: { required: true, tags: ["web"] },
  },
);

const callModel = runtime.wrapLlm(
  "gpt-4o-mini",
  async (input: { prompt: string }) => {
    return someLlmClient.responses.create({
      model: "gpt-4o-mini",
      input: input.prompt,
    });
  },
);

await search({ query: "warp constraints" });
await callModel({ prompt: "Summarize." });

const telemetry = runtime.buildToolUseBudgetTelemetry();
await runtime.writeToolTelemetry("reports/tool-telemetry.json", {
  includeEvents: true,
  pretty: true,
});
```

Notes:
- `buildToolUseBudgetTelemetry()` returns the fields required by the
  `tool-use-budget` pack.
- The JSON file produced by `writeToolTelemetry()` can be used with
  `shadow-of-intent verify` (default pack) or pointed to via
  `CASIMIR_TOOL_TELEMETRY_PATH`.

Defaults
- If `baseUrl` is omitted, the client targets `http://localhost:5173`.
- Map `CASIMIR_PUBLIC_BASE_URL` or `SHADOW_OF_INTENT_BASE_URL` to `baseUrl` when using a hosted endpoint.

Hello verifier example
- See `examples/hello-verifier` for a minimal CLI + SDK demo.

Constraint packs
```ts
const packs = await client.listConstraintPacks();
const evaluation = await client.evaluateConstraintPack("repo-convergence", {
  traceId: "ci:run-1",
  telemetry: {
    build: { status: "pass", durationMs: 420000 },
    tests: { failed: 0, total: 128 },
    schema: { contracts: true },
    deps: { coherence: true },
    timeToGreenMs: 480000,
    lint: { status: true },
    typecheck: { status: true },
  },
});
```

Auth + tenant isolation
- Provide `token` and `tenantId` in the client options.
- The SDK sets `Authorization: Bearer ...` and `X-Tenant-Id` headers.

Source layout
- `sdk/src/index.ts` re-exports the public SDK surface.
- `sdk/src/client.ts` implements the HTTP client and adapter calls.
- `sdk/src/runtime.ts` hosts the runtime telemetry helpers.
- `sdk/src/types.ts` defines SDK request/response types.
- `sdk/tsconfig.json` and `sdk/package.json` configure build + packaging.

Build
```
cd sdk
npm install
npm run build
```
