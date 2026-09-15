# PALURU Bus P2.4 立川・昭和第一学園 Hub PoC

## 1. 問題と方針

利用者は「何番乗り場か」ではなく、「昭和第一学園方面へ一番早く行ける便」「立川駅へ一番早く戻れる便」を選びたい。そこで既存 P2 Hub の `decisionGroup` を再利用し、乗り場・停留所が異なる便を同じ判断単位へ集約する。

- 既存神木本町 Hub、溝の口駅南口 Hub、P0 API は変更しない。
- Provider は Normalized Arrival を返し、Hub Aggregator は西武固有仕様を知らない。
- 乗り場は ranking の分割キーにせず、各便の必須表示属性とする。
- 昭和第一学園と昭和第一学園西門は同じ判断グループへ入れるが、便ごとの乗車停留所名は明示する。
- Position UI と Public departure prediction は OFF のまま。
- Production の Hub 一覧は変更せず、追加2 Hub はローカル受入 harness だけで表示する。

## 2. Hub config

### 立川駅北口 Hub

```json
{
  "id": "tachikawa-ekikitaguchi",
  "label": "立川駅北口",
  "decisionGroups": [
    {
      "id": "tachikawa_showa_daiichi_gakuen",
      "label": "昭和第一学園方面",
      "providers": ["seibu"],
      "destinations": ["昭和第一学園", "昭和第一学園西門"],
      "displayLimit": 3
    }
  ]
}
```

source `tachikawa_to_showa_daiichi_gakuen` は、GTFS stop 列上で立川駅北口から昭和第一学園または昭和第一学園西門へ到達する対象便だけを返す。6・7・8・9番乗り場を同じ decision group で順位付けする。

### 昭和第一学園 Hub

```json
{
  "id": "showa-daiichi-gakuen",
  "label": "昭和第一学園",
  "decisionGroups": [
    {
      "id": "showa_daiichi_gakuen_tachikawa",
      "label": "立川駅方面",
      "providers": ["seibu"],
      "destinations": ["立川駅北口"],
      "displayLimit": 3
    }
  ]
}
```

source `showa_daiichi_gakuen_to_tachikawa` は、昭和第一学園 `70191-02` と昭和第一学園西門 `70181-02-15` の双方から立川駅北口着 `70131-15` へ向かう便を同じ decision group へ統合する。

## 3. データフロー

```text
ODPT Seibu Static GTFS
  -> build-seibu-p2-4-static.js
  -> generated/seibu-p2-4-static.json
  -> Seibu Provider

ODPT Seibu TripUpdates + VehiclePosition
  -> Seibu Provider cache / decode / Static JOIN
  -> Normalized Arrival[]
  -> Hub Service
  -> provider-independent Aggregator / Ranking
  -> GET /api/bus/hub?id=...
```

生成 artifact は runtime 起動時に一度だけ読む。リクエスト時に GTFS ZIP の download・展開・全件 parse は行わない。artifact は 372,176 bytes、対象 trip は立川発 657件・学校発 654件、route 13件、stop 10件だった。

更新コマンド:

```text
cd bus
npm run build:seibu
```

生成処理は2方向、route、stop、stop_sequence、scheduled time、運行 calendar を検証してから一時ファイルを rename する。異常時に現在の artifact を途中書きで壊さない。

## 4. Normalized Arrival

```json
{
  "provider": "seibu",
  "routeId": "301002",
  "routeLabel": "立３７",
  "destination": "イオンモールむさし村山",
  "originStop": { "id": "70131-05-09", "name": "立川駅北口" },
  "scheduledDeparture": 1789351020,
  "estimatedDeparture": null,
  "etaMinutes": null,
  "delayMinutes": null,
  "platform": "6番",
  "realtimeState": "static_fallback",
  "position": { "supported": false }
}
```

時刻は API 内部で epoch seconds、UI で Asia/Tokyo の `HH:mm` へ変換する。RT event が一意に結合できた便だけ `estimatedDeparture`、`etaMinutes`、`delayMinutes` を返す。Static-only/fallback を ETA として扱わない。

## 5. Ranking

既存 P2.3 契約をそのまま使う。

