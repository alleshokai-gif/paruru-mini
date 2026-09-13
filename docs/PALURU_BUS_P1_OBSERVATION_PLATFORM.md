# PALURU Bus P1 Observation Platform

## 問題

Position、始発Departure Confidence、折返し発車見込みのPoCは、手動の短時間captureだけではroute / origin / platform別の分布、censored sample、誤判定率を校正できない。Realtime APIのリクエスト処理へ観測書込を混ぜると、PWAの可用性と個人向けAPIの応答へ影響する。

## 修正方針

観測を専用Cloud Run Jobへ分離する。

```text
Cloud Scheduler（朝・夕）
  ↓ execute
Cloud Run Job: paluru-bus-observer
  ↓ 1 sampleにつきODPT feedを1回取得
Kawasaki Adapter
  ├ Position evidence
  └ Departure evidence / state
  ↓ allowlist + deterministic observation_id
Google Sheets: Bus_Observation_Raw
  ↓ 日次time-driven trigger
GAS: BusObservationCalibration
  ↓
Bus_Observation_Daily
```

Realtime API、PWA、Public DTO、Position UI、Public実発車予測は変更しない。市バスナビ内部endpointは使用しない。

## Cloud Run Job境界

- 既定は10 sample、32秒間隔、最大330秒。値はsample 1〜12、interval 30〜35秒の範囲だけ設定可能。
- `OBSERVATION_TIME_BANDS`でAsia/Tokyoの実行帯を限定できる。範囲外はODPT / Sheetsへ接続せず正常skipする。
- 1 sampleのGTFS-RT取得結果をPositionとDepartureの両方へ渡す。用途別の重複fetchを行わない。
- 各sample直後にSheetsへbatch appendする。途中で異常終了しても、それ以前の行は保持する。
- `observation_id`はprovider、trip instance、feed/GPS timestamp、state、evidence等のcanonical値をHMACして生成する。同じfeedをretryしても同じIDになる。
- Sheets writerは既存IDを読んでから未登録行だけをappendする。Jobはtask count 1、Schedulerも重複起動させない。P1では単一writerを前提とし、同時writer間の原子的unique制約は提供しない。
- API response全文、ODPT token、生vehicle ID、HMAC keyは保存・ログ出力しない。

## Secretと権限

Secret Managerで次をCloud Run Jobのruntimeだけへ渡す。

```text
ODPT_ACCESS_TOKEN
OBSERVATION_HMAC_KEY
```

通常環境変数：

```text
PALURU_BUS_OBSERVATION_SPREADSHEET_ID
OBSERVATION_TIME_BANDS
OBSERVATION_SAMPLE_COUNT
OBSERVATION_INTERVAL_SEC
```

Jobには専用user-managed service accountを割り当てる。JSON service-account keyや`GOOGLE_APPLICATION_CREDENTIALS`は作らない。Google Auth LibraryのApplication Default Credentialsを使い、対象Spreadsheetをそのservice accountへ編集者共有する。Google Cloud IAM roleだけではWorkspace上のSheetアクセスを付与できない。

## Raw sheet schema

Sheet名は`Bus_Observation_Raw`。header順を固定し、不一致時はfail closedする。

|列|意味|
|---|---|
|observation_id|冪等append用HMAC ID|
|run_id|Cloud Run executionの安全な識別子。localはUUID|
|sample_index|run内のsample番号|
|observation_kind|`departure` / `position` / `departure_position`|
|observed_at|Asia/Tokyo ISO8601|
|provider|provider ID|
|direction_id|P0 query / direction ID|
|route_id|公式route ID|
|trip_id|公式trip ID|
|service_date|GTFS-RT start_date|
|origin_stop_id|Static上のtrip origin|
|platform|Provider resolverによるorigin乗り場|
|scheduled_departure|Static origin departure ISO8601|
|evidence_type|許可された発車証拠またはnull|
|departure_state|内部stateまたはnull|
|elapsed_from_scheduled_sec|観測時刻または肯定的証拠時刻との差|
|gps_age_sec|GPS timestampのage|
|rt_age_sec|feed timestampのage|
|next_bus_gap_min|同route / originの次便間隔|
|censored|scheduled超過後も肯定的証拠がないか|
|vehicle_hash|HMAC済みvehicle ID|
|gps_timestamp|VehiclePosition timestamp|
|position_lat / position_lon|Position検証に必要なGPS。小数6桁|
|position_state / confidence / reason|Position Engineの内部検証結果|
|previous_stop_id / next_stop_id / position_segment_key|high-confidence区間。未確定は空欄|
|position_expected_segments|Static stop chainから得た区間総数|
|aux_stop_id / aux_stop_sequence / aux_status|ODPT raw stateの補助観測。位置主根拠にはしない|

