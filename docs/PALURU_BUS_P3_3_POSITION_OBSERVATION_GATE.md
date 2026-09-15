# PALURU Bus P3.3 Position / stopsAway Automatic Observation Gate

最終更新: 2026-09-15 Asia/Tokyo

## 問題と方針

Public Positionを判断する証拠は、手動probeではなく通常observerの自動観測を一次データとする。現行observerは平日朝7時・8時と、夕方17:30・18:30・19:30にCloud Schedulerから起動され、1 runで10 samplesを32秒間隔で取得する。

```text
paluru-bus-observer
  -> ODPT feedをsampleごとに1回取得
  -> Vehicle GPS / timestamp / HMAC vehicle identityを収集
  -> Bus_Observation_Raw
  -> P3.3 shadow evaluator
  -> Bus_Position_Evaluation（将来の専用derived tab）
```

`current_stop_sequence`、`stop_id`、`current_status`は補助証拠に限定する。stopsAwayはGPSをroute geometryへ投影し、順序付きstop projectionから得たnext stopを基準に計算する。Position UIとPublic departure predictionはOFFを維持する。

## 現行GCP実体

2026-09-15にread-onlyで確認した。

- Cloud Run Job: `paluru-bus-observer`
- image: digest固定、generation 5
- execution SA: `paluru-bus-observer@paluru-bus.iam.gserviceaccount.com`
- timeout: 420秒
- task maxRetries: 1
- Scheduler morning: `0 7,8 * * 1-5` / `Asia/Tokyo` / ENABLED
- Scheduler evening: `30 17,18,19 * * 1-5` / `Asia/Tokyo` / ENABLED
- target: Cloud Run v2 Jobs `:run`へのOAuth POST

Job、Scheduler、IAM、image、public API、PWAは今回変更していない。

## 現在Rawから取得できるPosition evidence

既存`Bus_Observation_Raw`の34列から次を日次・provider・direction・route単位で評価できる。

- GPS timestamp / age / lat / lon
- HMAC vehicle identity
- trip / route / direction / service date
- Position Engineのstate / confidence / reason
- previous stop / next stop / segment key / expected segment count
- raw stop ID / sequence / status（auxiliary）

Raw schemaは変更しない。生vehicle ID、ODPT token、raw responseは保存しない。

## 現在不足する証拠

現行observerのruntimeは`p1-position-static.json`だけを読み、外部geometry sourceを注入していない。川崎GTFSにshapeがないため、現状のruntime Position Engineは`route_geometry_unavailable`へ安全に落ちる。既存Docker imageにも研究用road artifactは含まれない。

またRaw v1には次の値を直接保存していない。

- geometry source / version / geometry ID
- snap distance
- snapped progress
- inferred direction / direction confidence
- candidate stopsAway / stopsAway confidence
- outlier / ambiguous reasonの細分類

これらを空欄から推測しない。既存Rawのlat/lonと、別管理のgeometry candidateをderived evaluatorへ入力して再計算する。

## Shadow evaluator

`bus/observation/position-evaluator.js`は既存Rawを変更せず、次をpure calculationする。

1. Raw header完全一致、observation ID、HMAC、token/raw response疑いを検査
2. stale、GPS欠損、identity欠損を除外
3. provider / direction / route / trip chainを一致させる
4. GPSを候補geometryへ投影
5. route外、交差・重複geometryのambiguous projection、低confidenceを抑止
6. ordered stop projectionからprevious / next segmentとcandidate stopsAwayを算出
7. 同一HMAC vehicle / tripの時系列で進行方向、jump、jitter、stopsAway増加を検査
8. 生GPSを含まない日次summaryを生成

出力schemaは`Bus_Position_Evaluation`用に分離した。現時点ではstore / Cloud Run Job / Schedulerを実装・deployしていないため、実Sheetへは書かない。

## 登05 geometry candidate

既存PoC candidateは次の証拠を持つ。

- 281 points
- way接続gap 0
- GTFS stop 20件を投影
- ODPT GPS p95 44.58m
- 2 service days / 10 independent trips
- monotonic traces 10/10

