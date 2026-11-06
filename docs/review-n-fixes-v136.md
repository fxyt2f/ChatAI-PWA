# ChatAI PWA v1.36.0 — N01〜N06 修正報告

2026-11-06。R01〜R08修正後を作業開始点とし、既存の未コミット変更を保持した。`main` のままで、commit / push / pull / merge / rebase / reset / stash / checkout / switch / restore / clean / PR作成は実行していない。ユーザーによる再レビュー待ちであり、リリース完了ではない。

## A. 修正結果

| 指摘 | 結果 | 対応の要点 |
| --- | --- | --- |
| N01 / P1 | 修正済み | Bedrock署名の再利用を先行履歴の変更位置から判定し、影響する後続の継続データを送信時だけ再構築する。 |
| N02 / P1 | 修正済み | 通常installと手動再構築で共通の全資源検証を行い、検証済み候補のみを昇格する。 |
| N03 / P2 | 修正済み | 参照中のキャッシュを保護し、旧ポインターでの取得失敗は最新ポインターへ有限回で復旧する。 |
| N04 / P2 | 修正済み | API一覧取得と対象モデル確認を分離。空・欠落・失敗後に通常再送で再取得し、同時取得を共有する。 |
| N05 / P2 | 修正済み | 別タブのglobalイベントで全共通フォームを同期し、現在入力中の欄とフォーカスを保持する。 |
| N06 / P2 | 修正済み | 品質判定の画像入力能力を送信境界で検証し、非対応・未確認モデルへの画像POSTを止める。 |

上記は追加の自動再現条件での結果。実サービスでの受理や実機条件はEに分けて記載する。

## B. 原因と修正

### N01: 署名の履歴依存

原因は `_prepareApiHistory()` が変更をその応答単体でしか判定しなかったこと。Bedrockでは、前方のユーザー発言・応答が変わると、変更されていない後続応答の署名も再利用条件を満たさなくなる。

変更した関数・経路:

- `app.js`: `preserveMessageContentBaselineV136()`、`_prepareApiHistory()`。
- `saveEditMessage()`、置換適用、`setHistoryChangeTargetContent()`（Undo/Redo）、整形適用で変更前本文を保持。
- 既存の `continuation.displayContent` を再利用し、ユーザー発言についても変更前本文を保存する。IndexedDBストア、設定キー、schemaVersion、同期エンベロープの版は変更していない。

送信時に最初の変更位置を検出し、Bedrockではその位置以後の署名・継続列を再利用しない。集約応答は現在の本文と画像から再構築し、編集前の本文を戻さない。署名文字列、元の保存済み署名ブロック、過去の実行メタデータは書き換えない。Undoで元の本文へ戻した場合は元の継続列を利用できる。

別保存のツール結果との対応を保証できない履歴や、本文のないツール列を安全に再構築できない場合は、送信前に再生成を促すエラーで停止する。要約によって先行履歴を置き換える場合にも、置換位置以後のBedrock継続列を再利用しない。

Providerごとの判断:

