#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type AdapterAction = {
  id?: string;
  kind?: string;
  label?: string;
  params?: Record<string, unknown>;
  note?: string;
};

type AdapterBudget = {
  maxIterations?: number;
  maxTotalMs?: number;
  maxAttemptMs?: number;
};

type AdapterPolicy = {
  thresholds?: Record<string, number>;
  gate?: {
    mode?: "hard-only" | "all" | string;
    unknownAsFail?: boolean;
    minLadderTier?: "diagnostic" | "reduced-order" | "certified";
  };
};

type AdapterConstraintPack = {
  id: string;
  customerId?: string;
  policyProfileId?: string;
  policyOverride?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
  metrics?: Record<string, number | boolean | string | null>;
  certificate?: {
    status?: string;
    certificateHash?: string | null;
    certificateId?: string | null;
    integrityOk?: boolean;
  };
  deltas?: TrainingTraceDelta[];
  notes?: string[];
  proxy?: boolean;
  ladderTier?: "diagnostic" | "reduced-order" | "certified";
  autoTelemetry?: boolean;
  telemetryPath?: string;
  junitPath?: string;
  vitestPath?: string;
  jestPath?: string;
  eslintPath?: string;
  tscPath?: string;
  toolLogTraceId?: string;
  toolLogWindowMs?: number;
  toolLogLimit?: number;
};

type AdapterRunRequest = {
  traceId?: string;
  mode?: "gr" | "constraint-pack";
  pack?: AdapterConstraintPack;
  actions?: AdapterAction[];
  budget?: AdapterBudget;
  policy?: AdapterPolicy;
};

type TrainingTraceConstraint = {
  id: string;
  severity?: string;
  status?: string;
  value?: number | null;
  limit?: string | null;
  note?: string;
};

type TrainingTraceDelta = {
  key: string;
  from?: number | null;
  to?: number | null;
  delta?: number;
  unit?: string;
  change?: "added" | "removed" | "changed";
};

type TrainingTraceCertificate = {
  status?: string;
  certificateHash: string | null;
  certificateId?: string | null;
  integrityOk?: boolean;
};

type PolicyLadderTier = "diagnostic" | "reduced-order" | "certified";

type TrainingTraceSignal = {
  kind: string;
  proxy?: boolean;
  ladder: {
    tier: PolicyLadderTier;
    policy: string;
    policyVersion: string;
  };
};

type TrainingTraceSource = {
  system?: string;
  component?: string;
  tool?: string;
  version?: string;
};

type TrainingTraceMetrics = Record<string, number | boolean | string | null>;

type TrainingTraceRecord = {
  kind: "training-trace";
  version: number;
  id: string;
  seq: number;
  ts: string;
  traceId?: string;
  tenantId?: string;
  source?: TrainingTraceSource;
  signal?: TrainingTraceSignal;
  pass: boolean;
  deltas: TrainingTraceDelta[];
  metrics?: TrainingTraceMetrics;
  firstFail?: TrainingTraceConstraint;
  certificate?: TrainingTraceCertificate;
  notes?: string[];
};

type ConstraintPackConstraint = {
  id: string;
  severity?: string;
  description?: string;
  metric?: string;
  op?: string;
  limit?: number;
  min?: number;
  max?: number;
  units?: string;
  source?: string;
  proxy?: boolean;
  note?: string;
};

type ConstraintPackPolicy = {
  mode?: "hard-only" | "all" | string;
  unknownAsFail?: boolean;
  minLadderTier?: PolicyLadderTier;
};

type ConstraintPackCertificatePolicy = {
  issuer?: string;
  admissibleStatus: string;
  allowMarginalAsViable?: boolean;
  treatMissingCertificateAsNotCertified?: boolean;
};

type ConstraintPackSignalKinds = {
  diagnostic: string;
  certified: string;
};

type ConstraintPack = {
  id: string;
  domain?: string;
  version: number;
  description?: string;
  signalKinds: ConstraintPackSignalKinds;
  policy: ConstraintPackPolicy;
  certificate: ConstraintPackCertificatePolicy;
  constraints: ConstraintPackConstraint[];
  proxies?: ConstraintPackConstraint[];
};

type ConstraintPackConstraintOverride = Partial<ConstraintPackConstraint> & {
  id: string;
};

type ConstraintPackOverride = {
  packId?: string;
  policy?: Partial<ConstraintPackPolicy>;
  certificate?: Partial<ConstraintPackCertificatePolicy>;
  constraints?: ConstraintPackConstraintOverride[];
  proxies?: ConstraintPackConstraintOverride[];
};

type ConstraintPackConstraintResult = Omit<ConstraintPackConstraint, "limit"> & {
  status?: "pass" | "fail" | "unknown";
  value?: number | null;
  limit?: string | null;
  proxy?: boolean;
  note?: string;
};

type ConstraintPackCertificateResult = {
  status?: string;
  certificateHash?: string | null;
  certificateId?: string | null;
  integrityOk?: boolean;
};

type ConstraintPackEvaluation = {
  pass: boolean;
  constraints: ConstraintPackConstraintResult[];
  certificate?: ConstraintPackCertificateResult;
  deltas?: TrainingTraceDelta[];
  notes?: string[];
  firstFail?: ConstraintPackConstraintResult;
  proxy?: boolean;
  ladderTier?: PolicyLadderTier;
};

type AdapterArtifactRef = {
  kind: string;
  ref: string;
  label?: string;
};

type AdapterRunResponse = {
  traceId?: string;
  runId?: string;
  verdict?: "PASS" | "FAIL" | string;
  pass?: boolean;
  firstFail?: TrainingTraceConstraint | null;
  deltas?: TrainingTraceDelta[];
  certificate?: TrainingTraceCertificate | null;
  artifacts?: AdapterArtifactRef[];
};

type ParsedArgs = {
  jsonPath?: string;
  rawJson?: string;
  url?: string;
  exportUrl?: string;
  traceOut?: string;
  traceLimit?: number;
  token?: string;
  tenant?: string;
  traceparent?: string;
  tracestate?: string;
  traceId?: string;
  packId?: string;
  autoTelemetry?: boolean;
  ci?: boolean;
  quiet?: boolean;
  help?: boolean;
};

export const isCertifyingLane = (args: ParsedArgs): boolean =>
  args.ci === true || process.env.CASIMIR_CERTIFY === "1";

type MetricValue = number | boolean | string | null | undefined;

type RepoConvergenceTelemetry = {
  build?: {
    status?: MetricValue;
    ok?: MetricValue;
    exitCode?: number;
    durationMs?: number;
  };
  tests?: {
    status?: MetricValue;
    ok?: MetricValue;
    failed?: number;
    passed?: number;
    total?: number;
  };
  schema?: {
    contracts?: MetricValue;
    ok?: MetricValue;
  };
  deps?: {
    coherence?: MetricValue;
  };
  timeToGreenMs?: number;
  lint?: {
    status?: MetricValue;
  };
  typecheck?: {
    status?: MetricValue;
  };
  metrics?: Record<string, MetricValue>;
};

type ToolUseBudgetTelemetry = {
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

type AuditSafetyTelemetry = {
  audit?: {
    files?: {
      total?: number;
      tagged?: number;
      untagged?: number;
    };
    tags?: {
      unknown?: number;
    };
    violations?: {
      count?: number;
    };
    risk?: {
      files?: number;
    };
    provenance?: {
      files?: number;
      coverage?: number;
    };
    safety?: {
      files?: number;
      coverage?: number;
    };
    critical?: {
      files?: number;
    };
  };
  metrics?: Record<string, MetricValue>;
};

type LocalTelemetryResult<T> = {
  telemetry?: T;
  notes: string[];
};

const DEFAULT_TRACE_OUT = "training-trace.jsonl";
const DEFAULT_TRACE_LIMIT = 50;
const DEFAULT_REPORTS_DIR =
  process.env.CASIMIR_REPORTS_DIR ?? process.env.CI_REPORTS_DIR ?? "reports";

const USAGE =
  "Usage: shadow-of-intent verify [--json request.json] [--params '{...}'] " +
  "[--pack repo-convergence|tool-use-budget] [--auto-telemetry|--no-auto-telemetry] [--ci] " +
  "[--trace-id <id>] [--url https://host/api/agi/adapter/run] [--export-url https://host/api/agi/training-trace/export] " +
  `[--trace-out ${DEFAULT_TRACE_OUT}|-] [--trace-limit ${DEFAULT_TRACE_LIMIT}] ` +
  "[--token <jwt>] [--tenant <id>] [--quiet]\n" +
  "Local mode runs when no --url or CASIMIR_PUBLIC_BASE_URL is set. " +
  "Defaults to the tool-use-budget pack when no payload is provided.";

const isHttpUrl = (value?: string): boolean =>
  typeof value === "string" && /^https?:\/\//i.test(value);

const normalizePathCandidate = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolvePath = (envKeys: string[], fallback: string): string => {
  const candidate =
    envKeys
      .map((key) => normalizePathCandidate(process.env[key]))
      .find((value) => value !== undefined) ?? fallback;
  return path.resolve(process.cwd(), candidate);
};

const resolvePathOverride = (
  explicit: string | undefined,
  envKeys: string[],
  fallback: string,
): string => {
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }
  return resolvePath(envKeys, fallback);
};

const parseReportMaxBytes = (): number => {
  const requested = Number(
    process.env.CASIMIR_REPORT_MAX_BYTES ??
      process.env.CASIMIR_REPORTS_MAX_BYTES,
  );
  if (!Number.isFinite(requested) || requested < 1) {
    return 25000000;
  }
  return Math.min(Math.max(10240, Math.floor(requested)), 200000000);
};

const REPORT_MAX_BYTES = parseReportMaxBytes();

const readFileIfSmall = async (filePath: string): Promise<string | null> => {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > REPORT_MAX_BYTES) {
      console.warn(
        `[shadow-of-intent] report too large (${stat.size} bytes), skipping ${filePath}`,
      );
      return null;
    }
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
};

