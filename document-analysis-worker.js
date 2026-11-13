import { HTMLParser, parseAllDocuments, SaxesParser, unzipSync } from './vendor/document-analysis/text-parsers.js';

const MAX_TEXT = 800000;
const MAX_BLOCKS = 4000;
const MAX_DEPTH = 96;
const MAX_DOCX_XML = 12 * 1024 * 1024;

class AnalysisError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const tooLarge = () => new AnalysisError('content-limit', '抽出できる本文量または文書構造の上限を超えました。');
const invalid = message => new AnalysisError('invalid-document', message);

function textBlocks() {
    const blocks = [];
    let length = 0;
    const add = (text, location, group = null) => {
        text = text.trim();
        if (!text) return;
        length += text.length;
        if (length > MAX_TEXT || blocks.length >= MAX_BLOCKS) throw tooLarge();
        blocks.push({ text, location, group });
    };
    return { blocks, add };
}

function decode(bytes) {
    const decoder = label => new TextDecoder(label, { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
    try {
        if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] !== 0 && bytes[1] === 0) return decoder('utf-16le');
        if (bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] !== 0) return decoder('utf-16be');
        try { return decoder('utf-8'); } catch (error) {
            if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw error;
            return decoder('shift_jis');
        }
    } catch {
        throw new AnalysisError('encoding', '文字コードを読み取れませんでした。UTF-8、UTF-16、Shift_JISを使用できます。');
    }
}

function extractLines(text, markdown, add) {
    let heading, fence, start = 1;
    let lines = [];
    const flush = end => {
        add(lines.join('\n'), { type: 'lines', lineStart: start, lineEnd: end, heading }, heading || 'text');
        lines = [];
    };
    let number = 0, offset = 0;
    while (offset <= text.length) {
        let end = text.indexOf('\n', offset);
        if (end < 0) end = text.length;
        const line = text.slice(offset, end);
        offset = end + 1;
        number++;
        const previous = number - 1;
        const marker = markdown && /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
        const atx = markdown && !fence && /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
        const setext = markdown && !fence && lines.length === 1 && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
        if (atx) {
            flush(previous);
            heading = atx[1].trim();
        } else if (setext) {
            heading = lines[0].trim();
        } else if (!line.trim() && !fence) {
            flush(previous);
            continue;
        }
        if (!lines.length) start = number;
        lines.push(line);
        if (marker && !fence) fence = marker[1];
        else if (marker && marker[1][0] === fence?.[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    }
    flush(number);
}

function extractTable(text, delimiter, add) {
    let cells = [], cell = '', headers, headerRecord;
    let line = 1, lineStart = 1, row = 0, quoted = false, closedQuote = false;
    const render = record => {
        const columns = record.cells.map((value, index) =>
            (headers?.[index]?.trim() || '列' + (index + 1)) + ' = ' + value);
        add(columns.join('\n'), { type: 'table', row: record.row, lineStart: record.start, lineEnd: record.end });
    };
    const finish = () => {
        cells.push(cell);
        row++;
        if (cells.some(value => value.trim())) {
            const record = { cells, row, start: lineStart, end: line };
            if (!headerRecord) headerRecord = record;
            else {
                headers ??= headerRecord.cells;
                render(record);
            }
        }
        cells = [];
        cell = '';
        closedQuote = false;
    };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (char === '"') { quoted = false; closedQuote = true; }
            else { cell += char; if (char === '\n') line++; }
        } else if (char === delimiter) {
            cells.push(cell);
            cell = '';
            closedQuote = false;
        } else if (char === '\n') {
            finish();
            lineStart = ++line;
        } else if (char === '"' && !cell && !closedQuote) {
            quoted = true;
        } else if (char === '"' || closedQuote && !/[ \t]/.test(char)) {
            throw invalid('CSV/TSVの引用符が正しく閉じられていません。行 ' + line);
        } else if (!closedQuote) {
            cell += char;
        }
    }
    if (quoted) throw invalid('CSV/TSVの引用符が閉じられていません。行 ' + lineStart);
    if (cell || cells.length || closedQuote) finish();
    if (headerRecord && !headers) render(headerRecord);
}

