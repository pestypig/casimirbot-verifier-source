import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

type MetricValue = string | boolean | number | null | undefined;

type RepoTelemetry = {
  build?: {
    status?: MetricValue;
    ok?: boolean;
    exitCode?: number;
    durationMs?: number;
  };
  tests?: {
    status?: MetricValue;
    ok?: boolean;
    failed?: number;
    passed?: number;
    total?: number;
  };
  schema?: {
    contracts?: MetricValue;
    ok?: boolean;
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
  metrics?: Record<string, unknown>;
};

type TestCounts = {
  total?: number;
  failed?: number;
  passed?: number;
  skipped?: number;
  status?: "pass" | "fail";
};

type StepResult = {
  label: string;
  code: number;
  durationMs?: number;
  ran: boolean;
};

type RawOptions = {
  reportsDir: string;
  telemetryOut?: string;
  junitPaths: string[];
  vitestPath?: string;
  eslintPath?: string;
  tscPath?: string;
  run: boolean;
  runBuild: boolean;
  runTests: boolean;
  runEslint: boolean;
  runTsc: boolean;
  allowFail: boolean;
};

type CollectOptions = {
  reportsDir: string;
  repoTelemetryPath: string;
  vitestPath: string;
  eslintPath: string;
  tscPath: string;
  run: boolean;
  runBuild: boolean;
  runTests: boolean;
  runEslint: boolean;
  runTsc: boolean;
  allowFail: boolean;
};

const DEFAULT_REPORTS_DIR =
  process.env.CASIMIR_REPORTS_DIR ?? process.env.CI_REPORTS_DIR ?? "reports";

const TARGETS = [
  "client/src/**/*.{js,jsx,ts,tsx}",
  "server/**/*.{js,jsx,ts,tsx}",
  "shared/**/*.{js,jsx,ts,tsx}",
  "scripts/**/*.{js,jsx,ts,tsx}",
  "tests/**/*.{js,jsx,ts,tsx}",
  "tools/**/*.{js,jsx,ts,tsx}",
  "cli/**/*.{js,jsx,ts,tsx}",
  "sdk/**/*.{js,jsx,ts,tsx}",
  "modules/**/*.{js,jsx,ts,tsx}",
];

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
];

const usage = (): void => {
  console.log("Usage: shadow-of-intent collect [options]");
  console.log("Options:");
  console.log("  --reports-dir <path>   Output directory for reports.");
  console.log("  --telemetry-out <path> Repo telemetry output JSON.");
  console.log("  --junit-path <path>    JUnit XML report path (repeatable).");
  console.log("  --vitest-path <path>   Vitest JSON report path.");
  console.log("  --eslint-path <path>   ESLint JSON report path.");
  console.log("  --tsc-path <path>      tsc output path.");
  console.log("  --no-run               Skip running build/test/lint/tsc.");
  console.log("  --no-build             Skip build.");
  console.log("  --no-tests             Skip tests.");
  console.log("  --no-eslint            Skip eslint.");
  console.log("  --no-tsc               Skip tsc.");
  console.log("  --allow-fail           Do not exit non-zero on failed steps.");
  console.log("  -h, --help             Show this help.");
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

const resolveReportPath = (envKeys: string[], fallbackName: string): string => {
  for (const key of envKeys) {
    const envValue = process.env[key]?.trim();
    if (envValue) {
      return path.resolve(process.cwd(), envValue);
    }
  }
  return path.resolve(process.cwd(), fallbackName);
};

const ensureDir = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const extractArgValue = (
  arg: string,
  nextValue: string | undefined,
): { value: string; consumedNext: boolean } => {
  const eqIndex = arg.indexOf("=");
  if (eqIndex !== -1) {
    return { value: arg.slice(eqIndex + 1), consumedNext: false };
  }
  if (nextValue) {
    return { value: nextValue, consumedNext: true };
  }
  return { value: "", consumedNext: false };
};

const pushListValues = (value: string, target: string[]): void => {
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => target.push(entry));
};

