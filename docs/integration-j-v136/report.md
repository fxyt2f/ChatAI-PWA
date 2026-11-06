# J01〜J04 修正・検証報告

2026-11-06。mainと既存の未コミット変更を維持した。commit/push/fetch/ブランチ変更/PR作成は未実施。実ユーザーDB・実APIキー・実サービスアカウントを使用していない。

## J01：旧API移行の原子化

旧API移行がメモリ上のschema/API一覧を保存し、v136本体のトランザクション外から最新設定を巻き戻していた。

`app.js: convertLegacyApiSettingsV136()` はDBから読んだsettings/profilesを入力にする同期変換。既存資格情報・endpoint・API ID・既定モデルを保持し、不足API、候補、ModelRefを補完する。候補補完後に参照を再解決し、旧候補移行済みフラグも尊重する。

`settings-v136.js: ensureSettingsMigrationV136()` のsettings/profiles/chats/image_store readwriteトランザクション内で、最新マーカー確認と上記変換を行う。旧移行3種のマーカー、v136マーカー、必要データを同時に確定する。元プロファイルからバックアップを作り、既存バックアップは置き換えない。マーカー136なら書き戻さずDBの最新値をロードする。

旧 `ensureApiConfigsMigrationV1310()` / `ensureModelRefsMigrationV1312()` / `ensureApiModelCandidatesStabilityV1317()` は同じ原子的処理へ委譲する。`loadProfiles()` もこの処理を呼ぶ。呼出し順だけの変更ではない。

実loadGlobalSettings後、実loadProfiles内のgetAllProfiles入口でB/Cを停止するゲートを必ず通す。Aが移行・実saveApiConfigs・補助ModelRef更新を完了してから再開し、API一覧全体、資格情報、モデル参照、マーカー、バックアップを比較した。2/3タブ、abort/retry、複数回起動、カスタム旧モデルを検証した。

## J02：未記録と無効化済みの署名を区別

既知編集後の旧署名を未設定のまま残し、後の保存が変更後の履歴へ補完していた。

任意フィールド `historyPrefixInvalidV136` / `historyTurnInvalidV136` を追加した。

- 未記録・不明：依存ハッシュなし。displayContent/変更履歴による既存の保守的検査を維持する。
- 比較可能：既存I系ハッシュ、または新しい `historyWireV136` を使って検査する。
- 無効化済み：既知編集に依存し、元の依存情報を持たない旧署名はinvalidフラグを永続化する。通常保存による補完を禁止する。

比較可能な署名の一時的な不一致は元ハッシュを保持し、Undo/候補戻しで実送信内容が戻れば再利用できる。元依存が不明なまま無効化された署名は、通常保存では再有効化しない。署名自体を変更・生成していない。DB/Dropboxバージョンも変更していない。

編集済み旧応答の削除→保存→読込→再保存、複数の後続署名、未変更旧署名、実編集とUndo/Redoを検証した。実Bedrockアダプター最終payloadで、無効署名が含まれないことを確認した。

## J03：実Provider内容に対応する依存情報

変換前baseMessagesのハッシュでは、dummy/summary/実systemの違いを正しく判定できなかった。

`_prepareApiHistory()` を非同期化し、選択中候補だけを処理する。dummy/summaryを適用し、各署名の直前までに実際に採用した履歴をProvider変換して比較する。無効な祖先の継続データを除外した結果も、その後の比較へ反映する。

`_internalHandleSend()` は実送信する履歴と、メモリ等を展開した実systemInstructionから `historyWireV136={version,prefix,turn}` を記録する。toolループは保存時のaggregate単位の依存として保持する。

送信と検証はsettings-v136.js内の同じWorker変換を共有する。BedrockはConverseメッセージ・system、OpenRouter/Z.aiはOpenAI形式のメッセージ・system、Geminiは実contents/systemInstruction（画像専用例外含む）が基準。Bedrock/opaque OpenRouterはprefix、Gemini/Z.aiは独立したuser turnを比較する。時刻/UIメモは対象外。

保存済みtool IDとGemini native IDを使い、対応する結果へ引き継ぐ。ランダムIDによる検証／送信の相違をなくした。対応付け可能なIDがない履歴は、推測して送信せず再生成を求める。

4 Providerの実アダプターpayloadで、dummy有無・3回継続・設定変更、要約の同一/変更、system変更、編集・Undo/Redo、候補切替、保存/読込、native tool IDを検証した。実サービスの受付確認は未実施。

## J04：Workerと内容ベースのキャッシュ

保存・準備のメインスレッドで添付全文の直列化・同期SHAを繰り返していた。

履歴検証／変換を、既存settings-v136.jsから生成するBlob Workerへ移した。外部JS・ライブラリ・ネットワーク依存・シェル資源の追加はない。大文字列とバイナリには実SHA-256を使い、内容・型・順序を含む正規化表現をハッシュする。キャッシュは文字列内容で照合し、オブジェクトの同一性だけでは再利用しない。文字列キャッシュは64M文字上限・1値32M文字まで。変換結果は直近1件。キャッシュは永続化しない。

saveChatは所有者と保存用スナップショットを最初のawait前に確保する。構造操作の旧履歴取得と送信準備はawait前後で所有者・世代相当の状態・中断を確認する。実handleSendのdigest待機中にabort/loadChatを実行し、API送信0件、移動先の不変、元チャットへの保存を確認した。

添付の内容/MIME/順序変更で署名を除外し、時刻/UI属性だけの変更では維持する。読込・再保存、複数添付も検証した。

## 性能

