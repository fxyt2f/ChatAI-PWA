# Thinking変更時のポップオーバー維持

2026-11-06。

原因は`settings-ui-v136.js`の選択ハンドラーが直接closePopoverを呼ぶことと、
保存後のexecution-settings-changedイベントで毎回閉じていたことの二重だった。

選択後は同じDOMのレベル名、aria-checked、tabIndex、塗り位置だけを即時更新する。
保存中の選択回数を管理し、古い保存完了イベントで新しい表示を戻さない。
既存の保存キューを使用し、保存完了時も開いた状態を維持する。
キー操作は表示中の現在値を基準にするため、保存待ちの連続操作にも追従する。

更新イベントでは同一チャット・モデル・能力定義なら表示のみ同期する。
チャット切替、能力変更、モデル変更、生成開始など維持できない場合は閉じる。
外側クリック、Escape、トリガー再クリック、モデル一覧への移動も従来どおり。
DOM再生成や成功通知、保存構造・capability・APIの変更は行っていない。

変更ファイル:

- `settings-ui-v136.js`: 表示の局所更新、文脈の確認、保存中の表示保護。
- `tests/v136-ui-tests.js`: 既存の自動閉鎖前提を更新。遅延保存でLow→Medium→Highを連打し、
  同じパネル・同じradio要素を維持すること、リセットとキー操作、チャット切替と保存復元を追加検証。
- `tests/run-browser-tests.py`: PC・スマホ幅で実マウス／タッチを使った連続選択とリセットの検証。
- 本記録。

実行結果:

```text
python tests/run-browser-tests.py --ui
43 browser tests passed
263 responsive assertions across 360/390/768/1280px
8 resize assertions / 4 reduced-viewport assertions
56 native touch/mouse/keyboard assertions

node tests/settings-v136.test.js
30 tests passed

node tests/ui-static-v136.test.js
4 tests passed
```

外側クリック、Escape、再クリック、モデル一覧、生成制限も既存回帰で検証。
Nodeの成功結果は最終の入力テスト追加前に実行したものを再利用した。
git diff --checkは空白エラーなし（既存の改行コード警告のみ）。
実API・実Dropbox・実スマホ端末は未検証。Chromeのスマホ幅エミュレーションを使用した。
Workerに変更がないためWorkerテストは再実行していない。
mainで既存変更を保持し、禁止されたGit操作は行っていない。