const parseArgs = (): RawOptions => {
  const args = process.argv.slice(2);
  const options: RawOptions = {
    reportsDir: DEFAULT_REPORTS_DIR,
    telemetryOut: undefined,
    junitPaths: [],
    vitestPath: undefined,
    eslintPath: undefined,
    tscPath: undefined,
    run: true,
    runBuild: true,
    runTests: true,
    runEslint: true,
    runTsc: true,
    allowFail: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg.startsWith("--reports-dir")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --reports-dir requires a path.");
        process.exit(1);
      }
      options.reportsDir = value;
      if (consumedNext) i += 1;
      continue;
    }
    if (arg.startsWith("--telemetry-out")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --telemetry-out requires a path.");
        process.exit(1);
      }
      options.telemetryOut = value;
      if (consumedNext) i += 1;
      continue;
    }
    if (arg.startsWith("--junit-path")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --junit-path requires a path.");
        process.exit(1);
      }
      pushListValues(value, options.junitPaths);
      if (consumedNext) i += 1;
      continue;
    }
    if (arg.startsWith("--vitest-path")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --vitest-path requires a path.");
        process.exit(1);
      }
      options.vitestPath = value;
      if (consumedNext) i += 1;
      continue;
    }
    if (arg.startsWith("--eslint-path")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --eslint-path requires a path.");
        process.exit(1);
      }
      options.eslintPath = value;
      if (consumedNext) i += 1;
      continue;
    }
    if (arg.startsWith("--tsc-path")) {
      const { value, consumedNext } = extractArgValue(arg, args[i + 1]);
      if (!value) {
        console.error("[collect] --tsc-path requires a path.");
        process.exit(1);
      }
      options.tscPath = value;
      if (consumedNext) i += 1;
      continue;
    }
    if (arg === "--no-run") {
      options.run = false;
      continue;
    }
    if (arg === "--no-build") {
      options.runBuild = false;
      continue;
    }
    if (arg === "--no-tests") {
      options.runTests = false;
      continue;
    }
    if (arg === "--no-eslint") {
      options.runEslint = false;
      continue;
    }
    if (arg === "--no-tsc") {
      options.runTsc = false;
      continue;
    }
    if (arg === "--allow-fail") {
      options.allowFail = true;
      continue;
    }
    console.error(`[collect] Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }

  if (!options.run) {
    options.runBuild = false;
    options.runTests = false;
    options.runEslint = false;
    options.runTsc = false;
  }

  const allowFailEnv =
    process.env.CI_REPORTS_ALLOW_FAIL === "1" ||
    process.env.CI_REPORTS_ALLOW_FAIL === "true" ||
    process.env.CASIMIR_REPORTS_ALLOW_FAIL === "1" ||
    process.env.CASIMIR_REPORTS_ALLOW_FAIL === "true";
  if (allowFailEnv) {
    options.allowFail = true;
  }

  return options;
};

const resolveOptions = (raw: RawOptions): CollectOptions => {
  const reportsDir = path.resolve(process.cwd(), raw.reportsDir);
  const repoTelemetryPath = raw.telemetryOut
    ? path.resolve(process.cwd(), raw.telemetryOut)
    : resolveReportPath(
        ["CASIMIR_REPO_TELEMETRY_PATH", "CASIMIR_TELEMETRY_PATH"],
        path.join(reportsDir, "repo-telemetry.json"),
      );
  const vitestPath = raw.vitestPath
    ? path.resolve(process.cwd(), raw.vitestPath)
    : resolveReportPath(
        ["CASIMIR_TEST_VITEST_PATH", "CASIMIR_TEST_JEST_PATH"],
        path.join(reportsDir, "vitest.json"),
      );
  const eslintPath = raw.eslintPath
    ? path.resolve(process.cwd(), raw.eslintPath)
    : resolveReportPath(
        ["CASIMIR_LINT_ESLINT_PATH"],
        path.join(reportsDir, "eslint.json"),
      );
  const tscPath = raw.tscPath
    ? path.resolve(process.cwd(), raw.tscPath)
    : resolveReportPath(
        ["CASIMIR_TYPECHECK_TSC_PATH"],
        path.join(reportsDir, "tsc.txt"),
      );

  return {
    reportsDir,
    repoTelemetryPath,
    vitestPath,
    eslintPath,
    tscPath,
    run: raw.run,
    runBuild: raw.runBuild,
    runTests: raw.runTests,
    runEslint: raw.runEslint,
    runTsc: raw.runTsc,
    allowFail: raw.allowFail,
  };
};

const require = createRequire(import.meta.url);

const resolvePackageBin = (name: string): string | null => {
  try {
    const pkgPath = require.resolve(`${name}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = pkg.bin;
    const binRel =
      typeof bin === "string"
        ? bin
        : bin && typeof bin === "object"
          ? bin[name] ?? Object.values(bin)[0]
          : undefined;
    if (!binRel) return null;
    return path.resolve(path.dirname(pkgPath), binRel);
  } catch {
    return null;
  }
};

