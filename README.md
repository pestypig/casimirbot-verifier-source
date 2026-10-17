# CasimirBot verifier source preview

This MIT-licensed source preview contains the Shadow of Intent SDK, verification and trace-collection CLI, and a verifier project scaffolder. It is a selected clean-history snapshot of 27 first-party source files, with locally built JavaScript and declarations. The [CasimirBot platform](https://casimirbot.com/) and its private repository are separate.

## Contents

- `sdk/`: TypeScript client for the adapter, constraint packs, and trace export.
- `cli/`: `shadow-of-intent verify` and `shadow-of-intent collect` commands.
- `packages/create-casimir-verifier/`: a minimal generated verifier project with a synthetic request and CI example.

The package manifests are marked `private: true` in this source preview. The SDK and CLI npm package names are not a published, supported dependency set. The scaffold can be generated locally, but its generated project requires those dependencies to be installed from local package archives or a future coordinated publication. The included synthetic `repo-convergence` example demonstrates the verifier protocol; a PASS is not a claim of physical viability, an accepted product workflow, or a live production integration.

## Rebuild from source

Requires Node.js 18 or newer. In `sdk/` and `cli/`, run `npm install` and `npm run build` separately. The generated `dist/` files are committed so the preview can be inspected without a build. To send the synthetic request to an authorized adapter, build the CLI and run:

```sh
node cli/dist/casimir-verify.js --json packages/create-casimir-verifier/template/adapter-request.json --ci --url https://your-authorized-host.example/api/agi/adapter/run
```

The example requires an accepted adapter endpoint and its account/tenant credentials where enabled. The template request is synthetic; it cannot certify a physical result. For local command discovery, run `node cli/dist/casimir-verify.js --help`. See each component README for options.

## Scope and provenance

The [source inventory](SOURCE_INVENTORY.json) records the original 27 selected paths and SHA-256 digests from the private working tree before source-preview metadata changes. Three package manifests were changed here only to mark the preview private, remove npm publish configuration, and include source/license files in archive contents. The CLI source includes the launcher correction that calls the verifier entry point explicitly. The generated `dist/` artifacts were rebuilt from these source files.

The MIT license covers this selected first-party snapshot. It does not grant rights to the rest of the CasimirBot platform, historical repository, private assets, or any third-party service. Development dependencies and referenced GitHub Actions are obtained separately under their respective upstream terms; none is vendored here.
