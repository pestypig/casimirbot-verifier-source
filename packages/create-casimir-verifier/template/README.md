# Hello Verifier

Minimal acquisition demo for the Shadow of Intent CLI + SDK (no repo clone required once
packages are published).

Prereqs
- Node 18+
- `shadow-of-intent` and `shadow-of-intent-sdk` published to npm

Setup
```
npm install
```

Optional env (defaults to http://localhost:5173; set a base URL only for hosted):
```
# CASIMIR_PUBLIC_BASE_URL=https://your-host.example
# SHADOW_OF_INTENT_BASE_URL=https://your-host.example
CASIMIR_TOKEN=your_token_here
CASIMIR_TENANT=your_tenant_here
```

CLI run
```
npm run verify
```

SDK run
```
npm run sdk
```

CI workflow
- `.github/workflows/hello-verifier.yml` runs `npm run verify`.
- Set `CASIMIR_TOKEN` and `CASIMIR_TENANT` secrets if auth/tenant is enabled; otherwise
  only `CASIMIR_PUBLIC_BASE_URL` / `SHADOW_OF_INTENT_BASE_URL` is needed.

AGENTS.md snippet (template)
Copy this into `AGENTS.md` at the repo root if you want to require the Casimir verification gate:
```md
# AGENTS
## Required: Casimir verification gate for any patch
1) Propose the patch (diff) as usual.
2) Run the verifier using the adapter endpoint (for this template: `npm run verify`).
3) If the verdict is FAIL: fix the first failing HARD constraint, re-run until PASS.
4) Do not claim completion unless you have a PASS and include verdict/firstFail/deltas.

### Auth + tenant isolation (when enabled)
- If ENABLE_AGI_AUTH=1 or AGI_TENANT_REQUIRED=1, include:
  - Authorization: Bearer <token>
  - X-Tenant-Id (or X-Customer-Id)
```

Notes
- `adapter-request.json` uses the `repo-convergence` pack for a fast PASS demo.
- Replace telemetry values to simulate FAILs and first-fail behavior.
