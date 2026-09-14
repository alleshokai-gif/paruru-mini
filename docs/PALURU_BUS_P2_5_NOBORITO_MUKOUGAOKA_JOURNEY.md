# PALURU Bus P2.5 登戸・向ヶ丘遊園 Journey

検証日: 2026-09-14（Asia/Tokyo）

## 問題と目的

小田急利用時に「登戸で降りる」「向ヶ丘遊園まで乗る」のどちらを選ぶか判断しやすくするため、既存Hubより上位にJourney Groupを置く。P2.5ではカード間の優劣や徒歩・電車時間を計算せず、各駅から神木本町を通る次3便を独立に提示する。

## 変更方針と影響範囲

- 上位 `Journey Service` は2つの子Hubを束ねるだけとし、Providerや便の再ランキングを行わない。
- 各子Hubは既存Hub Aggregator / Rankingをそのまま使う。
- 川崎市バスのP0用Static artifactは変更せず、P2.5の1方向だけを別artifactとして生成し、Cloud Run composition rootで同一sourceのときだけmergeする。
- `/api/bus/arrivals` はmerge後もP0の4方向だけを返す。
- 東急は正規ODPT Staticだけを利用し、Realtimeや位置を推測しない。
- UIはFeature Gate配下に置き、Cloud Run production remote Acceptance通過後だけ本番PWA設定を有効化する。
- Position UIとPublic departure predictionはOFFを維持する。

## 正規Staticによる対象確定

### 登戸駅 → 神木本町方面

既存P0検証済みの川崎市バスを再利用する。

| 項目 | 値 |
|---|---|
| Provider | `kawasaki` |
| source/query | `noborito_to_home` |
| from stop | `362_1` 登戸駅 |
| target stop | `184_3` 神木本町 |
| route | `10044` 登05 |

この子Hubは `noborito_to_home` 以外を受け取らない。

### 向ヶ丘遊園駅南口 → 神木本町方面（川崎市バス）

2026-08-28版の川崎市交通局GTFSをP2.5 queryで事前抽出した。名前一致ではなく、同一trip内の停留所順とroute/directionを検証している。

| 項目 | 値 |
|---|---|
| Provider | `kawasaki` |
| source/query | `mukougaoka_to_kibukihoncho` |
| from stop | `474_5` 向丘遊園駅南口 |
| target stop | `184_1` 神木本町 |
| route | `10037` 溝19 |
| direction | `0` |
| platform | `5番` |
| destination/headsign | `溝口駅南口(おし沼)` |
| retained trips | 320 |

生成validatorはfrom/to、stop sequence、route、direction、platform、headsign、serviceを固定して検証する。`474_5`を出ても`184_1`を通らないtripはartifactへ入らない。

### 向ヶ丘遊園駅南口 → 神木本町方面（東急バス）

ODPT `BusroutePattern` の停留所列と `BusstopPoleTimetable` を照合した。

| 項目 | 値 |
|---|---|
| Provider | `tokyu` |
| source | `mukougaoka_to_kibukihoncho` |
| route | `odpt.Busroute:TokyuBus.Kou01` / 向01 |
| route pattern | `odpt.BusroutePattern:TokyuBus.Kou01.0004600073` |
| direction | `odpt.BusDirection:TokyuBus.Kajigayaeki` |
| from stop | `odpt.BusstopPole:TokyuBus.MukougaokayuuenEkiminamiguchi.00240650.6`（index 1） |
| platform | `6` |
| target stop | `odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.a`（index 10） |
| destination | `odpt.BusstopPole:TokyuBus.Kajigayaeki.00240688.`（index 18） |
| quality | `static_only` |

6番停留所の時刻表取得結果には向01以外も含まれる。Providerはoperator、stop、route、direction、weekday/Saturday/Sundayを厳密に選択してからnormalizeし、3曜日区分が揃わなければ失敗扱いにする。

## Journey / Hub契約

```text
GET /api/bus/journey?id=noborito-mukougaoka

Journey Group: 登戸・遊園
├─ Hub: noborito-eki
│  └─ Decision Group: noborito_kibukihoncho（次3便）
└─ Hub: mukougaoka-yuen-minamiguchi
   └─ Decision Group: mukougaoka_kibukihoncho（川崎＋東急、次3便）
```

