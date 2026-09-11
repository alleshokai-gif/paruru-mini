# PALURU Bus P0 deploy準備

## P1 Architectureのローカル検証（2026-09-11）

Cloud Runを本番候補としたまま、[P1 Architecture](PALURU_BUS_P1_ARCHITECTURE.md)の内部境界へ更新。Core/ServiceはQueryとProvider contextの注入方式。Node起動ログのbuild識別は`bus-p1-architecture-v1`、PWA Build IDと公開URLは変更していない。旧Cloudflare FreeのCPU NO-GOは下記履歴のまま。

- Dockerfile/.dockerignore/.gcloudignoreにKawasakiの`config.js`、`attribution.js`、`context.js`、`position-reference.js`を明示追加。Core/Queryの新ファイルは既存allowlist内。buildへSecret・テスト・調査データを送らない。
- image同梱Staticは既存 **2,616,507 bytes**、version `20260701_20260828`、4方向660/3820/660/3716行を維持。今回再取得・再生成していない。生成器の合成GTFS/検証/失敗時旧JSON維持テストと実artifact preflightはPASS。
- Internal RT schemaは1→2。cache keyは`provider:version:schema:kind`。schema1のcacheを新モデルとして採用しない。25秒cache、4方向一括取得、single-flight/失敗backoff、30秒pollingは維持。
- 既存remote build/Secret登録/認証付き検証/rollback手順は下記を再利用。P1をbuildする場合は新しいimage tag/digestを記録し、旧image tagを再利用しない。今回はCloud Build/Run/Secret操作を実行しない。
- ローカルrollbackはP1変更対象だけをP0へ戻す。将来remote検証する場合も別validation serviceで行い、本番へのtraffic移行は別の承認・受入後。Secret値やStatic artifactはソースrollbackで削除しない。

15:02:49 JSTまでの`npm run test:run`による実測。**Windows Node＋実Static/ODPT、Cloud Run cold startやCPU時間の実測ではない。**

|項目|P1ローカル実測|
|---|---|
|process spawn → health200|310.98ms|
|起動時Static read/validate/index＋日付確認|76.88ms|
|初回HTTP cache miss|109.96ms（ODPT83.51ms、decode15.67ms、JOIN4.11ms）|
|warm cache hit|5.32 / 6.30 / 6.87ms（JOIN2.30〜4.14ms）|
|26秒後refresh|88.52ms（ODPT66.72ms、decode12.41ms、JOIN3.70ms）|
|要求内Static参照|0.0007〜0.0025ms。JSON read/parse、ZIP/CSV処理なし|
|ODPT取得回数|1 / 0 / 0 / 1 / 0|
|response size|8,084〜8,098 bytes|
|process RSS|約69.0〜85.1MiB|

全4方向HTTP200/各3便。今回の最終sampleでは神木→溝口がRT（15:02予定→15:03予測、ETA1分、delay1分など）、他3方向はStatic fallback（estimated/eta/delayはnull）。別のブラウザ取得時点では溝口→神木にもRTあり。**4方向すべてで同時に未来RTを観測したとは扱わない。** 4方向のRTと欠損は合成HTTP/既存回帰テストで別途確認した。

Cloud Run実環境の起動/応答/CPU/memory/IAM、remote image、Android、本番PWA受入は未実施。最終テスト一覧とArchitecture判定は[P1記録](PALURU_BUS_P1_ARCHITECTURE.md)を参照。

## 朝の再確認（2026-09-11）

位置調査を再開し、4方向のGPS/TUと市バスナビ参照を16回観測した。証拠は[DATA_VALIDATION](PALURU_BUS_P0_DATA_VALIDATION.md)冒頭。位置P1の自動表示は未達、Position UI OFF。本番Core/Adapter/UI設定は変更していない。調査script/要約はdeny-all方式のDocker/Cloud Build contextに含まれない。

07:12:27 JST、既存`npm run test:run`をWindows Nodeプロセス・実Static・実ODPT・production CORSで再実行PASS。以下はCloud Run実環境の測定ではない。

|項目|朝のローカル実測|
|---|---|
|process spawn → health200|434.11ms|
|起動時Static read/validate/index|63.04ms|
|初回HTTP cache miss|128.85ms（ODPT fetch93.27ms、decode22.87ms、JOIN5.47ms）|
|warm cache hit|7.63 / 6.74 / 6.73ms（JOIN3.78〜4.32ms）|
|26秒後refresh|106.33ms（ODPT fetch79.45ms、decode18.16ms、JOIN4.24ms）|
|リクエスト内Static参照|0.0007〜0.0024ms、ZIP/CSVの処理なし|
|ODPT取得回数|1 / 0 / 0 / 1 / 0|
|response size|8,114〜8,118 bytes|
|process RSS|約70.7〜92.5MiB|

4方向×3便・HTTP200。神木→登戸は3便RT、神木→溝口はRT/欠損混在、登戸→神木は3便Static fallback、溝口→神木はRT/欠損混在。例：神木→登戸07:09予定便はestimated表示07:12、ETA1分、delayMinutes4（秒の遅延を60で割って四捨五入する既存処理で、HH:mm同士の引算とは別）。登戸発の未来RTを今回も全便確認したとは扱わない。CORSのlocalhost拒否、health、秘密ファイル404、過去ETA抑止、位置OFF、取得エラーなしを確認。

Bus tests28/28、Repository84/84 PASS。Busの初回2件はsandboxによるesbuild親ディレクトリ読取拒否で失敗、同一試験を通常権限で再実行してPASS。新規調査scriptの構文確認PASS、秘密scan321対象・一致0。Android/PWA本番受入は未実施。

gcloudはPATH/標準配置で再確認しても未検出。SDK導入やログイン、本番Secret登録、remote build/Cloud Run作成を行っていない。準備状況は下記runbookどおりで、次のGoogle Cloud作業はユーザーによるSDK導入・専用configurationのログインとproject照合。Cloud Buildによるremote buildを優先し、ローカルDocker復旧を前提にしない。**本番deploy判断は引き続き保留。**

## Cloud Run移行準備（2026-09-10）

**現行候補はCloud Run。設計・Node HTTP・build構成の準備はローカル確認済み。本番deploy判断は保留。** Cloud Build実行、コンテナ実行、Cloud Run作成、Secret登録、PWA公開URL変更は今回行っていない。Docker Desktopの復旧/起動を前提にしない。下のCloudflare手順は初期方式の履歴で、本番FreeはCPU超過のNO-GO。

### 対象と再利用

