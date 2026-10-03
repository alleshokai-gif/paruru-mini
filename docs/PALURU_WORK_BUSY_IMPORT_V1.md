# PALURU Work Busy Import v1

## 問題
Power Automate が Gmail に送る PALURU_AVAILABILITY メールを、PALURUのWorkBusyデータへ安全に取り込む経路がない。

## 原因
実装前は WorkBusy 専用の取込・保存経路がなかった。実メールによるAcceptanceは通過済み。

## 修正方針
- 手動実行関数 `importLatestWorkBusyEmailV1()` から `GmailApp.search()` で候補threadを検索し、全候補messageのうち件名が `PALURU_AVAILABILITY` と完全一致する最新の1通を選ぶ。本文は `String(message.getPlainBody() || message.getBody() || '')` で取得する。
- 本文はその場で DATE / BUSY を抽出し、JSTの日付・時刻として検証する。本文、予定名、参加者、message id は保存もログ出力もしない。
- WorkBusy 専用シートに source / generated_at / date / start / end の5項目だけを保持する。
- 過去・今日終了済み・今日から30日超・不正・0分の区間を除外し、日付ごとに重複、overlap、連続区間を統合する。
- 保存直後に WorkBusy を読み戻し、5項目と正規化区間の一致を確認してから成功を返す。
- Family Calendar合成、FREE算出、Home表示、Planner、Notion write は今回の対象外。

## 影響範囲
GAS の WorkBusy importer、Gmail read-only OAuth scope、および targeted test のみ。Advanced Gmail Serviceは使用しない。

## 副作用
GmailAppで候補threadを検索し、件名が完全一致するmessageの日時を比較して最新1通の本文だけを取得する。保存先はWorkBusyシートのみで、保持データは5項目に限定する。

## ロールバック方法
この機能の変更だけを含むコミットを revert し、必要ならGASソースを前バージョンへ戻す。WorkBusyの保存行は自動削除しない。

## Acceptance
1. GmailAppの検索候補から、件名が完全一致する最新messageを選択して本文を取得する。
2. DATE / BUSY のJST検証、過去・30日超・0分・不正区間の除外。
3. 重複・重複区間・連続区間の統合。
4. WorkBusy に5項目だけ保存し、read-back が書込内容と一致する。
5. 実メールで `WEEKLY_BUSY` と複数DATE/BUSY形式を処理し、invalid/zero-duration除外、WorkBusy保存、read-back一致を確認済み。書込先は WorkBusy のみ。
