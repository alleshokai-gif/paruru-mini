# PALURU Bus P1 Departure Prediction

## 状態

- フェーズ: Architecture / PoC
- Public departure prediction: `OFF`
- 本番デプロイ: 対象外
- 最初の対象: 溝の口駅南口 → 神木本町、登戸 → 神木本町
- 最終更新: 2026-09-12 (Asia/Tokyo)

## 問題

始発・折返し停留所では、scheduled departureを過ぎても折返し車両が未到着で、便がまだ発車していない場合がある。現行Coreは `estimated < now` と `scheduled < now` を基準に過去便を除外し、例外はVehiclePositionが対象始発stopで `STOPPED_AT` 相当と一意に結合できる場合だけである。

したがって、折返し車両が前便を走行中、VehiclePosition欠損、RT event欠損などでは、未発車の可能性がある先発便が消え、未来時刻の次便を先発として表示する余地がある。

## 修正方針

途中停留所のP0過去便除外は維持し、Static GTFSで当該boarding stopがtrip originと証明できる便だけにOrigin Departure Persistenceを適用する。

内部状態は次を扱う。

```text
scheduled
realtime
departure_pending
departure_overdue
departed
cancelled
unknown
```

`scheduled < now` または `estimated < now` だけでは `departed` としない。発車済みの肯定的証拠、または明示的なcancellationがあるまで、bounded grace内では `departure_pending` / `departure_overdue` を先発候補として保持する。

## Internal prediction model

```json
{
  "scheduledDeparture": 0,
  "incomingArrivalEstimated": null,
  "turnaroundEstimateSec": null,
  "estimatedReadyTime": null,
  "estimatedDeparture": null,
  "state": "departure_overdue",
  "confidence": 0,
  "source": "unavailable",
  "evidence": []
}
```

予測値が成立する場合も次を守る。

```text
estimatedDeparture = max(scheduledDeparture, incomingArrival + observed turnaround requirement)
```

固定の折返し時間は採用しない。terminal / platform / time bandごとに、同一車両が証明された `arrival → actual departure` の分布から推定する。

## incoming trip link level

- Level A: `block_id`、一意なvehicle ID、または正規データのtrip chainで同一車両を証明できる。内部PoCの予測に使用可能。
- Level B: 運用パターンから候補を限定できるが一意に証明できない。内部参考値のみ。
- Level C: 不明。`estimatedDeparture=null`。

Level B/CをPublic表示へ昇格しない。

## 発車済みの肯定的証拠

強い順に次を設計対象とする。証拠の実充足はPoCで記録する。

1. 同一tripの連続GPSがoriginから次区間へ進行し、Position Engineがhigh confidenceでorigin通過後を返す。
2. 正規RTでorigin後のstop eventが時系列・trip identityとも一意に成立する。
3. VehiclePositionの補助stateがStatic stop列とGPSの両方に整合する。
4. cancellation / trip relationshipによる明示状態。

raw `current_stop_sequence / stop_id / current_status` 単独は肯定的証拠にしない。

## Origin Departure Persistence

始発便の状態判定は以下とする。

- 定刻前で発車証拠なし: `departure_pending`
- 定刻超過、RT feedはfresh、当日service有効、発車/cancel証拠なし: `departure_overdue`
- origin乗り場で停車をGPS等と整合確認: `departure_pending`
- origin通過後を肯定的に確認: `departed`
- cancellation明示: `cancelled`
- 証拠不足または保持期限超過: `unknown`。発車済みとは断定しない。

`departure_pending` と `departure_overdue` は、次便に未来RTがあってもscheduled順の先発候補として保持する。ETAを0分へ丸めず、「遅延中・発車未確認」等の専用状態へ接続する。

## Bounded grace

無期限保持はしない。PoCでは明示設定を使うが、Public採用前に次で校正する。

- feed / trip / GPS鮮度
- 当該tripのservice有効性
- 次便との間隔
- terminal / platform / time band別の到着→発車実績分布
- incoming vehicleの有無と予想到着

保持期限を超えた場合は `unknown` とし、「運行状況を確認できません」へ落とす。`departed` へ自動遷移しない。

## Sorting boundary

候補の並べ替えは内部の `effectiveDeparture` を将来利用できる構造にする。ただし、未発車の先発候補を未来時刻の次便がscheduledだけで追い越さない。

```text
1. 15:00 departure_overdue
2. 15:15 realtime / scheduled
3. 15:30 realtime / scheduled
```

Hubの乗り場横断比較とPublic UIは今回実装しない。

## 影響範囲

