# 川崎市バス Shadow Bus Location 全対象便棚卸し

## 2026-09-29 ローカル一括再生成・実観測照合（未deploy）

同一の川崎市バス公式GTFS ZIPからP0・Journey StaticとPosition sidecarを一括再生成した。source versionは`20260701_20260928`、hashは`e27ef68c6ac2f398c8a3c7cd21eef53e9ed28efcf268c3bc0de9b7a26c4252b8`。既存8,856便のstop chainは8,856/8,856一致し、Journey専用268便を追加した。8 query・9,124 unique trip・40 chainのsidecar欠落は0。calendar_datesのみ旧feedと差がある。既存Shadow artifactのstop列は同一で、source hashだけ新feedに合わせた。

公式ZIPの`trips.txt`と`shapes.txt`を直接調べた結果、全48,352 tripで`shape_id`設定0、`shapes.txt`自体なし。したがって公式GTFS shapeを元に残り36 chainのgeometryを一括生成する経路はない。既存承認済み登05 1 chainと厳密な共通終端区間3 chain以外、**36 chain / 8,464 unique tripはgeometry未承認**。形状をGPS軌跡から補完していない。

保存済み`Bus_Observation_Raw`の31,267行をread-only照合した。P0の31/34 chainにGPS観測があり、3 chainにはこのRaw上の観測がない。Journey専用6 chainの観測もない。既存Observed Corridor検証器でP0の全34 chainを一括評価したが、全stop intervalのcoverageと公式referenceの条件を満たす新規chainは0だった。これはGPSから新しいgeometryを作る根拠とは扱わない。

15:55 JSTのODPT単発read-onlyではVP 154、PALURU対象trip JOIN 35。8 queryすべてで少なくとも1便のtrip JOINがあった。現行承認geometryでgate評価できた3件は、単発観測ゆえ`insufficient_history`で表示0。各queryのHub DTOは次3便を生成したが、position.supported=trueは0。追加geometryのない便はgate以前に対象外であり、「VPなし」とは異なる。3連続GPSによる実位置表示は、この単発照合では未検証。

| Query | Static行 | VP JOIN（単発） | Hub DTO | sidecar欠落 | geometry候補 | geometry未承認 |
|---|---:|---:|---:|---:|---:|---:|
| 神木→登戸 | 660 | 3 | 3 | 0 | 660 | 0 |
| 神木→溝 | 3,820 | 12 | 3 | 0 | 0 | 3,820 |
| 登戸→神木 | 660 | 1 | 3 | 0 | 0 | 660 |
| 溝→神木 | 3,716 | 17 | 3 | 0 | 0 | 3,716 |
| 遊園→神木 | 320 | 1 | 3 | 0 | 0 | 320 |
| 神木→宮前・鷲ヶ峰 | 4,200 | 18 | 3 | 0 | 0 | 4,200 |
| 神木→多摩川口 | 116 | 1 | 3 | 0 | 0 | 116 |
| 多摩川口→神木 | 116 | 1 | 3 | 0 | 0 | 116 |

この表の行はquery重複を含み、unique trip数と合計は一致しない。geometry候補は承認chainと共通区間chainのみで、全便が常時表示可能という意味ではない。

### Chain別coverage

下表のGPS数は保存済み通常Observer Rawの行数であり、当該chainの位置表示に必要な連続観測やgeometry承認を意味しない。