1. recommendable な便だけを最速候補の対象にする。
2. `effectiveDeparture` があれば優先する。Public departure prediction は OFF なので現状は null。
3. 新鮮な Realtime ETA / estimatedDeparture を優先し、なければ scheduledDeparture を時刻順の補助に使う。
4. `static_fallback`、stale、low confidence、`departure_uncertain`、`do_not_recommend` へ最速候補を付けない。
5. 乗り場は順位グループを分けず、6〜9番を横断比較する。

## 6. 障害分離

- Seibu Provider が失敗しても、神木本町・溝の口駅南口の既存 Kawasaki/Tokyu Hub は残る。
- 西武 Hub は success response 内で provider を `unavailable` とし、arrival を空にできる。
- RT だけが失敗した場合は Static 有効範囲内の便を `static_fallback` で返す。
- Static artifact 欠損・期限外・schema 不一致は fail closed とし、古い便を黙って表示しない。
- Public response に API token、生 vehicle ID、生 lat/lon、元 feed 全文を含めない。

## 7. ローカル API 実データ結果

2026-09-14 JST の観測例。時刻で内容が変わるため、以下はデータ契約の証拠であり固定 fixture ではない。

### `GET /api/bus/hub?id=tachikawa-ekikitaguchi`

- HTTP 200 / success true
- decision group: 1
- 上位3便で6・7・8番が混在する観測を確認。別観測では9番も上位3便に入った。
- 例: 立37 6番、立38 8番、立34 7番
- RT対象 event がない便は `static_fallback`、ETA/delay null、最速候補なし

### `GET /api/bus/hub?id=showa-daiichi-gakuen`

- HTTP 200 / success true
- decision group: 1
- 昭和第一学園本停留所と西門の便を同じグループに混在
- 実観測例: 立34 本停留所 `etaMinutes=2`・`delayMinutes=1`、立32 西門 `etaMinutes=3`、立35 本停留所 `etaMinutes=4`・`delayMinutes=6`
- Realtime 便だけが推薦候補になり、Position は全便 OFF

## 8. ローカル UI 受入

実ブラウザの実 API モードで次を確認した。

| 項目 | 結果 |
| --- | --- |
| 「いつもの場所」に既存2 Hub + 立川駅北口 + 昭和第一学園 | PASS |
| 立川駅北口「昭和第一学園方面」1グループ | PASS |
| 昭和第一学園「立川駅方面」1グループ | PASS |
| 各グループ3便 | PASS |
| 西武バス、系統、行先、乗り場または乗車停留所名 | PASS |
| Realtime ETA / 分単位遅延 | PASS |
| Static fallback を Realtime と誤表示しない | PASS |
| 390px harness の main clientWidth/scrollWidth | 390 / 390 |
| row/group の横 overflow | なし |
| 30秒更新 | 初回4 Hub取得後、次周期で4件増加 |
| 別画面中の停止 | 34秒間 28回のまま |
| Bus復帰時の即refresh | 復帰直後 28回→32回 |

この受入 harness は PALURU 認証の代替ではない。Android 実機、本番 PWA、Cloud Run remote は未確認。

## 9. 変更範囲とロールバック

### Provider / build

- `bus/providers/seibu/config.js`
- `bus/providers/seibu/attribution.js`
- `bus/providers/seibu/static-source.js`
- `bus/providers/seibu/static-build.js`
- `bus/providers/seibu/realtime.js`
- `bus/providers/seibu/provider.js`
- `bus/scripts/build-seibu-p2-4-static.js`
- `bus/generated/seibu-p2-4-static.json`（生成物、Git管理外）

### Hub / runtime / local UI

- `bus/hub/config.js`
- `bus/runtime/start.js`
- `bus/scripts/local-run.js`
- `bus/scripts/local-ui.js`
- `features/bus/hub.js`

### Packaging / tests

- `bus/package.json`
- `bus/Dockerfile`
- `bus/.dockerignore`
- `bus/.gcloudignore`
- `bus/test/seibu.test.js`
- `bus/test/hub.test.js`
- `bus/test/browser.html`
- `test/bus-hub-ui.test.js`

P2.4 の変更だけを戻す場合は、Seibu provider loader と2 Hub config、local-only Hub list、西武 UI label、package/build対象を外し、生成 artifact を再生成しない。既存 Kawasaki/Tokyu provider、P2.3 Hub、P0 UIへ影響を与えない。

