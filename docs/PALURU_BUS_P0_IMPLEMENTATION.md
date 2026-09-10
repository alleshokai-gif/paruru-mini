# PALURU Bus P0 実装・ローカル検証記録

> 2026-09-10 本番準備フェーズ：StaticのWorker内取得/6時間cache/24時間上限は生成JSON同梱方式へ置換した。現在の構成・設定・計測は [DEPLOYMENT](PALURU_BUS_P0_DEPLOYMENT.md) を優先する。以下の初期実装・測定は当時の記録として保持する。

2026-09-10 / Asia/Tokyo。ユーザーの実装GOに基づく時刻中心のP0。**位置UI OFF、本番deploy前、P0全体は途中**。
設計正本は [設計書](PALURU_BUS_P0_DESIGN.md)、正式IDと実データ根拠は [検証記録9・10節](PALURU_BUS_P0_DATA_VALIDATION.md)。

## 1. 実装した範囲

```text
PALURU Bus UI → GET /api/bus/arrivals → Worker cache / Bus Core
                                              ↓
                                      Kawasaki Adapter
                                              ↓
                                  ODPT Static GTFS / 複合GTFS-RT
```

Mini GASは既存の起動時membershipでBus画面を許可するだけ。バスの取得・更新・エラー処理にGAS/Agent/OSを使わない。
地図、検索、DB、管理画面、通知、他事業者は追加していない。

| 方向 | 乗車stop_id | 降車stop_id | route_id |
| --- | --- | --- | --- |
| 神木本町→登戸 | `184_2` | `362_1` | `10044` |
| 神木本町→溝の口駅南口 | `184_1` | `434_5` または `434_1` | `10032`〜`10037` |
| 登戸→神木本町 | `362_1` | `184_3` | `10044` |
| 溝の口駅南口→神木本町 | `434_2`, `434_3`, `434_4` | `184_3` | `10032`〜`10037` |

- 乗降順・pickup/dropoff・実際のrouteをStatic内で確認。曖昧な複数訪問を1件に決めない。
- trip_id、stop_sequence、サービス日は都度解決。路線名はStaticのroute_short_name、行先は乗車stopのstop_headsignを優先する。
- 乗り場は検証済みの表示対応表のみ。`platform_code`空欄をstop_id末尾から埋めない。登戸は「登05のりば」。
- 予測発車時刻でCoreが並べ、最大3便を返す。予測がない便は静的予定時刻で比較する。

## 2. 時刻・鮮度・障害の契約

| 項目 | 実装 |
| --- | --- |
| scheduled | Staticの乗車stop departure、calendar/例外日・24時超対応 |
| estimated | 同じstop/sequenceの直接departure.time優先。timeなし・delayありならscheduled+delay |
| delay | estimated−scheduledの秒差。delaySecondsを保存、delayMinutesは四捨五入。報告delayとの一致も返す |
| etaMinutes | 未来estimatedとの差を切上げ。過去ETAはnull |
| 過去予測＋乗車stopで停車中 | 同一Tripの鮮度内STOPPED_ATを照合できる場合だけprediction_pendingとして残し、ETAを消す |
| RT欠損 | static_fallback。RTなしを0分遅れとして表示しない |
| RT古い | realtime_stale。feed120秒、便180秒を実装用上限とする |
| 取得失敗 | fetchError=true（fetch_errorの状態）。RT取得失敗だけならStatic継続。Staticも使えなければHTTP503固定コード |
| UIの通信失敗 | 前回成功データをメモリ内に保持。エラー/前回更新を表示し、古いETAを消す |
| position | supported=false、status/stopsAway/previousStop/nextStopはnull |

日付・表示はAsia/Tokyo。計算はepoch秒、DTOはオフセット付きISO8601。PWAはUTC表記のISOも東京日付へ変換する。
前日・当日・翌日の運行日を探索する。0件は「検索範囲内の便なし」で、恒久的な運休判定ではない。
疎な更新からの遅延伝播、到着イベントから発車の代用、GPSから区間の推測はしない。

- UIはBus表示中・document非hiddenで30秒ごとに取得。取得中の重複要求なし。別画面/認証ロック/pagehideでabort・停止し、再表示で即取得。
- 画面内の残り時間だけは1秒ごとに再計算。これによるAPI呼出しはない。受信後の経過時間を使うので端末時計のズレをETAへ直接混ぜない。
- RT cacheは25秒。古い成功feedを最長120秒保持しても、元のtimestampで鮮度判定する。静的indexは6時間更新、取得失敗時最長24時間。
- 現状Staticは検証済み版20260828。6時間ごとに同じ指定版を再取得する。カタログ新版の自動探索は未実装で、運用前に版更新手順を決める。
- PWA/SWとAPI応答はno-store。SWはBus endpointをcacheから返さない。既存network first、updateViaCache、skipWaiting、clients.claim、古いcache削除を維持。

