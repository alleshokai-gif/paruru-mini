# PALURU Bus 東急公式バスナビ Position / Prediction調査

調査日: 2026-09-13（Asia/Tokyo）

## 結論

東急公式バスナビは、路線内のバス位置、選択停留所までの待ち時間、停留所間の所要見込みを表示している。向01で公開画面を観測した範囲では、位置と予測はJSON/XHRの公開APIとしてブラウザへ渡されず、`/blsys/navi`へのGETに対する**サーバー生成HTML**へ一緒に埋め込まれていた。

- バス位置はroute table内の停留所間行にバス画像として配置される。
- 神木本町を選択すると、同じHTML内のバス要素に`梶谷駅行 02分待ち`等の予測済み文字列が入る。
- 公開JavaScriptはフォーム遷移、画面更新、画像rolloverを担当する。配信される`default.js`に業務用XHR/fetch/JSON取得は確認できなかった。
- HTMLにはvehicle ID、trip ID、GPS座標、予測timestamp、元のstop sequence等は確認できなかった。

したがって、画面表示から「サーバー側に位置・予測モデルがある」ことは分かるが、その入力、算出式、更新timestamp、正規API契約は分からない。内部画面をPALURU runtimeのデータソースにする根拠もないため、**本番採用はNO-GO**とする。P2.1 Tokyu Providerは正規ODPT Staticだけを使用する。

## 調査対象と方法

