import { describe, expect, it } from 'vitest';
import { T, makeT } from '../src/i18n.js';

const LANGS = ['fr', 'es', 'de', 'it', 'pl', 'pt'];

describe('card interface languages', () => {
  for (const lang of LANGS) {
    it(`${lang} has exactly the keys of English`, () => {
      const en = Object.keys(T.en).sort();
      expect(Object.keys(T[lang]).sort()).toEqual(en);
    });
    it(`${lang} keeps the placeholders and the compass`, () => {
      for (const [k, v] of Object.entries(T.en)) {
        const found = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
        expect(found(T[lang][k]), `${lang}.${k}`).toEqual(found(v));
      }
      expect(T[lang].compass.split(',')).toHaveLength(8);
    });
  }
  it('picks the language of the prefix and falls back to English', () => {
    expect(makeT('de-DE')('gates')).toBe(T.de.gates);
    expect(makeT('xx')('gates')).toBe(T.en.gates);
    expect(makeT('pt-BR')('nope')).toBe('nope');
  });
});
