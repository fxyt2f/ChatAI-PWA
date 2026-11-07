# v1.36.1 リリース停止要因の解消

2件とも修正・検証完了。ビルドIDは `6ad1738e304358051d49`。通常のGitインデックスは空で、修正・検証段階の成果をローカルに保持している。

## 公開バイト列とSHA-256

システムGit設定 `core.autocrlf=true` と対象ファイルのeol属性未指定により、作業ツリーとGitのclean filter適用後の内容が異なっていた。全15資源を調べるとdropbox.jsはCRLF 378行とLFの混在、manifest.jsonはCRLF 17行だった。PNG内のCR/LFバイトは画像データとして扱う。

dropbox.jsとmanifest.jsonのCRLFだけをLFへ置換した。DropboxのGit blobは元々LFであり、正規化後SHA-256は `e96ed0a4aa2dd8cd5896346e77352ce853ae23bfde08df837b12ca88b753ba6b`。両ファイルとも正規化前の内容との一致を確認した。app.jsは今回の開始時とバイト単位で同一。スキーマ13、manifestテーマ色 `#1e1e1e` と既知の送信開始直後の中断競合を維持した。

.gitattributesにアプリシェルのテキスト13ファイルとsw.jsのLFを個別指定し、アイコンをバイナリ指定した。全リポジトリを対象にした変換やGit設定変更は行っていない。

tests/update-shell-integrity.pyは生成・通常チェック時にGit clean filterの結果も照合する。`--check --staged` はsw.js、app.jsと全資源をインデックスの実blobから読み取り、版・URL・生成済みハッシュと比較する。作業ツリーだけが新しく、対応する依存資源をステージし忘れた場合も失敗する。

独立した `GIT_INDEX_FILE` を使い、次の16パスだけを明示して検証した。

```text
.gitattributes sw.js index.html style.css app.js settings-v136.js
settings-ui-v136.js dropbox.js function-calling.js marked.js purify.min.js
prism.js prism.css CHANGELOG.md manifest.json icon-192x192.png
```

index.htmlの2つのURLを含む15資源すべてが実blobと一致した。検証用インデックスは `docs/release-v1361-local/blockers/publication.index`。通常インデックスは検証前後で同一であり、ステージ済みパスは0件。

## Failed to fetch

ページ側の `fetch('/__sw-test-fault')` が障害注入解除時に失敗していた。CDP Networkは `net::ERR_CONNECTION_REFUSED` を記録した。制御用URLは製品SWのfetch対象外であり、成功時も `fromServiceWorker=false`。意図的な503は別のURL `/settings-v136.js?v=1.36.1` に対するものだった。

失敗時はブラウザーonline、旧Worker activated、拒否対象Worker redundant、旧キャッシュあり、HTTPサーバースレッド稼働中だった。直後のサーバーヘルス確認もHTTP 200であり、意図的なオフライン設定へ進む前に失敗していた。

PythonのThreadingHTTPServerは待受キューの既定値が5。15資源の並行取得に障害注入解除の接続が重なり、待受キューが足りなくなる試験環境の問題だった。試験用サーバークラスのrequest_queue_sizeを64へ変更した。検証条件・タイムアウト・例外判定は維持し、制御用fetchもすべて実行する。

| 比較 | 結果 |
| --- | --- |
| 旧キュー5、新規Chromeプロファイル | 同じURLで接続拒否を再現 |
| 修正キュー64、別の新規プロファイル | SW検証を完走 |
| 同じ正規化済み資源、メモリ上だけ旧キュー5へ戻す | 同じ接続拒否が再発 |
| 修正キュー64、さらに別の新規プロファイル | 関連回帰とSW検証を完走 |
| 16接続をaccept前に保留する単体比較 | 旧キュー5は5接続成功、64は16接続成功 |

Network・Console・Worker状態・HTTP応答履歴・ネットワーク設定コマンドを任意の `--sw-diagnostics` 出力へ保存できる。意図的なオフライン区間の外部フォント・SDKの通信失敗、およびページ終了に伴う中断は、制御URLの予期しない接続拒否と区別した。詳細JSONとログはローカル保管とする。

## 実行した確認

| 検証 | 結果 |
| --- | --- |
| 公開バイト列の新規回帰 | 4件成功。CRLFと古いステージ資源を拒否し、独立インデックスも確認 |
| サーバー待受キューの新規回帰 | 1件成功 |
| 実Git blobとシェル指紋 | 15/15一致 |
| SW既存Nodeテスト | 4ファイル成功。更新延期、再試行、旧資源保持、失敗時回復、オフラインDOMPurifyなど |
| 関連ブラウザ基本ケース | 49件成功 |
| R1/R2/R3/R5の安全性 | 18ケース成功 |
| F1/F2 | 18ケース69アサーション、ネイティブF2 6アサーション成功 |
| 既存ダイアログ | 690アサーション成功 |
| レスポンシブ・resize・縮小Viewport・ネイティブ入力 | 263 / 8 / 4 / 60アサーション成功 |
| サイドバー・背景の追加確認 | 80アサーション成功 |
| 通常更新・5種類の不正更新拒否・旧Worker/キャッシュ保持 | 成功 |
| キャッシュ再構築・2タブ並行読取り | 成功 |
| サーバー・Worker停止、HTTPキャッシュ消去後のオフライン起動 | 成功 |
| オフラインDOMPurify | 読み込み・通常HTML保持・危険属性除去が成功 |
| 構文・参照・差分 | JS3/Python4、v1.36.1 URL、git diff --checkが成功 |

修正後の成功は新規プロファイル2つで確認した。主な再実行コマンドは次のとおり。

```text
python -B tests/shell-integrity-publication.test.py
python -B tests/browser-server-burst.test.py
python -B tests/run-browser-tests.py --sw --safety --dialog-races --dialogs
python -B tests/update-shell-integrity.py --check
python -B tests/update-shell-integrity.py --check --staged
```

最後のコマンドは正式な公開対象をステージしたインデックスに対して実行する。今回の実blob検証では独立インデックスを指定した。

## 変更と残存事項

製品資源はdropbox.jsとmanifest.jsonのLF化、sw.jsの生成済み指紋を更新した。テストはrunnerのサーバー容量・診断・オフラインDOMPurify確認、指紋生成/検証スクリプト、新規回帰2ファイルを変更・追加した。

先行検証の資料を保管し、テストが再生成した既存資料39ファイルを元の内容へ戻した。今回の開始時に記録したソース88件中、意図した5件を除く83件は同一。既存のUI・保存・添付の実装を保持した。

送信開始直後の中断競合はMedium、v1.36.2へ延期する既知問題として残る。実プロバイダー通信、物理端末、実OSキーボード、Chrome以外のブラウザーは今回未検証。正式リリース時の選別・秘密情報監査・CI・マージ・Pages公開資源の確認はリリース手順で実施する。