|設定|値・確認状態|
|---|---|
|Project / region|`paluru-bus` / `asia-northeast1`（東京）。ユーザー指定|
|課金 / API|ユーザーより課金有効、Run Admin / Cloud Build / Artifact Registry / Logging API有効との申告。CLIでの照合は未実施|
|CLI|今回のWindows PATHと標準配置でgcloudを検出できず。ログイン・project選択は未実施|
|本番候補service / 検証service|`paluru-bus-api` / `paluru-bus-api-validation`。Google Cloud内の名称重複は未確認|
|runtime|Node 24、Linux amd64、`0.0.0.0:$PORT`（既定8080）、非root user。TLSはCloud Run|
|初期リソース候補|1 CPU、512MiB、concurrency8、min0/max1、timeout30秒。request-based CPU。remote実測後に確定|
|Secret|Secret Manager `ODPT_ACCESS_TOKEN` の明示したversion → 同名env。buildには渡さない|
|CORS|productionは`https://alleshokai-gif.github.io`のみ。localhost/`*`を設定すると起動拒否。developmentのみlocalhost|
|HTTP|`GET /api/bus/arrivals`は4方向一括、queryなし。`GET /health`追加。既存PWA DTO互換|
|Position / UI|OFF。PWA polling30秒/hidden停止/復帰refreshは既存実装を再利用。PWA本番設定は未変更|

共通処理は `core/service.js` / `http/handler.js` へ移動した。`worker/service.js`は任意Cache APIをread/write形式に変換する互換層、`worker/index.js`はHTTP handlerの再export。Kawasaki RT Adapter、固定4方向、時刻Core、Normalize、欠損/過去ETA/運行日/stale判定を再利用した。CoreはCloudflare globalsに依存しない。

`runtime/start.js`はStaticを1回read/validate/pre-indexし、provider単位のserviceを1つ生成する。以後はRT取得→JOIN→DTO。StaticのZIP download/CSV parseはruntime依存グラフにない。`runtime/server.js`はNode HTTPとWHATWG HTTPの境界だけを受け持つ。

RT cache25秒、同一instance内のin-flight共有と失敗retry抑止25秒。4方向別fetchはしない。再取得失敗でも鮮度120秒内の予測は保持し、`fetchError`で失敗を別記。鮮度を過ぎたRTはETAに使わず、Staticへ戻す。Coreの`realtime_stale`と`static_fallback`も維持。複数instance/revision間でcacheは共有されず、max1も重複fetchゼロの保証ではない。

### Static・remote build

- 配置方式：生成JSONをimageへ同梱。外部KV/R2/DBなし。
- 23:19:25 JSTに公式Static build再実行PASS。ZIP7,423,362 bytesからP0 JSON **2,616,507 bytes（2.50MiB）**、8856行（660/3820/660/3716）を生成。元版`20260701_20260828`、source date20260828、生成JSON SHA256 `ddbde1d42354d5734849e550ccf9b3b803975dd62741b2c4c70c6ed45bf66b5d`。
- 元ZIP/全テーブルは保存しない。build専用処理のfetch504ms、生成5001ms。異常時は以前のJSONを保持する既存atomic publish試験PASS。
- 更新方法：公式の新版を確認 → `config/static-source.json`更新 → `npm run build:static` → test/HTTP検証 → Cloud Buildで新image → private Cloud Run受入 → 公開判断。Staticだけの更新も新revisionとして扱う。
- Dockerfileはmulti-stage、`npm ci --omit=dev --ignore-scripts`、必要なruntimeとJSONのみCOPY。`.dockerignore`と`.gcloudignore`はdeny-all＋allowlist。ローカルsecret、research scripts/要約、tests、Worker、node_modules、Git、MDはupload対象外。
- `cloudbuild.yaml`はLinux image build→synthetic値だけでコンテナ起動→`/health`とCORS、secret/build script/fflate不在のsmoke→image push。**deploy工程なし。** `.dev.vars`はbuild contextにも送らない。実際のremote build/image検査は未実行。

