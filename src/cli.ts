#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Catalog } from './catalog.js';
import { exportRun } from './export.js';
import { installSkills, bundledSkillsDirectory, INSTALL_TARGETS, type InstallTarget } from './install.js';
import { executeRun, type OrchestratorEvent } from './orchestrator.js';
import { Pipeline } from './pipeline.js';
import type { Run } from './state.js';
import type { Fix } from './validation.js';
import { runView } from './view.js';
import { VERSION } from './version.js';
import { createWorker, WORKER_NAMES, type WorkerName } from './workers/index.js';

class CliError extends Error {}

const HELP = `promptzilla ${VERSION}

Usage: promptzilla <command> [options]

Skills
  install               Copy the five skills into detected agent skill directories
  list                  List the bundled skills
  validate              Validate the bundled skill catalog

Pipeline
  start                 Create a run and print its first dispatch (manual mode)
  run                   Run Metapod, Judge Dredd and Brian Spillner to a terminal state
  status <run-id>       Show a run, its score history and the next dispatch
  submit <run-id>       Submit one stage output (manual mode)
  pause <run-id>        Pause an active stage for a user decision
  resume <run-id>       Resume a paused run with the user's decision
  fix <run-id>          Apply Judge-authorized exact replacements after STOP
  export <run-id>       Write the final or provisional prompt to Markdown
  test                  Exercise the pipeline with a fixture or a live model

Run options
  --request TEXT          A raw request (Full mode)
  --prompt FILE           An existing prompt (Optimize-only mode)
  --input FILE            Input file; pair with --mode full|optimize-only
  --mode MODE             full | optimize-only
  --resume <run-id>       Continue a paused run with --decision
  --priorities TEXT       Constraints to carry through every stage
  --worker NAME           opencode | claude | codex | fixture (default: opencode)
  --model NAME            Model passed to the worker
  --out DIR               Where approved Markdown is written (default: ./prompts)
  --name SLUG             Override the exported filename
  --timeout MS            Per-stage timeout (default: 900000)
  --show-output           Print each stage's full output
  --quiet                 Suppress stage progress

Global
  --skills-dir PATH       Override the skill catalog
  --runs-dir PATH         Override run storage (default: ~/.promptzilla/runs)
  --json                  Machine-readable output
  --help, --version

Examples
  npx promptzilla install
  npx promptzilla run --request "Write a prompt for a meeting-notes summarizer"
  npx promptzilla run --prompt ./prompt.md --worker claude --model claude-sonnet-4-5
  npx promptzilla test --live --worker opencode --model deepseek/deepseek-flash
  npx promptzilla status <run-id>
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  validate: { type: 'boolean' },
  json: { type: 'boolean' },
  'skills-dir': { type: 'string' },
  'runs-dir': { type: 'string' },
  target: { type: 'string', multiple: true },
  dir: { type: 'string' },
  'dry-run': { type: 'boolean' },
  request: { type: 'string' },
  prompt: { type: 'string' },
  input: { type: 'string' },
  mode: { type: 'string' },
  priorities: { type: 'string' },
  worker: { type: 'string' },
  model: { type: 'string' },
  out: { type: 'string' },
  name: { type: 'string' },
  timeout: { type: 'string' },
  quiet: { type: 'boolean', short: 'q' },
  'show-output': { type: 'boolean' },
  live: { type: 'boolean' },
  dispatch: { type: 'string' },
  output: { type: 'string' },
  'execution-id': { type: 'string' },
  reason: { type: 'string' },
  decision: { type: 'string' },
  resume: { type: 'string' },
  fixes: { type: 'string' },
  old: { type: 'string', multiple: true },
  new: { type: 'string', multiple: true },
} as const;

type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>;
type Values = Parsed['values'];

function requireValue(value: string | undefined, label: string): string {
  if (!value || !value.trim()) throw new CliError(`${label} is required.`);
  return value;
}

function parseMode(value: string | undefined): 'full' | 'optimize-only' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'full' && value !== 'optimize-only') throw new CliError('--mode must be "full" or "optimize-only".');
  return value;
}

function parseWorker(value: string | undefined, fallback: WorkerName): WorkerName {
  const name = (value ?? fallback) as WorkerName;
  if (!WORKER_NAMES.includes(name)) throw new CliError(`--worker must be one of: ${WORKER_NAMES.join(', ')}.`);
  return name;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 15 * 60 * 1000;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout < 1000) throw new CliError('--timeout must be at least 1000 milliseconds.');
  return Math.floor(timeout);
}

function runsDirectory(values: Values): string {
  return resolve(values['runs-dir'] ?? process.env.PROMPTZILLA_RUNS_DIR ?? join(homedir(), '.promptzilla', 'runs'));
}

function skillsDirectory(values: Values): string {
  return resolve(values['skills-dir'] ?? process.env.PROMPTZILLA_SKILLS_DIR ?? bundledSkillsDirectory());
}

async function loadPipeline(values: Values): Promise<Pipeline> {
  return new Pipeline(await Catalog.load(skillsDirectory(values)), runsDirectory(values));
}

async function readInputFile(path: string): Promise<string> {
  const text = await readFile(resolve(path), 'utf8');
  if (!text.trim()) throw new CliError(`Input file is empty: ${path}`);
  return text;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function historyLine(run: Run): string {
  if (!run.history.length) return 'no scores yet';
  return run.history.map(entry => `${entry.score} ${entry.verdict}`).join(', ');
}

function printRunSummary(run: Run, exported?: { path: string; approved: boolean }): void {
  process.stdout.write(`\nRun ${run.id} — ${run.status}\n`);
  process.stdout.write(`Mode: ${run.mode}   Scores: ${historyLine(run)}\n`);
  if (run.final) process.stdout.write(`Final: ${run.final.approved ? 'approved' : 'provisional'} — ${run.final.label}\n`);
  if (run.reason) process.stdout.write(`Reason: ${run.reason}\n`);
  if (run.deferred) process.stdout.write(`Deferred:\n${run.deferred}\n`);
  const placeholders = run.final ? [...run.final.text.matchAll(/\[(?:TBD|PLACEHOLDER)\]/g)].length : 0;
  if (placeholders) process.stdout.write(`Unresolved placeholders: ${placeholders}\n`);
  if (exported) process.stdout.write(`Prompt: ${exported.path}${exported.approved ? '' : ' (provisional, not approved)'}\n`);
}

function progressHandler(values: Values): (event: OrchestratorEvent) => void {
  return event => {
    if (values.quiet || values.json) return;
    if (event.type === 'start') {
      process.stdout.write(`Run ${event.run.id} — ${event.run.mode}\n`);
    } else if (event.type === 'dispatch') {
      const attempt = event.dispatch.attempt ? ` (retry ${event.dispatch.attempt})` : '';
      process.stdout.write(`\n→ ${event.dispatch.skill}${attempt} ...\n`);
    } else if (event.type === 'retry') {
      process.stdout.write(`  output rejected; retrying: ${event.error}\n`);
    } else if (event.type === 'submitted') {
      if (values['show-output']) {
        process.stdout.write(`\n--- ${event.dispatch.skill} output ---\n${event.text}\n--- end ---\n`);
      }
      const latest = event.run.history.at(-1);
      if (event.dispatch.stage === 'judge' && latest) {
        process.stdout.write(`  judge: ${latest.score}/10 ${latest.verdict}\n`);
      } else {
        process.stdout.write('  accepted\n');
      }
    } else if (event.type === 'paused') {
      process.stdout.write(`\nPaused: ${event.run.reason ?? 'a decision is required'}\n`);
      process.stdout.write(`Resume with: promptzilla resume ${event.run.id} --decision "..."\n`);
    } else if (event.type === 'finished' && !values['show-output']) {
      // The summary prints after executeRun returns.
    }
  };
}

async function commandInstall(values: Values): Promise<number> {
  const rawTargets = values.target ?? [];
  const targets: InstallTarget[] = [];
  for (const value of rawTargets) {
    for (const part of value.split(',').map(item => item.trim()).filter(Boolean)) {
      if (part === 'all') targets.push(...INSTALL_TARGETS);
      else if ((INSTALL_TARGETS as string[]).includes(part)) targets.push(part as InstallTarget);
      else throw new CliError(`Unknown install target: ${part}. Use claude, opencode, agents or all.`);
    }
  }
  if (values.dir && targets.length) throw new CliError('Use either --dir or --target, not both.');

  const results = await installSkills({
    ...(targets.length ? { targets: [...new Set(targets)] } : {}),
    ...(values.dir ? { directory: values.dir } : {}),
    ...(values['dry-run'] ? { dryRun: true } : {}),
    ...(values['skills-dir'] ? { skillsDir: skillsDirectory(values) } : {}),
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }
  for (const result of results) {
    process.stdout.write(`${result.dry_run ? 'Would install' : 'Installed'} ${result.skills.length} skills into ${result.directory}\n`);
    process.stdout.write(`  ${result.skills.join(', ')}\n`);
  }
  return 0;
}

async function commandValidate(values: Values): Promise<number> {
  const catalog = await Catalog.load(skillsDirectory(values));
  const message = `Validated ${catalog.list().length} skills and ${catalog.assets.size} source assets.`;
  process.stdout.write(values.json ? `${JSON.stringify({ skills: catalog.list(), assets: catalog.assets.size }, null, 2)}\n` : `${message}\n`);
  return 0;
}

async function commandList(values: Values): Promise<number> {
  const catalog = await Catalog.load(skillsDirectory(values));
  const skills = catalog.list();
  if (values.json) process.stdout.write(`${JSON.stringify({ skills }, null, 2)}\n`);
  else for (const skill of skills) process.stdout.write(`${skill.name}\n  ${skill.description}\n`);
  return 0;
}

async function resolveInput(values: Values, positionals: string[]): Promise<{ input: string; mode: 'full' | 'optimize-only' }> {
  const sources = [values.request, values.prompt, values.input].filter(value => value !== undefined);
  if (sources.length > 1) throw new CliError('Use only one of --request, --prompt or --input.');
  if (values.request !== undefined) return { input: values.request, mode: parseMode(values.mode) ?? 'full' };
  if (values.prompt !== undefined) return { input: await readInputFile(values.prompt), mode: parseMode(values.mode) ?? 'optimize-only' };
  if (values.input !== undefined) return { input: await readInputFile(values.input), mode: parseMode(values.mode) ?? 'optimize-only' };
  if (positionals.length) return { input: positionals.join(' '), mode: parseMode(values.mode) ?? 'full' };
  throw new CliError('Supply --request, --prompt, --input, or a request as the trailing argument.');
}

async function commandStart(values: Values, positionals: string[]): Promise<number> {
  const { input, mode } = await resolveInput(values, positionals);
  const pipeline = await loadPipeline(values);
  const run = await pipeline.start({
    mode,
    input,
    ...(values.priorities ? { priorities: values.priorities } : {}),
  });
  if (values.json) process.stdout.write(`${JSON.stringify(runView(run, join(runsDirectory(values), run.id)), null, 2)}\n`);
  else {
    printRunSummary(run);
    process.stdout.write(`Directory: ${join(runsDirectory(values), run.id)}\n`);
    if (run.dispatch) {
      process.stdout.write(`Next: ${run.dispatch.skill} (${run.dispatch.stage}), dispatch ${run.dispatch.id}\n`);
      process.stdout.write(`Submit with: promptzilla submit ${run.id} --dispatch ${run.dispatch.id} --output <file>\n`);
    }
  }
  return 0;
}

async function commandRun(values: Values, positionals: string[]): Promise<number> {
  const resuming = values.resume !== undefined;
  let input: string | undefined;
  let mode: 'full' | 'optimize-only' | undefined;
  if (resuming) {
    if (values.request || values.prompt || values.input || positionals.length) {
      throw new CliError('--resume cannot be combined with new input.');
    }
  } else {
    ({ input, mode } = await resolveInput(values, positionals));
  }

  const workerName = parseWorker(values.worker, 'opencode');
  const worker = createWorker(workerName, {
    ...(values.model ? { model: values.model } : {}),
    timeoutMs: parseTimeout(values.timeout),
    cwd: process.cwd(),
  });
  const pipeline = await loadPipeline(values);
  const outDir = resolve(values.out ?? join(process.cwd(), 'prompts'));

  const result = resuming
    ? await executeRun({
        pipeline,
        worker,
        outDir,
        resume: { runId: values.resume!, decision: requireValue(values.decision, '--decision') },
        ...(values.name ? { name: values.name } : {}),
        onEvent: progressHandler(values),
      })
    : await executeRun({
        pipeline,
        worker,
        mode: mode!,
        input: input!,
        outDir,
        ...(values.priorities ? { priorities: values.priorities } : {}),
        ...(values.name ? { name: values.name } : {}),
        onEvent: progressHandler(values),
      });

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ...runView(result.run, join(runsDirectory(values), result.run.id)), exported: result.exported ?? null }, null, 2)}\n`);
  } else {
    printRunSummary(result.run, result.exported);
    process.stdout.write(`Run directory: ${join(runsDirectory(values), result.run.id)}\n`);
  }
  if (result.run.status === 'paused') return 2;
  if (!result.run.final?.approved) return 3;
  return 0;
}

