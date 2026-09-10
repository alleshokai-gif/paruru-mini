import { readFileSync } from 'node:fs';
// This local config permits full-line comments; credentials belong exclusively in .dev.vars.
export function readLocalConfig() {
  return JSON.parse(readFileSync(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
}
