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

  need(ui.computer === 'sandbox-sdk', 'computer is not the Sandbox SDK');
  need(typeof ui.image === 'string' && ui.image.includes('nix'), 'image is not the nix image');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`receipt: ${problem}`);
  process.exit(1);
}

console.log('receipts prove the goal');