[performance-comparison.md](performance-comparison.md) と [verification-summary.json](verification-summary.json) に全値を保存した。同じWindows隔離Chrome・実saveChat/_prepareApiHistoryで今回再計測した。各ケース間をイベントループで分離し、PerformanceObserverのlongtaskとUIタイマーを測定した。値は単回測定で性能保証の上限ではない。

4MiB Base64の保存同期部分は215.3→2.3ms、保存全体は229.0→11.2ms、履歴準備同期は351.8→1.5ms。20MiBでは882.0→10.3ms、909.1→34.8ms、1734.7→6.3ms。添付なし、1MiB、4MiB、20MiB、4添付の保存・準備専用比較で、修正後の50ms以上のLong Taskは0だった。

この比較は保存・履歴準備区間。別のJ生成回帰では、実アダプター送信、payload JSON、検証用JSON検査も区間に含む。20MiB生成ケースで最大89msのLong Taskを記録しており、全送信処理でLong Taskがゼロとは主張しない。個別CPU内訳は未採取。詳細はverification-summary.jsonのdigestAndGenerationMetricsを参照。

## 競合テストの到達点

I系readyOrDoneは、操作が先に終了したら失敗する方式へ変更した。旧dbUtils/getAllChatsやsaveAppearanceValuesを待つ無効なフックは置換した。

- migration：実ensureSettingsMigrationV136のトランザクション開始前入口。
- cleanup：実cleanupBackgroundAssetsV136入口。
- background：捕捉済みtargetを受けるsaveBackgroundToTargetV136入口。
- J startup：実loadProfiles中のgetAllProfiles入口。旧設定取得後の到達をassert。
- J send：実Worker wireタスクの待機。_prepareApiHistoryと実handleSendの前後の所有者を検証。
- migration abort：実IDBの136マーカーput成功時にabort。マーカー/API/backupのロールバックと再試行を確認。

固定sleepで競合順を作っていない。イベント/Promiseゲートの通過を必須とし、未到達なら成功扱いしない。

## テスト結果

| 最終検証 | 結果 |
|---|---|
| Node各ファイル直接実行 | 69成功、0失敗 |
| run-browser-tests.py --j --ui --sw | 169成功、0失敗（既存134＋J35） |
| 合計 | 238成功、0失敗（既存203＋追加35） |
| responsive / resize / reduced viewport / native input | 263 / 8 / 4 / 60 assertions成功 |
| sidebar/background checks-only | 80 assertions成功 |
| JS構文 / git diff --check | 成功。既存LF→CRLF情報警告のみ |
| SW指紋 | 14資源一致、build 5acc5ef0c1d9ccb177bc |

SWは旧Workerからの更新、不正HTML/JS/CSS/未列挙参照/ネットワーク失敗の拒否、旧Worker・旧キャッシュ保持、2タブ読込み、手動clear、オンライン再起動、HTTPキャッシュ無効化、サーバー/Worker停止後のオフライン起動を確認した。SWアルゴリズムは変更せず生成指紋だけ更新した。

最終ログはverified-node-tests.txt、verified-browser-tests.txt、sidebar-checks.txt。修正前資源に対する初版J24テストは3成功/21失敗。J01の巻戻り、J02復活、J03依存不一致、J04停止を検出した。旧同期版には非同期ゲートがなく、該当検証も失敗する。後で追加した11件は旧版redの件数に含めない。最終版はJ35すべて成功。

途中の候補切替失敗は修正済み。資源変更途中のSW指紋不一致によるNode失敗は、最終指紋更新後に成功した。初回のSettingsV136読込失敗、およびfixtureのCDP受信タイムアウトが発生した。診断付き実行で再発せず、最終ランナーはfixtureの明示的120秒上限に合わせた受信待機と、失敗時テスト名の出力を持つ。環境側の根本原因が特定できたとは扱わない。失敗ログも保持した。

## 変更ファイルと保護

製品はapp.js、settings-v136.js、sw.js（指紋）。UIデザイン変更なし。settings-ui-v136.js/index.html/style.css/CHANGELOG.md/dropbox.jsは開始時ハッシュと一致。

既存テストはintegration-i-peer-v136.html、integration-i-v136.js、review-n-regressions-v136.js、review-regressions-v136.js、run-browser-tests.py、v136-browser.html。非同期呼出し更新と待機点強化を行い、既存テストの削除・無効化は行っていない。追加はintegration-j-v136.js、performance-j-v136.js、run-integration-j-v136.py。

元の2,194ファイルに削除なし。許可した9ファイル以外の開始時ハッシュは一致し、既存の大量画像・ZIP・報告書は変更していない。今回の記録だけをdocs/integration-j-v136へ保存した。

changes.diffは保存した開始時資源6ファイルとfixture3ファイルに対する実差分。その他テストのawait対応、ランナー変更、新規テスト本体は現行ソースも参照する。全保護確認・ハッシュはverification-summary.json、最終Git状態はgit-status.txt。

## 未検証・残る制約

- 実Bedrock/Gemini/OpenRouter/Z.ai、実Dropbox転送、実SDサーバーは未検証。実アダプターpayloadと既存Dropbox形式互換をダミーで検証した。
- 実端末インストールPWA、物理端末の操作、Chrome以外、極端な大規模DBは未検証。
- 既知の手動SW再構築初回cacheClearFailedは原因未特定・診断不足Warningとして維持する。今回の成功を根治の証拠としない。
- 初期から既に破損し、元依存情報もない旧会話を復元するものではない。不明な依存を無効として保持する保守的処理。
- 20MiBはストレス入力。保存・準備の改善と、生成全体に残る直列化/検証コストを区別する。

main・HEADを維持し、すべて未コミット。J01〜J04修正後の独立再レビュー待ち。
