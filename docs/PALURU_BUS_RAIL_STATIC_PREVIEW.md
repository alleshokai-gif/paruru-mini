# 帰宅最速 v1 Rail Static Preview

鉄道時刻はユーザー管理のローカル設定データとして扱う。PALURUは画面表示時に鉄道会社サイト、Google Routes API、非公開APIへアクセスしない。時刻の入力元と正確性はデータを登録するユーザーが確認する。サンプルは**架空時刻**であり、実際の乗車判断に使用しない。

## 入力と更新

- 入力例: `bus/rail/rail-static.example.json`。`sample: true` の68件は大学・高校ルートの平日／土休日UI確認用。
- Previewは起動時に `PALURU_RAIL_STATIC_PATH` が指定されていればそのJSONを読み、未指定なら入力例を読む。各リクエストで再読込するため、編集後のサーバー再起動は不要。
- `schemaVersion: 1`、`timezone: Asia/Tokyo`、`management: user`、`timetableVersion`、`calendarOverrides`、`trains` を保持する。祝日などの日付別区分は `calendarOverrides` でユーザーが明示する。推測で祝日ダイヤへ切り替えない。
- 各列車には `provider`、`route`、`calendarType`、`sourceStation`、`sourceDeparture`、`candidateStations`、`trainType`、`destination`、`internalTripId` を登録する。駅の順序、時刻の前後関係、ID重複を検証し、不整合時は候補を表示しない。
- 現在時刻より前に発車した列車も、最初の比較駅への到着前なら候補に残す。初期5件を表示し、「前の列車」「次の列車」で範囲を移動できる。

## Preview

`node bus/scripts/preview-product-acceptance.js` でPALURUに近い画面をローカル起動する。`?case=five` は大学、`?case=tie` は高校を初期選択する。再現用の時刻は `&at=2026-09-28T17%3A30%3A00%2B09%3A00` のように指定できる。`at` を省略すると現在時刻を使う。

列車選択後、候補駅の到着時刻を既存Home Route Coreへ渡し、駅ごとの乗換時間、Future Bus Query、神木本町到着時刻を比較する。Previewのバス比較には既存の川崎GTFS Staticを用い、東急の未来時刻ソースは取得不能として `partial` を維持する。通常Busカードはvalidation APIを参照する。Previewの結果は架空の鉄道時刻とStaticバス時刻に基づくため、運行予測として公開しない。

本番用のRail Staticデータは未登録。production deploy、main統合、GitHub Pages公開はこのPreview Acceptanceに含めない。