const runNodeBin = (
  binPath: string,
  args: string[],
  options?: { stdio?: "inherit" | "pipe" },
): ReturnType<typeof spawn> =>
  spawn(process.execPath, [binPath, ...args], { stdio: options?.stdio ?? "pipe" });

const runShellCommand = (command: string, args: string[]): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

const runCommand = (command: string, args: string[]): Promise<number> =>
  new Promise((resolve) => {
    const child = runNodeBin(command, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

const runCommandCapture = (
  command: string,
  args: string[],
  outputPath: string,
): Promise<number> =>
  new Promise((resolve) => {
    let buffer = "";
    const child = runNodeBin(command, args);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      buffer += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      buffer += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => {
      let output = buffer;
      if ((code ?? 1) === 0 && output.trim().length === 0) {
        output = "Found 0 errors.\n";
      }
      ensureDir(outputPath);
      fs.writeFileSync(outputPath, output, "utf8");
      resolve(code ?? 1);
    });
    child.on("error", () => {
      const output = "Typecheck failed to execute.\n";
      ensureDir(outputPath);
      fs.writeFileSync(outputPath, output, "utf8");
      resolve(1);
    });
  });

const readJson = (filePath: string): unknown => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const readText = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
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
  const metaSkipped =
    value &&
    typeof value === "object" &&
    Boolean((value as { meta?: { skipped?: boolean } }).meta?.skipped);
  if (metaSkipped) return null;
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

const parseXmlAttributes = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const regex = /([:\w-]+)=(["'])(.*?)\2/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(tag)) !== null) {
    attrs[match[1]] = match[3];
  }
  return attrs;
};

const parseJunitSummary = (raw: string): TestCounts | null => {
  const suiteTags = raw.match(/<testsuite\b[^>]*>/gi);
  if (!suiteTags) return null;
  let total = 0;
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  let sawCounts = false;
  for (const tag of suiteTags) {
    const attrs = parseXmlAttributes(tag);
    const tests = toNumber(attrs.tests);
    const failuresCount = toNumber(attrs.failures);
    const errorsCount = toNumber(attrs.errors);
    const skippedCount = toNumber(attrs.skipped ?? attrs.disabled);
    if (
      tests !== undefined ||
      failuresCount !== undefined ||
      errorsCount !== undefined ||
      skippedCount !== undefined
    ) {
      sawCounts = true;
    }
    total += tests ?? 0;
    failures += failuresCount ?? 0;
    errors += errorsCount ?? 0;
    skipped += skippedCount ?? 0;
  }
  if (!sawCounts) return null;
  const failed = failures + errors;
  const passed =
    total > 0 ? Math.max(0, total - failed - skipped) : undefined;
  const status = total > 0 ? (failed > 0 ? "fail" : "pass") : undefined;
  return { total, failed, passed, skipped, status };
};

const parseJunitReports = (paths: string[]): TestCounts | null => {
  if (!paths.length) return null;
  let total = 0;
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  let sawCounts = false;
  for (const filePath of paths) {
    const raw = readText(filePath);
    if (!raw) continue;
    const summary = parseJunitSummary(raw);
    if (!summary) continue;
    sawCounts = true;
    total += summary.total ?? 0;
    failed += summary.failed ?? 0;
    passed += summary.passed ?? 0;
    skipped += summary.skipped ?? 0;
  }
  if (!sawCounts) return null;
  const finalTotal = total > 0 ? total : undefined;
  const finalFailed = failed > 0 ? failed : undefined;
  const finalSkipped = skipped > 0 ? skipped : undefined;
  const finalPassed =
    finalTotal !== undefined
      ? Math.max(0, finalTotal - (finalFailed ?? 0) - (finalSkipped ?? 0))
      : passed > 0
        ? passed
        : undefined;
  const status =
    finalFailed !== undefined
      ? finalFailed > 0
        ? "fail"
        : "pass"
      : finalTotal !== undefined
        ? "pass"
        : undefined;
  return {
    total: finalTotal,
    failed: finalFailed,
    passed: finalPassed,
    skipped: finalSkipped,
    status,
  };
};

const collectXmlFiles = (dirPath: string): string[] => {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xml"))
    .map((entry) => path.join(dirPath, entry.name));
};

const resolveJunitPaths = (raw: RawOptions, reportsDir: string): string[] => {
  const candidates = new Set<string>();
  let explicit = false;

  if (raw.junitPaths.length > 0) {
    explicit = true;
    raw.junitPaths.forEach((entry) =>
      candidates.add(path.resolve(process.cwd(), entry)),
    );
  } else {
    const envPaths = [
      process.env.CASIMIR_TEST_JUNIT_PATH,
      process.env.JUNIT_PATH,
    ]
      .filter(Boolean)
      .flatMap((value) => value!.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (envPaths.length > 0) {
      explicit = true;
      envPaths.forEach((entry) =>
        candidates.add(path.resolve(process.cwd(), entry)),
      );
    }
  }

  const addDefaults = () => {
    const common = [
      path.join(reportsDir, "junit.xml"),
      path.join(reportsDir, "junit-report.xml"),
      path.join(reportsDir, "junit-results.xml"),
      path.join(reportsDir, "test-results.xml"),
      path.join(process.cwd(), "junit.xml"),
    ];
    common.forEach((entry) => candidates.add(entry));
    collectXmlFiles(reportsDir).forEach((entry) => candidates.add(entry));
    collectXmlFiles(path.join(process.cwd(), "test-results")).forEach((entry) =>
      candidates.add(entry),
    );
  };

  if (!explicit) {
    addDefaults();
  }

  let resolved = Array.from(candidates).filter((entry) => fs.existsSync(entry));
  if (resolved.length === 0 && explicit) {
    addDefaults();
    resolved = Array.from(candidates).filter((entry) => fs.existsSync(entry));
  }

  return resolved;
};

const readPackageScripts = (): Record<string, string> => {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
};

const mergeRepoTelemetry = (
  base?: RepoTelemetry,
  override?: RepoTelemetry,
): RepoTelemetry | undefined => {
  if (!base && !override) return undefined;
  const merged: RepoTelemetry = {
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
    merged.typecheck = { ...(base?.typecheck ?? {}), ...(override?.typecheck ?? {}) };
  }
  if (base?.metrics || override?.metrics) {
    merged.metrics = { ...(base?.metrics ?? {}), ...(override?.metrics ?? {}) };
  }
  return merged;
};

const buildRepoTelemetryFromEnv = (): RepoTelemetry => {
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

  const telemetry: RepoTelemetry = {};
  if (buildStatus !== undefined || buildExitCode !== undefined || buildDuration !== undefined) {
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
    telemetry.metrics = metrics;
  }
  return telemetry;
};

const buildRepoTelemetryFromReports = (
  options: CollectOptions,
  junitPaths: string[],
): RepoTelemetry => {
  const telemetry: RepoTelemetry = {};
  const testJson = readJson(options.vitestPath);
  let testCounts = parseTestJsonSummary(testJson);
  if (!testCounts) {
    testCounts = parseJunitReports(junitPaths);
  }
  if (testCounts) {
    telemetry.tests = {
      total: testCounts.total,
      failed: testCounts.failed,
      passed: testCounts.passed,
      status: testCounts.status,
    };
  }

  const eslintJson = readJson(options.eslintPath);
  const eslintTotals = parseEslintSummary(eslintJson);
  if (eslintTotals) {
    telemetry.lint = {
      status: eslintTotals.errors + eslintTotals.fatalErrors > 0 ? "fail" : "pass",
    };
  }

  const tscRaw = readText(options.tscPath);
  if (tscRaw) {
    const status = parseTscStatus(tscRaw);
    if (status) {
      telemetry.typecheck = {
        status,
      };
    }
  }

  return telemetry;
};

const resolveTestStatus = (
  tests?: RepoTelemetry["tests"],
): MetricValue => {
  if (!tests) return undefined;
  if (tests.failed !== undefined && Number.isFinite(tests.failed)) {
    return tests.failed > 0 ? "fail" : "pass";
  }
  if (
    tests.total !== undefined &&
    Number.isFinite(tests.total) &&
    tests.passed !== undefined &&
    Number.isFinite(tests.passed)
  ) {
    const failed = Math.max(0, tests.total - tests.passed);
    return failed > 0 ? "fail" : "pass";
  }
  if (tests.status !== undefined) return tests.status;
  if (tests.ok !== undefined) return tests.ok;
  return undefined;
};

const normalizeTelemetry = (telemetry: RepoTelemetry): RepoTelemetry => {
  if (telemetry.build) {
    const ok = telemetry.build.ok ?? toBooleanMetric(telemetry.build.status);
    if (ok !== undefined) {
      telemetry.build.ok = ok;
      if (telemetry.build.status === undefined) {
        telemetry.build.status = ok;
      }
    }
  }

  if (telemetry.tests) {
    const status =
      telemetry.tests.status ?? resolveTestStatus(telemetry.tests);
    if (status !== undefined) {
      telemetry.tests.status = status;
    }
    const ok = telemetry.tests.ok ?? toBooleanMetric(telemetry.tests.status);
    if (ok !== undefined) {
      telemetry.tests.ok = ok;
    }
  }

  if (telemetry.schema) {
    if (telemetry.schema.ok === undefined) {
      telemetry.schema.ok = toBooleanMetric(telemetry.schema.contracts);
    }
    if (
      telemetry.schema.contracts === undefined &&
      telemetry.schema.ok !== undefined
    ) {
      telemetry.schema.contracts = telemetry.schema.ok;
    }
  }

  if (!telemetry.schema || telemetry.schema.contracts === undefined) {
    const fallback =
      telemetry.typecheck?.status ?? telemetry.build?.status;
    if (fallback !== undefined) {
      telemetry.schema = {
        ...(telemetry.schema ?? {}),
        contracts: fallback,
        ok: toBooleanMetric(fallback),
      };
    }
  }

  return telemetry;
};

const readRepoTelemetry = (filePath: string): RepoTelemetry | undefined => {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { repo?: RepoTelemetry };
    if (parsed && typeof parsed === "object" && parsed.repo) {
      return parsed.repo;
    }
    return parsed as RepoTelemetry;
  } catch {
    return undefined;
  }
};

const writeRepoTelemetry = (
  telemetry: RepoTelemetry | undefined,
  filePath: string,
): void => {
  const payload = {
    generatedAt: new Date().toISOString(),
    repo: telemetry ?? {},
  };
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const getNpmCommand = (): string =>
  process.platform === "win32" ? "npm.cmd" : "npm";

const runBuild = async (scripts: Record<string, string>): Promise<StepResult> => {
  if (!scripts.build) {
    return { label: "build", code: 0, ran: false };
  }
  const start = Date.now();
  const code = await runShellCommand(getNpmCommand(), ["run", "build"]);
  return {
    label: "build",
    code,
    durationMs: Date.now() - start,
    ran: true,
  };
};

const runTests = async (
  options: CollectOptions,
  scripts: Record<string, string>,
): Promise<StepResult> => {
  const vitestBin = resolvePackageBin("vitest");
  const start = Date.now();
  if (vitestBin) {
    ensureDir(options.vitestPath);
    const code = await runCommand(vitestBin, [
      "run",
      "--reporter",
      "json",
      "--outputFile",
      options.vitestPath,
    ]);
    return {
      label: "tests",
      code,
      durationMs: Date.now() - start,
      ran: true,
    };
  }
  if (scripts.test) {
    const code = await runShellCommand(getNpmCommand(), ["run", "test"]);
    return {
      label: "tests",
      code,
      durationMs: Date.now() - start,
      ran: true,
    };
  }
  return { label: "tests", code: 0, ran: false };
};

const runEslint = async (
  options: CollectOptions,
  scripts: Record<string, string>,
): Promise<StepResult> => {
  const eslintBin = resolvePackageBin("eslint");
  const start = Date.now();
  if (eslintBin) {
    ensureDir(options.eslintPath);
    const code = await runCommand(eslintBin, [
      "--format",
      "json",
      "--output-file",
      options.eslintPath,
      "--no-error-on-unmatched-pattern",
      "--no-inline-config",
      "--quiet",
      ...TARGETS,
    ]);
    return {
      label: "eslint",
      code,
      durationMs: Date.now() - start,
      ran: true,
    };
  }
  if (scripts.lint) {
    const code = await runShellCommand(getNpmCommand(), ["run", "lint"]);
    return {
      label: "eslint",
      code,
      durationMs: Date.now() - start,
      ran: true,
    };
  }
  return { label: "eslint", code: 0, ran: false };
};

const runTsc = async (options: CollectOptions): Promise<StepResult> => {
  const start = Date.now();
  const tscBin = resolvePackageBin("typescript");
  if (!tscBin) {
    return { label: "tsc", code: 0, ran: false };
  }
  const code = await runCommandCapture(
    tscBin,
    ["--noEmit", "--pretty", "false", "--project", "tsconfig.json"],
    options.tscPath,
  );
  return {
    label: "tsc",
    code,
    durationMs: Date.now() - start,
    ran: true,
  };
};

const buildDepsTelemetry = (): RepoTelemetry => {
  const lockfiles = LOCKFILES.filter((name) =>
    fs.existsSync(path.join(process.cwd(), name)),
  );
  return {
    deps: {
      coherence: lockfiles.length === 1,
    },
  };
};

const main = async () => {
  const rawOptions = parseArgs();
  const options = resolveOptions(rawOptions);
  const junitPaths = resolveJunitPaths(rawOptions, options.reportsDir);
  const scripts = readPackageScripts();

  const results: StepResult[] = [];
  if (options.runBuild) {
    results.push(await runBuild(scripts));
  }
  if (options.runTests) {
    results.push(await runTests(options, scripts));
  }
  if (options.runEslint) {
    results.push(await runEslint(options, scripts));
  }
  if (options.runTsc) {
    results.push(await runTsc(options));
  }

  const existing = readRepoTelemetry(options.repoTelemetryPath);
  const fromEnv = buildRepoTelemetryFromEnv();
  const fromReports = buildRepoTelemetryFromReports(options, junitPaths);
  const fromDeps = buildDepsTelemetry();

  let merged = mergeRepoTelemetry(existing, fromEnv);
  merged = mergeRepoTelemetry(merged, fromReports);
  merged = mergeRepoTelemetry(merged, fromDeps);
  if (merged && results.length > 0) {
    const buildResult = results.find((result) => result.label === "build");
    if (buildResult?.ran) {
      merged.build = {
        status: buildResult.code === 0 ? "pass" : "fail",
        ok: buildResult.code === 0,
        exitCode: buildResult.code,
        durationMs: buildResult.durationMs,
      };
    }
    const testsResult = results.find((result) => result.label === "tests");
    if (testsResult?.ran && !merged.tests) {
      merged.tests = {
        status: testsResult.code === 0 ? "pass" : "fail",
        ok: testsResult.code === 0,
      };
    }
    const eslintResult = results.find((result) => result.label === "eslint");
    if (eslintResult?.ran && !merged.lint) {
      merged.lint = { status: eslintResult.code === 0 ? "pass" : "fail" };
    }
    const tscResult = results.find((result) => result.label === "tsc");
    if (tscResult?.ran && !merged.typecheck) {
      merged.typecheck = { status: tscResult.code === 0 ? "pass" : "fail" };
    }
  }

  if (merged) {
    merged = normalizeTelemetry(merged);
  }

  writeRepoTelemetry(merged, options.repoTelemetryPath);

  const failing = results.find((result) => result.ran && result.code !== 0);
  if (failing && !options.allowFail) {
    process.exit(failing.code);
  }
};

main().catch((error) => {
  console.error("[collect] failed:", error);
  process.exit(1);
});
