import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, hideDialogues, parseCheck, worthChecking } from './check.js';

const TEXT = '*She walk to the door.* "I am agree."';
const REPLY = JSON.stringify({
    english: true,
    fixes: [{ from: 'walk', to: 'walks', why: 'she takes -s' }],
    natural: null,
});

test('reads a plain reply', () => {
    assert.deepEqual(parseCheck(REPLY, TEXT), {
        text: TEXT,
        fixes: [{ from: 'walk', to: 'walks', why: 'she takes -s' }],
        natural: null,
    });
});

test('finds the JSON inside code fences and thinking', () => {
    const reply = `<think>maybe {"english": false}?</think>\`\`\`json\n${REPLY}\n\`\`\``;
    assert.equal(parseCheck(reply, TEXT).fixes.length, 1);
});

test('drops fixes that are invented, unchanged or malformed', () => {
    const fixes = [
        { from: 'not in message', to: 'x', why: 'y' },
        { from: 'walk', to: 'walk', why: 'y' },
        { from: 'walk' },
        null,
    ];
    assert.deepEqual(parseCheck(JSON.stringify({ english: true, fixes }), TEXT).fixes, []);
});

test('keeps a fix with no reason', () => {
    const reply = JSON.stringify({ english: true, fixes: [{ from: 'walk', to: 'walks', why: 1 }] });
    assert.equal(parseCheck(reply, TEXT).fixes[0].why, '');
});

test('skips messages that are not English', () => {
    assert.deepEqual(parseCheck('{"english": false, "fixes": []}', TEXT), { text: TEXT, skipped: true });
});

test('fails rather than calling a bad reply clean', () => {
    assert.throws(() => parseCheck('', TEXT));
    assert.throws(() => parseCheck('I found no mistakes.', TEXT));
    assert.throws(() => parseCheck('{"english": true}', TEXT));
});

test('hides straight, curly and unclosed dialogue', () => {
    assert.equal(hideDialogues(TEXT), '*She walk to the door.* "…"');
    assert.equal(hideDialogues('“Hi there,” she say.'), '"…" she say.');
    assert.equal(hideDialogues('She say "hi\nthere'), 'She say "…"');
    assert.equal(hideDialogues('It\'s Tom\'s door.'), 'It\'s Tom\'s door.');
});

test('never returns a fix inside hidden dialogue', () => {
    const source = hideDialogues(TEXT);
    const reply = JSON.stringify({
        english: true,
        fixes: [
            { from: 'am agree', to: 'agree', why: 'y' },
            { from: 'door.* "…"', to: 'door.*', why: 'y' },
            { from: 'walk', to: 'walks', why: 'y' },
        ],
        natural: 'She walks to the door. "…"',
    });
    const result = parseCheck(reply, TEXT, source);
    assert.deepEqual(result.fixes.map(fix => fix.from), ['walk']);
    assert.equal(result.natural, null);
    assert.equal(result.text, TEXT);
});

test('only checks messages of a sensible size', () => {
    assert.equal(worthChecking('Hello', 2), false);
    assert.equal(worthChecking('  Hello  ', 2), false);
    assert.equal(worthChecking('Hello there', 2), true);
    assert.equal(worthChecking('Hello', 1), true);
    assert.equal(worthChecking('   ', 1), false);
    assert.equal(worthChecking('one two three', 4), false);
    assert.equal(worthChecking(`Hello ${'a'.repeat(6000)}`, 2), false);
});

test('hidden dialogue does not count as words', () => {
    assert.equal(worthChecking(hideDialogues('"Hello there, friend"'), 1), false);
    assert.equal(worthChecking(hideDialogues('*nods* "Hello there, friend"'), 2), false);
    assert.equal(worthChecking(hideDialogues('*nods slowly* "Hello there"'), 2), true);
});

test('the prompt follows the settings', () => {
    const prompt = (dialect, improveDialogues) => buildPrompt({ dialect, improveDialogues });
    assert.match(prompt('all', false), /Accept both/);
    assert.match(prompt('us', false), /Use American English/);
    assert.match(prompt('uk', false), /Use British English/);
    assert.match(prompt('all', false), /dialogue that was removed/);
    assert.doesNotMatch(prompt('all', false), /native speaker would say it\. Keep its meaning/);
    assert.match(prompt('all', true), /native speaker would say it\. Keep its meaning/);
    assert.doesNotMatch(prompt('all', true), /dialogue that was removed/);
});
