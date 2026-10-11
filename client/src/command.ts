import { Duration, Effect, Schema } from 'effect';
import type { RpcClientError } from 'effect/rpc';
import { Command, Navigation } from 'foldkit';
import { type CoilError, Size, SurfaceKind } from '../../shared/protocol';
import { Message } from './message';
import { Action, Theme, ThreadOp } from './model';
import { CoilClient } from './rpc';

export const reasonOf = (error: CoilError | RpcClientError.RpcClientError): string => {
  switch (error._tag) {
    case 'UnknownThread':
      return `unknown thread ${error.name}`;
    case 'NameTaken':
      return `The name ${error.name} is taken`;
    case 'RpcClientError':
      return `could not reach coil (${error.message})`;
    default:
      return error.reason;
  }
};

export const LoadWho = Command.define('LoadWho', {
  messages: [Message.LoadedWho],
  execute: Effect.gen(function* () {
    const client = yield* CoilClient;
    const { who } = yield* client.WhoAmI();

    return Message.LoadedWho({ who });
  }).pipe(Effect.orElseSucceed(() => Message.LoadedWho({ who: '' }))),
});

export const LoadThreads = Command.define('LoadThreads', {
  messages: [Message.LoadedThreads, Message.FailedThreads],
  execute: Effect.gen(function* () {
    const client = yield* CoilClient;

    return Message.LoadedThreads({ threads: yield* client.ListThreads() });
  }).pipe(
    Effect.catch((error) => Effect.succeed(Message.FailedThreads({ reason: reasonOf(error) }))),
  ),
});

export const LoadView = Command.define('LoadView', {
  args: { name: Schema.String, refresh: Schema.Boolean },
  messages: [Message.LoadedView, Message.RefreshedView, Message.FailedView],
  execute: ({ name, refresh }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;
      const view = yield* client.ViewThread({ name });

      return refresh ? Message.RefreshedView({ name, view }) : Message.LoadedView({ name, view });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedView({ name, reason: reasonOf(error) })),
      ),
    ),
});

export const RefreshViewSoon = Command.define('RefreshViewSoon', {
  args: { name: Schema.String },
  messages: [Message.RefreshedView, Message.FailedView],
  interrupt: true,
  execute: ({ name }) =>
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(300));

      const client = yield* CoilClient;

      return Message.RefreshedView({ name, view: yield* client.ViewThread({ name }) });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedView({ name, reason: reasonOf(error) })),
      ),
    ),
});

export const SendMessage = Command.define('SendMessage', {
  args: { name: Schema.String, text: Schema.String },
  messages: [Message.SentMessage, Message.FailedSend],
  execute: ({ name, text }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      yield* client.StartMessage({ name, text, requestId: crypto.randomUUID() });

      return Message.SentMessage({ name });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedSend({ name, text, reason: reasonOf(error) })),
      ),
    ),
});

export const RunAction = Command.define('RunAction', {
  args: { name: Schema.String, action: Action },
  messages: [Message.CompletedAction, Message.FailedAction, Message.ForkedInto],
  execute: ({ name, action }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      if (action === 'fork') return Message.ForkedInto({ view: yield* client.Fork({ name }) });

      if (action === 'compact') {
        yield* client.Compact({ name });

        return Message.CompletedAction({
          name,
          action,
          note: 'Compacted. Summary and disk saved together.',
        });
      }

      yield* client.Pause({ name });

      return Message.CompletedAction({
        name,
        action,
        note: 'Paused. The disk is saved and the computer is off.',
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAction({ name, action, reason: reasonOf(error) })),
      ),
    ),
});

export const Resize = Command.define('Resize', {
  args: { name: Schema.String, size: Size },
  messages: [Message.CompletedAction, Message.FailedAction],
  execute: ({ name, size }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;
      const result = yield* client.Resize({ name, size });
      const note = result.restarted
        ? `Restarted at ${size}. The disk was kept.`
        : `The computer will start at ${size}.`;

      return Message.CompletedAction({ name, action: 'size', note });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAction({ name, action: 'size', reason: reasonOf(error) })),
      ),
    ),
});

export const AddSurface = Command.define('AddSurface', {
  args: { name: Schema.String, kind: SurfaceKind },
  messages: [Message.AddedSurface, Message.FailedSurface],
  execute: ({ name, kind }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      return Message.AddedSurface({
        name,
        kind,
        surfaces: yield* client.AddSurface({ name, kind }),
      });
    }).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedSurface({ reason: reasonOf(error) }))),
    ),
});

export const CloseSurface = Command.define('CloseSurface', {
  args: { name: Schema.String, id: Schema.String },
  messages: [Message.ChangedSurfaces, Message.FailedSurface],
  execute: ({ name, id }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      return Message.ChangedSurfaces({ name, surfaces: yield* client.CloseSurface({ name, id }) });
    }).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedSurface({ reason: reasonOf(error) }))),
    ),
});

export const LoadDir = Command.define('LoadDir', {
  args: { name: Schema.String, path: Schema.String },
  messages: [Message.LoadedDir, Message.FailedFiles],
  execute: ({ name, path }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      return Message.LoadedDir({ name, path, entries: yield* client.ListDir({ name, path }) });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedFiles({ name, reason: reasonOf(error) })),
      ),
    ),
});

