#!/usr/bin/env node

import fs from 'node:fs';
import { parseNameStatus, planValidation } from './scope.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const outputFile = option('--github-output');
if (!outputFile) throw new Error('--github-output is required');

let changedFiles = [];
if (!process.argv.includes('--empty')) {
  const diffFile = option('--git-diff');
  if (!diffFile) throw new Error('--git-diff or --empty is required');
  changedFiles = parseNameStatus(fs.readFileSync(diffFile));
}

const matrix = planValidation(changedFiles);
const scope = matrix.include[0];
fs.appendFileSync(outputFile, `matrix=${JSON.stringify(matrix)}\n`, 'utf8');
fs.appendFileSync(outputFile, `has_build=${scope ? 'true' : 'false'}\n`, 'utf8');
fs.appendFileSync(
  outputFile,
  `summary=${scope ? `${scope.language}:${scope.manifest}` : 'no-buildable-manifest'}\n`,
  'utf8'
);

console.log(scope
  ? `Validation scope: ${scope.language} in ${scope.directory} (${scope.manifest})`
  : 'No buildable manifest changed');
