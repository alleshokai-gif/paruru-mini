# PALURU Bus P1 Position Phase 2

## 実装前契約（2026-09-12 / Asia/Tokyo）

### 問題

P1 Position Engineは正規GTFS shapeを受け取れるが、川崎市交通局の現行ODPT Static `20260701_20260828`には`shapes.txt`、tripの`shape_id`、stop timeの`shape_dist_traveled`がない。stop間の直線は道路経路を表さないため、実路線位置を判定できない。

### 調査・実証方針

1. 川崎市交通局、ODPT、市バスナビの公開リソースを確認し、外部利用条件が明確なroute geometryを優先する。
2. ODPT API v4仕様で任意項目として定義される`odpt:BusroutePattern.ug:region`を、川崎市交通局の実データで有無確認する。レスポンス全文、キー、認証URLは保存・表示しない。
3. 正規geometryが得られなければ、まず`home_to_noborito`（登05）の保存済み/追加ODPT VehiclePositionからObserved Route Corridorを研究用に生成する。
4. 市バスナビの内部JSONは教師候補の限定参照だけに使用し、corridor生成、Engine、runtime、Public APIには入れない。

### Phase 2の境界

```text
Official GTFS shape ─┐
ODPT ug:region ──────┼→ Normalized Route Geometry → Position Engine
Observed Corridor ──┘
```

Position Engineはgeometryの由来を判定ロジックから分離する。正規化後は、少なくとも`sourceType`、`sourceVersion`、`patternKey`、順序付きpoints、stop列、品質証拠を持つ。`sourceType`候補は`gtfs_shape`、`odpt_region`、`observed_corridor`。Engine出力の`method`には実際のsourceを反映する。

Observed Corridorは事業者の公開GPSを加工した**派生研究データ**であり、正規shapeとは呼ばない。構築入力はtrip_id、route_id、運行日、完全stop列、vehicle timestamp、lat/lon。patternKeyはtrip_idではなく、provider＋route_id＋方向付き完全stop列のhashとする。同じroute_idでもstop列や方向が異なる便を混ぜない。

### 入力検査

- Staticに存在し、対象route、運行日、完全stop列が一致するtripだけを採用する。Vehicle側にstartTime/raw routeId/schedule relationshipが存在する場合はStaticとの矛盾を拒否し、欠損値を作らない。
- GPS欠損、120秒超の古いGPS、5秒超の未来GPS、同一timestampの矛盾座標を除外する。
- 同一便をtimestamp順に並べ、重複点、22m/sを超える異常jump、明確な逆進を除外または便全体を不採用にする。
- raw sequence/stop_id/statusは採否の主根拠や軌跡の並び替えに使わない。
- 1便だけから本番corridorを作らない。複数便・複数日の独立coverageを記録する。

### Corridor PoC

各便の時系列点をそのまま1本の候補traceとし、異なる便の点を時間で直結しない。共通の進行軸を複数traceから構築し、局所的な外れ値を除いた代表点と横方向のばらつき（corridor幅）を保持する。停留所座標は順序anchor/検証に使えるが、stop間の道路線を生成する入力にはしない。

成立判定には少なくとも次を必要とする。

- 3運行日以上。
- 5独立便以上。主要な隣接stop区間ごとに3便以上のGPS通過証拠。
- leave-one-trip-out検証。評価対象便を学習corridorへ混ぜない。
- 高confidence判定について、同一系統・方向・十分近い参照時刻で市バスナビ区間表示と95%以上一致。
- 一致率の分母、unknown率、明確な誤判定率、区間別coverageを併記する。分母不足を95%達成と扱わない。

実装前の保存済み観測は2026-09-11の1日分だけなので、アルゴリズムPoCと当日内の分析は可能でも、複数日Acceptanceは満たさなかった。Phase 2中に2026-09-12朝の限定観測を追加した結果は後述する。

### 影響範囲

`bus/position/`のgeometry source境界、研究用collector/builder/replay、関連test、本書とDATA_VALIDATION。既存P0 Static、ETA DTO、PWA、Cloud Run公開revision、Secret設定、polling、cacheには変更を加えない。Observed Corridorは検証GOまでCloud Run image/runtimeへ同梱しない。

### 失敗時・rollback

geometry未提供、サンプル不足、区間coverage不足、逆方向/branch混入、投影曖昧、GPS鮮度/距離閾値違反では`unsupported/null`。Position Observerの失敗はP0 ETAへ伝播させない。Phase 2追加コードと任意接続だけを戻せる構造にし、Position UI Feature GateはOFFを維持する。

## 調査結果

### 正規route geometry（2026-09-12確認）

