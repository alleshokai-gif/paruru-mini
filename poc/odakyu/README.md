# 小田急 乗換ラボ（独立ローカルPoC）

実際に取得したODPTの駅時刻表を保存・再読込し、19駅の縦型位置図と、乗換最大2回・120分以内の**発時刻の参考比較**を行う。列車位置は補間推定であり、リアルタイム位置・列車ID・到着時刻・遅延・接続保証は取得できていない。元のPALURU本番コード・API・GAS・Cloud Run・GCS・Service Workerは変更しない。

## 起動・再現

リポジトリのrootで `node poc/odakyu/server.mjs`。既定URLは http://127.0.0.1:8767 。`ODAKYU_POC_PORT`で変更可能。外部インターフェースへbindしない。

画面の「実データ比較例を再生」を押す。平日08:09新宿発の各停を手動選択した状態で08:15を再生し、登戸の発時刻08:49と、代々木上原08:24発快速急行に乗り換える仮説の登戸発08:38を比較する。11分は**発時刻差**であり、着時刻短縮ではない。向ヶ丘遊園へ切り替えた場合、同じ列車選択では短縮候補なし。快速急行の遊園通過を到着として補完しない。

## データ更新

既存ODPTチャレンジ認証を使用。`PALURU_CHALLENGE_SECRET_FILE`に、既存の無追跡ファイルへのパスを設定し、`node poc/odakyu/probe.mjs`を実行する。既存`bus/rail/challenge-client.js`の認証読込を再利用する。認証値をCLI引数・画面・ログへ出さない。

- 通常はStationTimetable / Railway / Stationの3GETのみ。自動polling・retryなし。
- `--probe-unavailable`を明示した場合だけTrain / TrainTimetableも取得。今回2回とも0件だったため、通常取得対象から外した。
- 上限20MB、20秒timeout、redirect拒否、配列検証、失敗はexit 1。失敗を成功扱いせず、古いsnapshotを上書きしない。
- `data/`へ取得時点別に保存。response hash・rows hash・UTC ISO取得日時を保持。取得元`dc:date`とJST表示時刻を区別する。保存後に再読込して照合する。
- `node poc/odakyu/build.mjs`で、保存済みの最新データを検証・解析して`data/model.json`と`data/analysis.json`を生成できる。serverも元snapshotのhash検証後にモデルを生成する。
- 画面の保存データ選択で異時点snapshotを再生。生データと派生JSONはGitに含めない。git cloneのみでは実データなし。今回の取得ファイルはこのworktreeの`poc/odakyu/data/`に保持する。

## 照合の限界

同一列車のIDは提供されていない。種別・行先・駅順・時間窓に一致する候補が1件の場合だけ**仮説**としてつなぐ。候補複数、欠測、種別変更、終着駅の着時刻欠落は補完せず打ち切る。一意候補でも同一便だと保証できない。照合用時間窓（各停10分/優等18分）は未実測のPoC設定値であり、接続可能性や遅延の根拠ではない。

快速急行は遊園を通過する。準急は2025年改正後の経堂以西各駅停車を反映。番線と実際の転線は未取得。急行線/緩行線は種別からの概略表示。登戸以南を複々線として表示しない。乗換bufferは最低3分、下北沢は階移動を考慮して最低6分の**仮設定**。身体条件を含む実移動時間は未確認。千代田線直通の候補を落とさないため代々木上原の全発車も対象とするが、始発/直通を断定しない。

## 検証

- `node --test poc/odakyu/core.test.mjs`：fixtureで境界条件・2回乗換を確認。fixtureは実列車の証明ではない。
- `node --test poc/odakyu/real-data.test.mjs`：今回取得した2時点のファイルが必要。取得元との全発時刻照合、単調性、hash、実データの参考比較。
- server起動後`node poc/odakyu/verify-http.mjs`：ローカルHTTPで画面・snapshot再読込・生データ/秘密ファイル非公開を確認。Originは`ODAKYU_POC_ORIGIN`で指定可能。
- 既存の鉄道テスト3ファイルも実行。結果は[ACCEPTANCE.md](ACCEPTANCE.md)。

## 利用条件と公開境界

[ODPTカタログ](https://ckan.odpt.org/dataset/odakyu__r_station_timetable)はチャレンジ2026限定。[限定ライセンス](https://developer.odpt.org/challenge_license)は2027-03-12終了予定で、応募・公開・データ取扱い等の条件がある。恒久的な本番利用の許諾と解釈しない。今回の作業はローカル開発。応募目的・条件への適合が確認されるまで外部公開・定期運用しない。認証発行や応募手続きは行っていない。

[小田急公式リアルタイム発車サイト](https://www.odakyu-rt.jp/)は事前許諾のない二次利用を禁止しているため、取得実装を作らない。[公式サイト一般規定](https://www.odakyu.jp/policy/index.html)も無断転用を許可していない。アプリ内部APIを見つけても利用許可なしに継続取得しない。

残件は、許可されたリアルタイム位置・列車ID付き通し時刻表・着時刻・遅延・番線・実乗換時間の確保、独立した列車単位のダイヤ検証、Android実機受入。これらが欠けているため「最適乗換の確定版」「リアルタイムPoC完成」とは扱わない。