function extractStructured(root, add, document) {
    const pathPart = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
    let nodes = 0;
    const visit = (value, path, depth) => {
        if (depth > MAX_DEPTH || ++nodes > 16000 || path.length > 4096) throw tooLarge();
        const location = { type: 'path', path: path || '/', document };
        const entries = value instanceof Map ? [...value] : value && typeof value === 'object' && !(value instanceof Date)
            ? Object.entries(value) : null;
        if (entries?.length) {
            for (const [key, child] of entries) {
                if (key && typeof key === 'object') throw invalid('YAMLの複合キーには対応していません。');
                visit(child, path + '/' + pathPart(key), depth + 1);
            }
        } else {
            const scalar = entries ? (Array.isArray(value) ? '[]' : '{}') : String(value);
            add((path ? path + ' = ' : '') + scalar, location);
        }
    };
    visit(root, '', 0);
}

function parseXML(text, handlers) {
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    parser.on('doctype', () => {
        throw new AnalysisError('unsafe-xml', '外部参照やエンティティ展開を防ぐため、DOCTYPE付きのXMLは解析できません。');
    });
    parser.on('error', () => { throw invalid('XMLの構造が無効です。'); });
    parser.on('opentag', tag => {
        if (++depth > MAX_DEPTH) throw tooLarge();
        handlers.open(tag);
    });
    parser.on('text', handlers.text);
    parser.on('cdata', handlers.text);
    parser.on('closetag', tag => { handlers.close(tag); depth--; });
    parser.write(text).close();
}

function extractXML(text, add) {
    const stack = [{ path: '', children: new Map(), text: '' }];
    const flush = node => {
        add(node.text, { type: 'xml', path: node.path });
        node.text = '';
    };
    parseXML(text, {
        open(tag) {
            const parent = stack.at(-1);
            flush(parent);
            const ordinal = (parent.children.get(tag.name) || 0) + 1;
            parent.children.set(tag.name, ordinal);
            const path = parent.path + '/' + tag.name + '[' + ordinal + ']';
            if (path.length > 4096) throw tooLarge();
            stack.push({ path, children: new Map(), text: '' });
            for (const attr of Object.values(tag.attributes)) {
                if (attr.uri !== 'http://www.w3.org/2000/xmlns/') {
                    add(attr.name + ' = ' + attr.value, { type: 'xml', path: path + '/@' + attr.name });
                }
            }
        },
        text(value) { stack.at(-1).text += value; },
        close() { flush(stack.pop()); }
    });
}

const hiddenHTML = new Set(['head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'canvas']);
const htmlBlocks = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dt', 'dd', 'footer', 'header',
    'hr', 'li', 'main', 'nav', 'p', 'pre', 'section', 'table', 'tr', 'td', 'th', 'ul', 'ol']);

function extractHTML(text, add) {
    const stack = [];
    let buffer = '', start = 1, heading, readingHeading = false, offset = 0, line = 1;
    const lineAt = index => {
        while (offset < index) if (text[offset++] === '\n') line++;
        return line;
    };
    const flush = end => {
        if (readingHeading && buffer.trim()) heading = buffer.trim();
        add(buffer, { type: 'html', heading, lineStart: start, lineEnd: Math.max(start, end) }, heading || 'html');
        buffer = '';
    };
    const parser = new HTMLParser({
        onopentag(name, attributes) {
            if (stack.length >= MAX_DEPTH) throw tooLarge();
            const hidden = stack.at(-1)?.hidden || hiddenHTML.has(name) ||
                Object.hasOwn(attributes, 'hidden') || attributes['aria-hidden'] === 'true';
            const title = /^h[1-6]$/.test(name);
            const block = title || htmlBlocks.has(name);
            if (!hidden && block) flush(lineAt(parser.startIndex));
            if (!hidden && title) readingHeading = true;
            stack.push({ name, hidden, block, title, pre: name === 'pre' || stack.at(-1)?.pre });
        },
        ontext(value) {
            if (stack.at(-1)?.hidden) return;
            if (!buffer) start = lineAt(parser.startIndex);
            buffer += stack.at(-1)?.pre ? value : value.replace(/\s+/g, ' ');
        },
        onclosetag() {
            const tag = stack.pop();
            if (!tag || tag.hidden) return;
            if (tag.block) flush(lineAt(parser.startIndex));
            if (tag.title) readingHeading = false;
        }
    });
    parser.end(text);
    flush(lineAt(text.length));
}

