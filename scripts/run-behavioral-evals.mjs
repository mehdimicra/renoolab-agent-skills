import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evalsDir = join(root, "evals");
const skillsDir = join(root, "skills");
const supportedHosts = new Set(["claude", "codex"]);
const supportedSuites = new Set(["trigger", "collisions", "all"]);

function usage() {
  return `Usage: node scripts/run-behavioral-evals.mjs [options]

Options:
  --host <claude|codex>       Agent host to execute (default: claude)
  --suite <trigger|collisions|all>
                              Fixture suite (default: all)
  --case <glob>               Stable case id filter
  --limit <n>                 Maximum selected cases
  --runs <n>                  Repetitions per case (default: 1)
  --concurrency <n>           Concurrent agent processes (default: 1)
  --timeout-ms <n>            Timeout per run (default: 90000)
  --model <name>              Host model override
  --max-budget-usd <amount>   Claude ceiling per run (default: 0.05)
  --report <path>             JSON report path
  --dry-run                   Validate and print the execution plan only
  --keep-temp                 Preserve isolated host workspace
  --help                      Show this help
`;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    host: "claude",
    suite: "all",
    caseGlob: null,
    limit: null,
    runs: 1,
    concurrency: 1,
    timeoutMs: 90_000,
    model: null,
    maxBudgetUsd: 0.05,
    report: null,
    dryRun: false,
    keepTemp: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${argument} requires a value`);
      }
      return argv[index];
    };

    if (argument === "--host") {
      options.host = nextValue();
    } else if (argument === "--suite") {
      options.suite = nextValue();
    } else if (argument === "--case") {
      options.caseGlob = nextValue();
    } else if (argument === "--limit") {
      options.limit = parsePositiveInteger(nextValue(), argument);
    } else if (argument === "--runs") {
      options.runs = parsePositiveInteger(nextValue(), argument);
    } else if (argument === "--concurrency") {
      options.concurrency = parsePositiveInteger(nextValue(), argument);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(nextValue(), argument);
    } else if (argument === "--model") {
      options.model = nextValue();
    } else if (argument === "--max-budget-usd") {
      options.maxBudgetUsd = parsePositiveNumber(nextValue(), argument);
    } else if (argument === "--report") {
      options.report = resolve(nextValue());
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--keep-temp") {
      options.keepTemp = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!supportedHosts.has(options.host)) {
    throw new Error(`Unsupported host: ${options.host}`);
  }
  if (!supportedSuites.has(options.suite)) {
    throw new Error(`Unsupported suite: ${options.suite}`);
  }
  return options;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*").replaceAll("?", ".")}$`, "i");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadFixtures(options) {
  const fixtures = [];
  if (options.suite === "trigger" || options.suite === "all") {
    const triggerDocument = await readJson(join(evalsDir, "cases.json"));
    for (const entry of triggerDocument.cases ?? []) {
      fixtures.push({ suite: "trigger", ...entry });
    }
  }
  if (options.suite === "collisions" || options.suite === "all") {
    const collisionDocument = await readJson(join(evalsDir, "collisions.json"));
    for (const entry of collisionDocument.cases ?? []) {
      fixtures.push({ suite: "collisions", ...entry });
    }
  }

  const ids = new Set();
  for (const fixture of fixtures) {
    if (!fixture.id) {
      throw new Error(`Fixture without id in ${fixture.suite}`);
    }
    if (ids.has(fixture.id)) {
      throw new Error(`Duplicate fixture id: ${fixture.id}`);
    }
    ids.add(fixture.id);
  }

  let selected = fixtures;
  if (options.caseGlob) {
    const pattern = globToRegExp(options.caseGlob);
    selected = selected.filter((fixture) => pattern.test(fixture.id));
  }
  if (options.limit) {
    selected = selected.slice(0, options.limit);
  }
  if (selected.length === 0) {
    throw new Error("No fixture matches the selected filters");
  }
  return selected;
}

function normalizeSkillName(value) {
  if (typeof value !== "string") {
    return null;
  }
  return value.split(":").at(-1) ?? null;
}

