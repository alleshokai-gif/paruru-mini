# PALURU Bus

川崎市バスの固定4方向を対象とする、PALURU Bus P0の作業フォルダ。
`gas-health/` と同階層に置くが、Busのリアルタイム取得にGASは使わない。

設計正本: [PALURU_BUS_P0_DESIGN.md](../docs/PALURU_BUS_P0_DESIGN.md)

## 現在の状態

**2026-09-10 最新：本番候補はCloud Runへ移行。Cloudflare Freeは実測CPU超過でNO-GO。** Node HTTPのローカル確認とCloud Build/deploy準備まで実施。本番deploy・PWA URL変更は未実施。

- project `paluru-bus` / region `asia-northeast1`。Docker Desktop不要でCloud Buildを使う。アカウント/API/課金はユーザー準備済みとの申告、gcloudの照合はこれから。
- Node版：`bus/`で `npm run dev:run`（development、loopback8080）または `$env:PORT='8787'`を設定してUI harnessと接続。別ターミナルで`npm run dev:ui`。
- `npm run test:run`：Nodeプロセス＋実HTTP＋実ODPTのcold/warm/cache測定。本番候補は`npm start`（runtime env必須）。ローカル起動だけがignore済み`.dev.vars`を読む。
- 本番SecretはSecret Managerのversion固定で注入。`.gcloudignore`/`.dockerignore`はruntimeと生成Staticだけをallowlist。調査用endpoint/要約/キーはimageに入れない。
- 市バスナビ内部JSONは**参照調査専用**。GPS/timestamp/連続した移動を主根拠に検証し、sequence/stop_idだけで位置判定しない。Position UIはOFF。
- [最新構成・gcloud/Secret/build/deploy/rollback手順](../docs/PALURU_BUS_P0_DEPLOYMENT.md)、[参照観測](../docs/PALURU_BUS_P0_DATA_VALIDATION.md)。以下のWorker前提は初期方式の履歴。

- 2026-09-06: 既存構成・公式画面・公開データ・利用条件を調査し、設計案を作成。
- ODPTで川崎市交通局のGTFS/GTFS-JP、VehiclePosition、TripUpdates、Alertの公開を確認。
- 2026-09-07: 正規トークンによる実データ検証用スクリプトを追加。本番Provider/Worker/UIは未実装。
- 2026-09-10: 4方向の実GTFS/TU/VPを取得・照合。初回結果は検証記録9節。
- 同日、ユーザーのP0実装GOを受け、位置UI OFFで固定設定・Adapter・Core・Worker・PWA UIを追加。登戸発の未来ETAも追加観測で1件確認。更新は30秒、RT cacheは25秒。
- ローカル検証の結果と本番に残る設定・受入: [実装記録](../docs/PALURU_BUS_P0_IMPLEMENTATION.md)。本番deploy・実PWA受入は未実施で、P0は途中。
- 観測結果・不足事項・GO判定: [PALURU_BUS_P0_DATA_VALIDATION.md](../docs/PALURU_BUS_P0_DATA_VALIDATION.md)。

## Static同梱版と本番準備（2026-09-10追記）

- Workerは生成済みJSON＋RTだけを参照。ZIP処理は `npm run build:static` の専用経路に限定。
- 元GTFS版は `config/static-source.json`。公式の新版を確認して変更し、再生成→test→local確認→ユーザーWorker deployを行う。
- `generated/*.json` はGit対象外で、Pages配信禁止。再生成失敗時は旧JSONを保持。
- `npm run check:bundle` でruntimeへのZIP/parser混入を検査。`npm run check:deploy` はWrangler dry-runとlocal起動profileだけで、公開しない。
- 本番設定・計測・deploy/rollback手順・残課題は [deploy準備記録](../docs/PALURU_BUS_P0_DEPLOYMENT.md) を参照。

## ローカルでの実データ検証

`bus/.dev.vars` の `ODPT_ACCESS_TOKEN=` に正規キーをローカルで設定する。値をチャット、コマンド引数、Markdownへ貼らない。
ファイルは `bus/.gitignore` で除外する。Gitへ入れるテンプレートは空値の `.dev.vars.example` だけ。
環境変数 `ODPT_ACCESS_TOKEN` も読めるが、ファイルと異なる値が両方設定されている場合は停止する。
本番ではWorker Secretを使用する。今回のCloudflare実アカウント設定・deployは行わない。

## WorkerとUIのローカル確認

Node.js 24環境で確認。`bus/` で依存をインストールし、2つのターミナルで起動する。

```powershell
cd bus
npm ci --ignore-scripts
npm test
npm run build:static
npm run check:static
npm run dev
```

別ターミナルで `bus/` へ移動し、`npm run dev:ui` を実行。`http://127.0.0.1:8788/` をブラウザで開く。
実コンポーネントとPALURU共通CSSの受入用画面で、PALURU認証の代替・本番画面ではない。
上部で実データ/合成正常/時刻表/stale/取得失敗を切り替えられる。終了時は両ターミナルでCtrl+C。