## 3. 秘密情報・公開境界

- 正規キーはgitignore済み`bus/.dev.vars`からローカルWorker bindingへ渡す。本番はWorker Secret。値なしexampleだけを追跡する。
- HTTPは固定GETのみ。query、任意stop、任意URL、汎用proxy、writeを受け付けない。CORSは設定Originのみだが認証の代替ではない。
- 上流例外本文・認証付きURL・署名付きredirect・原本ZIP/Protobufをログ/応答へ出さない。Workerは固定エラーコードのみ。
- 静的ZIP redirectは確認済みODPT配布ホストと指定版パスへ1回のみ。元キーを配布先へ転送しない。
- 静的ZIPを逐次展開し、対象路線・乗降stopの行だけ内部indexへ残す。原本は保存しない。Cache API以外のDB/KV/R2等なし。
- ローカルUIサーバーはファイルallowlist方式。Repositoryや`.dev.vars`、依存パッケージをHTTP公開しない。
- 出典、データ更新時刻、時刻表取得日時、時刻は目安である旨を表示。公開時の問い合わせ先・適用条件の最終確認は残る。

## 4. APIレスポンス例

実Workerの18:36:13の応答から神木→登戸の先発1件を抜粋。実際の応答は`directions`に4方向、各最大3便。秘密情報や車両IDは含まない。

```json
{
  "id": "home_to_noborito",
  "provider": "kawasaki",
  "from": "神木本町",
  "to": "登戸",
  "routeLabel": "登０５",
  "arrivals": [{
    "scheduledTime": "18:47",
    "estimatedTime": "18:54",
    "etaMinutes": 18,
    "delayMinutes": 7,
    "delaySeconds": 421,
    "realtime": true,
    "state": "realtime",
    "timingSource": "departure_time",
    "platform": "2番",
    "position": {
      "supported": false,
      "status": null,
      "stopsAway": null,
      "previousStop": null,
      "nextStop": null
    }
  }]
}
```

## 5. 実データ・ローカル表示結果

| 方向 | 18:36:13のlocal Worker先発 | 後続2便の予定 | 追加の実データ根拠 |
| --- | --- | --- | --- |
| 神木→登戸 | 予定18:47、予測18:54、ETA18分、遅れ421秒 | 19:04 / 19:22 | ブラウザでも予測・遅れを表示 |
| 神木→溝口 | 予定18:36、予測18:38、ETA3分、遅れ141秒 | 18:36 / 18:42 | 3便の予測を表示 |
| 登戸→神木 | 予定18:46、RTなし | 19:03 / 19:21 | 18:45:30の追加観測で18:46便の未来ETA1分を確認 |
| 溝口→神木 | 予定18:36、RTなし | 18:38 / 18:41 | 18:40頃のブラウザで18:41便のETA1分・明示0秒遅れを表示 |

RTは観測タイミングで欠損する。表のRTなしを、その方向が非対応である意味にはしない。
登戸発は発車直前の未来ETA1件と、その後の「過去timeだがSTOPPED_AT」を確認した。常時配信の保証ではない。

### 計測

