import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { ModelChoice } from '../../src/agent';
import type { Computer } from '../../src/computer';
import { Thread } from '../../src/thread';
import { memoryComputer } from '../memory-computer';

type Context = {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly toolName?: string;
    readonly content?: unknown;
  }>;
};

const asked = (context: Context): string => {
  const last = [...context.messages].reverse().find((message) => message.role === 'user');
  const content = last?.content;

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

const fileFrom = (request: string): { path: string; content: string } | null => {
  const match = /write (\S+) containing (.+)$/.exec(request);

  return match === null || match[1] === undefined || match[2] === undefined
    ? null
    : { path: match[1], content: match[2] };
};

const scripted = (): ModelChoice => {
  const faux = fauxProvider({ tokensPerSecond: 200 });

  faux.setResponses(
    Array.from({ length: 200 }, () => (context: Context) => {
      const request = asked(context);

      if (request.includes('Summarize') || request.includes('summary'))
        return fauxAssistantMessage(
          fauxText('Summary: the thread wrote files into its own computer.'),
        );

      const file = fileFrom(request);

      if (file !== null && !toolRan(context))
        return fauxAssistantMessage(
          [fauxText('Writing it now. '.repeat(40)), fauxToolCall('write_file', file)],
          { stopReason: 'toolUse' },
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

  protected override settings() {
    return { compaction: { keepRecentTokens: 1 } };
  }

  protected override computer(): Computer {
    return memoryComputer(this.ctx.id.toString());
  }
}

type Env = { readonly THREAD: DurableObjectNamespace<TestThread> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = (name: string) => env.THREAD.getByName(name);
    const run = url.searchParams.get('run') ?? crypto.randomUUID().slice(0, 8);

    if (url.pathname === '/isolation') {
      const a = `a-${run}`;
      const b = `b-${run}`;

      await stub(a).create(a, null);
      await stub(b).create(b, null);
      await stub(a).send('r1', 'write secret.txt containing only-in-a');

      const inA = await stub(a).exec(['sh', '-lc', 'ls']);
      const inB = await stub(b).exec(['sh', '-lc', 'ls']);
      const bRead = await stub(b)
        .readFile('secret.txt')
        .then(
          () => 'read',
          (error: Error) => `refused: ${error.message.slice(0, 40)}`,
        );

      return Response.json({ inA: inA.stdout, inB: inB.stdout, bRead });
    }

    if (url.pathname === '/kill') {
      const name = `k-${run}`;

      await stub(name).create(name, null);

      const sending = stub(name)
        .send('req-1', 'write note.txt containing survived')
        .catch((error: Error) => `dropped: ${error.message.slice(0, 30)}`);

      await sleep(150);

      const killed = await stub(name)
        .kill('killed by the test')
        .then(
          () => 'returned',
          (error: Error) =>
            String(error).includes('killed by the test') ? 'aborted' : String(error),
        );

      await sending;

      for (let i = 0; i < 80; i += 1) {
        const view = await stub(name).view();
        const answered = view.messages.some(
          (message) => message.role === 'assistant' && message.text === 'Done.',
        );

        if (answered) {
          const file = await stub(name)
            .readFile('note.txt')
            .catch(() => null);
          const turns = view.messages.filter((message) => message.role === 'user').length;

          return Response.json({ killed, file, turns, done: true });
        }

        await sleep(150);
      }

      return Response.json({ killed, done: false }, { status: 500 });
    }

    if (url.pathname === '/compact') {
      const name = `c-${run}`;

      await stub(name).create(name, null);
      await stub(name).send('r1', 'write a.txt containing first');
      await stub(name).send('r2', 'write b.txt containing second');

      const pair = await stub(name).compact();
      const paused = await stub(name).pause();
      const afterPause = await stub(name).view();

      await stub(name)
        .kill('killed after compaction')
        .catch(() => undefined);

      const resumedFiles = await stub(name).exec(['sh', '-lc', 'ls']);

      await stub(name).send('r3', 'write c.txt containing third');

      const view = await stub(name).view();

      return Response.json({
        pairReason: pair.reason,
        summaryEntry: pair.summaryEntry,
        pausedReason: paused?.reason ?? null,
        phaseAfterPause: afterPause.phase,
        runningAfterPause: afterPause.running,
        resumedFiles: resumedFiles.stdout,
        pairs: view.pairs.map((p) => p.reason),
        hasSummary: view.messages.some((message) => message.kind === 'pi.compaction'),
        lastAnswer:
          view.messages.filter((message) => message.role === 'assistant').at(-1)?.text ?? null,
        finalFiles: (await stub(name).exec(['sh', '-lc', 'ls'])).stdout,
      });
    }

    return new Response('not found', { status: 404 });
  },
};
