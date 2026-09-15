# PALURU Bus P3.2 Automatic Canary Evaluator

最終更新: 2026-09-15 Asia/Tokyo

## 問題と方針

P3.1は平日朝の収集を自動化したが、Cloud Run execution、構造化ログ、`Bus_Preorigin_Raw`を後から人が突き合わせる必要があった。P3.2では収集Jobを変更せず、別Cloud Run Jobが同日の証拠を読み、reason code付き`GO / HOLD / NO_GO`を`Bus_Preorigin_Daily`へ保存する。

```text
Cloud Scheduler 09:10 JST
  -> paluru-bus-preorigin-evaluator
    -> Scheduler 2本の設定とAttemptStarted / AttemptFinishedをread
    -> paluru-bus-preorigin-observer execution metadataをread
    -> preorigin_start / sample / complete / skipped / failed logをread
    -> Bus_Preorigin_Rawをread-only
    -> evaluator
    -> Bus_Preorigin_Dailyへappend-only
```

公開Bus API、PWA、Position UI、Public departure prediction、収集Job image、`Bus_Preorigin_Raw` schemaは変更しない。Level Cは計算も保存もしない。

## Scheduler時刻

Evaluator Scheduler候補は`paluru-bus-preorigin-evaluator-0910`、cron `10 9 * * 1-5`、timezone `Asia/Tokyo`とする。

最終収集起動08:55に既存max run 310秒を加えると09:00:10である。09:05は理論上290秒、09:10は590秒の完了余裕になる。Scheduler dispatch、Cloud Run終了metadata、Logging反映、Sheets appendの遅れを吸収するため09:10を採用する。人間が09:00前後に操作する手順は作らない。

収集Schedulerの期待fireは29回。08:55はtime-band終端guardを確認するedge executionであり、通常観測の期待値は06:35〜08:50の28 runs × 10 samples = 280 samplesとする。08:55 executionの0〜1 sampleは欠損扱いにしない。

## Input

### Scheduler

- Scheduler resource 2本のname、cron、timezone、state、POST target、OAuth SA、retry設定
- Cloud Scheduler loggingの`AttemptStarted`と`AttemptFinished`
- `scheduleTime`で29 expected slotと照合

Cloud Schedulerが開始・終了ログを出すこととtype URLはGoogle公式仕様を根拠にする。`scheduleTime`が実ログで得られない場合は時刻を推測せず`SCHEDULER_SCHEDULE_TIME_MISSING`でHOLDにする。

### Cloud Run

- v2 Jobs executions list
- create/completion time
- succeeded / failed / running / retried task count
- execution重複と時間的overlap

Scheduler retry 0とCloud Run Job task `maxRetries=1`は別に集計する。

### 安全なapplication log

- `preorigin_start`: targetTrips、sampleCount、intervalSec、maxRunSec
- `preorigin_sample`: runId、sampleIndex、件数、処理時間
- `preorigin_complete`: samples、status、reason
- `preorigin_skipped`: `outside_time_band`または`no_target_service`
- `preorigin_failed`: 安全なerror code

### Raw

`Bus_Preorigin_Raw`のheaderは完全一致を必須とする。service date、run、sample、target trip、HMAC vehicle、分類counter、transition証拠だけを読む。raw responseやSecretを取得する列は存在しない。

## Output

`Bus_Preorigin_Daily`を専用tabとして初回だけ作成する。既存tabは変更しない。header不一致は自動修正せず停止する。

主な列:

- evaluation / source fingerprint
- service date / evaluated at
- expected / actual / success / failed / skipped runs
- expected / actual / missing samples
- duplicate execution / overlap / interval anomaly
- target trip coverage
- assigned / unassigned candidate / partial / unusable
- stale / GPS missing / identity missing / out of radius
- undetermined / transition / Level A candidate / Level B candidate
- seconds-before-scheduled p50 / p80 / p90 / p95
- schema / duplicate / HMAC / raw ID / token / raw response検査
- decision / reason codes / evaluator version

