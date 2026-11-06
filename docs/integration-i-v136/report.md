# v1.36.0 最終統合レビュー I01〜I05 修正・検証報告

2026-11-06。作業ブランチ `main`。既存の未コミット変更を保持したまま実装・検証した。commit/push/pull/fetch/merge/rebase/reset/stash/checkout/switch/restore/clean、PR作成は行っていない。既存のユーザーデータ・検証ファイルは削除していない。ブラウザ検証は新規の隔離プロファイル・テスト用DB・ローカルHTTPサーバーを使用した。

## A. 修正結果

| 指摘 | 優先度 | 結果 | 保証する不変条件 |
|---|---|---|---|
| I01 重複移行 | P1 | 修正済み | DBの最新マーカーを確認した書込みトランザクションだけが移行し、遅い移行が通常保存を巻き戻さない |
| I02 背景整理競合 | P1 | 修正済み | 背景Blobと参照を原子的に公開し、整理は同一トランザクション内の最新参照から判断する |
| I03 保存先混同 | P2 | 修正済み | 操作開始時の所有者ID・共通／個別スコープを保存完了まで維持し、削除済み対象を復活させない |
| I04 全体上書き | P2 | 修正済み | 最新プロファイルへのフィールド更新により、他タブが保存した無関係な項目を保持する |
| I05 署名不整合 | P2 | 修正済み | 構造を含む依存履歴の変更を検出し、不整合な継続データを最終APIリクエストへ送らない |

既存150件と追加53件、合計203件が成功した。R01〜R08、N01〜N06の既存テストを削除・無効化せず再実行した。CSS・HTMLは本作業開始時からバイト単位で変更していない。モデル／Thinking・4カテゴリ設定・サイドバー配置・背景統一の既存UIを維持した。

## B. 原因と対策

### I01: 移行の判定と書込みが分離していた

原因は、メモリ上のバージョンとトランザクション外で読んだチャット全体を基に、遅延した移行が再び `put()` していたこと。`settings-v136.js: ensureSettingsMigrationV136()` を settings/profiles/chats/image_store の単一readwriteトランザクションへまとめた。

- 最新の移行マーカーをロック取得後に読み、移行済みなら旧スナップショットを書き戻さない。完了後のstateもDBから更新する。
- プロファイルはDBの最新値、チャットは同じトランザクションのカーソルで取得する。実行設定のないチャットのみ更新し、外で取得したチャット配列は再投入しない。
- バックアップ・設定・プロフィール・チャット・完了マーカーを一緒にcommit/abortする。既存バックアップは上書きしない。

同じDBの重複ストアを含むIDB readwriteトランザクションの排他を利用する。Web Locksやタブ固有のメモリロックには依存せず、トランザクション中にネットワーク等を待たない。

### I02: 参照収集と削除、およびBlobと参照の公開が分離していた

`settings-v136.js: saveBackgroundBlobV136()` は、画像追加と保存先の最新設定への参照パッチを image_store/profiles/settings の同じreadwriteトランザクションで実施する。対象プロファイルが消えていた場合はBlob追加を含めabortする。

`cleanupBackgroundAssetsV136()` は settings/profiles/chats/image_assets/image_store を同時に扱い、最新参照の収集から削除までを一つのreadwriteトランザクションにした。共通背景、無効中でも保持する個別背景、チャットの画像ID／添付、image_assetsの参照を保護し、未参照の `background_` だけを整理する。外部awaitや時間猶予による孤児判定は使わない。

同じ原因の別経路も調べ、以下を修正した。

- `saveGlobalSettingsV136()` と `mutateProfileV136()` の背景ID直接更新でも、Blobの存在確認と参照の書込みを同じトランザクションにした。GC後のIDを公開しない。
- プロファイルインポートは `parseProfileImportV136()` でBlobをDBへ先行公開せず、一時WeakMapに保持する。`addImportedProfileV136()` がBlobと新規プロファイルを一緒に追加する。app.jsの両インポート経路を切り替えた。
- `app.js: dbUtils.addProfile()/updateProfile()` も存在しない背景IDを公開しない。updateは削除済み行を再作成しない。
- 起動時の旧孤児整理、全アセット整理、`dbUtils.deleteChat()` の古い参照走査は `background_` を直接削除せず、上記の原子的整理へ委譲する。
- Dropboxの既存ステージング／昇格処理を確認した。ダウンロードしたBlobをメモリに保持し、既存のインポートトランザクションで昇格する経路は維持した。同期形式は変えていない。

