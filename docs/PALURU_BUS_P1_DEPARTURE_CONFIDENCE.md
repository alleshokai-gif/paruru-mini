# PALURU Bus P1 Departure Confidence

## 状態

- Phase: Architecture / PoC
- 対象: 登戸 → 神木本町、溝の口駅南口 → 神木本町のtrip origin
- Public実発車時刻予測: `OFF`
- Position UI: `OFF`
- 本番deploy: 対象外
- 最終更新: 2026-09-12 (Asia/Tokyo)

## 問題

始発停留所では、scheduled departure超過だけで便を消すと遅延未発車便を見失う。一方、発車済みの肯定的証拠が取れない便を長時間先頭へ残すと、利用者へ「走れば間に合う」と誤認させる。特に登05のような低頻度路線では後者の損失も大きい。

Phase 3のOrigin Departure Persistenceは、scheduled超過便をbounded grace内で`departure_overdue`として保持する。ただし、保持中のactionability段階、`departure_uncertain`、証拠が消えた後もterminal stateを維持する遷移規則、次便との安全なrankingが未完成である。

## 修正方針

Static GTFSで`isOrigin=true`と証明した便だけを状態機械へ渡す。途中停留所のP0過去便除外は変更しない。

状態：

```text
scheduled
departure_pending
departure_overdue
departure_uncertain
departed
cancelled
unknown
```

actionability：

```text
catchable
uncertain
do_not_recommend
```

`departed`と`cancelled`はterminal stateとし、同じtrip instanceでRT証拠が一時欠損してもoverdueへ戻さない。`unknown`は通常rankingから除外するが、発車済みとは断定しない。

## 肯定的証拠

allowlistした証拠だけを受け付け、同じtrip ID・運行日・fresh timestampを検証する。

1. `gps_origin_passed`: high confidenceの連続GPSがorigin geofence内から外へ進行。
2. `trip_next_stop`: 同一trip / vehicleを次停留所以降で一意に確認し、GPS時系列とも整合。
3. `rt_departed`: RT仕様上の明示的な発車後stateを確認。
4. `vehicle_next_trip`: 同一vehicleがStatic上で整合する次tripへ実際に遷移。
5. 明示的cancellation。

`scheduled < now`、`estimated < now`、TripUpdateに未来のstop eventがあること、raw `current_stop_sequence / stop_id / current_status`単独は発車証拠にしない。

## 時間窓

PoC policyは固定分数だけで判定せず、次便までのheadwayを基本に、RT freshness、同一trip update、同一vehicle、低頻度判定を入力とする。

- overdue window: scheduled超過直後に先発候補として保持できる短い窓。
- uncertainty window: 表示は残せるが「間に合う便」と推奨しない窓。
- retention window: 超過後は`unknown`として通常rankingから外す上限。

freshな同一trip/vehicle証拠は窓を延長できるが、発車済み判定の代用にはしない。stale RTは窓を短縮し、発車済みと断定しない。低頻度路線はcatchable扱いと先頭保持を早めに解除する。全閾値は設定値とし、実績分布を得るまで本番値にしない。

## Ranking

- `scheduled` / fresh future `realtime` / high-confidence `departure_pending`: 通常候補。
- `departure_overdue`: freshなsame-trip証拠があり低頻度でない短時間だけ先頭保持可能。それ以外はactionability=`uncertain`。
- `departure_uncertain`: actionability=`uncertain`または`do_not_recommend`。未来の通常便より常に優先しない。
- `departed` / `cancelled` / `unknown`: 通常rankingから除外。

Public実発車時刻は今回生成しない。Public rowには既存`state`を使い、`departure_uncertain`を「発車済みの可能性あり・間に合う保証なし」と表示できるようにする。生GPS、vehicle ID、証拠詳細、内部actionabilityは公開しない。

## 実データ観測

研究用captureはP0対象tripだけを保存し、vehicle IDはcaptureごとのsaltでhash化する。API response全文とSecretは保存しない。

