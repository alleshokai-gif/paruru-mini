# PALURU Bus P2.1 Deployment

作成日: 2026-09-13（Asia/Tokyo）

## 対象と公開境界

対象はCloud Run Bus APIのHub endpointと、PALURU PWAのHub Feature Gateである。既存P0 `/api/bus/arrivals`、Position UI、Public departure prediction、Mini/GAS、Observation Jobは変更しない。

- project: `paluru-bus`
- region: `asia-northeast1`
- validation service: `paluru-bus-api-validation`
- production service: `paluru-bus-api`
- production Origin: `https://alleshokai-gif.github.io`
- runtime service account: `paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com`
- Secret: `ODPT_ACCESS_TOKEN` version 1（値はbuild/image/source/logへ渡さない）

2026-09-13の読み取り確認ではactive accountとprojectは指定どおり、Secret version 1はENABLED、Artifact RegistryはDOCKERである。既存production revisionは`paluru-bus-api-00001-zsp`、validation revisionは`paluru-bus-api-validation-00001-tjq`で、両方とも既存P1 image digest `sha256:57ba8627cc156702022e1d30c4184c2237883a1f90bb87ece5776f1f0fa599cf`を参照する。production Hub endpointは現行revisionでは404 `BUS_NOT_FOUND`であり、P2.1のdeploy前状態として正しい。

## Cloud Build結果

最初のbuild `c9c4b1c8-d890-40f7-9583-13c51f008025`はFAIL。Docker buildは成功したが、runtimeがimportする`providers/kawasaki/departure.js`がDockerfileの明示COPYから漏れており、smoke containerが起動前に終了した。ローカルには同ファイルがあるためlocal testだけでは露見しなかった。Dockerfileとimage allowlist回帰testへ同ファイルと既存`hub.js`を明示し、再実行した。

再build `1d257ee9-ba01-446e-a22f-3797a3882bc8`はSUCCESS。2026-09-13 11:50:40〜11:51:22 JST、約41.8秒。image smokeでNode起動、health、localhost Origin拒否、Secret/調査script非同梱を確認した。

- image tag: `asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api:p2-1-20260913115035`
- deploy用digest: `asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:c57a042b80ed594564592f352012985afcb6aaf8721f10a50e7d2b23dfa5b99f`
- Secretはbuildへ渡していない。

## 祝日判定

判定は**A（東急Provider固有のHoliday→Sunday mappingを採用可能）**とする。ただし、ODPT一般仕様がHolidayとSundayを同義にするという意味ではない。

1. ODPT一般仕様はHolidayとSundayを別calendarとして定義する。
2. 東急の対象datasetはWeekday/Saturday/Sundayだけを返す。
3. 東急公式は国民の祝日を「休日ダイヤ」とし、公式時刻表の「休日」列を見るよう明記する。
4. 向01 a/bとも、ODPT Sunday全38便が東急公式「休日」列の全38便と一致した。Weekday 39便と平日列、Saturday 39便と土曜列も全件一致した。

内閣府公表の2026〜2027年だけを検証済み日付範囲とし、外側は非表示へfail closedにする。年末年始・お盆・臨時ダイヤは別の公式告知確認が必要で、通常曜日から推測しない。

## ローカルAcceptance

- Hub API: 登戸、溝の口、梶が谷、向ヶ丘遊園の4方面を各3便でPASS。
- 東急: a/b各3便、`static_only`、estimated/eta/delayはnull、Position unsupported。
- 東急→溝の口: config/responseとも0件。
- 曜日: 2026-09-14平日、09-19土曜、09-20日曜、09-21祝日でPASS。
- ブラウザ: 4方面各3便、取得日時・attribution表示、390px幅で横overflowなし。
- 更新: 31.5秒後にrequest増加、別画面中31.5秒は不変、復帰1.2秒で即時refresh。
- Position UI OFF、Public departure prediction OFF。
- Bus 129/129、Repository 92/92、Secret scan 435対象・一致0。
- Static preflight 3,134,559 bytes。runtime bundle 3,329,851 bytes（gzip 166,520）、36 modules、full GTFS parser/ZIP downloaderなし。
- Cloud Build context 64 files / 4,735,028 bytes。`.dev.vars`、`.local`、testsを含まず、Tokyu runtime 4 filesを含む。

## Cloud Buildとvalidation deploy

Cloud Buildは上記digestまで完了した。リポジトリ規則により、以下のCloud Run deployはユーザー本人が実行する。Docker Desktopは不要である。送信済みcontextは`.gcloudignore`のallowlistで制限し、`.dev.vars`、`.local`、tests、調査取得物を含めていない。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
$image = 'asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:c57a042b80ed594564592f352012985afcb6aaf8721f10a50e7d2b23dfa5b99f'
& .\.local\gcloud.ps1 run deploy paluru-bus-api-validation --image=$image --region=asia-northeast1 --project=paluru-bus --service-account=paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com --set-env-vars="NODE_ENV=production,ALLOWED_ORIGINS=https://alleshokai-gif.github.io" --set-secrets="ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:1" --execution-environment=gen2 --cpu=1 --memory=512Mi --concurrency=8 --timeout=30 --min-instances=0 --max-instances=1 --no-allow-unauthenticated
```

validationはprivateのまま受け入れる。別ターミナルでproxyを起動する。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
& .\.local\gcloud.ps1 run services proxy paluru-bus-api-validation --region=asia-northeast1 --port=8091
```