function appendTail(tail, line, maximum = 20) {
  tail.push(line);
  if (tail.length > maximum) {
    tail.shift();
  }
}

function runProcess({ command, args, cwd, timeoutMs, onJsonEvent, stopAfterSelection }) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const selectedSkills = [];
    const stdoutTail = [];
    const stderrTail = [];
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let timedOut = false;
    let stoppedAfterSelection = false;
    let settled = false;
    let child;

    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolvePromise({
        exitCode,
        signal,
        spawnError: spawnError?.message ?? null,
        timedOut,
        stoppedAfterSelection,
        selectedSkills,
        stdoutTail,
        stderrTail,
        durationMs: Date.now() - startedAt
      });
    };

    const consumeLine = (line, isErrorStream) => {
      if (!line.trim()) {
        return;
      }
      appendTail(isErrorStream ? stderrTail : stdoutTail, line);
      if (isErrorStream) {
        return;
      }
      try {
        const event = JSON.parse(line);
        const selected = onJsonEvent(event);
        if (selected) {
          const normalized = normalizeSkillName(selected);
          if (normalized && !selectedSkills.includes(normalized)) {
            selectedSkills.push(normalized);
          }
          if (stopAfterSelection && !stoppedAfterSelection) {
            stoppedAfterSelection = true;
            child.kill();
          }
        }
      } catch {
        // Hosts may emit a short non-JSON notice before their JSONL stream.
      }
    };

    const consumeChunk = (chunk, isErrorStream) => {
      const text = chunk.toString("utf8");
      if (isErrorStream) {
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          consumeLine(line, true);
        }
      } else {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          consumeLine(line, false);
        }
      }
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      finish(null, null, error);
      return;
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => consumeChunk(chunk, false));
    child.stderr.on("data", (chunk) => consumeChunk(chunk, true));
    child.on("error", (error) => finish(null, null, error));
    child.on("close", (exitCode, signal) => {
      if (stdoutBuffer.trim()) {
        consumeLine(stdoutBuffer, false);
      }
      if (stderrBuffer.trim()) {
        consumeLine(stderrBuffer, true);
      }
      finish(exitCode, signal);
    });
  });
}

function resolveClaudeCommand() {
  if (process.env.CLAUDE_BIN) {
    return process.env.CLAUDE_BIN;
  }
  if (process.platform === "win32") {
    const candidate = join(process.env.USERPROFILE ?? "", ".local", "bin", "claude.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "claude";
}

function resolveCodexLauncher() {
  if (process.env.CODEX_BIN) {
    return { command: process.env.CODEX_BIN, prefix: [] };
  }
  if (process.platform === "win32") {
    const script = join(
      process.env.APPDATA ?? "",
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js"
    );
    if (existsSync(script)) {
      return { command: process.execPath, prefix: [script] };
    }
  }
  return { command: "codex", prefix: [] };
}

async function prepareHost(options) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), `renoolab-${options.host}-eval-`));
  if (options.host === "claude") {
    const mcpConfig = join(temporaryRoot, "empty-mcp.json");
    await writeFile(mcpConfig, '{"mcpServers":{}}\n', "utf8");
    return { temporaryRoot, mcpConfig };
  }

  const workspace = join(temporaryRoot, "workspace");
  const targetSkills = join(workspace, ".agents", "skills");
  await mkdir(targetSkills, { recursive: true });
  await cp(skillsDir, targetSkills, { recursive: true });
  await writeFile(
    join(workspace, "AGENTS.md"),
    `# Evaluation environment\n\nThis workspace measures automatic skill routing. Select skills normally from the user request. Do not browse the web, call MCP tools, or modify files. If no local skill applies, answer in one short sentence.\n`,
    "utf8"
  );
  return { temporaryRoot, workspace };
}