同じservice date、evaluator version、入力fingerprintは同じ`evaluation_id`になる。retryは同じ行を増やさずduplicateとして正常終了する。後着データでfingerprintが変わった場合だけ新しいappend-only評価になる。

application logのunique sample件数とRawのunique sample key件数は別々に集計する。両方が280以上でも一致しない場合は`SAMPLE_SOURCE_MISMATCH`でHOLDにし、片方の件数で他方を補完しない。

## 現行Raw v1の不足

現行Rawは`raw_vehicle_entities`、`assigned_count`、`tripless_count`、`partial_descriptor_count`、`stale_count`、`gps_missing_count`、`runtime_dropped_count`を持つ。一方、feed全体の次の内訳は保存していない。

- `unusable`
- `identity_missing`
- `out_of_radius`

counter同士が重なるため差分から推測しない。Evaluator v1はこれらを`null`とし、`CLASSIFICATION_DETAIL_UNAVAILABLE`でHOLDにする。今後必要なら収集Jobの安全な集計ログへ件数だけ追加する別変更とし、Raw schema migrationは行わない。

## Decision

### NO_GO

- Scheduler resource設定不一致
- Raw header / unexpected column / row contract破壊
- observation ID conflict
- HMAC不正、raw ID / token / raw response疑い
- target tripが12件でない通常営業日
- static target mismatch
- 連続Job failure

### HOLD

- Scheduler fire / execution / sample欠落
- 単発Job failureまたは実行中
- overlap / interval anomaly
- `no_target_service`
- 対象便の前後window coverage不足
- 現行Rawで取得不能なclassification内訳

### GO

Fatal/HOLD reasonが0件の場合だけ。Level A候補0件だけではNO_GOにしない。Level A/Bは後処理結果であり、Level Cは自動生成しない。

reason codeは大文字snake caseで固定し、判断入力値や生識別子を含めない。

## SA / IAM案

Evaluator runtime SA候補は`paluru-bus-preorigin-evaluator@paluru-bus.iam.gserviceaccount.com`とする。

- source Jobのexecution list: source Jobに必要なread-only Run権限
- Cloud Run / Scheduler application log: projectのLogging read-only権限
- Scheduler resource 2本: Scheduler read-only権限
- 対象Spreadsheet: 対象ファイルだけ編集権限
- Secret Manager、ODPT token、HMAC key: 権限なし

既存`paluru-bus-scheduler` SAへはEvaluator Job resourceのInvokerだけを追加する。Evaluator JobはODPT/HMAC envが存在すると起動時にfail closedする。

IAMはdeploy前に実権限を`test-iam-permissions`で確認し、広いEditor/Owner権限は付けない。

## Rollback

Evaluator Schedulerをpauseし、Evaluator Jobを削除または旧revisionへ戻す。専用Daily tabはappend-only証拠として残し、Raw、収集Scheduler、収集Job、公開API、PWAは変更しない。

## Test

- 29 scheduler slots / 28 observation runs / 280 core samples
- 09:10の590秒余裕
- missing fire / execution / sample
- single / consecutive failure
- overlap / interval anomaly
- no target service
- target trip 12件
- header / unexpected column / HMAC / duplicate conflict
- Level A 0でもHOLD可能
- Level C非生成
- reason code安定性
- Daily tab限定作成とevaluation ID duplicate抑止
- Evaluator imageへcollector / ODPT Provider / static artifactを含めない

## 現在地

Pure evaluator、Daily schema/store、Job composition、Cloud Build定義、合成testまで実装した。Cloud Build、Evaluator Job、SA/IAM、Scheduler作成、実Sheet追記は未実施である。最初のP3.1自然canaryは既存Schedulerで予定どおり進み、Evaluator未deployでもRaw収集には影響しない。

Evaluator設定検証はGoogle clientを読み込まない独立moduleに置いた。Repository testはCloud用dependencyが未installでも設定・Secret境界を検証でき、image smokeではCloud用dependencyを含む実containerから同じmoduleを検証する。