元のターミナルでread-only acceptanceを実行する。

```powershell
$env:BUS_REMOTE_URL='http://127.0.0.1:8091'
npm run test:hub:remote
Remove-Item Env:BUS_REMOTE_URL
```

`P2_1_REMOTE_PASS`、P0 4方向×3便、Hub 4方面×3便、Tokyu Static 6便、CORS、Secret非露出を確認する。Cloud Loggingのseverity ERROR以上とrevision startup logも確認し、validationがPASSするまでproductionへ進めない。

## production deployと受入

validationと同じ`$image`をproductionへdeployする。既存runtime設定を明示して維持する。

```powershell
& .\.local\gcloud.ps1 run deploy paluru-bus-api --image=$image --region=asia-northeast1 --project=paluru-bus --service-account=paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com --set-env-vars="NODE_ENV=production,ALLOWED_ORIGINS=https://alleshokai-gif.github.io" --set-secrets="ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:1" --execution-environment=gen2 --cpu=1 --memory=512Mi --concurrency=8 --timeout=30 --min-instances=0 --max-instances=1 --allow-unauthenticated
$env:BUS_REMOTE_URL='https://paluru-bus-api-jwnmkrlyha-an.a.run.app'
npm run test:hub:remote
Remove-Item Env:BUS_REMOTE_URL
```

最初のrequestはscale-to-zero後でなければcold startの証拠にしない。acceptance scriptの各request elapsed/bytesと、Cloud Loggingの`bus_startup`、`bus_request`にあるstartupMs、ODPT fetch、join、total、rssBytesを保存し、重大error 0件を確認する。

## PWA Gate ON

production API受入後だけ、次の限定差分を適用する。

1. `index.html`: `hub.css`、`#busHubMount`、`hub.js`を既存Bus画面へ追加。
2. `features/bus/config.js`: `PALURU_BUS_HUB_UI_ENABLED=true`。
3. `sw.js`: Hub JS/CSSをapp-shellへ追加し、`/api/bus/hub`もno-storeにする。
4. `build.js`と既存のbuild固定test: 新しいP2.1 Build IDへ更新。
5. Hub UI/Repository/Bus/Secret scanを再実行する。

main pushによるGitHub Pages公開はユーザー本人が行う。公開後は認証済みPALURUでBusメニュー、4方面×3便、a/b、Static-only表示、30秒更新、画面離脱停止、復帰refresh、stale/fallback、横overflow、他機能を確認する。Android実機は別の受入結果として記録し、未実施なら未確認とする。

## rollback

Cloud Run異常時は、更新前に保存したproduction revisionへtrafficを戻す。現在の受入済みrollback候補は`paluru-bus-api-00001-zsp`である。

```powershell
& .\.local\gcloud.ps1 run services update-traffic paluru-bus-api --to-revisions=paluru-bus-api-00001-zsp=100 --region=asia-northeast1 --project=paluru-bus
```

PWA異常時はHub Gate/asset追加/Build IDのP2.1差分だけをrevertする。既存P0 Cloud Run URLは維持し、未運用のCloudflare Workerへ戻さない。Secret version、image、旧revisionは受入終了まで削除しない。

## 現在の判定

- Holiday/calendar: GO。
- P2.1 local API/UI: GO。
- Cloud Build: SUCCESS。
- validation `paluru-bus-api-validation-00002-g67`: remote acceptance PASS。
- production `paluru-bus-api-00002-thc`: remote acceptance PASS。4方向各3便、Hub 4方面各3便、Tokyu Static 6便、a/b、CORS、Secret非露出を確認した。
- production Cloud Logging: 当該revisionのERROR以上0件。起動269.8ms、warm Hub server elapsed 8.3〜11.5ms、client elapsed 28.9〜31.2ms、観測RSS最大約110.5MB。
- Provider障害分離: productionへ故障注入口は設けず、同じbuild sourceのintegration testでKawasaki/Tokyuを個別に失敗させ、残存Providerが返ることを確認した。
- PWA source: Hub mount/JS/CSS、Gate ON、lifecycle、Service Worker no-store/assets、Build `v20260913-bus-p2-1-hub-v1`まで反映。Repository 93/93、Bus 129/129、Secret scan 435対象・一致0。
- Web公開/Android: ユーザーによるPages更新と実機受入待ち。

よって、API本番化とPWA sourceはGO。Web公開・実ブラウザ・Android受入が残るため、P2.1全体は**途中**である。
