# Server-only P0 Static

`npm --prefix bus run build:static`で`p0-static.json`を生成する。

JSON・一時ファイルはgitignore対象。完全なGTFS ZIP/レスポンスは保存しない。生成物をGitHub Pagesへコピーしない。
Workerの`entry.js`がサーバー側へ同梱する。生成に失敗した場合は既存JSONを保持し、成功時は直前版を`previous-<hash>.json`としてローカルに残す。
正規キーは`bus/.dev.vars`のみ。詳細は`docs/PALURU_BUS_P0_DEPLOYMENT.md`。
