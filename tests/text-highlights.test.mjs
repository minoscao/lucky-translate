import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/text-highlights.ts', import.meta.url), 'utf8');
const { textHighlights, grammarHighlights } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
const highlighted = parts => parts.filter(part => part.highlighted).map(part => part.text);

test('study highlights exact phrases, merges overlap and preserves the full sentence', () => {
  const text = 'I listen to English podcasts, and I listen to music.';
  const parts = textHighlights(text, ['listen to', 'to English podcasts']);
  assert.deepEqual(highlighted(parts), ['listen to English podcasts', 'listen to']);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(highlighted(textHighlights('I drive home.', ['I drive home!'])), []);
  assert.deepEqual(highlighted(textHighlights('I go to the garden.', ['go', 'garden', 'den'])), ['go', 'garden']);
});

test('previously saved grammar recalls highlight verbs, frequency adverbs and named phrases', () => {
  const rows = [
    { point: 'Present simple for routines and facts', example: 'I go to work at 12 p.m. and sometimes drive home at 8 or 9 p.m.' },
    { point: 'Present simple with adverbs of frequency', example: 'Not usually because normally I go to work at 12 p.m.' },
    { point: "Gerund after 'listen to'", example: 'I like to listen to English podcasts while I drive.' },
  ];
  assert.deepEqual(rows.map(row => highlighted(textHighlights(row.example, grammarHighlights(row)))), [['go', 'drive'], ['usually', 'normally', 'go'], ['listen to']]);
  assert.deepEqual(grammarHighlights({ point: 'Custom pattern', example: 'I have been working.', highlights: ['have been working'] }), ['have been working']);
});

test('existing chat emphasis remains readable and HTML stays ordinary text', () => {
  assert.deepEqual(highlighted(textHighlights('Try **cutting through the red tape**.')), ['cutting through the red tape']);
  const text = '<script>alert(1)</script> and go.';
  assert.equal(textHighlights(text, ['go']).map(part => part.text).join(''), text);
});