const readJsonIfExists = async (filePath: string): Promise<unknown | null> => { 
  try {
    const raw = await readFileIfSmall(filePath);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readTextIfExists = async (filePath: string): Promise<string | null> => {  
  return readFileIfSmall(filePath);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const toBooleanMetric = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "pass", "ok", "success"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "fail", "failed", "error"].includes(lowered)) {
      return false;
    }
  }
  return undefined;
};

type TestCounts = {
  total?: number;
  failed?: number;
  passed?: number;
  skipped?: number;
  status?: "pass" | "fail";
};

const countAssertionResults = (value: unknown): TestCounts | null => {
  if (!Array.isArray(value)) return null;
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const assertions = obj.assertionResults;
    if (!Array.isArray(assertions)) continue;
    for (const assertion of assertions) {
      if (!assertion || typeof assertion !== "object") continue;
      const status = (assertion as Record<string, unknown>).status;
      if (typeof status !== "string") continue;
      const lowered = status.toLowerCase();
      if (["passed", "pass", "success"].includes(lowered)) {
        passed += 1;
        total += 1;
      } else if (["failed", "fail", "error"].includes(lowered)) {
        failed += 1;
        total += 1;
      } else if (
        ["skipped", "pending", "todo", "disabled"].includes(lowered)
      ) {
        skipped += 1;
        total += 1;
      }
    }
  }
  if (total === 0) return null;
  return { total, passed, failed, skipped };
};

const parseTestJsonSummary = (value: unknown): TestCounts | null => {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  let total =
    toNumber(obj.numTotalTests) ??
    toNumber(obj.totalTests) ??
    toNumber(obj.total) ??
    toNumber(obj.tests);
  let failed =
    toNumber(obj.numFailedTests) ??
    toNumber(obj.failedTests) ??
    toNumber(obj.failures) ??
    toNumber(obj.failed);
  let passed =
    toNumber(obj.numPassedTests) ??
    toNumber(obj.passedTests) ??
    toNumber(obj.passed);
  let skipped =
    toNumber(obj.numPendingTests) ??
    toNumber(obj.numSkippedTests) ??
    toNumber(obj.skippedTests) ??
    toNumber(obj.pending) ??
    toNumber(obj.skipped);
  const statusMetric = toBooleanMetric(obj.success ?? obj.ok ?? obj.status);

  if (total === undefined) {
    const assertionCounts = countAssertionResults(obj.testResults);
    if (assertionCounts) {
      total = assertionCounts.total;
      passed = passed ?? assertionCounts.passed;
      failed = failed ?? assertionCounts.failed;
      skipped = skipped ?? assertionCounts.skipped;
    }
  }

  if (total === undefined) {
    if (passed !== undefined || failed !== undefined || skipped !== undefined) {
      total = (passed ?? 0) + (failed ?? 0) + (skipped ?? 0);
    }
  }

  if (passed === undefined && total !== undefined && failed !== undefined) {
    passed = Math.max(0, total - failed - (skipped ?? 0));
  }

  const status =
    failed !== undefined && total !== undefined
      ? failed > 0
        ? "fail"
        : "pass"
      : statusMetric !== undefined
        ? statusMetric
          ? "pass"
          : "fail"
        : undefined;

  if (
    total === undefined &&
    failed === undefined &&
    passed === undefined &&
    skipped === undefined &&
    status === undefined
  ) {
    return null;
  }
  return { total, failed, passed, skipped, status };
};

const parseEslintSummary = (
  value: unknown,
): { errors: number; fatalErrors: number; warnings: number } | null => {
  const results = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { results?: unknown[] }).results)
      ? (value as { results: unknown[] }).results
      : null;
  if (!results) return null;
  let errors = 0;
  let fatalErrors = 0;
  let warnings = 0;
  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    errors += toNumber(obj.errorCount) ?? 0;
    fatalErrors += toNumber(obj.fatalErrorCount) ?? 0;
    warnings += toNumber(obj.warningCount) ?? 0;
  }
  return { errors, fatalErrors, warnings };
};

const parseTscStatus = (raw: string): "pass" | "fail" | undefined => {
  const foundMatch = raw.match(/Found\s+(\d+)\s+errors?/i);
  if (foundMatch) {
    const count = Number(foundMatch[1]);
    if (Number.isFinite(count)) {
      return count > 0 ? "fail" : "pass";
    }
  }
  if (/Found\s+0\s+errors?/i.test(raw)) return "pass";
  if (/error\s+TS\d+/i.test(raw) || /\bTS\d+:/i.test(raw)) return "fail";
  return undefined;
};

