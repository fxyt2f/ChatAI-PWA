const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the real import parser without initializing the browser UI.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('    parseImportedHistory(text) {');
const end = source.indexOf('\n    },', start);
assert.ok(start >= 0 && end > start, 'parseImportedHistory method exists');
const method = source.slice(start, end + '\n    }'.length);
const parseImportedHistory = new Function('normalizeChatPinState', 'window', 'console',
    'return ({' + method + '}).parseImportedHistory;')(
    value => value, { DocumentRag: { normalize: value => value } }, { log() {}, error() {} }
);

const block = (role, content, newline = '\n', attributes = '') =>
    '<|#|' + role + '|#|' + attributes + '>' + newline + content + newline +
    '<|#|/' + role + '|#|>' + newline + newline;

test('system/user/model preserve exact text across LF and CRLF delimiters', () => {
    const samples = [
        '', '  先頭の半角', '末尾の半角  ', '　　全角字下げ', '\tタブ\t',
        ' \t　混在する空白\t　 ', '\n\n先頭と末尾の複数改行\n\n',
        '\r\n本文中のCRLF\r\n', '1行目\n  2行目\n　3行目',
        ' \t　', '\u00a0ノーブレークスペース\u00a0'
    ];
    for (const role of ['system', 'user', 'model']) {
        for (const delimiter of ['\n', '\r\n']) {
            for (const content of samples) {
                const restored = parseImportedHistory(block(role, content, delimiter));
                const actual = role === 'system' ? restored.systemPrompt : restored.messages[0].content;
                assert.equal(actual, content, role + ' ' + JSON.stringify({ content, delimiter }));
            }
        }
    }
});

test('legacy metadata and message attributes remain compatible', () => {
    const input = '<|#|metadata|#|>\n{"bookmark":"kept"}\n<|#|/metadata|#|>\n\n' +
        block('system', '　既存のシステム指示　') +
        block('user', '  入力  ') +
        block('model', '\t回答　', '\n', 'isCascaded isSelected');
    const result = parseImportedHistory(input);
    assert.equal(result.systemPrompt, '　既存のシステム指示　');
    assert.equal(result.persistentMemory.bookmark, 'kept');
    assert.deepEqual(result.messages.map(message => [message.role, message.content]), [
        ['user', '  入力  '], ['model', '\t回答　']
    ]);
    assert.equal(result.messages[1].isCascaded, true);
    assert.equal(result.messages[1].isSelected, true);
});

test('export still puts message text unchanged between separator newlines', () => {
    const line = source.split('\n').find(item => item.includes('exportText += ') && item.includes('msg.content'));
    assert.ok(line && line.includes('attributes.trim()') && line.includes('\\n') &&
        line.includes('msg.content'), 'existing export expression remains intact');
});
