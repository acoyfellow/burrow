import { Schema } from 'effect';
import type { Update } from 'foldkit';
import type { Url } from 'foldkit/url';
import { DEFAULT_SIZE } from '../../shared/protocol';
import { LoadThreads, LoadView, LoadWho } from './command';
import type { Message } from './message';
import { FileView, type Model, Theme, ThreadsState, ViewState } from './model';
import { threadFromPath } from './route';
import type { CoilClient } from './rpc';

const threadFromUrl = (url: Url) => threadFromPath(url.pathname);

export const Flags = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  now: Schema.Number,
  online: Schema.Boolean,
  theme: Theme,
  openNew: Schema.Boolean,
});

export type Flags = typeof Flags.Type;

export const initialModel = (flags: Flags): Model => ({
  who: '',
  threads: ThreadsState.Loading(),
  name: flags.name,
  view: ViewState.Loading(),
  live: null,
  streamEpoch: 0,
  tab: 't1',
  dirPath: '.',
  entries: { _tag: 'Loading' },
  file: FileView.Closed(),
  action: null,
  draft: '',
  sending: false,
  menuOpen: false,
  sizeMenuOpen: false,
  addMenuOpen: false,
  drawer: 'none',
  newThread: { open: flags.openNew, repo: '', title: '', size: DEFAULT_SIZE, creating: false },
  toasts: [],
  nextToast: 1,
  online: flags.online,
  theme: flags.theme,
  installable: false,
  now: flags.now,
});

export const init = (flags: Flags, url: Url): Update.Return<Model, Message, CoilClient> => ({
  model: initialModel({ ...flags, name: flags.name ?? threadFromUrl(url) }),
  commands: [
    LoadWho(),
    LoadThreads(),
    ...(flags.name === null ? [] : [LoadView({ name: flags.name, refresh: false })]),
  ],
});
