# v1.39.0 第1回 設定画面の構成と設定項目マトリクス

## 作業開始時の状態

`C:\ChatAI-PWA` の `codex/v1.38.3` で作業した。開始時の追跡済み差分は次の3ファイル。既存の未追跡ファイルには、回答メニューの回帰テスト `tests/message_action_menu.py` と過去の検証資料などがあった。

| ファイル | 開始時の差分 | 第1回で加えた差分 |
| --- | --- | --- |
| `app.js` | 編集で置き換えたメッセージを回答メニューが参照し続けられるよう、`messageActionTargets` を追加 | 起動時の履歴照合で旧カテゴリIDを解決。画面に残っていた履歴ソート欄を既存の端末設定保存処理に接続 |
| `sw.js` | 上記修正に対応したシェルビルドIDと `app.js` のハッシュ | 作業開始時の修正を含め、変更後のシェルの整合性情報を再生成 |
| `tests/run-browser-tests.py` | `--message-action-menu` と専用テスト呼び出しを追加 | テスト内のカテゴリ参照を更新し、設定画面のキャプチャ出力先を追加 |

## カテゴリとグループ

カテゴリIDは `index.html` の `data-settings-panel`、グループIDは各パネル直下の `.settings-group` に対応する。

| 一覧の区分 | 新カテゴリ | グループ（表示順） |
| --- | --- | --- |
| AI・会話 | API・モデル (`api-model`) | API設定、モデル設定、通信制御 |
| AI・会話 | プロファイル (`profile`) | プロファイル編集、パラメータ、ダミープロンプト、個別テーマ、個別背景・表示効果 |
| AI・会話 | AI補助機能 (`ai-assistance`) | 思考プロセス・翻訳、校正機能、タイトル自動生成 |
| AI・会話 | メモリ・コンテキスト (`memory-context`) | プロファイルのメモリ機能、共通の記憶抽出、コンテキスト圧縮・要約 |
| AI・会話 | ツール・外部連携 (`tools-integrations`) | Function Calling、検索設定（Google Search）、Google Custom Search、Stable Diffusion、画像クオリティチェッカー |
| AI・会話 | 資料・検索 (`document-search`) | 意味検索・検索モデル |
| アプリ・環境 | チャット操作 (`chat-operation`) | 送信・スクロール・文章整形、画面移動・ヘッダー操作、ストリーミング出力 |
| アプリ・環境 | テーマ・表示 (`appearance`) | 共通テーマ、色設定、背景・表示効果、端末ごとの表示設定 |
| アプリ・環境 | データ・同期 (`data-sync`) | Dropbox、履歴管理、保存済み画像アセット、全データのバックアップ、データ削除 |
| アプリ・環境 | アプリ情報 (`app-info`) | バージョン・更新・リリースノート、開発者向け |

カテゴリは基本案どおり。Thinkingレベルは現在のモデルによって候補が変わるため、モデル選択と同じグループに置いた。フローティングボタンの表示はチャット上の操作パネルの呼び出し方なので、チャット操作の「画面移動・ヘッダー操作」に含めた。意味検索の有効化・モデル選択と、端末での取得・削除は相互に依存するため一つのグループで扱う。後続工程で範囲を表示する場合はグループ内の説明で表現できる。

## 設定項目マトリクス

同じ保存方式と依存関係を持つ操作は一行にまとめた。「対象」は設定値や生成データがDropbox同期に含まれることを示し、端末でのボタン操作やダイアログの開閉はその場の操作として扱う。旧カテゴリは作業開始時点の所属を示す。

保存先の表記

- **G** — IndexedDB `settings.globalSettingsV136`。`settings-v136.js` の `globalKeys`、`saveGlobalSettingsV136`、`saveAppearanceValues` を参照。
- **P** — IndexedDB `profiles` の `settings`。`profileKeys`、`saveProfileSettingValues`、`setProfileOverride` を参照。
- **L** — IndexedDB `settings.localUiSettings`。`app.js` の `DEFAULT_LOCAL_UI_SETTINGS`、`setupLocalUiSettingSave`、`updateLocalUiSetting` を参照。
- **C** — 保存済みチャットの `executionSettings`。新規チャットで履歴が未作成の間は `sessionStorage` の下書き。`setCurrentChatExecution` を参照。

### API・モデル／プロファイル

