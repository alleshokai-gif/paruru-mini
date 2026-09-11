# PALURU Bus P1 Architecture

## 実装前の契約（2026-09-11）

ユーザー指定のP1 Architectureを実装する。P0の固定4方向、Public DTO、3便、30秒polling、25秒cache、stale/fallback、過去ETA抑止、Secret、Cloud RunとPWAを維持する。本番deploy/commit/pushは今回の対象外。Position UIはOFF。

- 問題・根拠：`core/arrivals.js`がFAVORITESと川崎固定attributionを参照し、`core/service.js`はproviderの既定値がkawasaki。`config/settings.js`に川崎の乗り場対応が混在。AdapterはVP座標を内部モデルに残していない。
- 方針：呼出し側でP0 Queryを用意し、Coreへqueries/providerContextを必須注入。Providerは元データの解釈とNormalized Static/Realtimeを担当。順位と表示単位はQuery Resolver/Coreで決める。
- 範囲：busのCore/Provider/Query設定、Node/旧Worker compositionと関連script/test、指定4文書。PWA/GAS/URL/Build IDは変更しない。既存Static JSONの更新や全件parseを要求経路へ追加しない。
- 副作用：内部Core/Service/Static parserの引数が変わるため全呼出元を同時更新する。公開HTTP契約は変更しない。座標追加に伴う旧RT cacheの混在はschema versionで分離する。
- rollback：P1の変更ファイルだけをP0 commit `ca99837`へ戻す。既存Static artifact/config hashは維持し、Secret/観測結果/他機能のデータは変更しない。
- 受入：P0時点の合成DTO記録との完全一致、Query注入/不正Query、別Provider context、platform/attribution差替え、GPS欠損/範囲外/0の区別、DTO非露出、cache分離、runtime依存graph、Node HTTP、ローカル実ブラウザの3便/更新/欠損。Cloud Run実環境とAndroidは別ゲート。

## QueryとStaticの契約

```js
getArrivals({ index, realtime, queries, providerContext, now, fetchError, staticStale })
```

P1のQueryは`id/type/provider/label/fromStopIds/toStopIds/routeIds`。P0表示互換用の`from/to/group`は任意の表示メタデータ。`type: favorite`のみ実行する。hub/platform/nearbyは将来の型で、今は明示エラーにする。未知Provider、重複Query ID、対象外stop/route、曖昧な乗降イベントは推測して処理しない。

```json
{
  "id": "home_to_noborito",
  "type": "favorite",
  "provider": "kawasaki",
  "fromStopIds": ["184_2"],
  "toStopIds": ["362_1"],
  "routeIds": ["10044"],
  "label": "神木本町 → 登戸"
}
```

既存`favorites.json`は変更せず、`config/queries.js`でtype/labelを付けたP0 Queryへ変換する。既存Staticの`directions`は事前抽出済み候補の格納形式として互換維持し、CoreではQuery IDと切り離してstop/route条件から選択する。任意の路線検索機能にはしない。現在のStaticに含まれない区間を扱うには、Providerのbuild側で候補を追加抽出する必要がある。

Normalized Staticは`rows`（または互換`directions`）、`stops`、`routes`、`calendar`、`calendarDates`、`feedInfo`、`fetchedAt`。各候補rowはtripId/routeId/serviceId/fromStopId/toStopId/stopSequence/alightSequence/scheduledSeconds/startTimeと表示名を持つ。Providerが生GTFSを検証してこの型へ変換する。Coreは不変indexを前提にfromStopId索引を一度作り、Queryでservice別グループへ絞る。Query設定が変わったときは選択キャッシュを更新し、Serviceは生成時のQueryを複製して保持する。P0専用artifact/hash検証はcomposition側の`runtime/static-artifact.js`に残し、汎用Coreへ持ち込まない。

## Provider / Service / Aggregator

```text
PWA → HTTP → Bus Service（Provider context + Query set + Static + RT cache）
                     → Query Resolver → Coreの順位/公開DTO
Provider Adapter → Normalized Static / Arrival更新 / Internal Vehicle
                                      ↓ 将来のPosition Engine
複数Providerの結果 → 将来のHub Aggregator → Hub / Platform / Nearby UI
```

