# ぽぴお 動物病院選定・医療アクセス基盤 v2

調査日・最終確認日: 2026-08-24

対象: ミニチュアダックスの子犬「ぽぴお」

基準地点: 神木本町2丁目代表地点（個人宅の正確な位置ではない）

## 先に結論

病院を1院に固定せず、役割別の医療アクセスとして持つ。

| 役割 | 主候補 | 補完 |
|---|---|---|
| 日常・予防 | みやまえだいら動物病院を試行 | 最寄りの鈴木ペットクリニックと比較 |
| 近隣の整形・IVDD | ルート動物病院 | 初期評価と紹介条件を確認 |
| 整形・神経 | 青葉どうぶつ医療センター | 横浜青葉どうぶつ病院も比較 |
| 夜間初期救急 | 川崎市獣医師会 夜間動物救急センター | 入院不可のため次段を用意 |
| 24時間・入院 | アニマルメディカルセンター | 電話・空床・費用を都度確認 |
| 高度医療 | JARMeC川崎本院 | 紹介制で救急外来ではない |

## v2で変えたこと

v1はiPet公式検索を一般診療候補の入口にしていたため、母集団にselection biasがあった。v2は地理を先に探索し、iPetをあとからInsurance属性として付与する。

- 対象5区: 川崎市宮前区・高津区・多摩区、横浜市青葉区・都筑区
- Google Maps、川崎市獣医師会、横浜市獣医師会、横浜市公開一覧を照合
- 既存25院を全件保持
- 新規110院を追加し、総数135院
- 件数上限なし
- iPet非確認を除外理由にしない
- 眼科・歯科・皮膚・予防等は専門特化Providerとして分離保持
- 夜間・高度・二次診療の既存遠方候補を保持

詳細な差分・件数・重複分類は [`population-v2-audit.md`](population-v2-audit.md) を参照。

## 母集団の集計

### iPet

| 状態 | 件数 |
|---|---:|
| 窓口精算 | 81 |
| 非窓口精算を明示確認 | 0 |
| 要確認 | 54 |

「iPet検索に見当たらない」は `needs_confirmation` とし、非対応とは推測していない。

### エリア

| エリア | 件数 |
|---|---:|
| 宮前区 | 20 |
| 高津区 | 15 |
| 多摩区 | 21 |
| 青葉区 | 44 |
| 都筑区 | 29 |
| 上記以外の特殊医療候補 | 6 |
| 合計 | 135 |

### 距離帯

| 距離帯 | 件数 |
|---|---:|
| 0〜1km | 3 |
| 1〜3km | 18 |
| 3〜5km | 44 |
| 5〜7km | 30 |
| 7km超 | 40 |

既存25院はGoogle Maps経路表示の距離・時間を保持する。新規110院は直線距離と計画用車時間概算であり、経路検索値ではない。

既存保持対象の大学病院2院は45分を超えるため、30〜45分圏と混同せず `retained_existing_special_over_45_min` で保持する。

## データ品質の分離

### 事実として保持

- 公式病院サイト、保険会社、獣医師会、行政一覧の公開情報
- Google Mapsの所在地・座標・評価・件数の確認時スナップショット
- Caloo等で実際に確認できた表示値

### AI評価

- 役割別適性
- スコア
- Positive／Negative／Cross-source Signal
- 追加調査の優先度

### 未確認

新規院の診療時間、日祝、駐車場、医療設備、入院、手術、整形、神経、IVDD等は、確認できていないものを `null`／不明のまま保持した。病院名や口コミ★から推測補完していない。

Local Reputationは医療品質点に加えない。実受診Experienceは独立した空配列を全院に用意している。

## スコアv2

### Reputation Score

Google・Calooの評価と件数を使い、事前平均4.2、事前件数20のBayesian Averageで少数口コミの高評価を抑制する。

### Home Doctor Score

- Reputation 35%
- Accessibility 35%
- Availability 20%
- iPet利便性 5%
- 基本医療 5%

### Overall Score

- Home Doctor 30%
- Medical Capability 20%
- Dachshund 15%
- Emergency 15%
- Reputation 15%
- iPet利便性 5%

iPetは医療能力に加点しない。核心証拠がない能力スコアは `null`、部分確認できた能力スコア内の未知項目は中立50とする。Overallでも `null` 項目を算術上の中立50として扱う。最終判断をOverallだけで決めない。

## Web表示

[`index.html`](index.html) を直接開くか、ローカルHTTPサーバーから表示する。

表示機能:

- 役割別推薦7院
- 深掘り済みTOP8
- 全135院の一覧
- iPet状態ボタン
- 車10分／20分、日祝、夜間、整形神経、IVDD、高度医療の複合フィルタ
- 8種類の並び替え
- 一覧と同じフィルタが反映されるMAP
- 病院詳細、電話、Google Maps、公式サイト
- Google My Maps用CSV

一覧とMAPは [`web-data.js`](web-data.js) の同じ病院配列を参照する。表示用データは [`hospitals.json`](hospitals.json) から生成する。

## ファイル

| ファイル | 用途 |
|---|---|
| [`index.html`](index.html) | スマホ・PC向け静的ビュー |
| [`hospitals.json`](hospitals.json) | PALURU連携を考慮した全135院の正規化データ |
| [`hospitals.schema.json`](hospitals.schema.json) | v2 JSON Schema |
| [`population-v2-source.json`](population-v2-source.json) | 候補抽出Raw Data・別名分類・ソース別一覧 |
| [`population-v2-audit.md`](population-v2-audit.md) | 母集団再構築・差分監査 |
| [`comparison.md`](comparison.md) | 比較上の読み方と新規注目候補 |
| [`top-candidates.md`](top-candidates.md) | 深掘り済みTOP8 |
| [`review-signals.json`](review-signals.json) | v1深掘り対象の口コミSignal |
| [`web-data.js`](web-data.js) | 直接HTMLを開くための表示用データ |
| [`popio-vet-map.csv`](popio-vet-map.csv) | Google My Mapsインポート用 |
| [`build-v2-data.mjs`](build-v2-data.mjs) | Raw＋既存25院からv2 JSONを再現 |
| [`build-v2-web-data.mjs`](build-v2-web-data.mjs) | JSONからWeb Data／CSVを生成 |
| [`verify-v2.mjs`](verify-v2.mjs) | 件数・保持・フィルタ構造・再現性検証 |

## 受診前の注意

- 当日の受付可否、担当医、空床、保険適用は要確認。
- 口コミは医療品質を直接保証しない。
- 新規院の車時間は計画用概算で、実走・渋滞により変わる。
- JARMeC川崎本院は紹介制二次診療で救急外来ではない。
- 川崎市獣医師会 夜間動物救急センターは入院不可。
- 歩行異常・麻痺疑いではページの点数だけで待機判断せず、病院へ電話する。

## 主な一次情報

- [iPet対応動物病院検索](https://www.ipetclub.jp/vh/)
- [川崎市獣医師会 病院一覧](https://www.k-vma.com/member-map/)
- [横浜市獣医師会 青葉区](https://yvma.or.jp/hospital/index.html)
- [横浜市獣医師会 都筑区](https://yvma.or.jp/hospital/tsuzuki.html)
- [横浜市 動物病院公開一覧](https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/pet-dobutsu/aigo/kainushi/kyokenbyo.files/0062_20260401.pdf)
- [Google Maps](https://www.google.com/maps)
- [基準地点の町丁目代表点](https://geoshape.ex.nii.ac.jp/ka/resource/14/14136524002.html)

公開・デプロイ、PALURU API、GAS、PWA、Spreadsheetには変更を加えていない。