公式入口は[東急バスナビ](https://tokyu.bus-location.jp/)で、PC版は`https://tokyu.bus-location.jp/blsys/navi`へ遷移する。公式の[ご利用ガイド](https://tokyu.bus-location.jp/blsys/navi?EID=ug&VID=top)と公開HTML/JavaScriptを読み、向01の路線別運行画面と神木本町選択後の画面を同時刻帯に観測した。

認証回避、TLS pinning回避、アプリ改変は行っていない。画面の内部GETは調査・答え合わせだけに使い、コード、fixture、runtimeには保存・接続していない。

## 公式Webの通信構成

### 画面遷移

公開画面は次の構成だった。

```text
GET /blsys/navi
  -> 路線一覧を選択
GET /blsys/navi?VID=rtl&EID=nt&RAMK=64
  -> 向01 路線別運行情報（サーバー生成HTML）
GET /blsys/navi?...&SKF=3072&DOF=9...
  -> 神木本町を選択した位置＋予測表示（サーバー生成HTML）
```

`RAMK=64`、`SKF=3072`、`DOF=9`は画面内部のroute/stop/display-orderキーである。ODPTの正式IDではなく、公開利用契約もないためProvider設定には使わない。`DOF=9`とODPT route patternの神木本町index 10は対応して見えるが、zero-based変換仕様として採用しない。

公開HTMLが参照した主要scriptは、jQuery、`jquery.popupwindow.js`、`default.js`だった。`default.js`の`linkSubmit()`は`VID/EID`をhidden formへ設定して同じ`navi`へGETする。調査した公開業務script内に専用XHR、fetch、JSON/XML endpoint、position/wait model定義は確認できなかった。

### 更新周期

路線画面の自動更新選択肢は次の4つだった。

|値|表示|
|---:|---|
|0|なし|
|30|30秒|
|60|1分|
|300|5分|

画面説明では、30秒間隔は10分、1分間隔は20分、5分間隔は約1.5時間で終了するとされる。モバイル向け公開ガイドは、携帯端末では自動更新せず更新ボタンを使う旨を記載している。これは画面の更新設定であり、上流位置データ自体の生成周期を証明しない。

## Positionの表示モデル

向01のroute tableは両方向の停留所列を持ち、停留所の間にバス画像`buslocation/images/PC_00.png`を置く。08:54～08:56 JSTの観測では2つのバス要素があり、片方が向ヶ丘遊園駅方面、片方が梶が谷駅方面だった。

バス要素が入るHTML行には、vehicle/trip識別子、lat/lon、data属性はなかった。したがってブラウザ側がGPSを停留所列へ投影している証拠はなく、**停留所間位置までサーバーで表示化されている**のが最有力である。下位のサーバーモデルがstopsAwayを直接持つか、server側でstop sequenceやGPSから算出するかは未確認。

公式ガイドは、停留所別接近情報で乗車停留所から最大6つ手前までの停留所間にいる全バスを表示すると説明する。また、同じ起終点や停留所間に複数バスが表示された場合、並び順と発車・到着順が一致しない場合があると明記する。繰り返しバス要素で複数車両を表現するが、安定した車両IDは公開HTMLに出ない。

## Predictionの表示モデル

神木本町を選択した08:56 JSTのHTMLには、バス要素の表示文字として次が入っていた。

```text
向丘駅行 05分待ち
梶谷駅行 02分待ち
```

あわせて各停留所間の所要見込みが`01分`、`02分`等で表示された。値はraw HTMLに存在し、公開JavaScriptのカウントダウン計算ではない。このため「XX分待ち」はサーバー側で予測済みの最有力証拠となる。ただし予測時刻、delay、計算元、丸め方は公開されていない。

PositionとPredictionは、停留所を選択した同じHTML responseに含まれる。別endpoint/modelがサーバー内部にある可能性は否定できないが、ブラウザへ別JSONとして出る証拠は得られなかった。

## 始発・折返し

路線画面の凡例には、終点到着後の折返し行先を示すアイコンがある。一方、今回の公開HTMLには次を区別できる構造化項目は確認できなかった。

- scheduled departure
- incoming vehicle arrival
- turnaround duration
- actual/estimated departure
- trip chain / block / duty

折返しアイコンだけで同一車両や次tripを証明できない。Departure Predictionの入力には使用しない。

## NAVITIME調査との比較

既存[NAVITIME調査](PALURU_BUS_NAVITIME_RESEARCH.md)では、Android共通DTO候補として`approachingBeforeIndex`、`remainingMinutes`、`coord`、`previousNodeId`、`nextNodeId`が確認され、server-normalized値を共通UIが表示する構成が最有力だった。

|観点|NAVITIME候補|東急公式バスナビ公開画面|
|---|---|---|
|何停前|`approachingBeforeIndex`候補|停留所間table rowへ描画済み|
|待ち分|`remainingMinutes`候補|`02分待ち`等へ文字列化済み|
|座標|`coord`候補|車両lat/lonは非公開|
|前後stop|`previousNodeId/nextNodeId`候補|表示行から人間には読めるが構造化IDなし|
|Provider共通化|共通DTOの証拠あり|サーバー内部は不明、公開HTMLは東急専用|

両者の利用者向け意味は、PALURUの`stopsAway / previousStop / nextStop / etaMinutes`へ抽象化できる。ただし東急公式バスナビの画面値を抽出して埋めるのではなく、正規Providerデータから同じ意味を独自再構成する必要がある。

## 利用可否

|判定軸|判定|理由|
|---|---|---|
|技術的に取得可能|画面表示は可能|通常ブラウザGETでHTMLを閲覧できる|
|公開APIとして利用可能|確認できず|endpoint仕様、認証、SLA、再配信許諾が公開されていない|
|商用利用可能|確認できず|[東急バスWeb利用条件](https://www.tokyubus.co.jp/terms.html)は許諾なき複製・改変・再配布等を制限する|
|PALURU本番採用|NO-GO|内部HTML/endpoint利用の許可根拠がなく、schemaも不安定|

東急公式バスナビは研究上の公式表示referenceに限定する。HTMLスクレイピング、内部パラメータ依存、待ち分文字列のruntime抽出は行わない。

## Tokyu Providerへの影響

P2.1 Providerで正規に返せるのはODPT Static由来の次だけである。

```json
{
  "provider": "tokyu",
  "routeId": "odpt.Busroute:TokyuBus.Kou01",
  "routeLabel": "向０１",
  "stopId": "odpt.BusstopPole:TokyuBus.Shibokuhonchou.00240751.a",
  "destination": "梶が谷駅",
  "scheduledDeparture": 0,
  "estimatedDeparture": null,
  "etaMinutes": null,
  "delayMinutes": null,
  "position": { "supported": false }
}
```

公式バスナビが画面に持つPosition/Predictionは、正規公開APIが確認できるまで全てnull/unsupportedを維持する。

## 本番採用判定

- 東急公式バスナビ内部HTML/endpoint: **NO-GO**
- 公式表示を教師データとして人手で比較: **条件付きGO**。入力には使わず、利用条件と取得頻度を守る
- ODPT Static Tokyu Provider: **P2.1ローカルGO**
- Tokyu Realtime/Position Provider: **NO-GO**