文字列は長さ・文字種、数値は範囲を検証する。0やfalseと欠損を混同しない。Position Engineがunsupportedなら区間を推測せず空欄にする。

## Daily GAS

対象Spreadsheetに紐づく専用`gas-bus-observation/`で、Rawを日付単位に読み、`observation_id`で重複排除して`Bus_Observation_Daily`へappendする。GASは`spreadsheets.currentonly`だけを要求し、bound SpreadsheetのIDがScript Propertyと一致しない場合は停止する。

集計keyは`local_date + provider + direction_id + route_id + origin_stop_id + platform`。

- raw / unique trip / positive / censored件数
- scheduledから最初の肯定的departed evidenceまでの秒数: median / p80 / p90 / p95
- GPSあり、Position supported、欠損、stale、route外、Position異常値、Departure異常値件数
- unique segment数 / expected segment数とcoverage比
- Calibration候補値とsample充足状態

Calibration値は候補としてSheetへ保存するだけで、`bus/departure/policy.js`や本番設定へ自動反映しない。既存Daily headerと異なる場合は書換えず停止する。

定期観測campaignでは、日次triggerを20:45ごろ（Asia/Tokyo）に毎日起動し、handler側で土日をskipする。平日は当日分を集計する。Apps Scriptの`nearMinute(45)`は厳密な20:45実行を保証せず、20時台の指定分付近で実行される。初回受入や当日中の手動確認では、引数不要の`runTodayBusObservationCalibration()`を使う。

Dailyの論理一意keyは`local_date + provider + direction_id + route_id + origin_stop_id + platform`とする。同じkeyを再集計した場合は既存行の`summary_id`を維持して同じ行を更新し、Rawが増えてもDaily行を増殖させない。既存Dailyに同じ論理keyが複数ある場合は、勝手に統合せずfail closedする。

### 定期化前の差分記録

- 問題: 従来のtriggerは01:10ごろに前日分を処理し、今回指定の平日夜・当日集計と一致しない。`summary_id`がRawのobservation ID集合に依存するため、同じ日・同じgroupへ観測が増えるとDaily行が増える。
- 原因: 初回remote Acceptanceは同一Raw入力の再実行だけを検証しており、同日中にRawが増えた後の再集計を検証していなかった。
- 修正方針: weekday guard付きの当日集計handlerを20:45ごろに1件だけ登録する。Dailyは論理一意keyでupsertし、既存`summary_id`を保持する。
- 影響範囲: `gas-bus-observation/`とObservation設計書・専用テストだけ。Cloud Run Jobの観測内容、PWA、Bus API、Position UI、Public departure predictionは変更しない。
- 副作用: 同じ論理keyが既に複数行ある場合は集計を停止する。既存Raw/Dailyを削除・並べ替えしない。
- ロールバック: Cloud Scheduler 2件をpauseし、Apps ScriptのObservation triggerを削除して、GASソースを直前版へ戻す。Raw/Daily観測値は監査用に保持する。
- 実環境試験: Morning/Evening Schedulerを各1回手動起動し、Job成功・Raw追記・observation ID一意性を確認する。当日集計を2回実行し、2回目で同じDaily行数・同じ`summary_id`になることを確認する。