| 項目 | 旧カテゴリ | 新カテゴリ／グループ | 適用範囲 | Dropbox | 入力・操作 | 保存先・処理 | 条件・依存関係 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API設定の追加・編集・削除・順序 | 一般設定 | API・モデル／API設定 | 共通 | 対象 | 動的カード、上下移動、追加ボタン、編集ダイアログ | `settings.apiConfigs`、`saveApiConfigs`、`reorderApiConfigs`、モデル削除処理 | 候補の削除・無効化は参照状況や他タブ更新を検査 |
| 有効、プロバイダ、表示名 | 一般設定 | API・モデル／API設定 | 共通 | 対象 | ダイアログのチェック、選択、1行入力 | `apiConfigs` の `enabled`、`provider`、`name` | 既存設定のプロバイダ変更制限と編集中の自動保存 |
| APIキー | 一般設定 | API・モデル／API設定 | 共通 | 対象 | マスク付き入力 | `apiConfigs` 内のプロバイダ別接続情報 | 有効な接続設定をモデルの候補に利用 |
| Base URL、モデル候補 | 一般設定 | API・モデル／API設定 | 共通 | 対象 | 1行入力、複数行入力 | `apiConfigs.baseUrl`、`modelCandidates` | 接続先はプロバイダに応じた既定値。候補は共通のモデル選択肢に反映 |
| 旧API名・プロバイダ・各サービスのキー・Bedrock Access Key／Secret Key／Region・OpenRouterモデル入力、API使用量表示・カウントリセット | 一般設定 | API・モデル／API設定 | 接続情報は共通、使用量はプロファイル | API設定・保存済み使用量は対象 | 非表示の互換用入力、候補リスト、リセットボタン | `API_CONFIG_LEGACY_SYNC_KEYS`、`syncDefaultApiConfigFromLegacySettings`、`profiles.apiUsage` | 旧フィールドのコンテナは非表示。使用量および警告は既存の表示制御 |
| 基本モデル | 一般設定 | API・モデル／モデル設定 | チャット | 履歴保存後に対象 | API接続別の動的セレクト、経路表示 | C の `modelRef` | 選択可能なAPI・候補、生成中・初期化中の制限、無効な参照の警告 |
| Thinkingレベル | 一般設定 | API・モデル／モデル設定 | チャット | 履歴保存後に対象 | 動的セレクト | C の `thinkingEffort` | 選択モデルの対応レベル・既定値に依存。生成中・初期化中の制限 |
| 自動リトライ、上限回数、固定待機、待機秒数、指数バックオフ最大秒数 | その他設定 | API・モデル／通信制御 | 共通 | 対象 | チェック、数値入力 | G の `enableAutoRetry`、`maxRetries`、`useFixedRetryDelay`、`fixedRetryDelaySeconds`、`maxBackoffDelaySeconds` | 自動リトライONで詳細表示。固定待機とバックオフの欄を切り替える |
| APIタイムアウト、タイムアウト秒数 | その他設定 | API・モデル／通信制御 | 共通 | 対象 | チェック、数値入力 | G の `enableApiTimeout`、`apiTimeoutSeconds` | ONで秒数欄を表示 |
| 使用プロファイル | プロファイル設定 | プロファイル／プロファイル編集 | 共通の選択状態 | 対象 | PCのポップオーバー／モバイルのダイアログ、検索、項目選択 | `settings.activeProfileId`、`switchProfile` | プロファイル一覧を動的生成。切替後に保存値と個別外観を再反映 |
| 名前変更・アイコン変更／リセット | プロファイル設定 | プロファイル／プロファイル編集 | プロファイル | 対象 | 名前ダイアログ、画像ファイル選択、リセット | `profiles.name`、`profiles.icon`。同期用出力でアイコンをアセット化 | 対象プロファイルに紐付けて保存。リセットはアイコンの有無に依存 |
| 新規保存・削除・取込・出力 | プロファイル設定 | プロファイル／プロファイル編集 | プロファイル | レコードの作成・削除は対象、ファイル操作は端末 | ボタン、名前入力、確認、JSONファイル | `profiles`、プロファイルのインポート／エクスポート | プロファイル数・削除可否など既存制約を適用 |
| システムプロンプト、Max Tokens、Temperature、Top K、Top P | プロファイル設定 | プロファイル／パラメータ | プロファイル（新規チャットの既定値） | 対象 | 複数行・数値入力 | P の `systemPrompt`、`maxTokens`、`temperature`、`topK`、`topP` | 個々のチャットの値はチャット側で管理 |
| ダミーUser・Model、校正にも適用、思考翻訳にも適用、順序入替、回答連結 | プロファイル設定 | プロファイル／ダミープロンプト | プロファイル | 対象 | 複数行入力、チェック | P の `dummyUser`、`dummyModel`、`applyDummyToProofread`、`applyDummyToTranslate`、`reverseDummyOrder`、`concatDummyModel` | ダミー本文と各機能が有効な送信処理で適用 |
| 個別テーマを使用する | プロファイル設定 | プロファイル／個別テーマ | プロファイル | 対象 | チェック | P の `useCustomTheme` | ONで共通テーマを上書きするエディタを表示 |
| 明／暗、色の適用方式、アクセント・ヘッダー背景・ヘッダー文字モードと色・送信ボタン・その他ボタン・ユーザーメッセージの色、各色リセット | プロファイル設定（動的） | プロファイル／個別テーマ | プロファイル | 対象 | セレクト、標準カラーピッカー、リセット | P の `theme`。共通テーマ・色設定から複製した `profile-*` IDを `bindAppearanceEditors` で処理 | 個別テーマON。色の適用方式とヘッダー文字モードに従って有効化 |
| 個別背景・表示効果を使用する | プロファイル設定 | プロファイル／個別背景・表示効果 | プロファイル | 対象 | チェック | P の `useCustomAppearance` | ONで共通の背景・表示効果を上書きするエディタを表示 |
| 背景画像の選択・削除、レイヤー透明度、メッセージ透明度 | プロファイル設定（動的） | プロファイル／個別背景・表示効果 | プロファイル | 対象 | 画像ファイル選択、プレビュー、削除、スライダー | P の `appearance` と背景参照先の `image_store` | 個別背景ON。プレビュー・削除は画像の有無に依存 |

