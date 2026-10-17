const usage = (): void => {
  console.log("Usage: shadow-of-intent <command> [options]");
  console.log("Commands:");
  console.log("  verify   Run the verifier (default).");
  console.log("  collect  Generate repo telemetry from CI reports.");
  console.log("Run shadow-of-intent <command> --help for command options.");
};

const runModule = async (modulePath: string, argv: string[]) => {
  const baseArgv = process.argv.slice(0, 2);
  process.argv = [...baseArgv, ...argv];
  if (modulePath === "./casimir-verify.js") {
    const { runCasimirVerify } = await import("./casimir-verify.js");
    await runCasimirVerify();
  } else {
    await import(modulePath);
  }
};

const main = async () => {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "verify") {
    await runModule("./casimir-verify.js", rest);
    return;
  }
  if (command === "collect") {
    await runModule("./casimir-collect.js", rest);
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    usage();
    return;
  }
  console.error(`[shadow-of-intent] Unknown command: ${command}`);
  usage();
  process.exit(1);
};

main().catch((error) => {
  console.error("[shadow-of-intent] failed:", error);
  process.exit(1);
});
