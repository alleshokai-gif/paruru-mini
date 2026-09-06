# PALURU Bus

川崎市バスの固定4方向を対象とする、PALURU Bus P0の作業フォルダ。
`gas-health/` と同階層に置くが、Busのリアルタイム取得にGASは使わない。

設計正本: [PALURU_BUS_P0_DESIGN.md](../docs/PALURU_BUS_P0_DESIGN.md)

## 現在の状態

- 2026-09-06: 既存構成・公式画面・公開データ・利用条件を調査し、設計案を作成。
- ODPTで川崎市交通局のGTFS/GTFS-JP、VehiclePosition、TripUpdates、Alertの公開を確認。
- 実装開始は保留。設計レビュー、正規トークンでの実データ検証、利用条件の適用確認が必要。
- このフォルダにはまだ実装・実データ・秘密情報・Cloudflare設定を置いていない。

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
