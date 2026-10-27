# 小田急 乗換ナビ（保存ダイヤ・部分区間版）

PR #143の続き。PALURU本番と独立したloopbackアプリ。既存のODPT 7,221発時刻と、既存通勤Staticの提供元便ID695便を再利用する。到着比較は**提供元IDで同一便を識別し、明示された着発がある区間だけ**で実行する。旧来の時間窓による仮説結合はUIの到着判定に使わない。

## 起動・操作

rootで`node poc/odakyu/server.mjs`。既定URLは http://127.0.0.1:8767 。`ODAKYU_POC_PORT`で変更可能。外部公開なし。

列車は代々木上原の発時刻・種別・行先で手動選択する。最初に自動で乗車列車を決めない。「実ダイヤの比較例を再生」はローカル参照ファイルの例を開く。ホーム・歩行条件は利用者の設定を維持する。比較時刻・ダイヤ・目的地・保存時点を切替可能。祝日は自動判定しない。

## 今回確かめたデータ

| データ | 件数・範囲 | 確定していないこと |
|---|---|---|
| ODPT小田急StationTimetable | 2時点各276レコード。対象19駅・平土休日・4種別7,221発時刻 | 列車ID・着時刻 |
| 既存`bus/release-static/kazu-commute-static.json`内の小田急 | 695提供元便ID、1,633区間。平日369便・土休日326便 | 鉄道会社の運転列車番号・全駅通しダイヤ |
| 提供元ID付き登戸着 | 655便 | 着時刻の別資料との独立照合 |
| 提供元ID付き成城学園前着 | 512便 | 実際の番線・乗換移動時間 |
| 向ヶ丘遊園着 | 0便 | 発時刻や登戸からの所要時間で補完しない |

既存Staticの確認日は2026-09-30、対象日は平日2026-09-30 / 土休日2026-10-04。今日の運行状態を証明しない。1,633区間の起点の駅・種別・行先・カレンダー・発時刻は、別経路のODPT全件と一意一致した。不一致0、曖昧0、隔離0。提供元IDは運転列車番号ではない。全駅の停車・通過、千代田線から同じ列車で継続するか、新宿発との同一便は未確定。

## 判定

- `reconstruct.mjs`: 提供元IDのみで部分区間を結合。ODPT不一致、重複、ID内の矛盾、負の停車時間は便ごと隔離。時間が近い別便に付け替えない。
- `navigation.mjs`: 着時刻で乗換なし/ありを比較。最大2回、120分以内。明示された停車駅のみで乗換し、通過駅は使わない。対象駅着が未取得なら推奨を保留。同着・遅着なら乗換なしを優先。
- 接続は時刻の秒幅（分表示内の0〜59秒）と、ホーム/階移動/エレベーター経由・歩行条件の移動レンジ・追加余裕を合わせて3段階評価する。**0分接続は、発車済みと分かる場合以外はギリギリ**。移動レンジは未実測で、番線は利用者の現地確認を優先。
- 起点の着時刻がない場合のみ、選択中の列車の発時刻を保守的な下車時刻上限として使い、理由に表示。着時刻として保存・表示しない。
- 接続見込みの案と、接続がギリギリの早着案を別枠表示。いずれも接続保証ではない。
- 追越しは明示着発の順序逆転で表示し、具体的な地点・番線を推測しない。
- 位置は明示着発の間の定刻補間。範囲外へ外挿せず、位置不明の自分も別の強調欄に保持する。

このデータは部分区間なので、下北沢・経堂での乗換も含む全体最適を保証しない。向ヶ丘遊園着の実データがないため、遊園の到着比較の完成条件は未達。

## 保存・再現・試験

- `node poc/odakyu/build.mjs`: snapshotのhashを検証し、既存提供元Staticとの照合結果、到着モデル・比較例を`data/model.json`と`data/analysis.json`へ保存する。
- `node --test poc/odakyu/core.test.mjs poc/odakyu/real-data.test.mjs poc/odakyu/navigation.test.mjs`: 旧ロジック境界・保存応答・新しい実便照合・到着比較・接続を確認。
- server起動後`node poc/odakyu/verify-http.mjs`: モデル、2時点readback、公開asset、元データ・認証・serverソース非公開をHTTP確認。Originは`ODAKYU_POC_ORIGIN`で指定。
- 今回の実データ参照値も`data/navigation-reference.json`に置き、Gitへ含めない。比較例と実データ試験にはこのファイルと元snapshotが必要。ファイルがない場合、比較例は利用不可と明示し、別の列車へ自動代替しない。手動選択は維持する。
- `data/`は全てgitignore。元応答、派生JSON、実データgolden、スクリーンショット・テストログを追加commitしない。今回のworktreeに保存済み。Git cloneのみで実データがあるとは扱わない。

ODPT取得は既存`probe.mjs`と`bus/rail/challenge-client.js`を再利用する。`PALURU_CHALLENGE_SECRET_FILE`に既存無追跡ファイルを指定し、`node poc/odakyu/probe.mjs`。通常3GET、明示`--probe-unavailable`時のみ追加2GET。20MB/20秒上限、redirect拒否、無retry、atomic保存とhash再読込。認証値を引数・ログ・画面へ出さない。UTC ISOで取得日時を保存し、画面はAsia/Tokyo。