### I03: await後のアクティブプロファイルを保存先にしていた

`settings-v136.js: captureAppearanceTargetV136()` が `{scope, profileId}` を確定する。`saveAppearanceValues()`、`saveBackgroundBlobV136()`、`settings-ui-v136.js` の保存キュー、ファイル入力、URLダウンロード、背景削除は、イベント発生時／fetch開始前に確定した対象を渡す。

切替後もAへの保存を完了し、Bの画面には現在のBの有効背景を描画する。Aが削除済みなら失敗させ、共通設定へのフォールバックやAの再作成は行わない。プロフィール名・非同期アイコン読込み／リセットも同様に元のIDを固定した。追加のトーストや確認ダイアログは導入していない。

### I04: 古いstateからプロファイル全体を保存していた

`settings-v136.js: mutateProfileV136()/patchProfileSettingsV136()` を追加し、readwriteトランザクションで最新行を読み、対象フィールドだけを変更する。theme/appearanceは子項目をマージする。`setProfileOverride()` は同じトランザクションで最新の共通設定も読み、初回オンは共通値コピー、オフは個別値保持、再オンは既存個別値復元とした。空の未初期化オブジェクトも初回扱いする。

保存完了後にDBからstateを再読込みし、DB名で限定したBroadcastChannelで他タブへ通知する。受信側はDBを再読込みしてactive state・有効設定・DOMを更新する。古い非同期再読込みは世代チェックで排除する。編集中の入力値とカーソル位置は保持し、blur後に確定済みDB値を反映する。

関連経路の監査では、`app.js: saveProfileSettingValues()`、`updateCurrentProfile()`、API使用量加算／リセット、旧API設定の不足項目補完、旧API設定同期をフィールド更新へ変更した。中央API設定を持つv136では認証情報保存によるプロフィール全体保存を行わない。現行の実行経路に `dbUtils.updateProfile(...)` の呼出しは残っていない。明示的置換用の関数自体には削除済み行と背景IDの保護を残した。

### I05: 残存本文だけでは履歴の削除を検出できなかった

`settings-v136.js: historyContextV136()/rememberHistoryContextsV136()` と `app.js: _prepareApiHistory()/_internalHandleSend()/dbUtils.saveChat()` を更新した。

- 継続情報へ任意の `historyPrefixV136`／`historyTurnV136` を付加する。システム指示、選択中のメッセージ列、本文、ネイティブ継続ブロック、画像／添付／ツール情報からSHA-256の連鎖を計算する。表示用時刻等は含めず、保存で生じるnull／未定義の差は正規化する。
- BedrockおよびopaqueなOpenRouter継続は履歴prefixを、Gemini/Zaiは対象turnを検証する。削除・編集・置換・候補切替で依存先が変われば継続ブロックを再送しない。独立した後続turnや未変更の有効prefixは維持する。
- 安全に戻せる通常テキスト／画像は既存の可視データから再構築する。ツール専用など安全な再構築ができない履歴は、アダプター送信前にエラーにする。署名文字列そのものを改変・捏造しない。
- 旧継続情報にメタデータがない場合はN01の保守的な本文編集検知を併用し、削除等の構造操作前に現在のコンテキストを記録する。候補兄弟は共通の先行prefixを使い、選択された候補だけが後続prefixを進める。
- 新規応答にはそのリクエストで確定したコンテキストを付ける。配列の非列挙プロパティでリクエストローカルに引き回し、別送信の古いコンテキストを使わない。保存・再読込みでも任意メタデータを維持する。DBバージョンや同期ファイル形式の破壊的変更はない。

