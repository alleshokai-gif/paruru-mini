# PALURU Bus 昭和薬科大学 帰宅ルート Provider / Data Source Research

- 調査日: 2026-09-15（Asia/Tokyo）
- 対象: 昭和薬科大学から玉川学園前駅、成瀬駅、つくし野駅、町田駅方面へ帰る選択肢
- フェーズ: データソース調査のみ
- Production code / PWA / deploy / scheduler / database: 変更なし

## 1. 結論

| Provider / 経路 | 判定 | 根拠 | 現時点の本番利用 |
| --- | --- | --- | --- |
| 玉ちゃんバス（小田急バス） | `STATIC_ONLY` | ODPTで小田急バスの正規GTFS/GTFS-JPが公開され、東ルートと対象stopを実データで確認できた | **条件付き候補**。現在公開されている検証済みfeedのservice dateが2026-07-31で終わっているため、そのfeedを現在日時の本番時刻表には使えない |
| 小田急路線バスナビのRealtime | `RESEARCH_ONLY` | 公式画面では接近・走行位置情報を提供しているが、公開APIまたはGTFS-RTは確認できない | 使用しない。内部endpointを調査・利用しない |
| 神奈川中央交通 | `RESEARCH_ONLY` | ODPTに路線・停留所・時刻表・運賃のJSONがあるが「チャレンジ2026限定」。恒久公開GTFS/GTFS-RTは確認できない | **恒久本番はNO-GO**。チャレンジ応募目的以外へ限定データを使わない |
| 神奈中公式時刻表・バスロケWeb | `NO_GO` | 公式Webの利用条件が自動収集、API等による抽出・蓄積・解析を禁止している | PALURU runtime、事前生成、定期観測のいずれにも使わない |

調査としては成立した。最短のProvider候補は玉ちゃんバスの静的GTFSである。ただし、**有効な運行日を収録した最新版feedを取得できることを本番化の前提**とする。神奈中については、公式画面で経路の存在を確認できるが、現在確認できたデータ経路では恒久的なPALURU Providerを作れない。

## 2. 調査方法と境界

- 町田市、小田急バス、神奈川中央交通、昭和薬科大学、公共交通オープンデータセンターの公式公開情報を優先した。
- ODPTの小田急バスGTFSは、既存のローカルsecretを使って取得し、展開先は一時ディレクトリだけとした。token値、ダウンロードURLの認証query、レスポンス全文は保存していない。
- 神奈中の公式Web利用条件に自動収集・解析の禁止があるため、公開画面の先にあるXHR、JSON、内部APIは調査していない。
- 名前一致だけでstopやrouteを決めず、取得可能な正規GTFSの親子stop、stop sequence、route、tripを照合した。
- 本書の「見つからない」は、2026-09-15時点で確認した公式サイトとODPTカタログの範囲を指す。非公開契約データの不存在を意味しない。

## 3. 玉ちゃんバス（町田市・小田急バス）

### 3.1 公式公開リソース

