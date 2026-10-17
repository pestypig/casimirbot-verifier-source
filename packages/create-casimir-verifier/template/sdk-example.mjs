import { createCasimirClient } from "shadow-of-intent-sdk";

const client = createCasimirClient({
  baseUrl:
    process.env.SHADOW_OF_INTENT_BASE_URL ||
    process.env.CASIMIR_PUBLIC_BASE_URL ||
    "http://localhost:5173",
  token: process.env.CASIMIR_TOKEN,
  tenantId: process.env.CASIMIR_TENANT,
});

const result = await client.runAdapter({
  traceId: "hello-verifier-sdk-001",
  mode: "constraint-pack",
  pack: {
    id: "repo-convergence",
    telemetry: {
      build: { status: 1 },
      tests: { status: 1 },
      schema: { contracts: 1 },
      deps: { coherence: 1 },
      timeToGreenMs: 120000,
    },
  },
});

const verdict = result.verdict ?? (result.pass ? "PASS" : "FAIL");
console.log("verdict:", verdict);
if (!result.pass) {
  console.log("firstFail:", result.firstFail);
}