const parseMetricMap = (
  raw?: Record<string, unknown>,
): Record<string, MetricValue> | undefined => {
  if (!raw) return undefined;
  const out: Record<string, MetricValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "string" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const mergeRepoTelemetry = (
  base?: RepoConvergenceTelemetry,
  override?: RepoConvergenceTelemetry,
): RepoConvergenceTelemetry | undefined => {
  if (!base && !override) return undefined;
  const merged: RepoConvergenceTelemetry = {
    ...(base ?? {}),
    ...(override ?? {}),
  };
  if (base?.build || override?.build) {
    merged.build = { ...(base?.build ?? {}), ...(override?.build ?? {}) };
  }
  if (base?.tests || override?.tests) {
    merged.tests = { ...(base?.tests ?? {}), ...(override?.tests ?? {}) };
  }
  if (base?.schema || override?.schema) {
    merged.schema = { ...(base?.schema ?? {}), ...(override?.schema ?? {}) };
  }
  if (base?.deps || override?.deps) {
    merged.deps = { ...(base?.deps ?? {}), ...(override?.deps ?? {}) };
  }
  if (base?.lint || override?.lint) {
    merged.lint = { ...(base?.lint ?? {}), ...(override?.lint ?? {}) };
  }
  if (base?.typecheck || override?.typecheck) {
    merged.typecheck = {
      ...(base?.typecheck ?? {}),
      ...(override?.typecheck ?? {}),
    };
  }
  if (base?.metrics || override?.metrics) {
    merged.metrics = { ...(base?.metrics ?? {}), ...(override?.metrics ?? {}) };
  }
  return merged;
};

const mergeToolTelemetry = (
  base?: ToolUseBudgetTelemetry,
  override?: ToolUseBudgetTelemetry,
): ToolUseBudgetTelemetry | undefined => {
  if (!base && !override) return undefined;
  const merged: ToolUseBudgetTelemetry = {
    ...(base ?? {}),
    ...(override ?? {}),
  };
  if (base?.steps || override?.steps) {
    merged.steps = { ...(base?.steps ?? {}), ...(override?.steps ?? {}) };
  }
  if (base?.cost || override?.cost) {
    merged.cost = { ...(base?.cost ?? {}), ...(override?.cost ?? {}) };
  }
  if (base?.ops || override?.ops) {
    merged.ops = { ...(base?.ops ?? {}), ...(override?.ops ?? {}) };
  }
  if (base?.provenance || override?.provenance) {
    merged.provenance = {
      ...(base?.provenance ?? {}),
      ...(override?.provenance ?? {}),
    };
  }
  if (base?.runtime || override?.runtime) {
    merged.runtime = { ...(base?.runtime ?? {}), ...(override?.runtime ?? {}) };
  }
  if (base?.tools || override?.tools) {
    merged.tools = { ...(base?.tools ?? {}), ...(override?.tools ?? {}) };
  }
  if (base?.metrics || override?.metrics) {
    merged.metrics = { ...(base?.metrics ?? {}), ...(override?.metrics ?? {}) };
  }
  return merged;
};

const hasTelemetryFields = (telemetry?: Record<string, unknown>): boolean => {
  if (!telemetry) return false;
  return Object.keys(telemetry).length > 0;
};

const buildRepoTelemetryFromEnv = (): RepoConvergenceTelemetry => {
  const env = process.env;
  const buildStatus = env.CASIMIR_BUILD_STATUS ?? env.CASIMIR_BUILD_OK;
  const buildExitCode = toNumber(env.CASIMIR_BUILD_EXIT_CODE);
  const buildDuration = toNumber(env.CASIMIR_BUILD_DURATION_MS);

  const testStatus = env.CASIMIR_TEST_STATUS ?? env.CASIMIR_TEST_OK;
  const testsFailed = toNumber(env.CASIMIR_TEST_FAILED);
  const testsPassed = toNumber(env.CASIMIR_TEST_PASSED);
  const testsTotal = toNumber(env.CASIMIR_TEST_TOTAL);

  const schemaContracts =
    env.CASIMIR_SCHEMA_CONTRACTS ?? env.CASIMIR_SCHEMA_OK;
  const depsCoherence = env.CASIMIR_DEPS_COHERENCE;

  const lintStatus = env.CASIMIR_LINT_STATUS;
  const typecheckStatus = env.CASIMIR_TYPECHECK_STATUS;
  const timeToGreenMs = toNumber(env.CASIMIR_TIME_TO_GREEN_MS);

  const metrics = (() => {
    const raw = env.CASIMIR_REPO_METRICS_JSON;
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  })();

  const telemetry: RepoConvergenceTelemetry = {};
  if (
    buildStatus !== undefined ||
    buildExitCode !== undefined ||
    buildDuration !== undefined
  ) {
    telemetry.build = {
      status: buildStatus,
      ok: toBooleanMetric(buildStatus),
      exitCode: buildExitCode,
      durationMs: buildDuration,
    };
  }
  if (
    testStatus !== undefined ||
    testsFailed !== undefined ||
    testsPassed !== undefined ||
    testsTotal !== undefined
  ) {
    telemetry.tests = {
      status: testStatus,
      ok: toBooleanMetric(testStatus),
      failed: testsFailed,
      passed: testsPassed,
      total: testsTotal,
    };
  }
  if (schemaContracts !== undefined) {
    telemetry.schema = {
      contracts: schemaContracts,
      ok: toBooleanMetric(schemaContracts),
    };
  }
  if (depsCoherence !== undefined) {
    telemetry.deps = {
      coherence: depsCoherence,
    };
  }
  if (lintStatus !== undefined) {
    telemetry.lint = { status: lintStatus };
  }
  if (typecheckStatus !== undefined) {
    telemetry.typecheck = { status: typecheckStatus };
  }
  if (timeToGreenMs !== undefined) {
    telemetry.timeToGreenMs = timeToGreenMs;
  }
  if (metrics) {
    telemetry.metrics = parseMetricMap(metrics);
  }
  return telemetry;
};

const buildToolTelemetryFromEnv = (): ToolUseBudgetTelemetry => {
  const env = process.env;
  const stepsUsed = toNumber(env.CASIMIR_STEPS_USED);
  const stepsTotal = toNumber(env.CASIMIR_STEPS_TOTAL);
  const costUsd = toNumber(env.CASIMIR_COST_USD);
  const forbiddenOps = toNumber(env.CASIMIR_OPS_FORBIDDEN);
  const approvalMissing = toNumber(env.CASIMIR_OPS_APPROVAL_MISSING);
  const provenanceMissing = toNumber(env.CASIMIR_PROVENANCE_MISSING);
  const runtimeMs = toNumber(env.CASIMIR_RUNTIME_MS);
  const toolCalls = toNumber(env.CASIMIR_TOOL_CALLS);
  const toolTotal = toNumber(env.CASIMIR_TOOL_TOTAL);
  const metrics = (() => {
    const raw = env.CASIMIR_TOOL_METRICS_JSON;
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  })();

  const telemetry: ToolUseBudgetTelemetry = {};
  if (stepsUsed !== undefined || stepsTotal !== undefined) {
    telemetry.steps = { used: stepsUsed, total: stepsTotal };
  }
  if (costUsd !== undefined) {
    telemetry.cost = { usd: costUsd };
  }
  if (forbiddenOps !== undefined || approvalMissing !== undefined) {
    telemetry.ops = {
      forbidden: forbiddenOps,
      approvalMissing,
    };
  }
  if (provenanceMissing !== undefined) {
    telemetry.provenance = { missing: provenanceMissing };
  }
  if (runtimeMs !== undefined) {
    telemetry.runtime = { ms: runtimeMs };
  }
  if (toolCalls !== undefined || toolTotal !== undefined) {
    telemetry.tools = { calls: toolCalls, total: toolTotal };
  }
  if (metrics) {
    telemetry.metrics = parseMetricMap(metrics);
  }
  return telemetry;
};

const parseRepoTelemetryJson = (
  value: Record<string, unknown>,
): RepoConvergenceTelemetry => {
  if (value.repo && typeof value.repo === "object") {
    return value.repo as RepoConvergenceTelemetry;
  }
  return value as RepoConvergenceTelemetry;
};

const parseToolTelemetryJson = (
  value: Record<string, unknown>,
): ToolUseBudgetTelemetry => {
  if (value.tool && typeof value.tool === "object") {
    return value.tool as ToolUseBudgetTelemetry;
  }
  return value as ToolUseBudgetTelemetry;
};

const buildRepoTelemetryFromReports = async (
  vitestPath: string,
  eslintPath: string,
  tscPath: string,
): Promise<LocalTelemetryResult<RepoConvergenceTelemetry>> => {
  const notes: string[] = [];
  const telemetry: RepoConvergenceTelemetry = {};

  const vitestRaw = await readJsonIfExists(vitestPath);
  const counts = parseTestJsonSummary(vitestRaw);
  if (counts) {
    telemetry.tests = {
      total: counts.total,
      failed: counts.failed,
      passed: counts.passed,
      status: counts.status,
    };
    notes.push(
      `telemetry_source=vitest:${path.relative(process.cwd(), vitestPath)}`,
    );
  }

  const eslintRaw = await readJsonIfExists(eslintPath);
  const eslintTotals = parseEslintSummary(eslintRaw);
  if (eslintTotals) {
    telemetry.lint = {
      status:
        eslintTotals.errors + eslintTotals.fatalErrors > 0 ? "fail" : "pass",
    };
    notes.push(
      `telemetry_source=eslint:${path.relative(process.cwd(), eslintPath)}`,
    );
  }

  const tscRaw = await readTextIfExists(tscPath);
  if (tscRaw) {
    const status = parseTscStatus(tscRaw);
    if (status) {
      telemetry.typecheck = { status };
      notes.push(
        `telemetry_source=tsc:${path.relative(process.cwd(), tscPath)}`,
      );
    }
  }

  return {
    telemetry: hasTelemetryFields(telemetry) ? telemetry : undefined,
    notes,
  };
};

const collectRepoConvergenceTelemetry = async (options?: {
  telemetryPath?: string;
  vitestPath?: string;
  eslintPath?: string;
  tscPath?: string;
}): Promise<LocalTelemetryResult<RepoConvergenceTelemetry>> => {
  const notes: string[] = [];
  let telemetry: RepoConvergenceTelemetry | undefined;

  const repoTelemetryPath = resolvePathOverride(
    options?.telemetryPath,
    ["CASIMIR_REPO_TELEMETRY_PATH", "CASIMIR_TELEMETRY_PATH"],
    path.join(DEFAULT_REPORTS_DIR, "repo-telemetry.json"),
  );
  const repoTelemetryJson = await readJsonIfExists(repoTelemetryPath);
  if (repoTelemetryJson && typeof repoTelemetryJson === "object") {
    telemetry = mergeRepoTelemetry(
      telemetry,
      parseRepoTelemetryJson(repoTelemetryJson as Record<string, unknown>),
    );
    notes.push(
      `telemetry_source=repo-telemetry:${path.relative(
        process.cwd(),
        repoTelemetryPath,
      )}`,
    );
  }

  const vitestPath = resolvePathOverride(
    options?.vitestPath,
    ["CASIMIR_TEST_VITEST_PATH", "VITEST_JSON_PATH"],
    path.join(DEFAULT_REPORTS_DIR, "vitest.json"),
  );
  const eslintPath = resolvePathOverride(
    options?.eslintPath,
    ["CASIMIR_LINT_ESLINT_PATH", "ESLINT_JSON_PATH"],
    path.join(DEFAULT_REPORTS_DIR, "eslint.json"),
  );
  const tscPath = resolvePathOverride(
    options?.tscPath,
    ["CASIMIR_TYPECHECK_TSC_PATH", "TSC_OUTPUT_PATH"],
    path.join(DEFAULT_REPORTS_DIR, "tsc.txt"),
  );
  const reportTelemetry = await buildRepoTelemetryFromReports(
    vitestPath,
    eslintPath,
    tscPath,
  );
  if (reportTelemetry.telemetry) {
    telemetry = mergeRepoTelemetry(telemetry, reportTelemetry.telemetry);
    notes.push(...reportTelemetry.notes);
  }

  const envTelemetry = buildRepoTelemetryFromEnv();
  if (hasTelemetryFields(envTelemetry)) {
    telemetry = mergeRepoTelemetry(telemetry, envTelemetry);
    notes.push("telemetry_source=env");
  }

  return {
    telemetry,
    notes,
  };
};

const collectToolUseBudgetTelemetry = async (options?: {
  telemetryPath?: string;
}): Promise<LocalTelemetryResult<ToolUseBudgetTelemetry>> => {
  const notes: string[] = [];
  let telemetry: ToolUseBudgetTelemetry | undefined;

  const toolTelemetryPath = resolvePathOverride(
    options?.telemetryPath,
    ["CASIMIR_TOOL_TELEMETRY_PATH", "CASIMIR_TELEMETRY_PATH"],
    path.join(DEFAULT_REPORTS_DIR, "tool-telemetry.json"),
  );
  const toolTelemetryJson = await readJsonIfExists(toolTelemetryPath);
  if (toolTelemetryJson && typeof toolTelemetryJson === "object") {
    telemetry = mergeToolTelemetry(
      telemetry,
      parseToolTelemetryJson(toolTelemetryJson as Record<string, unknown>),
    );
    notes.push(
      `telemetry_source=tool-telemetry:${path.relative(
        process.cwd(),
        toolTelemetryPath,
      )}`,
    );
  }

  const envTelemetry = buildToolTelemetryFromEnv();
  if (hasTelemetryFields(envTelemetry)) {
    telemetry = mergeToolTelemetry(telemetry, envTelemetry);
    notes.push("telemetry_source=env");
  }

  return {
    telemetry,
    notes,
  };
};

const LOCAL_CONSTRAINT_PACKS: ConstraintPack[] = [
  {
    id: "repo-convergence",
    domain: "repo",
    version: 1,
    description:
      "Build/test convergence with contract + dependency coherence checks, plus time-to-green.",
    signalKinds: {
      diagnostic: "repo-diagnostic",
      certified: "repo-certified",
    },
    policy: {
      mode: "hard-only",
      unknownAsFail: true,
    },
    certificate: {
      issuer: "casimir-verifier",
      admissibleStatus: "GREEN",
      allowMarginalAsViable: false,
      treatMissingCertificateAsNotCertified: true,
    },
    constraints: [
      {
        id: "build_passed",
        severity: "HARD",
        description: "Build completes cleanly.",
        metric: "build.status",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "ci",
        note: "1=success, 0=fail",
      },
      {
        id: "tests_passed",
        severity: "HARD",
        description: "Tests complete with no failures.",
        metric: "tests.status",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "ci",
        note: "1=success, 0=fail",
      },
      {
        id: "schema_contracts_passed",
        severity: "HARD",
        description: "Schema contracts verified (API + types).",
        metric: "schema.contracts",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "schema",
        note: "1=green",
      },
      {
        id: "dependency_coherence_ok",
        severity: "HARD",
        description: "Lockfile + dependency graph coherence.",
        metric: "deps.coherence",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "deps",
        note: "1=green",
      },
      {
        id: "time_to_green_ms",
        severity: "SOFT",
        description: "Time-to-green under target ceiling.",
        metric: "time_to_green_ms",
        op: "<=",
        max: 1_200_000,
        units: "ms",
        source: "ci",
        note: "20 min target",
      },
    ],
    proxies: [
      {
        id: "lint_clean",
        severity: "SOFT",
        description: "Lint is clean (proxy signal).",
        metric: "lint.status",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "lint",
        proxy: true,
        note: "Proxy for build/test convergence.",
      },
      {
        id: "typecheck_clean",
        severity: "SOFT",
        description: "Typecheck is clean (proxy signal).",
        metric: "typecheck.status",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "typecheck",
        proxy: true,
        note: "Proxy for build/test convergence.",
      },
    ],
  },
  {
    id: "tool-use-budget",
    domain: "agent-runtime",
    version: 1,
    description:
      "Tool-use governance: step/cost limits, forbidden ops, approvals, provenance.",
    signalKinds: {
      diagnostic: "tool-budget-diagnostic",
      certified: "tool-budget-certified",
    },
    policy: {
      mode: "hard-only",
      unknownAsFail: true,
    },
    certificate: {
      issuer: "casimir-policy",
      admissibleStatus: "APPROVED",
      allowMarginalAsViable: false,
      treatMissingCertificateAsNotCertified: true,
    },
    constraints: [
      {
        id: "step_limit",
        severity: "HARD",
        description: "Step limit within policy.",
        metric: "steps.used",
        op: "<=",
        max: 32,
        units: "steps",
        source: "runtime",
      },
      {
        id: "cost_ceiling_usd",
        severity: "HARD",
        description: "Cost ceiling within policy.",
        metric: "cost.usd",
        op: "<=",
        max: 5,
        units: "usd",
        source: "billing",
      },
      {
        id: "forbidden_ops_count",
        severity: "HARD",
        description: "Forbidden operations executed.",
        metric: "ops.forbidden.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "policy",
      },
      {
        id: "approval_required_missing",
        severity: "HARD",
        description: "Approval-required operations missing approval.",
        metric: "ops.approval_missing.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "policy",
      },
      {
        id: "provenance_missing",
        severity: "HARD",
        description: "Missing provenance for external data/tools.",
        metric: "provenance.missing.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "policy",
      },
      {
        id: "runtime_ms",
        severity: "SOFT",
        description: "Runtime under target ceiling.",
        metric: "runtime.ms",
        op: "<=",
        max: 120_000,
        units: "ms",
        source: "runtime",
      },
      {
        id: "tool_calls",
        severity: "SOFT",
        description: "Tool calls under target ceiling.",
        metric: "tools.calls",
        op: "<=",
        max: 16,
        units: "count",
        source: "runtime",
      },
    ],
  },
  {
    id: "provenance-safety",
    domain: "audit",
    version: 1,
    description:
      "Audit-tag safety: provenance + verification coverage for risky IO/security surfaces.",
    signalKinds: {
      diagnostic: "audit-diagnostic",
      certified: "audit-certified",
    },
    policy: {
      mode: "hard-only",
      unknownAsFail: true,
    },
    certificate: {
      issuer: "casimir-audit",
      admissibleStatus: "SAFE",
      allowMarginalAsViable: false,
      treatMissingCertificateAsNotCertified: true,
    },
    constraints: [
      {
        id: "unknown_audit_tags",
        severity: "HARD",
        description: "No unknown audit tags.",
        metric: "audit.unknown_tags.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "audit",
      },
      {
        id: "audit_violations",
        severity: "HARD",
        description: "No explicit audit violations.",
        metric: "audit.violations.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "audit",
      },
      {
        id: "provenance_coverage",
        severity: "HARD",
        description: "Provenance protocol present when risk tags exist.",
        metric: "audit.provenance.coverage",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "audit",
        note: "1=covered, 0=missing",
      },
      {
        id: "safety_coverage",
        severity: "HARD",
        description: "Verification checklist present when risk tags exist.",
        metric: "audit.safety.coverage",
        op: "eq",
        limit: 1,
        units: "boolean",
        source: "audit",
        note: "1=covered, 0=missing",
      },
      {
        id: "untagged_files",
        severity: "SOFT",
        description: "All files have at least one audit tag.",
        metric: "audit.untagged.count",
        op: "<=",
        max: 0,
        units: "count",
        source: "audit",
      },
    ],
  },
];

const getLocalConstraintPackById = (id: string): ConstraintPack | undefined =>
  LOCAL_CONSTRAINT_PACKS.find((pack) => pack.id === id);

const normalizeCustomerId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasAnyTelemetry = (telemetry?: Record<string, unknown>): boolean => {
  if (!telemetry) return false;
  return Object.keys(telemetry).length > 0;
};

const hasPolicyOverridePayload = (
  override: ConstraintPackOverride | undefined,
): boolean => {
  if (!override) return false;
  return (
    override.policy !== undefined ||
    override.certificate !== undefined ||
    (override.constraints?.length ?? 0) > 0 ||
    (override.proxies?.length ?? 0) > 0
  );
};

const mergeConstraintOverrides = (
  constraints: ConstraintPackConstraint[],
  overrides?: ConstraintPackConstraintOverride[],
  warnings?: string[],
  label = "constraint",
): ConstraintPackConstraint[] => {
  if (!overrides || overrides.length === 0) return constraints;
  const overrideMap = new Map(
    overrides.map((override) => [override.id, override]),
  );
  const merged = constraints.map((constraint) => {
    const override = overrideMap.get(constraint.id);
    if (!override) return constraint;
    return {
      ...constraint,
      ...override,
      id: constraint.id,
      metric: constraint.metric,
    };
  });
  if (warnings) {
    for (const override of overrides) {
      if (!constraints.some((constraint) => constraint.id === override.id)) {
        warnings.push(`unknown_${label}:${override.id}`);
      }
    }
  }
  return merged;
};

const applyConstraintPackOverrides = (
  pack: ConstraintPack,
  overrides: ConstraintPackOverride[],
): { pack: ConstraintPack; warnings: string[] } => {
  if (!overrides.length) {
    return { pack, warnings: [] };
  }
  let next: ConstraintPack = {
    ...pack,
    policy: { ...pack.policy },
    certificate: { ...pack.certificate },
    constraints: pack.constraints.map((constraint) => ({ ...constraint })),
    proxies: pack.proxies?.map((constraint) => ({ ...constraint })),
  };
  const warnings: string[] = [];

  for (const override of overrides) {
    if (override.policy) {
      next.policy = { ...next.policy, ...override.policy };
    }
    if (override.certificate) {
      next.certificate = { ...next.certificate, ...override.certificate };
    }
    if (override.constraints) {
      next.constraints = mergeConstraintOverrides(
        next.constraints,
        override.constraints,
        warnings,
        "constraint",
      );
    }
    if (override.proxies) {
      if (next.proxies) {
        next.proxies = mergeConstraintOverrides(
          next.proxies,
          override.proxies,
          warnings,
          "proxy",
        );
      } else {
        warnings.push("proxy_overrides_ignored");
      }
    }
  }

  return { pack: next, warnings };
};

const resolvePackAutoTelemetry = (input: AdapterConstraintPack): boolean => {
  if (input.autoTelemetry === true) return true;
  if (input.autoTelemetry === false) {
    return Boolean(
      input.telemetryPath ||
        input.junitPath ||
        input.vitestPath ||
        input.jestPath ||
        input.eslintPath ||
        input.tscPath ||
        input.toolLogTraceId ||
        input.toolLogWindowMs ||
        input.toolLogLimit,
    );
  }
  if (
    input.telemetryPath ||
    input.junitPath ||
    input.vitestPath ||
    input.jestPath ||
    input.eslintPath ||
    input.tscPath ||
    input.toolLogTraceId ||
    input.toolLogWindowMs ||
    input.toolLogLimit
  ) {
    return true;
  }
  return false;
};

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v === undefined ? null : v));