## 10. Acceptance と判定

| Acceptance | 状態 |
| --- | --- |
| 西武の正規データ経路 | PASS |
| 正式 stop / route / platform | PASS |
| 立川発6〜9番を1 decision group | PASS |
| 学校・西門発を1 decision group | PASS |
| Static + RT Normalize | PASS |
| Provider 障害分離 | 合成テスト PASS |
| 390px overflow | 実ブラウザ PASS |
| 神木本町・溝の口 Hub 回帰 | 実ブラウザ PASS |
| Position UI OFF | PASS |
| Public departure prediction OFF | PASS |
| Bus tests | 153/153 PASS |
| Repository tests | 96/96 PASS |
| P0 Static preflight | 4方向 PASS |
| Bundle | 3,329,984 bytes、gzip 166,546 bytes、full Static parserなし |
| Synthetic integration | Realtime / upstream failure とも4方向×3便、CORS PASS |
| Secret 非露出 | 472 files、matches 0 |
| Browser console | error / warn 0件 |
| Android / 本番 PWA / Cloud Run | 未実施 |

**P2.4 ローカル PoC は GO**。本番 deploy は今回の範囲外であり、remote Acceptance と実機確認まで未完了とする。

## 11. 本番化フェーズの準備状況

2026-09-14 JST に最終sourceから Cloud Build を再実行し、build `d3c20eae-4aed-47e5-8e66-ea58d9906868` は44秒で SUCCESS となった。validation候補は `asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:6296f5ff853c7462cb43c639859d72d49e79f07aa52f5bba8638895555d7e7f3` に固定する。buildには実運用Secretを渡さず、image smoke test専用のsynthetic値だけを一時container環境へ設定した。image内に `.dev.vars`、開発script、Static parser依存がないことと `/health` をbuild内で確認した。

remote Acceptance は次を検証する。

- `/health` と P0 4方向×3便
- 神木本町3 group、溝の口駅南口1 groupの回帰
- 立川駅北口「昭和第一学園方面」3便
- 昭和第一学園「立川駅方面」3便
- 立川便のplatformが6・7・8・9番の正式集合内であること
- Realtime便のestimated / ETA / delayと、Static fallback便のnull境界
- uncertain / stale / static fallbackを最速候補にしないこと
- Position非公開、Public実発車予測OFF、生GPS・Secret非露出
- 本番OriginのCORS許可と未許可OriginへのCORS header非付与
- Cloud Logging ERROR以上0、応答時間、response size

上位3便へ全乗り場が同時に出るとは限らないため、6・7・8・9番の網羅性はStatic artifact検証で確認し、remote APIでは返却便が正式集合内にあることと同一decision groupで順位付けされることを確認する。

Cloud Run validation / production deploy、PWA Hub一覧の更新、公開Webアプリ更新、Android実機受入は未実施である。validation PASS前にPWAへ立川・学校Hubを追加しない。

## 12. Validation remote Acceptance

2026-09-14 JST、revision `paluru-bus-api-validation-00005-szn` が、build済みdigest `sha256:6296f5ff853c7462cb43c639859d72d49e79f07aa52f5bba8638895555d7e7f3` を使用していることを確認した。Secretは既存 `ODPT_ACCESS_TOKEN` のSecret参照であり、値は取得・出力していない。`NODE_ENV=production` の既定CORSは `https://alleshokai-gif.github.io` のみを許可する。

| Remote Acceptance | 結果 |
| --- | --- |
| `/health` | HTTP 200 / PASS |
| P0 | 4方向×3便 PASS |
| 神木本町 | 3 decision groups×3便 PASS |
| 溝の口駅南口 | 1 decision group×3便 PASS |
| 立川駅北口 | 1 decision group×3便 PASS |
| 昭和第一学園 | 1 decision group×3便 PASS |
| 立川platform | 上位3便で6・7・9番を観測。8番を含む正式4乗り場の抽出・横断順位付けはStatic/合成試験 PASS |
| 学校停留所統合 | `70191-02` と西門 `70181-02-15` を同じgroupで観測 |
| 西武品質 | Realtime 3便、Static fallback 3便を同時観測 |
| delay | Realtime 3便で非0 `delayMinutes` を保持。fallbackはnull |
| Position / Public departure prediction | OFF / OFF |
| CORS | 本番Origin 200＋許可header、未許可Origin 403＋許可headerなし |
| Secret / 生GPS | response非露出 PASS |
| Cloud Logging | 対象revision、直近2時間、ERROR以上0件 |

