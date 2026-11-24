## 2026-11-24 additive lightweight catalog (requires a new GAS version)

The first existing authenticated list page additionally returns `data.linkCatalog` with `format: family-links-1`, the same revision/total, and all filtered rows (at most 1000). Each row adds a server-validated canonical YouTube watch URL and exactly the matching official mqdefault thumbnail reference. Existing paged metadata and legacy detail actions remain compatible. Authentication, active family membership, capability and canonical Home validation still precede the one private file read. No media-provider call is made by the compact list. No public asset, service-worker cache, logging or persistent browser storage contains the catalog.

The current published v206 does not emit this field. Its temporary client fallback keeps complete revision/filter validation and uses two concurrent remaining pages after the first, without retries or partial-success claims. Request deadlines cover authentication as well as fetch (30s each, 90s total enumeration budget). Fixed-code DOM diagnostics contain only stage/count/timing/error code, not raw errors, credentials or catalog fields. New compact mode renders ordinary links immediately; clicks make zero GAS calls. Small official thumbnails are assigned on viewport intersection and failures become placeholders. Legacy v206 still needs its existing per-card media/link calls.

Rollout: compatible client may ship before the backend. Stage only the one reviewed GAS service file while preserving live HEAD/manifest/settings. A new immutable GAS version is blocked by the 200-version cap; this change authorizes no further deletion or alternate deployment. Do not claim direct-mode production acceptance before that version is published.

# 試合動画 UI / 取得連携（Draft）

この差分は架空データによるUIと既存アプリへの連携です。実データ取得・登録、merge、本番配備は実施しません。実際の学校名、LINE内容、動画ID、リンク、画像は使用しません。

## 合意済みの取得経路

既存の認証付き `callHomeControlApi`（POST / no-store）を使用します。新規base URL、認証方式、権限設定は追加しません。

| action | 入力 | UIでの扱い |
| --- | --- | --- |
| `listHandballMatchVideos` | `offset`, `limit:20` | 表示メタデータのみ。全ページの読取成功後に選択肢を構築 |
| `getHandballMatchVideoLink` | opaque `id` | 本人の押下時だけ取得・再認可。UIでURLを組み立てない |
| `getHandballMatchVideoThumbnail` | opaque `id` | 認証付きPOST。availableのbytesを検証してBlob化、placeholderは代替表示 |

`callHomeControlApi` は既存の `{success:true,data:...}` を展開します。一覧の `data` は `{items:[...]}`。UIへ渡すフィールドは `id, tournamentId, tournamentLabel, matchId, matchLabel, matchDate, postedAt, partLabel, classificationStatus` に限定します。想定外の `watchUrl` / `thumbnailUrl` が一覧に含まれても除去します。

バックエンド契約は [Draft #245 / 51c4a713…](https://github.com/alleshokai-gif/paruru-mini/blob/51c4a713945f7a3652dd0a28c5c943fece24d33e/docs/handball-match-video-api.md) を優先します。`playedOn` / `publishedOn` / `title` を取得アダプタで試合日 / 投稿日 / 動画ラベルへ対応させます。空の日付はnullへ正規化し、互いの日付から補完しません。旧段階の追加フィールドや分類enumは使用しません。

リンクの `data` は `{id,url}` です。opaque `id` の一致と契約どおりのcanonical YouTube URLを検証し、UIには `{watchUrl}` として渡します。URLをidから組み立てません。未知・不正の応答は開きません。

全件列挙は最大1000件・50ページ、1ページ20件です。最初の `catalogRevision` を後続ページへ送り、変更時は旧結果を破棄します。`total/offset/limit/hasMore`、重複、アカウント切替を検査します。全件由来 `filters` のID・名称・件数と全ページを照合し、その名称で大会・試合の選択肢を構築します。最初の20件から選択肢を決めません。未分類の大会・試合と「すべて」を残し、絞り込みは全件取得後にメモリ内で行います。途中失敗・revision不一致・filters不整合は成功扱いせず、再読み込みで新しいページングを開始します。架空51件と317件を試験します。

画像の契約は `{id,status:'available',mimeType:'image/jpeg',base64}` または `{id,status:'placeholder',...}`。id一致、JPEG MIME、base64形式、256KiB以下、JPEGの開始・終了signatureを検査します。UIでもsignatureとMIMEを照合してからBlob URL化します。取得は画面内に入った行に限定し、遷移・ログアウトでURLをrevokeします。SVG・外部画像URL・不正/過大画像は表示しません。placeholderを画像取得失敗と混同しません。

## 分類と日付

- `matchId` / `matchLabel` / `matchDate` は `null` 可。
- `postedAt` は日時または日付のみ。日付のみを時刻付きに補完しません。投稿日から試合日を推測しません。
- `classificationStatus`: `match_identified`（試合確認済み）、`tournament_only`（大会のみ確認）、`unclassified`（分類未確認）。サーバのnullableペアとの整合も検査します。
- 同じ大会内でも、相手のラベルや日付だけで同一試合と断定しません。共有の非null `matchId` がある場合だけ複数本を同じ試合へまとめます。`matchId:null` の投稿はopaque `id` ごとに別の未確認項目とします。

## 認証・データ境界

メニューの可視性は既存Home配下の家族予定と同じクライアント条件です。これはサーバの資料閲覧権限を付与するものではありません。サーバは一覧と各opaque `id` の両方で既存の家庭・会員・資料アクセス境界を検証し、他家庭・権限外の記録を返さない必要があります。

一覧、リンク、画像はメモリ内だけで扱い、storage / Cache API / Service Worker / 通常ログに保存しません。非表示・ログアウト時はDOMと保持データを破棄し、遅延応答を無視します。Service Workerに追加するのは公開UIコードとCSSだけで、fixtureや媒体は追加しません。

動画はYouTubeを明示した外部リンクです。埋め込み、oEmbed、先読み、第三者サムネイルURLへの直接取得は行いません。同じ認証境界の画像Blobが提供されない場合は代替表示します。

## 未完了の実接続受入

バックエンドとの応答形式照合、権限ごとの認証済み一覧・押下時再認可、サムネイル対応有無、実端末でのリンク遷移は、実接続許可後の別工程です。このDraftの合成試験で完了扱いしません。

## 検証証拠

- Claude Code実セッション `547ccc55-eb16-42d7-a347-2f69c430a7f6`。初回と契約差分の同一セッション継続が正常終了。共有は最小UIコードと合成データのみ。Codexが契約連携・独立検証を担当。
- 関連ローカル試験43/43 PASS。古いホームメニュー試験2件はmainでも再現（Kaz category fixture missing / 既存launcher数6対旧期待4）。今回の試合動画メニュー追加後は後者7対4。対象外の試験定義は変更していません。
- 実Chrome、390×900 / 1366×768で通常・空・読込中・未ログイン・権限なし・未接続・読取失敗・サムネ失敗・未分類・長文の20条件。横はみ出しなし、表示された操作44px以上、押下前の外部リンク0。
- 公開サンプルprobeは [Google公式IFrame API文書](https://developers.google.com/youtube/iframe_api_reference) の公開例のみ使用。oEmbed/指定JPEG各1回、22,712 bytes・480×360 JPEG、SHA256 `056129e50d3b499e3a6b2056bd73adcc97fe3f8365e34e91175ddc6ccf4314ac`。実装media decoderのBlob化とPillow独立復号PASS。画像・応答本文・動画IDは成果物に保存していません。本番Firebase/Drive/GAS受入ではありません。
