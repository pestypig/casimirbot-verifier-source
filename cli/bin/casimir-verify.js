#!/usr/bin/env node
console.warn("[shadow-of-intent] casimir-verify is deprecated; use shadow-of-intent-verify instead.");
import { runCasimirVerify } from "../dist/casimir-verify.js";

runCasimirVerify().catch((error) => {
  console.error("[shadow-of-intent] failed:", error);
  process.exit(1);
});
