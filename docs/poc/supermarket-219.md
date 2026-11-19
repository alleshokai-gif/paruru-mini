# #219 スーパー特売・献立 PoC

**問題・方針**: 6店の刊行経路が異なり、公開表示は自動取得許可や価格・在庫の完全性を意味しない。承認済みソースだけ既存スケジューラから1日1回確認し、元資料の識別子が変わる場合だけ抽出・目視照合へ回す。価格確認と献立ルールは決定論的に扱い、有料AI/OCRは必須にしない。

**影響・副作用・戻し方**: 家族リストの認可・書込・LINEには変更なし。PALURU買い物表示部品をループバック限定のプレビューで再利用。ローカルSQLiteのみ作成。既存のスケジューラへの登録はPoC検証後の別操作。無効化は日次呼出しの停止、またはローカルプレビューの終了（既存データ不変）。

**受入**: 当日の公式資料を画面で照合し、価格・単位・期間と元資料をSQLiteに保存／再読取。更新なし、期限切れ、取得失敗、他店の継続、同一資料再実行を区別。PALURUブラウザで3案・店舗・部分価格の注記と未購入リストの共存を確認。

## 6店の取得方針

| 店舗 | 第一候補・観測 | PoC採用・保留理由 |
| --- | --- | --- |
| オーケー 溝ノ口 | [店舗](https://ok-corporation.jp/shop/mizonokuchi.html) → [公式週間商品情報](https://ok-corporation.jp/flyer/) の関東版、対象外店舗表記あり | 1日1回の索引・robots確認。11/16–22号のスキャンPDFを目視抽出。robots 404確認。本文画像をDB・リポジトリへ再配布しない |
| イトーヨーカドー 溝ノ口 | [公式店舗](https://stores.itoyokado.co.jp/detail/521/) → [はとベース掲載一覧](https://promo.hatobase.jp/flyers/00521/new)、11/18–22の公開閲覧ページ | 公開ブラウザ閲覧。提供側の規約・robots・画像再利用を確認してから定期取得候補。非公開API使用なし |
| マルエツ 川崎坂戸 | [公式店舗検索](https://www.maruetsu.co.jp/index.php/shop/) | 調査時403、店舗固有のチラシ経路未確認。回避せず保留 |
| ライフ 溝口 | [公式店舗](https://store.lifecorp.jp/detail/east648/) → [公式ページ組込みトクバイ](https://widgets.tokubai.co.jp/224224/leaflet_widget) | [トクバイ利用規約](https://kufu.jp/terms/tokubai)／[ライフの利用条件](https://www.lifecorp.jp/about_use.html) を確認の上、正式許可または手動参照から。非公開API・画像転載なし |
| そうてつローゼン たいら | [公式店舗](https://www.sotetsu.rosen.co.jp/shopdetail?scode=0032) → 画像/PDFビューア候補 | 現在号・更新頻度・条件未確定。公式リンクの更新識別子を検証してから |
| ヤオコー 川崎枡形 | [公式店舗](https://www.yaoko-net.com/store/store07/221.html) → [公式チラシWebアプリ](https://yap-pd.yaoko-net.com/app/flyer/1221/) | JavaScript画面。許可確認済の公開ブラウザDOM以外を使用しない。日次自動取得は保留 |

オーケーの週間情報は「特売」と断定しない。会員現金価格と非会員・カード払価格を混同せず、今回は後者だけを使用。野菜など掲載外価格は不明、1店舗の通常在庫も未照合。海外産を除外するなどの追加絞り込みは未実装。

## ローカル運用・費用

Node.js 24。同じ作業用ディレクトリ・プライベートDBを使用し、日次タスクは重複起動禁止で `collect` を1回だけ起動する。PoCでは定期ジョブを登録していない。

```text
node scripts/supermarket/collector.mjs collect /private/offers.sqlite
node scripts/supermarket/collector.mjs verified-import /private/offers.sqlite /private/reviewed-flyer.json
node scripts/supermarket/collector.mjs export /private/offers.sqlite /private/snapshot.json
node scripts/supermarket/preview.mjs /private/offers.sqlite 8765
```

- 取得はオーケー公式オリジンに最大2 GET/日（robots 1、索引1、失敗時再試行なし）。公開PDFを人が新規版のみ開き、商品・規格・単位・税抜価格・紙面税込価格・支払条件・有効期間を外部ファイルへ記録してインポートする。自動OCRは未導入。新しいURLは価格照合待ち、同じURLは更新なし。版URLを再利用するサイレント修訂までは捕捉しない。
- `verified-import` の入力契約: `{store:"ok", source, from:"YYYY-MM-DD", until:"YYYY-MM-DD", offers:[{title,spec,unit,net_yen,tax_included_sen,conditions,kind}]}`。金額は税抜整数円と税込100分の1円。 `kind` は `weekly_information` または `special`。同じ版の再投入では行が増えず、異なる値の上書きはエラー。
- ローカルDB・Node標準SQLite・決定論推薦。追加外部API・AI・有料OCRは0、承認画像の確認は手動。クラウド配備・請求は未実測。
- ローカルパネルはPALURUの既存買い物画面を使用する。ループバックで試験用買い物リストを `shoppingApi` 契約へ渡し、実DBのチラシを合成。実アカウント接続・同期/書込み・LINE・本番スケジューラは未実施。将来のLINEは通常の買い物照会を変更せず、署名・既存家族認可を維持して `今日のスーパー` を専用トリガーとする。