async function commandStatus(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  const pipeline = await loadPipeline(values);
  const run = await pipeline.status(id);
  const view = runView(run, join(runsDirectory(values), run.id));
  if (values.json) process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
  else {
    process.stdout.write(`Run ${run.id} — ${run.status} (${run.final?.approved ? 'approved' : run.final ? 'provisional' : 'no final'})\n`);
    process.stdout.write(`Mode: ${run.mode}   Created: ${run.created_at}   Scores: ${historyLine(run)}\n`);
    if (run.reason) process.stdout.write(`Reason: ${run.reason}\n`);
    if (run.dispatch) process.stdout.write(`Next: ${run.dispatch.skill} (${run.dispatch.stage}), dispatch ${run.dispatch.id}\n`);
    process.stdout.write(`Directory: ${view.run_dir}\n`);
    if (run.final) process.stdout.write(`Final: ${run.final.file} — ${run.final.label}\n`);
  }
  return 0;
}

async function commandSubmit(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  const dispatchId = requireValue(values.dispatch, '--dispatch');
  const outputPath = requireValue(values.output, '--output');
  const output = outputPath === '-' ? await readStdin() : await readInputFile(outputPath);
  if (!output.trim()) throw new CliError('Stage output is empty.');
  const pipeline = await loadPipeline(values);
  const run = await pipeline.submit({
    run_id: id,
    dispatch_id: dispatchId,
    execution_id: values['execution-id'] ?? `manual:${randomUUID()}`,
    fresh_context: true,
    output,
  });
  if (values.json) process.stdout.write(`${JSON.stringify(runView(run, join(runsDirectory(values), run.id)), null, 2)}\n`);
  else printRunSummary(run);
  return 0;
}