- Static build/index: trip origin、必要なら `block_id`
- Kawasaki internal RT model: vehicle identity等が実際に存在する場合だけ保持
- `bus/departure/`: origin判定、evidence、persistence、prediction PoC
- Core: PoCをPublic配列へ接続する場合もorigin専用分岐に限定
- Public DTO: `estimatedDeparture`、incoming vehicle、turnaround値は非公開。既存`state`だけに`departure_pending` / `departure_overdue`を載せる
- PWA: overdueを0分や定刻扱いせず、安全状態の文言だけ表示する

## 副作用とfail-safe

- incoming車両不明、GPS stale、trip chain不明、RT欠損、矛盾、turnaround証拠不足では予測しない。
- scheduledをpredictionとして表示しない。
- 途中停留所へOrigin Persistenceを適用しない。
- cancellationは保持しない。
- stale feedから発車済みを断定しない。

## ロールバック

Departure Predictionの内部sidecar / policy注入を外し、既存P0 Coreへ戻す。Public表示はOFFのため、P0 API DTOは変えない。Coreに接続したorigin専用保持が回帰を起こす場合は、その分岐だけを戻す。

## 実装前Acceptance

1. 始発scheduled超過＋RT欠損で直ちに次便へ切り替わらない。
2. 始発scheduled超過＋車両未到着は `departure_overdue`。
3. 始発scheduled超過＋乗り場停車は `departure_pending`。
4. 連続GPSでorigin発車を確認した場合だけ `departed` として除外可能。
5. cancellationは除外する。
6. 次便に未来RTがあっても未発車先発便を勝手に追い越さない。
7. stale feedでは発車済みと断定しない。
8. bounded grace超過は `unknown` へ安全に落とす。
9. originと途中停留所をStatic stop列から区別する。
10. incoming link欠損・stale・矛盾は `estimatedDeparture=null`。
11. 推定値をscheduledより早くしない。
12. P0途中停留所、ETA、stale/fallbackの回帰testがPASSする。

## 実ブラウザ受入項目

Public Gateを将来ONにする場合、始発超過便の保持、次便との順位、cancellation、通信失敗、復帰refresh、30秒polling、他画面回帰を本番相当ブラウザで確認する。今回のPoCではPublic GateがOFFのため実ブラウザ受入は未実施・未完了と記録する。

## Static・Realtime調査結果

2026-09-12 Asia/TokyoにP0 Static 8,856 tripと当日のRealtimeを調査した。

### 始発構造

|P0方向|対象trip|当該乗車stopがorigin|途中停留所|
|---|---:|---:|---:|
|神木本町→登戸|660|0|660|
|神木本町→溝の口駅南口|3,820|48|3,772|
|登戸→神木本町|660|660|0|
|溝の口駅南口→神木本町|3,716|3,696|20|

溝の口駅南口発の例外20tripは、`434_2` route 10033が8trip、`434_3` route 10036が12tripで、いずれもstop sequence 7の途中停留所。`434_4`の760tripはすべてoriginである。名称や乗り場だけで始発と決めず、tripごとの完全stop列から`originStopId`、`originSequence`、`isOrigin`をP0 Static artifactへ生成した。

### block / vehicle identity

- Static `trips.txt`には`block_id`列があるが、P0選択8,856tripでは値あり0件。Staticだけでは折返しchainを作れない。
- 1回のRT観測ではVehiclePosition 134/134件、TripUpdates 134/205件に`vehicle.id`があり、同一tripのTU↔VPは132件で一致、conflict 0件だった。
- `vehicle.id`はProvider内部modelだけに保持し、Public DTO、ログ、検証Markdownへ生値を出さない。検証captureでは毎回異なるsaltによるhashへ置換した。
- raw sequence / stop / statusは同一車両の証明や発車証拠に使わない。

## 連続観測PoC

8回×31秒、約4分の限定観測を実施した。P0対象のvehicle/updateだけを要約保存し、raw response全文は保存していない。

- selected vehicle observations: 209
- selected TripUpdates: 209
- 同一vehicle IDのtrip transition: 2件
- 対象始発へのtransition: 1件
- same-feed future assignment: 0件
- exact arrival→departure turnaround sample: 0件

対象transitionでは、溝18の鷲ヶ峰営業所前→溝口駅南口tripが`434_5`へ向かった後、同じhashed vehicleが49秒後に溝口駅南口3番`434_3`始発の溝18へ切り替わった。Staticのterminal areaも一致し、**遷移後に確認できる同一車両trip chainとしてLevel Aを1件観測**した。