`calibration_ready`は自動判定しない。route / originごとにpositive 20件以上、複数日、censored、peak/off-peak、誤残存・誤除外を人がレビューする仕組みが整うまで常にfalseとし、candidate thresholdも空欄を維持する。登戸発はdirection / route / origin / platformをkeyに含め、他routeと混ぜない。

## 副作用とロールバック

- Job失敗はRealtime APIとPWAへ伝播しない。
- Sheets失敗時はJobを非zero終了し、Cloud Run retryまたは次回実行で同じobservation IDを再送する。
- Job / Schedulerを停止してもBus APIは継続する。
- ロールバックはScheduler pause、Jobの直前image指定、またはJob削除。Spreadsheet Rawは監査データとして削除しない。

## 実機・本番前Acceptance

1. 合成feedで1 fetch / sample、Position / Departure共用を確認。
2. Jobのbounded runと時間帯skipを確認。
3. Sheets schema、append、同一batch / retry duplicate抑止を確認。
4. route / origin / platform分離、positive / censored分離を確認。
5. GPS欠損・stale・異常値を推測補完しない。
6. GAS日次集計、percentile、区間coverage、異常件数を確認。
7. Calibrationがproductionへ自動反映されないことを確認。
8. Bus / Repository回帰、Secret scanを確認。
9. Cloud Run Job実行と実Sheet追記を確認。
10. PWA / Bus API deployが発生していないことを確認。

本ドキュメントの実測結果とGO判定は実装・検証後に追記する。

## Cloud Build / Run手順

対象はproject `paluru-bus`、region `asia-northeast1`、Job `paluru-bus-observer`。Realtime API serviceとimageを共有しない。

事前条件：

1. Google Sheets API、Cloud Run、Cloud Build、Artifact Registry、Secret Manager、Cloud Scheduler APIを有効化する。
2. `paluru-bus-observer@paluru-bus.iam.gserviceaccount.com`をJob専用service accountとして作る。
3. `ODPT_ACCESS_TOKEN`と`OBSERVATION_HMAC_KEY`の各Secretに、そのservice accountの`roles/secretmanager.secretAccessor`を付ける。
4. Spreadsheetを用意し、Job service accountへそのファイルだけ編集者共有する。Google Cloud IAM roleだけではSheetへアクセスできない。
5. `gas-bus-observation`を専用Apps Script projectへユーザー本人が反映し、Script Property設定後に`setupBusObservationSheets()`を実行する。
6. `bus/observation/job.env.example.yaml`を`bus/.local/observation-job.env.yaml`へコピーし、実Spreadsheet IDをローカル無視ファイルへだけ設定する。

Buildのみ：

```powershell
gcloud builds submit `
  --project=paluru-bus `
  --region=asia-northeast1 `
  --config=observation/cloudbuild.yaml `
  --substitutions=_IMAGE=asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-observer:VERSION `
  .
```

Job作成例。Secret versionは`latest`ではなく、受入対象の有効な数値versionへ固定する。

```powershell
gcloud run jobs deploy paluru-bus-observer `
  --project=paluru-bus `
  --region=asia-northeast1 `
  --image=asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-observer:VERSION `
  --service-account=paluru-bus-observer@paluru-bus.iam.gserviceaccount.com `
  --tasks=1 --max-retries=1 --task-timeout=7m `
  --cpu=1 --memory=512Mi `
  --env-vars-file=.local/observation-job.env.yaml `
  --set-secrets=ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:ODPT_VERSION,OBSERVATION_HMAC_KEY=OBSERVATION_HMAC_KEY:HMAC_VERSION