async function commandPause(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  const reason = requireValue(values.reason, '--reason');
  const pipeline = await loadPipeline(values);
  const run = await pipeline.pause(id, reason);
  if (values.json) process.stdout.write(`${JSON.stringify(runView(run, join(runsDirectory(values), run.id)), null, 2)}\n`);
  else printRunSummary(run);
  return 0;
}

async function commandResume(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  const decision = requireValue(values.decision, '--decision');
  const pipeline = await loadPipeline(values);
  const run = await pipeline.resume(id, decision);
  if (values.json) process.stdout.write(`${JSON.stringify(runView(run, join(runsDirectory(values), run.id)), null, 2)}\n`);
  else printRunSummary(run);
  return 0;
}

async function commandFix(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  let fixes: Fix[];
  if (values.fixes) {
    const parsed = JSON.parse(await readInputFile(values.fixes)) as unknown;
    if (!Array.isArray(parsed) || !parsed.length) throw new CliError('--fixes must point to a non-empty JSON array of {old,new} pairs.');
    fixes = parsed.map((item, index) => {
      const pair = item as { old?: unknown; new?: unknown };
      if (typeof pair?.old !== 'string' || typeof pair?.new !== 'string') throw new CliError(`Fix ${index + 1} needs string "old" and "new" fields.`);
      return { old: pair.old, new: pair.new };
    });
  } else {
    const olds = values.old ?? [];
    const news = values.new ?? [];
    if (!olds.length || olds.length !== news.length) throw new CliError('Supply matching --old and --new values, or --fixes FILE.');
    fixes = olds.map((old, index) => ({ old, new: news[index]! }));
  }
  const pipeline = await loadPipeline(values);
  const run = await pipeline.applyFixes(id, fixes);
  if (values.json) process.stdout.write(`${JSON.stringify(runView(run, join(runsDirectory(values), run.id)), null, 2)}\n`);
  else {
    printRunSummary(run);
    if (run.dispatch) {
      process.stdout.write(`Confirmation pending: ${run.dispatch.skill} (${run.dispatch.stage}), dispatch ${run.dispatch.id}\n`);
      process.stdout.write(`Submit with: promptzilla submit ${run.id} --dispatch ${run.dispatch.id} --output <file>\n`);
    }
  }
  return 0;
}