最低限記録する項目：

- route / origin stop / scheduled departure
- first positive departed evidence type / timestamp
- RT feed timestamp / GPS timestamp
- hashed vehicle key
- actual trip transitionの有無
- scheduledから証拠までのelapsed seconds
- feed / GPS ageとreject理由

同じtripの重複sampleを分布件数へ水増ししない。証拠が取れなかった便もcensored sampleとして残し、成功例だけで閾値を校正しない。

## 影響範囲

- `bus/departure/`: state machine、時間窓、origin GPS evidence、短期履歴
- `bus/core/arrivals.js`: origin decisionのrankingだけ
- `features/bus/bus.js`: `departure_uncertain`の安全表示
- `bus/scripts/`: research-only観測・集計
- Public Position DTO / Hub / 実発車時刻予測: 変更しない

## 副作用とfail-safe

- Evidence欠損・stale・矛盾は`departed`へ昇格しない。
- low-frequencyでuncertainな便は`catchable`にしない。
- 状態機械・observerが失敗してもP0途中停留所、ETA、Provider fetchを壊さない。
- instance再起動で内部履歴を失った場合は、保存していない発車証拠を推測せず再観測する。

## ロールバック

Cloud Run composition rootからDeparture Confidence resolverを外せば、Coreの既存P0処理へ戻せる。Position UIと実発車予測はOFFのため、それらの公開契約は変更しない。PWA state文言は該当stateが返らなければ使われない。

## 実装前Acceptance

1. 遅延未発車のorigin便がscheduled超過だけで消えない。
2. high-confidence発車証拠で速やかに`departed`となり除外される。
3. 証拠不足が続けば`departure_overdue`→`departure_uncertain`→`unknown`へ進む。
4. `departure_uncertain`は低頻度路線で`do_not_recommend`となる。
5. uncertain便を未来の通常便より常に優先しない。
6. stale RT / GPSで発車済みと断定しない。
7. cancellationは除外しterminal stateを維持する。
8. terminal stateは同一trip instance内で後戻りしない。
9. 途中停留所の過去ETA除外を変更しない。
10. Public DTOへ生GPS・vehicle ID・証拠詳細・実発車予測を出さない。
11. Position UIはOFF。
12. P0 ETA、fallback、stale、4方向×3便を回帰確認する。

## 実測結果と判定

### 状態機械

`bus/departure/engine.js`を同一trip instanceのstateを短期保持する状態機械へ変更した。

- `departed` / `cancelled`はterminal state。同じ便で証拠が一時欠損しても復活しない。
- `departure_overdue`から、証拠不足の継続で`departure_uncertain`、retention超過で`unknown`へ進む。
- stale feedは現在のGPSやtrip transitionを新しい発車証拠へ昇格しない。
- future estimatedがある便はscheduledを過ぎても通常の`realtime / catchable`を維持する。
- origin geofenceは同じvehicle/tripの3点以上を要求。停留所付近の連続滞留、またはorigin内から110m外へ2点連続で進行した場合だけ内部証拠を返す。
- raw sequence / stop / statusはorigin geofenceに渡さず、単独では発車判定しない。

時間窓はroute ID＋origin stopごとの次便headwayを使う。別路線・別乗り場の高頻度便で低頻度路線の窓を短く見せない。PoC例では、headway 20分以上はlow-frequencyとなり、fresh時もoverdue先頭保持候補は最大90秒。stale時はoverdue最大60秒、retentionもheadway由来値から短縮する。これらは検証用設定であり本番値ではない。

`departure_uncertain`は通常の未来便より後ろへ並べる。ただし警告自体が完全に消えないよう、3行中1行を最多1件のuncertain originへ予約する。低頻度またはstaleでは内部actionabilityを`do_not_recommend`とする。Public DTOへactionabilityや証拠は出さず、既存`state`だけをUI文言へ変換する。

