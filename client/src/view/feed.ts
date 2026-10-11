import { Effect } from 'effect';
import type { Html } from 'foldkit/html';
import type { ChatMessage, ThreadView } from '../../../shared/protocol';
import { Message } from '../message';
import { type LiveTool, type Model, ViewState } from '../model';
import { ScrollToEnd } from '../mount';
import { markdown } from './markdown';
import { type H, skeleton, spinner } from './parts';

const EXIT_CODE = /^exit (\d+)/;

const toolTarget = (args: string): string => {
  const parsed = Effect.runSync(
    Effect.try(() => JSON.parse(args) as unknown).pipe(Effect.orElseSucceed(() => null)),
  );

  if (typeof parsed !== 'object' || parsed === null) return args;

  const fields = parsed as Record<string, unknown>;

  for (const key of ['command', 'path', 'task', 'name'])
    if (typeof fields[key] === 'string') return fields[key];

  return args;
};

const tool = (
  h: H,
  key: string,
  name: string,
  args: string,
  output: string | null,
  running: boolean,
  failed: boolean,
): Html =>
  h.keyed('details')(
    key,
    [h.Class(`tool${failed ? ' failed' : ''}`), h.DataAttribute('tool', name)],
    [
      h.summary(
        [],
        [
          running ? spinner(h) : h.span([h.Class('caret')], ['▶']),
          h.b([], [name]),
          h.span([h.Class('arg')], [toolTarget(args)]),
        ],
      ),
      h.pre([], [output ?? args]),
    ],
  );

const richText = (h: H, text: string): Html => markdown(h, text);

const message = (h: H, entry: ChatMessage, results: ReadonlyMap<string, string>): Html | null => {
  if (entry.role === 'tool' && entry.tool !== undefined) {
    const output = results.get(entry.tool.id) ?? null;
    const exit = output === null ? null : EXIT_CODE.exec(output);

    return tool(
      h,
      entry.id,
      entry.tool.name,
      entry.tool.args,
      output === null ? null : output || '(no output)',
      false,
      exit?.[1] !== undefined && exit[1] !== '0',
    );
  }

  if (entry.kind === 'pi.compaction')
    return h.keyed('div')(
      entry.id,
      [h.Class('msg summary')],
      [h.div([h.Class('label')], ['Compaction summary']), h.div([h.Class('body')], [entry.text])],
    );

  if ((entry.role !== 'user' && entry.role !== 'assistant') || entry.text === '') return null;

  return h.keyed('div')(
    entry.id,
    [h.Class(`msg ${entry.role}`)],
    [
      ...(entry.role === 'user' ? [] : [h.div([h.Class('label')], ['agent'])]),
      entry.role === 'user' ? h.div([h.Class('body')], [entry.text]) : richText(h, entry.text),
      ...(entry.role === 'user' && entry.id !== 'pending'
        ? [
            h.div(
              [h.Class('msg-tools')],
              [
                h.button(
                  [
                    h.Class('edit'),
                    h.Title('Put this text back in the box to edit it'),
                    h.OnClick(Message.ClickedEdit({ text: entry.text })),
                  ],
                  ['Edit'],
                ),
                h.button(
                  [
                    h.Class('retry'),
                    h.Title('Send this again as a new turn'),
                    h.OnClick(Message.ClickedRetry({ text: entry.text })),
                  ],
                  ['Retry'],
                ),
              ],
            ),
          ]
        : []),
    ],
  );
};

const toolResults = (messages: readonly ChatMessage[]): ReadonlyMap<string, string> =>
  new Map(
    messages
      .filter((entry) => entry.role === 'toolResult' && entry.toolCallId !== undefined)
      .map((entry) => [entry.toolCallId ?? '', entry.text]),
  );

const ready = (h: H, view: ThreadView): Html =>
  h.div(
    [h.Class('empty inline')],
    [
      h.div(
        [h.Class('empty-inner')],
        [
          h.h2([], ['Ready when you are']),
          h.p(
            [],
            [
              view.repo === null
                ? 'Its computer has an empty git repo in /workspace.'
                : `Its computer has ${view.repo} checked out in /workspace.`,
            ],
          ),
          h.p(
            [h.Class('faint')],
            [
              view.origin.forkedFrom !== null
                ? `Forked from ${view.origin.forkedFrom}: it starts from that disk and a summary of that conversation.`
                : view.origin.parent !== null
                  ? `A child thread started by ${view.origin.parent}.`
                  : view.origin.base !== null
                    ? 'It started warm, from a prepared snapshot of this repo.'
                    : 'Ask it to build, fix, or explore something.',
            ],
          ),
        ],
      ),
    ],
  );

const liveItems = (h: H, model: Model): Html[] => {
  const live = model.live;

  if (live === null) return [];

  const tools = live.tools.map((each: LiveTool) =>
    tool(h, `live-${each.id}`, each.name, each.args, each.output, !each.done, false),
  );

  if (live.text !== '')
    return [
      ...tools,
      h.keyed('div')(
        'live-text',
        [h.Class('msg assistant'), h.Id('live-text')],
        [h.div([h.Class('label')], [spinner(h), 'agent']), markdown(h, live.text)],
      ),
    ];

  if (live.tools.every((each) => each.done))
    return [
      ...tools,
      h.keyed('div')(
        'live-wait',
        [h.Class('msg'), h.Id('live-wait')],
        [h.div([h.Class('label')], [spinner(h), live.compacting ? 'compacting…' : 'thinking…'])],
      ),
    ];

  return tools;
};

const welcome = (h: H): Html =>
  h.div(
    [h.Class('empty')],
    [
      h.div(
        [h.Class('empty-inner')],
        [
          h.div([h.Class('mark')], []),
          h.h2([], ['One thread, one agent, one computer']),
          h.p(
            [],
            [
              'Each thread gets its own Linux machine with a git checkout. Pause it and the disk is saved. Come back later and it resumes where it left off. Fork it to try another idea from the same point.',
            ],
          ),
          h.button(
            [
              h.Class('primary'),
              h.DataAttribute('new', '1'),
              h.OnClick(Message.ClickedNewThread()),
            ],
            ['New thread'],
          ),
        ],
      ),
    ],
  );

const conversation = (h: H, model: Model, view: ThreadView): Html => {
  const results = toolResults(view.messages);
  const items = view.messages
    .filter((entry) => entry.role !== 'toolResult')
    .map((entry) => message(h, entry, results))
    .filter((item): item is Html => item !== null);
  const live = liveItems(h, model);
  const endKey = `${view.messages.length}:${model.live?.text.length ?? 0}:${model.live?.tools.length ?? 0}`;

  return h.div(
    [h.Class('feed-inner')],
    [
      ...(items.length === 0 && model.live === null ? [ready(h, view)] : []),
      ...items,
      ...live,
      h.keyed('div')(endKey, [h.Class('feed-end'), h.OnMount(ScrollToEnd({ key: endKey }))], []),
    ],
  );
};

export const feed = (h: H, model: Model): Html => {
  const body =
    model.name === null
      ? welcome(h)
      : ViewState.match(model.view, {
          Loading: () => h.div([h.Class('feed-inner')], [skeleton(h)]),
          Failed: ({ reason }) =>
            h.div(
              [h.Class('err')],
              [reason, h.button([h.OnClick(Message.ClickedRetryView())], ['Retry'])],
            ),
          Ready: ({ value }) => conversation(h, model, value),
        });

  return h.section([h.Class('feed'), h.Id('feed'), h.AriaLive('polite')], [body]);
};
