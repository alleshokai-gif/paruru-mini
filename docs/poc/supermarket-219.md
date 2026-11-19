# #219 スーパー特売・献立 PoC

**問題・方針**: 6店の刊行経路が異なり、公開表示は自動取得許可や価格・在庫の完全性を意味しない。承認済みソースだけ既存スケジューラから1日1回確認し、元資料の識別子が変わる場合だけ抽出・目視照合へ回す。価格確認と献立ルールは決定論的に扱い、有料AI/OCRは利用しない。

**影響・副作用・戻し方**: 家族リストの認可・書込・LINEには変更なし。PALURU買い物表示部品をループバック限定のプレビューで再利用。ローカルSQLiteのみ作成。既存のスケジューラへの登録はPoC検証後の別操作。無効化は日次呼出しの停止、またはローカルプレビューの終了（既存データ不変）。

**受入**: 当日の公式資料を画面で照合し、価格・単位・期間と元資料をSQLiteに保存／再読取。更新なし、期限切れ、取得失敗、他店の継続、同一資料再実行を区別。PALURUブラウザで3案・店舗・部分価格の注記と未購入リストの共存を確認。

## 6店の取得方針

| 店舗 | 第一候補・観測 | PoC採用・保留理由 |
| --- | --- | --- |
| オーケー 溝ノ口 | [店舗](https://ok-corporation.jp/shop/mizonokuchi.html) → [公式週間商品情報](https://ok-corporation.jp/flyer/) の関東版、対象外店舗表記あり | 1日1回の索引・robots確認。変更号の公式画像をローカルOCR。11/16–22号の3行を実測保存し、公式PDFでも照合。robots 404確認。本文画像をDB・リポジトリへ再配布しない |
| イトーヨーカドー 溝ノ口 | [公式店舗](https://stores.itoyokado.co.jp/detail/521/) → [はとベース掲載一覧](https://promo.hatobase.jp/flyers/00521/new)、11/18–22の公開閲覧ページ | 公開ブラウザ閲覧。提供側の規約・robots・画像再利用を確認してから定期取得候補。非公開API使用なし |
| マルエツ 川崎坂戸 | [公式店舗](https://www.maruetsu.co.jp/store/9245/)からトクバイ11/17–23号等を確認。旧一覧は403 | トクバイの定期自動取得は許可未確認につき保留。手動閲覧、公式[チラシ更新メール](https://www.maruetsu.co.jp/magazine/)・[アプリ](https://www.maruetsu.co.jp/shufoo/sp.html)は代替候補（通知のみ・出典範囲未検証、登録なし） |
| ライフ 溝口 | [公式店舗](https://store.lifecorp.jp/detail/east648/) → [公式ページ組込みトクバイ](https://widgets.tokubai.co.jp/224224/leaflet_widget) | [トクバイ利用規約](https://kufu.jp/terms/tokubai)／[ライフの利用条件](https://www.lifecorp.jp/about_use.html) を確認の上、正式許可または手動参照から。非公開API・画像転載なし |
| そうてつローゼン たいら | [公式店舗](https://www.sotetsu.rosen.co.jp/shopdetail?scode=0032) → 画像/PDFビューア候補 | 現在号・更新頻度・条件未確定。公式リンクの更新識別子を検証してから |
| ヤオコー 川崎枡形 | [公式店舗](https://www.yaoko-net.com/store/store07/221.html) → [公式チラシWebアプリ](https://yap-pd.yaoko-net.com/app/flyer/1221/) | JavaScript画面。許可確認済の公開ブラウザDOM以外を使用しない。日次自動取得は保留 |

オーケーの週間情報は「特売」と断定しない。会員現金価格と非会員・カード払価格を混同せず、今回は後者だけを使用。野菜など掲載外価格は不明、1店舗の通常在庫も未照合。海外産を除外するなどの追加絞り込みは未実装。

## ローカル運用・費用

Node.js 24、ImageMagick 6互換 `identify` / `convert`、Tesseract 5 + `jpn` / `eng` が必要。Debian系は `imagemagick tesseract-ocr tesseract-ocr-jpn tesseract-ocr-eng` を既存のパッケージ供給元から取得可能。実測は Tesseract の公式 [tessdata_fast 4.1.0 jpn](https://github.com/tesseract-ocr/tessdata_fast/blob/a8ba5063ab8013372a20e300da0c97ee46b92b07/jpn.traineddata)（SHA-256 `1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d`）を標準英語データと併用、画像・辞書をリポジトリへ入れない。

プライベートDBを永続化し、日次タスクは重複起動禁止で `collect` を1回だけ起動する。同日再実行は前回結果を返し、疎通やOCRを重ねない。起動時に対象日を先に永続化。中断した実行は失敗として記録する。定期ジョブの本番登録は別途。

```text
node scripts/supermarket/collector.mjs collect /private/offers.sqlite
node scripts/supermarket/collector.mjs verified-import /private/offers.sqlite /private/reviewed-flyer.json
node scripts/supermarket/collector.mjs export /private/offers.sqlite /private/snapshot.json
node scripts/supermarket/preview.mjs /private/offers.sqlite 8765
```

- オーケーは通常2 GET/日（robots 1、索引1）、新号のみ同じ公式オリジンの画像を1 GET追加。期限は紙面のOCRと索引を比較し、特定の3商品枠について商品・規格・単位・非会員カード払レーン・2通りの数値OCR・8%税込の円部分を照合。税込参考は税抜から計算。読み取れない枠は除外し、全滅・レイアウト変化は取得失敗として持つ。画像バイトは一時ローカルのみ。SHA-256・版・抽出器をSQLiteに残す。固定3枠から外れた場合は自動収集対象外で、汎用全品OCRではない。版URLを再利用するサイレント修訂までは捕捉しない。
- 2026-11-20 JST、空DBで11/16–22号を取得→抽出→保存。3 GET / 23.691秒 / 3行（若鶏むね85円、銀鮭239円、ラム329円、各100g税抜・非会員カード払）。同日再実行0 GET / 19ms / 行増分0。別コマンドでDB再読取確認。画像SHA-256 `27b8b1660fc35de3ed58d0523280e6f1628aa6a279e3e31c126403f35561a05c`。新規発売号を翌週の実運用で継続読めるかは未確認。
- `verified-import` の入力契約: `{store:"ok", source, from:"YYYY-MM-DD", until:"YYYY-MM-DD", offers:[{title,spec,unit,net_yen,tax_included_sen,conditions,kind}]}`。金額は税抜整数円と税込100分の1円。 `kind` は `weekly_information` または `special`。同じ版の再投入では行が増えず、異なる値の上書きはエラー。
- ローカルDB・Node標準SQLite・決定論推薦。追加外部API・AI・有料OCRは0。クラウド配備・請求は未実測。
- ローカルパネルはPALURUの既存買い物画面を使用する。ループバックで試験用買い物リストを `shoppingApi` 契約へ渡し、実DBのチラシを合成。実アカウント接続・同期/書込み・LINE・本番スケジューラは未実施。将来のLINEは通常の買い物照会を変更せず、署名・既存家族認可を維持して `今日のスーパー` を専用トリガーとする。

### 既存Cloud Run / Schedulerでの候補

`scripts/supermarket/Dockerfile` はCloud Run Jobs用の任意パッケージ定義。既存の承認済み専用ジョブ／実行主体に限定し、`PALURU_SUPERMARKET_ENABLE_GCS=1` と許可済み `PALURU_SUPERMARKET_BUCKET` を明示したときだけ起動する。外部サービスやAPIキーは不要。Googleメタデータの実行主体を使用し、Public Access Prevention が enforced かつ Uniform Bucket-Level Access が有効な既存非公開バケットでなければ処理拒否。グローバルなIAM変更、GCS作成、ジョブ追加・起動、本番配信はこの変更単独では実行しない。

`family-supermarket/v1/claims/YYYY-MM-DD.json` を generation=0 で先取り。次に `collector-state.sqlite` と `latest.json` を既存generationと一致する場合だけ書き込む。後者を同generationで再読取し、ダイジェスト比較。同日重複は外部収集0回。DB保存後にlatest配信だけ落ちた場合、同日再実行はDBから最新JSONを修復（外部アクセス0）。旧日のlatestを新しい日に表示してはならない。既存owner専用read gatewayは同じ固定キーを読む。家族データ／チラシ原画像は格納しない。

配備前に専用の実行主体・バケット非公開設定・既存prefixへのオブジェクト作成/読取/更新と実bucketメタデータ読取・既存Schedulerの対象を確認する。構成の不足は未達として停止し、公開や権限拡張で代替しない。
