import("https://esm.run/@google/genai").then(module => {
    // 正しいクラス名 GoogleGenAI をグローバルスコープに設定
    window.GoogleGenAI = module.GoogleGenAI;
    console.log("Google GenAI SDK (@google/genai) の読み込みが完了しました。");
}).catch(err => {
    console.error("Google Gen AI SDKの読み込みに失敗しました:", err);
    // エラーメッセージを画面に表示するなどのフォールバック処理
    document.body.innerHTML = `<p style="color: red; padding: 20px;">SDKの読み込みに失敗しました。アプリを起動できません。</p>`;
});

// --- 定数 ---
const DB_NAME = 'GeminiPWA_DB';
const DB_VERSION = 13; 
const SETTINGS_STORE = 'settings';
const PROFILES_STORE = 'profiles';
const CHATS_STORE = 'chats';
const IMAGE_STORE = 'image_store';
const CHAT_UPDATEDAT_INDEX = 'updatedAtIndex';
const CHAT_CREATEDAT_INDEX = 'createdAtIndex';
const DEFAULT_MODEL = 'gemini-2.5-pro';
const DEFAULT_TEMPERATURE = 0.5;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TOP_K = 40;
const DEFAULT_TOP_P = 0.95;
const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'; // デフォルトフォント
const CHAT_TITLE_LENGTH = 15;
const TEXTAREA_MAX_HEIGHT = 120;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const ZAI_API_BASE_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const OPENROUTER_API_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DUPLICATE_SUFFIX = ' (コピー)';
const IMPORT_PREFIX = '(取込) ';
const LIGHT_THEME_COLOR = '#4a90e2';
const DARK_THEME_COLOR = '#007aff';
const APP_VERSION = "1.12";
const DEFAULT_ZAI_MODEL = 'glm-4.6';
const DEFAULT_OPENROUTER_MODEL = 'x-ai/grok-4.1-fast';
const VERSION_NOTICE_SESSION_KEY = 'pendingVersionNotice';
const VERSION_ACK_STORAGE_KEY = 'appVersionAcknowledged';
const VERSION_LEGACY_STORAGE_KEY = 'appVersion';

// プロバイダーごとのモデルリスト
const GEMINI_MODELS = [
    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    { value: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
    { value: 'gemini-2.5-flash-preview-09-2025', label: 'gemini-2.5-flash-preview-09-2025', group: 'プレビュー版' },
    { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'gemini-2.5-flash-lite-preview-09-2025', group: 'プレビュー版' },
    { value: 'gemini-2.5-flash-image-preview', label: 'gemini-2.5-flash-image-preview (Nano Banana)', group: 'プレビュー版' },
    { value: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview', group: 'プレビュー版' }
];

const ZAI_MODELS = [
    { value: 'glm-4.6', label: 'GLM-4.6' },
    { value: 'glm-4.5-Air', label: 'GLM-4.5 Air' },
    { value: 'glm-4.5-flash', label: 'GLM-4.5 Flash' }
];

const BEDROCK_MODELS = [
    { value: 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5 (推奨・東京リージョン用)' },
    { value: 'anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5 (標準リージョン用)' },
    { value: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
    { value: 'anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Claude 3.5 Sonnet v1' },
    { value: 'anthropic.claude-3-opus-20240229-v1:0', label: 'Claude 3 Opus' },
    { value: 'anthropic.claude-3-sonnet-20240229-v1:0', label: 'Claude 3 Sonnet' },
    { value: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' }
];

const DEFAULT_BEDROCK_MODEL = 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0';
const DEFAULT_BEDROCK_REGION = 'us-east-1';

const VERSION_HISTORY = {
    "1.12": [
        "ユーザー追加モデル対応を全面強化。思考プロセス翻訳、校正、要約、画像品質チェック、プロンプト改善の各機能で、ユーザーが追加したモデルを選択可能に。",
        "「追加モデル (カンマ区切り):」入力後、ページリロード不要で全モデル選択セレクターに即座に反映されるよう改善。",
        "`edit_image`関数にユーザー指定モデル機能を追加。`gemini-3-pro-image-preview`を含む任意のモデルで画像編集が可能に。",
        "開発者が更新を停止しても、ユーザーが新規モデルを追加すれば各種機能で使用できる拡張性の高い設計を実現。"
    ],
    "1.11": [
        "デバッグモード有効時のみ、`OpenRouter`、`Z.ai`、`AmazonBedrock`のプロバイダーを追加。開発者向け機能のため既存機能との連携は保証されていません。",
        "設定画面に「ダミーUserプロンプトとダミーModelプロンプトの順序を入れ替える」を追加。",
        "metadata内のキャラクター名や関係性名に特殊文字が使用されているとquerySelectorが正常に動作しない問題を修正"
    ],
    "1.1": [
        "gemini-3-pro-previewモデルを追加しました。",
        "gemini-3-pro-previewでのFunction Calling使用時に発生していた「thought_signature」エラーを修正しました。"
    ],
    "1.0": [
        "Dropbox連携機能とStable Diffusion WebUI/Forge/Reforge連携を追加し、PWA内のデータと画像生成ワークフローをクラウドやローカル環境とシームレスに同期できるようにしました。",
        "添付ファイルのサムネイル表示やアップデート内容を告知するダイアログ、URLコンテンツを取り込むfetch_url_content関数、プロファイルへのgemini-2.5-pro使用回数表示、デバッグモード切替などのUI/機能改善を実装しました。",
        "gemini-2.5-flash-imageやveo-3.1シリーズなど最新モデルの追加、画像/動画関連関数のモデル選択改善、URL要約や要約機能まわりのエラーハンドリング強化を行いました。",
        "Firefoxでのパフォーマンス劣化や再生成時の履歴破損、記憶管理画面の不具合など多数のバグを修正し、DB関連関数の保存ロジックも刷新しました。"
    ]
};
const SWIPE_THRESHOLD = 50; // スワイプ判定の閾値 (px)
const ZOOM_THRESHOLD = 1.01; // ズーム状態と判定するスケールの閾値 (誤差考慮)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 最大ファイルサイズ (例: 10MB)
const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 1メッセージあたりの合計添付ファイルサイズ上限 (例: 50MB) - API制限も考慮
const INITIAL_RETRY_DELAY = 100; // 初期リトライ遅延時間 (ミリ秒)
const MAX_PROFILES = 5; // プロファイル作成の上限数
let broadcastChannel = null; // タブ間通信用
// --- デバッグログ機能 ---
const DebugLogger = {
    logs: [],
    MAX_LOGS: 500,
    originalConsole: {},
    isInitialized: false,

    init() {
        if (state.settings.debugMode) {
            this._patchConsole();
        } else {
            this._unpatchConsole();
        }
        this.isInitialized = true;
        console.log(`[DebugLogger] 初期化完了。デバッグモード: ${state.settings.debugMode ? 'ON' : 'OFF'}`);
    },

    _patchConsole() {
        if (this.originalConsole.log) return; // 既にパッチ済み

        const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];
        consoleMethods.forEach(method => {
            this.originalConsole[method] = console[method];
            console[method] = (...args) => {
                // ログを内部配列に保存
                this.addLog(method, args);
                // 元のコンソールメソッドを呼び出す
                this.originalConsole[method].apply(console, args);
            };
        });
    },

    _unpatchConsole() {
        if (!this.originalConsole.log) return; // パッチされていない

        Object.keys(this.originalConsole).forEach(method => {
            console[method] = this.originalConsole[method];
        });
        this.originalConsole = {};
    },

    addLog(type, args) {
        // 循環参照を避けるための簡易的なシリアライザ
        const serialize = (obj) => {
            try {
                // DOM要素や特殊なオブジェクトは文字列に変換
                if (obj instanceof HTMLElement) return `[HTMLElement: ${obj.tagName}]`;
                if (obj instanceof Event) return `[Event: ${obj.type}]`;
                // 通常のオブジェクトはJSONに変換
                return JSON.stringify(obj, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        if (value instanceof Blob) return '[Blob]';
                        if (value instanceof File) return `[File: ${value.name}]`;
                    }
                    return value;
                }, 2);
            } catch (e) {
                return '[Unserializable Object]';
            }
        };

        this.logs.push({
            type,
            timestamp: new Date(),
            args: args.map(arg => (typeof arg === 'object' && arg !== null) ? serialize(arg) : arg)
        });

        // ログが最大数を超えたら古いものから削除
        if (this.logs.length > this.MAX_LOGS) {
            this.logs.shift();
        }
    },

    getLogs() {
        return this.logs;
    },

    clearLogs() {
        this.logs = [];
        console.log("[DebugLogger] ログがクリアされました。");
    }
};


// 添付を確定する処理
const extensionToMimeTypeMap = {
    // Text Data
    'pdf': 'application/pdf',
    'js': 'text/javascript',
    'py': 'text/x-python',
    'txt': 'text/plain',
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
    'css': 'text/css',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'xml': 'application/xml',
    'rtf': 'application/rtf',
    'java': 'text/x-java-source',
    'c': 'text/x-c',
    'cpp': 'text/x-c++src',
    'hpp': 'text/x-c++hdr',
    'h': 'text/x-chdr',
    'cs': 'text/plain',
    'php': 'application/x-httpd-php',
    'rb': 'text/x-ruby',
    'go': 'text/x-go',
    'swift': 'text/x-swift',
    'kt': 'text/x-kotlin',
    'kts': 'text/x-kotlin',
    'rs': 'text/rust',
    'ts': 'text/typescript',
    'tsx': 'text/typescript',
    'sql': 'application/sql',
    'sh': 'application/x-sh',
    'yml': 'text/yaml',
    'yaml': 'text/yaml',

    // Image Data
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'heic': 'image/heic',
    'heif': 'image/heif',

    // Video Data
    'mp4': 'video/mp4',
    'mpeg': 'video/mpeg',
    'mov': 'video/mov',
    'avi': 'video/avi',
    'flv': 'video/x-flv',
    'mpg': 'video/mpg',
    'webm': 'video/webm',
    'wmv': 'video/wmv',
    '3gp': 'video/3gpp',
    '3gpp': 'video/3gpp',

    // Audio Data
    'wav': 'audio/wav',
    'mp3': 'audio/mp3',
    'aiff': 'audio/aiff',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
};

// --- DOM要素 ---
let elements;
try {
    elements = {
        appContainer: document.querySelector('.app-container'),
        appHeader: document.querySelector('.app-header'),
        chatScreen: document.getElementById('chat-screen'),
        historyScreen: document.getElementById('history-screen'),
        settingsScreen: document.getElementById('settings-screen'),
        chatTitle: document.getElementById('chat-title'),
        messageContainer: document.getElementById('message-container'),
        userInput: document.getElementById('user-input'),
        sendButton: document.getElementById('send-button'),
        loadingIndicator: document.getElementById('loading-indicator'),
        historyList: document.getElementById('history-list'),
        historyTitle: document.getElementById('history-title'),
        noHistoryMessage: document.getElementById('no-history-message'),
        historyItemTemplate: document.querySelector('.js-history-item-template'),
        themeColorMeta: document.getElementById('theme-color-meta'),
        systemPromptArea: document.getElementById('system-prompt-area'),
        systemPromptDetails: document.getElementById('system-prompt-details'),
        systemPromptEditor: document.getElementById('system-prompt-editor'),
        saveSystemPromptBtn: document.getElementById('save-system-prompt-btn'),
        cancelSystemPromptBtn: document.getElementById('cancel-system-prompt-btn'),
        apiProviderSelect: document.getElementById('api-provider'),
        apiProviderRow: document.getElementById('api-provider-row'),
        apiKeyInput: document.getElementById('api-key'),
        zaiApiKeyInput: document.getElementById('zai-api-key'),
        geminiApiKeyContainer: document.getElementById('gemini-api-key-container'),
        zaiApiKeyContainer: document.getElementById('zai-api-key-container'),
        openrouterApiKeyInput: document.getElementById('openrouter-api-key'),
        openrouterApiKeyContainer: document.getElementById('openrouter-api-key-container'),
        openrouterModelInput: document.getElementById('openrouter-model-input'),
        openrouterModelInputContainer: document.getElementById('openrouter-model-input-container'),
        bedrockAccessKeyInput: document.getElementById('bedrock-access-key'),
        bedrockSecretKeyInput: document.getElementById('bedrock-secret-key'),
        bedrockRegionSelect: document.getElementById('bedrock-region'),
        bedrockApiKeyContainer: document.getElementById('bedrock-api-key-container'),
        modelNameSelect: document.getElementById('model-name'),
        modelNameLabel: document.getElementById('model-name-label'),
        userDefinedModelsGroup: document.getElementById('user-defined-models-group'),
        systemPromptDefaultTextarea: document.getElementById('system-prompt-default'),
        temperatureInput: document.getElementById('temperature'),
        maxTokensInput: document.getElementById('max-tokens'),
        topKInput: document.getElementById('top-k'),
        topPInput: document.getElementById('top-p'),
        thinkingBudgetInput: document.getElementById('thinking-budget'),
        includeThoughtsToggle: document.getElementById('include-thoughts-toggle'),
        thoughtTranslationOptionsDiv: document.getElementById('thought-translation-options'),
        enableThoughtTranslationCheckbox: document.getElementById('enable-thought-translation'),
        thoughtTranslationModelSelect: document.getElementById('thought-translation-model'),
        dummyUserInput: document.getElementById('dummy-user'),
        applyDummyToProofreadCheckbox: document.getElementById('apply-dummy-to-proofread'),
        applyDummyToTranslateCheckbox: document.getElementById('apply-dummy-to-translate'),
        dummyModelInput: document.getElementById('dummy-model'),
        reverseDummyOrderCheckbox: document.getElementById('reverse-dummy-order'),
        concatDummyModelCheckbox: document.getElementById('concat-dummy-model'),
        additionalModelsTextarea: document.getElementById('additional-models'),
        enterToSendCheckbox: document.getElementById('enter-to-send'),
        historySortOrderSelect: document.getElementById('history-sort-order'),
        darkModeToggle: document.getElementById('dark-mode-toggle'),
        debugModeToggle: document.getElementById('debug-mode-toggle'),
        fontFamilyInput: document.getElementById('font-family-input'),
        hideSystemPromptToggle: document.getElementById('hide-system-prompt-toggle'),
        geminiEnableGroundingToggle: document.getElementById('gemini-enable-grounding-toggle'),
        geminiEnableFunctionCallingToggle: document.getElementById('gemini-enable-function-calling-toggle'),
        forceFunctionCallingToggle: document.getElementById('force-function-calling-toggle'),
        appVersionSpan: document.getElementById('app-version'),
        backgroundImageInput: document.getElementById('background-image-input'),
        uploadBackgroundBtn: document.getElementById('upload-background-btn'),
        backgroundThumbnail: document.getElementById('background-thumbnail'),
        deleteBackgroundBtn: document.getElementById('delete-background-btn'),
        gotoHistoryBtn: document.getElementById('goto-history-btn'),
        gotoSettingsBtn: document.getElementById('goto-settings-btn'),
        backToChatFromHistoryBtn: document.getElementById('back-to-chat-from-history'),
        backToChatFromSettingsBtn: document.getElementById('back-to-chat-from-settings'),
        newChatBtn: document.getElementById('new-chat-btn'),
        updateAppBtn: document.getElementById('update-app-btn'),
        clearDataBtn: document.getElementById('clear-data-btn'),
        importHistoryBtn: document.getElementById('import-history-btn'),
        importHistoryInput: document.getElementById('import-history-input'),
        alertDialog: document.getElementById('alertDialog'),
        alertMessage: document.getElementById('alertDialog').querySelector('.dialog-message'),
        alertOkBtn: document.getElementById('alertDialog').querySelector('.dialog-ok-btn'),
        confirmDialog: document.getElementById('confirmDialog'),
        confirmMessage: document.getElementById('confirmDialog').querySelector('.dialog-message'),
        confirmOkBtn: document.getElementById('confirmDialog').querySelector('.dialog-ok-btn'),
        confirmCancelBtn: document.getElementById('confirmDialog').querySelector('.dialog-cancel-btn'),
        promptDialog: document.getElementById('promptDialog'),
        promptMessage: document.getElementById('promptDialog').querySelector('.dialog-message'),
        promptInput: document.getElementById('promptDialog').querySelector('.dialog-input'),
        promptOkBtn: document.getElementById('promptDialog').querySelector('.dialog-ok-btn'),
        promptCancelBtn: document.getElementById('promptDialog').querySelector('.dialog-cancel-btn'),
        swipeNavigationToggle: document.getElementById('swipe-navigation-toggle'),
        enableProofreadingCheckbox: document.getElementById('enable-proofreading'),
        proofreadingOptionsDiv: document.getElementById('proofreading-options'),
        proofreadingModelNameSelect: document.getElementById('proofreading-model-name'),
        proofreadingSystemInstructionTextarea: document.getElementById('proofreading-system-instruction'),
        attachFileBtn: document.getElementById('attach-file-btn'),
        fileUploadDialog: document.getElementById('fileUploadDialog'),
        fileInput: document.getElementById('file-input'),
        selectFilesBtn: document.getElementById('select-files-btn'),
        selectedFilesList: document.getElementById('selected-files-list'),
        confirmAttachBtn: document.getElementById('confirm-attach-btn'),
        cancelAttachBtn: document.getElementById('cancel-attach-btn'),
        enableAutoRetryCheckbox: document.getElementById('enable-auto-retry'),
        maxRetriesInput: document.getElementById('max-retries'),
        autoRetryOptionsDiv: document.getElementById('auto-retry-options'),
        useFixedRetryDelayCheckbox: document.getElementById('use-fixed-retry-delay'),
        fixedRetryDelayContainer: document.getElementById('fixed-retry-delay-container'),
        fixedRetryDelayInput: document.getElementById('fixed-retry-delay-seconds'),
        maxBackoffDelayContainer: document.getElementById('max-backoff-delay-container'),
        maxBackoffDelayInput: document.getElementById('max-backoff-delay-seconds'),
        enableApiTimeoutCheckbox: document.getElementById('enable-api-timeout'),
        apiTimeoutSecondsInput: document.getElementById('api-timeout-seconds'),
        apiTimeoutOptions: document.getElementById('api-timeout-options'),
        googleSearchApiKeyInput: document.getElementById('google-search-api-key'),
        googleSearchEngineIdInput: document.getElementById('google-search-engine-id'),
        overlayOpacitySlider: document.getElementById('overlay-opacity-slider'),
        overlayOpacityValue: document.getElementById('overlay-opacity-value'),
        headerColorInput: document.getElementById('header-color-input'),
        resetHeaderColorBtn: document.getElementById('reset-header-color-btn'),
        messageOpacitySlider: document.getElementById('message-opacity-slider'),
        messageOpacityValue:  document.getElementById('message-opacity-value'),
        modelWarningMessage: document.getElementById('model-warning-message'),
        profileCardHeaderWrapper: document.getElementById('profile-card-header-wrapper'),
        profileCardHeader: document.getElementById('profile-card-header'),
        profileCardIconContainer: document.getElementById('profile-card-icon-container'),
        profileCardName: document.getElementById('profile-card-name'),
        headerProfileMenu: document.getElementById('header-profile-menu'),
        profileCardHeaderWrapperSettings: document.getElementById('profile-card-header-wrapper-settings'),
        profileCardHeaderSettings: document.getElementById('profile-card-header-settings'),
        profileCardIconContainerSettings: document.getElementById('profile-card-icon-container-settings'),
        profileCardNameSettings: document.getElementById('profile-card-name-settings'),
        headerProfileMenuSettings: document.getElementById('header-profile-menu-settings'),
        profileManagementGroup: document.getElementById('profile-management-group'),
        profileDisplayCard: document.getElementById('profile-display-card'),
        profileDisplayIcon: document.getElementById('profile-display-icon'),
        profileDisplayNameMain: document.getElementById('profile-display-name-main'),
        profileDisplayNameSub: document.getElementById('profile-display-name-sub'),
        profileDisplayStatus: document.getElementById('profile-display-status'),
        profileEditNameBtn: document.getElementById('profile-edit-name-btn'),
        profileIconInput: document.getElementById('profile-icon-input'),
        profileResetIconBtn: document.getElementById('profile-reset-icon-btn'),
        profileSaveNewBtn: document.getElementById('profile-save-new-btn'),
        profileUpdateBtn: document.getElementById('profile-update-btn'),
        profileDeleteBtn: document.getElementById('profile-delete-btn'),
        profileExportBtn: document.getElementById('profile-export-btn'),
        profileImportBtn: document.getElementById('profile-import-btn'),
        profileImportInput: document.getElementById('profile-import-input'),
        autoScrollToggle: document.getElementById('auto-scroll-toggle'),
        enableWideModeToggle: document.getElementById('enable-wide-mode-toggle'),
        assetCountDisplay: document.getElementById('asset-count-display'),
        assetExportBtn: document.getElementById('asset-export-btn'),
        assetImportBtn: document.getElementById('asset-import-btn'),
        assetImportInput: document.getElementById('asset-import-input'),
        assetConflictDialog: document.getElementById('assetConflictDialog'),
        assetConflictMessage: document.getElementById('assetConflictDialog').querySelector('.dialog-message'),
        assetConflictApplyAll: document.getElementById('apply-to-all-checkbox'),
        manageAssetsBtn: document.getElementById('manage-assets-btn'),
        assetManagementDialog: document.getElementById('assetManagementDialog'),
        assetListContainer: document.getElementById('asset-list-container'),
        closeAssetDialogBtn: document.getElementById('close-asset-dialog-btn'),
        deleteAllAssetsBtn: document.getElementById('delete-all-assets-btn'),
        memoryToggleBtn: document.getElementById('memory-toggle-btn'),
        enableMemoryToggle: document.getElementById('enable-memory-toggle'),
        memoryOptionsContainer: document.getElementById('memory-options-container'),
        memoryAutoSaveIntervalSelect: document.getElementById('memory-auto-save-interval'),
        manageMemoryBtn: document.getElementById('manage-memory-btn'),
        memoryManagementDialog: document.getElementById('memoryManagementDialog'),
        memoryListContainer: document.getElementById('memory-list-container'),
        newMemoryInput: document.getElementById('new-memory-input'),
        addMemoryBtn: document.getElementById('add-memory-btn'),
        closeMemoryDialogBtn: document.getElementById('close-memory-dialog-btn'),
        deleteAllMemoryBtn: document.getElementById('delete-all-memory-btn'),
        headerAutoHideToggle: document.getElementById('header-auto-hide-toggle'),
        headerTriggerArea: document.getElementById('header-trigger-area'),
        summarizeHistoryBtn: document.getElementById('summarize-history-btn'),
        summaryModelNameSelect: document.getElementById('summary-model-name'),
        summarySystemPromptTextarea: document.getElementById('summary-system-prompt'),
        summaryDialog: document.getElementById('summaryDialog'),
        summaryStats: document.getElementById('summary-stats'),
        summaryEditor: document.getElementById('summary-editor'),
        summaryCancelBtn: document.getElementById('summary-cancel-btn'),
        summaryRegenerateBtn: document.getElementById('summary-regenerate-btn'),
        summaryConfirmBtn: document.getElementById('summary-confirm-btn'),
        enableSummaryButtonToggle: document.getElementById('enable-summary-button-toggle'),
        progressDialog: document.getElementById('progressDialog'),
        progressMessage: document.getElementById('progress-message'),
        floatingActionPanel: document.getElementById('floating-action-panel'),
        scrollToTopBtn: document.getElementById('scroll-to-top-btn'),
        scrollToBottomBtn: document.getElementById('scroll-to-bottom-btn'),
        floatingPanelBehaviorSelect: document.getElementById('floating-panel-behavior'),
        characterProfileBtn: document.getElementById('character-profile-btn'),
        characterProfileDialog: document.getElementById('characterProfileDialog'),
        profileBackBtn: document.getElementById('profile-back-btn'),
        characterListPane: document.getElementById('character-list-pane'),
        characterDetailPane: document.getElementById('character-detail-pane'),
        closeProfileDialogBtn: document.getElementById('close-profile-dialog-btn'),
        dropboxAuthBtn: document.getElementById('dropbox-auth-btn'),
        dropboxAuthState: document.getElementById('dropbox-auth-state'),
        dropboxConnectedState: document.getElementById('dropbox-connected-state'),
        dropboxUserName: document.getElementById('dropbox-user-name'),
        dropboxSyncBtn: document.getElementById('dropbox-sync-btn'),
        dropboxDisconnectBtn: document.getElementById('dropbox-disconnect-btn'),
        syncStatusHeaderIcon: document.getElementById('sync-status-header-icon'),
        syncStatusSettingsIcon: document.getElementById('sync-status-settings-icon'),
        dropboxSyncFrequencySelect: document.getElementById('dropbox-sync-frequency'),
        syncProgressText: document.getElementById('sync-progress-text'),
        lastSyncTimeDisplay: document.getElementById('last-sync-time-display'),
        sdApiUrlInput: document.getElementById('sd-api-url'),
        sdApiUserInput: document.getElementById('sd-api-user'),
        sdApiPasswordInput: document.getElementById('sd-api-password'),
        sdTestConnectionBtn: document.getElementById('sd-test-connection-btn'),
        sdEnableQualityCheckerCheckbox: document.getElementById('sd-enable-quality-checker'),
        sdQualityCheckerOptionsDiv: document.getElementById('sd-quality-checker-options'),
        sdQcModelSelect: document.getElementById('sd-qc-model'),
        sdQcPromptTextarea: document.getElementById('sd-qc-prompt'),
        sdQcRetriesInput: document.getElementById('sd-qc-retries'),
        sdPromptImproveModelSelect: document.getElementById('sd-prompt-improve-model'),
        sdPromptImproveSystemPromptTextarea: document.getElementById('sd-prompt-improve-system-prompt'),
        debugLogBtn: document.getElementById('debug-log-btn'),
        debugLogDialog: document.getElementById('debugLogDialog'),
        logContainer: document.getElementById('log-container'),
        copyLogsBtn: document.getElementById('copy-logs-btn'),
        clearLogsBtn: document.getElementById('clear-logs-btn'),
        closeLogDialogBtn: document.getElementById('close-log-dialog-btn'),
    };
    document.body.classList.toggle('dropbox-connected', false);
} catch (error) {
    console.error("起動時エラー:", error);
    if (sessionStorage.getItem('reloadAttempted') !== 'true') {
        console.log("初回エラーのため、強制リロードを試みます...");
        sessionStorage.setItem('reloadAttempted', 'true');
        location.reload(true);
    } else {
        console.error("リロード後もエラーが解決しなかったため、処理を停止します。");
        sessionStorage.removeItem('reloadAttempted');
        document.body.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">
            <h1>アプリケーションの起動に失敗しました</h1>
            <p>エラー: ${error.message}</p>
            <p>自動リロードを試みましたが、問題が解決しませんでした。ブラウザのキャッシュを手動でクリアする必要があるかもしれません。</p>
        </div>`;
    }
}

// --- アプリ状態 ---
const state = {
    tabId: `tab_${Date.now()}_${Math.random()}`, // このタブを識別するユニークID
    db: null,
    currentChatId: null,
    currentMessages: [],
    currentSystemPrompt: '',
    currentPersistentMemory: {}, // 現在のチャットの永続メモリ
    currentSummarizedContext: null,
    profiles: [], // 全プロファイルのリスト
    activeProfileId: null, // 現在アクティブなプロファイルのID
    activeProfile: null, // 現在アクティブなプロファイルの完全なデータ
    profileIconUrls: new Map(),
    videoUrlCache: new Map(),
    imageUrlCache: new Map(),
    settings: {
        apiProvider: 'gemini', // 'gemini' | 'zai' | 'bedrock' | 'openrouter'
        apiKey: '',
        zaiApiKey: '',
        openrouterApiKey: '',
        bedrockAccessKey: '',
        bedrockSecretKey: '',
        bedrockRegion: DEFAULT_BEDROCK_REGION,
        modelName: DEFAULT_MODEL,
        systemPrompt: '',
        temperature: null,
        maxTokens: null,
        topK: null,
        topP: null,
        thinkingBudget: null,
        includeThoughts: false,
        enableThoughtTranslation: true, // 思考プロセスの翻訳を有効にするか
        thoughtTranslationModel: 'gemini-2.5-flash-lite',
        dummyUser: '',
        applyDummyToProofread: false,
        applyDummyToTranslate: false,
        dummyModel: '',
        reverseDummyOrder: false,
        concatDummyModel: false,
        additionalModels: '',
        enterToSend: true,
        historySortOrder: 'updatedAt',
        darkMode: false,
        backgroundImageBlob: null,
        fontFamily: '',
        hideSystemPromptInChat: false,
        enableSwipeNavigation: false,
        enableAutoRetry: true,
        maxRetries: 30, 
        useFixedRetryDelay: false,
        fixedRetryDelaySeconds: 15,
        maxBackoffDelaySeconds: 60,
        enableApiTimeout: false,
        apiTimeoutSeconds: 90,
        enableProofreading: false,
        proofreadingModelName: 'gemini-2.5-flash',
        proofreadingSystemInstruction: 'あなたはプロの編集者です。受け取った文章の過剰な読点を抑制し、日本語として違和感のない読点の使用量に校正してください。承知しました等の応答は行わず、校正後の文章のみ出力して下さい。読点の抑制以外の編集は禁止です。読点以外の文章には絶対に手を付けないで下さい。',
        geminiEnableGrounding: false,
        geminiEnableFunctionCalling: false,
        googleSearchApiKey: '',
        googleSearchEngineId: '',
        messageOpacity: 1,
        overlayOpacity: 0.65,
        headerColor: '',
        allowPromptUiChanges: true,
        forceFunctionCalling: false,
        autoScroll: true,
        enableWideMode: true,
        enableMemory: false,
        memoryAutoSaveInterval: 30,
        headerAutoHide: false,
        summaryModelName: '', // 空の場合はmodelNameを使用
        summarySystemPrompt:`あなたはプロの編集者です。以下の会話履歴を、第三者の視点から見た物語の「あらすじ」として要約してください。
「承知しました」等のAIとしての応答は不要です。要約文のみ出力して下さい。

【最重要ルール】
- **プロットの維持**: 物語の重要な転換点、登場人物の重要な決断、新しい事実の判明、伏線となりうる発言は、絶対に省略しないでください。
- **客観的な記述**: 「主人公は〜した。」「〇〇は〜と感じた。」のように、キャラクターの行動と感情を客観的に記述してください。
- **情報の取捨選択**: 日常的な挨拶や、物語の進行に直接関係のない会話は省略してください。
- **時系列の維持**: 出来事が起こった順番を正確に保ってください。

最終的な出力は、このあらすじを初めて読む人でも、これまでの物語の流れを正確に理解できるような形式にしてください。`,
        enableSummaryButton: true,
        floatingPanelBehavior: 'on-click',
        dropboxSyncFrequency: 'instant',
        sdApiUrl: '',
        sdApiUser: '',
        sdApiPassword: '',
        sdEnableQualityChecker: false,
        sdQcModel: 'gemini-2.5-pro',
        sdQcPrompt: `あなたはプロンプトと画像を比較し、指示通りに生成されているか評価する専門家です。
以下のプロンプトと画像の内容を厳密に比較してください。

[プロンプト]
{prompt}

[評価ルール]
- プロンプトの要素（人物、服装、背景、構図、雰囲気など）が画像内に明確に反映されていれば "OK" と評価してください。
- 重要な要素が欠けていたり、指示と明らかに異なる場合は "NG" と評価し、その理由を簡潔に説明してください。

[出力形式]
評価結果を以下の形式で出力してください。他のテキストは一切含めないでください。
Result: [OKまたはNG]
Reason: [NGの場合の理由]`,
        sdQcRetries: 3,
        sdPromptImproveModel: 'gemini-2.5-flash',
        sdPromptImproveSystemPrompt: `あなたはプロのプロンプトエンジニアです。提示された「元のプロンプト」と「失敗理由」に基づき、失敗理由を解決するための改善された英語の画像生成プロンプトを生成してください。余計な解説や前置きは一切含めず、改善されたプロンプト本体のみを出力してください。`,
        debugMode: false,
    },
    syncMessageCounter: 0,
    backgroundImageUrl: null,
    isSending: false,
    abortController: null,
    editingMessageIndex: null,
    isEditingSystemPrompt: false,
    touchStartX: 0,
    touchStartY: 0,
    touchEndX: 0,
    touchEndY: 0,
    isSwiping: false,
    isZoomed: false,
    currentScreen: 'chat',
    panelFadeOutTimer: null,
    selectedFilesForUpload: [],
    pendingAttachments: [],
    isTemporaryBackgroundActive: false,
    currentScene: null,
    currentStyleProfiles: {},
    isMemoryEnabledForChat: true,
    characterProfileVisibleCharacter: null,
    sync: {
        isDirty: false, // ローカルに変更があったか
        lastSyncId: null, // 最後に同期したクラウドのID
        isSyncing: false, // 同期処理中か
        pushTimeoutId: null, // Push処理のデバウンス用タイマーID
        lastError: null
    }
};

function updateMessageMaxWidthVar() {
    const container = elements.messageContainer;
    if (!container) return;

    const isWideMode = state.settings.enableWideMode && window.innerWidth > 800;
    // ワイドモード時はコンテナ幅の70%、通常時は80%をメッセージの最大幅とする
    const percentage = isWideMode ? 0.7 : 0.8;
    let maxWidthPx = container.clientWidth * percentage;

    document.documentElement.style.setProperty('--message-max-width', `${maxWidthPx}px`);
}


let resizeTimer;
window.addEventListener('DOMContentLoaded', (event) => {
    console.log("DOM fully loaded and parsed. Initializing app...");
    appLogic.initializeApp();
});

// --- ユーティリティ関数 ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

 /**
 * 中断可能なsleep関数
 * @param {number} ms - 待機する時間 (ミリ秒)
 * @param {AbortSignal} signal - 中断を監視するためのAbortSignal
 * @returns {Promise<void>} 待機が完了するとresolveし、中断されるとrejectするPromise
 */
 function interruptibleSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        // 待機開始前にもし既に中断されていたら、即座にエラーを投げる
        if (signal.aborted) {
            const error = new Error("Sleep aborted");
            error.name = "AbortError";
            return reject(error);
        }   

        let timeoutId;

        // 中断信号を受け取った時の処理
        const onAbort = () => {
            clearTimeout(timeoutId); // タイマーをクリア
            const error = new Error("Sleep aborted");
            error.name = "AbortError";
            reject(error); // Promiseをエラーで終了させる
        };

        // 指定時間後にPromiseを成功させるタイマーを設定
        timeoutId = setTimeout(() => {
            signal.removeEventListener('abort', onAbort); // 成功したので中断リスナーは不要
            resolve();
        }, ms);

        // 中断イベントを監視開始
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

// ファイルサイズを読みやすい形式にフォーマット
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}



// Base64文字列をBlobオブジェクトに変換 (Promise)
function base64ToBlob(base64, mimeType) {
    return fetch(`data:${mimeType};base64,${base64}`).then(res => res.blob());
}

// --- Service Worker関連 ---
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('このブラウザはService Workerをサポートしていません。');
        return;
    }

    // ページリロードの唯一のトリガーとしてcontrollerchangeを定義
    let isReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isReloading) return;
        isReloading = true;
        console.log("Controller has changed, reloading page for update...");
        window.location.reload();
    });

    const handleUpdateFound = (registration) => {
        const newWorker = registration.installing;
        if (newWorker) {
            console.log('新しいService Workerのインストールを検知しました。');
            newWorker.addEventListener('statechange', () => {
                // 新しいワーカーがインストールされ、待機状態になったら...
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('新しいService Workerが待機状態に入りました。アクティベートを試みます。');
                    // 確認なしで即座に更新を指示
                    if (state.db) {
                        state.db.close();
                        console.log("Service Worker更新のため、現在のDB接続を閉じました。");
                    }
                    newWorker.postMessage({ action: 'skipWaiting' });
                }
            });
        }
    };

    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.status === 'cacheCleared') {
            console.log('Service Workerから手動キャッシュクリア完了のメッセージを受信。リロードを実行します。');
            if (isReloading) return;
            isReloading = true;
            window.location.reload();
        }
    });

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('ServiceWorker登録成功 スコープ: ', registration.scope);

            const checkForUpdates = () => {
                navigator.serviceWorker.ready.then(readyRegistration => {
                    readyRegistration.update();
                }).catch(error => {
                    console.error('navigator.serviceWorker.ready failed:', error);
                });
            };

            // 各イベントでの更新チェックは維持
            setInterval(checkForUpdates, 60 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') checkForUpdates();
            });
            window.addEventListener('focus', checkForUpdates);

            // 待機中のワーカーがいれば即座に更新を試みる
            if (registration.waiting) {
                console.log('待機中の新しいService Workerが見つかりました。アクティベートを試みます。');
                // 確認なしで即座に更新を指示
                if (state.db) state.db.close();
                registration.waiting.postMessage({ action: 'skipWaiting' });
            }

            registration.addEventListener('updatefound', () => handleUpdateFound(registration));

        } catch (error) {
            console.error('ServiceWorker処理中にエラー: ', error);
        }
    });
}

// --- HTMLエスケープユーティリティ ---
const htmlUtils = {
    // HTML要素内のテキストコンテンツ用エスケープ
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },

    // HTML属性値用エスケープ（より厳格）
    escapeAttr(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    // CSSセレクタ用の安全な文字列を生成
    escapeSelector(text) {
        if (text === null || text === undefined) return '';
        // CSS.escapeを使用（全ブラウザでサポート済み）
        return CSS.escape(String(text));
    }
};

// --- IndexedDBユーティリティ (dbUtils) ---
const dbUtils = {
    openDB() {
        return new Promise((resolve, reject) => {
            if (state.db) {
                resolve(state.db);
                return;
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onblocked = (event) => {
                console.warn("IndexedDBのバージョンアップがブロックされました。古い接続が残っています。", event);
                // ユーザーに具体的な対処法を案内する
                uiUtils.showCustomAlert(
                    "アプリの更新が他のチャットセッションのタブによってブロックされています。\n\n" +
                    "このアプリを開いている他のタブを閉じてから、" +
                    "このタブを再読み込み（リロード）してください。"
                );
                // ここではrejectしないことで、ユーザーが対処する時間を与える
            };

            request.onerror = (event) => {
                console.error("IndexedDBエラー:", event.target.error);
                reject(`IndexedDBエラー: ${event.target.error}`);
            };

            request.onsuccess = (event) => {
                state.db = event.target.result;
                console.log("IndexedDBオープン成功");
                state.db.onerror = (event) => {
                    console.error(`データベースエラー: ${event.target.error}`);
                };
                resolve(state.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                console.log(`[DB Migration] IndexedDBをバージョン ${event.oldVersion} から ${event.newVersion} へアップグレード中...`);

                // --- 既存ストアの確認と作成 ---
                if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                    db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains(CHATS_STORE)) {
                    const chatStore = db.createObjectStore(CHATS_STORE, { keyPath: 'id', autoIncrement: true });
                    chatStore.createIndex(CHAT_UPDATEDAT_INDEX, 'updatedAt', { unique: false });
                    chatStore.createIndex(CHAT_CREATEDAT_INDEX, 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(PROFILES_STORE)) {
                    const profilesStore = db.createObjectStore(PROFILES_STORE, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('image_assets')) {
                    db.createObjectStore('image_assets', { keyPath: 'name' });
                }

                // v10への移行処理 (プロファイル機能導入)
                if (event.oldVersion < 10) {
                    console.log("[DB Migration] v10へのデータ移行処理を実行します。");
                    const settingsStore = transaction.objectStore(SETTINGS_STORE);
                    const profilesStore = transaction.objectStore(PROFILES_STORE);
                    
                    const getAllSettingsReq = settingsStore.getAll();
                    
                    getAllSettingsReq.onsuccess = () => {
                        const oldSettingsArray = getAllSettingsReq.result;
                        
                        if (oldSettingsArray.length > 0) {
                            console.log("[DB Migration] 既存の設定を検出しました。新しいプロファイル構造に移行します...");
                            
                            const oldSettingsObject = {};
                            oldSettingsArray.forEach(item => {
                                oldSettingsObject[item.key] = item.value;
                            });

                                const profileSettingKeys = [
                                'apiProvider', 'apiKey', 'zaiApiKey', 'bedrockAccessKey', 'bedrockSecretKey', 'bedrockRegion', 
                                'modelName', 'systemPrompt', 'temperature', 'maxTokens', 'topK', 'topP',
                                'presencePenalty', 'frequencyPenalty', 'thinkingBudget', 'includeThoughts',
                                'enableThoughtTranslation', 'thoughtTranslationModel', 'dummyUser',
                                'applyDummyToProofread', 'applyDummyToTranslate', 'dummyModel', 'reverseDummyOrder', 'concatDummyModel',
                                'additionalModels', 'enterToSend', 'historySortOrder', 'darkMode', 'fontFamily',
                                'hideSystemPromptInChat', 'enableSwipeNavigation', 'enableAutoRetry', 'maxRetries',
                                'useFixedRetryDelay', 'fixedRetryDelaySeconds', 'maxBackoffDelaySeconds',
                                'enableProofreading', 'proofreadingModelName', 'proofreadingSystemInstruction',
                                'geminiEnableGrounding', 'geminiEnableFunctionCalling', 'googleSearchApiKey',
                                'googleSearchEngineId', 'messageOpacity', 'overlayOpacity', 'headerColor',
                                'allowPromptUiChanges', 'forceFunctionCalling'
                            ];

                            const newProfileSettings = {};
                            profileSettingKeys.forEach(key => {
                                newProfileSettings[key] = oldSettingsObject[key] !== undefined ? oldSettingsObject[key] : state.settings[key];
                            });

                            const defaultProfile = {
                                name: "デフォルトプロファイル",
                                icon: null,
                                createdAt: Date.now(),
                                settings: newProfileSettings
                            };
                            
                            const addProfileReq = profilesStore.add(defaultProfile);
                            
                            addProfileReq.onsuccess = (addEvent) => {
                                const newProfileId = addEvent.target.result;
                                console.log(`[DB Migration] デフォルトプロファイルを生成しました (ID: ${newProfileId})`);

                                profileSettingKeys.forEach(key => {
                                    settingsStore.delete(key);
                                });

                                settingsStore.put({ key: 'activeProfileId', value: newProfileId });
                                console.log(`[DB Migration] SETTINGS_STOREを整理し、activeProfileIdを設定しました。`);
                            };
                        }
                    };
                }

                // v11へのアップグレード処理 (画像ストア追加)
                if (event.oldVersion < 11) {
                    console.log("[DB Migration] v11へのアップグレード: image_storeを作成します。");
                    if (!db.objectStoreNames.contains(IMAGE_STORE)) {
                        db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
                    }
                    transaction.oncomplete = () => {
                        console.log("[DB Migration] スキーマ更新完了。データ移行処理を開始します。");
                        appLogic.migrateImageData(); 
                    };
                }

                if (event.oldVersion < 12) {
                    console.log("[DB Migration] v12へのアップグレード: memory_storeを作成します。");
                    if (!db.objectStoreNames.contains('memory_store')) {
                        db.createObjectStore('memory_store', { keyPath: 'profileId' });
                    }
                }

                // v13へのアップグレード: 安全なインポート用の一時ストアを追加
                if (event.oldVersion < 13) {
                    console.log("[DB Migration] v13へのアップグレード: 安全なインポート用の一時ストアを作成します。");
                    const tempStores = [
                        { name: `${PROFILES_STORE}_temp`, options: { keyPath: 'id' } },
                        { name: `${CHATS_STORE}_temp`, options: { keyPath: 'id' } },
                        { name: `${SETTINGS_STORE}_temp`, options: { keyPath: 'key' } },
                        { name: `${IMAGE_STORE}_temp`, options: { keyPath: 'id' } },
                        { name: 'image_assets_temp', options: { keyPath: 'name' } },
                        { name: 'memory_store_temp', options: { keyPath: 'profileId' } }
                    ];

                    tempStores.forEach(storeInfo => {
                        if (!db.objectStoreNames.contains(storeInfo.name)) {
                            db.createObjectStore(storeInfo.name, storeInfo.options);
                            console.log(`[DB Migration] Temporary store '${storeInfo.name}' created.`);
                        }
                    });
                }
            };
        });
    },



    // 指定されたストアを取得する内部関数
    _getStore(storeName, mode = 'readonly') {
        if (!state.db) throw new Error("データベースが開かれていません");
        const transaction = state.db.transaction([storeName], mode);

        return transaction.objectStore(storeName);
    },

    // 設定を保存
    async saveSetting(key, value) {
        await this.openDB();
        return new Promise((resolve, reject) => {
             try {
                console.log(`[DEBUG] saveSetting: key='${key}' の保存トランザクションを開始します。`);
                const transaction = state.db.transaction([SETTINGS_STORE], 'readwrite');
                const store = transaction.objectStore(SETTINGS_STORE);
                
                store.put({ key, value });

                transaction.oncomplete = () => {
                    console.log(`[DEBUG] saveSetting: key='${key}' のトランザクションが正常に完了しました。`);
                    resolve();
                };
                transaction.onerror = (event) => {
                     console.error(`[DEBUG] saveSetting: key='${key}' のトランザクションエラー:`, event.target.error);
                     reject(event.target.error);
                };
            } catch (error) {
                console.error(`[DEBUG] saveSetting: ストアアクセスエラー:`, error);
                reject(error);
            }
        });
    },

    async saveChat(optionalTitle = null, chatObjectToSave = null, options = {}) {
        await this.openDB();
    
        let messagesForStats = [];
        let chatDataToSave;
    
        if (!chatObjectToSave) {
            if ((!state.currentMessages || state.currentMessages.length === 0) && !state.currentSystemPrompt) {
                if(state.currentChatId) console.log(`saveChat: 既存チャット ${state.currentChatId} にメッセージもシステムプロンプトもないため保存せず`);
                else console.log("saveChat: 新規チャットに保存するメッセージもシステムプロンプトもなし");
                return state.currentChatId;
            }

            const messagesToSave = state.currentMessages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                thoughtSummary: msg.thoughtSummary || null,
                tool_calls: msg.tool_calls || null,
                imageIds: msg.imageIds,
                finishReason: msg.finishReason,
                safetyRatings: msg.safetyRatings,
                error: msg.error,
                isCascaded: msg.isCascaded,
                isSelected: msg.isSelected,
                siblingGroupId: msg.siblingGroupId,
                groundingMetadata: msg.groundingMetadata,
                // attachments を安全にコピーし、file オブジェクトのみ除外する
                attachments: msg.attachments ? msg.attachments.map(att => ({
                    name: att.name,
                    mimeType: att.mimeType,
                    base64Data: att.base64Data,
                    assetId: att.assetId
                })) : undefined,
                usageMetadata: msg.usageMetadata,
                executedFunctions: msg.executedFunctions,
                generated_images: msg.generated_images,
                generated_videos: msg.generated_videos ? msg.generated_videos.map(video => ({
                        base64Data: video.base64Data,
                        prompt: video.prompt
                    })) : undefined,
                isHidden: msg.isHidden,
                isAutoTrigger: msg.isAutoTrigger
            }));

            messagesForStats = messagesToSave;
    
            chatDataToSave = {
                messages: messagesToSave,
                systemPrompt: state.currentSystemPrompt,
                persistentMemory: state.currentPersistentMemory || {},
                summarizedContext: state.currentSummarizedContext || null,
                isMemoryEnabledForChat: state.isMemoryEnabledForChat,
            };
        } else {
            messagesForStats = chatObjectToSave.messages || [];
            chatDataToSave = chatObjectToSave;
        }
    
        const stats = await this._calculateChatStats(messagesForStats);
    
        return new Promise((resolve, reject) => {
            try {
                const transaction = state.db.transaction([CHATS_STORE], 'readwrite');
                const store = transaction.objectStore(CHATS_STORE);
                const now = Date.now();
    
                const processSave = (existingChatData = null) => {
                    let title;
                    if (optionalTitle !== null) {
                        title = optionalTitle;
                    } else if (existingChatData && existingChatData.title) {
                        title = existingChatData.title;
                    } else {
                        const firstUserMessage = (chatDataToSave.messages || []).find(m => m.role === 'user' && !m.isHidden);
                        title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : "無題のチャット";
                    }
    
                    const chatIdForOperation = existingChatData ? existingChatData.id : state.currentChatId;
                    const finalChatData = {
                        ...chatDataToSave,
                        updatedAt: chatObjectToSave && chatObjectToSave.updatedAt ? chatObjectToSave.updatedAt : now,
                        createdAt: existingChatData ? existingChatData.createdAt : now,
                        title: title,
                        stats: stats
                    };
                    if (chatIdForOperation) {
                        finalChatData.id = chatIdForOperation;
                    }
    
                    const putRequest = store.put(finalChatData);
                    putRequest.onsuccess = (event) => {
                        const savedId = event.target.result;
                        if (!state.currentChatId && savedId) {
                            state.currentChatId = savedId;
                        }
                        console.log(`チャット ${state.currentChatId ? '更新' : '保存'} 完了 ID:`, state.currentChatId || savedId);
                        if ((state.currentChatId || savedId) === (chatIdForOperation || savedId)) {
                            uiUtils.updateChatTitle(finalChatData.title);
                        }
                        if (!options.skipPush) {
                            appLogic.markAsDirtyAndSchedulePush();
                        }
                    };
                    putRequest.onerror = (event) => {
                        console.error("チャット保存(put)エラー:", event.target.error);
                    };
                };
    
                if (state.currentChatId && !chatObjectToSave) {
                    const getRequest = store.get(state.currentChatId);
                    getRequest.onsuccess = (event) => {
                        const existingChat = event.target.result;
                        if (!existingChat) {
                            console.warn(`ID ${state.currentChatId} のチャットが見つかりません(保存時)。新規として保存します。`);
                            state.currentChatId = null;
                        }
                        processSave(existingChat);
                    };
                    getRequest.onerror = (event) => {
                        console.error("既存チャットの取得エラー(更新用):", event.target.error);
                        state.currentChatId = null;
                        processSave(null);
                    };
                } else {
                    processSave(chatObjectToSave);
                }
    
                transaction.oncomplete = () => {
                    resolve(state.currentChatId);
                };
                transaction.onerror = (event) => {
                    console.error("チャット保存トランザクション失敗:", event.target.error);
                    reject(new Error(`チャット保存トランザクション失敗: ${event.target.error.message}`));
                };
    
            } catch (error) {
                console.error("チャット保存処理の開始に失敗:", error);
                reject(error);
            }
        });
    },

    async _calculateChatStats(messages) {
        if (!messages) return null;

        let totalTokens = 0;
        const assetIds = new Set();
        let totalAssetSize = 0;
        let attachmentCount = 0;

        messages.forEach(msg => {
            // トークン数を集計
            if (msg.usageMetadata && typeof msg.usageMetadata.totalTokenCount === 'number') {
                totalTokens += msg.usageMetadata.totalTokenCount;
            }
            // 生成された画像IDを収集
            if (msg.imageIds) {
                msg.imageIds.forEach(id => assetIds.add(id));
            }
            // 添付ファイルの情報を収集
            if (msg.attachments) {
                attachmentCount += msg.attachments.length;
                msg.attachments.forEach(att => {
                    if (att.base64Data) {
                        // Base64文字列の長さの約3/4が元のバイトサイズ
                        totalAssetSize += Math.ceil(att.base64Data.length * 0.75);
                    }
                });
            }
        });

        // imageIds に基づいて image_store から実際のBlobサイズを取得して加算
        if (assetIds.size > 0) {
            await this.openDB();
            const store = this._getStore(IMAGE_STORE);
            const imagePromises = Array.from(assetIds).map(id => {
                return new Promise((resolve) => {
                    const request = store.get(id);
                    request.onsuccess = (event) => {
                        if (event.target.result && event.target.result.blob instanceof Blob) {
                            resolve(event.target.result.blob.size);
                        } else {
                            resolve(0);
                        }
                    };
                    request.onerror = () => resolve(0); // エラー時は0として扱う
                });
            });
            const sizes = await Promise.all(imagePromises);
            totalAssetSize += sizes.reduce((sum, size) => sum + size, 0);
        }

        return {
            totalTokens: totalTokens,
            assetCount: assetIds.size + attachmentCount,
            totalAssetSize: totalAssetSize
        };
    },

    // チャットタイトルをDBで更新
    async updateChatTitleDb(id, newTitle) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(CHATS_STORE, 'readwrite');
            const getRequest = store.get(id);
            getRequest.onsuccess = (event) => {
                const chatData = event.target.result;
                if (chatData) {
                    chatData.title = newTitle;
                    chatData.updatedAt = Date.now(); // 更新日時も更新
                    const putRequest = store.put(chatData);
                    putRequest.onsuccess = () => {
                        appLogic.markAsDirtyAndSchedulePush(true);
                        resolve();
                    };
                    putRequest.onerror = (event) => reject(`タイトル更新エラー: ${event.target.error}`);
                } else {
                    reject(`チャットが見つかりません: ${id}`);
                }
            };
            getRequest.onerror = (event) => reject(`タイトル更新用チャット取得エラー: ${event.target.error}`);
            store.transaction.onerror = (event) => reject(`タイトル更新トランザクション失敗: ${event.target.error}`);
        });
    },

    // 指定IDのチャットを取得
    async getChat(id) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(CHATS_STORE);
            const request = store.get(id);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`チャット ${id} 取得エラー: ${event.target.error}`);
        });
    },

    // 全チャットを取得 (ソート順指定可)
    async getAllChats(sortBy = 'updatedAt') {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(CHATS_STORE);
            const indexName = sortBy === 'createdAt' ? CHAT_CREATEDAT_INDEX : CHAT_UPDATEDAT_INDEX;
            // インデックスが存在するか確認
            if (!store.indexNames.contains(indexName)) {
                 console.error(`インデックス "${indexName}" が見つかりません。主キー順でフォールバックします。`);
                 // フォールバック: 主キー順で取得して逆順にする
                 const getAllRequest = store.getAll();
                 getAllRequest.onsuccess = (event) => resolve(event.target.result.reverse()); // 新しいものが上に来るように
                 getAllRequest.onerror = (event) => reject(`全チャット取得エラー(フォールバック): ${event.target.error}`);
                 return;
            }
            // インデックスを使ってカーソルを開く (降順)
            const index = store.index(indexName);
            const request = index.openCursor(null, 'prev'); // 'prev'で降順
            const chats = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    chats.push(cursor.value);
                    cursor.continue();
                } else {
                    // カーソル終了
                    resolve(chats);
                }
            };
            request.onerror = (event) => reject(`全チャット取得エラー (${sortBy}順): ${event.target.error}`);
        });
    },

    // 指定IDのチャットを削除
    async deleteChat(id) {
        await this.openDB();
        
        // Step 1: 削除対象のチャットから画像IDを収集
        const chatToDelete = await this.getChat(id);
        const imageIdsToDelete = new Set();
        if (chatToDelete && chatToDelete.messages) {
            chatToDelete.messages.forEach(message => {
                (message.imageIds || []).forEach(imgId => imageIdsToDelete.add(imgId));
            });
        }

        // Step 2: 他のチャットで同じ画像IDが使われていないか確認 (安全対策)
        const allOtherChats = (await this.getAllChats()).filter(chat => chat.id !== id);
        const activeImageIdsInOtherChats = new Set();
        allOtherChats.forEach(chat => {
            (chat.messages || []).forEach(message => {
                (message.imageIds || []).forEach(imgId => activeImageIdsInOtherChats.add(imgId));
            });
        });

        const finalImageIdsToDelete = [...imageIdsToDelete].filter(id => !activeImageIdsInOtherChats.has(id));

        // Step 3: トランザクション内でチャットと画像の削除を実行
        return new Promise((resolve, reject) => {
            const storeNames = [CHATS_STORE];
            if (finalImageIdsToDelete.length > 0) {
                storeNames.push(IMAGE_STORE);
            }
            
            const transaction = state.db.transaction(storeNames, 'readwrite');
            const chatStore = transaction.objectStore(CHATS_STORE);

            // チャットを削除
            chatStore.delete(id);

            // 孤立した画像を削除
            if (finalImageIdsToDelete.length > 0) {
                const imageStore = transaction.objectStore(IMAGE_STORE);
                console.log(`[Delete Chat] チャット(ID:${id})に関連する ${finalImageIdsToDelete.length}件の画像をimage_storeから削除します。`);
                finalImageIdsToDelete.forEach(imgId => imageStore.delete(imgId));
            }

            transaction.oncomplete = () => {
                console.log(`チャット削除完了 (ID: ${id})`);
                appLogic.markAsDirtyAndSchedulePush(true);
                resolve();
            };
            transaction.onerror = (event) => {
                console.error(`チャット(ID:${id})の削除トランザクション中にエラー:`, event.target.error);
                reject(`チャット ${id} 削除エラー: ${event.target.error}`);
            };
        });
    },


    // 全データ (設定とチャット) をクリア
    async clearAllData() {
        await this.openDB();
        return new Promise((resolve, reject) => {
            // DBに存在するすべてのストア名をトランザクションの対象にする
            const storeNames = Array.from(state.db.objectStoreNames);
            if (storeNames.length === 0) {
                console.log("クリア対象のストアが存在しません。");
                resolve();
                return;
            }
            
            console.log(`以下のストアをクリアします: ${storeNames.join(', ')}`);
            const transaction = state.db.transaction(storeNames, 'readwrite');
            let storesCleared = 0;
            const totalStores = storeNames.length;

            transaction.oncomplete = () => {
                console.log("IndexedDBの全データ削除完了");
                resolve();
            };
            transaction.onerror = (event) => {
                reject(`データクリアトランザクション失敗: ${event.target.error}`);
            };

            // 各ストアに対してクリア処理を実行
            storeNames.forEach(storeName => {
                const request = transaction.objectStore(storeName).clear();
                request.onerror = (event) => {
                    console.error(`${storeName} のクリア中にエラー:`, event.target.error);
                };
            });
        });
    },

    async getSetting(key) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(SETTINGS_STORE);
                const request = store.get(key);
                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };
                request.onerror = (event) => {
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    async addProfile(profile) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(PROFILES_STORE, 'readwrite');
            const request = store.add(profile);
            request.onsuccess = (event) => {
                console.log(`[DB] プロファイルを新規追加しました (ID: ${event.target.result})`);
                resolve(event.target.result);
            };
            request.onerror = (event) => reject(`プロファイル追加エラー: ${event.target.error}`);
        });
    },

    async getProfile(id) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(PROFILES_STORE);
            const request = store.get(id);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`プロファイル(ID: ${id})取得エラー: ${event.target.error}`);
        });
    },

    async getAllProfiles() {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(PROFILES_STORE);
            const request = store.getAll();
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`全プロファイル取得エラー: ${event.target.error}`);
        });
    },

    async updateProfile(profile) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(PROFILES_STORE, 'readwrite');
            const request = store.put(profile);
            request.onsuccess = () => {
                console.log(`[DB] プロファイルを更新しました (ID: ${profile.id})`);
                resolve();
            };
            request.onerror = (event) => reject(`プロファイル(ID: ${profile.id})更新エラー: ${event.target.error}`);
        });
    },

    async deleteProfile(id) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore(PROFILES_STORE, 'readwrite');
            const request = store.delete(id);
            request.onsuccess = () => {
                console.log(`[DB] プロファイルを削除しました (ID: ${id})`);
                resolve();
            };
            request.onerror = (event) => reject(`プロファイル(ID: ${id})削除エラー: ${event.target.error}`);
        });
    },

    async getAsset(name) {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore('image_assets');
            const request = store.get(name);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`アセット ${name} 取得エラー: ${event.target.error}`);
        });
    },


    async getAllAssets() {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore('image_assets');
            const request = store.getAll();
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`全アセット取得エラー: ${event.target.error}`);
        });
    },
    async getMemory(profileId) {
        if (!profileId) return null;
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore('memory_store');
            const request = store.get(profileId);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`メモリ(ID: ${profileId})取得エラー: ${event.target.error}`);
        });
    },

    async saveMemory(profileId, memoryData) {
        if (!profileId) return Promise.reject("プロファイルIDが必要です。");
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore('memory_store', 'readwrite');
            const dataToSave = { profileId, ...memoryData };
            const request = store.put(dataToSave);
            request.onsuccess = () => {
                console.log(`[DB] メモリを保存しました (ID: ${profileId})`);
                resolve();
            };
            request.onerror = (event) => reject(`メモリ(ID: ${profileId})保存エラー: ${event.target.error}`);
        });
    },
    async getAllMemories() {
        await this.openDB();
        return new Promise((resolve, reject) => {
            const store = this._getStore('memory_store');
            const request = store.getAll();
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`全メモリ取得エラー: ${event.target.error}`);
        });
    },

    /**
     * [V2] メタデータを受け取り、アセットをDLしてからDBをクリア＆インポートする
     */
     async clearAndImportData(data, localAssetsBeforeClear, downloadedAssets, requiredAssetIds) {
        console.log("[DB Import V2] 安全なデータインポート処理を開始します。");
        uiUtils.showProgressDialog('データベースを準備中...');

        const { profiles, chats, memories, assets, settings } = data;
        
        const allAvailableAssets = new Map([...localAssetsBeforeClear, ...downloadedAssets]);
        console.log(`[DB Import V2] 利用可能なアセットの完全なマップを作成しました: ${allAvailableAssets.size}件`);

        // 欠落しているアセットIDを記録するオブジェクト（チャット単位）
        const missingAssetInfo = {};

        (chats || []).forEach(chat => {
            const missingIdsForThisChat = new Set();
            (chat.messages || []).forEach(message => {
                if (Array.isArray(message.imageIds) && message.imageIds.length > 0) {
                    message.imageIds.forEach(id => {
                        if (id && !allAvailableAssets.has(id)) {
                            missingIdsForThisChat.add(id);
                        }
                    });
                }
            });
            if (missingIdsForThisChat.size > 0) {
                const key = chat.title || `ID:${chat.id}`;
                missingAssetInfo[key] = [...missingIdsForThisChat];
            }
        });

        if (Object.keys(missingAssetInfo).length > 0) {
            console.error("[DB Import V2] 必要な画像アセットの一部が見つからないため、インポートを中止します。", missingAssetInfo);
            const error = new Error("必要な画像アセットのダウンロードに失敗したため、データのインポートを中止しました。再度同期をお試しください。");
            error.code = 'MISSING_ASSETS';
            error.missingAssetInfo = missingAssetInfo;
            throw error;
        }

        const profilesWithBlobs = (profiles || []).map(p => {
            if (p.iconAssetId && allAvailableAssets.has(p.iconAssetId)) {
                p.icon = allAvailableAssets.get(p.iconAssetId);
            }
            return p;
        });
        const assetsWithBlobs = (assets || []).map(a => ({
            name: a.name,
            assetId: a.assetId,
            blob: allAvailableAssets.get(a.assetId),
            createdAt: a.createdAt
        })).filter(a => a.blob);

        const imagesWithBlobs = [];
        requiredAssetIds.forEach(id => {
            if (allAvailableAssets.has(id)) {
                imagesWithBlobs.push({
                    id: id,
                    blob: allAvailableAssets.get(id),
                    createdAt: new Date()
                });
            }
        });
        
        const tempStoreNames = [
            `${PROFILES_STORE}_temp`, `${CHATS_STORE}_temp`, `${SETTINGS_STORE}_temp`,
            `${IMAGE_STORE}_temp`, 'image_assets_temp', 'memory_store_temp'
        ];
        const mainStoreNames = [
            PROFILES_STORE, CHATS_STORE, SETTINGS_STORE,
            IMAGE_STORE, 'image_assets', 'memory_store'
        ];

        const currentTokens = await dbUtils.getSetting('dropboxTokens');

        try {
            uiUtils.updateProgressMessage('データを一時領域にインポート中...');
            const tempTx = state.db.transaction(tempStoreNames, 'readwrite');
            const tempStores = {
                'profiles_temp': profilesWithBlobs,
                'chats_temp': chats || [],
                'memory_store_temp': memories || [],
                'image_assets_temp': assetsWithBlobs,
                'image_store_temp': imagesWithBlobs,
                'settings_temp': settings || []
            };

            const tempClearPromises = tempStoreNames.map(name => {
                return new Promise((resolve, reject) => {
                    const request = tempTx.objectStore(name).clear();
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                });
            });
            await Promise.all(tempClearPromises);

            for (const storeName in tempStores) {
                const store = tempTx.objectStore(storeName);
                (tempStores[storeName] || []).forEach(item => store.put(item));
            }
            
            await new Promise((resolve, reject) => {
                tempTx.oncomplete = resolve;
                tempTx.onerror = () => reject(tempTx.error);
            });
            console.log("[DB Import V2] 一時ストアへのデータ書き込みが完了しました。");

            uiUtils.updateProgressMessage('データベースを更新中...');
            const mainTx = state.db.transaction([...mainStoreNames, ...tempStoreNames], 'readwrite');
            
            const mainClearPromises = mainStoreNames.map(name => {
                return new Promise((resolve, reject) => {
                    const request = mainTx.objectStore(name).clear();
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                });
            });
            await Promise.all(mainClearPromises);

            for (let i = 0; i < mainStoreNames.length; i++) {
                const mainStore = mainTx.objectStore(mainStoreNames[i]);
                const tempStore = mainTx.objectStore(tempStoreNames[i]);
                const allTempItemsReq = tempStore.getAll();
                allTempItemsReq.onsuccess = () => {
                    allTempItemsReq.result.forEach(item => mainStore.put(item));
                };
            }
            
            const tempClearPromises2 = tempStoreNames.map(name => {
                return new Promise((resolve, reject) => {
                    const request = mainTx.objectStore(name).clear();
                    request.onsuccess = resolve;
                    request.onerror = () => reject(request.error);
                });
            });
            await Promise.all(tempClearPromises2);

            if (currentTokens) {
                mainTx.objectStore(SETTINGS_STORE).put(currentTokens);
            }

            await new Promise((resolve, reject) => {
                mainTx.oncomplete = resolve;
                mainTx.onerror = () => reject(mainTx.error);
            });
            console.log("[DB Import V2] メインデータベースの更新が正常に完了しました。");

            // 処理結果を返す
            return { removedAssetInfo: missingAssetInfo };

        } catch (error) {
            console.error("[DB Import V2] 安全なインポート処理中にエラーが発生しました:", error);
            try {
                const cleanupTx = state.db.transaction(tempStoreNames, 'readwrite');
                const cleanupPromises = tempStoreNames.map(name => {
                    return new Promise((resolve, reject) => {
                        const request = cleanupTx.objectStore(name).clear();
                        request.onsuccess = resolve;
                        request.onerror = () => reject(request.error);
                    });
                });
                await Promise.all(cleanupPromises);
            } catch (cleanupError) {
                console.error("[DB Import V2] エラー後のクリーンアップに失敗:", cleanupError);
            }
            throw error;
        }
    },
};

// --- UIユーティリティ (uiUtils) ---
const uiUtils = {
    setLoadingIndicatorText(text) {
        elements.loadingIndicator.textContent = text;
    },
    // APIタイムアウトオプションの表示/非表示を制御
    updateApiTimeoutOptionsVisibility() {
        const isEnabled = elements.enableApiTimeoutCheckbox.checked;
        elements.apiTimeoutOptions.style.display = isEnabled ? 'block' : 'none';
        elements.apiTimeoutSecondsInput.disabled = !isEnabled;
    },
    // オーバーレイの透明度を適用
    applyOverlayOpacity() {
        const opacityValue = state.settings.overlayOpacity ?? 0.75; // デフォルト値を0.75に
        document.documentElement.style.setProperty('--overlay-opacity-value', opacityValue);
        console.log(`オーバーレイ透明度適用: ${opacityValue}`);
    },

    // 新しいメッセージ要素をコンテナの末尾に追加する（ちらつき防止用）
    appendMessage(role, content, index, isStreamingPlaceholder = false, cascadeInfo = null, attachments = null) {
        const messageElement = this.createMessageElement(role, content, index, isStreamingPlaceholder, cascadeInfo, attachments);
        if (messageElement) {
            elements.messageContainer.appendChild(messageElement);
            if (window.Prism) {
                // 追加した要素内のコードブロックのみをハイライトする
                messageElement.querySelectorAll('pre code').forEach((block) => {
                    Prism.highlightElement(block);
                });
            }
        }
    },

renderChatMessages() {
    const renderStartTime = performance.now();

    const container = elements.messageContainer;
    
    container.style.minHeight = `${container.scrollHeight}px`;

    if (state.imageUrlCache.size > 0) {
        for (const url of state.imageUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        state.imageUrlCache.clear();
    }
    if (state.editingMessageIndex !== null) {
        const messageElement = container.querySelector(`.message[data-index="${state.editingMessageIndex}"]`);
        if (messageElement) appLogic.cancelEditMessage(state.editingMessageIndex, messageElement);
        else state.editingMessageIndex = null;
    }

    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    // 新しいヘルパー関数で表示対象メッセージを取得
    const visibleMessages = appLogic.getVisibleMessages();

    // 要約マーカー表示ロジック
    const summaryEndIndex = state.currentSummarizedContext?.summaryRange?.end;
    let markerInserted = false;

    visibleMessages.forEach(msg => {
        const index = state.currentMessages.indexOf(msg);
        if (index === -1 || msg.role === 'tool') return;
        
        // メッセージのインデックスが要約範囲の終端と一致したらマーカーを挿入
        if (!markerInserted && summaryEndIndex !== undefined && index >= summaryEndIndex) {
            const markerDiv = document.createElement('div');
            markerDiv.className = 'summary-marker';
            const markerText = document.createElement('span');
            markerText.className = 'summary-marker-text';
            const summarizedDate = new Date(state.currentSummarizedContext.summarizedAt).toLocaleString('ja-JP');
            markerText.textContent = `ここまで要約済み (${summarizedDate})`;
            markerDiv.appendChild(markerText);
            fragment.appendChild(markerDiv);
            markerInserted = true;
        }

        let cascadeInfo = null;
        if (msg.isCascaded && msg.siblingGroupId) {
            const siblings = state.currentMessages.filter(m => m.siblingGroupId === msg.siblingGroupId && !m.isHidden);
            const currentIndexInGroup = siblings.findIndex(m => m === msg);
            cascadeInfo = {
                currentIndex: currentIndexInGroup + 1,
                total: siblings.length,
                siblingGroupId: msg.siblingGroupId
            };
        }
        
        const messageElement = uiUtils.createMessageElement(msg.role, msg.content, index, false, cascadeInfo, msg.attachments);
        if (messageElement) {
            fragment.appendChild(messageElement);
        }
    });
    
    // ループ後にマーカーが挿入されなかった場合（＝全履歴が要約対象だった場合）の処理
    if (!markerInserted && summaryEndIndex !== undefined && state.currentMessages.length > 0 && state.currentMessages.length <= summaryEndIndex) {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'summary-marker';
        const markerText = document.createElement('span');
        markerText.className = 'summary-marker-text';
        const summarizedDate = new Date(state.currentSummarizedContext.summarizedAt).toLocaleString('ja-JP');
        markerText.textContent = `ここまで要約済み (${summarizedDate})`;
        markerDiv.appendChild(markerText);
        fragment.appendChild(markerDiv);
        markerInserted = true;
    }

    container.appendChild(fragment);
    
    if (window.Prism) {
        const highlightStartTime = performance.now();
        Prism.highlightAll();
        const highlightEndTime = performance.now();
    }
    
    requestAnimationFrame(() => {
        container.style.minHeight = '';
    });
    
    appLogic.updateSummarizeButtonState();
    const renderEndTime = performance.now();
},

createMessageElement(role, content, index, isStreamingPlaceholder = false, cascadeInfo = null, attachments = null) {
    const messageData = state.currentMessages[index];
    if (!messageData) return null;

    const summaryEndIndex = state.currentSummarizedContext?.summaryRange?.end;
    const isSummarized = summaryEndIndex !== undefined && index < summaryEndIndex;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', role);
    messageDiv.dataset.index = index;
    
    if (role === 'model' && messageData && messageData.thoughtSummary) {
        const thoughtDetails = document.createElement('details');
        thoughtDetails.classList.add('thought-summary-details');
        const thoughtSummaryElem = document.createElement('summary');
        thoughtSummaryElem.textContent = '思考プロセス';
        thoughtDetails.appendChild(thoughtSummaryElem);
        const thoughtContentDiv = document.createElement('div');
        thoughtContentDiv.classList.add('thought-summary-content');
        if (isStreamingPlaceholder) {
            thoughtContentDiv.id = `streaming-thought-summary-${index}`;
        } else {
            try {
                thoughtContentDiv.innerHTML = marked.parse(messageData.thoughtSummary || '');
            } catch (e) {
                console.error("Thought Summary Markdownパースエラー:", e);
                thoughtContentDiv.textContent = messageData.thoughtSummary || '';
            }
        }
        thoughtDetails.appendChild(thoughtContentDiv);
        messageDiv.appendChild(thoughtDetails);
    }

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    if (isStreamingPlaceholder) {
        contentDiv.id = `streaming-content-${index}`;
    }

    if (role === 'user' && attachments && attachments.length > 0) {
        const details = document.createElement('details');
        details.classList.add('attachment-details');
        details.open = false; // 最初から展開状態にする
        const summary = document.createElement('summary');
        summary.textContent = `添付ファイル (${attachments.length}件)`;
        details.appendChild(summary);
        const list = document.createElement('ul');
        list.classList.add('attachment-list');
        
        attachments.forEach(att => {
            const listItem = document.createElement('li');
            
            const mimeType = att.mimeType || '';
            let previewElement;

            if (mimeType.startsWith('image/')) {
                previewElement = document.createElement('img');
                previewElement.className = 'attachment-thumbnail';
                previewElement.alt = att.name;
                
                // 同期後のデータ(base64Data)からもサムネイルを生成できるようにする
                if (att.file instanceof Blob) {
                    const objectURL = URL.createObjectURL(att.file);
                    previewElement.src = objectURL;
                    state.imageUrlCache.set(objectURL, true);
                } else if (att.base64Data) {
                    // base64からBlobを生成してURLを作成
                    base64ToBlob(att.base64Data, att.mimeType)
                        .then(blob => {
                            const objectURL = URL.createObjectURL(blob);
                            previewElement.src = objectURL;
                            state.imageUrlCache.set(objectURL, true);
                        })
                        .catch(err => {
                            console.error('Base64からサムネイル用Blobへの変換に失敗:', err);
                            previewElement.alt = 'プレビュー失敗';
                        });
                }

            } else if (mimeType.startsWith('video/')) {
                previewElement = document.createElement('video');
                previewElement.className = 'attachment-thumbnail';
                previewElement.muted = true;
                previewElement.playsInline = true;
                if (att.file instanceof Blob) {
                    const objectURL = URL.createObjectURL(att.file);
                    previewElement.src = objectURL;
                    state.videoUrlCache.set(objectURL, true);
                } else if (att.base64Data) {
                    base64ToBlob(att.base64Data, att.mimeType)
                        .then(blob => {
                            const objectURL = URL.createObjectURL(blob);
                            previewElement.src = objectURL;
                            state.videoUrlCache.set(objectURL, true);
                        })
                        .catch(err => console.error('Base64から動画用Blobへの変換に失敗:', err));
                }
            } else {
                previewElement = document.createElement('span');
                previewElement.className = 'attachment-thumbnail material-symbols-outlined';
                previewElement.style.display = 'flex';
                previewElement.style.alignItems = 'center';
                previewElement.style.justifyContent = 'center';
                previewElement.textContent = 'description';
            }
            
            if (previewElement.tagName === 'IMG' || previewElement.tagName === 'VIDEO') {
                previewElement.onclick = () => {
                    const modalOverlay = document.getElementById('image-modal-overlay');
                    const modalImg = document.getElementById('image-modal-img'); // 正しいIDを参照
                    
                    // modalContentではなく、存在する要素を直接操作する
                    if (modalOverlay && modalImg) {
                        if (previewElement.tagName === 'IMG') {
                            modalImg.src = previewElement.src;
                            modalOverlay.classList.remove('hidden');
                        } else {
                            // 動画の場合は新しいタブで開くなどの代替案も考えられる
                            console.warn("動画のモーダル表示は現在サポートされていません。");
                        }
                    } else {
                        console.error("画像拡大用のモーダル要素が見つかりません。");
                    }
                };
            }

            const filenameSpan = document.createElement('span');
            filenameSpan.className = 'attachment-filename';
            filenameSpan.textContent = att.name;
            filenameSpan.title = `${att.name} (${att.mimeType})`;

            listItem.appendChild(previewElement);
            listItem.appendChild(filenameSpan);
            list.appendChild(listItem);
        });
        details.appendChild(list);
        contentDiv.appendChild(details);

        if (content && content.trim() !== '') {
            const pre = document.createElement('pre');
            pre.textContent = content;
            pre.style.marginTop = '8px';
            contentDiv.appendChild(pre);
        }
    } 

    else {
        try {
            if (content && (role === 'model' || role === 'user')) {
                 if (role === 'model' && !isStreamingPlaceholder && typeof marked !== 'undefined') {
                    contentDiv.innerHTML = marked.parse(content || '');
                } else {
                    const pre = document.createElement('pre'); pre.textContent = content; contentDiv.appendChild(pre);
                }
            } else if (role === 'error') {
                 const p = document.createElement('p'); p.textContent = content; contentDiv.appendChild(p);
            }
        } catch (e) {
             console.error("Markdownパースエラー:", e);
             const pre = document.createElement('pre'); pre.textContent = content; contentDiv.innerHTML = ''; contentDiv.appendChild(pre);
        }
    }
    messageDiv.appendChild(contentDiv);
            
    const imagePlaceholderRegex = /<p>\[IMAGE_HERE\]<\/p>|\[IMAGE_HERE\]/g;
    if (role === 'model' && messageData && messageData.imageIds && messageData.imageIds.length > 0) {
        let imageIndex = 0;
        const replacedHtml = contentDiv.innerHTML.replace(imagePlaceholderRegex, () => {
            if (imageIndex < messageData.imageIds.length) {
                const imageId = messageData.imageIds[imageIndex++];
                return `<img class="lazy-load-image" alt="生成画像（読み込み中...）" data-image-id="${imageId}">`;
            }
            return '';
        });
        contentDiv.innerHTML = replacedHtml;

        if (imageIndex < messageData.imageIds.length) {
            const fragment = document.createDocumentFragment();
            for (let i = imageIndex; i < messageData.imageIds.length; i++) {
                const imageId = messageData.imageIds[i];
                const img = document.createElement('img');
                img.className = 'lazy-load-image';
                img.alt = '生成画像（読み込み中...）';
                img.dataset.imageId = imageId;
                fragment.appendChild(img);
            }
            contentDiv.appendChild(fragment);
        }
        requestAnimationFrame(() => {
            const newImages = contentDiv.querySelectorAll('.lazy-load-image');
            newImages.forEach(img => appLogic.imageObserver.observe(img));
        });
    }
    
    if (role === 'model' && messageData && messageData.groundingMetadata &&
        ( (messageData.groundingMetadata.groundingChunks && messageData.groundingMetadata.groundingChunks.length > 0) ||
          (messageData.groundingMetadata.webSearchQueries && messageData.groundingMetadata.webSearchQueries.length > 0) )
       )
    {
        try {
            const details = document.createElement('details');
            details.classList.add('citation-details');
            const summary = document.createElement('summary');
            summary.textContent = '引用元/検索クエリ';
            details.appendChild(summary);
            let detailsHasContent = false;
            if (messageData.groundingMetadata.groundingChunks && messageData.groundingMetadata.groundingChunks.length > 0) {
                const citationList = document.createElement('ul');
                citationList.classList.add('citation-list');
                const citationMap = new Map();
                let displayIndexCounter = 1;
                if (messageData.groundingMetadata.groundingSupports) {
                    messageData.groundingMetadata.groundingSupports.forEach(support => {
                        if (support.groundingChunkIndices) {
                            support.groundingChunkIndices.forEach(chunkIndex => {
                                if (!citationMap.has(chunkIndex) && chunkIndex >= 0 && chunkIndex < messageData.groundingMetadata.groundingChunks.length) {
                                    const chunk = messageData.groundingMetadata.groundingChunks[chunkIndex];
                                    if (chunk?.web?.uri) {
                                        citationMap.set(chunkIndex, {
                                            uri: chunk.web.uri,
                                            title: chunk.web.title || 'タイトル不明',
                                            displayIndex: displayIndexCounter++
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
                const sortedCitations = Array.from(citationMap.entries())
                                            .sort(([, a], [, b]) => a.displayIndex - b.displayIndex);
                sortedCitations.forEach(([chunkIndex, citationInfo]) => {
                    const listItem = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = citationInfo.uri;
                    link.textContent = `[${citationInfo.displayIndex}] ${citationInfo.title}`;
                    link.title = citationInfo.title;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    listItem.appendChild(link);
                    citationList.appendChild(listItem);
                });
                if (sortedCitations.length === 0) {
                     messageData.groundingMetadata.groundingChunks.forEach((chunk, idx) => {
                         if (chunk?.web?.uri) {
                             const listItem = document.createElement('li');
                             const link = document.createElement('a');
                             link.href = chunk.web.uri;
                             link.textContent = chunk.web.title || `ソース ${idx + 1}`;
                             link.title = chunk.web.title || 'タイトル不明';
                             link.target = '_blank';
                             link.rel = 'noopener noreferrer';
                             listItem.appendChild(link);
                             citationList.appendChild(listItem);
                         }
                     });
                }
                if (citationList.hasChildNodes()) {
                    details.appendChild(citationList);
                    detailsHasContent = true;
                }
            }
            if (messageData.groundingMetadata.webSearchQueries && messageData.groundingMetadata.webSearchQueries.length > 0) {
                if (detailsHasContent) {
                    const separator = document.createElement('hr');
                    separator.style.marginTop = '10px';
                    separator.style.marginBottom = '8px';
                    separator.style.border = 'none';
                    separator.style.borderTop = '1px dashed var(--border-tertiary)'; 
                    details.appendChild(separator);
                }
                const queryHeader = document.createElement('div');
                queryHeader.textContent = '検索に使用されたクエリ:';
                queryHeader.style.fontWeight = '500';
                queryHeader.style.marginTop = detailsHasContent ? '0' : '8px';
                queryHeader.style.marginBottom = '4px';
                queryHeader.style.fontSize = '11px';
                queryHeader.style.color = 'var(--text-secondary)';
                details.appendChild(queryHeader);
                const queryList = document.createElement('ul');
                queryList.classList.add('search-query-list');
                queryList.style.listStyle = 'none';
                queryList.style.paddingLeft = '0';
                queryList.style.margin = '0';
                queryList.style.fontSize = '11px';
                queryList.style.color = 'var(--text-secondary)';
                messageData.groundingMetadata.webSearchQueries.forEach(query => {
                    const queryItem = document.createElement('li');
                    queryItem.textContent = `• ${query}`;
                    queryItem.style.marginBottom = '3px';
                    queryList.appendChild(queryItem);
                });
                details.appendChild(queryList);
                detailsHasContent = true;
            }
            if (detailsHasContent) {
                contentDiv.appendChild(details);
            }
        } catch (e) {
            console.error(`引用元/検索クエリ表示の生成中にエラーが発生しました (index: ${index}):`, e);
        }
    }
    
    if (role === 'model' && messageData && messageData.executedFunctions && messageData.executedFunctions.length > 0) {
        const details = document.createElement('details');
        details.classList.add('function-call-details');
        const uniqueFunctions = [...new Set(messageData.executedFunctions)];
        const summary = document.createElement('summary');
        summary.innerHTML = `⚙️ ツール使用 (${uniqueFunctions.length}件)`;
        details.appendChild(summary);
        const list = document.createElement('ul');
        list.classList.add('function-call-list');
        uniqueFunctions.forEach(funcName => {
            const listItem = document.createElement('li');
            listItem.textContent = funcName;
            list.appendChild(listItem);
        });
        details.appendChild(list);
        if (contentDiv.innerHTML.trim() !== '') {
            contentDiv.appendChild(details);
        } else {
            messageDiv.appendChild(details);
        }
    }

    if (role === 'model' && messageData && messageData.search_web_results && messageData.search_web_results.length > 0) {
        const details = document.createElement('details');
        details.classList.add('function-call-details');
        const summary = document.createElement('summary');
        summary.innerHTML = `🌐 Web検索結果 (${messageData.search_web_results.length}件)`;
        details.appendChild(summary);
        const list = document.createElement('ul');
        list.classList.add('function-call-list');
        messageData.search_web_results.forEach(result => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = result.link;
            link.textContent = result.title;
            link.title = result.snippet;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            listItem.appendChild(link);
            list.appendChild(listItem);
        });
        details.appendChild(list);
        if (contentDiv.innerHTML.trim() !== '') {
            contentDiv.appendChild(details);
        } else {
            messageDiv.appendChild(details);
        }
    }

    if (role === 'model' && messageData && messageData.generated_videos && messageData.generated_videos.length > 0) {
        const videoData = messageData.generated_videos[0];
        if (videoData && (videoData.url || videoData.base64Data)) {
            const video = document.createElement('video');
            video.controls = true; 
            video.playsInline = true; 
            video.muted = true; 
            video.loop = true; 
            video.style.maxWidth = '100%';
            video.style.borderRadius = 'var(--border-radius-md)';
            video.style.display = 'block';

            if (videoData.url) {
                video.src = videoData.url;
            } else if (videoData.base64Data) {
                base64ToBlob(videoData.base64Data, 'video/mp4')
                    .then(blob => {
                        const objectURL = URL.createObjectURL(blob);
                        video.src = objectURL;
                    })
                    .catch(err => {
                        console.error("Base64からの動画Blob生成に失敗:", err);
                        video.remove();
                    });
            }

            const placeholderRegex = /\[VIDEO_HERE\]/g;
            if (placeholderRegex.test(contentDiv.innerHTML)) {
                let replaced = false;
                contentDiv.innerHTML = contentDiv.innerHTML.replace(placeholderRegex, (match) => {
                    if (!replaced) {
                        replaced = true;
                        return video.outerHTML;
                    }
                    return '';
                });
            }
        }
    }

    const editArea = document.createElement('div');
    editArea.classList.add('message-edit-area', 'hidden');
    messageDiv.appendChild(editArea);

    if (role === 'model' && cascadeInfo && cascadeInfo.total > 1) {
        const cascadeControlsDiv = document.createElement('div');
        cascadeControlsDiv.classList.add('message-cascade-controls');
        const prevButton = document.createElement('button');
        prevButton.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
        prevButton.title = '前の応答';
        prevButton.classList.add('cascade-prev-btn');
        prevButton.disabled = cascadeInfo.currentIndex <= 1;
        prevButton.onclick = () => appLogic.navigateCascade(index, 'prev');
        cascadeControlsDiv.appendChild(prevButton);
        const indicatorSpan = document.createElement('span');
        indicatorSpan.classList.add('cascade-indicator');
        indicatorSpan.textContent = `${cascadeInfo.currentIndex}/${cascadeInfo.total}`;
        cascadeControlsDiv.appendChild(indicatorSpan);
        const nextButton = document.createElement('button');
        nextButton.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
        nextButton.title = '次の応答';
        nextButton.classList.add('cascade-next-btn');
        nextButton.disabled = cascadeInfo.currentIndex >= cascadeInfo.total;
        nextButton.onclick = () => appLogic.navigateCascade(index, 'next');
        cascadeControlsDiv.appendChild(nextButton);
        const deleteCascadeButton = document.createElement('button');
        deleteCascadeButton.innerHTML = '<span class="material-symbols-outlined">delete</span>';
        deleteCascadeButton.title = 'この応答を削除';
        deleteCascadeButton.classList.add('cascade-delete-btn');
        deleteCascadeButton.onclick = () => appLogic.confirmDeleteCascadeResponse(index);
        cascadeControlsDiv.appendChild(deleteCascadeButton);
        messageDiv.appendChild(cascadeControlsDiv);
    }

    if (role !== 'error') {
        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('message-actions');

        if (!isSummarized) {
            const editButton = document.createElement('button');
            editButton.innerHTML = '<span class="material-symbols-outlined">edit</span> 編集'; 
            editButton.title = 'メッセージを編集'; 
            editButton.classList.add('js-edit-btn');
            editButton.onclick = () => appLogic.startEditMessage(index, messageDiv);
            actionsDiv.appendChild(editButton);
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<span class="material-symbols-outlined">delete</span> 削除'; 
            deleteButton.title = 'この会話ターンを削除'; 
            deleteButton.classList.add('js-delete-btn');
            deleteButton.onclick = () => appLogic.deleteMessage(index);
            actionsDiv.appendChild(deleteButton);
            if (role === 'user') {
                const retryButton = document.createElement('button');
                retryButton.innerHTML = '<span class="material-symbols-outlined">replay</span> 再生成'; 
                retryButton.title = 'このメッセージから再生成'; 
                retryButton.classList.add('js-retry-btn');
                retryButton.onclick = () => appLogic.retryFromMessage(index);
                actionsDiv.appendChild(retryButton);
            }
        }

        if (role === 'model' && messageData?.usageMetadata &&
            typeof messageData.usageMetadata.candidatesTokenCount === 'number' &&
            typeof messageData.usageMetadata.totalTokenCount === 'number')
        {
            const usage = messageData.usageMetadata;
            const tokenSpan = document.createElement('span');
            tokenSpan.classList.add('token-count-display');
            let finalTotalTokenCount = usage.totalTokenCount;
            if (typeof messageData.usageMetadata.thoughtsTokenCount === 'number') {
                finalTotalTokenCount -= messageData.usageMetadata.thoughtsTokenCount;
            }
            const formattedCandidates = usage.candidatesTokenCount.toLocaleString('en-US');
            const formattedTotal = finalTotalTokenCount.toLocaleString('en-US');
            tokenSpan.textContent = `${formattedCandidates} / ${formattedTotal}`;
            tokenSpan.title = `Candidate Tokens / Total Tokens`;
            actionsDiv.appendChild(tokenSpan);
        }
        if (role === 'model' && typeof messageData?.retryCount === 'number' && messageData.retryCount > 0) {
            const retrySpan = document.createElement('span');
            retrySpan.classList.add('token-count-display');
            retrySpan.textContent = `(リトライ: ${messageData.retryCount}回)`;
            retrySpan.title = `APIリクエストを${messageData.retryCount}回再試行した結果です`;
            if (actionsDiv.querySelector('.token-count-display')) {
                retrySpan.style.marginLeft = '8px';
            }
            actionsDiv.appendChild(retrySpan);
        }
        
        if (actionsDiv.hasChildNodes()) {
            messageDiv.appendChild(actionsDiv);
        }
    }

    if (isStreamingPlaceholder) {
        messageDiv.id = `streaming-message-${index}`;
    }
    return messageDiv;
},


    // エラーメッセージを表示
    displayError(message, isApiError = false) {
        console.error("エラー表示:", message);
        const errorIndex = state.currentMessages.length; // 現在のメッセージリストの末尾に追加
        this.appendMessage('error', `エラー: ${message}`, errorIndex);
        elements.loadingIndicator.classList.add('hidden'); // ローディング非表示
        this.setSendingState(false); // 送信状態解除
    },
    // チャットタイトルを更新
    updateChatTitle(definitiveTitle = null) {
        let titleText = '新規チャット';
        let baseTitle = '';
        let isNewChat = !state.currentChatId;

        if (state.currentChatId) {
            isNewChat = false;
            if (definitiveTitle !== null) {
                baseTitle = definitiveTitle;
            } else {
                const firstUserMessage = state.currentMessages.find(m => m.role === 'user' && !m.isHidden);
                if (firstUserMessage) {
                    baseTitle = firstUserMessage.content;
                } else if (state.currentMessages.length > 0) {
                    baseTitle = "チャット履歴";
                }
            }
            if(baseTitle) {
                const displayBase = baseTitle.startsWith(IMPORT_PREFIX) ? baseTitle.substring(IMPORT_PREFIX.length) : baseTitle;
                const truncated = displayBase.substring(0, CHAT_TITLE_LENGTH);
                titleText = truncated + (displayBase.length > CHAT_TITLE_LENGTH ? '...' : '');
                if (baseTitle.startsWith(IMPORT_PREFIX)) {
                    titleText = IMPORT_PREFIX + titleText;
                }
            } else if(state.currentMessages.length > 0) {
                titleText = 'チャット履歴';
            }
            if (titleText === '新規チャット' && state.currentMessages.length > 0) {
                titleText = 'チャット履歴';
            }
        }
        
        // コロンを削除
        const displayTitle = titleText;
        elements.chatTitle.textContent = displayTitle;
        document.title = `Gemini PWA Mk-II - ${titleText}`;
    },


    // タイムスタンプをフォーマット
    formatDate(timestamp) {
        if (!timestamp) return '';
        try {
            // 日本語形式でフォーマット
            return new Intl.DateTimeFormat('ja-JP', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
        } catch (e) {
            // Intlが使えない場合のフォールバック
            console.warn("Intl.DateTimeFormatエラー:", e);
            const d = new Date(timestamp);
            return `${String(d.getFullYear()).slice(-2)}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
    },

    // 履歴リストをレンダリング
    async renderHistoryList() {
        try {
            const chats = await dbUtils.getAllChats(state.settings.historySortOrder);
            elements.historyList.querySelectorAll('.history-item:not(.js-history-item-template)').forEach(item => item.remove());

            const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            let oldChatsCount = 0;

            if (chats && chats.length > 0) {
                elements.noHistoryMessage.classList.add('hidden');
                const sortOrderText = state.settings.historySortOrder === 'createdAt' ? '作成順' : '更新順';
                elements.historyTitle.textContent = `履歴一覧 (${sortOrderText})`;

                chats.forEach(chat => {
                    if (chat.updatedAt < sevenDaysAgo) {
                        oldChatsCount++;
                    }

                    const li = elements.historyItemTemplate.cloneNode(true);
                    li.classList.remove('js-history-item-template');
                    li.dataset.chatId = chat.id;

                    const titleText = chat.title || `履歴 ${chat.id}`;
                    const titleEl = li.querySelector('.history-item-title');
                    titleEl.textContent = titleText;
                    titleEl.title = titleText;

                    // 統計情報を表示
                    if (chat.stats) {
                        li.querySelector('.js-stat-tokens').innerHTML = `<span class="material-symbols-outlined">token</span>${chat.stats.totalTokens > 0 ? chat.stats.totalTokens.toLocaleString() : '0'}`;
                        li.querySelector('.js-stat-assets').innerHTML = `<span class="material-symbols-outlined">perm_media</span>${chat.stats.assetCount > 0 ? chat.stats.assetCount.toLocaleString() : '0'}`;
                        li.querySelector('.js-stat-size').innerHTML = `<span class="material-symbols-outlined">database</span>${chat.stats.totalAssetSize > 0 ? formatFileSize(chat.stats.totalAssetSize) : '0 B'}`;
                    } else {
                        // 古いデータにはstatsがない場合がある
                        li.querySelector('.history-item-stats').style.display = 'none';
                    }

                    li.querySelector('.created-date').textContent = `作成: ${this.formatDate(chat.createdAt)}`;
                    li.querySelector('.updated-date').textContent = `更新: ${this.formatDate(chat.updatedAt)}`;

                    li.onclick = async (event) => {
                        if (!event.target.closest('.history-item-actions button')) {
                            const screenTransitionPromise = uiUtils.showScreen('chat');
                            const loadChatPromise = appLogic.loadChat(chat.id);
                            await Promise.all([screenTransitionPromise, loadChatPromise]);
                        }
                    };
                    li.querySelector('.js-edit-title-btn').onclick = (e) => { e.stopPropagation(); appLogic.editHistoryTitle(chat.id, titleEl); };
                    li.querySelector('.js-export-btn').onclick = (e) => { e.stopPropagation(); appLogic.exportChat(chat.id, titleText); };
                    li.querySelector('.js-duplicate-btn').onclick = (e) => { e.stopPropagation(); appLogic.duplicateChat(chat.id); };
                    li.querySelector('.js-delete-btn').onclick = (e) => { e.stopPropagation(); appLogic.confirmDeleteChat(chat.id, titleText); };

                    elements.historyList.appendChild(li);
                });
            } else {
                elements.noHistoryMessage.classList.remove('hidden');
                elements.historyTitle.textContent = '履歴一覧';
            }

            // 古い履歴削除ボタンの状態を更新
            const deleteBtn = document.getElementById('delete-old-chats-btn');
            if (oldChatsCount > 0) {
                deleteBtn.disabled = false;
                deleteBtn.title = `${oldChatsCount}件の古い履歴を一括削除`;
            } else {
                deleteBtn.disabled = true;
                deleteBtn.title = '削除対象の古い履歴はありません';
            }

        } catch (error) {
            console.error("履歴リストのレンダリングエラー:", error);
            elements.noHistoryMessage.textContent = "履歴の読み込み中にエラーが発生しました。";
            elements.noHistoryMessage.classList.remove('hidden');
            elements.historyTitle.textContent = '履歴一覧';
        }
    },

    // --- 背景画像UIヘルパー ---
    // 既存のオブジェクトURLを破棄
    revokeExistingObjectUrl() {
        if (state.backgroundImageUrl) {
            try {
                URL.revokeObjectURL(state.backgroundImageUrl);
                console.log("以前の背景URLを破棄:", state.backgroundImageUrl);
            } catch (e) {
                console.error("オブジェクトURLの破棄エラー:", e);
            }
            state.backgroundImageUrl = null;
        }
    },
    // 背景画像設定UIを更新
    updateBackgroundSettingsUI() {
        if (!elements.backgroundThumbnail || !elements.deleteBackgroundBtn) return;
        if (state.backgroundImageUrl) {
            elements.backgroundThumbnail.src = state.backgroundImageUrl;
            elements.backgroundThumbnail.classList.remove('hidden');
            elements.deleteBackgroundBtn.classList.remove('hidden');
        } else {
            elements.backgroundThumbnail.src = '';
            elements.backgroundThumbnail.classList.add('hidden');
            elements.deleteBackgroundBtn.classList.add('hidden');
        }
    },

    applyHeaderColor() {
        const customColor = state.settings.headerColor;
        if (customColor) {
            // カスタム色が設定されていれば、--header-color-custom 変数を設定
            document.documentElement.style.setProperty('--header-color-custom', customColor);
        } else {
            // 設定がなければ、--header-color-custom 変数を削除してデフォルトに戻す
            document.documentElement.style.removeProperty('--header-color-custom');
        }
        // ヘッダーの色が確定した後に、ブラウザのテーマカラーを更新
        // getComputedStyleで実際に適用されている色を取得
        const finalHeaderColor = getComputedStyle(elements.appHeader).backgroundColor;
        elements.themeColorMeta.content = finalHeaderColor;
        console.log(`ヘッダーカラー適用。テーマカラー: ${finalHeaderColor}`);
    },

    applyBackgroundImage() {
        // 一時的な背景が適用中の場合は、永続設定で上書きしない
        if (state.isTemporaryBackgroundActive) {
            console.log("一時的な背景が適用中のため、永続的な背景の適用をスキップしました。");
            return;
        }
        this.revokeExistingObjectUrl(); // 既存のURLがあれば破棄
        const blob = state.settings.backgroundImageBlob;
        if (blob instanceof Blob) {
            try {
                state.backgroundImageUrl = URL.createObjectURL(blob);
                const newUrl = `url("${state.backgroundImageUrl}")`;
                
                const chatScreen = elements.chatScreen;
                const isAlreadyVisible = chatScreen.classList.contains('background-visible');
    
                const switchImageAndFadeIn = () => {
                    document.documentElement.style.setProperty('--chat-background-image', newUrl);
                    chatScreen.classList.add('background-visible');
                };
    
                if (isAlreadyVisible) {
                    chatScreen.addEventListener('transitionend', switchImageAndFadeIn, { once: true });
                    chatScreen.classList.remove('background-visible');
                } else {
                    switchImageAndFadeIn();
                }
    
                console.log("背景画像をBlobから適用しました。");
            } catch (e) {
    
                console.error("背景画像のオブジェクトURL生成に失敗:", e);
                elements.chatScreen.classList.remove('background-visible');
                document.documentElement.style.removeProperty('--chat-background-image');
            }
        } else {
            elements.chatScreen.classList.remove('background-visible');
            document.documentElement.style.removeProperty('--chat-background-image');
        }
        this.updateBackgroundSettingsUI(); // 設定画面のUIも更新
    
    
    },

    // ------------------------------------

    // 設定をUIに適用
    applySettingsToUI() {
        // プロバイダーとAPIキーの設定（要素が存在する場合のみ）
        if (elements.apiProviderSelect) {
            let provider = state.settings.apiProvider || 'gemini';
            const isDebugOnlyProvider = provider === 'zai' || provider === 'openrouter' || provider === 'bedrock';
            if (!state.settings.debugMode && isDebugOnlyProvider) {
                provider = 'gemini';
                state.settings.apiProvider = provider;
                if (state.activeProfile && state.activeProfile.settings) {
                    state.activeProfile.settings.apiProvider = provider;
                    dbUtils.updateProfile(state.activeProfile)
                        .then(() => appLogic.markAsDirtyAndSchedulePush('structural'))
                        .catch(error => console.error("[Settings] APIプロバイダーの同期更新に失敗しました:", error));
                }
            }
            elements.apiProviderSelect.value = provider;
            const shouldShowProviderSelect = state.settings.debugMode === true;
            if (elements.apiProviderRow) {
                elements.apiProviderRow.classList.toggle('hidden', !shouldShowProviderSelect);
            }
            appLogic.updateProviderUI(provider);
            appLogic.updateModelOptions(provider);
        }
        elements.apiKeyInput.value = state.settings.apiKey || '';
        if (elements.zaiApiKeyInput) {
            elements.zaiApiKeyInput.value = state.settings.zaiApiKey || '';
        }
        if (elements.openrouterApiKeyInput) {
            elements.openrouterApiKeyInput.value = state.settings.openrouterApiKey || '';
        }
        if (elements.bedrockAccessKeyInput) {
            elements.bedrockAccessKeyInput.value = state.settings.bedrockAccessKey || '';
        }
        if (elements.bedrockSecretKeyInput) {
            elements.bedrockSecretKeyInput.value = state.settings.bedrockSecretKey || '';
        }
        if (elements.bedrockRegionSelect) {
            elements.bedrockRegionSelect.value = state.settings.bedrockRegion || DEFAULT_BEDROCK_REGION;
        }
        elements.modelNameSelect.value = state.settings.modelName || DEFAULT_MODEL;
        elements.systemPromptDefaultTextarea.value = state.settings.systemPrompt || '';
        elements.temperatureInput.value = state.settings.temperature === null ? '' : state.settings.temperature;
        elements.maxTokensInput.value = state.settings.maxTokens === null ? '' : state.settings.maxTokens;
        elements.topKInput.value = state.settings.topK === null ? '' : state.settings.topK;
        elements.topPInput.value = state.settings.topP === null ? '' : state.settings.topP;
        elements.thinkingBudgetInput.value = state.settings.thinkingBudget === null ? '' : state.settings.thinkingBudget;
        elements.includeThoughtsToggle.checked = state.settings.includeThoughts;
        elements.enableThoughtTranslationCheckbox.checked = state.settings.enableThoughtTranslation;
        elements.thoughtTranslationModelSelect.value = state.settings.thoughtTranslationModel || 'gemini-2.5-flash-lite';
        elements.thoughtTranslationOptionsDiv.classList.toggle('hidden', !state.settings.includeThoughts);
        elements.dummyUserInput.value = state.settings.dummyUser || '';
        elements.applyDummyToProofreadCheckbox.checked = state.settings.applyDummyToProofread;
        elements.applyDummyToTranslateCheckbox.checked = state.settings.applyDummyToTranslate;
        elements.dummyModelInput.value = state.settings.dummyModel || '';
        elements.reverseDummyOrderCheckbox.checked = state.settings.reverseDummyOrder;
        elements.concatDummyModelCheckbox.checked = state.settings.concatDummyModel;
        elements.additionalModelsTextarea.value = state.settings.additionalModels || '';
        elements.enterToSendCheckbox.checked = state.settings.enterToSend;
        elements.historySortOrderSelect.value = state.settings.historySortOrder || 'updatedAt';
        elements.darkModeToggle.checked = state.settings.darkMode;
        elements.debugModeToggle.checked = state.settings.debugMode;
        elements.fontFamilyInput.value = state.settings.fontFamily || '';
        elements.hideSystemPromptToggle.checked = state.settings.hideSystemPromptInChat;
        elements.geminiEnableGroundingToggle.checked = state.settings.geminiEnableGrounding;
        elements.geminiEnableFunctionCallingToggle.checked = state.settings.geminiEnableFunctionCalling;
        elements.swipeNavigationToggle.checked = state.settings.enableSwipeNavigation;
        elements.enableProofreadingCheckbox.checked = state.settings.enableProofreading;
        elements.proofreadingModelNameSelect.value = state.settings.proofreadingModelName || 'gemini-2.5-flash';
        elements.proofreadingSystemInstructionTextarea.value = state.settings.proofreadingSystemInstruction || '';
        elements.proofreadingOptionsDiv.classList.toggle('hidden', !state.settings.enableProofreading);
        elements.enableAutoRetryCheckbox.checked = state.settings.enableAutoRetry;
        elements.maxRetriesInput.value = state.settings.maxRetries;
        elements.autoRetryOptionsDiv.classList.toggle('hidden', !state.settings.enableAutoRetry);
        elements.useFixedRetryDelayCheckbox.checked = state.settings.useFixedRetryDelay;
        elements.fixedRetryDelayInput.value = state.settings.fixedRetryDelaySeconds;
        elements.maxBackoffDelayInput.value = state.settings.maxBackoffDelaySeconds;
        elements.fixedRetryDelayContainer.classList.toggle('hidden', !state.settings.useFixedRetryDelay);
        elements.maxBackoffDelayContainer.classList.toggle('hidden', state.settings.useFixedRetryDelay);
        elements.enableApiTimeoutCheckbox.checked = state.settings.enableApiTimeout || false;
        elements.apiTimeoutSecondsInput.value = state.settings.apiTimeoutSeconds || 90;
        this.updateApiTimeoutOptionsVisibility();
        elements.googleSearchApiKeyInput.value = state.settings.googleSearchApiKey || '';
        elements.googleSearchEngineIdInput.value = state.settings.googleSearchEngineId || '';
        const opacityPercent = Math.round((state.settings.overlayOpacity ?? 0.65) * 100);
        if (elements.overlayOpacitySlider) elements.overlayOpacitySlider.value = opacityPercent;
        if (elements.overlayOpacityValue)  elements.overlayOpacityValue.textContent = `${opacityPercent}%`;
        const msgPercent = Math.round((state.settings.messageOpacity ?? 1) * 100);
        if (elements.messageOpacitySlider) elements.messageOpacitySlider.value = msgPercent;
        if (elements.messageOpacityValue)  elements.messageOpacityValue.textContent = `${msgPercent}%`;
        document.documentElement.style.setProperty('--message-bubble-opacity', String(state.settings.messageOpacity ?? 1));
        document.getElementById('allow-prompt-ui-changes').checked = state.settings.allowPromptUiChanges;
        elements.forceFunctionCallingToggle.checked = state.settings.forceFunctionCalling;
        elements.autoScrollToggle.checked = state.settings.autoScroll;
        elements.enableWideModeToggle.checked = state.settings.enableWideMode; 
        elements.enableMemoryToggle.checked = state.settings.enableMemory;
        elements.memoryAutoSaveIntervalSelect.value = state.settings.memoryAutoSaveInterval;
        appLogic.toggleMemoryOptions(state.settings.enableMemory);
        
        // ヘッダー自動非表示機能のUIを更新
        elements.headerAutoHideToggle.checked = state.settings.headerAutoHide;
        elements.summaryModelNameSelect.value = state.settings.summaryModelName || state.settings.modelName || 'gemini-2.5-flash';
        elements.summarySystemPromptTextarea.value = state.settings.summarySystemPrompt || '';
        elements.enableSummaryButtonToggle.checked = state.settings.enableSummaryButton;
        document.body.classList.toggle('header-auto-hide', state.settings.headerAutoHide);
        elements.floatingPanelBehaviorSelect.value = state.settings.floatingPanelBehavior || 'on-click';
        elements.dropboxSyncFrequencySelect.value = state.settings.dropboxSyncFrequency || 'instant';

        const defaultHeaderColor = state.settings.darkMode ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
        elements.headerColorInput.value = state.settings.headerColor || defaultHeaderColor;

        this.updateUserModelOptions();
        this.updateBackgroundSettingsUI();
        this.applyDarkMode();
        this.applyFontFamily();
        this.toggleSystemPromptVisibility();
        this.applyOverlayOpacity();
        this.applyHeaderColor();
        this.updateModelWarningMessage();
        this.applyBackgroundImage();
        appLogic.applyWideMode();
        appLogic.toggleDebugLogButtonVisibility(state.settings.debugMode);

        elements.sdApiUrlInput.value = state.settings.sdApiUrl || '';
        elements.sdApiUserInput.value = state.settings.sdApiUser || '';
        elements.sdApiPasswordInput.value = state.settings.sdApiPassword || '';
        elements.sdEnableQualityCheckerCheckbox.checked = state.settings.sdEnableQualityChecker;
        elements.sdQcModelSelect.value = state.settings.sdQcModel || 'gemini-2.5-pro';
        elements.sdQcPromptTextarea.value = state.settings.sdQcPrompt || '';
        elements.sdQcRetriesInput.value = state.settings.sdQcRetries === null ? '' : state.settings.sdQcRetries;
        elements.sdPromptImproveModelSelect.value = state.settings.sdPromptImproveModel || 'gemini-2.5-flash';
        elements.sdPromptImproveSystemPromptTextarea.value = state.settings.sdPromptImproveSystemPrompt || '';
        elements.sdQualityCheckerOptionsDiv.classList.toggle('hidden', !state.settings.sdEnableQualityChecker);
    },



    // ユーザー指定モデルをコンボボックスに反映
    updateUserModelOptions() {
        const models = (state.settings.additionalModels || '')
            .split(',')
            .map(m => m.trim())
            .filter(m => m !== ''); // カンマ区切りで分割し、空要素を除去

        // 更新対象のグループとそれに対応するセレクターの設定値
        const targetGroups = [
            { 
                groupId: 'user-defined-models-group', 
                selectElement: elements.modelNameSelect, 
                currentValue: state.settings.modelName 
            },
            { 
                groupId: 'thought-translation-user-models', 
                selectElement: elements.thoughtTranslationModelSelect, 
                currentValue: state.settings.thoughtTranslationModel 
            },
            { 
                groupId: 'proofreading-user-models', 
                selectElement: elements.proofreadingModelNameSelect, 
                currentValue: state.settings.proofreadingModelName 
            },
            { 
                groupId: 'sd-qc-user-models', 
                selectElement: elements.sdQcModelSelect, 
                currentValue: state.settings.sdQcModel 
            },
            { 
                groupId: 'sd-prompt-improve-user-models', 
                selectElement: elements.sdPromptImproveModelSelect, 
                currentValue: state.settings.sdPromptImproveModel 
            },
            { 
                groupId: 'summary-user-models', 
                selectElement: elements.summaryModelNameSelect, 
                currentValue: state.settings.summaryModelName || state.settings.modelName 
            }
        ];

        // 各グループに対してユーザー定義モデルを追加
        targetGroups.forEach(({ groupId, selectElement, currentValue }) => {
            const group = document.getElementById(groupId);
            if (!group) return; // グループが存在しない場合はスキップ
            
            group.innerHTML = ''; // 一旦クリア

        if (models.length > 0) {
            group.disabled = false; // optgroupを有効化
            models.forEach(modelId => {
                const option = document.createElement('option');
                option.value = modelId;
                option.textContent = modelId;
                group.appendChild(option);
            });
            // 現在選択中のモデルがユーザー指定モデルに含まれていれば、それを選択状態にする
                if (models.includes(currentValue) && selectElement) {
                    selectElement.value = currentValue;
            }
        } else {
            group.disabled = true; // モデルがなければoptgroupを無効化
        }
        });
    },

    // ダークモードを適用
    applyDarkMode() {
        const isDark = state.settings.darkMode;
        document.body.classList.toggle('dark-mode', isDark);
        // OS設定の上書き用クラス (ダークモードでない場合)
        document.body.classList.toggle('light-mode-forced', !isDark);
        elements.themeColorMeta.content = isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
        console.log(`ダークモード ${isDark ? '有効' : '無効'}. テーマカラー: ${elements.themeColorMeta.content}`);
        this.applyOverlayOpacity();
        this.applyHeaderColor();
    },

    // フォント設定を適用
    applyFontFamily() {
        const customFont = state.settings.fontFamily?.trim();
        const fontFamilyToApply = customFont ? customFont : DEFAULT_FONT_FAMILY;
        document.documentElement.style.setProperty('--font-family', fontFamilyToApply);
        console.log(`フォント適用: ${fontFamilyToApply}`);
    },

    // --- システムプロンプトUI更新 ---
    updateSystemPromptUI() {
        elements.systemPromptEditor.value = state.currentSystemPrompt;
        // 編集中でない場合、detailsタグを閉じる
        if (!state.isEditingSystemPrompt) {
            elements.systemPromptDetails.removeAttribute('open');
        }
        // テキストエリアの高さを調整
        this.adjustTextareaHeight(elements.systemPromptEditor, 200);
        // 表示/非表示を制御
        this.toggleSystemPromptVisibility();
    },
    // システムプロンプトエリアの表示/非表示を切り替え
    toggleSystemPromptVisibility() {
        const shouldHide = state.settings.hideSystemPromptInChat;
        elements.systemPromptArea.classList.toggle('hidden', shouldHide);
        console.log(`システムプロンプト表示エリア ${shouldHide ? '非表示' : '表示'}`);
    },
    // --------------------------------

    // 画面を表示 (スワイプアニメーション + inert対応 + 戻るボタン対応)
    showScreen(screenName, fromPopState = false) {
        return new Promise((resolve) => {
          const startTime = performance.now();
      
          // --- 同一画面への重複遷移は無視 ---
          if (screenName === state.currentScreen) {
            resolve();
            return;
          }
      
          const chat = elements.chatScreen;
          const historyEl = elements.historyScreen;
          const settings = elements.settingsScreen;
          const allScreens = [chat, historyEl, settings];
      
          const pos = {
            chat: {
              chat: 'translate3d(0,0,0)',
              history: 'translate3d(-100%,0,0)',
              settings: 'translate3d(100%,0,0)',
            },
            history: {
              chat: 'translate3d(100%,0,0)',
              history: 'translate3d(0,0,0)',
              settings: 'translate3d(200%,0,0)',
            },
            settings: {
              chat: 'translate3d(-100%,0,0)',
              history: 'translate3d(-200%,0,0)',
              settings: 'translate3d(0,0,0)',
            },
          };
      
          if (screenName === 'chat') {
            chat.style.transform = pos.chat.chat;
            historyEl.style.transform = pos.chat.history;
            settings.style.transform = pos.chat.settings;
          } else if (screenName === 'history') {
            chat.style.transform = pos.history.chat;
            historyEl.style.transform = pos.history.history;
            settings.style.transform = pos.history.settings;
            this.renderHistoryList();
          } else if (screenName === 'settings') {

            chat.style.transform = pos.settings.chat;
            historyEl.style.transform = pos.settings.history;
            settings.style.transform = pos.settings.settings;
          }
      
          void elements.appContainer.offsetHeight;
      
          let activeScreen = null;
          if (screenName === 'chat') activeScreen = chat;
          else if (screenName === 'history') activeScreen = historyEl;
          else if (screenName === 'settings') activeScreen = settings;
      
          if (activeScreen) {
            activeScreen.classList.add('active');
            activeScreen.inert = false;
          }
          allScreens.forEach((s) => {
            if (s !== activeScreen) {
              s.classList.remove('active');
              s.inert = true;
            }
          });
      
          if (!fromPopState) {
            const entry = { screen: screenName };
            if (screenName === 'chat' && state.__navSource === 'history-item') {
              history.replaceState(entry, '', '#chat');
            } else {
              history.pushState(entry, '', `#${screenName}`);
            }
          }
      
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            state.currentScreen = screenName;
            const endTime = performance.now();
            resolve();
          };
          requestAnimationFrame(() => requestAnimationFrame(finish));
          setTimeout(finish, 600);
        });
    },

    // 送信状態を設定
    setSendingState(sending) {
        state.isSending = sending;
        if (sending) {
            elements.sendButton.innerHTML = '<span class="material-symbols-outlined">stop</span>';
            elements.sendButton.classList.add('sending');
            elements.sendButton.title = "停止";
            elements.sendButton.disabled = false;
            elements.userInput.disabled = true;
            elements.attachFileBtn.disabled = true;
            elements.loadingIndicator.classList.remove('hidden');
            elements.loadingIndicator.setAttribute('aria-live', 'polite');
            elements.systemPromptDetails.style.pointerEvents = 'none';
            elements.systemPromptDetails.style.opacity = '0.7';
        } else {
            elements.sendButton.innerHTML = '<span class="material-symbols-outlined">send</span>';
            elements.sendButton.classList.remove('sending');
            elements.sendButton.title = "送信";
            elements.sendButton.disabled = elements.userInput.value.trim() === '' && state.pendingAttachments.length === 0;
            elements.userInput.disabled = false;
            elements.attachFileBtn.disabled = false;
            elements.loadingIndicator.classList.add('hidden');
            elements.loadingIndicator.removeAttribute('aria-live');
            elements.systemPromptDetails.style.pointerEvents = '';
            elements.systemPromptDetails.style.opacity = '';
        }
    },

    // テキストエリアの高さを自動調整
    adjustTextareaHeight(textarea = elements.userInput, maxHeight = TEXTAREA_MAX_HEIGHT) {
        textarea.style.height = 'auto';
        const scrollHeight = textarea.scrollHeight;
        textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
        
        if (textarea === elements.userInput && !state.isSending) {
            elements.sendButton.disabled = textarea.value.trim() === '' && state.pendingAttachments.length === 0;
        }
    },



    // --- カスタムダイアログ関数 ---
    showCustomDialog(dialogElement, focusElement) {
        return new Promise((resolve) => {
            const closeListener = () => {
                dialogElement.removeEventListener('close', closeListener);
                resolve(dialogElement.returnValue);
            };
            dialogElement.addEventListener('close', closeListener);

            // アニメーションクラスを追加
            dialogElement.classList.add('animating');
            dialogElement.addEventListener('animationend', () => {
                dialogElement.classList.remove('animating');
            }, { once: true });

            dialogElement.showModal();
            
            if (focusElement) {
                requestAnimationFrame(() => { focusElement.focus(); });
            }
        });
    },

    // アラートダイアログ表示
    async showCustomAlert(message) {
        elements.alertMessage.textContent = message;
         // ボタンのイベントリスナーが重複しないように複製して置き換え
         const newOkBtn = elements.alertOkBtn.cloneNode(true);
         elements.alertOkBtn.parentNode.replaceChild(newOkBtn, elements.alertOkBtn);
         elements.alertOkBtn = newOkBtn;
        elements.alertOkBtn.onclick = () => elements.alertDialog.close('ok');
        await this.showCustomDialog(elements.alertDialog, elements.alertOkBtn);
    },
    // 確認ダイアログ表示
    async showCustomConfirm(message) {
        elements.confirmMessage.textContent = message;
         // ボタンのイベントリスナーが重複しないように複製して置き換え
         const newOkBtn = elements.confirmOkBtn.cloneNode(true);
         elements.confirmOkBtn.parentNode.replaceChild(newOkBtn, elements.confirmOkBtn);
         elements.confirmOkBtn = newOkBtn;
         const newCancelBtn = elements.confirmCancelBtn.cloneNode(true);
         elements.confirmCancelBtn.parentNode.replaceChild(newCancelBtn, elements.confirmCancelBtn);
         elements.confirmCancelBtn = newCancelBtn;

        elements.confirmOkBtn.onclick = () => elements.confirmDialog.close('ok');
        elements.confirmCancelBtn.onclick = () => elements.confirmDialog.close('cancel');
        const result = await this.showCustomDialog(elements.confirmDialog, elements.confirmOkBtn);
        return result === 'ok'; // OKが押されたか
    },
    // プロンプトダイアログ表示
    async showCustomPrompt(message, defaultValue = '') {
        elements.promptMessage.textContent = message;
        elements.promptInput.value = defaultValue;
         // ボタンと入力欄のイベントリスナーが重複しないように複製して置き換え
         const newOkBtn = elements.promptOkBtn.cloneNode(true);
         elements.promptOkBtn.parentNode.replaceChild(newOkBtn, elements.promptOkBtn);
         elements.promptOkBtn = newOkBtn;
         const newCancelBtn = elements.promptCancelBtn.cloneNode(true);
         elements.promptCancelBtn.parentNode.replaceChild(newCancelBtn, elements.promptCancelBtn);
         elements.promptCancelBtn = newCancelBtn;
         const newPromptInput = elements.promptInput.cloneNode(true);
         elements.promptInput.parentNode.replaceChild(newPromptInput, elements.promptInput);
         elements.promptInput = newPromptInput;

        // EnterキーでOKボタンをクリックする処理
        const enterHandler = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                elements.promptOkBtn.click();
            }
        };
        elements.promptInput.addEventListener('keypress', enterHandler);

        elements.promptOkBtn.onclick = () => elements.promptDialog.close(elements.promptInput.value); // OK時は入力値を返す
        elements.promptCancelBtn.onclick = () => elements.promptDialog.close(''); // キャンセル時は空文字列 ('') を渡す

        // ダイアログが閉じたらEnterキーリスナーを削除
        const closeHandler = () => {
            elements.promptInput.removeEventListener('keypress', enterHandler);
            elements.promptDialog.removeEventListener('close', closeHandler);
        };
         elements.promptDialog.addEventListener('close', closeHandler);

        const result = await this.showCustomDialog(elements.promptDialog, elements.promptInput);
        return result; // 入力値またはnullを返す
    },

    // 添付ファイルバッジの表示/非表示を更新する関数
    updateAttachmentBadgeVisibility() {
        const hasAttachments = state.pendingAttachments.length > 0;
        elements.attachFileBtn.classList.toggle('has-attachments', hasAttachments);
    },

    // ファイルアップロードダイアログ表示
    showFileUploadDialog() {
        if (state.selectedFilesForUpload.length === 0 && state.pendingAttachments.length > 0) {
            state.selectedFilesForUpload = state.pendingAttachments.map(att => ({ file: att.file }));
            console.log("送信待ちの添付ファイルをダイアログに復元:", state.selectedFilesForUpload.map(item => item.file.name));
        } else if (state.selectedFilesForUpload.length === 0) {
            // ファイルが選択されておらず、送信待ちもない場合はクリアを確実にする
            state.selectedFilesForUpload = [];
        }

        this.updateSelectedFilesUI();
        elements.fileUploadDialog.showModal();
        this.updateAttachmentBadgeVisibility();
    },

    // 選択されたファイルリストのUIを更新 (変更なし、呼び出しタイミングが重要)
    updateSelectedFilesUI() {
        elements.selectedFilesList.innerHTML = ''; // リストをクリア
        let totalSize = 0;
        // selectedFilesForUpload には { file: File } が入っている
        state.selectedFilesForUpload.forEach((item, index) => {
            const li = document.createElement('li');
            li.classList.add('selected-file-item');
            li.dataset.fileIndex = index;

            const infoDiv = document.createElement('div');
            infoDiv.classList.add('selected-file-info');

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('selected-file-name');
            nameSpan.textContent = item.file.name;
            nameSpan.title = item.file.name;

            const sizeSpan = document.createElement('span');
            sizeSpan.classList.add('selected-file-size');
            sizeSpan.textContent = formatFileSize(item.file.size); // File オブジェクトからサイズ取得

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(sizeSpan);

            const removeBtn = document.createElement('button');
            removeBtn.classList.add('remove-file-btn');
            removeBtn.title = '削除';
            removeBtn.textContent = '×';
            removeBtn.onclick = () => appLogic.removeSelectedFile(index);

            li.appendChild(infoDiv);
            li.appendChild(removeBtn);
            elements.selectedFilesList.appendChild(li);

            totalSize += item.file.size;
        });

        // 合計サイズチェック
        if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
            elements.confirmAttachBtn.disabled = true;
            // アラートはファイル追加時に行う方が親切かもしれない
            // uiUtils.showCustomAlert(`合計ファイルサイズが大きすぎます (${formatFileSize(MAX_TOTAL_ATTACHMENT_SIZE)}以下にしてください)。`);
        } else {
            // サイズが問題なければ常に有効化
            elements.confirmAttachBtn.disabled = false;
        }
    },

    // モデル選択に応じた警告メッセージの表示/非表示を切り替え
    updateModelWarningMessage() {
        const selectedModel = elements.modelNameSelect.value;
        const isNanoBanana = selectedModel === 'gemini-2.5-flash-image-preview';
        elements.modelWarningMessage.classList.toggle('hidden', !isNanoBanana);
    },
    updateProfileSwitcher() {
        const switcher = elements.profileSwitcher;
        switcher.innerHTML = '';
        state.profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name;
            if (profile.id === state.activeProfileId) {
                option.selected = true;
            }
            switcher.appendChild(option);
        });
        console.log("[UI] プロファイルスイッチャーを更新しました。");
    },

    updateProfileSwitcherUI() {
        const menus = [elements.headerProfileMenu, elements.headerProfileMenuSettings];

        menus.forEach(menu => {
            if (!menu) return;
            menu.innerHTML = '';
            menu.addEventListener('click', e => e.stopPropagation());
        });

        state.profiles.forEach(profile => {
            const menuItem = document.createElement('div');
            menuItem.classList.add('profile-menu-item');
            if (profile.id === state.activeProfileId) {
                menuItem.classList.add('active');
            }
            menuItem.dataset.profileId = profile.id;

            const iconContainer = document.createElement('div');
            iconContainer.classList.add('profile-icon-container');
            
            if (profile.icon) {
                let url = state.profileIconUrls.get(profile.id);
                if (!url) {
                    url = URL.createObjectURL(profile.icon);
                    state.profileIconUrls.set(profile.id, url);
                }
                iconContainer.innerHTML = `<img src="${url}" alt="${htmlUtils.escapeAttr(profile.name)}">`;
            } else {
                iconContainer.innerHTML = `<span class="material-symbols-outlined">account_circle</span>`;
            }

            const textContainer = document.createElement('div');
            textContainer.classList.add('profile-menu-text-container');

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('profile-menu-name');
            nameSpan.textContent = profile.name;
            textContainer.appendChild(nameSpan);

            const modelLineDiv = document.createElement('div');
            modelLineDiv.classList.add('profile-menu-model-line');

            const modelSpan = document.createElement('span');
            modelSpan.classList.add('profile-menu-model');
            modelSpan.textContent = profile.settings?.modelName || 'モデル未設定';
            modelLineDiv.appendChild(modelSpan);

            if (profile.settings?.modelName === 'gemini-2.5-pro') {
                const usage = profile.apiUsage || { count: 0 };
    
                const countSpan = document.createElement('span');
                countSpan.classList.add('profile-menu-api-count');
                countSpan.textContent = `(本日: ${usage.count} 回)`;
                modelLineDiv.appendChild(countSpan);
            }
            
            textContainer.appendChild(modelLineDiv);

            menuItem.appendChild(iconContainer);
            menuItem.appendChild(textContainer);

            const switchHandler = (event) => {
                event.stopPropagation();
                appLogic.switchProfile(profile.id);
                menus.forEach(m => m?.classList.add('hidden'));
            };
            
            menus.forEach(menu => {
                if (menu) {
                    const clonedItem = menuItem.cloneNode(true);
                    clonedItem.onclick = switchHandler;
                    menu.appendChild(clonedItem);
                }
            });
        });
        
        console.log("[UI] プロファイルメニューを更新しました。");
    },


    updateProfileCardUI() {
        if (!state.activeProfile) return;
        const profile = state.activeProfile;
        
        // --- ヘッダーカード (チャット & 設定) ---
        const cards = [
            { name: elements.profileCardName, container: elements.profileCardIconContainer },
            { name: elements.profileCardNameSettings, container: elements.profileCardIconContainerSettings }
        ];
        
        cards.forEach(card => {
            // アイコンコンテナが存在すれば、アイコンの更新は必ず実行する
            if (card.container) {
                if (profile.icon) {
                    let url = state.profileIconUrls.get(profile.id);
                    if (!url) {
                        url = URL.createObjectURL(profile.icon);
                        state.profileIconUrls.set(profile.id, url);
                    }
                    card.container.innerHTML = `<img src="${url}" alt="プロファイルアイコン">`;
                } else {
                    card.container.innerHTML = `<span class="material-symbols-outlined">account_circle</span>`;
                }
            }
            // 名前の要素が存在する場合のみ、名前を更新する
            if (card.name) {
                card.name.textContent = profile.name;
            }
        });

        // --- 設定画面のプロファイル編集エリア ---
        const iconImg = elements.profileDisplayIcon;
        const iconPlaceholder = iconImg.nextElementSibling;
        if (profile.icon) {
            let url = state.profileIconUrls.get(profile.id);
            if (!url) {
                url = URL.createObjectURL(profile.icon);
                state.profileIconUrls.set(profile.id, url);
            }
            iconImg.src = url;
            iconImg.style.display = 'block';
            iconPlaceholder.style.display = 'none';
            elements.profileResetIconBtn.style.display = 'flex';
        } else {
            iconImg.style.display = 'none';
            iconPlaceholder.style.display = 'flex';
            elements.profileResetIconBtn.style.display = 'none';
        }
        elements.profileDisplayNameMain.textContent = profile.name;
        
        const subText = `${profile.settings.modelName || '...'} / T: ${profile.settings.temperature ?? '...'}`;
        elements.profileDisplayNameSub.textContent = subText;
        
        elements.profileDisplayStatus.classList.toggle('active', profile.id === state.activeProfileId);

        console.log("[UI] プロファイルカードUIを更新しました。");
    },
    

    toggleProfileMenu(type) {
        console.log(`[Debug Toggle] toggleProfileMenuが呼び出されました。type: ${type}`);
        const menu = type === 'header' ? elements.headerProfileMenu : elements.headerProfileMenuSettings;
        console.log('[Debug Toggle] 対象メニュー要素:', menu);
        if (menu) {
            menu.classList.toggle('hidden');
            console.log(`[Debug Toggle] hiddenクラスをトグルしました。現在のクラス: ${menu.className}`);
        } else {
            console.error('[Debug Toggle] エラー: 対象となるメニュー要素が見つかりません。');
        }
    },

    // --- 進捗ダイアログ ヘルパー ---
    showProgressDialog(message) {
        elements.progressMessage.textContent = message;
        if (!elements.progressDialog.open) {
            elements.progressDialog.showModal();
        }
    },
    updateProgressMessage(message) {
        elements.progressMessage.textContent = message;
    },
    hideProgressDialog() {
        if (elements.progressDialog.open) {
            elements.progressDialog.close();
        }
    },

    showSyncNotification(message, isError = false) {
        const notification = document.getElementById('sync-notification');
        const icon = document.getElementById('sync-notification-icon');
        const messageEl = document.getElementById('sync-notification-message');

        if (!notification || !icon || !messageEl) return;

        messageEl.textContent = message;
        notification.classList.remove('success', 'error');

        if (isError) {
            notification.classList.add('error');
            icon.textContent = 'cloud_off';
        } else {
            notification.classList.add('success');
            icon.textContent = 'check_circle';
        }

        notification.classList.remove('hidden');
        notification.style.opacity = 1;

        setTimeout(() => {
            notification.style.opacity = 0;
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 500);
        }, 4000);
    },
}; // uiUtilsオブジェクトの末尾

// --- APIユーティリティ (apiUtils) ---
const apiUtils = {
    // Gemini形式からOpenAI形式への変換
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
                        const toolCallId = part.functionResponse._toolCallId || part.functionResponse.name;
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
                    if (part.text) {
                        contentParts.push({ type: 'text', text: part.text });
                    } else if (part.inlineData) {
                        // 画像データの変換
                        const imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        contentParts.push({
                            type: 'image_url',
                            image_url: { url: imageUrl }
                        });
                    } else if (part.functionCall) {
                        // Function Callingの変換
                        // OpenAI互換APIの場合、保存されたtool_call_idを使用
                        const toolCallId = part.functionCall._toolCallId || `call_${Date.now()}_${Math.random()}`;
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

    // OpenAI形式からGemini形式への変換（レスポンス用）
    convertOpenAIToGeminiFormat(openAIResponse) {
        // OpenAI形式のレスポンスをGemini形式に変換
        const candidates = [];
        
        if (openAIResponse.choices && openAIResponse.choices.length > 0) {
            for (const choice of openAIResponse.choices) {
                const parts = [];
                const message = choice.message;
                
                if (message.content) {
                    if (typeof message.content === 'string') {
                        parts.push({ text: message.content });
                    } else if (Array.isArray(message.content)) {
                        for (const contentItem of message.content) {
                            if (contentItem.type === 'text') {
                                parts.push({ text: contentItem.text });
                            } else if (contentItem.type === 'image_url') {
                                // 画像URLからbase64データを抽出（必要に応じて）
                                // 現時点ではテキストのみ対応
                            }
                        }
                    }
                }
                
                if (message.tool_calls && message.tool_calls.length > 0) {
                    for (const toolCall of message.tool_calls) {
                        const callArgs = toolCall?.function?.arguments;
                        const parsedArgs = this._parseToolArguments(callArgs);
                        parts.push({
                            functionCall: {
                                name: toolCall.function.name,
                                args: parsedArgs,
                                _toolCallId: toolCall.id  // OpenAI互換APIのtool_call_idを保存
                            }
                        });
                    }
                }
                
                if (parts.length > 0) {
                    candidates.push({
                        content: { parts },
                        finishReason: this.mapFinishReason(choice.finish_reason),
                        index: choice.index
                    });
                }
            }
        }
        
        // usageMetadataの変換
        const usageMetadata = openAIResponse.usage ? {
            promptTokenCount: openAIResponse.usage.prompt_tokens,
            candidatesTokenCount: openAIResponse.usage.completion_tokens,
            totalTokenCount: openAIResponse.usage.total_tokens
        } : undefined;
        
        return {
            candidates,
            usageMetadata
        };
    },

    // OpenAIのfinish_reasonをGeminiのfinishReasonにマッピング
    mapFinishReason(openAIFinishReason) {
        const mapping = {
            'stop': 'STOP',
            'length': 'MAX_TOKENS',
            'tool_calls': 'STOP',
            'content_filter': 'SAFETY',
            'function_call': 'STOP'
        };
        return mapping[openAIFinishReason] || 'STOP';
    },

    /**
     * OpenAI形式のtool argumentsを安全にオブジェクトへ変換する
     * - 文字列(JSON)形式
     * - 文字列だが各値がクォートされていない簡易オブジェクト形式
     * - 既にオブジェクト
     * に対応する。
     * 解析に失敗した場合は { raw: ... } を返す。
     */
    _parseToolArguments(callArgs) {
        if (!callArgs) {
            return {};
        }

        if (typeof callArgs === 'object') {
            return callArgs;
        }

        if (typeof callArgs !== 'string') {
            return {};
        }

        const trimmed = callArgs.trim();
        if (!trimmed) {
            return {};
        }

        // 1st attempt: JSON.parse as-is
        try {
            return JSON.parse(trimmed);
        } catch (firstError) {
            // 2nd attempt: 正規化してからJSON.parse
            try {
                const normalized = trimmed
                    // 値がクォートされていないケースを検出してクォートを付与
                    .replace(/:\s*([^"{\[\],}]+)(?=\s*[},])/g, (_match, value) => {
                        const v = value.trim();
                        if (!v) return ': ""';
                        const lower = v.toLowerCase();
                        if (lower === 'true' || lower === 'false' || lower === 'null') {
                            return `: ${lower}`;
                        }
                        if (/^-?\d+(\.\d+)?$/.test(v)) {
                            return `: ${v}`;
                        }
                        const escaped = v.replace(/"/g, '\\"');
                        return `: "${escaped}"`;
                    });

                return JSON.parse(normalized);
            } catch (secondError) {
                console.warn('convertOpenAIToGeminiFormat: argumentsの解析に失敗しました。生文字列を保持します。', secondError);
                return { raw: trimmed };
            }
        }
    },

    // Gemini形式からBedrock Converse形式への変換
    convertGeminiToConverseFormat(messagesForApi) {
        const converseMessages = [];
        let pendingToolResults = [];  // 連続するtoolメッセージを一時保存
        
        for (let i = 0; i < messagesForApi.length; i++) {
            const geminiMsg = messagesForApi[i];
            
            // まずロールを判定（デフォルト）
            let role = geminiMsg.role === 'model' ? 'assistant' : geminiMsg.role;
            const content = [];
            
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
                        // Tool use形式に変換
                        content.push({
                            toolUse: {
                                toolUseId: part.functionCall._toolCallId || `tool_${Date.now()}_${Math.random()}`,
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
                        const toolUseId = part.functionResponse._toolCallId || part.functionResponse.name;
                        
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

    // Bedrock Converse形式からGemini形式への変換
    convertConverseToGeminiFormat(converseResponse) {
        const parts = [];
        
        if (converseResponse.output && converseResponse.output.message) {
            const message = converseResponse.output.message;
            
            for (const contentItem of message.content || []) {
                if (contentItem.text) {
                    parts.push({ text: contentItem.text });
                } else if (contentItem.toolUse) {
                    parts.push({
                        functionCall: {
                            name: contentItem.toolUse.name,
                            args: contentItem.toolUse.input || {},
                            _toolCallId: contentItem.toolUse.toolUseId
                        }
                    });
                }
            }
        }
        
        // finishReasonのマッピング
        let finishReason = 'STOP';
        if (converseResponse.stopReason) {
            const reasonMap = {
                'end_turn': 'STOP',
                'tool_use': 'STOP',
                'max_tokens': 'MAX_TOKENS',
                'stop_sequence': 'STOP',
                'content_filtered': 'SAFETY'
            };
            finishReason = reasonMap[converseResponse.stopReason] || 'STOP';
        }
        
        return {
            candidates: [{
                content: {
                    parts: parts,
                    role: 'model'
                },
                finishReason: finishReason
            }],
            usageMetadata: {
                promptTokenCount: converseResponse.usage?.inputTokens || 0,
                candidatesTokenCount: converseResponse.usage?.outputTokens || 0,
                totalTokenCount: (converseResponse.usage?.inputTokens || 0) + (converseResponse.usage?.outputTokens || 0)
            }
        };
    },

    // Gemini形式のFunction DeclarationsをBedrock形式に変換
    convertGeminiToolsToBedrock(geminiTools) {
        // JSON Schemaの型名を小文字に変換する再帰関数
        const normalizeJsonSchema = (schema) => {
            if (!schema || typeof schema !== 'object') {
                return schema;
            }

            const normalized = Array.isArray(schema) ? [] : {};

            for (const key in schema) {
                if (!schema.hasOwnProperty(key)) continue;

                let value = schema[key];

                // "type"フィールドの値を小文字に変換
                if (key === 'type' && typeof value === 'string') {
                    value = value.toLowerCase();
                }
                // オブジェクトまたは配列の場合は再帰処理
                else if (typeof value === 'object' && value !== null) {
                    value = normalizeJsonSchema(value);
                }

                normalized[key] = value;
            }

            return normalized;
        };

        const bedrockTools = [];
        
        for (const geminiTool of geminiTools) {
            if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                for (const funcDecl of geminiTool.function_declarations) {
                    // parametersを正規化（型名を小文字に変換）
                    const normalizedParameters = normalizeJsonSchema(funcDecl.parameters || {});
                    
                    bedrockTools.push({
                        toolSpec: {
                            name: funcDecl.name,
                            description: funcDecl.description || '',
                            inputSchema: {
                                json: normalizedParameters
                            }
                        }
                    });
                }
            }
        }
        
        return bedrockTools;
    },

    // Gemini APIを呼び出す
    async callGeminiApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callGeminiApi: 現在の設定値を確認します。`, {
            forceFunctionCalling: state.settings.forceFunctionCalling,
            geminiEnableFunctionCalling: state.settings.geminiEnableFunctionCalling,
            isForcedNow: forceCalling
        });

        const apiKey = state.settings.apiKey;
        if (!apiKey) {
            throw new Error("Gemini APIキーが設定されていません。");
        }
        
        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_MODEL;

        if (model === 'gemini-2.5-pro') {
            await appLogic._updateApiUsageCount(state.activeProfileId); 
        }

        const isImageGenModel = model === 'gemini-2.5-flash-image-preview';

        const endpointMethod = 'generateContent?';

        const endpoint = `${GEMINI_API_BASE_URL}${model}:${endpointMethod}key=${apiKey}`;
        
        const finalGenerationConfig = { ...generationConfig };
        
        if (isImageGenModel) {
            finalGenerationConfig.responseModalities = ['IMAGE', 'TEXT'];
            delete finalGenerationConfig.thinkingConfig;

            delete finalGenerationConfig.maxOutputTokens;
            delete finalGenerationConfig.topK;
            delete finalGenerationConfig.topP;
            delete finalGenerationConfig.temperature;

        } else {
            if (state.settings.thinkingBudget !== null || state.settings.includeThoughts) {
                generationConfig.thinkingConfig = {};
                if(state.settings.thinkingBudget !== null) generationConfig.thinkingConfig.thinkingBudget = state.settings.thinkingBudget;
                if(state.settings.includeThoughts) generationConfig.thinkingConfig.includeThoughts = true;
            }
        }

        const requestBody = {
            contents: messagesForApi,
            ...(Object.keys(finalGenerationConfig).length > 0 && { generationConfig: finalGenerationConfig }),
            safetySettings : [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        if (isImageGenModel) {
            requestBody.safetySettings = [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ];
        } else {
            if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0 && systemInstruction.parts[0].text) {
                requestBody.systemInstruction = systemInstruction;
            }

            let finalTools = [];
            if (state.settings.geminiEnableFunctionCalling) {
                finalTools = window.functionDeclarations || [];
                console.log("Function Calling を有効にしてAPIを呼び出します。");
            } 
            else if (state.settings.geminiEnableGrounding) {
                finalTools.push({ "google_search": {} });
                console.log("グラウンディング (Google Search) を有効にしてAPIを呼び出します。");
            }
            
            if (finalTools.length > 0) {
                requestBody.tools = finalTools;
            }

            if (forceCalling && state.settings.geminiEnableFunctionCalling) {
                requestBody.toolConfig = {
                    functionCallingConfig: {
                        mode: 'ANY'
                    }
                };
                console.log("Function Calling を強制モード (ANY) で実行します。");
            }
        }

        console.log("Geminiへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        console.log("ターゲットエンドポイント:", endpoint);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to Gemini API...`);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from Gemini API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },


    /**
     * テキストを日本語に翻訳する関数
     * @param {string} textToTranslate - 翻訳対象の英語テキスト
     * @param {string} translationModelName - 翻訳に使用するモデル名
     * @returns {Promise<string>} 翻訳された日本語テキスト。失敗した場合は元の英語テキストを返す。
     */
     async translateText(textToTranslate, translationModelName) {
        if (!textToTranslate || textToTranslate.trim() === '') {
            return textToTranslate;
        }

        const japaneseChars = textToTranslate.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) || [];
        const japaneseRatio = japaneseChars.length / textToTranslate.length;

        if (japaneseRatio > 0.5) {
            console.log(`翻訳スキップ: 日本語の文字が${Math.round(japaneseRatio * 100)}%含まれているため、翻訳済みと判断しました。`);
            return textToTranslate;
        }

        console.log("--- 思考プロセスの翻訳処理開始 ---");
        
        const modelToUse = translationModelName || 'gemini-2.5-flash-lite';
        const apiKey = state.settings.apiKey;
        if (!apiKey) {
            console.warn("翻訳スキップ: APIキーが設定されていません。");
            return textToTranslate;
        }

        const endpoint = `${GEMINI_API_BASE_URL}${modelToUse}:generateContent`;
        
        const systemInstruction = {
            parts: [{ text: "You are a professional translator. Translate the given English text into natural Japanese. Do not add any extra comments or explanations. Just output the translated Japanese text." }]
        };

        const requestBody = {
            contents: [{
                role: 'user',
                parts: [{ text: textToTranslate }]
            }],
            systemInstruction,
            generationConfig: {
                temperature: 0.1,
            },
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        if (state.settings.applyDummyToTranslate && state.settings.dummyUser) {
            requestBody.contents.push({
                role: 'user',
                parts: [{ text: state.settings.dummyUser }]
            });
            console.log("翻訳リクエストにダミーUserプロンプトを適用しました。");
        }

        let lastError = null;
        const maxTranslationRetries = state.settings.enableAutoRetry ? state.settings.maxRetries : 0;

        for (let attempt = 0; attempt <= maxTranslationRetries; attempt++) {
            try {
                if (state.abortController?.signal.aborted) {
                    throw new Error("リクエストがキャンセルされました。");
                }

                if (attempt > 0) {
                    let delay;
                    if (state.settings.useFixedRetryDelay) {
                        delay = state.settings.fixedRetryDelaySeconds * 1000;
                    } else {
                        const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        const maxDelay = state.settings.maxBackoffDelaySeconds * 1000;
                        delay = Math.min(exponentialDelay, maxDelay);
                    }
                    uiUtils.setLoadingIndicatorText(`翻訳エラー 再試行(${attempt}回目)... ${Math.round(delay/1000)}秒待機`);
                    console.log(`翻訳APIリトライ ${attempt}: ${delay}ms待機...`);
                    await interruptibleSleep(delay, state.abortController.signal);
                }

                if (attempt > 0) {
                    uiUtils.setLoadingIndicatorText('思考プロセスの翻訳を再試行中...');
                } else {
                    uiUtils.setLoadingIndicatorText('思考プロセスを翻訳中...');
                }

                const timeoutController = new AbortController();
                const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(requestBody),
                    signal: timeoutController.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorBody = await response.text();
                    try { errorBody = JSON.parse(errorBody); } catch(e) { /* ignore */ }
                    console.error(`翻訳APIエラー (${response.status})`, errorBody);
                    const error = new Error(`翻訳APIエラー (${response.status})`);
                    error.status = response.status;
                    throw error;
                }

                const responseData = await response.json();
                if (responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const translatedText = responseData.candidates[0].content.parts[0].text;
                    console.log("--- 翻訳処理成功 ---");
                    return translatedText;
                } else {
                    console.warn("翻訳APIの応答形式が不正、またはコンテンツが空です。", responseData);
                    if(responseData.promptFeedback) {
                        console.warn("翻訳がブロックされた可能性があります:", responseData.promptFeedback);
                    }
                    throw new Error("翻訳APIの応答形式が不正です。");
                }
            } catch (error) {
                lastError = error;
                if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                    if (state.abortController?.signal.aborted) {
                        break;
                    }
                }
                if (error.status && error.status >= 400 && error.status < 500) {
                    console.error(`リトライ不可の翻訳エラー (ステータス: ${error.status})。`);
                    break;
                }
                console.warn(`翻訳API呼び出し試行 ${attempt + 1} が失敗。`, error);
            }
        }

        console.error("思考プロセスの翻訳中にエラーが発生しました。原文を返します。", lastError);
        return textToTranslate;
    },

    // Z.ai APIを呼び出す
    async callZaiApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callZaiApi: Z.ai APIを呼び出します。`);

        const apiKey = state.settings.zaiApiKey || state.settings.apiKey;
        if (!apiKey) {
            throw new Error("Z.ai APIキーが設定されていません。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_ZAI_MODEL;

        // Gemini形式のメッセージをOpenAI形式に変換
        const openAIMessages = this.convertGeminiToOpenAIFormat(messagesForApi);

        // システムプロンプトの処理
        if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
            const systemText = systemInstruction.parts[0].text;
            if (systemText) {
                // システムメッセージを先頭に追加
                openAIMessages.unshift({
                    role: 'system',
                    content: systemText
                });
            }
        }

        // リクエストボディの構築
        const requestBody = {
            model: model,
            messages: openAIMessages
        };

        // 生成パラメータの変換
        if (generationConfig) {
            if (generationConfig.temperature !== undefined) {
                requestBody.temperature = generationConfig.temperature;
            }
            if (generationConfig.maxOutputTokens !== undefined) {
                requestBody.max_tokens = generationConfig.maxOutputTokens;
            }
            if (generationConfig.topP !== undefined) {
                requestBody.top_p = generationConfig.topP;
            }
            // Z.ai APIではtop_kはサポートされていない可能性があるため、変換しない
        }

        // Function Callingの処理
        if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
            // Gemini形式のfunction declarationsをOpenAI形式に変換
            const openAITools = [];
            
            for (const geminiTool of window.functionDeclarations) {
                if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                    // Gemini形式: { function_declarations: [{ name, description, parameters }] }
                    for (const funcDecl of geminiTool.function_declarations) {
                        openAITools.push({
                            type: 'function',
                            function: {
                                name: funcDecl.name,
                                description: funcDecl.description || '',
                                parameters: funcDecl.parameters || {}
                            }
                        });
                    }
                } else if (geminiTool.google_search) {
                    // Google SearchはZ.aiではサポートされていない可能性があるためスキップ
                    console.warn("Z.ai APIではGoogle Searchはサポートされていません。スキップします。");
                }
            }

            if (openAITools.length > 0) {
                requestBody.tools = openAITools;
                if (forceCalling) {
                    requestBody.tool_choice = 'required';
                } else {
                    requestBody.tool_choice = 'auto';
                }
                console.log(`Z.ai APIに ${openAITools.length} 個のFunction Callingツールを設定しました。`);
            }
        }

        console.log("Z.aiへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        
        // メッセージ構造の詳細をログ出力（デバッグ用）
        if (requestBody.messages && requestBody.messages.length > 0) {
            const recentMessages = requestBody.messages.slice(-6);
            console.log('[Z.ai Debug] 送信する最近のメッセージ構造:');
            recentMessages.forEach((msg, idx) => {
                const info = { role: msg.role };
                if (msg.tool_calls) {
                    info.tool_calls = msg.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name }));
                }
                if (msg.tool_call_id) {
                    info.tool_call_id = msg.tool_call_id;
                }
                // contentの存在を常に表示（空文字列でも）
                if ('content' in msg) {
                    if (typeof msg.content === 'string') {
                        if (msg.content === '') {
                            info.content = '""'; // 空文字列を明示
                        } else {
                            info.content_preview = msg.content.substring(0, 50) + '...';
                        }
                    } else {
                        info.content_type = typeof msg.content;
                    }
                } else {
                    info.no_content_field = true;
                }
                console.log(`  [${idx}]`, JSON.stringify(info));
            });
        }
        
        console.log("ターゲットエンドポイント:", ZAI_API_BASE_URL);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to Z.ai API...`);

            const response = await fetch(ZAI_API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from Z.ai API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                    } else if (errorData.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // レスポンスを取得してGemini形式に変換
            const openAIResponse = await response.json();
            
            // デバッグ用：Z.ai APIからのレスポンス構造を確認
            if (openAIResponse.choices && openAIResponse.choices[0]) {
                const choice = openAIResponse.choices[0];
                console.log('[Z.ai Debug] APIレスポンス情報:');
                console.log(`  - finish_reason: ${choice.finish_reason}`);
                if (choice.message) {
                    if (choice.message.tool_calls) {
                        console.log(`  - tool_calls数: ${choice.message.tool_calls.length}`);
                        choice.message.tool_calls.forEach((tc, idx) => {
                            console.log(`    [${idx}] id: ${tc.id}, name: ${tc.function?.name}`);
                        });
                    }
                    if (choice.message.content) {
                        console.log(`  - content: ${choice.message.content.substring(0, 50)}...`);
                    }
                }
            }
            
            const geminiFormatResponse = this.convertOpenAIToGeminiFormat(openAIResponse);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: response.status,
                json: async () => geminiFormatResponse
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },

    // OpenRouter APIを呼び出す
    async callOpenRouterApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callOpenRouterApi: OpenRouter APIを呼び出します。`);

        const apiKey = state.settings.openrouterApiKey;
        if (!apiKey) {
            throw new Error("OpenRouter APIキーが設定されていません。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const model = state.settings.modelName || DEFAULT_OPENROUTER_MODEL;

        // Gemini形式のメッセージをOpenAI形式に変換
        const openAIMessages = this.convertGeminiToOpenAIFormat(messagesForApi);

        // システムプロンプトの処理
        if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
            const systemText = systemInstruction.parts[0].text;
            if (systemText) {
                // システムメッセージを先頭に追加
                openAIMessages.unshift({
                    role: 'system',
                    content: systemText
                });
            }
        }

        // リクエストボディの構築
        const requestBody = {
            model: model,
            messages: openAIMessages
        };

        // 生成パラメータの変換
        if (generationConfig) {
            if (generationConfig.temperature !== undefined) {
                requestBody.temperature = generationConfig.temperature;
            }
            if (generationConfig.maxOutputTokens !== undefined) {
                requestBody.max_tokens = generationConfig.maxOutputTokens;
            }
            if (generationConfig.topP !== undefined) {
                requestBody.top_p = generationConfig.topP;
            }
        }

        // Function Callingの処理
        if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
            // Gemini形式のfunction declarationsをOpenAI形式に変換
            const openAITools = [];
            
            for (const geminiTool of window.functionDeclarations) {
                if (geminiTool.function_declarations && Array.isArray(geminiTool.function_declarations)) {
                    // Gemini形式: { function_declarations: [{ name, description, parameters }] }
                    for (const funcDecl of geminiTool.function_declarations) {
                        openAITools.push({
                            type: 'function',
                            function: {
                                name: funcDecl.name,
                                description: funcDecl.description || '',
                                parameters: funcDecl.parameters || {}
                            }
                        });
                    }
                } else if (geminiTool.google_search) {
                    // Google SearchはOpenRouterではサポートされていない可能性があるためスキップ
                    console.warn("OpenRouter APIではGoogle Searchはサポートされていません。スキップします。");
                }
            }

            if (openAITools.length > 0) {
                requestBody.tools = openAITools;
                if (forceCalling) {
                    requestBody.tool_choice = 'required';
                } else {
                    requestBody.tool_choice = 'auto';
                }
                console.log(`OpenRouter APIに ${openAITools.length} 個のFunction Callingツールを設定しました。`);
            }
        }

        console.log("OpenRouterへの送信データ:", JSON.stringify(requestBody, (key, value) => {
            if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 50) + '...[省略]...' + value.substring(value.length - 20);
            }
            return value;
        }, 2));
        
        // メッセージ構造の詳細をログ出力（デバッグ用）
        if (requestBody.messages && requestBody.messages.length > 0) {
            const recentMessages = requestBody.messages.slice(-6);
            console.log('[OpenRouter Debug] 送信する最近のメッセージ構造:');
            recentMessages.forEach((msg, idx) => {
                const info = { role: msg.role };
                if (msg.tool_calls) {
                    info.tool_calls = msg.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name }));
                }
                if (msg.tool_call_id) {
                    info.tool_call_id = msg.tool_call_id;
                }
                // contentの存在を常に表示（空文字列でも）
                if ('content' in msg) {
                    if (typeof msg.content === 'string') {
                        if (msg.content === '') {
                            info.content = '""'; // 空文字列を明示
                        } else {
                            info.content_preview = msg.content.substring(0, 50) + '...';
                        }
                    } else {
                        info.content_type = typeof msg.content;
                    }
                } else {
                    info.no_content_field = true;
                }
                console.log(`  [${idx}]`, JSON.stringify(info));
            });
        }
        
        console.log("ターゲットエンドポイント:", OPENROUTER_API_BASE_URL);

        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${timestamp}] Sending fetch request to OpenRouter API...`);

            const response = await fetch(OPENROUTER_API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Gemini PWA'
                },
                body: JSON.stringify(requestBody),
                signal
            });

            const receivedTimestamp = new Date().toLocaleTimeString();
            console.log(`[API_DEBUG ${receivedTimestamp}] Received response from OpenRouter API. Status: ${response.status}`);

            if (!response.ok) {
                let errorMsg = `APIエラー (${response.status}): ${response.statusText}`;
                let errorData = null;
                try {
                    errorData = await response.json();
                    console.error("APIエラーレスポンスボディ:", errorData);
                    
                    // 詳細なエラー情報をログ出力
                    if (errorData.error) {
                        console.error("[OpenRouter] エラー詳細:", JSON.stringify(errorData.error, null, 2));
                        if (errorData.error.metadata) {
                            console.error("[OpenRouter] メタデータ:", errorData.error.metadata);
                        }
                        if (errorData.error.code) {
                            console.error("[OpenRouter] エラーコード:", errorData.error.code);
                        }
                    }
                    
                    if (errorData.error && errorData.error.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.error.message}`;
                        // OpenRouter特有の追加情報があれば追加
                        if (errorData.error.code) {
                            errorMsg += ` (code: ${errorData.error.code})`;
                        }
                    } else if (errorData.message) {
                        errorMsg = `APIエラー (${response.status}): ${errorData.message}`;
                    }
                } catch (e) {
                    console.error("APIエラーレスポンスボディのパース失敗:", e);
                }
                const error = new Error(errorMsg);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // レスポンスを取得してGemini形式に変換
            const openAIResponse = await response.json();
            
            // デバッグ用：OpenRouter APIからのレスポンス構造を確認
            if (openAIResponse.choices && openAIResponse.choices[0]) {
                const choice = openAIResponse.choices[0];
                console.log('[OpenRouter Debug] APIレスポンス情報:');
                console.log(`  - finish_reason: ${choice.finish_reason}`);
                if (choice.message) {
                    if (choice.message.tool_calls) {
                        console.log(`  - tool_calls数: ${choice.message.tool_calls.length}`);
                        choice.message.tool_calls.forEach((tc, idx) => {
                            console.log(`    [${idx}] id: ${tc.id}, name: ${tc.function?.name}`);
                        });
                    }
                    if (choice.message.content) {
                        console.log(`  - content: ${choice.message.content.substring(0, 50)}...`);
                    }
                }
            }
            
            const geminiFormatResponse = this.convertOpenAIToGeminiFormat(openAIResponse);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: response.status,
                json: async () => geminiFormatResponse
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error("リクエストがキャンセルされました。");
            } else {
                throw error;
            }
        }
    },

    // Amazon Bedrock APIを呼び出す
    async callBedrockApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        console.log(`[Debug] callBedrockApi: Amazon Bedrock APIを呼び出します。`);
        
        const accessKey = state.settings.bedrockAccessKey;
        const secretKey = state.settings.bedrockSecretKey;
        const region = state.settings.bedrockRegion || DEFAULT_BEDROCK_REGION;
        
        // デバッグ情報を出力
        console.log(`[Bedrock Debug] Access Key存在: ${!!accessKey}, Secret Key存在: ${!!secretKey}, Region: ${region}`);
        console.log(`[Bedrock Debug] state.settings:`, {
            bedrockAccessKey: accessKey ? `${accessKey.substring(0, 8)}...` : 'なし',
            bedrockSecretKey: secretKey ? '設定済み' : 'なし',
            bedrockRegion: region
        });
        
        if (!accessKey || !secretKey) {
            console.error('[Bedrock Debug] 認証情報が不足しています。elements確認:', {
                bedrockAccessKeyInput: elements.bedrockAccessKeyInput,
                bedrockSecretKeyInput: elements.bedrockSecretKeyInput,
                bedrockAccessKeyValue: elements.bedrockAccessKeyInput?.value,
                bedrockSecretKeyValue: elements.bedrockSecretKeyInput ? '存在する' : 'なし'
            });
            throw new Error("Bedrock認証情報（Access KeyまたはSecret Key）が設定されていません。");
        }

        // AWS SDK が読み込まれているか確認
        if (!window.BedrockRuntimeClient || !window.ConverseCommand) {
            throw new Error("AWS Bedrock SDK が読み込まれていません。ページを再読み込みしてください。");
        }

        // signalが渡されていない場合のみstate.abortControllerを作成
        if (!signal) {
            state.abortController = new AbortController();
            signal = state.abortController.signal;
        }

        const modelId = state.settings.modelName || DEFAULT_BEDROCK_MODEL;

        try {
            // BedrockRuntimeClientの初期化
            const client = new window.BedrockRuntimeClient({
                region: region,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            });

            // Gemini形式からBedrock Converse形式へ変換
            const converseMessages = this.convertGeminiToConverseFormat(messagesForApi);
            
            // デバッグ: 変換後のメッセージ数とtoolResult数を確認
            console.log(`[Bedrock] 変換後のメッセージ数: ${converseMessages.length}`);
            converseMessages.forEach((msg, idx) => {
                const toolResults = msg.content?.filter(c => c.toolResult) || [];
                if (toolResults.length > 0) {
                    console.log(`[Bedrock] メッセージ${idx} (role: ${msg.role}): ${toolResults.length}個のtoolResultを含む`);
                }
            });
            
            // システムプロンプトの処理
            let systemPrompts = [];
            if (systemInstruction && systemInstruction.parts && systemInstruction.parts.length > 0) {
                const systemText = systemInstruction.parts[0].text;
                if (systemText) {
                    systemPrompts.push({ text: systemText });
                }
            }

            // リクエストボディの構築
            const requestBody = {
                modelId: modelId,
                messages: converseMessages,
                inferenceConfig: {}
            };

            // システムプロンプトを追加
            if (systemPrompts.length > 0) {
                requestBody.system = systemPrompts;
            }

            // 生成設定の追加
            if (generationConfig.maxOutputTokens) {
                requestBody.inferenceConfig.maxTokens = generationConfig.maxOutputTokens;
            }
            
            // Claude Sonnet 4.5では temperature と topP を同時に指定できないため、temperatureのみ使用
            const isClaudeSonnet45 = modelId.includes('claude-sonnet-4-5');
            
            if (generationConfig.temperature !== undefined && generationConfig.temperature !== null) {
                requestBody.inferenceConfig.temperature = generationConfig.temperature;
            }
            
            // Claude Sonnet 4.5以外の場合のみtopPを設定
            if (!isClaudeSonnet45 && generationConfig.topP !== undefined && generationConfig.topP !== null) {
                requestBody.inferenceConfig.topP = generationConfig.topP;
            } else if (isClaudeSonnet45 && generationConfig.topP !== undefined) {
                console.log('[Bedrock] Claude Sonnet 4.5では topP パラメータをスキップします（temperature と topP の同時指定不可のため）');
            }

            // Function Callingの処理
            if (state.settings.geminiEnableFunctionCalling && window.functionDeclarations) {
                const bedrockTools = this.convertGeminiToolsToBedrock(window.functionDeclarations);
                if (bedrockTools.length > 0) {
                    requestBody.toolConfig = {
                        tools: bedrockTools
                    };
                    
                    if (forceCalling) {
                        requestBody.toolConfig.toolChoice = { any: {} };
                    } else {
                        requestBody.toolConfig.toolChoice = { auto: {} };
                    }
                    
                    console.log(`Amazon Bedrock APIに ${bedrockTools.length} 個のFunction Callingツールを設定しました。`);
                }
            }

            console.log("Amazon Bedrockへの送信データ:", JSON.stringify(requestBody, (key, value) => {
                if (key === 'bytes' && value instanceof Uint8Array) {
                    return `[Uint8Array: ${value.length} bytes]`;
                }
                return value;
            }, 2));

            // Converse APIコマンドを実行
            const command = new window.ConverseCommand(requestBody);
            const response = await client.send(command);
            
            console.log("Amazon Bedrockからのレスポンス:", response);

            // レスポンスをGemini形式に変換
            const geminiFormatResponse = this.convertConverseToGeminiFormat(response);

            // Responseオブジェクトのように扱えるようにラップ
            return {
                ok: true,
                status: 200,
                json: async () => geminiFormatResponse
            };

        } catch (error) {
            console.error("Amazon Bedrock API呼び出しエラー:", error);
            throw new Error(`Bedrock APIエラー: ${error.message}`);
        }
    },

    // プロバイダーに応じて適切なAPIを呼び出すラッパー関数
    async callApi(messagesForApi, generationConfig, systemInstruction, tools = null, forceCalling = false, signal = null) {
        const provider = state.settings.apiProvider || 'gemini';
        
        if (provider === 'zai') {
            return await this.callZaiApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'openrouter') {
            return await this.callOpenRouterApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else if (provider === 'bedrock') {
            return await this.callBedrockApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        } else {
            return await this.callGeminiApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, signal);
        }
    }
};

function updateCurrentSystemPrompt() {
    const provider = state.settings.apiProvider;
    const commonPrompt = state.settings.systemPrompt || '';
    const specificPrompt = state.settings.systemPrompt || commonPrompt;

    // 新規チャット(メッセージがまだない状態)の場合のみ、
    // 設定のデフォルト値を state.currentSystemPrompt に反映する。
    // 既存チャットや、新規でもユーザーが編集したチャットは上書きしない。
    if (!state.currentChatId && state.currentMessages.length === 0) {
        state.currentSystemPrompt = specificPrompt;
        console.log(`新規チャットのため、デフォルトのシステムプロンプトを適用しました。`);
    } else {
        console.log(`既存チャットのため、デフォルトのシステムプロンプトによる上書きをスキップしました。`);
    }

    // ログ出力は関数の最後に移動
    console.log(`システムプロンプトを更新しました。Provider: ${provider}, Current Prompt: "${state.currentSystemPrompt.substring(0, 30)}..."`);
}

/**
 * タブ間通信のためのBroadcastChannelを設定する
 */
 function setupBroadcastChannel() {
    if ('BroadcastChannel' in window) {
        try {
            broadcastChannel = new BroadcastChannel('gemini-pwa-sync-channel');
            console.log('[BroadcastChannel] チャンネルに接続しました。');

            broadcastChannel.onmessage = async (event) => {
                const { type, newSyncId, sourceTabId } = event.data;

                // 自分のタブからのメッセージは無視
                if (sourceTabId === state.tabId) {
                    return;
                }

                console.log(`[BroadcastChannel] 他のタブからメッセージを受信:`, event.data);

                if (type === 'SYNC_COMPLETED' && newSyncId) {
                    // 自身のメモリ上の状態を更新
                    state.sync.lastSyncId = newSyncId;
                    state.sync.isDirty = false;
                    state.sync.lastError = null;
                    
                    // DBにも保存
                    await dbUtils.saveSetting('lastSyncId', newSyncId);
                    await dbUtils.saveSetting('syncIsDirty', false);
                    await dbUtils.saveSetting('syncLastError', null);
                    await dbUtils.saveSetting('lastSyncTimestamp', Date.now());

                    // UIを更新
                    await appLogic.updateDropboxUIState();
                }
            };
        } catch (error) {
            console.error('[BroadcastChannel] チャンネルの作成に失敗しました:', error);
        }
    } else {
        console.warn('[BroadcastChannel] このブラウザはBroadcastChannelをサポートしていません。');
    }
}

// --- アプリケーションロジック (appLogic) ---
const appLogic = {
    _setupEventListenersCallCount: 0,

    timerManager: {
        timers: {}, // { timer_name: { timerId: 123, endTime: 167... } }
        
        start(name, minutes) {
            if (this.timers[name]) {
                clearTimeout(this.timers[name].timerId);
                console.log(`タイマー「${name}」は上書きされました。`);
            }
            
            const durationMs = minutes * 60 * 1000;
            const endTime = Date.now() + durationMs;

            const timerId = setTimeout(() => {
                console.log(`タイマー「${name}」が時間切れになりました。自動応答をトリガーします。`);
                // 実行中のタイマーリストから削除
                delete this.timers[name];
                // 自動応答をトリガー
                appLogic.triggerTimerExpiredResponse(name);
            }, durationMs);

            this.timers[name] = { timerId, endTime };
            
            const message = `タイマー「${name}」を${minutes}分で開始しました。`;
            console.log(`[Timer] ${message}`);
            return { success: true, message: message };
        },

        check(name) {
            if (!this.timers[name]) {
                return { success: false, message: `タイマー「${name}」はセットされていません。` };
            }
            const remainingMs = this.timers[name].endTime - Date.now();
            if (remainingMs <= 0) {
                return { success: true, status: "expired", message: `タイマー「${name}」は既に時間切れです。` };
            }
            const remainingMinutes = Math.floor(remainingMs / 60000);
            const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
            const message = `タイマー「${name}」の残り時間は約${remainingMinutes}分${remainingSeconds}秒です。`;
            console.log(`[Timer] ${message}`);
            return { success: true, status: "running", remaining_time: message };
        },

        stop(name) {
            if (!this.timers[name]) {
                return { success: false, message: `タイマー「${name}」はセットされていません。` };
            }
            clearTimeout(this.timers[name].timerId);
            delete this.timers[name];
            const message = `タイマー「${name}」を停止しました。`;
            console.log(`[Timer] ${message}`);
            return { success: true, message: message };
        },
    },

        /**
     * タイマー時間切れ時にAIに応答を促す関数
     * @param {string} timerName - 時間切れになったタイマーの名前
     */
    async triggerTimerExpiredResponse(timerName) {
        // 現在送信中の場合は何もしない
        if (state.isSending) {
            console.warn("タイマーが切れましたが、現在送信中のため自動応答をスキップします。");
            return;
        }
        console.log(`タイマー「${timerName}」の時間切れ応答を生成します。`);

        // ユーザーには見えない内部的な指示メッセージを作成
        const systemInstructionForTimer = `[システムメモ]
タイマー「${timerName}」が時間切れになりました。
この事実を踏まえて、現在の会話の文脈に沿った自然な応答を生成してください。
例えば、「そういえば、約束の時間だね」「時間切れだ！イベントが発生する」のように、会話を続けてください。
このシステムメモ自体は応答に含めないでください。`;

        const userMessage = { 
            role: 'user', 
            content: systemInstructionForTimer, 
            timestamp: Date.now(),
            attachments: [],
            isHidden: true,
            isAutoTrigger: true
        };

        // 履歴にこの内部メッセージを追加
        state.currentMessages.push(userMessage);
        
        // UIにもメッセージ要素を追加するが、即座に非表示にする
        const messageIndex = state.currentMessages.length - 1;
        uiUtils.appendMessage(userMessage.role, userMessage.content, messageIndex);
        const messageElement = elements.messageContainer.querySelector(`.message[data-index="${messageIndex}"]`);
        if (messageElement) {
            messageElement.style.display = 'none';
        }

        // 裏でhandleSendを呼び出す (第3引数 isAutoTrigger を true に設定)
        await this.handleSend(false, -1, true);
    },

    async loadGlobalSettings() {
        try {
            console.log("[GlobalSettings] 共通設定の読み込みを開始します。");
            const storedBlob = await dbUtils.getSetting('backgroundImageBlob');
            if (storedBlob && storedBlob.value instanceof Blob) {
                state.settings.backgroundImageBlob = storedBlob.value;
                console.log("[GlobalSettings] 背景画像BlobをDBから読み込みました。");
            }
        } catch (error) {
            console.error("[GlobalSettings] 共通設定の読み込み中にエラーが発生しました:", error);
            // エラーが発生しても起動処理は続行する
        }
    },

    async loadProfiles() {
        try {
            console.log("[Profile] プロファイルの読み込みを開始します。");
            state.profiles = await dbUtils.getAllProfiles();
            const activeIdSetting = await dbUtils.getSetting('activeProfileId');
            state.activeProfileId = activeIdSetting ? activeIdSetting.value : null;

            if (state.profiles.length === 0) {
                console.warn("[Profile] プロファイルが見つかりません。最初のプロファイルを作成します。");
                const newProfile = {
                    name: "デフォルトプロファイル",
                    icon: null,
                    createdAt: Date.now(),
                    settings: { ...state.settings }
                };
                const newId = await dbUtils.addProfile(newProfile);
                await dbUtils.saveSetting('activeProfileId', newId);
                state.profiles = [await dbUtils.getProfile(newId)];
                state.activeProfileId = newId;
            }

            if (!state.activeProfileId || !state.profiles.some(p => p.id === state.activeProfileId)) {
                state.activeProfileId = state.profiles[0].id;
                await dbUtils.saveSetting('activeProfileId', state.activeProfileId);
                console.log(`[Profile] アクティブなプロファイルが無効でした。最初のプロファイル (ID: ${state.activeProfileId}) をアクティブに設定しました。`);
            }
            
            console.log(`[Profile] ${state.profiles.length}件のプロファイルを読み込みました。アクティブID: ${state.activeProfileId}`);
            this.applyActiveProfile();
            uiUtils.updateProfileSwitcherUI();

        } catch (error) {
            console.error("[Profile] プロファイルの読み込み中に致命的なエラーが発生しました:", error);
            await uiUtils.showCustomAlert(`プロファイルの読み込みに失敗しました: ${error}`);
        }
    },

    applyActiveProfile() {
        state.activeProfile = state.profiles.find(p => p.id === state.activeProfileId);
        if (state.activeProfile) {
            console.log(`[Profile] プロファイル「${state.activeProfile.name}」(ID: ${state.activeProfile.id}) を適用します。`);
            
            // 1. アプリの最新のデフォルト設定をベースにする
            const newSettings = { ...window.state.settings };
            
            // 2. ロードしたプロファイルの設定で上書きする
            const loadedProfileSettings = state.activeProfile.settings || {};
            Object.assign(newSettings, loadedProfileSettings);

            // 3. state.settings を更新する
            state.settings = newSettings;

            uiUtils.applySettingsToUI(); 
            uiUtils.updateProfileCardUI();

            // 4. プロファイル適用後にデバッグロガーを初期化/再設定する
            DebugLogger.init();
        } else {
            console.error(`[Profile] 適用すべきアクティブなプロファイル (ID: ${state.activeProfileId}) が見つかりません。`);
        }
    },


    async switchProfile(newProfileId) {
        newProfileId = Number(newProfileId);
        if (newProfileId === state.activeProfileId) return;
        
        console.log(`[Profile] プロファイルを ID: ${newProfileId} に切り替えます。`);
        await dbUtils.saveSetting('activeProfileId', newProfileId);
        state.activeProfileId = newProfileId;
        
        // プロファイル設定の適用とUI更新のみを行う
        this.applyActiveProfile();
        uiUtils.updateProfileSwitcherUI();
    },

    async saveNewProfile() {
        if (state.profiles.length >= MAX_PROFILES) {
            return uiUtils.showCustomAlert(`プロファイルの上限数（${MAX_PROFILES}個）に達しているため、新しいプロファイルを作成できません。`);
        }
        const profileName = await uiUtils.showCustomPrompt("新しいプロファイル名を入力してください:", "新規プロファイル");
        if (!profileName || !profileName.trim()) {
            console.log("[Profile] 新規保存をキャンセルしました。");
            return;
        }

        const currentSettings = this.getCurrentUiSettings();
        const newProfile = {
            name: profileName.trim(),
            icon: state.activeProfile?.icon || null,
            createdAt: Date.now(),
            settings: currentSettings
        };

        try {
            const newId = await dbUtils.addProfile(newProfile);
            const newlyAddedProfile = await dbUtils.getProfile(newId);
            state.profiles.push(newlyAddedProfile); // stateを更新
            
            await dbUtils.saveSetting('activeProfileId', newId); // activeProfileIdを更新
            state.activeProfileId = newId;
            
            this.markAsDirtyAndSchedulePush(true);
            this.applyActiveProfile();
            uiUtils.updateProfileSwitcherUI();
            await uiUtils.showCustomAlert(`プロファイル「${newProfile.name}」を保存しました。`);
        } catch (error) {
            console.error("[Profile] 新規プロファイルの保存に失敗しました:", error);
            await uiUtils.showCustomAlert(`プロファイルの保存に失敗しました: ${error}`);
        }
    },

    async updateCurrentProfile() {
        if (!state.activeProfile) {
            await uiUtils.showCustomAlert("更新対象のプロファイルが選択されていません。");
            return;
        }
        
        const updatedProfile = { ...state.activeProfile };

        try {
            await dbUtils.updateProfile(updatedProfile);
            // state内のプロファイルリストも更新
            const index = state.profiles.findIndex(p => p.id === updatedProfile.id);
            if (index !== -1) {
                state.profiles[index] = updatedProfile;
            }
            // activeProfile は既に更新されているので再代入は不要

            this.markAsDirtyAndSchedulePush(true);
            
            console.log(`[Profile] プロファイル「${updatedProfile.name}」を更新しました。`);
            this.applyActiveProfile(); // UIに再適用
            uiUtils.updateProfileSwitcherUI();
        } catch (error) {
            console.error("[Profile] プロファイルの更新に失敗しました:", error);
            await uiUtils.showCustomAlert(`プロファイルの更新に失敗しました: ${error.message}`);
        }
    },
    
    async deleteCurrentProfile() {
        if (!state.activeProfile) return;
        if (state.profiles.length <= 1) {
            await uiUtils.showCustomAlert("最後のプロファイルは削除できません。");
            return;
        }

        const confirmed = await uiUtils.showCustomConfirm(`本当にプロファイル「${state.activeProfile.name}」を削除しますか？`);
        if (!confirmed) return;

        try {
            const idToDelete = state.activeProfileId;
            await dbUtils.deleteProfile(idToDelete);
            this.markAsDirtyAndSchedulePush(true);
            
            // stateからも削除
            state.profiles = state.profiles.filter(p => p.id !== idToDelete);
            // アイコンURLキャッシュも削除
            if (state.profileIconUrls.has(idToDelete)) {
                URL.revokeObjectURL(state.profileIconUrls.get(idToDelete));
                state.profileIconUrls.delete(idToDelete);
            }

            // 削除後は残っているリストの最初のプロファイルに切り替える
            const newActiveId = state.profiles[0].id;
            await dbUtils.saveSetting('activeProfileId', newActiveId);
            state.activeProfileId = newActiveId;
            
            this.applyActiveProfile();
            uiUtils.updateProfileSwitcherUI();
            await uiUtils.showCustomAlert("プロファイルを削除しました。");
        } catch (error) {
            console.error("[Profile] プロファイルの削除に失敗しました:", error);
            await uiUtils.showCustomAlert(`プロファイルの削除に失敗しました: ${error}`);
        }
    },

    async editCurrentProfileName() {
        if (!state.activeProfile) return;
        const newName = await uiUtils.showCustomPrompt("新しいプロファイル名:", state.activeProfile.name);
        if (newName && newName.trim() && newName.trim() !== state.activeProfile.name) {
            state.activeProfile.name = newName.trim();
            await this.updateCurrentProfile(); // 更新処理を共通化
        }
    },

    handleProfileIconChange(file) {
        if (!file || !file.type.startsWith('image/')) return;

        // 1. 既存のアイコンURLキャッシュがあれば破棄する
        if (state.activeProfile && state.profileIconUrls.has(state.activeProfile.id)) {
            const oldUrl = state.profileIconUrls.get(state.activeProfile.id);
            URL.revokeObjectURL(oldUrl);
            state.profileIconUrls.delete(state.activeProfile.id);
            console.log(`[Profile] 古いアイコンキャッシュを破棄しました (ID: ${state.activeProfile.id})`);
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const blob = new Blob([e.target.result], { type: file.type });
            if (state.activeProfile) {
                state.activeProfile.icon = blob;
                await this.updateCurrentProfile(); // 更新処理を共通化
            }
        };
        reader.readAsArrayBuffer(file);
    },

    async resetProfileIcon() {
        if (!state.activeProfile) return;
        const confirmed = await uiUtils.showCustomConfirm("アイコンをデフォルトに戻しますか？");
        if (confirmed) {
            state.activeProfile.icon = null;
            if (state.profileIconUrls.has(state.activeProfile.id)) {
                URL.revokeObjectURL(state.profileIconUrls.get(state.activeProfile.id));
                state.profileIconUrls.delete(state.activeProfile.id);
            }
            await this.updateCurrentProfile();
        }
    },

    getCurrentUiSettings() {
        const settings = {};
        const stringKeys = ['apiProvider', 'apiKey', 'zaiApiKey', 'openrouterApiKey', 'bedrockAccessKey', 'bedrockSecretKey', 'bedrockRegion', 'modelName', 'dummyUser', 'dummyModel', 'additionalModels', 'historySortOrder', 'fontFamily', 'proofreadingModelName', 'proofreadingSystemInstruction', 'googleSearchApiKey', 'googleSearchEngineId', 'headerColor', 'thoughtTranslationModel', 'summaryModelName', 'summarySystemPrompt'];
        const numberKeys = ['temperature', 'maxTokens', 'topK', 'topP', 'thinkingBudget', 'maxRetries', 'maxBackoffDelaySeconds', 'overlayOpacity', 'messageOpacity'];
        const booleanKeys = ['enterToSend', 'darkMode', 'geminiEnableGrounding', 'geminiEnableFunctionCalling', 'enableSwipeNavigation', 'enableProofreading', 'enableAutoRetry', 'useFixedRetryDelay', 'reverseDummyOrder', 'concatDummyModel', 'includeThoughts', 'enableThoughtTranslation', 'applyDummyToProofread', 'applyDummyToTranslate', 'forceFunctionCalling', 'autoScroll', 'enableWideMode', 'enableSummaryButton'];
        
        settings.systemPrompt = elements.systemPromptDefaultTextarea.value.trim();
        settings.fixedRetryDelaySeconds = parseFloat(elements.fixedRetryDelayInput.value) || null;
        settings.hideSystemPromptInChat = elements.hideSystemPromptToggle.checked;
        settings.floatingPanelBehavior = elements.floatingPanelBehaviorSelect.value;
        const allowUiChangesEl = document.getElementById('allow-prompt-ui-changes');
        if (allowUiChangesEl) {
            settings.allowPromptUiChanges = allowUiChangesEl.checked;
        }

        stringKeys.forEach(key => {
            // modelNameは特別処理（OpenRouter選択時はテキスト入力から取得）
            if (key === 'modelName') {
                const provider = settings.apiProvider || state.settings.apiProvider || 'gemini';
                if (provider === 'openrouter' && elements.openrouterModelInput) {
                    settings[key] = elements.openrouterModelInput.value.trim();
                } else if (elements.modelNameSelect) {
                    settings[key] = elements.modelNameSelect.value.trim();
                }
            } else {
                const element = elements[key + 'Input'] || elements[key + 'Select'] || elements[key + 'Textarea'];
                if (element) settings[key] = element.value.trim();
            }
        });
        
        numberKeys.forEach(key => {
            let element;
            if (key === 'overlayOpacity' || key === 'messageOpacity') {
                element = elements[key + 'Slider'];
            } else {
                element = elements[key + 'Input'];
            }
            
            if (element) {
                const value = (key === 'overlayOpacity' || key === 'messageOpacity') ? parseFloat(element.value) / 100 : parseFloat(element.value);
                settings[key] = isNaN(value) ? null : value;
            }
        });

        booleanKeys.forEach(key => {
            const element = elements[key + 'Checkbox'] || elements[key + 'Toggle'];
            if (element) settings[key] = element.checked;
        });

        console.log("[Profile] 現在のUIから設定を取得しました:", settings);
        return settings;
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    },

    base64ToBlob(base64, mimeType) {
        return fetch(`data:${mimeType};base64,${base64}`).then(res => res.blob());
    },

    _prepareApiHistory(baseMessages) {
        console.log("[API Prep] 履歴をAPIフォーマットに変換します。");

        // ディープコピーで元のメッセージ配列を保護する
        const messagesForApi = JSON.parse(JSON.stringify(baseMessages));

        let historyToProcess;

        // 要約コンテキストが存在する場合、API送信用の履歴を動的に構築する
        if (state.currentSummarizedContext && state.currentSummarizedContext.summaryText) {
            console.log("[API Prep] 要約コンテキストを検出。API履歴を圧縮します。");
            const { summaryText } = state.currentSummarizedContext;
            const headCount = 5;
            const tailCount = 15;

            const headMessages = messagesForApi.slice(0, headCount);
            const tailMessages = messagesForApi.slice(Math.max(headCount, messagesForApi.length - tailCount));
            
            const summaryMessage = {
                role: 'user',
                content: `【これまでの会話の要約】\n${summaryText}`,
                timestamp: Date.now(),
                isHidden: true, // UIには表示されない内部的なメッセージ
                attachments: []
            };
            
            historyToProcess = [...headMessages, summaryMessage, ...tailMessages];
            console.log(`[API Prep] 履歴を圧縮しました: Head(${headMessages.length}) + Summary(1) + Tail(${tailMessages.length}) = ${historyToProcess.length}件`);

        } else {
            // 通常の履歴
            historyToProcess = messagesForApi;
        }

        // ダミープロンプトの追加処理は共通
        if (state.settings.reverseDummyOrder) {
            // 順序を入れ替える場合: ダミーModel → ダミーUser
            if (state.settings.dummyModel) {
                historyToProcess.push({ role: 'model', content: state.settings.dummyModel, attachments: [] });
            }
            if (state.settings.dummyUser) {
                historyToProcess.push({ role: 'user', content: state.settings.dummyUser, attachments: [] });
            }
        } else {
            // 通常の順序: ダミーUser → ダミーModel
            if (state.settings.dummyUser) {
                historyToProcess.push({ role: 'user', content: state.settings.dummyUser, attachments: [] });
            }
            if (state.settings.dummyModel) {
                historyToProcess.push({ role: 'model', content: state.settings.dummyModel, attachments: [] });
            }
        }
        
        return historyToProcess.map(msg => {
            const parts = [];
            let contentText = msg.content || '';
            if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
                const fileNames = msg.attachments.map(att => att.name).join(', ');
                const attachmentText = `\n\n[添付ファイル: ${fileNames}]`;
                contentText = (contentText.trim() ? contentText : '') + attachmentText;
            }
            if (contentText.trim() !== '' || msg.isHidden) {
                parts.push({ text: contentText });
            }
            if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
                msg.attachments.forEach(att => parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64Data } }));
            }
            if (msg.generated_images && msg.generated_images.length > 0) {
                msg.generated_images.forEach(img => {
                    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
                });
            }
            if (msg.role === 'model' && msg.tool_calls) {
                msg.tool_calls.forEach(toolCall => parts.push({ functionCall: toolCall.functionCall }));
            }
            if (msg.role === 'tool') {
                if (msg.name && msg.response) {
                    parts.push({ 
                        functionResponse: { 
                            name: msg.name, 
                            response: msg.response,
                            _toolCallId: msg._toolCallId || msg.tool_call_id  // 元のtoolCallIdを保存
                        } 
                    });
                }
            }
            return { role: msg.role === 'tool' ? 'tool' : (msg.role === 'model' ? 'model' : 'user'), parts };
        }).filter(c => c.parts.length > 0);
    },





    /**
     * 画像Blobを受け取り、WebPに変換してimage_storeに保存し、新しいIDを返す
     * @param {Blob} blob - 保存対象の画像Blob
     * @returns {Promise<string>} 保存された画像のユニークID
     */
     async saveImageBlob(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    canvas.toBlob(async (webpBlob) => {
                        if (!webpBlob) {
                            console.warn("WebPへの変換に失敗しました。元の形式で保存します。");
                            webpBlob = blob;
                        }
                        
                        const imageId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                        const imageData = {
                            id: imageId,
                            blob: webpBlob,
                            width: img.naturalWidth,  // 幅を追加
                            height: img.naturalHeight, // 高さを追加
                            createdAt: new Date()
                        };

                        try {
                            await dbUtils.openDB();
                            const store = dbUtils._getStore(IMAGE_STORE, 'readwrite');
                            const request = store.put(imageData);
                            request.onsuccess = () => resolve(imageId);
                            request.onerror = (event) => reject(event.target.error);
                        } catch (dbError) {
                            reject(dbError);
                        }
                    }, 'image/webp', 0.9);
                };
                img.onerror = () => reject(new Error("画像データの読み込みに失敗しました。"));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error("FileReaderでBlobの読み込みに失敗しました。"));
            reader.readAsDataURL(blob);
        });
    },


    imageObserver: null, // 画像遅延読み込み用のIntersectionObserver

    /**
     * IDを指定してimage_storeから画像Blobを取得する
     * @param {string} id - 取得する画像のID
     * @returns {Promise<Blob|null>} 画像のBlobオブジェクト、またはnull
     */
    async getImageBlobById(id) {
        try {
            await dbUtils.openDB();
            const store = dbUtils._getStore(IMAGE_STORE, 'readonly');
            return new Promise((resolve, reject) => {
                const request = store.get(id);
                request.onsuccess = (event) => {
                    resolve(event.target.result || null); // オブジェクト全体を返す
                };
                request.onerror = (event) => reject(event.target.error);
            });
        } catch (error) {
            console.error(`ID(${id})の画像Blob取得エラー:`, error);
            return null;
        }
    },



    /**
     * 古い形式の画像データ（チャット履歴埋め込み）を新しいimage_storeに移行する
     * @param {IDBTransaction} transaction - onupgradeneededから渡されるトランザクション
     */
    async migrateImageData() {
        console.log("[DB Migration] v11データ移行処理のチェックを開始します...");
        try {
            const migrationFlag = await dbUtils.getSetting('v11_migration_complete');
            if (migrationFlag && migrationFlag.value) {
                console.log("[DB Migration] v11データ移行は既に完了しています。");
                return;
            }

            console.log("[DB Migration] v11データ移行を開始します...");
            const allChats = await dbUtils.getAllChats();
            let migratedImageCount = 0;

            for (const chat of allChats) {
                let chatModified = false;
                if (!chat.messages) continue;

                for (const message of chat.messages) {
                    if (message.generated_images && message.generated_images.length > 0) {
                        message.imageIds = message.imageIds || [];
                        for (const imgData of message.generated_images) {
                            try {
                                const imageBlob = await this.base64ToBlob(imgData.data, imgData.mimeType);
                                const newImageId = await this.saveImageBlob(imageBlob);
                                message.imageIds.push(newImageId);
                                migratedImageCount++;
                            } catch (error) {
                                console.error(`[DB Migration] チャット(id:${chat.id})の画像移行中にエラー:`, error);
                            }
                        }
                        // 移行が完了したら古いキーは削除
                        delete message.generated_images;
                        chatModified = true;
                    }
                }

                if (chatModified) {
                    console.log(`[DB Migration] チャット(id:${chat.id})を更新します。`);
                    await dbUtils.saveChat(chat.title, chat);
                }
            }

            console.log(`[DB Migration] v11データ移行が完了しました。合計 ${migratedImageCount} 枚の画像を移行しました。`);
            await dbUtils.saveSetting('v11_migration_complete', true);

        } catch (error) {
            console.error("[DB Migration] v11データ移行処理中に致命的なエラーが発生しました:", error);
        }
    },

    applyWideMode() {
        document.body.classList.toggle('wide-mode-enabled', state.settings.enableWideMode);
        // ワイドモードの有効/無効が切り替わった際に、メッセージ幅を再計算する
        updateMessageMaxWidthVar();
    },

    getVisibleMessages() {
        const visibleMessages = [];
        const processedGroupIds = new Set();

        state.currentMessages.forEach((msg) => {
            if (msg.isHidden) return; // isHiddenフラグを持つメッセージは表示しない

            if (msg.isCascaded && msg.siblingGroupId) {
                // 同じグループは一度しか処理しない
                if (!processedGroupIds.has(msg.siblingGroupId)) {
                    const siblings = state.currentMessages.filter(m => m.siblingGroupId === msg.siblingGroupId && !m.isHidden);
                    // 選択されているものを探す。なければ最後のものを採用
                    const selectedSibling = siblings.find(m => m.isSelected) || siblings[siblings.length - 1];
                    if (selectedSibling) {
                        visibleMessages.push(selectedSibling);
                    }
                    processedGroupIds.add(msg.siblingGroupId);
                }
            } else {
                // カスケードでないメッセージはそのまま追加
                visibleMessages.push(msg);
            }
        });
        return visibleMessages;
    },

    _updateApiUsageCount: async function(profileId) {
        if (!profileId) return;
    
        const profileToUpdate = state.profiles.find(p => p.id === profileId);
        if (!profileToUpdate) return;
    
        const now = new Date();
        const getPacificDate = (date) => {
            const options = { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' };
            const formatter = new Intl.DateTimeFormat('en-CA', options);
            return formatter.format(date);
        };
        const todayPacific = getPacificDate(now);
    
        // プロファイルにapiUsageオブジェクトがなければ初期化
        if (!profileToUpdate.apiUsage || profileToUpdate.apiUsage.date !== todayPacific) {
            profileToUpdate.apiUsage = { date: todayPacific, count: 0 };
        }
    
        profileToUpdate.apiUsage.count++;
    
        try {
            // 更新されたプロファイル情報をDBに保存
            await dbUtils.updateProfile(profileToUpdate);
            console.log(`[API Count] Profile ${profileId} の使用回数を更新しました。 Count for ${todayPacific}: ${profileToUpdate.apiUsage.count}`);
            
            // UIを更新
            this.updateApiUsageUI();
            uiUtils.updateProfileSwitcherUI();
        } catch (error) {
            console.error(`[API Count] プロファイルID ${profileId} の使用回数保存に失敗:`, error);
        }
    },

    
    _checkAndResetApiUsage: async function() {
        console.log("[API Count] 全プロファイルのAPI使用回数リセットチェックを開始します...");
        
        const now = new Date();
        const getPacificDate = (date) => {
            const options = { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' };
            const formatter = new Intl.DateTimeFormat('en-CA', options);
            return formatter.format(date);
        };
        const todayPacific = getPacificDate(now);
    
        let profilesWereUpdated = false;
    
        for (const profile of state.profiles) {
            if (profile.apiUsage && profile.apiUsage.date !== todayPacific) {
                console.log(`[API Count] プロファイル「${profile.name}」(ID: ${profile.id}) の日付が古いため (${profile.apiUsage.date})、使用回数をリセットします。`);
                // apiUsageオブジェクトごと削除する
                delete profile.apiUsage;
                
                try {
                    // 更新されたプロファイルをDBに保存
                    await dbUtils.updateProfile(profile);
                    profilesWereUpdated = true;
                } catch (error) {
                    console.error(`[API Count] プロファイルID ${profile.id} のリセット保存に失敗:`, error);
                }
            }
        }
    
        if (profilesWereUpdated) {
            console.log("[API Count] 1つ以上のプロファイルが更新されたため、UIを再描画します。");
            // state.activeProfileも更新されている可能性があるので再適用
            this.applyActiveProfile(); 
            uiUtils.updateProfileSwitcherUI();
        } else {
            console.log("[API Count] リセットが必要なプロファイルはありませんでした。");
        }
    },


    updateApiUsageUI: function() {
        const profile = state.activeProfile;
        const usageContainer = document.getElementById('api-usage-container');
        const usageText = document.getElementById('api-usage-text');
        
        if (!usageContainer || !usageText || !profile) {
            if(usageContainer) usageContainer.classList.add('hidden');
            return;
        }
    
        const usage = profile.apiUsage || { count: 0 };
    
        if (state.settings.modelName === 'gemini-2.5-pro' && state.settings.apiProvider === 'gemini') {
            usageText.textContent = `gemini-2.5-pro 本日の使用回数: ${usage.count} 回 (日本時間16/17時リセット)`;
            usageContainer.classList.remove('hidden');
        } else {
            usageContainer.classList.add('hidden');
        }
    },

    // プロバイダー変更時のUI更新
    updateProviderUI(provider) {
        const isGemini = provider === 'gemini';
        const isZai = provider === 'zai';
        const isOpenRouter = provider === 'openrouter';
        const isBedrock = provider === 'bedrock';
        
        // APIキー入力欄の表示/非表示
        if (elements.geminiApiKeyContainer) {
            elements.geminiApiKeyContainer.classList.toggle('hidden', !isGemini);
        }
        if (elements.zaiApiKeyContainer) {
            elements.zaiApiKeyContainer.classList.toggle('hidden', !isZai);
        }
        if (elements.openrouterApiKeyContainer) {
            elements.openrouterApiKeyContainer.classList.toggle('hidden', !isOpenRouter);
        }
        if (elements.bedrockApiKeyContainer) {
            elements.bedrockApiKeyContainer.classList.toggle('hidden', !isBedrock);
        }
        
        // モデル選択UIの表示/非表示（OpenRouterはテキスト入力、その他はセレクトボックス）
        if (elements.modelNameLabel) {
            elements.modelNameLabel.classList.toggle('hidden', isOpenRouter);
        }
        if (elements.modelNameSelect) {
            elements.modelNameSelect.classList.toggle('hidden', isOpenRouter);
        }
        if (elements.openrouterModelInputContainer) {
            elements.openrouterModelInputContainer.classList.toggle('hidden', !isOpenRouter);
        }
        
        // デバッグモード専用プロバイダーのチェック
        const isDebugOnlyProvider = isZai || isOpenRouter || isBedrock;
        if (!state.settings.debugMode && isDebugOnlyProvider) {
            // デバッグモードOFFならGeminiに戻す
            state.settings.apiProvider = 'gemini';
            if (state.activeProfile && state.activeProfile.settings) {
                state.activeProfile.settings.apiProvider = 'gemini';
                dbUtils.updateProfile(state.activeProfile)
                    .then(() => this.markAsDirtyAndSchedulePush('structural'))
                    .catch(error => console.error("[Settings] APIプロバイダーの同期更新に失敗しました:", error));
            }
            this.updateProviderUI('gemini');
            this.updateModelOptions('gemini');
            uiUtils.showCustomAlert("デバッグモードを無効にしたため、APIプロバイダーをGeminiに戻しました。");
        }
        
        // プロバイダー固有の設定項目の表示/非表示
        // Gemini専用機能（グラウンディング、Function Callingなど）の表示制御は後で実装
    },

    // プロバイダーに応じたモデルリストの更新
    updateModelOptions(provider) {
        // OpenRouterの場合はテキスト入力を使用するためセレクトボックスの更新は不要
        if (provider === 'openrouter') {
            // テキストボックスに現在のモデル名を設定
            if (elements.openrouterModelInput) {
                const currentModel = state.settings.modelName || DEFAULT_OPENROUTER_MODEL;
                elements.openrouterModelInput.value = currentModel;
            }
            // モデル警告メッセージとAPI使用状況の更新
            uiUtils.updateModelWarningMessage();
            this.updateApiUsageUI();
            return;
        }
        
        const modelSelect = elements.modelNameSelect;
        if (!modelSelect) return;
        
        // 既存のオプションをクリア（ユーザー指定モデルグループを除く）
        const userDefinedGroup = elements.userDefinedModelsGroup;
        const currentValue = modelSelect.value;
        
        // すべてのoptgroupとoptionを削除（ユーザー指定グループを除く）
        const optgroups = Array.from(modelSelect.querySelectorAll('optgroup'));
        optgroups.forEach(group => {
            if (group.id !== 'user-defined-models-group') {
                group.remove();
            }
        });
        
        const options = Array.from(modelSelect.querySelectorAll('option:not([data-user-defined])'));
        options.forEach(option => option.remove());
        
        // プロバイダーに応じたモデルリストを追加
        let models;
        if (provider === 'zai') {
            models = ZAI_MODELS;
        } else if (provider === 'bedrock') {
            models = BEDROCK_MODELS;
        } else {
            models = GEMINI_MODELS;
        }
        
        const groups = {};
        
        models.forEach(model => {
            if (model.group) {
                // グループ化されたモデル
                if (!groups[model.group]) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = model.group;
                    modelSelect.appendChild(optgroup);
                    groups[model.group] = optgroup;
                }
                const option = document.createElement('option');
                option.value = model.value;
                option.textContent = model.label;
                groups[model.group].appendChild(option);
            } else {
                // 通常のモデル
                const option = document.createElement('option');
                option.value = model.value;
                option.textContent = model.label;
                modelSelect.appendChild(option);
            }
        });
        
        // ユーザー指定モデルグループを最後に追加
        if (userDefinedGroup && userDefinedGroup.parentNode !== modelSelect) {
            modelSelect.appendChild(userDefinedGroup);
        }
        
        // 現在の値が新しいリストに含まれているか確認
        const availableValues = models.map(m => m.value);
        if (availableValues.includes(currentValue)) {
            modelSelect.value = currentValue;
        } else {
            // デフォルトモデルを設定
            let defaultModel;
            if (provider === 'zai') {
                defaultModel = DEFAULT_ZAI_MODEL;
            } else if (provider === 'openrouter') {
                defaultModel = DEFAULT_OPENROUTER_MODEL;
            } else if (provider === 'bedrock') {
                defaultModel = DEFAULT_BEDROCK_MODEL;
            } else {
                defaultModel = DEFAULT_MODEL;
            }
            modelSelect.value = defaultModel;
            state.settings.modelName = defaultModel;
        }
        
        // モデル警告メッセージを更新
        uiUtils.updateModelWarningMessage();
        this.updateApiUsageUI();
    },

    /**
     * @private 現在の永続メモリから状況サマリーを生成するヘルパー関数
     * @returns {string} AI向けのマークダウン形式のサマリー文字列
     */
    _buildSummaryForPrompt() {
        const memory = state.currentPersistentMemory || {};
        if (Object.keys(memory).length === 0) {
            return '';
        }

        let summary = "【現在の状況サマリー】\n";
        const sections = [];

        // 1. キャラクター記憶 (最優先)
        const characterMemoryEntries = Object.entries(memory).filter(([key]) => key.startsWith('character_memory_'));
        if (characterMemoryEntries.length > 0) {
            let content = characterMemoryEntries.map(([key, value]) => {
                const charName = key.replace('character_memory_', '');
                return `■ ${charName}\n` + JSON.stringify(value, null, 2);
            }).join('\n');
            sections.push(`## キャラクター記憶 (manage_character_memory)\n${content}`);
        }
        
        // 2. シーン
        if (memory.scene_stack && memory.scene_stack.length > 0) {
            const currentScene = memory.scene_stack[memory.scene_stack.length - 1];
            let content = Object.entries(currentScene)
                .map(([key, value]) => `- ${key}: ${value}`)
                .join('\n');
            sections.push(`## シーン (manage_scene)\n${content}`);
        }

        // 3. 日付
        if (typeof memory.game_day === 'number') {
            sections.push(`## 日付 (manage_game_date)\n- 現在: ${memory.game_day}日目`);
        }

        // 4. ステータス
        const statusEntries = Object.entries(memory).filter(([key]) => key.startsWith('character_') && !key.startsWith('character_memory_'));
        if (statusEntries.length > 0) {
            let content = statusEntries.map(([key, value]) => {
                const charName = key.replace('character_', '');
                const statuses = Object.entries(value).map(([sKey, sValue]) => `${sKey}: ${sValue}`).join(', ');
                return `- ${charName}: ${statuses}`;
            }).join('\n');
            sections.push(`## 主要ステータス (manage_character_status)\n${content}`);
        }

        // 5. 所持品
        if (memory.inventories && Object.keys(memory.inventories).length > 0) {
            let content = Object.entries(memory.inventories).map(([charName, items]) => {
                const itemList = Object.entries(items).map(([itemName, qty]) => `${itemName}(${qty})`).join(', ');
                return `- ${charName}: ${itemList}`;
            }).join('\n');
            sections.push(`## 所持品 (manage_inventory)\n${content}`);
        }
        
        // 6. 口調
        if (memory.style_profiles && Object.keys(memory.style_profiles).length > 0) {
            let content = Object.entries(memory.style_profiles).map(([charName, profile]) => {
                const profileDetails = Object.entries(profile).map(([key, value]) => `${key}: ${value}`).join(', ');
                return `- ${charName}: ${profileDetails}`;
            }).join('\n');
            sections.push(`## 口調設定 (manage_style_profile)\n${content}`);
        }

        // 7. フラグと短期記憶 (既知の構造化データキーを除外して抽出)
        const knownKeys = new Set(['scene_stack', 'game_day', 'inventories', 'style_profiles']);
        const flagAndMemoryKeys = Object.keys(memory).filter(key => 
            !key.startsWith('character_') && !knownKeys.has(key)
        );

        if (flagAndMemoryKeys.length > 0) {
            let flagContent = flagAndMemoryKeys.map(key => `- ${key}: ${JSON.stringify(memory[key])}`).join('\n');
            sections.push(`## フラグ・重要設定 (manage_flags, manage_persistent_memory)\n${flagContent}`);
        }

        if (sections.length > 0) {
            summary += sections.join('\n\n');
            return summary;
        }

        return '';
    },

    // アプリ初期化
    async initializeApp() {
        // isSyncReloadフラグはメッセージの切り替えにのみ使用
        const isSyncReload = sessionStorage.getItem('isSyncReload') === 'true';
        // 条件分岐の外で必ずダイアログを表示する
        uiUtils.showProgressDialog(isSyncReload ? 'データベースを準備中...' : '初期化処理を開始中...');

        setupBroadcastChannel();
        let versionNoticeData = null;
    
        // --- ステップ0: バージョンアップ通知 ---
        try {
            const pendingNoticeRaw = sessionStorage.getItem(VERSION_NOTICE_SESSION_KEY);
            if (pendingNoticeRaw) {
                try {
                    versionNoticeData = JSON.parse(pendingNoticeRaw);
                    console.log(`[VersionNotice] ペンディング通知を検出しました。version=${versionNoticeData.version}`);
                } catch (parseError) {
                    console.error("[VersionNotice] ペンディング通知の解析に失敗しました。削除して再生成します。", parseError);
                    sessionStorage.removeItem(VERSION_NOTICE_SESSION_KEY);
                    versionNoticeData = null;
                }
            }

            if (!versionNoticeData) {
                const acknowledgedVersion = localStorage.getItem(VERSION_ACK_STORAGE_KEY);
                const legacyVersion = localStorage.getItem(VERSION_LEGACY_STORAGE_KEY);
                const currentVersion = APP_VERSION;
                console.log(`[VersionNotice] バージョンチェック開始。ack=${acknowledgedVersion ?? 'none'}, legacy=${legacyVersion ?? 'none'}, current=${currentVersion}`);

                const shouldShowNotice =
                    !acknowledgedVersion ||
                    acknowledgedVersion !== currentVersion ||
                    (legacyVersion && legacyVersion !== currentVersion);

                if (shouldShowNotice) {
                    const newFeatures = VERSION_HISTORY[currentVersion];
                    let message = `アプリがバージョン ${currentVersion} にアップデートされました。`;
    
                    if (newFeatures && newFeatures.length > 0) {
                        message += "\n\n主な更新内容:\n- " + newFeatures.join("\n- ");
                    }
                    versionNoticeData = {
                        version: currentVersion,
                        message,
                        shouldPersist: true
                    };
                    sessionStorage.setItem(VERSION_NOTICE_SESSION_KEY, JSON.stringify(versionNoticeData));
                    console.log(`[VersionNotice] 新しいバージョン通知を作成しました。(ack=${acknowledgedVersion ?? 'none'}, legacy=${legacyVersion ?? 'none'})`);
                } else {
                    console.log("[VersionNotice] 既に最新バージョンが確認済みのため通知をスキップします。");
                }
            }
        } catch (e) {
            console.error("バージョンチェック処理中にエラー:", e);
        }
        // --- ステップ1: 最初にDB接続を一度だけ確立する ---
        try {
            if (isSyncReload) uiUtils.updateProgressMessage('データベースを準備中...');
    
            await dbUtils.openDB();
        } catch (dbError) {
            console.error("初期化中のDBオープンに失敗:", dbError);
            const shouldReload = await uiUtils.showCustomConfirm(
                `データベースの起動に失敗しました: ${dbError.message}\n\nハードリロードを実行しますか？\n（チャット履歴などのデータは保持されます）`
            );
            if (shouldReload) {
                console.log("ユーザーがリロードを選択しました。");
                window.location.reload(true);
            } else {
                elements.appContainer.innerHTML = `<p style="padding: 20px; text-align: center; color: red;">アプリの起動に失敗しました。</p>`;
            }
            return;
        }
    
        // --- 孤児画像データのクリーンアップ処理 (一度だけ実行) ---
        try {
            const cleanupFlag = await dbUtils.getSetting('imageStoreCleanup_v1_complete');
            if (!cleanupFlag || !cleanupFlag.value) {
                console.log("[Cleanup] 孤児画像データのクリーンアップ処理を開始します...");
                
                // 1. 全チャットから有効な画像IDをすべて収集
                const allChats = await dbUtils.getAllChats();
                const activeImageIds = new Set();
                allChats.forEach(chat => {
                    (chat.messages || []).forEach(message => {
                        (message.imageIds || []).forEach(id => activeImageIds.add(id));
                    });
                });
                console.log(`[Cleanup] ${activeImageIds.size}件の有効な画像IDを検出しました。`);
    
                // 2. image_storeに存在するすべての画像IDを取得
                const allStoredImageIds = await new Promise((resolve, reject) => {
                    const store = dbUtils._getStore(IMAGE_STORE);
                    const request = store.getAllKeys(); // キーのみを取得
                    request.onsuccess = () => resolve(new Set(request.result));
                    request.onerror = (e) => reject(e.target.error);
                });
                console.log(`[Cleanup] image_storeには ${allStoredImageIds.size}件の画像が存在します。`);
    
                // 3. 孤児IDを特定 (存在するIDのうち、有効でないもの)
                const orphanImageIds = [];
                allStoredImageIds.forEach(storedId => {
                    if (!activeImageIds.has(storedId)) {
                        orphanImageIds.push(storedId);
                    }
                });
    
                // 4. 孤児データを削除
                if (orphanImageIds.length > 0) {
                    console.log(`[Cleanup] ${orphanImageIds.length}件の孤児画像を削除します。`, orphanImageIds);
                    const tx = state.db.transaction(IMAGE_STORE, 'readwrite');
                    const store = tx.objectStore(IMAGE_STORE);
                    orphanImageIds.forEach(id => store.delete(id));
                    
                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = () => reject(tx.error);
                    });
                    console.log("[Cleanup] 孤児画像の削除が完了しました。");
                } else {
                    console.log("[Cleanup] 孤児画像は見つかりませんでした。");
                }
    
                // 5. 処理完了フラグを立てる
                await dbUtils.saveSetting('imageStoreCleanup_v1_complete', true);
                console.log("[Cleanup] クリーンアップ処理が正常に完了しました。");
            } else {
                console.log("[Cleanup] 孤児画像データのクリーンアップは既に完了しています。");
            }
        } catch (error) {
            console.error("[Cleanup] 孤児画像データのクリーンアップ中にエラーが発生しました:", error);
            // このエラーはアプリの起動を妨げない
        }
    
        // --- ステップ2: Dropbox OAuthコールバック処理 ---
        const handleAuthCallback = async () => {
            console.log("[SYNC_DEBUG] handleAuthCallback: 開始");
            const urlParams = new URLSearchParams(window.location.search);
            const authCode = urlParams.get('code');
    
            if (authCode) {
                const newUrl = window.location.origin + window.location.pathname;
                window.history.replaceState({}, document.title, newUrl);
    
                uiUtils.showProgressDialog('Dropboxと連携中...');
                try {
                    const REDIRECT_URI = window.location.origin + window.location.pathname;
                    const codeVerifier = sessionStorage.getItem('dropboxCodeVerifier');
    
                    if (!codeVerifier) {
                        throw new Error("認証セッションが見つかりません。もう一度お試しください。");
                    }
    
                    await window.dropboxApi.getAccessToken(authCode, REDIRECT_URI, codeVerifier);
                    
                    console.log("Dropbox連携に成功し、トークンを保存しました。");
    
                    await this.updateDropboxUIState();
                    
                    console.log("[SYNC_DEBUG] handleAuthCallback: 初回連携のため、handlePull(true)を呼び出します。");
                    await this.handlePull(true);
    
                    console.log("[SYNC_DEBUG] handleAuthCallback: handlePullが完了しました。");
    
                } catch (error) {
                    console.error("Dropboxのトークン取得に失敗:", error);
                    uiUtils.hideProgressDialog();
                    await uiUtils.showCustomAlert(`連携に失敗しました: ${error.message}`);
                } finally {
                    sessionStorage.removeItem('dropboxCodeVerifier');
                }
            }
        };
        
        await handleAuthCallback();
    
        // --- ステップ3: メイン初期化処理 ---
        
        // ライブラリと基本設定
        if (typeof marked !== 'undefined') {
            const renderer = new marked.Renderer();
            const originalLinkRenderer = renderer.link;
            renderer.link = (href, title, text) => {
                const html = originalLinkRenderer.call(renderer, href, title, text);
                return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
            };
            marked.setOptions({ renderer, breaks: true, gfm: true, sanitize: true, smartypants: false });
        } else {
            console.error("Marked.jsライブラリが読み込まれていません！");
        }
        elements.appVersionSpan.textContent = APP_VERSION;
        window.addEventListener('beforeinstallprompt', (e) => e.preventDefault());
        
        // デバッグ用ヘルパー
        window.debug = {
            getState: () => console.log(state),
            getMemory: () => console.log(state.currentPersistentMemory),
            getChat: async (id) => console.log(await dbUtils.getChat(id || state.currentChatId))
        };
        
        // Service Worker登録
        registerServiceWorker();
        
        // Observerの初期化
        this.imageObserver = new IntersectionObserver(async (entries, observer) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const imageId = img.dataset.imageId;
                    observer.unobserve(img);
                    const imageData = await this.getImageBlobById(imageId);
                    if (imageData && imageData.blob) {
                        if (imageData.width && imageData.height) {
                            img.width = imageData.width;
                            img.height = imageData.height;
                        }
                        const objectURL = URL.createObjectURL(imageData.blob);
                        img.src = objectURL;
                        img.alt = '生成された画像';
                    } else {
                        img.alt = '画像の読み込みに失敗しました';
                        img.classList.add('load-error');
                    }
                }
            }
        }, { rootMargin: '200px' });
    
        const mutationObserver = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.removedNodes.forEach(node => {
                        const imagesToRevoke = [];
                        if (node.tagName === 'IMG' && node.src.startsWith('blob:')) {
                            imagesToRevoke.push(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('img[src^="blob:"]').forEach(img => imagesToRevoke.push(img));
                        }
                        imagesToRevoke.forEach(img => {
                            console.log(`[Memory] DOMから削除された画像のURLを解放します: ${img.src}`);
                            URL.revokeObjectURL(img.src);
                        });
                    });
                }
            }
        });
        mutationObserver.observe(elements.messageContainer, { childList: true, subtree: true });
    
        try {
            // --- ステップ4: データ読み込みとUI更新 ---
            if (isSyncReload) uiUtils.updateProgressMessage('各種設定を読み込み中...');
            await this.loadGlobalSettings();
            if (isSyncReload) uiUtils.updateProgressMessage('プロファイル情報を読み込み中...');
            await this.loadProfiles();

            await this._checkAndResetApiUsage();
            this.updateApiUsageUI();
            await this.initializeSyncState();
            await this.updateDropboxUIState();
    
            const tokenData = await dbUtils.getSetting('dropboxTokens');
            let recoveryFlowExecuted = false; // リカバリーフローが実行されたかどうかのフラグ
            if (tokenData && tokenData.value) {
                const lockData = await window.dropboxApi.checkLockFile();
                if (lockData && lockData.operation) {
                    recoveryFlowExecuted = true;
                    console.warn(`[Sync Recovery] 同期ロックファイルを検出。中断された操作: ${lockData.operation}`);
                    this.updateSyncStatusUI('syncing', `中断された${lockData.operation === 'push' ? '同期' : '復元'}を再開中...`);
    
                    if (lockData.operation === 'push') {
                        // isDirtyフラグを強制的に立ててからPushを実行
                        state.sync.isDirty = true;
                        await this.handlePush(false);
                    } else if (lockData.operation === 'pull') {
                        await this.handlePull(false);
                    }
                } else if (lockData) {
                    // 旧形式のロックファイル、または内容が不正な場合
                    recoveryFlowExecuted = true;
                    console.warn("[Sync Recovery] 操作タイプ不明のロックファイルを検出。ユーザーに選択を促します。");
                    const choice = await this.showRecoveryDialog();
                    if (choice === 'pull') {
                        await this.handlePull(true);
                    } else if (choice === 'push') {
                        state.sync.isDirty = true;
                        await this.handlePush(true);
                    } else {
                        await window.dropboxApi.deleteLockFile();
                    }
                }
            }
    
            // 起動時にPull処理を実行 (OAuthコールバックがなく、リカバリーフローも実行されなかった場合)
            if (!new URLSearchParams(window.location.search).has('code') && !recoveryFlowExecuted) {
                console.log("[SYNC_DEBUG] initializeApp: 通常起動のため、handlePull(false)を呼び出します。");
                await this.handlePull(false);
            } else {
                console.log("[SYNC_DEBUG] initializeApp: OAuthコールバックまたは復旧フローが実行されたため、通常のPullはスキップします。");
            }
    
            await this.updateDropboxUIState();
    
            const profiles = await dbUtils.getAllProfiles();
            if (profiles.length === 0) {
                const oldSettingsArray = await new Promise((resolve, reject) => {
                    const store = dbUtils._getStore(SETTINGS_STORE);
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result.filter(s => s.key !== 'dropboxTokens'));
                    request.onerror = (e) => reject(e.target.error);
                });
    
                if (oldSettingsArray.length > 0) {
                    console.log("[Migration] プロファイルが存在せず、古い設定データが見つかったため移行処理を実行します。");
                    const oldSettingsObject = {};
                    oldSettingsArray.forEach(item => { oldSettingsObject[item.key] = item.value; });
                    const initialProfileSettings = { ...state.settings, ...oldSettingsObject };
                    delete initialProfileSettings.backgroundImageBlob;
                    const defaultProfile = { name: "デフォルトプロファイル", icon: null, createdAt: Date.now(), settings: initialProfileSettings };
                    const newId = await dbUtils.addProfile(defaultProfile);
                    await new Promise((resolve, reject) => {
                        const store = dbUtils._getStore(SETTINGS_STORE, 'readwrite');
                        store.clear().onsuccess = () => resolve();
                        store.transaction.onerror = () => reject(store.transaction.error);
                    });
                    await dbUtils.saveSetting('activeProfileId', newId);
                    console.log("[Migration] データ移行が完了しました。");
                    await this.loadProfiles();
                }
            }
    
            if (isSyncReload) uiUtils.updateProgressMessage('チャット履歴を読み込み中...');
    
            const chats = await dbUtils.getAllChats(state.settings.historySortOrder);
            if (chats && chats.length > 0) {
                await this.loadChat(chats[0].id);
            } else {
                this.startNewChat();
            }
    
        } catch (error) {
            console.error("初期化中のデータ処理で失敗:", error);
            const shouldReload = await uiUtils.showCustomConfirm(
                `データの読み込みに失敗しました: ${error.message}\n\nハードリロードを実行しますか？\n（チャット履歴などのデータは保持されます）`
            );
            if (shouldReload) {
                console.log("ユーザーがリロードを選択しました。");
                window.location.reload(true);
                return; // リロード後は処理を終了
            }
        } finally {
            // --- ステップ5: 最終的なUI設定と表示 ---
            if (isSyncReload) uiUtils.updateProgressMessage('画面を描画中...');
            elements.chatScreen.style.transform = 'translateX(0)';
            elements.historyScreen.style.transform = 'translateX(-100%)';
            elements.settingsScreen.style.transform = 'translateX(100%)';
            uiUtils.showScreen('chat', true);
            history.replaceState({ screen: 'chat' }, '', '#chat');
            state.currentScreen = 'chat';
            
            updateMessageMaxWidthVar();
            this.setupEventListeners();
            this.updateZoomState();
            uiUtils.adjustTextareaHeight();
            uiUtils.setSendingState(false);
            this.updateAssetCount();
            this.toggleSummaryButtonVisibility();
            this.scrollToBottom();
            this.applyFloatingPanelBehavior();
            
            // finallyブロックで必ずダイアログを閉じる
            uiUtils.hideProgressDialog();
            sessionStorage.removeItem('isSyncReload');

            if (versionNoticeData && versionNoticeData.message) {
                try {
                    console.log(`[VersionNotice] 通知を表示します。version=${versionNoticeData.version}`);
                    await uiUtils.showCustomAlert(versionNoticeData.message);
                    console.log("[VersionNotice] 通知がユーザーによって確認されました。");
                    if (versionNoticeData.shouldPersist) {
                        localStorage.setItem(VERSION_ACK_STORAGE_KEY, versionNoticeData.version);
                        localStorage.setItem(VERSION_LEGACY_STORAGE_KEY, versionNoticeData.version);
                        console.log(`[VersionNotice] バージョン ${versionNoticeData.version} をACK/LEGACYキーに保存しました。`);
                    }
                } catch (versionAlertError) {
                    console.error("[VersionNotice] 通知の表示に失敗しました:", versionAlertError);
                } finally {
                    sessionStorage.removeItem(VERSION_NOTICE_SESSION_KEY);
                }
            }
        }
    },

    
    // 復旧ダイアログを表示するヘルパー関数
    async showRecoveryDialog() {
        const pullConfirm = await uiUtils.showCustomConfirm(
            "【同期エラーの復旧】\n\n" +
            "前回の同期が正常に完了しなかったようです。\n\n" +
            "クラウドのデータで現在のブラウザのデータを上書き復元しますか？ (推奨)\n\n" +
            "※「キャンセル」を押すと、ローカルのデータでクラウドを上書きする選択肢が表示されます。"
        );
        if (pullConfirm) {
            return 'pull';
        }

        const pushConfirm = await uiUtils.showCustomConfirm(
            "【同期エラーの復旧】\n\n" +
            "現在のブラウザのデータで、クラウド上のデータを強制的に上書きしますか？\n\n" +
            "※ 他のデバイスで行った変更が失われる可能性があります。"
        );
        if (pushConfirm) {
            return 'push';
        }

        return 'cancel';
    },    

    /**
     * 同期関連の初期化処理
     */
    async initializeSyncState() {
        const [lastSyncIdSetting, isDirtySetting, lastErrorSetting] = await Promise.all([
            dbUtils.getSetting('lastSyncId'),
            dbUtils.getSetting('syncIsDirty'),
            dbUtils.getSetting('syncLastError')
        ]);

        state.sync.lastSyncId = lastSyncIdSetting ? lastSyncIdSetting.value : null;
        state.sync.isDirty = isDirtySetting ? isDirtySetting.value : false;
        state.sync.lastError = lastErrorSetting ? lastErrorSetting.value : null;
        
        console.log(`[Sync] 同期状態を初期化しました。lastSyncId: ${state.sync.lastSyncId}, isDirty: ${state.sync.isDirty}, lastError:`, state.sync.lastError);
    },

    /**
     * ローカルデータに変更があったことを記録し、設定に応じてPush処理をスケジュールする
     * @param {boolean} [forcePush=false] - trueの場合、同期頻度の設定を無視して即時Pushを実行する
     */
    markAsDirtyAndSchedulePush(type = 'message') {
        const timestamp = new Date().toLocaleTimeString();
        const normalizedType = type === true ? 'structural' : type;

        console.log(`[SYNC_DEBUG ${timestamp}] markAsDirtyAndSchedulePush called. type=${normalizedType}, isSending=${state.isSending}, isSyncing=${state.sync.isSyncing}, isDirty=${state.sync.isDirty}`);

        const tokenDataPromise = dbUtils.getSetting('dropboxTokens');
        if (!tokenDataPromise) {
            console.log(`[SYNC_DEBUG ${timestamp}] -> SKIPPED: Dropbox not connected.`);
            return;
        }

        if (state.sync.isSyncing) {
            console.log(`[SYNC_DEBUG ${timestamp}] -> SKIPPED: Already syncing.`);
            return;
        }

        if (!state.sync.isDirty) {
            state.sync.isDirty = true;
            dbUtils.saveSetting('syncIsDirty', true);
            console.log(`[SYNC_DEBUG ${timestamp}] -> State set to DIRTY.`);
        }
        this.updateSyncStatusUI('dirty');

        if (normalizedType === 'message' && state.isSending) {
            console.log(`[SYNC_DEBUG ${timestamp}] -> SKIPPED: AI is responding (isSending=true).`);
            return;
        }

        const frequency = state.settings.dropboxSyncFrequency;

        if (frequency === 'manual') {
            if (normalizedType === 'message') {
                console.log(`[SYNC_DEBUG ${timestamp}] -> SKIPPED: Manual sync mode for message update.`);
                return;
            }
            console.log(`[SYNC_DEBUG ${timestamp}] -> EXECUTING: Structural change detected in manual sync mode. Forcing push.`);
            this.handlePush();
            return;
        }

        // 構造的な変更は常に即時Push
        if (normalizedType !== 'message') {
            console.log(`[SYNC_DEBUG ${timestamp}] -> EXECUTING: Non-message change detected. Triggering push immediately.`);
            this.handlePush();
            return;
        }

        // メッセージターンの完了をカウント
        state.syncMessageCounter++;
        console.log(`[SYNC_DEBUG ${timestamp}] Message counter incremented to: ${state.syncMessageCounter}`);

        // 既存の予約があればクリア
        if (state.sync.pushTimeoutId) {
            clearTimeout(state.sync.pushTimeoutId);
            state.sync.pushTimeoutId = null;
        }

        if (frequency === 'instant') {
            console.log(`[SYNC_DEBUG ${timestamp}] -> EXECUTING: Instant mode, pushing immediately.`);
            this.handlePush();
            state.syncMessageCounter = 0;
            return;
        }

        const threshold = parseInt(frequency, 10);
        if (!isNaN(threshold)) {
            if (state.syncMessageCounter >= threshold) {
                console.log(`[SYNC_DEBUG ${timestamp}] -> EXECUTING: Threshold (${threshold}) reached. Triggering push immediately.`);
                this.handlePush();
                state.syncMessageCounter = 0;
            } else {
                console.log(`[SYNC_DEBUG ${timestamp}] -> WAITING: Threshold (${threshold}) not reached yet.`);
            }
            return;
        }

        // その他の設定値の場合は安全のため即時実行
        console.log(`[SYNC_DEBUG ${timestamp}] -> EXECUTING: Unrecognized frequency '${frequency}'. Triggering push as fallback.`);
        this.handlePush();
        state.syncMessageCounter = 0;
    },



    /**
     * [V2 Core Push] 実際にアップロード処理を行うコア関数
     * @private
     */
     async _doPush(isManual = false) {
        console.log(`[SYNC_DEBUG] _doPush: 開始。isManual = ${isManual}`);

        if (state.sync.isSyncing) {
            console.log("[Sync Core Push V2] 既に別の同期処理が実行中のため、今回の要求はスキップします。");
            return;
        }
        state.sync.isSyncing = true;
        const updateProgress = (message) => {
            console.log(`[SYNC_DEBUG] updateProgress: isManual=${isManual}, message="${message}"`);
            this.updateSyncStatusUI('syncing', message);
            if (isManual) {
                console.log(`[SYNC_DEBUG] updateProgress: isManual=trueのため、updateProgressMessageを呼び出します。`);
                uiUtils.updateProgressMessage(message);
            }
        };

        updateProgress('同期準備中...');

        try {
            // 操作タイプ 'push' を渡す
            await window.dropboxApi.uploadLockFile('push');

            // --- Step 1: 競合検知 ---
            updateProgress('クラウドの状態を確認中...');
            const cloudMetadataString = await window.dropboxApi.downloadMetadata();
            
            if (cloudMetadataString) {
                const cloudData = JSON.parse(cloudMetadataString);
                if (cloudData.syncId !== state.sync.lastSyncId) {
                    console.warn(`[Sync Push] 競合を検出！ Local: ${state.sync.lastSyncId}, Cloud: ${cloudData.syncId}`);
                    if (isManual) uiUtils.hideProgressDialog();
                    const confirmed = await uiUtils.showCustomConfirm(
                        "【警告：同期の競合】\n\n" +
                        "クラウド上のデータが、このデバイスが最後に同期した状態から変更されています。（他のデバイスが先に同期した可能性があります）\n\n" +
                        "このまま同期を実行すると、クラウド上のデータがこのデバイスのデータで完全に上書きされます。\n\n" +
                        "クラウドのデータを上書きして同期を続行しますか？"
                    );
                    if (!confirmed) {
                        console.log("[Sync Push] ユーザーが上書きをキャンセルしました。Push処理を中断します。");
                        state.sync.isSyncing = false;
                        this.updateSyncStatusUI('dirty');
                        if (isManual) uiUtils.showCustomAlert("同期がキャンセルされました。");
                        // キャンセル時もロックファイルは削除する
                        await window.dropboxApi.deleteLockFile();
                        return;
                    }
                    if (isManual) uiUtils.showProgressDialog('同期を再開しています...');
                    console.log("[Sync Push] ユーザーが上書きを承認しました。Push処理を続行します。");
                }
            }

            // --- Step 2: データ準備 ---
            await window.dropboxApi.ensureAssetsFolderExists();
            
            updateProgress('ローカルデータを準備中...');
            const { metadataJson, localAssets } = await this._prepareExportData();
            const localAssetIds = new Set(localAssets.keys());

            const cloudAssetsList = await window.dropboxApi.listAssets();
            const cloudAssetIds = new Set(cloudAssetsList.map(asset => asset.name));

            const assetsToUploadArray = Array.from(localAssets.entries())
                .filter(([assetId]) => !cloudAssetIds.has(assetId))
                .map(([assetId, asset]) => ({ assetId, asset }));
                
            const assetsToDelete = Array.from(cloudAssetIds).filter(id => !localAssetIds.has(id));

            // --- Step 3: アセットのアップロード（バッチ処理） ---
            if (assetsToUploadArray.length > 0) {
                console.log(`[Sync Core Push V2] ${assetsToUploadArray.length}個のアセットをバッチアップロードします。`);
                const progressCallback = (current, total) => {
                    updateProgress(`アセットをアップロード中 (${current}/${total})`);
                };
                await window.dropboxApi.uploadAssetsInBatches(assetsToUploadArray, progressCallback);
            } else {
                console.log("[Sync Core Push V2] アップロードする新規アセットはありません。");
            }

            // --- Step 4: 不要なアセットの削除 ---
            if (assetsToDelete.length > 0) {
                console.log(`[Sync Core Push V2] ${assetsToDelete.length}個の不要なアセットを削除します。`);
                updateProgress(`${assetsToDelete.length}個の不要アセットを削除中...`);
                await window.dropboxApi.deleteAssets(assetsToDelete);
            }

            // --- Step 5: メタデータのアップロード ---
            updateProgress('最終データを保存中...');
            const parsedMetadata = JSON.parse(metadataJson);

            await window.dropboxApi.uploadMetadata(metadataJson);

            // --- Step 6: 状態の更新 ---
            const syncTimestamp = new Date(parsedMetadata.exportedAt).getTime();
            state.sync.lastSyncId = parsedMetadata.syncId;
            state.sync.isDirty = false;
            state.sync.lastError = null;
            await Promise.all([
                dbUtils.saveSetting('lastSyncId', parsedMetadata.syncId),
                dbUtils.saveSetting('syncIsDirty', false),
                dbUtils.saveSetting('syncLastError', null),
                dbUtils.saveSetting('lastSyncTimestamp', syncTimestamp)
            ]);

            if (broadcastChannel) {
                broadcastChannel.postMessage({
                    type: 'SYNC_COMPLETED',
                    newSyncId: parsedMetadata.syncId,
                    sourceTabId: state.tabId
                });
            }
            
            this.updateSyncStatusUI('idle');
            await this.updateDropboxUIState();
            console.log(`[Sync Core Push V2] Push成功。新しいsyncId: ${parsedMetadata.syncId}`);
            if (isManual) {
                uiUtils.hideProgressDialog();
            }

        } catch (error) {
            const errorMessage = error.message || '不明なアップロードエラーが発生しました。';
            this.updateSyncStatusUI('error', errorMessage);
            console.error("[Sync Core Push V2] Push処理中にエラーが発生しました:", error);
            if (isManual) {
                uiUtils.hideProgressDialog();
                uiUtils.showCustomAlert(`同期に失敗しました: ${errorMessage}`);
            }
        } finally {
            state.sync.isSyncing = false;
            await window.dropboxApi.deleteLockFile();
            console.log(`[SYNC_DEBUG] _doPush: 終了。`);
        }
    },

    /**
     * [Push Gatekeeper] ローカルの変更をDropboxにアップロードする処理の呼び出しを管理する
     */
    handlePush(isManual = false) {
        if (state.sync.isSyncing || !state.sync.isDirty) {
            return;
        }
        dbUtils.getSetting('dropboxTokens').then(tokenData => {
            if (!tokenData || !tokenData.value) {
                return;
            }
            // 手動実行の場合はプログレスダイアログを表示
            if (isManual) {
                uiUtils.showProgressDialog('同期を開始しています...');
            }
            this._doPush(isManual).catch(error => { // isManualフラグを渡す
                console.error("[Sync Push] バックグラウンドPush処理でエラー:", error);
                if (isManual) {
                    uiUtils.hideProgressDialog();
                    uiUtils.showCustomAlert(`同期に失敗しました: ${error.message}`);
                }
            });
        });
    },

    /**
     * [V2 Pull] Dropboxからデータをダウンロードして同期する
     */
     async handlePull(isManual = false) {
        console.log(`[SYNC_DEBUG] handlePull: 開始。isManual = ${isManual}`);

        if (state.sync.isSyncing) {
            console.log(`[Sync Pull] スキップしました (isSyncing: ${state.sync.isSyncing})`);
            return;
        }

        const tokenData = await dbUtils.getSetting('dropboxTokens');
        if (!tokenData || !tokenData.value) {
            console.log("[Sync Pull] Dropbox未連携のためスキップしました。");
            return;
        }

        console.log("[Sync Pull V2] Pull処理を開始します。");
        state.sync.isSyncing = true;
        this.updateSyncStatusUI('syncing', 'クラウドと通信中...');
        if (isManual) {
            console.log("[SYNC_DEBUG] handlePull: isManual=trueのため、showProgressDialogを呼び出します。");
            uiUtils.showProgressDialog('クラウドと通信中...');
        }

        try {
            await window.dropboxApi.uploadLockFile('pull');

            const cloudMetadataString = await window.dropboxApi.downloadMetadata();

            if (cloudMetadataString === null) {
                console.log("[Sync Pull V2] クラウドにファイルが見つかりません。");
                const localChats = await dbUtils.getAllChats();
                if (localChats.length > 0 || state.sync.isDirty) {
                    console.log("[Sync Pull V2] ローカルにデータが存在するため、初回Pushを実行します。");
                    if (isManual) {
                        console.log("[SYNC_DEBUG] handlePull: isManual=trueのため、updateProgressMessageを呼び出します。");
                        uiUtils.updateProgressMessage('初回データをクラウドに保存中...');
                    }
                    
                    state.sync.isSyncing = false; 

                    await window.dropboxApi.deleteLockFile();
                    console.log(`[SYNC_DEBUG] handlePull: _doPushを呼び出します。isManual = ${isManual}`);
                    await this._doPush(isManual);
                } else {
                    console.log("[Sync Pull V2] ローカルもクラウドも空のため、同期処理は不要です。");
                    this.updateSyncStatusUI('idle');
                    if (isManual) uiUtils.hideProgressDialog();
                }
                return;
            }

            const cloudData = JSON.parse(cloudMetadataString);

            const cloudSyncId = cloudData.syncId;

            console.log(`[Sync Pull V2] Cloud syncId: ${cloudSyncId}, Local lastSyncId: ${state.sync.lastSyncId}`);

            if (cloudSyncId !== state.sync.lastSyncId) {
                if (state.sync.isDirty) {
                    if (isManual) uiUtils.hideProgressDialog();
                    const confirmed = await uiUtils.showCustomConfirm(
                        "【警告：データの同期に関する重要な確認】\n\n" +
                        "クラウド上に、このデバイスとは異なるデータが見つかりました。\n\n" +
                        "同期を実行すると、このデバイスの全てのデータ（チャット、プロファイル等）が完全に削除され、クラウド上のデータで置き換えられます。\n" +
                        "（データが統合・マージされるわけではありません）\n\n" +
                        "このデバイスのデータを残したい場合は、一度「キャンセル」を押し、履歴画面から各チャットを個別に出力してバックアップを作成してください。\n\n" +
                        "クラウドのデータで同期を開始してもよろしいですか？"
                    );
                    if (!confirmed) {
                        console.log("[Sync Pull] ユーザーが上書きをキャンセルしました。");
                        this.updateSyncStatusUI('dirty');
                        if (isManual) uiUtils.showCustomAlert("同期がキャンセルされました。");
                        state.sync.isSyncing = false;
                        await window.dropboxApi.deleteLockFile();
                        return;
                    }
                    if (isManual) uiUtils.showProgressDialog('同期を再開しています...');
                }

                const importResult = await this.importDataFromString(cloudMetadataString);
                const removedAssetInfo = importResult.removedAssetInfo;

                state.sync.lastSyncId = importResult.syncId;
                state.sync.isDirty = false;
                state.sync.lastError = null;
                
                const syncTimestamp = new Date(importResult.exportedAt).getTime();
                await Promise.all([
                    dbUtils.saveSetting('lastSyncId', importResult.syncId),
                    dbUtils.saveSetting('syncIsDirty', false),
                    dbUtils.saveSetting('syncLastError', null),
                    dbUtils.saveSetting('lastSyncTimestamp', syncTimestamp)
                ]);

                if (broadcastChannel) {
                    broadcastChannel.postMessage({
                        type: 'SYNC_COMPLETED',
                        newSyncId: importResult.syncId,
                        sourceTabId: state.tabId
                    });
                }

                this.updateSyncStatusUI('idle');
                if (isManual) uiUtils.hideProgressDialog();

                let finalMessage = "クラウドからデータを同期しました。アプリを再起動します。";
                if (removedAssetInfo && Object.keys(removedAssetInfo).length > 0) {
                    let cleanupDetails = "\n\n【通知】\nクラウド上で実体が見つからなかったため、以下のチャットから画像添付の記録を削除しました：\n";
                    for (const chatTitle in removedAssetInfo) {
                        cleanupDetails += `・「${chatTitle}」から ${removedAssetInfo[chatTitle].length} 件\n`;
                    }
                    finalMessage += cleanupDetails;
                }

                await uiUtils.showCustomAlert(finalMessage);
                sessionStorage.setItem('isSyncReload', 'true'); // リロード後の処理のためにフラグを立てる
                window.location.reload();

            } else {
                console.log("[Sync Pull V2] ローカルは既に最新です。同期は不要です。");
                await dbUtils.saveSetting('lastSyncTimestamp', Date.now());
                this.updateSyncStatusUI('idle');
                await this.updateDropboxUIState();
                if (isManual) {
                    uiUtils.hideProgressDialog();
                }
            }

        } catch (error) {
            const errorMessage = error.message || '不明な同期エラーが発生しました。';
            this.updateSyncStatusUI('error', errorMessage);
            console.error("[Sync Pull V2] Pull処理中にエラーが発生しました:", error);
            if (isManual) {
                uiUtils.hideProgressDialog();
                await uiUtils.showCustomAlert(`同期に失敗しました: ${errorMessage}`);
            }
        } finally {
            state.sync.isSyncing = false;
            await window.dropboxApi.deleteLockFile();
            console.log(`[SYNC_DEBUG] handlePull: 終了。`);
        }
    },

    // イベントリスナーを設定
    setupEventListeners() {
        if (!this._popstateBound) {
            window.addEventListener('popstate', this.handlePopState.bind(this));
            this._popstateBound = true;
        }
    
        this._setupEventListenersCallCount++;
    
        // --- 画面遷移 ---
        elements.gotoHistoryBtn.addEventListener('click', () => uiUtils.showScreen('history'));
        elements.gotoSettingsBtn.addEventListener('click', () => uiUtils.showScreen('settings'));
        elements.backToChatFromHistoryBtn.addEventListener('click', () => uiUtils.showScreen('chat'));
        elements.backToChatFromSettingsBtn.addEventListener('click', () => uiUtils.showScreen('chat'));
    
        // --- チャット関連 ---
        elements.newChatBtn.addEventListener('click', () => this.confirmStartNewChat());
        elements.sendButton.addEventListener('click', () => {
            if (state.isSending) {
                this.abortRequest();
            } else {
                this.handleSend();
            }
        });
        elements.userInput.addEventListener('input', () => uiUtils.adjustTextareaHeight());
        elements.userInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                if (!elements.sendButton.disabled) this.handleSend();
                return;
            }
            if (state.settings.enterToSend && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (!elements.sendButton.disabled) this.handleSend();
            }
        });
    
        // --- システムプロンプト ---
        elements.systemPromptDetails.addEventListener('toggle', (event) => {
            if (event.target.open) {
                this.startEditSystemPrompt();
            } else if (state.isEditingSystemPrompt) {
                this.cancelEditSystemPrompt();
            }
        });
        elements.saveSystemPromptBtn.addEventListener('click', () => this.saveCurrentSystemPrompt());
        elements.cancelSystemPromptBtn.addEventListener('click', () => this.cancelEditSystemPrompt());
    
        // --- プロファイルメニューの表示/非表示 ---
        elements.profileCardHeader.addEventListener('click', (e) => {
            e.stopPropagation();
            uiUtils.toggleProfileMenu('header');
        });
        elements.profileCardHeaderSettings.addEventListener('click', (e) => {
            e.stopPropagation();
            uiUtils.toggleProfileMenu('settings');
        });
    
        document.addEventListener('click', (e) => {
            const target = e.target;
            const isHeaderCardClicked = elements.profileCardHeader.contains(target);
            const isSettingsCardClicked = elements.profileCardHeaderSettings.contains(target);
            const isHeaderMenuClicked = elements.headerProfileMenu.contains(target);
            const isSettingsMenuClicked = elements.headerProfileMenuSettings.contains(target);
    
            if (!isHeaderCardClicked && !isSettingsCardClicked && !isHeaderMenuClicked && !isSettingsMenuClicked) {
                elements.headerProfileMenu.classList.add('hidden');
                elements.headerProfileMenuSettings.classList.add('hidden');
            }
        });
    
        // --- プロファイル編集 ---
        elements.profileEditNameBtn.addEventListener('click', () => this.editCurrentProfileName());
        elements.profileIconInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleProfileIconChange(file);
            }
            e.target.value = null;
        });
        elements.profileResetIconBtn.addEventListener('click', () => this.resetProfileIcon());
        elements.profileSaveNewBtn.addEventListener('click', () => this.saveNewProfile());
        elements.profileDeleteBtn.addEventListener('click', () => this.deleteCurrentProfile());
        elements.profileExportBtn.addEventListener('click', () => this.exportProfile());
        elements.profileImportBtn.addEventListener('click', () => elements.profileImportInput.click());
        elements.profileImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.importProfile(file);
            e.target.value = null;
        });

        // カウンターリセットボタンの処理
        document.getElementById('reset-api-count-btn').addEventListener('click', async () => {
            const confirmed = await uiUtils.showCustomConfirm("API使用回数のカウントを0にリセットしますか？");
            if (confirmed) {
                const profile = state.activeProfile;
                if (profile) {
                    if (profile.apiUsage) {
                        delete profile.apiUsage;
                        try {
                            await dbUtils.updateProfile(profile);
                            this.markAsDirtyAndSchedulePush('structural');
                            console.log(`[API Count] カウンターが手動でリセットされました (Profile ID: ${profile.id})`);
                            this.updateApiUsageUI();
                            uiUtils.updateProfileSwitcherUI();
                        } catch (error) {
                            console.error(`[API Count] カウンターリセットの保存に失敗:`, error);
                        }
                    }
                }
            }
        });

        // --- データ同期 (エラークリア) ---
        document.getElementById('clear-sync-error-btn').addEventListener('click', () => {
            state.sync.lastError = null;
            dbUtils.saveSetting('syncLastError', null);
            // isDirtyがtrueならdirtyに、そうでなければidleに戻す
            const newStatus = state.sync.isDirty ? 'dirty' : 'idle';
            this.updateSyncStatusUI(newStatus);
        });
    
        // --- 設定項目（即時保存） ---
        const setupInstantSave = (element, key, eventType = 'change', onUpdate = null, getValue = null) => { // getValue関数を追加
            if (element) {
                element.addEventListener(eventType, async () => {
                    if (!state.activeProfile) return;
                    let value;
                    
                    // getValue関数が提供されている場合はそれを使用
                    if (getValue) {
                        value = getValue();
                    } else {
                        switch (element.type) {
                            case 'checkbox':
                                value = element.checked;
                                break;
                            case 'range':
                                value = parseFloat(element.value) / 100;
                                break;
                            case 'number':
                            case 'select-one':
                                const rawValue = element.value;
                                value = parseFloat(rawValue);
                                if (isNaN(value)) {
                                    // 空文字列の場合はnullに、それ以外の文字列（selectなど）はそのまま
                                    value = rawValue === '' ? null : rawValue;
                                }
                                break;
                            default:
                                value = element.value;
                                break;
                        }
                    }
                    
                    state.settings[key] = value;
                    state.activeProfile.settings[key] = value;
                    
                    await dbUtils.updateProfile(state.activeProfile);
                    appLogic.markAsDirtyAndSchedulePush('structural');
                    
                    if (onUpdate) {
                        onUpdate(value);
                    }
                });
            } else {
                console.warn(`❌ [Debug Settings] '${key}' に対応するDOM要素が見つかりません。`);
            }
        };


        
        const settingsMap = {
            apiProvider: { 
                element: elements.apiProviderSelect, 
                event: 'change',
                onUpdate: (value) => {
                    const isDebugOnlyProvider = value === 'zai' || value === 'openrouter' || value === 'bedrock';
                    if (!state.settings.debugMode && isDebugOnlyProvider) {
                        const fallbackProvider = 'gemini';
                        state.settings.apiProvider = fallbackProvider;
                        if (state.activeProfile && state.activeProfile.settings) {
                            state.activeProfile.settings.apiProvider = fallbackProvider;
                            dbUtils.updateProfile(state.activeProfile)
                                .then(() => this.markAsDirtyAndSchedulePush('structural'))
                                .catch(error => console.error("[Settings] デバッグモードOFF中にデバッグ専用プロバイダーが選択されましたがGeminiへ戻す際の保存に失敗しました:", error));
                        }
                        if (elements.apiProviderSelect) {
                            elements.apiProviderSelect.value = fallbackProvider;
                        }
                        this.updateProviderUI(fallbackProvider);
                        this.updateModelOptions(fallbackProvider);
                        uiUtils.showCustomAlert("デバッグモードが無効のため、このプロバイダーは選択できません。Geminiに戻しました。");
                        return;
                    }
                    this.updateProviderUI(value);
                    this.updateModelOptions(value);
                }
            },
            apiKey: { element: elements.apiKeyInput, event: 'input' },
            zaiApiKey: { element: elements.zaiApiKeyInput, event: 'input' },
            openrouterApiKey: { element: elements.openrouterApiKeyInput, event: 'input' },
            bedrockAccessKey: { element: elements.bedrockAccessKeyInput, event: 'input' },
            bedrockSecretKey: { element: elements.bedrockSecretKeyInput, event: 'input' },
            bedrockRegion: { element: elements.bedrockRegionSelect, event: 'change' },
            modelName: { 
                element: elements.modelNameSelect, 
                event: 'change', 
                onUpdate: () => {
                    uiUtils.updateModelWarningMessage();
                    this.updateApiUsageUI(); // onUpdateに統合
                },
                getValue: () => {
                    // OpenRouter選択時はテキスト入力から取得
                    const provider = state.settings.apiProvider || 'gemini';
                    if (provider === 'openrouter' && elements.openrouterModelInput) {
                        return elements.openrouterModelInput.value.trim();
                    }
                    return elements.modelNameSelect ? elements.modelNameSelect.value.trim() : '';
                }
            },
            systemPrompt: { element: elements.systemPromptDefaultTextarea, event: 'input' },
            temperature: { element: elements.temperatureInput, event: 'input' },
            maxTokens: { element: elements.maxTokensInput, event: 'input' },
            topK: { element: elements.topKInput, event: 'input' },
            topP: { element: elements.topPInput, event: 'input' },
            thinkingBudget: { element: elements.thinkingBudgetInput, event: 'input' },
            includeThoughts: { element: elements.includeThoughtsToggle, event: 'change' },
            enableThoughtTranslation: { element: elements.enableThoughtTranslationCheckbox, event: 'change' },
            thoughtTranslationModel: { element: elements.thoughtTranslationModelSelect, event: 'change' },
            dummyUser: { element: elements.dummyUserInput, event: 'input' },
            applyDummyToProofread: { element: elements.applyDummyToProofreadCheckbox, event: 'change' },
            applyDummyToTranslate: { element: elements.applyDummyToTranslateCheckbox, event: 'change' },
            dummyModel: { element: elements.dummyModelInput, event: 'input' },
            reverseDummyOrder: { element: elements.reverseDummyOrderCheckbox, event: 'change' },
            concatDummyModel: { element: elements.concatDummyModelCheckbox, event: 'change' },
            additionalModels: { element: elements.additionalModelsTextarea, event: 'input' },
            enterToSend: { element: elements.enterToSendCheckbox, event: 'change' },
            historySortOrder: { element: elements.historySortOrderSelect, event: 'change' },
            darkMode: { element: elements.darkModeToggle, event: 'change', onUpdate: () => uiUtils.applyDarkMode() },
            debugMode: { element: elements.debugModeToggle, event: 'change', onUpdate: (value) => {
                DebugLogger.init();
                this.toggleDebugLogButtonVisibility(value);

                if (elements.apiProviderRow) {
                    elements.apiProviderRow.classList.toggle('hidden', !value);
                }

                const isDebugOnlyProvider = state.settings.apiProvider === 'zai' || state.settings.apiProvider === 'openrouter' || state.settings.apiProvider === 'bedrock';
                if (!value && isDebugOnlyProvider) {
                    const fallbackProvider = 'gemini';
                    state.settings.apiProvider = fallbackProvider;
                    if (state.activeProfile && state.activeProfile.settings) {
                        state.activeProfile.settings.apiProvider = fallbackProvider;
                        dbUtils.updateProfile(state.activeProfile)
                            .then(() => this.markAsDirtyAndSchedulePush('structural'))
                            .catch(error => console.error("[Settings] デバッグモードOFF時のAPIプロバイダー更新に失敗しました:", error));
                    }
                    if (elements.apiProviderSelect) {
                        elements.apiProviderSelect.value = fallbackProvider;
                    }
                    this.updateProviderUI(fallbackProvider);
                    this.updateModelOptions(fallbackProvider);
                    uiUtils.showCustomAlert("デバッグモードを無効にしたため、APIプロバイダーをGeminiに戻しました。");
                } else if (value) {
                    const provider = state.settings.apiProvider || 'gemini';
                    this.updateProviderUI(provider);
                    this.updateModelOptions(provider);
                }
            }},
            fontFamily: { element: elements.fontFamilyInput, event: 'input', onUpdate: () => uiUtils.applyFontFamily() },
            hideSystemPromptInChat: { element: elements.hideSystemPromptToggle, event: 'change', onUpdate: () => uiUtils.toggleSystemPromptVisibility() },
            geminiEnableGrounding: { element: elements.geminiEnableGroundingToggle, event: 'change' },
            geminiEnableFunctionCalling: { element: elements.geminiEnableFunctionCallingToggle, event: 'change' },
            enableSwipeNavigation: { element: elements.swipeNavigationToggle, event: 'change' },
            enableProofreading: { element: elements.enableProofreadingCheckbox, event: 'change' },
            proofreadingModelName: { element: elements.proofreadingModelNameSelect, event: 'change' },
            proofreadingSystemInstruction: { element: elements.proofreadingSystemInstructionTextarea, event: 'input' },
            enableAutoRetry: { element: elements.enableAutoRetryCheckbox, event: 'change' },
            maxRetries: { element: elements.maxRetriesInput, event: 'input' },
            useFixedRetryDelay: { element: elements.useFixedRetryDelayCheckbox, event: 'change' },
            fixedRetryDelaySeconds: { element: elements.fixedRetryDelayInput, event: 'input' },
            maxBackoffDelaySeconds: { element: elements.maxBackoffDelayInput, event: 'input' },
            enableApiTimeout: { element: elements.enableApiTimeoutCheckbox, event: 'change' },
            apiTimeoutSeconds: { element: elements.apiTimeoutSecondsInput, event: 'input' },
            googleSearchApiKey: { element: elements.googleSearchApiKeyInput, event: 'input' },
            googleSearchEngineId: { element: elements.googleSearchEngineIdInput, event: 'input' },
            overlayOpacity: { element: elements.overlayOpacitySlider, event: 'input', onUpdate: () => uiUtils.applyOverlayOpacity() },
            messageOpacity: { element: elements.messageOpacitySlider, event: 'input', onUpdate: (value) => document.documentElement.style.setProperty('--message-bubble-opacity', String(value)) },
            headerColor: { element: elements.headerColorInput, event: 'input', onUpdate: () => uiUtils.applyHeaderColor() },
            allowPromptUiChanges: { element: document.getElementById('allow-prompt-ui-changes'), event: 'change' },
            forceFunctionCalling: { element: elements.forceFunctionCallingToggle, event: 'change' },
            autoScroll: { element: elements.autoScrollToggle, event: 'change' },
            enableWideMode: { element: elements.enableWideModeToggle, event: 'change', onUpdate: () => this.applyWideMode() },
            enableMemory: { element: elements.enableMemoryToggle, event: 'change', onUpdate: (value) => this.toggleMemoryOptions(value) },
            memoryAutoSaveInterval: { element: elements.memoryAutoSaveIntervalSelect, event: 'change' },
            headerAutoHide: { element: elements.headerAutoHideToggle, event: 'change', onUpdate: (value) => document.body.classList.toggle('header-auto-hide', value) },
            dropboxSyncFrequency: { element: elements.dropboxSyncFrequencySelect, event: 'change' },
            summaryModelName: { element: elements.summaryModelNameSelect, event: 'change' },
            summarySystemPrompt: { element: elements.summarySystemPromptTextarea, event: 'input' },
            enableSummaryButton: { element: elements.enableSummaryButtonToggle, event: 'change', onUpdate: () => this.toggleSummaryButtonVisibility() },
            floatingPanelBehavior: { element: elements.floatingPanelBehaviorSelect, event: 'change', onUpdate: () => this.applyFloatingPanelBehavior() },
            sdApiUrl: { element: elements.sdApiUrlInput, event: 'input' },
            sdApiUser: { element: elements.sdApiUserInput, event: 'input' },
            sdApiPassword: { element: elements.sdApiPasswordInput, event: 'input' },
            sdEnableQualityChecker: { 
                element: elements.sdEnableQualityCheckerCheckbox, 
                event: 'change', 
                onUpdate: (value) => {
                    elements.sdQualityCheckerOptionsDiv.classList.toggle('hidden', !value);
                } 
            },
            sdQcModel: { element: elements.sdQcModelSelect, event: 'change' },
            sdQcPrompt: { element: elements.sdQcPromptTextarea, event: 'input' },
            sdQcRetries: { element: elements.sdQcRetriesInput, event: 'input' },
            sdPromptImproveModel: { element: elements.sdPromptImproveModelSelect, event: 'change' },
            sdPromptImproveSystemPrompt: { element: elements.sdPromptImproveSystemPromptTextarea, event: 'input' }
        };
    
        for (const key in settingsMap) {
            const { element, event, onUpdate, getValue } = settingsMap[key];
            setupInstantSave(element, key, event, onUpdate, getValue);
        }
    
        // --- OpenRouterモデル名テキストボックスのイベントリスナー ---
        if (elements.openrouterModelInput) {
            elements.openrouterModelInput.addEventListener('input', async () => {
                if (!state.activeProfile) return;
                const value = elements.openrouterModelInput.value.trim();
                state.settings.modelName = value;
                state.activeProfile.settings.modelName = value;
                await dbUtils.updateProfile(state.activeProfile);
                appLogic.markAsDirtyAndSchedulePush('structural');
            });
        }
    
        // --- 追加モデルのblurイベントリスナー（モデル一覧の即時更新用） ---
        if (elements.additionalModelsTextarea) {
            elements.additionalModelsTextarea.addEventListener('blur', () => {
                uiUtils.updateUserModelOptions();
            });
        }
    
        // --- メモリ機能の個別イベントリスナー ---
        elements.memoryToggleBtn.addEventListener('click', () => this.toggleChatMemory());
        elements.manageMemoryBtn.addEventListener('click', () => this.openMemoryManagementDialog());
        elements.closeMemoryDialogBtn.addEventListener('click', () => elements.memoryManagementDialog.close());
        elements.addMemoryBtn.addEventListener('click', () => this.addMemoryItem());
        elements.deleteAllMemoryBtn.addEventListener('click', () => this.confirmDeleteAllMemory());

        elements.characterProfileBtn.addEventListener('click', () => this.openCharacterProfileDialog());
        elements.closeProfileDialogBtn.addEventListener('click', () => elements.characterProfileDialog.close());
        elements.profileBackBtn.addEventListener('click', () => {
            elements.characterProfileDialog.classList.remove('details-visible');
        });

        // スライダーの数値表示をリアルタイムで更新するリスナー
        elements.overlayOpacitySlider.addEventListener('input', (event) => {
            elements.overlayOpacityValue.textContent = `${event.target.value}%`;
        });
        elements.messageOpacitySlider.addEventListener('input', (event) => {
            elements.messageOpacityValue.textContent = `${event.target.value}%`;
        });

        // --- その他 ---
        elements.importHistoryBtn.addEventListener('click', () => elements.importHistoryInput.click());
        elements.importHistoryInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) this.handleHistoryImport(file);
            event.target.value = null;
        });
    
        elements.includeThoughtsToggle.addEventListener('change', () => {
            const isEnabled = elements.includeThoughtsToggle.checked;
            elements.thoughtTranslationOptionsDiv.classList.toggle('hidden', !isEnabled);
        });
        
        elements.enableApiTimeoutCheckbox.addEventListener('change', () => {
            uiUtils.updateApiTimeoutOptionsVisibility();
        });
        
        elements.updateAppBtn.addEventListener('click', () => this.updateApp());
        elements.clearDataBtn.addEventListener('click', () => this.confirmClearAllData());
    
        elements.enableProofreadingCheckbox.addEventListener('change', () => {
            const isEnabled = elements.enableProofreadingCheckbox.checked;
            elements.proofreadingOptionsDiv.classList.toggle('hidden', !isEnabled);
        });
    
        elements.uploadBackgroundBtn.addEventListener('click', () => elements.backgroundImageInput.click());
        elements.backgroundImageInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) this.handleBackgroundImageUpload(file);
            event.target.value = null;
        });
        elements.deleteBackgroundBtn.addEventListener('click', () => this.confirmDeleteBackgroundImage());
        
        elements.resetHeaderColorBtn.addEventListener('click', () => {
            state.settings.headerColor = '';
            elements.headerColorInput.value = state.settings.darkMode ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
            const event = new Event('input', { bubbles: true });
            elements.headerColorInput.dispatchEvent(event);
        });
        
        elements.messageContainer.addEventListener('click', (event) => {
            if (event.target.tagName === 'IMG' && event.target.closest('.message-content')) {
                const modalOverlay = document.getElementById('image-modal-overlay');
                const modalImg = document.getElementById('image-modal-img');
                
                if (modalOverlay && modalImg) {
                    modalImg.src = event.target.src;
                    modalOverlay.classList.remove('hidden');
                }
            }
        });
    
        document.body.addEventListener('click', (event) => {
            if (!elements.messageContainer.contains(event.target)) {
                const currentlyShown = elements.messageContainer.querySelector('.message.show-actions');
                if (currentlyShown) {
                    currentlyShown.classList.remove('show-actions');
                }
            }
        }, true); 
    
        if ('visualViewport' in window) {
            window.visualViewport.addEventListener('resize', this.updateZoomState.bind(this));
            window.visualViewport.addEventListener('scroll', this.updateZoomState.bind(this));
        } else {
            console.warn("VisualViewport API is not supported in this browser.");
        }
        
        elements.attachFileBtn.addEventListener('click', () => uiUtils.showFileUploadDialog());
    
        elements.selectFilesBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.multiple = true;
            fileInput.style.display = 'none';

            fileInput.addEventListener('change', (event) => {
                this.handleFileSelection(event.target.files);
                document.body.removeChild(fileInput);
            });

            document.body.appendChild(fileInput);
            fileInput.click();
        });

        elements.confirmAttachBtn.addEventListener('click', () => this.confirmAttachment());
        elements.cancelAttachBtn.addEventListener('click', () => this.cancelAttachment());
        elements.fileUploadDialog.addEventListener('close', () => {
            if (elements.fileUploadDialog.returnValue !== 'ok') {
                this.cancelAttachment();
            }
        });
        document.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (button && !button.disabled) {
                this.createRipple(e, button);
            }
        });
    
        const chatScreen = elements.chatScreen;
    
        chatScreen.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!state.isSending) {
                chatScreen.classList.add('drag-over');
            }
        });
    
        chatScreen.addEventListener('dragleave', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.relatedTarget === null || !chatScreen.contains(event.relatedTarget)) {
                chatScreen.classList.remove('drag-over');
            }
        });
    
        chatScreen.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            chatScreen.classList.remove('drag-over');
    
            if (state.isSending) return;
    
            const files = event.dataTransfer.files;
            if (files && files.length > 0) {
                console.log(`${files.length}個のファイルがドロップされました。`);
                this.handleFileSelection(files);
                uiUtils.showFileUploadDialog();
            }
        });
    
        const fileUploadDialog = elements.fileUploadDialog;
    
        fileUploadDialog.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    
        fileUploadDialog.addEventListener('dragleave', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    
        fileUploadDialog.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
    
            if (state.isSending) return;
    
            const files = event.dataTransfer.files;
            if (files && files.length > 0) {
                console.log(`${files.length}個のファイルがダイアログにドロップされました。`);
                this.handleFileSelection(files);
                uiUtils.updateSelectedFilesUI();
            }
        });
    
        const modalOverlay = document.getElementById('image-modal-overlay');
        const modalCloseBtn = document.getElementById('image-modal-close');
        
        if (modalOverlay && modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => {
                modalOverlay.classList.add('hidden');
            });
            
            modalOverlay.addEventListener('click', (event) => {
                if (event.target === modalOverlay) {
                    modalOverlay.classList.add('hidden');
                }
            });
        }
        elements.enableAutoRetryCheckbox.addEventListener('change', () => {
            elements.autoRetryOptionsDiv.classList.toggle('hidden', !elements.enableAutoRetryCheckbox.checked);
        });
        elements.useFixedRetryDelayCheckbox.addEventListener('change', () => {
            const useFixed = elements.useFixedRetryDelayCheckbox.checked;
            elements.fixedRetryDelayContainer.classList.toggle('hidden', !useFixed);
            elements.maxBackoffDelayContainer.classList.toggle('hidden', useFixed);
        });
    
        elements.modelNameSelect.addEventListener('change', () => {
            uiUtils.updateModelWarningMessage();
        });
        window.addEventListener('beforeunload', () => {
            const revokeUrls = (cache, name) => {
                if (cache.size > 0) {
                    console.log(`[Memory] ページ離脱のため、${cache.size}個の${name}URLを解放します。`);
                    for (const url of cache.values()) {
                        if (url.startsWith('blob:')) {
                            URL.revokeObjectURL(url);
                        }
                    }
                    cache.clear();
                }
            };
            
            revokeUrls(state.profileIconUrls, 'アイコン');
            revokeUrls(state.videoUrlCache, '動画');
            revokeUrls(state.imageUrlCache, 'チャット画像');
        });

        elements.assetExportBtn.addEventListener('click', () => this.handleAssetExport());
        elements.assetImportBtn.addEventListener('click', () => elements.assetImportInput.click());
        elements.assetImportInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) this.handleAssetImport(file);
            event.target.value = null;
        });

        elements.manageAssetsBtn.addEventListener('click', () => this.openAssetManagementDialog());
        elements.closeAssetDialogBtn.addEventListener('click', () => elements.assetManagementDialog.close());

        elements.deleteAllAssetsBtn.addEventListener('click', () => this.confirmDeleteAllAssets());

        elements.floatingPanelBehaviorSelect.addEventListener('change', () => {
            state.settings.floatingPanelBehavior = elements.floatingPanelBehaviorSelect.value;
            this.updateCurrentProfile();
            // 新しい挙動を即座に適用
            this.applyFloatingPanelBehavior();
        });

        // --- History Summary ---
        elements.summarizeHistoryBtn.addEventListener('click', () => this.startSummaryProcess());
        elements.summaryCancelBtn.addEventListener('click', () => elements.summaryDialog.close('cancel'));
        elements.summaryRegenerateBtn.addEventListener('click', () => this.regenerateSummary());
        elements.summaryConfirmBtn.addEventListener('click', () => this.confirmSummary());

        // --- Floating Action Panel & Scroll ---
        const mainContent = elements.chatScreen.querySelector('.main-content');

        // スクロールイベントからはパネル表示ロジックを削除し、ボタンの状態更新のみ残す
        mainContent.addEventListener('scroll', () => {
            this.updateScrollButtonsState();
        });

        // クリックイベントをトグル方式に変更
        mainContent.addEventListener('click', (event) => {
            // 設定が 'on-click' でない場合は何もしない
            if (state.settings.floatingPanelBehavior !== 'on-click') return;

            const interactiveElements = 'A, BUTTON, INPUT, TEXTAREA, SELECT, DETAILS, SUMMARY, IMG, PRE, CODE';
            // 操作可能な要素やパネル自体をクリックした場合は反応しない
            if (event.target.closest(interactiveElements) || event.target.closest('.floating-action-panel')) {
                return;
            }

            const panel = elements.floatingActionPanel;
            // パネルが表示されている場合は、タイマーを止めて非表示にする
            if (panel.classList.contains('visible')) {
                clearTimeout(state.panelFadeOutTimer);
                panel.classList.remove('visible');
            } else {
                // パネルが非表示の場合は、表示する (既存のロジックを呼び出す)
                this.showActionPanel();
            }
        });

        elements.floatingActionPanel.addEventListener('mouseenter', () => clearTimeout(state.panelFadeOutTimer));
        elements.floatingActionPanel.addEventListener('mouseleave', () => this.showActionPanel());
        
        elements.scrollToTopBtn.addEventListener('click', () => this.scrollToTop());
        elements.scrollToBottomBtn.addEventListener('click', () => this.scrollToBottom(true));

        // --- Header Auto-Hide Event Listeners ---
        let headerHideTimer = null;

        // --- オンライン復帰時の自動同期 ---
        window.addEventListener('online', () => {
            console.log("[Network] オンライン状態に復帰しました。同期状態を確認します。");
            // isDirtyフラグがtrue、またはエラー状態の場合に同期を試みる
            if (state.sync.isDirty || state.sync.lastError) {
                console.log("[Sync] 同期が必要な変更、またはエラーが検出されたため、自動Pushを実行します。");
                this.handlePush();
            }
        });

        // --- データ同期 (OAuth) ---
        elements.dropboxAuthBtn.addEventListener('click', async () => {
            try {
                const APP_KEY = 'tzq2d3onnfa630w';
                // 重要: このURIはDropbox App Consoleで設定したものと完全に一致させる必要があります
                const REDIRECT_URI = window.location.origin + window.location.pathname;

                const codeVerifier = appLogic._generateCodeVerifier();
                const codeChallenge = await appLogic._generateCodeChallenge(codeVerifier);

                // 次のステップでトークンを取得するためにverifierを保存
                sessionStorage.setItem('dropboxCodeVerifier', codeVerifier);

                const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${APP_KEY}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&token_access_type=offline&code_challenge=${codeChallenge}&code_challenge_method=S256`;

                // Dropboxの認証ページにリダイレクト
                window.location.href = authUrl;

            } catch (error) {
                console.error("Dropbox認証の開始に失敗:", error);
                uiUtils.showCustomAlert("認証処理の開始に失敗しました。");
            }
        });

        elements.dropboxSyncBtn.addEventListener('click', async () => {
            console.log("手動同期ボタンがクリックされました。");

            if (state.sync.isSyncing) {
                uiUtils.showCustomAlert("現在、別の同期処理が実行中です。");
                return;
            }
        
            const tokenData = await dbUtils.getSetting('dropboxTokens');
            if (!tokenData || !tokenData.value) {
                // このケースはUI上起こらないはずだが、念のため
                return;
            }
            
            // --- 新しい手動同期ロジック ---
            state.sync.isSyncing = true;
            this.updateSyncStatusUI('syncing', 'クラウドの状態を確認中...');
            uiUtils.showProgressDialog('クラウドの状態を確認中...');
        
            try {
                // Step 1: クラウドのメタデータを取得
                const cloudMetadataString = await window.dropboxApi.downloadMetadata();
        
                // クラウドにデータがない場合 -> 初回Pushの可能性
                if (!cloudMetadataString) {
                    console.log("[Manual Sync] クラウドにデータがありません。Push処理を実行します。");
                    uiUtils.updateProgressMessage('初回データをクラウドに保存中...');
                    state.sync.isSyncing = false; // _doPushを呼ぶ前にリセット
                    await this._doPush(true); // isManual=trueで実行
                    return;
                }
        
                const cloudData = JSON.parse(cloudMetadataString);
                const cloudSyncId = cloudData.syncId;
                const localSyncId = state.sync.lastSyncId;
        
                console.log(`[Manual Sync] Cloud syncId: ${cloudSyncId}, Local syncId: ${localSyncId}`);
        
                // Step 2: syncIdを比較
                // syncIdが異なる -> 他のデバイスが更新した可能性 -> Pullを実行
                if (cloudSyncId !== localSyncId) {
                    console.log("[Manual Sync] syncIdが異なります。Pull処理を実行します。");
                    uiUtils.updateProgressMessage('他のブラウザのデータの変更を同期中...');
                    state.sync.isSyncing = false; // handlePullを呼ぶ前にリセット
                    await this.handlePull(true);
                    return;
                }
        
                // Step 3: syncIdが一致する場合 -> アセットの不整合やローカルの変更をチェック
                console.log("[Manual Sync] syncIdは一致しています。アセットの整合性を確認します。");
                uiUtils.updateProgressMessage('アセットの整合性を確認中...');
        
                const { localAssets } = await this._prepareExportData();
                const cloudAssetsList = await window.dropboxApi.listAssets();
                
                const localAssetCount = localAssets.size;
                const cloudAssetCount = cloudAssetsList.length;
        
                console.log(`[Manual Sync] Local asset count: ${localAssetCount}, Cloud asset count: ${cloudAssetCount}`);
        
                // アセット数が異なるか、ローカルに変更がある(isDirty)場合 -> Pushで調整
                if (localAssetCount !== cloudAssetCount || state.sync.isDirty) {
                     if (state.sync.isDirty) {
                        console.log("[Manual Sync] ローカルに変更（isDirty=true）があるため、Push処理を実行します。");
                        uiUtils.updateProgressMessage('ローカルの変更を同期中...');
                    } else {
                        console.log("[Manual Sync] アセット数が一致しないため、Push処理でクラウドの状態を調整します。");
                        uiUtils.updateProgressMessage('クラウドの状態を調整中...');
                    }
                    state.sync.isSyncing = false; // _doPushを呼ぶ前にリセット
                    await this._doPush(true);
                    return;
                }
        
                // Step 4: syncIdもアセット数も一致 -> 本当に差分なし
                console.log("[Manual Sync] syncIdとアセット数が一致しており、差分はありません。");
                this.updateSyncStatusUI('idle');
                uiUtils.hideProgressDialog();
                await uiUtils.showCustomAlert("データは既に最新の状態です。");
        
            } catch (error) {
                const errorMessage = error.message || '不明なエラーが発生しました。';
                this.updateSyncStatusUI('error', errorMessage);
                console.error("[Manual Sync] 手動同期処理中にエラーが発生しました:", error);
                uiUtils.hideProgressDialog();
                await uiUtils.showCustomAlert(`同期に失敗しました: ${errorMessage}`);
            } finally {
                state.sync.isSyncing = false;
            }
        });


        elements.syncStatusHeaderIcon.addEventListener('click', () => {
            uiUtils.showScreen('settings').then(() => {
                const syncGroup = document.getElementById('data-sync-group');
                if (syncGroup) {
                    syncGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });

        elements.dropboxDisconnectBtn.addEventListener('click', async () => {
            const confirmed = await uiUtils.showCustomConfirm("Dropboxとの連携を解除しますか？同期されなくなります。");
            if (confirmed) {
                try {
                    await window.dropboxApi.disconnect();
                    await appLogic.updateDropboxUIState();
                    await uiUtils.showCustomAlert("連携を解除しました。");
                } catch (error) {
                    console.error("Dropbox連携解除に失敗:", error);
                    await uiUtils.showCustomAlert(`連携解除に失敗しました: ${error.message}`);
                }
            }
        });

        // --- PC (Mouse Hover) Logic ---
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            const showHeaderPC = () => {
                if (state.settings.headerAutoHide) {
                    clearTimeout(headerHideTimer);
                    document.body.classList.add('header-force-show');
                }
            };
            const hideHeaderPC = () => {
                if (state.settings.headerAutoHide) {
                    headerHideTimer = setTimeout(() => {
                        document.body.classList.remove('header-force-show');
                    }, 200);
                }
            };
            elements.headerTriggerArea.addEventListener('mouseenter', showHeaderPC);
            elements.appHeader.addEventListener('mouseenter', showHeaderPC);
            elements.headerTriggerArea.addEventListener('mouseleave', hideHeaderPC);
            elements.appHeader.addEventListener('mouseleave', hideHeaderPC);
        }

        // --- Smartphone (Touch) Logic ---
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            // メインコンテンツエリアのタップで表示をトグル ＆ 5秒タイマーを開始
            const mainContent = elements.chatScreen.querySelector('.main-content');
            mainContent.addEventListener('click', (event) => {
                if (state.settings.headerAutoHide) {
                    const interactiveElements = 'A, BUTTON, INPUT, TEXTAREA, SELECT, DETAILS, SUMMARY, IMG, PRE, CODE';
                    if (!event.target.closest(interactiveElements)) {
                        clearTimeout(headerHideTimer);
                        const body = document.body;
                        const isVisible = body.classList.contains('header-force-show');

                        if (isVisible) {
                            body.classList.remove('header-force-show');
                        } else {
                            body.classList.add('header-force-show');
                            headerHideTimer = setTimeout(() => {
                                body.classList.remove('header-force-show');
                            }, 5000); // 5秒後に自動で隠す
                        }
                    }
                }
            });

            // ヘッダーに触れている間は、自動で隠れるタイマーをキャンセルする
            elements.appHeader.addEventListener('touchstart', () => {
                if (state.settings.headerAutoHide) {
                    clearTimeout(headerHideTimer);
                }
            }, { passive: true }); // スクロール性能を阻害しないようにする
        }

        // 画面遷移時に表示状態をリセット
        const resetHeaderVisibility = () => {
            document.body.classList.remove('header-force-show');
        };
        elements.gotoHistoryBtn.addEventListener('click', resetHeaderVisibility);
        elements.gotoSettingsBtn.addEventListener('click', resetHeaderVisibility);
        elements.backToChatFromHistoryBtn.addEventListener('click', resetHeaderVisibility);
        elements.backToChatFromSettingsBtn.addEventListener('click', resetHeaderVisibility);

        // --- 古い履歴の一括削除 ---
        const deleteOldChatsBtn = document.getElementById('delete-old-chats-btn');
        if (deleteOldChatsBtn) {
            deleteOldChatsBtn.addEventListener('click', async () => {
                const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                const allChats = await dbUtils.getAllChats();
                const chatsToDelete = allChats.filter(chat => chat.updatedAt < sevenDaysAgo);

                if (chatsToDelete.length === 0) {
                    await uiUtils.showCustomAlert("削除対象の古いチャットはありません。");
                    return;
                }

                const confirmed = await uiUtils.showCustomConfirm(
                    `${chatsToDelete.length}件の古いチャット（7日以上更新なし）を削除しますか？\nこの操作は元に戻せません。`
                );

                if (confirmed) {
                    uiUtils.showProgressDialog('古いチャットを削除中...');
                    try {
                        for (const chat of chatsToDelete) {
                            // 現在開いているチャットは削除しない
                            if (chat.id !== state.currentChatId) {
                                await dbUtils.deleteChat(chat.id);
                            }
                        }
                        this.markAsDirtyAndSchedulePush('structural');
                        await uiUtils.showCustomAlert(`${chatsToDelete.length}件の古いチャットを削除しました。`);
                        await uiUtils.renderHistoryList(); // リストを再描画
                    } catch (error) {
                        console.error("古いチャットの一括削除エラー:", error);
                        await uiUtils.showCustomAlert(`削除中にエラーが発生しました: ${error.message}`);
                    } finally {
                        uiUtils.hideProgressDialog();
                    }
                }
            });
        }
        elements.sdTestConnectionBtn.addEventListener('click', async () => {
            const url = elements.sdApiUrlInput.value.trim().replace(/\/$/, '');
            if (!url) {
                return uiUtils.showCustomAlert("先にWebUIのURLを入力してください。");
            }
            const endpoint = `${url}/sdapi/v1/progress`;
            const headers = {};
            if (elements.sdApiUserInput.value && elements.sdApiPasswordInput.value) {
                headers['Authorization'] = 'Basic ' + btoa(`${elements.sdApiUserInput.value}:${elements.sdApiPasswordInput.value}`);
            }

            try {
                const response = await fetch(endpoint, { headers: headers });
                if (response.ok) {
                    await uiUtils.showCustomAlert("接続に成功しました！");
                } else {
                    throw new Error(`サーバーからの応答が不正です (ステータス: ${response.status})`);
                }
            } catch (error) {
                console.error("SD接続テストエラー:", error);
                await uiUtils.showCustomAlert(`接続に失敗しました。\nURL、認証情報、Forge/Reforgeの起動オプション(--listen)を確認してください。\nエラー: ${error.message}`);
            }
        });

        elements.sdEnableQualityCheckerCheckbox.addEventListener('change', (event) => {
            elements.sdQualityCheckerOptionsDiv.classList.toggle('hidden', !event.target.checked);
        });

        // タブがアクティブになった時にカウンターのリセットをチェック
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this._checkAndResetApiUsage();
            }
        });
        
        // --- デバッグログ関連 ---
        elements.debugLogBtn.addEventListener('click', () => this.openLogDialog());
        elements.closeLogDialogBtn.addEventListener('click', () => elements.debugLogDialog.close());
        elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        elements.copyLogsBtn.addEventListener('click', () => this.copyLogsToClipboard());
            
    },


    // popstateイベントハンドラ (戻るボタン/ジェスチャー)
    handlePopState(event) {
    const targetScreen = event.state?.screen || 'chat';
    if (targetScreen === state.currentScreen) {
      console.log(`[popstate] same screen -> ignore: ${targetScreen}`);
      return;
    }
    console.log(`popstate event fired: Navigating to screen '${targetScreen}' from history state.`);
    // showScreenを呼び出す (fromPopState = true を渡して履歴操作を抑制)
    uiUtils.showScreen(targetScreen, true);
    },

    // ズーム状態を更新
    updateZoomState() {
        if ('visualViewport' in window) {
            // スケールが閾値より大きい場合をズームとみなす
            const newZoomState = window.visualViewport.scale > ZOOM_THRESHOLD;
            if (state.isZoomed !== newZoomState) {
                state.isZoomed = newZoomState;
                console.log(`Zoom state updated: ${state.isZoomed}`);
                // ズーム状態に応じてbodyにクラスを追加/削除
                document.body.classList.toggle('zoomed', state.isZoomed);
            }
        }
    },


    // --- スワイプ処理 (ズーム対応) ---
    handleTouchStart(event) {
        if (!state.settings.enableSwipeNavigation) return;
        
        // マルチタッチ(ピンチ操作など)やズーム中はスワイプ開始点を記録しない
        if (event.touches.length > 1 || state.isZoomed) {
            state.touchStartX = 0; // 開始点をリセットしてスワイプ判定を無効化
            state.touchStartY = 0;
            state.isSwiping = false;
            return;
        }
        state.touchStartX = event.touches[0].clientX;
        state.touchStartY = event.touches[0].clientY;
        state.isSwiping = false; // スワイプ開始時はフラグをリセット
        state.touchEndX = state.touchStartX; // touchendで使えるように初期化
        state.touchEndY = state.touchStartY;
    },

    handleTouchMove(event) {
        if (!state.settings.enableSwipeNavigation) return;
        
        // 開始点がない、マルチタッチ、ズーム中は処理しない
        if (!state.touchStartX || event.touches.length > 1 || state.isZoomed) {
            return;
        }

        const currentX = event.touches[0].clientX;
        const currentY = event.touches[0].clientY;
        const diffX = state.touchStartX - currentX;
        const diffY = state.touchStartY - currentY;

        // 横方向の移動が縦方向より大きい場合にスワイプと判定
        // isSwipingフラグを立てるのは閾値を超えたときではなく、横移動が優位な場合
        if (Math.abs(diffX) > Math.abs(diffY)) {
            state.isSwiping = true;
            // 横スワイプ(画面遷移の可能性)中はデフォルトの縦スクロールを抑制
            // これにより、意図しない縦スクロールと画面遷移の競合を防ぐ
            event.preventDefault();
        } else {
            // 縦方向の移動が大きい場合はスワイプフラグを解除
            state.isSwiping = false;
        }
        // 現在位置を記録 (touchendで使うため)
        state.touchEndX = currentX;
        state.touchEndY = currentY;
    },

    handleTouchEnd(event) {
         if (!state.settings.enableSwipeNavigation) {
             this.resetSwipeState(); // 状態はリセットしておく
             return;
         }

         // ズーム状態を最終確認 (touchendまでに変わる可能性もあるため)
         this.updateZoomState();
         if (state.isZoomed) {
             console.log("Zoomed state detected on touchend, skipping swipe navigation.");
             this.resetSwipeState();
             return;
         }

         // スワイプ中でない、または開始点がない場合はリセットして終了
         if (!state.isSwiping || !state.touchStartX) {
             this.resetSwipeState();
             return;
         }

        const diffX = state.touchStartX - state.touchEndX;
        const diffY = state.touchStartY - state.touchEndY; // 縦移動量も一応計算

        // スワイプ距離が閾値を超えているか、かつ横移動が縦移動より大きいか
        if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) { // 左スワイプ (右から左へ) -> 設定画面へ
                console.log("左スワイプ検出 -> 設定画面へ");
                uiUtils.showScreen('settings'); // showScreenが履歴操作を行う
            } else { // 右スワイプ (左から右へ) -> 履歴画面へ
                console.log("右スワイプ検出 -> 履歴画面へ");
            }
        } else {
            // 閾値未満または縦移動が大きい場合は何もしない
            console.log("スワイプ距離不足 or 縦移動大");
        }

        this.resetSwipeState(); // スワイプ状態をリセット
    },

    resetSwipeState() {
        state.touchStartX = 0;
        state.touchStartY = 0;
        state.touchEndX = 0;
        state.touchEndY = 0;
        state.isSwiping = false;
    },
    // --- スワイプ処理ここまで ---


    // 新規チャット開始の確認と実行
    async confirmStartNewChat() {
        const confirmed = await uiUtils.showCustomConfirm("現在のチャットを保存して新規チャットを開始しますか？");
        if (!confirmed) {
            console.log("新規チャットの開始をキャンセルしました。");
            return;
        }

        // 送信中なら中断
        if (state.isSending) {
            this.abortRequest();
        }
        // 編集中なら破棄
        if (state.editingMessageIndex !== null) {
            const msgEl = elements.messageContainer.querySelector(`.message[data-index="${state.editingMessageIndex}"]`);
            this.cancelEditMessage(state.editingMessageIndex, msgEl);
        }
        // システムプロンプト編集中なら破棄
        if (state.isEditingSystemPrompt) {
            this.cancelEditSystemPrompt();
        }
        // 保留中の添付ファイルがあれば破棄
        if (state.pendingAttachments.length > 0) {
            state.pendingAttachments = [];
            uiUtils.updateAttachmentBadgeVisibility();
        }
        
        try {
            // 現在のチャットに保存すべき内容があれば保存する
            if ((state.currentMessages.length > 0 || state.currentSystemPrompt) && state.currentChatId) {
                await dbUtils.saveChat();
            }
        } catch (error) {
            console.error("新規チャット開始前のチャット保存失敗:", error);
            // 保存に失敗しても、ユーザーは新規チャットを望んでいるので処理は続行
            await uiUtils.showCustomAlert("現在のチャットの保存に失敗しました。");
        }

        // 新規チャットを開始
        this.startNewChat();
        uiUtils.showScreen('chat');
    },

    // 新規チャットを開始する (状態リセット)
    startNewChat() {
        state.pendingCascadeResponses = null; // 保留中のカスケードデータをクリア
        state.currentChatId = null;
        state.currentMessages = [];
        state.currentSystemPrompt = state.settings.systemPrompt || ''; 
        state.pendingAttachments = [];
        state.currentPersistentMemory = {};
        state.currentSummarizedContext = null;
        state.isMemoryEnabledForChat = true; // 新規チャットではデフォルトで有効
        state.syncMessageCounter = 0;
        this.toggleMemoryIconVisibility();
        state.currentScene = { scene_id: "initial", location: "不明な場所" };
        uiUtils.updateSystemPromptUI();
        uiUtils.renderChatMessages();
        uiUtils.updateChatTitle();
        elements.userInput.value = '';
        uiUtils.adjustTextareaHeight();
        uiUtils.setSendingState(false);
        this.updateCharacterProfileButtonVisibility();
        state.currentStyleProfiles = {};
    },


    // app.js の appLogic オブジェクト内
    async loadChat(id) {
        state.pendingCascadeResponses = null; // 保留中のカスケードデータをクリア
        const loadChatStartTime = performance.now();
        state.syncMessageCounter = 0;

        state.currentMessages = [];

        if (state.isSending) {
            const confirmed = await uiUtils.showCustomConfirm("送信中です。中断して別のチャットを読み込みますか？");
            if (!confirmed) return;
            this.abortRequest();
        }
        if (state.editingMessageIndex !== null) {
            const confirmed = await uiUtils.showCustomConfirm("編集中です。変更を破棄して別のチャットを読み込みますか？");
            if (!confirmed) return;
            const msgEl = elements.messageContainer.querySelector(`.message[data-index="${state.editingMessageIndex}"]`);
            this.cancelEditMessage(state.editingMessageIndex, msgEl);
        }
        if (state.isEditingSystemPrompt) {
            const confirmed = await uiUtils.showCustomConfirm("システムプロンプト編集中です。変更を破棄して別のチャットを読み込みますか？");
            if (!confirmed) return;
            this.cancelEditSystemPrompt();
        }
        if (state.pendingAttachments.length > 0) {
            const confirmedAttach = await uiUtils.showCustomConfirm("添付準備中のファイルがあります。破棄して別のチャットを読み込みますか？");
            if (!confirmedAttach) return;
            state.pendingAttachments = [];
            uiUtils.updateAttachmentBadgeVisibility();
        }

        try {
            const dbGetStartTime = performance.now();
            const chat = await dbUtils.getChat(id);
            const dbGetEndTime = performance.now();
            
            if (chat) {
                state.currentChatId = chat.id;
                state.currentMessages = chat.messages?.map(msg => ({
                    ...msg,
                    attachments: msg.attachments || []
                })) || [];
                
                state.currentPersistentMemory = chat.persistentMemory || {};
                state.currentSummarizedContext = chat.summarizedContext || null;
                // チャットごとのメモリ有効状態を読み込む (未定義ならtrue)
                state.isMemoryEnabledForChat = chat.isMemoryEnabledForChat !== false;
                this.toggleMemoryIconVisibility();

                this.updateCharacterProfileButtonVisibility();

                let needsSave = false;
                const groupIds = new Set(state.currentMessages.filter(m => m.siblingGroupId).map(m => m.siblingGroupId));
                groupIds.forEach(gid => {
                    const siblings = state.currentMessages.filter(m => m.siblingGroupId === gid);
                    const selected = siblings.filter(m => m.isSelected);
                    if (selected.length === 0 && siblings.length > 0) {
                        siblings[siblings.length - 1].isSelected = true;
                        needsSave = true;
                    } else if (selected.length > 1) {
                        selected.slice(0, -1).forEach(m => m.isSelected = false);
                        needsSave = true;
                    }
                });
                
                state.currentSystemPrompt = chat.systemPrompt !== undefined ? chat.systemPrompt : state.settings.systemPrompt;
                state.pendingAttachments = [];
                
                uiUtils.updateChatTitle(chat.title);
                uiUtils.updateSystemPromptUI();
                
                const renderStartTime = performance.now();
                uiUtils.renderChatMessages();
                const renderEndTime = performance.now();
                
                this.scrollToBottom();

                elements.userInput.value = '';
                uiUtils.adjustTextareaHeight();
                uiUtils.setSendingState(false);

                if (needsSave) {
                    console.log("読み込み時に isSelected を正規化しました。DBに保存します。");
                    await dbUtils.saveChat();
                }

            } else {
                await uiUtils.showCustomAlert("チャット履歴が見つかりませんでした。");
                this.startNewChat();
                uiUtils.showScreen('chat');
            }
        } catch (error) {
            await uiUtils.showCustomAlert(`チャットの読み込みエラー: ${error}`);
            this.startNewChat();

        }
        const loadChatEndTime = performance.now();
    },

    // チャットを複製
    async duplicateChat(id) {
        // 送信中・編集中・他チャット保存の確認 (loadChatと同様)
        if (state.isSending) { const conf = await uiUtils.showCustomConfirm("送信中です。中断してチャットを複製しますか？"); if (!conf) return; this.abortRequest(); }
        if (state.editingMessageIndex !== null) { const conf = await uiUtils.showCustomConfirm("編集中です。変更を破棄してチャットを複製しますか？"); if (!conf) return; const msgEl = elements.messageContainer.querySelector(`.message[data-index="${state.editingMessageIndex}"]`); this.cancelEditMessage(state.editingMessageIndex, msgEl); }
        if (state.isEditingSystemPrompt) { const conf = await uiUtils.showCustomConfirm("システムプロンプト編集中です。変更を破棄してチャットを複製しますか？"); if (!conf) return; this.cancelEditSystemPrompt(); }
        if ((state.currentMessages.length > 0 || state.currentSystemPrompt) && state.currentChatId && state.currentChatId !== id) { try { await dbUtils.saveChat(); } catch (error) { console.error("複製前の現チャット保存失敗:", error); const conf = await uiUtils.showCustomConfirm("現在のチャット保存に失敗しました。複製を続行しますか？"); if (!conf) return; } }
        // 保留中の添付ファイルがあれば破棄確認
        if (state.pendingAttachments.length > 0) {
            const confirmedAttach = await uiUtils.showCustomConfirm("添付準備中のファイルがあります。破棄してチャットを複製しますか？");
            if (!confirmedAttach) return;
            state.pendingAttachments = []; // 破棄
        }

        try {
            const chat = await dbUtils.getChat(id); // 複製元を取得
            if (chat) {
                // 新しいタイトルを作成 (末尾のコピーサフィックスを除去して再度付与)
                const originalTitle = chat.title || "無題のチャット";
                const newTitle = originalTitle.replace(new RegExp(DUPLICATE_SUFFIX.replace(/([().])/g, '\\$1') + '$'), '').trim() + DUPLICATE_SUFFIX;

                // メッセージをディープコピーし、新しい siblingGroupId を生成
                const duplicatedMessages = [];
                const groupIdMap = new Map(); // 古いGroupId -> 新しいGroupId
                (chat.messages || []).forEach(msg => {
                    const newMsg = JSON.parse(JSON.stringify(msg)); // ディープコピー
                    // attachments もコピー (Base64データも含まれる)
                    newMsg.attachments = msg.attachments ? JSON.parse(JSON.stringify(msg.attachments)) : [];
                    // 新しいフラグもコピー (isSelected は後で調整)
                    newMsg.isCascaded = msg.isCascaded ?? false;
                    newMsg.isSelected = msg.isSelected ?? false;
                    if (msg.siblingGroupId) {
                        if (!groupIdMap.has(msg.siblingGroupId)) {
                            groupIdMap.set(msg.siblingGroupId, `dup-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
                        }
                        newMsg.siblingGroupId = groupIdMap.get(msg.siblingGroupId);
                    } else {
                        delete newMsg.siblingGroupId; // 元々なければ削除
                    }
                    duplicatedMessages.push(newMsg);
                });

                // 複製後の isSelected を正規化 (各グループの最後のものを選択)
                const newGroupIds = new Set(duplicatedMessages.filter(m => m.siblingGroupId).map(m => m.siblingGroupId));
                newGroupIds.forEach(gid => {
                    const siblings = duplicatedMessages.filter(m => m.siblingGroupId === gid);
                    siblings.forEach((m, idx) => {
                        m.isSelected = (idx === siblings.length - 1); // 最後のものだけ true
                    });
                });

                // 新しいチャットデータを作成
                const newChatData = {
                    messages: duplicatedMessages,
                    systemPrompt: chat.systemPrompt || '', // システムプロンプトもコピー
                    // 永続メモリもディープコピーで複製
                    persistentMemory: JSON.parse(JSON.stringify(chat.persistentMemory || {})),
                    updatedAt: Date.now(), // 更新/作成日時は現在
                    createdAt: Date.now(),
                    title: newTitle
                };
                // 新しいチャットとしてDBに追加
                const newChatId = await new Promise((resolve, reject) => {
                    const store = dbUtils._getStore(CHATS_STORE, 'readwrite');
                    const request = store.add(newChatData); // addで新規追加
                    request.onsuccess = (event) => resolve(event.target.result); // 新しいIDを返す
                    request.onerror = (event) => reject(event.target.error);
                });
                this.markAsDirtyAndSchedulePush(true);
                console.log("チャット複製完了:", id, "->", newChatId);
                // 履歴画面が表示されていればリストを更新、そうでなければアラート表示
                if (state.currentScreen === 'history') { // stateで判定
                    uiUtils.renderHistoryList();
                } else {
                    await uiUtils.showCustomAlert(`チャット「${newTitle}」を複製しました。`);
                }
            } else {
                await uiUtils.showCustomAlert("複製元のチャットが見つかりません。");
            }
        } catch (error) {
            await uiUtils.showCustomAlert(`チャット複製エラー: ${error}`);
        }
    },

    async exportProfile() {
        if (!state.activeProfile) {
            return uiUtils.showCustomAlert("エクスポートするプロファイルが選択されていません。");
        }
        
        // stateのデータを汚染しないようにディープコピーする
        const profileToExport = JSON.parse(JSON.stringify(state.activeProfile));
        
        // アイコンBlobがあればBase64に変換して埋め込む
        if (state.activeProfile.icon instanceof Blob) {
            try {
                const base64Icon = await this.fileToBase64(state.activeProfile.icon);
                profileToExport.icon = {
                    mimeType: state.activeProfile.icon.type,
                    data: base64Icon
                };
            } catch (error) {
                console.error("アイコンのBase64変換に失敗:", error);
                return uiUtils.showCustomAlert("アイコンのエクスポート処理に失敗しました。");
            }
        }

        delete profileToExport.id;

        const jsonString = JSON.stringify(profileToExport, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = profileToExport.name.replace(/[\\/:*?"<>|]/g, '_');
        a.href = url;
        a.download = `${safeName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async importProfile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                if (state.profiles.length >= MAX_PROFILES) {
                    return uiUtils.showCustomAlert(`プロファイルの上限数（${MAX_PROFILES}個）に達しているため、プロファイルをインポートできません。`);
                }
                const importedData = JSON.parse(event.target.result);

                if (!importedData.name || !importedData.settings) {
                    throw new Error("無効なファイルです。'name'と'settings'プロパティが必要です。");
                }

                let newProfile = { ...importedData };
                
                if (newProfile.icon && newProfile.icon.data) {
                    try {
                        newProfile.icon = await this.base64ToBlob(newProfile.icon.data, newProfile.icon.mimeType);
                    } catch (error) {
                        console.error("インポート時のアイコン復元に失敗:", error);
                        newProfile.icon = null;
                    }
                }

                let finalName = newProfile.name;
                const existingNames = state.profiles.map(p => p.name);
                while (existingNames.includes(finalName)) {
                    finalName = `${IMPORT_PREFIX}${finalName}`;
                }
                newProfile.name = finalName;

                const newId = await dbUtils.addProfile(newProfile);
                const newlyAddedProfile = await dbUtils.getProfile(newId);
                state.profiles.push(newlyAddedProfile);
                await dbUtils.saveSetting('activeProfileId', newId);
                state.activeProfileId = newId;

                this.markAsDirtyAndSchedulePush(true);
                this.applyActiveProfile();
                uiUtils.updateProfileSwitcherUI();
                await uiUtils.showCustomAlert(`プロファイル「${finalName}」をインポートしました。`);

            } catch (error) {
                console.error("プロファイルのインポートに失敗:", error);
                await uiUtils.showCustomAlert(`プロファイルのインポートに失敗しました: ${error.message}`);
            }
        };
        reader.readAsText(file);
    },



    // チャットをテキストファイルとしてエクスポート
    async exportChat(chatId, chatTitle) {
        const confirmed = await uiUtils.showCustomConfirm(`チャット「${chatTitle || 'この履歴'}」をテキスト出力しますか？`);
        if (!confirmed) return;
    
        uiUtils.showProgressDialog('エクスポート準備中...');
        try {
            let chatToExport;
            if (state.currentChatId === chatId) {
                chatToExport = {
                    id: state.currentChatId,
                    title: chatTitle,
                    messages: state.currentMessages,
                    systemPrompt: state.currentSystemPrompt,
                    persistentMemory: state.currentPersistentMemory,
                    summarizedContext: state.currentSummarizedContext,
                    createdAt: null,
                    updatedAt: Date.now(),
                };
            } else {
                chatToExport = await dbUtils.getChat(chatId);
            }
    
            if (!chatToExport || ((!chatToExport.messages || chatToExport.messages.length === 0) && !chatToExport.systemPrompt)) {
                await uiUtils.showCustomAlert("チャットデータが空です。");
                return;
            }
    
            let exportText = '';
            const imageDataBlock = {};
            const attachmentDataBlock = {};
            const allImageIds = new Set();

            if (chatToExport.messages) {
                // 先に全メッセージを走査して、必要な画像IDと添付ファイルIDを収集
                chatToExport.messages.forEach(msg => {
                    if (msg.imageIds && msg.imageIds.length > 0) {
                        msg.imageIds.forEach(id => allImageIds.add(id));
                    }
                    // 添付ファイルにもユニークIDを割り振り、データ収集の準備
                    if (msg.attachments && msg.attachments.length > 0) {
                        msg.attachments.forEach(att => {
                            if (att.base64Data) {
                                const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                                att.attachmentId = attachmentId; // 一時的にIDを付与
                                attachmentDataBlock[attachmentId] = {
                                    name: att.name,
                                    mimeType: att.mimeType,
                                    data: att.base64Data
                                };
                            }
                        });
                    }
                });
            }

            if (allImageIds.size > 0) {
                uiUtils.updateProgressMessage(`画像データを収集中... (0 / ${allImageIds.size})`);
                let processedCount = 0;
                for (const imageId of allImageIds) {
                    try {
                        const imageData = await this.getImageBlobById(imageId);
                        if (imageData && imageData.blob) {
                            const base64Data = await this.fileToBase64(imageData.blob);
                            imageDataBlock[imageId] = {
                                mimeType: imageData.blob.type,
                                data: base64Data,
                                width: imageData.width,
                                height: imageData.height
                            };
                        }
                    } catch (e) {
                        console.error(`エクスポート中に画像(ID: ${imageId})の処理に失敗しました:`, e);
                    }
                    processedCount++;
                    uiUtils.updateProgressMessage(`画像データを収集中... (${processedCount} / ${allImageIds.size})`);
                }
            }
    
            uiUtils.updateProgressMessage('テキストデータを生成中...');
            if (chatToExport.persistentMemory && Object.keys(chatToExport.persistentMemory).length > 0) {
                try {
                    const metadataToExport = { ...chatToExport.persistentMemory };
                    const metadataJson = JSON.stringify(metadataToExport, null, 2);
                    exportText += `<|#|metadata|#|>\n${metadataJson}\n<|#|/metadata|#|>\n\n`;
                } catch (e) {
                    console.error("persistentMemoryのJSON化に失敗しました:", e);
                }
            }
    
            if (chatToExport.systemPrompt) {
                exportText += `<|#|system|#|>\n${chatToExport.systemPrompt}\n<|#|/system|#|>\n\n`;
            }

            if (chatToExport.summarizedContext) {
                try {
                    const summaryJson = JSON.stringify(chatToExport.summarizedContext, null, 2);
                    exportText += `<|#|summary|#|>\n${summaryJson}\n<|#|/summary|#|>\n\n`;
                } catch (e) {
                    console.error("summarizedContextのJSON化に失敗しました:", e);
                }
            }
    
            if (chatToExport.messages) {
                chatToExport.messages.forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'model') {
                        let attributes = '';
                        if (msg.role === 'model') {
                            if (msg.isCascaded) attributes += ' isCascaded';
                            if (msg.isSelected) attributes += ' isSelected';
                            if (msg.imageIds && msg.imageIds.length > 0) {
                                attributes += ` imageIds="${msg.imageIds.join(',')}"`;
                            }
                        }
                        // ファイル名ではなく、割り振ったattachmentIdを記録する
                        if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
                            const attachmentIds = msg.attachments.map(a => a.attachmentId).filter(Boolean).join(',');
                            if (attachmentIds) {
                                attributes += ` attachments="${attachmentIds}"`;
                            }
                        }
                        exportText += `<|#|${msg.role}|#|${attributes.trim()}>\n${msg.content}\n<|#|/${msg.role}|#|>\n\n`;
                    }
                });
            }

            if (Object.keys(imageDataBlock).length > 0) {
                exportText += `<|#|imagedata|#|>\n${JSON.stringify(imageDataBlock, null, 2)}\n<|#|/imagedata|#|>\n\n`;
            }

            // 新しくattachmentdataブロックを書き出す
            if (Object.keys(attachmentDataBlock).length > 0) {
                exportText += `<|#|attachmentdata|#|>\n${JSON.stringify(attachmentDataBlock, null, 2)}\n<|#|/attachmentdata|#|>\n`;
            }
    
            uiUtils.updateProgressMessage('ファイルをダウンロード中...');
            const blob = new Blob([exportText.trim()], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeTitle = (chatToExport.title || `chat_${chatId}_export`).replace(/[<>:"/\\|?*\s]/g, '_');
            a.href = url;
            a.download = `${safeTitle}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("チャットエクスポート完了:", chatId);
        } catch (error) {
            await uiUtils.showCustomAlert(`エクスポートエラー: ${error}`);
        } finally {
            uiUtils.hideProgressDialog();
        }
    },

    // チャット削除の確認と実行 (メッセージペア全体)
    async confirmDeleteChat(id, title) {
         const confirmed = await uiUtils.showCustomConfirm(`「${title || 'この履歴'}」を削除しますか？`);
         if (confirmed) {
            const isDeletingCurrent = state.currentChatId === id;
            const currentScreenBeforeDelete = state.currentScreen;

            try {
                // 1. DBから削除
                await dbUtils.deleteChat(id);
                console.log("チャット削除:", id);

                // 2. 表示中チャット削除なら内部状態リセット
                if (isDeletingCurrent) {
                    console.log("表示中のチャットが削除されたため、内部状態を新規チャットにリセット。");
                    this.startNewChat(); // pendingAttachments もクリアされる
                }

                // 3. 履歴画面での操作ならリストUI更新 & 状態リセット判定
                if (currentScreenBeforeDelete === 'history') {
                    console.log("履歴画面での操作のため、リストUIを更新します。");
                    await uiUtils.renderHistoryList(); // リストUIを更新
                    const listIsEmpty = elements.historyList.querySelectorAll('.history-item:not(.js-history-item-template)').length === 0;

                    // リストが空になった場合、内部状態をリセットする（念のため）
                    if (listIsEmpty) {
                        console.log("履歴リストが空になりました。");
                        if (!isDeletingCurrent) {
                            this.startNewChat();
                        }
                    }
                }

            } catch (error) {
                await uiUtils.showCustomAlert(`チャット削除エラー: ${error}`);
                uiUtils.setSendingState(false); // エラー時も送信状態解除
            }
        }
    },

    // 履歴アイテムのタイトルを編集
    async editHistoryTitle(chatId, titleElement) {
        const currentTitle = titleElement.textContent;
        const newTitle = await uiUtils.showCustomPrompt("新しいタイトル:", currentTitle); // newTitle は OK なら文字列、キャンセルなら ''

        // キャンセル時('')でなく、入力があり(trim後空でなく)、変更があった場合
        const trimmedTitle = (newTitle !== null) ? newTitle.trim() : '';

        if (newTitle !== '' && trimmedTitle !== '' && trimmedTitle !== currentTitle) {
            const finalTitle = trimmedTitle.substring(0, 100); // 100文字に制限
            try {
                await dbUtils.updateChatTitleDb(chatId, finalTitle); // DB更新
                // UI更新
                titleElement.textContent = finalTitle;
                titleElement.title = finalTitle; // ホバータイトルも更新
                // 更新日時も更新表示
                const dateElement = titleElement.closest('.history-item')?.querySelector('.updated-date');
                if(dateElement) dateElement.textContent = `更新: ${uiUtils.formatDate(Date.now())}`;
                // 現在表示中のチャットのタイトルが変更されたら、ヘッダーも更新
                if (state.currentChatId === chatId) {
                    uiUtils.updateChatTitle(finalTitle);
                }
            } catch (error) {
                await uiUtils.showCustomAlert(`タイトル更新エラー: ${error}`);
            }
        } else {
            // キャンセルまたは変更なし
            console.log("タイトル編集キャンセルまたは変更なし");
        }
    },

    async proofreadText(textToProofread) {
        console.log("--- 校正処理開始 ---");
        const { 
            proofreadingModelName, 
            proofreadingSystemInstruction, 
            apiKey, 
            temperature, 
            maxTokens, 
            topK, 
            topP,
            enableAutoRetry,
            maxRetries
        } = state.settings;

        if (!proofreadingModelName) {
            throw new Error("校正用モデルが設定されていません。");
        }

        const endpoint = `${GEMINI_API_BASE_URL}${proofreadingModelName}:generateContent`;
        const systemInstruction = proofreadingSystemInstruction?.trim() ? { parts: [{ text: proofreadingSystemInstruction.trim() }] } : null;
        const generationConfig = {};
        if (temperature !== null) generationConfig.temperature = temperature;
        if (maxTokens !== null) generationConfig.maxOutputTokens = maxTokens;
        if (topK !== null) generationConfig.topK = topK;
        if (topP !== null) generationConfig.topP = topP;

        const requestBody = {
            contents: [{ role: 'user', parts: [{ text: textToProofread }] }],
            ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
            ...(systemInstruction && { systemInstruction }),
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        if (state.settings.applyDummyToProofread && state.settings.dummyUser) {
            requestBody.contents.push({
                role: 'user',
                parts: [{ text: state.settings.dummyUser }]
            });
            console.log("校正リクエストにダミーUserプロンプトを適用しました。");
        }

        console.log("校正APIへの送信データ:", JSON.stringify(requestBody, null, 2));

        let lastError = null;
        const maxProofreadRetries = enableAutoRetry ? maxRetries : 0;

        for (let attempt = 0; attempt <= maxProofreadRetries; attempt++) {
            try {
                if (state.abortController?.signal.aborted) {
                    throw new Error("リクエストがキャンセルされました。");
                }

                if (attempt > 0) {
                    let delay;
                    if (state.settings.useFixedRetryDelay) {
                        delay = state.settings.fixedRetryDelaySeconds * 1000;
                    } else {
                        const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        const maxDelay = state.settings.maxBackoffDelaySeconds * 1000;
                        delay = Math.min(exponentialDelay, maxDelay);
                    }
                    
                    uiUtils.setLoadingIndicatorText(`校正エラー 再試行(${attempt}回目)... ${Math.round(delay/1000)}秒待機`);
                    console.log(`校正APIリトライ ${attempt}: ${delay}ms待機...`);
                    await interruptibleSleep(delay, state.abortController.signal);
                }

                if (attempt === 0) {
                    uiUtils.setLoadingIndicatorText('校正中...');
                } else if (attempt === 1) {
                    uiUtils.setLoadingIndicatorText('校正処理を再試行中...');
                } else {
                    uiUtils.setLoadingIndicatorText(`校正処理${attempt}回目の再試行中...`);
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(requestBody),
                    signal: state.abortController?.signal
                });

                if (!response.ok) {
                    let errorMsg = `校正APIエラー (${response.status}): ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        if (errorData.error?.message) {
                            errorMsg = `校正APIエラー (${response.status}): ${errorData.error.message}`;
                        }
                    } catch (e) { /* JSONパース失敗は無視 */ }
                    const error = new Error(errorMsg);
                    error.status = response.status;
                    throw error;
                }

                const responseData = await response.json();
                if (responseData.candidates?.[0]?.content?.parts) {
                    const proofreadContent = responseData.candidates[0].content.parts.map(p => p.text).join('');
                    console.log("--- 校正処理成功 ---");
                    return proofreadContent;
                } else if (responseData.promptFeedback) {
                    const blockReason = responseData.promptFeedback.blockReason || 'SAFETY';
                    throw new Error(`校正モデルに応答がブロックされました (理由: ${blockReason})`);
                } else {
                    throw new Error("校正APIの応答に有効なコンテンツが含まれていません。");
                }

            } catch (error) {
                lastError = error;
                if (error.name === 'AbortError') {
                    throw error;
                }
                if (error.status && error.status >= 400 && error.status < 500) {
                    console.error(`リトライ不可の校正エラー (ステータス: ${error.status})。`, error);
                    throw error;
                }
                console.warn(`校正API呼び出し試行 ${attempt + 1} が失敗。`, error);
            }
        }

        console.error("校正APIの最大リトライ回数に達しました。");
        throw lastError;
    },

    
    /**
     * @private API通信と応答解析、ループ処理に責務を特化した内部関数。
     * stateの変更やUIの更新は一切行わない。
     * @param {Array} messagesForApi - APIに送信するメッセージ履歴。
     * @param {object} generationConfig - 生成設定。
     * @param {object} systemInstruction - システムプロンプト。
     * @returns {Promise<Array>} 生成された新しいメッセージオブジェクトの配列。
    */
     async _internalHandleSend(messagesForApi, generationConfig, systemInstruction) {
        let loopCount = 0;
        // Z.ai API(OpenAI互換)は1回のレスポンスで1つのtool_callしか返さないため、
        // Gemini APIよりも多くのループが必要
        const MAX_LOOPS = 20;
        const finalTurnResults = [];
        let currentTurnHistory = [...messagesForApi];
        let aggregatedSearchResults = [];

        uiUtils.setLoadingIndicatorText('応答生成中...');

        while (loopCount < MAX_LOOPS) {
            loopCount++;

            const result = await this.callApiWithRetry({
                messagesForApi: currentTurnHistory,
                generationConfig,
                systemInstruction,
                tools: window.functionDeclarations,
                isFirstCall: (loopCount === 1)
            });

            const modelMessage = {
                role: 'model',
                content: result.content || '',
                thoughtSummary: (finalTurnResults.length === 0) ? result.thoughtSummary : null,
                tool_calls: result.toolCalls,
                timestamp: Date.now(),
                finishReason: result.finishReason,
                safetyRatings: result.safetyRatings,
                usageMetadata: result.usageMetadata,
                retryCount: result.retryCount,
                executedFunctions: []
            };
            finalTurnResults.push(modelMessage);

            if (!result.toolCalls || result.toolCalls.length === 0) {
                console.log("[_internalHandleSend] ツール呼び出しがないため、ループを終了します。");
                break;
            }
            
            const historyForFunctions = state.currentMessages.slice(0, -1);
            const responseTextForQc = result.content || '';
            
            const toolResults = [];
            let containsTerminalAction = false;
            
            for (const toolCall of result.toolCalls) {
                const functionName = toolCall.functionCall.name;
                const functionArgs = toolCall.functionCall.args;
                
                console.log(`[Function Calling] 実行: ${functionName}`, functionArgs);
                
                if (functionName === 'generate_image_stable_diffusion') {
                    uiUtils.setLoadingIndicatorText('SDで画像生成中...');
                } else if (functionName === 'run_quality_checker') {
                    uiUtils.setLoadingIndicatorText('品質チェック中...');
                } else {
                    uiUtils.setLoadingIndicatorText('関数実行中...');
                }

                let toolResult;
                try {
                    const argsWithContext = { ...functionArgs, _responseTextForQc: responseTextForQc };
                    toolResult = await window.functionCallingTools[functionName](argsWithContext, {
                        messages: historyForFunctions.filter(m => m.role !== 'tool'),
                        persistentMemory: state.currentPersistentMemory
                    });
                } catch (toolError) {
                    console.error(`[_internalHandleSend] ${functionName}の実行中に予期せぬエラー:`, toolError);
                    toolResult = { error: { message: `ツール実行中に予期せぬエラーが発生しました: ${toolError.message}` } };
                }

                if (['generate_image', 'generate_image_stable_diffusion', 'generate_video', 'edit_image', 'display_layered_image'].includes(functionName)) {
                    containsTerminalAction = true;
                    console.log(`[Function Calling] 終端アクション (${functionName}) を検出しました。`);
                } else if (['generate_image', 'generate_video', 'edit_image', 'display_layered_image'].includes(functionName)) {
                    containsTerminalAction = true; 
                    console.log(`[Function Calling] 終端アクション (${functionName}) を検出しました。`);
                }

                const responseForAI = { ...toolResult };
                if (toolResult.search_results) {
                    aggregatedSearchResults.push(...toolResult.search_results);
                    delete responseForAI.search_results;
                }
                if (toolResult._internal_ui_action) {
                    delete responseForAI._internal_ui_action;
                }

                const toolResponseMessage = { 
                    role: 'tool', 
                    name: functionName, 
                    response: responseForAI, 
                    timestamp: Date.now(),
                    _toolCallId: toolCall.functionCall._toolCallId  // OpenAI互換APIのtool_call_idを保持
                };
                
                if(toolResult._internal_ui_action){
                    toolResponseMessage._internal_ui_action = toolResult._internal_ui_action;
                }

                toolResults.push(toolResponseMessage);
                modelMessage.executedFunctions.push(functionName);
            }
            
            finalTurnResults.push(...toolResults);
            
            if (containsTerminalAction) {
                console.log("終端アクションが検出されたため、Function Callingループを終了します。");
                if (!result.content) {
                    console.log("[_internalHandleSend] テキスト応答がなかったため、ツール結果を基に最終応答を生成します。");
                    uiUtils.setLoadingIndicatorText('最終応答を生成中...');

                    const partsForApi = [
                        ...(result.thoughtParts || []),
                        ...result.toolCalls.map(tc => ({ functionCall: tc.functionCall }))
                    ];
                    const modelMessageForApi = { role: 'model', parts: partsForApi };
                    const toolResultsForApi = toolResults.map(tr => ({ 
                        role: 'tool', 
                        parts: [{ 
                            functionResponse: { 
                                name: tr.name, 
                                response: tr.response,
                                _toolCallId: tr._toolCallId  // OpenAI互換APIのtool_call_idを引き継ぐ
                            } 
                        }] 
                    }));
                    currentTurnHistory.push(modelMessageForApi, ...toolResultsForApi);

                    // Bedrock使用時はレート制限回避のため遅延を入れる
                    if (state.settings.apiProvider === 'bedrock') {
                        const delayMs = 6500; // 6.5秒の遅延（レート制限: 毎分10リクエスト = 6秒間隔 + 余裕0.5秒）
                        console.log(`[Bedrock] レート制限回避のため ${delayMs}ms 待機します...`);
                        uiUtils.setLoadingIndicatorText(`レート制限回避のため ${delayMs/1000}秒待機中...`);
                        await interruptibleSleep(delayMs, state.abortController.signal);
                    }

                    const textResult = await this.callApiWithRetry({ 
                        messagesForApi: currentTurnHistory,
                        generationConfig,
                        systemInstruction,
                        tools: null,
                        isFirstCall: false
                    });
                    
                    modelMessage.content = textResult.content || '';
                }
                break;
            }

                const partsForApi = [
                    ...(result.thoughtParts || []),
                    ...result.toolCalls.map(tc => ({ functionCall: tc.functionCall }))
                ];

                const modelMessageForApi = { role: 'model', parts: partsForApi };
                const toolResultsForApi = toolResults.map(tr => ({
                    role: 'tool',
                    parts: [{
                        functionResponse: {
                            name: tr.name,
                            response: tr.response,
                            _toolCallId: tr._toolCallId  // OpenAI互換APIのtool_call_idを引き継ぐ
                        }
                    }]
                }));
                currentTurnHistory.push(modelMessageForApi, ...toolResultsForApi);
            
            // Bedrock使用時はレート制限回避のため遅延を入れる
            if (state.settings.apiProvider === 'bedrock') {
                const delayMs = 6500; // 6.5秒の遅延（レート制限: 毎分10リクエスト = 6秒間隔 + 余裕0.5秒）
                console.log(`[Bedrock] レート制限回避のため ${delayMs}ms 待機します...`);
                uiUtils.setLoadingIndicatorText(`レート制限回避のため ${delayMs/1000}秒待機中...`);
                await interruptibleSleep(delayMs, state.abortController.signal);
            }
            
            uiUtils.setLoadingIndicatorText('応答生成中...');
        }

        if (loopCount >= MAX_LOOPS) {
            console.warn("Function Callingのループが上限に達しました。");
            const finalErrorMessage = {
                role: 'model',
                content: 'AIが同じ操作を繰り返しているようです。処理を中断しました。プロンプトを修正して再度お試しください。',
                timestamp: Date.now(),
            };
            finalTurnResults.push(finalErrorMessage);
        }
        
        // 後処理（翻訳や校正）
        const finalModelMessages = finalTurnResults.filter(m => m.role === 'model');
        if (finalModelMessages.length > 0) {
            if (aggregatedSearchResults.length > 0) {
                const lastMessage = finalModelMessages[finalModelMessages.length - 1];
                lastMessage.search_web_results = aggregatedSearchResults;
            }

            if (state.settings.enableProofreading) {
                const lastTextResponse = finalModelMessages.filter(m => m.content).pop();
                if (lastTextResponse) {
                    try {
                        uiUtils.setLoadingIndicatorText('校正中...');
                        lastTextResponse.content = await this.proofreadText(lastTextResponse.content);
                    } catch (proofreadError) {
                        console.error("校正処理中にエラーが発生しました。校正前のテキストを使用します。", proofreadError);
                    }
                }
            }

            if (state.settings.enableThoughtTranslation) {
                for (const msg of finalModelMessages) {
                    if (msg.thoughtSummary) {
                        try {
                            uiUtils.setLoadingIndicatorText('思考プロセスを翻訳中...');
                            msg.thoughtSummary = await apiUtils.translateText(msg.thoughtSummary, state.settings.thoughtTranslationModel);
                        } catch (translateError) {
                            console.error("思考プロセスの翻訳中にエラーが発生しました。原文を使用します。", translateError);
                        }
                    }
                }
            }
        }
        
        return finalTurnResults;
    },





    /**
     * @private _internalHandleSendから返されたメッセージ配列を単一のオブジェクトに集約する。
     */
     _aggregateMessages(messages) {
        // 最後に content を持つ model メッセージを探す。なければ、最後の model メッセージを探す。
        const primaryModelMessage = [...messages].reverse().find(m => m.role === 'model' && m.content) 
                                 || [...messages].reverse().find(m => m.role === 'model');

        // プライマリメッセージが見つからない場合は、空のオブジェクトを返す（安全対策）
        if (!primaryModelMessage) {
            console.warn("[_aggregateMessages] プライマリとなるモデルメッセージが見つかりませんでした。");
            return { role: 'model', content: '', timestamp: Date.now(), imageIds: [] };
        }

        // プライマリメッセージをベースとして、最終的なオブジェクトを作成（ディープコピー）
        const finalAggregatedMessage = JSON.parse(JSON.stringify(primaryModelMessage));

        // imageIds や executedFunctions などを初期化
        finalAggregatedMessage.imageIds = finalAggregatedMessage.imageIds || [];
        finalAggregatedMessage.executedFunctions = finalAggregatedMessage.executedFunctions || [];
        finalAggregatedMessage.generated_videos = finalAggregatedMessage.generated_videos || [];

        // 全てのメッセージを走査し、ツール関連の情報をマージする
        messages.forEach(msg => {
            // 自身（プライマリ）以外のモデルメッセージからは、ツール実行履歴のみをマージ
            if (msg.role === 'model' && msg !== primaryModelMessage) {
                if (msg.executedFunctions) {
                    finalAggregatedMessage.executedFunctions.push(...msg.executedFunctions);
                }
            }
            
            // ツール応答からUIアクション（画像IDなど）をマージ
            if (msg.role === 'tool' && msg._internal_ui_action) {
                const actions = Array.isArray(msg._internal_ui_action) ? msg._internal_ui_action : [msg._internal_ui_action];
                actions.forEach(action => {
                    if (action.type === 'display_generated_images' && action.imageIds) {
                        finalAggregatedMessage.imageIds.push(...action.imageIds);
                    }
                    if (action.type === 'display_generated_videos' && action.videos) {
                        finalAggregatedMessage.generated_videos.push(...action.videos);
                    }
                });
            }
        });

        // 重複を除去
        finalAggregatedMessage.imageIds = [...new Set(finalAggregatedMessage.imageIds)];
        finalAggregatedMessage.executedFunctions = [...new Set(finalAggregatedMessage.executedFunctions)];

        // タイムスタンプを更新
        finalAggregatedMessage.timestamp = Date.now();

        return finalAggregatedMessage;
    },

    
    async handleSend() {
        state.pendingCascadeResponses = null; // 保留中のカスケードデータをクリア
        if (state.isSending) { return; }
        if (state.editingMessageIndex !== null) { await uiUtils.showCustomAlert("他のメッセージを編集中です。"); return; }
        if (state.isEditingSystemPrompt) { await uiUtils.showCustomAlert("システムプロンプトを編集中です。"); return; }

        const text = elements.userInput.value.trim();
        const attachmentsToSend = [...state.pendingAttachments];
        if (!text && attachmentsToSend.length === 0) return;

        uiUtils.setSendingState(true);
        uiUtils.setLoadingIndicatorText('応答生成中...');
        
        const userMessage = { role: 'user', content: text, timestamp: Date.now(), attachments: attachmentsToSend };
        state.currentMessages.push(userMessage);
        uiUtils.appendMessage(userMessage.role, userMessage.content, state.currentMessages.length - 1, false, null, userMessage.attachments);
        
        const baseHistory = state.currentMessages.filter(msg => !msg.isCascaded || msg.isSelected);
        
        const modelMessage = { role: 'model', content: '', timestamp: Date.now() };
        state.currentMessages.push(modelMessage);
        const modelMessageIndex = state.currentMessages.length - 1;
        uiUtils.appendMessage(modelMessage.role, modelMessage.content, modelMessageIndex, true);

        state.pendingAttachments = [];
        state.selectedFilesForUpload = [];
        uiUtils.updateAttachmentBadgeVisibility();
        elements.userInput.value = '';
        uiUtils.adjustTextareaHeight();
        if (state.settings.autoScroll) {
            this.scrollToBottom();
        }
        
        await dbUtils.saveChat(null, null, { skipPush: true });
        
        try {
            const generationConfig = {};
            if (state.settings.temperature !== null) generationConfig.temperature = state.settings.temperature;
            if (state.settings.maxTokens !== null) generationConfig.maxOutputTokens = state.settings.maxTokens;
            if (state.settings.topK !== null) generationConfig.topK = state.settings.topK;
            if (state.settings.topP !== null) generationConfig.topP = state.settings.topP;
            if (state.settings.thinkingBudget !== null || state.settings.includeThoughts) {
                generationConfig.thinkingConfig = {};
                if(state.settings.thinkingBudget !== null) generationConfig.thinkingConfig.thinkingBudget = state.settings.thinkingBudget;
                if(state.settings.includeThoughts) generationConfig.thinkingConfig.includeThoughts = true;
            }

            const summaryText = this._buildSummaryForPrompt();
            let finalSystemPrompt = state.currentSystemPrompt?.trim() || '';
            if (summaryText) {
                finalSystemPrompt += `\n\n${summaryText}`;
            }

            if (state.settings.enableMemory && state.isMemoryEnabledForChat && state.activeProfileId) {
                const memoryData = await dbUtils.getMemory(state.activeProfileId);
                if (memoryData && memoryData.items && memoryData.items.length > 0) {
                    const memoryBlock = `[長期記憶]\n- ${memoryData.items.join('\n- ')}\n---\n\n`;
                    finalSystemPrompt = memoryBlock + finalSystemPrompt;
                    console.log("長期記憶をシステムプロンプトに挿入しました。");
                }
            }

            const systemInstruction = finalSystemPrompt ? { role: "system", parts: [{ text: finalSystemPrompt }] } : null;

            const historyForApi = this._prepareApiHistory(baseHistory);
            const newMessages = await this._internalHandleSend(historyForApi, generationConfig, systemInstruction);
            
            const finalAggregatedMessage = this._aggregateMessages(newMessages);
            state.currentMessages[modelMessageIndex] = finalAggregatedMessage;

            uiUtils.renderChatMessages();

            // モデルの応答をDBに保存
            await dbUtils.saveChat(null, null, { skipPush: true });

            this.updateCharacterProfileButtonVisibility();

            // --- 自動学習トリガー ---
            const interval = parseInt(state.settings.memoryAutoSaveInterval, 10);
            // ユーザーの発言回数をカウント
            const userMessageCount = state.currentMessages.filter(m => m.role === 'user').length;
            if (state.settings.enableMemory && state.isMemoryEnabledForChat && interval > 0 && userMessageCount > 0 && userMessageCount % interval === 0) {
                console.log(`[Memory] ユーザーの発言数が ${userMessageCount} 回に達したため、自動学習を開始します。`);
                this.triggerAutoMemorySave(); // awaitを付けずに実行 (Fire-and-forget)
            }
            // -------------------------

        } catch(error) {
            console.error("--- handleSend: 最終catchブロックでエラー捕捉 ---", error);
            const errorMessage = (error.name !== 'AbortError') ? (error.message || "不明なエラーが発生しました。") : "リクエストがキャンセルされました。";
            
            state.currentMessages[modelMessageIndex] = { role: 'error', content: errorMessage, timestamp: Date.now() };
            uiUtils.renderChatMessages(() => uiUtils.scrollToBottom());
            
            // エラー発生時もDBに保存
            await dbUtils.saveChat(null, null, { skipPush: true });
        } finally {
            uiUtils.setSendingState(false);
            state.abortController = null;
            
            // 処理が完了したこのタイミングで、安全に同期処理をトリガーする
            this.markAsDirtyAndSchedulePush('message');

            if (state.settings.autoScroll) {
                requestAnimationFrame(() => {
                    this.scrollToBottom();
                });
            }
        }
    },


    
    // APIリクエストを中断
    abortRequest() {
        if (state.abortController) {
            console.log("中断リクエスト送信");
            state.abortController.abort(); // AbortControllerで中断
        } else {
            console.log("中断するアクティブなリクエストがありません。");
        }
    },

    // --- 履歴インポートハンドラ ---
    async handleHistoryImport(file) {
        if (!file || !file.type.startsWith('text/plain')) {
            await uiUtils.showCustomAlert("テキストファイル (.txt) を選択してください。");
            return;
        }
        console.log("履歴インポート開始:", file.name);
        
        elements.progressMessage.textContent = '履歴ファイルを解析中...';
        elements.progressDialog.showModal();

        const reader = new FileReader();

        reader.onload = async (event) => {
            const textContent = event.target.result;
            if (!textContent) {
                elements.progressDialog.close();
                await uiUtils.showCustomAlert("ファイルの内容が空です。");
                return;
            }
            try {
                const { messages: importedMessages, systemPrompt: importedSystemPrompt, persistentMemory: importedMemory, summarizedContext: importedSummary, imageData: importedImageData } = this.parseImportedHistory(textContent);
                
                if (importedMessages.length === 0 && !importedSystemPrompt && (!importedMemory || Object.keys(importedMemory).length === 0)) {
                    elements.progressDialog.close();
                    await uiUtils.showCustomAlert("ファイルから有効なメッセージ、システムプロンプト、またはメタデータを読み込めませんでした。形式を確認してください。");
                    return;
                }

                const imageIdMap = new Map();
                if (importedImageData && Object.keys(importedImageData).length > 0) {
                   
                    elements.progressMessage.textContent = `画像を復元中... (0 / ${Object.keys(importedImageData).length})`;
                    let restoredCount = 0;
                    const totalImages = Object.keys(importedImageData).length;

                    for (const oldId in importedImageData) {
                        try {
                            const { mimeType, data } = importedImageData[oldId];
                            const blob = await this.base64ToBlob(data, mimeType);
                            const newId = await this.saveImageBlob(blob);
                            imageIdMap.set(oldId, newId);
                            restoredCount++;
                            elements.progressMessage.textContent = `画像を復元中... (${restoredCount} / ${totalImages})`;
                        } catch (e) {
                            console.error(`インポート中に画像(旧ID: ${oldId})の復元に失敗:`, e);
                        }
                    }
                }

                elements.progressMessage.textContent = 'データベースに保存中...';

                importedMessages.forEach(msg => {
                    if (msg.imageIds && msg.imageIds.length > 0) {
                        msg.imageIds = msg.imageIds.map(oldId => imageIdMap.get(oldId) || oldId).filter(Boolean);
                    }
                });

                let currentGroupId = null;
                let lastUserIndex = -1;
                for (let i = 0; i < importedMessages.length; i++) {
                    const msg = importedMessages[i];
                    if (msg.role === 'user') {
                        lastUserIndex = i;
                        currentGroupId = null;
                    } else if (msg.role === 'model' && msg.isCascaded) {
                        if (currentGroupId === null && lastUserIndex !== -1) {
                            currentGroupId = `imp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                        }
                        if (currentGroupId) {
                            msg.siblingGroupId = currentGroupId;
                        }
                    } else {
                        currentGroupId = null;
                    }
                }
                const groupIds = new Set(importedMessages.filter(m => m.siblingGroupId).map(m => m.siblingGroupId));
                groupIds.forEach(gid => {
                    const siblings = importedMessages.filter(m => m.siblingGroupId === gid);
                    const selected = siblings.filter(m => m.isSelected);
                    if (selected.length === 0 && siblings.length > 0) {
                        siblings[siblings.length - 1].isSelected = true;
                    } else if (selected.length > 1) {
                        selected.slice(0, -1).forEach(m => m.isSelected = false);
                    }
                });

                const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
                const newTitle = IMPORT_PREFIX + (fileNameWithoutExt || `Imported_${Date.now()}`);

                const newChatData = {
                    messages: importedMessages,
                    systemPrompt: importedSystemPrompt || '',
                    persistentMemory: importedMemory || {},
                    summarizedContext: importedSummary || null,
                    updatedAt: Date.now(),
                    createdAt: Date.now(),
                    title: newTitle.substring(0, 100)
                };

                const newChatId = await new Promise((resolve, reject) => {
                    const store = dbUtils._getStore(CHATS_STORE, 'readwrite');
                    const request = store.add(newChatData);
                    request.onsuccess = (event) => resolve(event.target.result);
                    request.onerror = (event) => reject(event.target.error);
                });

                this.markAsDirtyAndSchedulePush(true);

                console.log("履歴インポート成功:", newChatId);
                elements.progressDialog.close();
                await uiUtils.showCustomAlert(`履歴「${newChatData.title}」をインポートしました。`);
                uiUtils.renderHistoryList();

            } catch (error) {
                console.error("履歴インポート処理エラー:", error);
                elements.progressDialog.close();
                await uiUtils.showCustomAlert(`履歴のインポート中にエラーが発生しました: ${error.message}`);
            }
        };

        reader.onerror = async (event) => {
            console.error("ファイル読み込みエラー:", event.target.error);
            elements.progressDialog.close();
            await uiUtils.showCustomAlert("ファイルの読み込みに失敗しました。");
        };

        reader.readAsText(file);
    },

    parseImportedHistory(text) {
        const messages = [];
        let systemPrompt = '';
        let persistentMemory = {};
        let summarizedContext = null;
        const imageData = {};
        const attachmentData = {}; // 添付ファイルデータ保持用オブジェクト

        let remainingText = text;

        // 正規表現を更新し、attachmentdataも捕捉できるようにする
        const dataBlockRegex = /<\|#\|(metadata|summary|imagedata|attachmentdata)\|#\|>([\s\S]*?)<\|#\|\/\1\|#\|>\s*/g;
        let dataMatch;
        while ((dataMatch = dataBlockRegex.exec(text)) !== null) {
            const blockType = dataMatch[1];
            const blockContent = dataMatch[2].trim();
            try {
                const jsonData = JSON.parse(blockContent);
                switch (blockType) {
                    case 'metadata':
                        persistentMemory = jsonData;
                        break;
                    case 'summary':
                        summarizedContext = jsonData;
                        break;
                    case 'imagedata':
                        Object.assign(imageData, jsonData);
                        break;
                    case 'attachmentdata': // attachmentdataブロックの処理を追加
                        Object.assign(attachmentData, jsonData);
                        break;
                }
            } catch (e) {
                console.error(`インポートされた ${blockType} のJSONパースに失敗:`, e);
            }
            // パースしたブロックを元のテキストから削除
            remainingText = remainingText.replace(dataMatch[0], '');
        }
    
        const blockRegex = /<\|#\|(system|user|model)\|#\|([^>]*)>([\s\S]*?)<\|#\|\/\1\|#\|>/g;
        let match;
    
        while ((match = blockRegex.exec(remainingText)) !== null) {
            const role = match[1];
            const attributesString = match[2].trim();
            const content = match[3].trim();
    
            if (role === 'system' && content) {
                systemPrompt = content;
            } else if ((role === 'user' || role === 'model')) {
                const messageData = {
                    role: role,
                    content: content,
                    timestamp: Date.now(),
                    attachments: []
                };

                const attributeRegex = /(\w+)="([^"]*)"|(\w+)/g;
                let attrMatch;
                while ((attrMatch = attributeRegex.exec(attributesString)) !== null) {
                    if (attrMatch[1]) {
                        const key = attrMatch[1];
                        const value = attrMatch[2].replace(/&quot;/g, '"');
                        if (key === 'attachments') {
                            // attachmentIdを元に、保持しておいたデータから完全なオブジェクトを復元
                            const attachmentIds = value.split(',');
                            messageData.attachments = attachmentIds.map(id => {
                                const data = attachmentData[id];
                                if (data) {
                                    return {
                                        name: data.name,
                                        mimeType: data.mimeType,
                                        base64Data: data.data,
                                        // fileオブジェクトはインポート時には復元しない
                                    };
                                }
                                return null; // データが見つからない場合はnull
                            }).filter(Boolean); // nullを除外
                        } else if (key === 'imageIds') {
                            messageData.imageIds = value.split(',');
                        }
                    } else if (attrMatch[3]) {
                        messageData[attrMatch[3]] = true;
                    }
                }
                messages.push(messageData);
            }
        }
        console.log(`インポートテキストから ${messages.length} 件のメッセージとシステムプロンプト(${systemPrompt ? 'あり' : 'なし'})、要約データ(${summarizedContext ? 'あり' : 'なし'})をパースしました。`);

        // 返り値にimageDataを追加
        return { messages, systemPrompt, persistentMemory, summarizedContext, imageData };
    },



    // -------------------------------

    // --- 背景画像ハンドラ ---
    async handleBackgroundImageUpload(file) {
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            await uiUtils.showCustomAlert(`画像サイズが大きすぎます (${(maxSize / 1024 / 1024).toFixed(1)}MB以下にしてください)`);
            return;
        }
        if (!file.type.startsWith('image/')) {
            await uiUtils.showCustomAlert("画像ファイルを選択してください (JPEG, PNG, GIF, WebPなど)");
            return;
        }
        try {
            const blob = file;
            // stateとDBを更新し、新しい関数を呼び出してUIに適用する
            state.settings.backgroundImageBlob = blob;
            await dbUtils.saveSetting('backgroundImageBlob', blob);
            uiUtils.applyBackgroundImage();
        } catch (error) {
            console.error("背景画像の保存・適用エラー:", error);
            // エラー時にはstateとDBをnullに戻し、背景を非表示にする
            state.settings.backgroundImageBlob = null;
            await dbUtils.saveSetting('backgroundImageBlob', null);
            uiUtils.applyBackgroundImage();
        }
    },
     // 背景画像削除の確認
     async confirmDeleteBackgroundImage() {
         const confirmed = await uiUtils.showCustomConfirm("背景画像を削除しますか？");
         if (confirmed) {
             await this.handleBackgroundImageDelete();
         }
     },
     // 背景画像削除処理
    async handleBackgroundImageDelete() {
        try {
            uiUtils.revokeExistingObjectUrl();
            await dbUtils.saveSetting('backgroundImageBlob', null);
            state.settings.backgroundImageBlob = null;

            state.isTemporaryBackgroundActive = false;
            elements.chatScreen.classList.remove('background-visible');
            document.documentElement.style.removeProperty('--chat-background-image');
            uiUtils.updateBackgroundSettingsUI();
        } catch (error) {
    
    
           console.error("背景画像削除エラー:", error);
           await uiUtils.showCustomAlert(`背景画像の削除中にエラーが発生しました: ${error}`);
        }
    },
     // -------------------------------

    // アプリを更新 (キャッシュクリア)
    async updateApp() {
        if (!('serviceWorker' in navigator)) {
            await uiUtils.showCustomAlert("お使いのブラウザはService Workerをサポートしていません。");
            return;
        }
        
        const confirmed = await uiUtils.showCustomConfirm("アプリのキャッシュをクリアして最新版を再取得しますか？ (ページがリロードされます)");
        if (!confirmed) return;

        try {
            const registration = await navigator.serviceWorker.ready;
            
            if (registration && registration.active) {
                // Service Workerにキャッシュクリアを指示します。
                // リロード処理は、sw.jsからの完了メッセージを 'message' リスナーが受け取って実行します。
                registration.active.postMessage({ action: 'clearCache' });

            } else {
                await uiUtils.showCustomAlert("アクティブなService Workerが見つかりませんでした。ページを強制的に再読み込みします。");
                window.location.reload(true);
            }
        } catch (error) {
            console.error("Service Workerの処理中にエラー:", error);
            await uiUtils.showCustomAlert(`Service Workerの処理中にエラーが発生しました。ページを強制的に再読み込みします。\nエラー: ${error.message}`);
            window.location.reload(true);
        }
    },

    // 全データ削除の確認と実行
    async confirmClearAllData() {
        const confirmed = await uiUtils.showCustomConfirm("本当にすべてのデータ（チャット履歴、プロファイル、アセット、設定）を削除しますか？この操作は元に戻せません。");
        if (confirmed) {
            try {
                uiUtils.revokeExistingObjectUrl();
                await dbUtils.clearAllData();
                await uiUtils.showCustomAlert("すべてのデータが削除されました。アプリをリセットします。");

                // ページをリロードして、完全にクリーンな状態で再起動するのが最も確実
                window.location.reload();

            } catch (error) {
                await uiUtils.showCustomAlert(`データ削除中にエラーが発生しました: ${error}`);
            }
        }
    },

    async executeToolCalls(toolCalls, historyForFunctions, responseTextForQc = '') {
        const messagesForFunction = (historyForFunctions || []).map(c => c.originalMessage || c);
        
        // ダミープロンプトの数を計算
        const dummyUserCount = state.settings.dummyUser ? 1 : 0;
        const dummyModelCount = state.settings.dummyModel ? 1 : 0;
        const dummyPromptCount = dummyUserCount + dummyModelCount;

        const chat = {
            id: state.currentChatId,
            messages: messagesForFunction.filter(m => m.role !== 'tool'),
            systemPrompt: state.currentSystemPrompt,
            persistentMemory: state.currentPersistentMemory,
            dummy_prompt_count: dummyPromptCount // 計算したダミーの数を追加
        };

    
        const toolResults = [];
        let containsTerminalAction = false;
        let aggregatedSearchResults = [];
        let internalUiActions = [];
    
        for (const toolCall of toolCalls) {
            const functionName = toolCall.functionCall.name;
            const functionArgs = toolCall.functionCall.args;
            
            console.log(`[Function Calling] 実行: ${functionName}`, functionArgs);

            // 終端アクションとなる関数かをここで判定する
            if (['generate_image', 'generate_video', 'edit_image', 'display_layered_image', 'run_quality_checker'].includes(functionName)) {
                containsTerminalAction = true;
                console.log(`[Function Calling] 終端アクション (${functionName}) を検出しました。`);
            }
    
            let result;
            if (window.functionCallingTools && typeof window.functionCallingTools[functionName] === 'function') {
                try {
                    const argsWithContext = { ...functionArgs, _responseTextForQc: responseTextForQc };
                    result = await window.functionCallingTools[functionName](argsWithContext, chat);
                } catch (e) {
                    console.error(`[Function Calling] 関数 '${functionName}' の実行中にエラーが発生しました:`, e);
                    result = { error: `関数実行中の内部エラー: ${e.message}` };
                }
            } else {
                console.error(`[Function Calling] 関数 '${functionName}' が見つかりません。`);
                result = { error: `関数 '${functionName}' が見つかりません。` };
            }

            const responseForAI = { ...result };

            if (result.search_results) {
                aggregatedSearchResults.push(...result.search_results);
                delete responseForAI.search_results;
            }

            if (result._internal_ui_action) {
                console.log(`[Debug] executeToolCalls: _internal_ui_actionを検出`, result._internal_ui_action);
                internalUiActions.push(result._internal_ui_action);

                if (result._internal_ui_action.type === 'display_layered_image') {
                    containsTerminalAction = true;
                }
                
                delete responseForAI._internal_ui_action;
            }

            toolResults.push({ 
                role: 'tool', 
                name: functionName, 
                response: responseForAI, 
                timestamp: Date.now(),
                _toolCallId: toolCall.functionCall._toolCallId  // Bedrock API用にtoolCallIdを保持
            });

            if (containsTerminalAction) {
                break;
            }
        }
    
        if (chat.persistentMemory) {
            state.currentPersistentMemory = chat.persistentMemory;
        }
        await dbUtils.saveChat();
    
        state.currentScene = state.currentPersistentMemory?.scene_stack?.slice(-1)[0] || null;
        state.currentStyleProfiles = state.currentPersistentMemory?.style_profiles || {};
    
        return { toolResults, containsTerminalAction, search_results: aggregatedSearchResults, internalUiActions };
    },


    // --- システムプロンプト編集 ---
    startEditSystemPrompt() {
        if (state.isSending) return; // 送信中は編集不可
        state.isEditingSystemPrompt = true;
        elements.systemPromptEditor.value = state.currentSystemPrompt; // 現在の値で初期化
        uiUtils.adjustTextareaHeight(elements.systemPromptEditor, 200);
        elements.systemPromptEditor.focus();
        console.log("システムプロンプト編集開始");
    },
    async saveCurrentSystemPrompt() {
        const newPrompt = elements.systemPromptEditor.value.trim();
        if (newPrompt !== state.currentSystemPrompt) {
            state.currentSystemPrompt = newPrompt;
            try {
                await dbUtils.saveChat(); // 現在のチャットを保存 (SP含む)
                await sleep(100);
                console.log("システムプロンプト保存完了");
            } catch (error) {
                await uiUtils.showCustomAlert("システムプロンプトの保存に失敗しました。");
            }
        }
        state.isEditingSystemPrompt = false;
        elements.systemPromptDetails.removeAttribute('open'); // detailsを閉じる
    },
    cancelEditSystemPrompt() {
        state.isEditingSystemPrompt = false;
        elements.systemPromptEditor.value = state.currentSystemPrompt; // 元の値に戻す
        elements.systemPromptDetails.removeAttribute('open'); // detailsを閉じる
        uiUtils.adjustTextareaHeight(elements.systemPromptEditor, 200);
        console.log("システムプロンプト編集キャンセル");
    },
    // -----------------------------

    // --- メッセージアクション ---
    // メッセージ編集開始
    async startEditMessage(index, messageElement) {
        const startTime = performance.now();
        console.log(`[PERF_DEBUG] startEditMessage 開始 (index: ${index})`);

        if (state.isSending) {
            await uiUtils.showCustomAlert("送信中は編集できません。");
            return;
        }
        if (state.editingMessageIndex !== null && state.editingMessageIndex !== index) {
            await uiUtils.showCustomAlert("他のメッセージを編集中です。");
            return;
        }
        if (state.isEditingSystemPrompt) {
            await uiUtils.showCustomAlert("システムプロンプトを編集中です。");
            return;
        }
        if (state.editingMessageIndex === index) {
            messageElement.querySelector('.edit-textarea')?.focus();
            return;
        }

        const message = state.currentMessages[index];
        if (!message) return;

        const rawContent = message.content;
        state.editingMessageIndex = index;

        const contentDiv = messageElement.querySelector('.message-content');
        const editArea = messageElement.querySelector('.message-edit-area');
        const cascadeControls = messageElement.querySelector('.message-cascade-controls');
        editArea.innerHTML = '';

        let horizontalPadding = 0;
        try {
            const computedStyle = window.getComputedStyle(messageElement);
            const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
            horizontalPadding = paddingLeft + paddingRight;
        } catch (e) {
            console.error("幅の動的計算中にエラー:", e);
        }
        messageElement.style.width = `calc(var(--message-max-width) + ${horizontalPadding}px + 17px)`;

        const textarea = document.createElement('textarea');
        textarea.value = rawContent;
        textarea.classList.add('edit-textarea');
        textarea.rows = 3;

        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('message-edit-actions');

        const saveButton = document.createElement('button');
        saveButton.textContent = '保存';
        saveButton.classList.add('save-edit-btn');
        saveButton.onclick = () => this.saveEditMessage(index, messageElement);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'キャンセル';
        cancelButton.classList.add('cancel-edit-btn');
        cancelButton.onclick = () => this.cancelEditMessage(index, messageElement);

        actionsDiv.appendChild(saveButton);
        actionsDiv.appendChild(cancelButton);
        editArea.appendChild(textarea);
        editArea.appendChild(actionsDiv);

        messageElement.classList.add('editing');
        if(contentDiv) contentDiv.classList.add('hidden');
        if(cascadeControls) cascadeControls.classList.add('hidden');
        editArea.classList.remove('hidden');

        uiUtils.adjustTextareaHeight(textarea, 400); // 編集開始時に一度だけ高さを調整
        textarea.focus();
        textarea.select();
        const endTime = performance.now();
        console.log(`[PERF_DEBUG] startEditMessage 完了 (所要時間: ${endTime - startTime}ms)`);
    },




    // メッセージ編集を保存
    async saveEditMessage(index, messageElement) {
        const textarea = messageElement.querySelector('.edit-textarea');
        if (!textarea) {
            this.cancelEditMessage(index, messageElement);
            return;
        }
        const newRawContent = textarea.value; // trim() を削除し、空白のみの保存も許可
        const originalMessage = state.currentMessages[index];

        if (newRawContent === originalMessage.content) {
            this.cancelEditMessage(index, messageElement);
            return;
        }

        // 1. stateを更新
        const updatedMessage = {
            ...originalMessage,
            content: newRawContent,
            timestamp: Date.now()
        };
        delete updatedMessage.error;
        state.currentMessages[index] = updatedMessage;

        // 2. 既存のメタ情報表示を一旦削除
        messageElement.querySelectorAll('.function-call-details, .citation-details').forEach(el => el.remove());

        // 3. テキスト部分をDOMに反映
        const contentDiv = messageElement.querySelector('.message-content');
        if (contentDiv) {
            if (updatedMessage.role === 'model' && typeof marked !== 'undefined') {
                contentDiv.innerHTML = marked.parse(newRawContent || '');
            } else {
                const pre = contentDiv.querySelector('pre') || document.createElement('pre');
                pre.textContent = newRawContent;
                if (!contentDiv.querySelector('pre')) {
                    contentDiv.innerHTML = '';
                    contentDiv.appendChild(pre);
                }
            }
        }

        // 4. 画像が存在する場合、画像を再注入
        const imagePlaceholderRegex = /<p>\[IMAGE_HERE\]<\/p>|\[IMAGE_HERE\]/g;
        if (updatedMessage.role === 'model' && updatedMessage.imageIds && updatedMessage.imageIds.length > 0) {
            let imageIndex = 0;
            // プレースホルダーを<img>タグに置換
            const replacedHtml = contentDiv.innerHTML.replace(imagePlaceholderRegex, () => {
                if (imageIndex < updatedMessage.imageIds.length) {
                    const imageId = updatedMessage.imageIds[imageIndex++];
                    // createMessageElementと同様の遅延読み込み用のimgタグを生成
                    return `<img class="lazy-load-image" alt="生成画像（読み込み中...）" data-image-id="${imageId}">`;
                }
                return ''; // プレースホルダーが画像の数より多い場合は空文字に
            });
            contentDiv.innerHTML = replacedHtml;

            // プレースホルダーが足りなかった場合、残りの画像を末尾に追加
            if (imageIndex < updatedMessage.imageIds.length) {
                const fragment = document.createDocumentFragment();
                for (let i = imageIndex; i < updatedMessage.imageIds.length; i++) {
                    const imageId = updatedMessage.imageIds[i];
                    const img = document.createElement('img');
                    img.className = 'lazy-load-image';
                    img.alt = '生成画像（読み込み中...）';
                    img.dataset.imageId = imageId;
                    fragment.appendChild(img);
                }
                contentDiv.appendChild(fragment);
            }
            
            // 新しく追加された画像をIntersectionObserverの監視対象に追加
            requestAnimationFrame(() => {
                const newImages = contentDiv.querySelectorAll('.lazy-load-image[data-image-id]');
                newImages.forEach(img => this.imageObserver.observe(img));
            });
        }

        // 5. メタ情報（ツール使用履歴など）を再生成して追加
        if (updatedMessage.role === 'model') {
            const detailsFragment = document.createDocumentFragment();
            // ツール使用履歴
            if (updatedMessage.executedFunctions && updatedMessage.executedFunctions.length > 0) {
                const details = document.createElement('details');
                details.classList.add('function-call-details');
                const uniqueFunctions = [...new Set(updatedMessage.executedFunctions)];
                const summary = document.createElement('summary');
                summary.innerHTML = `⚙️ ツール使用 (${uniqueFunctions.length}件)`;
                details.appendChild(summary);
                const list = document.createElement('ul');
                list.classList.add('function-call-list');
                uniqueFunctions.forEach(funcName => {
                    const listItem = document.createElement('li');
                    listItem.textContent = funcName;
                    list.appendChild(listItem);
                });
                details.appendChild(list);
                detailsFragment.appendChild(details);
            }
            // Web検索結果
            if (updatedMessage.search_web_results && updatedMessage.search_web_results.length > 0) {
                const details = document.createElement('details');
                details.classList.add('function-call-details');
                const summary = document.createElement('summary');
                summary.innerHTML = `🌐 Web検索結果 (${updatedMessage.search_web_results.length}件)`;
                details.appendChild(summary);
                const list = document.createElement('ul');
                list.classList.add('function-call-list');
                updatedMessage.search_web_results.forEach(result => {
                    const listItem = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = result.link;
                    link.textContent = result.title;
                    link.title = result.snippet;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    listItem.appendChild(link);
                    list.appendChild(listItem);
                });
                details.appendChild(list);
                detailsFragment.appendChild(details);
            }
            
            // 生成したメタ情報を適切な場所に追加
            if (contentDiv.innerHTML.trim() !== '') {
                contentDiv.appendChild(detailsFragment);
            } else {
                messageElement.appendChild(detailsFragment);
            }
        }

        // 6. Prism.jsでハイライトを再適用
        if (window.Prism) {
            contentDiv.querySelectorAll('pre code').forEach((block) => {
                Prism.highlightElement(block);
            });
        }

        // 7. 編集UIを閉じる
        this.finishEditing(messageElement);

        // 8. DBへの保存処理
        try {
            const requiresTitleUpdate = (index === state.currentMessages.findIndex(m => m.role === 'user'));
            let newTitleForSave = null;
            if (requiresTitleUpdate) {
                newTitleForSave = newRawContent.substring(0, 50) || "無題のチャット";
            }
            await dbUtils.saveChat(newTitleForSave);

            if (requiresTitleUpdate) {
                uiUtils.updateChatTitle(newTitleForSave);
            }
            console.log("メッセージ編集後にチャット保存:", index);
        } catch (error) {
            await uiUtils.showCustomAlert("メッセージ編集後のチャット保存に失敗しました。");
        }
    },



    // メッセージ編集をキャンセル
    cancelEditMessage(index, messageElement = null) {
          if (!messageElement) {
              messageElement = elements.messageContainer.querySelector(`.message[data-index="${index}"]`);
          }
          if (messageElement) {
              this.finishEditing(messageElement);
          } else if (state.editingMessageIndex === index) {
              state.editingMessageIndex = null;
              console.log("編集キャンセル: 要素が見つかりませんでしたがインデックスをリセット:", index);
          }
    },
    // 編集UIを終了する共通処理
    finishEditing(messageElement) {
        if (!messageElement) return;
        const editArea = messageElement.querySelector('.message-edit-area');
        const contentDiv = messageElement.querySelector('.message-content');
        const cascadeControls = messageElement.querySelector('.message-cascade-controls');

        messageElement.style.removeProperty('width');

        messageElement.classList.remove('editing');
        if(contentDiv) contentDiv.classList.remove('hidden');
        if(cascadeControls) cascadeControls.classList.remove('hidden');
        if(editArea) {
            editArea.classList.add('hidden');
            editArea.innerHTML = '';
        }

        const index = parseInt(messageElement.dataset.index, 10);
        if (state.editingMessageIndex === index) {
            state.editingMessageIndex = null;
            console.log("編集終了:", index);
        }

        elements.userInput.focus();
    },

    // メッセージを削除 (会話ターン全体)
    async deleteMessage(index) {
        if (state.editingMessageIndex === index) {
            this.cancelEditMessage(index);
        }
        if (state.isSending) {
            await uiUtils.showCustomAlert("送信中は削除できません。");
            return;
        }
        if (state.isEditingSystemPrompt) {
            await uiUtils.showCustomAlert("システムプロンプトを編集中は削除できません。");
            return;
        }
        if (index < 0 || index >= state.currentMessages.length) {
             console.error("削除対象のインデックスが無効:", index);
             return;
        }

        const messageToDelete = state.currentMessages[index];
        const messageContentPreview = messageToDelete.content.substring(0, 30) + "...";
        let confirmMessage = "";
        let deleteTargetDescription = "";
        let indicesToDelete = [];

        if (messageToDelete.role === 'user') {
            indicesToDelete.push(index);
            confirmMessage = `メッセージ「${messageContentPreview}」を削除しますか？`;
            deleteTargetDescription = `単一メッセージ (index: ${index}, role: user)`;

            const nextMessageIndex = index + 1;
            if (nextMessageIndex < state.currentMessages.length && state.currentMessages[nextMessageIndex].role === 'error') {
                indicesToDelete.push(nextMessageIndex);
                confirmMessage = `メッセージ「${messageContentPreview}」と、それに対するエラー応答を削除しますか？`;
                deleteTargetDescription = `メッセージペア (user at ${index}, error at ${nextMessageIndex})`;
            }
        } else if (messageToDelete.role === 'model' && messageToDelete.isCascaded && messageToDelete.siblingGroupId) {
            const groupId = messageToDelete.siblingGroupId;
            const siblings = state.currentMessages.filter(msg => msg.role === 'model' && msg.isCascaded && msg.siblingGroupId === groupId);
            indicesToDelete = state.currentMessages
                .map((msg, i) => (msg.role === 'model' && msg.isCascaded && msg.siblingGroupId === groupId) ? i : -1)
                .filter(i => i !== -1);

            confirmMessage = `「${messageContentPreview}」を含む応答グループ全体 (${siblings.length}件) を削除しますか？`;
            deleteTargetDescription = `カスケードグループ (gid: ${groupId}, ${indicesToDelete.length}件)`;
        } else {
            indicesToDelete.push(index);
            confirmMessage = `メッセージ「${messageContentPreview}」(${messageToDelete.role}) を削除しますか？`;
            deleteTargetDescription = `単一メッセージ (index: ${index}, role: ${messageToDelete.role})`;
        }

        const confirmed = await uiUtils.showCustomConfirm(confirmMessage);
        if (confirmed) {
            console.log(`削除実行: ${deleteTargetDescription}`);
            const originalFirstUserMsgIndex = state.currentMessages.findIndex(m => m.role === 'user');

            indicesToDelete.sort((a, b) => b - a).forEach(idx => {
                state.currentMessages.splice(idx, 1);
            });

            console.log(`メッセージ削除完了 (state)。削除件数: ${indicesToDelete.length}`);

            const newFirstUserMsgIndex = state.currentMessages.findIndex(m => m.role === 'user');
            let requiresTitleUpdate = indicesToDelete.includes(originalFirstUserMsgIndex);

            try {
                uiUtils.renderChatMessages();
    
                let newTitleForSave = null;
                const currentChatData = state.currentChatId ? await dbUtils.getChat(state.currentChatId) : null;
    
                if (requiresTitleUpdate) {
                    const newFirstUserMessage = newFirstUserMsgIndex !== -1 ? state.currentMessages[newFirstUserMsgIndex] : null;
                    newTitleForSave = newFirstUserMessage ? newFirstUserMessage.content.substring(0, 50) : "無題のチャット";
                } else if (currentChatData) {
                    newTitleForSave = currentChatData.title;
                }
    
                await dbUtils.saveChat(newTitleForSave);
    
                if (requiresTitleUpdate) {
                    uiUtils.updateChatTitle(newTitleForSave);
                }
    
                if (state.currentMessages.length === 0 && !state.currentSystemPrompt && state.currentChatId) {
                    console.log("チャットが空になったためリセットします。");
                    this.startNewChat();
                }
                
                if (state.settings.autoScroll) {
                    requestAnimationFrame(() => {
                        this.scrollToBottom();
                    });
                }
    
            } catch (error) {
                console.error("メッセージ削除後のチャット保存/取得エラー:", error);
                await uiUtils.showCustomAlert("メッセージ削除後のチャット保存に失敗しました。");
            }
    
        } else {
             console.log("削除キャンセル");
        }
    },

    async retryFromMessage(index) {
        if (state.isSending) { await uiUtils.showCustomAlert("送信中です。"); return; }
        
        const userMessage = state.currentMessages[index];
        if (!userMessage || userMessage.role !== 'user') return;
    
        const messageContentPreview = userMessage.content.substring(0, 30) + "...";
        const confirmed = await uiUtils.showCustomConfirm(`「${messageContentPreview}」から再生成しますか？\n(これより未来の会話履歴は削除され、既存の応答は別候補として保持されます)`);
    
        if (confirmed) {
            uiUtils.setSendingState(true);
    
            let originalResponses = [];
            // 保留中のカスケード応答があれば、それを使用する
            if (state.pendingCascadeResponses) {
                originalResponses = state.pendingCascadeResponses;
                console.log("保留中のカスケード応答を復元しました。");
            } else {
                const futureMessages = state.currentMessages.slice(index + 1);
                const firstModelResponse = futureMessages.find(msg => msg.role === 'model');
                if (firstModelResponse && firstModelResponse.isCascaded && firstModelResponse.siblingGroupId) {
                    const groupId = firstModelResponse.siblingGroupId;
                    originalResponses = state.currentMessages.filter(
                        msg => msg.siblingGroupId === groupId
                    );
                } else if (firstModelResponse) {
                    originalResponses.push(firstModelResponse);
                }
            }
    
            // 次の再生成に備えて、元の応答をstateに待避させる
            state.pendingCascadeResponses = originalResponses;
            
            // UI上から古い応答を削除し、stateもユーザープロンプトまでの状態に戻す
            state.currentMessages.splice(index + 1);
            uiUtils.renderChatMessages();
    
            let modelMessage;
    
            try {
                const baseHistory = state.currentMessages.filter(msg => !msg.isCascaded || msg.isSelected);
                const historyForApi = this._prepareApiHistory(baseHistory);
    
                modelMessage = { role: 'model', content: '', timestamp: Date.now() };
                state.currentMessages.push(modelMessage);
                const modelMessageIndex = state.currentMessages.length - 1;
                uiUtils.appendMessage(modelMessage.role, modelMessage.content, modelMessageIndex, true);
                this.scrollToBottom();
    
                const generationConfig = {};
                if (state.settings.temperature !== null) generationConfig.temperature = state.settings.temperature;
                if (state.settings.maxTokens !== null) generationConfig.maxOutputTokens = state.settings.maxTokens;
                if (state.settings.topK !== null) generationConfig.topK = state.settings.topK;
                if (state.settings.topP !== null) generationConfig.topP = state.settings.topP;
                 if (state.settings.thinkingBudget !== null || state.settings.includeThoughts) {
                    generationConfig.thinkingConfig = {};
                    if(state.settings.thinkingBudget !== null) generationConfig.thinkingConfig.thinkingBudget = state.settings.thinkingBudget;
                    if(state.settings.includeThoughts) generationConfig.thinkingConfig.includeThoughts = true;
                }
                const systemInstruction = state.currentSystemPrompt?.trim() ? { role: "system", parts: [{ text: state.currentSystemPrompt.trim() }] } : null;
    
                const newMessages = await this._internalHandleSend(historyForApi, generationConfig, systemInstruction);
                const newAggregatedMessage = this._aggregateMessages(newMessages);
    
                // 成功したので、待避していたデータを取得し、待避領域をクリア
                const finalOriginalResponses = state.pendingCascadeResponses || [];
                state.pendingCascadeResponses = null;

                const siblingGroupId = (finalOriginalResponses.length > 0 && finalOriginalResponses[0].siblingGroupId)
                    ? finalOriginalResponses[0].siblingGroupId
                    : `gid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

                finalOriginalResponses.forEach(msg => {
                    msg.isCascaded = true;
                    msg.isSelected = false;
                    msg.siblingGroupId = siblingGroupId;
                });

                // 最終結果のexecutedFunctionsを初期化
                newAggregatedMessage.executedFunctions = newAggregatedMessage.executedFunctions || [];
                
                // 再生成中に実行された関数呼び出しがあれば、それらも新しいメッセージのexecutedFunctionsに追加する
                newMessages.forEach(msg => {
                    if (msg.executedFunctions && Array.isArray(msg.executedFunctions)) {
                         msg.executedFunctions.forEach(funcName => {
                             if (!newAggregatedMessage.executedFunctions.includes(funcName)) {
                                 newAggregatedMessage.executedFunctions.push(funcName);
                             }
                         });
                    }
                    // ツール実行結果からも復元
                     if (msg.role === 'tool' && msg.name) {
                         if (!newAggregatedMessage.executedFunctions.includes(msg.name)) {
                             newAggregatedMessage.executedFunctions.push(msg.name);
                         }
                     }
                });
                
                newAggregatedMessage.isCascaded = true;
                newAggregatedMessage.isSelected = true;
                newAggregatedMessage.siblingGroupId = siblingGroupId;

                state.currentMessages.splice(modelMessageIndex, 1, ...finalOriginalResponses, newAggregatedMessage);
                uiUtils.renderChatMessages();
                this.scrollToBottom();
                await dbUtils.saveChat();
    
            } catch(error) {
                console.error("再生成エラー:", error);
                const errorMessage = (error.name !== 'AbortError') ? (error.message || "不明なエラーが発生しました。") : "リクエストがキャンセルされました。";
                
    
                // 1. プレースホルダーを履歴から削除
                const placeholderIndex = state.currentMessages.findIndex(m => m.timestamp === modelMessage.timestamp);
                if (placeholderIndex !== -1) {
                    state.currentMessages.splice(placeholderIndex, 1);
                }
    
                // 2. DBにはエラーメッセージを含まない現在の履歴（ユーザープロンプトまで）を保存
                await dbUtils.saveChat();
    
                // 3. UI表示のためだけに、エラーメッセージを現在のメッセージリストに追加
                state.currentMessages.push({ role: 'error', content: errorMessage, timestamp: Date.now(), isNonPersistent: true });
    
                // 4. UIを再描画（これで「ユーザープロンプト → エラー」表示になる）
                uiUtils.renderChatMessages();
    
                // 5. 次の操作に備え、UI表示用に追加したエラーメッセージを履歴から削除
                state.currentMessages = state.currentMessages.filter(m => !m.isNonPersistent);
                
                this.scrollToBottom();
    
            } finally {
                uiUtils.setSendingState(false);
                state.abortController = null; 
                if (state.settings.autoScroll) {
                    requestAnimationFrame(() => {
                        this.scrollToBottom();
                    });
                }
            }
        }
    },    

    // --- カスケード応答操作 ---
    getCascadedSiblings(index, includeSelf = false) {
        const targetMsg = state.currentMessages[index];
        if (!targetMsg || !targetMsg.isCascaded || !targetMsg.siblingGroupId) {
            return [];
        }
        const groupId = targetMsg.siblingGroupId;
        const siblings = state.currentMessages.filter((msg, i) =>
            msg.role === 'model' &&
            !msg.tool_calls &&
            msg.isCascaded &&
            msg.siblingGroupId === groupId &&
            (includeSelf || i !== index)
        );
        return siblings;
    },

    async navigateCascade(currentIndex, direction) {
        const currentMsg = state.currentMessages[currentIndex];
        if (!currentMsg || !currentMsg.isCascaded || !currentMsg.siblingGroupId) return;

        const groupId = currentMsg.siblingGroupId;
        
        const siblingsWithIndices = state.currentMessages
            .map((msg, i) => ({ msg, originalIndex: i }))
            .filter(item => item.msg.siblingGroupId === groupId);

        if (siblingsWithIndices.length <= 1) return;

        const currentPosition = siblingsWithIndices.findIndex(item => item.originalIndex === currentIndex);
        if (currentPosition === -1) return;

        let targetPosition = -1;
        if (direction === 'prev' && currentPosition > 0) {
            targetPosition = currentPosition - 1;
        } else if (direction === 'next' && currentPosition < siblingsWithIndices.length - 1) {
            targetPosition = currentPosition + 1;
        }

        if (targetPosition !== -1) {
            siblingsWithIndices.forEach(item => {
                item.msg.isSelected = false;
            });

            const targetItem = siblingsWithIndices[targetPosition];
            targetItem.msg.isSelected = true;
            const newSelectedIndex = targetItem.originalIndex;

            // UIを再描画し、その後で操作UIを強制的に再表示する
            uiUtils.renderChatMessages();
            
            // requestAnimationFrameを使用して、DOMの更新が完了した後に実行
            requestAnimationFrame(() => {
                const elementToShowActions = elements.messageContainer.querySelector(`.message[data-index="${newSelectedIndex}"]`);
                if (elementToShowActions && !elementToShowActions.classList.contains('editing')) {
                    // 他に表示されているメニューがあれば閉じる
                    const currentlyShown = elements.messageContainer.querySelector('.message.show-actions');
                    if (currentlyShown && currentlyShown !== elementToShowActions) {
                        currentlyShown.classList.remove('show-actions');
                    }
                    // ターゲットのメニューを表示
                    elementToShowActions.classList.add('show-actions');
                }
            });

            await dbUtils.saveChat();
        }
    },

    async confirmDeleteCascadeResponse(indexToDelete) {
        const msgToDelete = state.currentMessages[indexToDelete];
        if (!msgToDelete || msgToDelete.role !== 'model' || !msgToDelete.isCascaded || !msgToDelete.siblingGroupId) {
            return;
        }
        if (state.editingMessageIndex !== null) { await uiUtils.showCustomAlert("編集中は削除できません。"); return; }
        if (state.isSending) { await uiUtils.showCustomAlert("送信中は削除できません。"); return; }
        if (state.isEditingSystemPrompt) { await uiUtils.showCustomAlert("システムプロンプト編集中は削除できません。"); return; }

        const siblings = this.getCascadedSiblings(indexToDelete, true);
        const currentIndexInGroup = siblings.findIndex(m => m === msgToDelete) + 1;
        const totalSiblings = siblings.length;
        const contentPreview = msgToDelete.content.substring(0, 30) + "...";
        const confirmMsg = `この応答 (${currentIndexInGroup}/${totalSiblings})「${contentPreview}」を削除しますか？\n(この応答のみが削除されます)`;

        const confirmed = await uiUtils.showCustomConfirm(confirmMsg);
        if (confirmed) {
            const wasSelected = msgToDelete.isSelected;
            const groupId = msgToDelete.siblingGroupId;

            state.currentMessages.splice(indexToDelete, 1);

            let newlySelectedIndex = -1;
            const remainingSiblingsWithIndices = state.currentMessages
                .map((msg, i) => ({ msg, originalIndex: i }))
                .filter(item => item.msg.role === 'model' && item.msg.isCascaded && item.msg.siblingGroupId === groupId);

            if (remainingSiblingsWithIndices.length > 0) {
                remainingSiblingsWithIndices.forEach(item => { item.msg.isSelected = false; });

                if (wasSelected) {
                    const lastSiblingItem = remainingSiblingsWithIndices[remainingSiblingsWithIndices.length - 1];
                    lastSiblingItem.msg.isSelected = true;
                    newlySelectedIndex = lastSiblingItem.originalIndex;
                } else {
                    const stillSelectedItem = remainingSiblingsWithIndices.find(item => item.msg.isSelected);
                    if (stillSelectedItem) {
                        newlySelectedIndex = stillSelectedItem.originalIndex;
                    } else {
                        const lastSiblingItem = remainingSiblingsWithIndices[remainingSiblingsWithIndices.length - 1];
                        lastSiblingItem.msg.isSelected = true;
                        newlySelectedIndex = lastSiblingItem.originalIndex;
                    }
                }
            }

            uiUtils.renderChatMessages();
            requestAnimationFrame(() => {
                if (newlySelectedIndex !== -1) {
                    const elementToShowActions = elements.messageContainer.querySelector(`.message[data-index="${newlySelectedIndex}"]`);
                    if (elementToShowActions && !elementToShowActions.classList.contains('editing')) {
                        const currentlyShown = elements.messageContainer.querySelector('.message.show-actions');
                        if (currentlyShown && currentlyShown !== elementToShowActions) {
                            currentlyShown.classList.remove('show-actions');
                        }
                        elementToShowActions.classList.add('show-actions');
                    }
                }
            });

            try {
                await dbUtils.saveChat();
            } catch (error) {
                await uiUtils.showCustomAlert("応答削除後のチャット状態の保存に失敗しました。");
            }
        }
    },
    
    // --- ファイルアップロード関連ロジック ---
    async handleFileSelection(fileList) {
        if (!fileList || fileList.length === 0) return;

        const newFiles = Array.from(fileList);
        let addedCount = 0;
        const skippedFiles = {
            duplicate: [],
            size: [],
            totalSize: []
        };

        // 既存ファイルの合計サイズを計算
        let currentTotalSize = state.selectedFilesForUpload.reduce((sum, item) => sum + item.file.size, 0);

        elements.selectFilesBtn.disabled = true;
        elements.selectFilesBtn.textContent = '処理中...';

        for (const file of newFiles) {
            // 個別ファイルサイズチェック
            if (file.size > MAX_FILE_SIZE) {
                skippedFiles.size.push(file.name);
                continue;
            }

            // 合計ファイルサイズチェック
            if (currentTotalSize + file.size > MAX_TOTAL_ATTACHMENT_SIZE) {
                skippedFiles.totalSize.push(file.name);
                continue;
            }

            // 重複ファイルチェック (ファイル名とサイズが両方同じ)
            const isDuplicate = state.selectedFilesForUpload.some(
                existingItem => existingItem.file.name === file.name && existingItem.file.size === file.size
            );
            if (isDuplicate) {
                skippedFiles.duplicate.push(file.name);
                continue;
            }

            // 全てのチェックをパスしたら追加
            state.selectedFilesForUpload.push({ file: file });
            currentTotalSize += file.size;
            addedCount++;
        }

        elements.selectFilesBtn.disabled = false;
        elements.selectFilesBtn.textContent = 'ファイルを選択';

        // スキップされたファイルがあればまとめて通知
        let alertMessage = '';
        if (skippedFiles.duplicate.length > 0) {
            alertMessage += `以下のファイルは既に追加されているためスキップしました:\n- ${skippedFiles.duplicate.join('\n- ')}\n\n`;
        }
        if (skippedFiles.size.length > 0) {
            alertMessage += `以下のファイルはサイズが大きすぎるため(${formatFileSize(MAX_FILE_SIZE)}以下)スキップしました:\n- ${skippedFiles.size.join('\n- ')}\n\n`;
        }
        if (skippedFiles.totalSize.length > 0) {
            alertMessage += `合計サイズ上限(${formatFileSize(MAX_TOTAL_ATTACHMENT_SIZE)})を超えるため、以下のファイルはスキップしました:\n- ${skippedFiles.totalSize.join('\n- ')}\n\n`;
        }

        if (alertMessage) {
            await uiUtils.showCustomAlert(alertMessage.trim());
        }

        uiUtils.updateSelectedFilesUI();
        console.log(`${addedCount}個のファイルが選択リストに新しく追加されました。`);
    },

    

    removeSelectedFile(indexToRemove) {
        if (indexToRemove >= 0 && indexToRemove < state.selectedFilesForUpload.length) {
            const removedFile = state.selectedFilesForUpload.splice(indexToRemove, 1)[0];
            console.log(`ファイル "${removedFile.file.name}" をリストから削除しました。`);
            uiUtils.updateSelectedFilesUI();
        }
    },

    async confirmAttachment() {
        if (state.selectedFilesForUpload.length === 0) {
            state.pendingAttachments = [];
            console.log("添付ファイルリストが空の状態で確定されました。送信待ちリストをクリアします。");
            elements.fileUploadDialog.close('ok');
            uiUtils.adjustTextareaHeight();
            uiUtils.updateAttachmentBadgeVisibility();
            return;
        }

        elements.confirmAttachBtn.disabled = true;
        elements.confirmAttachBtn.textContent = '処理中...';

        const attachmentsToAdd = [];
        let encodingError = false;

        for (const item of state.selectedFilesForUpload) {
            try {
                // 確実なキャッシュ回避のため、一度Base64に変換し、そこから新しいBlobを再生成する
                const base64Data = await this.fileToBase64(item.file);
                const rehydratedBlob = await this.base64ToBlob(base64Data, item.file.type);

                let browserMimeType = item.file.type || '';
                const fileName = item.file.name;
                const fileExtension = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();

                let guessedMimeType = null;
                if (fileExtension && extensionToMimeTypeMap[fileExtension]) {
                    guessedMimeType = extensionToMimeTypeMap[fileExtension];
                }

                let finalMimeType;
                if (guessedMimeType) {
                    finalMimeType = guessedMimeType;
                    if (finalMimeType !== browserMimeType) {
                        console.log(`ファイル "${fileName}": 拡張子(.${fileExtension})からMIMEタイプを "${finalMimeType}" に設定 (ブラウザ提供: ${browserMimeType || '空'})`);
                    }
                } else if (browserMimeType) {
                    finalMimeType = browserMimeType;
                    console.log(`ファイル "${fileName}": ブラウザ提供のMIMEタイプ "${finalMimeType}" を使用します。(拡張子からの推測なし)`);
                } else {
                    finalMimeType = 'application/octet-stream';
                    console.warn(`ファイル "${fileName}": MIMEタイプ不明。拡張子(.${fileExtension})にもマッピングなし。'application/octet-stream' を使用します。`);
                }

                attachmentsToAdd.push({
                    file: rehydratedBlob,
                    name: fileName,
                    mimeType: finalMimeType,
                    base64Data: base64Data
                });
            } catch (error) {
                console.error(`ファイル "${item.file.name}" のBase64エンコード中にエラー:`, error);
                encodingError = true;
                await uiUtils.showCustomAlert(`ファイル "${item.file.name}" の処理中にエラーが発生しました。`);
                break;
            }
        }

        elements.confirmAttachBtn.disabled = false;
        elements.confirmAttachBtn.textContent = '添付して閉じる';

        if (!encodingError) {
            state.pendingAttachments = attachmentsToAdd;
            console.log(`${state.pendingAttachments.length}件のファイルを添付準備完了:`, state.pendingAttachments.map(a => `${a.name} (${a.mimeType})`));
            elements.fileUploadDialog.close('ok');
            uiUtils.adjustTextareaHeight();
            uiUtils.updateAttachmentBadgeVisibility();
        }
    },

    cancelAttachment() {
        state.selectedFilesForUpload = [];
        console.log("ファイル添付をキャンセルしました。");
        elements.fileUploadDialog.close('cancel');
        uiUtils.updateAttachmentBadgeVisibility();
    },

    async callApiWithRetry(apiParams) {
        const { messagesForApi, generationConfig, systemInstruction, tools, isFirstCall } = apiParams;
        let lastError = null;
        const maxRetries = state.settings.enableAutoRetry ? state.settings.maxRetries : 0;
        const forceCalling = state.settings.forceFunctionCalling && isFirstCall;
        
        // state.abortControllerを確実に作成（ユーザーの手動キャンセル用）
        if (!state.abortController) {
            state.abortController = new AbortController();
        }
        
        // タイムアウト設定の取得
        const timeoutEnabled = state.settings.enableApiTimeout || false;
        const timeoutMs = timeoutEnabled ? (state.settings.apiTimeoutSeconds || 90) * 1000 : null;
        
        if (timeoutEnabled) {
            console.log(`[Timeout] APIタイムアウト有効: ${timeoutMs}ms`);
        } else {
            console.log(`[Timeout] APIタイムアウト無効`);
        }

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // このリトライ専用のAbortController
            const attemptController = new AbortController();
            let timeoutId = null;
            
            try {
                if (state.abortController?.signal.aborted) {
                    throw new DOMException("リクエストがキャンセルされました。", "AbortError");
                }

                if (attempt > 0) {
                    let delay;
                    if (state.settings.useFixedRetryDelay) {
                        delay = state.settings.fixedRetryDelaySeconds * 1000;
                    } else {
                        const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        const maxDelay = state.settings.maxBackoffDelaySeconds * 1000;
                        delay = Math.min(exponentialDelay, maxDelay);
                    }

                    uiUtils.setLoadingIndicatorText(`APIエラー 再試行(${attempt}回目)... ${Math.round(delay/1000)}秒待機`);
                    console.log(`API呼び出し失敗。${delay}ms後にリトライします... (試行 ${attempt + 1}/${maxRetries + 1})`);
                    await interruptibleSleep(delay, state.abortController.signal);
                }

                if (attempt === 1) {
                    uiUtils.setLoadingIndicatorText('再試行中...');
                } else if (attempt > 1) {
                    uiUtils.setLoadingIndicatorText(`${attempt}回目の再試行中...`);
                }

                // タイムアウトタイマーの設定
                const startTime = Date.now();
                if (timeoutEnabled && timeoutMs) {
                    timeoutId = setTimeout(() => {
                        const elapsed = Date.now() - startTime;
                        console.warn(`[Timeout] API呼び出しが${elapsed}ms経過。タイムアウト(${timeoutMs}ms)により中断します。`);
                        attemptController.abort();
                    }, timeoutMs);
                }

                const response = await apiUtils.callApi(messagesForApi, generationConfig, systemInstruction, tools, forceCalling, attemptController.signal);

                const getFinishReasonError = (candidate) => {
                    const reason = candidate?.finishReason;
                    if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
                        const error = new Error(`モデルが応答をブロックしました (理由: ${reason})`);
                        error.candidate = candidate; // エラーオブジェクトに詳細情報を添付
                        return error;
                    }
                    return null;
                };

                const checkForSafetyRejection = (candidate, content, toolCalls, images) => {
                    if (content || (toolCalls && toolCalls.length > 0) || (images && images.length > 0)) {
                        return null;
                    }
                    const isNormalFinish = candidate?.finishReason === 'STOP' || candidate?.finishReason === 'MAX_TOKENS';
                    const safetyRatings = candidate?.safetyRatings;
                    const hasHighRiskRating = safetyRatings && safetyRatings.some(r => r.probability === 'HIGH' || r.probability === 'MEDIUM');

                    if (isNormalFinish && hasHighRiskRating) {
                        const highRiskCategories = safetyRatings
                            .filter(r => r.probability === 'HIGH' || r.probability === 'MEDIUM')
                            .map(r => r.category.replace('HARM_CATEGORY_', ''))
                            .join(', ');
                        return new Error(`モデルがコンテンツの生成を拒否しました (理由: ${highRiskCategories})。プロンプトを調整して再試行してください。`);
                    }
                    return null;
                };

                // 非ストリーミングの処理に統一
                const responseData = await response.json();
                
                // タイマークリア（成功時）
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                    const elapsed = Date.now() - startTime;
                    console.log(`[API Call] レスポンス取得成功 (所要時間: ${elapsed}ms)`);
                }
                
                if (responseData.promptFeedback) {
                    const blockReason = responseData.promptFeedback.blockReason || 'SAFETY';
                    throw new Error(`APIが応答をブロックしました (理由: ${blockReason})`);
                }
                if (!responseData.candidates || responseData.candidates.length === 0) {
                    throw new Error("API応答に有効な候補(candidates)が含まれていません。プロンプトがブロックされた可能性があります。");
                }
                
                const candidate = responseData.candidates[0];
                const finishReasonError = getFinishReasonError(candidate);
                if (finishReasonError) throw finishReasonError;

                const parts = candidate.content?.parts || [];
                let finalContent = '';
                let finalThoughtSummary = '';
                let finalToolCalls = [];
                let finalThoughtParts = [];

                parts.forEach(part => {
                    // Thought Signature + Function Call の検出 (Gemini 3の関数呼び出し)
                    // thoughtSignature と functionCall の両方を持つパートのみ特別扱い
                    if (part.thoughtSignature && part.functionCall) {
                        finalThoughtParts.push(part);
                        finalToolCalls.push({ functionCall: part.functionCall });
                    }
                    
                    // Thought Partの検出 (旧形式: thought がオブジェクトの場合)
                    else if (part.thought && part.thought !== true) {
                        finalThoughtParts.push(part);
                    }

                    // テキストコンテンツの処理
                    // thoughtSignatureを持つがfunctionCallを持たないパートもここで処理
                    else if (part.text) {
                        if (part.thought === true) {
                            finalThoughtSummary += part.text;
                        } else {
                            finalContent += part.text;
                        }
                    }
                    
                    // 関数呼び出しの処理（thoughtSignatureを持たない通常のfunctionCall）
                    else if (part.functionCall) {
                        finalToolCalls.push({ functionCall: part.functionCall });
                    }
                });

                // 古い形式のthoughts（candidate.thoughts）の処理
                if (candidate.thoughts?.parts) {
                    candidate.thoughts.parts.forEach(part => {
                        if (part.text) {
                            finalThoughtSummary += part.text;
                        }
                    });
                }
                
                const safetyError = checkForSafetyRejection(candidate, finalContent, finalToolCalls, []);
                if (safetyError) throw safetyError;

                if (!finalContent && finalToolCalls.length === 0) {
                    throw new Error("APIから空の応答が返されました。");
                }

                return {
                    content: finalContent,
                    thoughtSummary: finalThoughtSummary.trim() || null,
                    toolCalls: finalToolCalls.length > 0 ? finalToolCalls : null,
                    thoughtParts: finalThoughtParts.length > 0 ? finalThoughtParts : null, // 追加
                    finishReason: candidate.finishReason,
                    safetyRatings: candidate.safetyRatings,
                    usageMetadata: responseData.usageMetadata,
                    retryCount: attempt
                };

            } catch (error) {
                // タイマークリーンアップ
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }

                lastError = error;
                
                // タイムアウトによるAbortの判定
                if (error.name === 'AbortError' && attemptController.signal.aborted && !state.abortController?.signal.aborted) {
                    // attemptControllerによるAbort = タイムアウト
                    const timeoutError = new Error(`APIタイムアウト: ${timeoutMs}ms以内にレスポンスが返りませんでした。`);
                    timeoutError.isTimeout = true;
                    lastError = timeoutError;
                    console.warn(`[Timeout] タイムアウト検出。エラーとして扱い、リトライ機構に委ねます。`);
                    // continueせずにそのままcatchブロックの末尾へ（= リトライループ継続）
                }
                
                // ユーザーによる手動キャンセル
                if (error.name === 'AbortError' && state.abortController?.signal.aborted) {
                    console.error("待機中または通信中に中断されました。リトライを中止します。", error);
                    throw error;
                }
                
                // 4xx系エラーは即座に終了
                if (error.status && error.status >= 400 && error.status < 500) {
                    console.error(`リトライ不可のエラー (ステータス: ${error.status})。リトライを中止します。`, error);
                    throw error;
                }
                
                console.warn(`API呼び出し/処理試行 ${attempt + 1} が失敗しました。`, error);
                if (error.candidate) {
                    console.error("ブロックされた応答の詳細:", JSON.stringify(error.candidate, null, 2));
                }
            }
        }

        console.error("最大リトライ回数に達しました。最終的なエラーをスローします。");
        throw lastError;
    },

    createRipple(event, button) {
        // 既存のrippleを削除
        const existingRipple = button.querySelector(".ripple");
        if(existingRipple) {
            existingRipple.remove();
        }

        const circle = document.createElement("span");
        const diameter = Math.max(button.clientWidth, button.clientHeight);
        const radius = diameter / 2;

        circle.style.width = circle.style.height = `${diameter}px`;
        
        const rect = button.getBoundingClientRect();
        circle.style.left = `${event.clientX - rect.left - radius}px`;
        circle.style.top = `${event.clientY - rect.top - radius}px`;
        circle.classList.add("ripple");

        button.appendChild(circle);

        // アニメーション終了後に要素を削除
        setTimeout(() => {
            if (circle.parentElement) {
                circle.remove();
            }
        }, 600); // animation-durationと合わせる
    },

    // --- Function Calling用ヘルパー ---
    async updateOpacitySettings(opacitySettings) {
        let settingsChanged = false;
        const changedItems = [];

        if (typeof opacitySettings.overlay === 'number' && opacitySettings.overlay >= 0 && opacitySettings.overlay <= 1) {
            state.settings.overlayOpacity = opacitySettings.overlay;
            await dbUtils.saveSetting('overlayOpacity', state.settings.overlayOpacity);
            document.documentElement.style.setProperty('--overlay-opacity-value', state.settings.overlayOpacity);
            changedItems.push(`オーバーレイの濃さを${Math.round(opacitySettings.overlay * 100)}%に`);
            settingsChanged = true;
        }
        if (typeof opacitySettings.message_bubble === 'number' && opacitySettings.message_bubble >= 0.1 && opacitySettings.message_bubble <= 1) {
            state.settings.messageOpacity = opacitySettings.message_bubble;
            await dbUtils.saveSetting('messageOpacity', state.settings.messageOpacity);
            changedItems.push(`メッセージバブルの濃さを${Math.round(opacitySettings.message_bubble * 100)}%に`);
            settingsChanged = true;
        }

        if (settingsChanged) {
            uiUtils.applySettingsToUI();
            const message = `${changedItems.join('、')}変更しました。`;
            return { success: true, message: message };
        } else {
            return { success: false, message: "有効な値が指定されなかったため、UIは変更されませんでした。" };
        }
    },

    /**
     * Function Callingから受け取ったURLを一時的な背景画像として適用する
     * @param {string} url - 画像のURL
     * @returns {Promise<object>} 処理結果
     */
     async applyBackgroundImageFromUrl(url) {
        if (!url || typeof url !== 'string') {
            return { error: "画像URLが無効です。" };
        }
        console.log(`一時的な背景画像をURLから適用: ${url}`);
        
        // 既存のオブジェクトURLがあれば解放する
        uiUtils.revokeExistingObjectUrl();
        
        // 新しいURLをstateに保存
        state.backgroundImageUrl = url;
        
        const chatScreen = elements.chatScreen;
        const isAlreadyVisible = chatScreen.classList.contains('background-visible');
    
        // フェードアウト完了後に画像を設定してフェードインさせる処理
        const switchImageAndFadeIn = () => {
            document.documentElement.style.setProperty('--chat-background-image', `url("${url}")`);
            chatScreen.classList.add('background-visible');
        };
    
        if (isAlreadyVisible) {
            // 画像が表示されている場合：一度フェードアウトさせてから切り替える
            chatScreen.addEventListener('transitionend', switchImageAndFadeIn, { once: true });
            chatScreen.classList.remove('background-visible');
        } else {
            // 画像がない場合：即座に切り替えてフェードイン
            switchImageAndFadeIn();
        }
        
        // 一時的な背景が適用されたことを示すフラグを立てる
    

        state.isTemporaryBackgroundActive = true;
        
        // サムネイルUIを更新（新しいURLでサムネイルが表示される）
        uiUtils.updateBackgroundSettingsUI();
        
        const message = `背景画像を一時的に変更しました。この変更はリロードするか、設定から背景を再設定すると元に戻ります。`;
        return { success: true, message: message };
    },


    async handleBackgroundImageUrl(url) {
        if (!url || typeof url !== 'string') {
            return { error: "画像URLが無効です。" };
        }

        console.log(`背景画像をURLから取得開始: ${url}`);
        uiUtils.setLoadingIndicatorText('背景画像を取得中...');
        elements.loadingIndicator.classList.remove('hidden');

        try {
            // CORSの問題を回避するため、no-corsモードは使わない。
            // サーバーが許可しない場合はエラーとして扱うのが適切。
            const response = await fetch(url, { referrerPolicy: "no-referrer" });
            if (!response.ok) {
                throw new Error(`画像の取得に失敗しました (HTTPステータス: ${response.status})`);
            }
            const blob = await response.blob();
            
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (blob.size > maxSize) {
                return { error: `画像サイズが大きすぎます (${(maxSize / 1024 / 1024).toFixed(1)}MB以下にしてください)` };
            }

            uiUtils.revokeExistingObjectUrl();
            await dbUtils.saveSetting('backgroundImageBlob', blob);
            state.settings.backgroundImageBlob = blob;
            state.backgroundImageUrl = URL.createObjectURL(blob);
            document.documentElement.style.setProperty('--chat-background-image', `url(${state.backgroundImageUrl})`);
            uiUtils.updateBackgroundSettingsUI();
            
            console.log("背景画像をURLから正常に更新しました。");
            return { success: true, message: "背景画像を更新しました。" };

        } catch (error) {
            console.error("背景画像のURLからの取得エラー:", error);
            // CORSエラーはコンソールに表示されることが多いが、プログラムからは詳細を取得できない場合がある
            if (error instanceof TypeError) { // ネットワークエラーはCORSの可能性が高い
                 return { error: `画像の取得に失敗しました。指定されたURLのサーバーが外部からのアクセスを許可していない(CORSポリシー)可能性があります。` };
            }
            return { error: `画像の取得中にエラーが発生しました: ${error.message}` };
        } finally {
            elements.loadingIndicator.classList.add('hidden');
        }
    },
    async exportProfile() {
        console.log('[Debug Event] exportProfile が呼び出されました。');

        if (!state.activeProfile) {
            return uiUtils.showCustomAlert("エクスポートするプロファイルが選択されていません。");
        }
        
        // stateのデータを汚染しないようにディープコピーする
        const profileToExport = JSON.parse(JSON.stringify(state.activeProfile));
        
        // アイコンBlobがあればBase64に変換して埋め込む
        if (state.activeProfile.icon instanceof Blob) {
            try {
                const base64Icon = await this.fileToBase64(state.activeProfile.icon);
                profileToExport.icon = {
                    mimeType: state.activeProfile.icon.type,
                    data: base64Icon
                };
            } catch (error) {
                console.error("アイコンのBase64変換に失敗:", error);
                return uiUtils.showCustomAlert("アイコンのエクスポート処理に失敗しました。");
            }
        }

        delete profileToExport.id; // DBのIDは不要なので削除

        const jsonString = JSON.stringify(profileToExport, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = profileToExport.name.replace(/[\\/:*?"<>|]/g, '_');
        a.href = url;
        a.download = `${safeName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async importProfile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                if (state.profiles.length >= MAX_PROFILES) {
                    return uiUtils.showCustomAlert(`プロファイルの上限数（${MAX_PROFILES}個）に達しているため、プロファイルをインポートできません。`);
                }
                const importedData = JSON.parse(event.target.result);

                if (!importedData.name || !importedData.settings) {
                    throw new Error("無効なファイルです。'name'と'settings'プロパティが必要です。");
                }

                let newProfile = { ...importedData };
                
                if (newProfile.icon && newProfile.icon.data) {
                    try {
                        newProfile.icon = await this.base64ToBlob(newProfile.icon.data, newProfile.icon.mimeType);
                    } catch (error) {
                        console.error("インポート時のアイコン復元に失敗:", error);
                        newProfile.icon = null;
                    }
                }

                let finalName = newProfile.name;
                const existingNames = state.profiles.map(p => p.name);
                while (existingNames.includes(finalName)) {
                    finalName = `${IMPORT_PREFIX}${finalName}`;
                }
                newProfile.name = finalName;

                const newId = await dbUtils.addProfile(newProfile);
                const newlyAddedProfile = await dbUtils.getProfile(newId);
                state.profiles.push(newlyAddedProfile);
                
                uiUtils.updateProfileSwitcherUI();
                await uiUtils.showCustomAlert(`プロファイル「${finalName}」をインポートしました。`);

            } catch (error) {
                console.error("プロファイルのインポートに失敗:", error);
                await uiUtils.showCustomAlert(`プロファイルのインポートに失敗しました: ${error.message}`);
            }
        };
        reader.readAsText(file);
    },
    updateAssetCount: async function() {
        try {
            const assets = await dbUtils.getAllAssets();
            elements.assetCountDisplay.textContent = `現在 ${assets.length} 枚のアセットが保存されています。`;
        } catch (error) {
            console.error("アセット数の更新に失敗:", error);
            elements.assetCountDisplay.textContent = "アセット数の取得に失敗しました。";
        }
    },

    convertBlobToWebP: function(originalBlob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob((webpBlob) => {
                        if (webpBlob) {
                            console.log(`[WebP Converter] 変換成功: ${originalBlob.size} bytes -> ${webpBlob.size} bytes`);
                            resolve(webpBlob);
                        } else {
                            console.warn("[WebP Converter] WebPへの変換に失敗。元の形式を使用します。");
                            resolve(originalBlob);
                        }
                    }, 'image/webp', 0.9);
                };
                img.onerror = () => {
                    console.error("[WebP Converter] 画像データの読み込み失敗。");
                    resolve(originalBlob);
                };
                img.src = e.target.result;
            };
            reader.onerror = () => {
                console.error("[WebP Converter] FileReader失敗。");
                resolve(originalBlob);
            };
            reader.readAsDataURL(originalBlob);
        });
    },

    handleAssetExport: async function() {
        uiUtils.showProgressDialog('エクスポート準備中...');
        try {
            const assets = await dbUtils.getAllAssets();
            if (assets.length === 0) {
                uiUtils.hideProgressDialog();
                return uiUtils.showCustomAlert("エクスポートするアセットがありません。");
            }

            uiUtils.updateProgressMessage('Zipファイルを生成中...');

            const zip = new JSZip();
            const manifest = [];
            const usedFileNames = new Set();

            const sanitizeFileName = (name) => {
                return name.replace(/[\\/:*?"<>|]/g, '_');
            };

            for (const asset of assets) {
                let baseName = sanitizeFileName(asset.name);
                let fileName = `${baseName}.webp`;
                let count = 1;
                while (usedFileNames.has(fileName)) {
                    count++;
                    fileName = `${baseName}_${count}`;
                }
                usedFileNames.add(fileName);
                
                manifest.push({ asset_name: asset.name, file_name: fileName });
                zip.file(fileName, asset.blob);
            }

            zip.file("manifest.json", JSON.stringify(manifest, null, 2));

            const content = await zip.generateAsync({ type: "blob" });
            
            uiUtils.updateProgressMessage('ファイルをダウンロード中...');
            const a = document.createElement("a");
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
            a.download = `Gemini_PWA_Assets_${date}.zip`;
            a.href = URL.createObjectURL(content);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

        } catch (error) {
            console.error("アセットのエクスポートに失敗:", error);
            await uiUtils.showCustomAlert(`エクスポート中にエラーが発生しました: ${error.message}`);
        } finally {
            uiUtils.hideProgressDialog();
        }
    },

    handleAssetImport: async function(file) {
        if (!file) return;
        if (typeof JSZip === 'undefined') {
            return uiUtils.showCustomAlert("Zip処理ライブラリが読み込まれていません。");
        }

        uiUtils.showProgressDialog('Zipファイルを展開中...');
        console.log(`[Import] インポート処理開始: ${file.name}`);

        try {
            const zip = await JSZip.loadAsync(file);
            const manifestFileEntry = Object.values(zip.files).find(
                entry => !entry.dir && entry.name.endsWith('manifest.json')
            );

            const assetsToImport = [];
            const assetNameMap = new Map();

            if (manifestFileEntry) {
                console.log(`[Import] ${manifestFileEntry.name} を発見。通常モードで処理します。`);
                try {
                    const manifest = JSON.parse(await manifestFileEntry.async("string"));
                    manifest.forEach(item => assetNameMap.set(item.file_name, item.asset_name));
                    console.log(`[Import] manifestから ${assetNameMap.size} 件のアセット定義を読み込みました。`);
                } catch (e) {
                    console.error("[Import] manifest.jsonのパースに失敗しました。", e);
                    await uiUtils.showCustomAlert("manifest.jsonの形式が正しくありません。簡易モードで続行します。");
                }
            } else {
                console.log("[Import] manifest.jsonが見つかりません。簡易モードで処理します。");
            }

            const imageFilePromises = [];
            zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && /\.(webp|png|jpe?g|gif)$/i.test(relativePath)) {
                    const baseName = relativePath.split('/').pop();
                    const assetName = assetNameMap.get(baseName) || baseName.replace(/\.[^/.]+$/, "");
                    console.log(`[Import] ファイルを発見: '${relativePath}' -> アセット名: '${assetName}'`);
                    imageFilePromises.push({ name: assetName, file: zipEntry });
                }
            });

            assetsToImport.push(...imageFilePromises);

            if (assetsToImport.length === 0) {
                uiUtils.hideProgressDialog();
                return uiUtils.showCustomAlert("Zipファイル内にインポート可能な画像が見つかりませんでした。");
            }
            console.log(`[Import] ${assetsToImport.length}件のインポート対象画像をリストアップしました。`);

            let conflictChoice = null;
            let applyToAll = false;
            let importedCount = 0;

            for (let i = 0; i < assetsToImport.length; i++) {
                const item = assetsToImport[i];
                let assetName = item.name;
                uiUtils.updateProgressMessage(`アセットを処理中 (${i + 1}/${assetsToImport.length}): ${assetName}`);

                const existingAsset = await dbUtils.getAsset(assetName);
                
                if (existingAsset) {
                    console.log(`[Import] 競合を検出: アセット「${assetName}」は既に存在します。`);
                    if (!applyToAll) {
                        uiUtils.hideProgressDialog(); // 確認ダイアログ表示のため一時的に隠す
                        const userDecision = await this.showAssetConflictDialog(assetName);
                        uiUtils.showProgressDialog(`アセットを処理中 (${i + 1}/${assetsToImport.length}): ${assetName}`); // 再表示
                        conflictChoice = userDecision.choice;
                        applyToAll = userDecision.applyToAll;
                        console.log(`[Import] ユーザーの選択: ${conflictChoice}, 全てに適用: ${applyToAll}`);
                    }

                    if (conflictChoice === 'skip') {
                        console.log(`[Import] 「${assetName}」をスキップしました。`);
                        continue;
                    }
                    if (conflictChoice === 'rename') {
                        let newName;
                        let count = 2;
                        do {
                            newName = `${assetName} (${count})`;
                            count++;
                        } while (await dbUtils.getAsset(newName));
                        console.log(`[Import] 「${assetName}」の名前を「${newName}」に変更しました。`);
                        assetName = newName;
                    }
                }

                const blob = await item.file.async("blob");
                const webpBlob = await this.convertBlobToWebP(blob);
                
                await assetDB.save({ name: assetName, blob: webpBlob, createdAt: new Date() });
                console.log(`[Import] アセット「${assetName}」をDBに保存しました。`);
                importedCount++;
            }
            
            uiUtils.hideProgressDialog();
            await uiUtils.showCustomAlert(`${importedCount}件のアセットのインポート処理が完了しました。`);
            await this.updateAssetCount();

            if (importedCount > 0) {
                this.markAsDirtyAndSchedulePush(true);
            }

        } catch (error) {
            console.error("アセットのインポートに失敗:", error);
            await uiUtils.showCustomAlert(`インポート中にエラーが発生しました: ${error.message}`);
        } finally {
            uiUtils.hideProgressDialog();
        }
    },


    async openAssetManagementDialog() {
        try {
            const assets = await dbUtils.getAllAssets();
            const container = elements.assetListContainer;
            container.innerHTML = ''; // コンテナをクリア

            if (assets.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">保存されているアセットはありません。</p>';
                elements.assetManagementDialog.showModal();
                return;
            }

            // URLを解放するためのリスト
            const objectUrls = [];

            assets.forEach(asset => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'asset-item';

                const url = URL.createObjectURL(asset.blob);
                objectUrls.push(url); // URLをリストに追加

                const thumbnail = document.createElement('img');
                thumbnail.className = 'asset-thumbnail';
                thumbnail.src = url;
                thumbnail.alt = asset.name;

                const infoDiv = document.createElement('div');
                infoDiv.className = 'asset-info';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'asset-name';
                nameSpan.textContent = asset.name;
                nameSpan.title = asset.name;

                const detailsSpan = document.createElement('span');
                detailsSpan.className = 'asset-details';
                const createdDate = new Date(asset.createdAt).toLocaleString('ja-JP');
                detailsSpan.textContent = `追加日: ${createdDate}`;

                infoDiv.appendChild(nameSpan);
                infoDiv.appendChild(detailsSpan);

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'asset-actions-item';
                
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
                deleteBtn.title = "削除";
                deleteBtn.onclick = () => this.confirmDeleteAsset(asset.name);

                actionsDiv.appendChild(deleteBtn);
                
                itemDiv.appendChild(thumbnail);
                itemDiv.appendChild(infoDiv);
                itemDiv.appendChild(actionsDiv);
                
                container.appendChild(itemDiv);
            });

            // ダイアログが閉じられたらURLを解放するイベントリスナー
            elements.assetManagementDialog.addEventListener('close', () => {
                objectUrls.forEach(url => URL.revokeObjectURL(url));
                console.log(`${objectUrls.length}個のアセット用オブジェクトURLを解放しました。`);
            }, { once: true }); // 一度だけ実行

            elements.assetManagementDialog.showModal();

        } catch (error) {
            console.error("アセット管理ダイアログの表示に失敗:", error);
            await uiUtils.showCustomAlert("アセットの読み込みに失敗しました。");
        }
    },

    // --- Character Profile Dialog Functions ---
    updateCharacterProfileButtonVisibility() {
        const memory = state.currentPersistentMemory || {};
        const hasCharacterData = Object.keys(memory).some(key => key.startsWith('character_memory_'));
        
        elements.characterProfileBtn.disabled = !hasCharacterData;
        if (!hasCharacterData) {
            elements.characterProfileBtn.title = "キャラクターデータがありません";
        } else {
            elements.characterProfileBtn.title = "キャラクタープロファイル";
        }
    },

    async openCharacterProfileDialog() {
        const memory = state.currentPersistentMemory || {};
        const characterKeys = Object.keys(memory).filter(key => key.startsWith('character_memory_'));

        if (characterKeys.length === 0) return;

        // ダイアログの状態をリセット
        elements.characterProfileDialog.classList.remove('details-visible');
        state.characterProfileVisibleCharacter = null;
        elements.characterDetailPane.innerHTML = '';


        const listContainer = elements.characterListPane;
        listContainer.innerHTML = '';
        
        const characterNames = characterKeys.map(key => key.replace('character_memory_', ''));
        
        characterNames.forEach(name => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'profile-character-item';
            itemDiv.textContent = name;
            itemDiv.dataset.characterName = name;
            itemDiv.onclick = () => {
                this.renderCharacterDetails(name);
                // for Mobile
                if (window.innerWidth < 600) {
                    elements.characterProfileDialog.classList.add('details-visible');
                }
            };
            listContainer.appendChild(itemDiv);
        });

        // PC表示の場合のみ、最初のキャラクターをデフォルトで表示する
        if (window.innerWidth >= 600) {
            this.renderCharacterDetails(characterNames[0]);
        }

        elements.characterProfileDialog.showModal();
    },


    renderCharacterDetails(characterName) {
        state.characterProfileVisibleCharacter = characterName;

        // リストのアクティブ表示を更新
        document.querySelectorAll('.profile-character-item').forEach(item => {
            item.classList.toggle('active', item.dataset.characterName === characterName);
        });

        const detailPane = elements.characterDetailPane;
        const memoryKey = `character_memory_${characterName}`;
        const data = state.currentPersistentMemory[memoryKey] || {};

        // 汎用的なフィールド更新関数
        const createFieldUpdater = (fieldPath) => {
            return (event) => {
                const newValue = event.target.value;
                this.handleProfileFieldUpdate(characterName, fieldPath, newValue);
            };
        };

        detailPane.innerHTML = `
            <div class="profile-detail-section">
                <label for="profile-status">状態</label>
                <input type="text" id="profile-status" value="${htmlUtils.escapeAttr(data.status || '')}">
            </div>
            <div class="profile-detail-section">
                <label for="profile-location">現在地</label>
                <input type="text" id="profile-location" value="${htmlUtils.escapeAttr(data.current_location || '')}">
            </div>
            <div class="profile-detail-section">
                <label for="profile-summary">概要</label>
                <textarea id="profile-summary">${htmlUtils.escapeHtml(data.summary || '')}</textarea>
            </div>
            <div class="profile-detail-section">
                <label for="profile-goal">短期目標</label>
                <textarea id="profile-goal">${htmlUtils.escapeHtml(data.short_term_goal || '')}</textarea>
            </div>
            <div class="profile-detail-section">
                <div class="profile-detail-section-header">
                    <label>他キャラクターとの関係</label>
                    <button id="add-relationship-btn" class="add-relationship-btn">＋ 追加</button>
                </div>
                <div id="profile-relationships-grid" class="profile-relationships-grid">
                    ${Object.keys(data.relationships || {}).map((targetName, index) => {
                        const escapedNameHtml = htmlUtils.escapeHtml(targetName);
                        const escapedContext = htmlUtils.escapeHtml(data.relationships[targetName].context || '');
                        const affinity = data.relationships[targetName].affinity || 0;
                        return `
                        <div class="profile-relationship-card" data-rel-index="${index}">
                            <div class="profile-relationship-card-header">
                                <h5>${escapedNameHtml}</h5>
                                <button class="delete-relationship-btn" data-target-name="${htmlUtils.escapeAttr(targetName)}" title="この関係性を削除">
                                    <span class="material-symbols-outlined">delete</span>
                                </button>
                            </div>
                            <label for="affinity-${index}">親密度</label>
                            <input type="number" id="affinity-${index}" value="${affinity}">
                            <label for="context-${index}" style="margin-top:10px;">関係性の文脈</label>
                            <textarea id="context-${index}">${escapedContext}</textarea>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
            <div class="profile-detail-section profile-delete-character-section">
                <button id="delete-character-btn" class="delete-character-btn">
                    <span class="material-symbols-outlined">person_remove</span>
                    このキャラクターを削除
                </button>
            </div>
        `;

        // イベントリスナーを設定
        detailPane.querySelector('#profile-status').addEventListener('blur', createFieldUpdater(['status']));
        detailPane.querySelector('#profile-location').addEventListener('blur', createFieldUpdater(['current_location']));
        detailPane.querySelector('#profile-summary').addEventListener('blur', createFieldUpdater(['summary']));
        detailPane.querySelector('#profile-goal').addEventListener('blur', createFieldUpdater(['short_term_goal']));
        
        detailPane.querySelector('#add-relationship-btn').addEventListener('click', () => this.addRelationship(characterName));
        detailPane.querySelector('#delete-character-btn').addEventListener('click', () => this.confirmDeleteCharacter(characterName)); // 追加

        Object.keys(data.relationships || {}).forEach((targetName, index) => {
            const card = detailPane.querySelector(`.profile-relationship-card[data-rel-index="${index}"]`);
            if (!card) {
                console.warn(`関係性カードが見つかりません: index=${index}, name=${targetName}`);
                return;
            }
            card.querySelector(`#affinity-${index}`).addEventListener('blur', createFieldUpdater(['relationships', targetName, 'affinity']));
            card.querySelector(`#context-${index}`).addEventListener('blur', createFieldUpdater(['relationships', targetName, 'context']));
            card.querySelector('.delete-relationship-btn').addEventListener('click', (e) => {
                const targetNameFromBtn = e.currentTarget.dataset.targetName;
                this.deleteRelationship(characterName, targetNameFromBtn);
            });
        });
    },



    async handleProfileFieldUpdate(characterName, fieldPath, newValue) {
        const memoryKey = `character_memory_${characterName}`;
        const memory = state.currentPersistentMemory[memoryKey];
        if (!memory) return;

        // パスに基づいて値を更新
        let current = memory;
        for (let i = 0; i < fieldPath.length - 1; i++) {
            current = current[fieldPath[i]];
        }
        const finalKey = fieldPath[fieldPath.length - 1];
        
        // affinityは数値に変換
        if (finalKey === 'affinity') {
            newValue = parseInt(newValue, 10) || 0;
        }

        if (current[finalKey] === newValue) return; // 変更がなければ何もしない

        console.log(`Updating profile for ${characterName}: ${fieldPath.join('.')} = ${newValue}`);
        current[finalKey] = newValue;

        try {
            await dbUtils.saveChat();
        } catch (error) {
            console.error("キャラクタープロファイルの自動保存に失敗:", error);
        }
    },

    async addRelationship(characterName) {
        const targetName = await uiUtils.showCustomPrompt("関係を追加する相手のキャラクター名を入力してください:");
        if (!targetName || !targetName.trim()) return;

        const memoryKey = `character_memory_${characterName}`;
        const memory = state.currentPersistentMemory[memoryKey];
        if (!memory) return;
        if (!memory.relationships) memory.relationships = {};

        if (memory.relationships[targetName]) {
            await uiUtils.showCustomAlert(`キャラクター「${targetName}」との関係は既に存在します。`);
            return;
        }

        // 新しい空の関係を追加
        memory.relationships[targetName] = { affinity: 0, context: "" };
        
        try {
            await dbUtils.saveChat();
            // UIを再描画して新しいカードを表示
            this.renderCharacterDetails(characterName);
        } catch (error) {
            console.error("関係性の追加に失敗:", error);
        }
    },

    async deleteRelationship(characterName, targetName) {
        const confirmed = await uiUtils.showCustomConfirm(`「${characterName}」から「${targetName}」への関係性を削除しますか？`);
        if (!confirmed) return;

        const memoryKey = `character_memory_${characterName}`;
        const memory = state.currentPersistentMemory[memoryKey];
        if (memory && memory.relationships && memory.relationships[targetName]) {
            delete memory.relationships[targetName];
            try {
                await dbUtils.saveChat();
                // UIを再描画してカードを消す
                this.renderCharacterDetails(characterName);
            } catch (error) {
                console.error("関係性の削除に失敗:", error);
            }
        }
    },

    async confirmDeleteCharacter(characterName) {
        const confirmed = await uiUtils.showCustomConfirm(`キャラクター「${characterName}」のすべてのデータを削除しますか？\nこの操作は元に戻せません。`);
        if (!confirmed) return;

        const normalizedCharName = normalizeCharacterName(characterName);
        let keyToDelete = null;

        // 正規化された名前で一致するキーを探す
        for (const key in state.currentPersistentMemory) {
            if (key.startsWith('character_memory_')) {
                const existingName = key.replace('character_memory_', '');
                if (normalizeCharacterName(existingName) === normalizedCharName) {
                    keyToDelete = key;
                    break;
                }
            }
        }

        if (keyToDelete && state.currentPersistentMemory[keyToDelete]) {
            delete state.currentPersistentMemory[keyToDelete];
            try {
                await dbUtils.saveChat();
                console.log(`キャラクター「${characterName}」のデータを削除しました。`);
                
                // ダイアログを再オープンしてリストを更新
                this.openCharacterProfileDialog();
                // フローティングボタンの状態も更新
                this.updateCharacterProfileButtonVisibility();

            } catch (error) {
                console.error("キャラクターデータの削除に失敗:", error);
                await uiUtils.showCustomAlert("キャラクターデータの削除に失敗しました。");
            }
        } else {
            console.warn(`削除対象のキャラクター「${characterName}」が見つかりませんでした。`);
        }
    },

    async confirmDeleteAsset(assetName) {
        const confirmed = await uiUtils.showCustomConfirm(`アセット「${assetName}」を削除しますか？\nこの操作は元に戻せません。`);
        if (confirmed) {
            try {
                await assetDB.delete(assetName);
                console.log(`アセット「${assetName}」を削除しました。`);
                
                // UIを再描画
                this.openAssetManagementDialog();
                // 設定画面のカウント表示も更新
                this.updateAssetCount();

            } catch (error) {
                console.error(`アセット「${assetName}」の削除に失敗:`, error);
                await uiUtils.showCustomAlert("アセットの削除に失敗しました。");
            }
        }
    },

    async confirmDeleteAllAssets() {
        const assets = await dbUtils.getAllAssets();
        if (assets.length === 0) {
            await uiUtils.showCustomAlert("削除するアセットはありません。");
            return;
        }

        const confirmed = await uiUtils.showCustomConfirm(`保存されている ${assets.length} 個のすべてのアセットを削除しますか？\nこの操作は元に戻せません。`);
        if (confirmed) {
            try {
                await new Promise((resolve, reject) => {
                    const request = state.db.transaction('image_assets', 'readwrite').objectStore('image_assets').clear();
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
                console.log("すべてのアセットを削除しました。");
                // 併せて image_store の孤児Blobをクリーンアップ
                try {
                    const activeChats = await dbUtils.getAllChats();
                    const activeImageIds = new Set();
                    (activeChats || []).forEach(chat => {
                        (chat.messages || []).forEach(msg => {
                            (msg.imageIds || []).forEach(id => activeImageIds.add(id));
                        });
                    });

                    await new Promise((resolve, reject) => {
                        const tx = state.db.transaction(IMAGE_STORE, 'readwrite');
                        const store = tx.objectStore(IMAGE_STORE);
                        const getAllKeysReq = store.getAllKeys();
                        getAllKeysReq.onsuccess = () => {
                            const keys = getAllKeysReq.result || [];
                            const orphanIds = keys.filter(id => !activeImageIds.has(id));
                            orphanIds.forEach(id => store.delete(id));
                            tx.oncomplete = resolve;
                            tx.onerror = () => reject(tx.error);
                        };
                        getAllKeysReq.onerror = () => reject(getAllKeysReq.error);
                    });
                    console.log("image_store の孤児Blobをクリーンアップしました。");
                } catch (cleanupErr) {
                    console.warn("image_store クリーンアップ中にエラー:", cleanupErr);
                }
                
                // UIを再描画
                this.openAssetManagementDialog();
                // 設定画面のカウント表示も更新
                this.updateAssetCount();

            } catch (error) {
                console.error("すべてのアセットの削除に失敗:", error);
                await uiUtils.showCustomAlert("すべてのアセットの削除に失敗しました。");
            }
        }
    },


    showAssetConflictDialog: function(assetName) {
        return new Promise(resolve => {
            const dialog = elements.assetConflictDialog;
            elements.assetConflictMessage.textContent = `アセット「${assetName}」は既に存在します。どうしますか？`;
            elements.assetConflictApplyAll.checked = false; // チェックボックスをリセット

            const actionArea = dialog.querySelector('.dialog-actions-main');

            const listener = (event) => {
                const button = event.target.closest('button');
                if (!button) return; // ボタン以外がクリックされた場合は何もしない

                const choice = button.value;
                if (choice) {
                    dialog.close(); // ダイアログを閉じる
                    // リスナーを削除
                    actionArea.removeEventListener('click', listener);
                    // 結果を返す
                    resolve({
                        choice: choice,
                        applyToAll: elements.assetConflictApplyAll.checked
                    });
                }
            };
            
            // 既存のリスナーがあれば念のため削除
            // (dialog.close()で消えるはずだが、安全のため)
            const oldListener = actionArea._listener;
            if (oldListener) {
                actionArea.removeEventListener('click', oldListener);
            }

            actionArea.addEventListener('click', listener);
            actionArea._listener = listener; // リスナーを記憶させておく

            dialog.showModal();
        });
    },
    // --- Memory Feature ---
    toggleMemoryOptions(isEnabled) {
        elements.memoryOptionsContainer.classList.toggle('hidden', !isEnabled);
        this.toggleMemoryIconVisibility();
    },

    toggleMemoryIconVisibility() {
        const isMasterEnabled = state.settings.enableMemory;
        elements.memoryToggleBtn.classList.toggle('hidden', !isMasterEnabled);
        if (isMasterEnabled) {
            elements.memoryToggleBtn.classList.toggle('active', state.isMemoryEnabledForChat);
        }
    },

    async toggleChatMemory() {
        state.isMemoryEnabledForChat = !state.isMemoryEnabledForChat;
        this.toggleMemoryIconVisibility();
        // 現在のチャットの状態として保存
        if (state.currentChatId) {
            try {
                await dbUtils.saveChat();
            } catch (error) {
                console.error("チャットごとのメモリ設定の保存に失敗:", error);
            }
        }
    },

    async openMemoryManagementDialog() {
        if (!state.activeProfileId) return;
        try {
            const memoryData = await dbUtils.getMemory(state.activeProfileId);
            this.renderMemoryList(memoryData ? memoryData.items : []);
            elements.memoryManagementDialog.showModal();
        } catch (error) {
            console.error("記憶管理ダイアログの表示に失敗:", error);
            await uiUtils.showCustomAlert("記憶の読み込みに失敗しました。");
        }
    },

    renderMemoryList(memoryItems) {
        elements.memoryListContainer.innerHTML = '';
        if (!memoryItems || memoryItems.length === 0) {
            elements.memoryListContainer.innerHTML = '<p class="no-memory-message">記憶されている項目はありません。</p>';
            return;
        }
        memoryItems.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'memory-item';
            
            const textSpan = document.createElement('span');
            textSpan.className = 'memory-item-text';
            textSpan.textContent = item;
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'memory-item-actions';
            
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
            editBtn.title = "編集";
            editBtn.onclick = () => this.editMemoryItem(index);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
            deleteBtn.title = "削除";
            deleteBtn.onclick = () => this.deleteMemoryItem(index);
            
            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
            itemDiv.appendChild(textSpan);
            itemDiv.appendChild(actionsDiv);
            elements.memoryListContainer.appendChild(itemDiv);
        });
    },

    async addMemoryItem() {
        const newItem = elements.newMemoryInput.value.trim();
        if (!newItem) return;

        try {
            const memoryData = await dbUtils.getMemory(state.activeProfileId) || { items: [] };
            memoryData.items.push(newItem);
            await dbUtils.saveMemory(state.activeProfileId, memoryData);
            this.markAsDirtyAndSchedulePush(true);
            this.renderMemoryList(memoryData.items);
            elements.newMemoryInput.value = '';
        } catch (error) {
            console.error("記憶の追加に失敗:", error);
            await uiUtils.showCustomAlert("記憶の追加に失敗しました。");
        }
    },

    async editMemoryItem(index) {
        try {
            const memoryData = await dbUtils.getMemory(state.activeProfileId);
            if (!memoryData || !memoryData.items || !memoryData.items[index]) return;
            
            const currentItem = memoryData.items[index];
            const newItem = await uiUtils.showCustomPrompt("記憶を編集:", currentItem);

            if (newItem && newItem.trim() !== currentItem) {
                memoryData.items[index] = newItem.trim();
                await dbUtils.saveMemory(state.activeProfileId, memoryData);
                this.markAsDirtyAndSchedulePush(true);
                this.renderMemoryList(memoryData.items);
            }
        } catch (error) {
            console.error("記憶の編集に失敗:", error);
            await uiUtils.showCustomAlert("記憶の編集に失敗しました。");
        }
    },

    async deleteMemoryItem(index) {
        try {
            const memoryData = await dbUtils.getMemory(state.activeProfileId);
            if (!memoryData || !memoryData.items || !memoryData.items[index]) return;

            const itemToDelete = memoryData.items[index];
            const confirmed = await uiUtils.showCustomConfirm(`以下の記憶を削除しますか？\n\n「${itemToDelete}」`);
            
            if (confirmed) {
                memoryData.items.splice(index, 1);
                await dbUtils.saveMemory(state.activeProfileId, memoryData);
                this.markAsDirtyAndSchedulePush(true);
                this.renderMemoryList(memoryData.items);
            }
        } catch (error) {
            console.error("記憶の削除に失敗:", error);
            await uiUtils.showCustomAlert("記憶の削除に失敗しました。");
        }
    },

    async confirmDeleteAllMemory() {
        const memoryData = await dbUtils.getMemory(state.activeProfileId) || { items: [] };
        if (memoryData.items.length === 0) {
            await uiUtils.showCustomAlert("削除する記憶はありません。");
            return;
        }

        const confirmed = await uiUtils.showCustomConfirm(`現在プロファイルに保存されている ${memoryData.items.length} 件の記憶をすべて削除しますか？\nこの操作は元に戻せません。`);
        if (confirmed) {
            try {
                await dbUtils.saveMemory(state.activeProfileId, { items: [] });
                this.markAsDirtyAndSchedulePush(true);
                this.renderMemoryList([]);
            } catch (error) {
                console.error("全記憶の削除に失敗:", error);
                await uiUtils.showCustomAlert("全記憶の削除に失敗しました。");
            }
        }
    },


    async triggerAutoMemorySave() {
        if (!state.activeProfileId || !state.settings.apiKey) {
            console.error("[Memory] APIキーが未設定のため、自動学習をスキップしました。");
            return;
        }

        try {
            const interval = parseInt(state.settings.memoryAutoSaveInterval, 10);
            const userMessagesInInterval = state.currentMessages.filter(m => m.role === 'user').slice(-interval);
            if (userMessagesInInterval.length === 0) {
                return;
            }
            const firstUserMessageIndex = state.currentMessages.indexOf(userMessagesInInterval[0]);
            const historyToSummarize = state.currentMessages.slice(firstUserMessageIndex);

            const conversationText = historyToSummarize.map(msg => {
                return `${msg.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.content}`;
            }).join('\n');

            const memoryData = await dbUtils.getMemory(state.activeProfileId) || { items: [] };
            const existingMemoryText = memoryData.items.length > 0
                ? `- ${memoryData.items.join('\n- ')}`
                : "（まだ何も記憶していません）";

            const summarizationPrompt = `あなたは、私（ユーザー）との会話を分析し、長期的な関係構築のために記憶しておくべき「永続的な個人情報」を抽出するアシスタントです。
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
            
            6.  **重複の完全な排除**: 【既存の記憶】に少しでも関連する内容が既にある場合は、絶対に含めないでください。
            
            7.  **出力形式の厳守**:
                - 抽出した内容は、「ユーザーは〇〇を所有している」「ユーザーは〇〇という考えを持っている」のように、必ず**三人称の客観的な事実**として記述してください。
                - **AIとしての応答（「承知しました」など）や前置き、後書きは一切含めず**、抽出した箇条書きのリスト、または \`[追加情報なし]\` という文字列のみを出力してください。

            ---
            【既存の記憶】
            ${existingMemoryText}
            ---
            【会話履歴】
            ${conversationText}
            ---

            [抽出結果]`;

            const modelForMemory = "gemini-2.5-flash";
            const endpoint = `${GEMINI_API_BASE_URL}${modelForMemory}:generateContent`;
            const requestBody = {
                contents: [{
                    role: 'user',
                    parts: [{ text: summarizationPrompt }]
                }],
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.settings.apiKey },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorData = await response.json();
                const errorMessage = errorData.error?.message || `HTTPエラー: ${response.status}`;
                throw new Error(errorMessage);
            }

            const responseData = await response.json();
            const summaryText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!summaryText) {
                console.warn("[Memory] 自動学習による要約結果が空でした。");
                return;
            }

            if (summaryText.trim() === '[追加情報なし]') {
                console.log("[Memory] AIが追加情報なしと判断したため、メモリの更新をスキップしました。");
                return;
            }

            const newItems = summaryText.split('\n')
                .map(line => line.replace(/^[*-]\s*/, '').trim())
                .filter(line => line.length > 0 && line !== '[追加情報なし]');

            if (newItems.length > 0) {
                const existingItems = new Set(memoryData.items);
                const uniqueNewItems = newItems.filter(item => !existingItems.has(item));
                
                if (uniqueNewItems.length > 0) {
                    memoryData.items.push(...uniqueNewItems);
                    await dbUtils.saveMemory(state.activeProfileId, memoryData);
                    console.log(`[Memory] 自動学習により、${uniqueNewItems.length}件の新しい記憶を追加しました。`, uniqueNewItems);
                } else {
                    console.log("[Memory] 自動学習で生成された記憶は、すべて既存のものでした。");
                }
            }
        } catch (error) {
            console.error("[Memory] 自動学習プロセスの実行中にエラーが発生しました:", error);
        }
    },

    updateSummarizeButtonState() {
        const messageCount = state.currentMessages.length;
        elements.summarizeHistoryBtn.disabled = messageCount < 5;
    },

    applyFloatingPanelBehavior() {
        const behavior = state.settings.floatingPanelBehavior;
        const panel = elements.floatingActionPanel;

        // 既存のタイマーがあればクリア
        clearTimeout(state.panelFadeOutTimer);

        if (behavior === 'always') {
            panel.classList.add('visible');
        } else if (behavior === 'hidden') {
            panel.classList.remove('visible');
        } else { // 'on-click'
            // on-clickの場合は、最初は非表示にしておく
            panel.classList.remove('visible');
        }
    },

    async startSummaryProcess() {
        if (state.isSending || state.editingMessageIndex !== null || state.isEditingSystemPrompt) {
            uiUtils.showCustomAlert("他の処理が完了してから、再度お試しください。");
            return;
        }

        const visibleMessages = this.getVisibleMessages();
        let start = 0;
        let end = visibleMessages.length;

        if (state.currentSummarizedContext && state.currentSummarizedContext.summaryRange) {
            const originalEndIndex = state.currentSummarizedContext.summaryRange.end;
            
            // 要約済み範囲に含まれる表示メッセージの数をカウント
            const summarizedVisibleMessages = visibleMessages.filter(msg => {
                const originalIndex = state.currentMessages.indexOf(msg);
                return originalIndex < originalEndIndex;
            });
            start = summarizedVisibleMessages.length;
        }

        if (end <= start) {
            uiUtils.showCustomAlert("前回から新しい会話履歴がないため、要約する内容がありません。");
            return;
        }

        // フィルタリング後のメッセージリストから要約対象を切り出す
        const messagesToSummarize = visibleMessages.slice(start, end);
        const originalText = messagesToSummarize.map(m => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.content}`).join('\n\n');

        const confirmed = await uiUtils.showCustomConfirm(
            `履歴を要約しますか？\n\n要約を実行すると、対象範囲のメッセージ（${messagesToSummarize.length}件）は編集・削除・再生成ができなくなります。この操作は元に戻せません。`
        );

        if (!confirmed) {
            console.log("要約処理をユーザーがキャンセルしました。");
            return;
        }

        elements.summaryDialog.dataset.originalText = originalText;
        elements.summaryDialog.dataset.summaryRangeStart = start;
        // 終了位置はフィルタリング前の `state.currentMessages` でのインデックスを保存する
        elements.summaryDialog.dataset.summaryRangeEnd = state.currentMessages.length;

        elements.summaryStats.textContent = '要約を生成中です...';
        elements.summaryEditor.value = '';
        elements.summaryEditor.disabled = true;
        elements.summaryRegenerateBtn.disabled = true;
        elements.summaryConfirmBtn.disabled = true;
        elements.summaryDialog.showModal();

        await this._callSummaryApi(originalText);
    },


    async _callSummaryApi(originalText) {
        try {
            const systemInstruction = {
                parts: [{ text: state.settings.summarySystemPrompt }]
            };
            
            const userContent = `【要約対象の会話履歴】\n${originalText}`;

            const requestBody = {
                contents: [{ role: 'user', parts: [{ text: userContent }] }],
                systemInstruction: systemInstruction,
                generationConfig: {
                    temperature: 0.3,
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            };

            const summaryModel = state.settings.summaryModelName || state.settings.modelName;
            console.log("--- [要約API] リクエスト開始 ---");
            console.log("使用モデル:", summaryModel);
            console.log("リクエストボディ:", JSON.stringify(requestBody, null, 2));

            const endpoint = `${GEMINI_API_BASE_URL}${summaryModel}:generateContent`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.settings.apiKey },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: "レスポンスボディのJSONパースに失敗" } }));
                console.error("--- [要約API] APIエラーレスポンス ---");
                console.error("ステータス:", response.status, response.statusText);
                console.error("エラーレスポンスボディ:", errorData);
                throw new Error(errorData.error?.message || `APIエラー: ${response.status}`);
            }

            const responseData = await response.json();

            console.log("--- [要約API] 正常レスポンス ---");
            console.log("レスポンスボディ全体:", JSON.stringify(responseData, null, 2));

            const candidate = responseData.candidates?.[0];
            const summaryText = candidate?.content?.parts?.[0]?.text;

            if (!summaryText) {
                let errorMessage = "APIから有効な要約結果が得られませんでした。";
                const finishReason = candidate?.finishReason;
                const blockReason = responseData.promptFeedback?.blockReason;

                if (finishReason === 'SAFETY' || blockReason) {
                    const reason = finishReason === 'SAFETY' ? 'SAFETY' : blockReason;
                    errorMessage = `生成された要約が安全フィルターにブロックされた可能性があります。(理由: ${reason})`;
                    console.error(`[要約API] ブロック検出: finishReason=${finishReason}, blockReason=${blockReason}`);
                } else if (finishReason) {
                    errorMessage = `APIが予期せぬ理由で応答を終了しました。(理由: ${finishReason})`;
                    console.error(`[要約API] 予期せぬ終了: finishReason=${finishReason}`);
                } else {
                    console.error("[要約API] 応答形式が不正です。テキスト部分が見つかりませんでした。");
                }
                throw new Error(errorMessage);
            }

            this._showSummaryDialog(summaryText, originalText.length);

        } catch (error) {
            console.error("要約API呼び出し/処理中にエラー:", error);
            elements.summaryDialog.close();
            uiUtils.showCustomAlert(`要約の生成に失敗しました: ${error.message}`);
        }
    },


    _showSummaryDialog(summaryText, originalLength) {
        // 統計情報を更新
        const reductionRate = (100 - (summaryText.length / originalLength * 100)).toFixed(1);
        elements.summaryStats.textContent = `原文: ${originalLength.toLocaleString()}文字 → 要約: ${summaryText.length.toLocaleString()}文字 (${reductionRate} %削減)`;
        // テキストエリアに結果を表示し、編集可能にする
        elements.summaryEditor.value = summaryText;
        elements.summaryEditor.disabled = false;
        // ボタンを有効化
        elements.summaryRegenerateBtn.disabled = false;
        elements.summaryConfirmBtn.disabled = false;
        // ダイアログが既に開いていることを確認
        if (!elements.summaryDialog.open) {
            elements.summaryDialog.showModal();
        }
    },

    async regenerateSummary() {
        const originalText = elements.summaryDialog.dataset.originalText;
        if (originalText) {
            // ダイアログを閉じる代わりに、UIをローディング状態に戻す
            elements.summaryStats.textContent = '要約を再生成中です...';
            elements.summaryEditor.value = '';
            elements.summaryEditor.disabled = true;
            elements.summaryRegenerateBtn.disabled = true;
            elements.summaryConfirmBtn.disabled = true;
            
            // APIを再呼び出し
            await this._callSummaryApi(originalText);
        } else {
            uiUtils.showCustomAlert("再生成するための元データが見つかりませんでした。");
        }
    },


    async confirmSummary() {
        const summaryText = elements.summaryEditor.value.trim();
        if (!summaryText) {
            uiUtils.showCustomAlert("要約内容が空です。");
            return;
        }

        const start = parseInt(elements.summaryDialog.dataset.summaryRangeStart, 10);
        const end = parseInt(elements.summaryDialog.dataset.summaryRangeEnd, 10);

        try {
            // 既存の要約と新しい要約を結合する
            const existingSummary = state.currentSummarizedContext ? state.currentSummarizedContext.summaryText : "";
            const newSummaryText = existingSummary ? `${existingSummary}\n\n${summaryText}` : summaryText;

            // state.currentMessagesを上書きせず、summarizedContextオブジェクトを更新する
            state.currentSummarizedContext = {
                summaryText: newSummaryText,
                summaryRange: { start: 0, end: end }, // startは常に0、endを更新
                summarizedAt: Date.now()
            };

            // 変更されたsummarizedContextを含むチャット全体を保存する
            await dbUtils.saveChat();

            elements.summaryDialog.close('confirm');
            
            // UIを再描画してサマリーマーカーを表示させる
            uiUtils.renderChatMessages();
            
            await uiUtils.showCustomAlert(`履歴の要約を保存しました。\n次回以降、APIには要約された内容が送信されます。`);

        } catch (error) {
            console.error("要約の保存エラー:", error);
            await uiUtils.showCustomAlert(`要約の保存に失敗しました: ${error.message}`);
        }
    },




    toggleSummaryButtonVisibility() {
        elements.summarizeHistoryBtn.classList.toggle('hidden', !state.settings.enableSummaryButton);
    },

    showActionPanel() {
        const behavior = state.settings.floatingPanelBehavior;
        const panel = elements.floatingActionPanel;

        // 'always' または 'hidden' の場合は何もしない
        if (behavior === 'always' || behavior === 'hidden') {
            return;
        }

        // 'on-click' の場合の挙動
        clearTimeout(state.panelFadeOutTimer);
        panel.classList.add('visible');
        state.panelFadeOutTimer = setTimeout(() => {
            panel.classList.remove('visible');
        }, 5000); // 5秒後にフェードアウト
    },

    updateScrollButtonsState() {
        const mainContent = elements.chatScreen.querySelector('.main-content');
        if (!mainContent) return;

        const isAtTop = mainContent.scrollTop < 50;
        const isAtBottom = mainContent.scrollHeight - mainContent.scrollTop - mainContent.clientHeight < 50;

        elements.scrollToTopBtn.disabled = isAtTop;
        elements.scrollToBottomBtn.disabled = isAtBottom;
    },

    scrollToTop() {
        const mainContent = elements.chatScreen.querySelector('.main-content');
        if (!mainContent) return;

        const startY = mainContent.scrollTop;
        const endY = 0;
        const distance = endY - startY;
        const duration = 300; // 300ミリ秒で完了
        let startTime = null;

        if (distance === 0) return;

        const step = (currentTime) => {
            if (startTime === null) startTime = currentTime;
            const elapsed = currentTime - startTime;
            const t = Math.min(elapsed / duration, 1);
            // easeOutCubic イージング関数で滑らかな動きに
            const easedT = 1 - Math.pow(1 - t, 3);

            mainContent.scrollTop = startY + (distance * easedT);

            if (elapsed < duration) {
                requestAnimationFrame(step);
            } else {
                // アニメーション終了後、確実に最終位置に設定
                mainContent.scrollTop = endY;
            }
        };

        requestAnimationFrame(step);
    },



    scrollToBottom(force = false) {
        const mainContent = elements.chatScreen.querySelector('.main-content');
        if (!mainContent) return;

        if (!state.settings.autoScroll && !force) {
            return;
        }

        const startY = mainContent.scrollTop;
        const duration = 300; // 300ミリ秒で完了
        let startTime = null;

        const step = (currentTime) => {
            if (startTime === null) startTime = currentTime;
            const elapsed = currentTime - startTime;
            
            // アニメーションの各フレームでscrollHeightを再取得
            const endY = mainContent.scrollHeight - mainContent.clientHeight;
            const distance = endY - startY;

            const t = Math.min(elapsed / duration, 1);
            const easedT = 1 - Math.pow(1 - t, 3);

            mainContent.scrollTop = startY + (distance * easedT);

            if (elapsed < duration) {
                requestAnimationFrame(step);
            } else {
                // アニメーション終了後、その時点での最新のscrollHeightを使って確実に最下部に設定
                mainContent.scrollTop = mainContent.scrollHeight;
            }
        };

        requestAnimationFrame(step);
    },

    /**
     * [V2] 同期用にメタデータとアセットリストを分離して準備する
     * @param {boolean} isManual - 手動実行かどうか
     * @returns {Promise<{metadataJson: string, localAssets: Map<string, {blob: Blob, hash: string}>}>}
     */
     async _prepareExportData() {
        try {
            // ディープコピーの対象を、Blobを含まないメタデータのみに限定する
            const [profiles, chats, memories, allSettings] = await Promise.all([
                dbUtils.getAllProfiles().then(data => JSON.parse(JSON.stringify(data))),
                dbUtils.getAllChats().then(data => JSON.parse(JSON.stringify(data))),
                dbUtils.getAllMemories().then(data => JSON.parse(JSON.stringify(data))),
                new Promise((res, rej) => {
                    const store = dbUtils._getStore(SETTINGS_STORE);
                    const request = store.getAll();
                    request.onsuccess = () => res(JSON.parse(JSON.stringify(request.result)));
                    request.onerror = (e) => rej(e.target.error);
                })
            ]);
            // Blobを含むアセットは、後で直接DBから読み込む
            const imageAssets = await dbUtils.getAllAssets();
            const chatImages = await new Promise((res, rej) => {
                const store = dbUtils._getStore('image_store');
                const request = store.getAll();
                request.onsuccess = () => res(request.result);
                request.onerror = (e) => rej(e.target.error);
            });

            const settingsForExport = allSettings.filter(setting => 
                !['dropboxTokens', 'syncIsDirty', 'syncLastError', 'lastSyncId'].includes(setting.key)
            );

            const localAssets = new Map();
            const addAsset = (assetId, blob) => {
                if (!assetId || !blob) return;
                localAssets.set(assetId, { blob, hash: null });
            };

            for (const profile of profiles) {
                const originalProfile = await dbUtils.getProfile(profile.id);
                if (originalProfile && originalProfile.icon instanceof Blob) {
                    const assetId = `profile_${profile.id}_icon.webp`;
                    addAsset(assetId, originalProfile.icon);
                    profile.iconAssetId = assetId;
                }
                delete profile.icon;
            }
            for (const asset of imageAssets) {
                if (asset.blob) { // Blobが存在することを確認
                    if (!asset.assetId) {
                        const safeName = asset.name.replace(/[^a-zA-Z0-9]/g, '_');
                        asset.assetId = `asset_${safeName}_${new Date(asset.createdAt).getTime()}.webp`;
                        asset._needsUpdate = true;
                    }
                    addAsset(asset.assetId, asset.blob);
                }
            }
            for (const image of chatImages) {
                if (image.id && image.blob) {
                    addAsset(image.id, image.blob);
                }
            }

            console.log("[Data Export V2] チャット履歴内の添付ファイルのアセット化とデータクレンジングを開始します...");
            const blobsToSaveToImageStore = [];

            // DBから直接読み込んだデータを操作し、stateを汚染しないようにする
            const allDbChats = await dbUtils.getAllChats();
            for (const chat of allDbChats) {
                if (chat.messages) {
                    for (const message of chat.messages) {
                        if (message.imageIds && Array.isArray(message.imageIds)) {
                            message.imageIds = message.imageIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
                        }

                        if (message.attachments && message.attachments.length > 0) {
                            const newImageIdsForMessage = [];
                            for (const attachment of message.attachments) {
                                if (!attachment.assetId && attachment.base64Data) {
                                    attachment.assetId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                                    if (!chat._needsUpdate) chat._needsUpdate = true;
                                    
                                    try {
                                        const blob = await this.base64ToBlob(attachment.base64Data, attachment.mimeType);
                                        addAsset(attachment.assetId, blob);
                                        newImageIdsForMessage.push(attachment.assetId);
                                        blobsToSaveToImageStore.push({ id: attachment.assetId, blob: blob });
                                    } catch (e) {
                                        console.error(`[Data Export V2] 新規添付ファイルのアセット化に失敗:`, e);
                                    }
                                } 
                                else if (attachment.assetId) {
                                    const imgData = chatImages.find(img => img.id === attachment.assetId);
                                    if (imgData && imgData.blob) {
                                        addAsset(attachment.assetId, imgData.blob);
                                    } else {
                                        console.warn(`[Data Export V2] 既存アセット(ID: ${attachment.assetId})のBlobがimage_storeに見つかりません。`);
                                    }
                                }
                            }
                            if (newImageIdsForMessage.length > 0) {
                                if (!message.imageIds) message.imageIds = [];
                                message.imageIds.push(...newImageIdsForMessage);
                            }
                        }
                    }
                }
            }
            console.log("[Data Export V2] アセット化とクレンジングが完了しました。");

            if (blobsToSaveToImageStore.length > 0) {
                console.log(`[Data Export V2] ${blobsToSaveToImageStore.length}件の新規アセットBlobをimage_storeに永続化します。`);
                const tx = state.db.transaction('image_store', 'readwrite');
                const store = tx.objectStore('image_store');
                for (const item of blobsToSaveToImageStore) {
                    store.put(item);
                }
            }

            const assetsToUpdate = imageAssets.filter(a => a._needsUpdate);
            if (assetsToUpdate.length > 0) {
                console.log(`[Data Export V2] ${assetsToUpdate.length}件のimage_assetsにassetIdを永続化します。`);
                const tx = state.db.transaction('image_assets', 'readwrite');
                const store = tx.objectStore('image_assets');
                for (const asset of assetsToUpdate) {
                    delete asset._needsUpdate;
                    store.put(asset);
                }
            }
            const chatsToUpdate = allDbChats.filter(c => c._needsUpdate);
            if (chatsToUpdate.length > 0) {
                console.log(`[Data Export V2] ${chatsToUpdate.length}件のチャットにattachmentのassetIdを永続化します。`);
                const tx = state.db.transaction(CHATS_STORE, 'readwrite');
                const store = tx.objectStore(CHATS_STORE);
                for (const chat of chatsToUpdate) {

                    // DBに保存する前にディープコピーを作成し、コピーからbase64Dataを削除する
                    const chatForDb = JSON.parse(JSON.stringify(chat));
                    chatForDb.messages.forEach(msg => {
                        if (msg.attachments) {
                            msg.attachments.forEach(att => delete att.base64Data);
                        }
                    });
                    delete chatForDb._needsUpdate;
                    store.put(chatForDb);

                    // メモリ上のstate.currentMessagesは、base64Dataが削除されていない元のchatオブジェクトで更新する
                    if (chat.id === state.currentChatId) {
                        state.currentMessages = chat.messages;
                    }
                }
            }

            // エクスポート用の `chats` 配列（DBから取得した全チャットデータ）に対して、
            // 添付ファイルのbase64Dataを復元する処理を追加
            for (const chat of chats) {
                if (chat.messages) {
                    for (const message of chat.messages) {
                        if (message.attachments && message.attachments.length > 0) {
                            for (const attachment of message.attachments) {
                                // base64Dataがなく、assetIdがある場合に復元を試みる
                                if (!attachment.base64Data && attachment.assetId) {
                                    const assetBlobData = localAssets.get(attachment.assetId);
                                    if (assetBlobData && assetBlobData.blob) {
                                        try {
                                            // fileToBase64 を使って Blob から Base64 文字列を生成
                                            attachment.base64Data = await this.fileToBase64(assetBlobData.blob);
                                        } catch (e) {
                                            console.error(`[Data Export V2] エクスポート中に assetId: ${attachment.assetId} から base64Data の復元に失敗しました。`, e);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            const syncId = 'sync_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            const metadata = {
                version: "2.0",
                exportedAt: new Date().toISOString(),
                syncId: syncId,
                data: {
                    profiles,
                    chats,
                    memories,
                    assets: imageAssets.map(a => ({ name: a.name, assetId: a.assetId, createdAt: a.createdAt })),
                    settings: settingsForExport
                }
            };

            
            console.log(`[Data Export V2] データ準備完了。syncId: ${syncId}, アセット数: ${localAssets.size}`);

            return {
                metadataJson: JSON.stringify(metadata),
                localAssets: localAssets
            };

        } catch (error) {
            console.error("[Data Export V2] エクスポート準備中にエラー:", error);
            throw new Error("データのエクスポート準備に失敗しました。");
        }
    },





    async importDataFromString(jsonString) {
        console.log("[Data Import V2] 文字列からのデータインポートを開始します。");
        uiUtils.showProgressDialog('インポートデータを準備中...');
    
        try {
            const parsedData = JSON.parse(jsonString);
            if (parsedData.version !== "2.0" || !parsedData.data) {
                throw new Error("インポートデータの形式が無効か、バージョンが古いです。");
            }
            
            const cloudData = parsedData.data;

            const localAssetsBeforeClear = new Map();
            const localImageAssets = await dbUtils.getAllAssets();
            localImageAssets.forEach(asset => {
                if(asset.assetId && asset.blob) localAssetsBeforeClear.set(asset.assetId, asset.blob);
            });
            const localChatImages = await new Promise((res, rej) => {
                const store = dbUtils._getStore('image_store');
                const request = store.getAll();
                request.onsuccess = () => res(request.result);
                request.onerror = (e) => rej(e.target.error);
            });
            localChatImages.forEach(image => {
                if(image.id && image.blob) localAssetsBeforeClear.set(image.id, image.blob);
            });
            console.log(`[Sync Pull] ローカルに存在するアセットBlob: ${localAssetsBeforeClear.size}件をメモリに保持しました。`);

            const requiredAssetIds = new Set();
            (cloudData.profiles || []).forEach(p => { if (p.iconAssetId) requiredAssetIds.add(p.iconAssetId); });
            (cloudData.assets || []).forEach(a => { if (a.assetId) requiredAssetIds.add(a.assetId); });
            (cloudData.chats || []).forEach(c => {
                (c.messages || []).forEach(m => {
                    if (m.imageIds) m.imageIds.forEach(id => { if(id) requiredAssetIds.add(id); });
                });
            });
            console.log(`[Sync Pull] クラウドが必要とするアセットID: ${requiredAssetIds.size}件`);

            const assetsToDownloadIds = [...requiredAssetIds].filter(id => !localAssetsBeforeClear.has(id));
            console.log(`[Sync Pull] ダウンロードが必要なアセットID: ${assetsToDownloadIds.length}件`);

            const downloadedAssets = new Map();
            if (assetsToDownloadIds.length > 0) {
                for (let i = 0; i < assetsToDownloadIds.length; i++) {
                    const assetId = assetsToDownloadIds[i];
                    uiUtils.updateProgressMessage(`アセットをダウンロード中 (${i + 1}/${assetsToDownloadIds.length})`);
                    try {
                        const blob = await window.dropboxApi.downloadAsset(assetId);
                        if (blob) {
                            downloadedAssets.set(assetId, blob);
                        } else {
                            console.warn(`[Sync Pull] アセット(ID: ${assetId})のダウンロードに失敗、またはクラウドに存在しませんでした。`);
                        }
                    } catch (downloadError) {
                        console.error(`[Sync Pull] アセット(ID: ${assetId})のダウンロード中にエラーが発生しました:`, downloadError);
                    }
                }
            }

            // clearAndImportDataからの戻り値を受け取る
            const { removedAssetInfo } = await dbUtils.clearAndImportData(cloudData, localAssetsBeforeClear, downloadedAssets, requiredAssetIds);
    
            console.log("[Data Import V2] データのインポートに成功しました。");
            
            // 戻り値にクレンジング情報とメタデータを両方含める
            return {
                ...parsedData, // syncId, exportedAtなどを含む
                removedAssetInfo: removedAssetInfo // クレンジング情報を追加
            };
    
        } catch (error) {
            console.error("[Data Import V2] インポート処理中にエラーが発生しました:", error);
            uiUtils.hideProgressDialog();
            if (error && error.missingAssetInfo) {
                const detailLines = Object.entries(error.missingAssetInfo)
                    .map(([chatTitle, ids]) => `・${chatTitle}: ${ids.length}件の画像が不足`)
                    .join('\n');
                const message = [
                    "必要な画像アセットが不足しているため同期を中止しました。",
                    "ネットワーク状況またはDropbox上のアセット状態を確認し、再度同期をお試しください。",
                    "不足している画像一覧:",
                    detailLines
                ].join('\n');
                const wrappedError = new Error(message);
                wrappedError.missingAssetInfo = error.missingAssetInfo;
                wrappedError.code = error.code || 'MISSING_ASSETS';
                throw wrappedError;
            }
            throw new Error(`データのインポートに失敗しました: ${error.message}`);
        }
    },


    /**
     * [PKCE] code_verifierを生成する
     * @returns {string} ランダムな文字列
     */
     _generateCodeVerifier() {
        const randomBytes = new Uint8Array(32);
        window.crypto.getRandomValues(randomBytes);
        return btoa(String.fromCharCode.apply(null, randomBytes))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    /**
     * [PKCE] code_verifierからcode_challengeを生成する
     * @param {string} verifier - code_verifier
     * @returns {Promise<string>} SHA-256でハッシュ化されたチャレンジ文字列
     */
    async _generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, new Uint8Array(hashBuffer)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },
    
    async updateDropboxUIState() {
        const tokenData = await dbUtils.getSetting('dropboxTokens');
        const isAuthenticated = tokenData && tokenData.value && tokenData.value.access_token;

        elements.syncStatusHeaderIcon.style.display = isAuthenticated ? 'block' : 'none';
        
        if (isAuthenticated) {
            document.body.classList.add('dropbox-connected');
            elements.dropboxAuthState.classList.add('hidden');
            elements.dropboxConnectedState.classList.remove('hidden');
            
            // 最終同期日時を取得して表示
            const lastSyncSetting = await dbUtils.getSetting('lastSyncTimestamp');
            if (lastSyncSetting && lastSyncSetting.value) {
                const date = new Date(lastSyncSetting.value);
                elements.lastSyncTimeDisplay.textContent = `最終同期: ${date.toLocaleString('ja-JP')}`;
            } else {
                elements.lastSyncTimeDisplay.textContent = `最終同期: なし`;
            }

            try {
                const accountInfo = await window.dropboxApi.testConnection();
                elements.dropboxUserName.textContent = accountInfo.name.display_name;
                this.updateSyncStatusUI(state.sync.isDirty ? 'dirty' : 'idle');
            } catch (error) {
                console.error("Dropboxユーザー情報の取得に失敗:", error);
                elements.dropboxUserName.textContent = '不明なユーザー';
                this.updateSyncStatusUI('error', 'アカウント情報取得失敗');
            }
        } else {
            document.body.classList.remove('dropbox-connected');
            elements.dropboxAuthState.classList.remove('hidden');
            elements.dropboxConnectedState.classList.add('hidden');
            elements.lastSyncTimeDisplay.textContent = ''; // 未連携時は非表示
            this.updateSyncStatusUI('not-connected');
        }
    },

    /**
     * 同期ステータスUIを更新する
     * @param {string} status - 'idle', 'dirty', 'pushing', 'pulling', 'error'
     * @param {string} [message] - 表示するカスタムメッセージ
     */
    updateSyncStatusUI(status, message) {
        console.log(`[Sync UI] updateSyncStatusUI called with status: "${status}", message: "${message || ''}"`);

        if (status === 'error' && message) {
            state.sync.lastError = {
                message: message,
                timestamp: new Date().toISOString()
            };
        }

        const errorDisplay = document.getElementById('sync-error-display');
        const errorMessageEl = document.getElementById('sync-error-message');
        const errorTimestampEl = document.getElementById('sync-error-timestamp');

        if (state.sync.lastError) {
            errorMessageEl.textContent = state.sync.lastError.message;
            errorTimestampEl.textContent = `発生日時: ${new Date(state.sync.lastError.timestamp).toLocaleString('ja-JP')}`;
            errorDisplay.classList.remove('hidden');
        } else {
            errorDisplay.classList.add('hidden');
        }

        const indicators = [
            elements.syncStatusHeaderIcon,
            elements.syncStatusSettingsIcon, // 設定画面のアイコンを追加
            elements.syncProgressText 
        ].filter(Boolean);

        const statusMap = {
            'not-connected': { text: '未連携', icon: 'cloud_off' },
            'idle': { text: '同期済み', icon: 'cloud_done' },
            'dirty': { text: '要同期', icon: 'cloud_upload' },
            'syncing': { text: '同期中...', icon: 'cloud_sync' },
            'error': { text: '同期エラー', icon: 'cloud_alert' }
        };

        const newStatus = statusMap[status] ? status : 'error';
        const statusInfo = statusMap[newStatus];

        indicators.forEach(element => {
            element.dataset.status = newStatus;
            
            if (element.classList.contains('sync-status-header-icon')) { // 共通クラスで判定
                element.textContent = statusInfo.icon;
                element.title = message || statusInfo.text;
            } else if (element.id === 'sync-progress-text') {
                if (newStatus === 'syncing') {
                    element.textContent = `(${message || statusInfo.text})`;
                } else {
                    element.textContent = '';
                }
            }
        });
    },

    // --- Stable Diffusion連携機能の本体ロジック ---
    handleStableDiffusionGeneration: async function(args, responseText = '') {
        if (!state.settings.sdApiUrl) {
            return { error: "Stable Diffusion WebUIのURLが設定されていません。" };
        }

        let currentPrompt = args.prompt;
        let generatedImageBlob = null;
        let qualityCheckResult = null;
        const isQcEnabled = state.settings.sdEnableQualityChecker;
        const maxRetries = isQcEnabled ? (state.settings.sdQcRetries || 0) : 0;

        try {
            for (let i = 0; i <= maxRetries; i++) {
                if (i > 0) {
                    uiUtils.setLoadingIndicatorText(`プロンプト改善中... (${i}/${maxRetries})`);
                    currentPrompt = await this._improveSdPrompt(args.prompt, currentPrompt, qualityCheckResult.reason);
                }
                
                uiUtils.setLoadingIndicatorText('SDで画像生成中...');
                const payload = { ...args, prompt: currentPrompt };
                generatedImageBlob = await this.callStableDiffusionApi(payload);

                if (!isQcEnabled) {
                    break;
                }

                uiUtils.setLoadingIndicatorText('品質チェック中...');
                qualityCheckResult = await this.runQualityChecker(generatedImageBlob, currentPrompt, responseText);

                // runQualityCheckerの実行直後に、その結果をログに出力する
                console.log(`[Quality Check Cycle ${i + 1}/${maxRetries + 1}] 判定: ${qualityCheckResult.result}。理由: ${qualityCheckResult.reason || 'N/A'}`);

                if (qualityCheckResult.result === 'OK') {
                    break; 
                } else {
                    if (i >= maxRetries) {
                        throw new Error(`品質チェックが上限回数(${maxRetries}回)に達しました。最後のNG理由: ${qualityCheckResult.reason}`);
                    }
                }
            }

            const imageId = await this.saveImageBlob(generatedImageBlob);

            return {
                success: true,
                message: "Stable Diffusionによる画像の生成と保存に成功しました。",
                _internal_ui_action: {
                    type: "display_generated_images",
                    imageIds: [imageId]
                },
                meta: { ...args, finalPrompt: currentPrompt, qualityCheckResult }
            };

        } catch (error) {
            console.error("[Stable Diffusion] 画像生成プロセスでエラー:", error);
            return { success: false, error: { message: `画像生成エラー: ${error.message}` } };
        }
    },

        // --- デバッグログUI関連 ---
        toggleDebugLogButtonVisibility(isEnabled) {
            elements.debugLogBtn.classList.toggle('hidden', !isEnabled);
        },
    
        openLogDialog() {
            this.renderLogDialogContent();
            elements.debugLogDialog.showModal();
        },
    
        renderLogDialogContent() {
            const logs = DebugLogger.getLogs();
            const container = elements.logContainer;
            const fragment = document.createDocumentFragment();
            const LOG_TRUNCATE_THRESHOLD = 200; // 省略を開始する文字数
    
            if (logs.length === 0) {
                container.innerHTML = '<div class="log-entry">ログはありません。</div>';
                return;
            }
    
            logs.forEach(log => {
                const entryDiv = document.createElement('div');
                entryDiv.classList.add('log-entry', `log-type-${log.type}`);
    
                const timestampSpan = document.createElement('span');
                timestampSpan.className = 'log-timestamp';
                timestampSpan.textContent = log.timestamp.toLocaleTimeString('ja-JP', { hour12: false });
    
                const typeSpan = document.createElement('span');
                typeSpan.className = 'log-type';
                typeSpan.textContent = `[${log.type}]`;
                
                entryDiv.appendChild(timestampSpan);
                entryDiv.appendChild(typeSpan);
    
                const messageText = log.args.join(' ');
    
                if (messageText.length > LOG_TRUNCATE_THRESHOLD) {
                    entryDiv.classList.add('collapsible');
    
                    const summarySpan = document.createElement('span');
                    summarySpan.className = 'log-summary';
                    summarySpan.textContent = messageText.substring(0, LOG_TRUNCATE_THRESHOLD) + '... (クリックして展開)';
                    
                    const fullSpan = document.createElement('span');
                    fullSpan.className = 'log-full hidden';
                    fullSpan.textContent = messageText;
    
                    entryDiv.appendChild(summarySpan);
                    entryDiv.appendChild(fullSpan);
    
                    entryDiv.addEventListener('click', () => {
                        summarySpan.classList.toggle('hidden');
                        fullSpan.classList.toggle('hidden');
                    });
    
                } else {
                    const messageNode = document.createTextNode(messageText);
                    entryDiv.appendChild(messageNode);
                }
                
                fragment.appendChild(entryDiv);
            });
            
            container.innerHTML = ''; // 一旦クリア
            container.appendChild(fragment);
            // ダイアログを開いたときに最下部にスクロール
            container.scrollTop = container.scrollHeight;
        },
    
    
        clearLogs() {
            DebugLogger.clearLogs();
            this.renderLogDialogContent(); // UIを更新
        },
    
        async copyLogsToClipboard() {
            const logs = DebugLogger.getLogs();
            if (logs.length === 0) {
                await uiUtils.showCustomAlert("コピーするログがありません。");
                return;
            }
            const textToCopy = logs.map(log => {
                const time = log.timestamp.toISOString();
                const message = log.args.join(' ');
                return `${time} [${log.type}] ${message}`;
            }).join('\n');
    
            try {
                await navigator.clipboard.writeText(textToCopy);
                await uiUtils.showCustomAlert("ログをクリップボードにコピーしました。");
            } catch (err) {
                console.error('クリップボードへのコピーに失敗:', err);
                await uiUtils.showCustomAlert("クリップボードへのコピーに失敗しました。");
            }
        },

    async _improveSdPrompt(originalPrompt, failedPrompt, ngReason) {
        const model = state.settings.sdPromptImproveModel;
        const systemPrompt = state.settings.sdPromptImproveSystemPrompt;

        const userPrompt = `元のプロンプト: ${originalPrompt}\n失敗したプロンプト: ${failedPrompt}\n失敗理由: ${ngReason}`;

        const requestBody = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { temperature: 0.5 }
        };

        const endpoint = `${GEMINI_API_BASE_URL}${model}:generateContent`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.settings.apiKey },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`プロンプト改善APIエラー (${response.status})`);

        const data = await response.json();
        const improvedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!improvedPrompt) throw new Error("プロンプト改善APIから有効な応答が得られませんでした。");
        
        console.log("[SD Prompt Improver] 改善されたプロンプト:", improvedPrompt);
        return improvedPrompt;
    },

    runQualityChecker: async function(imageBlob, prompt, responseText = '') {
        const qcModel = state.settings.sdQcModel;
        const qcSystemPrompt = state.settings.sdQcPrompt
            .replace('{prompt}', prompt || '(プロンプトなし)')
            .replace('{response_text}', responseText || '(応答文なし)');
        
        const imageBase64 = await this.fileToBase64(imageBlob);

        const requestBody = {
            contents: [{
                parts: [
                    { text: qcSystemPrompt },
                    { inlineData: { mimeType: 'image/png', data: imageBase64 } }
                ]
            }],
            generationConfig: { temperature: 0.1 }
        };

        const endpoint = `${GEMINI_API_BASE_URL}${qcModel}:generateContent`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.settings.apiKey },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`品質チェックAPIエラー (${response.status})`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (text.includes('Result: OK')) {
            const result = { result: 'OK', reason: '' };
            console.log("[Quality Checker] 判定: OK");
            return result;
        } else {
            const reasonMatch = text.match(/Reason:\s*(.*)/);
            const reason = reasonMatch ? reasonMatch[1].trim() : '理由不明';
            const result = { result: 'NG', reason: reason };
            console.log(`[Quality Checker] 判定: NG。理由: ${reason}`);
            return result;
        }
    },

    callStableDiffusionApi: async function(args) {
        const apiUrl = state.settings.sdApiUrl.trim().replace(/\/$/, '');
        const endpoint = `${apiUrl}/sdapi/v1/txt2img`;

        // advanced_params を分離し、残りを mainArgs として受け取る
        const { advanced_params, ...mainArgs } = args;

        // 1. デフォルト値を設定
        // 2. mainArgs で上書き
        // 3. advanced_params でさらに上書き (これにより、どんなパラメータも渡せる)
        const payload = {
            negative_prompt: "",
            seed: -1,
            steps: 25,
            cfg_scale: 7,
            width: 1024,
            height: 1024,
            ...mainArgs,
            ...advanced_params
        };

        // 必須パラメータのチェック
        if (!payload.prompt) {
            throw new Error("必須パラメータ 'prompt' が指定されていません。");
        }

        // Hires. fixが有効な場合のdenoising_strengthのフォールバック処理
        if (payload.enable_hr === true && payload.denoising_strength === undefined) {
            payload.denoising_strength = 0.7;
            console.log("[Stable Diffusion] Hires. fixが有効ですがdenoising_strengthが未指定のため、デフォルト値の0.7を設定しました。");
        }
        
        // sd_model_checkpoint を override_settings に移動する後処理
        if (payload.sd_model_checkpoint) {
            if (!payload.override_settings) {
                payload.override_settings = {};
            }
            if (!payload.override_settings.sd_model_checkpoint) {
                payload.override_settings.sd_model_checkpoint = payload.sd_model_checkpoint;
            }
            delete payload.sd_model_checkpoint; // トップレベルのキーは削除
        }

        const headers = { 'Content-Type': 'application/json' };
        if (state.settings.sdApiUser && state.settings.sdApiPassword) {
            headers['Authorization'] = 'Basic ' + btoa(`${state.settings.sdApiUser}:${state.settings.sdApiPassword}`);
        }

        console.log("[Stable Diffusion] APIリクエスト送信:", endpoint, payload);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorMsg = `APIエラー (${response.status})`;
            try {
                const errorJson = await response.json();
                errorMsg += `: ${errorJson.detail || JSON.stringify(errorJson)}`;
            } catch (e) { /* ignore */ }
            throw new Error(errorMsg);
        }

        const result = await response.json();
        if (!result.images || result.images.length === 0) {
            throw new Error("APIからの応答に画像データが含まれていませんでした。");
        }

        const base64Image = result.images[0];
        return await this.base64ToBlob(base64Image, 'image/png');
    },



    runQualityChecker: async function(imageBlob, prompt, responseText = '') {
        const qcModel = state.settings.sdQcModel;
        const qcSystemPrompt = state.settings.sdQcPrompt
            .replace('{prompt}', prompt || '(プロンプトなし)')
            .replace('{response_text}', responseText || '(応答文なし)');
        
        const imageBase64 = await this.fileToBase64(imageBlob);

        const requestBody = {
            contents: [{
                parts: [
                    { text: qcSystemPrompt },
                    { inlineData: { mimeType: 'image/png', data: imageBase64 } }
                ]
            }],
            generationConfig: { temperature: 0.1 }
        };

        const endpoint = `${GEMINI_API_BASE_URL}${qcModel}:generateContent`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.settings.apiKey },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`品質チェックAPIエラー (${response.status})`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (text.includes('Result: OK')) {
            return { result: 'OK', reason: '' };
        } else {
            const reasonMatch = text.match(/Reason:\s*(.*)/);
            return { result: 'NG', reason: reasonMatch ? reasonMatch[1] : '理由不明' };
        }
    }

}; // appLogic終了

window.appLogic = appLogic;
window.state = state;
window.dbUtils = dbUtils;