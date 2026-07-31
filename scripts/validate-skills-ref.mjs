import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillsRoot = join(root, "skills");

function resolveInvocation() {
  if (process.env.SKILLS_REF_BIN) {
    return { command: process.env.SKILLS_REF_BIN, args: [] };
  }
  const venvCommand = process.platform === "win32"
    ? join(root, ".venv", "Scripts", "skills-ref.exe")
    : join(root, ".venv", "bin", "skills-ref");
  if (existsSync(venvCommand)) {
    return { command: venvCommand, args: [] };
  }
  return {
    command: "python",
    args: ["-m", "skills_ref.cli"]
  };
}

const invocation = resolveInvocation();
const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const skillName of skillNames) {
  const args = [...invocation.args, "validate", join(skillsRoot, skillName)];
  const result = spawnSync(invocation.command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });
  if (result.error) {
    throw new Error(`Unable to run ${invocation.command}: ${result.error.message}`);
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`skills-ref rejected ${skillName} with exit code ${result.status}`);
  }
}

console.log(`skills-ref validated ${skillNames.length} skills.`);