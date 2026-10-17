# create-casimir-verifier

Scaffold a minimal Casimir verifier repo with a CLI check, SDK sample, and CI
workflow.

Usage
```
npx create-casimir-verifier --dest <path>
```

Options
- `--dest <path>`: destination directory (defaults to current directory).
- `--force`: overwrite existing files.
- `--dry-run`: show files without writing anything.

Template contents
- `packages/create-casimir-verifier/package.json` defines the scaffold tool.
- `packages/create-casimir-verifier/template/package.json` is the generated project manifest.
- `packages/create-casimir-verifier/template/adapter-request.json` is a minimal verifier payload.
- `packages/create-casimir-verifier/template/.github/workflows/hello-verifier.yml` runs the verification job in CI.

Example
```
npx create-casimir-verifier --dest ./hello-verifier
```
