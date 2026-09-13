# PALURU Bus: バスNAVITIME「何停前」表示方式調査

## 1. 調査目的と結論

調査日: 2026-09-12（Asia/Tokyo）

PALURU BusのPosition / Hub設計の参考として、Android版「バスNAVITIME」が事業者をまたいで「何停前」「あと何分」を扱う方式を、公開情報とAndroid APKの静的解析から調べた。

現時点の最有力構成は **A + D** である。

- **A: サーバーが停留所手前indexと残り分数を返す**
- **D: NAVITIME側が事業者別入力を共通モデルへ正規化する**

Android APKには、同じ接近便モデル内に `approachingBeforeIndex` と `remainingMinutes` が存在し、接近情報一覧、詳細、My時刻表の各UIが両getterを直接参照する。別の車両位置モデルには `coord`、`previousNodeId`、`nextNodeId` があり、停車順・地図表示に使われている。従って「何停前」を毎回Android端末が緯度経度だけから算出する構成より、サーバーで正規化済みの接近値をUIが表示し、詳細位置用データを別途併用する構成の方が証拠に合う。

ただし、`approachingBeforeIndex` の0/1起点、目標停留所を含むか、停留所間・停車中をどう丸めるかは、実レスポンスを取得していないため未確認である。川崎市バスと東急バスが同じAndroidモデルへ入ることは強く示唆されるが、両事業者の実通信を同時観測して同一schemaであることまでは確認していない。

`chibus.busapp.navitime.jp` とAPK内endpoint候補はアプリ内部用であり、公開利用条件を確認できない。PALURUの本番データソースとしては **NO-GO**。アーキテクチャの参考としてのみ利用する。

## 2. 調査境界

実施したこと:

- NAVITIME公式の製品情報、法人API仕様、GTFS / GTFS-RT対応説明を確認
- APK内のmanifest、DEX文字列、モデル、xrefを静的解析
- 公開DNS、TLS証明書、host rootへのHEADを確認
- APKは展開・読取だけを行い、実行・改変・再配布していない

実施していないこと:

- アプリ内部endpointへのリクエスト
- 認証情報やトークンの抽出
- TLS pinning回避、証明書差替え、APK改変
- 非公開APIを使った川崎市バス・東急バスの実データ取得
- PALURU runtime / productionへの組込み

端末にADB接続されたAndroid実機がなかったため、Google Playから端末へ配信されたAPKを直接pullできなかった。静的解析には第三者配布サイトのサンプルを使用し、署名fingerprintを別配布サイトの表示と照合した。この制約により、解析結果は「サンプル7.20.3の構造」であり、現在Google Playで配信中の全split構成と同一であることは未確認である。

## 3. 公開情報

### 3.1 Android製品