async function commandExport(values: Values, positionals: string[]): Promise<number> {
  const id = requireValue(positionals[0], 'A run ID');
  const pipeline = await loadPipeline(values);
  const run = await pipeline.status(id);
  const exported = await exportRun(run, resolve(values.out ?? join(process.cwd(), 'prompts')), values.name);
  if (values.json) process.stdout.write(`${JSON.stringify(exported, null, 2)}\n`);
  else process.stdout.write(`Wrote ${exported.path}${exported.approved ? '' : ' (provisional, not approved)'}\n`);
  return 0;
}

async function commandTest(values: Values): Promise<number> {
  const live = values.live ?? false;
  const workerName = parseWorker(values.worker, live ? 'opencode' : 'fixture');
  if (!live && workerName !== 'fixture') throw new CliError('A non-live test uses the fixture worker. Add --live to call a real model.');
  if (live && workerName === 'fixture') throw new CliError('--live needs a real worker: opencode, claude or codex.');

  const request = values.request ?? 'Write a prompt for a meeting-notes summarizer that returns exactly five bullet points.';
  const worker = createWorker(workerName, {
    ...(values.model ? { model: values.model } : {}),
    timeoutMs: parseTimeout(values.timeout),
    cwd: process.cwd(),
  });
  const pipeline = await loadPipeline(values);
  const outDir = resolve(values.out ?? join(process.cwd(), 'prompts'));

  if (!values.json) process.stdout.write(`Testing the full pipeline with the ${workerName} worker${values.model ? ` (${values.model})` : ''}.\n`);
  const result = await executeRun({
    pipeline,
    worker,
    mode: 'full',
    input: request,
    outDir,
    onEvent: progressHandler(values),
  });

  const failures: string[] = [];
  if (!result.run.history.length) failures.push('no Judge pass completed');
  if (result.run.status === 'blocked') failures.push(`pipeline blocked: ${result.run.reason ?? 'unknown reason'}`);
  if (!result.run.final) failures.push('no final or provisional prompt was produced');
  if (!live) {
    if (result.run.status !== 'completed') failures.push(`fixture run ended ${result.run.status}, expected completed`);
    if (!result.run.final?.approved) failures.push('fixture run was not approved');
    if (!result.exported?.approved) failures.push('approved Markdown was not exported');
  }

  const passed = failures.length === 0;
  if (values.json) {
    process.stdout.write(`${JSON.stringify({
      passed,
      worker: workerName,
      live,
      status: result.run.status,
      scores: result.run.history.map(entry => ({ score: entry.score, verdict: entry.verdict })),
      run_id: result.run.id,
      exported: result.exported ?? null,
      failures,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`\n${passed ? 'PASS' : 'FAIL'} — ${result.run.status}; scores: ${historyLine(result.run)}\n`);
    if (result.exported) process.stdout.write(`Exported: ${result.exported.path}\n`);
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }
  return passed ? 0 : 1;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values.validate) return commandValidate(values);

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 1;
  }

  switch (command) {
    case 'install': return commandInstall(values);
    case 'validate': return commandValidate(values);
    case 'list': return commandList(values);
    case 'start': return commandStart(values, positionals.slice(1));
    case 'run': return commandRun(values, positionals.slice(1));
    case 'status': return commandStatus(values, positionals.slice(1));
    case 'submit': return commandSubmit(values, positionals.slice(1));
    case 'pause': return commandPause(values, positionals.slice(1));
    case 'resume': return commandResume(values, positionals.slice(1));
    case 'fix': return commandFix(values, positionals.slice(1));
    case 'export': return commandExport(values, positionals.slice(1));
    case 'test': return commandTest(values);
    default: throw new CliError(`Unknown command: ${command}. Run "promptzilla --help".`);
  }
}

main()
  .then(code => { process.exitCode = code; })
  .catch(error => {
    const message = error instanceof Error ? error.message : 'Command failed.';
    process.stderr.write(`promptzilla: ${message}\n`);
    process.exitCode = 1;
  });
