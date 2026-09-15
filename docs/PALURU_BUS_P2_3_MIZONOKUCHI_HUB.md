# PALURU Bus P2.3 溝の口駅南口Hub

最終更新: 2026-09-13 Asia/Tokyo

## 問題と方針

溝の口駅南口から神木本町方面へ向かう便は2・3・4番のりばに分かれる。利用者の判断は「どの乗り場か」ではなく「どの便で神木本町方面へ最も早く帰れるか」なので、1つのdecision groupへ統合する。既存Kawasaki Providerが解決した便属性だけをHubへ渡し、Hub層へ川崎固有のstop/route解釈は追加しない。

影響範囲はHub config、複数Hubを扱うservice/runtime、Kawasaki Hub normalize、Bus Hub UI、ローカル受入harness、testsに限定する。既存P0 `/api/bus/arrivals`、Position Engine、Public departure prediction、GASは変更しない。

ロールバックは `mizonokuchi-minamiguchi` のHub設定とPWAのHub一覧を外し、Hub serviceを神木本町だけへ戻す。既存P0 APIとStatic artifactはそのまま利用できる。

## 正式対応

既存のP0実データ検証値を再利用する。名称から推測した対応はない。

|標柱|表示のりば|正式route_id|Hub source|
|---|---|---|---|
|`434_2`|2番|`10033`, `10034`|`mizonokuchi_to_home`|
|`434_3`|3番|`10036`|`mizonokuchi_to_home`|
|`434_4`|4番|`10032`, `10035`, `10037`|`mizonokuchi_to_home`|

targetは `184_3` 神木本町。正式なroute labelと行先は生成済みP0 StaticおよびKawasaki ProviderのNormalized Arrivalを使用する。

## Hub契約

```json
{
  "id": "mizonokuchi-minamiguchi",
  "label": "溝の口駅南口",
  "decisionGroups": [
    {
      "id": "mizonokuchi_minamiguchi_home",
      "label": "神木本町方面",
      "providers": ["kawasaki"],
      "displayLimit": 3
    }
  ]
}
```

`GET /api/bus/hub?id=mizonokuchi-minamiguchi` は神木本町Hubと同じNormalized Hub Arrivalを返す。Kawasaki Providerはarrivalの検証済みplatformからfrom stopを一意に逆引きする。複数stop queryでplatformが欠損・未知なら推測せず `BUS_KAWASAKI_HUB_PLATFORM_INVALID` でfail closedする。

Hub serviceはHubごとに必要なProviderだけを取得する。このHubはTokyu Providerを呼ばない。Provider失敗はHub provider statusへ隔離し、他Hubの状態へ波及させない。

## Rankingと推薦

同じdecision group内で全platformを横断し、既存P2.2 Rankingを再利用する。

1. `effectiveDeparture`
2. realtime ETA
3. `estimatedDeparture`
4. `scheduledDeparture`

`departure_uncertain`、`unknown`、`do_not_recommend`は推薦しない。stale/realtime_staleおよび明示low confidenceも `recommendedArrivalId` の候補にしない。安全に推薦できる最上位便だけへ「最速候補」を表示する。Position/stopsAwayは順位キーにしない。

## UI

Busトップの「いつもの場所」は設定配列から神木本町、溝の口駅南口の順に描画する。各場所は独立した30秒polling controllerを持つが、画面離脱中は両方停止し、復帰時に両Hubを即refreshする。

便には事業者、系統、行先、のりば、scheduled、利用可能なETA/delay、品質・departure stateを表示する。390px以下ではlocation/group/board/rowへ `min-width: 0; max-width: 100%` を適用し、長い行先は折り返す。Legacy固定4方向UIはGate OFFのまま保持する。

## ローカルAcceptance

2026-09-13夜の実ODPTデータを使ったローカルCloud Run相当APIで次を確認した。

- P0 4方向 x 3便: PASS
- 神木本町3 decision group: PASS
- 溝の口駅南口1 decision group x 3便: PASS
- 実時刻の上位3便は2番・3番が混在。4番はその時点の上位3便になかった
- 2/3/4番の正式mapping: 合成Provider契約testでPASS
- route、行先、platform、scheduled、ETA/delay/stateのAPI保持: PASS
- uncertainty/staleを推薦しない: PASS
- Position UI OFF、Public departure prediction OFF: PASS

実ブラウザでは狭幅表示で両Hubとカード折り返しを確認した。取得回数は初回2、30秒後4、別画面で32秒待機後も4、復帰3秒後6となり、30秒polling、離脱停止、復帰即refreshが成立した。Android実機と本番API/PWAは今回の範囲外で未確認。

検証結果はBus 137/137、Repository 95/95、Static preflight 4方向、runtime bundle 3,329,984 bytes（gzip 166,546 bytes、36 modules）、Secret scan 442 files / matches 0。sandbox内のesbuild/Secret scanはworkspace上位の読み取り制限で失敗したため、同一コードを権限制限外で再実行して上記PASSを得た。

## 判定

P2.3のローカルArchitecture/API/UIは **GO**。本番deployは別Gateであり、今回は行わない。公開PWAとAndroid実機は未確認なので、製品としての完成判定は行わない。

## 本番化準備（2026-09-14）

