# NIKO Editor

日本語で使える、Markdown・HTML・テキスト対応のWindowsエディタです。文字を選んで文字色・背景色をクリックするだけで色を付けられます。Tauri 2とRustでアプリ化し、HTML・CSS・JavaScriptで編集画面を構築しています。

## Windowsで使う

[Releases](https://github.com/konikatsu/niko-editor/releases) からファイルをダウンロードします。

- `portable-x64.exe`：インストールせずに起動できます。WebView2 Runtimeが必要です。
- `setup-x64.exe`：インストーラー。WebView2が不足している場合はダウンロードして導入します。

Windows 10/11（64bit）向けです。アプリの利用にNode.jsやRustのインストールは必要ありません。自動保存データはこのPCのアプリ用領域に保存されます。配布バイナリは現時点ではコード署名を付けていません。

## 使い方

Windowsアプリのほか、`dist/index.html` をブラウザで開いて使うこともできます。外部CDN・アカウント・サーバーは不要です。ローカルサーバーを使う場合は `npm start` を実行し、表示されたURLを開いてください。

- **かんたん編集**：用紙をクリックして入力。太字、下線、見出し、リスト、引用、リンク、文字色、背景色に対応。
- **ソース**：MarkdownやHTMLを直接編集。広い画面ではプレビューと並べて表示。
- **形式切り替え**：Markdown・HTMLを相互変換。色や下線はMarkdown内のHTMLタグとして保持。
- **テキスト編集**：`.txt` の本文をそのまま編集。行番号、行・列の表示、折り返し切り替えに対応。
- **検索・置換**：文字列の検索、前後の候補へ移動、1件ずつの置換・すべて置換、大文字・小文字の区別。Markdown・HTMLではソース内を検索します。
- **開く・保存する**：`.md` / `.markdown` / `.html` / `.htm` / `.txt` を読み込み、Markdown・HTML・テキストで保存。Windowsアプリは標準のファイル選択画面を使用します。UTF-8（BOM付きも可）とBOM付きUTF-16の読み込み、UTF-8での保存に対応します（ブラウザ版の読み込みはUTF-8）。
- **自動保存**：本文・形式・名前をブラウザ内のlocalStorageに保存。端末間の同期はありません。大切な文章はファイルでも保存してください。
- **ショートカット**：Ctrl/Cmd+S 保存、Z 元に戻す、Shift+Z/Y やり直す、B 太字、I 斜体、U 下線、K リンク、F 検索、H 置換。

HTMLソースは見たまま編集を行うまで原文を保持します。見たまま編集・形式変換では安全な本文に整えます。JavaScript、埋め込み、任意のCSS、ページ全体のデザインの完全な保持は対象外です。プレビューはサニタイズとsandbox/CSPを使用します。外部の画像・スクリプト等は取得せず、埋め込まれたビットマップ画像のみ表示します。

## 開発

Node.js 24以上を使用してください。Windowsアプリの開発・ビルドには、Rust stableとMicrosoft C++ Build Tools（C++デスクトップ開発）、WebView2が必要です。

```powershell
npm ci
npm run prepare-assets
npm test
npm start
# Windowsアプリを開発用に起動
npm run desktop
# exeとインストーラーを生成
npm run build:win
```

`dist/` がそのまま配信可能な静的ファイルです。依存ライブラリのライセンスは `dist/vendor/` に同梱しています。アプリの入力内容を外部サーバーへ送信する処理はありません。

Windowsの成果物は `release/` に生成されます。`src-tauri/Cargo.lock` と `package-lock.json` をバージョン管理しています。GitHub Actionsはpush/PRでテストとWindowsビルドを実行し、`v1.0.0` のようなタグをpushするとGitHub ReleasesにexeとSHA-256チェックサムを公開します。

## 実装

- `dist/app.js`：編集、色付け、履歴、自動保存、検索・置換。
- `dist/editor-core.js`：形式変換、HTMLのサニタイズ、安全なプレビュー。
- `src-tauri/src/main.rs`：Windowsアプリ、ファイル選択、保存。
- `src-tauri/src/file_policy.rs`：文字コード、ファイル形式・サイズの検証。

プレビューをsandbox化し、Rustのファイル操作は選択ダイアログで指定したファイルに限定しています。汎用的なファイルシステム・シェルのAPIは画面へ公開しません。