- Bedrock: Converseの署名は先行する会話を含めて扱う。[AWS Converse公式仕様](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)、[署名テキストの保持](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ReasoningTextBlock.html)に基づく。
- Gemini: 編集された応答・そのツールターンを再構築する。後続の別の未編集ターンまでBedrockと同じ規則で消さず、Thought Signatureを維持する。[Google公式Thought Signatures](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures)のターン単位の検証を踏まえた実装上の判断。
- OpenRouter: Anthropic宛て、または暗号化・署名を含むopaqueなreasoning detailsは、変更されたprefixに依存する可能性があるため影響する後続部分を再構築する。無関係な前方履歴や、すべてのProviderの継続情報を一括削除しない。[OpenRouter公式Preserving Reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#preserving-reasoning)を参照。
- Z.ai: 元のreasoningブロックを改変せず、編集された応答・現在の変更されたターンを再構築する。Bedrockと同じ会話全体ハッシュ検証があるとは仮定しない。[Z.ai公式Thinking Mode](https://docs.z.ai/guides/capabilities/thinking-mode)のブロック順序・非改変条件を踏まえた判断。

影響範囲は送信・再生成用の履歴、ユーザー/応答の編集・置換・整形・Undo/Redo。元データの破壊による対応ではない。

### N02: 通常installの混在検出

原因は通常installが `cache.addAll()` の成功のみで昇格しており、手動再構築との検証差があったこと。

`sw.js` の `validateShell()` / `buildShell()` を共通化した。HTMLの版付き参照と取得対象の一致に加えて、HTML・JS・CSS・補助スクリプト等14資源を、Worker内に固定したSHA-256一覧と照合する。HTTP 200でも古いJSやCSS、未列挙の参照、異なるHTMLは拒否する。

通常installでは別キャッシュへ取得・検証し、検証済み候補の参照だけを保存して `skipWaiting()` する。activateで候補を再検証してからactiveポインターを更新し、clientsをclaimする。失敗した候補は消すが、稼働中Workerのactiveポインターと正常な旧シェルには触らない。

整合性一覧は `tests/update-shell-integrity.py` で更新する。Workerとアプリのリリース版も生成時に照合する。これはアプリDBの保存形式変更ではなく、SWの配布資源検証用データ。

アプリシェル資源を変更した後は次を実行する。更新漏れの場合は安全側にインストールを失敗させる。

```text
python -B tests/update-shell-integrity.py
python -B tests/update-shell-integrity.py --check
```

### N03: ポインターとキャッシュ読出し

原因は旧ポインターを読んでからキャッシュを開くまでの間に、旧キャッシュが削除され得たこと。

`readShell()` は最大3回まで最新ポインターを読み直し、同じ名前ならそれ以上繰り返さない。旧キャッシュが消えても有効な新シェルがあれば復旧する。`matchShell()` は読出し中の参照をpinし、整理側がそのキャッシュを消さない。

`publishShell()` は新しいactive参照を書いた後に旧シェルをretiredとして記録する。`cleanupShells()` は過去に公開された退役シェルだけを整理し、別Workerが用意している未公開候補を一括削除しない。退役記録はWorker再起動後も残る。切替後の整理失敗を理由に、公開済みの新シェルを削除しない。タイマーによる回避は使っていない。

### N04: 能力確認の再試行

原因はAPI設定IDのキャッシュが存在するだけで再取得を止め、対象モデルが空一覧・欠落で未確認のままになること。

`settings-v136.js` の `getModelMetadataV136()` / `getModelThinkingCapability()` / `refreshModelThinkingCapabilities()` / `refreshExecutionApiConfigsV136()` / `setCurrentChatExecution()` を修正した。

- API一覧が取得できたことと、そのモデルの能力が確認できたことを区別する。
- 空一覧・対象モデル欠落・能力項目未確認・取得失敗から、通常の再送または選択時の取得で回復する。
- API設定IDに加え接続先と資格情報に結び付け、接続先が変わった後の能力キャッシュを流用しない。
- 同時の同一取得は一つのPromiseへまとめ、1操作内で無限再試行しない。
- チャット切替後に能力取得が終わってもチャット設定は変更しない。
- Lowは保持し、確認後の実リクエストへ対応する `reasoning.effort: low` を渡す。
- 確認できない保存済みeffortは推測して送信せず、既存の控えめなエラーで停止する。通常の回復時に通知は増やしていない。

### N05: 共通設定フォーム

原因は `execution-settings-changed` のglobal通知で外観エディターだけを同期していたこと。

`app.js` の既存即時保存バインドからグローバルのフォーム対応表を共有し、`SettingsUI.syncGlobalForms()` で全共通欄を同期する。思考表示/翻訳、校正、要約、補助モデルとプロンプト、通信、外部連携も含む。新しい選択値が現タブの選択肢になければ、その値の選択肢だけを補う。フォーム全体は再生成しない。

入力イベントで編集中の欄を追跡し、フォーカス中の入力は別タブからの更新で上書きしない。フォーカス解除後は `reloadGlobalSettingsV136()` で最新DB値を読み直す。同一項目はR03の「後にコミットされた差分が勝つ」規則と整合させ、解除・保存後にDB、state、DOMを一致させる。画面を開き直す際も再取得する。UIデザインの変更や通常の通知追加はない。

### N06: 品質判定の画像入力

原因はModelRef・資格情報が有効なら、モデルの入力モダリティを確認せず画像を送信できたこと。

`SettingsV136.imageInputCapability()` と `appLogic.assertAuxiliaryImageInputV136()` を追加し、`callAuxiliaryApiV136()` の画像送信境界で検証する。Providerの名前や曖昧なモデル名一致では判断しない。

- OpenRouterはモデルの `architecture.input_modalities` を保持・利用し、未確認なら実際のモデル一覧取得を通す。[公式モデルAPI](https://openrouter.ai/docs/api/api-reference/models/get-models)を参照。
- メタデータがない場合は検証済みの完全一致モデル定義を使う。[Googleモデル仕様](https://ai.google.dev/gemini-api/docs/models)、[AWSモデル互換性](https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html)、[Z.ai GLM-4.6V](https://docs.z.ai/guides/vlm/glm-4.6v)を参照。
- `glm-4.6` は拒否、`glm-4.6v` は許可。似た文字列の未確認モデルを自動許可しない。
- 既存のGemini画像対応モデルと確認済みBedrockモデルを維持し、OpenRouterの画像ペイロードとBedrockの実画像バイトを確認した。
- 保存・再読込・インポート/Dropbox形式復元後も同じ送信境界で検証する。
- 拒否時は画像対応モデルの再選択を促す。SD画像生成本体は変更していない。

## C. 追加テスト

`tests/review-n-regressions-v136.js` の17件:

| 指摘 | テスト名・検証内容 |
| --- | --- |
| N01 | `Bedrock signed suffix after edit 1/3/2, Undo, Redo and reload` の3件。先頭/中間応答とユーザー発言の実編集、複数ツール列、保存/再読込、Undo/Redoを実Bedrockアダプターのリクエストで確認。未編集時の署名と変更前のprefix署名も確認。 |
| N01 | `user replacement invalidates only the affected Bedrock suffix`。実置換の適用・保存後、現在本文を送り、後続署名だけを再利用しない。 |
| N01 | `Gemini later unedited turn retains its own Thought Signature`。Bedrockの規則で他Providerの全後続署名を消さない。 |
| N04 | `empty/missing/network metadata recovers through actual retries without losing Low` の3件。空一覧・欠落・ネットワークエラーから実再取得で回復し、次の実リクエストと再送時の取得回数を確認。 |
| N04 | `simultaneous capability refresh is shared across a chat switch`。取得待機を固定し、重複取得・チャット設定の混同を確認。 |
| N04 | `same API config ID with a changed endpoint rechecks model capabilities`。同じIDでも別接続先の能力を再取得する。 |
| N05 | `actual independent tab updates global checkbox, auxiliary model, network and integration DOM`。2つの実タブでDB/stateに加えてフォーム値を確認。 |
| N05 | `focused text is retained until blur then matches committed DB state`。実際に編集タブを前面化し、入力保持・フォーカス維持・解除後のDB/state/DOM一致・再表示を確認。 |
| N06 | `saved SD quality ModelRef glm-4.6/glm-4.6v/unverified-glm-4.6v-copy` の3件。保存/読戻し後の非対応・対応・未確認と実画像ペイロードを確認。 |
| N06 | `Bedrock vision quality adapter emits actual image bytes`。別Providerの実アダプター形式で画像バイトを確認。 |
| N06 | `Dropbox-format restored text-only ModelRef is rejected before image POST`。実際の書出し/復元処理後にも拒否する。 |

その他の追加テスト:

- `tests/sw-install-concurrency-v136.test.js`: 8件。通常installの正常系、旧HTML、旧JS、異なるCSS、未列挙参照、ネットワーク失敗、旧ポインターで停止した単一/複数読者のオフライン復旧。
- `tests/image-capabilities-v136.test.js`: 10件。完全一致、似た名前、未知モデル、Provider別モデル、メタデータ優先。
- `tests/sw-fixture-v136.js`: 実資源のバイトと独立したCacheStorageを使うVM fixture。

既存のSWテストは、候補のinstallとactivateを分け、実資源の整合性を検証できるfixtureへ合わせた。外部POST除外、旧キャッシュ整理、オフラインHTML、失敗時保持といった既存の目的・件数は維持している。R04のOpenRouter画像モックには入力モダリティの応答を加え、中央設定・専用モデル・キーに関する従来の期待は維持した。テストの削除・無効化はしていない。

## D. 実行結果

全て今回の最終ソースに対して実行した。既存109件に追加35件を加え、計144件成功。

| コマンド | 最終結果 |
| --- | --- |
| `node tests/settings-v136.test.js` | 30件成功 |
| `node tests/sw-v136.test.js` | 5件成功 |
| `node tests/ui-static-v136.test.js` | 4件成功 |
| `node tests/sw-clear-cache-v136.test.js` | 4件成功 |
| `node tests/sw-install-concurrency-v136.test.js` | 8件成功 |
| `node tests/image-capabilities-v136.test.js` | 10件成功 |
| `python -B tests/run-browser-tests.py --review --ui --sw` | 83件成功（N系追加17件を含む） |
| `node --check`（変更したアプリ/テストJS 11ファイル） | 全て成功 |
| `python -B tests/update-shell-integrity.py --check` | 14資源と一致 |
| `git diff --check` | 成功 |

ブラウザの追加確認: 360/390/768/1280pxで263確認、リサイズ8確認、狭い高さ4確認、ネイティブのタッチ・マウス・キーボード56確認が成功。既存のモデル/Thinking統合UIとポップオーバー維持も成功。

実Chrome/実Service Worker:

- 旧SWからv1.36.0への正常更新。
- 通常installで旧HTML、旧JS、異なるCSS、未列挙参照、ネットワーク失敗を拒否し、稼働中Workerを保持。
- 上記更新失敗後、HTTPキャッシュを消去・無効化して旧アプリをオフライン起動。
- 2タブから12件のシェル取得を行いながら手動再構築。
- 手動再構築後のオンライン再起動、HTTPキャッシュ無効化/消去、実HTTPサーバーとSW停止後のオフライン再起動。

VM:

- N03はポインター取得後に処理を停止し、公開→退役整理→読出し再開という順序を固定。単一読者と独立した2読者の両方で、オフラインでも有効な新シェルから200を返すことを確認した。
- 再構築途中の失敗、版不一致、ポインター書込失敗による旧シェル保持も成功。

Chromeの並行取得成功と、VMで順序を固定した競合の解消は別の検証結果として扱う。Chromeで全スケジューリング順序を網羅したという意味ではない。

IndexedDB・複数タブ:

- R03の設定競合テストとN05のDOM同期テストは、実際の独立した2タブ・DB接続を使用。
- 編集内容の保存/再読込、署名保持、モデル設定、共通/個別外観、背景参照、Dropbox形式往復も既存テストで成功。

記録:

- `docs/review-n-before.txt`: N01/N04/N05/N06の修正前再現。
- `docs/review-n-sw-before.txt`: N02/N03の修正前再現。
- `docs/review-n-after.txt`: 最終ブラウザ/実SW結果。
- `docs/review-n-node-results.txt`: 最終Node結果。
- `docs/review-n-changes.diff`: 今回開始時点からのアプリ側4ファイルの差分。R01〜R08以前からある未コミット差分とは区別した比較。

テスト導入中に、設定欄のIDと表示状態、前面タブのフォーカス、実行設定固定のfixtureを調整した。期待値を弱める対応ではなく、実際の送信・入力条件へ合わせた修正である。

## E. 未検証事項

追加した再現条件で未解決の問題は残っていない。以下は今回実行していない。

- Gemini / OpenRouter / Z.ai / Bedrockの実APIでの署名・ツール履歴・画像入力の受理。モックリクエストの構造検証と区別する。
- 実Dropboxアカウントへの同期。形式の書出し/インポート/読戻しは実行済み。
- 実SDサーバーでの生成・品質判定・プロンプト改善。
- Android / iOSのインストール済みPWA、Safari、端末再起動やOS固有のキャッシュ追放、実モバイルキーボード。
- 実ホスティング/CDNの配布。今回のHTTP混在はローカルサーバーで制御して再現した。

## F. 最終レビュー箇所

| ファイル | 重点関数・境界 |
| --- | --- |
| `app.js` | `preserveMessageContentBaselineV136()`、`_prepareApiHistory()`。ユーザー編集を含むprefix変更、Provider別の継続可否、ツール履歴を再構築できない場合の停止。 |
| `app.js` | `assertAuxiliaryImageInputV136()` / `callAuxiliaryApiV136()`。保存元にかかわらず画像送信前に検証すること。 |
| `settings-v136.js` | `getModelMetadataV136()` / `getModelThinkingCapability()` / `refreshModelThinkingCapabilities()`。接続先・モデル単位の確認、missing/failedからの回復、共有中リクエストとLowの保持。 |
| `settings-v136.js` | `reloadGlobalSettingsV136()` / `imageInputCapability()`。DB由来の反映と、モダリティ判定の完全一致・未知状態。 |
| `settings-ui-v136.js` | `syncGlobalForms()`、input/focusout、global通知、`enter()`。入力保護、後勝ち保存規則、フォーカスとDOMの維持。 |
| `sw.js` | `validateShell()` / `buildShell()`、install/activate。候補検証とactive公開の順序、通常更新と手動更新の共通化。 |
| `sw.js` | `readShell()` / `matchShell()` / `publishShell()` / `cleanupShells()`。有限再取得、pin、退役対象、候補を消さない整理、切替後の失敗処理。 |
| `tests/update-shell-integrity.py` | ソース変更後の配布資源指紋更新と `--check`。 |

## G. Git状態

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

ブランチは `main`。今回のアプリ側編集は `app.js` / `settings-v136.js` / `settings-ui-v136.js` / `sw.js`。テスト・報告書以外の無関係なファイルは編集していない。`CHANGELOG.md` / `dropbox.js` / `index.html` / `style.css` の既存未コミット差分はそのまま保持している。
