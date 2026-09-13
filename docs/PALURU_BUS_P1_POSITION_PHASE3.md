# PALURU Bus P1 Position Phase 3

## 状態

- フェーズ: Architecture / PoC
- Public Position UI: `OFF`
- 本番デプロイ: 対象外
- 最初の実路線: 登05 神木本町 → 登戸
- 最終更新: 2026-09-12 (Asia/Tokyo)

## 問題

川崎市交通局の現行Static GTFSには `shapes.txt` と `shape_id` がない。停留所座標を直線で結ぶだけでは、折返し、近接道路、上下線を区別できず、停留所間を安全に判定できない。

Phase 2のObserved Corridor PoCでは、登05の主パターンについて複数日・複数便のGPSを取得したが、神木本町到着前の十分な区間カバレッジと公式表示との同時刻・同一便比較が不足している。このため生成corridorは `eligible=false` のままである。

## 修正方針

Position Engineはgeometryの取得元を知らず、検証済みのgeometry artifactを優先順位で選ぶ。

```text
1. gtfs_shape
2. official_odpt_geometry
3. validated_road_geometry
4. observed_corridor
```

存在しないsourceはskipする。`shape_missing` はエラーにせず `route_geometry_unavailable` とする。川崎ProviderはVehicle GPSをNormalizeするだけとし、道路探索や停留所間判定を持たせない。

`validated_road_geometry` は、利用条件を確認した道路データからbuild時に生成し、次の証拠をartifactに含める。

- source名・version・取得日
- license / attribution識別子
- 対象provider / route / stop chain
- 各隣接停留所間のpolyline
- GPS validationの便数・service day数・点数
- routeからの距離分布
- stop順序・進行方向の検証結果
- holdout結果
- `eligible`

外部の道路探索APIをCloud Run runtimeから呼ばない。Web画面内部endpointや利用条件が不明なendpointを使用しない。

## GPS validation

道路geometryを正解扱いしない。trip patternとdirectionを固定し、ODPT VehiclePositionの連続GPSで次を検証する。

1. stale・欠損・未来時刻・不可能ジャンプを除外する。
2. 同一service instance内で前進する連続点を使う。
3. 各点を候補geometryへ投影し、距離と進行方向を測る。
4. 近接する別道路へ投影が分岐する場合はambiguousにする。
5. trip単位holdoutで過学習を検出する。
6. 市バスナビは同時刻・同一便の答え合わせだけに用い、runtime入力にはしない。

最初の対象は登05 神木本町→登戸であり、神木本町到着前を含む全停留所間、複数便、複数service dayを必要とする。

## 影響範囲

- `bus/position/`: geometry source選択、道路候補validation
- `bus/scripts/`: build時だけ動く道路geometry生成・検証
- `bus/generated/`: Git非管理の検証artifact
- Public DTO / PWA DOM / Position Feature Gate: 変更しない
- P0 ETA / polling / cache / stale fallback: 変更しない

## 副作用とfail-safe

- geometryがない、古い、static hash不一致、GPS証拠不足なら `supported=false`。
- wrong road、逆方向、stop順序不一致、holdout不足なら `eligible=false`。
- 生lat/lonはPublic DTOへ出さない。
- 市バスナビ内部JSON endpointは検証専用であり本番依存にしない。

## ロールバック

追加するgeometry artifactをloaderから外し、既存の `route_geometry_unavailable` 経路へ戻す。Public UIがOFFのため、P0 API/UIの表示契約は変えない。

## 実装前Acceptance

- geometry sourceの優先順位が上記4種類で固定される。
- source欠損を正常なunsupportedとして扱う。
- 道路候補がstop順序と方向に一致する。
- route外GPS、近接別道路、逆方向をrejectする。
- GPS stale / 欠損 / jumpをrejectする。
- 高confidence判定は同一便の公式表示と照合できる。
- 神木本町到着前を含む全区間を複数便・複数日で評価する。
- P0/P1回帰testがPASSする。
- Position UIはOFF、生GPSはPublic DTOへ非露出。

## 現在の証拠

Phase 2時点の登05主パターンは2 service day、10 independent trip、80 unique GPS点を持つ。一方、strict採用は37点、神木本町到着前で成立したintervalは0/12、公式同時比較pairは0件である。したがってPhase 3開始時点のPublic Position判定は `NO-GO / OFF維持` である。

## Geometry source調査結果

2026-09-12に公式・一次資料を限定調査した。

|候補|確認結果|今回の扱い|
|---|---|---|
|現行川崎市GTFS / ODPT|P0対象版に`shapes.txt`と`shape_id`なし。ODPTの川崎市dataset catalogにも別のroute geometry配布を確認できなかった|`gtfs_shape` / `official_odpt_geometry`は欠損としてskip|
|国土数値情報 N07 バスルート|2022年、version 2.0。バス運行会社単位の経路データであり、個別系統の正解shapeではない|川崎市交通局の道路networkとの整合を確かめる公的road mask|
|OpenStreetMap route relation|登05のrelation 7109917を確認。version 14、39 way、停留所/platform memberを含む|方向別の道路候補。ODPT GPSとN07でbuild時検証し、raw APIをruntimeから呼ばない|
|市バスナビ内部JSON|公開再利用許諾を確認できない|公式表示との同時比較だけ。runtime / artifact生成入力にしない|

