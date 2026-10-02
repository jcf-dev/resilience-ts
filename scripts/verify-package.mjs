import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  cpSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "resilience-ts-consumer-"));
const run = (command, args, cwd = dir) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
try {
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(
    Object.keys(metadata.dependencies ?? {}).length,
    0,
    "No runtime dependencies",
  );
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        dir,
        "--cache",
        join(dir, "npm-cache"),
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  assert.equal(packed.length, 1);
  const artifact = join(dir, packed[0].filename);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "isolated-consumer",
      version: "1.0.0",
      private: true,
      type: "module",
    }),
  );
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--cache",
    join(dir, "npm-cache"),
    artifact,
  ]);
  for (const file of ["esm.mjs", "cjs.cjs", "types.mts", "types.cts"])
    cpSync(join(root, "test/consumers", file), join(dir, file));
  run("node", ["esm.mjs"]);
  run("node", ["cjs.cjs"]);
  run("node", [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--strict",
    "--noEmit",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "types.mts",
    "types.cts",
  ]);
  console.log("Isolated packed install and .mts/.cts type checks passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
