import { Option } from 'effect';
import type { Html } from 'foldkit/html';
import { Message } from '../message';
import type { Model } from '../model';
import { paletteItems } from '../palette';
import type { H } from './parts';

const KEYS: Record<string, Message> = {
  ArrowDown: Message.MovedPalette({ delta: 1 }),
  ArrowUp: Message.MovedPalette({ delta: -1 }),
  Escape: Message.ClosedPalette(),
};

export const palette = (h: H, model: Model): Html => {
  const state = model.palette;

  if (state === null) return null;

  const items = paletteItems(model, state.query);

  return h.div(
    [h.Class('dialog-backdrop'), h.OnClick(Message.ClosedPalette())],
    [
      h.div(
        [
          h.Class('dialog palette'),
          h.Id('palette'),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabel('Search threads and commands'),
          h.OnClick(Message.CompletedEffect(), { propagation: 'Stop' }),
        ],
        [
          h.input([
            h.Id('palette-input'),
            h.Placeholder('Search threads and commands'),
            h.Autocomplete('off'),
            h.Value(state.query),
            h.OnInput((query) => Message.UpdatedPalette({ query })),
            h.OnKeyDownPreventDefault((key) => {
              if (key === 'Enter') return Option.some(Message.ChosePalette({ index: state.index }));

              const mapped = KEYS[key];

              return mapped === undefined ? Option.none() : Option.some(mapped);
            }),
          ]),
          h.div(
            [h.Class('palette-list'), h.Role('listbox')],
            items.length === 0
              ? [h.div([h.Class('palette-empty')], ['Nothing matches.'])]
              : items.map((item, index) =>
                  h.button(
                    [
                      h.Class(index === state.index ? 'on' : ''),
                      h.Role('option'),
                      h.AriaSelected(index === state.index),
                      h.OnClick(Message.ChosePalette({ index })),
                    ],
                    [h.span([], [item.label]), h.span([h.Class('palette-hint')], [item.hint])],
                  ),
                ),
          ),
        ],
      ),
    ],
  );
};