const hashPayload = (value: unknown): string =>
  crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const issueConstraintPackCertificate = (input: {
  pack: ConstraintPack;
  metrics: Record<string, MetricValue>;
  constraints: ConstraintPackConstraintResult[];
  proxy?: boolean;
}): ConstraintPackCertificateResult => {
  const payload = {
    packId: input.pack.id,
    packVersion: input.pack.version,
    metrics: input.metrics,
    constraints: input.constraints,
    proxy: input.proxy ?? null,
  };
  const certificateHash = hashPayload(payload);
  return {
    certificateHash,
    certificateId: `constraint-pack:${input.pack.id}:${certificateHash.slice(
      0,
      12,
    )}`,
    integrityOk: true,
  };
};

const mergeMetricOverrides = (
  target: Record<string, MetricValue>,
  overrides?: Record<string, MetricValue>,
): void => {
  if (!overrides) return;
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
};

const pickFirstDefined = <T>(...values: Array<T | undefined>): T | undefined =>
  values.find((value) => value !== undefined);

const resolveStatusFromExitCode = (
  exitCode?: number,
): number | undefined => {
  if (!Number.isFinite(exitCode)) return undefined;
  return exitCode === 0 ? 1 : 0;
};

const resolveTestStatus = (
  tests?: RepoConvergenceTelemetry["tests"],
): MetricValue => {
  if (!tests) return undefined;
  if (tests.failed !== undefined && Number.isFinite(tests.failed)) {
    return tests.failed > 0 ? 0 : 1;
  }
  if (
    tests.total !== undefined &&
    Number.isFinite(tests.total) &&
    tests.passed !== undefined &&
    Number.isFinite(tests.passed)
  ) {
    return tests.passed === tests.total ? 1 : 0;
  }
  return tests.status;
};

