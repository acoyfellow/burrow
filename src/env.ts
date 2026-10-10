export const WORKSPACE = '/workspace';

export const SHELL_ENV: Record<string, string> = {
  PATH: '/sandbox/bin:/opt/busybox:/usr/local/bin:/usr/bin',
  TERMINFO_DIRS: '/etc/terminfo',
  HOME: '/root',
  SSL_CERT_FILE: '/etc/ssl/certs/ca-bundle.crt',
  GIT_SSL_CAINFO: '/etc/ssl/certs/ca-bundle.crt',
  GIT_AUTHOR_NAME: 'burrow',
  GIT_AUTHOR_EMAIL: 'burrow@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'burrow',
  GIT_COMMITTER_EMAIL: 'burrow@users.noreply.github.com',
};