参照資料：

- [国土数値情報 N07 バスルートデータ](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html)
- [国土数値情報 利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement_01.html)
- [OpenStreetMap 登05 relation 7109917](https://www.openstreetmap.org/relation/7109917)
- [OpenStreetMap attribution guideline](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
- [OpenStreetMap API Usage Policy](https://operations.osmfoundation.org/policies/api/)
- [ODPT 川崎市交通局 dataset](https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines)

国土数値情報は出典表示と加工表示を伴う利用が可能で、CC BY 4.0互換の扱いが案内されている。OpenStreetMapはODbLとattribution条件がある。Public OSM APIは編集APIであり、大量・頻繁なread-only runtime利用を前提にしない。今回のPoCは必要なrelationをbuild時だけ取得し、生成artifactをGit・Docker・Cloud Runへ入れていない。OSM由来artifactを将来配布する前に、派生database該当性と表示attributionを改めて確認する。

## 登05 road geometry PoC結果

`npm run probe:road:poc`と`npm run build:road:poc`で、神木本町→登戸の候補geometryを再生成した。Secret、ODPT raw全文、市バスナビ内部response全文は保存していない。

- candidate id: `3210f931a9a1b9423c1259be`
- source version: `osm:7109917:v14+mlit:n07:2022`
- 生成artifact: 13,534 bytes、281 point、39 way、way接続gap 0
- N07川崎市交通局line: 648本。281/281 pointが60m以内、match rate 1.000、p95距離4.88m
- GTFS stop: 20/20を候補へ投影、最大距離8.46m。ただし複数の競合投影pathが残り`stop_projection_ambiguous`
- ODPT GPS: 80点中79点が60m以内、match rate 0.9875、p95距離44.58m、最大44.85m
- service day: 2日、independent trip: 10、進行方向が単調なtrace: 10/10

19区間の独立trip coverageは次のとおり。

```text
1,2,2,2,2,3,3,3,3,1,2,1,0,1,0,3,3,2,2
```

神木本町→神木不動と五所塚→切通し上の2区間は0件で、全区間3便以上を満たさない。市バスナビの同一便・同一位置時刻に確証がある比較pairも0件で、一致率はN/Aである。

検証器は次を理由に`geometryReady=false`、`eligible=false`を返した。

```text
stop_projection_ambiguous
service_days_insufficient
segment_coverage_insufficient
official_reference_insufficient
```

N07整合、GPS距離、10/10の進行方向は候補の有力な補強証拠である。ただし道路候補を正解shapeへ昇格する証拠ではない。生成物は`bus/generated/road-geometry-home-to-noborito.json`に置き、既存ignore下のローカル検証artifactとして保持する。

## 実装結果

- `bus/position/route-index.js`の優先順位を`gtfs_shape`、`official_odpt_geometry`、`validated_road_geometry`、`observed_corridor`へ固定した。
- `bus/position/road-geometry.js`でrelation way連結、stop順序、N07整合、GPS距離、方向、全区間coverage、公式reference gateを判定する。
- `bus/scripts/probe-road-sources.js`と`build-road-geometry-poc.js`はbuild時専用。Cloud Run runtimeに外部道路API依存を追加していない。
- wrong road、逆方向、証拠不足をrejectする試験を追加した。

## Position Acceptance

Architecture / candidate build PoCは成立した。一方、神木本町到着前を含む全区間3便以上・3 service day以上・公式比較20 pair以上を満たさないため、Public Positionは`NO-GO`である。Position Feature Gateは`OFF`、Public DTOの`position.supported=false`、生GPS非露出を維持する。

## 最終検証

- `npm run build:position`：PASS。1,316,509 bytes、8,856 trip、180 stop、34 chain、公式shape 0。P0 artifactとsource version/hash一致。
- Bus `npm test`：94/94 PASS。road geometry、Position、Departure Persistence、Cloud Run runtimeを含む。
- Repository `node --test test/*.test.js`：85/85 PASS。
- `npm run check:static`：PASS。3,134,559 bytes、P0 4方向660 / 3,820 / 660 / 3,716 trip。
- `npm run check:secrets`：383対象、token一致0。
- `git diff --check`：PASS。

Cloud Run相当のWindows Node processで正規ODPTを使ったローカル受入は4方向×3便、health、production CORS、25秒cache、Secret非露出をPASSした。process起動→health 377.72ms、初回278.42ms、cache hit 7.62〜13.52ms、cache更新109.05ms。初回のODPT fetch 247.40ms、decode 16.11ms、Position抑止処理0.54〜1.70ms、JOIN 3.78〜9.65ms、response 8,139 bytes、RSS 81.10〜97.69MB。Position処理値はshapeなしの早期抑止経路であり、validated geometryをruntimeへ接続した性能ではない。

本番deploy、Public Position UI、Android実機受入は今回実施していない。