### AI補助機能／メモリ・コンテキスト／ツール・外部連携／資料・検索

| 項目 | 旧カテゴリ | 新カテゴリ／グループ | 適用範囲 | Dropbox | 入力・操作 | 保存先・処理 | 条件・依存関係 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 思考プロセスの表示、思考翻訳、翻訳モデル | 一般設定 | AI補助機能／思考プロセス・翻訳 | 共通 | 対象 | チェック2種、動的モデル選択 | G の `showThoughtProcess`、`enableThoughtTranslation`、`thoughtTranslationModelRef` | 思考データを持つ応答に適用。翻訳には有効な翻訳モデルが必要 |
| 校正の有効化、校正モデル、校正用システムプロンプト | 一般設定 | AI補助機能／校正機能 | 共通 | 対象 | チェック、動的モデル選択、複数行入力 | G の `enableProofreading`、`proofreadingModelRef`、`proofreadingSystemInstruction` | OFFでもモデル・プロンプトを事前編集可。成功した回答と有効モデルが実行条件 |
| タイトル自動生成、生成モデル、生成用プロンプト | 一般設定 | AI補助機能／タイトル自動生成 | 共通 | 対象 | チェック、動的モデル選択、複数行入力 | G の `enableChatTitleGeneration`、`chatTitleModelRef`、`chatTitleSystemPrompt` | 新規チャットの最初のメッセージを利用。有効モデルが必要 |
| メモリ有効化、自動学習間隔 | プロファイル設定 | メモリ・コンテキスト／メモリ機能 | プロファイル | 対象 | チェック、間隔選択（OFF含む） | P の `enableMemory`、`memoryAutoSaveInterval` | 自動学習はメモリON、間隔、抽出モデルに依存 |
| 記憶管理（追加・編集・項目削除・全削除） | プロファイル設定 | メモリ・コンテキスト／メモリ機能 | プロファイル | 対象 | 管理ダイアログ、動的リスト、テキスト、削除確認 | プロファイルID別 `memory_store`、`updateMemoryItems` | 操作中の対象プロファイルと記憶項目を照合 |
| 記憶抽出モデル、抽出プロンプト、初期プロンプトに戻す | プロファイル設定 | メモリ・コンテキスト／記憶抽出 | 共通 | 対象 | 動的モデル選択、複数行入力、リセット | G の `memoryModelRef`、`memoryExtractionPrompt`。専用エディタで保存 | プロファイル選択を問わず編集可。モデル未指定時は自動学習を実行しない |
| 要約ボタン表示、要約モデル、要約システムプロンプト | 一般設定 | メモリ・コンテキスト／コンテキスト圧縮・要約 | 設定は共通、要約結果はチャット | 対象 | チェック、動的モデル選択、複数行入力 | G の `enableSummaryButton`、`summaryModelRef`、`summarySystemPrompt` | ボタン表示と実行用モデルは別。チャット内の要約データに適用 |
| Function Calling、UI変更許可、呼び出し強制 | AI機能・ツール設定 | ツール・外部連携／Function Calling | プロファイル | 対象 | チェック3種 | P の `geminiEnableFunctionCalling`、`allowPromptUiChanges`、`forceFunctionCalling` | モデル能力に依存。Google Searchより優先。UI変更ツールは許可時のみ |
| 従来方式を使用 | AI機能・ツール設定 | ツール・外部連携／Function Calling | 共通 | 対象 | チェック | G の `useLegacyFunctionCalling` | 既存の互換用Function Calling経路選択 |
| Google Search | AI機能・ツール設定 | ツール・外部連携／検索設定 | プロファイル | 対象 | チェック | P の `geminiEnableGrounding` | 対応モデルで使用。Function Callingと同時に送信しない |
| Google Search APIキー、検索エンジンID | 外部連携 | ツール・外部連携／Google Custom Search | 共通 | 対象 | マスク付き入力、1行入力 | G の `googleSearchApiKey`、`googleSearchEngineId` | Function Callingのカスタム検索ツールで利用 |
| API URL、Basic認証ユーザー・パスワード、接続テスト | 外部連携 | ツール・外部連携／Stable Diffusion | 共通 | 保存値は対象、テスト結果は対象外 | 1行・マスク付き入力、テストボタン、結果表示 | G の `sdApiUrl`、`sdApiUser`、`sdApiPassword` | 認証は接続先に応じて入力 |
| 画像クオリティチェッカーON、判定モデル、判定プロンプト、再生成回数、改善モデル、改善指示 | 外部連携 | ツール・外部連携／画像クオリティチェッカー | 共通 | 対象 | チェック、動的モデル選択2種、複数行入力2種、数値入力 | G の `sdEnableQualityChecker`、`sdQcModelRef`、`sdQcPrompt`、`sdQcRetries`、`sdPromptImproveModelRef`、`sdPromptImproveSystemPrompt` | ONで詳細表示。用途別の候補検証とStable Diffusionの生成フローに依存 |
| 意味検索ON、意味検索モデル | その他設定 | 資料・検索／意味検索・検索モデル | 共通 | 対象 | チェック、動的セレクト | `settings.globalOtherSettings` の `documentEmbeddingEnabled`、`documentEmbeddingModel` | 利用にはWebGPUと当該端末のモデルキャッシュが必要。利用不可時はキーワード検索 |
| モデル取得・キャッシュ削除、利用状況 | その他設定 | 資料・検索／意味検索・検索モデル | 端末 | モデル・ベクトルは対象外。取得成功時の有効化設定は対象 | ボタン、確認ダイアログ、状態表示 | Cache Storage、IndexedDBの資料埋め込みストア。`document-embedding.js` の `refresh`、`manage` | WebGPU・キャッシュ有無・処理中の状態でボタン制限。資料参照方式は各チャット・プロジェクト側で管理 |

