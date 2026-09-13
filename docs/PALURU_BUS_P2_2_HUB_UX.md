# PALURU Bus P2.2 Hub UX

## 実装前記録

- 問題: 神木本町の便が事業者・行先ごとの4カードに分かれ、同じ移動判断に使う登戸駅行きと向ヶ丘遊園駅南口行きを比較しにくい。P0カードとの重複もある。またP2.1 Hub UIはNormalized Arrivalの`delayMinutes`を表示しておらず、P0の遅延表示から回帰していた。
- 確認した原因: Kawasaki Provider、Normalized Model、Hub Aggregator、Public Hub APIの各境界は`delayMinutes`を保持する。欠落は`features/bus/hub.js`の表示変換だけにあった。
- 修正方針: Hub configへProviderより上位の`decisionGroups`を導入し、神木本町を3つの利用判断へ再編する。通常RealtimeだけP0と同じ分単位の遅延文言を表示し、Static-only、stale、発車待ち系stateでは品質・state表示を優先する。
- 影響範囲: Hub config/Aggregator/Ranking、Hub UI/CSS、P0表示Feature Gate、local Hub検証、関連testと文書。P0 API、Provider取得、Position、Public departure prediction、Mini/GASは変更しない。
- 副作用: Public Hub DTOの正本配列名を`decisionGroups`へ変更する。移行中のクライアント用に同じ配列の`groups` aliasを残す。各groupのAPI出力は表示上限3便に限定する。
- ロールバック: P2.2のHub config/Aggregator/UI差分とBuild IDをP2.1へ戻し、`PALURU_BUS_LEGACY_UI_ENABLED`を従来状態へ戻す。データ移行はない。

## Decision Group

`decisionGroup`は会社や物理乗り場ではなく、利用者が今どの便に乗るかを比較する単位である。`platform`は便の属性として保持し、group keyには使わない。

|ID|表示|Provider source|
|---|---|---|
|`kibukihoncho_north`|登戸・向ヶ丘遊園方面|Kawasaki `home_to_noborito`、Tokyu `kibukihoncho_to_mukougaoka`|
|`kibukihoncho_mizonokuchi`|溝の口方面|Kawasaki `home_to_mizonokuchi`|
|`kibukihoncho_kajigaya`|梶が谷方面|Tokyu `kibukihoncho_to_kajigaya`|

東急→溝の口は正規routeが未確定なので設定しない。各groupは`hubId`、`destinations`、`providers`、`displayLimit`を持つ。Source bindingは`provider + sourceId + decisionGroupId`で行い、Provider内部で最終UI groupを決めない。

## Hub API契約

```json
{
  "hubId": "kibukihoncho",
  "hubLabel": "神木本町",
  "decisionGroups": [
    {
      "id": "kibukihoncho_north",
      "hubId": "kibukihoncho",
      "label": "登戸・向ヶ丘遊園方面",
      "destinations": ["登戸駅", "向ヶ丘遊園駅南口"],
      "providers": ["kawasaki", "tokyu"],
      "recommendedArrivalId": null,
      "arrivals": []
    }
  ]
}
```

`arrivals[].delayMinutes`はKawasaki Realtimeで数値またはnullを保持する。Tokyu `static_only`ではnullであり、Static値を遅延として補完しない。`groups`はP2.1互換aliasで、新規UIは`decisionGroups`を読む。

## Rankingと表示品質

便ごとの比較時刻は`effectiveDeparture`、Realtime ETA、`estimatedDeparture`、`scheduledDeparture`の順で選ぶ。選んだ時刻で同じdecision group内を並べる。`departure_uncertain`、`do_not_recommend`、明示的low confidenceは順位を下げ、`cancelled/departed`は除外する。Positionは順位に使わない。

`static_only`も時刻順の比較対象には含めるが、「時刻表のみ」を必ず表示する。Realtimeと同じ精度であることを示す表示はしない。最初のrecommendable便に「最速候補」を表示する。

## 遅延表示