| Chain ID | Route | Query | unique trip | Geometry | 保存済みGPS行 |
|---|---|---|---:|---|---:|
| `5370a44db40ffefa6b748856` | 10032 | 神木→溝 | 16 | 未承認 | 107 |
| `b988ef8828bdfbc6c0c4ff16` | 10032 | 神木→溝 | 248 | 未承認 | 991 |
| `c4f02357350055b76c439bd3` | 10032 | 神木→宮前、溝→神木 | 228 | 未承認 | 1400 |
| `0ecee3242d08839776d8bbba` | 10033 | 神木→宮前 | 16 | 未承認 | 0 |
| `23a357fb2d298f62573a9928` | 10033 | 神木→宮前、溝→神木 | 8 | 未承認 | 86 |
| `40e2ace0bbaa4272343e5ef0` | 10033 | 神木→溝 | 256 | 未承認 | 427 |
| `629c2ad17cf3914174ad2368` | 10033 | 神木→宮前、溝→神木 | 308 | 未承認 | 1278 |
| `785617e18ae643f4c7fb7d72` | 10033 | 神木→宮前、溝→神木 | 636 | 未承認 | 3192 |
| `9e92a77e25701197168575cd` | 10033 | 神木→溝 | 716 | 未承認 | 1794 |
| `c969462748a637aca0f81854` | 10033 | 神木→溝 | 16 | 未承認 | 168 |
| `224a8834e7968f97428a2df2` | 10034 | 神木→溝 | 112 | 未承認 | 181 |
| `23fa70e997f18e4ea8e365f7` | 10034 | 神木→溝 | 136 | 未承認 | 515 |
| `a3001b6be001f3c3e753918b` | 10034 | 神木→宮前、溝→神木 | 116 | 未承認 | 328 |
| `f050421f1ff8779c01f454a4` | 10034 | 神木→宮前、溝→神木 | 152 | 未承認 | 780 |
| `20695129ab97f47bc9d228dc` | 10035 | 神木→宮前、溝→神木 | 204 | 未承認 | 954 |
| `b94453a94b9448e5aad799e3` | 10035 | 神木→溝 | 48 | 未承認 | 308 |
| `da6ceae1b00f7520ac0ec8ea` | 10035 | 神木→溝 | 4 | 未承認 | 0 |
| `f479df1fe2ecbc0c86434c78` | 10035 | 神木→溝 | 232 | 未承認 | 622 |
| `2ef894fa13a6b1dd33eafde0` | 10036 | 神木→溝 | 20 | 未承認 | 268 |
| `62ad3d72d962e80a758c742f` | 10036 | 神木→宮前 | 20 | 未承認 | 0 |
| `6d546300c441821b77b8047d` | 10036 | 神木→溝 | 340 | 未承認 | 737 |
| `8df3562a23d81e785d9d55bf` | 10036 | 神木→溝 | 1308 | 未承認 | 2958 |
| `9d04494785690f2390e8c507` | 10036 | 神木→宮前、溝→神木 | 328 | 未承認 | 1433 |
| `ecc66724b5520b6fb901af44` | 10036 | 神木→宮前、溝→神木 | 12 | 未承認 | 158 |
| `fdf1dc56c42effd69e34da62` | 10036 | 神木→宮前、溝→神木 | 1396 | 未承認 | 5131 |
| `2ad522085037e75b52f5034c` | 10037 | 神木→溝、遊園→神木 | 320 | 未承認 | 582 |
| `4f25124385bfd895b19c8c78` | 10037 | 神木→溝 | 48 | 未承認 | 185 |
| `59d15d06aecb78adbcfb602e` | 10037 | 溝→神木 | 328 | 未承認 | 1621 |
| `09c16672dfa79bdef71332c7` | 10044 | 神木→登戸 | 104 | 共通区間のみ | 311 |
| `1d80d827989eba72dd7101be` | 10044 | 神木→登戸 | 20 | 共通区間のみ | 81 |
| `274558b277a188062d64cf5c` | 10044 | 神木→宮前、登戸→神木 | 48 | 未承認 | 0 |
| `3210f931a9a1b9423c1259be` | 10044 | 神木→登戸 | 488 | 承認済 | 1293 |
| `c15578d8d3155fc1a7e95f19` | 10044 | 神木→宮前、登戸→神木 | 456 | 未承認 | 2268 |
| `cb3f6314a8aabbcd2c84b537` | 10044 | 神木→登戸 | 48 | 共通区間のみ | 0 |
| `e644c0221ae04a4c69f34c88` | 10044 | 神木→宮前、登戸→神木 | 136 | 未承認 | 704 |
| `f7503231a8e6679e450aeb59` | 10044 | 神木→宮前、登戸→神木 | 20 | 未承認 | 406 |
| `2c7df62c649c6a7f246575fa` | 10045 | 神木→多摩川口 | 84 | 未承認 | 0 |
| `60b57f22440a721cbeb5be60` | 10045 | 神木→多摩川口 | 32 | 未承認 | 0 |
| `67ace8d630924f198e1512f3` | 10045 | 神木→宮前、多摩川口→神木 | 52 | 未承認 | 0 |
| `ad3ddf201845e5c98e0993cc` | 10045 | 神木→宮前、多摩川口→神木 | 64 | 未承認 | 0 |

### 同じOSM手順による道路候補の一括screen

既存登05と同じOSM route relation取得・way stitch・GTFS停留所順序投影を、OSM route master内の分岐relationまで含めて一括実施した。8系統31 relation候補から、全停留所の順序を投影できたchainは22/40。残り18 chainではこの候補群から全停留所の経路を再現できなかった。1 relationはHTTP 410で取得不能だった。特に溝16・溝18・溝19は候補relationにgapまたはstop投影失敗があり、現時点で一括承認できない。

| Route | Chain数 | OSM候補で全stop順序を投影 |
|---|---:|---:|
| 10032 溝11 | 3 | 3 |
| 10033 溝15 | 7 | 3 |
| 10034 溝16 | 4 | 0 |
| 10035 溝17 | 4 | 4 |
| 10036 溝18 | 7 | 0 |
| 10037 溝19 | 3 | 0 |
| 10044 登05 | 8 | 8 |
| 10045 登06 | 4 | 4 |

22件は**道路候補**であって承認済みgeometryではない。gap 0、stop投影の一意性、MLIT N07照合、GPS時系列・全区間検証、既存safety gateをまだ全件で通していない。OSM一覧の近似やGPS点間の直線接続で不足形状を補完しない。

**判定: 全40 chainのsidecarはPASS、geometryは4/40候補・36/40未承認、実VP gateの全chain受入は未達。全対象便バスロケの本番化はNO-GO。** Public PositionはOFF、既存gateは不変。

## PR #58初回棚卸し時点の記録（上記一括再生成より前）

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

2026-09-29 15:23 JSTのODPT read-only単発観測では、VP 148 entity、うちPALURU対象Static tripと一致する車両は32件だった。神木本町→登戸の3件はgeometry候補、残り29件はgeometry未承認または位置用sidecar未収録である。例えば神木本町→溝の口15件、溝の口→神木本町11件、登戸→神木本町1件にVPがあり、単純な「VPがない」問題ではない。この1回の取得だけでは各便の連続GPS・confidence・実位置表示までは判定できない。集計にraw vehicle ID、GPS座標、trip IDは保存していない。

## 本番化の停止線

1. 36未対応chain（P0側30、Journey専用6）の正規stop列を同一Static版で確定する。
2. 既存geometryと方向・全共通区間が厳密一致するものだけ汎用再利用する。短い部分一致や逆方向は承認しない。
3. 再利用できないchainは検証済みgeometry artifactを追加し、全対象でGPS投影・stop順序・route crossing・時系列・実VehiclePositionを検証する。
4. 便ごとの`VPなし / JOIN不可 / sidecarなし / geometryなし / 共通区間前 / safety gate reject / 表示可`を安全な集計で説明し、validation実ブラウザで確認してから同一digestをproductionへ進める。

今回のbranchは棚卸しと既存承認区間の安全な再利用まで。全市バス位置表示、production deploy、閾値緩和、Public Position ONは行っていない。
