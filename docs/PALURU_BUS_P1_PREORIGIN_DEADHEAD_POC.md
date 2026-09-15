# PALURU Bus P1 神木本町始発・回送車追跡PoC

最終更新: 2026-09-13 Asia/Tokyo

## 目的と境界

平日朝の神木本町始発・溝口駅南口方面について、営業tripへ割り当てられる前のVehiclePositionを正規ODPT GTFS-RTから観測できるか検証する。研究用classifierはproduction Adapterより前のraw VehiclePosition entityを分類するが、raw response全文、生vehicle ID、API tokenを保存しない。Public API/UI、production Adapter、Position UI、Public departure predictionは変更しない。

同一vehicleをHMAC化した識別子で連続観測し、未割当候補から対象始発tripへの切替を確認できた場合だけLevel Aとする。空間・時刻だけが合う場合はLevel B、回送中VehiclePositionが配信されないことを対象時間帯の十分な観測で確認した場合だけLevel Cとする。

## 対象始発便

使用Staticは `20260701_20260828`。平日serviceが有効な2026-09-14で `home_to_mizonokuchi` を、`isOrigin=true`、`originStopId=fromStopId=184_1`、`routeId=10035` でexact filterした。

全12便は溝17、1番のりば、溝口駅南口行である。

|scheduled|trip_id|
|---|---|
|06:50|`4112_01_100002368`|
|07:00|`4112_01_100002306`|
|07:10|`4112_01_100002307`|
|07:20|`4112_01_100002308`|
|07:30|`4112_01_100002309`|
|07:40|`4112_01_100002310`|
|07:50|`4112_01_100002311`|
|08:00|`4112_01_100002312`|
|08:10|`4112_01_100002313`|
|08:20|`4112_01_100002370`|
|08:35|`4112_01_100002663`|
|08:50|`4112_01_100002664`|

川崎市バスナビの平日時刻表はこれら12時刻へ「シ（当バス停始発）」を表示しており、Static抽出と一致した。川崎市の公式告知も神木本町始発便の存在と08:35、08:50の増便を明記している。

確認資料:

