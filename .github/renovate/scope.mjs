import path from 'node:path';

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Pipfile.lock',
  'gradle.lockfile'
]);

export function normalizeRepositoryPath(value) {
  if (typeof value !== 'string' || !value) return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (normalized.startsWith('/') || parts.some(part => part === '..') || /[\r\n\0]/.test(normalized)) {
    throw new Error(`Unsafe repository path: ${value}`);
  }
  return normalized;
}

export function isLockfile(repositoryPath) {
  const name = repositoryPath.split('/').at(-1);
  return LOCKFILES.has(name) || name.endsWith('.lock') ||
    repositoryPath.includes('/gradle/dependency-locks/');
}

export function manifestScope(rawPath) {
  const repositoryPath = normalizeRepositoryPath(rawPath);
  if (!repositoryPath || isLockfile(repositoryPath)) return null;

  const name = repositoryPath.split('/').at(-1);
  let language;
  if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(name)) {
    language = 'gradle';
  } else if (name === 'pom.xml') {
    language = 'maven';
  } else if (name === 'package.json') {
    language = 'node';
  } else if (name === 'pyproject.toml') {
    language = 'poetry';
  } else if (name === 'Pipfile') {
    language = 'pipenv';
  } else if (/^[\w.-]*requirements[\w.-]*\.(?:txt|pip)$/i.test(name)) {
    language = 'pip';
  }
  if (!language) return null;

  const directory = path.posix.dirname(repositoryPath);
  return {
    language,
    directory: directory === '.' ? '.' : directory,
    manifest: repositoryPath,
    manifestName: name
  };
}

export function planValidation(changedFiles) {
  if (!Array.isArray(changedFiles)) throw new TypeError('changedFiles must be an array');

  const byManifest = new Map();
  for (const changedFile of changedFiles) {
    const scope = manifestScope(changedFile);
    if (scope) byManifest.set(scope.manifest, scope);
  }

  const scopes = [...byManifest.values()];
  if (scopes.length > 1) {
    throw new Error(
      `PR changes multiple buildable manifests: ${scopes.map(scope => `${scope.language}:${scope.manifest}`).join(', ')}`
    );
  }
  return { include: scopes };
}

export function parseNameStatus(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('git diff input must be a Buffer');
  const fields = buffer.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();

  const changedFiles = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status || !/^[A-Z][0-9]*$/.test(status)) {
      throw new Error(`Malformed git diff status: ${status || '<empty>'}`);
    }

    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const source = fields[index++];
      const destination = fields[index++];
      if (source == null || destination == null) throw new Error('Malformed rename/copy record');
      changedFiles.push(destination);
      continue;
    }

    const repositoryPath = fields[index++];
    if (repositoryPath == null) throw new Error(`Missing path for git diff status ${status}`);
    if (kind !== 'D') changedFiles.push(repositoryPath);
  }
  return changedFiles;
}
