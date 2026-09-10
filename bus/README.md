# PALURU Bus

川崎市バスの固定4方向を対象とする、PALURU Bus P0の作業フォルダ。
`gas-health/` と同階層に置くが、Busのリアルタイム取得にGASは使わない。

設計正本: [PALURU_BUS_P0_DESIGN.md](../docs/PALURU_BUS_P0_DESIGN.md)

## 現在の状態

- 2026-09-06: 既存構成・公式画面・公開データ・利用条件を調査し、設計案を作成。
- ODPTで川崎市交通局のGTFS/GTFS-JP、VehiclePosition、TripUpdates、Alertの公開を確認。
- 2026-09-07: 正規トークンによる実データ検証用スクリプトを追加。本番Provider/Worker/UIは未実装。
- 観測結果・不足事項・GO判定: [PALURU_BUS_P0_DATA_VALIDATION.md](../docs/PALURU_BUS_P0_DATA_VALIDATION.md)。

## ローカルでの実データ検証

`bus/.dev.vars` の `ODPT_ACCESS_TOKEN=` に正規キーをローカルで設定する。値をチャット、コマンド引数、Markdownへ貼らない。
ファイルは `bus/.gitignore` で除外する。Gitへ入れるテンプレートは空値の `.dev.vars.example` だけ。
環境変数 `ODPT_ACCESS_TOKEN` も読めるが、ファイルと異なる値が両方設定されている場合は停止する。
本番ではWorker Secretを使用する。このフェーズでCloudflare設定・deployは行わない。

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
- URLへのキー付与は内部処理だけで行い、リダイレクトは拒否する。例外本文・HTTP応答本文・車両識別子は出力しない。
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
最下段の位置には、sequence差に加えて状態別の区間数を使用する。生の差分と欠番の影響を別々に確認する。

## 設計レビュー後の配置案

```text
bus/
  README.md
  config/
    favorites.json             # 固定4方向。公式ID確認後に作成
  core/                        # 共通DTO・選別・並び順・鮮度
  providers/
    kawasaki/                  # ODPTのGTFS/GTFS-RTをNormalize
  worker/                      # HTTP・キャッシュ・上限・エラー境界
  test/                        # 合成fixture中心のCore/Adapterテスト

features/bus/                  # PWAのBus UI。実装時に作成
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
