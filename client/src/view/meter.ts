import type { Html } from 'foldkit/html';
import { MODELS, modelInfo } from '../../../shared/models';
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

const modelMenu = (h: H, model: Model, view: ThreadView, name: string): Html =>
  h.div(
    [h.Class('model-list'), h.Id('model-list'), h.Role('menu'), h.Hidden(!model.modelMenuOpen)],
    MODELS.map((each) =>
      h.button(
        [
          h.Role('menuitemradio'),
          h.AriaChecked(each.id === view.model),
          h.DataAttribute('model', each.id),
          h.Class(each.id === view.model ? 'on' : ''),
          h.Disabled(view.busy),
          h.OnClick(Message.ClickedOp({ name, op: { _tag: 'SetModel', model: each.id } })),
        ],
        [
          h.span([h.Class('model-name')], [each.label]),
          h.span(
            [h.Class('model-meta')],
            [
              `${tokens(each.context)} · $${each.inputPerMtok}/$${each.outputPerMtok}${each.vision ? ' · sees images' : ''}`,
            ],
          ),
        ],
      ),
    ),
  );

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
            [modelInfo(view.model)?.label ?? view.model.split('/').pop() ?? view.model],
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
