// Plain object on purpose (no import from 'vitest/config'): in the pre-commit hook there is no card/node_modules,
// vitest and three live in the hook's own environment, exposed through NODE_PATH.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const local = existsSync(new URL('./node_modules/three', import.meta.url));
const hookThree = (process.env.NODE_PATH || '')
  .split(':')
  .map((p) => join(p, 'three', 'build', 'three.module.js'))
  .find((p) => existsSync(p));

export default {
  resolve: { alias: !local && hookThree ? [{ find: /^three$/, replacement: hookThree }] : [] },
};
