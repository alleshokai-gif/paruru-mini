# AGENTS.md

## PALURU Mini実装ルール

- 日本語で報告する
- 既存データを削除しない
- Spreadsheetはヘッダー名ベースで読み書きする
- 既存列を並べ替えない
- 不足ヘッダーは末尾追加する
- 日時はAsia/Tokyoを前提にする
- ユーザーが明示指定した値はAI解析結果より優先する
- APIキー、Calendar ID、個人メモ本文を通常ログへ出さない
- Android PWAのService Worker更新経路を壊さない

## v1.0のデータ方針

- PALURU Inboxは未処理項目の置き場
- Googleカレンダーは確定したeventの正本
- SignageはGoogleカレンダーを参照する
- GoogleカレンダーからPALURUへの逆同期は未実装
- eventはGoogleカレンダー登録成功後のみcompletedへ移動する
- カレンダー登録失敗時はInboxに残す

## カレンダー連携

- `PALURU_FAMILY_CALENDAR_ID` はScript Propertiesで管理する
- フロントへCalendar IDを返さない
- 成功判定は `success=true`、`calendarSyncStatus=synced`、`calendarEventIdあり`、新規eventでは `status=completed` を必須にする
- 成功確認前に登録パネルを閉じない

## PWA

- navigation / HTML / JS / CSS / manifestはnetwork first
- 画像・キャラクター素材はcache first
- `updateViaCache: "none"`、`registration.update()`、`skipWaiting()`、`clients.claim()` を維持する
- Build番号を更新し、設定画面で確認できる状態を維持する

---

# PALURU Development Principles (Mandatory)

以下はPALURU開発における絶対ルールである。既存の実装ルールと矛盾する場合も、この節を優先する。

## 1. 設計を勝手に変えない

PALURUは設計が正本であり、AIは設計者ではなく実装者である。次を無断で導入・置換してはならない。

- Tool Calling
- Agent Loop
- Tool Router
- Tool再投入
- Responses APIループ
- OpenAI呼び出し回数の変更
- 処理順の変更
- 新しい責務の追加

設計変更が必要と考えた場合は、実装せず「設計変更提案」として停止する。

## 2. 完了の定義

次をすべて満たすまで「完了」「復旧」「修正完了」と報告してはならない。

1. コード実装
2. 構文チェックPASS
3. 既存テストPASS
4. 対象Repository全体テストPASS
5. デプロイ
6. 接続済み実ブラウザ・実PWA・実デプロイでの確認
7. 受入試験PASS

一つでも欠ける場合は「途中」と報告し、コード確認・テスト・実機確認を必ず分離して記載する。

## 3. 実機確認と受入試験

ブラウザ操作が可能なら、モックのみで終了してはならない。実ブラウザ、実PWA、実デプロイで受入試験を実施する。実装前に受入試験一覧を作成し、通過するまで完成扱いしない。

## 4. 事実・推測・未確認を混同しない

証拠がない限り、以下の表現を使わない。

- 確定
- 復旧
- 修正完了
- 原因は○○
- 動作確認済み

証拠がないものは「推測」「仮説」「未確認」「調査不能」と明記する。調査不能な箇所を推測で穴埋めしない。

## 5. ログ

ログ実装を「追跡可能」と報告できるのは、次を実機で確認した後だけである。

- 運用者が確認できる保存先・画面がある
- 検索方法がある
- requestId（または設計で定めた安全な相関ID）で追跡できる
- 実際にログを取得できる

コードへ出力APIを書くことだけをログ実装完了と扱わない。

## 6. 性能

性能改善を報告する前に、最低限以下を実測する。

- OpenAI呼び出し回数
- API回数
- Router時間
- Service時間
- 総時間

「速くなった」とは書かず、測定値と測定条件だけを記載する。

## 7. PALURU Agent正本設計

通常相談経路の正本は次のとおりである。

OpenAI（Intent JSONを1回生成）
→ GAS検証
→ 決定論Router
→ PALURU_OS
→ Service
→ GASテンプレート生成
→ PWA

OpenAIの責務は分類と引数抽出のみ。Service選択と実行はGASが行う。Tool Callingへ戻してはならない。

## 8. 作業単位と変更履歴

調査、実装修正、リファクタ、性能改善を同時に行わない。1テーマ1PRとする。

実装前に必ず次を記録する。

- 問題
- 原因（証拠がある場合のみ。なければ未確認）
- 修正方針
- 影響範囲
- 副作用
- ロールバック方法
- 実機試験項目

実装後は、実際に変わった内容だけを記録する。

## 9. 最重要ルール

動いている機能は壊さない。修正対象外の回帰は失敗である。変更前後で対象外を含む回帰試験を行う。

## 10. Codexの役割

Codexはコード作成者であり、設計者・レビュー担当・完成判定者ではない。設計判断または受入可否の判断が必要な場合は、証拠と未確認事項を示してユーザーの判断を待つ。

## Agent consultation acceptance contract

- Home card and Agent Today Paruru must use the same server-normalized input conditions: selected calendar members, unknown-event policy, cutover time, target dates, scope, Calendar, and Inbox.
- Do not write request text, replies, raw responses, Calendar, Inbox, health data, tokens, or secrets to diagnostics. Keep only safe event metadata, code, stage, reason, size, elapsed time, request-id suffix, and Build ID.
- Preserve known upstream error codes through Mini, Agent, and OS. Do not collapse them to `AGENT_ERROR`; only unknown failures may use the generic code.
- Every `agentChat` change must retain the one-OpenAI-call plus deterministic GAS-service architecture and must measure `routerMs`, `serviceMs`, `totalMs`, `openAiCallCount`, and `serviceCallCount` on both success and failure.