const wordNamespaces = new Set([
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'http://purl.oclc.org/ooxml/wordprocessingml/main'
]);
const word = tag => wordNamespaces.has(tag.uri) ? tag.local : null;
const wordAttribute = (tag, name) => Object.values(tag.attributes)
    .find(attr => wordNamespaces.has(attr.uri) && attr.local === name)?.value;

function docxHeadingStyles(bytes) {
    const headingStyles = new Set();
    if (!bytes) return headingStyles;
    let style;
    parseXML(decode(bytes), {
        open(tag) {
            switch (word(tag)) {
                case 'style': style = wordAttribute(tag, 'styleId'); break;
                case 'outlineLvl':
                    if (style && /^[0-8]$/.test(wordAttribute(tag, 'val'))) headingStyles.add(style);
                    break;
            }
        },
        close(tag) { if (word(tag) === 'style') style = null; },
        text() {}
    });
    return headingStyles;
}

function extractDOCX(bytes, add) {
    if (bytes.length < 22) throw invalid('DOCXファイルを開けませんでした。');
    const wanted = new Set(['word/document.xml', 'word/styles.xml']);
    const seen = new Set();
    let zip;
    try {
        zip = unzipSync(bytes, { filter(entry) {
            if (!wanted.has(entry.name)) return false;
            if (seen.has(entry.name)) throw invalid('DOCX内に重複した文書データがあります。');
            seen.add(entry.name);
            if (entry.originalSize > MAX_DOCX_XML || entry.size > MAX_DOCX_XML) throw tooLarge();
            return true;
        } });
    } catch (error) {
        if (error instanceof AnalysisError) throw error;
        throw invalid('DOCXの圧縮データが破損しているか、暗号化されています。');
    }
    if (!zip['word/document.xml']) throw invalid('DOCX内に本文が見つかりません。');
    const headings = docxHeadingStyles(zip['word/styles.xml']);
    let body = false, paragraph, paragraphNumber = 0, heading, tableNumber = 0, textDepth = 0, ignored = 0;
    const tables = [];
    const skip = new Set(['drawing', 'pict', 'del', 'moveFrom', 'object']);
    const currentRow = () => tables.at(-1)?.row;
    parseXML(decode(zip['word/document.xml']), {
        open(tag) {
            const name = word(tag);
            if (ignored || skip.has(name)) { ignored++; return; }
            if (name === 'body') body = true;
            if (!body) return;
            switch (name) {
                case 'tbl': tables.push({ number: ++tableNumber, rowNumber: 0, row: null, parentCell: currentRow()?.cells.at(-1) }); break;
                case 'tr':
                    if (tables.length) tables.at(-1).row = { number: ++tables.at(-1).rowNumber, cells: [] };
                    break;
                case 'tc': currentRow()?.cells.push([]); break;
                case 'p': paragraph = { text: '', number: ++paragraphNumber, isHeading: false }; break;
                case 'pStyle': {
                    const style = wordAttribute(tag, 'val');
                    if (paragraph && (headings.has(style) || /^heading[1-9]$/i.test(style))) paragraph.isHeading = true;
                    break;
                }
                case 'outlineLvl':
                    if (paragraph && /^[0-8]$/.test(wordAttribute(tag, 'val'))) paragraph.isHeading = true;
                    break;
                case 't': textDepth++; break;
                case 'tab': if (paragraph) paragraph.text += '\t'; break;
                case 'br':
                case 'cr': if (paragraph) paragraph.text += '\n'; break;
            }
        },
        text(value) { if (!ignored && paragraph && textDepth) paragraph.text += value; },
        close(tag) {
            if (ignored) { ignored--; return; }
            const name = word(tag);
            if (name === 'body') body = false;
            if (!body) return;
            switch (name) {
                case 't': textDepth--; break;
                case 'p':
                    if (paragraph) {
                        const { text, number, isHeading } = paragraph;
                        const cell = currentRow()?.cells.at(-1);
                        if (cell) cell.push(text);
                        else {
                            if (isHeading && text.trim()) heading = text.trim();
                            add(text, { type: 'docx', heading, paragraphStart: number, paragraphEnd: number }, heading || 'docx');
                        }
                        paragraph = null;
                    }
                    break;
                case 'tr': {
                    const table = tables.at(-1);
                    if (table?.row) {
                        const text = table.row.cells.map(cell => cell.join('\n').trim()).join(' | ');
                        if (table.parentCell) table.parentCell.push(text);
                        else add(text, { type: 'docx', heading, table: table.number, row: table.row.number });
                        table.row = null;
                    }
                    break;
                }
                case 'tbl': tables.pop(); break;
            }
        }
    });
}

