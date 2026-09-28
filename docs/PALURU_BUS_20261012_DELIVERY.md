# PALURU Bus: 2026-10-12までの観測判定と実用機能開発

更新日: 2026-09-28 JST。観測中心フェーズは2026-10-12で終了する。以後の観測継続はGO / LIMITED GO / HOLDの判定を延期する理由にしない。本書は開発計画と現時点の証拠であり、Public Positionや実発車予測の公開承認ではない。

## 依存関係と実装境界

| 順序 | 成果 | 依存 | 現在の範囲 |
| --- | --- | --- | --- |
| 1 | 観測基盤の一意性、日次と累積評価の分離 | 保存済み観測と既存schema | ローカル修正。Job/Sheetは未変更 |
| 2 | バスロケv1 | 検証済みgeometry、Position Engine | Shadow UIの部品と安全gate。Public flagはOFF |
| 3 | 登戸駅多摩川口 | 公式GTFSのstop/trip列 | 独立query、乗り場、強調badgeをローカル実装 |
| 4 | 未来時刻のバスと帰宅時刻 | Static stop_times、既存RT | CoreのローカルPoC。Public API未接続 |
| 5 | 大学・高校からの帰宅比較 | 4、列車選択、出口別乗換時間 | 固定経路の比較Core/UI部品。鉄道ProviderとPublic mountは未実装 |

観測基盤の改善は2〜5のローカル実装を止めない。各機能の本番公開は、正規データの利用条件、実ブラウザ・実機受入、既存APIとの統合を別途確認して判断する。外部deploy、production設定変更、credential作成・変更は本フェーズで行わない。

## 2026-09-28に保存済みSheetから読み取った実績

対象は既存の `Bus_Position_Evaluation` / `Bus_Position_Daily` / `Bus_Preorigin_Daily` / `Bus_Observation_Daily`。ブラウザ上の保存済みセルを読み取り専用で集計した。Raw行の再保存やSheet変更はしていない。

### Preorigin

- 9/17、18、24、25、28は各29 execution成功、target 12便を観測。Daily上のactual observation samplesは各279。9/21〜23は各29 execution成功だが `NO_TARGET_SERVICE` で観測run 0。0件を故障と同一視しない。
- 9/24は `OBSERVATION_ID_CONFLICT` のためDaily判定 `NO_GO`。保存済みRawでは、異なるrun/sample/timestampの `target_snapshot` が同じIDになった2組を確認済み。ID生成材料にrun/sample/observed_atが欠けていた。ローカルのID生成を保存行全体ベースに変更し、同一行のretryのみ同一IDとなるテストを追加。既存Rawは変更しない。
- 9/28 Dailyは29 execution成功、28 observation runs、actual samples 279、target 12便、Level A 0、Level B 0、transition 0、HOLD。9/17・18・24のLevel B候補はそれぞれ6・2・1件。Level Cは自動判定しない。
- 9/28までのDailyには `RUN_OVERLAP`、`SAMPLE_SOURCE_MISMATCH`、`SCHEDULER_SCHEDULE_TIME_MISSING` 等が残る。Rawへ0行を書くsampleを欠測扱いした評価ロジックはローカルで修正済みだが、Evaluator Jobは未deployのため保存済みDailyの過去判定は変わらない。5分cronに対して10回×32秒とfetch/書込時間が重なる可能性がある。overlapそのものを一意性破壊と断定せず、10/12に新IDでの重複・欠測を再評価する。

### Position (登05、route 10044、神木本町→登戸)

- 9/16〜25の8日、derived観測1,071行、124 trip-day。stop interval 0〜18の19区間すべてを複数日合算で観測。snap距離の有効値850点、p50 1.816m、p95 37.235m。
- directionはforward 335、unknown 728、reverse 8。`trip_geometry_mismatch` 200、`duplicate_timestamp` 190、`low_confidence` 84、`off_route` 12、`route_crossing_ambiguous` 2。mismatch 200点は6 tripへ集中し、Position Staticのchain `09c16672dfa79bdef71332c7` に156点、`1d80d827989eba72dd7101be` に44点。既存artifactのchainは `3210f931a9a1b9423c1259be` なので、route IDだけでgeometryを共有できない。異なるpatternはPublic表示から除外する。
- Dailyは単日監視のため、毎日 `MULTI_DAY_COVERAGE_INSUFFICIENT` を出しても複数日判定には使えない。新しい累積関数は保存済みderived rowをroute/direction/chain別に集計し、日数、trip-day、19区間union、mismatch、reverse、unknownを別評価する。現時点の関数はPublic flagを昇格させず、公式表示との照合と閾値校正がない限りHOLDを返す。既存Cloud Run Jobへの接続と保存先は未実装。
- artifactの `approvedForShadow=true` と `approvedForPublic=false`、`geometryReady=false` を混同しない。全19区間の合算coverageだけでPublic GOとはしない。

