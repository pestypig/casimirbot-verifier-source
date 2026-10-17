#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const isCertifyingLane = (args) => args.ci === true || process.env.CASIMIR_CERTIFY === "1";
const DEFAULT_TRACE_OUT = "training-trace.jsonl";
const DEFAULT_TRACE_LIMIT = 50;
const DEFAULT_REPORTS_DIR = process.env.CASIMIR_REPORTS_DIR ?? process.env.CI_REPORTS_DIR ?? "reports";
const USAGE = "Usage: shadow-of-intent verify [--json request.json] [--params '{...}'] " +
    "[--pack repo-convergence|tool-use-budget] [--auto-telemetry|--no-auto-telemetry] [--ci] " +
    "[--trace-id <id>] [--url https://host/api/agi/adapter/run] [--export-url https://host/api/agi/training-trace/export] " +
    `[--trace-out ${DEFAULT_TRACE_OUT}|-] [--trace-limit ${DEFAULT_TRACE_LIMIT}] ` +
    "[--token <jwt>] [--tenant <id>] [--quiet]\n" +
    "Local mode runs when no --url or CASIMIR_PUBLIC_BASE_URL is set. " +
    "Defaults to the tool-use-budget pack when no payload is provided.";
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);
const normalizePathCandidate = (value) => {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const resolvePath = (envKeys, fallback) => {
    const candidate = envKeys
        .map((key) => normalizePathCandidate(process.env[key]))
        .find((value) => value !== undefined) ?? fallback;
    return path.resolve(process.cwd(), candidate);
};
const resolvePathOverride = (explicit, envKeys, fallback) => {
    if (explicit) {
        return path.resolve(process.cwd(), explicit);
    }
    return resolvePath(envKeys, fallback);
};
const parseReportMaxBytes = () => {
    const requested = Number(process.env.CASIMIR_REPORT_MAX_BYTES ??
        process.env.CASIMIR_REPORTS_MAX_BYTES);
    if (!Number.isFinite(requested) || requested < 1) {
        return 25000000;
    }
    return Math.min(Math.max(10240, Math.floor(requested)), 200000000);
};
const REPORT_MAX_BYTES = parseReportMaxBytes();
const readFileIfSmall = async (filePath) => {
    try {
        const stat = await fs.stat(filePath);
        if (stat.size > REPORT_MAX_BYTES) {
            console.warn(`[shadow-of-intent] report too large (${stat.size} bytes), skipping ${filePath}`);
            return null;
        }
        return await fs.readFile(filePath, "utf8");
    }
    catch {
        return null;
    }
};
const readJsonIfExists = async (filePath) => {
    try {
        const raw = await readFileIfSmall(filePath);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
};
const readTextIfExists = async (filePath) => {
    return readFileIfSmall(filePath);
};
const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};
const toBooleanMetric = (value) => {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
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
const countAssertionResults = (value) => {
    if (!Array.isArray(value))
        return null;
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of value) {
        if (!entry || typeof entry !== "object")
            continue;
        const obj = entry;
        const assertions = obj.assertionResults;
        if (!Array.isArray(assertions))
            continue;
        for (const assertion of assertions) {
            if (!assertion || typeof assertion !== "object")
                continue;
            const status = assertion.status;
            if (typeof status !== "string")
                continue;
            const lowered = status.toLowerCase();
            if (["passed", "pass", "success"].includes(lowered)) {
                passed += 1;
                total += 1;
            }
            else if (["failed", "fail", "error"].includes(lowered)) {
                failed += 1;
                total += 1;
            }
            else if (["skipped", "pending", "todo", "disabled"].includes(lowered)) {
                skipped += 1;
                total += 1;
            }
        }
    }
    if (total === 0)
        return null;
    return { total, passed, failed, skipped };
};
const parseTestJsonSummary = (value) => {
    if (!value || typeof value !== "object")
        return null;
    const obj = value;
    let total = toNumber(obj.numTotalTests) ??
        toNumber(obj.totalTests) ??
        toNumber(obj.total) ??
        toNumber(obj.tests);
    let failed = toNumber(obj.numFailedTests) ??
        toNumber(obj.failedTests) ??
        toNumber(obj.failures) ??
        toNumber(obj.failed);
    let passed = toNumber(obj.numPassedTests) ??
        toNumber(obj.passedTests) ??
        toNumber(obj.passed);
    let skipped = toNumber(obj.numPendingTests) ??
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
    const status = failed !== undefined && total !== undefined
        ? failed > 0
            ? "fail"
            : "pass"
        : statusMetric !== undefined
            ? statusMetric
                ? "pass"
                : "fail"
            : undefined;
    if (total === undefined &&
        failed === undefined &&
        passed === undefined &&
        skipped === undefined &&
        status === undefined) {
        return null;
    }
    return { total, failed, passed, skipped, status };
};
const parseEslintSummary = (value) => {
    const results = Array.isArray(value)
        ? value
        : value &&
            typeof value === "object" &&
            Array.isArray(value.results)
            ? value.results
            : null;
    if (!results)
        return null;
    let errors = 0;
    let fatalErrors = 0;
    let warnings = 0;
    for (const entry of results) {
        if (!entry || typeof entry !== "object")
            continue;
        const obj = entry;
        errors += toNumber(obj.errorCount) ?? 0;
        fatalErrors += toNumber(obj.fatalErrorCount) ?? 0;
        warnings += toNumber(obj.warningCount) ?? 0;
    }
    return { errors, fatalErrors, warnings };
};
const parseTscStatus = (raw) => {
    const foundMatch = raw.match(/Found\s+(\d+)\s+errors?/i);
    if (foundMatch) {
        const count = Number(foundMatch[1]);
        if (Number.isFinite(count)) {
            return count > 0 ? "fail" : "pass";
        }
    }
    if (/Found\s+0\s+errors?/i.test(raw))
        return "pass";
    if (/error\s+TS\d+/i.test(raw) || /\bTS\d+:/i.test(raw))
        return "fail";
    return undefined;
};
const parseMetricMap = (raw) => {
    if (!raw)
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "string" ||
            value === null) {
            out[key] = value;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
};
const mergeRepoTelemetry = (base, override) => {
    if (!base && !override)
        return undefined;
    const merged = {
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
const mergeToolTelemetry = (base, override) => {
    if (!base && !override)
        return undefined;
    const merged = {
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
const hasTelemetryFields = (telemetry) => {
    if (!telemetry)
        return false;
    return Object.keys(telemetry).length > 0;
};
const buildRepoTelemetryFromEnv = () => {
    const env = process.env;
    const buildStatus = env.CASIMIR_BUILD_STATUS ?? env.CASIMIR_BUILD_OK;
    const buildExitCode = toNumber(env.CASIMIR_BUILD_EXIT_CODE);
    const buildDuration = toNumber(env.CASIMIR_BUILD_DURATION_MS);
    const testStatus = env.CASIMIR_TEST_STATUS ?? env.CASIMIR_TEST_OK;
    const testsFailed = toNumber(env.CASIMIR_TEST_FAILED);
    const testsPassed = toNumber(env.CASIMIR_TEST_PASSED);
    const testsTotal = toNumber(env.CASIMIR_TEST_TOTAL);
    const schemaContracts = env.CASIMIR_SCHEMA_CONTRACTS ?? env.CASIMIR_SCHEMA_OK;
    const depsCoherence = env.CASIMIR_DEPS_COHERENCE;
    const lintStatus = env.CASIMIR_LINT_STATUS;
    const typecheckStatus = env.CASIMIR_TYPECHECK_STATUS;
    const timeToGreenMs = toNumber(env.CASIMIR_TIME_TO_GREEN_MS);
    const metrics = (() => {
        const raw = env.CASIMIR_REPO_METRICS_JSON;
        if (!raw)
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object"
                ? parsed
                : undefined;
        }
        catch {
            return undefined;
        }
    })();
    const telemetry = {};
    if (buildStatus !== undefined ||
        buildExitCode !== undefined ||
        buildDuration !== undefined) {
        telemetry.build = {
            status: buildStatus,
            ok: toBooleanMetric(buildStatus),
            exitCode: buildExitCode,
            durationMs: buildDuration,
        };
    }
    if (testStatus !== undefined ||
        testsFailed !== undefined ||
        testsPassed !== undefined ||
        testsTotal !== undefined) {
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
const buildToolTelemetryFromEnv = () => {
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
        if (!raw)
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object"
                ? parsed
                : undefined;
        }
        catch {
            return undefined;
        }
    })();
    const telemetry = {};
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
const parseRepoTelemetryJson = (value) => {
    if (value.repo && typeof value.repo === "object") {
        return value.repo;
    }
    return value;
};
const parseToolTelemetryJson = (value) => {
    if (value.tool && typeof value.tool === "object") {
        return value.tool;
    }
    return value;
};
const buildRepoTelemetryFromReports = async (vitestPath, eslintPath, tscPath) => {
    const notes = [];
    const telemetry = {};
    const vitestRaw = await readJsonIfExists(vitestPath);
    const counts = parseTestJsonSummary(vitestRaw);
    if (counts) {
        telemetry.tests = {
            total: counts.total,
            failed: counts.failed,
            passed: counts.passed,
            status: counts.status,
        };
        notes.push(`telemetry_source=vitest:${path.relative(process.cwd(), vitestPath)}`);
    }
    const eslintRaw = await readJsonIfExists(eslintPath);
    const eslintTotals = parseEslintSummary(eslintRaw);
    if (eslintTotals) {
        telemetry.lint = {
            status: eslintTotals.errors + eslintTotals.fatalErrors > 0 ? "fail" : "pass",
        };
        notes.push(`telemetry_source=eslint:${path.relative(process.cwd(), eslintPath)}`);
    }
    const tscRaw = await readTextIfExists(tscPath);
    if (tscRaw) {
        const status = parseTscStatus(tscRaw);
        if (status) {
            telemetry.typecheck = { status };
            notes.push(`telemetry_source=tsc:${path.relative(process.cwd(), tscPath)}`);
        }
    }
    return {
        telemetry: hasTelemetryFields(telemetry) ? telemetry : undefined,
        notes,
    };
};
const collectRepoConvergenceTelemetry = async (options) => {
    const notes = [];
    let telemetry;
    const repoTelemetryPath = resolvePathOverride(options?.telemetryPath, ["CASIMIR_REPO_TELEMETRY_PATH", "CASIMIR_TELEMETRY_PATH"], path.join(DEFAULT_REPORTS_DIR, "repo-telemetry.json"));
    const repoTelemetryJson = await readJsonIfExists(repoTelemetryPath);
    if (repoTelemetryJson && typeof repoTelemetryJson === "object") {
        telemetry = mergeRepoTelemetry(telemetry, parseRepoTelemetryJson(repoTelemetryJson));
        notes.push(`telemetry_source=repo-telemetry:${path.relative(process.cwd(), repoTelemetryPath)}`);
    }
    const vitestPath = resolvePathOverride(options?.vitestPath, ["CASIMIR_TEST_VITEST_PATH", "VITEST_JSON_PATH"], path.join(DEFAULT_REPORTS_DIR, "vitest.json"));
    const eslintPath = resolvePathOverride(options?.eslintPath, ["CASIMIR_LINT_ESLINT_PATH", "ESLINT_JSON_PATH"], path.join(DEFAULT_REPORTS_DIR, "eslint.json"));
    const tscPath = resolvePathOverride(options?.tscPath, ["CASIMIR_TYPECHECK_TSC_PATH", "TSC_OUTPUT_PATH"], path.join(DEFAULT_REPORTS_DIR, "tsc.txt"));
    const reportTelemetry = await buildRepoTelemetryFromReports(vitestPath, eslintPath, tscPath);
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
const collectToolUseBudgetTelemetry = async (options) => {
    const notes = [];
    let telemetry;
    const toolTelemetryPath = resolvePathOverride(options?.telemetryPath, ["CASIMIR_TOOL_TELEMETRY_PATH", "CASIMIR_TELEMETRY_PATH"], path.join(DEFAULT_REPORTS_DIR, "tool-telemetry.json"));
    const toolTelemetryJson = await readJsonIfExists(toolTelemetryPath);
    if (toolTelemetryJson && typeof toolTelemetryJson === "object") {
        telemetry = mergeToolTelemetry(telemetry, parseToolTelemetryJson(toolTelemetryJson));
        notes.push(`telemetry_source=tool-telemetry:${path.relative(process.cwd(), toolTelemetryPath)}`);
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
const LOCAL_CONSTRAINT_PACKS = [
    {
        id: "repo-convergence",
        domain: "repo",
        version: 1,
        description: "Build/test convergence with contract + dependency coherence checks, plus time-to-green.",
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
                max: 1200000,
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
        description: "Tool-use governance: step/cost limits, forbidden ops, approvals, provenance.",
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
                max: 120000,
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
        description: "Audit-tag safety: provenance + verification coverage for risky IO/security surfaces.",
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
const getLocalConstraintPackById = (id) => LOCAL_CONSTRAINT_PACKS.find((pack) => pack.id === id);
const normalizeCustomerId = (value) => {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const hasAnyTelemetry = (telemetry) => {
    if (!telemetry)
        return false;
    return Object.keys(telemetry).length > 0;
};
const hasPolicyOverridePayload = (override) => {
    if (!override)
        return false;
    return (override.policy !== undefined ||
        override.certificate !== undefined ||
        (override.constraints?.length ?? 0) > 0 ||
        (override.proxies?.length ?? 0) > 0);
};
const mergeConstraintOverrides = (constraints, overrides, warnings, label = "constraint") => {
    if (!overrides || overrides.length === 0)
        return constraints;
    const overrideMap = new Map(overrides.map((override) => [override.id, override]));
    const merged = constraints.map((constraint) => {
        const override = overrideMap.get(constraint.id);
        if (!override)
            return constraint;
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
const applyConstraintPackOverrides = (pack, overrides) => {
    if (!overrides.length) {
        return { pack, warnings: [] };
    }
    let next = {
        ...pack,
        policy: { ...pack.policy },
        certificate: { ...pack.certificate },
        constraints: pack.constraints.map((constraint) => ({ ...constraint })),
        proxies: pack.proxies?.map((constraint) => ({ ...constraint })),
    };
    const warnings = [];
    for (const override of overrides) {
        if (override.policy) {
            next.policy = { ...next.policy, ...override.policy };
        }
        if (override.certificate) {
            next.certificate = { ...next.certificate, ...override.certificate };
        }
        if (override.constraints) {
            next.constraints = mergeConstraintOverrides(next.constraints, override.constraints, warnings, "constraint");
        }
        if (override.proxies) {
            if (next.proxies) {
                next.proxies = mergeConstraintOverrides(next.proxies, override.proxies, warnings, "proxy");
            }
            else {
                warnings.push("proxy_overrides_ignored");
            }
        }
    }
    return { pack: next, warnings };
};
const resolvePackAutoTelemetry = (input) => {
    if (input.autoTelemetry === true)
        return true;
    if (input.autoTelemetry === false) {
        return Boolean(input.telemetryPath ||
            input.junitPath ||
            input.vitestPath ||
            input.jestPath ||
            input.eslintPath ||
            input.tscPath ||
            input.toolLogTraceId ||
            input.toolLogWindowMs ||
            input.toolLogLimit);
    }
    if (input.telemetryPath ||
        input.junitPath ||
        input.vitestPath ||
        input.jestPath ||
        input.eslintPath ||
        input.tscPath ||
        input.toolLogTraceId ||
        input.toolLogWindowMs ||
        input.toolLogLimit) {
        return true;
    }
    return false;
};
const canonicalJson = (value) => JSON.stringify(value, (_key, v) => (v === undefined ? null : v));
const hashPayload = (value) => crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const issueConstraintPackCertificate = (input) => {
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
        certificateId: `constraint-pack:${input.pack.id}:${certificateHash.slice(0, 12)}`,
        integrityOk: true,
    };
};
const mergeMetricOverrides = (target, overrides) => {
    if (!overrides)
        return;
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) {
            target[key] = value;
        }
    }
};
const pickFirstDefined = (...values) => values.find((value) => value !== undefined);
const resolveStatusFromExitCode = (exitCode) => {
    if (!Number.isFinite(exitCode))
        return undefined;
    return exitCode === 0 ? 1 : 0;
};
const resolveTestStatus = (tests) => {
    if (!tests)
        return undefined;
    if (tests.failed !== undefined && Number.isFinite(tests.failed)) {
        return tests.failed > 0 ? 0 : 1;
    }
    if (tests.total !== undefined &&
        Number.isFinite(tests.total) &&
        tests.passed !== undefined &&
        Number.isFinite(tests.passed)) {
        return tests.passed === tests.total ? 1 : 0;
    }
    return tests.status;
};
const buildRepoConvergenceMetrics = (telemetry) => {
    const metrics = {};
    if (!telemetry)
        return metrics;
    const buildStatus = telemetry.build?.status ??
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
const buildToolUseBudgetMetrics = (telemetry) => {
    const metrics = {};
    if (!telemetry)
        return metrics;
    const stepUsage = pickFirstDefined(telemetry.steps?.used, telemetry.steps?.total);
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
    const toolCalls = pickFirstDefined(telemetry.tools?.calls, telemetry.tools?.total);
    if (toolCalls !== undefined) {
        metrics["tools.calls"] = toolCalls;
    }
    if (telemetry.metrics) {
        mergeMetricOverrides(metrics, telemetry.metrics);
    }
    return metrics;
};
const buildAuditSafetyMetrics = (telemetry) => {
    const metrics = {};
    if (!telemetry)
        return metrics;
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
const LADDER_ORDER = [
    "reduced-order",
    "diagnostic",
    "certified",
];
const isTierAtLeast = (tier, minimum) => {
    const tierIndex = LADDER_ORDER.indexOf(tier);
    const minimumIndex = LADDER_ORDER.indexOf(minimum);
    if (tierIndex === -1 || minimumIndex === -1)
        return false;
    return tierIndex >= minimumIndex;
};
const resolveLadderTier = (input) => {
    const actual = input.certified
        ? "certified"
        : input.proxy
            ? "reduced-order"
            : "diagnostic";
    if (!input.requested)
        return actual;
    const requestedIndex = LADDER_ORDER.indexOf(input.requested);
    const actualIndex = LADDER_ORDER.indexOf(actual);
    if (requestedIndex === -1 || actualIndex === -1)
        return actual;
    return requestedIndex <= actualIndex ? input.requested : actual;
};
const coerceMetricValue = (raw) => {
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
const formatLimitLabel = (constraint, threshold) => {
    if (threshold === undefined || !Number.isFinite(threshold)) {
        if (constraint.min !== undefined &&
            constraint.max !== undefined &&
            Number.isFinite(constraint.min) &&
            Number.isFinite(constraint.max)) {
            return `[${constraint.min}, ${constraint.max}]`;
        }
        return null;
    }
    const op = constraint.op?.trim();
    if (!op || op === "eq")
        return String(threshold);
    return `${op} ${threshold}`;
};
const resolveConstraintThreshold = (constraint) => {
    const op = (constraint.op ?? "").trim();
    if (op === "eq") {
        return {
            op,
            threshold: pickFirstDefined(constraint.limit, constraint.min, constraint.max),
        };
    }
    if (op === "<=" || op === "<") {
        return { op, threshold: pickFirstDefined(constraint.max, constraint.limit) };
    }
    if (op === ">=" || op === ">") {
        return { op, threshold: pickFirstDefined(constraint.min, constraint.limit) };
    }
    if (constraint.min !== undefined &&
        constraint.max !== undefined &&
        Number.isFinite(constraint.min) &&
        Number.isFinite(constraint.max)) {
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
const evaluateConstraint = (constraint, metrics) => {
    const metricKey = constraint.metric;
    const raw = metricKey ? metrics[metricKey] : undefined;
    const { value, issue } = coerceMetricValue(raw);
    const noteParts = [];
    let status = "unknown";
    let limit = null;
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
            if (typeof resolved.min === "number" &&
                typeof resolved.max === "number") {
                status =
                    value >= resolved.min && value <= resolved.max ? "pass" : "fail";
            }
            else {
                noteParts.push("limit_missing");
            }
        }
        else if (resolved.op === "eq") {
            if (threshold === undefined || !Number.isFinite(threshold)) {
                noteParts.push("limit_missing");
            }
            else {
                status = value === threshold ? "pass" : "fail";
            }
        }
        else if (resolved.op === "<=") {
            if (threshold === undefined || !Number.isFinite(threshold)) {
                noteParts.push("limit_missing");
            }
            else {
                status = value <= threshold ? "pass" : "fail";
            }
        }
        else if (resolved.op === "<") {
            if (threshold === undefined || !Number.isFinite(threshold)) {
                noteParts.push("limit_missing");
            }
            else {
                status = value < threshold ? "pass" : "fail";
            }
        }
        else if (resolved.op === ">=") {
            if (threshold === undefined || !Number.isFinite(threshold)) {
                noteParts.push("limit_missing");
            }
            else {
                status = value >= threshold ? "pass" : "fail";
            }
        }
        else if (resolved.op === ">") {
            if (threshold === undefined || !Number.isFinite(threshold)) {
                noteParts.push("limit_missing");
            }
            else {
                status = value > threshold ? "pass" : "fail";
            }
        }
        else if (resolved.op) {
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
const resolvePass = (pack, constraints) => {
    if (!constraints.length)
        return true;
    const relevant = pack.policy.mode === "hard-only"
        ? constraints.filter((entry) => entry.severity === "HARD")
        : constraints;
    if (!relevant.length)
        return true;
    const hasFail = relevant.some((entry) => entry.status === "fail");
    const hasUnknown = relevant.some((entry) => entry.status === "unknown");
    if (hasFail)
        return false;
    if (hasUnknown && pack.policy.unknownAsFail)
        return false;
    return true;
};
const resolveFirstFail = (constraints) => {
    const hardFail = constraints.find((entry) => entry.severity === "HARD" && entry.status === "fail");
    if (hardFail)
        return hardFail;
    return constraints.find((entry) => entry.status === "fail");
};
const resolveProxyFlag = (inputProxy, constraints) => {
    if (typeof inputProxy === "boolean") {
        return inputProxy;
    }
    const hasRealData = constraints.some((entry) => !entry.proxy && entry.status !== "unknown");
    const hasProxyData = constraints.some((entry) => entry.proxy && entry.status !== "unknown");
    if (!hasRealData && hasProxyData) {
        return true;
    }
    return undefined;
};
const evaluateConstraintPackFromMetrics = (pack, metrics, input = {}) => {
    const constraintResults = pack.constraints.map((constraint) => evaluateConstraint(constraint, metrics));
    const proxyResults = (pack.proxies ?? []).map((constraint) => evaluateConstraint(constraint, metrics));
    const allConstraints = [...constraintResults, ...proxyResults];
    let pass = resolvePass(pack, constraintResults);
    const firstFail = resolveFirstFail(constraintResults);
    const proxy = resolveProxyFlag(input.proxy, allConstraints);
    const autoCertificate = !input.certificate;
    let certificate = input.certificate ??
        issueConstraintPackCertificate({
            pack,
            metrics,
            constraints: allConstraints,
            proxy,
        });
    const certificateHash = certificate?.certificateHash ?? null;
    const hasCertificate = typeof certificateHash === "string" && certificateHash.trim().length > 0;
    const certified = pass && hasCertificate && certificate?.integrityOk === true && !proxy;
    const ladderTier = resolveLadderTier({
        requested: input.ladderTier,
        certified,
        proxy: Boolean(proxy),
    });
    const ladderNotes = [];
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
    ].filter((note) => typeof note === "string" && note.length > 0);
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
const normalizeLimit = (limit) => {
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
const normalizeConstraintResult = (entry) => ({
    ...entry,
    severity: entry.severity ?? "SOFT",
    status: entry.status ?? "unknown",
});
const toTrainingTraceConstraint = (entry) => {
    const normalized = normalizeConstraintResult(entry);
    return {
        id: normalized.id,
        severity: normalized.severity,
        status: normalized.status,
        value: typeof normalized.value === "number" && Number.isFinite(normalized.value)
            ? normalized.value
            : null,
        limit: normalizeLimit(normalized.limit),
        note: normalized.note,
    };
};
const pickFirstFailingHardConstraint = (constraints) => {
    const normalized = constraints.map(normalizeConstraintResult);
    const hardFail = normalized.find((entry) => entry.severity === "HARD" && entry.status === "fail");
    if (hardFail)
        return toTrainingTraceConstraint(hardFail);
    const anyFail = normalized.find((entry) => entry.status === "fail");
    return anyFail ? toTrainingTraceConstraint(anyFail) : undefined;
};
const resolveConstraintsPass = (pack, constraints) => {
    if (constraints.length === 0)
        return true;
    const normalized = constraints.map(normalizeConstraintResult);
    const relevant = pack.policy.mode === "hard-only"
        ? normalized.filter((entry) => entry.severity === "HARD")
        : normalized;
    if (relevant.length === 0)
        return true;
    const hasFail = relevant.some((entry) => entry.status === "fail");
    const hasUnknown = relevant.some((entry) => entry.status === "unknown");
    if (hasFail)
        return false;
    if (hasUnknown && pack.policy.unknownAsFail)
        return false;
    return true;
};
const resolveCertificatePass = (pack, evaluation) => {
    const certificate = evaluation.certificate;
    const requiresCertificate = pack.certificate.treatMissingCertificateAsNotCertified;
    const certificateHash = certificate?.certificateHash ?? null;
    const hasCertificate = typeof certificateHash === "string" && certificateHash.trim().length > 0;
    const status = certificate?.status;
    const statusOk = status === pack.certificate.admissibleStatus ||
        (pack.certificate.allowMarginalAsViable === true &&
            status === "MARGINAL");
    const integrityOk = certificate?.integrityOk !== false;
    if (!integrityOk)
        return false;
    if (!hasCertificate) {
        return !requiresCertificate;
    }
    return statusOk ?? false;
};
const resolveProxyFlagForTrace = (constraints) => {
    const hasRealData = constraints.some((entry) => !entry.proxy && entry.status !== "unknown");
    const hasProxyData = constraints.some((entry) => entry.proxy && entry.status !== "unknown");
    return !hasRealData && hasProxyData;
};
const resolveSignal = (pack, evaluation, pass, proxy) => {
    const certificate = evaluation.certificate;
    const hasCertificate = typeof certificate?.certificateHash === "string" &&
        certificate.certificateHash.trim().length > 0;
    const certified = pass && hasCertificate && certificate?.integrityOk === true && !proxy;
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
const sanitizeMetrics = (metrics) => {
    if (!metrics)
        return undefined;
    const cleaned = {};
    for (const [key, value] of Object.entries(metrics)) {
        if (value === undefined)
            continue;
        cleaned[key] = value;
    }
    return Object.keys(cleaned).length ? cleaned : undefined;
};
const ensureTrainingTraceCertificate = (certificate) => {
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
const buildConstraintPackTraceRecord = (input) => {
    const constraints = input.evaluation.constraints ?? [];
    const pass = input.evaluation.pass ??
        (resolveConstraintsPass(input.pack, constraints) &&
            resolveCertificatePass(input.pack, input.evaluation));
    const proxy = typeof input.evaluation.proxy === "boolean"
        ? input.evaluation.proxy
        : resolveProxyFlagForTrace(constraints);
    const firstFail = input.evaluation.firstFail
        ? toTrainingTraceConstraint(input.evaluation.firstFail)
        : pickFirstFailingHardConstraint(constraints);
    const certificate = ensureTrainingTraceCertificate(input.evaluation.certificate);
    const deltas = input.evaluation.deltas ?? [];
    const signal = resolveSignal(input.pack, input.evaluation, pass, proxy);
    const notes = input.evaluation.notes?.filter((note) => typeof note === "string" && note.trim().length > 0);
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
const NON_CERTIFYING_FALLBACK_NOTE = "synthetic_fallback_non_certifying=true";
export const buildFallbackTraceRecord = (input) => {
    const traceId = input.response.traceId ??
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
        ? sanitizeMetrics(input.payload.pack.metrics)
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
const runLocalConstraintPack = async (payload, args) => {
    if (!payload.pack) {
        throw new Error("Provide pack details for constraint-pack mode.");
    }
    const resolvedPack = getLocalConstraintPackById(payload.pack.id);
    if (!resolvedPack) {
        throw new Error("constraint-pack-not-found");
    }
    const requestedCustomerId = normalizeCustomerId(payload.pack.customerId);
    if (args.tenant &&
        requestedCustomerId &&
        args.tenant !== requestedCustomerId) {
        throw new Error("tenant-mismatch");
    }
    if (payload.pack.policyProfileId) {
        throw new Error("policy-profile-not-supported");
    }
    const policyNotes = [];
    const overrides = [];
    if (payload.pack.policyOverride && isPlainObject(payload.pack.policyOverride)) {
        const inlineOverride = payload.pack.policyOverride;
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
            policyNotes.push(...resolved.warnings.map((warning) => `policy_${warning}`));
        }
    }
    const shouldAutoTelemetry = effectivePack.id === "provenance-safety"
        ? payload.pack.autoTelemetry !== false
        : resolvePackAutoTelemetry(payload.pack);
    let telemetry = payload.pack.telemetry;
    const autoTelemetryNotes = [];
    if (shouldAutoTelemetry) {
        if (effectivePack.id === "repo-convergence") {
            const collected = await collectRepoConvergenceTelemetry({
                telemetryPath: payload.pack.telemetryPath,
                vitestPath: payload.pack.vitestPath,
                eslintPath: payload.pack.eslintPath,
                tscPath: payload.pack.tscPath,
            });
            if (collected.telemetry) {
                telemetry = mergeRepoTelemetry(telemetry, collected.telemetry);
            }
            autoTelemetryNotes.push(...collected.notes);
        }
        else if (effectivePack.id === "tool-use-budget") {
            const collected = await collectToolUseBudgetTelemetry({
                telemetryPath: payload.pack.telemetryPath,
            });
            if (collected.telemetry) {
                telemetry = mergeToolTelemetry(telemetry, collected.telemetry);
            }
            autoTelemetryNotes.push(...collected.notes);
        }
        else if (!telemetry && !payload.pack.metrics) {
            autoTelemetryNotes.push(`telemetry_auto_unavailable=${effectivePack.id}`);
        }
    }
    if (!hasAnyTelemetry(telemetry) && !hasAnyTelemetry(payload.pack.metrics)) {
        throw new Error("constraint-pack-telemetry-missing");
    }
    const metrics = effectivePack.id === "repo-convergence"
        ? buildRepoConvergenceMetrics(telemetry)
        : effectivePack.id === "tool-use-budget"
            ? buildToolUseBudgetMetrics(telemetry)
            : buildAuditSafetyMetrics(telemetry);
    mergeMetricOverrides(metrics, payload.pack.metrics);
    const evaluationNotes = [
        ...(payload.pack.notes ?? []),
        ...policyNotes,
        ...autoTelemetryNotes,
    ];
    const evaluation = evaluateConstraintPackFromMetrics(effectivePack, metrics, {
        certificate: payload.pack.certificate,
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
const normalizeEndpoint = (input, endpointPath) => {
    if (!isHttpUrl(input)) {
        throw new Error(`Endpoint must be an absolute URL: ${input}`);
    }
    if (input.includes("/api/")) {
        return input;
    }
    return `${input.replace(/\/+$/, "")}${endpointPath}`;
};
export const resolveAdapterEndpoint = (explicit) => {
    if (explicit) {
        return normalizeEndpoint(explicit, "/api/agi/adapter/run");
    }
    const base = process.env.CASIMIR_PUBLIC_BASE_URL ??
        process.env.SHADOW_OF_INTENT_BASE_URL;
    if (isHttpUrl(base)) {
        return normalizeEndpoint(base, "/api/agi/adapter/run");
    }
    const direct = process.env.CASIMIR_VERIFY_URL ?? process.env.AGI_ADAPTER_URL;
    if (direct) {
        return normalizeEndpoint(direct, "/api/agi/adapter/run");
    }
    return undefined;
};
const resolveExportEndpoint = (explicit, adapterUrl) => {
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
const normalizeToken = (value) => {
    if (!value)
        return undefined;
    return value.startsWith("Bearer ") ? value : `Bearer ${value}`;
};
const buildAuthHeaders = (args) => {
    const headers = {};
    const token = normalizeToken(args.token);
    if (token)
        headers.Authorization = token;
    if (args.tenant)
        headers["X-Tenant-Id"] = args.tenant;
    if (args.traceparent)
        headers.traceparent = args.traceparent;
    if (args.tracestate)
        headers.tracestate = args.tracestate;
    return headers;
};
const parseArgs = () => {
    const args = process.argv.slice(2);
    if (args[0] === "verify") {
        args.shift();
    }
    const parsed = {};
    const takeValue = (token, next) => {
        if (token.includes("="))
            return token.split("=", 2)[1];
        return next;
    };
    for (let i = 0; i < args.length; i += 1) {
        const token = args[i];
        const next = args[i + 1];
        if (token === "--help" || token === "-h") {
            parsed.help = true;
        }
        else if (token === "--json" || token === "-j") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.jsonPath = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--params" || token === "-p") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.rawJson = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--url") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.url = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--export-url") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.exportUrl = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--trace-out" || token === "-o") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.traceOut = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--trace-limit" || token === "-l") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.traceLimit = Number(value);
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--token") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.token = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--tenant") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.tenant = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--traceparent") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.traceparent = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--trace-id") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.traceId = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--pack") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.packId = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--auto-telemetry") {
            parsed.autoTelemetry = true;
        }
        else if (token === "--no-auto-telemetry") {
            parsed.autoTelemetry = false;
        }
        else if (token === "--ci") {
            parsed.ci = true;
        }
        else if (token === "--tracestate") {
            const value = takeValue(token, next);
            if (value !== undefined) {
                parsed.tracestate = value;
                if (!token.includes("="))
                    i += 1;
            }
        }
        else if (token === "--quiet" || token === "-q") {
            parsed.quiet = true;
        }
    }
    return parsed;
};
const loadPayload = async (jsonPath, rawJson) => {
    const payload = {};
    if (jsonPath) {
        const src = await fs.readFile(jsonPath, "utf8");
        const parsed = JSON.parse(src);
        if (!parsed || typeof parsed !== "object") {
            throw new Error("Request JSON must be an object.");
        }
        Object.assign(payload, parsed);
    }
    if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (!parsed || typeof parsed !== "object") {
            throw new Error("Inline params must be a JSON object.");
        }
        Object.assign(payload, parsed);
    }
    return payload;
};
const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const validateAdapterRequest = (payload) => {
    const errors = [];
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
const isAdapterRunResponse = (value) => {
    if (!isPlainObject(value))
        return false;
    if (typeof value.pass === "boolean")
        return true;
    if (typeof value.verdict === "string")
        return true;
    return false;
};
const runAdapter = async (url, payload, headers) => {
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
const buildExportUrl = (baseUrl, limit, tenant) => {
    const url = new URL(baseUrl);
    if (Number.isFinite(limit) && limit > 0) {
        url.searchParams.set("limit", String(limit));
    }
    if (tenant) {
        url.searchParams.set("tenantId", tenant);
    }
    return url.toString();
};
const exportTraces = async (url, headers) => {
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
const formatTraceJsonl = (record) => {
    const entries = Array.isArray(record) ? record : [record];
    return entries.map((entry) => JSON.stringify(entry)).join("\n");
};
const writeTraceOutput = async (output, outPath) => {
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
const resolvePackId = (args) => {
    if (args.packId)
        return args.packId;
    if (args.ci)
        return "repo-convergence";
    return "tool-use-budget";
};
const resolveTraceId = (args, packId) => {
    if (args.traceId)
        return args.traceId;
    if (process.env.CI) {
        const env = process.env;
        const runId = env.GITHUB_RUN_ID ??
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
const resolveAutoTelemetry = (args, packId) => {
    if (typeof args.autoTelemetry === "boolean") {
        return args.autoTelemetry;
    }
    if (args.ci || args.packId || packId) {
        return true;
    }
    return undefined;
};
const buildPackPayload = async (args) => {
    const packId = resolvePackId(args);
    if (!packId)
        return null;
    const autoTelemetry = resolveAutoTelemetry(args, packId);
    const traceId = resolveTraceId(args, packId);
    const pack = { id: packId };
    if (autoTelemetry !== undefined) {
        pack.autoTelemetry = autoTelemetry;
    }
    if (autoTelemetry && packId === "repo-convergence") {
        const localTelemetry = await collectRepoConvergenceTelemetry();
        if (localTelemetry.telemetry) {
            pack.telemetry = localTelemetry.telemetry;
        }
        if (localTelemetry.notes.length > 0) {
            pack.notes = localTelemetry.notes;
        }
    }
    else if (autoTelemetry && packId === "tool-use-budget") {
        const localTelemetry = await collectToolUseBudgetTelemetry();
        if (localTelemetry.telemetry) {
            pack.telemetry = localTelemetry.telemetry;
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
    let payload;
    if (args.jsonPath || args.rawJson) {
        payload = await loadPayload(args.jsonPath, args.rawJson);
    }
    else {
        const packPayload = await buildPackPayload(args);
        if (packPayload) {
            payload = packPayload;
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
        throw new Error("Certifying lanes require an explicit --url adapter endpoint.");
    }
    const traceOut = args.traceOut ?? DEFAULT_TRACE_OUT;
    const traceLimit = Number.isFinite(args.traceLimit)
        ? args.traceLimit
        : DEFAULT_TRACE_LIMIT;
    const authHeaders = buildAuthHeaders(args);
    const adapterPayload = payload;
    const useRemote = !!adapterUrl;
    let response;
    let localTrace = null;
    let exportUrl;
    if (useRemote) {
        exportUrl = resolveExportEndpoint(args.exportUrl, adapterUrl);
        response = await runAdapter(adapterUrl, adapterPayload, authHeaders);
    }
    else {
        const isConstraintPackRun = adapterPayload.mode === "constraint-pack" || !!adapterPayload.pack;
        if (!isConstraintPackRun) {
            throw new Error("Local verify only supports constraint packs; pass --url or set CASIMIR_PUBLIC_BASE_URL for adapter runs.");
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
            const exportRequestUrl = buildExportUrl(exportUrl, traceLimit, args.tenant);
            const jsonl = await exportTraces(exportRequestUrl, authHeaders);
            await writeTraceOutput(jsonl, traceOut);
            traceExported = true;
        }
        catch (error) {
            console.error("[shadow-of-intent] trace export failed:", error);
            if (certifyingLane) {
                throw new Error("Trace export must succeed in certifying lanes; synthetic fallback blocked.");
            }
        }
    }
    if (!traceExported) {
        const fallbackTrace = localTrace ??
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
const isEntrypoint = process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
    runCasimirVerify().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
