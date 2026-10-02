import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
rmSync("dist", { recursive: true, force: true });
execFileSync("node", ["node_modules/typescript/bin/tsc"], { stdio: "inherit" });
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }));
mkdirSync("dist/esm", { recursive: true });
const exports = Object.keys(
  createRequire(import.meta.url)("../dist/cjs/index.js"),
);
writeFileSync(
  "dist/esm/index.js",
  `import runtime from '../cjs/index.js';\n${exports.map((name) => `export const ${name} = runtime.${name};`).join("\n")}\n`,
);
writeFileSync("dist/esm/index.d.ts", "export * from '../cjs/index.js';\n");
