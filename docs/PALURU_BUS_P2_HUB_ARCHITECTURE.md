# PALURU Bus P2 Hub Architecture

作成日: 2026-09-13（Asia/Tokyo）

## P2.1実装前記録

- 問題: P2 ArchitectureはProvider非依存の契約までで、東急向01の正規Static取得、川崎結果とのruntime統合、利用者向け品質表示が未接続だった。
- 確認できた原因: 東急本体はODPT静的JSONを公開するが、正規Realtime datasetは確認できない。既存Hub modelには`static_only`がなく、Static便とRealtime便の品質を順位へ反映できなかった。
- 修正方針: 向01・神木本町a標柱→梶が谷駅とb標柱→向ヶ丘遊園駅南口の正式IDを固定検証するTokyu Static Providerを追加する。Cloud Run runtimeへread-only Hub endpointを追加し、Kawasaki P0結果はProvider内mapperで共通modelへ変換する。公開前まではローカルUIだけをFeature Gateで表示する。
- 影響範囲: `providers/tokyu/`、Kawasaki Hub mapper、`hub/service.js`、Hub model/ranking、HTTP/runtime/Docker allowlist、ローカルUI harness、tests、P2文書。
- 副作用: Hub request時だけ東急Staticを両方向3 queryずつ、計6 query取得する。6時間memory cacheとsingle-flightで重複取得を抑える。既存`/api/bus/arrivals`のresponse contractは変更しない。
- ロールバック: Hub endpoint/runtime composition、Tokyu Provider、Kawasaki mapper、ローカルHub UI追加を戻せばP0/P1 APIへ戻る。DB/data migrationはない。
- 受入項目: 4方面×3便、Static-onlyラベル、RT項目null、Provider片側障害、東急溝口不在、平日/土曜/日曜/祝日、CORS/Secret、30秒pollingと復帰refresh、P0/P1回帰、Position/Departure Public Gate OFF。

## 実装前記録

- 問題: P0/P1は1Providerの固定方向をカード単位で返す。事業者横断で同じ利用目的の便を比較する境界がない。
- 確認できた原因: CoreはProvider注入済みだが`hub/platform/nearby` Queryを意図的に拒否する。P0 Public DTOは表示単位で、Hub順位付けに必要な`effectiveDeparture/confidence/actionability`の内部契約がない。
- 修正方針: Provider/Coreの上に、Provider非依存のNormalized Hub Arrival契約とAggregator/Rankingを追加する。既存P0 API、PWA、Provider runtimeは接続変更しない。
- 影響範囲: 新規`bus/hub/`、新規Hub test、本設計書、東急調査書だけ。
- 副作用: なし。新規Hubコードは既存runtime/Docker/Public endpointからimportしない。
- ロールバック: 新規`bus/hub/`、Hub test、2つのP2文書を削除すればP0/P1状態へ戻る。データ移行・設定変更・deployはない。
- 実機試験項目: 今回はPublic UIを接続しないため実機対象なし。将来接続時に3便、group、順位、Provider欠損、30秒更新、横overflow、P0画面回帰を別Acceptanceにする。

## レイヤ構造

```text
Kawasaki Provider ----\
                       -> Normalized Hub Arrivals -> Hub Aggregator -> 将来のHub DTO/UI
Tokyu Provider --------/
                                 |
                                 +-> Ranking Policy
```

`bus/hub/`はProvider実装をimportしない。Providerごとのfetch、static/RT解釈、platform、attribution、vehicle、arrival normalizeは`providers/<id>/`に残す。HubはProviderが成功したarrivalだけを統合し、1Provider障害を状態として保持する。

P1の`core/queries.js`へ`hub` Queryを押し込まない。Favorite QueryのままProvider単位で取得し、その上位でHub sourceと利用目的を対応付ける。これによりProviderを追加してもCoreのroute/stop条件分岐は増えない。

## Normalized Hub Arrival

ProviderからHubへ渡す内部モデル。時刻はAsia/Tokyo文字列ではなくUnix epoch secondsとし、比較前に曖昧なparseを行わない。

```json
{
  "id": "provider-stable-trip-instance",
  "sourceId": "home_to_noborito",
  "provider": "kawasaki",
  "routeId": "10044",
  "routeLabel": "登05",
  "destination": "登戸駅（生田緑地口）",
  "originStop": { "id": "184_2", "name": "神木本町" },
  "targetStop": { "id": "184_2", "name": "神木本町" },
  "scheduledDeparture": 1789260000,
  "estimatedDeparture": 1789260180,
  "effectiveDeparture": null,
  "etaMinutes": 6,
  "delayMinutes": 3,
  "platform": "2番",
  "realtimeState": "realtime",
  "departureState": "realtime",
  "actionability": "catchable",
  "confidence": null,
  "position": {
    "supported": false,
    "state": null,
    "stopsAway": null,
    "previousStop": null,
    "nextStop": null,
    "confidence": null
  }
}
```