- Node Adapter/Core実データ試験: 18:26:29、wall5128ms、プロセスCPU5218ms、heapUsed約81MiB、プロセスpeak RSS約241MiB。
- ZIP7,423,362 bytes、stop_times955,492行を処理。残した乗降候補は660 / 3820 / 660 / 3716行、内部indexのJSON長2,275,913文字。
- 実workerdの初回HTTP200: 5223ms。静的cacheあり・RT再取得時163ms、連続cache利用時18ms / 18ms（同一feed timestamp）。ローカル測定でネットワーク待ちも含む。
- プロセスRSSはWorker isolateのメモリ使用量ではない。Miniflare成功だけで本番128MiB制限やCPU予算適合をPASSにしない。
- Workers FreeのHTTP CPU枠は10ms、Paid既定は30秒。現状のcold処理をFreeで動くとは扱わない。プランと本番CPU/メモリの確認が必要。[Cloudflare公式制限](https://developers.cloudflare.com/workers/platform/limits/)

## 6. テスト・Acceptance

| 項目 | 確認結果 |
| --- | --- |
| 4方向各3便 / 正式乗降ID | 実Static、実Worker200、ローカルブラウザで確認 |
| scheduled・運行日・24時超 | 合成テストPASS＋実データ照合 |
| RTのtime / delay-only / 明示0 / 欠損 | 合成テストPASS。実データは対象departureにtime+delayあり |
| 予測による順位入替 | 合成テストPASS。実路上の追越しの受入は未確認 |
| 過去ETAなし / 停車中の予測更新待ち | 合成テストPASS＋実データに同状態あり |
| 30秒polling | 偽時計テストで29,999ms未取得・30,000ms取得。ブラウザのAPI回数増加も確認 |
| document.hidden中停止 / 復帰 | 合成ライフサイクル試験PASS。in-app browserは別タブでもhidden=falseだったため、実OS背景化は未確認 |
| 別画面へ移動 / 復帰 | ローカルブラウザで停止中の取得回数が1回のまま、再表示で2回に増加 |
| stale / static fallback / fetch error | UI切替試験。失敗でも4カード保持、ETA表示0件。時刻表のみは予定/RT予測なし |
| Bus障害が他機能へ波及しない | Bus lifecycleがthrowしてもInbox読込を継続するVM試験PASS。実PWAの他画面は未確認 |
| APIキー漏洩なし | 最終作業tree対象270ファイルとAPI応答の実キー混入検査で0件。secretはGit除外・未追跡、exampleは空値。秘密ファイル/依存のHTTP取得も404を確認 |
| position Gate OFF | Core・UIのGate=false、API位置値null。ブラウザ位置DOM0件 |
| スマホ幅 | 360px/390px、4カード各3行、カード/行の横はみ出し0。共通CSS込みの360px、更新ボタン72×48pxも確認 |
| 既存回帰 | 変更前78件PASS。Bus UIテスト追加後83件PASS |
| Bus Unit | 15件PASS。静的/RT/並び/鮮度/キャッシュ/固定endpoint/秘密情報の境界。有効期限切れのStaticを明示エラーにする試験も含む |
| 既存Python validator | 14件PASS |
| 構文・差分 | Node構文確認、git diff --check PASS |
| 本番PALURU / Android PWA | 未deploy・未受入。ローカル受入harnessは認証済みPALURUの代替ではない |

## 7. 追加・変更ファイル

| 範囲 | ファイル |
| --- | --- |
| 固定設定 | `bus/config/favorites.json`, `settings.js` |
| Adapter | `bus/providers/kawasaki/static.js`, `adapter.js` |
| Core | `bus/core/time.js`, `arrivals.js` |
| Worker | `bus/worker/service.js`, `index.js`, `bus/wrangler.local.jsonc` |
| ローカル実行・依存 | `bus/package.json`, `package-lock.json`, `.gitignore`, `scripts/local-config.js`, `local-secret.js`, `local-worker.js`, `local-ui.js`, `live-check.js` |
| Bus試験 | `bus/test/fixtures.js`, `core.test.js`, `worker.test.js`, `browser.html`, `browser-harness.js`, `test/bus-ui.test.js` |
| PWA UI | `features/bus/config.js`, `bus.js`, `bus.css` |
| PWA登録 | `index.html`, `app.js`, `sw.js`, `build.js` |
| 既存画面許可 | `gas/HomeMembershipService.js`（activeな3ロールのallowedViewsにbusだけ追加） |
| 既存テスト期待値 | `test/home-membership.test.js`, `membership-context.test.js`の画面一覧、`family-inbox-pwa.test.js`, `pwa-agent-chat.test.js`のBuild固定値 |
| 文書 | この記録、`PALURU_BUS_P0_DESIGN.md`, `PALURU_BUS_P0_DATA_VALIDATION.md`, `bus/README.md` |

作業開始時から存在した`bus/validate_odpt.py`・`test_validate_odpt.py`・検証MD・READMEの実データ検証差分は保持した。今回の実装で既存の検証差分を巻き戻していない。
Buildは`v20260910-bus-p0-gated-v1`。既存データ、Agent/OSの契約、Cloudflare実アカウント設定は変更していない。commit/push/deployなし。

## 8. deploy可否と次の最小手順

**ローカル実装をレビュー可能。本番deployは保留、実行していない。**

1. Worker名、公開API URL、PALURU許可Origin、Cloudflareプランを決める。現時点は`wrangler.local.jsonc`だけで、本番設定ではない。
2. cold処理のCPU/メモリ予算、Static版の更新手順、公開時の問い合わせ先・ライセンス表記を確認する。Free枠では現状のcold CPU処理に適合する根拠がない。
3. 決まったURLのみ`features/bus/config.js`へ設定。本番のODPTキーはユーザーがWorker Secretへ設定する。キーをクライアント設定に入れない。
4. ユーザー本人がWorker・MiniのallowedViews・PWAをdeployし、Build表示/更新経路、実4方向、他画面への非波及、Androidの背景化/復帰、欠損/通信失敗を受け入れる。
5. 位置のsequence/statusと前後停留所は追加検証。4方向で意味を確定し、ユーザー判断を得るまでCore/UI両GateをOFFにする。

DB移行は不要。全体P0の完成判定はこのローカル記録からは行わない。
