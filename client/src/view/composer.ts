import { Option } from 'effect';
import type { Html } from 'foldkit/html';
import { Message } from '../message';
import type { Model } from '../model';
import { viewOf } from '../update';
import { type H, spinner } from './parts';

const hint = (model: Model): string => {
  const view = viewOf(model);

  if (view === null) return '';
  if (view.busy) return 'Working. You can leave; it keeps going.';
  if (view.phase === 'paused') return 'Paused. Sending resumes it from the saved disk.';

  return '';
};

export const composer = (h: H, model: Model): Html => {
  const view = viewOf(model);
  const working = view?.busy ?? false;

  return h.div(
    [
      h.Class('composer'),
      h.Id('composer'),
      h.Style({ display: model.name === null ? 'none' : '' }),
    ],
    [
      h.div(
        [h.Class('composer-inner')],
        [
          h.textarea([
            h.Id('text'),
            h.Rows(1),
            h.Placeholder('Ask the agent to do something in its computer'),
            h.Value(model.draft),
            h.OnInput((value) => Message.UpdatedDraft({ value })),
            h.OnKeyDownPreventDefault((key, modifiers) =>
              key === 'Enter' && !modifiers.shiftKey
                ? Option.some(Message.SubmittedDraft())
                : Option.none(),
            ),
          ]),
          h.div(
            [h.Class('composer-foot')],
            [
              h.div([h.Class('hint'), h.Id('hint')], [hint(model)]),
              h.button(
                [
                  h.Id('send'),
                  h.AriaLabel('Send'),
                  h.Disabled(view === null || working),
                  h.OnClick(Message.SubmittedDraft()),
                ],
                [working ? spinner(h) : '↑'],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};