[Google Playの公式掲載](https://play.google.com/store/apps/details?hl=ja&id=com.navitime.local.bus)で確認できるpackageは `com.navitime.local.bus`。接近情報対応路線ではバス接近情報を表示し、My時刻表では直近3便と接近情報、到着予測を扱うと説明されている。

NAVITIMEの[2021年の機能拡充発表](https://corporate.navitime.co.jp/topics/pr/202112/13_5420.html)は「バス停までの到着時間や走行位置」をリアルタイム表示し、一覧で「いくつ前のバス停間を走行中」で「あとどれくらいで到着するか」を示す機能と説明している。この表示単位はPALURUが目指す「停留所間 + あと何停 + ETA」に近い。

### 3.2 事業者データ連携

NAVITIMEは[2024年のバスロケ拡充発表](https://corporate.navitime.co.jp/topics/pr/202402/27_5707.html)で、GTFS / GTFS-RT等のオープンデータ形式と、バス会社から直接受領する個別形式の両方を扱える仕組みを構築したと説明している。同じ発表では、東急バスは2021年3月、川崎市バスは2023年9月からリアルタイム情報に対応したとされる。

[2022年のGTFS関連発表](https://corporate.navitime.co.jp/topics/pr/202209/26_5511.html)では、GTFS-JPを静的情報、GTFS-Realtimeを遅延・位置等の動的情報として扱い、事業者独自形式とは別の共通形式として利用する構成が説明されている。[2016年のバスロケーションシステム発表](https://corporate.navitime.co.jp/topics/pr/201604/28_3664.html)では、NAVITIME側でGPS位置、接近情報、混雑度、到着時間を計算・提供する製品も存在する。

このためNAVITIME全体では、次の複数入力が併存すると考えるのが妥当である。

```text
GTFS / GTFS-Realtime
事業者から直接受領する個別形式
NAVITIME提供の動態管理・GPS
        ↓
NAVITIME側の事業者別変換・計算
        ↓
バスNAVITIME共通接近情報モデル
```

川崎市バスと東急バスのどちらが上記のどの入力経路を使うかは、公開発表だけでは確定できない。川崎市バスについてPALURUが利用しているODPTデータが存在する事実だけから、NAVITIMEも同じfeedを入力にしているとは断定しない。

### 3.3 法人API

[NAVITIME API 2.0公式仕様](https://api-sdk.navitime.co.jp/api/specs/index.html)には、駅・バス停、路線、時刻表、停車駅一覧、ルート等の法人APIが列挙されている。2026-09-12時点の公開index内を `接近`、`リアルタイム`、`バスロケ`、`GTFS` で確認した範囲では、バスの `stopsAway` や接近便を返す公開API仕様は見つからなかった。API利用自体もNAVITIMEとの契約またはAPIマーケット契約が必要と明記されている。

従って「法人APIがある」ことは、APK内部の接近情報endpointを第三者が利用できる根拠にならない。公開利用可能なバス接近APIが必要なら、NAVITIMEへ契約対象機能として問い合わせる必要がある。

## 4. Android APK静的解析

### 4.1 サンプルとmanifest

解析サンプル:

|項目|観測値|
|---|---|
|取得元|[APKCombo](https://apkcombo.com/navitime-bus-transit-japan/com.navitime.local.bus/)の第三者配布サンプル|
|package|`com.navitime.local.bus`|
|versionName / versionCode|`7.20.3` / `351`|
|base APK SHA-256|`9823411ee2bad1220211edaecceac3774bab34f968efc83b2b0b5dd1bc2db8dc`|
|signing certificate SHA-1|`0b1557ec670626cb869500c0935a3848109d9d41`|
|min / target SDK|28 / 35|
|main activity|`com.navitime.local.bus.ui.StartActivity`|
|DEX数 / 文字列数|4 / 131,794|

certificate SHA-1は[APKPureの同package掲載](https://apkpure.net/navitime-bus-transit-japan/com.navitime.local.bus)にも同じ値が表示され、第三者配布物同士の整合は取れた。ただしGoogle Play配信物そのものとの照合ではない。

manifestには `INTERNET`、`ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION` 等がある。位置権限は利用者現在地・周辺検索・地図機能にも必要なので、これだけでは車両GPSから端末内で「何停前」を算出している証拠にならない。

主な関連component / class:

- `com.navitime.local.bus.ui.activity.MapActivity`
- `com.navitime.local.bus.ui.activity.WebViewActivity`
- `com.navitime.service.MyTimetableService`
- `com.navitime.appwidget.bus.realtime.database.RailroadProvider`
- `com.navitime.local.bus.ui.fragment.approaching.top.*`
- `com.navitime.local.bus.ui.fragment.approaching.detail.*`
- `com.navitime.local.bus.ui.fragment.busstoplist.*`
- `com.navitime.infra.RealtimeTimetableRepository`

### 4.2 base URLとendpoint候補

APK assetのproduction URL設定に次が存在した。

|設定key|静的値|用途の判定|
|---|---|---|
|`NTJ-Base-Url`|`https://chibus.busapp.navitime.jp/v1/`|接近情報を含むアプリ共通base URL|
|`NTJ-Storage-Url`|同上|同一baseのstorage系取得|
|`NTJ-Common-Storage-Url`|`https://static.cld.navitime.jp/`|共通静的配信候補|
|`NTJ-D-Bus-Base-Url`|`https://dbus.navitime.co.jp/`|別系統のD-Bus base URL。役割詳細は未確認|

難読化class `U4/a` はassetの `NTJ-Base-Url` を返す。`U4/a.m(Context)` はそのURLをparseしてhostが `chibus.busapp.navitime.jp` と一致するか確認し、`BusApplication` から呼ばれる。`NTJ-Base-Url` は接近情報ViewModel、RealtimeTimetableRepository、停車順ViewModel、各loader等から参照されるため、`chibus` は単なるWebView許可hostではなく、production app backendのbase URLとして使われる構成である。

DEXには次のpath文字列が存在した。

- `buslocation/approaching`
- `buslocation/around-approaching`
- `buslocation/node-approaching`
- `stops/buslocation`
- `timetable/realtime`
- `buslocation`

これらは**endpoint候補**である。静的文字列だけではHTTP method、query、header、認証、最終URL、response wire formatを確定できないため、本書では完全なAPI仕様として扱わない。実リクエストも行っていない。

### 4.3 接近情報モデル

APKのJava/Kotlin entityから、次の共通モデルを確認した。

|class|主なfield|意味の判定|
|---|---|---|
|`ApproachingBusData`|`approachingBeforeIndex`, `remainingMinutes`, `busVehicleId`, `buslocationCourseId`, `destinationName`, `link`|停留所向け接近便の共通DTO|
|`BusApproachingData` / `BusApproachingSingleData`|`approachingBeforeIndex`, `remainingMinutes`, vehicle / course / destination / congestion / status|旧または別画面系の接近便DTO|
|`timetable.BusLocationDataRecord`|`approachingBeforeIndex`, `remainingMinutes`, vehicle / course / congestion|時刻表へ付与される接近情報|
|`BusLocationDataInfo`|`coord`, `previousNodeId`, `nextNodeId`, `remainingMinutes`, vehicle / course / direction / target flags|停車順・地図向け車両位置DTO|
|`ApproachingNodeData`|`id`, `name`, `coord`|対象停留所DTO|
|`ApproachingAroundNodeData`|`id`, `name`, `distance`, `coord`|周辺停留所DTO|
|`BusRoadInfo`|route/link id・名称・短縮名・方向・companies・`hasBusLocation`|事業者をまたぐ路線メタデータ|
|`BusStopListNode`|停留所情報、`busesBetweenPreviousStop` 等|停車順上の車両表示候補|

`ApproachingStatus` enumには `APPROACHING`、`LOADING`、`MAINTENANCE`、`NINE_AHEAD`、`NONE`、`SEARCH_ERROR` がある。少なくとも9停以上を別状態として扱うUI設計が存在する。ただし `NINE_AHEAD` と数値indexの厳密な境界は実データ未観測である。

APK内にGoogle protobufのwell-known `.proto` は含まれるが、上記バス接近情報専用の `.proto` 定義は見つからなかった。モデルは通常のJava/Kotlin entityとして存在し、JSON object mappingと整合する形だが、実レスポンスを観測していないため「wire formatはJSON」とは確定しない。

### 4.4 UIからの参照

xrefで以下を確認した。

- `BusLocationTopAdapter.ViewHolder.update()` が `ApproachingBusData.getApproachingBeforeIndex()` と `getRemainingMinutes()` を参照
- `BusLocationDetailAdapter.ItemViewHolder.update()` が同じ2 fieldを参照
- `MyTimetableCardItem` が同じ2 fieldを参照
- `DirectTimetableDailyResultViewModel.findLatestTimetable()` が接近便のvehicle / course IDを時刻表へ結合
- `StopListFragment` と `BusStopListBusLocationItem` が `BusLocationDataInfo` のvehicle / course / coord等を参照
- `BusStopListItem` が `BusStopListNode.getBusesBetweenPreviousStop()` を参照

同じ `ApproachingBusData` が周辺接近一覧、接近詳細、My時刻表へ渡り、表示層で `approachingBeforeIndex` と `remainingMinutes` を直接読む。この構造は、サーバーが共通接近値を返し、Android側が画面ごとに再利用する方式を強く支持する。

一方、`BusLocationDataInfo` の `coord`、`previousNodeId`、`nextNodeId` は地図・停車順の車両表示で使える。端末がこれらを補助的に加工する可能性は残るが、接近一覧の「何停前」値を作るために緯度経度から全計算している証拠はない。

## 5. `chibus.busapp.navitime.jp` 公開観測

2026-09-12 21:28 JSTの観測:

|項目|結果|
|---|---|
|A record|`43.206.27.245`, `54.95.235.220`, `16.76.51.109`（TTL 32秒、観測時点）|
|TLS Subject / SAN|`*.busapp.navitime.jp`|
|Issuer|Amazon RSA 2048 M01|
|certificate validity|2026-06-18 00:00:00Z ～ 2027-01-01 23:59:59Z|
|root HEAD|HTTP 200、`Content-Type: text/html`、`Server: Apache`|

IP・TTL・証明書は変化し得る観測値であり、backend実装や利用許可を示さない。rootが200を返すことも、`/v1/`配下を公開APIとして第三者利用できる根拠にはならない。

## 6. 「何停前」方式の仮説評価

|仮説|評価|証拠|未確認点|
|---|---|---|---|
|A. serverが`stopsAway`相当を返す|**最有力**|共通接近DTOが`approachingBeforeIndex`と`remainingMinutes`を同時保持し、複数UIが直接参照|indexの厳密な意味、server内の算出元|
|B. serverがvehicle/stop列を返しappが計算|補助経路として有力|位置DTOに`previousNodeId` / `nextNodeId`、停車順DTOに`busesBetweenPreviousStop`|接近一覧のindexをこの情報から再計算する証拠なし|
|C. lat/lonからappが計算|地図用途ではあり得るが「何停前」の主方式として弱い|位置DTOに`coord`、map UIが参照|直接indexが既にある。端末位置権限は利用者位置にも使う|
|D. NAVITIMEが事業者別データを共通化|**強い**|公式にGTFS/GTFS-RTと事業者個別形式の両対応を説明。genericな共通DTOとcompanies/route modelが存在|川崎・東急それぞれの入力feedと変換規則|

最も証拠に合う処理は次である。

```text
事業者別 realtime / GTFS-RT / NAVITIME動態管理
        ↓
NAVITIME backendのprovider別adapter・予測
        ↓
approachingBeforeIndex + remainingMinutes
車両位置詳細では coord + previousNodeId + nextNodeId
        ↓
Android共通UI
```

ここで `approachingBeforeIndex` は名前上「何停前index」に相当するが、PALURUの `stopsAway` と同じ定義とはまだ証明できない。値をそのまま設計へコピーせず、表示文言と数え方を別途実測する必要がある。

## 7. 川崎市バス・東急バスの共通化

確認できた証拠:

1. NAVITIME公式発表は同じ「バスNAVITIME」リアルタイム基盤上で、東急バスと川崎市バスの対応開始時期を列挙している。
2. 同じ発表が、GTFS / GTFS-RTと事業者個別形式を共通して扱える仕組みを明記している。
3. Android側の接近UIは会社別classではなく、`BusRoadInfo.companies`を含むgenericな `ApproachingBusData` / `BusLocationDataInfo` を使う。
4. 周辺接近、停留所接近、時刻表、停車順で同じvehicle / course / route系識別子を再利用する。

この証拠から、**少なくともAndroid UI境界では川崎市バスと東急バスを同じ共通モデルへ落とす設計が最有力**である。ただし実際の川崎・東急responseを採取していないため、provider別の欠損field、index基準、ETA算出法、更新周期が同一とは言えない。

## 8. PALURUで再現する設計

NAVITIMEの内部APIを再利用せず、公開利用可能な事業者データから同じ責務分離を再現する。

```text
Provider Adapter
  - provider固有RT / Staticを読む
  - ID、時刻、車両、位置を内部modelへnormalize
        ↓
Arrival / Position Engine
  - ETA・delay
  - previousStop / nextStop
  - stopsAwayとその数え方
  - evidence / confidence / freshness
        ↓
Hub Aggregator
  - providerをまたいで候補を統合
  - effective arrival/departureで順位付け
        ↓
PWA
  - server計算結果を表示
  - 欠損を推測補完しない
```

内部Positionは、数値だけでなく根拠と意味を保持する。

```json
{
  "supported": true,
  "state": "between_stops",
  "previousStopId": "...",
  "nextStopId": "...",
  "stopsAway": 2,
  "stopsAwaySemantics": "intermediate_stops_before_target",
  "etaMinutes": 6,
  "method": "gps_observed_corridor",
  "confidence": 0.96,
  "observedAt": "ISO8601"
}
```

Providerが正規に `stopsAway` 相当を提供する場合は `method: provider_stops_ahead`、GPS corridorからPALURUが再構成する場合は `method: gps_observed_corridor` のように区別する。両者を同じ値として無条件に混ぜない。

川崎市バスでは、ODPT VehiclePositionのlat/lon/timestampとStatic停留所列、検証済みgeometry / observed corridorをPosition Engineへ渡す。`current_stop_sequence` / `stop_id` / `current_status` は補助整合性にだけ使い、位置判定の主根拠にしない。曖昧なら `supported: false` とする。

東急バスでは、公開GTFS / GTFS-RTまたは正式契約APIの存在と利用条件を確認してからProviderを作る。正規の車両位置または接近区間が得られなければ、Positionはunsupportedのままにする。

Hubの順位付けはETAまたは将来のeffective departureで行う。「2停前」と「3停前」は停留所間距離や道路状況が違うため、事業者横断の速さの順位には直接使わず、利用者向け説明として扱う。

## 9. 利用可否判定

|対象|判定|理由|
|---|---|---|
|NAVITIME公式の公開記事・UI設計|参考利用GO|公開情報としてアーキテクチャ比較に利用可能|
|NAVITIME API 2.0の契約対象機能|契約確認後GO候補|公開仕様・契約条件の範囲に限る|
|`chibus.busapp.navitime.jp/v1/`内部endpoint|本番利用NO-GO|APK内部base URLであり、第三者利用を許可する公開仕様・規約を確認できない|
|APK model / endpoint文字列|設計参考のみ|静的解析は利用許可やresponse保証にならない|
|川崎市バスの公開ODPTデータ|既存条件内でGO|PALURU側で利用条件を確認済みの正規データ。位置推定精度は別Acceptance|
|東急バスデータ|未確認|公開feed / APIと利用条件を別途確定する必要がある|

## 10. 未確認事項と次の調査

優先順位順:

1. 公式Google Play版を接続済みAndroid端末から正規に確認し、version / split / signing fingerprintをサンプルと比較する。
2. 通常のアプリ実行で観測可能な範囲に限り、川崎市バス・東急バスの同一画面についてhost、content type、更新間隔、response model fieldの有無を比較する。TLS pinning回避や認証回避は行わない。payloadは本番利用せず、必要最小限をマスクして検証証拠にだけ使う。
3. `approachingBeforeIndex` の0/1起点、対象停留所を0とするか、停車中・通過直後・9停以上の丸めを複数時点で照合する。
4. `remainingMinutes` と時刻表RTの予測時刻・delayの関係、欠損、負値、0分表示を確認する。
5. NAVITIME法人窓口へ、契約可能なバス接近・車両位置APIと対応事業者、再配信可否を問い合わせる。
6. PALURUではNAVITIMEと独立して、川崎市バスODPT GPSと公式市バスナビ表示の教師比較を継続する。東急は正規公開source確定後に同じProvider契約へ載せる。

## 11. 判定

- **通信先構成**: `chibus.busapp.navitime.jp/v1/` がproduction base URLであることをAPK assetとコード参照から確認。
- **API/model候補**: 接近・周辺接近・停留所接近・停車順・リアルタイム時刻表のpath文字列と、共通DTOを確認。実API仕様は未確認。
- **何停前方式**: A + Dが最有力。server-normalized `approachingBeforeIndex` + `remainingMinutes` をAndroid共通UIが表示する構成。
- **川崎/東急共通化**: UI model共通化は強く支持。provider別入力・欠損規則・算出式は未確認。
- **PALURU再現**: Provider Adapter → Position/Arrival Engine → Hub Aggregator → UI。正規データ、根拠、confidence、欠損抑止を維持する。
- **利用可否**: NAVITIME内部endpointのPALURU runtime利用はNO-GO。公開契約APIまたは各事業者の正規公開データだけを実装候補とする。