const buildRepoConvergenceMetrics = (
  telemetry?: RepoConvergenceTelemetry,
): Record<string, MetricValue> => {
  const metrics: Record<string, MetricValue> = {};
  if (!telemetry) return metrics;
  const buildStatus =
    telemetry.build?.status ??
    telemetry.build?.ok ??
    resolveStatusFromExitCode(telemetry.build?.exitCode);
  const testStatus = resolveTestStatus(telemetry.tests);
  const schemaStatus = telemetry.schema?.contracts ?? telemetry.schema?.ok;
  const lintStatus = telemetry.lint?.status;
  const typecheckStatus = telemetry.typecheck?.status;

  if (buildStatus !== undefined) {
    metrics["build.status"] = buildStatus;
  }
  if (testStatus !== undefined) {
    metrics["tests.status"] = testStatus;
  }
  if (schemaStatus !== undefined) {
    metrics["schema.contracts"] = schemaStatus;
  }
  if (telemetry.deps?.coherence !== undefined) {
    metrics["deps.coherence"] = telemetry.deps?.coherence;
  }
  if (telemetry.timeToGreenMs !== undefined) {
    metrics["time_to_green_ms"] = telemetry.timeToGreenMs;
  }
  if (lintStatus !== undefined) {
    metrics["lint.status"] = lintStatus;
  }
  if (typecheckStatus !== undefined) {
    metrics["typecheck.status"] = typecheckStatus;
  }
  if (telemetry.metrics) {
    mergeMetricOverrides(metrics, telemetry.metrics);
  }
  return metrics;
};

const buildToolUseBudgetMetrics = (
  telemetry?: ToolUseBudgetTelemetry,
): Record<string, MetricValue> => {
  const metrics: Record<string, MetricValue> = {};
  if (!telemetry) return metrics;
  const stepUsage = pickFirstDefined(
    telemetry.steps?.used,
    telemetry.steps?.total,
  );
  if (stepUsage !== undefined) {
    metrics["steps.used"] = stepUsage;
  }
  if (telemetry.cost?.usd !== undefined) {
    metrics["cost.usd"] = telemetry.cost.usd;
  }
  if (telemetry.ops?.forbidden !== undefined) {
    metrics["ops.forbidden.count"] = telemetry.ops.forbidden;
  }
  if (telemetry.ops?.approvalMissing !== undefined) {
    metrics["ops.approval_missing.count"] = telemetry.ops.approvalMissing;
  }
  if (telemetry.provenance?.missing !== undefined) {
    metrics["provenance.missing.count"] = telemetry.provenance.missing;
  }
  if (telemetry.runtime?.ms !== undefined) {
    metrics["runtime.ms"] = telemetry.runtime.ms;
  }
  const toolCalls = pickFirstDefined(
    telemetry.tools?.calls,
    telemetry.tools?.total,
  );
  if (toolCalls !== undefined) {
    metrics["tools.calls"] = toolCalls;
  }
  if (telemetry.metrics) {
    mergeMetricOverrides(metrics, telemetry.metrics);
  }
  return metrics;
};

const buildAuditSafetyMetrics = (
  telemetry?: AuditSafetyTelemetry,
): Record<string, MetricValue> => {
  const metrics: Record<string, MetricValue> = {};
  if (!telemetry) return metrics;
  const audit = telemetry.audit;
  if (audit?.files?.total !== undefined) {
    metrics["audit.files.total"] = audit.files.total;
  }
  if (audit?.files?.tagged !== undefined) {
    metrics["audit.tagged.count"] = audit.files.tagged;
  }
  if (audit?.files?.untagged !== undefined) {
    metrics["audit.untagged.count"] = audit.files.untagged;
  }
  if (audit?.tags?.unknown !== undefined) {
    metrics["audit.unknown_tags.count"] = audit.tags.unknown;
  }
  if (audit?.violations?.count !== undefined) {
    metrics["audit.violations.count"] = audit.violations.count;
  }
  if (audit?.risk?.files !== undefined) {
    metrics["audit.risk.files"] = audit.risk.files;
  }
  if (audit?.provenance?.files !== undefined) {
    metrics["audit.provenance.files"] = audit.provenance.files;
  }
  if (audit?.provenance?.coverage !== undefined) {
    metrics["audit.provenance.coverage"] = audit.provenance.coverage;
  }
  if (audit?.safety?.files !== undefined) {
    metrics["audit.safety.files"] = audit.safety.files;
  }
  if (audit?.safety?.coverage !== undefined) {
    metrics["audit.safety.coverage"] = audit.safety.coverage;
  }
  if (audit?.critical?.files !== undefined) {
    metrics["audit.critical.files"] = audit.critical.files;
  }
  if (telemetry.metrics) {
    mergeMetricOverrides(metrics, telemetry.metrics);
  }
  return metrics;
};

const TRUTHY_VALUES = new Set([
  "1",
  "true",
  "yes",
  "ok",
  "pass",
  "passed",
  "green",
  "success",
]);
const FALSY_VALUES = new Set([
  "0",
  "false",
  "no",
  "fail",
  "failed",
  "red",
  "error",
]);

const LADDER_ORDER: PolicyLadderTier[] = [
  "reduced-order",
  "diagnostic",
  "certified",
];

const isTierAtLeast = (
  tier: PolicyLadderTier,
  minimum: PolicyLadderTier,
): boolean => {
  const tierIndex = LADDER_ORDER.indexOf(tier);
  const minimumIndex = LADDER_ORDER.indexOf(minimum);
  if (tierIndex === -1 || minimumIndex === -1) return false;
  return tierIndex >= minimumIndex;
};

const resolveLadderTier = (input: {
  requested?: PolicyLadderTier;
  certified: boolean;
  proxy: boolean;
}): PolicyLadderTier => {
  const actual: PolicyLadderTier = input.certified
    ? "certified"
    : input.proxy
      ? "reduced-order"
      : "diagnostic";
  if (!input.requested) return actual;
  const requestedIndex = LADDER_ORDER.indexOf(input.requested);
  const actualIndex = LADDER_ORDER.indexOf(actual);
  if (requestedIndex === -1 || actualIndex === -1) return actual;
  return requestedIndex <= actualIndex ? input.requested : actual;
};

const coerceMetricValue = (
  raw: MetricValue,
): { value: number | null; issue?: "missing" | "unparseable" | "not-finite" } => {
  if (raw === null || raw === undefined) {
    return { value: null, issue: "missing" };
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { value: raw }
      : { value: null, issue: "not-finite" };
  }
  if (typeof raw === "boolean") {
    return { value: raw ? 1 : 0 };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { value: null, issue: "missing" };
    }
    const lowered = trimmed.toLowerCase();
    if (TRUTHY_VALUES.has(lowered)) {
      return { value: 1 };
    }
    if (FALSY_VALUES.has(lowered)) {
      return { value: 0 };
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed)
      ? { value: parsed }
      : { value: null, issue: "unparseable" };
  }
  return { value: null, issue: "unparseable" };
};

const formatLimitLabel = (
  constraint: ConstraintPackConstraint,
  threshold?: number,
): string | null => {
  if (threshold === undefined || !Number.isFinite(threshold)) {
    if (
      constraint.min !== undefined &&
      constraint.max !== undefined &&
      Number.isFinite(constraint.min) &&
      Number.isFinite(constraint.max)
    ) {
      return `[${constraint.min}, ${constraint.max}]`;
    }
    return null;
  }
  const op = constraint.op?.trim();
  if (!op || op === "eq") return String(threshold);
  return `${op} ${threshold}`;
};

const resolveConstraintThreshold = (
  constraint: ConstraintPackConstraint,
): { op: string; threshold?: number; min?: number; max?: number } => {
  const op = (constraint.op ?? "").trim();
  if (op === "eq") {
    return {
      op,
      threshold: pickFirstDefined(
        constraint.limit,
        constraint.min,
        constraint.max,
      ),
    };
  }
  if (op === "<=" || op === "<") {
    return { op, threshold: pickFirstDefined(constraint.max, constraint.limit) };
  }
  if (op === ">=" || op === ">") {
    return { op, threshold: pickFirstDefined(constraint.min, constraint.limit) };
  }
  if (
    constraint.min !== undefined &&
    constraint.max !== undefined &&
    Number.isFinite(constraint.min) &&
    Number.isFinite(constraint.max)
  ) {
    return { op: "band", min: constraint.min, max: constraint.max };
  }
  if (constraint.min !== undefined && Number.isFinite(constraint.min)) {
    return { op: ">=", threshold: constraint.min };
  }
  if (constraint.max !== undefined && Number.isFinite(constraint.max)) {
    return { op: "<=", threshold: constraint.max };
  }
  return { op };
};

const evaluateConstraint = (
  constraint: ConstraintPackConstraint,
  metrics: Record<string, MetricValue>,
): ConstraintPackConstraintResult => {
  const metricKey = constraint.metric;
  const raw = metricKey ? metrics[metricKey] : undefined;
  const { value, issue } = coerceMetricValue(raw);
  const noteParts: string[] = [];
  let status: ConstraintPackConstraintResult["status"] = "unknown";
  let limit: string | null = null;

  if (!metricKey) {
    noteParts.push("metric_not_configured");
  }
  if (issue) {
    noteParts.push(metricKey ? `${metricKey}_${issue}` : issue);
  }

  if (value !== null) {
    const resolved = resolveConstraintThreshold(constraint);
    const threshold = resolved.threshold;
    limit = formatLimitLabel(constraint, threshold);
    if (resolved.op === "band") {
      if (
        typeof resolved.min === "number" &&
        typeof resolved.max === "number"
      ) {
        status =
          value >= resolved.min && value <= resolved.max ? "pass" : "fail";
      } else {
        noteParts.push("limit_missing");
      }
    } else if (resolved.op === "eq") {
      if (threshold === undefined || !Number.isFinite(threshold)) {
        noteParts.push("limit_missing");
      } else {
        status = value === threshold ? "pass" : "fail";
      }
    } else if (resolved.op === "<=") {
      if (threshold === undefined || !Number.isFinite(threshold)) {
        noteParts.push("limit_missing");
      } else {
        status = value <= threshold ? "pass" : "fail";
      }
    } else if (resolved.op === "<") {
      if (threshold === undefined || !Number.isFinite(threshold)) {
        noteParts.push("limit_missing");
      } else {
        status = value < threshold ? "pass" : "fail";
      }
    } else if (resolved.op === ">=") {
      if (threshold === undefined || !Number.isFinite(threshold)) {
        noteParts.push("limit_missing");
      } else {
        status = value >= threshold ? "pass" : "fail";
      }
    } else if (resolved.op === ">") {
      if (threshold === undefined || !Number.isFinite(threshold)) {
        noteParts.push("limit_missing");
      } else {
        status = value > threshold ? "pass" : "fail";
      }
    } else if (resolved.op) {
      noteParts.push("unsupported_op");
    }
  }

  return {
    id: constraint.id,
    severity: constraint.severity,
    status,
    value,
    limit,
    proxy: constraint.proxy,
    note: noteParts.length ? noteParts.join(",") : undefined,
  };
};

