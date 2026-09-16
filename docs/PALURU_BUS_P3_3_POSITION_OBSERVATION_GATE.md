# PALURU Bus P3.3 Position Shadow Observation

最終更新: 2026-09-16 Asia/Tokyo

## 目的と現在地

Position / stopsAwayの公開判断に必要な証拠を、手動probeではなく通常observerの自動観測から作る。P3.3はStage 1（shadow evaluation）までを対象とし、Position UIとPublic departure predictionはOFFを維持する。

    paluru-bus-observer
      -> Bus_Observation_Raw（既存schema、read-only）
      -> paluru-bus-position-evaluator
         -> GPS + version固定geometry candidate
         -> Bus_Position_Evaluation（観測ごとのderived evidence）
         -> Bus_Position_Daily（日次route/direction summary）

ローカル実装、合成test、Cloud Run Job / Scheduler / IAMの設定契約まで作成した。本番GCPへのbuild / deploy / Scheduler作成は未実施である。

## 入力境界

Bus_Observation_Rawの既存34列を変更しない。使用する値は次のとおり。

- service date / observed time
- provider / direction / route / trip
- HMAC済みvehicle identity
- GPS timestamp / freshness / lat / lon
- 既存Position state / confidence / reason
- previous / next / segment
- raw stop / sequence / status（補助証拠のみ）

current_stop_sequence、stop_id、current_statusだけでpositionまたはstopsAwayを確定しない。生GPSは計算時だけ使用し、derived tabへ保存しない。

## Geometry source

選択優先順位は次で固定した。

1. gtfs_shape
2. official_odpt_geometry
3. validated_road_geometry
4. observed_corridor

同じ優先順位のsourceが同一targetに複数ある場合はfail closedする。static source hash、provider、direction、chain、target stopが一致しないartifactも拒否する。

現在のposition-shadow-geometry.jsonには、登05専用の`validated_road_geometry` sourceを1件収録する。OSM relation 7109917 version 14の道路形状を国土数値情報N07 2022で照合し、GTFS stop列の投影結果をversion固定artifactへ保存した。`approvedForShadow=true`、`approvedForPublic=false`、`geometryReady=false`をschemaとtestで固定する。

最初のshadow targetは、既存PoCと同じ次の1方向に限定した。

- provider: kawasaki
- direction: home_to_noborito
- route: 10044（登05）
- target stop: 362_1（登戸駅・正式stop ID）

対象を増やすときは、routeごとに正規stop列とgeometry sourceを独立検証する。

### 登05 Shadow artifact

- approval version: `p3.3-shadow-1`
- source version: `osm:7109917:v14+mlit:n07:2022`
- point / way: 281 / 39
- way gap: 0、gap distance: 0m
- proper self intersection: 0
- GTFS stop projection: 20/20、順序整合
- N07: 281/281 pointが60m以内、p95 4.877m
- 既存GPS: 80点中79点match、p95 44.576m、10/10 tripが単調進行
- 神木本町 `184_2`: ordinal 12
- 登戸駅 `362_1`: ordinal 19

`362_1`は折返し形状により複数投影候補がある。ShadowではGTFS終点とOSM relation終端が一致する最終投影を`terminal_route_end_order_constraint`としてartifactへ固定した。走行中GPS自体に複数のsnap候補が出る場合は、この解決を流用せず`route_crossing_ambiguous`でfail closedする。

OSM由来pointsはODbL 1.0と出典をartifact内に記録する。N07はgeometryの正解ではなく公的road corroborationとして使い、国土交通省の現行利用規約URL、加工表示、input SHA-256を記録する。

## Shadow計算

有効なHMAC vehicle / trip / GPSについて次を計算する。

- route snap distance / progress
- ordered stop projection
- previous stop / next stop / stop interval
- exact target stopまでのcandidate stopsAway
- GPS ageとroute distanceからのconfidence
- 同一service date / trip / HMAC vehicleの時系列progress
- reverse / impossible jump / stop-boundary jitter
- severe stopsAway contradiction
- route crossing / off-route / stale / low-confidence reason
- raw stop / sequenceとの一致・不一致（auxiliary）

単一点では進行方向を確定しない。初点はinsufficient_history、後続点が単調に進んだ場合だけforward候補とする。曖昧・route外・staleはunsupported相当のnullへ戻す。

## Bus_Position_Evaluation

観測ごとのappend-only derived tab。主な列は次のとおり。

- deterministic evaluation_id
- content source_fingerprint
- source observation ID
- service date / observed at
- provider / route / trip / direction
- HMAC vehicle ID
- geometry source / version / ID
- snap distance / progress
- inferred direction / confidence
- previous stop / next stop / interval index
- candidate stopsAway / confidence
- monotonicity / jitter / severe contradiction
- ambiguity reason / auxiliary consistency
- evaluator version