- [川崎市バスナビ 神木本町1番・溝口駅南口方面 平日時刻表](https://kcbn.bus-navigation.jp/wgsys/wgp/timeTableRouteTabFileHtml.htm?localeLang=ja&name=00184_01_1_1.html&nextDiagramFlag=0)
- [川崎市交通局 溝口駅南口～柿生駅前系統の路線再編](https://www.city.kawasaki.jp/820/page/0000144313.html)

## raw entity分類

production `parseRealtime()` は `trip_id` と8桁 `start_date` の両方があるVehiclePositionだけをInternal Vehicle Modelへ入れる。したがってtrip descriptorなし、trip_idだけ、start_dateなしのentityはproductionでは意図的に除外される。

研究用 `classifyRawVehiclePositions()` は全VehiclePosition entityを次へ分類する。

- `assigned`: `trip_id + start_date`があり、現行runtimeにも入る
- `unassigned_candidate`: HMAC vehicle IDと有効lat/lonがあり、trip_id/route_idがない
- `partial_assignment`: HMAC vehicle IDと有効lat/lonがあるがdescriptorが不完全
- `unusable`: identityまたは位置が不足

`scheduleRelationship`も値が存在する場合だけ保持する。vehicle IDは32byte以上のkeyでHMAC-SHA256化し、raw entity IDは出力しない。研究captureごとに一時keyを生成し、key自体は保存しない。

## tracker

対象便のscheduled前15分から後5分だけをactive windowとする。GPSは120秒以内、未来許容5秒、神木本町から4km以内の未割当/部分割当だけをLevel B候補として短期memoryへ保持する。同じHMAC vehicleがexact `service_date + trip_id`へ切り替わったときだけLevel A transitionを生成する。

神木本町80m以内への到達時刻は参考値として記録できるが、それ単独でincoming vehicleや発車を断定しない。異常ジャンプや「溝口方面側→神木本町→転回/側道→origin」の軌跡評価は、複数点が蓄積した後の別判定とし、現PoCでは推測しない。

Observation Platformへ将来append-onlyで追加できる契約は次の7項目である。

```text
preorigin_vehicle_seen
preorigin_first_seen_at
preorigin_distance_to_origin
trip_assignment_transition_at
seconds_before_scheduled
arrival_to_origin
departure_positive_evidence
```

既存Google SheetのheaderとGAS集計は今回変更しない。本番観測schemaへ反映する場合は末尾追加、既存行保全、GAS集計の後方互換、duplicate ID再検証を別migrationとして行う。

## 初回限定観測

2026-09-13 21:42 JST頃に1 snapshotを取得した。日曜かつ対象時間外なので、回送車有無のLevel判定には使わない。

- raw VehiclePosition entities: 74
- `unassigned_candidate`: 0
- `partial_assignment`: 0
- 現行parserで除外されるVehiclePosition: 0
- target window: 0
- vehicle→target trip transition: 0
- Level A/B records: 0

このsnapshotで「回送中VehiclePositionは配信されない」とは判断できない。現在の判定は **未判定** であり、Level Cではない。

## 次の観測

研究script `npm run probe:preorigin:poc` は1〜40 sample、30〜35秒間隔に制限される。平日朝に `PREORIGIN_SAMPLE_COUNT=40` を設定し、各runを対象便の15分前までに開始する。06:35〜09:00を複数runで覆い、日を分けて次を集計する。

- tripなし / routeなし / descriptorなしVehiclePosition件数
- 神木本町4km圏、80m圏の連続GPS
- 同一HMAC vehicleのassignment transition
- transition後の対象trip一致
- scheduledとの差
- 異常ジャンプ、逆方向、GPS stale除外件数

ローカルprobeは単一capture内だけ有効な一時HMAC keyを使う。自動観測JobはSecret Manager上の既存`OBSERVATION_HMAC_KEY`を使うが、HMAC入力へ`service_date`を加えるため、同日内のbounded runでは同一車両を照合でき、日を跨ぐと別hashになる。生vehicle IDとHMAC keyはSheet、ログ、artifactへ出さない。

## Acceptanceと現状

|条件|結果|
|---|---|
|Static origin便抽出|PASS: 12便|
|公式時刻表の始発印との照合|PASS: 12時刻一致|
|raw entityをproduction filter前に分類|PASS: 合成test|
|HMACのみ保存、生ID非露出|PASS: 合成test・出力検査|
|same vehicleのLevel A遷移|PASS: 合成test|
|別vehicleをLevel Aにしない|PASS|
|stale/identity欠損/遠方GPS除外|PASS|
|実対象時間帯・複数便観測|未実施|
|実vehicle→trip切替|未観測|
|回送軌跡|未観測|

検証結果は今回追加のHub/PoCを含むBus 137/137、Repository 95/95、Secret scan 442 files / matches 0。PoC captureはGit ignore対象の `bus/generated/` だけへ保存する。

研究用Architecture/collector seamはGO候補。既存Observation Rawのschema migrationは行わず、専用tabへ分離する。実データLevel A/B/C判定と発車予測への利用は対象時間帯の複数日観測が終わるまでNO-GOとする。

## 自動観測構成（2026-09-14）

既存`paluru-bus-observer`の`Bus_Observation_Raw`は34列固定で、`trip_id`必須のPosition / Departure校正schemaである。production filter前のtripなしVehiclePositionを同じ表へ混ぜると既存JobとGAS日次集計を壊すため、Preoriginは次の独立境界とした。

```text
Cloud Scheduler
  -> paluru-bus-preorigin-observer (Cloud Run Job)
    -> ODPT VehiclePosition raw feed（1 sampleにつき1回）
    -> research/preorigin.js（production parser前で分類）
    -> Bus_Preorigin_Raw（同じSpreadsheet内の専用tab）
```

Realtime Bus API、PWA、`Bus_Observation_Raw`、`Bus_Observation_Daily`、GAS日次集計は変更しない。専用tabが存在しない初回だけJobがtabとheaderを作成し、既存tab・既存行は変更しない。headerが存在して不一致なら自動修正せず停止する。

### Job境界

- Job: `paluru-bus-preorigin-observer`
- image: Realtime APIおよび既存Observation Jobと分離
- service account候補: 既存`paluru-bus-observer@paluru-bus.iam.gserviceaccount.com`
- Spreadsheet権限: 共有済みの対象1ファイルだけ
- sample: 10回
- interval: 32秒
- max run: 310秒
- start guard: `06:35-08:56` Asia/Tokyo
- 対象: route `10035`、origin `184_1`、検証済み12時刻だけ

10 sampleは最初と最後の間が288秒で、5分Scheduler間隔より短い。Cloud Run Job executionの重複を避け、Sheetのduplicate ID確認を逐次にする。各rowのIDはservice date、target trip、record kind、HMAC vehicle、vehicle/feed timestamp等からHMAC生成し、同じfeedの再実行を抑止する。

Scheduler候補はtimezone `Asia/Tokyo`を明示する。

|name|cron|対象|
|---|---|---|
|`paluru-bus-preorigin-0635`|`35-55/5 6 * * 1-5`|平日06:35〜06:55|
|`paluru-bus-preorigin-0700`|`*/5 7,8 * * 1-5`|平日07:00〜08:55|

08:55 executionはJob内time guardにより08:56以降のsampleを取得しない。祝日等で正規Static上の対象serviceが0件ならODPTへ接続せず`no_target_service`で正常skipする。対象が1〜11件または13件以上なら静的データ不整合としてfail closedする。

### 専用Sheet schema

`Bus_Preorigin_Raw`はtarget snapshotと対象vehicle observationをappend-onlyで保存する。主な列は、対象trip/時刻/乗り場、raw entity分類件数、HMAC vehicle、vehicle/feed timestamp、必要最小限のlat/lon・origin距離、7つのPreorigin研究項目、evidence level、censoredである。

Level Aは、同じ日付scopeの同一HMAC vehicleがunassigned/partial candidateから対象tripへ切り替わった場合だけ生成する。空間・時刻一致だけはLevel B、証拠なしは`undetermined`である。JobはLevel Cを自動生成しない。Level C判定は複数便・複数日のcoverageと欠損分類を人がレビューした後に限る。

### 自動観測Acceptanceの現在地

|項目|結果|
|---|---|
|production parser前分類|ローカル合成test PASS|
|tripなし / partial / stale / GPS欠損分類|ローカル合成test PASS|
|12始発便限定|現行Staticで12件、時刻集合一致test PASS|
|同一vehicle transition|合成Level A test PASS|
|日付scope HMAC / 生ID非露出|合成test PASS|
|専用tab header / duplicate抑止|mock Sheets test PASS|
|bounded runner / 32秒|合成test PASS|
|Cloud Build|PASS: `e03d158c-aaf0-45b0-831d-d8cb6bd2e487`|
|Cloud Run Job / Sheet実追記 / Scheduler|未実施。ユーザー本人deploy後にremote受入|
|複数日Level判定|未実施。`undetermined`維持|

生成imageは`asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-preorigin-observer@sha256:fede82b604ebe48e6843f1ead82c2384828581c52cbac2ae3b323da017db4279`。Cloud Build smokeはNode 24、既定10 sample / 32秒 / 310秒、専用Sheet名を確認し、BuildへSecretは渡していない。

### 初回remote execution

ユーザー本人がJobをdeployし、execution `paluru-bus-preorigin-observer-svqz6`を実行した。Job revisionは上記digestと一致し、1 task成功、Cloud Logging ERROR以上0件。安全な開始ログでtarget trips 12、sample 10、interval 32秒、max run 310秒を確認した。

executionは2026-09-14 09:40 JST頃で、設定した`06:35-08:56`より後だったため`outside_time_band`で正常skipした。ODPT fetchとSheets appendは0件であり、Google Sheets実画面にも`Bus_Preorigin_Raw` tabはまだ存在しなかった。したがって、実Sheet追記、実データ分類、remote duplicate抑止は未確認である。これは時間帯guardのPASSであって観測AcceptanceのPASSではない。

次の平日06:35〜08:55 JSTにcanaryを1回実行し、専用tab/header、追記行、ID一意性、HMAC形式、raw vehicle/entity/token非保存を確認するまでScheduler作成はNO-GOとする。Level Cは引き続き生成・判定しない。

remote受入後の最終回帰はRepository 95/95、Bus 144/144、Secret scan 452 files / matches 0。Realtime Bus API、PWA、Position UI、Public departure predictionは変更・deployしていない。
