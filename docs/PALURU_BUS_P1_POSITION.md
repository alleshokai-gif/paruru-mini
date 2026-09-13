# PALURU Bus P1 Position

## 実装前の契約（2026-09-11 / Asia/Tokyo）

ユーザー指定のPositionレイヤを追加する。P0の4方向・ETA・3便・30秒polling・25秒cache・公開DTOを維持し、Position UIはOFF。本番deploy/commit/push、Hub、他社Provider実装、地図、生GPS公開は今回行わない。

- 問題：P1 Architectureは内部GPSを保持するが位置推定器を持たない。朝の実観測では対象10便のshapeが欠損し、raw sequence/statusと参照表示の不一致もある。
- 方針：同じStatic版の完全stop列と公式shapeを事前抽出し、GPSのshape投影と連続点から判定。shapeなし/曖昧/古いGPSはunknown。Naviは答え合わせ専用でEngine入力・runtime依存にしない。
- 影響：`bus/position/`、位置Static生成器、Node起動時読込とServiceの任意内部観測境界、関連test/配布allowlist、本書。P0 Staticのbytes、GAS/PWA/公開設定は変更しない。
- 副作用：Cloud Run instance内で別indexと上限付き履歴を保持。欠損/不正な位置indexやEngine障害は位置機能だけを無効にし、ETA応答へ波及させない。要求内のGTFS parseと追加feed取得は行わない。
- rollback：この位置レイヤと任意接続だけを戻す。既存P0 artifact/Secret/公開環境を変更せず、位置index生成は検証成功後のみ原子的に置換する。
- 受入：shape snap、折返し/並行区間、停留所列、jitter、古い/欠損/route外GPS、方向、confidence、raw矛盾、非露出、P0全DTO/Node回帰。実データは4方向・複数便を限定観測し、照合不能を成功/誤判定の分母に入れない。

## 境界とデータ

`Kawasaki Adapter → Internal Vehicle → Position Engine → Internal Normalized Position`。
Serviceが取得済みRTを任意Observerへ渡す。EngineはProvider名・Navi・ODPT・Favorite設定をimportしない。Hub Aggregatorは将来この出力を上位で統合する。

Internal Vehicleは既存trip/date/startTimeとGPSを保持し、Engine境界で`provider/tripId/routeId/timestamp/position/rawState`へ変換。履歴keyはprovider＋Static版＋trip＋運行日＋startTime。別便、翌日、別Providerの履歴を混ぜない。

位置artifactは`provider/sourceVersion/sourceHash/generatedAt/stops/shapes/chains/trips/directions`。trip_id直接lookupとstop列の重複排除を用い、shape_id・shape points・stop/shape双方のshape_dist_traveledを保持する。P0 artifactとsource hash/版/対象tripを照合。起動時に一度読み込み、同じshape/chainの幾何indexを共有する。欠損shapeをstop間直線から生成しない。

## GPS・停留所判定

shape各線分へGPSを投影し、距離・shape上の進行距離・全長比progressを得る。停止列も同じshapeへ対応付ける。shape_dist_traveledは単位をメートルと決めつけず、shape側の値から幾何距離へ変換する。未提供なら一意な投影とstop順序を検査し、折返しで複数候補が残ればunknown。