lat/lon、raw vehicle ID、ODPT token、raw responseは保存しない。同じIDと同じfingerprintはduplicateとして抑止し、同じIDでfingerprintが変わった場合はfail closedする。

## Bus_Position_Daily

service date / provider / direction / route単位のappend-only summary。

- total / usable / missing / stale observations
- GPS usable coverage
- independent trip / timeband count
- snap distance p50 / p80 / p90 / p95 / max
- snap match / ambiguous / off-route
- direction trace / monotonic trace / consistency
- stop projection / interval coverage
- jitter / reverse-or-jump / severe contradiction
- auxiliary sequence contradiction
- schema / dedupe / raw-data security checks
- Stage / decision / reason codes
- geometry_ready_candidate=false

P3.3 Jobはgeometry_ready_candidateをtrueへ変更できない。日次結果は現時点でHOLDまたはNO_GOだけを生成し、GO昇格は複数日レビュー後の別フェーズとする。

## Sheetsと権限境界

Evaluator専用SA:

paluru-bus-position-evaluator@paluru-bus.iam.gserviceaccount.com

Google Sheetsはtab単位ACLを提供しないため、対象SpreadsheetへのEditor共有が必要になる。コード側の境界は次で固定した。

- Bus_Observation_Raw: read-only
- Bus_Position_Evaluation: create / append
- Bus_Position_Daily: create / append
- その他tab: read / writeしない

EvaluatorにはSecret Manager role、ODPT token、HMAC keyを付与しない。これらのenvが存在すると起動時にfail closedする。project-wide Viewer等も不要である。

Scheduler SAは既存のpaluru-bus-scheduler@paluru-bus.iam.gserviceaccount.comを使用し、Evaluator Job resourceだけにroles/run.invokerを付与する。

## Cloud Run Job / Scheduler設計

Job:

- name: paluru-bus-position-evaluator
- region: asia-northeast1
- task / parallelism: 1 / 1
- max retries: 0
- timeout: 300秒
- image: digest固定
- env: NODE_ENV、PALURU_BUS_OBSERVATION_SPREADSHEET_IDのみ

Scheduler:

- name: paluru-bus-position-evaluator-1945
- cron: 45 19 * * 1-5
- timezone: Asia/Tokyo
- OAuth: Scheduler専用SA
- retry: 0
- target: Cloud Run v2 Jobs run endpoint

通常observerの最終起動は19:30、bounded runは最大330秒である。19:45評価は最終run開始から900秒後、最大run終了後570秒の余裕を持つ。人間の時刻操作は不要である。

## geometryReady gate候補

既存登05 PoC（281 points、gap 0、GPS p95約44.6m、direction 10/10、20 stop projection）は候補値であり、GO証拠ではない。

本番閾値を固定する前に次の分布を収集する。

- 平日3日以上、可能なら5日以上
- 朝夕を含む複数timeband
- 20 independent trips以上
- targetまでの全stop intervalで複数trip
- usable GPS coverageの分母と欠損理由
- snap distance p50 / p80 / p90 / p95 / max
- direction consistencyと逆走・jump
- stop projection order violation
- severe stopsAway contradiction
- ambiguous / off-route rate
- official referenceとの同一trip・同一時刻pair

usable 95%以上、snap p95 50m以下、direction 98%以上はレビュー候補に留める。観測偏り、区間未網羅、重大矛盾があれば採用しない。重大stopsAway誤判定は0を目標とする。

## 公開Stage

|Stage|状態|
|---|---|
|0|geometryなし / geometryReady=false / UI非表示|
|1|自動shadow evaluation（今回）|
|2|internal/debug、高confidenceのみ|
|3|限定route public|
|4|route expansion|

Stage 2以降、PWA / Realtime API / Position UIは今回変更しない。

## Rollback

このフェーズは未deployのためproduction rollbackは発生していない。将来deploy時は次を独立して戻す。

1. Position evaluator Schedulerをpause
2. Evaluator Jobを直前digestへ戻す、または削除
3. derived 2 tabは証拠として保持し、削除しない
4. observer、Bus API、PWAには変更がないためrollback対象外

## 未確認・不足データ

- production Spreadsheet上の実GPS分布
- 全stop interval / 複数日 / 複数timeband coverage
- 公式表示との同時刻reference
- GCP Job / Scheduler / SA / Sheet共有のremote acceptance
- Android / Public UI（Stage 1では対象外）

したがって、P3.3 Architecture / local runtimeはGO候補、GCP deployはユーザー承認待ち、geometryReady / Public PositionはHOLD / OFFである。
