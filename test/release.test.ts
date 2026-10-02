import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";

const run = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: run,
  }),
}));
import {
  generateNotes as stagingNotes,
  prepare,
  verifyConditions,
} from "../scripts/stage-release.mjs";

let cwd: string;
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "jcf-dev/resilience-ts",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_WORKFLOW_REF:
    "jcf-dev/resilience-ts/.github/workflows/ci.yml@refs/heads/main",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-only",
};
const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
const context = () => ({
  cwd,
  env,
  options: { dryRun: false },
  logger,
  nextRelease: { version: "0.1.1", gitHead: "source-commit", notes: "Fixes" },
});

beforeEach(async () => {
  run.mockReset();
  cwd = await mkdtemp(path.join(tmpdir(), "resilience-release-"));
  await mkdir(path.join(cwd, "release"));
  await writeFile(
    path.join(cwd, "release/jcf-dev-resilience-ts-0.1.1.tgz"),
    "verified tarball",
  );
});
afterEach(() => rm(cwd, { recursive: true, force: true }));

test.each([
  { GITHUB_REF: "refs/pull/1/merge" },
  { GITHUB_EVENT_NAME: "pull_request" },
  { GITHUB_REPOSITORY: "fork/resilience-ts" },
  { GITHUB_WORKFLOW_REF: "jcf-dev/resilience-ts/other.yml@refs/heads/main" },
  { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  { NPM_TOKEN: "saved-token" },
  { NODE_AUTH_TOKEN: "saved-token" },
])("refuses releases outside the trusted main workflow: %j", (override) => {
  expect(() =>
    verifyConditions({}, { ...context(), env: { ...env, ...override } }),
  ).toThrow();
  expect(run).not.toHaveBeenCalled();
});

test("stages the exact tarball and records the approval receipt", async () => {
  run.mockResolvedValue({
    stdout: JSON.stringify({
      name: "@jcf-dev/resilience-ts",
      version: "0.1.1",
      stageId: "stage-123",
    }),
  });
  const release = context();
  await prepare({}, release);
  const args = run.mock.calls[0]![1];
  expect(args.slice(1, 4)).toEqual([
    "stage",
    "publish",
    path.join(cwd, "release/jcf-dev-resilience-ts-0.1.1.tgz"),
  ]);
  expect(args).toContain("--ignore-scripts");
  const receipt = JSON.parse(
    await readFile(path.join(cwd, "release/staging.json"), "utf8"),
  );
  expect(receipt).toMatchObject({
    version: "0.1.1",
    stageId: "stage-123",
    gitHead: "source-commit",
  });
  expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(stagingNotes()).toContain("2FA approval");
});

test.each([
  { name: "other-package", version: "0.1.1", stageId: "stage-123" },
  { name: "@jcf-dev/resilience-ts", version: "0.1.0", stageId: "stage-123" },
  { name: "@jcf-dev/resilience-ts", version: "0.1.1" },
])("rejects an incomplete or mismatched stage receipt: %j", async (receipt) => {
  run.mockResolvedValue({ stdout: JSON.stringify(receipt) });
  await expect(prepare({}, context())).rejects.toThrow("staging receipt");
  await expect(
    readFile(path.join(cwd, "release/staging.json")),
  ).rejects.toThrow();
});

test.each([
  ["fix: correct npm release instructions", "patch"],
  ["feat: add a strategy", "minor"],
  ["feat!: change the API", "major"],
  ["fix: update behavior\n\nBREAKING CHANGE: old behavior removed", "major"],
  ["chore!: require a new Node version", "major"],
  ["docs: update examples", null],
  ["ci: update workflow", null],
])("versions Conventional Commit %s as %s", async (message, expected) => {
  const result = await analyzeCommits(
    { preset: "conventionalcommits" },
    { cwd, logger, commits: [{ message, hash: "abc123" }] },
  );
  expect(result).toBe(expected);
});

test("generates release notes with the compatible conventional preset", async () => {
  const notes = await generateNotes(
    { preset: "conventionalcommits" },
    {
      cwd,
      logger,
      options: {
        repositoryUrl: "https://github.com/jcf-dev/resilience-ts.git",
      },
      branch: { name: "main" },
      lastRelease: { version: "0.1.0", gitTag: "v0.1.0" },
      nextRelease: { version: "0.1.1", gitTag: "v0.1.1" },
      commits: [
        { hash: "abc123", message: "fix: correct npm release instructions" },
      ],
    },
  );
  expect(notes).toContain("0.1.1");
  expect(notes).toContain("correct npm release instructions");
});