Journeyレスポンスには上位の `recommendedChildId` を置かない。各 `decisionGroup.arrivals` は既存Hub内でのみ並び替え済みで、カード間比較は将来のJourney Decisionへ残す。片方のHub取得に失敗した場合、その子だけ `unavailable` とし、もう片方は残す。

## UI

初期PoCではローカルUIだけを有効にした。Cloud Run production remote Acceptance通過後、PWAの
`features/bus/config.js` でも `PALURU_BUS_JOURNEY_UI_ENABLED=true` とし、検証済みJourney 1件だけを登録する。

- 見出し: `登戸・遊園`
- 上部地点切替の5件目として統合し、選択時だけJourney本文を取得・表示する
- 5件時の地点切替は1段目3件・2段目2件の均等幅とし、横スクロールを使わない
- 子カード: `登戸駅`、`向ヶ丘遊園駅南口`
- 子カード見出しは既存decision groupと同じ濃青背景・白文字にする
- 子カードの駅名と `神木本町方面` は既存の文字サイズを維持して1行表示する
- 最速候補行の背景を左右へ広げても、のりば・遅延表示の右端は通常行と揃える
- 各カード: 神木本町方面の次3便
- 事業者色SVG、事業者名、系統、行先、のりばを常時表示
- 東急は `時刻表のみ` と表示しETA扱いしない
- 既存Hub arrival rendererを共用し、delay/state契約を分岐させない

実時刻の次3便が常に両Provider混在になるとは限らない。正しい時刻順で3便を切るため、ある時刻帯では川崎のみ、または東急のみになる。混在描画は合成受入で確認し、両Providerの実取得可否は実データAPI受入で別に確認する。

## ローカル検証

### Static生成

- source date: `20260828`
- source version: `20260701_20260828`
- trips: 320
- JSON: 118,285 bytes
- build時検証: PASS

### API実データ

- P0 `/api/bus/arrivals`: 4方向を維持
- 既存Hub: 神木本町3 group、溝の口1 group、立川1 group、昭和第一学園1 group
- Journey: 2子Hub、各3便
- 登戸: `noborito_to_home` / `10044` のみ
- 向ヶ丘遊園: KawasakiとTokyuのProvider取得状態がともにavailable
- Position: 全便Public `supported=false`
- Secret露出: なし

### 実ブラウザ

332px viewport（390px以下の厳しい条件）で確認した。

- 2子カード、各3便: PASS
- 向ヶ丘遊園の川崎＋東急混在fixture: PASS
- Provider SVG `currentColor`: 川崎 `rgb(31,111,178)`、東急 `rgb(198,40,40)`
- 事業者・系統・行先・のりば: PASS
- document scroll width 317px / viewport 332px: 横overflowなし

### 自動テスト・検査

- Bus: 161 / 161 PASS
- Repository: 103 / 103 PASS
- Hub / Journey UI対象: 12 / 12 PASS
- P0 Static preflight: 4方向PASS
- Bundle: 3,330,400 bytes、gzip 166,617 bytes、runtime module 36、hot pathのGTFS parserなし
- Secret scan: 495 files、matches 0

## 副作用とロールバック

P0 artifact、P0 query設定、既存Hub configは削除しない。ロールバックはJourney endpoint/config/UIとP2.5 artifact mergeを外し、Tokyu方向追加を戻す。P0 `/api/bus/arrivals` はwrapperで常に既存4方向だけを返す。

## 未実装・未確認

- PWAのWebアプリ更新、公開PALURU受入
- Android実機受入
- カード間の所要時間比較、推奨駅、徒歩時間、小田急乗車時間
- Tokyu Realtime / Position
- Public Position / departure prediction

## 判定

P2.5 Local Acceptance、Cloud Build、validation、production Cloud Run remote AcceptanceはGO。
PWA限定差分はテスト済みだが、Webアプリ更新・公開PALURU・Android実機は未実施のため、PWA全体は途中である。

## 本番化準備