- [ODPTの川崎市バスdataset](https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines)に、この時点で表示されるresourceは`川崎市バス-20260828`のGTFS/GTFS-JP 1件。説明も時刻表データであり、別のGeoJSON/polyline/resourceは掲載されていない。
- 同GTFSを実取得して生成した既存position sidecarは8,856 trip、180 stop、34 stop chain。`shapes.txt`、tripの`shape_id`、`shape_dist_traveled`はいずれも0件。これは当該版の確認結果で、将来版まで不存在と断定しない。
- ODPT API v4仕様の`odpt:BusroutePattern`には任意の`ug:region`があるため、登録済み正規tokenでoperatorとroute patternを照会した。operator 42件が返ったが、川崎市交通局を示すoperatorをRDF結果から特定できず、既知候補2 IDへのroute pattern照会も0件、`ug:region` 0件だった。URL、token、response全文は保存・表示していない。この照会経路で提供を確認できなかったという結果であり、全ODPTデータにgeometryが存在しない証明ではない。
- [川崎市交通局の路線図](https://www.city.kawasaki.jp/820/category/4-5-1-0-0-0-0-0-0-0.html)は4エリアのPDF。人が閲覧する路線図であり、機械利用できるroute geometryのschema/API/利用条件は提示されていない。
- [市バスナビ公式案内](https://www.city.kawasaki.jp/820/page/0000039449.html)は時刻表・到着時間・リアルタイム運行状況の閲覧を案内する。一方、[市バスナビ注意事項](https://kcbn.bus-navigation.jp/wgsys/wgp/notes.htm?locale=ja)は掲載情報の無断転用等を制限し、内部JSONを公開APIとして再利用できる根拠は示していない。

したがって、**今回確認した公開catalog・公式案内・正規API照会の範囲では、本番入力に採用できる川崎市バスroute geometryを確認できなかった**。市バスナビ内部JSONは引き続き教師候補の限定参照だけとし、runtime、corridor生成、Public APIへ入れない。

### geometry source非依存化

Positionのroute indexは、同じ正規化geometry契約へ次のsourceを注入できるようにした。

1. `gtfs_shape`
2. `odpt_region`
3. `observed_corridor`

公式GTFS shapeがある場合は常に優先する。外部geometry artifactはprovider、Static hash、source version、生成日時、chain、geometry ID、座標列、`eligible`を検証する。`eligible=false`のObserved CorridorはEngineへ入らない。shapeがない状態は`route_geometry_unavailable`として安全に位置だけを抑止し、P0 ETA処理のエラーにしない。

Engineは`trip.geometry`へ投影し、内部結果に実sourceを`geometrySource`、方式を`gps_gtfs_shape_snap`または`gps_observed_corridor_snap`等で保持する。Public DTOは従来どおり`position.supported=false`、生GPS/geometry metadata非公開。UI gateもOFF。

### Observed Corridor PoC

`bus/position/observed-corridor.js`と`bus/scripts/build-observed-corridor-poc.js`を追加した。route_idと完全stop列のchain IDでpatternを分離し、別patternを混ぜない。入力はtrip_id、route_id、運行日、vehicle timestamp、lat/lon。raw sequence/stop_id/statusは一切使わない。

処理は次のとおり。

1. GPS鮮度、座標、Static trip/route、任意descriptorの矛盾を検査する。
2. 同一trip＋運行日でtimestamp順にし、重複timestamp矛盾、180秒超gap、22m/s＋20m超jumpを除外する。
3. 構築時だけ、GPSを隣接stop間の**直線anchor**へ分類する。最短距離220m以内かつ次候補との差20m以上を要求し、曖昧点は捨てる。このanchorは道路shapeでもruntime位置判定でもない。
4. 区間ごと・tripごとに時系列を保持し、明確な逆進を除く。1便が点数で多数決を取らないよう、区間を6 binへ分け、各tripの代表点から中央値を作る。
5. 3便以上が通過した区間だけ候補segmentとする。全区間がそろった場合のみ1本の候補polylineを組み、学習から1便ずつ除外するleave-one-trip-outを行う。
6. 3運行日、5独立便、全区間3便、hold-out投影95%以上・進行順100%、公式教師20組以上・一致95%以上をすべて満たすまで`eligible=false`。

stop間直線を最終geometryとして使わず、点の区間分類と不成立判定にだけ使う。道路が大きく曲がる区間や近接道路では点が多くunknownになる設計で、無理にcoverageを上げない。

### 登05・神木本町→登戸の実データ

公式route_id `10044`、表示`登０５`を対象に、既存5窓と2026-09-12 07:15:04〜07:18:43の追加1窓を解析した。追加窓は1方向だけを8回・31秒間隔で取得。API token/raw response全文は保存せず、Git ignore下の限定観測に必要項目だけを保存した。

- 全pattern合計：2運行日、14独立trip/service instance、94ユニークtrip＋timestamp GPS点。
- 同じroute_idでも完全stop列は4 pattern。captureで観測したのは3 patternで、1 patternは0件。混合していない。
- 主pattern `3210f931a9a1b9423c1259be`：菅生車庫→登戸、20 stop、神木本町はordinal 12。2日・10独立trip・80ユニークGPS点。
- 主patternの厳格分類採用は37点。43点は近接するstop区間候補を20m差で一意にできず`stop_interval_ambiguous`、1 gapを記録。
- 3便以上そろった候補区間は19区間中2区間だけ。`菅生車庫→清水台`が4便・集約polylineからの距離p95約18.6m、`長尾橋→宿河原`が3便・p95約1.1m。神木本町より上流の必要12区間では前者1区間だけ。
- 区間単位leave-one-trip-outでは、`菅生車庫→清水台`は17/17点が60m内へ投影できたが、進行順が保たれた便は3/4=75%で不合格。候補上の`previous=菅生車庫 / next=清水台 / stopsAway=11`は計算できるが、正規化Positionには採用せず`stopsAway=null`にした。
- `長尾橋→宿河原`は3/3点投影・3/3便進行順で区間検証を通ったが、神木本町通過後の区間なので今回の乗車stop向け`stopsAway`はnull。**19区間中、神木本町到着前にsupportedを返せる区間は0**。
- 全区間coverageがないためfull candidate polylineとleave-one-trip-outは生成条件未達。`geometryReady=false`、`eligible=false`。

便数とGPS総数は増えたが、広い区間へ分散しており、同じ区間を複数便が走った証拠が不足している。今回の結果からstop間を補間して全routeを作っていない。

### 市バスナビ教師候補との同時観測

保存済み6窓で登０５ markerとODPT対象vehicleを同時比較した件数は49。空間的に50m以内、GPS age -5〜120秒、次候補との差50m以上という研究用条件を満たす一意候補は22件あった。ただし市バスナビ側にODPT trip_idと同一と証明できる識別子・秒精度の位置timestampがなく、**adjudicated pairは0、公式一致率はN/A**。22件を正解扱いしていない。

2026-09-12追加窓では、市バスナビ`content`は`5, 5, 4, 3, 2, 2, 1, 1`、ODPT feed timestamp差は`31,31,31,31,31,0,31`秒。Navi markerの最近傍stopは順に堰下、堰下、堰下、向丘出張所、平橋、平橋、向丘中学校下、向丘中学校下だった。近いODPT候補との距離は約0.3〜276.7mで、feed更新が据え置かれた回や両系統の位置時点差が見える。`content`をそのままstopsAwayへ変換せず、GPS/corridor推定後の教師ラベル候補としてだけ保持する。

### 合成PoCと実路線判定

合成fixtureでは、shapeなしの3日・6独立service instance・全3区間各6便をObserved Corridorへ変換し、leave-one-trip-out投影100%、進行順100%、教師19/20=95%で`eligible=true`になることを確認した。注入後のEngineは`gps_observed_corridor_snap`を返し、GTFS shapeが同時にあれば公式shapeを優先する。

これはアルゴリズム境界の試験であり、川崎実路線の精度証明ではない。実データはfull corridor未生成、教師分母0なので、高confidence 95%を算出できない。

## 現在の判定

|項目|結果|
|---|---|
|正規route geometry|今回の公開/正規経路では確認できず。全将来sourceの不存在は未確定|
|Observed Corridorの構築境界|実装済み、合成試験PASS|
|登05主patternの実GPS|2日・10便・80点、厳格採用37点|
|区間coverage|3便以上2/19、hold-out通過1/19。神木本町上流でhold-out通過0/12|
|leave-one-trip-out|実データは全区間未達のため未実施|
|市バスナビ公式一致率|N/A（adjudicated pair 0）|
|Position Engine source独立|PASS。GTFS shape/ODPT region/Observed Corridorを同一境界で扱う|
|P0 ETA/Public DTO|回帰PASS、変更なし|
|Position UI|**OFF維持**|
|Phase 2 GO|**NO-GO（データ精度Acceptance）**。収集・教師label確定を継続|

次は主patternの未coverage区間を中心に3日目以降を収集する。全区間を単一長時間観測で埋めるのではなく、各区間3独立便を満たすまでcoverage表を更新する。その後、実データleave-one-trip-outを実行し、同一trip/timeを確証できる市バスナビ教師組だけで一致率を算出する。内部endpointをruntime利用する変更、本番deploy、UI gate変更は行わない。

## テスト・変更範囲

- Bus：`npm test` **75/75 PASS**。既存P0 DTO 13 scenario、Node HTTP/CORS/cache/fallback、Position P1、新規geometry source注入・優先順位・Observed Corridor gateを含む。
- Repository：`node --test test/*.test.js` **84/84 PASS**。Bus UIの30秒polling、visibility復帰、stale/fallback、Position Gate OFFを含む。
- Secret scan：**359対象・一致0**。`.dev.vars`、観測JSON、corridor/reference生成JSONはGit ignoreを確認。
- 新規/変更JavaScriptの`node --check`、追跡差分の`git diff --check` PASS。
- Bus testとSecret scanの最初の実行では、sandboxがesbuild/Repository親を読めず失敗した。同一コードを通常権限で再実行しPASSしており、本体失敗と混同しない。

Phase 2で追加した主なファイルは`bus/position/observed-corridor.js`、`bus/scripts/build-observed-corridor-poc.js`、`bus/scripts/analyze-position-reference-phase2.js`、本書。`geometry.js`、`route-index.js`、`engine.js`、`runtime/position.js`、`observe-position-p0.js`、`position.test.js`、`package.json`を限定変更した。既存P1 Positionの未commit差分と同じ作業tree上にあり、commit/pushは実施していない。
