# 川崎市バス Shadow Bus Location 全対象便棚卸し

## 範囲と判定の意味

対象はPALURUのP0、Hub、Journeyが選択する川崎市バス8 queryである。`displayLimit=3`より前のStatic候補を数えた。`VehiclePosition`があっても、trip/service JOIN、承認済みgeometry、対象区間への進入、GPS時系列、freshness、confidence、conflictの全gateを通った便だけが停留所単位の位置を表示する。gate不成立は「位置確認中」のままとする。Public PositionはOFF、Shadow専用geometryの`approvedForPublic=false`と`geometryReady=false`は不変。

2026-09-29時点のproduction Staticは`20260701_20260828`、source hash `dcbd2e24a6fdd46c7af6e7c3145593774bcf4817fde1ea91517b7c1f387860eb`。`bus/generated/p1-position-static.json`はP0の8,856 unique trip / 34 chainだけを含む。承認済みgeometryは`bus/release-static/position-shadow-geometry.json`の登05・神木本町→登戸、20停留所・281点・gap 0、`p3.3-shadow-1`の1件だけ。

`node bus/scripts/check-kawasaki-position-coverage.js`は保存済みStaticとgeometryだけをread-onlyで照合する。全8 queryの13,608行を、重複を除いた**9,124 unique trip**まで漏れなく分類した。内訳は承認chain 488、厳密な共通終端区間の再利用172、geometry未承認8,196、位置用sidecar未収録268。したがって、このbranchでも位置表示のgeometry候補は登05の660 tripだけであり、残り8,464 tripを表示可能と宣言していない。

## Query別

| Query | Static行 | geometry候補 | geometry未承認 | sidecar未収録 |
|---|---:|---:|---:|---:|
| 神木本町→登戸 `home_to_noborito` | 660 | 660 | 0 | 0 |
| 神木本町→溝の口 `home_to_mizonokuchi` | 3,820 | 0 | 3,820 | 0 |
| 登戸→神木本町 `noborito_to_home` | 660 | 0 | 660 | 0 |
| 溝の口→神木本町 `mizonokuchi_to_home` | 3,716 | 0 | 3,716 | 0 |
| 向ヶ丘遊園→神木本町 `mukougaoka_to_kibukihoncho` | 320 | 0 | 320 | 0 |
| 神木本町→宮前平・鷲ヶ峰 `kibukihoncho_to_miyamae_washigamine` | 4,200 | 0 | 4,048 | 152 |
| 神木本町→登戸多摩川口 `kibukihoncho_to_noborito_tamagawa` | 116 | 0 | 0 | 116 |
| 登戸多摩川口→神木本町 `noborito_tamagawa_to_kibukihoncho` | 116 | 0 | 0 | 116 |

同じtripがP0とJourney、または2つのJourney queryに現れるので、上表の行を合計してunique trip数にはしない。

## Chain別の説明

現在の位置用sidecarにある34 chainのうち、次の4 chainは同じ登05・同じ進行方向で、承認済み20停留所chainの終端まで停留所IDとsequence差分が完全一致する。共通区間の開始より前と、共通区間外へ投影されたGPSは表示しない。既存のconfidence / stale / conflict gateはそのまま使う。

| Route / direction | Chain ID | 停留所数 | Static行 | 判定 |
|---|---|---:|---:|---|
| 登05 神木本町→登戸 | `3210f931a9a1b9423c1259be` | 20 | 488 | 承認済み全chain |
| 同 | `cb3f6314a8aabbcd2c84b537` | 24 | 48 | 承認済み20停留所と終端一致、進入後のみ |
| 同 | `09c16672dfa79bdef71332c7` | 24 | 104 | 承認済み末尾16停留所と一致、進入後のみ |
| 同 | `1d80d827989eba72dd7101be` | 12 | 20 | 承認済み末尾12停留所と一致、進入後のみ |

以下は**geometry追加対象**。同じroute番号でも、逆方向、別乗り場、分岐、短い停留所列の一致だけで承認済みgeometryを流用しない。複数queryで共用するchainは一度だけ列挙した。

