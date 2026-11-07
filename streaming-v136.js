/* SSE framing and provider response assembly shared by the conversation adapters. */
(function (root) {
    'use strict';

    // A single text SSE event rarely needs megabytes. The larger wire budget
    // accommodates long responses and many deltas without unbounded assembly.
    const MAX_EVENT_CHARS = 2 * 1024 * 1024;
    const MAX_STREAM_BYTES = 32 * 1024 * 1024;
    const MAX_STREAM_BLOCKS = 64 * 1024;
    const sizeError = () => new Error('APIストリームのサイズ上限を超えました。');

    function canStream(provider, model, generationConfig = {}) {
        if (provider !== 'gemini' && provider !== 'openrouter') return false;
        const mediaModel = /(?:^|[\/_-])(?:image|imagen|tts|audio|video|veo|sora)(?:$|[\/_.-]|\d)/i;
        return !mediaModel.test(model)
            && !generationConfig?.responseModalities?.some(modality => modality.toUpperCase() !== 'TEXT');
    }

    async function readSse(body, signal, receive) {
        signal?.throwIfAborted();
        if (!body) throw new Error('API応答にストリームがありません。');
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let line = '', data = [], event = '', skipLf = false, eof = false;
        let eventSize = 0, streamSize = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); };
        signal?.addEventListener('abort', cancel, { once: true });
        function acceptLine() {
            if (line === '') {
                const payload = data.join('\n');
                const type = event;
                data = [];
                event = '';
                eventSize = 0;
                if (type === 'error' || payload.trim()) return receive(payload, type);
            } else {
                const colon = line.indexOf(':');
                const field = colon < 0 ? line : line.slice(0, colon);
                const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
                if (field === 'data' || field === 'event') {
                    eventSize += line.length + 1;
                    if (eventSize > MAX_EVENT_CHARS) throw sizeError();
                    if (field === 'data') data.push(value);
                    else event = value;
                }
            }
            return false;
        }
        try {
            for (;;) {
                const { done, value } = await reader.read();
                signal?.throwIfAborted();
                eof = done;
                streamSize += value?.byteLength || 0;
                if (streamSize > MAX_STREAM_BYTES) throw sizeError();
                const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
                let start = 0;
                for (const match of text.matchAll(/[\r\n]/g)) {
                    if (skipLf && match.index === start && match[0] === '\n') {
                        skipLf = false;
                        start++;
                        continue;
                    }
                    line += text.slice(start, match.index);
                    if (line.length > MAX_EVENT_CHARS) throw sizeError();
                    if (acceptLine()) return true;
                    line = '';
                    skipLf = match[0] === '\r';
                    start = match.index + 1;
                }
                if (start < text.length) {
                    line += text.slice(start);
                    if (line.length > MAX_EVENT_CHARS) throw sizeError();
                    skipLf = false;
                }
                if (done) {
                    if (data.length || line.startsWith('data:') || event === 'error') {
                        throw new Error('APIストリームがイベントの途中で切断されました。');
                    }
                    return false;
                }
            }
        } finally {
            signal?.removeEventListener('abort', cancel);
            if (!eof && !signal?.aborted) cancel();
            reader.releaseLock();
        }
    }

    function geminiAccumulator() {
        const result = {};
        const candidates = new Map();
        let content = '', thoughtSummary = '';
        return {
            add(chunk, progress) {
                const { candidates: incoming, usageMetadata, ...metadata } = chunk;
                Object.assign(result, metadata);
                if (usageMetadata) result.usageMetadata = { ...result.usageMetadata, ...usageMetadata };
                let received = Boolean(chunk.promptFeedback?.blockReason);
                for (const candidate of incoming || []) {
                    const index = candidate.index ?? 0;
                    const current = candidates.get(index) || {};
                    const { content: nextContent, thoughts, ...fields } = candidate;
                    Object.assign(current, fields);
                    if (nextContent) {
                        const parts = current.content?.parts || [];
                        current.content = { ...current.content, ...nextContent, parts };
                        for (const part of nextContent.parts || []) parts.push(part);
                    }
                    if (thoughts) {
                        const parts = current.thoughts?.parts || [];
                        current.thoughts = { ...current.thoughts, ...thoughts, parts };
                        for (const part of thoughts.parts || []) parts.push(part);
                    }
                    candidates.set(index, current);
                    received ||= Boolean(nextContent?.parts?.length || thoughts?.parts?.length || candidate.finishReason);
                    if (index === 0) {
                        for (const part of nextContent?.parts || []) {
                            if (typeof part.text !== 'string') continue;
                            if (part.thought === true) thoughtSummary += part.text;
                            else content += part.text;
                        }
                        for (const part of thoughts?.parts || []) thoughtSummary += part.text || '';
                    }
                }
                if (received) progress({ content, thoughtSummary });
            },
            finish() {
                const ordered = [...candidates.keys()].sort((a, b) => a - b).map(index => candidates.get(index));
                if (!result.promptFeedback?.blockReason && (!ordered.length || ordered.some(candidate => !candidate.finishReason))) {
                    throw new Error('Geminiストリームが完了前に切断されました。');
                }
                for (const candidate of ordered) {
                    for (const { functionCall } of candidate.content?.parts || []) {
                        if (functionCall && (candidate.finishReason !== 'STOP' || !functionCall.name || functionCall.willContinue
                            || functionCall.partialArgs?.length || (functionCall.args != null
                                && (typeof functionCall.args !== 'object' || Array.isArray(functionCall.args))))) {
                            throw new Error('Geminiのツール呼び出しが未完了です。');
                        }
                    }
                }
                return { ...result, candidates: ordered };
            }
        };
    }

    function reasoningText(message) {
        const reasoningTexts = [];
        const addText = (value) => {
            if (typeof value === 'string' && value.trim()) {
                reasoningTexts.push(value.trim());
            }
        };

        const reasoning = normalizeReasoningTextForDedupe(message?.reasoning);
        const reasoningContent = normalizeReasoningTextForDedupe(message?.reasoning_content);
        if (!reasoningContent || !reasoningContent.includes(reasoning)) addText(message?.reasoning);
        if (!reasoning || !reasoning.includes(reasoningContent)) addText(message?.reasoning_content);
        if (reasoning && reasoning === reasoningContent) addText(message.reasoning);

        const reasoningDetails = message?.reasoning_details;
        const directText = reasoningTexts.map(text => normalizeReasoningTextForDedupe(text));
        const addDetail = detail => {
            const text = extractReasoningDetailText(detail);
            if (!text || directText.some(value => value.includes(normalizeReasoningTextForDedupe(text)))) return;
            addText(text);
        };
        if (Array.isArray(reasoningDetails)) {
            reasoningDetails.forEach(addDetail);
        } else if (reasoningDetails && typeof reasoningDetails === 'object') {
            addDetail(reasoningDetails);
        }

        return dedupeReasoningTextParts(reasoningTexts).join('\n\n');
    }

    function normalizeReasoningTextForDedupe(text) {
        return String(text || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function dedupeConsecutiveReasoningParagraphs(text) {
        const paragraphs = String(text || '').split(/\n{2,}/);
        const deduped = [];
        let previousKey = '';

        for (const paragraph of paragraphs) {
            const trimmed = paragraph.trim();
            const key = normalizeReasoningTextForDedupe(trimmed);

            if (!key || key === previousKey) {
                continue;
            }

            deduped.push(trimmed);
            previousKey = key;
        }

        return deduped.join('\n\n');
    }

    function dedupeReasoningTextParts(parts) {
        const seen = new Set();
        const deduped = [];

        for (const part of parts) {
            if (typeof part !== 'string') {
                continue;
            }

            const text = dedupeConsecutiveReasoningParagraphs(part);
            const key = normalizeReasoningTextForDedupe(text);

            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            deduped.push(text);
        }

        return deduped;
    }

    function extractReasoningDetailText(detail) {
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
            return '';
        }

        if (detail.type && !['reasoning.text', 'reasoning.summary'].includes(detail.type)) {
            return '';
        }

        if (detail.type === 'reasoning.summary' && typeof detail.summary === 'string') {
            return detail.summary.trim();
        }

        if (detail.type === 'reasoning.text' && typeof detail.text === 'string') {
            return detail.text.trim();
        }

        for (const key of ['summary', 'text', 'content']) {
            if (typeof detail[key] === 'string' && detail[key].trim()) {
                return detail[key].trim();
            }
        }

        return '';
    }

    function appendReasoningDetails(details, blocks, incoming) {
        for (const detail of Array.isArray(incoming) ? incoming : [incoming]) {
            if (!detail || typeof detail !== 'object') continue;
            const textField = detail.type === 'reasoning.text' ? 'text' : detail.type === 'reasoning.summary' ? 'summary' : null;
            // Only indexed/identified text deltas can be joined. Opaque blocks keep their wire order.
            const indexKey = textField && detail.index != null ? JSON.stringify([detail.type, 'index', detail.index]) : null;
            const idKey = textField && detail.id != null ? JSON.stringify([detail.type, 'id', detail.id]) : null;
            const compatible = previous => previous
                && (previous.format == null || detail.format == null || previous.format === detail.format)
                && (previous.id == null || detail.id == null || previous.id === detail.id)
                && (previous.index == null || detail.index == null || previous.index === detail.index)
                && (!previous.signature || !detail.signature || previous.signature === detail.signature);
            const indexed = blocks.get(indexKey), identified = blocks.get(idKey);
            let block = compatible(indexed) ? indexed : compatible(identified) ? identified : null;
            if (block) {
                const text = (block[textField] || '') + (detail[textField] || '');
                Object.assign(block, Object.fromEntries(Object.entries(detail).filter(([, value]) => value != null)), { [textField]: text });
            } else {
                block = { ...detail };
                details.push(block);
            }
            if (indexKey) blocks.set(indexKey, block);
            if (idKey) blocks.set(idKey, block);
        }
    }

    function appendToolCall(tools, fragment) {
        const index = fragment.index;
        if (!Number.isInteger(index) || index < 0) throw new Error('ツール呼び出しの index が不正です。');
        const tool = tools.get(index) || { function: {} };
        if (fragment.type != null) {
            if (fragment.type !== 'function') throw new Error('ツール呼び出しの type が不正です。');
            tool.type = fragment.type;
        }
        if (fragment.id != null) {
            if (typeof fragment.id !== 'string') throw new Error('ツール呼び出しの ID が不正です。');
            // A repeated typed ID is metadata. An untyped ID field is a continuation.
            if (!tool.id) tool.id = fragment.id;
            else if (!fragment.type) tool.id += fragment.id;
            else if (fragment.id !== tool.id) throw new Error('同じ index に異なるツール呼び出しIDがあります。');
        }
        const { name, arguments: args } = fragment.function || {};
        if ((name != null && typeof name !== 'string') || (args != null && typeof args !== 'string')) {
            throw new Error('ツール呼び出しの断片が不正です。');
        }
        if (name) tool.function.name = (tool.function.name || '') + name;
        if (args) tool.function.arguments = (tool.function.arguments || '') + args;
        tools.set(index, tool);
    }

    function routerAccumulator() {
        const result = {};
        const choices = new Map();
        return {
            add(chunk, progress) {
                if (chunk.model) result.model = chunk.model;
                if (chunk.usage) result.usage = chunk.usage;
                let received = false;
                for (const choice of chunk.choices || []) {
                    const index = choice.index ?? 0;
                    if (choice.finish_reason === 'error') throw new Error('OpenRouterストリームの途中でエラーが発生しました。');
                    const current = choices.get(index) || { index, message: { role: 'assistant' }, tools: new Map(), blocks: new Map() };
                    const delta = choice.delta || {};
                    for (const key of ['content', 'reasoning', 'reasoning_content']) {
                        if (typeof delta[key] === 'string' && delta[key]) {
                            current.message[key] = (current.message[key] || '') + delta[key];
                            received = true;
                        }
                    }
                    if (delta.reasoning_details && (!Array.isArray(delta.reasoning_details) || delta.reasoning_details.length)) {
                        appendReasoningDetails(current.message.reasoning_details ||= [], current.blocks, delta.reasoning_details);
                        received = true;
                    }
                    if (delta.tool_calls?.length) {
                        for (const fragment of delta.tool_calls) appendToolCall(current.tools, fragment);
                        received = true;
                    }
                    if (choice.finish_reason) {
                        current.finish_reason ||= choice.finish_reason;
                        received = true;
                    }
                    choices.set(index, current);
                }
                if (received) {
                    const message = choices.get(0)?.message || {};
                    progress({ content: message.content || '', getThoughtSummary: () => reasoningText(message) });
                }
            },
            finish(done) {
                if (!done || !choices.size || [...choices.values()].some(choice => !choice.finish_reason)) {
                    throw new Error('OpenRouterストリームが完了前に切断されました。');
                }
                result.choices = [...choices.values()].sort((a, b) => a.index - b.index).map(({ tools, blocks, ...choice }) => {
                    if (!tools.size && !['tool_calls', 'function_call'].includes(choice.finish_reason)) return choice;
                    if (!tools.size) throw new Error('OpenRouterのツール呼び出しが未完了です。');
                    if (!['stop', 'tool_calls', 'function_call'].includes(choice.finish_reason)) {
                        throw new Error('OpenRouterのツール呼び出しが未完了です。');
                    }
                    choice.message.tool_calls = [...tools.keys()].sort((a, b) => a - b).map(index => {
                        const tool = tools.get(index);
                        const args = JSON.parse(tool.function.arguments || 'null');
                        if (!tool.id?.trim() || !tool.function.name?.trim() || !args || typeof args !== 'object' || Array.isArray(args)) {
                            throw new Error('OpenRouterのツール呼び出しが未完了です。');
                        }
                        return tool;
                    });
                    return choice;
                });
                return result;
            }
        };
    }

    async function collectResponse(provider, body, signal, progress) {
        const accumulator = provider === 'gemini' ? geminiAccumulator() : routerAccumulator();
        let blockCount = 0;
        const done = await readSse(body, signal, (payload, event) => {
            if (event === 'ping' || event === 'keepalive') return false;
            if (payload.trim() === '[DONE]' && event !== 'error') return true;
            let chunk;
            try { chunk = JSON.parse(payload); }
            catch (error) { throw new Error('APIストリームのイベントを解析できません。', { cause: error }); }
            if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) throw new Error('APIストリームの応答形式が不正です。');
            if (chunk.error || event === 'error') {
                const info = chunk.error || chunk;
                const error = new Error(info.message || 'APIストリームの途中でエラーが発生しました。');
                if (Number.isInteger(info.code)) error.status = info.code;
                throw error;
            }
            const candidates = (provider === 'gemini' ? chunk.candidates : chunk.choices) ?? [];
            if (!Array.isArray(candidates)) throw new Error('APIストリームの応答形式が不正です。');
            blockCount += candidates.length;
            if (blockCount > MAX_STREAM_BLOCKS) throw sizeError();
            for (const candidate of candidates) {
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                    throw new Error('APIストリームの候補形式が不正です。');
                }
                const details = candidate.delta?.reasoning_details;
                blockCount += (candidate.content?.parts?.length || 0) + (candidate.thoughts?.parts?.length || 0)
                    + (candidate.delta?.tool_calls?.length || 0) + (Array.isArray(details) ? details.length : Number(Boolean(details)));
                if (blockCount > MAX_STREAM_BLOCKS) throw sizeError();
            }
            accumulator.add(chunk, progress);
            return false;
        });
        return accumulator.finish(done);
    }

    const api = { canStream, collectResponse, readSse, reasoningText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.StreamingV136 = api;
})(globalThis);