```

初回はSchedulerを作らず`gcloud run jobs execute paluru-bus-observer --wait`で実行し、Cloud Loggingの安全な件数ログ、Raw追記、同じfeedのduplicate抑止、GAS日次集計を受入する。PWA / Bus APIのdeployコマンドはこの手順に含めない。

## 実行スケジュール案

校正campaignの初期案は平日5回。

- 朝: 07:00、08:00
- 夕: 17:30、18:30、19:30
- 各回約5分、10 sample、32秒間隔
- Scheduler jobは朝用と夕用の2件。Job側time bandも二重guardとして維持する。

この案は月22平日で約110 executions、1,100 ODPT feed fetch、最大約550 Job分。初回live sampleの45行を上限見積に使うと約49,500 Raw行／月、34列で約168万cell／月となる。校正完了後はSchedulerをpauseし、Sheet容量を監視する。無期限運転を前提にしない。

## コスト・quota見積（2026-09-12時点）

- Cloud Run Jobsはinstance lifetime全体、最低1分で課金。1 vCPU / 512 MiBを約33,000秒／月とすると、無料枠未適用でもCPU約0.59 USD、memory約0.03 USDの概算。billing account共有の月240,000 vCPU秒・450,000 GiB秒無料枠が残っていれば対象範囲内。
- Cloud Schedulerはbilling accountあたり3 jobまで無料。案は2 job。
- Sheets APIは1 executionあたり初期read 2回、append最大10回。公式quotaの1 user/projectあたりread・write各60回/分を下回る。標準利用は現時点で追加料金なしと記載されるが、公式ページは2026年後半の課金計画にも言及しているため本番開始時に再確認する。
- Artifact Registryはbilling account合計0.5 GiB-monthまで無料。image実サイズと既存image合計はremote build後に確認する。

参照：

- https://cloud.google.com/run/pricing
- https://cloud.google.com/scheduler/pricing
- https://cloud.google.com/artifact-registry/pricing
- https://developers.google.com/workspace/sheets/api/limits
- https://docs.cloud.google.com/run/docs/securing/service-identity
- https://developers.google.com/workspace/guides/create-credentials

## ローカル検証結果

2026-09-12 16時台、正規ODPT feedを1回取得し、production collectorへ同じsnapshotを渡した。

- feed fetch: 1
- 生成候補: 45行
- Departure専用: 14行
- Departure + Position共用: 11行
- Position専用: 20行
- GPSあり: 31行
- censored: 14行
- high-confidence Position: 0行（正規geometry未確定のため、推測せずunsupported）
- positive departed evidence: 0行（単一sampleのため）

この確認ではmemory sinkを使用しており、実Google Sheetsへの追記ではない。Raw schema、Sheets REST append、既存ID・同一batch duplicate抑止は合成HTTP testでPASSした。実Sheet追記、Cloud Build、Cloud Run Job、GAS remote実行は別Acceptanceとして残る。

## 2026-09-12 ローカルAcceptance

|項目|結果|証拠・制限|
|---|---|---|
|Observation unit|PASS 6/6|bounded run、time band、1 fetch/sample、schema、duplicate、route/origin、GPS欠損|
|GAS集計 unit|PASS 1/1|group、positive/censored、percentile、coverage、production非反映|
|Bus repository|PASS 111/111|esbuildを含む全Bus test|
|PALURU repository|PASS 87/87|既存Repository test|
|Static artifact|PASS|3,134,559 bytes、4方向 trip存在・参照整合|
|Cloud Run相当HTTP|PASS|4方向HTTP 200、実ODPT。Windows Node processでありCloud Run実測ではない|
|Secret scan|PASS|410 files、0 match|
|Cloud Build upload allowlist|PASS|53 files。Observation Job/Staticを含み、`.dev.vars`、`.local`、`node_modules`は0|
|実Google Sheets追記|未確認|Spreadsheet作成・service account共有・Cloud認証が必要|
|GAS remote集計|未確認|専用Apps Script projectへの反映と実Sheet受入が必要|
|Cloud Build / Cloud Run Job|未確認|Google CLI browser login完了後に実施|

ローカル実装はGO。観測基盤の本番運用は、実Sheet追記、同一feed再実行のduplicate抑止、GAS remote集計、Cloud Run Job実行を確認するまでNO-GOとする。Realtime APIとPWAのdeployは本Phaseの対象外。

## 2026-09-12 remote Acceptance

対象はproject `paluru-bus`、region `asia-northeast1`。active accountは`alle.shokai@gmail.com`であることをGoogle Cloud CLIから再確認した。PWAとRealtime Bus API serviceは変更・deployしていない。

### Cloud Build / Cloud Run Job

- Cloud Build ID: `861a08e6-7b72-46ae-9e4f-1c9ab6a18622`
- image digest: `sha256:3514b8b253d0dc1b59bb359c78fa520f088e3b8b4f0599368131d6f783ed44b9`
- Job: `paluru-bus-observer`
- service account: `paluru-bus-observer@paluru-bus.iam.gserviceaccount.com`
- resource: 1 task、1 vCPU、512 MiB、timeout 420秒、max retry 1
- bounded run: 10 sample、32秒間隔、最大330秒
- time band: `06:30-09:30,16:30-20:30`（Asia/Tokyo）
- Secret: `ODPT_ACCESS_TOKEN:1`、`OBSERVATION_HMAC_KEY:1`をSecret Manager参照として設定。値は確認・出力していない。
- 初回5分実行: `paluru-bus-observer-qh7rg`、4分58.79秒、1 task成功
- 実行内: feed fetch 10、append候補395、insert 358、duplicate抑止37。sample 7で同一snapshotの37行を再送せず抑止した。

初回のschema不一致実行はfail closedで失敗し、header修正後の実行で成功した。Rawデータを削除して復旧する処理は行っていない。

### 実Google Sheets / GAS

対象SpreadsheetだけをJob service accountへ編集者共有した。Apps Scriptは対象Spreadsheetへboundし、OAuth scopeは`spreadsheets.currentonly`だけを使用する。`setupBusObservationSheets()`は20:39:56開始、20:39:59完了。`runTodayBusObservationCalibration()`は20:40:43開始、20:40:45完了した。

実Sheet exportで次を確認した。

- `Bus_Observation_Raw`: 442行、unique `observation_id` 442、重複0
- run数: 3、run/sample組み合わせ数: 12
- `Bus_Observation_Daily`: 14 groupを追記
- 同日再集計: 20:43:17開始、20:43:19完了
- 再集計後: Daily 14行のまま、14件の`summary_id`も初回と同一
- 合計unique trip: 47、positive trip: 2、censored trip: 17
- GPSあり: 319行、GPS stale: 25行
- Position supported: 0行。正規geometry未確定のため、推測で区間を生成していない。
- `calibration_ready`: 全14 groupでfalse。candidate thresholdは全件空欄のまま。

route / origin / platform別のDeparture集計は次の通り。p50はDaily schemaの`median_sec`を表す。`—`は取得値がないことを示し、0として補完しない。

|direction|route|origin|platform|raw|trip|positive|censored|p50|p80|p90|p95|
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
|home_to_mizonokuchi|10032|229_2|—|11|1|0|0|—|—|—|—|
|home_to_mizonokuchi|10033|461_1|—|31|3|0|0|—|—|—|—|
|home_to_mizonokuchi|10036|242_2|—|11|1|0|0|—|—|—|—|
|home_to_mizonokuchi|10036|503_1|—|34|4|0|0|—|—|—|—|
|home_to_mizonokuchi|10037|474_5|—|13|2|0|0|—|—|—|—|
|home_to_noborito|10044|234_1|—|22|2|0|0|—|—|—|—|
|mizonokuchi_to_home|10032|434_4|4番|22|2|0|1|—|—|—|—|
|mizonokuchi_to_home|10033|255_3|—|6|1|0|0|—|—|—|—|
|mizonokuchi_to_home|10033|434_2|2番|53|6|1|3|215|215|215|215|
|mizonokuchi_to_home|10034|434_2|2番|33|3|0|1|—|—|—|—|
|mizonokuchi_to_home|10035|434_4|4番|22|2|0|1|—|—|—|—|
|mizonokuchi_to_home|10036|434_3|3番|112|11|0|7|—|—|—|—|
|mizonokuchi_to_home|10037|434_4|4番|23|3|0|2|—|—|—|—|
|noborito_to_home|10044|362_1|登05のりば|49|6|1|2|130|130|130|130|

### 判定

観測基盤のremote AcceptanceはGO。Cloud Run Job実行、対象Sheetだけへの追記、Raw duplicate抑止、GAS当日集計、Daily同日duplicate抑止まで実環境で成立した。

Calibration値のproduction採用はNO-GOを維持する。positive evidenceが2 tripだけで、14 groupすべて`calibration_ready=false`である。日次triggerはこの受入では作成していない。スケジュール案を採用する場合は、ユーザーが運用頻度と期間を決めた後に別作業として作成する。

remote受入後の回帰結果：

|項目|結果|
|---|---|
|PALURU Repository|PASS 87/87|
|Bus|PASS 111/111|
|GAS aggregate unit|PASS 1/1|
|Secret scan|PASS、412 files、0 match|
|`git diff --check`|PASS。WindowsのLF→CRLF warningのみ|
|PWA / Bus API main|変更・deployなし|

## 2026-09-13 定期観測有効化

### Cloud Scheduler / IAM

project `paluru-bus`、region `asia-northeast1`に次の2件を作成した。いずれもtimezoneを`Asia/Tokyo`へ明示し、Cloud Run Jobs v2の`paluru-bus-observer:run`だけをPOSTする。

|Scheduler job|cron|JST実行時刻|
|---|---|---|
|`paluru-bus-observer-morning`|`0 7,8 * * 1-5`|平日07:00、08:00|
|`paluru-bus-observer-evening`|`30 17,18,19 * * 1-5`|平日17:30、18:30、19:30|

Scheduler専用service accountは`paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com`。project全体roleは追加せず、対象Cloud Run JobのIAM policyへ`roles/run.invoker`だけを付与した。Google管理のCloud Scheduler service agentには既定の`roles/cloudscheduler.serviceAgent`が存在する。Scheduler 2件はOAuth tokenで起動し、scopeは`cloud-platform`、retry countは1、attempt deadlineは180秒である。

Cloud Run Job側の二重guardは`06:30-09:30,16:30-20:30`（Asia/Tokyo）、10 sample、32秒間隔である。06:18 JSTからの手動Acceptanceだけは、実データを取得できるよう一時的に開始時刻を`06:00`へ広げた。Morning / Eveningの実行後に`06:30-09:30,16:30-20:30`へ復元し、remote Job設定で復元値を確認した。Scheduler作成前のJob execution countは4、Sheet基準値はRaw 442行・unique observation ID 442・重複0、Daily 14行・unique summary ID 14・論理key重複0である。

### Daily集計の定期化

Apps Script triggerは`runWeekdayBusObservationCalibration`を20:45付近（Asia/Tokyo）に毎日起動し、handlerで土日をskipする設計へ変更した。公式仕様上`nearMinute(45)`は前後15分の範囲であり、厳密な20:45固定ではない。

同日中にRawが増えた再集計でもDaily行を増やさないため、論理一意keyで既存行をupsertする。移行前の既存14行は既存`summary_id`を維持する。Calibrationは複数日・peak/off-peak・censored・誤残存・誤除外レビューをまだ集約判定できないため、automatic review gateを閉じ、`calibration_ready=false`とcandidate空欄を維持する。

### 月間概算

平日5回、月22日で110 executions。実測298.79秒を使うと約32,867 vCPU秒、約16,433 GiB秒（512 MiB）で、無料枠を一切適用しない単価概算は約0.62 USD／月。330秒上限では約0.69 USD／月である。Cloud Run無料枠はbilling account全体で共有されるため、実請求0 USDを保証しない。

Cloud Schedulerは2 jobで、billing accountの月3 job無料枠に収まれば0 USD、他projectが無料枠を消費済みなら最大0.20 USD／月。Sheets API標準利用は現時点で追加料金なしだが、公式は2026年後半のquota超過課金計画を案内している。Artifact Registry既存image、Cloud Logging保持量、network、税・為替、同一billing accountの他project利用分はこの概算に含めない。

参照：

- https://cloud.google.com/run/pricing
- https://cloud.google.com/scheduler/pricing
- https://developers.google.com/workspace/sheets/api/limits
- https://developers.google.com/apps-script/reference/script/clock-trigger-builder
- https://developers.google.com/apps-script/guides/services/quotas

### 現在のAcceptance

|項目|結果|
|---|---|
|Scheduler 2件作成・timezone|PASS|
|専用SA・Job単位`roles/run.invoker`|PASS|
|Sheet baseline一意性|PASS|
|GAS構文・専用unit|PASS|
|PALURU Repository|PASS 87/87|
|Bus|PASS 111/111。sandbox内実行で拒否されたesbuild 4件は権限付き同一testでPASS|
|Secret scan|PASS、413 files、0 match|
|Morning手動test run|PASS。execution `paluru-bus-observer-vmh84`、06:18:17〜06:23:15 JST、4分58.73秒、10 sample、195 rows、176 inserted、19 duplicates。Rawは442→618行、unique ID 618、重複0|
|Evening手動test run|PASS。execution `paluru-bus-observer-dztr6`、06:26:39〜06:31:34 JST、4分54.82秒、10 sample、217 rows、217 inserted、0 duplicates。Rawは618→835行、unique ID 835、重複0|
|GAS source反映・trigger作成|PASS。ユーザーが`clasp push`し、06:09 JSTにinstaller完了。実画面で1 trigger、`runWeekdayBusObservationCalibration`、時間主導型、20:00〜21:00、GMT+09:00を確認|
|GAS trigger冪等再実行|PASS。06:14 JSTにinstallerを再実行後もtriggerは1件|
|Daily実upsert・同日再集計|PASS。旧版の06:35再集計で発生した重複13行だけを削除後、日付正規化版を06:51、06:52 JSTに実行。両回ともDaily 27行、unique summary ID 27、unique論理key 27、重複0、summary ID集合不変、Raw 835行・unique ID 835・重複0|
|PWA / Bus API main / Position UI / Public prediction|変更・deployなし|

Daily実集計は新しいRawにより14 groupから27 groupへ増えた。全groupの`calibration_ready`はfalse、candidate値は空欄である。

再集計の重複は、`setValues()`で書いた`local_date`がGoogle Sheetsで日付セルへ変換される一方、既存行の論理key生成が日付値を`String()`のまま比較していた経路で発生した。exportしたSheetでも`local_date`が文字列ではなく日付シリアルとして保持されていることを確認した。対策としてDaily論理key生成時にDate値をAsia/Tokyoの`yyyy-MM-dd`へ正規化し、Dateセルを既存行に持つupsert testを追加した。remote sourceで正規化行を確認後、削除前exportで重複が`[16,29]`から`[28,41]`までの13組に限られ、Raw 835行が一意であることを再確認した。ユーザー許可に基づき後発側のDaily 29〜41行だけを削除し、RawとDaily 2〜28行は変更していない。

日付正規化版で2回再集計後もDaily 27行、27 unique summary ID、27 unique論理key、重複0、同じsummary ID集合を維持した。Rawも835行・835 unique ID・重複0で不変である。最終testはRepository 87/87、Bus 111/111、GAS専用test 1/1、Secret scan 413 files / 0 matches。Morning / Evening Scheduler、Cloud Run Job、Raw追記、Daily集計を含む定期観測をGOとする。

Calibrationは全27 groupで`calibration_ready=false`、daily group単位のpositive最大値は1であり、positive 20件条件には未達である。`noborito_to_home / 10044 / 362_1 / 登05のりば`は他routeと別groupを維持し、既存positive dayはp50/p80/p90/p95が130秒、今回追加されたdayはpositive 0・censored 1である。他routeの閾値は流用しない。Calibration値のproduction適用は引き続きNO-GOである。