| Route | 未対応chain ID | 理由 |
|---|---|---|
| 10032 | `b988ef8828bdfbc6c0c4ff16`, `5370a44db40ffefa6b748856`, `c4f02357350055b76c439bd3` | 別経路・逆方向 |
| 10033 | `9e92a77e25701197168575cd`, `c969462748a637aca0f81854`, `40e2ace0bbaa4272343e5ef0`, `785617e18ae643f4c7fb7d72`, `629c2ad17cf3914174ad2368`, `23a357fb2d298f62573a9928` | 別経路・逆方向 |
| 10034 | `224a8834e7968f97428a2df2`, `23fa70e997f18e4ea8e365f7`, `a3001b6be001f3c3e753918b`, `f050421f1ff8779c01f454a4` | 別経路・逆方向 |
| 10035 | `f479df1fe2ecbc0c86434c78`, `da6ceae1b00f7520ac0ec8ea`, `b94453a94b9448e5aad799e3`, `20695129ab97f47bc9d228dc` | 溝の口方面・逆方向 |
| 10036 | `8df3562a23d81e785d9d55bf`, `2ef894fa13a6b1dd33eafde0`, `6d546300c441821b77b8047d`, `fdf1dc56c42effd69e34da62`, `9d04494785690f2390e8c507`, `ecc66724b5520b6fb901af44` | 溝の口方面・逆方向 |
| 10037 | `2ad522085037e75b52f5034c`, `4f25124385bfd895b19c8c78`, `59d15d06aecb78adbcfb602e` | 向ヶ丘遊園経由・逆方向 |
| 10044 | `c15578d8d3155fc1a7e95f19`, `f7503231a8e6679e450aeb59`, `274558b277a188062d64cf5c`, `e644c0221ae04a4c69f34c88` | 登05逆方向。往路geometryを反転流用しない |

Journey専用の268 unique tripはP0位置用sidecarにない。まず同一source版から全8 queryを収録したsidecarが必要。その後にgeometryを評価する。内訳は10045の往復116便ずつ、10033の16便、10036の20便。位置用sidecarがない現状では、該当便の`trip_static_mismatch`をgeometry不足と混同しない。

## 最新公式GTFSとの照合上の注意

2026-09-29に指定日`20260828`で公式GTFSをread-only取得したところ、返却されたfeedは`20260701_20260928`であり、production StaticとZIP hashが異なった。8 queryの方向別選択行、停留所、route、calendarは完全一致したが、`calendar_dates`は異なる。最新feedから全8 queryの位置用chainをメモリ上で再構成すると40 unique chain、shape付きtrip 0で、既存P0の8,856 tripについてchain IDおよび全stop列は**8,856/8,856一致**した。Journey専用6 chainの候補IDは、10033 `0ecee3242d08839776d8bbba`、10036 `62ad3d72d962e80a758c742f`、10045 `2c7df62c649c6a7f246575fa` / `60b57f22440a721cbeb5be60` / `67ace8d630924f198e1512f3` / `ad3ddf201845e5c98e0993cc`。これらは**新feedでの候補**であって、旧production ZIPのchainが同一だと証明したものではない。今回の実行ではStaticを置換していない。

## 本番化の停止線

1. 36未対応chain（P0側30、Journey専用6）の正規stop列を同一Static版で確定する。
2. 既存geometryと方向・全共通区間が厳密一致するものだけ汎用再利用する。短い部分一致や逆方向は承認しない。
3. 再利用できないchainは検証済みgeometry artifactを追加し、全対象でGPS投影・stop順序・route crossing・時系列・実VehiclePositionを検証する。
4. 便ごとの`VPなし / JOIN不可 / sidecarなし / geometryなし / 共通区間前 / safety gate reject / 表示可`を安全な集計で説明し、validation実ブラウザで確認してから同一digestをproductionへ進める。

今回のbranchは棚卸しと既存承認区間の安全な再利用まで。全市バス位置表示、production deploy、閾値緩和、Public Position ONは行っていない。