function claudeEventObserver(state) {
  return (event) => {
    if (event.type === "system" && event.subtype === "init") {
      state.hostVersion = event.claude_code_version ?? state.hostVersion;
      state.model = event.model ?? state.model;
    }
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type === "tool_use" && block.name === "Skill") {
          return block.input?.skill ?? null;
        }
      }
    }
    if (event.type === "result") {
      state.costUsd = event.total_cost_usd ?? state.costUsd;
      state.terminalReason = event.terminal_reason ?? event.subtype ?? null;
      state.hostError = event.api_error_status ? String(event.api_error_status) : state.hostError;
    }
    return null;
  };
}

function codexEventObserver(state) {
  const skillPath = /\.agents[\\/]skills[\\/]([a-z0-9-]+)[\\/]SKILL\.md/i;
  return (event) => {
    if (event.type === "thread.started") {
      state.threadId = event.thread_id ?? null;
    }
    if (event.type === "turn.completed") {
      state.usage = event.usage ?? null;
    }
    if (event.type === "error") {
      state.hostError = event.message ?? JSON.stringify(event);
    }
    const command = event.item?.command;
    if (typeof command === "string") {
      const match = command.match(skillPath);
      if (match) {
        return match[1];
      }
    }
    return null;
  };
}

async function runClaude(prompt, options, hostContext) {
  const state = {
    hostVersion: null,
    model: options.model ?? "haiku",
    costUsd: null,
    terminalReason: null,
    hostError: null
  };
  const args = [
    "--plugin-dir",
    root,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    hostContext.mcpConfig,
    "--tools",
    "Skill",
    "--permission-mode",
    "dontAsk",
    "--model",
    state.model,
    "--max-turns",
    "1",
    "--max-budget-usd",
    String(options.maxBudgetUsd),
    "--no-session-persistence",
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    prompt
  ];
  const processResult = await runProcess({
    command: resolveClaudeCommand(),
    args,
    cwd: root,
    timeoutMs: options.timeoutMs,
    onJsonEvent: claudeEventObserver(state),
    stopAfterSelection: false
  });
  return { ...processResult, ...state };
}

async function runCodex(prompt, options, hostContext) {
  const state = {
    threadId: null,
    usage: null,
    hostError: null,
    model: options.model ?? null
  };
  const launcher = resolveCodexLauncher();
  const args = [
    ...launcher.prefix,
    "exec",
    "--json",
    "--cd",
    hostContext.workspace,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    'web_search="disabled"'
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  args.push(prompt);

  const processResult = await runProcess({
    command: launcher.command,
    args,
    cwd: hostContext.workspace,
    timeoutMs: options.timeoutMs,
    onJsonEvent: codexEventObserver(state),
    stopAfterSelection: true
  });
  return { ...processResult, ...state };
}

function expectedOutcome(fixture) {
  if (fixture.suite === "trigger") {
    return { mode: "equals", skill: fixture.expected_skill };
  }
  return { mode: "equals", skill: fixture.primary };
}

function gradeRun(fixture, runResult) {
  const expected = expectedOutcome(fixture);
  const selected = runResult.selectedSkills[0] ?? null;
  const infrastructureError = runResult.spawnError
    ?? runResult.hostError
    ?? (runResult.timedOut ? `Timed out after ${runResult.durationMs} ms` : null);
  let passed = false;
  if (!infrastructureError && expected.mode === "equals") {
    passed = selected === expected.skill;
  }

  return { expected, selected, passed, infrastructureError };
}

function gitState() {
  try {
    const commit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true
    }).stdout.trim() || null;
    const status = spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true
    }).stdout.trim();
    return { commit, dirty: Boolean(status) };
  } catch {
    return { commit: null, dirty: null };
  }
}

