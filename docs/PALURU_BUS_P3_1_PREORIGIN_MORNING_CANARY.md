# PALURU Bus P3.1 Preorigin Automatic Morning Observation

最終更新: 2026-09-15 Asia/Tokyo

## 方針

神木本町始発の溝17について、営業trip割当前のVehiclePositionと対象始発tripへの同一車両遷移を、平日朝に自動収集する。利用者が特定時刻に操作するCanary手順は廃止する。

このフェーズは研究用観測だけを対象とする。Realtime Bus API、PWA、Position UI、Public departure prediction、production判定、calibration設定は変更しない。Level A/B/Cや閾値をproduction設定へ自動反映しない。

```text
Cloud Scheduler（平日、Asia/Tokyo）
  -> paluru-bus-preorigin-observer（Cloud Run Job）
    -> ODPT VehiclePosition feedを32秒間隔で10回取得
    -> production filter前でentity分類
    -> Bus_Preorigin_Rawへappend-only追記

翌日以降の任意時刻
  -> check-preorigin-remote.js
    -> Cloud Run executions + Raw行を読み取り
    -> duplicate / 欠損分類 / Level A候補を安全な集計値だけで出力
```

## 変更境界

- Cloud Run Jobは公開Bus APIと別image・別entry pointを使う。
- 出力は既存Observation Spreadsheet内の`Bus_Preorigin_Raw`だけとする。
- `Bus_Observation_Raw`、`Bus_Observation_Daily`、GAS集計、PWA、公開APIは変更しない。
- raw token、raw ODPT response、raw vehicle ID、entity IDは保存・ログ出力しない。
- vehicle識別子は日付scopeを含むHMACの`veh_<32 hex>`だけ保存する。
- 研究用GPSは専用Rawの限定列にだけ保存し、Public DTOへ出さない。
- Scheduler 2本と対象Job単位のInvoker権限は2026-09-15に有効化した。Job image、公開API、PWA、commit、pushはこの作業では変更していない。

## 対象とfail-closed

|項目|固定値|
|---|---|
|timezone|`Asia/Tokyo`|
|Scheduler曜日|月曜〜金曜|
|Job time band|`06:35-08:56`。終端は含めない|
|route|`10035` / 溝17|
|origin|`184_1` / 神木本町1番のりば|
|sample|10回|
|interval|32秒|
|max run|310秒|

対象始発時刻は次の12件だけである。

```text
06:50  07:00  07:10  07:20  07:30  07:40
07:50  08:00  08:10  08:20  08:35  08:50
```

Static上で対象が0件なら`no_target_service`としてODPT取得前に正常skipする。対象が1〜11件または13件以上、時刻集合不一致、route/origin不一致ならfail closedする。Job開始時刻がtime band外なら`outside_time_band`としてODPT取得・Sheet初期化・追記を行わず即終了し、実行中も各sampleの直前にtime bandを再確認する。

Schedulerは次の2件に分割する。最終起動は08:55であり、Job内のsample単位time guardが08:56以降の取得を止める。

|Scheduler|cron|起動時刻|
|---|---|---|
|`paluru-bus-preorigin-0635`|`35-55/5 6 * * 1-5`|06:35〜06:55、5分間隔|
|`paluru-bus-preorigin-0700`|`*/5 7,8 * * 1-5`|07:00〜08:55、5分間隔|

合計29 execution/平日である。1 executionのsample間隔は開始時刻基準で制御する。外部応答が遅い場合は隣接executionと一時的に重なる可能性があるため、Sheetの決定的observation IDによるdedupeを必須とする。Schedulerの自動retryは無効にし、次の5分起動を使用する。Job task側の既存`maxRetries=1`は変更せず、再試行時も同じdedupe / conflict fail-closed境界を使う。

## 保存契約

`Bus_Preorigin_Raw`は、target snapshot、候補vehicle observation、対象tripへのassignment transitionという証拠をappend-onlyで保存する。

`preorigin_observation_id`は次の正規化済み項目からHMAC生成する。

- service date
- target trip
- record kind
- HMAC vehicle ID
- vehicle timestamp
- feed timestamp
- transition timestamp
- raw evidence level（常に`undetermined`）

writerは既存IDと同一append内IDを除外する。既存headerが完全一致しない場合は、自動修正せず停止する。保存するvehicle IDはHMACだけで、生IDはmodel、Sheet、ログへ出さない。

Raw writerはLevel A/B/Cを決めない。すべての行を`evidence_level=undetermined`、`censored=true`として保存する。`record_kind=assignment_transition`やvehicle分類は観測証拠であり、最終Levelではない。

## 後処理

`check-preorigin-remote.js`は指定日をJST日付で絞り、次を読み取り集計する。

- Cloud Run execution数、success / failure / running
- Raw行数、一意observation ID数、duplicate行数
- target trip数、sample数
- raw VP、tripなし、partial descriptor、stale、GPS欠損、production parser除外件数
- 同日・同一target trip・同一HMAC vehicleのcandidateからassignedへの時系列遷移

Level A候補は同日内で、同じHMAC vehicleの`unassigned_candidate`または`partial_assignment`が先にあり、同じtarget tripの`assigned`が後にある場合だけ数える。executionをまたぐ遷移も結合する。空間・時刻一致だけのcandidateはLevel B候補件数として分ける。Level Cは自動判定せず`not_auto_classified`を返す。

