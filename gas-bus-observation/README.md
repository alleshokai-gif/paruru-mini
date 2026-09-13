# PALURU Bus Observation Calibration GAS

Observation専用Spreadsheetの日次集計だけを行う。PALURU Mini、Bus API、PWA、本番policyは変更しない。

1. Script Property `PALURU_BUS_OBSERVATION_SPREADSHEET_ID`へ対象Spreadsheet IDを設定する。
2. `setupBusObservationSheets()`を一度実行する。
3. Cloud Run Job用service accountを対象Spreadsheetの編集者として共有する。
4. `runDailyBusObservationCalibration('YYYY-MM-DD')`で手動受入する。
5. 問題がなければ`installBusObservationDailyTrigger()`でAsia/Tokyo 20:45ごろの日次triggerを1件作成する。trigger自体は毎日起動し、`runWeekdayBusObservationCalibration()`が土日をskipして平日の当日分だけを集計する。

RawとDailyのheader不一致は自動修正せず停止する。Dailyは`local_date + provider + direction_id + route_id + origin_stop_id + platform`を論理一意keyとしてupsertし、既存`summary_id`を維持する。同じ論理keyが複数ある場合は停止する。Calibration候補をproduction設定へ自動反映せず、レビュー条件が別途成立するまで`calibration_ready=false`を維持する。