## 利用条件・変更範囲

新しい依存・認証・スクレイパーなし。既存の個人用保存Staticを読取再利用したもので、新規の許諾を取得したという意味ではない。追加収集・外部公開・再配布はしない。[ODPT限定ライセンス](https://developer.odpt.org/challenge_license)は恒久利用の許可ではない。[小田急公式サイトの規定](https://www.odakyu.jp/policy/index.html)と[リアルタイムサイト](https://www.odakyu-rt.jp/)の無断二次利用禁止を尊重する。資料は存在しても許諾を確認できない経路を継続取得しない。

変更は`poc/odakyu/`だけ。BUS/PWA/GAS/Cloud Run/GCS/本番設定・Service Worker・既存実データは変更しない。既存PR更新のみ、マージしない。リポジトリのCloudflare自動プレビューは`[skip ci]`付きcommitで抑止し、CI設定変更やデプロイ操作はしない。通常のCIを実行した証拠にはせず、ローカル試験と分ける。

受入と残件は[ACCEPTANCE.md](ACCEPTANCE.md)。

### 追加の着時刻照合

任意のローカル `data/arrival-audit.json` があれば、保存Staticと別に公式画面で観察した既存着時刻の一致を検証する（新しい時刻を取り込む処理ではない）。現在の記録は平日3件一致・不一致0。同じ提供元の別取得経路であり、別提供者の資料照合ではない。未配置なら未実施、不正な記録はエラー、不一致便は案内対象外とする。元記録・個別便ID・時刻はGitへ追加しない。`verification.test.mjs` の実データ試験にはこのignored記録が必要。

遊園着がない直接原因は既存Staticビルダーの保存区間制限。公式画面には着時刻があるが、追加の複製・加工の利用許諾は未確認のためアプリDBへ追加していない。現在の完成範囲は登戸への部分静的比較。日常利用する遊園版・新宿同一便追跡は未完成。

## Phase 4：機能とデータを分離

- 使用データで「保存実データ」「デモ」「追加データ」を明示選択。失敗時に別モードへ切り替えない。
- `dataset.mjs` は列車・停車/通過・分単位着発・カレンダー・同一列車継続リンクを検証。`navigation.mjs` は提供元への通信や区間名に依存せず計算する。
- デモは実時刻・実便IDを含まない16区間レコード。新宿発→上原→登戸→遊園の最大2回乗換、直通境界と種別変更を試せる。実運行案内には使用しない。
- `continuation: { station, nextTripId, evidence: 'explicit_same_train' }` が明示され、同一カレンダー・同じ境界駅・単調な着発を満たす場合だけ乗換0回で継続。不明な直通は結合しない。提供元便IDと運転列車番号は別フィールド。
- `reconstructTrips(artifact, model, { segments })` で明示区間設定を受け取れる。既存3区間は既定値として互換維持。BUSの取得ビルダー・本番コードは変更していない。
- 上部に選択列車・目的地・判断・着時刻・短縮・接続確実性を表示。列車選択後は判断へスクロール。前後列車・位置図・乗換駅・根拠は詳細を開く。

### 追加データの入力契約

許諾済みファイルをローカル `data/additional-dataset.json` に配置し「追加データ」を選択する。配置・契約は今回実施していない。`schemaVersion:1`, `kind:'additional'`, 固有の`id`, `timezone:'Asia/Tokyo'`, `stations:[{id,name,index}]`, `trips`, `rights` が必要。各tripは`id, calendar, type, destination, origin, identityBasis:'explicit_trip'または'provider_id', knownPasses:[], stops:[{station,index,arrival,departure,stop,platform}]`。時刻は営業日開始から単調になる整数分（0〜2879）、不明はnull、通過行はstop:falseで着発null。推測便結合は禁止。

`rights` は`status:'confirmed', useScope:'local-only', evidenceRef:'許諾確認記録への参照', validUntil:'期限を表すISO日時'`。この記録は利用者が確認した許諾条件の申告であり、プログラムが許諾を発行するものではない。期限切れ・記録不足・時刻矛盾・ID重複・循環リンクはエラー。証拠参照自体は画面APIへ返さない。`title`, `serviceDates`, `coverage`, `example:{selectedId,compareAt}` は表示用の任意項目。追加データも自動でDaily Readyにはしない。元データ・許諾文面・認証をGitに追加しない。

デモの純粋機能試験は実データなしで実行可能：`node --test poc/odakyu/dataset.test.mjs poc/odakyu/reconstruct.test.mjs`。ローカルserverは実データ未配置でもデモのAPIを利用可能（画面で明示選択が必要）。

利用条件、申請先、未送信の問い合わせ文面は[DATA-ACCESS.md](DATA-ACCESS.md)。Function Complete・Data Coverage・Daily Readyは独立して評価する。特に既存Staticの存在は恒久利用の許諾証明にならない。