### チャット操作／テーマ・表示／データ・同期／アプリ情報

| 項目 | 旧カテゴリ | 新カテゴリ／グループ | 適用範囲 | Dropbox | 入力・操作 | 保存先・処理 | 条件・依存関係 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Enter送信、自動スクロール | その他設定 | チャット操作／チャット操作 | 端末 | 対象外 | チェック | L の `enterToSend`、`autoScroll` | チャット入力・メッセージ更新時に適用 |
| 文章整形の有効化 | 一般設定 | チャット操作／チャット操作 | 端末 | 対象外 | チェック | L の `enableTextFormatting` | 整形の詳細はチャットの既存パネルにあり、別の `settings.textFormattingSettings` に保存・同期される |
| スワイプON、右側に表示する画面（ライブラリ・情報管理・設定） | その他設定 | チャット操作／画面移動・ヘッダー操作 | 端末 | 対象外 | チェック | L の `enableSwipeNavigation`、`swipeDestinations` | OFF時は行き先の選択を無効化。行き先の順序とジェスチャー判定を再利用 |
| ヘッダー自動非表示 | その他設定 | チャット操作／画面移動・ヘッダー操作 | 端末 | 対象外 | チェック | L の `headerAutoHide` | PCはポインター、モバイルはタップで再表示 |
| フローティングボタンの表示 | テーマ・表示設定 | チャット操作／画面移動・ヘッダー操作 | 端末 | 対象外 | セレクト | L の `floatingPanelBehavior` | クリック／タップ時表示・常時表示・常時非表示をチャットに適用 |
| ストリーミング出力 | 一般設定 | チャット操作／ストリーミング出力 | 共通 | 対象 | チェック | G の `enableStreamingOutput` | 対応API・実行条件で逐次出力 |
| 明／暗 | テーマ・表示設定 | テーマ・表示／共通テーマ | 共通 | 対象 | セレクト | G の `theme.darkMode` | プロファイル個別テーマで上書き可 |
| 色の適用方式、アクセント色、ヘッダー背景色、ヘッダー文字色方式、ヘッダー文字色、送信ボタン色、その他ボタン色、ユーザーメッセージ色、各色リセット | テーマ・表示設定 | テーマ・表示／色設定 | 共通 | 対象 | セレクト、標準カラーピッカー、リセット | G の `theme`（`themeColorMode`、`accentColor`、`headerColor`、`headerTextColorMode`、`headerTextColor`、`sendButtonColor`、`otherButtonColor`、`userMessageColor`） | 色の適用方式に応じた表示、手動ヘッダー文字色のみ色編集可。個別テーマで上書き可 |
| 背景画像選択・削除、レイヤー透明度、メッセージ透明度 | テーマ・表示設定 | テーマ・表示／背景・表示効果 | 共通 | 対象 | ファイル選択、プレビュー、削除、スライダー | G の `appearance.backgroundAssetId`、`overlayOpacity`、`messageOpacity` と `image_store` | 画像の有無でプレビュー・削除を制御。個別背景・表示効果で上書き可 |
| 文字サイズ、行間、段落間隔、フォント、ワイドモード | テーマ・表示設定 | テーマ・表示／表示設定 | 端末 | 対象外 | セレクト3種、テキスト、チェック | L の `chatFontSize`、`chatLineHeight`、`chatParagraphMarginBottom`、`fontFamily`、`enableWideMode` | フォントは端末に依存。ワイドモードは幅800px以上のチャットに適用 |
| Dropbox App Key | 外部連携 | データ・同期／データ同期 | 共通 | 対象（競合の照合には例外あり） | 1行入力 | G の `dropboxAppKey`、`dropboxApi.setAppKey` | 変更時に再認証が必要な場合あり。既存トークンは別レコード |
| Dropbox連携／解除、今すぐ同期、状態・日時・エラー表示とクリア | 外部連携 | データ・同期／データ同期 | 端末の認証・実行状態 | OAuthトークンと同期管理キーは対象外 | ボタン、OAuth、状態表示 | `settings.dropboxTokens`、`lastSyncTimestamp`、`syncLastError` 等。 `dropbox.js`、`synchronizeDropbox` | 連携の有無、進行・失敗状態に応じて表示切替 |
| 同期競合のバックアップを取り出す | 外部連携 | データ・同期／データ同期 | 端末での出力 | 出力操作は対象外 | ボタン、退避ファイルの取得 | 既存の同期競合ダイアログと退避処理 | 競合による退避データがある場合に取得可 |
| 履歴ソート順 | その他設定 | データ・同期／履歴管理 | 端末 | 対象外 | セレクト | L の `historySortOrder` | 履歴一覧の順序に適用 |
| 履歴の一括削除 | その他設定 | データ・同期／履歴管理 | 選択した履歴 | 保存済み履歴の削除は対象 | ダイアログ、動的な選択一覧・全選択、確認 | `chats` と履歴に従属するレコードの削除処理 | 選択後に更新された履歴や他の資料原本を誤って削除しない既存制御 |
| 保存画像の件数、取込・管理・出力 | その他設定 | データ・同期／保存済み画像アセット | 共通アセット | アセットは対象、ZIP操作は端末 | 件数表示、ZIP、動的管理一覧、個別・全削除、競合時の上書き／スキップ／両方保存と一括適用 | `image_assets`、画像アセットの入出力処理 | 同名ファイル時に競合確認。削除は既存確認を経由 |
| バックアップ保存・ファイルから復元 | その他設定 | データ・同期／全データのバックアップ | アプリの保存データ | ファイルは対象外。復元した同期対象データは同期可能 | ボタン、JSONファイル選択、既存確認 | バックアップ用エクスポート／インポート | 復元前に形式・内容を検証。エクスポート対象は保存処理の既存除外規則に従う |
| 全データクリア | その他設定 | データ・同期／データ削除 | 現在のブラウザのデータ | ローカル初期化操作 | 折りたたみ内のボタンと確認 | `dbUtils.clearAllData` による端末の保存データ初期化 | 初期状態は閉じた状態。操作前に確認 |
| バージョン、リリースノート、GitHub Repository、アプリ更新 | その他設定 | アプリ情報／アプリ情報 | 実行中のアプリ・端末 | 対象外 | 表示、ダイアログ、リンク、更新ボタン | `APP_VERSION`、SWのキャッシュ更新、L の `lastSeenReleaseVersion` | ネットワークとSWの状態に依存 |
| デバッグモード | その他設定 | アプリ情報／開発者向け | 端末 | 対象外 | チェック | L の `debugMode` | 有効時に既存のログ機能を表示・適用 |