async function extract(entry, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { blocks, add } = textBlocks();
    if (entry.format === 'docx') {
        extractDOCX(bytes, add);
        return blocks;
    }
    const text = decode(bytes);
    switch (entry.format) {
        case 'txt':
        case 'md': extractLines(text, entry.format === 'md', add); break;
        case 'csv':
        case 'tsv': extractTable(text, entry.format === 'csv' ? ',' : '\t', add); break;
        case 'json': extractStructured(JSON.parse(text), add); break;
        case 'yaml': {
            const documents = parseAllDocuments(text, { schema: 'core', strict: true });
            for (const [index, document] of documents.entries()) {
                if (document.errors.length || document.warnings.length) throw invalid('YAMLの構造またはタグが無効です。');
                let value;
                try { value = document.toJS({ maxAliasCount: 0, mapAsMap: true }); }
                catch (error) {
                    if (error instanceof ReferenceError) throw new AnalysisError('yaml-alias', '安全のためYAMLのエイリアス参照は解析しません。');
                    throw error;
                }
                extractStructured(value, add, index + 1);
            }
            break;
        }
        case 'xml': extractXML(text, add); break;
        case 'html': extractHTML(text, add); break;
        default: throw new AnalysisError('unsupported', '対応していないファイル形式です。');
    }
    return blocks;
}

const CHUNK_LENGTH = 840;
const CHUNK_OVERLAP = 100;
const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const japaneseRuns = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const latinRuns = /[\p{Script=Latin}\p{Nd}]+(?:[._-][\p{Script=Latin}\p{Nd}]+)*/gu;
const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
const commonWords = new Set(['について', 'こと', 'もの', 'どう', 'どこ', 'なぜ', '何', 'です', 'ます', 'する',
    'ある', 'あり', 'いる', '教え', 'ください', 'お願い', 'ため', 'とき', '場合', 'できる', '教える',
    'what', 'when', 'how', 'where', 'which', 'who', 'does', 'the', 'is', 'are', 'for', 'with', 'and', 'please']);
const normalize = text => text.normalize('NFKC').toLowerCase();
const kana = text => text.replace(/[ぁ-ゖ]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60));

function features(text, isQuery = false) {
    const counts = new Map();
    const add = key => counts.set(key, (counts.get(key) || 0) + 1);
    const normalized = normalize(text);
    const segments = words ? Array.from(words.segment(normalized)).filter(item => item.isWordLike).map(item => item.segment)
        : normalized.match(japaneseRuns) || [];
    for (const segment of segments) {
        if (japanese.test(segment) && segment.length >= 2 && !commonWords.has(segment)) {
            add('w:' + kana(segment));
        }
    }
    for (const match of normalized.matchAll(latinRuns)) {
        const token = match[0];
        if (!commonWords.has(token)) add('a:' + token);
        for (const part of token.split(/[._-]/)) if (part !== token && !commonWords.has(part)) add('a:' + part);
    }
    // Keep overlapping Japanese character pairs for compounds and alternate segmentation.
    const gramSource = isQuery ? normalized.replace(/について|教えて(?:ください)?|お願いします|ですか|でしょうか|できますか/g, ' ') : normalized;
    for (const match of gramSource.matchAll(japaneseRuns)) {
        const chars = Array.from(kana(match[0]));
        for (let i = 0; i + 1 < chars.length; i++) add('b:' + chars[i] + chars[i + 1]);
        if (!isQuery || chars.length === 1) for (const char of chars) {
            if (/\p{Script=Han}/u.test(char)) add('u:' + char);
        }
    }
    return counts;
}