function hostVersion(options) {
  const launcher = options.host === "claude"
    ? { command: resolveClaudeCommand(), prefix: [] }
    : resolveCodexLauncher();
  const result = spawnSync(launcher.command, [...launcher.prefix, "--version"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function runWithConcurrency(tasks, concurrency, worker) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await worker(tasks[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => consume())
  );
  return results;
}

function defaultReportPath(options) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return join(evalsDir, "results", `${options.host}-${options.suite}-${timestamp}.json`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const fixtures = await loadFixtures(options);
  const taskPlan = fixtures.flatMap((fixture) => (
    Array.from({ length: options.runs }, (_, runIndex) => ({ fixture, runIndex: runIndex + 1 }))
  ));

  if (options.dryRun) {
    const fixtureFingerprint = createHash("sha256")
      .update(fixtures.map((fixture) => fixture.id).join("\n"), "utf8")
      .digest("hex");
    console.log(JSON.stringify({
      host: options.host,
      suite: options.suite,
      fixtures: fixtures.length,
      runs_per_fixture: options.runs,
      executions: taskPlan.length,
      fixture_ids_sha256: fixtureFingerprint
    }, null, 2));
    return;
  }

  const hostContext = await prepareHost(options);
  const startedAt = new Date();
  try {
    const rawResults = await runWithConcurrency(
      taskPlan,
      options.concurrency,
      async ({ fixture, runIndex }, index) => {
        const runResult = options.host === "claude"
          ? await runClaude(fixture.prompt, options, hostContext)
          : await runCodex(fixture.prompt, options, hostContext);
        const grade = gradeRun(fixture, runResult);
        const marker = grade.passed ? "PASS" : "FAIL";
        console.log(`[${index + 1}/${taskPlan.length}] ${marker} ${fixture.id} run=${runIndex} selected=${grade.selected ?? "none"}`);
        return {
          id: fixture.id,
          suite: fixture.suite,
          run: runIndex,
          prompt: fixture.prompt,
          prompt_sha256: createHash("sha256").update(fixture.prompt, "utf8").digest("hex"),
          expected: grade.expected,
          selected_skills: runResult.selectedSkills,
          passed: grade.passed,
          infrastructure_error: grade.infrastructureError,
          duration_ms: runResult.durationMs,
          exit_code: runResult.exitCode,
          signal: runResult.signal,
          stopped_after_selection: runResult.stoppedAfterSelection,
          timed_out: runResult.timedOut,
          cost_usd: runResult.costUsd ?? null,
          terminal_reason: runResult.terminalReason ?? null,
          host_version: runResult.hostVersion ?? null,
          model: runResult.model ?? options.model ?? null,
          stderr_tail: runResult.stderrTail
        };
      }
    );

    const passedRuns = rawResults.filter((result) => result.passed).length;
    const caseResults = fixtures.map((fixture) => {
      const runs = rawResults.filter((result) => result.id === fixture.id);
      return {
        id: fixture.id,
        passed: runs.every((result) => result.passed),
        passed_runs: runs.filter((result) => result.passed).length,
        total_runs: runs.length
      };
    });
    const totalCostUsd = rawResults.reduce((sum, result) => sum + (result.cost_usd ?? 0), 0);
    const repositoryState = gitState();
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      repository_commit: repositoryState.commit,
      repository_dirty: repositoryState.dirty,
      host: options.host,
      host_version: hostVersion(options),
      model_override: options.model,
      suite: options.suite,
      configuration: {
        runs_per_fixture: options.runs,
        concurrency: options.concurrency,
        timeout_ms: options.timeoutMs,
        max_budget_usd_per_claude_run: options.host === "claude" ? options.maxBudgetUsd : null
      },
      summary: {
        fixtures: fixtures.length,
        passed_fixtures: caseResults.filter((result) => result.passed).length,
        executions: rawResults.length,
        passed_executions: passedRuns,
        accuracy: rawResults.length === 0 ? 0 : passedRuns / rawResults.length,
        duration_ms: Date.now() - startedAt.getTime(),
        total_cost_usd: totalCostUsd
      },
      cases: caseResults,
      runs: rawResults
    };

    const reportPath = options.report ?? defaultReportPath(options);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report: ${reportPath}`);
    console.log(`Passed ${passedRuns}/${rawResults.length} executions (${(report.summary.accuracy * 100).toFixed(1)}%).`);
    if (passedRuns !== rawResults.length) {
      process.exitCode = 1;
    }
  } finally {
    if (options.keepTemp) {
      console.log(`Temporary workspace kept at ${hostContext.temporaryRoot}`);
    } else {
      await rm(hostContext.temporaryRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});