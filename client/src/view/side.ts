import type { Html } from 'foldkit/html';
import type { ThreadSummary } from '../../../shared/protocol';
import { Message } from '../message';
import { type Model, ThreadsState } from '../model';
import { pathForThread } from '../route';
import { type H, phaseKey, phaseLabel, short, skeleton } from './parts';

const GROUPS: readonly [string, (thread: ThreadSummary) => boolean][] = [
  ['Working', (thread) => thread.busy],
  ['Running', (thread) => !thread.busy && thread.phase === 'awake'],
  ['Paused', (thread) => !thread.busy && thread.phase !== 'awake'],
];

const rowTitle = (thread: ThreadSummary): string =>
  [
    thread.title,
    phaseLabel(thread),
    thread.forkedFrom === null ? null : `fork of ${thread.forkedFrom}`,
    thread.createdBy === 'web' ? null : `via ${thread.createdBy}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

const row = (h: H, model: Model, thread: ThreadSummary, child: boolean): Html =>
  h.keyed('a')(
    thread.name,
    [
      h.Class(`item${thread.name === model.name ? ' on' : ''}${child ? ' child' : ''}`),
      h.Href(pathForThread(thread.name)),
      h.DataAttribute('thread', thread.name),
      h.Title(rowTitle(thread)),
      h.OnClick(Message.ClickedThread({ name: thread.name }), { defaultAction: 'Prevent' }),
    ],
    [
      h.span([h.Class(`dot ${phaseKey(thread)}`)], []),
      h.span([h.Class('t')], [thread.title === '' ? thread.name : thread.title]),
      h.span([h.Class('m')], [short(model.now, thread.updatedAt)]),
    ],
  );

const threadList = (h: H, model: Model, threads: readonly ThreadSummary[]): Html[] => {
  if (threads.length === 0)
    return [
      h.div(
        [h.Class('empty inline')],
        [h.div([h.Class('empty-inner')], [h.p([], ['No threads yet.'])])],
      ),
    ];

  const names = new Set(threads.map((thread) => thread.name));
  const children = new Map<string, ThreadSummary[]>();

  for (const thread of threads)
    if (thread.parent !== null && names.has(thread.parent))
      children.set(thread.parent, [...(children.get(thread.parent) ?? []), thread]);

  const roots = threads.filter((thread) => !(thread.parent !== null && names.has(thread.parent)));

  return GROUPS.flatMap(([label, belongs]) => {
    const members = roots.filter(belongs);

    if (members.length === 0) return [];

    return [
      h.div([h.Class('group')], [`${label} ${members.length}`]),
      ...members.flatMap((thread) => [
        row(h, model, thread, false),
        ...(children.get(thread.name) ?? []).map((kid) => row(h, model, kid, true)),
      ]),
    ];
  });
};

const listBody = (h: H, model: Model): Html[] =>
  ThreadsState.match(model.threads, {
    Loading: () => [skeleton(h)],
    Failed: ({ reason }) => [
      h.div(
        [h.Class('err')],
        [
          `Could not load threads. ${reason}`,
          h.button([h.OnClick(Message.ClickedRetryThreads())], ['Retry']),
        ],
      ),
    ],
    Ready: ({ value }) => threadList(h, model, value),
  });

export const side = (h: H, model: Model): Html =>
  h.aside(
    [h.Class('side')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.b(
            [h.Class('logo')],
            [
              h.img([h.Src('/icons/coil.svg'), h.Alt(''), h.Width('20'), h.Height('20')]),
              'co',
              h.span([], ['il']),
            ],
          ),
          h.span(
            [h.Style({ display: 'flex', gap: '2px', 'align-items': 'center' })],
            [
              h.button(
                [
                  h.Class('narrow'),
                  h.Id('side-close'),
                  h.AriaLabel('Close'),
                  h.OnClick(Message.ClosedDrawer()),
                ],
                ['✕'],
              ),
              h.button(
                [
                  h.Class('new'),
                  h.Id('new-side'),
                  h.Title('New thread'),
                  h.AriaLabel('New thread'),
                  h.OnClick(Message.ClickedNewThread()),
                ],
                ['+'],
              ),
            ],
          ),
        ],
      ),
      h.nav([h.Class('list'), h.Id('list'), h.AriaLabel('Threads')], listBody(h, model)),
      h.div(
        [h.Class('who')],
        [
          h.span([h.Id('whoami')], [model.who]),
          h.button(
            [
              h.Id('install'),
              h.Hidden(!model.installable),
              h.Title('Install coil as an app'),
              h.OnClick(Message.ClickedInstall()),
            ],
            ['Install'],
          ),
          h.button(
            [
              h.Id('theme'),
              h.Title('Switch light or dark'),
              h.AriaLabel('Theme'),
              h.OnClick(Message.ClickedTheme()),
            ],
            ['◐'],
          ),
        ],
      ),
    ],
  );