GTFS stop_sequenceは連番とは限らない。[GTFS公式仕様](https://gtfs.org/documentation/schedule/reference/)に沿って順序識別子として保持し、停留所数は完全stop列のordinal差で数える。連番なら例の13−10=3と一致する。

`stopsAway = target ordinal - nextStop ordinal`：nextStopを含み目的stopを含まない「目的停留所より手前にある停留所数」。nextStopが目的stopなら0（次が目的停留所）。目的stop到達/通過後は別state/unknownとし、負数は返さない。「あと3停で到着」「3つ前」と同一視せず、将来UIはこの定義を明示する。

- 停留所間：一意なshape位置を挟むpreviousStop/nextStopを返す。
- approaching/departed：複数GPSの前進とstop付近への進入/離脱が一致する場合のみ。
- at_stop：複数点が停留所位置付近で滞留する場合の幾何状態。乗降やドア開を証明しない。UI表記は「停留所付近」。単一点だけならunknown。
- raw sequence/stop/statusは補助矛盾の記録/減点専用。曖昧なGPS候補をraw値で選び直さない。

## 暫定confidenceと短期履歴

confidenceは**検証前のルールスコアであり、正解確率ではない**。実測で校正するまで数値だけでUI解禁しない。

初期パラメータは設定として分離：GPS age上限120秒・未来許容5秒、route距離40m、stop投影距離60m、曖昧候補の距離差10m/進行距離差40m、履歴180秒/最大6点/最大256便、判定には異なるtimestampの3点・20秒以上を要求。前進15m、jitter15m、最高22m/s＋誤差20mを暫定境界とする。重複timestampで履歴を増やさず、逆行/飛び/欠損後は連続性を再確立する。

鮮度・route距離・連続進行・trip/stop列の整合を評価し、raw矛盾は減点。初期閾値0.85未満はsupported=false。shape欠損/識別不一致/曖昧な折返し等はスコアに関係なく抑止。メモリ消失/instance切替後の初回はunknownに戻る。

## Public DTOとUI解禁

今回の公開DTOはP0の`position.supported=false`と既存null項目を厳密維持。生lat/lon・履歴・rawStateを返さない。Position UIもOFF。精度が未検証なのでDOM/CSSは今回追加しない。

2026-09-12のPhase 2で、Position Engineのroute geometryをGTFS shape固定からsource注入へ変更した。`gtfs_shape`、`odpt_region`、`observed_corridor`を同じ投影境界で扱い、公式shapeを優先する。shape欠損はエラーではなく`route_geometry_unavailable`として位置だけを抑止する。Observed Corridorの設計・実証結果は [PALURU_BUS_P1_POSITION_PHASE2.md](PALURU_BUS_P1_POSITION_PHASE2.md) を正本とする。Public DTOとUI gateは変更していない。

UI解禁候補は高confidenceの公式一致率95%以上に加え、4方向、停留所付近/間/始発直後/到着前、複数便/時間帯の十分な独立サンプルが必要。Naviには共通trip IDや位置timestampが未確認なので、候補照合を確定一致に数えない。一致率=一致/判定可能で同一便・時点・区間が確証ある組、明確誤判定率=不一致/同じ分母。分母0はN/A、unknown/shape欠損はcoverageとして別記する。

## 実装ファイル

|ファイル|今回の責務|
|---|---|
|`bus/position/geometry.js`|都市内の距離計算・shape線分への投影・source距離単位の変換|
|`bus/position/route-index.js`|artifact検査、trip直接lookup、shape/完全stop列の共有index|
|`bus/position/engine.js`|内部Vehicle整形、連続候補判定、区間/停留所状態、confidence、公開OFF境界|
|`bus/position/policy.js`|検証前の距離/時間/履歴/score閾値|
|`bus/position/observer.js`|取得済みRTとP0運行日/targetの照合。内部集計のみ|
|`bus/runtime/position.js`|起動時にsidecarを一度読込。不正/欠損は位置機能だけ無効|
|`bus/runtime/start.js`, `metrics.js`, `core/service.js`|任意Observerの接続と安全な時間計測。公開Arrivalの変更なし|
|`bus/scripts/position-static.js`, `build-p1-position-static.js`|同一公式GTFS版から位置用sidecarを検証・生成|
|`bus/scripts/observe-position-p0.js`|既存の限定観測にTrip descriptor項目を追加。Naviは参照専用|
|`bus/scripts/replay-p1-position.js`|ローカル観測の再生・抑止理由集計。Navi値はEngine入力にしない|
|`bus/test/position.test.js`|新規21試験|
|`bus/providers/kawasaki/static.js`|既存build-time ZIP readerのexportのみ|
|`bus/package.json`, `Dockerfile`, `.dockerignore`, `.gcloudignore`|生成コマンドとPositionコード/単一sidecarの配布allowlist|

生成物・限定GPS観測は既存の`bus/generated/*.json` ignore下に置く。Docker/Cloud Buildは`p1-position-static.json`だけを追加許可し、観測記録や`.local`、`.dev.vars`を含めない。公式の全ZIP/全レスポンスは保存しない。

## Static Position indexの実結果

2026-09-11、P0と同じ[川崎市交通局ODPT Static](https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines)の`20260701_20260828`を正規キーで取得した。ZIPのSHA-256は既存P0 artifactのsourceHashと一致。P0 JSON自体は変更していない。

- 生成物：`bus/generated/p1-position-static.json`、**1,316,509 bytes（約1.26 MiB）**。
- 2026-09-12再生成時SHA-256：`edd1dba578f52d18c5289a10ecd56ca86f9f01b195b5354a43e29bab61819aa6`。`generatedAt`を含むartifact全体hashであり、正規GTFS同一性は別の`sourceHash`で照合する。
- 8,856 trip、180 stop（全180件に座標あり）、重複排除後34完全stop列。
- **`shapes.txt`なし、対象8,856 tripのshape_idなし、stopのshape_dist_traveledもなし**。
- そのため道路shapeは0件、判定に使えるchainも0件。stop座標があることを「shapeがある」と扱わない。

|P0 direction|対象trip数|公式shape付き|
|---|---:|---:|
|神木本町→登戸|660|0|
|神木本町→溝の口駅南口|3,820|0|
|登戸→神木本町|660|0|
|溝の口駅南口→神木本町|3,716|0|

更新は`bus`で`npm run build:position`。先にP0 Staticを更新した場合、必ずその版と同じZIPから再生成する。版/hash/全対象trip/4方向/stop列/座標を検査してからtemp→renameし、置換前ファイルをhash名で保存する。異常時は旧sidecarを維持する。将来のremote build前にもこの生成を実施する必要がある。本フェーズではremote build/deployを実行していない。

## 実データ・公式参照の観測

日時はすべて2026-09-11 Asia/Tokyo。8回×31秒間隔の限定観測を3窓実施。参照JSONの必要なmarker項目とODPTのP0対象車両だけを抽出し、raw全文/Secretは保存していない。

- 第1窓：21:26:34〜21:30:15、4方向合計144 vehicle-direction行。
- 第2窓：21:44:45〜21:48:25、同144行。
- 第1/2窓は既存captureがTripのstartTime/relationship/raw routeIdを保存していなかった。GPS/contentの比較証拠として維持するが、初期replayの仮置きdescriptorによる出力は正式なEngine検証数に含めない。現scriptは旧captureを`capture_descriptor_missing`として抑止する。
- 第3窓はdescriptorの必要項目を保存してEngineへ渡す。relationshipの明示的な欠損はGTFS-RTの既定値SCHEDULEDとして既存Adapterと同じ正規化を行う。過去captureで「項目自体が未記録」の場合と区別する。

第3窓：**21:54:17.436〜21:57:58.182**。`position-p0-20260911T215417.json`と同名`-p1-replay.json`に限定証拠を保存。

|方向|観測行 / 独立trip / 異なるGPS時刻|GPS age範囲|Engine結果|
|---|---:|---:|---|
|神木本町→登戸|9 / 2 / 7|5.18〜76.99秒|shape_missing 9|
|神木本町→溝の口駅南口|61 / 9 / 48|6.18〜91.50秒|shape_missing 61|
|登戸→神木本町|15 / 2 / 11|11.18〜89.99秒|shape_missing 15|
|溝の口駅南口→神木本町|56 / 8 / 42|4.65〜87.89秒|shape_missing 56|

異なるGPS時刻はdirection内のtrip_id＋timestampの組数。directionをまたぐ重複は独立sampleとは数えない。全141行でGPS欠損0、120秒超0、**supported 0/141**。4方向に実GPSとStatic joinはあるが、shapeなしのため位置の推定値は返していない。

公式表示と厳密に比較できる高confidence判定は**0組**。一致率・明確な誤判定率はともに**N/A（分母0）**。0%誤判定・100%正解と報告しない。古いGPS/欠損/route外の抑止は合成試験で確認し、この窓にその実例が出たとは主張しない。

第3窓のODPT header差分は30,31,31,30,31,61,31秒。第1窓も主に30〜31秒、第2窓には61秒あり。これは取得したfeed timestamp間の観測差であり、61秒が配信停滞か取得時の更新スキップかは未確定。既存30秒polling/25秒cacheは変更しない。

第3窓のNavi JSONは各方向8/8取得成功。ただし神木→登戸のmarkerは0、登戸→神木も最後6回はmarkerなし。画面検索の対象外/通過等を欠損や運休と決めつけず、公式比較不能として扱った。

### 新しく確認した時点差

第2窓の`home_to_noborito`、ODPT trip `4112_01_100001257`、route `10044`の例。Naviは同系統の候補であり、共通trip IDと位置timestampによる確定joinではない。

|受信時刻|Navi content / 座標|ODPT GPS timestamp / 座標|補助sequence / stop_id / status|
|---|---|---|---|
|21:45:48.789|5 / 35.599345,139.570775|1789130673 / 35.599621,139.569305|9 / 245_1 / INCOMING_AT|
|21:46:20.247|4 / 35.598970,139.573513|1789130733 / 35.599346,139.570770|9 / 245_1 / INCOMING_AT|
|21:46:51.653|4 / 35.598970,139.573513|1789130768 / 35.598969,139.573517|10 / 467_1 / INCOMING_AT|

近い座標が別の観測時刻に現れている。単に同時HTTP取得しただけでは、両データの位置時刻が同じとはいえない。GPSとtimestampを主根拠にし、raw sequenceやcontentの差を直接停留所間の答えにしない方針を維持する。

通常ブラウザ操作で公式検索→登05走行位置を開いた。ページ更新時刻21:46の図では、登戸方面アイコンが**堰下と向丘出張所の間**、待ち時間03分と表示された。先行する接近一覧は21:49便・2番・5個前通過を表示。これらはページ更新時刻も画面種別も異なり、静止画とODPTを厳密な同一時点の正解組には数えない。

同tripのStatic列は、平(sequence8)→堰下(9/245_1)→向丘出張所(10/467_1)→平橋(11)→向丘中学校下(12)→神木本町(13/184_2)。この列とGPSは取得できるが、道路shape欠損のためEngineは区間を断定しない。

参照は[公式市バスナビ](https://kcbn.bus-navigation.jp/wgsys/)の表示と、既存調査で特定した`/wgsys/wgp/busMarkImg.htm`の限定JSONのみ。内部endpointの公開再利用許諾は未確認であり、runtime/Provider/API/生成indexへ取り込まない。route-label一致や最寄りGPS候補を正解ラベルに自動採用しない。

## 東急との比較（2026-09-11）

[東急公式サイト](https://www.tokyubus.co.jp/)から案内される[東急バスナビ](https://tokyu.bus-location.jp/blsys/navi)で、通常操作により向01（梶が谷駅〜向ヶ丘遊園駅南口）を確認した。21:39のroute画面で、神木本町を含む停留所列・上下方向・バスアイコン・折返し表示を確認。[公式利用案内](https://tokyu.bus-location.jp/blsys/navi?EID=ug&VID=top)には路線上のバス位置と停留所接近表示が説明されている。

|項目|川崎市バス|東急バス|
|---|---|---|
|正規Static / RT|ODPT GTFS / GTFS-RTを実取得|一般開発者向けの配布URL・利用条件は未確認|
|正規Vehicle lat/lon/timestamp|P0全方向で実取得|公開利用できるfeedでは未検証|
|公式Route Position UI|走行位置図・接近情報を実表示確認|向01のstop列＋方向別バスアイコンを実表示確認|
|内部画面通信の手掛かり|参照JSONにcontent/GPS等あり|GET form `/blsys/navi`、VID/EID/RAMK等の画面選択パラメータを確認|
|公開JS|既存調査のJSON呼出し定義|`default.js`のform.submitとroute画面のwindow.open定義を確認|
|更新|ODPT headerは主に30〜31秒、観測間隔61秒の例もあり|UI選択肢30秒/1分/5分。feed周期は未測定|
|公式shape|今回の配布版にない|配布データ未取得のため未確認|
|本番入力に採用|正規ODPTのみ|未採用。内部endpoint/HTMLを入力にしない|

東急の公開JSで確認したのは画面遷移定義であり、汎用JSON APIの発見ではない。今回使えるブラウザ接続にNetwork/HAR取得機能はなく、XHR全体の記録は未実施。lat/lonを返す通信が「存在しない」とは判定しない。

検索・公式案内・ODPT catalog照会を試した範囲では、東急の一般向けGTFS/RT取得URLとライセンスを確定できなかった。catalog API照会は取得不能だったため、未確認を「公開なし」に置換しない。[東急Web利用条件](https://www.tokyubus.co.jp/terms.html)はコンテンツの許諾なき再利用に制限を設け、リンク先には個別条件が適用されるとしている。内部画面データのアプリ再利用を許す根拠は確認していない。

Engineには東急固有値を導入していない。将来、許諾済みのtrip/完全stop列/shape/Vehicle座標とtimestampをAdapter・位置Static builderで共通形式へ変換できれば再利用できる。ただし東急実データでの互換性は未検証。shapeまたは識別情報が不足するProviderではsupported=falseを返す。

## テストとP0回帰

- Phase 3最終再実行時 Repository `node --test test/*.test.js`：**85/85 PASS**。
- Phase 3最終再実行時 Bus `npm test`：**94/94 PASS**。fail/skip 0。
- 最終Secret scan：**351対象・一致0**。生成sidecar/3窓目の限定観測/再生結果/新規source/MDを含む。`.dev.vars`、生成JSON、ローカル受入wrapperはGit ignore確認済み。
- 新規/変更Position関連JSの構文確認、`git diff --check` PASS。PWA/GAS/公開API URLの差分なし。
- Position合成試験：屈曲shape投影、距離単位、非連番sequence、区間、接近/離脱/滞留、jitter、GPS古い/欠損/未来/route外、重複timestamp、逆行/jump、近接往復/折返し、raw矛盾、confidence閾値、履歴上限、source版、原子的生成、公開非露出、Node起動障害分離。
- 合成snap例：折れ曲がる200m経路に対してrouteから約10m、進行距離約150mを再現。**これは人工fixtureの幾何試験であり、川崎実路線の精度証明ではない**。
- 既存P0全DTO13シナリオ（RT/Static/欠損/zero/遅延/取消/順序変更/過去ETA/stale等）が不変。Observerが例外を出しても全DTOとprovider fetch回数が同じ。
- Node依存graphにGTFS ZIP/CSV parse、build script、秘密ファイル、Navi/東急内部endpointを含まない。
- `npm run test:run`：新規Node process＋正規ODPTで4方向×3便、health、CORS、Secret非露出、25秒cacheの取得回数1/0/0/1/0をPASS。

### ローカルNode計測

21:52:53取得。Windows Node processで測定し、Cloud Run/container実測ではない。

|項目|実測|
|---|---:|
|process起動→health|374.17ms|
|起動処理 / P0 Static / Position sidecar|125.97 / 73.16 / 35.65ms|
|初回API / warm cache hit|100.67ms / 4.50〜5.98ms|
|cache期限後API|79.20ms|
|ODPT fetch / decode（2 fetch）|61.88〜74.60 / 7.65〜11.89ms|
|Position処理 / ETA JOIN|0.328〜2.474 / 1.742〜5.295ms|
|response bytes|8,070|
|RSS（5 request）|78.12〜96.98MB（decimal）|

Positionの実測はshape欠損による早期抑止経路。shape snapを全便に行った性能とはみなさない。起動時statusは`shape_unavailable`、indexは8,856 trip / 0 shape / 34 chain / 0 supported chain。

### 実ブラウザ（ローカルHTTP）

新しいNode runtimeを8790、既存Busコンポーネントのallowlist harnessを8791で一時起動。既存8787/8788プレビューや公開環境は変更していない。

- 実ODPT：4方向×3便、乗り場、分単位ETA/遅延、RTなし表示、翌日便の日付を確認。Position DOMなし。
- 自動更新でAPI取得1→2回、別画面中は2回のまま、Bus復帰で即3回。
- 合成stale：前回更新・古い情報の警告、古いETAを抑止。
- 合成Static：12便すべてリアルタイム予測なし、ETAなし。
- 合成fetch失敗：更新失敗＋前回更新を表示。
- Desktop viewportでは横overflowなし。Android実機と本番Cloud Run/PWAでのP1 Position受入は未実施。UI本体・polling/visibility制御コードは変更していない。

## 制限と次の検証

1. 最大の不足は**公式の道路shape**。現配布にはない。別の正規配布または事業者の許諾済み経路データを確認するまで、stop間の直線補完・Navi入力への切替はしない。
2. 厳密なNavi同一便/同一位置時刻/区間の対応が不足。最寄り座標・同じ系統だけで教師ラベルを作らない。停留所付近/間/始発直後/到着前の全条件を、4方向・複数独立便・複数時間帯で確証する受入は未達。
3. GPSが遅れて届くため、EngineのobservedAtは位置の時刻として保持する。停止位置付近の滞留は乗降を証明しない。
4. confidenceの0.85、距離/速度/鮮度閾値は未校正。観測した高confidenceの一致率と独立sample数で検証する必要があり、score0.95を95%精度と呼ばない。
5. 幾何計算は都市内の近似（起点から緯度経度各1度以内、緯度±85度以内）。長距離・日付変更線・極域は未対応。完全に重なる往復shapeや投影stop順序が曖昧な経路は抑止する。
6. instance内の短期履歴のみ。起動直後/instance切替/長い無取得後は最低3つの異なるGPS時刻が揃うまでunknown。P0/APIへ位置を公開する接続は実装していない。
7. 今回の目的停留所はP0カードの乗車stop（from）。将来Hub/乗車中用途はtargetを明示して呼び出す。Hub統合・UI解禁は別フェーズ。

**位置UI解禁はNO-GO、Feature Gate OFFを維持。** ローカルEngine・抑止・P0回帰を検証した段階であり、実路線位置の精度受入は未達。本番deploy/commit/pushはしていない。

Phase 3では、国土数値情報N07とOpenStreetMap登05relationからbuild時限定の道路候補を生成し、ODPT GPSで検証する境界を追加した。数値結果、利用条件、区間coverage、Public Gate判定は [PALURU_BUS_P1_POSITION_PHASE3.md](PALURU_BUS_P1_POSITION_PHASE3.md) を参照する。

過去記録は[DATA_VALIDATION](PALURU_BUS_P0_DATA_VALIDATION.md)、公開済みP0/Architectureは[DEPLOYMENT](PALURU_BUS_P0_DEPLOYMENT.md)を参照。作業開始時に存在したDEPLOYMENTのMini反映記録差分は維持し、今回書き換えていない。