### Departure Confidence

- `Bus_Observation_Daily` は保存済み249 summary IDがすべて一意。route/origin/platform別の累積は、登戸始発 `10044/362_1` がpositive 28・censored 158、溝の口始発 `10033/434_2` が33・229、`10036/434_3` が27・360。件数20を超えた群でも `calibration_ready=true` は0。各routeの誤残存・誤除外や分布を未レビューのまま閾値へ反映しない。
- その他の溝の口始発routeはpositive 20未満の群がある。登戸低頻度便に他routeの閾値を流用しない。現在の自動観測は継続するが、帰宅最速v1のCore PoCを止めない。

## 10/12の判定規則

| 対象 | GO | LIMITED GO | HOLD |
| --- | --- | --- | --- |
| Position | 複数日・複数便で全区間を検証し、high-confidenceの公式表示一致と重大誤判定率を十分な分母で確認 | patternを限定し、unknown/矛盾/古いGPSを抑止した家族Shadow利用 | mismatchや方向矛盾を分離できない、または公式照合が不足 |
| Departure Confidence | origin別にpositive/censored/誤判定を確認し、校正閾値を検証 | overdue/uncertainの安全表示だけを利用し、実発車時刻は非公開 | 誤残存・誤除外の危険を評価できない |
| Preorigin | 一意ID、欠測とskipの区別、vehicle→target tripの同一HMAC遷移を実証 | 観測基盤だけ継続し、Level A未取得を明示 | ID衝突やRaw破損が再発、pipelineの信頼性不足 |

10/12に必ずどれかを選び、観測延期を結論にしない。HOLDでも安全gate付きの範囲だけを個別に扱う。Level Cは自動生成しない。

## バスロケv1と帰宅最速v1の安全境界

Position Shadow UIは `PALURU_BUS_POSITION_SHADOW_ENABLED=false` が初期値。artifactのShadow承認、geometry version、GPS鮮度、engine confidence、方向・trip整合を満たした時だけ停留所名と候補stopsAwayを描く。失敗時は「位置確認中」。raw GPS、vehicle ID、sequence単独推定をPublic DTOへ出さない。既存Public Position UIもOFFを維持する。

多摩川口は登05の通常登戸駅と別query・別乗り場として扱い、Hub便の `areaBadge=多摩川口` で混同を防ぐ。公式GTFSの登06 route 10045、`184_2→365_1` と `365_2→184_3` を使用。出発前後の徒歩時間は別入力とし、未計測値を推測しない。

Future Bus Queryは選択列車の駅到着時刻に乗換時間を足した `boardingAt` 以後のStatic/RT候補を返す。GTFS到着時刻が欠ければ神木本町到着はnull。RTの発車遅延だけで到着を補正した時は `departure_delay_projection` と明示し、直接の到着予測と区別する。未発車の可能性がある始発時刻超過便は参考候補として保持できるが、`recommendable=false` にする。

大学は登戸（通常/多摩川口）と向ヶ丘遊園、高校は登戸（通常/多摩川口）と武蔵溝ノ口を固定比較する。鉄道ProviderはBus Coreに混ぜない。v1はユーザーが列車を選び、駅ごとの到着時刻と出口別の実測乗換時間を入力する設計。小田急・JR東日本のODPT駅時刻表はChallenge 2026限定ライセンスで、Public PWAへの利用可否は未確定。公式アプリの内部通信を流用しない。

参考: [小田急ODPT駅時刻表](https://ckan.odpt.org/dataset/odakyu__r_station_timetable)、[JR東日本ODPT駅時刻表](https://ckan.odpt.org/dataset/jreast__r_station_timetable)、[小田急公式時刻表一覧](https://www.odakyu.jp/station/timetables-download.html)。

## ローカル受入と未接続箇所

Core/Hub/Static/Shadow UI部品は合成ケースで自動テスト済み。9/28には別ポートの一時HTMLで実ブラウザを開き、390px幅のHub行と帰宅比較部品について、多摩川口badge、位置区間と「位置確認中」、時刻表品質、2経路と5分差、カード内横はみ出しなしを確認した。一時HTMLは確認後に削除した。これは合成データによる**部品受入**であり、PALURU本体画面・実ODPT・Android実機の受入ではない。

現時点でPublic APIへのFuture Bus・帰宅比較・Position Shadowの接続、鉄道候補の正規Provider、出口別乗換時間の計測、P3.3累積Evaluatorの自動Job接続は未実施。したがってPublic機能の完成・deploy GOとは報告しない。

Repository full testには今回差分より前から3件のbaseline failureが残る。Bus全体テスト、対象テスト、Static preflight、diff/secret scanを個別に記録し、baseline失敗をPASSに読み替えない。