Cloud Run内の `bus_request` 34件では、200が31件、意図したCORS拒否403が3件だった。`elapsedMs` はmin 0.6 / p50 12.3 / p90 74.4 / max 240.7 ms、最大RSSは123.4 MiB。21件の処理stageでは `totalMs` p50 12.3 / max 238.8、JOIN p50 10.4 / max 90.0、RT decode p50 9.4 / max 58.8 ms。外部ODPT取得を行った3件は39.1〜84.3 msだった。これはvalidation受入時のwarm中心の測定であり、Android体感や継続負荷を保証する値ではない。

Provider障害分離は、remoteで障害を注入する管理endpointを持たないため、本番相当APIへ故意の障害は起こしていない。Seibu RT欠損時にStatic fallbackを返してHubを維持する実観測と、Provider全体失敗時にも他Providerを残す合成テストの双方で確認した。

**Validation判定:** PASS。本番候補digestは固定済み。本番Cloud Run更新後に同じremote Acceptanceを再実行するまで、PWA追加とWebアプリ更新は未実施のまま維持する。

## 13. Production remote Acceptance と PWA限定差分

2026-09-14 JST、production revision `paluru-bus-api-00005-n29` がvalidationと同じdigestを使用し、traffic 100%であることを確認した。本番Secretは既存Secret参照のままで、値は取得・出力していない。

| 本番確認 | 結果 |
| --- | --- |
| `/health` / P0 | HTTP 200 / 4方向×3便 PASS |
| 既存Hub | 神木本町3 group、溝の口駅南口1 group、各3便 PASS |
| P2.4 Hub | 立川駅北口、昭和第一学園とも1 group×3便 PASS |
| 立川platform | 上位3便で6・7番を観測。6〜9番の正式集合・横断RankingはStatic/合成試験 PASS |
| 学校停留所統合 | 本停留所 `70191-02` と西門 `70181-02-15` を同一responseで観測 |
| 西武品質 | Realtime 2便、Static fallback 4便 |
| delay | Realtime 2便で非0 `delayMinutes` を保持。fallbackはnull |
| Provider障害分離 | RT欠損時fallback実観測＋Provider全体失敗の合成試験 PASS |
| CORS | 本番Origin 200＋許可header、未許可Origin 403＋許可headerなし |
| Secret / 生GPS | response非露出 PASS |
| Cloud Logging | 対象revision、直近2時間、ERROR以上0件 |
| Position / Public departure prediction | OFF / OFF |

本番revisionの `bus_request` 12件は200が11件、意図したCORS拒否403が1件。`elapsedMs` はmin 0.5 / p50 8.8 / p90 86.1 / max 212.7 ms、最大RSSは111.1 MiB。7件の処理stageでは `totalMs` p50 8.1 / max 98.8、JOIN p50 6.9 / max 14.4 ms。1回発生した外部ODPT取得は55.9 ms、RT decodeは23.7 msだった。

本番API PASS後にPWA公開設定へ `tachikawa-ekikitaguchi` と `showa-daiichi-gakuen` を追加した。必要な既存Seibu表示差分は `features/bus/hub.js` のProvider名、情報品質ラベル、乗車停留所名fallbackである。Service Workerは既に `features/bus/config.js` と `features/bus/hub.js` をversion付きnetwork-first対象にしているため、asset一覧やcache戦略は変更せず、Build IDを `v20260914-bus-p2-4-tachikawa-hub-v1` へ更新した。

390px固定幅のローカル実ブラウザでは、main clientWidth/scrollWidthは390/390、Hub/decision group/rowのoverflowは0。4 Hubは `[3,3,3] / [3] / [3] / [3]` 便で表示された。30秒polling後にAPI取得が4件増え、別画面中32秒は20回のまま、Bus復帰直後に20→24回となった。ブラウザconsole error/warnは0件。

PWA限定差分後はRepository 97/97、Bus 153/153、対象UI 18/18、Secret scan 478 files / matches 0。公開Webアプリ更新とAndroid実機受入はユーザー操作後まで未確認である。