|条件|表示|
|---|---|
|fresh Realtime、`delayMinutes > 0`|`+N分遅れ`|
|fresh Realtime、`delayMinutes = 0`|表示なし|
|fresh Realtime、`delayMinutes < 0`|P0と同じ`N分早い予測`|
|`static_only` / `static_fallback`|遅延表示なし|
|`stale` / `realtime_stale`|state表示を優先し、遅延表示なし|
|`departure_pending` / `departure_overdue` / `departure_uncertain` / `unknown`|発車状態表示を優先し、遅延表示なし|

秒単位値はUIへ出さない。Hub APIで非数値の`delayMinutes`を受けた場合はfail closedとする。

## P0表示とFeature Gate

Busトップは`PALURU_BUS_HUB_UI_ENABLED=true`、`PALURU_BUS_LEGACY_UI_ENABLED=false`を標準とする。固定4方向P0 componentとAPIは削除せず、Legacy Gateを明示的にtrueへ切り替えたときだけ比較表示できる。Position UIとPublic departure predictionはOFFのまま。

## ローカル受入項目

- 神木本町に3 decision groupだけが表示される。
- 登戸駅と向ヶ丘遊園駅南口が同じgroup契約に入り、各便の事業者・系統・行先・乗り場を確認できる。
- Kawasaki Realtimeの正の遅延は`+N分遅れ`、Tokyu Static-onlyは遅延なし。
- stale / 発車待ち系stateでは遅延よりstate文言を優先する。
- Provider片側障害でも他方を残す。
- 390px viewportで横overflowがない。
- P0/P1、Position Gate、Public departure prediction、Secret scanに回帰がない。

本番deploy、GitHub Pages更新、Android実機受入はこのローカルフェーズに含めない。

## 2026-09-13 ローカル検証結果

- Hub model/API test: Kawasaki Realtimeの`delayMinutes=7`をdecision groupとtop-level arrivalsの両方で保持。Tokyu Static-onlyはnull。
- Hub UI test: 正の遅延は`+N分遅れ`、0分は空、`static_only`、`stale`、`realtime_stale`、`departure_pending`は遅延を表示せず既存state文言を優先。
- 実ODPT local integration: P0 4方向、3 decision group各3便。北方面はTokyu StaticとKawasaki Realtimeが同じgroupに混在。溝の口はKawasaki、梶が谷はTokyu Static-only。東急→溝の口0件、Position UI OFF、Secret非露出。
- 実ブラウザ390x844: 3 group各3便、事業者・系統・行先・乗り場、Kawasaki遅延、Tokyu時刻表のみを確認。viewport 390px時のdocument/body幅は375/375px、row overflow 0、main overflowなし、Static行のdelay要素0件。30秒後の自動更新でRealtime ETA/遅延値の更新も確認。
- Repository: 94/94 PASS。
- Bus: 130/130 PASS。最初のsandbox内実行でesbuildの親directory readが4件拒否されたため、同じsuiteを許可済み制限外で再実行して全件PASSを確認。
- Secret scan: 436 files、match 0。

P2.2のArchitecture、local API、local UIはGO。production Cloud Run、GitHub Pages、Android PWAには未反映のため、本番化は未判定である。

## 2026-09-13 Cloud Run validation受入