2026-09-14 JST、Cloud Build前にactive account `alle.shokai@gmail.com`、project `paluru-bus`、region
`asia-northeast1`、project ACTIVE、課金有効、Cloud Build / Artifact Registry / Cloud Run / Logging /
Secret Manager API有効を確認した。送信allowlistにP2.5 Journeyと4つの生成済みStaticを含み、`.dev.vars`、
tests、`node_modules`は含めていない。

- Build ID: `bc19e7de-0c71-4f21-a3ae-98c7562a664f`
- status: SUCCESS
- source upload: 86 files / 5.1 MiB（圧縮前）
- build: 2026-09-14 16:52:16〜16:52:59 JST
- image tag: `asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api:p2-5-20260914-161520`
- fixed digest: `sha256:2eef5d9bbeffa26491e005fd3c311de10a16687d65e82230b1b5634c2e51fda1`
- image smoke: `/health`、Node 24、localhost CORS拒否、`.dev.vars` / scripts / `fflate`非同梱を確認
- Secret: buildへ実値を渡していない。runtime用の有効Secret version番号は`1`、値は未取得・未出力

validationはユーザー本人が次の固定digestで更新する。`--no-allow-unauthenticated`を維持し、PWAや本番serviceは
この段階で変更しない。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
$p25DigestImage = 'asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:2eef5d9bbeffa26491e005fd3c311de10a16687d65e82230b1b5634c2e51fda1'
& .\.local\gcloud.ps1 run deploy paluru-bus-api-validation `
  --image=$p25DigestImage `
  --project=paluru-bus `
  --region=asia-northeast1 `
  --platform=managed `
  --execution-environment=gen2 `
  --service-account=paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com `
  --cpu=1 `
  --memory=512Mi `
  --concurrency=8 `
  --min-instances=0 `
  --max-instances=1 `
  --timeout=30s `
  --port=8080 `
  --no-allow-unauthenticated `
  --set-env-vars='NODE_ENV=production,ALLOWED_ORIGINS=https://alleshokai-gif.github.io' `
  --update-secrets='ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:1' `
  --startup-probe='httpGet.path=/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=2,failureThreshold=12' `
  --configuration=paluru-bus
```

deploy後はrevisionとdigestの一致を確認してから、認証付きread-only AcceptanceでP0 4方向、既存4 Hub、
Journey 2カード各3便、Provider状態、Realtime / static-only / stale、CORS、Secret非露出、Logging、performanceを
確認する。次3便を正しい時刻順で切るため、遊園カードの表示3便が常に両Provider混在するとは限らない。
Kawasaki / Tokyu双方のProviderがavailableであることと、混在DOM fixtureを別々に検証する。

準備後の確認ではRepository 105/105、P2.5関連34/34、構文、差分whitespace、tracked / untracked /
generated 493ファイルのSecret照合がPASSした。Bus全体のうちesbuildを使わない156件はPASSし、4件の
dependency graph検査はCodex sandboxの上位パス読取制限で実行不能だった。同じruntime graphを使うCloud
Buildとimage smokeはPASSしているが、通常権限でのBus 161/161再実行はvalidation受入前の残確認とする。

ローカル実データの再確認時、Tokyuだけが`BUS_TOKYU_UPSTREAM_FETCH`となり、遊園カードは川崎3便を残した。
これはProvider障害分離の期待動作だが、P2.5の両Provider受入は未達なので、remote AcceptanceはTokyuが
`available`へ戻るまでPASS扱いしない。

## Validation remote Acceptance

2026-09-14 JST、ユーザーがvalidation revision `paluru-bus-api-validation-00006-2wk`をdeployした。
revisionはReady、指定digest一致、traffic 100%で、runtime service accountとSecret参照名を確認した。
Secret値は取得・出力していない。

- `/health`: HTTP 200
- P0: 4方向、各3便
- 既存Hub: 神木本町3 group、溝の口駅南口1 group、立川駅北口1 group、昭和第一学園1 group
- Journey: 登戸駅3便、向ヶ丘遊園駅南口3便
- 遊園Provider状態: Kawasaki / Tokyuともに`available`
- 観測時点の遊園上位3便: Tokyu 3便。時刻順の結果を変更してProvider混在を強制しない
- 不正Origin: Hub / JourneyともHTTP 403
- Public Position / departure prediction: OFF
- response内のSecret・生GPS: なし
- end-to-end: cold相当health 5,374.1ms、warm Journey 34.4ms、warm Hub 23.3〜401.0ms

Cloud Loggingは同revisionの直近15 requestを集計し、ERROR以上0件だった。request処理時間はp50 7.2ms、
p90 127.2ms、max 374.2ms、RSSはp50 111.4MiB、p90 / max 114.4MiB。RT取得が記録された1件は
ODPT fetch 95.6ms、decode 16.5ms、JOINは8件でp50 6.2ms、p90 / max 10.5msだった。

Validation判定はGO。本番はユーザー本人が同じdigestを`paluru-bus-api`へdeployする。PWAは本番APIの
再受入がPASSするまで変更しない。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
$p25DigestImage = 'asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:2eef5d9bbeffa26491e005fd3c311de10a16687d65e82230b1b5634c2e51fda1'
& .\.local\gcloud.ps1 run deploy paluru-bus-api `
  --image=$p25DigestImage `
  --project=paluru-bus `
  --region=asia-northeast1 `
  --platform=managed `
  --execution-environment=gen2 `
  --service-account=paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com `
  --cpu=1 `
  --memory=512Mi `
  --concurrency=8 `
  --min-instances=0 `
  --max-instances=1 `
  --timeout=30s `
  --port=8080 `
  --allow-unauthenticated `
  --set-env-vars='NODE_ENV=production,ALLOWED_ORIGINS=https://alleshokai-gif.github.io' `
  --update-secrets='ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:1' `
  --startup-probe='httpGet.path=/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=2,failureThreshold=12' `
  --configuration=paluru-bus
```

