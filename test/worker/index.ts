import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { ModelChoice } from '../../src/agent';
import type { Computer } from '../../src/computer';
import { burrow } from '../../src/service';
import { type Env, Thread } from '../../src/thread';
import { memoryComputer } from '../memory-computer';

export { Directory } from '../../src/directory';

type Context = {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content?: unknown }>;
};

const asked = (context: Context): string => {
  const content = [...context.messages].reverse().find((m) => m.role === 'user')?.content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '',
      )
      .join('');

  return '';
};

const toolRan = (context: Context) => context.messages.at(-1)?.role === 'toolResult';

const fileFrom = (request: string) => {
  const match = /write (\S+) containing (.+)$/.exec(request);

  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { path: match[1], content: match[2] };
};

const scripted = (): ModelChoice => {
  const faux = fauxProvider({ tokensPerSecond: 200 });

  faux.setResponses(
    Array.from({ length: 400 }, () => (context: Context) => {
      const request = asked(context);

      if (request.includes('Summarize') || request.includes('summary'))
        return fauxAssistantMessage(
          fauxText('Summary: the thread wrote files into its own computer.'),
        );

      const file = fileFrom(request);

      if (file !== null && !toolRan(context))
        return fauxAssistantMessage(
          [fauxText('Writing it now. '.repeat(40)), fauxToolCall('write_file', file)],
          {
            stopReason: 'toolUse',
          },
        );

      return fauxAssistantMessage(fauxText('Done.'));
    }),
  );

  return { provider: faux.provider, modelId: faux.models[0].id, options: {} };
};

export class TestThread extends Thread {
  protected override model(): ModelChoice {
    return scripted();
  }

  protected override computer(): Computer {
    return memoryComputer(this.ctx.id.toString());
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const api = burrow(env);
    const stub = (name: string) => env.THREAD.getByName(name);
    const run = url.searchParams.get('run') ?? crypto.randomUUID().slice(0, 8);

    if (url.pathname === '/isolation') {
      const a = `a-${run}`;
      const b = `b-${run}`;

      await api.create({ name: a, createdBy: 'test' });
      await api.create({ name: b, createdBy: 'test' });
      await api.send(a, 'r1', 'write secret.txt containing only-in-a');

      const inA = await api.exec(a, ['bash', '-lc', 'ls']);
      const inB = await api.exec(b, ['bash', '-lc', 'ls']);
      const bRead = await api.read(b, 'secret.txt').then(
        () => 'read',
        (error: Error) => `refused: ${error.message.slice(0, 40)}`,
      );

      return Response.json({ inA: inA.stdout, inB: inB.stdout, bRead });
    }

    if (url.pathname === '/kill') {
      const name = `k-${run}`;

      await api.create({ name, createdBy: 'test' });
      await stub(name).start('req-1', 'write note.txt containing survived');
      await sleep(150);

      const killed = await stub(name)
        .kill('killed by the test')
        .then(
          () => 'returned',
          (error: Error) =>
            String(error).includes('killed by the test') ? 'aborted' : String(error),
        );

      const answer = await stub(name).waitForAnswer();
      const view = await stub(name).view();
      const file = await stub(name)
        .readFile('note.txt')
        .catch(() => null);

      return Response.json({
        killed,
        answer,
        file,
        busy: view.busy,
        turns: view.messages.filter((m) => m.role === 'user').length,
      });
    }

    if (url.pathname === '/compact') {
      const name = `c-${run}`;

      await api.create({ name, createdBy: 'test' });
      await api.send(name, 'r1', 'write a.txt containing first');
      await api.send(name, 'r2', 'write b.txt containing second');

      const pair = await api.compact(name);
      const paused = await api.pause(name);
      const afterPause = await api.view(name);

      await stub(name)
        .kill('killed after compaction')
        .catch(() => undefined);

      const resumedFiles = await api.exec(name, ['bash', '-lc', 'ls']);

      await api.send(name, 'r3', 'write c.txt containing third');

      const view = await api.view(name);

      return Response.json({
        pairReason: pair.reason,
        summaryEntry: pair.summaryEntry,
        pausedReason: paused?.reason ?? null,
        phaseAfterPause: afterPause.phase,
        runningAfterPause: afterPause.running,
        resumedFiles: resumedFiles.stdout,
        pairs: view.pairs.map((p) => p.reason),
        hasSummary: view.messages.some((m) => m.kind === 'pi.compaction'),
        summaryIdMatches: view.messages.some(
          (m) => m.kind === 'pi.compaction' && m.id === pair.summaryEntry,
        ),
        lastAnswer:
          view.messages.filter((m) => m.role === 'assistant' && m.text !== '').at(-1)?.text ?? null,
        finalFiles: (await api.exec(name, ['bash', '-lc', 'ls'])).stdout,
      });
    }

    if (url.pathname === '/directory-fork-child') {
      const name = `d-${run}`;

      await api.create({ name, createdBy: 'mcp', title: 'parent' });
      await api.send(name, 'r1', 'write plan.txt containing the plan');

      const forked = await api.fork(name, `${name}-f`, 'web');
      const forkSees = await api.read(forked.name, 'plan.txt').catch(() => null);

      await api.exec(forked.name, ['bash', '-lc', 'true']);
      await stub(forked.name).readFile('plan.txt');

      const list = await api.list();
      const mine = list.filter((t) => t.name.startsWith(name));

      return Response.json({
        listed: mine.map((t) => ({
          name: t.name,
          createdBy: t.createdBy,
          forkedFrom: t.forkedFrom,
        })),
        forkSees,
        forkOrigin: forked.origin,
        forkSeeded: forked.origin.forkedFrom === name,
        unknown: await api.view('nope-nope').then(
          () => 'found',
          (error: Error) => error.message,
        ),
      });
    }

    return new Response('not found', { status: 404 });
  },
};
