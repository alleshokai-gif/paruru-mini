# PALURU BUS ダイヤ更新

毎日 03:15 JST に、既存の Scheduler 実行IDが Cloud Run Job
`paluru-bus-schedule-refresh` を起動する。Job は既存の ODPT Secret を使う。
API イメージに取得・ZIP 展開の処理は含めない。

- 川崎：ODPT公式カタログの日付版を確認し、更新時に P0、経路比較、位置データを同じZIPから生成。
- 西武：既存の公式GTFSをETagで確認。対象路線だけをストリーミング解析し、既存GTFS-RT結合を使用。
- 東急：既存ODPT APIの標柱時刻表と便時刻表を日次照合。提供済みの現行データを対象とし、個別の施行日が返らない場合に公表日を改正日とみなさない。バス接近取得は従来のまま。

3社それぞれ、検証に通った内容をハッシュ付きの変更不可キーに保存し、その後に
`schedules/v1/<provider>/state.json` を GCS の世代番号条件付きで置換する。
将来版は始発時刻まで保留し、失敗時は適用版を保持する。API は1分を目安に
状態を読み、内容ハッシュと成果物を検証してから同じリクエスト内で一貫した版を使う。
API起動・ヘルスチェックでは外部取得しない。初回APIリクエストの保存先確認は最大1.2秒。

保存先は `gs://paluru-bus-static-schedules-20261106`。非公開で、既存 API 実行IDは
読み取り、既存観測ジョブ実行IDはオブジェクト更新のみ。Secret 値や車両 ID は保存しない。
APIの `schedule` は適用版・適用日時・取得時刻・内容ハッシュ・更新確認状態を返す。

## 復旧

Cloud Run のコード障害では直前の確認済みリビジョンにトラフィックを戻す。
データだけを戻すときは、以前の検証済みデータが期限内であることを確認してから、
更新ジョブを `--args=refresh/run.js,rollback,kawasaki` で一度実行する（事業者IDは
`kawasaki` / `tokyu` / `seibu`）。旧版で保持し、`resume` を実行するまで日次処理は
上書きしない。期限切れ・ハッシュ不一致の版へは戻さない。

## 11月1日の照合

- 本番旧イメージの川崎は `20260701_20260928`、西武は `20260824`（10月31日まで）。
- 新しい公式GTFSは川崎 `20261101_00000000`、西武 `20261019`（11月1日〜12月31日）。
- 4方向の比較は改正前後の平日・土曜・休日の実運行日を用いた。便IDが変わるため、時刻差から便の同一性は推定していない。
- 登戸発・鷲ヶ峰営業所前行きの休日13便は [市バスナビ](https://kcbn.bus-navigation.jp/wgsys/wgp/timeTableRouteTabFileHtml.htm?localeLang=ja&name=00362_01_2_3.html&nextDiagramFlag=0) と新版GTFSで一致。
- [川崎市の改正告知](https://www.city.kawasaki.jp/820/page/0000190492.html) / [ODPT川崎GTFS](https://ckan.odpt.org/dataset/transportation_bureau_city_of_kawasaki_all_lines) / [ODPT西武GTFS](https://ckan.odpt.org/dataset/seibu_bus__b-bus_gtfs) / [ODPT東急標柱時刻表](https://ckan.odpt.org/ja/dataset/tokyu_bus__b-busstop_timetable)
