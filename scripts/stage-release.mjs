import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const packageName = "@jcf-dev/resilience-ts";

export function generateNotes() {
  return "### npm staged publication\n\nCI stages this package on npm for maintainer review and 2FA approval before it becomes public. Review the attached tarball and `staging.json` receipt for the stage ID, then run `npm stage approve <stage-id>` with npm 11.15+ or approve it in the npm website's Staged Packages tab. Check npm for the current public version.";
}

export function verifyConditions(_config, { env, options }) {
  if (options.dryRun) return;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "jcf-dev/resilience-ts" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_WORKFLOW_REF !==
      "jcf-dev/resilience-ts/.github/workflows/ci.yml@refs/heads/main" ||
    !env.ACTIONS_ID_TOKEN_REQUEST_URL ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  ) {
    throw new Error(
      "Releases require this repository's main CI workflow and OIDC.",
    );
  }
  if (env.NPM_TOKEN || env.NODE_AUTH_TOKEN) {
    throw new Error("Use npm trusted publishing instead of a saved npm token.");
  }
}

export async function prepare(config, context) {
  verifyConditions(config, context);
  const { cwd, env, logger, nextRelease } = context;
  const filename = `jcf-dev-resilience-ts-${nextRelease.version}.tgz`;
  const tarball = path.join(cwd, "release", filename);
  const { stdout } = await run(
    process.execPath,
    [
      path.join(cwd, "node_modules/npm/bin/npm-cli.js"),
      "stage",
      "publish",
      tarball,
      "--access=public",
      "--tag=latest",
      "--registry=https://registry.npmjs.org/",
      "--ignore-scripts",
      "--json",
    ],
    { cwd, env, maxBuffer: 5 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  const staged = result[packageName] ?? result;
  if (
    staged.name !== packageName ||
    staged.version !== nextRelease.version ||
    typeof staged.stageId !== "string" ||
    !staged.stageId
  ) {
    throw new Error(
      "npm did not return a staging receipt for the release version.",
    );
  }
  const receipt = {
    name: packageName,
    version: nextRelease.version,
    stageId: staged.stageId,
    gitHead: nextRelease.gitHead,
    filename,
    sha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
  };
  await writeFile(
    path.join(cwd, "release/staging.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  logger.log("Staged %s@%s: %s", packageName, receipt.version, receipt.stageId);
}