出力は集計値だけであり、HMAC vehicle、GPS、Spreadsheet ID、Secretを含めない。Raw上のLevel文字列を判断根拠には使用しない。

確認scriptは特定時刻の操作を要求しない。自動実行日の翌日以降、任意の時刻に実行できる。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
$env:PREORIGIN_CHECK_DATE = "YYYY-MM-DD"
npm.cmd run check:preorigin:remote
Remove-Item Env:PREORIGIN_CHECK_DATE
```

ローカル確認にはCloud Run readと対象Spreadsheet readのApplication Default Credentialsが必要である。認証は一度だけ行い、token値を出力しない。

## Google Cloud IAM

Scheduler専用service accountは次を使用する。

```text
paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com
```

このservice accountへ付けるruntime権限は、対象Cloud Run Job `paluru-bus-preorigin-observer`に対する`roles/run.invoker`だけとする。Spreadsheet編集権限、Secret参照権限、Project全体のRun権限は付けない。Job自身は既存の`paluru-bus-observer` service accountと対象Sheetだけの共有を維持する。

## Scheduler実体（2026-09-15 read-back）

- `paluru-bus-scheduler@paluru-bus.iam.gserviceaccount.com`は既存SAを再利用した。
- SAのproject-wide roleとSecret IAM bindingは0件である。
- 対象Job `paluru-bus-preorigin-observer`リソースにだけ`roles/run.invoker`を付与した。
- 2本とも`ENABLED`、HTTP `POST`、timezone `Asia/Tokyo`、OAuth scope `https://www.googleapis.com/auth/cloud-platform`である。
- targetは`https://run.googleapis.com/v2/projects/paluru-bus/locations/asia-northeast1/jobs/paluru-bus-preorigin-observer:run`である。
- Scheduler retryは0、attempt deadlineは60秒である。
- Job imageはgeneration 2の`sha256:d00b095185a1cf22c56357b942cff8f3ecaaf8e693c734e26827b5f5f3af9ed6`から変更していない。execution SA、env、Secret参照も変更していない。
- 公開Bus APIはrevision `paluru-bus-api-00008-7zk`、PWAファイルは有効化前後で不変だった。

最初の自然Scheduler execution自体をcanaryとする。特定時刻の人間操作や確認目的のmanual force-runは行わない。翌営業日以降、任意時刻に後処理scriptでexecutionとSheetを確認する。

## 変更記録とrollback

- 問題: 旧手順は時刻依存データの取得に人間の朝の操作を要求し、継続観測にならなかった。
- 原因の証拠: GCP read-back時点でPreorigin Schedulerは0本で、Jobは時間外実行の正常skipだけが確認済みだった。
- 修正方針: 既存Job imageを固定したまま、Scheduler専用SA、Job resource単位Invoker、指定2 Schedulerだけをidempotentに作成する。
- 影響範囲: Preorigin Jobの起動経路と研究用`Bus_Preorigin_Raw`だけ。公開Bus API、PWA、Position UI、Public departure predictionには接続しない。
- 副作用: 平日29 executionが作成される。隣接executionやJob task再試行が重なる可能性は、observation ID dedupeとconflict fail-closedで処理する。
- rollback: 2 Schedulerをpauseまたはdeleteし、対象JobからScheduler SAの`roles/run.invoker` bindingだけを外す。Job image、observer execution SA、Sheetデータは変更しない。
- 実機試験: Scheduler read-back、次回自然execution、Cloud Run success/failure、専用tab/header、ID一意性、HMAC形式、raw保存禁止、Level A後処理を順に確認する。後半は最初の自然実行まで未確認である。

## Testと現在地

専用合成testは次を検証する。

- 平日06:35〜08:55のScheduler起動集合とsample単位の08:56 time guard
- Job内部の10 sample / 32秒 / 310秒 / time-band固定値
- 12始発便限定と不正集合のfail closed
- production parser前のtripなし / partial / stale / GPS欠損分類
- 日付scope HMACとraw vehicle identity拒否
- Raw writerがLevel A/B/Cを保存しないこと
- executionをまたぐ同一HMAC遷移のLevel A後処理
- duplicate conflictのfail closed
- Sheet専用tab / header / retry duplicate抑止
- checker出力にHMAC/GPS/Sheet ID/Secretが出ないこと

Scheduler設定と権限の静的AcceptanceはPASSした。実データの初回自然観測、Sheet追記、duplicate件数、Level A件数は次の平日朝まで未確認である。未観測をLevel Cとは扱わない。Position UIとPublic departure predictionはOFFを維持する。

2026-09-15の回帰結果はRepository 109/109、Bus 170/170、Secret scan 511 files / matches 0である。

## 判定基準

|対象|GO条件|
|---|---|
|Observation pipeline|自動execution成功、Sheet追記、ID一意、保存境界違反0|
|Level A feasibility|同一日・同一HMAC vehicleのcandidate→対象trip assignmentを複数便・複数日で確認|
|Scheduler運用|fail closed、dedupe、error、row増加、費用を翌日集計で継続確認|

Level Aが0件でも即Level Cにしない。複数日、対象12便のcoverage、tripなし/partial/GPS欠損、RT鮮度を合わせて人が判定する。production設定への反映は別フェーズとする。
