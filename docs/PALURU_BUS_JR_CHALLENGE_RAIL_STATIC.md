# JR南武線 Rail Static / Challenge補正（Preview）

## 境界

- 対象は南武線本線の立川発12:00以降、立川→登戸→武蔵溝ノ口を同一列車で通る平日・土休日便。
- `bus/scripts/build-jr-nambu-static.js` がChallenge `odpt:TrainTimetable` を更新時だけ取得し、`bus/generated/rail-nambu-challenge-static.json` を生成する。この生成物はGit管理外・サーバー側に置く。生feedは保存しない。
- `bus/rail/rail-static.example.json` は小田急のユーザー管理サンプルのみ。架空の南武線便は含めない。
- `odpt:departureTime` だけを `stationTime` として保持し、`stationTimeSource=departure` を明示する。到着時刻は作らない。駅の発時刻に乗換時間を加える比較は保守的な代用であり、着時刻の予測ではない。
- 南武線の実順序は立川→登戸→武蔵溝ノ口。23時台発で日付を跨ぐ列車も翌日の駅時刻に展開する。
- `bus/rail/jr-challenge-provider.js` はサーバー側でのみ `odpt:Train` を読む。`事業者+路線+運行日+列車番号` が一意、timestampが120秒以内かつ有効期間内の場合だけ位置とdelay秒を付加する。遅延が正なら、各 `stationTime` にその秒数を加えて「遅延に基づく見込み」と表示する。stale・曖昧・未照合はStaticに戻す。
- Challenge credentialは `ODPT_CHALLENGE_ACCESS_TOKEN` のみ。ローカルでは `PALURU_CHALLENGE_SECRET_FILE` が指す非追跡ファイルからそのキーだけを読む。`ODPT_ACCESS_TOKEN` は使わない。PWAへtoken・生feedを渡さない。
- GTFS-RT TripUpdate、小田急Challenge、鉄道自動同定、production API/PWAは対象外。

## 更新とPreview

`PALURU_CHALLENGE_SECRET_FILE` またはサーバー環境の `ODPT_CHALLENGE_ACCESS_TOKEN` を設定した上で、`node bus/scripts/build-jr-nambu-static.js` を実行する。既存生成物と列車を比較し、追加・削除・変更が0件なら書き換えない。列車番号、発時刻、対象駅の発時刻、種別、行先の変更を確認してからPreviewを受け入れる。

Previewは `bus/scripts/preview-product-acceptance.js` を使う。大学は従来のユーザー管理Static、 高校は生成済み南武線Staticを読み込む。Challenge Realtimeが取れない場合も高校列車選択はStaticで動く。Previewのバス比較は既存GTFS Staticを使い、Publicへは出さない。

## 未確定・安全境界

- Challengeの生成物をproduction配布してよいか、運用期間や公開範囲はこのPreviewでは判定しない。
- 土休日はSaturdayHoliday区分。平日に重なる祝日は明示的なcalendar overrideがない限り自動推測しない。Public採用前に休日指定の運用が必要。
- 駅の着時刻がないため、乗換余裕や最速判定は発時刻を基準とする。結果に「着時刻未提供」を表示する。
- 時刻表更新は手動・差分確認。通常の帰宅画面からTrainTimetableを毎回取得しない。
