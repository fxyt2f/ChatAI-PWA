# ChatAI PWA

ChatAI PWA は、Gemini-PWA-Mk-II をベースにした私用 AI PWA クライアントです。Gemini API に加えて OpenRouter API を利用できるようにし、DeepSeek V4 Pro などの reasoning / thinking 対応モデルを日常的に使いやすくすることを目的にしています。

ブラウザだけで動作し、チャット履歴、プロファイル、設定、Dropbox 同期などをローカルブラウザ内に保存します。

## 主な機能

- Gemini API 対応
- OpenRouter API 対応
- DeepSeek V4 Pro などの OpenRouter reasoning 表示
- OpenRouter reasoning の二重表示防止
- OpenRouter 思考プロセス翻訳
- OpenRouter 履歴要約
- OpenRouter 追加モデル管理
- 添付ファイル対応
  - テキスト、JSON、Markdown、CSV などは本文テキストとして送信
  - PDF は OpenRouter の file content part 形式で送信
  - 画像は対応モデル向けに image_url 形式で送信
  - DeepSeek 系モデルでは画像を直接送らず、安全寄りの説明テキストとして扱う
- Dropbox 同期
- PWA 対応
- 複数プロファイルと設定保存
- Function Calling / Tools
- 履歴インポート、エクスポート

## 重要な注意

- API キー、access token、refresh token、App Secret などの秘密情報をコードや README に直書きしないでください。
- OpenRouter API キー、Gemini API キー、Dropbox token はブラウザ内の設定として扱います。
- GitHub Pages で公開する場合、ページ自体は第三者からアクセス可能になる可能性があります。
- このリポジトリは自分用クライアントとして使う想定です。公開運用する場合は、利用者ごとの API キー管理とデータ保護を各自で確認してください。
- Dropbox App Key はユーザー自身の Dropbox developer app で作成してください。
- Dropbox App Secret は入力しないでください。このアプリは PKCE を使うため、ブラウザ側に App Secret を置きません。
- Dropbox 連携には Dropbox 側の権限設定と Redirect URI の完全一致登録が必要です。

## セットアップ

### 1. リポジトリを取得する

```bash
git clone https://github.com/fxyt2f/ChatAI-PWA.git
cd ChatAI-PWA
```

ZIP で取得した場合は、展開したフォルダを開いてください。

### 2. ローカルで起動する

ブラウザの PWA 機能や fetch の都合上、`file://` ではなくローカル HTTP サーバーで開いてください。

```bash
py -m http.server 8000
```

ブラウザで次を開きます。

```text
http://localhost:8000/
```

### 3. OpenRouter API キーを設定する

1. ChatAI PWA を開く
2. 設定画面を開く
3. API Provider で OpenRouter を選ぶ
4. OpenRouter API キーを入力する
5. 設定を保存する

OpenRouter API キーは OpenRouter のアカウント管理画面で作成してください。キーはコードに書かず、必ずアプリの設定画面から入力してください。

### 4. DeepSeek V4 Pro を設定する

OpenRouter のモデル欄、または OpenRouter 追加モデル設定に次のようなモデル ID を設定します。

```text
deepseek/deepseek-v4-pro
```

OpenRouter 側の実際のモデル ID は変更される可能性があります。利用前に OpenRouter の Models ページで現在のモデル ID を確認してください。

### 5. OpenRouter 追加モデルを登録する

設定画面の「その他設定」にある OpenRouter 追加モデル欄へ、カンマ区切りでモデル ID を入力します。

```text
deepseek/deepseek-v4-pro, anthropic/claude-sonnet-4.5, google/gemini-2.5-pro
```

登録したモデルは OpenRouter 用のモデル選択候補として表示されます。

### 6. Dropbox を使う場合の設定

Dropbox 同期を使う場合は、先に Dropbox developer app を作成し、App key と Redirect URI を設定してください。詳しくは次の「Dropbox 設定」を参照してください。

## Dropbox 設定

Dropbox 同期を使うには、ユーザー自身の Dropbox developer app が必要です。

### 1. Dropbox developer app を作成する

1. Dropbox App Console を開く
2. 新しいアプリを作成する
3. Scoped access を選ぶ
4. App folder または必要なアクセス範囲を選ぶ
5. 作成された App key を控える

