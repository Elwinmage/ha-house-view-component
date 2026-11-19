// Plain object on purpose (no import from 'vitest/config'): in the pre-commit hook there is no card/node_modules,
// vitest and three live in the hook's own environment, exposed through NODE_PATH.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const local = existsSync(new URL('./node_modules/three', import.meta.url));
const hookDir = (process.env.NODE_PATH || '')
  .split(':')
  .map((p) => join(p, 'three'))
  .find((p) => existsSync(join(p, 'build', 'three.module.js')));

export default {
  resolve: {
    alias:
      !local && hookDir
        ? [
            { find: /^three$/, replacement: join(hookDir, 'build', 'three.module.js') },
            // three/addons/* -> examples/jsm/* (package exports are not applied through NODE_PATH)
            { find: /^three\/addons\/(.*)$/, replacement: `${join(hookDir, 'examples', 'jsm')}/$1` },
          ]
        : [],
  },
};