function splitBlock(block) {
    if (block.text.length <= CHUNK_LENGTH) return [block];
    const result = [];
    const text = block.text;
    let start = 0, line = block.location.lineStart;
    const newlines = value => (value.match(/\n/g) || []).length;
    const trackLines = ['lines', 'html'].includes(block.location.type);
    while (start < text.length) {
        let end = Math.min(start + CHUNK_LENGTH, text.length);
        if (end < text.length) {
            const breakAt = start + Math.floor(CHUNK_LENGTH * 0.58);
            const endings = Array.from(text.slice(breakAt, end).matchAll(/[\n。！？.!?；;、, \t]/g));
            const chosen = endings.reverse().find(item => /[\n。！？.!?]/.test(item[0])) || endings[0];
            if (chosen) end = breakAt + chosen.index + 1;
            else if (/[\uDC00-\uDFFF]/.test(text[end])) end--;
        }
        const value = text.slice(start, end);
        const location = trackLines ? { ...block.location, lineStart: line,
            lineEnd: Math.min(block.location.lineEnd, line + newlines(value.trimEnd())) } : block.location;
        result.push({ ...block, text: value.trim(), location });
        if (end === text.length) break;
        let next = end - CHUNK_OVERLAP;
        const boundary = text.slice(next, end - 32).search(/[\n。！？.!? \t]/);
        if (boundary >= 0) next += boundary + 1;
        if (/[\uDC00-\uDFFF]/.test(text[next])) next++;
        if (trackLines) line += newlines(text.slice(start, next));
        start = next;
    }
    return result;
}

function buildIndex(entry, blocks) {
    if (!blocks.length) throw new AnalysisError('empty', '検索できる本文が見つかりませんでした。');
    const chunks = [];
    let pending, totalChars = 0;
    const flush = () => {
        if (!pending) return;
        const order = chunks.length;
        chunks.push({ id: entry.versionId + ':' + (order + 1), order, text: pending.text, location: pending.location });
        totalChars += pending.text.length;
        pending = null;
    };
    for (const block of blocks) {
        for (const part of splitBlock(block)) {
            if (!part.text) continue;
            if (pending?.group && pending.group === part.group && pending.location.type === part.location.type &&
                pending.text.length + part.text.length + 2 <= CHUNK_LENGTH) {
                pending.text += '\n\n' + part.text;
                if (part.location.lineEnd != null) pending.location.lineEnd = part.location.lineEnd;
                if (part.location.paragraphEnd != null) pending.location.paragraphEnd = part.location.paragraphEnd;
            } else {
                flush();
                pending = { ...part, location: { ...part.location } };
            }
        }
    }
    flush();
    if (!chunks.length) throw new AnalysisError('empty', '検索できる本文が見つかりませんでした。');
    if (chunks.length > MAX_BLOCKS || totalChars > MAX_TEXT * 1.25) throw tooLarge();

    const postings = Object.create(null);
    let termCount = 0, postingCount = 0;
    for (const chunk of chunks) {
        const terms = features(chunk.text);
        chunk.length = 0;
        for (const [term, frequency] of terms) {
            if (!Object.hasOwn(postings, term)) {
                if (++termCount > 180000) throw tooLarge();
                postings[term] = [];
            }
            if (++postingCount > 500000) throw tooLarge();
            postings[term].push(chunk.order, frequency);
            chunk.length += frequency;
        }
    }
    return { chunks, postings, totalChars, termCount };
}

function excerpt(text, matched) {
    const haystack = kana(normalize(text));
    const anchors = matched.map(term => haystack.indexOf(term.slice(2))).filter(index => index >= 0);
    const first = anchors.length ? Math.min(...anchors) : 0;
    return excerptAt(text, first);
}