Provider contextは`id/attribution/platformResolver/realtimeSchemaVersion`と、任意のPosition用Static参照を持つ。川崎の名前・出典・のりば・ODPT endpoint・元GTFSの解釈は`providers/kawasaki/`内に置く。CoreはProviderをimportしない。Serviceは1つのProvider contextとQuery setを束ね、Provider/version/schema単位でcacheする。4方向で同じfeedを重複取得しない。

現時点のGTFS型Normalized Staticはservice date/24時超/stop sequenceを共通内部契約とする。他社Adapterはこの契約にNormalizeする。Hubの会社横断統合・重複排除・順位・上位3件はProviderより上のAggregator責務で、今回実装しない。新ProviderはAdapter/context/Static供給とcomposition設定を追加し、Coreの条件分岐を増やさない。

## Internal Vehicle / Public DTO

Internal Vehicleはtrip（tripId/routeId/startDate/startTime等）、timestamp、stopId、sequence、statusと`position: {lat, lon}`。座標は元VPに実際に存在し、有限・範囲内の数値である場合のみ保持する。欠損や不正値は各軸null。明示された0と欠損を区別し、欠損を0,0で埋めない。

```js
// 内部形式。説明用であり実APIレスポンスではない。
{
  trip: { tripId, routeId, startDate, startTime, relationship },
  timestamp, stopId, sequence, status,
  position: { lat, lon }
}
```

`timestamp`はepoch秒、表示時刻はAsia/Tokyo。元RTのcurrent_stop_sequence/current_status/stop_idをそれぞれsequence/status/stopIdとして保持する。元データ欠損時はnull。既存P0の「古いETA＋乗車停留所でSTOPPED_AT→予測更新待ち」は互換維持するが、これは何停前/停留所間の根拠へ転用しない。

Public DTOは明示した項目だけ組み立て、Internal VehicleやProvider contextをspreadしない。`position.supported=false`、その他位置項目null、`positionUiEnabled=false`を維持する。lat/lonやInternal Vehicleはログ・API・PWAへ渡さない。

Position用StaticはProvider contextの任意参照境界にする。全停留所列/座標/shapeIdを持つ同じsourceVersionの別indexを将来注入でき、未提供はnull。既存2.5MiBのP0 Staticの乗降2点から全停留所列を捏造しない。shape計算/GPS判定は今回作らない。

## 拡張と未実装

東急・西武・伊予鉄を追加するときは、それぞれ`providers/<id>/`のAdapter、context、Static builderを用意する。Providerの公開条件・ID・時刻/位置の実データ検証は別途必要。ServiceをProvider別に構成し、Hub Aggregatorは後段で統合する。単一Providerの結果へ他社の予測を混ぜない。

未実装：Position Engine、接近/離脱/通過判定、shape snap、Hub/Platform/Nearby Query実行、Hub UI、会社横断最速、折返し/混雑予測、他社Adapter。本番に市バスナビ内部endpointを導入しない。

PWA接続先は既存`features/bus/config.js`の`PALURU_BUS_API_URL` 1箇所。Cloud Run URLは未確定のため差し替えない。

## 検証結果

変更ファイル（`bus/`配下、文書を除く）：

- 新規：`config/{policy,queries}.js`、`core/queries.js`、`providers/kawasaki/{config,attribution,context,position-reference}.js`、`test/{architecture.test,p0-cases}.js`、`test/p0-dto-baseline.json`。
- 更新：`config/settings.js`、`core/{arrivals,service}.js`、`providers/kawasaki/{adapter,static}.js`、`runtime/start.js`、`worker/entry.js`。
- 呼出元更新：`scripts/{check-static,integration-check,live-check,local-ui,p0-static,remote-probe-entry}.js`。
- 既存試験更新：`test/{core.test,fixtures,http-runtime.test,run-build.test,worker.test}.js`。
- 配布構成：`Dockerfile`、`.dockerignore`、`.gcloudignore`。文書：本書と`PALURU_BUS_P0_DESIGN.md`、`PALURU_BUS_P0_IMPLEMENTATION.md`、`PALURU_BUS_P0_DEPLOYMENT.md`。

2026-09-11 / Asia/Tokyo。公開環境を変更しないローカル検証。