公式仕様はAWSの[Converse履歴とreasoning署名](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)、[ReasoningTextBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ReasoningTextBlock.html)、Googleの[thought signatures](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures)、OpenRouterの[reasoning保持](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning)、Z.aiの[thinking mode](https://docs.z.ai/guides/capabilities/thinking-mode)を確認した。AWSでは署名に先行メッセージの不変性が必要であり、Googleでは当該ツールturnのPartと順序を保持する必要がある。各プロバイダーの依存範囲に応じて検証し、全プロバイダーの署名を無条件に破棄する方式は採らなかった。

## C. 修正前後の再現テスト

`tests/integration-i-peer-v136.html` は実IndexedDBを開く独立タブを提供する。`tests/integration-i-v136.js` が制御可能な待機点と実UIイベントで競合を作る。単なる逐次処理／確率的なsleepに依存しない。

修正前の6資源を `before/assets/` に保存し、初期の9ケースを `before/initial-regressions.js` に固定した。修正前は **0成功／9失敗**、修正後は元の9ケースを含む **45成功／0失敗**。前後の入出力は `before-tests.json/.txt`、`after-tests.json/.txt` に保持した。

I01/I02の元の「外で取得したスナップショットを保留して他タブを更新し、再開する」順序は同じ制御関数で実行する。修正後は危険な外部読込み自体がなく、トランザクションが先に完了する場合がある。その場合は完了を観測して同じ他タブ更新を続ける。加えてBlob追加要求の成功時点から別タブGCを開始し、実際のIDBロックにより参照commitまで削除できないことを検証した。消した待機点に後付けの待ち時間を導入していない。

| 指摘 | 修正前の固定再現 | 修正後の追加確認 |
|---|---|---|
| I01 | 遅い移行の間に新しいメッセージを保存すると消える | 2／3タブ、最新プロフィール保持、通常チャット保存保持、マーカー書込み後の強制abort・全体rollback、再試行・再起動、既存バックアップ維持 |
| I02 | 古い参照で整理／Blob先行公開により参照先Blobが消える | Blob追加中の他タブGC、共通＋個別同時更新、同一所有者の並行保存、孤児だけ削除、インポート、直接ID公開、チャット削除経由の古い参照走査、再読込み後の画像デコード |
| I03 | Aで開始してBへ切り替えるとBまたは共通へ誤保存 | B個別オン／オフ、明示共通保存、A削除時abort・復活なし、実ファイル入力キュー、実URLイベントのfetch待機中切替 |
| I04 | 別タブのtemperature／promptを古いoverride保存が巻き戻す | 異なる項目と入れ子項目の並行パッチ、初回オン・オフ・再オン、削除後保存、実BroadcastChannel、DB/state/DOM一致、編集中入力とcaret、名前・非同期アイコン保存 |
| I05 | 先頭／中間／AIメッセージ削除後も依存Bedrock署名を送る | 複数署名、未変更prefix、末尾削除、候補切替と元に戻す操作、選択／非選択候補削除、削除後の新規署名継続、保存再読込み、危険なtool-only拒否、Gemini／OpenRouter／Zaiの最終payload |

Bedrockは実アダプターが構築する最終リクエストを検査した。SDK送信と応答はテスト用スタブであり実API接続ではない。メッセージ削除そのもののUndo/Redo機能は存在しないため該当なし。候補を元に戻した際の有効性と既存N01の本文Undo/Redoは検証した。

## D. 実行した検証

本表は今回実行した結果。以前のテスト成功だけを流用していない。最終本体のSHA-256は `verification-summary.json`、本作業開始時からの差分は `changes.diff` に保存した。

| コマンド | 結果 |
|---|---|
| `python -B tests/run-integration-i-v136.py --phase before` | 期待どおりexit 1、0成功／9失敗。修正前の不具合を再現 |
| `python -B tests/run-integration-i-v136.py --phase after` | exit 0、45成功／0失敗 |
| `node tests/history-context-v136.test.js` | 8成功。SHA-256参照値・永続化の正規化・構造と候補・system prompt・元署名非改変 |
| `node tests/image-capabilities-v136.test.js` | 成功 |
| `node tests/settings-v136.test.js` | 成功 |
| `node tests/sw-clear-cache-v136.test.js` | 成功 |
| `node tests/sw-install-concurrency-v136.test.js` | 成功 |
| `node tests/sw-v136.test.js` | 成功 |
| `node tests/ui-static-v136.test.js` | 成功。上記Node合計69件（既存61＋追加8） |
| `python -B tests/run-browser-tests.py --integration --ui --sw` | 134成功／0失敗（既存89＋追加45）。さらに263レスポンシブ、8リサイズ、4縮小viewport、60ネイティブ入力assertion成功。SWの下記シナリオも成功 |
| `python -B tests/sidebar-background-review.py --phase after --checks-only --output docs/integration-i-v136/sidebar-checks` | 80 assertion成功／0失敗。既存の検証ファイルを上書きせず別出力 |
| `python -B tests/update-shell-integrity.py` | 最終JS変更後に指紋更新 |
| `python -B tests/update-shell-integrity.py --check` | 全14資源一致、build `25360054c988bc277231` |
| `node --check app.js` / `settings-v136.js` / `settings-ui-v136.js` | 構文エラーなし |
| `git diff --check` | 成功。既存LF→CRLFの情報警告のみ |

計203件は69 Node＋134 browserの重複しない件数。追加53件は8 Node＋45 browser。単独after検証、レスポンシブ等のassertion、SWシナリオはこの件数へ重複加算していない。旧データ移行・設定分離・中央API・Thinking・Gemini FC ID・Dropbox新旧形式保存／復元も既存150件の再実行範囲に含む。

SWでは旧Workerからの通常更新、不正HTML/JS/CSS・未列挙参照・ネットワーク失敗の更新候補拒否、旧Workerと旧キャッシュ維持、不正更新後の旧版オフライン起動、2タブ読込み中のシェル再構築、手動再構築、オンライン再起動を検証した。HTTPキャッシュを無効化／削除し、サーバーとWorkerを停止してから1.36.0のオフライン起動も確認した。サーバーログのWinError 10053は不正更新リクエスト取消時の出力で、テスト失敗ではない。

SW本体は整合性マニフェストの生成ブロックだけを更新し、キャッシュ構築／切替アルゴリズムは変更していない。**以前の手動再構築初回 `cacheClearFailed` は原因未特定のWarningを維持する。今回の連続成功を根本原因解消の証拠とはしない。**

## E. 未追跡ファイルと情報監査

件数・容量・カテゴリ別の推奨範囲は [untracked-summary.md](untracked-summary.md)、全パスの一覧は `untracked-audit.json` に記録した。元の画像・ログ・ZIPは削除していない。

`tests/audit-untracked-v136.py` でテキスト、ZIP内の非画像、PNG等のメタデータを走査した。既知のAPIキー形式・秘密鍵・AWSアクセスキー・Dropboxトークン・JWTの一致はない。代入値の候補12件はテスト用ダミーであり、レビュー候補2件もfixture内の旧キー／別キーと確認した。ローカルユーザーパスはブラウザテストのPython例外ログに含まれるため、将来のGit管理から除外するか、元ログを保持したまま匿名化したコピーを使うことを推奨する。

画像1,895ファイルをSHA-256で重複排除した1,543枚すべてにWindows日本語OCRを実行した。エラー0、空認識0、認識文字数779,886（大画像の重複タイル部分を含む）。対象のキー形式・メール・ローカルユーザーパス検出0。認識した本文は保存せず、画像ハッシュ・処理数・検出種別だけを `image-ocr-audit.json` に記録した。既存ZIPの685画像はすべてこのOCR済み画像とハッシュ一致する。画像メタデータからも対象形式は検出されなかった。

既知形式の正規表現・OCRは、任意の個人情報の不存在を保証するものではない。画面は隔離fixture／ダミー設定を用いた検証成果物で、実ユーザーのDBやアカウントは検証に使用していない。Git管理候補は表の推奨に従い選別し、特にフルログや大量中間画像を無選別に追加しない。

## F. 未検証事項・残る制約

- 実Bedrock/Gemini/OpenRouter/Zai APIの課金を伴う送信は未実行。実アダプター最終payloadまで確認した。
- 実Dropboxアカウントとの転送、実SDサーバーへの生成要求は未実行。既存の形式互換テスト・モック送信を実行した。
- 実端末へインストールしたPWA、実タッチ端末／物理キーボード、Chrome以外のブラウザは未検証。隔離Windows Chromeの実IDB・複数タブ・CDP／ネイティブ入力で検証した。
- 手動SW初回失敗の原因は未特定。再発時にはWorker/controllerの状態、message受信先、資源URL、取得／HTTP／digest／cache.putの失敗段階、サーバー側要求ログが必要。
- 古いチャットが既に履歴破損した状態で保存され、継続情報の依存メタデータも残っていない場合、その失われた元履歴は復元できない。以降の構造操作と新規応答には本修正の追跡を適用する。

## G. 最終Git状態

ブランチ `main`。全変更は未コミット。既存のCHANGELOG/dropbox/style/indexを含む変更を保持した。今回style.css/index.htmlの追加編集はなく、ユーザーデータの削除も行っていない。

```text
 M CHANGELOG.md
 M app.js
 M dropbox.js
 M index.html
 M style.css
 M sw.js
?? docs/
?? settings-ui-v136.js
?? settings-v136.js
?? tests/
```

`git-status.txt` にも同じ状態を記録した。修正後の再レビューを待つ状態であり、Gitへの追加・コミット・外部公開はしていない。
