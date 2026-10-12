import { Effect, Queue, Schema, Stream } from 'effect';
import { Mount } from 'foldkit';
import { Message } from './message';
import { attachBrowser } from './surfaces/browser';
import { attachTerminal } from './surfaces/terminal';

const hold = <A>(
  attach: (element: HTMLElement, emit: (message: A) => void) => () => void,
  element: Element,
) =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        element instanceof HTMLElement
          ? attach(element, (message) => Queue.offerUnsafe(queue, message))
          : () => undefined,
      ),
      (detach) => Effect.sync(detach),
    ).pipe(Effect.andThen(Effect.never)),
  );

export const TerminalSurface = Mount.defineStream('TerminalSurface', {
  args: { thread: Schema.String, id: Schema.String },
  messages: [Message.CompletedEffect],
  execute: ({ element, thread, id }) =>
    hold(() => attachTerminal(element as HTMLElement, thread, id), element),
});

export const BrowserSurface = Mount.defineStream('BrowserSurface', {
  args: { thread: Schema.String },
  messages: [Message.FailedSurface],
  execute: ({ element, thread }) =>
    hold<typeof Message.FailedSurface.Type>(
      (host, emit) =>
        attachBrowser(host, thread, (reason) => emit(Message.FailedSurface({ reason }))),
      element,
    ),
});

export const ScrollToEnd = Mount.define('ScrollToEnd', {
  args: { key: Schema.String },
  messages: [Message.CompletedEffect],
  execute: ({ element }) =>
    Effect.sync(() => {
      const feed = element.closest('.feed');

      if (feed !== null) feed.scrollTop = feed.scrollHeight;

      return Message.CompletedEffect();
    }),
});
