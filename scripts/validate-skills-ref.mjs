import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillsRoot = join(root, "skills");

function resolveCommand() {
  if (process.env.SKILLS_REF_BIN) {
    return process.env.SKILLS_REF_BIN;
  }
  const candidates = process.platform === "win32"
    ? [join(root, ".venv", "Scripts", "skills-ref.exe")]
    : [join(root, ".venv", "bin", "skills-ref")];
  return candidates.find((candidate) => existsSync(candidate)) ?? "skills-ref";
}

const command = resolveCommand();
const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const skillName of skillNames) {
  const result = spawnSync(command, ["validate", join(skillsRoot, skillName)], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });
  if (result.error) {
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
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