README やコードには実値を書かず、説明では次のようなプレースホルダーを使ってください。

```text
<YOUR_DROPBOX_APP_KEY>
```

### 2. ChatAI PWA に App key を入力する

ChatAI PWA の設定画面で、Dropbox App Key 欄に App key を入力します。

App Secret は入力しません。ブラウザアプリに App Secret を置くと漏えいリスクが高いため、このアプリでは PKCE 認証を使います。

### 3. Redirect URI を登録する

Dropbox 側の Redirect URI には、実際に ChatAI PWA を開く URL を完全一致で登録してください。末尾の `/` も一致させる必要があります。

ローカル例:

```text
http://localhost:8000/
```

GitHub Pages 例:

```text
https://fxyt2f.github.io/ChatAI-PWA/
```

認証開始時にはアプリ側にも Redirect URI が表示されます。Dropbox 側に登録した値と完全に一致しているか確認してください。

### 4. 必要な Permission を有効にする

Dropbox App Console の Permissions で、少なくとも次の scope を有効にしてください。

- `files.content.read`
- `files.content.write`
- `files.metadata.read`
- `files.metadata.write`
- `account_info.read`

権限を変更した場合は、ChatAI PWA 側で Dropbox 連携を解除し、再認証してください。

## GitHub Pages で使う方法

GitHub Pages を使うと、このリポジトリを静的 PWA として公開できます。

### 公開手順

1. GitHub でリポジトリを開く
2. `Settings` を開く
3. `Pages` を開く
4. `Source` を `Deploy from a branch` にする
5. `Branch` を `main` にする
6. `Folder` を `/root` にする
7. 保存する
8. 表示された URL を開く

GitHub Pages の公開 URL は通常、次の形式になります。

```text
https://<ユーザー名>.github.io/ChatAI-PWA/
```

このリポジトリの例:

```text
https://fxyt2f.github.io/ChatAI-PWA/
```

### GitHub Pages 利用時の注意

- Dropbox Redirect URI には GitHub Pages の公開 URL を完全一致で登録してください。
- GitHub Pages で公開する場合も、API キーや token をコードに直書きしないでください。
- このリポジトリには `.nojekyll` を置き、GitHub Pages が静的ファイルをそのまま配信できるようにしています。
- PWA は Service Worker のキャッシュが効くため、更新後に古いファイルが残る場合はアプリ内の更新ボタン、またはブラウザの強制リロードを使ってください。

## PWA とサブパス対応

ChatAI PWA は GitHub Pages のサブパス `/ChatAI-PWA/` でも動くよう、CSS、JavaScript、manifest、Service Worker、アイコン参照を相対パスで扱います。

- `manifest.json` は相対パスで参照
- `start_url` は `./`
- `scope` は `./`
- Service Worker は `./sw.js` で登録
- アイコンは `./icon-192x192.png`

## 開発メモ

これまでの主な変更:

- アプリ名を ChatAI PWA に変更
- OpenRouter API 対応
- OpenRouter reasoning / thinking 表示対応
- OpenRouter reasoning の二重表示防止
- DeepSeek V4 Pro などの text-only 想定モデル向けの安全寄り添付処理
- OpenRouter 添付ファイル変換
- OpenRouter 思考プロセス翻訳
- OpenRouter 履歴要約
- Gemini / OpenRouter 追加モデル UI 改善
- Dropbox App Key の設定画面対応
- Dropbox retry / backoff / token refresh mutex 改善
- PWA cache versioning
- GitHub Pages 向け `.nojekyll` 追加

## 秘密情報の扱い

次の値はリポジトリに含めないでください。

- OpenRouter API key
- Gemini API key
- Dropbox access token
- Dropbox refresh token
- Dropbox App Secret

Dropbox App Key は秘密情報ではありませんが、README やサンプルでは `<YOUR_DROPBOX_APP_KEY>` のようなプレースホルダーを使ってください。

## ライセンス

このリポジトリは Gemini-PWA-Mk-II をベースにした私用フォークです。

元プロジェクトの LICENSE を尊重し、MIT License を維持します。詳細は `LICENSE` を確認してください。