必須項目は`id/sourceId/provider/routeId/routeLabel/destination/originStop/targetStop/scheduledDeparture/realtimeState/position`。RT、実発車予測、platform、confidenceはnull可。欠損値を0やscheduledで補完しない。

`effectiveDeparture`は内部の確証済み候補だけに使う。Public実発車予測はOFFのままであり、このArchitecture追加でAPI公開しない。Positionも説明用であり、生GPSは契約に含めない。

## Hub設定と神木本町の正規構造

Hub IDは`kibukihoncho`。Hub configはProvider内部のstop解釈を行わず、`provider + sourceId`を利用目的へ束ねる。

|purpose|provider source|正式stop / route|状態|
|---|---|---|---|
|`noborito` 登戸方面|Kawasaki `home_to_noborito`|from `184_2`, route `10044` 登05|既存P0|
|`mizonokuchi` 溝の口方面|Kawasaki `home_to_mizonokuchi`|from `184_1`, routes `10032..10037`|既存P0|
|`kajigaya` 梶が谷方面|Tokyu `kibukihoncho_to_kajigaya`|from `...Shibokuhonchou.00240751.a`, route `...Kou01`, pattern `...0004600073`|P2.1 Static Provider実装済み|
|`mukougaoka` 向ヶ丘遊園方面|Tokyu `kibukihoncho_to_mukougaoka`|from `...Shibokuhonchou.00240751.b`, route `...Kou01`, pattern `...0004600232`|P2.1 Static Provider実装済み|

東急の正式値と不採用理由は[Tokyu Provider Research](PALURU_BUS_TOKYU_PROVIDER_RESEARCH.md)を正本とする。向01の反対方向は向ヶ丘遊園駅南口行きであり、登戸行きへ読み替えない。東急→溝の口はHub sourceにも`unresolved`にも設定せず、候補を生成しない。

初期`walkMinutes`はnull。徒歩時間未評価を0分と扱わない。将来はHub source bindingに非負分を追加し、時刻比較用の`arrivalAtBoardingPoint`等へ明示的に反映する。

## Aggregator契約

入力:

```js
aggregateHub({
  hub,
  generatedAt,
  providerResults: [
    { provider: 'kawasaki', arrivals: [...] },
    { provider: 'tokyu', error: { code: 'SOURCE_UNAVAILABLE' } }
  ]
})
```

出力:

```json
{
  "hubId": "kibukihoncho",
  "generatedAt": 1789260000,
  "providers": [
    { "provider": "kawasaki", "state": "available" },
      { "provider": "tokyu", "state": "unavailable", "code": "SOURCE_UNAVAILABLE" }
  ],
  "arrivals": [],
  "groups": [
    { "id": "noborito", "label": "登戸方面", "recommendedArrivalId": null, "arrivals": [] }
  ]
}
```

- Hub設定自体が不正ならfail closed。
- Provider resultがerror、欠損、型不正ならそのProviderを`unavailable/invalid`として隔離する。
- 正常Providerのarrivalsは残す。
- Hub sourceに未登録のarrivalは推測分類せず除外する。
- Provider固有stop/routeをAggregatorで解釈しない。

## Ranking

各arrivalの比較時刻は次の順で選ぶ。

1. 有効な`effectiveDeparture`
2. `generatedAt + etaMinutes * 60`
3. `estimatedDeparture`
4. `scheduledDeparture`

`etaMinutes`と`estimatedDeparture`が同時にある場合は許容差を検証し、矛盾するcandidateをinvalidにする。今回の純粋Ranking関数は比較済みのnormalized値だけを受ける。

推薦tier:

1. actionabilityが利用可能で、明示的なlow confidenceでない便
2. actionabilityは利用可能だが明示的low confidenceの便
3. `departure_uncertain`、`unknown`、`do_not_recommend`

`cancelled/departed`は候補から除外する。tier内では比較時刻、scheduled、provider、idの順で安定sortする。`departure_uncertain`は結果には説明用で残せるが`recommendedArrivalId`にはならない。Position/stopsAwayは順位キーにしない。

`static_only`は明示的な品質tierとし、時刻が早くてもfresh Realtimeより高確度には扱わない。一方、同じ目的groupにRealtime候補がない場合は時刻表候補として表示できる。`departure_uncertain`と`do_not_recommend`は引き続きおすすめ対象外であり、Static-onlyと混同しない。confidenceの校正前閾値はHub設定に直書きせずRanking optionとして注入する。

## P2.1 runtime/API

Cloud Run候補runtimeへ次を追加した。