|確認|証拠・結果|
|---|---|
|Bus全体|51/51 PASS。既存28＋Architecture23。初回esbuild3件はsandbox親ディレクトリ読取拒否。同一テストを通常権限で実行しPASS|
|P0全DTO互換|変更前`ca99837`で採取した13合成ケースのJSON SHA256と一致。4方向・順序・時刻・欠損・stale・取消・過去ETA・日付越えを含む|
|Provider独立|esbuild依存graphにFAVORITES/Query設定/Provider/runtime/Workerなし。別の合成Provider ID、stop/route/trip、attribution、platformResolverで実行PASS|
|Query|ID変更/順序変更/一部選択/flat rows、設定差替え、ServiceのQuery snapshot、型/stop/route/重複/曖昧な乗降の拒否PASS|
|GPS内部保持|合成protobufをdecode。trip/route/status/sequence/timestamp/stopId/lat/lon保持、欠損null、範囲外/非有限null、明示0を区別してPASS|
|公開DTO|座標・Vehicle・sequenceを露出せず、positionの全項目は未対応/nullableのまま。Position UI OFF|
|Static|既存実artifact2,616,507 bytes、4方向660/3820/660/3716行のpreflight PASS。生成器は合成GTFS・異常時保存保護test PASS。再生成なし|
|Node HTTP|実ODPT、production CORS、4方向×3便、health、25秒cache、秘密ファイル404、key非露出PASS。性能は[Deployment](PALURU_BUS_P0_DEPLOYMENT.md)冒頭|
|旧Worker互換|ローカルworkerdのRTあり/上流失敗で各4方向×3便。各シナリオのRT fetch1回、CORS PASS。実ネット通信0|
|Python検証器|既存合成テスト14/14 PASS（専用.venv）|
|構文|変更したBus JavaScript27ファイルのnode --check PASS|
|Secret|332対象scan、実キー値一致0。HTTP body/プロセス計測ログもキー非露出。scanは値を出さず件数のみ|
|Repository全体|83/84 PASS。既存Agent UIテスト1件がLF固定の文字列一致でCRLFファイルに失敗。Bus/PWA処理による差分ではない。修正範囲追加の回答待ち|

リポジトリ既存失敗の証拠：`app.js`は改行を正規化するとHEADと完全一致。`test/pwa-agent-chat.test.js:478`の対象文字列はHEADのLFソースに存在し、Windows CRLFソースでは一致せず、LF正規化後は一致する。本体ソースは変更していない。Bus内の既存Docker allowlistテストにも同様のLF固定検査があり、今回対象内で`\r?\n`対応にした。検査内容・allowlistは緩和していない。

### ローカル実ブラウザ

In-app Chromiumで受入用ページから**既存Bus component → ローカルNode API → 実ODPT**を確認。PALURU認証・本番PWA・Androidの代替試験ではない。

- 390×844 viewport（スクロールバーを除くclient幅375px）で4カード、各3便。document scrollWidth/clientWidthとも375px。表示崩れ/横overflowなし。
- 実データでRT便の分単位ETA/delay、欠損便の「予定」「リアルタイム予測なし」を確認。
- 30秒設定で取得回数1→2。別画面へ移動して42秒間2回のまま、Bus復帰後3回へ即増加。
- 合成staleで「前回更新」「古い情報」と12便を保持し、ETA表示0。合成Staticで12便の予定時刻/予測なし。HTTP503を返す試験で前回データを保持してエラー表示。
- 位置UIなし。document.hiddenの実イベントは、別タブでもhidden=falseを返すこの環境では未確認。hidden停止/復帰/旧要求破棄は既存PWA unit testでPASS。Androidバックグラウンド化は別途必要。

### Architecture Acceptanceと残件

1〜8、10〜11はローカル根拠でPASS：P0同一結果、Core固定依存除去、Provider追加境界、内部GPS/公開非露出、位置OFF、Node runtime、新規テスト、秘密管理。9「既存tests全PASS」は上記1件により未達。**厳密なArchitecture判定は現時点NO-GO（全体テストの改行依存1件の解消待ち）**。Bus単体とローカル実HTTPの検証はPASS。本番deploy/Cloud Build/Secret登録/commit/pushは実施していない。

次のPosition P1案：同一便のGPS＋timestampの連続観測と、同一Static版の完全な停留所列/stop座標を用意する。Position Engineは鮮度・便同一性・複数区間候補・折返し/停車を明示的に扱い、曖昧ならnull。sequence/stopIdは補助照合に留める。必要ならshapeを別フェーズで評価する。4方向で検証・受入した後にだけPublic DTOとFeature Gateの変更を別途判断する。今回この判定処理は実装していない。