町田市は[玉川学園コミュニティバス・東ルート](https://www.city.machida.tokyo.jp/kurashi/sumai/kotsu/shimin/komyubasu/tamachan/ttkmtcb002.html)で、運行概要、[運行案内PDF（時刻表・経路図）](https://www.city.machida.tokyo.jp/kurashi/sumai/kotsu/shimin/komyubasu/tamachan/ttkmtcb002.files/tamatyan_unkoannai.pdf)、小田急路線バスナビへの導線を公開している。運行状況の問い合わせ先と運行事業者は小田急バス新百合ヶ丘営業所である。運行案内PDFは公式確認資料として扱い、その掲載だけを二次利用許諾の根拠にはしない。

町田市の[市民バス・コミュニティバス オープンデータ](https://opendata.city.machida.tokyo.jp/sk/dataset/unyu_communitybus)には、[玉ちゃんバス東ルート停留所CSV](https://www.city.machida.tokyo.jp/shisei/opendata/unyu/communitybus.files/tamachaneast.csv)がある。カタログ上のライセンスはCreative Commons Attributionで、町田市は[オープンデータ利用案内](https://www.city.machida.tokyo.jp/shisei/opendata/index.html)で出典表示を条件に営利・非営利を問わず二次利用できるとしている。CSVの再配布・加工利用もCC BYの出典表示条件に従う。

CSVについて確認できたこと:

- 26行で、停留所名、所在地、座標欄、時刻欄を持つ。
- `1 玉川学園前駅南口` と `8 昭和薬科大学` を収録する。
- 時刻欄には `（2022.1.16改正）` とあり、現行時刻表の正本にはできない。
- カタログは情報を2025-03-17時点としており、地図作成上の誤差と現況との差を明記している。
- `経度` / `緯度` 欄の値はWGS84度数ではなく、座標系の説明も確認できない。GPS結合へは使用しない。

### 3.2 ODPT GTFS / GTFS-JP

公共交通オープンデータセンターの[小田急バスdataset](https://ckan.odpt.org/en/dataset/odakyu_bus_aii_lines)はGTFS/GTFS-JPを提供している。ライセンスは[公共交通オープンデータ基本ライセンス](https://developer.odpt.org/terms/data_basic_license.html)で、基本ライセンス上は条件に従った営利・非営利利用が可能である。一方、第三者が再利用でき、元データの全部または大部分を復元できる形での公開・再配布・公衆送信は原則禁止される。PALURUは必要な便表示だけをDeliverableとして返し、GTFSや復元可能な抽出dataを配布しない。datasetページは基本ライセンスに加えて特定利用条件の確認も要求しているため、本番化時に当時点の条件を再確認する。

2026-07-16版resourceを実際に展開して確認した。収録ファイルは次のとおり。

```text
agency.txt
calendar_dates.txt
fare_attributes.txt
fare_rules.txt
feed_info.txt
routes.txt
stop_times.txt
stops.txt
translations.txt
trips.txt
```

`calendar.txt`、`shapes.txt` はない。`calendar_dates.txt`だけで運行日を表し、対象feedで確認できたservice dateは2026-07-16から2026-07-31までだった。`feed_info.txt`のversionも `20260716_20260731` である。調査日2026-09-15の便をこのfeedから生成してはならない。

### 3.3 正式stop

| 用途 | `stop_id` | `stop_name` | 親stop | 緯度 | 経度 | 備考 |
| --- | --- | --- | --- | ---: | ---: | --- |
| 玉川学園前駅南口 親 | `63021` | 玉川学園前駅南口 | - | 35.563383 | 139.463719 | `location_type=1` |
| 東ルート乗車側 | `63021_1` | 玉川学園前駅南口 | `63021` | 35.563564 | 139.463816 | 循環便の始点 |
| 東ルート到着側 | `63021_90` | 玉川学園前駅南口 | `63021` | 35.563201 | 139.463621 | 昭和薬科大学からの目的stop |
| 昭和薬科大学 親 | `63032` | 昭和薬科大学 | - | 35.553992 | 139.471901 | `location_type=1` |
| 昭和薬科大学 標柱 | `63032_1` | 昭和薬科大学 | `63032` | 35.553992 | 139.471901 | 対象の乗車stop |

町田市CSVの所在地も、玉川学園前駅南口を町田市玉川学園2丁目、昭和薬科大学を町田市東玉川学園2丁目としており、名称だけでなく所在地でも対応を確認した。

### 3.4 正式route / trip pattern

| `route_id` | `route_short_name` | `route_long_name` | 対象区間 | 実データ上のstop sequence |
| --- | --- | --- | --- | --- |
| `60714_1` | 東ルート | 玉ちゃんバス　東ルート | 循環便の昭和薬科大学以降を利用 | `63032_1` = 8、`63021_90` = 21 |
| `60713_1` | 東ルート | 玉ちゃんバス　東ルートこすもす会館経由 | こすもす会館経由循環便の昭和薬科大学以降を利用 | `63032_1` = 14、`63021_90` = 27 |
| `60722_1` | 東ルート | 玉ちゃんバス　東ルート・昭和薬科大学発 | 昭和薬科大学始発から駅南口 | `63032_1` = 1、`63021_90` = 14 |
| `60723_1` | 東ルート | 玉ちゃんバス東ルート・東玉川学園二丁目止 | 駅から東玉川学園二丁目止まり | Showa→駅の候補から除外 |

全対象patternの`direction_id`は1だった。単独で方向を決めず、from/to stop sequenceが昇順であることも条件にする。

### 3.5 曜日・特別日

町田市の現行ページは年中無休とし、次の区分を公開している。

- 平日
- 土曜・日曜・祝日・お盆・年末年始
- 運行本数の説明では8月12日から14日、12月30日から1月3日を休日側としている

一方、町田市CSVの古い注記は8月13日から16日を祝日扱いとしており、現行ページと一致しない。CSV内の古い時刻・特別日規則を本番で使わない。ProviderではGTFSの`calendar_dates.txt`を運行日の正本とし、requested service dateがfeedに存在しない場合は時刻表を返さない。

### 3.6 Realtime

小田急バスは[公式FAQ](https://www.odakyubus.co.jp/faq/faq11.html)で運行状況を小田急路線バスナビに掲載すると案内し、2025年の[公式告知](https://www.odakyubus.co.jp/news/detail/250623_181553.html)でもバス接近情報の提供継続を示している。したがって利用者向けのRealtime表示は存在する。

ただし、ODPTの小田急バス組織で現在確認できる機械可読datasetはGTFS/GTFS-JPであり、小田急バスのGTFS-RT、TripUpdates、VehiclePosition、公開Realtime APIは確認できなかった。路線バスナビは公開利用可能なAPIとして案内されていないため、PALURUのデータソースにしない。

| 項目 | 利用可否 |
| --- | --- |
| static timetable / stops / routes / trips | 有効なservice dateを含むODPT GTFSが取得できる場合に利用候補 |
| stop WGS84 lat/lon | ODPT GTFSから利用候補 |
| delay / arrival prediction | `null` |
| VehiclePosition / stopsAway | `null` |
| 公式バスナビ内部通信 | 調査・runtime利用を行わない |

## 4. 神奈川中央交通

### 4.1 ODPT掲載状況

ODPTの[神奈川中央交通 organization](https://ckan.odpt.org/organization/kanachu)には、次の4 datasetが存在する。

- バス路線情報 JSON
- バス停情報 JSON
- バス時刻表 JSON
- バス運賃情報 JSON

いずれも[公共交通オープンデータチャレンジ2026限定ライセンス](https://developer.odpt.org/challenge_license)である。恒久公開GTFS/GTFS-JPではなく、通常ライセンスのdatasetでもない。organizationにはバスロケーション、GTFS-RT、TripUpdates、VehiclePosition datasetがない。

限定ライセンスは、Challengeへ応募する目的での利用、Challenge期間中に誰でも無償利用できる機能の公開などを条件とし、許諾は2027-03-12に終了する。応募以外の目的と判断された場合は利用停止等の対象となり得る。したがって、家族向けPALURUの恒久的なproduction Providerには採用しない。

今回使用した通常のODPT credentialではKanachu operator/objectを取得できず、限定datasetの実payload、ODPT上の正式stop ID・route IDは未検証である。Challengeへの参加・追加権限を推測して進めない。

### 4.2 公式時刻表と対象系統

[神奈中公式の昭和薬科大学停留所ページ](https://transfer-cloud.navitime.biz/kanachu/courses?busstop=00023592)で確認できた系統は次のとおり。`00023592`は公式Webの公開query IDであり、公開再利用用のcanonical stop IDとは扱わない。

| のりば | 系統 | 行先 | 帰宅候補としての扱い |
| --- | --- | --- | --- |
| 1 | つ03 | 東玉川学園四丁目 | 成瀬・つくし野方面と逆。候補外 |
| 1 | 成02 | 東玉川学園四丁目 | 成瀬方面と逆。候補外 |
| 2 | つ03 | つくし野駅（成瀬駅経由） | **つくし野駅候補**。成瀬駅も通る |
| 2 | 成02 | 成瀬駅 | **成瀬駅候補** |
| 2 | 成05 | 成瀬台 | 駅行ではないため、今回の駅帰宅候補から除外 |

神奈中の[大和営業所路線図・運賃表](https://www.kanachu.co.jp/routebus/files/yamato.pdf)でも、つ03は東玉川学園四丁目―昭和薬科大学―成瀬駅―つくし野駅、成02は東玉川学園四丁目―昭和薬科大学―成瀬駅、成05は成瀬駅―昭和薬科大学―成瀬台の系統として記載されている。

### 4.3 周辺stopの区別

| stop | 公式Web query ID | 帰宅方向の確認結果 | キャンパスとの関係 |
| --- | --- | --- | --- |
| 昭和薬科大学 | `00023592` | 2番からつ03＝つくし野、成02＝成瀬、成05＝成瀬台 | 大学前。直接乗車候補 |
| 東玉川学園四丁目 | `00023604` | 1番からつ03＝つくし野、成02＝成瀬 | 両系統の起点。大学からの徒歩距離・推奨導線は公式根拠未確認 |
| 観性寺前 | `00023374` | 1番からつ01/つ03、成01/02/03/04＝成瀬・つくし野、町74＝町田バスセンター | 大学公式が成瀬アクセスで下車後徒歩約10分と案内。帰宅時は逆向きstopを利用する候補 |
| 三ツ又 | `00023411` | 2番から町76＝町田バスセンター | 大学公式が町田アクセスで下車後徒歩約10分と案内。帰宅時は逆向きstopを利用する候補 |

昭和薬科大学の[公式交通アクセス](https://www.shoyaku.ac.jp/about/access/)は、玉川学園前駅まで徒歩約15分、成瀬駅から観性寺前経由でバス5分＋徒歩約10分、町田駅から三ツ又経由でバス約20分＋徒歩約10分と案内している。大学から駅への逆方向で使う場合も、発車stopと当日ダイヤは各公式時刻表で確認する必要がある。

### 4.4 曜日区分

神奈中公式時刻表は、平日・土曜・休日のtabを表示する。祝日は休日ダイヤとして案内されるが、臨時ダイヤ、年末年始、お盆等は個別告知の影響を受ける。

この表示は人が確認する公式案内としては使えるが、PALURUが自動処理できるライセンス付きstatic feedではない。Web画面からダイヤを抽出してProvider化しない。

### 4.5 公式バスロケと利用条件

公式時刻表画面には`リアルタイム運行情報`への導線があり、利用者向けの神奈中バスロケが存在する。公開画面はHTML/JavaScriptで提供されている。

しかし[神奈中時刻表サイトの利用条件](https://transfer-cloud.navitime.biz/kanachu/terms-of-use)は、次を明示的に禁止している。

- コンテンツの複製、頒布、公衆送信、改変、二次的著作物作成
- リバースエンジニアリングその他の解析
- spider、crawler、robot、scraping、API等による自動収集、抽出、複製、蓄積、解析

このため、Network/XHR、JSON、内部endpoint、バスロケの内部modelは調査していない。技術方式は`UNKNOWN`のまま残す。公式Webが表示する情報を、公開APIとみなしてはならない。

| 項目 | 確認結果 |
| --- | --- |
| 公式GTFS / GTFS-JP | 恒久公開datasetは確認できず |
| ODPT static | Challenge 2026限定のroute / stop / timetable / fare JSONのみ |
| GTFS-RT / public realtime API | 確認できず |
| 公式バスロケ | 利用者向けWebは存在 |
| 内部通信方式 | 利用条件に従い未調査 |
| PALURU production利用 | 現行経路ではNO-GO |

### 4.6 利用経路ごとの判定

| データ経路 | 技術的な取得 | 公開利用 | 商用利用 | PALURU production |
| --- | --- | --- | --- | --- |
| ODPT Challenge 2026 static JSON | Challenge参加・権限があればAPI取得可能 | Challenge応募と公開条件の範囲だけ。復元可能なraw/derivative dataの再配布は原則禁止 | 会社運営serviceも条件付きで可だが、Challenge応募・期間中の無償公開が必須 | **不可**。恒久家族serviceのdata sourceにしない |
| 神奈中公式時刻表Web | 人がブラウザで閲覧可能 | Webの通常閲覧のみ | コンテンツによる直接の商業的利益を利用条件が禁止 | **不可**。自動取得・保存・解析をしない |
| 神奈中公式バスロケ | 人がブラウザで閲覧可能 | 利用者向け画面として公開 | 公開API利用条件は確認できず | **不可**。内部通信を使わない |
| 恒久公開GTFS / GTFS-RT | 今回の公式調査では未発見 | - | - | data sourceが見つかるまで不可 |

## 5. Journey候補

| Journey候補 | boarding stop | destination | operator / route | static timetable | realtime / delay / position | license / production usability | Provider候補 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 徒歩 | 昭和薬科大学 西門側 | 玉川学園前駅 | 徒歩約15分 | 大学公式の所要時間あり | 天候・現在地連動なし | 大学公式案内を説明情報として参照可能。経路geometryを使う場合は別途正規sourceが必要 | Journeyの固定徒歩候補。Bus Providerではない |
| 玉ちゃんバス | `63032_1` 昭和薬科大学 | `63021_90` 玉川学園前駅南口 | 小田急バス 東ルート `60713_1` / `60714_1` / `60722_1` | ODPT GTFSあり。ただし検証feedは2026-07-31で運行日終了 | 公開APIなし。すべて`null` | ODPT基本ライセンス＋特定利用条件。現在有効なfeedが取得できる場合のみproduction候補 | `providers/odakyu` static-only候補 |
| 神奈中・大学前→成瀬 | 昭和薬科大学 2番 | 成瀬駅 | 成02、つ03 | 公式Web表示あり。Challenge限定JSONあり | 公式WebのRealtime導線あり。公開APIなし | Web自動取得は禁止。Challenge限定dataは恒久PALURUに使わない | 現時点では作らない |
| 神奈中・大学前→つくし野 | 昭和薬科大学 2番 | つくし野駅 | つ03 | 同上 | 同上 | 同上 | 現時点では作らない |
| 神奈中・観性寺前→成瀬 | 観性寺前 1番 | 成瀬駅 | つ01/つ03、成01/02/03/04 | 公式Web表示あり。Challenge限定JSONあり | 公式WebのRealtime導線あり。公開APIなし | Web自動取得は禁止。大学から徒歩約10分という公式案内あり | 現時点では作らない |
| 神奈中・観性寺前→町田 | 観性寺前 1番 | 町田バスセンター | 町74 | 同上 | 同上 | 同上 | 現時点では作らない |
| 神奈中・三ツ又→町田 | 三ツ又 2番 | 町田バスセンター | 町76 | 同上 | 同上 | Web自動取得は禁止。大学から徒歩約10分という公式案内あり | 現時点では作らない |
| 神奈中・大学前→成瀬台 | 昭和薬科大学 2番 | 成瀬台 | 成05 | 公式Web表示あり | 公開APIなし | 駅へ抜ける便ではないため今回のdecision groupから除外 | 対象外 |

## 6. PALURUの共通modelへ載せられる範囲

玉ちゃんバスstatic-onlyは次まで正規化できる。

```json
{
  "provider": "odakyu",
  "routeId": "60714_1",
  "routeLabel": "東ルート",
  "originStop": "昭和薬科大学",
  "targetStop": "玉川学園前駅南口",
  "scheduledDeparture": "HH:mm",
  "estimatedDeparture": null,
  "etaMinutes": null,
  "delayMinutes": null,
  "platform": null,
  "realtimeState": "static_only",
  "position": {
    "supported": false
  }
}
```

`scheduledDeparture - now`を補助的な残り時間として表示する場合も、Realtime ETAとは明確に区別する。service dateがfeedに存在しない場合は便を生成せず、古い時刻を表示しない。

神奈中は同じNormalized Modelへ理論上は変換できるが、入力dataの恒久利用権限がないため実装しない。公式Web query IDをProviderの正式IDとして保存しない。

## 7. 未解決事項

1. 小田急バスODPT GTFSに、調査日を含む新しいservice dateのresourceが公開されるか。
2. 小田急バスdatasetの最新Specific Terms of Useと、PALURUで必要なattribution表記。
3. 玉ちゃんバス東ルートに公開GTFS-RTまたは正式なRealtime APIが将来提供されるか。
4. 神奈中がChallenge限定ではないGTFS/GTFS-JP、GTFS-RT、または契約可能な公式APIを提供するか。
5. 神奈中の正式ODPT stop / route ID。Challenge参加権限なしに推測しない。
6. 東玉川学園四丁目までのキャンパスからの徒歩時間と安全な徒歩導線。
7. 徒歩候補を時刻・雨量と比較する場合の正規な徒歩geometry、天候source、徒歩所要時間補正。

## 8. 最小実装案（1案）

**玉ちゃんバス東ルートだけを扱う`odakyu` Static Providerを、service-date fail-closedで実装する。**

実装前に現在有効なODPT GTFS resourceを取得できることを確認する。取得できた場合だけ、build scriptで`63032_1 → 63021_90`を通る`60713_1`、`60714_1`、`60722_1`の当日便を小型JSONへ抽出する。runtimeはそのJSONから次3便を`static_only`で返し、Realtime項目はすべて`null`にする。取得feedにrequested service dateがなければProvider unavailableを返す。

この案なら、正規の機械可読static dataだけを使い、神奈中の利用条件に触れず、既存Hub AggregatorへProviderを1つ追加する境界を検証できる。現在有効なfeedが確認できるまではコード実装へ進まない。