const resolvePass = (
  pack: ConstraintPack,
  constraints: ConstraintPackConstraintResult[],
): boolean => {
  if (!constraints.length) return true;
  const relevant =
    pack.policy.mode === "hard-only"
      ? constraints.filter((entry) => entry.severity === "HARD")
      : constraints;
  if (!relevant.length) return true;
  const hasFail = relevant.some((entry) => entry.status === "fail");
  const hasUnknown = relevant.some((entry) => entry.status === "unknown");
  if (hasFail) return false;
  if (hasUnknown && pack.policy.unknownAsFail) return false;
  return true;
};

const resolveFirstFail = (
  constraints: ConstraintPackConstraintResult[],
): ConstraintPackConstraintResult | undefined => {
  const hardFail = constraints.find(
    (entry) => entry.severity === "HARD" && entry.status === "fail",
  );
  if (hardFail) return hardFail;
  return constraints.find((entry) => entry.status === "fail");
};

const resolveProxyFlag = (
  inputProxy: boolean | undefined,
  constraints: ConstraintPackConstraintResult[],
): boolean | undefined => {
  if (typeof inputProxy === "boolean") {
    return inputProxy;
  }
  const hasRealData = constraints.some(
    (entry) => !entry.proxy && entry.status !== "unknown",
  );
  const hasProxyData = constraints.some(
    (entry) => entry.proxy && entry.status !== "unknown",
  );
  if (!hasRealData && hasProxyData) {
    return true;
  }
  return undefined;
};

const evaluateConstraintPackFromMetrics = (
  pack: ConstraintPack,
  metrics: Record<string, MetricValue>,
  input: {
    certificate?: ConstraintPackCertificateResult;
    deltas?: TrainingTraceDelta[];
    notes?: string[];
    proxy?: boolean;
    ladderTier?: PolicyLadderTier;
  } = {},
): ConstraintPackEvaluation => {
  const constraintResults = pack.constraints.map((constraint) =>
    evaluateConstraint(constraint, metrics),
  );
  const proxyResults = (pack.proxies ?? []).map((constraint) =>
    evaluateConstraint(constraint, metrics),
  );
  const allConstraints = [...constraintResults, ...proxyResults];
  let pass = resolvePass(pack, constraintResults);
  const firstFail = resolveFirstFail(constraintResults);
  const proxy = resolveProxyFlag(input.proxy, allConstraints);
  const autoCertificate = !input.certificate;
  let certificate =
    input.certificate ??
    issueConstraintPackCertificate({
      pack,
      metrics,
      constraints: allConstraints,
      proxy,
    });
  const certificateHash = certificate?.certificateHash ?? null;
  const hasCertificate =
    typeof certificateHash === "string" && certificateHash.trim().length > 0;
  const certified =
    pass && hasCertificate && certificate?.integrityOk === true && !proxy;
  const ladderTier = resolveLadderTier({
    requested: input.ladderTier,
    certified,
    proxy: Boolean(proxy),
  });
  const ladderNotes: string[] = [];
  if (pack.policy.minLadderTier) {
    if (!isTierAtLeast(ladderTier, pack.policy.minLadderTier)) {
      pass = false;
      ladderNotes.push(`ladder_min_tier=${pack.policy.minLadderTier}`);
      ladderNotes.push(`ladder_actual=${ladderTier}`);
    }
  }
  if (autoCertificate && certificate) {
    const status = pass
      ? proxy
        ? "PROXY"
        : pack.certificate.admissibleStatus
      : "FAIL";
    certificate = { ...certificate, status };
  }
  const mergedNotes = [
    ...(input.notes ?? []),
    ...ladderNotes,
  ].filter((note): note is string => typeof note === "string" && note.length > 0);

  return {
    pass,
    constraints: allConstraints,
    ...(certificate ? { certificate } : {}),
    ...(input.deltas ? { deltas: input.deltas } : {}),
    ...(mergedNotes.length ? { notes: mergedNotes } : {}),
    ...(firstFail ? { firstFail } : {}),
    ...(proxy ? { proxy } : {}),
    ladderTier,
  };
};

const normalizeLimit = (limit: string | number | null | undefined): string | null => {
  if (limit === null || limit === undefined) {
    return null;
  }
  if (typeof limit === "string") {
    return limit;
  }
  if (Number.isFinite(limit)) {
    return String(limit);
  }
  return null;
};

const normalizeConstraintResult = (
  entry: ConstraintPackConstraintResult,
): Required<Pick<ConstraintPackConstraintResult, "id" | "severity" | "status">> &
  ConstraintPackConstraintResult => ({
  ...entry,
  severity: entry.severity ?? "SOFT",
  status: entry.status ?? "unknown",
});

const toTrainingTraceConstraint = (
  entry: ConstraintPackConstraintResult,
): TrainingTraceConstraint => {
  const normalized = normalizeConstraintResult(entry);
  return {
    id: normalized.id,
    severity: normalized.severity,
    status: normalized.status,
    value:
      typeof normalized.value === "number" && Number.isFinite(normalized.value)
        ? normalized.value
        : null,
    limit: normalizeLimit(normalized.limit),
    note: normalized.note,
  };
};

const pickFirstFailingHardConstraint = (
  constraints: ConstraintPackConstraintResult[],
): TrainingTraceConstraint | undefined => {
  const normalized = constraints.map(normalizeConstraintResult);
  const hardFail = normalized.find(
    (entry) => entry.severity === "HARD" && entry.status === "fail",
  );
  if (hardFail) return toTrainingTraceConstraint(hardFail);
  const anyFail = normalized.find((entry) => entry.status === "fail");
  return anyFail ? toTrainingTraceConstraint(anyFail) : undefined;
};

const resolveConstraintsPass = (
  pack: ConstraintPack,
  constraints: ConstraintPackConstraintResult[],
): boolean => {
  if (constraints.length === 0) return true;
  const normalized = constraints.map(normalizeConstraintResult);
  const relevant =
    pack.policy.mode === "hard-only"
      ? normalized.filter((entry) => entry.severity === "HARD")
      : normalized;
  if (relevant.length === 0) return true;
  const hasFail = relevant.some((entry) => entry.status === "fail");
  const hasUnknown = relevant.some((entry) => entry.status === "unknown");
  if (hasFail) return false;
  if (hasUnknown && pack.policy.unknownAsFail) return false;
  return true;
};

const resolveCertificatePass = (
  pack: ConstraintPack,
  evaluation: ConstraintPackEvaluation,
): boolean => {
  const certificate = evaluation.certificate;
  const requiresCertificate =
    pack.certificate.treatMissingCertificateAsNotCertified;
  const certificateHash = certificate?.certificateHash ?? null;
  const hasCertificate =
    typeof certificateHash === "string" && certificateHash.trim().length > 0;
  const status = certificate?.status;
  const statusOk =
    status === pack.certificate.admissibleStatus ||
    (pack.certificate.allowMarginalAsViable === true &&
      status === "MARGINAL");
  const integrityOk = certificate?.integrityOk !== false;
  if (!integrityOk) return false;
  if (!hasCertificate) {
    return !requiresCertificate;
  }
  return statusOk ?? false;
};

const resolveProxyFlagForTrace = (
  constraints: ConstraintPackConstraintResult[],
): boolean => {
  const hasRealData = constraints.some(
    (entry) => !entry.proxy && entry.status !== "unknown",
  );
  const hasProxyData = constraints.some(
    (entry) => entry.proxy && entry.status !== "unknown",
  );
  return !hasRealData && hasProxyData;
};

const resolveSignal = (
  pack: ConstraintPack,
  evaluation: ConstraintPackEvaluation,
  pass: boolean,
  proxy: boolean,
): TrainingTraceSignal => {
  const certificate = evaluation.certificate;
  const hasCertificate =
    typeof certificate?.certificateHash === "string" &&
    certificate.certificateHash.trim().length > 0;
  const certified =
    pass && hasCertificate && certificate?.integrityOk === true && !proxy;
  const ladderTier = resolveLadderTier({
    requested: evaluation.ladderTier,
    certified,
    proxy,
  });
  return {
    kind: certified ? pack.signalKinds.certified : pack.signalKinds.diagnostic,
    ladder: {
      tier: ladderTier,
      policy: pack.id,
      policyVersion: String(pack.version),
    },
    ...(proxy ? { proxy: true } : {}),
  };
};

const sanitizeMetrics = (
  metrics?: Record<string, MetricValue>,
): TrainingTraceMetrics | undefined => {
  if (!metrics) return undefined;
  const cleaned: TrainingTraceMetrics = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value === undefined) continue;
    cleaned[key] = value as number | boolean | string | null;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
};

const ensureTrainingTraceCertificate = (
  certificate?: TrainingTraceCertificate | ConstraintPackCertificateResult | null,
): TrainingTraceCertificate => {
  if (!certificate) {
    return {
      status: "NOT_CERTIFIED",
      certificateHash: null,
      certificateId: null,
      integrityOk: false,
    };
  }
  return {
    status: certificate.status ?? "NOT_CERTIFIED",
    certificateHash: certificate.certificateHash ?? null,
    certificateId: certificate.certificateId ?? null,
    integrityOk: certificate.integrityOk,
  };
};