```text
GET /api/bus/hub?id=kibukihoncho
```

既存`GET /api/bus/arrivals`は変更しない。Hub serviceはKawasaki P0 serviceとTokyu Static Providerを`Promise.allSettled`で独立取得し、一方の失敗をもう一方へthrow伝播させない。

品質値は次の意味に固定した。

|Provider状態|`realtimeState`|時刻フィールド|
|---|---|---|
|川崎 fresh RT|`realtime`|scheduled + availableなestimated/ETA/delay|
|川崎 前回RT|`stale`|RT値はあるがfresh扱いしない|
|川崎 RTなし|`static_fallback`|scheduledのみ|
|東急 正規Static|`static_only`|scheduledのみ。estimated/ETA/delayは必ずnull|

Tokyu Providerは`BusstopPole`、`BusroutePattern`、`BusstopPoleTimetable`のexact queryだけを取得する。向01のa/梶が谷駅とb/向ヶ丘遊園駅南口以外はvalidatorで拒否し、東急溝の口候補を生成するコード・設定は持たない。Provider statusには静的データの`retrievedAt`と`sourceUpdatedAt`だけを安全なepoch秒として載せ、Hub UIは取得日時とattributionを表示する。

曜日判定は東急固有resolverに閉じ込める。ODPT一般仕様ではHolidayとSundayは別calendarだが、対象東急datasetにはHolidayがなく、ODPT Sundayの全便が東急公式時刻表の休日列とa/b両方向で一致した。内閣府が公表済みの2026〜2027年の祝日・休日だけをSundayへ割り当て、範囲外は非表示へfail closedにする。年末年始・お盆・臨時ダイヤは別の公式告知確認が必要で、自動推測しない。

P2.1の本番Cloud Run受入前はlocal harnessだけが`PALURU_BUS_HUB_UI_ENABLED=true`を渡していた。本番revision `paluru-bus-api-00002-thc`の受入後、PWA sourceも同Gateをtrueにし、`index.html`からHub scriptとstyleを読み込む。Static-onlyは`時刻表のみ`と表示し、「あと○分」「遅れ」表示を作らない。Position DOMは追加しない。

## Provider別の違い

|境界|Kawasaki|Tokyu候補|Hubの扱い|
|---|---|---|---|
|Static|GTFS/GTFS-JPをP0 JSONへ事前抽出|ODPT静的JSON|Provider内でNormalized Arrival化|
|RT|GTFS-RT TripUpdates/VehiclePosition|正規経路を確認できず|TokyuはRT null、Kawasakiを維持|
|trip ID|GTFS trip_id|ODPT BusTimetable ID|Provider固有のstable IDとして渡す|
|stop列|stop_times|BusroutePattern order|Provider内で解釈|
|platform|川崎の公式対応表|BusstopPoleNumber `a` / `b`|Provider表示Resolverで解釈。Hubは文字列だけ受ける|
|geometry|公式shapeなし、別P1研究|対象patternにLineStringなし|position unsupportedを許容|
|attribution|川崎市交通局 + ODPT|東急バス + ODPT|Provider contextから集約|

## 拡張境界

新Provider追加は、ProviderがNormalized Hub Arrivalを返し、Hub configに`provider + sourceId + decisionGroupId`を足す。Aggregator/Ranking変更は原則不要。Nearby、Platform、溝の口Hubは別config/resolve段階を追加し、Provider内で最終UI groupを決めない。

## Acceptance

|条件|設計時点|
|---|---|
|東急の正規データ取得可否|PASS: Staticのみ取得可、RTはNO-GO|
|Provider境界の共通化|PASS: runtime Hub serviceで統合|
|神木本町stop/route構造|PARTIAL: 3候補確定、東急→溝の口は正式routeなし|
|Provider非依存Aggregator|PASS: Hub graphのProvider非依存test|
|川崎のみで動作|PASS: failure isolation test|
|東急欠損でもHub継続|PASS: failure isolation test|
|confidence / uncertain|PASS: low confidence降格・uncertain推薦除外test|
|P0/P1回帰|PASS: Repository 91/91、Bus 127/127|
|Position UI OFF|PASS: flag回帰test・live response|
|Public departure prediction OFF|PASS: flag回帰test|

## 判定基準

P2.1 local Architectureは、Tokyu Static Provider、Hub runtime、品質別Ranking、Provider障害隔離と全回帰が通ればGO。事業者横断Realtime比較、東急→溝の口候補、本番Hub UIはこのGOに含めない。

全機能としてのP2 Hubは現時点で**NO-GO**。東急Realtimeがなく、要求候補の1つに正式routeがないためである。

## 実装・検証結果

新規Architecture/P2.1 seam:

