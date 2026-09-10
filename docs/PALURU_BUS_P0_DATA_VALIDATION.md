# PALURU Bus P0 実データ検証記録

- 記録日: 2026-09-07、Asia/Tokyo
- 状態: **途中。検証準備・合成試験まで。ODPT本体は未取得**
- 判定: **実データのGO判定は保留／本番P0実装開始はNO-GO（証拠不足）**
- 阻害要因: `ODPT_ACCESS_TOKEN` が未設定。`--check-config` は `ODPT_ACCESS_TOKEN_MISSING` で停止した。API拒否・データ非提供を観測したわけではない。
- 実データ観測日時・サンプル数・更新周期: **未観測**。未取得を0件・0秒として扱わない。
- 設計正本: [PALURU_BUS_P0_DESIGN.md](PALURU_BUS_P0_DESIGN.md)
- 今回の範囲: `bus/` の秘密管理・最小観測ツール・合成試験、設計/検証Markdown。本番UI・Provider・Worker・deployは対象外。

## 1. 使用する公式データと取得状態

2026-09-07にカタログで次の公開を再確認した。認証付きZIP/Protobufの内容確認とは別の証拠である。

| データ | 公式公開元 | 今回の本体取得 |
| --- | --- | --- |
| Static GTFS/GTFS-JP | [川崎市バス時刻表カタログ](https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines)、表示版 `20260828` | 未実施 |
| TripUpdates | [川崎市バスRTカタログ](https://ckan.odpt.org/dataset/odpt_transportation_bureau_city_of_kawasaki_all_lines)、[TripUpdatesリソース](https://ckan.odpt.org/dataset/odpt_transportation_bureau_city_of_kawasaki_all_lines/resource/dc831adb-163f-4383-abdc-419d88a7b5f6) | 未実施 |
| VehiclePosition | 同RTカタログ、[VehiclePositionリソース](https://ckan.odpt.org/dataset/odpt_transportation_bureau_city_of_kawasaki_all_lines/resource/058d7e67-ca78-46a3-ab6b-9d425c7018e3) | 未実施 |

APIのホストは `api.odpt.org`。キーなしの取得先パスを検証スクリプトの定数として管理する。

```text
/api/v4/files/odpt/TransportationBureau_CityOfKawasaki/AllLines.zip
/api/v4/gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_trip_update
/api/v4/gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_vehicle
```

静的版は調査時版を引数 `--static-date` で指定する。本番で `20260828` を永久固定する設計ではない。
カタログの「一体となったデータ」の説明だけで両RTリソースが同一内容とは判断しない。実際のentity種別・件数・hashを観測する。
今回はAlertを追加取得しない。TUの運休/スキップ等は観測するが、Alertを含む本番の運休・迂回受入は未実施。

### 利用条件と秘密管理

- 採用経路は、川崎市交通局がODPTで公開した正規API。HTMLスクレイピングや市バスナビ内部通信へのfallbackは実装しない。
- カタログの適用ライセンスは [公共交通オープンデータ基本ライセンス](https://developer.odpt.org/terms/data_basic_license.html)。[センター利用規約](https://developer.odpt.org/terms/center_use_rules.html)・[開発者ガイドライン](https://developer.odpt.org/terms/data_basic_use_guideline.html)を含む初回調査は設計書5節に記録済み。
- 正規キー使用の指示は受領済み。キーの登録状況やアカウント個別の条件は今回確認していない。正規APIの存在を根拠に、あらゆる取得頻度・再配布方法が許可されるとは判定しない。
- `bus/.dev.vars` はローカル専用。値なしの `bus/.dev.vars.example` のみGit対象とする。`.dev.vars` と派生ファイルは `bus/.gitignore` で除外し、Git未追跡も確認した。
- スクリプトはキーをコマンド引数で受け取らず、値・認証付きURL・例外本文・レスポンス本文を出力しない。HTTP redirectは追従しない。失敗は安全なコードだけ出して停止する。
- 全線ZIP/RTレスポンスはメモリ内で解析し、全文を保存しない。証拠は対象停留所/便の必要部分と集計だけ。車両識別子は証拠出力から除外する。
- 本番キーはWorker Secretで管理する。本フェーズでCloudflare Secret作成・deploy・Git commit/pushは行っていない。

## 2. 4方向の正式ID・のりば

**GTFSの正式IDは未確定。** 公式バスナビで確認した画面用 `signPoleKey` を `stop_id` として流用しない。
名称は候補抽出だけに使用する。tripの停留所順・乗降可否・座標・親stop・`platform_code` の照合まで必要。

| 方向 | 正式 boarding stop_id / のりば | 正式 alighting stop_id | route_id / route名 | trip_id / stop_sequence |
| --- | --- | --- | --- | --- |
| 神木本町→登戸方面 | 未観測 | 未観測 | 未観測 | 未観測 |
| 神木本町→溝の口駅南口方面 | 未観測 | 未観測 | 未観測 | 未観測 |
| 登戸→神木本町 | 未観測 | 未観測 | 未観測 | 未観測 |
| 溝の口駅南口→神木本町 | 未観測 | 未観測 | 未観測 | 未観測 |

公式バスナビでの名称は「登戸駅（生田緑地口）」「溝口駅南口」。GTFSでの正式表記は未確認。
同名の全標柱を一括で乗車対象にせず、同じtrip内で乗車stop→降車stopの順に通る組合せだけを証拠に残す。
往復、経由違い、同一stopの再訪、駅の乗車側/降車側を区別する。帰りは「神木本町」の終着headsignだけを検索しない。
`platform_code` が欠損する場合は欠損のまま記録し、IDの末尾や座標から番号を作らない。

## 3. TripUpdates・VehiclePositionの充足状況

| 方向 | TU対象trip / 乗車stop直接更新 | time / delayの内訳 | VP→TU→Static結合 | stopsAway / 区間 | 有効な次便 |
| --- | --- | --- | --- | --- | --- |
| 神木本町→登戸 | 未観測 | 未観測 | 未観測 | 未観測 | 未観測 |
| 神木本町→溝口駅南口 | 未観測 | 未観測 | 未観測 | 未観測 | 未観測 |
| 登戸→神木本町 | 未観測 | 未観測 | 未観測 | 未観測 | 未観測 |
| 溝口駅南口→神木本町 | 未観測 | 未観測 | 未観測 | 未観測 | 未観測 |

実取得後は以下を更新する。

- TU: `trip_id`、`start_date`、`start_time`、`route_id` の存在率、対象便数、対象乗車stopの直接更新数、`stop_id` / `stop_sequence`、arrival/departure別の `time` / `delay` の存在率。
- VP: `trip_id`等、`current_stop_sequence`、`current_status`、`stop_id`、lat/lon、timestamp。フィールド未設定とProtobufの既定値を区別する。
- 便照合: `FeedEntity.id` で結合しない。運行日・便インスタンスの一意性を検証する。頻度運行、同一ID重複、日付不一致、経路不一致は未解決として残す。
- `futureDepartureCandidate` は観測用の時刻条件。鮮度の受入とは別であり、このフラグだけでUI表示可能/GOとは判定しない。

## 4. Staticとの時刻結合

算式の合成試験は実施したが、川崎市バス実データでの成立は未確認。
同じ便・運行日・乗車stop・イベント（arrivalまたはdeparture）を使用する。[GTFS-RT Reference](https://gtfs.org/documentation/realtime/reference/)

| 項目 | 検証方法 | 現状 |
| --- | --- | --- |
| scheduled | stop_timesの当該イベント時刻＋運行日。calendar/calendar_datesを解決 | 合成試験のみ |
| estimated | TUのtimeを優先。time欠損・delayありならscheduled＋delay | 合成試験のみ |
| delay | estimated−scheduled。同イベントの配信delayがあれば一致を検算 | 合成試験のみ |
| etaMinutes | `ceil((estimated−now)/60)`。負の差は過去イベントとして除外 | 合成試験のみ |

静的時刻・運行日はAsia/Tokyo。計算はepoch秒、証拠出力は `+09:00` 付きISO。
`24:xx` 以降は元の運行日から翌暦日へ換算する。arrivalの遅れをdepartureの遅れと混同しない。
配信delayとtimeの矛盾、片方だけの配信、両方欠損をそれぞれ記録する。欠損delayを0にしない。
定刻を過ぎた遅延便は、RTの未来のestimatedが有効なら時刻条件で残す。すでに過ぎたestimatedを「あと0分」で残さない。

## 5. 「何停前」「停留所間」の再構成

実データでの可否は**未確認**。今回の合成試験で検証した定義は次のとおり。

- 生の `target stop_sequence − current_stop_sequence` を `rawSequenceDelta` として保持する。
- 停留所列をsequence順に並べ、欠番がある場合は整数の差ではなく配列内の区間数を数える。
- `STOPPED_AT`: 現在停留所上。対象index−現在index。当停留所上は0。
- `IN_TRANSIT_TO`: 現在sequenceの停留所へ向かう区間。確定した直前停留所から対象までの区間数。当停留所への区間なら1。
- `INCOMING_AT`: 現在sequenceの停留所へ接近中。数える区間は上記と同じだが、「接近中」と明示して停車中と区別する。
- `current_status` 未設定時は、sequenceがある場合の仕様上の既定値 `IN_TRANSIT_TO` を適用し、未設定だった証拠を残す。川崎市が明示的に配信した値とは扱わない。
- sequence未設定、stop_idとsequenceの不一致、迂回/スキップで隣接関係が不確か、始発より前で直前停留所がない場合は区間数を作らない。対象通過済みは別状態にする。
- 座標の近さやETAから停留所区間を推測しない。区間中央に置くアイコンは模式表現で、移動距離50%の意味にしない。

この定義は公式ナビの「N個前を通過」と同一とは未確認。実データと公式画面の照合後に表示文言をレビューする。
最新のUI指定は設計書9節へ反映した。4方向共通の案内板に先発順3便（系統・行き先・予定出発時刻・のりば）、最下段に現在1位だけの位置を表示する。
順位の変更と位置欄を同時に更新する。順位逆転の実観測、同じ経路での進捗比較可能性は未確認。

## 6. 欠損・例外・更新周期

### 実データで確認した欠損

**まだない。未取得であり「欠損なし」ではない。**

観測ツールが区別するもの:

- timeだけ / delayだけ / 両方 / 両方なし、arrival/departure片側のみ、配信delayと計算delayの不一致。
- 対象trip自体が未配信、対象stopの直接更新がない、同一stop再訪の曖昧さ、NO_DATA/SKIPPED/非SCHEDULED。
- VPなし、trip識別不十分、座標のみ、sequenceなし、status未設定、timestampなし、対象停留所通過済み。
- 非標準/差分feed、頻度運行、運行日不明、カレンダー不一致、改正版とのID不一致。

対象stopへの直接更新がない場合、今回の最小ツールは遅延伝播を実装せず不足として残す。
仕様に従う伝播が可能かを原データの必要範囲で追加確認するまでは、「予測非対応」と結論しない。
当日便が少ない時間帯の0件とデータ非提供も区別する。

### 更新周期の観測計画

初回は静的1回＋RT2種を20秒間隔で4snapshot（通常9要求、約60秒＋通信時間）。失敗時は自動retryしない。引数の上限は6snapshot/間隔15〜60秒。
実行時の適用アクセス条件がこれより厳しい場合はそちらを優先する。

記録対象は取得時刻、feed timestamp、entity種別件数、対象便TU/VP timestamp、内容hashの変化、対象便の停留所状態。
hash変化だけを車両移動と判定しない。20秒の観測間隔を上流の20秒生成周期とも判定しない。
RT2種は順次取得のため完全同時snapshotではなく、両方の取得時刻・上流時刻差を確認する。

| 観測事項 | 結果 |
| --- | --- |
| 初回/最終の実データ取得日時 | 未実施 |
| RT2種の上流timestamp差分 | 未観測 |
| 対象4方向のentity更新・位置進行 | 未観測 |
| 上流遅延・停止・欠落の継続 | 未観測 |
| 15秒pollingの妥当性 | 未判定 |

GO-Aの「安定」は短時間の全線取得成功で代替しない。4方向それぞれの実際の接近便を複数snapshotで観測し、必要なら運行時間帯を変えて追加観測する。無人継続収集や定期実行は追加しない。

## 7. GO判定

| 判定 | 条件 | 今回 |
| --- | --- | --- |
| 共通最低条件 | 4方向すべてでscheduled＋次便判定 | 未実証 |
| GO-A | 4方向でestimated・delay・位置/stopsAwayが安定 | 未判定 |
| GO-B | estimated/delayが成立し、一部位置のみ欠損 | 未判定 |
| GO-C | Staticだけ安定。時刻表P0は可能、RT P0はNO-GO | 未判定 |

現時点は**証拠不足により実装開始NO-GO**。GO-Cと判定できる静的データの証拠もない。
これは「ODPTが取得不能」「川崎市バスがRT非対応」という結論ではない。

P0 Acceptance 1/2/7〜11は本番UI/Worker未実装。3〜6は実データ検証待ち。12は正規経路・条件の初回調査までで、今回の本体取得や本番公開の受入PASSではない。

## 8. 変更・ローカル確認・次の作業

### 変更内容

| ファイル | 目的 |
| --- | --- |
| `bus/.gitignore` | `.dev.vars`・ローカル仮想環境・Pythonキャッシュを除外 |
| `bus/.dev.vars.example` | `ODPT_ACCESS_TOKEN` の空値テンプレート |
| `bus/requirements-validation.txt` | 公式GTFS-Realtime PythonバインディングとProtobufを固定 |
| `bus/validate_odpt.py` | メモリ内取得/解析、固定4方向の証拠集計、取得回数上限、秘密を含まない出力 |
| `bus/test_validate_odpt.py` | 実データを含まない合成試験 |
| `bus/README.md` | 秘密設定と再現手順、観測ツールの限界 |
| `docs/PALURU_BUS_P0_DESIGN.md` | ユーザー指定の案内板UIと先発位置表示を反映 |
| この文書 | 実証/未確認、GO判定、次の観測の記録 |

ローカルだけに空値の `bus/.dev.vars` と `.venv/` を作成した。キー設定はユーザー待ち。
今回追加するのは検証用CLIであり、PALURU API/DTO・GAS・PWA・SW・Build・既存データの変更はない。
追加前からの `gas-family-inbox/FamilyInboxWorkerService.js` の差分は対象外として維持した。
ロールバックは今回の検証ツール/文書差分に限定する。秘密ファイルや他タスクの変更を削除・巻き戻ししない。

### 確認結果

- Python 3.14.3、`gtfs-realtime-bindings==2.2.0`、`protobuf==7.36.1`。インストール先はGit除外済みの `bus/.venv/`。
- 合成試験 **11件PASS**。標柱差分/方向、乗降条件、運行例外・24時超・翌日次便、欠損と0、time優先、過去除外、状態別sequence/欠番、再訪stop、Protobuf結合、日時不一致、秘密出力防止、redirect拒否を確認。
- Python構文確認PASS、`git diff --check` PASS。
- `.dev.vars` と `.venv/` のGit除外、`.dev.vars` 未追跡を確認。
- 正規キー有無の安全な事前確認で停止。実APIの認証/HTTP/データ/4方向の実動作は未検証。
- 既存Repository全体テスト・実ブラウザ/PWA受入・Android実機・本番deployは未実施。合成試験をP0受入の代わりにしない。

### 次の最小ステップ

1. ユーザーがローカル `bus/.dev.vars` へ正規キーを設定する。値はチャットへ送らない。
2. `--check-config` の後、[READMEの検証手順](../bus/README.md)でStatic＋RTを有界観測する。
3. この文書2〜7節を、取得日時・4方向ID/のりば・対象便の最小証拠・欠損・周期の実測値へ更新する。名称だけで本番設定を確定しない。
4. 疎なTU、ID差異、乗り場欠損など観測された差分だけ追加検証する。未観測の穴を推測で埋めない。
5. GO-A/Bと設計レビューを通過後、固定4方向設定＋Kawasaki Adapter＋Bus Core＋独立Worker APIが最小実装単位。その後、共通のスマホ案内板カードとPALURU入口を追加する。
6. ユーザー本人のdeploy後に、4方向・先発順位逆転と位置欄一致・欠損表示・15秒更新/非表示停止・他機能への影響を実ブラウザ/PWAで受入確認する。

現時点では2以降の実データ依存作業と本番実装は保留。
