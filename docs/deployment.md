# Deployment

## GAS

1. Apps Scriptプロジェクトへ `gas/Code.js` を反映します
2. Script Propertiesを設定します
3. Web Appとしてデプロイします
4. Web App URLを `app.js` の `GAS_WEB_APP_URL` に設定します

## Script Properties

- `OPENAI_API_KEY`
- `PALURU_FAMILY_CALENDAR_ID`

実値はREADMEやコードへ書きません。

## Spreadsheet

- Spreadsheet名: `Paruru_DB`
- シート名: `01_Inbox`

GASはヘッダー不足を末尾追加します。既存列の並べ替えや削除は行いません。

## GitHub Pages / PWA

1. `APP_VERSION` はアプリの区切り版です
2. `build.js` の `BUILD_ID` はService Workerキャッシュと設定画面表示で共通のビルド番号です
3. `app.js` と `sw.js` は `globalThis.BUILD_ID` を参照し、Build文字列を重複定義しません
4. GitHubへpushします
5. Android PWAで設定画面のBuild表記を確認します

### デプロイ前Buildチェック

- [ ] PWA実行コードを変更した場合は、`build.js` の `BUILD_ID` を必ず更新した
- [ ] `git diff` で `BUILD_ID` の変更を確認した
- [ ] `app.js` と `sw.js` が `globalThis.BUILD_ID` を参照している
- [ ] `node scripts/check-build-version.js` が成功する
- [ ] 公開後、設定画面のBuild表示を確認する
- [ ] DevToolsのCache Storageで最新 `BUILD_ID` のcacheだけが有効であることを確認する

## キャッシュ更新確認

- HTML / JS / CSS / manifestはnetwork first
- 画像はcache first
- Service Worker登録は `updateViaCache: "none"`
- 起動時に `registration.update()`
- install時に `skipWaiting()`
- activate時に `clients.claim()`
- 古いcacheは削除
- controllerchangeでは一度だけreload

## Android確認

1. Chrome通常タブで開く
2. インストール済みPWAで開く
3. 設定画面の `PALURU Mini 1.0.0 / Build ...` を確認する
4. 反映されない場合はAndroid側でサイトデータまたはPWAを一度リセットする