- `bus/hub/config.js`: Hub、目的group、Provider source binding、未解決候補
- `bus/hub/model.js`: Provider共通のallowlist型と欠損・矛盾検査
- `bus/hub/ranking.js`: effective/ETA/staticの比較時刻、confidence、uncertainの安全な順位
- `bus/hub/aggregator.js`: Provider障害隔離、group化、推薦便選択
- `bus/hub/service.js`: Provider並列取得と片側障害隔離
- `bus/providers/tokyu/`: 向01両方向のexact Static Provider、祝日resolver、attribution、cache
- `bus/providers/kawasaki/hub.js`: P0 DTOからHub modelへのProvider内変換
- `bus/http/handler.js`: fixed Hub read-only endpoint
- `features/bus/hub.js` / `hub.css`: local-only Feature Gate UI
- `bus/test/hub.test.js` / `tokyu.test.js` / `test/bus-hub-ui.test.js`: 契約・障害・品質・UI試験

検証結果:

- Hub/Tokyu/UIの今回対象試験: 22/22 PASS
- 平日/土曜/日曜/祝日のlive全便照合: PASS。a 39/39/38、b 39/39/38でODPTと東急公式各列が一致
- Bus全体: 129/129 PASS、fail/skip 0
- Repository全体: 92/92 PASS、fail/skip 0
- JS構文、対象diff check: PASS
- Static preflight: 3,134,559 bytes、4方向 660/3820/660/3716件
- runtime bundle: 3,329,851 bytes、gzip 166,520 bytes、36 modules、ZIP downloader/full parserなし
- Cloud Build context: 64 files / 4,735,028 bytes、`.dev.vars`/`.local`/testsなし、Tokyu runtime 4 filesを含む
- Cloud Build: 初回smokeでDockerfileのKawasaki departure module漏れを検出・修正。再build `1d257ee9-ba01-446e-a22f-3797a3882bc8` SUCCESS、image digest `sha256:c57a042b80ed594564592f352012985afcb6aaf8721f10a50e7d2b23dfa5b99f`
- Secret scan: 435対象、matches 0
- P0完全DTO 13ケース、Cloud Run Node runtime、Position/Departure/Observation既存回帰を含めてPASS
- `BUS_POSITION_UI_ENABLED=false`、`DEPARTURE_PREDICTION_PUBLIC_ENABLED=false`を回帰試験で確認

最初のsandbox内Bus実行ではesbuildがworkspace上位を読めず4件失敗し、Secret scanも走査制限で失敗した。同一コードを権限制限外で再実行した結果は上記の全PASS。実装失敗を隠した再試行ではない。

実ODPTを使うローカルCloud Run相当HTTPで、登戸・溝の口・梶が谷・向ヶ丘遊園の4方面各3便を確認した。東急6便はすべて`static_only`で、estimated/ETA/delayはnull、東急溝の口は0件、P0 Position UIはfalseだった。ローカルブラウザでも4方面各3便、a/b標柱、`時刻表のみ`、静的取得日時とattributionを確認した。390px幅でdocument/bodyの横overflowなし、画面離脱後31.5秒でrequest数不変、復帰1.2秒後の即時refreshを確認した。

P2.1 imageはユーザー操作でCloud Run validationとproductionへdeployし、production revision `paluru-bus-api-00002-thc`のremote受入がPASSした。その後、PWA sourceへHub mount/script/style、Gate ON、Service Worker更新、Build更新を限定反映した。GAS、Position UI、Public departure predictionは変更していない。GitHub Pages公開、commit、push、Android実機受入は未実施。

## GO / NO-GO

- **P2 Hub Architecture: GO**。Provider非依存の契約、Aggregator/Ranking、障害隔離、川崎単独動作、confidence/uncertain安全境界をsource testで確認した。
- **Tokyu Static Provider / local Hub API: GO**。正規ODPT exact query、3便、品質境界、片側障害隔離を確認した。
- **Tokyu Realtime / 事業者横断Realtime Hub: NO-GO**。正規RTデータが確認できない。
- **東急 神木本町→溝の口: NO-GO**。正式routeが存在する証拠がない。
- **本番Hub UI source: GO**。祝日calendar、Cloud Run remote受入、PWA Gate/asset/lifecycleと回帰試験はPASS。Web公開とAndroid実機受入は未実施。

## P2.2 Decision Group追記

P2.1の4つの行先groupは履歴として上記に残す。P2.2では事業者・物理乗り場より利用判断を優先し、正本を`decisionGroups`へ変更した。神木本町は`登戸・向ヶ丘遊園方面`、`溝の口方面`、`梶が谷方面`の3 groupである。正確な契約、遅延表示、Legacy Gate、ローカル受入は[PALURU Bus P2.2 Hub UX](PALURU_BUS_P2_2_HUB_UX.md)を正本とする。
