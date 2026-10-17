# Shadow of Intent CLI

Thin CLI wrapper around the Shadow of Intent adapter and training-trace export endpoints.
Requires Node 18+.

Install (once published)
```
npm install -g shadow-of-intent
```

Usage
```
shadow-of-intent verify --json adapter-request.json
```
CI one-step (auto-ingest telemetry from reports/ + env)
```
shadow-of-intent verify --ci --trace-out artifacts/training-trace.jsonl
```
Requires reports in `reports/` (run `npm run reports:ci`) or `CASIMIR_*` env
telemetry to satisfy repo-convergence constraints.
Collect CI telemetry (one command)
```
shadow-of-intent collect
```
Also available as `shadow-of-intent-collect`.
Writes `reports/repo-telemetry.json` plus `reports/vitest.json`,
`reports/eslint.json`, and `reports/tsc.txt` when tooling is available. Use
`--no-run` to only parse existing reports.
Runtime default (tool-use-budget)
```
shadow-of-intent verify --trace-out training-trace.jsonl
```
Requires runtime telemetry in `reports/tool-telemetry.json` or
`CASIMIR_TOOL_TELEMETRY_PATH` / `CASIMIR_*` envs.
Constraint pack shortcut (auto telemetry)
```
shadow-of-intent verify --pack repo-convergence --auto-telemetry
```

Hello verifier example
- See `examples/hello-verifier` for a minimal CLI + SDK demo.

Defaults
- Runs locally when no `--url` or `CASIMIR_PUBLIC_BASE_URL` is set.
- Use `--url` or set `CASIMIR_PUBLIC_BASE_URL` / `SHADOW_OF_INTENT_BASE_URL` to call a remote adapter.
- Local mode only supports constraint-pack runs; GR runs require `--url`.       
- When no payload is provided, the CLI runs the `tool-use-budget` pack and
  auto-ingests telemetry from `reports/tool-telemetry.json` + `CASIMIR_*` envs.

Options
- `--json` path to adapter request JSON.
- `--params` inline JSON object string.
- `--pack` constraint pack id (e.g., `repo-convergence`, `tool-use-budget`).
- `--auto-telemetry` enable auto-ingest for packs (reports/ + env).
- `--no-auto-telemetry` disable auto-ingest for packs.
- `--ci` shorthand for `--pack repo-convergence --auto-telemetry`.
- `--trace-id` override trace id (default uses CI envs when present).
- `--url` override adapter endpoint.
- `--export-url` override trace export endpoint.
- `--trace-out` JSONL output path (use `-` for stdout).
- `--trace-limit` max traces to export (default: 50).
- `--token` bearer token (JWT).
- `--tenant` tenant/customer id.
- `--quiet` suppress response output.

Collect options
- `--reports-dir` report directory (default: `reports`).
- `--telemetry-out` path to write `repo-telemetry.json`.
- `--junit-path` JUnit XML path (repeatable).
- `--vitest-path` Vitest JSON report path.
- `--eslint-path` ESLint JSON report path.
- `--tsc-path` tsc output path.
- `--no-run` skip running build/test/lint/tsc and only parse existing files.
- `--no-build` skip build.
- `--no-tests` skip tests.
- `--no-eslint` skip eslint.
- `--no-tsc` skip tsc.
- `--allow-fail` do not exit non-zero on failed steps.

Example request JSON
```json
{
  "traceId": "cli-run-001",
  "actions": [
    { "id": "a1", "label": "reduce duty", "params": { "dutyEffectiveFR": 0.0025 } }
  ],
  "budget": { "maxIterations": 1, "maxTotalMs": 60000 }
}
```