一方で、`stop_projection_ambiguous`、service day不足、全segment coverage不足、同時刻の公式reference不足が残り、artifactは`geometryReady=false / eligible=false`である。P3.3 evaluatorもこれをPublic GOへ昇格しない。

## geometryReady gate案

50m、95%、98%を現時点のproduction閾値として固定しない。まず複数日のshadow summaryを収集し、分布と重大誤判定を確認する。

候補となるレビュー条件:

- 少なくとも3 service days、できれば平日5日以上
- 20 independent trips以上
- 全stop intervalで3 independent trips以上
- GPS usable coverageの分母・欠損理由が安定
- snap distance p50 / p80 / p90 / p95 / maxを記録
- 現行候補のp95 44.58mを再現できるか確認
- direction traceの単調性と95%信頼下限を確認
- stop projection order violation 0
- severe stopsAway contradiction 0
- route corridor gap 0
- origin / terminal / 分岐・近接道路を個別確認
- official referenceを同一trip・同一時刻で20 pair以上、high-confidence一致率95%以上

分布取得後に、`p95 <= 50m`、GPS usable coverage 95%、direction accuracy 98%を候補値として再評価する。観測母数と区間偏りを無視して採用しない。

## stopsAway validation

候補stopsAwayは`target stop ordinal - inferred next stop ordinal`とする。同一vehicle / tripで次を検査する。

- 時間とともに自然減少する
- 1 stopの境界振動はjitterとして別集計する
- 2 stop以上の逆増加はsevere contradiction
- geometry progressの後退、速度上限超過jumpをrejectする
- 一度通過したstopへ戻るtraceを方向矛盾とする
- origin / terminalではunknownへ落とせる
- raw sequence / statusの不一致はaux contradictionであり、GPS判定を上書きしない

重大矛盾0をPublic候補条件とする。

## Stage

|Stage|状態|昇格条件|
|---|---|---|
|0|`geometryReady=false`、UI非表示|候補geometryと自動Rawが揃う|
|1|shadow evaluation|複数日・全区間・複数便を自動集計|
|2|internal/debug、高confidenceのみ|閾値校正、重大矛盾0、公式reference十分|
|3|登05限定Public|実ブラウザ・Android受入とrollback確認|
|4|route拡大|routeごとに同じgateを独立PASS|

Providerやroute間でthresholdを流用しない。

## 自動収集の追加案

次の独立変更で、P3.3 evaluator用Cloud Run Jobを通常observer最終run後に起動する。

- input: `Bus_Observation_Raw` read-only、version固定geometry artifact、Position static
- output: `Bus_Position_Evaluation` append-only
- evaluator SA: Raw read + derived tab writeに限定
- Scheduler: 朝・夕の各最終run完了後。収集Jobと重ならない余裕を持つ
- idempotency: date/provider/direction/route/evaluator version/source fingerprint
- candidate artifactが未承認、hash不一致、schema不一致ならfail closed

road geometry artifactは現在Git ignore下の研究成果であり、OSM派生物の配布条件とattributionを再確認するまでcontainerへ入れない。このため自動derived JobのdeployはHOLDとする。

## Test

- GPS shape snap / stop interval / candidate stopsAway
- monotonic direction / reverse / speed jump
- ±1 stop jitter / severe stopsAway contradiction
- stale / missing / identity missing
- route crossing ambiguity / route外GPS
- research confidence threshold
- raw sequenceは補助証拠のみ
- Raw header / HMAC / token / raw response fail closed
- Public `geometry_ready=false`

## 現在地

既存Raw非変更のshadow evaluatorとderived summary schema、合成testまで実装した。通常observerの自動収集GCP実体はread-only確認済み。開発者端末のGoogle OAuth tokenはSheets scopeを持たず、observer SA impersonation権限もないため、実Sheetの最新分布はこの変更内で再取得できていない。

P3.3 Architecture / pure evaluatorはGO候補。実データgate、derived Job deploy、`Bus_Position_Evaluation`実書込、Stage 2以降、Public PositionはHOLD / OFFである。