### 実データ観測

2026-09-12 15:07:03〜15:12:46 Asia/Tokyo、12回×31秒の限定観測を行った。対象は登戸→神木本町と溝の口駅南口→神木本町。API response全文と生vehicle IDは保存せず、vehicle IDはcapture固有saltでhash化した。

- 観測対象となったStatic trip instance: 26
- scheduledを観測窓内で跨いだ便: 1
- 観測開始前にscheduledを過ぎていたleft-censored便: 15
- 観測終了時点で未来だった便: 10
- 肯定的発車証拠: 1
- 同一vehicleの次trip遷移: 0
- scheduledを跨いだが証拠未取得のright-censored便: 0

唯一の校正候補は、溝11 route 10032、溝口駅南口4番`434_4`、scheduled 15:08便。同一hashed vehicleを15:06:14から観測し、連続GPSのorigin離脱を15:10:43にhigh confidence 0.980で確認した。最初の肯定的証拠はscheduledから163秒後だった。

1件のmedian / p80 / p95はすべて163秒になるが、統計的な閾値ではない。登05は観測候補3便、RT/GPS各12 sampleを得たが、観測窓内でscheduledを跨いだ便がなく、発車確証時間のsampleは0件。threshold calibrationは`ready=false`とした。route＋originごとに少なくとも20 positive sampleとcensored sampleを含めるまではPoC閾値を本番採用しない。

### ローカルNode受入

2026-09-12 15:23:03 Asia/Tokyo、正規ODPTを使ったCloud Run相当Windows Node processで4方向×3便、health、CORS、25秒cache、fallback、Secret非露出をPASSした。

- 登戸発は未来の15:47、16:09を先に表示し、証拠不足の15:22便を3行目のuncertain警告枠へ移動。
- 溝口発は未来の15:26、15:27を先に表示し、15:20便を3行目へ移動。
- uncertain便のETAはnullで、「あと0分」やcatchableな便として扱わない。
- process起動→health 434.02ms、初回API 131.70ms、cache hit 9.97〜18.15ms、cache更新116.66ms。Departure Confidence処理は0.48〜1.96ms、JOINは6.48〜13.84ms。これはCloud Run/container実測ではない。

### 最終検証

- Bus test: 105 / 105 PASS
- Repository test: 86 / 86 PASS
- Static preflight: PASS（3,134,559 bytes、4方向660 / 3,820 / 660 / 3,716 trip instance）
- Secret scan: PASS（391 files、matches 0）
- `git diff --check`: PASS。LF / CRLF変換予告だけでwhitespace errorなし。
- deploy / commit / push: 未実施。

### Acceptance

|項目|結果|
|---|---|
|scheduled超過だけで消さない|PASS（合成＋ローカル実データ）|
|肯定的証拠でdepartedへ遷移|PASS（合成、実GPS 1件）|
|overdue→uncertain→unknown|PASS（合成）|
|低頻度uncertainをdo_not_recommend|PASS（合成）|
|uncertainを次便より常時優先しない|PASS（合成＋ローカル実データ）|
|stale RT/GPSからdepartedを断定しない|PASS（合成）|
|cancellation除外とterminal保持|PASS（合成）|
|途中停留所のP0過去便処理|PASS（回帰test）|
|Public内部証拠・生GPS・vehicle ID非露出|PASS（test / Secret scan）|
|Position UI / 実発車予測OFF|PASS（source/test）|
|閾値の実績校正|NO-GO（校正可能1件、登05 0件）|
|本番ブラウザ・Android|未実施|

**Architecture / state-machine PoCはGO。本番投入はNO-GO。** 理由は、実GPSで肯定的発車証拠を1件取得できたものの、優先対象の登05が0件で、route＋origin別の発車確証時間分布とfalse-positive / false-negative率を評価できないため。Public実発車予測とPosition UIはOFF、本番deployは実施しない。