## Production remote Acceptance

2026-09-14 JST、ユーザーがproduction revision `paluru-bus-api-00006-x7c`をdeployした。指定digest一致、
Ready、traffic 100%を確認し、service accountは
`paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com`だった。環境変数は名前だけを確認し、Secret値は
取得・出力していない。

- `/health`: HTTP 200
- P0: 4方向、各3便
- 既存Hub: 神木本町3 group、溝の口駅南口1 group、立川駅北口1 group、昭和第一学園1 group
- Journey: 登戸駅3便、向ヶ丘遊園駅南口3便
- Provider: 登戸はKawasaki、遊園はKawasaki / Tokyuともに`available`
- 不正Origin: Hub / JourneyともHTTP 403
- `delayMinutes`: Hub / Journeyレスポンスで保持
- Public Position / departure prediction: OFF
- Secret・生GPS: responseへ非露出

外形計測はhealth 149.5ms、arrivals 212.6ms、Journey 40.9ms、warm Hub 21.9〜97.6msだった。
Cloud Loggingの確認時点では同revisionの集計対象requestが1件で、ERROR以上0件、処理6.1ms、RSS
88.2〜88.6MiBだった。request数が少ないため、Logging値は長期性能分布とは扱わない。

production Cloud Run判定はGO。

## PWA限定差分

Cloud Run production受入後、次のPWA差分だけを準備した。

- 検証済みJourney `noborito-mukougaoka` をFeature Gate配下で有効化
- 5件目の地点切替からJourney controllerを呼び出す
- Journey CSS / JSをHTMLとService Worker app shellへ追加
- `/api/bus/journey` をPWA response cache対象外にする
- Build IDを `v20260914-bus-p2-5-journey-v1` へ更新

PWA差分後のRepository testは106/106、Hub / Journey等の対象testは25/25、source Secret scanは
494 files / matches 0。作業ツリーには別テーマの未公開差分が共存するため、Webアプリ更新ではP2.5限定差分だけを
選択し、全作業ツリーを一括公開しない。

`bus/.local/p2-5-pwa-release.patch` はHEADのclean indexへ適用check済み。HEADのclean snapshotへこのpatchだけを
適用し、canonical LFでRepository 101/101 PASSを確認した。現在の混在作業ツリーを一括stageせず、このpatchを
indexへ適用することでP2.5 PWA差分だけをcommitできる。
