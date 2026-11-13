/* v1.36 storage/execution core. No DOM or network access in the pure helpers. */
(function (root) {
    'use strict';
    const GLOBAL_KEY = 'globalSettingsV136';
    const SUCCESS_KEY = 'lastSuccessfulExecution';
    const MIGRATION_KEY = 'settingsSchemaVersion';
    const BACKUP_KEY = 'settingsMigrationBackupV136';
    const DRAFT_KEY = 'chatai-pwa-execution-draft-v1';
    const REMOVED_MODELS_KEY = 'removedApiModelRefsV136';
    const CHAT_PARAMETER_DRAFT_KEY = 'chatai-pwa-parameter-draft-v1';
    const chatNumberRules = { maxTokens: [1, Infinity, 1], temperature: [0, 2, 0.1], topK: [1, Infinity, 1], topP: [0, 1, 0.01] };
    const AUXILIARY_MODEL_NONE = 'none';
    const auxiliaryModelSelectIds = {
        thoughtTranslationModelRef: 'thought-translation-model', proofreadingModelRef: 'proofreading-model-name',
        summaryModelRef: 'summary-model-name', chatTitleModelRef: 'chat-title-model', memoryModelRef: 'memory-extraction-model',
        sdQcModelRef: 'sd-qc-model', sdPromptImproveModelRef: 'sd-prompt-improve-model'
    };
    const auxiliaryLegacyModelKeys = {
        thoughtTranslationModelRef: 'thoughtTranslationModel', proofreadingModelRef: 'proofreadingModelName',
        summaryModelRef: 'summaryModelName', sdQcModelRef: 'sdQcModel', sdPromptImproveModelRef: 'sdPromptImproveModel'
    };
    const appearanceKeys = ['backgroundAssetId', 'overlayOpacity', 'messageOpacity'];
    const themeKeys = ['darkMode', 'themeColorMode', 'accentColor', 'headerColor', 'headerTextColorMode',
        'headerTextColor', 'sendButtonColor', 'otherButtonColor', 'userMessageColor'];
    const profileKeys = ['systemPrompt', 'temperature', 'maxTokens', 'topK', 'topP', 'dummyUser', 'dummyModel',
        'reverseDummyOrder', 'concatDummyModel', 'applyDummyToProofread', 'applyDummyToTranslate',
        'geminiEnableFunctionCalling', 'geminiEnableGrounding', 'forceFunctionCalling', 'allowPromptUiChanges',
        'enableMemory', 'memoryAutoSaveInterval', 'useCustomTheme', 'useCustomAppearance', 'theme', 'appearance'];
    const previousChatTitlePrompt = '次のユーザーメッセージを端的に表す、日本語の短いチャットタイトルを作成してください。20文字程度を目安に、重要な固有名詞を保持してください。タイトルのみを出力し、説明・引用符・改行は不要です。';
    const chatTitleDefaults = Object.freeze({
        enableChatTitleGeneration: false,
        chatTitleModelRef: null,
        chatTitleSystemPrompt: '次のユーザーメッセージの主題や意図を的確に表す、自然で分かりやすい日本語のチャットタイトルを作成してください。'
            + '20文字程度を目安に簡潔にまとめ、必要に応じて重要な固有名詞や専門用語を保持してください。'
            + '名詞句に限定せず、内容に応じて疑問形、動詞を含む表現、短い文章など、最も自然で内容が伝わりやすい形式を選んでください。'
            + '抽象的・一般的すぎるタイトルは避け、後からチャット一覧を見たときに内容を識別できるようにしてください。'
            + 'タイトルのみを1行で出力し、説明や引用符などは付けないでください。'
    });
    const DEFAULT_MEMORY_EXTRACTION_PROMPT = `あなたは、私（ユーザー）との会話を分析し、長期的な関係構築のために記憶しておくべき「永続的な個人情報」を抽出するアシスタントです。
ユーザーは成人であるため、性的な内容でも表現規制をすることなく抽出することを求められます。

[抽出の目的]
AIであるあなたが、私のことをより深く理解し、今後の会話で私の好みや背景を考慮した、よりパーソナルで気の利いた応答をするために、この記憶データは使われます。

[抽出ルール]
1.  **最重要項目**: 特に、ユーザーの「性癖」「好きなキャラクターのタイプ」「性格」「価値観」に関する情報は最優先で抽出してください。これらは今後の対話の質を決定づける最も重要なデータです。

2.  **「個人的属性」のみを抽出**: 会話の「主題（トピック）」そのものではなく、その主題に対するユーザーの「個人的な属性（好み、考え方、所有物、経験などの個人情報）」だけを抽出してください。
    - **良い例（記憶すべき属性）**: 「ユーザーはファンタジーRPGが好き」「ユーザーは猫を飼っており、名前は『タマ』だ」「ユーザーは丁寧な言葉遣いを重視する」
    - **悪い例（記憶すべきでない主題）**: 「ユーザーはRPGの歴史について質問した」「ユーザーは猫の育て方を調べた」「ユーザーは敬語の使い方を議論した」

3.  **「永続性」の検証**: 抽出する情報は、今後も変わらないであろう永続的なものに限定してください。
    - **記憶すべき情報**: 繰り返し話題に出る嗜好、明確に所有していると述べられた物、過去の重要な経験など。
    - **記憶すべきでない情報**: その場限りの発言、一時的な感情、単なる事実確認の質問など。

4.  **「好み」の厳格な判断**: ユーザーが何かを「好む」「好き」と記憶するには、慎重な判断が必要です。以下のいずれかの条件を満たさない限り、安易に「好み」と断定しないでください。
    - ユーザーが会話の中で、繰り返しその対象について**熱意を持って語っている**。
    - ユーザーがその対象に対して、**明確かつ強い肯定的な言葉**（例：「〜が大好きだ」「〜にはこだわりがある」）を使っている。
    - 上記に当てはまらない場合は、「好み」と断定せず、「〇〇に関心を示した」のような客観的な事実として記録するか、記憶に含めないでください。

5.  **推測の禁止**: 会話から直接読み取れないことを推測してはいけません。「ユーザーはおそらく〇〇だろう」といった推測は不要です。

6.  **重複の完全な排除**: 【既存の記憶】に少しでも関連する内容が既にある場合は、絶対に含めないでください。`;
    const MEMORY_EXTRACTION_OUTPUT_FORMAT = `7.  **出力形式の厳守**:
    - 抽出した内容は、「ユーザーは〇〇を所有している」「ユーザーは〇〇という考えを持っている」のように、必ず**三人称の客観的な事実**として記述してください。
    - **AIとしての応答（「承知しました」など）や前置き、後書きは一切含めず**、抽出した箇条書きのリスト、または \`[追加情報なし]\` という文字列のみを出力してください。`;
    const legacyChatTitlePrompts = [previousChatTitlePrompt, `${previousChatTitlePrompt}\n\n{message}`];
    const migrateChatTitlePrompt = settings => legacyChatTitlePrompts.includes(settings?.chatTitleSystemPrompt)
        ? { ...settings, chatTitleSystemPrompt: chatTitleDefaults.chatTitleSystemPrompt }
        : settings;
    const globalKeys = ['showThoughtProcess', 'enableThoughtTranslation', 'thoughtTranslationModelRef',
        'thoughtTranslationModel', 'enableProofreading', 'proofreadingModelRef', 'proofreadingModelName',
        'proofreadingSystemInstruction', 'enableSummaryButton', 'summaryModelRef', 'summaryModelName',
        'summarySystemPrompt', 'enableAutoRetry', 'maxRetries', 'useFixedRetryDelay', 'fixedRetryDelaySeconds',
        'maxBackoffDelaySeconds', 'enableApiTimeout', 'apiTimeoutSeconds', 'dropboxAppKey', 'dropboxSyncFrequency',
        'googleSearchApiKey', 'googleSearchEngineId', 'sdApiUrl', 'sdApiUser', 'sdApiPassword',
        'memoryModelRef', 'memoryExtractionPrompt', 'sdQcModelRef', 'sdPromptImproveModelRef',
        'sdEnableQualityChecker', 'sdQcModel', 'sdQcPrompt', 'sdQcRetries', 'sdPromptImproveModel',
        'sdPromptImproveSystemPrompt', 'theme', 'appearance', 'enableStreamingOutput', ...Object.keys(chatTitleDefaults)];
    const pick = (source = {}, keys = []) => Object.fromEntries(keys.filter(key =>
        Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, structuredClone(source[key])]));
    function normalizeChatNumbers(source, fallback = {}) {
        return Object.fromEntries(Object.entries(chatNumberRules).map(([key, [min, max, step]]) => {
            const value = Object.hasOwn(source || {}, key) ? source[key] : fallback[key];
            if (!Number.isFinite(value) || value < min || value > max) return [key, null];
            const steps = (value - min) / step;
            return [key, Math.abs(steps - Math.round(steps)) < 1e-8 ? value : null];
        }));
    }
    function chatContentVersion(chat) {
        return { recordGenerationId: chat?.recordGenerationId ?? null, contentRevision: chat?.contentRevision ?? 0 };
    }
    function sameChatContentVersion(chat, expected) {
        const actual = chatContentVersion(chat);
        return actual.recordGenerationId === expected.recordGenerationId && actual.contentRevision === expected.contentRevision;
    }
    function nextChatContentVersion(chat) {
        const { recordGenerationId, contentRevision } = chatContentVersion(chat);
        return { recordGenerationId: recordGenerationId || root.crypto.getRandomValues(new Uint32Array(4)).join('-'),
            contentRevision: contentRevision + 1 };
    }
    const modelRef = value => value?.apiConfigId && value?.modelName
        ? { apiConfigId: String(value.apiConfigId), modelName: String(value.modelName) } : null;
    const matchesRemovedModel = (ref, removed = []) => !!ref && removed.some(item =>
        item.apiConfigId === String(ref.apiConfigId || '').trim() && item.modelName === String(ref.modelName || '').trim());
    const clearRemovedExecution = (execution, removed) => matchesRemovedModel(execution?.modelRef, removed)
        ? { ...execution, modelRef: null, thinkingEffort: null, modelSelectionRequired: true } : execution;
    function profileSettings(source = {}, legacyThemeScoped = false) {
        const result = pick(source, profileKeys);
        result.useCustomTheme = source.useCustomTheme ?? legacyThemeScoped;
        result.useCustomAppearance = source.useCustomAppearance === true;
        if (!result.theme && legacyThemeScoped) result.theme = pick(source, themeKeys);
        if (result.theme) result.theme = pick(result.theme, themeKeys);
        if (result.appearance) result.appearance = pick(result.appearance, appearanceKeys);
        return result;
    }
    const cap = (mode, levels = [], defaultEffort = null, extra = {}) =>
        ({ mode, levels, defaultEffort, supported: mode !== 'unknown' && mode !== 'none', ...extra });
    const GEMINI_MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
    const MODEL_DEFAULT_EFFORT = 'model-default';
    // Exact GenerateContent overrides for models with documented levels/defaults.
    // https://ai.google.dev/gemini-api/docs/generate-content/thinking
    // https://ai.google.dev/gemini-api/docs/generate-content/image-generation
    const geminiThinkingModels = {
        'gemini-3-pro-preview': { levels: ['low', 'high'], defaultEffort: 'high' },
        'gemini-3-flash-preview': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'high' },
        'gemini-3.1-pro-preview': { levels: ['low', 'medium', 'high'], defaultEffort: 'high' },
        'gemini-3.1-pro-preview-customtools': { levels: ['low', 'medium', 'high'], defaultEffort: 'high' },
        'gemini-3.1-flash-lite-preview': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'minimal' },
        'gemini-3.1-flash-lite': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'minimal' },
        'gemini-3.5-flash-lite': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'minimal' },
        'gemini-3.5-flash': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' },
        'gemini-3.6-flash': { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' },
        'gemini-3.7-flash': { levels: ['low', 'medium', 'high'], defaultEffort: 'medium' },
        'gemini-3.8-flash': { levels: ['low', 'medium', 'high'], defaultEffort: 'medium' },
        'gemini-3.1-flash-image': { levels: ['minimal', 'high'], defaultEffort: 'minimal' },
        'gemini-3.1-flash-lite-image': { levels: ['minimal', 'high'], defaultEffort: 'minimal' },
        'gemini-3-pro-image': { levels: ['high'], defaultEffort: 'high' }
    };
    const bedrockBudgetModels = new Set(['anthropic.claude-3-7-sonnet-20250219-v1:0',
        'anthropic.claude-sonnet-4-20250514-v1:0', 'anthropic.claude-opus-4-20250514-v1:0',
        'anthropic.claude-sonnet-4-5-20250929-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0',
        'anthropic.claude-opus-4-5-20251101-v1:0']);
    const geminiModelId = name => String(name || '').replace(/^models\//, '');
    const geminiMajor = id => Number(/^gemini-([1-9]\d*)(?:\.\d+)*(?:-[a-z0-9]+)*$/.exec(id)?.[1]) || 0;
    // The GenerateContent guide documents HIGH as the maximum for these two Gemini 4 models.
    const geminiHighMaximumModels = new Set(['gemini-4-carbon', 'gemini-4-argon']);
    // https://aistudio.google.com/docs/thinking?generate-content=true#thinking-levels
    const geminiDocumentedDefaults = new Map([
        ['gemini-4-hydrogen', 'high'],
        ['gemini-4-carbon', 'medium'],
        ['gemini-4-argon', 'medium'],
        ['gemini-robotics-er-2-preview', 'high']
    ]);
    function geminiCapability(id, metadata) {
        if (metadata?.thinking === false ||
            (Array.isArray(metadata?.supportedGenerationMethods) && !metadata.supportedGenerationMethods.includes('generateContent'))) {
            return cap('none', [], null, { source: 'metadata', preserveEffort: true });
        }
        if (metadata?.configRejected) return cap('none', [], null, { source: 'response', preserveEffort: true });
        const base = geminiModelId(metadata?.baseModelId);
        const known = Object.hasOwn(geminiThinkingModels, id) ? geminiThinkingModels[id]
            : Object.hasOwn(geminiThinkingModels, base) ? geminiThinkingModels[base] : null;
        const documentedDefault = geminiDocumentedDefaults.get(id) ?? known?.defaultEffort ?? geminiDocumentedDefaults.get(base);
        const major = geminiMajor(base) || geminiMajor(id);
        if (!known && (['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(id)
            || (major > 0 && major < 3 && metadata?.thinking === true))) {
            return cap('legacy-default', [], null, { summary: true,
                limitation: 'No thinkingLevel; native default only. Flash-Lite needs a budget to force thinking.' });
        }
        const specialized = /(?:^|-)(?:tts|live|embedding|native-audio)(?:-|$)/.test(base || id);
        if (!documentedDefault && (major < 3 || specialized) && metadata?.thinking !== true) return cap('unknown');
        const acceptedLevels = metadata?.acceptedLevels || [];
        const rejectedLevels = metadata?.rejectedLevels || [];
        const candidates = ['low', 'medium', 'high'];
        if (major >= 4 && !geminiHighMaximumModels.has(id) && !geminiHighMaximumModels.has(base)) candidates.push('xhigh');
        const levels = (known?.levels || candidates).filter(level => !rejectedLevels.includes(level));
        const modelDefault = !known || !levels.includes(known.defaultEffort);
        return cap('level', levels, modelDefault ? MODEL_DEFAULT_EFFORT : known.defaultEffort, {
            source: known ? 'known' : 'inferred', thinkingConfirmed: Boolean(known || metadata?.thinking === true || acceptedLevels.length),
            initialEffort: levels.includes(documentedDefault) ? documentedDefault : MODEL_DEFAULT_EFFORT,
            modelDefault, acceptedLevels, rejectedLevels
        });
    }

    function geminiThinkingRejection(error, level) {
        if (error?.status !== 400) return null;
        const message = error.data?.error?.message || error.message || '';
        const fields = Array.isArray(error.data?.error?.details) ? error.data.error.details.flatMap(detail =>
            Array.isArray(detail?.fieldViolations) ? detail.fieldViolations : []) : [];
        if (/\bthinking(?:[_ ]?config(?:uration)?)? (?:is )?not supported(?: (?:by|for|on) (?:this |the )?model)?[.!]?$/i.test(message.trim())
            || /\b(?:does not|doesn't) support thinking(?:[_ ]?config(?:uration)?| features)?[.!]?$/i.test(message.trim())) return 'config';
        if (!level) return null;
        const unsupported = /\b(?:not supported|unsupported|does not support|only supports)\b/i;
        const levelField = /\bthinking[_ ]?level\b/i;
        const conditional = /\b(?:in combination|when|with|unless)\b/i;
        if (levelField.test(message) && unsupported.test(message) && !conditional.test(message)) return 'level';
        if (/\binvalid value at ['"][\w.]*thinking_?level['"]/i.test(message)) return 'level';
        if (/\bunknown name ['"]thinking_?level['"].*cannot find field/i.test(message)) return 'level';
        return fields.some(field => /(?:^|\.)thinking_?level$/i.test(field?.field || '') &&
            unsupported.test(field?.description || '') && !conditional.test(field?.description || '')) ? 'level' : null;
    }

    function capability(provider, name, metadata) {
        const id = geminiModelId(name);
        if (provider === 'openrouter' && metadata) {
            const r = metadata.reasoning;
            if (r && Object.prototype.hasOwnProperty.call(r, 'supported_efforts')) {
                const levels = (r.supported_efforts === null
                    ? ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : r.supported_efforts)
                    .filter(level => ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level));
                return cap('effort', levels, levels.includes(r.default_effort) ? r.default_effort : levels[0] || null,
                    { source: 'metadata' });
            }
            return cap(r ? 'enabled' : 'none', [], null, { source: 'metadata' });
        }
        if (provider === 'gemini') return geminiCapability(id, metadata);
        if (provider === 'openrouter') {
            const googleId = id.replace(/^google\//, '');
            if (id.startsWith('google/') && Object.hasOwn(geminiThinkingModels, googleId)) {
                const model = geminiThinkingModels[googleId];
                return cap('effort', model.levels, model.defaultEffort);
            }
            if (['openai/o3', 'openai/o3-mini', 'openai/o4-mini', 'openai/o1'].includes(id)) return cap('effort', ['low', 'medium', 'high'], 'medium');
            if (id === 'openai/gpt-5') return cap('effort', ['minimal', 'low', 'medium', 'high'], 'medium');
            if (['x-ai/grok-4', 'x-ai/grok-4.1-fast'].includes(id)) return cap('effort', ['low', 'medium', 'high'], 'high');
        }
        if (provider === 'zai') {
            if (id === 'glm-5.2') return cap('effort', ['high', 'max'], 'max');
            if (['glm-5.3', 'glm-5.3-flash'].includes(id)) return cap('effort', ['low', 'high', 'max'], 'max');
            if (['glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-4.7-flash', 'glm-5', 'glm-5.1'].includes(id)) return cap('enabled');
        }
        if (provider === 'bedrock') {
            const bedrockId = id.replace(/^(us|eu|apac|jp|global)\./, '');
            if (['anthropic.claude-opus-4-6-v1', 'anthropic.claude-sonnet-4-6'].includes(bedrockId)) return cap('adaptive', ['low', 'medium', 'high', 'max'], 'high');
            if (bedrockBudgetModels.has(bedrockId)) return cap('budget', [], null, { budgetTokens: 1024 });
        }
        return cap('unknown');
    }
    // Exact IDs verified against provider model/input-modality documentation.
    // Unknown IDs (including lookalikes) never inherit a provider-wide vision flag.
    const geminiImageModels = new Set([
        'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
        'gemini-2.5-flash-preview-09-2025', 'gemini-2.5-flash-lite-preview-09-2025', 'gemini-2.5-flash-image-preview',
        'gemini-2.5-flash-image', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
        'gemini-3.1-pro-preview-customtools', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash',
        'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image'
    ]);
    const bedrockImageModels = new Set([
        'anthropic.claude-3-haiku-20240307-v1:0', 'anthropic.claude-3-sonnet-20240229-v1:0', 'anthropic.claude-3-opus-20240229-v1:0',
        'anthropic.claude-3-5-sonnet-20240620-v1:0', 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        ...bedrockBudgetModels, 'anthropic.claude-opus-4-6-v1', 'anthropic.claude-sonnet-4-6',
        'amazon.nova-lite-v1:0', 'amazon.nova-pro-v1:0', 'amazon.nova-premier-v1:0'
    ]);
    function imageInputCapability(provider, name, metadata) {
        const id = String(name || '').replace(/^models\//, '');
        if (Array.isArray(metadata?.inputModalities)) return metadata.inputModalities.includes('image') ? 'supported' : 'unsupported';
        if (provider === 'gemini' && geminiImageModels.has(id)) return 'supported';
        if (provider === 'zai') {
            if (['glm-4.6v', 'glm-4.6v-flash', 'glm-4.6v-flashx', 'glm-4.5v'].includes(id)) return 'supported';
            if (['glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4.6', 'glm-4.7', 'glm-4.7-flash'].includes(id)) return 'unsupported';
        }
        if (provider === 'bedrock' && bedrockImageModels.has(id.replace(/^(us|eu|apac|jp|global)\./, ''))) return 'supported';
        return 'unknown';
    }
    const canSelectEffort = (value, c) => c.levels.includes(value) || (c.modelDefault && value === MODEL_DEFAULT_EFFORT);
    const normalizeEffort = (value, c) => canSelectEffort(value, c) ? value : c.defaultEffort;
    function executionSettings(source, fallbackRef, resolveCapability, preserveUnknown = false) {
        const needsSelection = source?.modelSelectionRequired === true && source.modelRef === null;
        const ref = needsSelection ? null : modelRef(source?.modelRef) || modelRef(fallbackRef);
        const c = resolveCapability(ref);
        const effort = source?.thinkingEffort ?? null;
        const useGeminiDefault = c.initialEffort && (effort === null || effort === MODEL_DEFAULT_EFFORT);
        return { schemaVersion: 1, modelRef: ref,
            thinkingEffort: c.mode === 'unknown' || c.preserveEffort || c.rejectedLevels?.includes(effort)
                || useGeminiDefault || (preserveUnknown && effort === null) ? effort : normalizeEffort(effort, c),
            updatedAt: source?.updatedAt || Date.now(), ...(needsSelection && { modelSelectionRequired: true }) };
    }
    function applyThinking(body, provider, c, effort) {
        if (provider === 'gemini') {
            delete body.thinkingConfig;
            if (c.mode === 'level') {
                const level = effort == null || effort === MODEL_DEFAULT_EFFORT ? null : normalizeEffort(effort, c);
                if (level && level !== MODEL_DEFAULT_EFFORT) {
                    body.thinkingConfig = { thinkingLevel: c.source === 'inferred' ? level.toUpperCase() : level, includeThoughts: true };
                } else if (c.thinkingConfirmed) body.thinkingConfig = { includeThoughts: true };
            }
            else if (c.mode === 'legacy-default') body.thinkingConfig = { includeThoughts: true };
        } else if (provider === 'openrouter') {
            delete body.reasoning;
            if (c.mode === 'effort' && c.levels.length) body.reasoning = { effort: normalizeEffort(effort, c), exclude: false };
            else if (c.mode === 'enabled') body.reasoning = { enabled: true, exclude: false };
        } else if (provider === 'zai') {
            if (c.supported) body.thinking = { type: 'enabled' };
            if (c.mode === 'effort') body.reasoning_effort = normalizeEffort(effort, c);
        } else if (provider === 'bedrock' && ['adaptive', 'budget'].includes(c.mode)) {
            if (body.toolConfig?.toolChoice?.any) throw new Error('Thinking対応ClaudeではFunction Callingの強制を解除してください。');
            if (c.mode === 'adaptive') {
                body.additionalModelRequestFields = { thinking: { type: 'adaptive' }, output_config: { effort: normalizeEffort(effort, c) } };
                delete body.inferenceConfig.temperature;
                delete body.inferenceConfig.topP;
            } else {
                if (body.inferenceConfig.maxTokens && body.inferenceConfig.maxTokens <= c.budgetTokens) throw new Error('このClaudeのThinkingにはMax Tokensを1024より大きく設定してください。');
                body.additionalModelRequestFields = { thinking: { type: 'enabled', budget_tokens: c.budgetTokens } };
                delete body.inferenceConfig.temperature;
                delete body.inferenceConfig.topP;
            }
        }
        return body;
    }
    const READER_VERSION = 137;
    function assertCompatible(envelope) {
        if (!envelope || envelope.version !== '2.0' || !envelope.data) throw new Error('同期データの形式が無効です。');
        if ((envelope.settingsSchemaVersion || 0) > 136 || (envelope.minimumReaderVersion || 0) > READER_VERSION ||
            (Object.hasOwn(envelope.data, 'documentLibrary') &&
                (envelope.minimumReaderVersion !== READER_VERSION || envelope.data.documentLibrary?.schemaVersion !== 1)) ||
            (Object.hasOwn(envelope, 'backupSchemaVersion') &&
                (envelope.minimumReaderVersion !== READER_VERSION || envelope.backupSchemaVersion !== 1)) ||
            envelope.data.settings?.some(s => s.key === GLOBAL_KEY && s.value?.schemaVersion > 1) ||
            envelope.data.settings?.some(s => s.key === MIGRATION_KEY && s.value > 136) ||
            envelope.data.profiles?.some(p => p.profileSchemaVersion > 1) ||
            envelope.data.chats?.some(c => c.executionSettings?.schemaVersion > 1)) {
            throw new Error('新しいバージョンの同期データのため復元・上書きできません。');
        }
    }
    const sha256Constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function hashV136(text) {
        // Synchronous SHA-256 keeps _prepareApiHistory synchronous. The digest is
        // a local change detector, never a provider signature or authentication token.
        const input = new TextEncoder().encode(text), data = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
        data.set(input); data[input.length] = 0x80;
        const view = new DataView(data.buffer), bits = input.length * 8;
        view.setUint32(data.length - 8, Math.floor(bits / 0x100000000)); view.setUint32(data.length - 4, bits >>> 0);
        const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
        const rotate = (x,n) => (x >>> n) | (x << (32 - n));
        for (let offset = 0; offset < data.length; offset += 64) {
            for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
            for (let i = 16; i < 64; i++) {
                const x = w[i - 15], y = w[i - 2];
                w[i] = (w[i-16] + (rotate(x,7)^rotate(x,18)^(x>>>3)) + w[i-7] + (rotate(y,17)^rotate(y,19)^(y>>>10))) >>> 0;
            }
            let [a,b,c,d,e,f,g,z] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (z + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + sha256Constants[i] + w[i]) >>> 0;
                const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
                z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
            }
            [a,b,c,d,e,f,g,z].forEach((v,i) => h[i] = (h[i] + v) >>> 0);
        }
        return h.map(v => v.toString(16).padStart(8,'0')).join('');
    }
    const stableHistoryJson = value => JSON.stringify(value, (_,v) => v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
    const historySeedV136 = system => hashV136(stableHistoryJson({ system: system || '' }));
    function historyStepV136(prefix, message) {
        const data = pick(message, ['role','content','imageIds','generated_images','tool_calls','name','response','_toolCallId','tool_call_id','geminiFunctionCallId']);
        // saveChat materializes optional nulls/empty arrays. They do not change
        // the wire conversation and must not invalidate a fingerprint on reload.
        const compact = object => Object.fromEntries(Object.entries(object).filter(([,v]) => v != null && (!Array.isArray(v) || v.length)));
        if (message.attachments?.length) data.attachments = message.attachments.map(a => compact(pick(a,['name','mimeType','base64Data','assetId'])));
        if (message.continuation) {
            const continuation = compact(pick(message.continuation,['provider','apiConfigId','modelName','parts','turns','openai','bedrock']));
            if (Object.keys(continuation).length) data.continuation = continuation;
        }
        return hashV136(prefix + stableHistoryJson(compact(data)));
    }
    function historyContextV136(messages, system = '') {
        let prefix = historySeedV136(system), turn = historySeedV136('');
        for (const message of messages) {
            if (message.isCascaded && !message.isSelected) continue;
            if (message.role === 'user') turn = historySeedV136('');
            prefix = historyStepV136(prefix, message); turn = historyStepV136(turn, message);
        }
        return { prefix, turn };
    }
    function rememberHistoryContextsV136(messages, system = '') {
        if (!(messages || []).some(m => m.continuation?.provider && !m.continuation.historyWireV136
            && (m.continuation.historyPrefixV136 === undefined || m.continuation.historyTurnV136 === undefined))) return;
        let prefix = historySeedV136(system), turn = historySeedV136(''), editedPrefix = false, editedTurn = false;
        const groups = new Map();
        for (const message of messages || []) {
            if (message.role === 'user') { turn = historySeedV136(''); editedTurn = false; }
            const group = message.isCascaded && message.siblingGroupId;
            if (group && !groups.has(group)) groups.set(group, { prefix, turn, editedPrefix, editedTurn });
            const context = group ? groups.get(group) : { prefix, turn, editedPrefix, editedTurn };
            const c = message.continuation;
            if (c?.provider && !c.historyWireV136) {
                // Known edits in legacy data still use N01's conservative fallback.
                // Newly generated responses already carry their request's context.
                if (c.historyPrefixV136 === undefined && context.editedPrefix) c.historyPrefixInvalidV136 = true;
                if (c.historyTurnV136 === undefined && context.editedTurn) c.historyTurnInvalidV136 = true;
                if (!context.editedPrefix && !c.historyPrefixInvalidV136) c.historyPrefixV136 ??= context.prefix;
                if (!context.editedTurn && !c.historyTurnInvalidV136) c.historyTurnV136 ??= context.turn;
            }
            if (message.isCascaded && !message.isSelected) continue;
            const original = c?.displayContent ?? c?.parts?.filter(p => typeof p.text === 'string' && p.thought !== true).map(p=>p.text).join('');
            const edited = original !== undefined && original !== (message.content || '');
            editedPrefix ||= edited; editedTurn ||= edited;
            prefix = historyStepV136(prefix, message); turn = historyStepV136(turn, message);
        }
    }
    // The worker owns serialization, legacy SHA chains and provider conversion.
    // Large immutable strings are content-keyed (not object-identity-keyed), so an
    // in-place edit cannot reuse an old digest. The bounded cache is never persisted.
    const wireConvertersV136 = {
    convertGeminiToOpenAIFormat(messagesForApi) {
        const openAIMessages = [];

        for (const geminiMsg of messagesForApi) {
            const role = geminiMsg.role === 'model' ? 'assistant' : (geminiMsg.role === 'tool' ? 'tool' : 'user');
            const parts = geminiMsg.parts || [];

            if (role === 'tool') {
                // ツールレスポンスの処理
                for (const part of parts) {
                    if (part.functionResponse) {
                        // OpenAI互換APIの場合、保存されたtool_call_idを使用
                        const toolCallId = part.functionResponse._toolCallId || part.functionResponse.id || part.functionResponse.name;
                        openAIMessages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: typeof part.functionResponse.response === 'string'
                                ? part.functionResponse.response
                                : JSON.stringify(part.functionResponse.response)
                        });
                    }
                }
            } else {
                const contentParts = [];
                const toolCalls = [];

                for (const part of parts) {
                    if (part.text && part.thought !== true) {
                        contentParts.push({ type: 'text', text: part.text });
                    } else if (part.inlineData) {
                        contentParts.push(...this._convertInlineDataToOpenAIContentParts(part.inlineData));
                    } else if (part.functionCall) {
                        // Function Callingの変換
                        // OpenAI互換APIの場合、保存されたtool_call_idを使用
                        const toolCallId = part.functionCall._toolCallId || part.functionCall.id;
                        if (!toolCallId) throw new Error("ツール呼出しIDがない履歴は安全に変換できません。この応答から再生成してください。");
                        toolCalls.push({
                            id: toolCallId,
                            type: 'function',
                            function: {
                                name: part.functionCall.name,
                                arguments: typeof part.functionCall.args === 'string'
                                    ? part.functionCall.args
                                    : JSON.stringify(part.functionCall.args || {})
                            }
                        });
                    }
                }

                const message = { role };
                const continuation = geminiMsg.tmContinuation;
                if (role === 'assistant' && continuation) Object.assign(message, structuredClone(continuation));

                // コンテンツの設定
                if (contentParts.length > 0) {
                    if (contentParts.length === 1 && contentParts[0].type === 'text') {
                        message.content = contentParts[0].text;
                    } else {
                        message.content = contentParts.map(part => {
                            if (part.type === 'text') {
                                return { type: 'text', text: part.text };
                            } else if (part.type === 'image_url') {
                                return part;
                            }
                            return part;
                        });
                    }
                } else if (toolCalls.length > 0) {
                    // tool_callsのみでcontentがない場合は空文字列を設定（Z.ai API互換性のため）
                    message.content = '';
                }

                // tool_callsの設定（contentと独立）
                if (toolCalls.length > 0) {
                    message.tool_calls = toolCalls;
                }

                if (message.content !== undefined || message.tool_calls) {
                    openAIMessages.push(message);
                }
            }
        }

        // デバッグ用にtoolメッセージとassistantメッセージのtool_callsを確認
        const toolMessages = openAIMessages.filter(m => m.role === 'tool');
        const assistantMessagesWithTools = openAIMessages.filter(m => m.role === 'assistant' && m.tool_calls);
        if (toolMessages.length > 0 || assistantMessagesWithTools.length > 0) {
            console.log('[Z.ai Debug] 変換後のメッセージ情報:');
            if (assistantMessagesWithTools.length > 0) {
                console.log(`  - assistant with tool_calls: ${assistantMessagesWithTools.length}件`);
                const lastAssistant = assistantMessagesWithTools[assistantMessagesWithTools.length - 1];
                if (lastAssistant && lastAssistant.tool_calls) {
                    console.log(`  - 最後のassistantのtool_call IDs:`, JSON.stringify(lastAssistant.tool_calls.map(tc => tc.id)));
                }
            }
            if (toolMessages.length > 0) {
                console.log(`  - tool messages: ${toolMessages.length}件`);
                const recentToolIds = toolMessages.slice(-5).map(m => m.tool_call_id);
                console.log(`  - 最近のtool_call_ids:`, JSON.stringify(recentToolIds));
            }
            // IDの一致を確認
            if (assistantMessagesWithTools.length > 0 && toolMessages.length > 0) {
                const lastAssistant = assistantMessagesWithTools[assistantMessagesWithTools.length - 1];
                const expectedIds = lastAssistant.tool_calls?.map(tc => tc.id) || [];
                const actualIds = toolMessages.slice(-expectedIds.length).map(tm => tm.tool_call_id);
                const matched = expectedIds.every((id, i) => id === actualIds[i]);
                console.log(`  - ID一致チェック: ${matched ? '✓ 一致' : '✗ 不一致'}`);
                if (!matched) {
                    console.warn(`  - 期待されるIDs: ${JSON.stringify(expectedIds)}`);
                    console.warn(`  - 実際のIDs: ${JSON.stringify(actualIds)}`);
                }
            }
        }

        return openAIMessages;
    },
    _convertInlineDataToOpenAIContentParts(inlineData) {
        const mimeType = inlineData?.mimeType || 'application/octet-stream';
        const base64Data = inlineData?.data || '';
        const lowerMimeType = mimeType.toLowerCase();
        const currentModel = (state.settings.modelName || '').toLowerCase();
        const isDeepSeekModel = currentModel.startsWith('deepseek/');

        if (lowerMimeType.startsWith('image/')) {
            if (isDeepSeekModel) {
                return [{
                    type: 'text',
                    text: `[添付画像: ${mimeType}。現在のモデルでは画像を直接読めない可能性があります]`
                }];
            }

            return [{
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` }
            }];
        }

        if (lowerMimeType === 'application/pdf') {
            return [{
                type: 'file',
                file: {
                    filename: 'attachment.pdf',
                    file_data: `data:application/pdf;base64,${base64Data}`
                }
            }];
        }

        if (this._isTextLikeMimeType(lowerMimeType)) {
            const decodedText = this._decodeBase64ToUtf8(base64Data);
            if (decodedText !== null) {
                return [{
                    type: 'text',
                    text: `[添付テキスト / MIME: ${mimeType}]\n${decodedText}`
                }];
            }
        }

        return [{
            type: 'text',
            text: `[未対応添付: filename不明 / MIME: ${mimeType}。OpenRouter送信では本文に変換されませんでした]`
        }];
    },
    _isTextLikeMimeType(mimeType) {
        if (mimeType.startsWith('text/')) {
            return true;
        }

        const textMimeTypes = new Set([
            'application/json',
            'application/xml',
            'application/javascript',
            'application/typescript',
            'application/x-javascript',
            'application/ecmascript',
            'application/sql',
            'application/yaml',
            'application/x-yaml',
            'application/rtf'
        ]);

        return textMimeTypes.has(mimeType) || mimeType.endsWith('+json') || mimeType.endsWith('+xml');
    },
    _decodeBase64ToUtf8(base64Data) {
        try {
            if (!base64Data || typeof atob !== 'function') {
                return null;
            }

            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            if (typeof TextDecoder === 'function') {
                return new TextDecoder('utf-8').decode(bytes);
            }

            let percentEncoded = '';
            for (let i = 0; i < bytes.length; i++) {
                percentEncoded += `%${bytes[i].toString(16).padStart(2, '0')}`;
            }
            return decodeURIComponent(percentEncoded);
        } catch (error) {
            console.warn('Base64テキスト添付のUTF-8デコードに失敗しました。', error);
            return null;
        }
    },
    convertGeminiToConverseFormat(messagesForApi) {
        const converseMessages = [];
        let pendingToolResults = [];  // 連続するtoolメッセージを一時保存

        for (let i = 0; i < messagesForApi.length; i++) {
            const geminiMsg = messagesForApi[i];

            // まずロールを判定（デフォルト）
            let role = geminiMsg.role === 'model' ? 'assistant' : geminiMsg.role;
            const content = [];
            if (role === 'assistant' && geminiMsg.tmBedrockContinuation) {
                const signedContent = structuredClone(geminiMsg.tmBedrockContinuation).map(item => {
                    if (Array.isArray(item.reasoningContent?.redactedContent))
                        item.reasoningContent.redactedContent = Uint8Array.from(item.reasoningContent.redactedContent);
                    return item;
                });
                converseMessages.push({ role, content: signedContent });
                continue;
            }

            // functionResponseが含まれているかチェック
            let hasFunctionResponse = false;

            if (geminiMsg.parts) {
                for (const part of geminiMsg.parts) {
                    if (part.text) {
                        content.push({ text: part.text });
                    } else if (part.inlineData) {
                        // Base64画像データをバイナリに変換
                        const base64Data = part.inlineData.data;
                        const format = part.inlineData.mimeType.split('/')[1];
                        content.push({
                            image: {
                                format: format,
                                source: {
                                    bytes: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
                                }
                            }
                        });
                    } else if (part.functionCall) {
                        const toolUseId = part.functionCall._toolCallId || part.functionCall.id;
                        if (!toolUseId) throw new Error('ツール呼出しIDがない履歴は安全に変換できません。この応答から再生成してください。');
                        // Tool use形式に変換
                        content.push({
                            toolUse: {
                                toolUseId,
                                name: part.functionCall.name,
                                input: part.functionCall.args || {}
                            }
                        });
                    } else if (part.functionResponse) {
                        // Tool result形式に変換
                        hasFunctionResponse = true;
                        const responseContent = typeof part.functionResponse.response === 'string'
                            ? part.functionResponse.response
                            : JSON.stringify(part.functionResponse.response);

                        // toolUseIdは元のtoolCallIdを使用（なければ関数名をフォールバック）
                        const toolUseId = part.functionResponse._toolCallId || part.functionResponse.id || part.functionResponse.name;

                        content.push({
                            toolResult: {
                                toolUseId: toolUseId,
                                content: [{ text: responseContent }]
                            }
                        });
                    }
                }
            }

            // role: "tool" の場合は、連続するtoolメッセージを集める
            if (geminiMsg.role === 'tool' || hasFunctionResponse) {
                pendingToolResults.push(...content);

                // 次のメッセージがtool以外の場合、または最後のメッセージの場合
                const nextMsg = messagesForApi[i + 1];
                const isLastMessage = i === messagesForApi.length - 1;
                const nextIsNotTool = !nextMsg || (nextMsg.role !== 'tool' && !nextMsg.parts?.some(p => p.functionResponse));

                if (isLastMessage || nextIsNotTool) {
                    // 溜まっているtoolResultsを1つの"user"メッセージとして追加
                    if (pendingToolResults.length > 0) {
                        converseMessages.push({
                            role: 'user',
                            content: pendingToolResults
                        });
                        pendingToolResults = [];
                    }
                }
            } else {
                // tool以外のメッセージはそのまま追加
                if (content.length > 0) {
                    converseMessages.push({ role, content });
                }
            }
        }

        return converseMessages;
    },
    };
    function historyWorkerRuntime() {
        const cache = new Map(); let bytes = 0;
        async function canonical(value) {
            if (typeof value === 'string' && value.length > 4096) {
                let digest = cache.get(value);
                if (!digest) {
                    digest = crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(buffer => Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2,'0')).join(''));
                    if (value.length <= 32 * 1024 * 1024) {
                        while (bytes + value.length > 64 * 1024 * 1024 && cache.size) { const key = cache.keys().next().value; bytes -= key.length; cache.delete(key); }
                        cache.set(value,digest); bytes += value.length;
                    }
                }
                return { stringSHA256: await digest, length: value.length };
            }
            if (ArrayBuffer.isView(value)) return { bytesSHA256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), x => x.toString(16).padStart(2,'0')).join(''), length: value.byteLength };
            if (Array.isArray(value)) return Promise.all(value.map(canonical));
            if (value && typeof value === 'object') {
                const result = {};
                for (const key of Object.keys(value).sort()) if (value[key] !== undefined) result[key] = await canonical(value[key]);
                return result;
            }
            return value;
        }
        const digest = async value => hashV136(JSON.stringify(await canonical(value)));
        const converted = new Map();
        async function convert(provider, messages, model) {
            const key = await digest({ provider, messages, model });
            if (converted.has(key)) return converted.get(key);
            state.settings.modelName = model;
            let result;
            if (provider === 'bedrock') result = wireConverters.convertGeminiToConverseFormat(messages);
            else if (provider === 'openrouter' || provider === 'zai') result = wireConverters.convertGeminiToOpenAIFormat(messages);
            else result = messages.map(m => ({ role:m.role === 'tool' ? 'user' : m.role, parts:m.parts.map(p => {
                const copy = structuredClone(p);
                if (copy.functionCall) delete copy.functionCall._toolCallId;
                if (copy.functionResponse) delete copy.functionResponse._toolCallId;
                return copy;
            }) }));
            if (converted.size >= 1) converted.delete(converted.keys().next().value);
            converted.set(key,result); return result;
        }
        self.onmessage = async ({data:{id,op,value}}) => {
            try {
                let result;
                if (op === 'remember') {
                    rememberHistoryContextsV136(value.messages,value.system);
                    result = value.messages.map(m => m.continuation && pick(m.continuation,['historyPrefixV136','historyTurnV136','historyPrefixInvalidV136','historyTurnInvalidV136']));
                } else if (op === 'prefixes') {
                    let prefix = historySeedV136(value.system), turn = historySeedV136('');
                    result = value.messages.map(m => { if(m.role === 'user') turn=historySeedV136(''); const before={prefix,turn}; prefix=historyStepV136(prefix,m);turn=historyStepV136(turn,m);return before; });
                } else if (op === 'convert') result = await convert(value.provider,value.messages,value.model);
                else if (op === 'wire') {
                    const {provider,messages,model,system} = value;
                    let start=0;
                    messages.forEach((m,i) => { if(m.role === 'user' && !m.parts?.some(p=>p.functionResponse)) start=i; });
                    const native=await convert(provider,messages,model);
                    const systemText=system?.parts?.[0]?.text || '';
                    const actualSystem=provider === 'gemini' ? (model === 'gemini-2.5-flash-image-preview' ? null : system || null) : systemText;
                    result={version:1,prefix:await digest({system:actualSystem,messages:native}),turn:await digest(await convert(provider,messages.slice(start),model))};
                } else throw new Error('Unknown history operation');
                self.postMessage({id,result});
            } catch(error) { self.postMessage({id,error:error.message}); }
        };
    }
    let historyWorker, historyRequestId = 0;
    const historyRequests = new Map();
    function configureHistoryWorkerV136(converters) {
        if (historyWorker) return;
        const functions = [hashV136,stableHistoryJson,historySeedV136,historyStepV136,historyContextV136,rememberHistoryContextsV136];
        const source = `const sha256Constants=${JSON.stringify(sha256Constants)}; const pick=${pick.toString()};\n`
            + functions.map(fn => `const ${fn.name}=${fn.toString()};`).join('\n')
            + `\nconst state={settings:{}}; const console={log(){},warn(){},error(){}}; const wireConverters={${Object.values(converters).map(fn=>fn.toString()).join(',\n')}};\n(${historyWorkerRuntime.toString()})();`;
        const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        try { historyWorker=new Worker(url); } finally { URL.revokeObjectURL(url); }
        historyWorker.onmessage=({data})=>{const pending=historyRequests.get(data.id);if(!pending)return;historyRequests.delete(data.id);data.error?pending.reject(new Error(data.error)):pending.resolve(data.result);};
        historyWorker.onerror=()=>{for(const p of historyRequests.values())p.reject(new Error('履歴検証Workerに失敗しました。再読込して再試行してください。'));historyRequests.clear();historyWorker.terminate();historyWorker=null;};
    }
    function historyTaskV136(op,value) {
        if (!historyWorker) throw new Error('履歴検証Workerが初期化されていません。');
        return new Promise((resolve,reject)=>{const id=++historyRequestId;historyRequests.set(id,{resolve,reject});try{historyWorker.postMessage({id,op,value});}catch(error){historyRequests.delete(id);reject(error);}});
    }
    async function rememberHistoryContextsAsyncV136(messages,system='') {
        if (!(messages || []).some(m=>m.continuation?.provider && !m.continuation.historyWireV136 && (m.continuation.historyPrefixV136 === undefined || m.continuation.historyTurnV136 === undefined))) return;
        const owner=root.state?.currentMessages === messages ? {messages,system:root.state.currentSystemPrompt} : null;
        const continuations=messages.map(m=>m.continuation);
        const original=messages.map(m=>({message:m,content:m.content}));
        const result=await historyTaskV136('remember',{messages,system});
        if(owner && (root.state.currentMessages !== owner.messages || root.state.currentSystemPrompt !== owner.system || messages.length !== original.length || original.some((v,i)=>messages[i] !== v.message || messages[i].content !== v.content))) throw new DOMException('履歴の対象が変更されました。','AbortError');
        result.forEach((patch,i)=>{if(patch && messages[i]?.continuation === continuations[i])Object.assign(continuations[i],patch);});
    }
    function createMethods({ state, dbUtils, uiUtils, defaults, localUiKeys = [] }) {
        let globalSaveQueue = Promise.resolve();
        const capabilityRequests = new Map();
        const geminiConnections = new Map();
        const geminiBase = config => (config.baseUrl || GEMINI_MODELS_BASE).replace(/\/$/, '');
        const geminiFingerprint = config => hashV136(JSON.stringify([geminiBase(config), config.apiKey]));
        function geminiRecord(config, modelName) {
            const fingerprint = geminiFingerprint(config);
            let connection = geminiConnections.get(config.id);
            if (connection?.fingerprint !== fingerprint) {
                connection = { fingerprint, models: new Map() };
                geminiConnections.set(config.id, connection);
            }
            const id = geminiModelId(modelName);
            if (!connection.models.has(id)) connection.models.set(id, { accepted: new Set(), rejected: new Set() });
            return connection.models.get(id);
        }
        const importedBackgrounds = new WeakMap();
        const profileReads = new Map();
        const notify = (type, detail = {}) => root.dispatchEvent?.(new CustomEvent('execution-settings-changed', { detail: { type, ...detail } }));
        const transaction = (stores, write, signal) => new Promise((resolve, reject) => {
            signal?.throwIfAborted();
            const tx = state.db.transaction(stores, 'readwrite');
            const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
            const cleanup = () => signal?.removeEventListener('abort', abort);
            tx.oncomplete = () => { cleanup(); resolve(); };
            tx.onabort = () => { cleanup(); reject(signal?.reason || tx.error || new Error('保存が中断されました。')); };
            signal?.addEventListener('abort', abort, { once: true });
            try { write(tx); } catch (error) { tx.abort(); reject(error); }
        });
        return {
            async loadSettingsV136() {
                const [global, success, version, removed] = await Promise.all([GLOBAL_KEY, SUCCESS_KEY, MIGRATION_KEY, REMOVED_MODELS_KEY].map(k => dbUtils.getSetting(k)));
                if (version?.value > 136) throw new Error('保存データは新しいアプリで開いてください。');
                state.settingsSchemaVersion = version?.value || 0;
                state.globalSettingsV136 = migrateChatTitlePrompt(global?.value) || null;
                state.lastSuccessfulExecution = success?.value || null;
                state.removedApiModelRefsV136 = removed?.value || [];
                state.modelMetadataV136 = {};
                state.modelMetadataStatusV136 = {};
                state.modelMetadataSourcesV136 = {};
                this.ensureGlobalSettingsChannelV136();
                this.ensureProfileSettingsChannelV136();
            },
            async ensureSettingsMigrationV136() {
                // These stores are locked together across connections/tabs. Read the
                // marker and migration inputs here, never publish a pre-lock snapshot.
                const activeId = state.activeProfileId;
                let committed;
                await transaction(['settings', 'profiles', 'chats', 'image_store'], tx => {
                    const store = tx.objectStore('settings'), settingsRequest = store.getAll();
                    settingsRequest.onsuccess = () => {
                        try {
                            const legacy = Object.fromEntries(settingsRequest.result.map(s => [s.key, s.value]));
                            if (legacy[MIGRATION_KEY] > 136) { tx.abort(); return; }
                            const profilesRequest = tx.objectStore('profiles').getAll();
                            profilesRequest.onsuccess = () => {
                                try {
                                    const currentProfiles = profilesRequest.result;
                                    if (legacy[MIGRATION_KEY] === 136) {
                                        const stored = legacy[GLOBAL_KEY];
                                        const migrated = migrateChatTitlePrompt(stored);
                                        if (migrated !== stored) {
                                            migrated.revision = (stored.revision || 0) + 1;
                                            legacy[GLOBAL_KEY] = migrated;
                                            store.put({ key: GLOBAL_KEY, value: migrated });
                                        }
                                        committed = { legacy, profiles: currentProfiles };
                                        return;
                                    }
                                    const originalProfiles = structuredClone(currentProfiles);
                                    const migratedApi = this.convertLegacyApiSettingsV136?.(legacy, currentProfiles, activeId);
                                    const active = migratedApi?.active || currentProfiles.find(p => p.id === activeId)?.settings || {};
                                    const local = { ...state.localUiSettings, ...legacy.localUiSettings };
                                    localUiKeys.forEach(key => {
                                        if (Object.prototype.hasOwnProperty.call(legacy.localUiSettings || {}, key)) return;
                                        if (Object.prototype.hasOwnProperty.call(active, key)) local[key] = active[key];
                                        else if (Object.prototype.hasOwnProperty.call(legacy, key)) local[key] = legacy[key];
                                    });
                                    const configs = structuredClone(migratedApi?.configs || legacy.apiConfigs || []);
                                    const recoverProfiles = Array.isArray(legacy.apiConfigs) && !legacy.apiConfigs.length ? [] : currentProfiles;
                                    const deleted = new Set(legacy.apiConfigDeletedIdsV1318 || []);
                                    for (const profile of recoverProfiles) for (const [provider, key] of [['gemini','apiKey'],['openrouter','openrouterApiKey'],['zai','zaiApiKey'],['bedrock','bedrockAccessKey']]) {
                                        const settings = profile.settings || {};
                                        const id = `api_legacy_profile_${profile.id}_${provider}`;
                                        if (!settings[key] || deleted.has(id) || deleted.has(this.getLegacyApiConfigIdForProvider(provider)) ||
                                            configs.some(c => c.id === id || (c.provider === provider && (c.apiKey || c.bedrockAccessKey) === settings[key]
                                            && (provider !== 'bedrock' || c.bedrockSecretKey === settings.bedrockSecretKey)))) continue;
                                        const recovered = this.createLegacyApiConfig(provider, settings);
                                        recovered.id = id;
                                        recovered.name = `${profile.name} / ${this.getProviderDisplayName(provider)} (旧設定)`;
                                        configs.push(recovered);
                                    }
                                    const global = migrateChatTitlePrompt({ ...pick(defaults, globalKeys), ...pick(legacy, globalKeys), ...pick(active, globalKeys),
                                        ...pick(legacy[GLOBAL_KEY] || {}, globalKeys), schemaVersion: 1 });
                                    global.showThoughtProcess ??= active.includeThoughts ?? legacy.includeThoughts ?? defaults.includeThoughts;
                                    global.theme ||= { ...pick(defaults, themeKeys), ...pick(legacy.globalThemeSettings || active, themeKeys) };
                                    global.appearance ||= { overlayOpacity: active.overlayOpacity ?? legacy.overlayOpacity ?? defaults.overlayOpacity,
                                        messageOpacity: active.messageOpacity ?? legacy.messageOpacity ?? defaults.messageOpacity, backgroundAssetId: null };
                                    const legacyRef = this.resolveLegacyInitialModelRef(active, legacy, configs);
                                    const profiles = currentProfiles.map(p => ({ ...p, settings: profileSettings(p.settings, (legacy.themeSettingsProfileScoped ?? state.themeSettingsProfileScoped) === true) }));
                                    const oldBlob = legacy.backgroundImageBlob instanceof Blob ? legacy.backgroundImageBlob : state.settings.backgroundImageBlob;
                                    const backgroundId = !global.appearance.backgroundAssetId && oldBlob instanceof Blob ? `background_${crypto.randomUUID()}` : null;
                                    if (backgroundId) global.appearance.backgroundAssetId = backgroundId;
                                    const backup = originalProfiles.map(p => ({ profileId: p.id, settings: pick(p.settings,
                                        [...globalKeys.filter(k => !/key|password|user/i.test(k)), ...themeKeys, 'modelName', 'apiProvider', 'defaultModelRef', 'thinkingBudget', 'includeThoughts']) }));
                                    const localUiSettings = this.normalizeLocalUiSettings(local);
                                    if (!legacy[BACKUP_KEY]) store.put({ key: BACKUP_KEY, value: backup });
                                    for (const [key, value] of [[GLOBAL_KEY, global], ['apiConfigs', configs], ['localUiSettings', localUiSettings],
                                        ['legacyInitialModelRefV136', legacyRef], ['apiConfigsMigratedV1310', true],
                                        ['apiModelRefsMigratedV1312', true], ['apiModelCandidatesStabilizedV1317', true], [MIGRATION_KEY, 136]]) store.put({ key, value });
                                    profiles.forEach(p => tx.objectStore('profiles').put(p));
                                    if (backgroundId) tx.objectStore('image_store').put({ id: backgroundId, blob: oldBlob, createdAt: Date.now() });
                                    const chats = tx.objectStore('chats').openCursor();
                                    chats.onsuccess = () => {
                                        try {
                                            const cursor = chats.result;
                                            if (!cursor) return;
                                            const chat = cursor.value;
                                            if (!chat.executionSettings) {
                                                const meta = [...(chat.messages || [])].reverse().find(m => m.role === 'model' && (!m.isCascaded || m.isSelected) && m.usageMetadata?.tmExecution?.modelName)?.usageMetadata.tmExecution;
                                                chat.executionSettings = { schemaVersion: 1, modelRef: modelRef(meta) || modelRef(chat.defaultModelRef) || legacyRef, thinkingEffort: null, updatedAt: Date.now() };
                                                Object.assign(chat, nextChatContentVersion(chat));
                                                cursor.update(chat);
                                            }
                                            cursor.continue();
                                        } catch { tx.abort(); }
                                    };
                                    committed = { legacy: { ...legacy, [GLOBAL_KEY]: global, apiConfigs: configs, localUiSettings, legacyInitialModelRefV136: legacyRef }, profiles };
                                } catch { tx.abort(); }
                            };
                        } catch { tx.abort(); }
                    };
                });
                const { legacy, profiles } = committed;
                state.profiles = profiles;
                state.activeProfile = profiles.find(p => p.id === state.activeProfileId) || null;
                state.apiConfigs = legacy.apiConfigs || [];
                state.settings.apiConfigs = state.apiConfigs;
                state.localUiSettings = this.normalizeLocalUiSettings(legacy.localUiSettings || {});
                state.localUiSettingsStoredKeys = new Set(localUiKeys);
                state.globalSettingsV136 = legacy[GLOBAL_KEY];
                state.legacyInitialModelRefV136 = legacy.legacyInitialModelRefV136;
                state.apiConfigsMigratedV1310 = true;
                state.settings.apiConfigsMigratedV1310 = true;
                state.settingsSchemaVersion = 136;
                state.settingsScopeMigrationComplete = true;
            },
            applyGlobalSettingsV136() {
                if (!state.globalSettingsV136) return;
                Object.assign(state.settings, chatTitleDefaults, { enableStreamingOutput: false }, pick(state.globalSettingsV136, globalKeys));
                state.settings.includeThoughts = state.globalSettingsV136.showThoughtProcess === true;
                this.applyProfileAppearanceV136();
            },
            applyProfileAppearanceV136() {
                const p = state.activeProfile?.settings || {};
                const g = state.globalSettingsV136;
                if (!g) return;
                state.themeSettingsProfileScoped = p.useCustomTheme === true;
                state.settings.themeSettingsProfileScoped = state.themeSettingsProfileScoped;
                Object.assign(state.settings, pick(g.theme ?? {}, themeKeys), p.useCustomTheme ? pick(p.theme ?? {}, themeKeys) : {},
                    g.appearance, p.useCustomAppearance ? p.appearance : {});
                document.documentElement.style.setProperty('--message-bubble-opacity', String(state.settings.messageOpacity));
                uiUtils.applyOverlayOpacity();
                uiUtils.applyDarkMode();
                uiUtils.applyThemeColorSettings();
                const id = state.settings.backgroundAssetId;
                const generation = (state.appearanceLoadGeneration || 0) + 1;
                state.appearanceLoadGeneration = generation;
                if (state.appliedBackgroundAssetIdV136 === id) return;
                if (!id) { state.appliedBackgroundAssetIdV136 = id; state.settings.backgroundImageBlob = null; uiUtils.applyBackgroundImage(); return; }
                const req = state.db.transaction('image_store').objectStore('image_store').get(id);
                req.onsuccess = () => {
                    if (state.appearanceLoadGeneration !== generation) return;
                    state.appliedBackgroundAssetIdV136 = id;
                    state.settings.backgroundImageBlob = req.result?.blob || null;
                    uiUtils.applyBackgroundImage();
                };
            },
            ensureGlobalSettingsChannelV136() {
                if (state.globalSettingsChannelV136 || !root.BroadcastChannel) return;
                const channel = new root.BroadcastChannel('chatai-global-settings-v136');
                state.globalSettingsChannelV136 = channel;
                channel.onmessage = event => {
                    const data = event.data;
                    if (data?.apiModelDraftReply) return;
                    if (data?.apiModelDraftQuery) {
                        if (data.database !== state.db.name || !Array.isArray(data.removed)) return;
                        const current = !state.currentChatId && this.getCurrentChatModelRef();
                        const draft = this.readExecutionDraft()?.modelRef;
                        const refs = data.removed.filter(ref => matchesRemovedModel(ref, [current || {}, draft || {}]));
                        if (refs.length) channel.postMessage({ apiModelDraftReply: data.apiModelDraftQuery, refs });
                        return;
                    }
                    const reload = event.data?.apiModelsChanged && event.data.database === state.db.name
                        ? this.reloadAfterApiModelEditV136() : this.reloadGlobalSettingsV136();
                    reload.catch(() => {});
                };
            },
            async reloadGlobalSettingsV136() {
                const latest = (await dbUtils.getSetting(GLOBAL_KEY))?.value;
                if (latest && (latest.revision || 0) >= (state.globalSettingsV136?.revision || 0)) {
                    state.globalSettingsV136 = migrateChatTitlePrompt(latest);
                    this.applyGlobalSettingsV136(); notify('global');
                }
            },
            async saveGlobalSettingsV136(updates, signal) {
                const changes = pick(updates, globalKeys);
                for (const [refKey, legacyKey] of Object.entries(auxiliaryLegacyModelKeys)) {
                    if (changes[refKey] === null && !Object.hasOwn(changes, legacyKey)) changes[legacyKey] = '';
                }
                for (const kind of ['theme', 'appearance']) if (changes[kind])
                    changes[kind] = pick(changes[kind], kind === 'theme' ? themeKeys : appearanceKeys);
                const save = async () => {
                    let next;
                    // IndexedDB serializes readwrite transactions across tabs. Last committed
                    // field patch wins; untouched fields always come from the same transaction.
                    await transaction(changes.appearance?.backgroundAssetId ? ['settings', 'image_store'] : ['settings'], tx => {
                        const store = tx.objectStore('settings'), req = store.get(GLOBAL_KEY);
                        req.onsuccess = () => {
                            const current = req.result?.value || {};
                            next = migrateChatTitlePrompt({ ...current, ...changes, schemaVersion: 1, revision: (current.revision || 0) + 1 });
                            for (const kind of ['theme', 'appearance']) if (changes[kind])
                                next[kind] = { ...current[kind], ...changes[kind] };
                            const publish = () => {
                                store.put({ key: GLOBAL_KEY, value: next });
                                if (changes.theme) store.put({ key: 'globalThemeSettings', value: next.theme });
                            };
                            const saveValidated = () => {
                                if (changes.appearance?.backgroundAssetId) {
                                    const asset = tx.objectStore('image_store').get(changes.appearance.backgroundAssetId);
                                    asset.onsuccess = () => { if (asset.result?.blob) publish(); else tx.abort(); };
                                } else publish();
                            };
                            if (Object.keys(auxiliaryModelSelectIds).some(key => changes[key])) {
                                const removed = store.get(REMOVED_MODELS_KEY);
                                removed.onsuccess = () => {
                                    if (Object.keys(auxiliaryModelSelectIds).some(key => matchesRemovedModel(changes[key], removed.result?.value))) tx.abort();
                                    else saveValidated();
                                };
                            } else saveValidated();
                        };
                    }, signal);
                    state.globalSettingsV136 = next;
                    if (changes.theme) state.globalThemeSettings = { ...next.theme };
                    this.applyGlobalSettingsV136();
                    this.markAsDirtyAndSchedulePush('structural');
                    this.ensureGlobalSettingsChannelV136();
                    state.globalSettingsChannelV136?.postMessage({ revision: next.revision });
                    notify('global');
                };
                globalSaveQueue = globalSaveQueue.catch(() => {}).then(save);
                return globalSaveQueue;
            },
            getShowThoughtProcess() { return state.globalSettingsV136?.showThoughtProcess === true; },
            getGlobalAuxiliaryModelRefV136(refKey, global = state.globalSettingsV136 || state.settings, configs = state.apiConfigs) {
                const ref = global[refKey];
                if (ref === AUXILIARY_MODEL_NONE) return null;
                if (ref?.apiConfigId || ref?.modelName) {
                    const apiConfigId = String(ref.apiConfigId || '').trim();
                    const modelName = String(ref.modelName || '').trim();
                    return apiConfigId === AUXILIARY_MODEL_NONE || modelName === AUXILIARY_MODEL_NONE ? null : { apiConfigId, modelName };
                }
                // Older controls could store a plain model name alongside a null ModelRef.
                const name = global[auxiliaryLegacyModelKeys[refKey]];
                const modelName = typeof name === 'string' ? name.trim() : '';
                if (!modelName || modelName === AUXILIARY_MODEL_NONE) return null;
                const geminiOnly = refKey === 'sdQcModelRef' || refKey === 'sdPromptImproveModelRef';
                const choice = configs?.find(config => config.id !== AUXILIARY_MODEL_NONE && config.enabled !== false
                    && (!geminiOnly || config.provider === 'gemini') && this.getApiConfigModelCandidates(config).includes(modelName));
                return { apiConfigId: choice?.id || '', modelName };
            },
            async setShowThoughtProcess(value) {
                await this.saveGlobalSettingsV136({ showThoughtProcess: value === true });
                uiUtils.renderChatMessages();
            },
            getProfileAppearanceSettings() { return profileSettings(state.activeProfile?.settings); },
            ensureProfileSettingsChannelV136() {
                if (state.profileSettingsChannelV136 || !root.BroadcastChannel) return;
                const channel = new root.BroadcastChannel('chatai-profile-settings-v136');
                state.profileSettingsChannelV136 = channel;
                channel.onmessage = event => {
                    if (event.data?.database === state.db.name) this.reloadProfileSettingsV136(event.data.profileId).catch(() => {});
                };
            },
            async reloadProfileSettingsV136(profileId) {
                const generation = (profileReads.get(profileId) || 0) + 1;
                profileReads.set(profileId, generation);
                const latest = await dbUtils.getProfile(profileId);
                if (profileReads.get(profileId) !== generation) return latest;
                const focused = root.document?.activeElement;
                const editing = root.settingsUiV136?.editedProfileInputs?.get(focused) === profileId;
                const draft = editing ? { value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
                const index = state.profiles?.findIndex(p => p.id === profileId) ?? -1;
                if (latest) {
                    if (index >= 0) state.profiles[index] = latest;
                    else if (state.profiles) state.profiles.push(latest);
                } else if (index >= 0) state.profiles.splice(index, 1);
                if (state.activeProfileId === profileId) {
                    state.activeProfile = latest ? (index >= 0 ? state.profiles[index] : latest) : null;
                    if (latest) Object.assign(state.settings, pick(latest.settings, profileKeys));
                    this.applyProfileAppearanceV136();
                    uiUtils.applySettingsToUI?.();
                    if (latest) uiUtils.updateProfileCardUI?.();
                }
                notify('profile');
                if (draft && focused.isConnected && state.activeProfileId === profileId && root.document.activeElement === focused) {
                    focused.value = draft.value;
                    if (typeof draft.start === 'number') focused.setSelectionRange(draft.start, draft.end);
                }
                return latest;
            },
            async mutateProfileV136(profileId, mutate, signal, { preserveStoredSettings = false } = {}) {
                if (profileId == null) throw new Error('保存対象のプロファイルがありません。');
                let missing = false;
                await transaction(['profiles', 'settings', 'image_store'], tx => {
                    const profiles = tx.objectStore('profiles'), profileRequest = profiles.get(profileId);
                    const globalRequest = tx.objectStore('settings').get(GLOBAL_KEY);
                    const versionRequest = tx.objectStore('settings').get(MIGRATION_KEY);
                    let remaining = 3;
                    const update = () => {
                        if (--remaining) return;
                        try {
                            if (!profileRequest.result) { missing = true; tx.abort(); return; }
                            const previousBackgroundId = profileRequest.result.settings?.appearance?.backgroundAssetId;
                            const next = mutate(profileRequest.result, globalRequest.result?.value || {});
                            if (!next || next.id !== profileId || typeof next.then === 'function') { tx.abort(); return; }
                            if (versionRequest.result?.value === 136 && !preserveStoredSettings) next.settings = profileSettings(next.settings);
                            const backgroundId = next.settings?.appearance?.backgroundAssetId;
                            if (backgroundId && backgroundId !== previousBackgroundId) {
                                const asset = tx.objectStore('image_store').get(backgroundId);
                                asset.onsuccess = () => { if (asset.result?.blob) profiles.put(next); else tx.abort(); };
                            } else profiles.put(next);
                        } catch { tx.abort(); }
                    };
                    profileRequest.onsuccess = globalRequest.onsuccess = versionRequest.onsuccess = update;
                }, signal).catch(async error => { if (missing) { await this.reloadProfileSettingsV136(profileId); throw new Error('保存対象のプロファイルは削除されています。'); } throw error; });
                const latest = await this.reloadProfileSettingsV136(profileId);
                this.ensureProfileSettingsChannelV136();
                state.profileSettingsChannelV136?.postMessage({ database: state.db.name, profileId });
                this.markAsDirtyAndSchedulePush('structural');
                return latest;
            },
            async patchProfileSettingsV136(profileId, updates, signal) {
                const changes = pick(updates, profileKeys);
                return this.mutateProfileV136(profileId, profile => {
                    const settings = { ...profile.settings, ...changes };
                    for (const kind of ['theme', 'appearance']) if (changes[kind])
                        settings[kind] = { ...profile.settings?.[kind], ...pick(changes[kind], kind === 'theme' ? themeKeys : appearanceKeys) };
                    return { ...profile, settings };
                }, signal);
            },
            async setProfileOverride(kind, enabled, profileId = state.activeProfileId) {
                if (!['theme', 'appearance'].includes(kind)) return;
                const key = kind === 'theme' ? 'useCustomTheme' : 'useCustomAppearance';
                await this.mutateProfileV136(profileId, (profile, global) => {
                    const settings = { ...profile.settings, [key]: enabled === true };
                    if (enabled && (!settings[kind] || !Object.keys(settings[kind]).length)) settings[kind] = structuredClone(global[kind] || {});
                    return { ...profile, settings };
                });
                notify(kind);
            },
            captureAppearanceTargetV136(kind, options = {}) {
                if (options.scope === 'global' || options.global === true) return { scope: 'global', global: true };
                if (options.scope === 'profile') return { scope: 'profile', global: false, profileId: options.profileId };
                const profileId = options.profileId ?? state.activeProfileId;
                const profile = state.activeProfile?.id === profileId ? state.activeProfile : state.profiles?.find(p => p.id === profileId);
                if (profileId != null && !profile) throw new Error('保存対象のプロファイルは削除されています。');
                const own = kind === 'theme' ? profile?.settings?.useCustomTheme : profile?.settings?.useCustomAppearance;
                return own ? { scope: 'profile', global: false, profileId } : { scope: 'global', global: true };
            },
            async saveAppearanceValues(kind, updates, options = {}) {
                const target = this.captureAppearanceTargetV136(kind, options);
                const changes = pick(updates, kind === 'theme' ? themeKeys : appearanceKeys);
                if (target.scope === 'profile') await this.patchProfileSettingsV136(target.profileId, { [kind]: changes }, options.signal);
                else await this.saveGlobalSettingsV136({ [kind]: changes }, options.signal);
                notify(kind);
            },
            async saveBackgroundBlobV136(blob, options = {}) {
                const target = this.captureAppearanceTargetV136('appearance', options);
                return this.saveBackgroundToTargetV136(blob, target);
            },
            async saveBackgroundToTargetV136(blob, target) {
                const id = blob ? `background_${crypto.randomUUID()}` : null;
                let nextGlobal, missing = false;
                // Blob + its only new reference commit together. Cleanup shares
                // these write locks, so it can observe neither half of the save.
                await transaction(['image_store', 'profiles', 'settings'], tx => {
                    const store = tx.objectStore(target.scope === 'profile' ? 'profiles' : 'settings');
                    const request = store.get(target.scope === 'profile' ? target.profileId : GLOBAL_KEY);
                    request.onsuccess = () => {
                        try {
                            if (target.scope === 'profile' && !request.result) { missing = true; tx.abort(); return; }
                            if (id) tx.objectStore('image_store').put({ id, blob, createdAt: Date.now() });
                            if (target.scope === 'profile') {
                                const profile = request.result;
                                store.put({ ...profile, settings: { ...profile.settings,
                                    appearance: { ...profile.settings?.appearance, backgroundAssetId: id } } });
                            } else {
                                const current = request.result?.value || {};
                                nextGlobal = { ...current, schemaVersion: 1, revision: (current.revision || 0) + 1,
                                    appearance: { ...current.appearance, backgroundAssetId: id } };
                                store.put({ key: GLOBAL_KEY, value: nextGlobal });
                            }
                        } catch { tx.abort(); }
                    };
                }).catch(async error => { if (missing) { await this.reloadProfileSettingsV136(target.profileId); throw new Error('背景の保存対象プロファイルは削除されています。'); } throw error; });
                if (target.scope === 'profile') {
                    await this.reloadProfileSettingsV136(target.profileId);
                    this.ensureProfileSettingsChannelV136();
                    state.profileSettingsChannelV136?.postMessage({ database: state.db.name, profileId: target.profileId });
                } else {
                    await this.reloadGlobalSettingsV136();
                    this.ensureGlobalSettingsChannelV136();
                    state.globalSettingsChannelV136?.postMessage({ revision: nextGlobal.revision });
                }
                this.markAsDirtyAndSchedulePush('structural');
                await this.cleanupBackgroundAssetsV136();
                notify('appearance');
                return target;
            },
            async cleanupBackgroundAssetsV136() {
                // Every source of references and the deletion decision belong to
                // the same snapshot/transaction; no network or external await here.
                await transaction(['settings', 'profiles', 'chats', 'image_assets', 'image_store'], tx => {
                    const requests = [tx.objectStore('settings').get(GLOBAL_KEY), tx.objectStore('profiles').getAll(),
                        tx.objectStore('chats').getAll(), tx.objectStore('image_assets').getAll(), tx.objectStore('image_store').getAllKeys()];
                    let remaining = requests.length;
                    requests.forEach(request => request.onsuccess = () => {
                        if (--remaining) return;
                        try {
                            const ids = new Set(requests[1].result.map(p => p.settings?.appearance?.backgroundAssetId).filter(Boolean));
                            const globalId = requests[0].result?.value?.appearance?.backgroundAssetId;
                            if (globalId) ids.add(globalId);
                            requests[3].result.forEach(a => { if (a.assetId) ids.add(a.assetId); });
                            for (const chat of requests[2].result) for (const m of chat.messages || []) {
                                (m.imageIds || []).forEach(id => ids.add(id));
                                (m.attachments || []).forEach(a => { if (a.assetId) ids.add(a.assetId); });
                            }
                            requests[4].result.forEach(id => { if (String(id).startsWith('background_') && !ids.has(id)) tx.objectStore('image_store').delete(id); });
                        } catch { tx.abort(); }
                    });
                });
            },
            async createProfileExportV136(profile) {
                const result = { profileSchemaVersion: 1, name: profile.name, createdAt: profile.createdAt,
                    settings: profileSettings(profile.settings), icon: null };
                if (profile.icon instanceof Blob) result.icon = { mimeType: profile.icon.type, data: await this.fileToBase64(profile.icon) };
                const id = result.settings.appearance?.backgroundAssetId;
                if (id) {
                    const asset = await new Promise((resolve, reject) => {
                        const req = state.db.transaction('image_store').objectStore('image_store').get(id);
                        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
                    });
                    if (!asset?.blob) throw new Error('プロファイルの背景画像が見つかりません。');
                    result.backgroundAsset = { mimeType: asset.blob.type, data: await this.fileToBase64(asset.blob) };
                }
                return result;
            },
            async parseProfileImportV136(source) {
                if (source.profileSchemaVersion > 1) throw new Error('新しいバージョンのプロファイルは読み込めません。');
                const result = { name: source.name, createdAt: Date.now(), icon: source.icon,
                    settings: profileSettings(source.settings, source.settings?.themeSettingsProfileScoped === true) };
                if (source.backgroundAsset?.data) {
                    const blob = await this.base64ToBlob(source.backgroundAsset.data, source.backgroundAsset.mimeType);
                    const id = `background_${crypto.randomUUID()}`;
                    importedBackgrounds.set(result, { id, blob });
                    result.settings.appearance = { ...result.settings.appearance, backgroundAssetId: id };
                } else if (result.settings.appearance?.backgroundAssetId) {
                    throw new Error('プロファイルの背景画像データがありません。');
                }
                return result;
            },
            async addImportedProfileV136(profile) {
                const id = await dbUtils.addProfile(profile, {
                    importedBackground: importedBackgrounds.get(profile),
                    renameOnConflict: true
                });
                importedBackgrounds.delete(profile);
                return id;
            },
            isAppearanceTargetActiveV136(target) {
                return target.scope === 'profile'
                    ? target.profileId === state.activeProfileId && state.activeProfile?.settings?.useCustomAppearance === true
                    : !state.activeProfile?.settings?.useCustomAppearance;
            },
            getModelMetadataV136(ref) {
                const config = this.getApiConfigById(ref?.apiConfigId);
                const source = state.modelMetadataSourcesV136?.[ref?.apiConfigId];
                if (source && (config?.provider !== 'openrouter' || config.enabled === false
                    || source.base !== (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
                    || source.apiKey !== config.apiKey)) return undefined;
                return state.modelMetadataV136?.[ref?.apiConfigId]?.[ref?.modelName];
            },
            getModelThinkingCapability(ref = this.getCurrentChatModelRef()) {
                const config = this.getApiConfigById(ref?.apiConfigId);
                if (config?.provider === 'gemini') {
                    const record = geminiRecord(config, ref.modelName);
                    return capability('gemini', ref.modelName, { ...record.metadata,
                        acceptedLevels: [...record.accepted], rejectedLevels: [...record.rejected],
                        configRejected: record.configRejected });
                }
                const metadata = this.getModelMetadataV136(ref);
                const noReasoningInfo = metadata && metadata.reasoning === undefined
                    && (!Array.isArray(metadata.supportedParameters) || metadata.supportedParameters.some(p => p === 'reasoning' || p === 'reasoning.effort'));
                if (config?.provider === 'openrouter' && (!metadata || noReasoningInfo)) {
                    const status = state.modelMetadataStatusV136?.[ref?.apiConfigId] || 'pending';
                    return cap('unknown', [], null, { status: status === 'ready' ? 'missing' : status });
                }
                return capability(config?.provider, ref?.modelName, metadata);
            },
            ensureGeminiThinkingCapabilities(ref) {
                const config = this.getApiConfigById(ref?.apiConfigId);
                if (config?.provider !== 'gemini' || config.enabled === false || !config.apiKey) return;
                const model = geminiModelId(ref.modelName);
                if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model)) return;
                let url;
                try {
                    url = new URL(geminiBase(config) + '/' + encodeURIComponent(model));
                    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
                } catch { return; }
                const record = geminiRecord(config, model);
                if (record.pending || record.refreshAfter > Date.now()) return record.pending;
                const apiConfigId = config.id;
                const current = () => {
                    const latest = this.getApiConfigById(apiConfigId);
                    return latest?.provider === 'gemini' && latest.enabled !== false && geminiRecord(latest, model) === record;
                };
                record.pending = Promise.resolve().then(async () => {
                    try {
                        if (!current()) return;
                        const response = await fetch(url, {
                            headers: { 'x-goog-api-key': config.apiKey }, cache: 'no-store',
                            redirect: 'error', signal: AbortSignal.timeout(5000)
                        });
                        if (!response.ok) throw new Error('Models API request failed');
                        const data = await response.json();
                        if (!data || typeof data.name !== 'string') throw new Error('Invalid Models API response');
                        if (!current()) return;
                        record.metadata = {
                            thinking: typeof data.thinking === 'boolean' ? data.thinking : undefined,
                            baseModelId: typeof data.baseModelId === 'string' ? data.baseModelId : undefined,
                            supportedGenerationMethods: Array.isArray(data.supportedGenerationMethods) ? data.supportedGenerationMethods : undefined
                        };
                        record.refreshAfter = Date.now() + 15 * 60 * 1000;
                        notify('capabilities', { apiConfigId, modelName: ref.modelName });
                    } catch {
                        record.refreshAfter = Date.now() + 20 * 1000;
                    } finally { record.pending = null; }
                });
                return record.pending;
            },
            recordGeminiThinkingResult(config, level, rejection = null) {
                if (!config?.ref || config.provider !== 'gemini') return;
                const { apiConfigId, modelName } = config.ref;
                const latest = this.getApiConfigById(apiConfigId);
                if (latest?.provider !== 'gemini' || latest.enabled === false || geminiFingerprint(latest) !== geminiFingerprint(config)) return;
                const record = geminiRecord(latest, modelName);
                if (rejection === 'config') {
                    if (record.configRejected) return;
                    record.configRejected = true;
                } else {
                    const value = level?.toLowerCase();
                    if (!['minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)) return;
                    const target = rejection === 'level' ? record.rejected : record.accepted;
                    if (target.has(value) && (rejection || !record.configRejected)) return;
                    const previous = rejection === 'level' ? record.accepted : record.rejected;
                    previous.delete(value);
                    target.add(value);
                    if (!rejection) record.configRejected = false;
                }
                notify('capabilities', { apiConfigId, modelName });
            },
            async refreshModelThinkingCapabilities(apiConfigId) {
                const config = this.getApiConfigById(apiConfigId);
                if (config?.provider !== 'openrouter') return;
                const base = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
                const pending = capabilityRequests.get(apiConfigId);
                if (pending?.base === base && pending.key === config.apiKey) return pending.promise;
                const job = { base, key: config.apiKey };
                const ownsRequest = () => capabilityRequests.get(apiConfigId) === job;
                const current = () => {
                    const latest = this.getApiConfigById(apiConfigId);
                    return ownsRequest() && latest?.provider === 'openrouter' && latest.enabled !== false
                        && (latest.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '') === base && latest.apiKey === config.apiKey;
                };
                capabilityRequests.set(apiConfigId, job);
                job.promise = (async () => {
                    state.modelMetadataStatusV136 ||= {};
                    state.modelMetadataStatusV136[apiConfigId] = 'pending';
                    try {
                        const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000),
                            headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} });
                        if (!response.ok) throw new Error('モデルの対応情報を取得できませんでした。');
                        const data = await response.json();
                        if (!Array.isArray(data.data)) throw new Error('モデルの対応情報の形式を確認できませんでした。');
                        if (!current()) return;
                        state.modelMetadataV136 ||= {};
                        state.modelMetadataV136[apiConfigId] = Object.fromEntries(data.data.filter(m => typeof m.id === 'string').map(m => [m.id, {
                            reasoning: m.reasoning, inputModalities: m.architecture?.input_modalities,
                            supportedParameters: m.supported_parameters
                        }]));
                        state.modelMetadataSourcesV136 ||= {};
                        state.modelMetadataSourcesV136[apiConfigId] = { base, apiKey: config.apiKey };
                        state.modelMetadataStatusV136[apiConfigId] = data.data.length ? 'ready' : 'missing';
                        notify('capabilities', { apiConfigId });
                    } catch (error) {
                        if (current()) { state.modelMetadataStatusV136[apiConfigId] = 'failed'; notify('capabilities', { apiConfigId }); }
                        throw error;
                    } finally { if (ownsRequest()) capabilityRequests.delete(apiConfigId); }
                })();
                return job.promise;
            },
            ensureModelThinkingCapabilities(ref = this.getCurrentChatModelRef()) {
                const config = this.getApiConfigById(ref?.apiConfigId);
                if (config?.provider === 'gemini') {
                    void this.ensureGeminiThinkingCapabilities(ref);
                    return;
                }
                if (config?.provider !== 'openrouter' || config.enabled === false
                    || this.getModelThinkingCapability(ref).mode !== 'unknown') return;
                return this.refreshModelThinkingCapabilities(ref.apiConfigId).catch(() => { /* Keep unverified capabilities unknown. */ });
            },
            getCurrentChatModelRef() {
                const ref = modelRef(state.currentExecutionSettings?.modelRef);
                return this.isUnavailableExecutionSelection(ref) ? null : ref;
            },
            getCurrentChatThinkingEffort() {
                return this.getCurrentChatModelRef() ? state.currentExecutionSettings?.thinkingEffort ?? null : null;
            },
            syncChatExecutionToLegacySettings() {
                const ref = this.getCurrentChatModelRef();
                if (!ref) {
                    state.settings.defaultModelRef = null;
                    state.settings.apiConfigId = '';
                    state.settings.apiProvider = '';
                    state.settings.modelName = '';
                    return;
                }
                state.settings.defaultModelRef = ref;
                state.settings.apiConfigId = ref.apiConfigId;
                state.settings.modelName = ref.modelName;
                state.settings.apiProvider = this.getApiConfigById(ref.apiConfigId)?.provider || '';
            },
            readExecutionDraft() {
                try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
            },
            persistExecutionDraft() {
                // sessionStorage is isolated per browsing context, including independent duplicated tabs.
                sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state.currentExecutionSettings));
            },
            async initializeNewChatExecution({ restoreDraft = false } = {}) {
                const generation = (state.executionInitGeneration || 0) + 1;
                state.executionInitGeneration = generation;
                state.executionInitializingV136 = true;
                notify('chat');
                const [successEntry, legacyEntry, configs, removed] = await Promise.all(
                    [SUCCESS_KEY, 'legacyInitialModelRefV136', 'apiConfigs', REMOVED_MODELS_KEY].map(key => dbUtils.getSetting(key)));
                if (generation !== state.executionInitGeneration || state.currentChatId) return;
                const success = successEntry?.value;
                const legacy = legacyEntry?.value;
                state.lastSuccessfulExecution = success || null;
                state.legacyInitialModelRefV136 = legacy || null;
                if (configs) state.apiConfigs = state.settings.apiConfigs = this.normalizeApiConfigs(configs.value);
                state.removedApiModelRefsV136 = removed?.value || [];
                const candidates = [success?.modelRef, legacy];
                const fallback = candidates.find(ref => ref && this.validateModelRefForUsage(ref).valid) || null;
                const draft = restoreDraft ? this.clearUnavailableExecutionSelectionV136(this.readExecutionDraft()) : null;
                const source = draft || (success && modelRef(success.modelRef) && JSON.stringify(success.modelRef) === JSON.stringify(modelRef(fallback)) ? success : null);
                state.currentExecutionSettings = executionSettings(source, fallback, ref => this.getModelThinkingCapability(ref));
                state.executionInitializingV136 = false;
                this.syncChatExecutionToLegacySettings(); this.persistExecutionDraft();
                uiUtils.applySettingsToUI(); notify('chat');
                void this.ensureModelThinkingCapabilities();
            },
            async refreshExecutionApiConfigsV136() {
                const [stored, removed] = await Promise.all(['apiConfigs', REMOVED_MODELS_KEY].map(key => dbUtils.getSetting(key)));
                state.apiConfigs = this.normalizeApiConfigs(stored?.value || []);
                state.settings.apiConfigs = state.apiConfigs;
                state.removedApiModelRefsV136 = removed?.value || [];
                await this.syncRemovedExecutionSelectionV136();
                return this.ensureModelThinkingCapabilities(clearRemovedExecution(state.currentExecutionSettings, state.removedApiModelRefsV136)?.modelRef);
            },
            getLegacyChatExecutionV136(chat, fallbackRef) {
                const meta = [...(chat.messages || [])].reverse().find(m => m.role === 'model' && (!m.isCascaded || m.isSelected)
                    && m.usageMetadata?.tmExecution?.modelName)?.usageMetadata.tmExecution;
                return { schemaVersion: 1, modelRef: modelRef(meta) || modelRef(chat.defaultModelRef) || modelRef(chat)
                    || modelRef(fallbackRef), thinkingEffort: null, updatedAt: Date.now() };
            },
            getChatExecutionSettingsV136(chat) {
                if (chat.executionSettings?.schemaVersion > 1) throw new Error('新しいバージョンのチャット設定です。');
                const legacy = modelRef(state.legacyInitialModelRefV136);
                const execution = chat.executionSettings || this.getLegacyChatExecutionV136(chat,
                    legacy && this.validateModelRef(legacy).valid ? legacy : null);
                return structuredClone(this.clearUnavailableExecutionSelectionV136(execution));
            },
            clearUnavailableExecutionSelectionV136(execution) {
                const ref = execution?.modelRef;
                if (this.isUnavailableExecutionSelection(ref)) {
                    // Keep the stored chat execution record. This marker makes
                    // content saves preserve it until the user selects a model.
                    return { ...execution, modelRef: null, thinkingEffort: null, modelSelectionRequired: true };
                }
                return clearRemovedExecution(execution, state.removedApiModelRefsV136);
            },
            applyRemovedExecutionSelectionV136(storedExecution = null) {
                const draft = this.readExecutionDraft(), nextDraft = this.clearUnavailableExecutionSelectionV136(draft);
                if (nextDraft !== draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(nextDraft));
                if (state.isSending || state.currentExecutionApiConfig) return;
                const execution = state.currentExecutionSettings;
                const next = storedExecution?.modelSelectionRequired && !execution?.modelSelectionRequired
                    ? storedExecution : this.clearUnavailableExecutionSelectionV136(execution);
                if (next === execution) return;
                state.currentExecutionSettings = next;
                this.syncChatExecutionToLegacySettings();
                if (!state.currentChatId) this.persistExecutionDraft();
                uiUtils.applySettingsToUI(); notify('chat');
            },
            async syncRemovedExecutionSelectionV136() {
                const chatId = state.currentChatId;
                if (chatId && state.removedApiModelRefsV136?.length && !state.isSending) {
                    const execution = state.currentExecutionSettings;
                    const chat = await dbUtils.getChat(chatId);
                    if (state.currentChatId === chatId && state.currentExecutionSettings === execution)
                        this.applyRemovedExecutionSelectionV136(chat?.executionSettings);
                } else this.applyRemovedExecutionSelectionV136();
            },
            async reloadAfterApiModelEditV136() {
                const [configs, removed, success, legacy, profiles] = await Promise.all([
                    ...['apiConfigs', REMOVED_MODELS_KEY, SUCCESS_KEY, 'legacyInitialModelRefV136'].map(key => dbUtils.getSetting(key)),
                    dbUtils.getAllProfiles()
                ]);
                state.apiConfigs = state.settings.apiConfigs = this.normalizeApiConfigs(configs?.value || []);
                state.removedApiModelRefsV136 = removed?.value || [];
                state.lastSuccessfulExecution = success?.value || null;
                state.legacyInitialModelRefV136 = legacy?.value || null;
                state.profiles = profiles;
                state.activeProfile = profiles.find(profile => profile.id === state.activeProfileId) || null;
                await this.reloadGlobalSettingsV136();
                await this.syncRemovedExecutionSelectionV136();
                this.syncActiveApiConfigState();
                this.renderApiConfigList();
                uiUtils.updateUserModelOptions();
                void this.ensureGeminiThinkingCapabilities(this.getCurrentChatModelRef());
                root.settingsUiV136?.refresh();
            },
            async waitForGenerationCompletionV136(session = state.sendExecutionV136) {
                if (session?.finished) {
                    let timer;
                    try {
                        await Promise.race([session.finished, new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
                        return !state.sendJobsV136.has(session.messages);
                    } finally { clearTimeout(timer); }
                }
                const deadline = Date.now() + 10000;
                while (state.isSending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
                return !state.isSending;
            },
            async setCurrentChatExecution(updates, { validateThinkingEffort = false } = {}) {
                const contextId = state.currentChatId, contextGeneration = state.executionInitGeneration;
                const selection = (state.executionSelectionGenerationV136 || 0) + 1;
                state.executionSelectionGenerationV136 = selection;
                await state.executionSettingsReady;
                const assertContext = () => {
                    if (contextId !== state.currentChatId || contextGeneration !== state.executionInitGeneration || selection !== state.executionSelectionGenerationV136)
                        throw new Error('チャットまたは選択が変わったため、古い選択を適用しませんでした。');
                };
                assertContext();
                if (state.isSending || state.currentExecutionApiConfig) throw new Error('応答生成中はモデル・Thinkingを変更できません。');
                const current = state.currentExecutionSettings || {};
                const ref = modelRef(updates.modelRef || current.modelRef);
                this.assertModelRefForExecution(ref);
                const capabilityRequest = this.ensureModelThinkingCapabilities(ref);
                if (capabilityRequest) await capabilityRequest;
                if (state.isSending || state.currentExecutionApiConfig) throw new Error('応答生成中はモデル・Thinkingを変更できません。');
                const capability = this.getModelThinkingCapability(ref);
                const changingModel = ref.apiConfigId !== current.modelRef?.apiConfigId || ref.modelName !== current.modelRef?.modelName;
                const gemini = this.getApiConfigById(ref.apiConfigId)?.provider === 'gemini';
                if (gemini && validateThinkingEffort && !canSelectEffort(updates.thinkingEffort, capability))
                    throw new Error('このモデルでは利用できないThinkingレベルです。');
                const useDefault = gemini && changingModel && (capability.modelDefault || capability.preserveEffort || capability.mode === 'unknown');
                const desired = useDefault ? { ...current, thinkingEffort: null } : current;
                const next = executionSettings({ ...desired, ...updates, updatedAt: Date.now() }, ref, () => capability);
                assertContext();
                if (state.currentChatId) {
                    const id = state.currentChatId;
                    await transaction(['chats', 'settings'], tx => {
                        const removed = tx.objectStore('settings').get(REMOVED_MODELS_KEY);
                        removed.onsuccess = () => {
                            if (matchesRemovedModel(ref, removed.result?.value)) { tx.abort(); return; }
                            const store = tx.objectStore('chats'); const req = store.get(id);
                            req.onsuccess = () => { if (!req.result) { tx.abort(); return; } store.put({ ...req.result, executionSettings: next }); };
                        };
                    });
                } else {
                    const removed = await dbUtils.getSetting(REMOVED_MODELS_KEY);
                    assertContext();
                    if (state.isSending || state.currentExecutionApiConfig || matchesRemovedModel(ref, removed?.value))
                        throw new Error('選択したモデルを適用できません。設定を確認してください。');
                    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
                }
                if (contextId !== state.currentChatId || contextGeneration !== state.executionInitGeneration || selection !== state.executionSelectionGenerationV136) return next;
                state.currentExecutionSettings = next; this.syncChatExecutionToLegacySettings();
                this.markAsDirtyAndSchedulePush('structural'); notify('chat');
                uiUtils.applySettingsToUI(); return structuredClone(next);
            },
            setCurrentChatModelRef(ref) { return this.setCurrentChatExecution({ modelRef: ref }); },
            setCurrentChatThinkingEffort(value) {
                if (!canSelectEffort(value, this.getModelThinkingCapability())) throw new Error('このモデルでは利用できないThinkingレベルです。');
                return this.setCurrentChatExecution({ thinkingEffort: value }, { validateThinkingEffort: true });
            },
            freezeExecutionSettings() {
                this.applyRemovedExecutionSelectionV136();
                const config = structuredClone(this.resolveDefaultExecutionApiConfig());
                const c = this.getModelThinkingCapability(config.ref);
                if (config.provider === 'openrouter' && c.mode === 'unknown' && this.getCurrentChatThinkingEffort() != null)
                    throw new Error('Thinking能力を確認できません。設定は保持しています。接続を確認して再送信してください。');
                const selected = this.getCurrentChatThinkingEffort();
                if (c.rejectedLevels?.includes(selected)) throw new Error('選択したThinkingレベルはGemini APIで拒否されました。別のレベルかモデル既定を選んでください。');
                const useGeminiDefault = config.provider === 'gemini' && c.mode === 'level'
                    && (selected == null || selected === MODEL_DEFAULT_EFFORT);
                config.thinkingCapability = c;
                config.thinkingEffort = c.mode === 'unknown' || useGeminiDefault ? selected : normalizeEffort(selected, c);
                if (config.provider !== 'gemini' || (c.mode !== 'none' && !useGeminiDefault)) {
                    state.currentExecutionSettings = { ...state.currentExecutionSettings, thinkingEffort: config.thinkingEffort };
                }
                state.currentExecutionApiConfig = Object.freeze(config);
                return config;
            },
            applyExecutionThinking(body, provider, config = this.getExecutionApiConfig()) {
                const c = config?.thinkingCapability || capability(provider, config?.modelName || state.settings.modelName);
                return applyThinking(body, provider, c, config?.thinkingEffort);
            },
            completeExecutionMetadata(snapshot, message, { signal = state.abortController?.signal } = {}) {
                signal?.throwIfAborted();
                const actual = message?.usageMetadata?.tmActualExecution;
                const result = { ...snapshot, completedAt: Date.now() };
                if (actual?.modelName) result.modelName = actual.modelName;
                if (actual && actual.modelName !== snapshot.modelName) {
                    result.requestedModelName = snapshot.modelName;
                    result.thinkingEffort = null;
                }
                return result;
            },
            successfulExecutionRecord(message) {
                const meta = message?.usageMetadata?.tmExecution;
                if (!meta?.completedAt || message.role !== 'model' || message.error || (!message.content && !message.imageIds?.length && !message.generated_videos?.length)) return null;
                return { schemaVersion: 1, modelRef: modelRef(meta), thinkingEffort: meta.thinkingEffort ?? null, completedAt: meta.completedAt };
            },
            clearModelSettingsForRemovalV136(source, removed, configs, profileScoped = false) {
                const patch = {}, affected = [];
                const legacyRef = modelRef(source);
                const basicRef = modelRef(source?.defaultModelRef) || legacyRef;
                if (matchesRemovedModel(basicRef, removed)) {
                    patch.defaultModelRef = null;
                    affected.push({ key: 'defaultModelRef', modelName: basicRef.modelName });
                }
                if (matchesRemovedModel(legacyRef, removed)) patch.modelName = '';
                const legacyConfigs = profileScoped && source?.apiConfigId ? configs.filter(config => config.id === source.apiConfigId) : configs;
                for (const key of Object.keys(auxiliaryModelSelectIds)) {
                    const ref = this.getGlobalAuxiliaryModelRefV136(key, source || {}, legacyConfigs);
                    if (!matchesRemovedModel(ref, removed)) continue;
                    patch[key] = null;
                    if (auxiliaryLegacyModelKeys[key]) patch[auxiliaryLegacyModelKeys[key]] = '';
                    affected.push({ key, modelName: ref.modelName });
                }
                return { patch, affected };
            },
            removedApiModelsForEditV136(nextConfig, baseline) {
                const nextNames = this.getApiConfigModelCandidates(nextConfig);
                return (baseline ? this.getApiConfigModelCandidates(baseline) : [])
                    .filter(name => !nextNames.includes(name)).map(modelName => ({ apiConfigId: nextConfig.id, modelName }));
            },
            async inspectPeerApiModelDraftsV136(nextConfig, baseline) {
                const removed = this.removedApiModelsForEditV136(nextConfig, baseline);
                this.ensureGlobalSettingsChannelV136();
                const channel = state.globalSettingsChannelV136;
                if (!removed.length || !channel) return [];
                const id = root.crypto.randomUUID(), found = [];
                return new Promise(resolve => {
                    const onReply = ({ data }) => {
                        if (data?.apiModelDraftReply === id && Array.isArray(data.refs)) found.push(...data.refs.filter(ref => matchesRemovedModel(ref, removed)));
                    };
                    channel.addEventListener('message', onReply);
                    channel.postMessage({ apiModelDraftQuery: id, database: state.db.name, removed });
                    setTimeout(() => {
                        channel.removeEventListener('message', onReply);
                        resolve(removed.map(ref => ({ modelName: ref.modelName, count: found.filter(item => item.modelName === ref.modelName).length }))
                            .filter(item => item.count));
                    }, 180);
                });
            },
            async editApiConfigModelsV136(nextConfig, baseline, confirmedImpact = null, peerDrafts = []) {
                const id = nextConfig.id;
                const nextNames = this.getApiConfigModelCandidates(nextConfig);
                const removed = this.removedApiModelsForEditV136(nextConfig, baseline);
                const preview = confirmedImpact === null;
                const scopes = removed.length ? ['settings', 'profiles', 'chats'] : ['settings'];
                let result, failure;
                await transaction(scopes, tx => {
                    const settings = tx.objectStore('settings');
                    const requests = [settings.get('apiConfigs'), settings.get(REMOVED_MODELS_KEY)];
                    if (removed.length) requests.push(settings.get(GLOBAL_KEY), settings.get(SUCCESS_KEY),
                        settings.get('legacyInitialModelRefV136'), tx.objectStore('profiles').getAll(), tx.objectStore('chats').getAll());
                    let pending = requests.length;
                    requests.forEach(request => request.onsuccess = () => {
                        if (--pending) return;
                        try {
                            const [stored, removals, global, success, legacy, profiles, chats] = requests.map(item => item.result);
                            const configs = this.normalizeApiConfigs(stored?.value || []);
                            const current = configs.find(config => config.id === id);
                            const configSignature = config => config ? JSON.stringify({ ...config, updatedAt: undefined, createdAt: undefined }) : '';
                            if (configSignature(current) !== configSignature(baseline)) throw new Error('API設定が別の操作で変更されました。設定を開き直してください。');

                            const impact = [], writes = [];
                            const add = (modelName, key, scope, target = null, name = null) => impact.push({ modelName, key, scope, target, name });
                            const applySettings = (source, scope, target, name, write) => {
                                const { patch, affected } = this.clearModelSettingsForRemovalV136(source, removed, configs, scope === 'profile');
                                affected.forEach(item => add(item.modelName, item.key, scope, target, name));
                                if (Object.keys(patch).length) writes.push(() => write({ ...source, ...patch }));
                            };
                            if (removed.length) {
                                applySettings(global?.value, 'global', null, null, value => settings.put({ key: GLOBAL_KEY,
                                    value: { ...value, revision: (value.revision || 0) + 1 } }));
                                for (const profile of profiles) applySettings(profile.settings, 'profile', profile.id, profile.name,
                                    value => tx.objectStore('profiles').put({ ...profile, settings: value }));
                                for (const chat of chats) {
                                    const { patch } = this.clearModelSettingsForRemovalV136(pick(chat, ['defaultModelRef', 'apiConfigId', 'modelName']), removed, configs);
                                    const execution = chat.executionSettings || this.getLegacyChatExecutionV136(chat, legacy?.value);
                                    const next = clearRemovedExecution(execution, removed);
                                    if (next !== execution) {
                                        if (execution.schemaVersion > 1) throw new Error('新しいバージョンのチャット設定が含まれています。');
                                        patch.executionSettings = next;
                                        add(execution.modelRef.modelName, 'defaultModelRef', 'chat', chat.id);
                                    } else if (Object.keys(patch).length) {
                                        const ref = modelRef(chat.defaultModelRef) || modelRef(chat);
                                        if (matchesRemovedModel(ref, removed)) add(ref.modelName, 'defaultModelRef', 'chat', chat.id);
                                    }
                                    if (Object.keys(patch).length) writes.push(() => tx.objectStore('chats').put({ ...chat, ...patch }));
                                }
                                const currentRef = this.getCurrentChatModelRef();
                                if (matchesRemovedModel(currentRef, removed) && !impact.some(item => item.scope === 'chat'
                                    && item.target === state.currentChatId && item.modelName === currentRef.modelName)) {
                                    add(currentRef.modelName, 'defaultModelRef', state.currentChatId ? 'current' : 'draft', state.currentChatId);
                                }
                                const draftRef = this.readExecutionDraft()?.modelRef;
                                if (matchesRemovedModel(draftRef, removed) && !impact.some(item => item.scope === 'draft' && item.modelName === draftRef.modelName))
                                    add(draftRef.modelName, 'defaultModelRef', 'draft');
                                for (const draft of peerDrafts) add(draft.modelName, 'defaultModelRef', 'peerDraft', draft.count);
                                if (matchesRemovedModel(success?.value?.modelRef, removed)) {
                                    add(success.value.modelRef.modelName, 'defaultModelRef', 'newChatDefault');
                                    writes.push(() => settings.put({ key: SUCCESS_KEY, value: { ...success.value, modelRef: null } }));
                                }
                                if (matchesRemovedModel(legacy?.value, removed)) {
                                    add(legacy.value.modelName, 'defaultModelRef', 'newChatDefault');
                                    writes.push(() => settings.put({ key: 'legacyInitialModelRefV136', value: null }));
                                }
                            }
                            result = impact;
                            if (preview) return;
                            if (JSON.stringify(impact) !== JSON.stringify(confirmedImpact)) throw new Error('使用箇所が変更されました。もう一度保存して内容を確認してください。');
                            const previous = removals?.value || [];
                            const retained = previous.filter(ref => ref.apiConfigId !== id || !nextNames.includes(ref.modelName));
                            if (removed.length || retained.length !== previous.length)
                                settings.put({ key: REMOVED_MODELS_KEY, value: [...retained, ...removed.filter(ref => !matchesRemovedModel(ref, retained))] });
                            settings.put({ key: 'apiConfigs', value: current ? configs.map(config => config.id === id ? nextConfig : config) : [...configs, nextConfig] });
                            writes.forEach(write => write());
                        } catch (error) { failure = error; tx.abort(); }
                    });
                }).catch(error => { throw failure || error; });
                return result;
            },
            async persistApiConfigsWithModelRemovalsV136(configs) {
                let next;
                await transaction(['settings'], tx => {
                    const settings = tx.objectStore('settings'), request = settings.get(REMOVED_MODELS_KEY);
                    request.onsuccess = () => {
                        const removed = request.result?.value || [];
                        next = this.normalizeApiConfigs(configs).map(config => {
                            const before = this.getApiConfigModelCandidates(config);
                            const candidates = before.filter(modelName => !matchesRemovedModel({ apiConfigId: config.id, modelName }, removed));
                            return candidates.length === before.length ? config : { ...config, modelCandidates: candidates,
                                defaultModel: candidates[0] || '', additionalModels: this.joinModelCandidateList(candidates) };
                        });
                        settings.put({ key: 'apiConfigs', value: next });
                    };
                });
                return next;
            },
            async moveApiConfigV136(id, offset) {
                let reordered;
                await transaction(['settings'], tx => {
                    const settings = tx.objectStore('settings');
                    const request = settings.get('apiConfigs');
                    request.onsuccess = () => {
                        const configs = request.result?.value;
                        if (!Array.isArray(configs)) return;
                        const index = configs.findIndex(config => config.id === id);
                        const destination = index + offset;
                        if (index < 0 || destination < 0 || destination >= configs.length) return;
                        [configs[index], configs[destination]] = [configs[destination], configs[index]];
                        reordered = configs;
                        settings.put({ key: 'apiConfigs', value: configs });
                    };
                });
                return reordered;
            },
            async inspectApiConfigReferences(configId) {
                const chats = await dbUtils.getAllChats();
                const usages = this.collectApiConfigModelRefUsages(configId);
                for (const key of ['memoryModelRef', 'sdQcModelRef', 'sdPromptImproveModelRef']) {
                    const ref = state.globalSettingsV136?.[key];
                    if (ref?.apiConfigId === configId) usages.push({ scope: 'global', usage: key, modelName: ref.modelName, legacy: false });
                }
                const add = (ref, label) => { if (ref?.apiConfigId === configId) usages.push({ scope: 'chat', usage: label, modelName: ref.modelName, legacy: false }); };
                chats.forEach(c => add(c.executionSettings?.modelRef, `チャット「${c.title || c.id}」`));
                add(this.getCurrentChatModelRef(), '現在のチャット');
                add(this.readExecutionDraft()?.modelRef, '未送信チャット');
                return { ...this.getApiConfigUsage(configId), usages, blockingUsages: usages.filter(u => !u.legacy), isInUse: usages.some(u => !u.legacy) };
            },
            async getReferencedImageIdsV136({ excludeChatId = null } = {}) {
                const ids = new Set();
                const profiles = await dbUtils.getAllProfiles();
                profiles.forEach(p => { if (p.settings?.appearance?.backgroundAssetId) ids.add(p.settings.appearance.backgroundAssetId); });
                const global = (await dbUtils.getSetting(GLOBAL_KEY))?.value;
                if (global?.appearance?.backgroundAssetId) ids.add(global.appearance.backgroundAssetId);
                const assets = await dbUtils.getAllAssets();
                assets.forEach(a => { if (a.assetId) ids.add(a.assetId); });
                const chats = await dbUtils.getAllChats();
                for (const job of state.sendJobsV136.values()) {
                    chats.push({ id: job.chatId, messages: job.messages });
                    if (job.chatId !== excludeChatId) job.imageIds.forEach(id => ids.add(id));
                }
                for (const chat of chats) if (String(chat.id) !== String(excludeChatId)) for (const m of chat.messages || []) {
                    (m.imageIds || []).forEach(id => ids.add(id));
                    (m.attachments || []).forEach(a => { if (a.assetId) ids.add(a.assetId); });
                }
                return ids;
            },
            async getLegacyProfileSettingsV136(profileId) {
                const backup = (await dbUtils.getSetting(BACKUP_KEY))?.value || [];
                return structuredClone(backup.find(p => String(p.profileId) === String(profileId))?.settings || null);
            },
            async restoreLegacyGlobalSettingsV136(profileId) {
                const legacy = await this.getLegacyProfileSettingsV136(profileId);
                if (!legacy) throw new Error('移行前の設定が見つかりません。');
                const updates = pick(legacy, globalKeys);
                if (legacy.includeThoughts !== undefined) updates.showThoughtProcess = legacy.includeThoughts === true;
                await this.saveGlobalSettingsV136(updates);
            }
        };
    }
    root.SettingsV136 = { GLOBAL_KEY, SUCCESS_KEY, MIGRATION_KEY, BACKUP_KEY, DRAFT_KEY, profileKeys, globalKeys, chatTitleDefaults,
        CHAT_PARAMETER_DRAFT_KEY, normalizeChatNumbers,
        REMOVED_MODELS_KEY, matchesRemovedModel, clearRemovedExecution,
        AUXILIARY_MODEL_NONE, auxiliaryLegacyModelKeys, auxiliaryModelSelectIds,
        DEFAULT_MEMORY_EXTRACTION_PROMPT, MEMORY_EXTRACTION_OUTPUT_FORMAT,
        chatContentVersion, sameChatContentVersion, nextChatContentVersion,
        themeKeys, appearanceKeys, pick, modelRef, profileSettings, capability, normalizeEffort, executionSettings,
        applyThinking, MODEL_DEFAULT_EFFORT, geminiThinkingRejection, imageInputCapability, assertCompatible, READER_VERSION, createMethods,
        hashV136, historySeedV136, historyStepV136, historyContextV136, rememberHistoryContextsV136,
        configureHistoryWorkerV136, historyTaskV136, rememberHistoryContextsAsyncV136, wireConvertersV136 };
    if (typeof module !== 'undefined') module.exports = root.SettingsV136;
})(typeof window !== 'undefined' ? window : globalThis);