- Cloud Build `8287ee8b-ddcd-4ce9-bf36-4b8262c4834d` はSUCCESS。validation revision `paluru-bus-api-validation-00003-gh2` がimage digest `sha256:3949a6384ad474a10a741dffae2cfaadec6bd06456ce6b1a42d3c32a35d2059d`を参照し、traffic 100%でReadyであることを確認した。
- validation serviceはIAM認証のまま保持し、認証proxy経由で受入した。`/health`、`/api/bus/arrivals`、`/api/bus/hub?id=kibukihoncho`はHTTP 200。P0は4方向各3便、Hubは3 decision group各3便だった。
- 北方面はKawasaki RealtimeとTokyu Static-onlyが混在。観測時のHub 9便はKawasaki 4便、Tokyu 5便で、Kawasaki 4便すべてが数値の`delayMinutes`を保持し、正の遅延例は1〜3分だった。Tokyu 5便は`static_only`で、`delayMinutes`、Realtime予測時刻、Realtime ETAはすべてnull。東急→溝の口は0件だった。
- Public responseに生lat/lonはなく、`position.supported=true`は0件、非nullの`effectiveDeparture`は0件だった。Position UIとPublic departure predictionはOFFを維持している。
- CORSは`https://alleshokai-gif.github.io`を許可し、非許可OriginはHTTP 403かつ`Access-Control-Allow-Origin`なし。API応答のSecret識別子・値の非露出も確認した。
- `stale` / departure state優先表示とProvider障害分離は、同じP2.2 sourceの合成testでPASS済み。稼働serviceへ故障を注入するremote試験は行っていない。
- Cloud Loggingで当該revisionのERROR以上は0件。起動時は`startupMs=220.8`、Static読込`160.8ms`、Position index読込`47.8ms`、RSS約105MB。cache missのP0 requestはODPT fetch `55.8ms`、RT decode `13.7ms`、JOIN `10.2ms`、server total `82.2ms`。cache hitのHub requestはJOIN `4.2〜7.2ms`、server total `4.8〜8.0ms`。認証proxyを含むclient実測はhealth `234.9ms`、P0 `103.4ms`、Hub初回 `140.6ms`、Hub再取得 `24.5〜29.1ms`だった。

Cloud Run validation受入はGO。本番service、PWA、GitHub Pages、Android PWAは未更新であり、全体の本番化は途中である。

## 2026-09-13 Cloud Run本番受入

- production revision `paluru-bus-api-00003-2kk`がvalidationと同じimage digestを参照し、traffic 100%でReady。CPU 1、memory 512MiB、concurrency 8、runtime service account、Secret version 1参照、production Origin設定もvalidationと一致した。
- 公開URLでhealth、P0、Hubを受入し、P0 4方向各3便、Hub 3 decision group各3便を確認した。北方面はKawasaki RealtimeとTokyu Static-onlyが同じgroupへ入り、実観測例では20:26 Tokyu、20:35 Kawasaki、20:55 Tokyuの時刻順になった。
- 川崎Realtimeで正の`delayMinutes`をAPIが保持し、観測例は1〜4分。Tokyuは6件すべて`static_only`で、`delayMinutes`、Realtime予測時刻、Realtime ETAはnull。東急→溝の口は0件だった。
- 上位3便は実時刻順で変動するため、別の観測時点では北方面がTokyu 3便になった。groupのProvider契約は常にKawasaki/Tokyuであり、表示行へ固定比率を設けないP2.2 rankingどおりである。
- CORSはproduction Originを許可し、非許可OriginはHTTP 403かつ許可headerなし。生GPS、Secret、非nullのPublic `effectiveDeparture`はレスポンスへ出ておらず、Position/Public departure predictionはOFF。
- Cloud Loggingで当該revisionのERROR以上は0件。起動時は`startupMs=316.4`、Static読込`224.9ms`、Position index読込`72.1ms`、RSS約104MB。cache missはODPT fetch `71.7ms`、RT decode `18.7ms`、JOIN `14.7ms`、server total `109.9ms`。cache hitのHubはJOIN `9.9〜10.5ms`、server total `11.4〜12.0ms`。公開client実測はhealth `148.2ms`、P0 `158.8ms`、Hub初回 `206.3ms`、Hub再取得 `32.8〜63.5ms`だった。
- 本番API受入後の回帰はRepository 94/94、Bus 130/130、Hub/UI 15/15、Secret scan 436 files / 0 matches。Bus suiteの最初のsandbox内実行でesbuildの親directory readだけが4件拒否されたため、同一suiteを許可済み制限外で再実行して130/130を確認した。

Cloud Run本番APIはGO。PWA sourceはP2.2設定済みだが、GitHub Pages公開とAndroid実機受入は未実施である。