export const LoadFile = Command.define('LoadFile', {
  args: { name: Schema.String, path: Schema.String },
  messages: [Message.LoadedFile, Message.FailedFiles],
  execute: ({ name, path }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;

      return Message.LoadedFile({ name, path, text: yield* client.ReadFile({ name, path }) });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedFiles({ name, reason: reasonOf(error) })),
      ),
    ),
});

export const CreateThread = Command.define('CreateThread', {
  args: { repo: Schema.String, title: Schema.String, size: Size },
  messages: [Message.CreatedThread, Message.FailedCreate],
  execute: ({ repo, title, size }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;
      const view = yield* client.CreateThread({
        repo: repo === '' ? null : repo,
        title: title === '' ? undefined : title,
        size,
      });

      return Message.CreatedThread({ view });
    }).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedCreate({ reason: reasonOf(error) }))),
    ),
});

export const PushUrl = Command.define('PushUrl', {
  args: { url: Schema.String },
  messages: [Message.CompletedEffect],
  execute: ({ url }) =>
    Effect.gen(function* () {
      if (globalThis.location.pathname !== url) yield* Navigation.pushUrl(url);

      return Message.CompletedEffect();
    }),
});

export const ExpireToast = Command.define('ExpireToast', {
  args: { id: Schema.Number, bad: Schema.Boolean },
  messages: [Message.ExpiredToast],
  execute: ({ id, bad }) =>
    Effect.sleep(Duration.millis(bad ? 6000 : 2500)).pipe(Effect.as(Message.ExpiredToast({ id }))),
});

const THEME_KEY = 'coil-theme';

export const SaveTheme = Command.define('SaveTheme', {
  args: { theme: Theme },
  messages: [Message.AppliedTheme],
  execute: ({ theme }) =>
    Effect.sync(() => {
      const root = globalThis.document.documentElement;

      if (theme === 'system') delete root.dataset.theme;
      else root.dataset.theme = theme;

      Effect.runSync(
        Effect.try(() => globalThis.localStorage.setItem(THEME_KEY, theme)).pipe(Effect.ignore),
      );

      return Message.AppliedTheme({ theme });
    }),
});

export const storedTheme = (): Theme => {
  const value = Effect.runSync(
    Effect.try(() => globalThis.localStorage.getItem(THEME_KEY)).pipe(
      Effect.orElseSucceed(() => null),
    ),
  );

  return value === 'light' || value === 'dark' ? value : 'system';
};

export const systemIsDark = () =>
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

type InstallPrompt = { prompt: () => Promise<void> };

let installPrompt: InstallPrompt | null = null;

export const rememberInstallPrompt = (prompt: InstallPrompt | null) => {
  installPrompt = prompt;
};

export const Install = Command.define('Install', {
  messages: [Message.BecameInstallable],
  execute: Effect.promise(async () => {
    await installPrompt?.prompt();
    installPrompt = null;

    return Message.BecameInstallable({ installable: false });
  }),
});

export const ConfirmResize = Command.define('ConfirmResize', {
  args: { name: Schema.String, size: Size, running: Schema.Boolean },
  messages: [Message.ClickedSize, Message.CompletedEffect],
  execute: ({ size, running }) =>
    Effect.sync(() =>
      !running ||
      globalThis.confirm(
        `Restart the computer at ${size}? The disk is saved first; running programs stop.`,
      )
        ? Message.ClickedSize({ size })
        : Message.CompletedEffect(),
    ),
});

const askTitle = (name: string) =>
  Effect.sync(() => globalThis.prompt('New title for this thread', name)?.trim() ?? '');

export const RunOp = Command.define('RunOp', {
  args: { name: Schema.String, op: ThreadOp },
  messages: [Message.CompletedOp, Message.FailedOp, Message.CompletedEffect],
  execute: ({ name, op }) =>
    Effect.gen(function* () {
      const client = yield* CoilClient;
      const done = (note: string, gone = false) => Message.CompletedOp({ name, note, gone });

      switch (op._tag) {
        case 'Stop':
          yield* client.Stop({ name });
          return done('Stopped.');
        case 'SetModel':
          yield* client.SetModel({ name, model: op.model });
          return done(`Model set to ${op.model.split('/').pop()}.`);
        case 'Rename': {
          const title = yield* askTitle(name);

          if (title === '') return Message.CompletedEffect();
          yield* client.Rename({ name, title });
          return done(`Renamed to ${title}.`);
        }
        case 'Archive':
          yield* client.Archive({ name, archived: op.archived });
          return done(op.archived ? 'Archived.' : 'Restored.');
        case 'Delete': {
          const sure = yield* Effect.sync(() =>
            globalThis.confirm(`Delete ${name}? Its computer, disk and chat are removed for good.`),
          );

          if (!sure) return Message.CompletedEffect();
          yield* client.DeleteThread({ name });
          return done(`Deleted ${name}.`, true);
        }
      }
    }).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedOp({ name, reason: reasonOf(error) }))),
    ),
});