Cloud Runのlisten/TLS/終了規約は[公式container contract](https://docs.cloud.google.com/run/docs/container-contract)、remote buildは[Cloud Build公式手順](https://docs.cloud.google.com/build/docs/building/build-containers)を確認した。

### ローカル実測とAcceptance

Windows Node 24.14.0、実Static、正規ODPT、production CORS設定、実HTTPで23:19〜20 JSTに計測。`npm run test:run` は独立Nodeプロセス起動からhealthを確認し、APIを5回取得する。**Cloud Runやコンテナのcold start/CPU/memory実測ではない。**

|項目|ローカル実測|
|---|---|
|process spawn → health200|311.85ms|
|Static read＋validation＋index（起動時だけ）|62.94ms|
|HTTP初回cache miss|90.26ms、ODPT fetch/body72.24ms、RT decode7.30ms、JOIN4.14ms|
|warm cache hit 3件|5.36 / 6.01 / 7.65ms、JOIN2.52〜4.52ms|
|26秒後warm refresh|63.57ms、ODPT fetch/body51.89ms、decode2.30ms、JOIN4.05ms|
|各APIのStatic参照|0.0008〜0.0025ms（ファイルread/parseなし）|
|ODPT fetch回数|1 / 0 / 0 / 1 / 0|
|HTTP body|7,974〜7,978 bytes|
|process RSS|約66.1〜85.7MiB（プロセス全体、GCで変動）|

23時台のAPIは4方向とも翌日便のStatic fallback、各3便・HTTP200。先発/次便/次々便は、神木→登戸05:55/06:08/06:19、神木→溝口05:42/05:43/05:44、登戸→神木06:18/06:25/06:38、溝口→神木05:56/06:02/06:08（すべて09/11）。estimated/delay/ETAはnullで、誤って定刻RT扱いしない。RTありのNode HTTPは合成便で4方向を検証。今回の夜間local API試験だけで4方向の生RT表示を確認したとは扱わない。

|受入|結果|
|---|---|
|Repository全体|84/84 PASS（Node test runner集計。内部独自assert群を含む）|
|Bus全体|28/28 PASS。Node HTTP/health/CORS/read-only/secret欠損、provider cache分離、runtime graphを追加|
|既存Python検証器|専用`.venv`で14/14 PASS。システムPythonにはGTFS bindingsがなく、専用環境で再実行|
|Static再生成・4方向・失敗時旧JSON維持|PASS|
|Node実HTTP/4方向/25秒cache/実ODPT|PASS|
|RTあり/なし/stale/過去ETA/日付越え|合成test PASS。夜間の実APIはStatic fallback|
|Worker互換integration|RT/上流失敗の2シナリオPASS、各4方向×3便|
|秘密scan|315ファイル、実キー値の一致0（最終コード・参照要約を含む）。HTTP/計測出力への混入なし|
|ローカルChrome＋実Bus component→Node API|4方向×3便・翌日日付・欠損表示、別画面で取得1回のまま停止/復帰で2回へ即更新、その後30秒設定で取得増加を確認。合成staleでは前回更新と古い情報を表示しETA抑止、合成RTはあと7分/+3分遅れ。幅943pxで横overflowなし|
|position UI|OFF、位置DOMなし|
|build context/image内secret不在|allowlist/source検査PASS。gcloud upload一覧・実image検査は未実行|
|Cloud Build/Cloud Run起動・性能・IAM・本番URL|未実施|
|本番PWA/Android実機|未実施。今回PWA/GAS/Pages/Cloudflare本番変更なし|

API応答に性能情報/secret/ODPT生データを追加しない。NodeログはrequestId、status、size、memory、elapsedとstage計測だけ。Cloud Loggingで検索できる実ログの確認はremote受入時に行う。今回のindexは既存direction/service索引を再利用し、RT trip lookupも維持。前フェーズで観測したP0外RTの全件Normalizeは追加最適化の余地として残るが、位置調査・サーバー移行に混ぜて大改修しない。

### gcloudログイン・project準備（ユーザー実行）

以下は手順書であり、未実行。gcloudが未導入なら[公式Windowsインストーラー](https://docs.cloud.google.com/sdk/docs/install-sdk)で導入し、新しいPowerShellを開く。サービスアカウントJSON鍵やADC loginはこのNodeアプリの起動には不要。

既存gcloud設定を無断で切り替えないよう専用configurationを使う。同名configurationが既にある場合は先に内容を照合する。

```powershell
gcloud config configurations list
gcloud config configurations create paluru-bus --no-activate
gcloud auth login --configuration=paluru-bus
gcloud config set project paluru-bus --configuration=paluru-bus
gcloud config set run/region asia-northeast1 --configuration=paluru-bus
gcloud config list --configuration=paluru-bus
gcloud projects describe paluru-bus --configuration=paluru-bus
gcloud services list --enabled --configuration=paluru-bus
gcloud run services list --region=asia-northeast1 --configuration=paluru-bus
gcloud artifacts repositories list --location=asia-northeast1 --configuration=paluru-bus
gcloud builds get-default-service-account --region=asia-northeast1 --configuration=paluru-bus
```

project/account/課金をConsoleでも照合。`paluru-bus-api` / `paluru-bus-api-validation` が他用途に存在したら停止する。default Build service accountは実際のコマンド結果から確認し、メールアドレスを推測しない。Build実行者の権限に加え、実行SAのArtifact Registry書込み・Logging書込み・source bucket読取を確認し、不足分だけ対象resourceへ付与する。Owner/Editorを一律追加しない。参照：[default Build account](https://docs.cloud.google.com/sdk/gcloud/reference/builds/get-default-service-account)。

### Secretとimage repository（ユーザー実行）

Secret Manager APIは準備済み一覧に含まれないため確認し、未有効なら有効化する。以下の作成は同名resourceの不在を確認した後だけ行う。

```powershell
gcloud services enable secretmanager.googleapis.com --configuration=paluru-bus
gcloud iam service-accounts create paluru-bus-runtime --display-name="PALURU Bus runtime" --configuration=paluru-bus
gcloud artifacts repositories create paluru-bus --repository-format=docker --location=asia-northeast1 --configuration=paluru-bus
```

Google Cloud Consoleのproject `paluru-bus` → Secret Managerで`ODPT_ACCESS_TOKEN`を作成する。値は手元の`bus/.dev.vars`からユーザーが登録画面へ入力し、チャット/CLI引数/Markdownへ貼らない。前後の改行・引用符・`ODPT_ACCESS_TOKEN=`部分を値に含めない。既存secretがある場合は上書きせず、用途とversionを照合する。登録値の表示・CLI出力は行わない。

```powershell
gcloud secrets add-iam-policy-binding ODPT_ACCESS_TOKEN --member="serviceAccount:paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --configuration=paluru-bus
gcloud secrets versions list ODPT_ACCESS_TOKEN --format="table(name,state)" --configuration=paluru-bus
```

runtime SAだけに当該secretへのAccessorを付ける。Build SAへODPT secret権限を付与しない。deployするversion番号を確認し、`latest`ではなく固定番号で注入する。[Cloud Run公式Secret設定](https://docs.cloud.google.com/run/docs/configuring/services/secrets)。

### Remote build（まだ実行しない）

Repositoryの`bus/`で実行する。最新Staticを生成し、テストがPASSしてからupload一覧を確認する。`.dev.vars`、`.local`、research要約、node_modules、Gitが1つでも一覧に入る場合は中断する。

```powershell
cd C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini\bus
npm ci --ignore-scripts
npm run build:static
npm test
npm run test:run
npm run check:secrets
gcloud meta list-files-for-upload
$busImage = 'asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api:p0-run-20260910'
gcloud builds submit . --config=cloudbuild.yaml --region=asia-northeast1 --substitutions="_IMAGE=$busImage" --configuration=paluru-bus
```

各リリースで新しいtagを使う。build PASS時のimage digest、Build ID、Node version、image size、health/secret不在smoke結果を記録。smokeはODPTを呼ばず、実secretも持たない。Cloud Buildの生成image実行がローカルDocker検証の代わりになる。

### 認証付きCloud Run検証（build後・実行許可後）

新規検証serviceの不在、runtime SA、secret有効version、image digestを照合して実行。値を推測して変数に入れない。下の`REPLACE_...`は実値で置換するまでは実行不可。

```powershell
$busDigestImage = 'asia-northeast1-docker.pkg.dev/paluru-bus/paluru-bus/paluru-bus-api@sha256:REPLACE_VERIFIED_DIGEST'
$busSecretVersion = 'REPLACE_ENABLED_VERSION_NUMBER'
gcloud run deploy paluru-bus-api-validation --image=$busDigestImage --region=asia-northeast1 --platform=managed --execution-environment=gen2 --service-account=paluru-bus-runtime@paluru-bus.iam.gserviceaccount.com --cpu=1 --memory=512Mi --concurrency=8 --min-instances=0 --max-instances=1 --timeout=30s --port=8080 --no-allow-unauthenticated --set-env-vars="NODE_ENV=production,ALLOWED_ORIGINS=https://alleshokai-gif.github.io" --update-secrets="ODPT_ACCESS_TOKEN=ODPT_ACCESS_TOKEN:$busSecretVersion" --startup-probe="httpGet.path=/health,httpGet.port=8080,periodSeconds=5,timeoutSeconds=2,failureThreshold=12" --configuration=paluru-bus
gcloud run services proxy paluru-bus-api-validation --port=8789 --region=asia-northeast1 --configuration=paluru-bus
```

proxyはgcloudログインしたユーザーのIAMで認証する。ID tokenをprintして貼る必要はない。検証者に必要なInvoker権限を対象serviceにだけ付与する。[公式proxy](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/proxy)、[公式startup probe](https://docs.cloud.google.com/run/docs/configuring/healthchecks)。

別ターミナルから `http://127.0.0.1:8789/health` と `/api/bus/arrivals` を取得。APIにはOrigin `https://alleshokai-gif.github.io`を明示し、localhost Originは403のまま確認する。private serviceを公開PWAへ接続しない。通常営業時間に4方向の生RTも確認する。

Cloud Loggingの `resource.type="cloud_run_revision"` / `resource.labels.service_name="paluru-bus-api-validation"` / `jsonPayload.event="bus_request"` を使い、応答`X-Request-Id`とログ`requestId`で照合する。API本文や認証ヘッダーをログへ追加しない。

remoteで測るもの：新instance起動（health/process startupとプラットフォームcold latencyを区別）、cold API、warm hit、25秒超でのrefresh、ODPT fetch/body、decode、JOIN、response size、RSS、Cloud Run memory/latency。proxy応答時間には認証proxy往復も含む。停止/新revisionなどで確認していないrequestをcoldと断定しない。Cloudflare10ms基準は適用しない。

### 公開判定・rollback

**現時点：remote build準備GO、Cloud Run本番deployは保留（未検証）。** 次の条件が揃うまで公開しない：アカウント/名前/IAM/Secret照合、remote build＋image smoke、private Cloud Run4方向/生RT/fallback/stale/CORS/secret非混入、cold/warmの実用性能、利用者の公開判断。

公開判断後に検証済みdigestとsecret versionで本番名へdeployする。public IAM変更はその段階で明示的に実施。返却された実URLを `features/bus/config.js`へ反映するPWA変更は別の公開作業で、Build ID・SW更新経路・実ブラウザ・Androidを受け入れる。旧Worker候補URLを本番接続済みと扱わない。

rollbackは、既存本番がある場合、記録済みの直前revisionへtraffic100%を戻す（`gcloud run services update-traffic paluru-bus-api --to-revisions=PREVIOUS_REVISION=100 --region=asia-northeast1 --configuration=paluru-bus`）。imageにStaticを含むため同時に戻る。旧secret versionも受入期間中は削除しない。初回公開が成立していない場合は検証serviceをprivateのまま保持し、PWAを前の承認済み設定へ戻す。FreeでNO-GOのWorkerへ自動転送しない。今回rollback操作なし。

### この移行フェーズの変更ファイル

- `core/service.js`、`http/handler.js`：共有service/HTTP契約。
- `worker/service.js`、`worker/index.js`：既存Workerの互換接続。
- `runtime/config.js`、`metrics.js`、`server.js`、`start.js`、`static-artifact.js`：Node設定/起動/HTTP/安全な計測/Static検証。
- `scripts/p0-static.js`：Static検証を共有runtime検証へ切り出し。buildのZIP経路は維持。
- `scripts/local-run.js`、`check-run-http.js`、`package.json`：ローカル起動・実HTTP計測。
- `scripts/check-secrets.js`：旧Workerのローカルprofileが存在する時だけ追加scan。新しいCloud Run checkoutで過去の計測物を必須にしない。
- `Dockerfile`、`.dockerignore`、`.gcloudignore`、`cloudbuild.yaml`：Secretなしのremote build構成。
- `test/http-runtime.test.js`、`test/run-build.test.js`：Node HTTPとbuild境界試験。
- `scripts/observe-position-reference.js`：独立した参照調査専用。runtime/imageに含めない。
- `README.md`、DESIGN / DATA_VALIDATION / DEPLOYMENT：最新構成と証拠、手順を記録。

## 以下はCloudflare初期方式の履歴

2026-09-10 / Asia/Tokyo。最終検証結果：**FreeプランではNO-GO。CPU上限超過のため本番deploy中断。** 本番Worker/PWA/GASは未deploy。

> 最新フェーズ：ユーザーが2026-09-10に最終検証と条件付き本番deployを明示許可。停電後の再開時点では未deploy。以下の「ユーザー本人のみdeploy」は前フェーズの運用記録であり、今回はユーザー指定の停止条件を優先する。アカウント・名前・plan・CPU等の確認前には公開しない。

## 最終検証フェーズ（停電後再開）

- 問題：本番アカウント/Worker名/プラン/リクエストCPUは未確認。
- 進め方：Wrangler認証確認→対象アカウント/名前/プラン照合→公式上限とdry-run照合→remoteまたは本番相当のCPU/HTTP測定→全停止条件を満たす場合だけWorker公開→API/PWA/Android受入。
- 計測追加の範囲：Busの検証スクリプトとこの記録。通常のAPI DTO、GAS/Agent/OS契約は変更しない。計測用Profilerはlocal workerdだけに接続し、raw profile/RT本文/秘密値を保存・表示しない。
- ロールバック：初回公開前の不適合では公開しない。公開後に失敗した場合は既存の本書rollback方針に従い、他機能へ変更を波及させない。
- 停止条件：CPU/bundle超過、名前衝突、Secret/CORS不備、四方向の重大不整合、既存PALURU回帰。Android実機の結果をブラウザの代用結果で埋めない。
- 再開時の確認：ローカル変更と生成物は保持。Wrangler `whoami --json` は `loggedIn:false`。認証待ちの間は独立したローカル検証のみ進める。

## 最終検証結果（2026-09-10 22:05 JST時点）

### アカウント・名前・プラン

- ユーザーのWranglerログイン後、OAuth認証成功を確認。
- 対象：`Alle.shokai@gmail.com's Account` / account ID `fefb5053df43957c88be306bf60db824`。既存Worker設定のアカウントと一致。
- Workers APIで既存Worker 3件、`paluru-bus-api` は未存在、サブドメインは `alle-shokai` と確認。
- account-settings APIの `default_usage_model: standard` だけではFree/Paidを判定しない。subscriptions APIはOAuth権限不足（403）。
- ログイン済みCloudflare管理画面の **Workers plans → Free → Current plan** と **10 ms / request** を確認。プラン変更はしていない。
- 本番予定URL：`https://paluru-bus-api.alle-shokai.workers.dev/api/bus/arrivals`。本番Workerは未作成であり、稼働URLとして案内しない。
- CORS設定は `https://alleshokai-gif.github.io` のみ。localhost / `*` を本番設定へ追加していない。

### Bundle / Static / 起動

- 再実行した `wrangler deploy --dry-run`：**Total Upload 2822.41 KiB / gzip 154.89 KiB**。
- dry-run成果物のJavaScript module：**2,890,149 bytes**。SHA-256 `9833f0aa60ab794696dfb649cc631a5341544dde03e2ccaeeb417cca9ec2d558`。
- [Cloudflare現行公式上限](https://developers.cloudflare.com/workers/platform/limits/)（2026-09-10確認）はWorker未圧縮64 MiB、圧縮サイズ上限なし、startup 1秒。旧3/10 MiB基準を使用しない。実測bundleは上限内。
- Static JSONは **2,616,507 bytes**、版 `20260701_20260828` のまま。全GTFS ZIP/CSV parseはWorkerホットパスにない。
- [ODPT公式カタログ](https://ckan.odpt.org/en/dataset/transportation_bureau_city_of_kawasaki_all_lines)掲載のStatic日付 `20260828` と設定値を照合済み。
- local startup profile：Active 52.3ms / GC 3.1ms / profile window 194.9ms。これはリクエストCPUではない。
- 本番用moduleを一時Workerへuploadした際のCloudflare `startup_time_ms` は **27ms**。

### Remote CPU実測：停止条件該当

本番名とは別の `paluru-bus-api-validation-20260910` を、未存在確認後に一時作成した。DB/KV/R2/cron/他Worker bindingは追加していない。ODPTキーはメモリからCloudflareの `secret_text` bindingへ渡した。一時Workerだけinvocation logsを有効化（query string除去、traces無効）し、HTTP処理のCPUを管理画面で読んだ。ログAPIもWrangler OAuthでは403のため、**画面上の値とCF-Rayを照合**して記録した。

第1測定は段階別時間を返す検証用entry、第2測定はdry-runから抽出した**本番JavaScript moduleそのもの**。第2測定に段階別ヘッダーや追加loggerはない。通常設定との差は一時Worker名・invocation logs・一時Secret binding。双方とも同じFreeアカウント、NRT経由、4方向API、逐次5リクエスト。

**第2測定（21:58 JST、本番module）の採用値：**

|リクエスト|Cloudflare CPU|Cloudflare wall|クライアント応答完了|CF-Ray|HTTP|
|---|---:|---:|---:|---|---|
|初回|**53ms**|150ms|349.60ms|`a38e9a71ea70d561`|200|
|キャッシュ1|9ms|10ms|29.56ms|`a38e9a73ec71d561`|200|
|キャッシュ2|4ms|5ms|26.14ms|`a38e9a741ca7d561`|200|
|26秒後の再取得|**34ms**|149ms|316.77ms|`a38e9b172a1c0dce`|200|
|更新後キャッシュ|6ms|7ms|22.89ms|`a38e9b18c8df0dce`|200|

全5件outcomeは `ok`。ただしHTTP成功をCPU上限PASSと扱わない。[Cloudflareの説明](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#cpu-time-per-execution)でも、CPUの繰り越しにより上限超過時に即エラーにならない場合がある。ユーザー指定の10ms判定に対し53ms/34msはFAILであり、**本番deployを中断**した。

第1測定（21:53 JST）のCPUは初回63ms、キャッシュ10/3ms、再取得35ms、更新後キャッシュ6ms。検証用ヘッダーでODPT呼出し回数 `1 / 0 / 0 / 1 / 0` を確認。ODPT fetch+body+decodeの経過時間は36ms/40ms、RT load全体は92ms/93ms。Workerの `performance.now()` はI/O時点で進むため、そこで得たJOIN `0ms` を「CPUゼロ」と解釈しない。ODPT待機時間だけの厳密分離と段階別Cloudflare CPUは未計測。総CPUは上表のplatform値を使う。

local V8 samplingだけでの先行測定は、profiler開始/停止や `(program)` を含むため、本番CPU判定には採用していない。

### 四方向・APIの検証範囲

|方向|本番相当の一時Workerでの確認|本番API|
|---|---|---|
|神木本町 → 登戸|3便 / RT 1便|未実施|
|神木本町 → 溝口駅南口|3便 / RT 3便|未実施|
|登戸 → 神木本町|3便 / RT 0便、Static fallback|未実施|
|溝口駅南口 → 神木本町|3便 / RT 1便（第2測定）|未実施|

- 第2測定のJSON responseは8,098〜8,099 bytes、全5回HTTP 200、`fetchError:false`、本番OriginへのCORS応答一致、秘密値一致なし。
- この追加remote probeが保存するのは件数・状態・時間・サイズのみ。全arrival値の一致・欠損強制・stale経時のremote受入までPASSとはしていない。
- scheduled/estimated/ETA/遅延の整合、欠損時null、過去ETA排除、取消/skip、stale・失敗分離は前述のローカル実データ/Unit/local workerd統合試験で確認。本番API受入とは分ける。
- Position UIは引き続きOFF。PALURU本番接続/GAS反映/GitHub Pages公開は実施していない。Android実機は未接続・未確認。

### CPU削減候補（検討結果、未実装）

確定しているのは「cache miss時のplatform CPU超過」。各処理のCPU寄与はremoteでは分離できていないため、原因をStatic読込だけに断定しない。

22:01 JSTの追加Node診断（Cloudflare CPUの代用ではない）：RT 41,001 bytes、TU 97件・VP 86件・stop update 852件。P0 tripに該当したTU/VPは各18件だが、現在は全件をNormalizeし、125,081 bytesのcache JSONへ変換する。初回の同期経過時間はRT decode/Normalize 12.83ms、JOIN 24.87ms、cache stringify 0.65ms。warmでは順に2.46〜5.63ms、1.76〜5.85ms、0.55〜1.45ms。Windowsのprocess CPU値は粒度が粗いため判定に使わない。

次の最小構成は、既存のAdapter→Core→Worker→PWAを維持したまま以下を行い、同じremote試験へ戻すこと。

1. Static生成時に `trip_id → direction/boarding row` と `service_id → scheduled順row` をpre-index化する。現在あるservice別groupingより候補絞込みを進める。
2. RT decode後、P0 trip・対象boarding eventだけをNormalize/cache/JOINへ渡す。対象外便の配列/DTO生成とJSON化を減らす。protobuf decode自体の削減は別途計測して必要性を判断する。
3. Static候補はscheduled順で絞り、同一便RTを直接lookupして統合する。遅延で予定時刻が過去になった便・取消・skip・重複TU・日跨ぎを落とさない試験を先に定義する。
4. 表示用変換は現行同様top3のみ。4方向の順位・欠損・位置OFFという外部契約は変えない。

このフェーズでは最適化の実装やプラン変更をしていない。Free内と推測して再deployせず、cold miss / warm miss / hitをplatform CPUで再計測する。

### Test / Acceptance / cleanup

|項目|結果|
|---|---|
|アカウント、名前非衝突、Freeプラン、公式上限|PASS|
|dry-run / bundle size / remote startup|PASS|
|CPU 10ms以下|**FAIL → NO-GO**|
|Repository `node --test test/*.test.js`|84 PASS|
|Bus `npm test`|21 PASS（sandboxのesbuild親directory読取制限後、同一試験を権限付きで再実行）|
|local workerd統合・RT有無・CORS/エラー|2シナリオ PASS（再開フェーズ）|
|秘密値scan / `.dev.vars` ignored|PASS：296対象、ODPT実値/URLエンコード値の一致0件|
|Position OFF|PASS（コード/テスト）|
|4方向本番API / 本番PWA / Android|未実施：CPU停止条件により保留|
|一時Worker cleanup|2回の成功uploadをそれぞれ削除、API一覧で非存在を確認|
|本番deploy / rollback|本番deployなし、rollback不要|

22:05 JSTの最終read-only照合でもWorkerは既存3件、本番名は未存在。追加検証スクリプト6ファイルの構文確認と `git diff --check` もPASS。Git commit/pushは実施していない。

一度、本番比較用にWrangler `.bundle`（実体はmultipart）をJSとしてuploadし、400 / code 10021で拒否された。Worker非存在を確認後、multipartのmain moduleを抽出して再測定した。秘密値/未マスクエラー本文は記録していない。

今回追加した検証コード：`bus/scripts/cloudflare-preflight.js`（read-only）、`cloudflare-session.js`（認証をpipe内保持）、`profile-requests.js`（local V8）、`remote-probe-entry.js`（段階別計測）、`remote-probe.js`（一時Workerの作成・計測・削除）。`check-secrets.js` は要約証拠もscan対象に追加。実データの要約はgitignore配下 `.local/remote-probe[-exact]-summary.json`、永続的なレビュー用証拠はこのMDとする。

検証の再実行：`node scripts/cloudflare-preflight.js` → `npm run check:deploy` → `node scripts/remote-probe.js --exact-bundle`。最後のコマンドは**一時Cloudflare Workerを作る副作用あり**。自動テストには含めない。OAuthでCPU queryが403なら管理画面でCF-Ray対応のCPUを確認し、ターミナルでEnterを押すと削除する（5分で自動削除）。中断/停電でプロセスが終了した場合は一時Worker名とtagを確認し、その検証Workerだけ片付ける。

## 変更前の問題と方針

- 問題：Worker serviceが初回にGTFS ZIPを取得し、全stop_timesを走査する。前フェーズのローカルcold約5秒は、この経路を含む測定。
- 証拠：`worker/service.js` → `adapter.getStatic()` → `parseStatic()`。改修前Bus 15件、Repository 83件のテストPASS。
- 方針：公式ZIP処理を手動生成スクリプトへ移す。P0四方向・運行カレンダーだけのJSONを事前生成し、Workerのサーバー側bundleへ同梱する。
- 影響：BusのStatic供給・Worker設定・生成/検証スクリプト。Agent、Mini Gateway、GAS、他domainの契約は変更しない。
- 副作用：Static更新には再生成とユーザーによるWorker再deployが必要になる。従来の6時間再取得/24時間上限は廃止し、配布feedの有効日をCoreで検証する。自動で旧ZIP取得へ戻さない。
- ロールバック：生成失敗では既存JSONを保持する。成功時も直前JSONをローカル退避。本番ではユーザーが前Worker versionへ戻す。初回公開前の問題ならBus公開を保留する。
- 実機試験：四方向×最大3便、RT/Static/stale/失敗、30秒更新と復帰、分単位の遅延、位置非表示、他機能への非波及。実デプロイとAndroid受入は別ゲート。

## Static配置方式

|候補|P0での判断|
|---|---|
|Worker bundle JSON|採用。外部読取なし。コードとStaticを同じversionで切り替え/rollbackできる。実測サイズと起動時間を下記へ記録する。|
|KV|不採用。bindingと更新手順が増え、更新の地域間反映にも時間差がある。自動更新が必要になった時に再評価。|
|R2|不採用。bucket/binding/取得/キャッシュが追加される。四方向の小型データには不要。|

KVの整合性は[Cloudflare公式](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、R2接続方法は[公式Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)を参照。

生成JSONは`bus/generated/`のgitignore対象とし、Pagesへ配信しない。完全なAPIレスポンス、ZIP、全stop_timesは保存しない。ODPT_ACCESS_TOKENは生成物にも含めない。

## 本番設定の確認根拠

- PALURU公開URL：`https://alleshokai-gif.github.io/paruru-mini/`。2026-09-10の実ブラウザでPALURU端末登録画面を確認。登録操作はしていない。
- 許可Origin：`https://alleshokai-gif.github.io`（パスを含めない）。Originは同一ホスト上の他Pagesと共通であり、認証の代替ではない。
- Worker名：`paluru-bus-api`。既存Workerの小文字・ハイフン形式に合わせた新規名。
- workers.devサブドメイン：既存接続タブ`pharmacy-portal-private.alle-shokai.workers.dev`から`alle-shokai`を確認。新Workerの公開先はユーザーによるdeploy時に確定照合する。
- Wrangler CLIは未ログイン。アカウント上のWorker名重複・プランはこの時点では未確認。既存アカウント設定は変更しない。

## 受入一覧（実装前に定義、実施後チェック）

- [x] Worker runtime import graphにZIP取得/展開/全件parseがない
- [x] 生成・四方向・ID/sequence/時刻検証、異常時の旧JSON保持
- [x] Local Worker API四方向、RTあり/なし、cache/stale/error
- [x] APIキー非混入、prod/development CORS分離、name/Origin確定
- [x] Static/RT/JOIN/処理時間・responseサイズ測定
- [x] Repository / Bus test PASS、UI遅延分表示、Position OFF
- [x] deploy手順・Static更新・rollbackを記載
- [x] 本番deploy未実施

## 実装結果

```text
手動更新: 公式GTFS ZIP → build-p0-static → ID/運行日/時刻検証 → 原子的なJSON置換
                                                      ↓
                                              Worker server bundle

GET /api/bus/arrivals → Origin/固定path/method検証 → 同梱Static参照
                                                     ＋
                                    RT cache / Kawasaki RT Adapter
                                                     ↓
                                          同一便JOIN / Normalize
                                                     ↓
                                       四方向×最大3便 JSON response
```

- `static-source.js`と`static.js`は生成処理専用。Workerのimport graphから外し、`fflate`もdevDependencyへ移動。
- `entry.js`だけが生成JSONをimport。モジュール初期化時に運行service別の小さな索引を作る。Staticのリクエスト内処理はオブジェクト参照だけで、Staticファイル取得/JSON.parse/ZIP download/unzip/全stop_times走査はない。RTのdecodeやcache JSON読込とは区別する。
- 運行対象serviceだけを評価し、順位決定後の最大3便だけをDTO化。順位、欠損、取消、過去ETA、24時超、運行日例外の契約は維持。
- 固定APIは既存との整合を優先して全四方向を1回で返す。任意`id`/stop/URLやその他queryは受け付けず404。
- APIスキーマは従来を維持。`staticUpdatedAt`は生成元取得日時、`staticVersion`はfeed_version。Staticの旧24時間TTLは使わず、feed有効期間外は明示エラー。`staticStale`は互換用フィールドとして通常false。
- UI接続予定URLは `https://paluru-bus-api.alle-shokai.workers.dev/api/bus/arrivals`。これは新Workerの稼働確認ではない。user deploy結果のURLと照合してからPWAを公開する。
- PWA Buildは`v20260910-bus-p0-static-v2`。既存network-first、SWライフサイクル、Bus APIのSW bypassは維持。位置flagはCore/UI両方false。

## 生成物と検証

生成日時：**2026-09-10 19:57:20.597 JST**。

|項目|結果|
|---|---|
|指定ソース日付|20260828（この版を実取得。最新版であるとの再判定ではない）|
|sourceVersion|20260701_20260828|
|feed有効期間|20260701〜20270701|
|元ZIP|7,423,362 bytes、メモリ内のみ|
|P0 JSON|**2,616,507 bytes / 約2.50 MiB**|
|JSON SHA-256|`99a97e8fbb57425a19b0e3116132ac199b82513565f2561405f37085bcc73019`|
|生成時のStatic fetch|500ms|
|生成・検証・置換|4,656ms（Worker request外）|
|Wrangler bundle|2,822.41 KiB / gzip 154.89 KiB|

|方向ID|乗車stop_id|降車stop_id|route_id|抽出件数|
|---|---|---|---|---:|
|home_to_noborito|184_2|362_1|10044|660|
|home_to_mizonokuchi|184_1|434_5 / 434_1|10032〜10037|3,820|
|noborito_to_home|362_1|184_3|10044|660|
|mizonokuchi_to_home|434_2 / 434_3 / 434_4|184_3|10032〜10037|3,716|

件数は複数serviceを含む配布期間全体のtrip記録数。今日の運行本数ではない。実生成物のdirectionIdは行き2方向が0、帰り2方向が1。stop辞書9件、route辞書7件、calendar12行、calendar_dates14行。
JSONは`directions[id]`の行にtripId、routeId、serviceId、directionId（欠損ならnull）、from/to stop、乗車/降車sequence、scheduledSeconds（運行日0時からの秒）、startTime、routeLabel、headsign、platformを保持する。
別途stop名・route名の辞書、四方向設定、対象serviceのcalendar/calendar_dates、生成/ソース/設定hashを持つ。全線のstop_times、位置座標、車両ID、shapeは含めない。Position OFFの範囲に不要な中間停留所は含めない。

生成時は四方向、正確な乗降stop/route参照、trip/service存在、重複、乗降sequence、時刻、運行日/例外を検証する。曖昧な複数乗降ペアは停止し、欠損値を推測しない。検証・一時ファイル書込を通してからrenameする。失敗時の旧ファイルbyte一致、成功時の退避もテストした。

## Static更新手順

1. 公式ODPTカタログで川崎市交通局AllLinesの配布版/ダイヤ改正を確認。公開前にも再確認する。
2. 新版なら`bus/config/static-source.json`の`sourceDate`を更新する。正式IDが変わった場合は生成を停止し、検証MD/固定設定の対応を先に確認する。
3. ローカル`.dev.vars`にある正規キーを使って以下を実行する。ZIP・RT全文をファイルへredirectしない。

```powershell
npm --prefix bus ci --ignore-scripts
npm --prefix bus run build:static
npm --prefix bus run check:static
npm --prefix bus test
npm --prefix bus run test:integration
npm --prefix bus run test:live
npm --prefix bus run check:bundle
npm --prefix bus run check:deploy
npm --prefix bus run check:secrets
node --test test/*.test.js
```

`check:deploy`は固定の`wrangler deploy --dry-run`と`wrangler check startup --worker <local bundle>`だけを実行する。Wranglerファイルログ/telemetryを無効化し、公開処理は持たない。
通常のWorker buildは`check:static`だけで、公式GTFS取得は行わない。生成物がないclean checkoutでは、testは合成fixtureで動くがWorker buildは停止する。先に`build:static`が必要。

更新頻度は公式Static更新・ダイヤ改正のタイミングでの手動再生成＋ユーザーWorker deploy。定期cron/DBは追加しない。更新を見落とすとfeed有効期間内でも古いダイヤを表示し得るため、長期有効日だけで「最新」とは判定しない。自動更新が必要になった時がKV/R2等を再評価する条件。

## Worker / Secret / CORS / cache

|設定|本番準備値|
|---|---|
|config|bus/wrangler.jsonc|
|name / entry|paluru-bus-api / worker/entry.js|
|compatibility_date|2026-09-10|
|public endpoint|GET /api/bus/arrivals（全四方向）|
|workers.dev / preview_urls|true / false|
|routes / assets / KV / R2 / DB / Cron|追加なし|
|Secret|ODPT_ACCESS_TOKEN（Worker Secretのみ、値はconfigに置かない）|
|ALLOWED_ORIGINS|https://alleshokai-gif.github.io|
|development Origin|wrangler.local.jsoncだけにlocalhost:8788 / 127.0.0.1:8788|
|RT refresh|25秒|
|UI polling|30秒、hidden/離脱時停止、復帰即refresh|
|HTTP response cache|no-store。ETAは現在時刻から再計算|

同一isolateではin-flight Promise共有と25秒メモリcacheで同一feed取得をまとめる。Cache APIにもRTを保存し、取得時刻から25秒未満だけfreshとして再利用する。保存TTL 120秒は障害時に前回RTを識別するためで、120秒fresh扱いではない。失敗後は25秒backoff。RT更新失敗とStatic fallback、古いRTを区別し、過去ETAを出さない。
Cache APIは地域/isolateをまたぐ世界共通のlockではない。複数isolateの同時cold取得は起こり得る。P0でDurable Object等は追加しない。
Origin不一致は403、`*`許可なし。Originなしの公共交通readアクセスは従来どおり許可するため、CORSをAPI認証と呼ばない。家族データやMiniトークンはこのAPIへ渡さない。

Secret運用は[Cloudflare公式](https://developers.cloudflare.com/workers/configuration/secrets/)に従う。ローカルキーはgitignore確認付きloaderで読み、生成JSON・bundle・API・通常ログへ入れない。生成物とdry-run出力はGit対象外。Workerに静的ファイル配信bindingはなく、JSON/ソース公開endpointもない。

## 性能測定

2026-09-10、Windows / Node 24.14.0 / ローカルworkerd。実RTを使った結果。全リクエストは四方向一括。

|Node service計測（20:03:09 JST）|初回|cache 1|cache 2|cache 3|
|---|---:|---:|---:|---:|
|Static参照|0.001ms|0.0005ms|0.0006ms|0.0005ms|
|RT取得/本文読取/decode（cache時は参照）|147.26ms|0.15ms|0.19ms|0.17ms|
|JOIN/Normalize|22.08ms|3.85ms|3.49ms|1.74ms|
|JSON serialize|0.062ms|0.077ms|0.112ms|0.041ms|
|全体wall|169.64ms|4.15ms|3.87ms|1.99ms|
|response size|8,078 bytes|8,078 bytes|8,078 bytes|8,078 bytes|

起動時のローカルJSON読込＋service索引作成は25.83ms（リクエスト前）。RT fetchは1回、headers到着まで101.54ms。
Nodeのprocess CPU合算は初回156ms、cache時0msと出たが、Windowsの計測粒度・別threadを含む値なのでcache CPUゼロとは解釈しない。

- local workerd HTTP（実RT）：初回 **221.98ms**、cache **9.17ms / 6.89ms**、response **8,090 bytes**、4方向各3便。RTありとStatic fallbackの両方を観測。
- Wrangler dry-run：PASS。local startup profileはactive **36.8ms**、profile window173.2ms、idle136.2ms、GC0ms。これはWorkerのローカル起動profileであり、本番CPU認証値ではない。
- runtime module graphは28module。ZIP downloader、static parser、fflateは0件。GTFS処理約4.7秒は生成コマンドだけ。
- 初回JOINは22.08msで、warmだけを根拠にFreeのHTTP CPU枠へ適合すると判定しない。Free HTTP CPU 10ms、起動1秒などの制限は[Cloudflare公式](https://developers.cloudflare.com/workers/platform/limits/)参照。本番プラン/CPU測定は未確認。

## テスト・ブラウザ結果

- Repository：`node --test test/*.test.js` **84 PASS**。既存Agent/Mini/各domain/SWの回帰を含む。
- Bus：**21 PASS**。生成validation、異常時旧JSON保持、運行calendar/24時超、RT time/delay/欠損/取消/過去便、cache/single-flight、secret-safe errors、runtime graph、CORS。
- 既存Python validator：**14 PASS**。
- local workerd合成統合：RTあり／上流503をそれぞれ実行し、**4方向×3便、scheduled/estimated/delay/ETA、位置OFF**を検証。各ケース2 API呼出しにRTは1回。本番Origin許可、localhost/別Origin/`*`拒否。外部通信0件。
- 実ブラウザ20:07 JST：実RT＋生成Staticから4カード×3便。20:14便が20:13便より先に並ぶRT順序を確認。`+7分遅れ`表示あり、秒値は出ない。421秒→7分は別途Unit Testで固定検証。
- 合成Staticで12行・予定表示・ETAなし、位置DOM0件。取得失敗で前回12行と失敗メッセージを保持。別画面へ移ると更新停止表示。
- hidden/30秒/復帰の厳密な時間制御は自動テストPASS。Android実機、デプロイ済みBus/PWAの受入は未実施。

## ユーザー本人によるdeploy手順（今回は実行しない）

1. Cloudflareへログインし、既存Workerと同じ対象アカウント、Workersプラン/CPU枠、`paluru-bus-api`が他用途で使われていないことを確認する。衝突していたら上書きしない。Free適合は今回の結果から断定しない。
2. 公式Staticの版確認と上記preflightを通す。変更ファイル/生成版/直前Worker versionを確認する。
3. ユーザーが`bus/`で`npx wrangler deploy --config wrangler.jsonc`を実行する。初回でSecret未設定の間はAPIが503を返す。まだPWAを公開しない。
4. ユーザーが`npx wrangler secret put ODPT_ACCESS_TOKEN --config wrangler.jsonc`を実行し、非表示の対話入力で値を設定する。値をコマンド引数・履歴・チャットへ貼らない。既存Secretがある場合は不要な変更をしない。
5. 実際に表示されたWorker URLがPWA設定の予定URLと一致することを確認。異なる場合は`features/bus/config.js`の公開URLだけを合わせ、Build更新を伴う確認を行う。
6. PALURU本番Originから4方向・RT/fallback・CORS・cache/CPUを確認。失敗時はPWA公開へ進まない。
7. 前フェーズで追加済みのMini allowedViewsをユーザーの既存deploy手順で反映し、PWAをGitHub Pagesへユーザーが公開。`generated/`や`.local/`、`.dev.vars`を公開に含めない。
8. Android PWAでBuild `v20260910-bus-p0-static-v2`、30秒更新/hidden/復帰、四方向、他機能を受入確認する。ここまで揃うまではP0完成とは扱わない。

## rollback

- 生成処理が失敗：既存`p0-static.json`を自動保持。原因を確認してから再生成する。
- 生成成功後に取り消す：`generated/previous-<hash>.json`を確認して`p0-static.json`へ戻し、対応する`static-source.json`と固定設定も同じ版へ戻す。check:static/build/test後、ユーザーがWorkerを再deployする。全GTFS取得の旧hot pathへ戻さない。
- 本番更新後：ユーザーがCloudflareの直前の動作確認済みWorker versionへrollbackする。コードとStaticが同じbundleなので同時に戻る。Secretの不要な削除/変更はしない。
- 初回の本番受入が失敗：PWAを公開せず、既存PALURUを維持。既にPWAを出した場合はユーザーが直前PWA版またはBus接続無効の版を既存SW更新手順で配信する。DB移行/データ復元は不要。

## 変更ファイル（このフェーズ）

- Static：`bus/config/static-source.json`、`providers/kawasaki/static-source.js`、`static.js`、`scripts/p0-static.js`、`build-p0-static.js`、`check-static.js`、`generated/README.md`、`.gitignore`。
- runtime/config：`providers/kawasaki/adapter.js`、`core/arrivals.js`、`config/settings.js`、`worker/entry.js`、`worker/index.js`、`worker/service.js`、`wrangler.jsonc`、`wrangler.local.jsonc`。
- local検証：`scripts/bundle.js`、`check-bundle.js`、`check-deploy.js`、`check-secrets.js`、`integration-check.js`、`local-worker.js`、`live-check.js`、`test/core.test.js`、`worker.test.js`、`static-build.test.js`、`package.json`、`package-lock.json`。
- PWA公開準備：`features/bus/config.js`、`build.js`、Build期待値の既存2テスト、`test/bus-ui.test.js`の421秒表示テスト。
- MD：本書、`bus/README.md`、DESIGN/IMPLEMENTATIONへの新方式優先注記。前フェーズのGAS/Agent/OS変更を追加していない。

## 本番deploy前Acceptance結果

|項目|判定・根拠|
|---|---|
|Static full parseのhot path除去|PASS：runtime import graph検査|
|生成スクリプト/四方向|PASS：実GTFS生成＋異常系テスト|
|Worker local API四方向|PASS：実RT＋生成JSONで各3便|
|RTあり/なしfallback|PASS：実データおよびlocal workerdの成功/503両ケース|
|APIキー漏洩なし|PASS：Git対象・生成JSON・bundle・local dry-run/profileの計289対象で実キー一致0件。APIも非混入確認|
|CORS / Worker名 / 本番Origin|PASS（ローカル本番設定確定・Origin実画面確認）。アカウント上の名前重複は未確認|
|cache|PASS：25秒fresh、30秒UI、単一isolate取得抑制/失敗backoff|
|Repository / Bus test|PASS：84 / 21。Python14、local統合2ケースもPASS|
|Position UI OFF|PASS：Core/UI flag＋実ブラウザDOM0|
|本番deploy未実施|PASS：dry-run/local profileのみ。commit/pushも未実施|

**判断：ローカル準備・受入は成立。本番deployは条件付き保留。** Cloudflareの対象アカウント/Worker名重複/プランCPU枠の照合が残る。CLI未ログイン、Dashboardもログイン画面で、推測では埋めない。最新Static版の公開直前確認も必要。ユーザーdeployと実PWA受入は今回の対象外。
