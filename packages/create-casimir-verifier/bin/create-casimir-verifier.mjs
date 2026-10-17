#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: create-casimir-verifier [--dest <path>] [--force] [--dry-run]`;

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}

const destInput = parsed.dest ?? ".";
const destDir = path.resolve(process.cwd(), destInput);
const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const templateDir = path.join(packageDir, "template");

await ensureTemplateDir(templateDir);
await ensureDestDir(destDir);

const files = await listFiles(templateDir);
if (files.length === 0) {
  console.error("Template directory is empty.");
  process.exit(1);
}

const conflicts = await findConflicts(destDir, files, parsed.force);
if (conflicts.blocking.length > 0) {
  console.error("Destination has conflicting directories:");
  for (const entry of conflicts.blocking) {
    console.error(`- ${entry}`);
  }
  process.exit(1);
}

if (conflicts.files.length > 0) {
  console.error("Destination already has files that would be overwritten:");
  for (const entry of conflicts.files) {
    console.error(`- ${entry}`);
  }
  console.error("Re-run with --force to overwrite files.");
  process.exit(1);
}

if (parsed.dryRun) {
  console.log("Dry run: the following files would be created:");
  for (const entry of files) {
    console.log(`- ${entry}`);
  }
  process.exit(0);
}

for (const relPath of files) {
  const srcPath = path.join(templateDir, relPath);
  const destPath = path.join(destDir, relPath);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(srcPath, destPath);
}

console.log(`Scaffolded hello-verifier into ${destDir}`);

function parseArgs(argv) {
  const parsedArgs = {
    dest: null,
    force: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsedArgs.help = true;
      continue;
    }
    if (arg === "--force") {
      parsedArgs.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsedArgs.dryRun = true;
      continue;
    }
    if (arg === "--dest") {
      parsedArgs.dest = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--dest=")) {
      parsedArgs.dest = arg.slice("--dest=".length);
      continue;
    }
    if (!arg.startsWith("-") && !parsedArgs.dest) {
      parsedArgs.dest = arg;
    }
  }

  return parsedArgs;
}

async function ensureTemplateDir(dir) {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      console.error(`Template path is not a directory: ${dir}`);
      process.exit(1);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.error(`Template directory not found: ${dir}`);
      process.exit(1);
    }
    throw error;
  }
}

async function ensureDestDir(dir) {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      console.error(`Destination path is not a directory: ${dir}`);
      process.exit(1);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
      return;
    }
    throw error;
  }
}

async function listFiles(dir) {
  const results = [];
  await walk(dir, dir, results);
  return results;
}

async function walk(rootDir, currentDir, results) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, results);
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath);
    results.push(relativePath);
  }
}

async function findConflicts(destDir, files, force) {
  const conflicts = {
    files: [],
    blocking: [],
  };

  for (const relPath of files) {
    const destPath = path.join(destDir, relPath);
    try {
      const stat = await fs.stat(destPath);
      if (stat.isDirectory()) {
        conflicts.blocking.push(relPath);
      } else if (!force) {
        conflicts.files.push(relPath);
      }
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return conflicts;
}
