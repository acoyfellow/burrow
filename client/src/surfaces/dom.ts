export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const socketUrl = (path: string): string =>
  `${globalThis.location.protocol === 'https:' ? 'wss://' : 'ws://'}${globalThis.location.host}${path}`;

export const spinnerNode = (): HTMLElement => {
  const spinner = document.createElement('span');

  spinner.className = 'spin';

  return spinner;
};
