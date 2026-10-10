import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const need = (ok, message) => {
  if (!ok) problems.push(message);
};

const read = (path) => {
  if (!existsSync(path)) {
    problems.push(`${path} missing`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
};

const ui = read('receipts/live-ui.json');

if (ui !== null) {
  const steps = new Map((ui.steps ?? []).map((step) => [step.step, step]));
  const required = ['create', 'live-stream', 'pause', 'resume', 'compact', 'fork', 'child'];

  for (const name of required) {
    const step = steps.get(name);
    need(step !== undefined && step.ok === true, `live-ui step ${name} missing or not ok`);
  }

  need(
    (steps.get('live-stream')?.eventsBeforeDone ?? 0) >= 3,
    'live-stream saw fewer than 3 events before the turn finished',
  );
  need(
    steps.get('resume')?.fileSurvived === true,
    'resume did not show the file from before pause',
  );
  need(typeof steps.get('compact')?.summaryEntry === 'string', 'compact recorded no summary entry');
  need(
    steps.get('fork')?.forkSawParentFile === true,
    'fork did not start from the parent snapshot',
  );
  need(
    typeof steps.get('child')?.childResult === 'string' &&
      steps.get('child').childResult.length > 0,
    'child thread returned no result',
  );

  const listed = new Set(ui.freshBrowserThreadList ?? []);
  need(
    ui.mcpCreatedThread !== undefined && listed.has(ui.mcpCreatedThread),
    'fresh browser list lacks the MCP-created thread',
  );
  need(
    ui.scriptCreatedThread !== undefined && listed.has(ui.scriptCreatedThread),
    'fresh browser list lacks the script-created thread',
  );

  need(
    ui.isolation?.aHasFile === true &&
      ui.isolation?.bHasFile === false &&
      ui.isolation?.hostnamesDiffer === true,
    'live isolation not proven',
  );

  for (const shot of ['receipts/shots/desktop.png', 'receipts/shots/phone.png'])
    need(existsSync(shot), `${shot} missing`);

  need(
    ui.warmStart?.ok === true && ui.warmStart?.startedFromBase === true,
    'warm start not proven',
  );
  need(ui.computer === 'sandbox-sdk', 'computer is not the Sandbox SDK');
  need(typeof ui.image === 'string' && ui.image.includes('nix'), 'image is not the nix image');
}

const v3 = read('receipts/live-v3.json');

if (v3 !== null) {
  const steps = new Map((v3.steps ?? []).map((step) => [step.step, step]));

  for (const name of [
    'two-terminals',
    'reattach',
    'browser-localhost',
    'browser-click',
    'agent-browser',
  ]) {
    need(steps.get(name)?.ok === true, `live-v3 step ${name} missing or not ok`);
  }

  need(steps.get('reattach')?.historyShown === true, 'reattach did not show the earlier output');
  need(
    steps.get('two-terminals')?.ttyA !== steps.get('two-terminals')?.ttyB,
    'the two terminals shared one tty',
  );
  need(v3.deployed === 'https://coil.coey.dev', 'live-v3 did not run on the deployed site');

  for (const shot of v3.shots ?? []) need(existsSync(shot), `${shot} missing`);
  need(
    (v3.shots ?? []).some((s) => s.includes('phone')),
    'no phone screenshot',
  );
}

const evaluation = read('receipts/browser-eval.json');

if (evaluation !== null) {
  for (const engine of ['homegrown', 'browser_run_chromium', 'kitesurf']) {
    const e = evaluation.engines?.[engine];
    need(
      e !== undefined &&
        e.cold_start_ms !== undefined &&
        e.fps !== undefined &&
        e.click_ms !== undefined,
      `browser-eval lacks ${engine}`,
    );
    need(
      typeof e?.reaches_container_localhost === 'boolean',
      `browser-eval lacks localhost reach for ${engine}`,
    );
  }
  need(typeof evaluation.choice === 'string', 'browser-eval has no choice');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`receipt: ${problem}`);
  process.exit(1);
}

console.log('receipts prove the goal');
