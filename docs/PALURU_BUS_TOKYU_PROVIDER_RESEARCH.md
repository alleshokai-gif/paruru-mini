# PALURU Bus Tokyu Provider Research

検証日: 2026-09-13（Asia/Tokyo）

## 結論

東急バス本体の正規データは公共交通オープンデータセンター（ODPT）で取得できる。ただし、確認できた本体データはGTFS/GTFS-JPやGTFS-Realtimeではなく、ODPT JSONの静的4種である。

- `odpt:BusstopPole`
- `odpt:BusroutePattern`
- `odpt:BusTimetable`
- `odpt:BusstopPoleTimetable`

このため、神木本町Hubの**向01両方向を扱う静的時刻表ProviderをP2.1でローカル実装**した。`a`は梶が谷駅、`b`は向ヶ丘遊園駅南口である。VehiclePosition、TripUpdates、動的到着予測、delayは、この正規経路では確認できず本番候補にできない。内部endpoint、NAVITIME内部endpoint、HTMLスクレイピングは利用しない。

公式根拠は[ODPTの東急バス組織ページ](https://ckan.odpt.org/organization/tokyu_bus)、[バス停情報](https://ckan.odpt.org/dataset/tokyu_bus__b-busstop)、[バス路線情報](https://ckan.odpt.org/dataset/tokyu_bus__b-busroute)、[バス時刻表](https://ckan.odpt.org/dataset/tokyu_bus__b-bus_timetable)、[バス停時刻表](https://ckan.odpt.org/dataset/tokyu_bus__b-busstop_timetable)である。組織ページの8件は、本体の静的JSON 4件、画像1件、別主体のコミュニティバスGTFS-JP 3件であり、東急バス本体のGTFS-Realtimeは含まれていない。

## 実データ確認方法

登録済みのODPT正規APIキーをローカルのignore済み`.dev.vars`から読み、`odpt:operator=odpt.Operator:TokyuBus`で必要項目だけを要約した。トークン、URLクエリ、APIレスポンス全文は保存していない。

観測結果:

|型|取得件数|Hubで使える項目|
|---|---:|---|
|`odpt:BusstopPole`|3,045|正式stop ID、標柱番号、緯度経度、所属route pattern|
|`odpt:BusroutePattern`|747|route ID、route pattern ID、停留所列、順序、系統表示|
|`odpt:Bus`|0|東急operatorの動的車両は取得できず|
|対象stop timetable|両方向で平日・土曜・Sunday各1|発時刻、方向、route pattern|

対象レコードの`dc:date`はroute/stopが2026-09-01、stop timetableが2026-09-01で、検証時点のAPI応答から得た値である。公開前は毎回最新取得日と適用内容を再確認する。

## 神木本町の正式構造

名称一致だけで決めず、route patternの全停留所列と方向、標柱番号を結合した。

### 梶が谷方面

|項目|正式値|
|---|---|
|operator|`odpt.Operator:TokyuBus`|
|route ID|`odpt.Busroute:TokyuBus.Kou01`|
|系統|`向０１`|
|route pattern ID|`odpt.BusroutePattern:TokyuBus.Kou01.0004600073`|
|乗車stop ID|`odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.a`|
|標柱番号|`a`|
|stop列index|10 / 18|
|方向|`odpt.BusDirection:TokyuBus.Kajigayaeki`|
|終点|梶が谷駅|
|stop座標|35.600742, 139.583089|

### 反対方向

|項目|正式値|
|---|---|
|route ID|`odpt.Busroute:TokyuBus.Kou01`|
|系統|`向０１`|
|route pattern ID|`odpt.BusroutePattern:TokyuBus.Kou01.0004600232`|
|乗車stop ID|`odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.b`|
|標柱番号|`b`|
|stop列index|8 / 16|
|方向|`odpt.BusDirection:TokyuBus.MukougaokayuuenEkiminamiguchi`|
|終点|向ヶ丘遊園駅南口|

`a`/`b`は正規APIの`odpt:busstopPoleNumber`であり、利用者向けの「1番のりば」等へ推測変換しない。両標柱の公開座標は同じで、道路のどちら側かを座標だけで断定しない。

## 溝の口方面候補の判定

全747 route patternから神木本町標柱を含むものを抽出すると、上記向01の2方向だけだった。**東急バスの神木本町発・溝の口方面は確認できなかった。**

さらに、終点が溝の口駅または溝の口駅南口のpatternについて、全stop座標から神木本町座標に最も近いstopを調べた。最短は溝22の溝の口駅南口そのもので直線約2.44kmだった。これは道路徒歩距離ではなく、近隣Hub候補とみなせないことを確認するための座標比較である。

したがってP2の`東急 → 溝の口方面`はHub configへ設定しない。梶が谷行きを溝の口行きと表示したり、向ヶ丘遊園行きを登戸行きへ読み替えたりしない。

## 曜日・祝日ダイヤの最終検証

ODPT一般仕様は`odpt.Calendar:Holiday`を「日曜、祝日、休日、振替休日」、`odpt.Calendar:Sunday`を「日曜のみ」と区別する。一方、東急の対象`BusstopPoleTimetable`は`Weekday`、`Saturday`、`Sunday`の3種類だけを返し、`Holiday`レコードを返さない。一般仕様だけからHolidayをSundayへ読み替えることはできないため、東急固有の公開情報と実データを追加照合した。

- 東急公式の向01時刻表は、a/b両方向とも列名が`平日 / 土曜 / 休日`である。
- 東急公式のお知らせは、国民の祝日は全路線で「休日ダイヤ」とし、時刻表の「休日」欄を確認するよう明記している。
- 正規ODPTの`Weekday / Saturday / Sunday`を、東急公式ページの`平日 / 土曜 / 休日`へ全便照合した。aは39 / 39 / 38便、bも39 / 39 / 38便で、時刻は各列すべて一致した。
- したがって、**東急Providerに限り**、検証済みの国民の祝日をODPT `Sunday` timetableへ割り当てる。これはODPT一般仕様の変更ではなく、上記の東急固有証拠に基づくmappingである。

日付判定には内閣府公表の国民の祝日・休日一覧を使い、2026-01-01から2027-12-31だけをコード内の検証済み範囲とする。範囲外はweekdayへ補完せず`null`となり、その日の東急Static便を表示しない。確認した4パターンは次のとおり。

|種別|検証日|選択calendar|結果|
|---|---|---|---|
|平日|2026-09-14|`odpt.Calendar:Weekday`|PASS|
|土曜|2026-09-19|`odpt.Calendar:Saturday`|PASS|
|日曜|2026-09-20|`odpt.Calendar:Sunday`|PASS|
|祝日|2026-09-21 敬老の日|`odpt.Calendar:Sunday`（東急公式の休日列）|PASS|

年末年始、お盆、臨時ダイヤなどは国民の祝日一覧だけでは解決できない。東急が通常曜日と異なる特別ダイヤを告知する例も確認したため、特別運行日を自動推測しない。公開前と特別期間前に公式告知を確認し、必要なら明示的なservice-date overrideまたは当日非表示を別変更として入れる。

## データ充足状況

|項目|結果|根拠・扱い|
|---|---|---|
|公開GTFS / GTFS-JP（本体）|未確認|ODPTのGTFS 3件は目黒・品川・大田のコミュニティバス。東急本体JSONとは別|
|ODPT静的JSON|取得可|stop、pattern、bus timetable、stop timetable|
|停留所列|取得可|`odpt:busstopPoleOrder`と`odpt:index`|
|stop lat/lon|取得可|`geo:lat` / `geo:long`|
|route geometry|対象patternではなし|`ug:region`に利用可能なLineStringなし。stop列の直線補間は禁止|
|GTFS-Realtime|カタログ掲載なし|東急本体のProtocol Buffers datasetを確認できず|
|VehiclePosition|取得不可|正規ODPT `odpt:Bus`を東急operatorで照会して0件|
|TripUpdates|取得不可|正規datasetなし|
|到着予測・delay|取得不可|静的発時刻だけを使い、nullで保持|
|公式バスロケ画面|あり|[東急公式バスナビ調査](PALURU_BUS_TOKYU_BUS_LOCATION_RESEARCH.md)でserver-rendered位置・待ち分を確認。画面内部通信は本番入力にしない|

## 利用条件

4つのJSON datasetには[公共交通オープンデータ基本ライセンス](https://developer.odpt.org/terms/data_basic_license.html)が表示される。確認した範囲で、画像データ以外の東急JSONに固有の追加条件は表示されていないが、本番実装前に各datasetの最新表示を再確認する。

基本ライセンス上、アプリ等の成果物作成と営利・非営利利用は可能。一方、元データの全部または大部分を復元できる再利用可能形式での再配布は原則禁止される。PALURUはHubに必要な数便だけをNormalizeし、APIキーや元の全データを公開しない。

[ODPT利用規約](https://developer.odpt.org/terms/center_use_rules.html)に従い、登録アカウントのtokenをサーバー側で管理する。[開発者ガイドライン](https://developer.odpt.org/terms/data_basic_use_guideline.html)に従い、静的データ取得日時を確認可能にし、更新通知後原則1週間以内に更新し、ODPT由来・無保証・問い合わせ先を表示する必要がある。

[東急バスWeb利用条件](https://www.tokyubus.co.jp/terms.html)は、サイトコンテンツの許諾なき複製・改変・再配布等を制限している。東急バスナビの内部endpointや画面データを、ODPTデータの代わりに使用する根拠にはならない。

## P2.1 Provider実装

`providers/tokyu/`は次の責務を持つ。

1. ODPT JSONのstop / route pattern / timetableを取得して期限付きcacheする。
2. `BusstopPoleTimetable`の方向配列を単一方向と決めつけず、対象patternで絞り込む。
3. `a`標柱・梶が谷方向と`b`標柱・向ヶ丘遊園駅南口方向を、向01の正規IDで個別検証する。
4. 静的時刻をNormalized Arrivalへ変換し、RT項目をnull、`realtimeState=static_only`、`position.supported=false`にする。
5. attributionと取得日時をProvider contextから渡す。
6. 1件の壊れたrecordやsource障害を、他ProviderやHub全体へthrow伝播させない。

Staticは6時間のinstance memory cacheとsingle-flightを使い、1回のloadで両方向それぞれのstop、route pattern、stop timetable、計6つの正規ODPT exact queryだけを取得する。巨大な全件配列はruntimeで取得しない。レスポンス件数、正式ID、stop index、終点、calendar、全departure entryを検証し、矛盾時は東急Providerだけをfail closedにする。取得epochとsource更新epochはHub Provider statusへ渡し、Public UIで静的時刻表の取得日時と出典を確認できる。

`Weekday/Saturday/Sunday`と東急公式`平日/土曜/休日`の全便一致を実データで確認した。祝日mappingは上記の有界日付だけを対象とし、未収載年はfail closedにする。

## 判定

- 東急Static Provider P2.1: **本番候補GO**。正規ODPT JSON、正式stop/pattern、曜日・祝日mappingを実取得・公式表と照合し、Hub APIでa/b各3便を確認した。本番Cloud Run/PWA受入は未実施。
- 東急Realtime Provider: **NO-GO**。正規VehiclePosition / TripUpdates / 到着予測を確認できない。
- 東急の神木本町→梶が谷駅・向ヶ丘遊園駅南口Hub候補: **GO候補**。
- 東急の神木本町→溝の口Hub候補: **NO-GO**。正規routeが確認できない。