Cloud Build `acf5d528-ebf3-4e4f-a628-1dcfc7cd09ae` はSUCCESS。生成imageは`asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:e5f153e1e038386fe3832c6ee1e4ff5ad04048420a4e0b5559f6d50cacb30aae`で、image smokeはPASSした。Buildには本番Secretを渡していない。

validation / production Cloud Run deploy、remote Acceptance、公開PWA更新、Android実機受入は未実施。PALURU憲法に従い、deployと公開操作はユーザー本人が実行する。remote Acceptance前に完成扱いしない。

### Validation remote Acceptance

ユーザー本人がrevision `paluru-bus-api-validation-00004-djx`へdigest固定deployした。2026-09-14 09:40 JST頃の認証付きread-only受入結果は次のとおり。

- `/health`: HTTP 200、117.2ms
- `/api/bus/arrivals`: 4方向 x 3便、HTTP 200、110.6ms
- 神木本町Hub: 3 decision group x 3便、連続3回200、34.4〜41.6ms
- 溝の口駅南口Hub: 1 decision group x 3便、連続3回200、24.0〜27.1ms
- 時間差の観測で2番・3番・4番の便が同じgroupの上位3件へ入ることを確認
- 神木本町Hubでnonzero `delayMinutes` 3便を確認
- 溝の口Hubで`departure_uncertain`を確認し、`recommendedArrivalId=null`または安全な便だけを推薦
- Position supported 0件、effectiveDeparture 0件
- production Origin CORS許可、localhost OriginはHTTP 403かつallow-originなし
- responseにSecret名、token、生lat/lonなし
- revision単位Cloud Logging ERROR以上0件
- UIのdelay / stale / pending / uncertain優先表示test 7/7 PASS
- 最終回帰: Repository 95/95、Bus 144/144、Secret scan 452 files / matches 0

実データの行先は「神木本町」固定ではなく各便の正式headsign（例: 鷲ヶ峰営業所前、宮前区役所前）を表示する。decision groupの利用目的が「神木本町方面」であり、便の行先をtarget stop名へ書き換えない。

validationは **GO**。validation受入時点の本番`paluru-bus-api`はrevision `paluru-bus-api-00003-2kk`で、rollback元digest `sha256:3949a6384ad474a10a741dffae2cfaadec6bd06456ce6b1a42d3c32a35d2059d`を確認した。この時点では本番更新、更新後のremote Acceptance、PWA公開、Android実機は未実施だった。

### Production remote Acceptance

ユーザー本人が同じ検証済みdigestを本番revision `paluru-bus-api-00004-9nt`へdeployした。Ready revisionとimage digestの一致を確認後、2026-09-14に本番Originからread-only受入を実施した。

- tokenあり／公開PWAと同じtokenなしの両経路で`/health`、P0 4方向 x 3便、両HubがHTTP 200
- 神木本町Hubは3 decision group、溝の口駅南口Hubは1 decision group x 3便
- 溝の口の実レスポンス上位3便に3番・2番・4番が同時に混在
- 品質状態は`realtime`、`static_only`、`static_fallback`を観測。nonzero delayは5便、fallbackは3便
- `departure_uncertain`を1便観測し、最速推薦対象外であることを確認
- stale実便は観測時0件。stale時の非推薦・表示優先は既存契約/UI testで確認
- Position supported 0件、effective departure 0件。Position UIとPublic departure predictionはOFF
- production Origin CORS許可、localhostはHTTP 403かつallow-originなし
- responseにSecret名、token、生lat/lonなし。revision単位Cloud Logging ERROR以上0件
- tokenなし実測: health 149.1ms、P0 60.8ms、神木本町Hub 28.3〜36.0ms、溝の口Hub 25.9〜29.0ms

Cloud Run本番APIは **GO**。

### PWA限定release差分

同一working treeに別テーマの未コミット変更があるため、P2.3 PWAだけのpatchをGit管理外の`bus/.local/p2-3-pwa-release.patch`へ分離した。対象は`build.js`、`features/bus/{config,hub.js,hub.css}`、Hub UI test、Build固定値を持つ既存2 testだけで、Kaz OS、Mini、GAS、Bus API runtimeを含まない。Build IDは`v20260914-bus-p2-3-mizonokuchi-hub-v1`。

patchはHEADのindexへ`git apply --cached --check --whitespace=error-all`で適用可能、PWA対象test 9/9 PASS。Git blobどおりLFを保持したclean cloneへpatchだけを適用したRepository全体も95/95 PASSした。現在のworking tree全体はRepository 95/95、Bus 144/144、Secret scan 452 files / matches 0である。Windowsのsystem `core.autocrlf=true`でcloneすると既存`test/popio-health-ui.test.js`のLF固定検査1件だけが失敗するが、canonical LF snapshotとP2.3対象testはPASSしており、当該既存テストは今回の限定範囲外のため変更していない。

PWA source release準備は **GO**。GitHub Pages公開、公開ファイル照合、認証済み実ブラウザ、Android PWA受入はユーザー本人のpush後に行うため未確認である。

公開前baselineはBuild `v20260913-bus-p2-2-decision-hub-v1`で、公開`features/bus/config.js`と`hub.js`に溝の口駅南口／multi-Hub設定がまだないことをHTTP 200の配信ファイルで確認した。rollbackはP2.2 commit `ea63e1d8e4c46064587c5b715b71d41f833c2cc5`を基準にする。
