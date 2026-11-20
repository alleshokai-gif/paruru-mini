# 全紙面の私有観測データ（#219、受入途中）

`scripts/supermarket/whole-flyer.mjs` は、取得許可を確認して私有保存した原本の全ページを処理するローカルCLI。商品・食品・献立候補の許可リストは使わない。既存Collector、公開snapshot、推薦、買い物リスト、LINEの実行経路はこの追加では変更しない。

```sh
node scripts/supermarket/whole-flyer.mjs manifest.json private-new-run
node scripts/supermarket/whole-flyer.mjs --resume manifest.json private-new-run private-resumed-run
node scripts/supermarket/whole-flyer.mjs --reindex private-resumed-run private-reindexed-run
```

既存OCRイメージ内のImageMagick/TesseractとNode SQLiteを使用する。ネットワーククライアント、外部モデル、認証情報は不要。原画像はGitや公開成果物に含めない。出力先は毎回新規ディレクトリにする。再開は同じmanifest/image hashで成功passを再利用し、失敗したpassだけ読む。再分類は保存したOCR語・座標のみを使用し、原本の再取得やOCRを行わない。独立目視の正解データは入力しない。

各面は全頁PSM11（長辺最大4000px、座標を原寸へ戻す）と、1600px/320px重なりの元解像度全域タイルで読む。SQLiteとgzipには、全OCR語、passと実装hash、ページ・面・原本座標、出典・image hash、数値候補、近傍ラベル・単位・税・条件・日付の読取候補を保持する。後半passが失敗しても既読データは残し、`page_partial`と失敗passを記録する。

**全域を読めたことと、全商品を正しく構造化したことは別。** 数値候補には日付、容量、ポイント、誤読が含まれる。近傍ラベルとの対応、商品別の期限、税・単位・会員条件は未検証であり、全候補を`needs_review`にする。確定価格や商品名に昇格せず、推薦や公開DTOへ流さない。掲載SKUの分母、欠落数、recall、価格/単位精度が不明ならnullのまま保持する。全画素の処理率を商品抽出率と呼ばない。

2026-11-20のローカル検証では、公式オーケー11/16–22号PDF（物理1ページ、表裏2論理面）を全域処理した。2面各13pass、数値候補220/239、構造化商品の完全確定0。食品以外も処理対象。これは私有観測層の証拠であり、#219の全商品抽出・全件原本突合・日次本番DB/read-backの受入完了ではない。既存の固定3商品は疎通試験として残っており、全掲載商品抽出の成果に算入しない。