### 保存・同期の根拠

- `app.js` の `_prepareExportData` は履歴、プロファイル、設定、アセットと資料・プロジェクトの同期用スナップショットを作成する。`localUiSettings` 本体と旧形式のキー、`dropboxTokens`、同期状態や移行用の一部レコードを除外する。同期の適用側でもローカルキーを置き換えない。文字サイズ、行間、段落間隔、フォント、ワイド表示と、同じレコードにある操作・履歴表示・デバッグ設定は端末の値を維持する。
- `dropboxAppKey` はGに含まれる。初回連携時の空データ比較（`dropboxBootstrapContents`）では除外され、同期マージの `dropbox-sync.js` で両側の値が異なる場合に個別の処理がある。OAuthトークンは `dropbox.js` が別に保存する。
- 共通の意味検索設定は `globalOtherSettings` として含まれる。モデルのキャッシュと資料から生成したベクトルは同期ペイロードに含まれない。Dropboxの説明では、認証情報のうちOAuthトークンと端末のキャッシュを同期対象外と記載する。
- G、P、Cはそれぞれ別の適用範囲。共通テーマとプロファイルのオーバーライドは別々に保存され、テーマと背景の上書きも独立。未保存チャットのモデル・Thinking下書きは端末のセッションに留まり、履歴作成後にチャットの一部として同期する。

