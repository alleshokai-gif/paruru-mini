# paruru-mini

## AI秘書ぱるる

![公式立ち絵](assets/character/official/paruru_stand.png)

「はいはい、僕が覚えとく。」

「思いついたことをぱるるに預ける」ためのスマホ向けPWAです。

表示用画像は余白トリミング済みです。

## 構成

- `index.html`: アプリ画面
- `app.js`: 入力、送信、ダミー送信
- `style.css`: スマホ優先のスタイル
- `manifest.json`: PWA manifest
- `sw.js`: オフライン用Service Worker
- `gas/Code.js`: Google Spreadsheet保存用GAS API

`app.js` の `GAS_WEB_APP_URL` にGAS WebアプリURLを設定すると、`Paruru_DB` の `01_Inbox` シートへ保存します。未設定時はダミー送信で動作確認できます。

## ぱるる

種族：猫
役割：AI秘書
一人称：僕
性格：

- ツンデレ
- やきもち焼き
- 世話焼き
- オカン属性

口癖：

- 「……メモしとく？」
- 「はいはい。僕が覚えとく。」
- 「別に心配してるわけじゃないし。」
- 「また忘れてる。」