ただし切替は次tripのscheduled departureより362秒前で、future tripが前feedに予告された例ではない。origin到着とorigin発車をPosition high confidenceで挟めておらず、Observed Dwell / Turnaround Timeには数えない。もう1件のtransitionは登05の登戸発から後続の神木本町→登戸tripだったが、前tripの終点と次tripの始発areaが一致せずLevel Cとした。

結論は次のとおり。

- 一意なvehicle IDによる**遷移後の**trip chain追跡は成立候補。
- 発車前にincoming vehicleを一意に割り当てる証拠は0件。
- 正確なterminal arrival→actual origin departureを測るPosition証拠は0件。
- `estimatedDeparture`は`null`、prediction levelは現時点でLevel C。

## Bounded graceの初期PoC

Staticの同一乗り場headwayを参考値として集計した。

|始発stop|sample|median|p80|max|
|---|---:|---:|---:|---:|
|登戸 `362_1`|648|19分|22分|33分|
|溝の口 `434_2`|1,200|10分|12分|27分|
|溝の口 `434_3`|1,712|6分|10分|28分|
|溝の口 `434_4`|748|13分|22分|66分|

これは発車遅延や折返し所要時間の分布ではなく、保持をboundedにするための時刻表間隔の参考値に限る。初期PoC policyは`min 10分`、headwayの2倍、fallback 30分、上限45分とした。値はterminal実績で未校正なのでPublic仕様に固定しない。

grace内では、始発のscheduled/estimated超過だけで便を除外せず`departure_overdue`としてscheduled順に保持する。高confidence GPSでorigin停車を確認した場合は`departure_pending`、origin通過を確認した場合だけ`departed`とする。grace超過は`unknown / grace_expired`であり、発車済みとは断定しない。Public GateがOFFの現在はunknown専用表示をまだ公開しない。

## 実装結果

- `bus/providers/kawasaki/static.js`：tripごとの`originStopId`、`originSequence`、`isOrigin`を生成。
- `bus/departure/engine.js`：origin専用state、肯定的発車証拠、bounded grace、incoming/turnaround予測のfail-closed評価。
- `bus/departure/tracker.js`：正確なvehicle IDとStatic terminal areaが一致したtransition / same-feed assignmentだけをLevel A chain候補にする。Position証拠はturnaround時刻用に別判定。
- `bus/departure/turnaround.js`：Level Aかつhigh confidenceのarrival/departure sampleだけを記録し、最低12件からmedian/p80を算出。
- `bus/providers/kawasaki/departure.js`：登戸と溝の口駅南口各乗り場のProvider固有terminal areaを定義。
- `bus/core/arrivals.js`：resolver注入時だけorigin専用保持を適用。途中停留所の既存過去便除外は維持。
- `features/bus/bus.js`：将来stateを受けた場合もETA 0分にせず、「遅延中・発車未確認」「発車待ち」と表示。予測発車時刻自体は公開しない。

## Departure Prediction Acceptance

Origin Departure PersistenceのArchitecture / 合成PoCはGO候補。指定された8ケース（RT欠損、車両未到着、乗り場停車、GPS発車確認、cancel、未来次便、stale、grace超過）をorigin専用testで固定した。

一方、実発車予測はpre-departure linkとturnaround実測が0件のためPublic表示`NO-GO / OFF`である。Position Engineが実路線でorigin到着・通過をhigh confidence判定でき、terminal / platform / time band別に最低12件のLevel A sampleを得るまで`estimatedDeparture`を返さない。

## 最終検証

- Origin Persistence / tracker / turnaround / UI合成testを含むBus全体：94/94 PASS。
- Repository全体：85/85 PASS。
- 正規ODPTを使ったローカルNode受入：4方向×3便、health、CORS、cache、fallback、Secret非露出をPASS。
- 14:35時点の実レスポンスで、登戸始発の14:14便と14:35便、溝の口始発の14:26 / 14:31 / 14:32便が、scheduled超過だけでは消えず候補に残った。ETAはnullで、0分へ偽装していない。
- PWA表示試験：`departure_overdue`は「遅延中・発車未確認」、`departure_pending`は「発車待ち」、時刻labelは「便」。Position UIはOFF。
- Secret scan：383対象、token一致0。

実ブラウザ・Android実機・本番Cloud Runでは未確認。本番deployは実施していない。

始発便の表示継続・順位・除外を扱う次フェーズは [PALURU_BUS_P1_DEPARTURE_CONFIDENCE.md](PALURU_BUS_P1_DEPARTURE_CONFIDENCE.md) を正本とする。実発車時刻予測は引き続きOFFであり、Confidence stateと予測時刻を混同しない。
