#!/usr/bin/env node
import { runCasimirVerify } from "../dist/casimir-verify.js";

runCasimirVerify().catch((error) => {
  console.error("[shadow-of-intent] failed:", error);
  process.exit(1);
});