const buildConstraintPackTraceRecord = (input: {
  traceId: string;
  tenantId?: string;
  pack: ConstraintPack;
  evaluation: ConstraintPackEvaluation;
  metrics?: Record<string, MetricValue>;
  source?: TrainingTraceSource;
}): TrainingTraceRecord => {
  const constraints = input.evaluation.constraints ?? [];
  const pass =
    input.evaluation.pass ??
    (resolveConstraintsPass(input.pack, constraints) &&
      resolveCertificatePass(input.pack, input.evaluation));
  const proxy =
    typeof input.evaluation.proxy === "boolean"
      ? input.evaluation.proxy
      : resolveProxyFlagForTrace(constraints);
  const firstFail = input.evaluation.firstFail
    ? toTrainingTraceConstraint(input.evaluation.firstFail)
    : pickFirstFailingHardConstraint(constraints);
  const certificate = ensureTrainingTraceCertificate(input.evaluation.certificate);
  const deltas = input.evaluation.deltas ?? [];
  const signal = resolveSignal(input.pack, input.evaluation, pass, proxy);
  const notes = input.evaluation.notes?.filter(
    (note): note is string => typeof note === "string" && note.trim().length > 0,
  );
  return {
    kind: "training-trace",
    version: 1,
    id: input.traceId,
    seq: 1,
    ts: new Date().toISOString(),
    traceId: input.traceId,
    tenantId: input.tenantId,
    source: input.source,
    signal,
    pass,
    deltas,
    metrics: sanitizeMetrics(input.metrics),
    firstFail: firstFail ?? undefined,
    certificate,
    ...(notes && notes.length ? { notes } : {}),
  };
};

const NON_CERTIFYING_FALLBACK_NOTE =
  "synthetic_fallback_non_certifying=true";

export const buildFallbackTraceRecord = (input: {
  payload: AdapterRunRequest;
  response: AdapterRunResponse;
  tenantId?: string;
}): TrainingTraceRecord => {
  const traceId =
    input.response.traceId ??
    input.payload.traceId ??
    `local:${crypto.randomUUID()}`;
  const pass = input.response.pass === true || input.response.verdict === "PASS";
  const deltas = input.response.deltas ?? [];
  const certificate = {
    ...ensureTrainingTraceCertificate(input.response.certificate),
    status: "NOT_CERTIFIED",
    integrityOk: false,
  };
  const metrics = input.payload.pack?.metrics
    ? sanitizeMetrics(input.payload.pack.metrics as Record<string, MetricValue>)
    : undefined;
  return {
    kind: "training-trace",
    version: 1,
    id: input.response.runId ?? traceId,
    seq: 1,
    ts: new Date().toISOString(),
    traceId,
    tenantId: input.tenantId,
    pass,
    deltas,
    metrics,
    firstFail: input.response.firstFail ?? undefined,
    certificate,
    notes: [NON_CERTIFYING_FALLBACK_NOTE],
  };
};

const runLocalConstraintPack = async (
  payload: AdapterRunRequest,
  args: ParsedArgs,
): Promise<{ response: AdapterRunResponse; trace: TrainingTraceRecord }> => {
  if (!payload.pack) {
    throw new Error("Provide pack details for constraint-pack mode.");
  }
  const resolvedPack = getLocalConstraintPackById(payload.pack.id);
  if (!resolvedPack) {
    throw new Error("constraint-pack-not-found");
  }
  const requestedCustomerId = normalizeCustomerId(payload.pack.customerId);
  if (
    args.tenant &&
    requestedCustomerId &&
    args.tenant !== requestedCustomerId
  ) {
    throw new Error("tenant-mismatch");
  }
  if (payload.pack.policyProfileId) {
    throw new Error("policy-profile-not-supported");
  }

  const policyNotes: string[] = [];
  const overrides: ConstraintPackOverride[] = [];
  if (payload.pack.policyOverride && isPlainObject(payload.pack.policyOverride)) {
    const inlineOverride = payload.pack.policyOverride as ConstraintPackOverride;
    if (inlineOverride.packId && inlineOverride.packId !== resolvedPack.id) {
      throw new Error("policy-override-pack-mismatch");
    }
    const normalizedOverride = { ...inlineOverride, packId: resolvedPack.id };
    if (hasPolicyOverridePayload(normalizedOverride)) {
      overrides.push(normalizedOverride);
      policyNotes.push("policy_override=inline");
    }
  }

  let effectivePack = resolvedPack;
  if (overrides.length) {
    const resolved = applyConstraintPackOverrides(effectivePack, overrides);
    effectivePack = resolved.pack;
    if (resolved.warnings.length) {
      policyNotes.push(
        ...resolved.warnings.map((warning) => `policy_${warning}`),
      );
    }
  }

  const shouldAutoTelemetry =
    effectivePack.id === "provenance-safety"
      ? payload.pack.autoTelemetry !== false
      : resolvePackAutoTelemetry(payload.pack);
  let telemetry = payload.pack.telemetry;
  const autoTelemetryNotes: string[] = [];
  if (shouldAutoTelemetry) {
    if (effectivePack.id === "repo-convergence") {
      const collected = await collectRepoConvergenceTelemetry({
        telemetryPath: payload.pack.telemetryPath,
        vitestPath: payload.pack.vitestPath,
        eslintPath: payload.pack.eslintPath,
        tscPath: payload.pack.tscPath,
      });
      if (collected.telemetry) {
        telemetry = mergeRepoTelemetry(
          telemetry as RepoConvergenceTelemetry | undefined,
          collected.telemetry,
        ) as Record<string, unknown> | undefined;
      }
      autoTelemetryNotes.push(...collected.notes);
    } else if (effectivePack.id === "tool-use-budget") {
      const collected = await collectToolUseBudgetTelemetry({
        telemetryPath: payload.pack.telemetryPath,
      });
      if (collected.telemetry) {
        telemetry = mergeToolTelemetry(
          telemetry as ToolUseBudgetTelemetry | undefined,
          collected.telemetry,
        ) as Record<string, unknown> | undefined;
      }
      autoTelemetryNotes.push(...collected.notes);
    } else if (!telemetry && !payload.pack.metrics) {
      autoTelemetryNotes.push(`telemetry_auto_unavailable=${effectivePack.id}`);
    }
  }

  if (!hasAnyTelemetry(telemetry) && !hasAnyTelemetry(payload.pack.metrics)) {
    throw new Error("constraint-pack-telemetry-missing");
  }

  const metrics =
    effectivePack.id === "repo-convergence"
      ? buildRepoConvergenceMetrics(telemetry as RepoConvergenceTelemetry)
      : effectivePack.id === "tool-use-budget"
        ? buildToolUseBudgetMetrics(telemetry as ToolUseBudgetTelemetry)
        : buildAuditSafetyMetrics(telemetry as AuditSafetyTelemetry);
  mergeMetricOverrides(metrics, payload.pack.metrics as Record<string, MetricValue>);

  const evaluationNotes = [
    ...(payload.pack.notes ?? []),
    ...policyNotes,
    ...autoTelemetryNotes,
  ];
  const evaluation = evaluateConstraintPackFromMetrics(effectivePack, metrics, {
    certificate: payload.pack.certificate as ConstraintPackCertificateResult | undefined,
    deltas: payload.pack.deltas,
    notes: evaluationNotes.length ? evaluationNotes : undefined,
    proxy: payload.pack.proxy,
    ladderTier: payload.pack.ladderTier,
  });

  const traceId = payload.traceId ?? `local:${crypto.randomUUID()}`;
  const trace = buildConstraintPackTraceRecord({
    traceId,
    tenantId: args.tenant ?? requestedCustomerId,
    pack: effectivePack,
    evaluation,
    metrics,
    source: {
      system: "constraint-pack",
      component: "cli",
      tool: effectivePack.id,
      version: String(effectivePack.version),
    },
  });

  return {
    response: {
      traceId,
      runId: trace.id,
      verdict: trace.pass ? "PASS" : "FAIL",
      pass: trace.pass,
      firstFail: trace.firstFail ?? null,
      deltas: trace.deltas,
      certificate: trace.certificate ?? null,
      artifacts: [
        { kind: "constraint-pack", ref: effectivePack.id },
        { kind: "training-trace-id", ref: trace.id },
      ],
    },
    trace,
  };
};

const normalizeEndpoint = (input: string, endpointPath: string): string => {
  if (!isHttpUrl(input)) {
    throw new Error(`Endpoint must be an absolute URL: ${input}`);
  }
  if (input.includes("/api/")) {
    return input;
  }
  return `${input.replace(/\/+$/, "")}${endpointPath}`;
};

export const resolveAdapterEndpoint = (explicit?: string): string | undefined => {
  if (explicit) {
    return normalizeEndpoint(explicit, "/api/agi/adapter/run");
  }
  const base =
    process.env.CASIMIR_PUBLIC_BASE_URL ??
    process.env.SHADOW_OF_INTENT_BASE_URL;
  if (isHttpUrl(base)) {
    return normalizeEndpoint(base as string, "/api/agi/adapter/run");
  }
  const direct = process.env.CASIMIR_VERIFY_URL ?? process.env.AGI_ADAPTER_URL;
  if (direct) {
    return normalizeEndpoint(direct, "/api/agi/adapter/run");
  }
  return undefined;
};

const resolveExportEndpoint = (
  explicit: string | undefined,
  adapterUrl: string,
): string => {
  if (explicit) {
    return normalizeEndpoint(explicit, "/api/agi/training-trace/export");
  }
  const direct = process.env.CASIMIR_TRACE_EXPORT_URL;
  if (direct) {
    return normalizeEndpoint(direct, "/api/agi/training-trace/export");
  }
  const parsed = new URL(adapterUrl);
  parsed.pathname = "/api/agi/training-trace/export";
  parsed.search = "";
  return parsed.toString();
};

const normalizeToken = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
};

