import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A method written twice in a class silently replaces the first one (esbuild only warns): the vacuum room highlight
// was lost that way once. Methods are written at two spaces of indentation in these files.
const FILES = ['engine.js', 'house-view-card.js', 'editors.js', 'vacuum-ctl.js', 'garden-tools.js', 'pickers.js'];

describe('class members', () => {
  for (const file of FILES) {
    it(`${file} defines each method once per class`, () => {
      const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      for (const body of src.split(/^(?:export )?class /m).slice(1)) {
        const end = body.search(/^}/m);
        const names = [...body.slice(0, end).matchAll(/^ {2}(?:static |async |get |set )?([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) =>
          m[0].includes(' get ') || /^ {2}(get|set) /.test(m[0]) ? `${m[0].trim().split(' ')[0]} ${m[1]}` : m[1],
        );
        const twice = names.filter((n, i) => names.indexOf(n) !== i && !['if', 'for', 'while', 'switch'].includes(n));
        expect(twice, file).toEqual([]);
      }
    });
  }
});