## ナビゲーションと第2回への引き継ぎ

- `CategoryPane` の800px切り替え、詳細の履歴、戻る、カテゴリ別の縦スクロール、サイドバー開閉を利用する。「AI・会話」と「アプリ・環境」は同じナビ内の見出しで、どのカテゴリにも一覧から直接アクセスできる。既存のPC既定表示は旧一般設定の主項目を引き継ぐ「API・モデル」。
- 旧ハッシュと履歴のカテゴリ値は `general → api-model`、`ai-tools → tools-integrations`、`integrations → data-sync`、`other → chat-operation` へ解決する。旧外部連携の先頭項目はDropbox、旧その他設定の端末で頻繁に使う操作はチャット操作にまとまる。旧 `profile` と `appearance` はそのまま使える。
- 第2回はパネル直下の `.settings-group` を単位にスタイリングできる。グループのIDと中の入力IDを維持し、`prepareSettingsLayout`、モデル候補生成、プロファイル用外観の複製、エラー表示を起点に扱う。個別テーマは共通テーマと色のDOM、個別背景は共通背景のDOMをそれぞれ複製するため、行構造を変えたときは共通・個別を両方確認する。
- 情報管理とライブラリは独立画面。資料の参照モードや、情報管理内のキャラクター・シナリオ・要約データの管理は、それぞれの画面で扱う。

## 第1回の検証記録

- 変更前後の設定HTMLで、ナビゲーションを除くボタン・入力・選択肢・ラベル・リンク・折りたたみの287要素を比較し、タグと属性の保持を確認。UI静的検証4件、設定の単体検証35件、シェル33アセットの整合性検証も通過。
- 隔離Chromeで、PC・モバイルの遷移、旧カテゴリのURLと履歴、カテゴリ別スクロール、設定の自動保存と再読み込み、共通・個別テーマ、API設定、記憶抽出、プロファイル切り替え、情報管理、スワイプ、リリースノートを確認。作業開始前の回答メニュー修正も専用の回帰テストが通過。
- リリースノートとスワイプの対象テストは通過。共通ハーネス後段の「atomic chat/success save rolls back on transaction abort」は作業ツリーと変更前のHEADで同じアサーションが失敗した。実機、実アカウントでのDropbox同期、実API・WebGPUモデルの取得は今回の検証範囲外。
- `screenshots/` にPCとモバイルの設定トップおよび「テーマ・表示」を保存。外部URLを遮断したテスト環境のため、一部のアイコンはリガチャの文字で表示される。
