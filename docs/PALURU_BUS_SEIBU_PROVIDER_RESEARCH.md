# PALURU Bus P2.4 西武バス Provider 調査

## 1. 目的と判定境界

立川駅北口から昭和第一学園方面、および昭和第一学園・昭和第一学園西門から立川駅北口方面を、正規データだけで PALURU Bus の共通 Arrival Model へ変換できるか確認した。

- 調査・実データ観測日時: 2026-09-14 JST
- 実装対象: Static GTFS/GTFS-JP と GTFS-Realtime
- 使用しないもの: HTML スクレイピング、公式バスロケの内部 endpoint、NAVITIME 内部 endpoint
- Public Position UI: OFF
- Public departure prediction: OFF
- 本番 deploy: このフェーズでは行わない

## 2. 正規データ経路

| データ | 正規経路 | 今回の実証 | 採用 |
| --- | --- | --- | --- |
| GTFS/GTFS-JP | 公共交通オープンデータセンターの[西武バス バス関連情報](https://ckan.odpt.org/dataset/seibu_bus__b-bus_gtfs) | ZIP を取得し、`stops.txt`、`routes.txt`、`trips.txt`、`stop_times.txt`、`calendar.txt`、`calendar_dates.txt`、`feed_info.txt` を結合 | 採用 |
| GTFS-Realtime TripUpdates | ODPT `SeibuBus_trip_update` | Protocol Buffers を取得・decode。対象便で stop event の time/delay を観測 | 採用 |
| GTFS-Realtime VehiclePosition | ODPT `SeibuBus_vehicle` | 対象便の lat/lon、timestamp、current_stop_sequence、stop_id を観測 | 内部保持のみ |
| ODPT JSON BusroutePattern / BusstopPole / Bus | ODPT API v4 | 正式名称・停留所列・運行車両を補助照合 | 調査証拠。runtime の主経路には不採用 |
| ODPT JSON BusstopPoleTimetable / BusTimetable | ODPT API v4 | 対象 Pole の直接取得を試みたが、今回の照会条件では timetable を確定できなかった | 不採用 |
| 西武バス公式バスロケ | [経路検索・バス位置情報検索機能](https://www.seibubus.co.jp/rosen/busnavi-annai/) | リアルタイム運行情報と地図上の位置表示が公式に案内されている | runtime 不採用 |

ODPT カタログ上、Static は GTFS/GTFS-JP、Realtime は Protocol Buffers 形式で公開され、いずれも公共交通オープンデータ基本ライセンスが指定されている。西武バスと公共交通オープンデータ協議会の[2021年リリース](https://www.seibubus.co.jp/news/uploads/1ff3d5aeb0704e5240a85b23fa178bd756967cf6.pdf)でも、GTFS-Realtime のバスロケーションデータ提供開始が明示されている。

## 3. Static GTFS 実データ

観測した feed は次のとおり。

| 項目 | 値 |
| --- | --- |
| publisher | 西武バス |
| feed_version | `20260824` |
| 有効期間 | 2026-09-01〜2026-10-31 |
| ZIP size | 4,287,847 bytes |
| stops | 4,038 |
| routes | 386 |
| trips | 28,945 |
| stop_times | 530,296 |
| `shapes.txt` | なし |
| 対象 trip | 立川発 657、学校発 654 |

Static の有効期限外は fail closed とし、古い時刻表を表示しない。生成 artifact は最新 GTFS から再生成する。

## 4. 正式 stop ID と乗り場

名前一致では決めず、対象 trip の stop 列、stop_sequence、route、platform_code を結合して確定した。

### 立川駅北口

| GTFS stop_id | 用途 | platform_code |
| --- | --- | --- |
| `70131-05-09` | 立川発 | 6 |
| `70131-03` | 立川発 | 7 |
| `70131-08` | 立川発の別標柱 | 7 |
| `70131-06` | 立川発 | 8 |
| `70131-01` | 立川発 | 9 |
| `70131-15` | 立川着 | なし |

### 昭和第一学園周辺

| GTFS stop_id | 用途 | 停留所名 |
| --- | --- | --- |
| `70191-01-03-05` | 立川発便の降車側 | 昭和第一学園 |
| `70191-02` | 立川方面の乗車側 | 昭和第一学園 |
| `70181-01` | 立32 の降車側 | 昭和第一学園西門 |
| `70181-02-15` | 立32 の立川方面乗車側 | 昭和第一学園西門 |

ODPT JSON BusstopPole でも `SeibuBus.Tachikawaekikitaguchi.70131.*`、`SeibuBus.ShowaDaiichiGakuen.70191.*`、`SeibuBus.ShowaDaiichiGakuenNishimon.70181.*` 系の pole を照合した。runtime JOIN は GTFS の stop_id を正本とする。

西武バスの[学校来校者向け公式案内](https://www.seibubus.co.jp/news/uploads/a0a2964a7d1e87d758739161e7f6757d70f20e64.pdf)は、立川駅北口 6〜9番の全乗り場から学校方面へ利用できると案内している。個々の便・系統と標柱の対応は、案内図の要約ではなく現行 GTFS を正本にした。

## 5. 正式 route と方向

| route_id | 系統表示 | 立川発乗り場 | 学校側 | 立川方面の逆方向 |
| --- | --- | --- | --- | --- |
| `251001` | 立34 | 7 | 昭和第一学園 | あり |
| `251006` | 系統番号なし | 7（別標柱） | 昭和第一学園 | あり |
| `251009` | 立34-1 | 7 | 昭和第一学園 | あり |
| `301002` | 立37 | 6 | 昭和第一学園 | あり |
| `301004` | 立35 | 6 | 昭和第一学園 | あり |
| `301008` | 立36 | 6 | 昭和第一学園 | あり |
| `302001` | 立40 | 9 | 昭和第一学園 | あり |
| `306001/309007` | 立39 | 8 | 昭和第一学園 | あり |
| `306002` | 立38 | 8 | 昭和第一学園 | あり |
| `306004-1` | 深夜 | 8 | 昭和第一学園 | 対象 feed ではなし |
| `306009/309008` | 立45 | 8 | 昭和第一学園 | あり |
| `306010` | 立33 | 8 | 昭和第一学園 | あり |
| `307003` | 立32 | 9 | 昭和第一学園西門 | あり |

`251006` は現行 GTFS の `route_short_name` が空欄である。PALURU は系統を作らず、明示的に「系統番号なし」と表示する。

## 6. GTFS-Realtime 実観測

同一時点の feed で TripUpdates 326 entity、VehiclePositions 326 entity を観測した。P2.4 対象はそれぞれ 17 entity だった。

| 項目 | 対象17件での観測 |
| --- | --- |
| TripUpdates `trip_id` / `route_id` | あり |
| 対象 stop の arrival/departure `time` または `delay` | 11件 |
| VehiclePosition lat/lon | 17件 |
| VehiclePosition timestamp | 17件 |
| `current_stop_sequence` / `stop_id` | 17件 |
| `current_status` | 0件 |
| TripDescriptor `start_date` | 0件 |

Static scheduled を正本にし、対象 stop の同一 event に対して `time` を優先し、`delay` のみなら `scheduled + delay` を使う。`estimatedDeparture`、`etaMinutes`、`delayMinutes` は新鮮な RT が一意に結合できた場合だけ返す。`start_date` が観測できなかったため、trip_id/route_id の一致に加えて時刻の妥当範囲を設け、別日データの誤結合を抑止する。

VehiclePosition の GPS は Internal Vehicle Model に保持するが、`current_status` 欠損と `shapes.txt` 不在のため stopsAway を生成しない。Public DTO は `position.supported=false` とし、生 GPS、vehicle ID を公開しない。

## 7. 利用条件

[公共交通オープンデータ基本ライセンス](https://developer.odpt.org/terms/data_basic_license.html)では、ライセンスとガイドラインに従う成果物の公開、および営利・非営利利用が許可されている。一方、元データや復元可能な派生データを第三者が再利用できる形で再配布することは、個別条件または事前承認がない限り禁止される。

[開発者ガイドライン](https://developer.odpt.org/terms/data_basic_use_guideline.html)に従い、PALURU では次を守る。

- 動的データの取得時刻・鮮度を扱い、古い RT を Realtime と表示しない。
- Static の取得日時を利用者が確認できる場所へ表示し、更新通知後は定められた期間内に更新する。
- データ提供元、精度・完全性が保証されない旨、アプリ問い合わせ先を表示する。
- API token は server secret に限定し、PWA、API response、Git、ログへ出さない。
- GTFS ZIP、全 stop_times、復元可能な派生データを Public API へ配布しない。

判定は次のとおり。

| 観点 | 判定 |
| --- | --- |
| 技術的に取得可能 | GO |
| 公開アプリでの利用 | 基本ライセンス・ガイドライン遵守を条件に GO |
| 商用利用 | 基本ライセンス・ガイドライン遵守を条件に GO |
| 元データ・復元可能な派生データの再配布 | NO-GO（個別条件または書面承認なし） |
| PALURU の必要最小 Arrival DTO | 本番候補。remote Acceptance 前は未公開 |

## 8. Provider 境界

`providers/seibu/` が次を担当する。

- Static GTFS 取得・検証・P2.4 artifact 生成
- calendar/calendar_dates による運行日判定
- TripUpdates / VehiclePosition の取得・decode
- route、stop、platform、attribution の西武固有解釈
- Static + RT JOIN と共通 Arrival Model への変換
- 25秒の Provider 単位 RT cache
- RT 障害時の `static_fallback`

Hub Core は `provider=seibu` の Arrival を受け取り、既存の validation、ranking、provider 障害分離だけを行う。Hub Core に西武固有 route/stop 条件は追加していない。

## 9. 欠損・例外

- `shapes.txt` がないため Position UI は解禁しない。
- RT は全便・全停留所で予測 event が埋まるとは限らない。欠損時は `static_fallback` とし、ETA/delay を null にする。
- 観測時は `current_status` と TripDescriptor `start_date` がなかった。存在を推測しない。
- feed 有効期限を越えた artifact は表示せず再生成を要求する。
- 立32 は「昭和第一学園」本停留所ではなく「昭和第一学園西門」を通る。Hub では同じ移動判断へまとめるが、便の乗車停留所名を省略しない。
- 公式バスロケ内部通信は調査対象に含めず、本番依存を追加していない。

## 10. 判定

正規 ODPT の Static と Realtime から、対象2方向の scheduled と条件付き realtime prediction を共通 Model へ変換できたため、**西武 Provider のローカル PoC は GO**。

本番化は、Static 更新運用、Cloud Build、validation service、CORS、Logging、実データの remote Acceptance、PWA 更新、Android 実機受入が未実施なので、この文書時点では未判定とする。

## 11. P2.4 本番化前 Static 更新確認

2026-09-14 JST に正規 ODPT Static を再取得し、既存 artifact を壊さない生成・検証・置換処理を実行した。

| 項目 | 実測 |
| --- | --- |
| sourceVersion | `20260824` |
| GTFS ZIP | 4,287,847 bytes |
| P2.4 artifact | 372,176 bytes |
| artifact SHA-256 | `90b8b5299f0e42e693a5dd7a460139c53ee17523224d1459428c8dca41f385d0` |
| 立川→学校候補 | 657便 |
| 学校→立川候補 | 654便 |
| route / stop | 13 routes / 10 stops |
| fetch / build | 645 ms / 3,967 ms |

生成処理は一時ファイルを検証後に publish し、異常時は既存 JSON を置換しない。生成物は Git 管理外だが Cloud Build context と Docker image には含める。現行 feed の有効期間は `20260901`〜`20261031` であるため、公開運用では期限前または提供元更新通知後に同じコマンドを再実行し、validation service で受入してから本番 image を更新する。

## 12. Seibu Position 簡易観測

2026-09-14 JST に、公式 VehiclePositions を32秒間隔で5回観測した。対象はP2.4に含まれる19 trip、合計88観測である。これは短時間の成立性確認であり、本番精度の証明ではない。

| 項目 | 観測結果 |
| --- | --- |
| `current_stop_sequence` | 88 / 88 |
| `stop_id` | 88 / 88 |
| lat/lon | 88 / 88 |
| `current_status` | 0 / 88 |
| sequence と stop_id の矛盾 | 0 / 88 |
| stale / GPS欠損 | 0 / 88 |
| 同一trip連続pair | 55 |
| sequence進行 / 維持 / 逆行 | 24 / 31 / 0 |
| GPS移動pair | 46 / 55 |

報告 stop とGPS最近傍stopが一致したのは39 / 88で、49件は一致しなかった。GPSから報告 stop までの距離は p50 138.2 m、p90 503.8 m、GPSから最寄りGTFS stopまでは p50 37.7 m、p90 60.5 mだった。この観測は、`stop_id` が単純なGPS最近傍停留所ではなく、次停留所等の運行状態を表す可能性と整合する。ただし `current_status` が全件欠損しているため、その意味を確定できない。

研究用PoCは、Staticの同一trip stop列と `current_stop_sequence` / `stop_id` が一致し、新鮮なGPSが同じroute corridorのstop列に整合する場合だけ `stopsAwayCandidate` を算出する。`current_status` 欠損、sequence/stop矛盾、古いGPS、GPS欠損、route不一致、異常なGPS距離では候補を公開判定へ昇格させない。今回25件で候補値を算出できたが、すべて `position.supported=false` のままにした。

**簡易検証の判定:** sequence/stopの連続性観測は継続候補。正確な停留所間状態と stopsAway のPublic表示は、複数日・複数時間帯の観測と公式表示との照合が不足しているため **NO-GO**。Position UI は OFF を維持する。
