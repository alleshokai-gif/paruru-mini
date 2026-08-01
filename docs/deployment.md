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
3. `index.html`、`manifest.json`、`sw.js` の参照版数を揃えます
4. GitHubへpushします
5. Android PWAで設定画面のBuild表記を確認します

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