const buildAuthHeaders = (args: ParsedArgs): Record<string, string> => {
  const headers: Record<string, string> = {};
  const token = normalizeToken(args.token);
  if (token) headers.Authorization = token;
  if (args.tenant) headers["X-Tenant-Id"] = args.tenant;
  if (args.traceparent) headers.traceparent = args.traceparent;
  if (args.tracestate) headers.tracestate = args.tracestate;
  return headers;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  if (args[0] === "verify") {
    args.shift();
  }
  const parsed: ParsedArgs = {};
  const takeValue = (token: string, next?: string): string | undefined => {
    if (token.includes("=")) return token.split("=", 2)[1];
    return next;
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    const next = args[i + 1];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
    } else if (token === "--json" || token === "-j") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.jsonPath = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--params" || token === "-p") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.rawJson = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--url") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.url = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--export-url") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.exportUrl = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--trace-out" || token === "-o") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.traceOut = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--trace-limit" || token === "-l") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.traceLimit = Number(value);
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--token") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.token = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--tenant") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.tenant = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--traceparent") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.traceparent = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--trace-id") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.traceId = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--pack") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.packId = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--auto-telemetry") {
      parsed.autoTelemetry = true;
    } else if (token === "--no-auto-telemetry") {
      parsed.autoTelemetry = false;
    } else if (token === "--ci") {
      parsed.ci = true;
    } else if (token === "--tracestate") {
      const value = takeValue(token, next);
      if (value !== undefined) {
        parsed.tracestate = value;
        if (!token.includes("=")) i += 1;
      }
    } else if (token === "--quiet" || token === "-q") {
      parsed.quiet = true;
    }
  }

  return parsed;
};

const loadPayload = async (
  jsonPath?: string,
  rawJson?: string,
): Promise<Record<string, unknown>> => {
  const payload: Record<string, unknown> = {};
  if (jsonPath) {
    const src = await fs.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(src);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Request JSON must be an object.");
    }
    Object.assign(payload, parsed as Record<string, unknown>);
  }
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Inline params must be a JSON object.");
    }
    Object.assign(payload, parsed as Record<string, unknown>);
  }
  return payload;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const validateAdapterRequest = (payload: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!isPlainObject(payload)) {
    errors.push("request must be an object");
    return errors;
  }
  if (payload.traceId !== undefined && typeof payload.traceId !== "string") {
    errors.push("traceId must be a string");
  }
  if (payload.mode !== undefined && typeof payload.mode !== "string") {
    errors.push("mode must be a string");
  }
  if (payload.actions !== undefined && !Array.isArray(payload.actions)) {
    errors.push("actions must be an array");
  }
  if (payload.budget !== undefined && !isPlainObject(payload.budget)) {
    errors.push("budget must be an object");
  }
  if (payload.policy !== undefined && !isPlainObject(payload.policy)) {
    errors.push("policy must be an object");
  }
  if (payload.pack !== undefined && !isPlainObject(payload.pack)) {
    errors.push("pack must be an object");
  }
  return errors;
};

const isAdapterRunResponse = (value: unknown): value is AdapterRunResponse => {
  if (!isPlainObject(value)) return false;
  if (typeof value.pass === "boolean") return true;
  if (typeof value.verdict === "string") return true;
  return false;
};

const runAdapter = async (
  url: string,
  payload: AdapterRunRequest,
  headers: Record<string, string>,
): Promise<AdapterRunResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`Adapter request failed: ${response.status} ${text}`);      
  }
  const json = await response.json();
  if (!isAdapterRunResponse(json)) {
    throw new Error("Unexpected adapter response shape.");
  }
  return json;
};

const buildExportUrl = (
  baseUrl: string,
  limit?: number,
  tenant?: string,
): string => {
  const url = new URL(baseUrl);
  if (Number.isFinite(limit) && (limit as number) > 0) {
    url.searchParams.set("limit", String(limit));
  }
  if (tenant) {
    url.searchParams.set("tenantId", tenant);
  }
  return url.toString();
};

const exportTraces = async (
  url: string,
  headers: Record<string, string>,
): Promise<string> => {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...headers, Accept: "application/x-ndjson" },
  });
  if (!response.ok) {
    const text = (await response.text()) || response.statusText;
    throw new Error(`Trace export failed: ${response.status} ${text}`);
  }
  return response.text();
};

const formatTraceJsonl = (
  record: TrainingTraceRecord | TrainingTraceRecord[],
): string => {
  const entries = Array.isArray(record) ? record : [record];
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
};

const writeTraceOutput = async (output: string, outPath: string): Promise<void> => {
  const content = output.endsWith("\n") ? output : `${output}\n`;
  if (outPath === "-") {
    process.stdout.write(content);
    return;
  }
  const dir = path.dirname(outPath);
  if (dir && dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(outPath, content, "utf8");
};

const resolvePackId = (args: ParsedArgs): string | undefined => {
  if (args.packId) return args.packId;
  if (args.ci) return "repo-convergence";
  return "tool-use-budget";
};

const resolveTraceId = (args: ParsedArgs, packId?: string): string | undefined => {
  if (args.traceId) return args.traceId;
  if (process.env.CI) {
    const env = process.env;
    const runId =
      env.GITHUB_RUN_ID ??
      env.GITHUB_RUN_NUMBER ??
      env.CI_PIPELINE_ID ??
      env.BUILD_BUILDID ??
      env.BUILD_NUMBER ??
      env.RUN_ID ??
      env.CI_JOB_ID;
    const base = packId ? `ci:${packId}` : "ci:shadow-of-intent";
    return runId ? `${base}:${runId}` : base;
  }
  return undefined;
};

const resolveAutoTelemetry = (
  args: ParsedArgs,
  packId?: string,
): boolean | undefined => {
  if (typeof args.autoTelemetry === "boolean") {
    return args.autoTelemetry;
  }
  if (args.ci || args.packId || packId) {
    return true;
  }
  return undefined;
};

const buildPackPayload = async (
  args: ParsedArgs,
): Promise<AdapterRunRequest | null> => {
  const packId = resolvePackId(args);
  if (!packId) return null;
  const autoTelemetry = resolveAutoTelemetry(args, packId);
  const traceId = resolveTraceId(args, packId);
  const pack: AdapterConstraintPack = { id: packId };
  if (autoTelemetry !== undefined) {
    pack.autoTelemetry = autoTelemetry;
  }
  if (autoTelemetry && packId === "repo-convergence") {
    const localTelemetry = await collectRepoConvergenceTelemetry();
    if (localTelemetry.telemetry) {
      pack.telemetry = localTelemetry.telemetry as Record<string, unknown>;
    }
    if (localTelemetry.notes.length > 0) {
      pack.notes = localTelemetry.notes;
    }
  } else if (autoTelemetry && packId === "tool-use-budget") {
    const localTelemetry = await collectToolUseBudgetTelemetry();
    if (localTelemetry.telemetry) {
      pack.telemetry = localTelemetry.telemetry as Record<string, unknown>;
    }
    if (localTelemetry.notes.length > 0) {
      pack.notes = localTelemetry.notes;
    }
  }
  return {
    ...(traceId ? { traceId } : {}),
    mode: "constraint-pack",
    pack,
  };
};

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.error(USAGE);
    process.exit(0);
  }

  let payload: Record<string, unknown> | undefined;
  if (args.jsonPath || args.rawJson) {
    payload = await loadPayload(args.jsonPath, args.rawJson);
  } else {
    const packPayload = await buildPackPayload(args);
    if (packPayload) {
      payload = packPayload as unknown as Record<string, unknown>;
    }
  }
  if (!payload) {
    console.error("Adapter request payload is required.");
    console.error(USAGE);
    process.exit(1);
  }
  const requestErrors = validateAdapterRequest(payload);
  if (requestErrors.length) {
    console.error("Invalid adapter run request:");
    for (const error of requestErrors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const adapterUrl = resolveAdapterEndpoint(args.url);
  const certifyingLane = isCertifyingLane(args);
  if (certifyingLane && !args.url) {
    throw new Error(
      "Certifying lanes require an explicit --url adapter endpoint.",
    );
  }
  const traceOut = args.traceOut ?? DEFAULT_TRACE_OUT;
  const traceLimit = Number.isFinite(args.traceLimit)
    ? (args.traceLimit as number)
    : DEFAULT_TRACE_LIMIT;
  const authHeaders = buildAuthHeaders(args);
  const adapterPayload = payload as AdapterRunRequest;
  const useRemote = !!adapterUrl;
  let response: AdapterRunResponse;
  let localTrace: TrainingTraceRecord | null = null;
  let exportUrl: string | undefined;
  if (useRemote) {
    exportUrl = resolveExportEndpoint(args.exportUrl, adapterUrl as string);
    response = await runAdapter(
      adapterUrl as string,
      adapterPayload,
      authHeaders,
    );
  } else {
    const isConstraintPackRun =
      adapterPayload.mode === "constraint-pack" || !!adapterPayload.pack;
    if (!isConstraintPackRun) {
      throw new Error(
        "Local verify only supports constraint packs; pass --url or set CASIMIR_PUBLIC_BASE_URL for adapter runs.",
      );
    }
    const localResult = await runLocalConstraintPack(adapterPayload, args);
    response = localResult.response;
    localTrace = localResult.trace;
  }
  const responsePayload = JSON.stringify(response, null, 2);
  if (!args.quiet) {
    const responseStream = traceOut === "-" ? process.stderr : process.stdout;
    responseStream.write(`${responsePayload}\n`);
  }

  let traceExported = false;
  if (useRemote && exportUrl) {
    try {
      const exportRequestUrl = buildExportUrl(
        exportUrl,
        traceLimit,
        args.tenant,
      );
      const jsonl = await exportTraces(exportRequestUrl, authHeaders);
      await writeTraceOutput(jsonl, traceOut);
      traceExported = true;
    } catch (error) {
      console.error("[shadow-of-intent] trace export failed:", error);
      if (certifyingLane) {
        throw new Error(
          "Trace export must succeed in certifying lanes; synthetic fallback blocked.",
        );
      }
    }
  }
  if (!traceExported) {
    const fallbackTrace =
      localTrace ??
      buildFallbackTraceRecord({
        payload: adapterPayload,
        response,
        tenantId: args.tenant,
      });
    await writeTraceOutput(formatTraceJsonl(fallbackTrace), traceOut);
    traceExported = true;
  }

  const pass = response.pass === true || response.verdict === "PASS";
  if (!pass) {
    if (!args.quiet) {
      console.error("[shadow-of-intent] verdict: FAIL");
    }
    process.exit(2);
  }

  if (!args.quiet && traceExported) {
    console.error("[shadow-of-intent] verdict: PASS");
  }
}

export const runCasimirVerify = main;

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  runCasimirVerify().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