function excerptAt(text, first) {
    const start = Math.max(0, first - 60);
    const end = Math.min(text.length, start + 280);
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function findText(documents, query, firstPerDocument) {
    const needle = normalize(query.trim());
    if (!needle) return [];
    const matches = [];
    for (const { id, chunks } of documents) {
        for (const chunk of chunks) {
            const offset = normalize(chunk.text).indexOf(needle);
            if (offset < 0) continue;
            matches.push({ documentId: id, chunkId: chunk.id, location: chunk.location,
                excerpt: excerptAt(chunk.text, offset) });
            if (firstPerDocument) break;
        }
    }
    return matches;
}

function queryFeatures(query) {
    const terms = [...features(query, true).keys()];
    return terms.some(term => !term.startsWith('u:')) ? terms.filter(term => !term.startsWith('u:')) : terms;
}

function search(indexes, query, queryTerms, limit) {
    const allowSingle = queryTerms.length === 1;
    const weight = term => term.startsWith('a:') ? 3.0 : term.startsWith('w:') ? 2.5 : term.startsWith('b:') ? 0.65 : 0.2;
    const count = indexes.reduce((sum, index) => sum + index.chunks.length, 0);
    const average = indexes.reduce((sum, index) => sum + index.chunks.reduce((total, chunk) => total + chunk.length, 0), 0) /
        Math.max(1, count) || 1;
    const terms = [];
    for (const term of queryTerms) {
        const df = indexes.reduce((sum, index) => sum + (index.postings[term]?.length || 0) / 2, 0);
        if (df) terms.push({ term, weight: weight(term), idf: Math.log(1 + (count - df + 0.5) / (df + 0.5)) });
    }
    const totalWeight = terms.reduce((sum, term) => sum + term.weight, 0) || 1;
    const phrase = kana(normalize(query.trim())).replace(/\s+/g, ' ');
    const ranked = [];
    for (const index of indexes) {
        const hits = new Map();
        for (const { term, weight, idf } of terms) {
            const postings = index.postings[term] || [];
            for (let i = 0; i < postings.length; i += 2) {
                const order = postings[i], tf = postings[i + 1];
                const chunk = index.chunks[order];
                if (!chunk || !Number.isFinite(tf) || tf <= 0) continue;
                const hit = hits.get(order) || { score: 0, weight: 0, matched: [], words: 0, grams: 0 };
                hit.score += weight * idf * ((tf * 2.2) / (tf + 1.2 * (0.35 + 0.65 * chunk.length / average)));
                hit.weight += weight;
                hit.matched.push(term);
                if (term.startsWith('w:') || term.startsWith('a:')) hit.words++;
                if (term.startsWith('b:')) hit.grams++;
                hits.set(order, hit);
            }
        }
        for (const [order, hit] of hits) {
            if (!hit.words && hit.grams < 2 && !allowSingle) continue;
            const chunk = index.chunks[order];
            const exact = phrase.length >= 2 && kana(normalize(chunk.text)).replace(/\s+/g, ' ').includes(phrase);
            const score = hit.score * (0.32 + 0.68 * hit.weight / totalWeight) + (exact ? 2.5 : 0);
            if (score <= 0) continue;
            ranked.push({ documentId: index.documentId, chunkId: chunk.id, order, location: chunk.location,
                text: chunk.text, excerpt: excerpt(chunk.text, hit.matched), score });
        }
    }
    ranked.sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.order - b.order);
    return ranked.filter(result => result.score >= ranked[0].score * 0.12).slice(0, limit);
}

self.onmessage = async ({ data }) => {
    try {
        let result;
        switch (data.operation) {
            case 'analyze': result = buildIndex(data.entry, await extract(data.entry, data.blob)); break;
            case 'index': result = buildIndex(data.entry, data.blocks); break;
            case 'terms': result = queryFeatures(data.query); break;
            case 'search': result = search(data.indexes, data.query, data.terms, data.limit); break;
            case 'find-text': result = findText(data.documents, data.query, data.firstPerDocument); break;
            default: throw invalid('ファイル解析処理が無効です。');
        }
        self.postMessage({ result });
    } catch (error) {
        self.postMessage({ error: {
            code: error.code || 'invalid-document',
            message: error.code ? error.message : 'ファイルの形式または本文を読み取れませんでした。'
        } });
    }
};