- `npm run dev`: esbuild＋workerd（Miniflare）をメモリ内で起動。HTTPはloopback限定。機密値を含む例外本文・設定dumpは出力しない。
- `npm run dev:ui`: 必要ファイルだけをallowlistで配信。Repositoryルートを汎用HTTPサーバーで公開しない。`.dev.vars`・サーバーソース・依存パッケージは配信対象外。
- `npm run test:live`: 生成済みStaticを読み、正規ODPTのRTを1回取得＋cache参照3回。四方向・Static/RT/JOIN/responseの安全な計測要約だけ出力。
- 共通のローカル設定は `wrangler.local.jsonc`。本番Worker名・ドメインを表す設定ではない。
- PWAの `features/bus/config.js` は `paluru-bus-api.alle-shokai.workers.dev` を公開予定先として設定。Worker deploy結果と照合してからユーザーがPWAを公開する。キーを置かない。MiniのallowedViews追加もユーザーdeploy後に反映される。

RepositoryルートからPowerShellで実行する。

```powershell
python -m venv bus/.venv
bus/.venv/Scripts/python.exe -m pip install --disable-pip-version-check --no-cache-dir -r bus/requirements-validation.txt
bus/.venv/Scripts/python.exe -m unittest discover -s bus -p test_validate_odpt.py -v
bus/.venv/Scripts/python.exe bus/validate_odpt.py --check-config
bus/.venv/Scripts/python.exe bus/validate_odpt.py --static-date 20260828 --samples 4 --interval 20
```

- `--check-config` は値を表示せず、キーの有無とGit除外を確認する。HTTP取得はしない。
- 静的版 `20260828` は調査時カタログの版。実行前に公式カタログを確認し、新版があれば引数を変更する。本番の固定版ではない。
- ZIPとProtobufをメモリ内で解析する。レスポンス全文を保存しない。標準出力は件数、対象停留所候補、ID組合せ、方向ごとの最大3便の証拠に限定する。
- 通常の上限は静的1回＋RT2種×4回、20秒間隔。引数で1〜6回、15〜60秒に限定する。HTTP失敗は自動再試行せず停止する。`Ctrl+C` で終了可能。
- URLへのキー付与は内部処理だけで行う。静的GTFSはODPTから実際に返された配布ホスト `dataodpt.blob.core.windows.net` と指定版のファイルパスに限り1回転送を許可する。元のキーや認証ヘッダーは転送せず、署名付きURLも出力しない。その他の転送は拒否する。
- 例外本文・HTTP応答本文・車両識別子は出力しない。RT2種を取得して版差を記録し、TU/VP両方を含む新しい方のFULL_DATASET内だけで結合する。別版を混ぜない。
- 終了コード2はキー不足・上流エラーなどの観測停止、3は解析等の失敗。エラーの例外本文を追加ログへ出さない。
- 氏名等の個人情報は扱わない。選別した停留所・便・緯度経度は公共交通データ。証拠MDには必要な抜粋だけ転記する。

### 観測スクリプトの限界

このスクリプトは本番Coreではない。名称は候補発見にだけ使い、同一trip内の乗車→降車順、乗降条件、標柱・座標・親stopを照合してからIDを人が確認する。
同名別標柱は統合しない。`platform_code` が空なら、`stop_id` の末尾等からのりば番号を作らない。

時刻はAsia/Tokyo、計算はepoch秒、出力はオフセット付きISO。運行日と24時超を扱う。静的次便探索は前日/当日/翌日の範囲に限定するため、0件を「今後運行なし」とは判定しない。
運行日のないRT、曖昧な便結合、頻度運行、差分feed、通常SCHEDULED以外は再構成対象外として記録する。
対象停留所への直接更新をまず観測し、疎な更新からの遅延伝播は実装しない。直接更新不足は「RT非対応」の証拠にはしない。

`futureDepartureCandidate` は時刻・運行日・結合条件に基づく観測用候補。鮮度の受入は未判定で、本番へ表示可能という意味ではない。
フィード/便/位置のtimestampを残し、実データで許容鮮度を決める。短時間の4回観測だけで4方向の安定性をGO-Aにしない。
位置は、sequence差に加えて状態別の区間数を検証する。2026-09-10に `STOPPED_AT(seq 9) → IN_TRANSIT_TO(seq 9)` と座標移動を観測したため、川崎データの `IN_TRANSIT_TO` から区間を断定しない。観測ツールもこの状態の `stopsAway` と前後区間をnullにする。仕様モデルでの仮の数値は `unverifiedSpecStopsAway` として区別する。
`STOPPED_AT` / `INCOMING_AT` も観測時刻の情報であり、GPS座標と停留所イベントの同時性は未確認。GTFS停留所順と座標の整合性は別の検証事項として残す。

## 現在の配置

```text
bus/
  README.md
  config/
    favorites.json             # 検証済みの正式IDで固定4方向
  core/                        # 共通DTO・選別・並び順・鮮度
  providers/
    kawasaki/                  # ODPTのGTFS/GTFS-RTをNormalize
  worker/                      # HTTP・キャッシュ・上限・エラー境界
  test/                        # 合成fixture中心のCore/Adapterテスト

features/bus/                  # PWAのBus UI。位置Gate OFF
```

`tokyu/`、`seibu/`、`iyotetsu/` は将来のAdapter追加先の候補に留める。
P0ではフォルダも実装も増やさない。

## 境界

- 固定4方向、地図なし、DBなし、検索・編集・通知・AI予測なし。
- UI → Worker → Core → Kawasaki Adapter → 公式データ。
- Miniの画面許可は既存の仕組みに従う。バスデータ取得はMini/Agent/OSを通さない。
- 原本ZIP・全線Protobuf・ODPTトークンをPWAや公開ディレクトリに置かない。
- 不明な停留所ID・便ID・位置・遅延を推測で補完しない。
- 公開操作はユーザー本人が行う。
