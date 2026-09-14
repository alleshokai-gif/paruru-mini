# PALURU Bus P2.4 Hub地点切替

## 問題

4地点のHubを縦に連続表示すると、スマートフォンで目的地点までの移動量が大きく、非表示地点のAPI pollingも継続する。

## 修正方針

- Hub設定順に地点選択buttonを表示する。
- 選択中の1地点だけを表示し、そのcontrollerだけをactiveにする。
- 選択Hub IDを `sessionStorage` に保存する。保存値が現行設定に存在しない場合は先頭地点へ戻す。
- 短縮ラベルを4等分の1行で表示し、390pxでも横スクロールを使わない。
- buttonをtabとして表現し、`aria-selected`、`aria-controls`、対応tabpanelを設定する。

## 影響範囲

- PWA Hub UIの地点選択とpolling lifecycle
- PWA Build IDとService Worker cache更新
- Hub API、Hub ranking、arrival DTO、Position UI、Public departure predictionは変更しない。

## 副作用と安全策

- `sessionStorage` が利用不能でも先頭地点を表示し、Hub機能を止めない。
- 未選択Hubのcontrollerは保持するがinactiveとし、fetch/pollingしない。
- Hub切替では旧controllerを停止してから新controllerをactiveにし、即時refreshする。

## ロールバック

この変更のHub UI、CSS、設定、Build ID差分を戻す。サーバーAPIや保存データの移行はない。

## 受入試験

1. 4地点buttonが表示され、選択地点だけ本文に表示される。
2. 選択buttonだけ `aria-selected=true` になる。
3. Hub切替直後に選択Hubを1回取得する。
4. 非選択Hubは30秒後もpollingしない。
5. Bus画面離脱中は選択Hubもpollingしない。
6. Bus画面復帰時は選択Hubを即時refreshする。
7. reload後に同一sessionの選択Hubが復元される。
8. 390pxで横overflowがない。
9. ranking、state、delay表示の既存テストがPASSする。
10. Position UIとPublic departure predictionはOFFのまま。

## ローカル検証結果（2026-09-14 JST）

- 390px viewport: document overflow `0px`。地点buttonは4件横並びの1行表示。
- 初回表示: 神木本町だけを表示し、API取得は1回。
- 立川駅への切替: 取得回数 `1 → 2`、表示tabpanelは立川駅北口だけ。
- 30秒polling: 32秒後の取得回数 `2 → 3`。選択Hub以外の追加取得なし。
- Bus画面離脱: 32秒間で取得回数 `3 → 3`。
- Bus画面復帰: 取得回数 `3 → 4`。選択していた立川駅を即時refresh。
- 同一session reload: 立川駅の選択を復元し、初回取得は立川駅の1回だけ。
- 4地点を順に切り替え、常に `aria-selected=true` と表示tabpanelが各1件で一致した。
- browser console error/warning: 0件。
- Hub/PWA対象テスト: 20/20 PASS。
- Repository全体: 99/99 PASS。
- Bus全体: 153/153 PASS。
- Secret scan: 479 files、matches 0。

本番Webアプリ更新とAndroid実機受入は未実施。

## 便行レイアウト調整

- 便行の上下paddingを `13px` から `10px` へ縮小した。
- 行先と時刻の間隔を縮小した。
- 時刻の数字と `便` / `予定` を別要素にし、半角スペースを挟んで接尾辞を数字の60%でbaseline揃えにした。
- `departure_uncertain` / `unknown` の表示を `発車済みの可能性あり` へ短縮した。状態とranking契約は変更していない。
- Realtimeの `あと22分` と `+5分遅れ` を専用テストで確認した。

## Providerアイコン方針

- 事業者名の直前に共通Bus inline SVGを表示する。
- 共通のoutline Bus SVGへ `stroke="currentColor"` を適用し、Provider classから川崎=青、東急=赤、西武=緑を指定する。
- 事業者名・系統・行先の文字情報は維持する。
- SVGは装飾扱いの `aria-hidden=true` とし、事業者名の読み上げを重複させない。
- 390pxで便見出しのwrapを許容しつつ、横overflowは発生させない。

ローカル実ブラウザでは川崎アイコンの計算色 `rgb(31, 111, 178)`、西武 `rgb(35, 134, 54)`、`stroke=currentColor`、事業者名・系統・行先の維持、document overflow `0px` を確認した。観測時の東急便は上位3件に含まれなかったため、東急赤はCSS契約テストまで確認し、実データ表示は未観測とする。
