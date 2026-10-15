import type { Html } from 'foldkit/html';
import { Option } from 'effect';
import { modelInfo } from '../../../shared/models';
import {
  groupLabel,
  matchesQuery,
  type PickerOption,
  pickerOptions,
  startsGroup,
} from '../model-picker';
import type { ThreadView, Usage } from '../../../shared/protocol';
import { Message } from '../message';
import type { Model } from '../model';
import type { H } from './parts';

export const tokens = (count: number): string => {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;

  return String(count);
};

export const contextShare = (usage: Usage): number =>
  usage.contextWindow === 0 ? 0 : Math.min(100, (usage.contextTokens / usage.contextWindow) * 100);

const percent = (share: number): string =>
  share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;

export const ringColor = (share: number): string => {
  if (share <= 0) return 'var(--line2)';
  if (share < 50) return 'var(--ok)';
  if (share < 70) return 'var(--warn)';
  if (share < 85) return 'var(--orange)';

  return 'var(--bad)';
};

const ring = (h: H, share: number, size: 'small' | 'big'): Html =>
  h.span(
    [h.Class(`ring ${size}`), h.Style({ '--share': `${share}%`, '--ring': ringColor(share) })],
    [],
  );

const detailRow = (h: H, label: string, value: string): Html =>
  h.div([h.Class('usage-row')], [h.span([], [label]), h.b([], [value])]);

const usageDetail = (h: H, model: Model, view: ThreadView): Html =>
  h.div(
    [h.Class('usage-pop'), h.Id('usage-pop'), h.Role('dialog'), h.Hidden(!model.usageOpen)],
    [
      h.div(
        [h.Class('usage-head')],
        [
          ring(h, contextShare(view.usage), 'big'),
          h.div(
            [],
            [
              h.b([], [`${percent(contextShare(view.usage))} of context`]),
              h.span(
                [],
                [
                  `${tokens(view.usage.contextTokens)} of ${tokens(view.usage.contextWindow)} tokens`,
                ],
              ),
            ],
          ),
        ],
      ),
      detailRow(h, 'Tokens in', tokens(view.usage.input)),
      detailRow(h, 'Tokens out', tokens(view.usage.output)),
      detailRow(h, 'Cache read', tokens(view.usage.cacheRead)),
      h.p([h.Class('usage-hint')], ['Compact when the ring turns orange.']),
    ],
  );

const MODEL_KEYS: Record<string, Message> = {
  ArrowDown: Message.MovedModelIndex({ delta: 1 }),
  ArrowUp: Message.MovedModelIndex({ delta: -1 }),
  Escape: Message.ClosedModelMenu(),
};

const price = (each: PickerOption) =>
  each.inputPerMtok === 0 && each.outputPerMtok === 0
    ? 'price n/a'
    : `$${each.inputPerMtok}/$${each.outputPerMtok}`;

const modelMeta = (each: PickerOption) =>
  [
    tokens(each.context),
    price(each),
    ...(each.vision ? ['sees images'] : []),
    ...(each.reasoning ? ['reasons'] : []),
  ].join(' · ');

const modelRow = (
  h: H,
  each: PickerOption,
  options: readonly PickerOption[],
  index: number,
  state: {
    readonly active: number;
    readonly current: string;
    readonly busy: boolean;
    readonly name: string;
  },
): readonly Html[] => [
  ...(startsGroup(options, index)
    ? [h.div([h.Class('model-group'), h.Role('presentation')], [groupLabel(each)])]
    : []),
  h.button(
    [
      h.Role('option'),
      h.Id(`model-option-${index}`),
      h.AriaSelected(index === state.active),
      h.DataAttribute('model', each.id),
      h.Class(
        [index === state.active ? 'active' : '', each.id === state.current ? 'on' : '']
          .join(' ')
          .trim(),
      ),
      h.Disabled(state.busy),
      h.OnClick(Message.ChoseModel({ name: state.name, index })),
    ],
    [
      h.span([h.Class('model-name')], [each.label]),
      h.span([h.Class('model-id')], [each.id]),
      h.span([h.Class('model-meta')], [modelMeta(each)]),
    ],
  ),
];

const modelMenu = (h: H, model: Model, view: ThreadView, name: string): Html => {
  const options = pickerOptions(model.models, model.modelQuery);
  const matched = model.models.filter((each) => matchesQuery(each, model.modelQuery)).length;
  const state = { active: model.modelIndex, current: view.model, busy: view.busy, name };

  return h.div(
    [h.Class('model-list'), h.Id('model-list'), h.Hidden(!model.modelMenuOpen)],
    [
      h.input([
        h.Id('model-search'),
        h.Class('model-search'),
        h.Role('combobox'),
        h.AriaExpanded(true),
        h.AriaControls('model-options'),
        h.AriaActiveDescendant(`model-option-${model.modelIndex}`),
        h.AriaLabel('Search models'),
        h.Placeholder(`Search ${model.models.length} models`),
        h.Autocomplete('off'),
        h.Value(model.modelQuery),
        h.OnInput((query) => Message.UpdatedModelQuery({ query })),
        h.OnKeyDownPreventDefault((key) => {
          if (key === 'Enter')
            return Option.some(Message.ChoseModel({ name, index: model.modelIndex }));

          const mapped = MODEL_KEYS[key];

          return mapped === undefined ? Option.none() : Option.some(mapped);
        }),
      ]),
      h.div(
        [h.Class('model-options'), h.Id('model-options'), h.Role('listbox')],
        options.length === 0
          ? [h.div([h.Class('model-empty')], ['No model matches.'])]
          : options.flatMap((each, index) => modelRow(h, each, options, index, state)),
      ),
      ...(matched > options.length
        ? [
            h.div(
              [h.Class('model-more')],
              [`Showing ${options.length} of ${matched}. Type to narrow.`],
            ),
          ]
        : []),
    ],
  );
};

export const meter = (h: H, model: Model, view: ThreadView, name: string): Html => {
  const share = contextShare(view.usage);

  return h.div(
    [h.Class('meter')],
    [
      h.span(
        [h.Class('pop-wrap'), h.DataAttribute('popover', 'model')],
        [
          h.button(
            [
              h.Class('pill'),
              h.Id('model'),
              h.DataAttribute('tip', 'Choose the model for this thread'),
              h.AriaHasPopup('menu'),
              h.OnClick(Message.ToggledModelMenu()),
            ],
            [
              model.models.find((each) => each.id === view.model)?.label ??
                modelInfo(view.model)?.label ??
                view.model.split('/').pop() ??
                view.model,
            ],
          ),
          modelMenu(h, model, view, name),
        ],
      ),
      h.span(
        [h.Class('pop-wrap'), h.DataAttribute('popover', 'usage')],
        [
          h.button(
            [
              h.Class('usage'),
              h.Id('usage'),
              h.DataAttribute('tip', `Context ${percent(share)}`),
              h.AriaLabel(`Context ${percent(share)} used`),
              h.OnClick(Message.ToggledUsage()),
            ],
            [ring(h, share, 'small')],
          ),
          usageDetail(h, model, view),
        ],
      ),
    ],
  );
};
