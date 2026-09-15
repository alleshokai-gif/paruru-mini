# Issue #1: 端末登録の部分成功リカバリー

## 問題

端末承認は、Pairing Registry、`Home_Members`、`Device_Memberships` の複数保存先を更新する。サーバー側の更新が成功した後にレスポンス受信または画面更新が失敗すると、管理者画面は失敗を表示する一方、6桁コードはサーバー側で消費済みになる。現行UIは成功照合用のIDと再開操作を持たないため、同じ操作を安全に再実行できない。

## 現在状態の診断（2026-09-15 Asia/Tokyo）

- 対象端末: deviceId末尾 `de63005`
- Pairing request: requestId末尾 `fab12136`
- `Home_Members`: `eldest_daughter / self_record / active`
- `Device_Memberships`: 対象deviceが `active`。`assignedBy` は同じpairing request
- Pairing Registry: 対象deviceが `active`、requestが `approved`、pairing codeは消費済み
- 対象deviceのRegistry `lastUsedAt`: approval後の `2026-09-15T20:56:40+09:00`
- 管理者ブラウザ: pairing済みの `father / admin`。設定画面にはapproval後も失敗表示が残った
- GAS: approval時刻付近のWeb App実行はApps Script上で完了扱い

以上から、今回の保存状態は `READY` 相当であり、永続データのresetや再pairingは不要。確認できた不整合は「サーバーのREADY」と「管理者UIの失敗表示」の間にある。ブラウザ通信のどの段階で応答が失われたかは、現行ログだけでは特定不能。

## 原因

証拠から確定できる根本原因は次の2点。

1. approval requestを一意に再照合するclient idempotency keyを管理者PWAが保持・送信していない。
2. Pairing Registryのrequest/device状態とMembership状態をまとめた回復状態を返すAPIとUIがない。

そのため、サーバーcommit後のresponse timeoutでは、管理者PWAがREADYを照合できず、消費済みコードによる再送も成功しない。

## 修正方針

- 既存のPairing Registry requestIdをserver operation idとして維持する。
- 管理者PWAがapproval attemptごとにUUIDを生成し、秘密を含まない最小情報をlocalStorageへ保持する。
- サーバーはclient approval request idをrequestへ関連付け、同一payloadの再送を同じrequestへ束縛する。
- `devicePairingList`は、RegistryとMembershipを照合して回復可能な未完了requestだけを返す。
- `devicePairingResume`は保存済みのtemplateとrequestIdのみを使い、Membershipの二重作成をせず、未完了stepだけを再実行する。
- response timeout時は、PWAがclient approval request idで結果を照合する。READYなら成功表示へ補正する。
- reload時は、localStorageのapproval attemptとserver recovery listを照合し、`登録処理を再開`を表示する。

## 状態モデル

状態は単一booleanではなく、次の値で表現する。

- `UNREGISTERED`
- `PAIRING_PENDING`
- `MEMBERSHIP_APPROVED`
- `DEVICE_PROVISIONING_PENDING`
- `READY`
- `FAILED_RETRYABLE`
- `FAILED_TERMINAL`
- `REVOKED`

既存の `request.status`、`device.status`、Membership行は後方互換のため維持する。新状態はrequestへ追加し、旧データは既存3保存先から決定的に導出する。

## 影響範囲

- Mini GASのdevice pairing API
- 管理者PWAの設定画面とlocalStorage上のapproval attempt
- pair待ち端末のstatus表示
- pairing/membership/PWAの回帰テスト

Calendar、Inbox、Health、Agent、家電操作の実行API、既存Membership列順は変更しない。

## 副作用と安全境界

- retry/resumeは認証済みadminだけが実行できる。
- client由来のmember、role、homeIdは使用しない。
- serverに保存済みのrequestId、target device、template、Membership assignmentが一致しない場合はfail closedとする。
- activeな別deviceや別memberへの再割当て、既存行削除、列追加、列並べ替えは行わない。
- pairing token、request secret、code、token hashはdiagnosticsやUIへ返さない。

## ロールバック方法

このcommitをrevertする。既存のRegistry/Membership項目は削除・変更せず、新しいrequest属性だけを追加するため、旧コードは追加属性を無視できる。データcleanupは不要。

## 実ブラウザ受入項目

1. 新規端末を正常承認し、対象端末と管理者設定の両方でREADYを確認する。
2. Membership成功後にdevice provisioningを失敗させ、管理者に「端末登録の一部に失敗しました。再試行」を表示する。
3. 再試行1回と複数回でMembership行数が増えず、同じrequestIdでREADYへ進むことを確認する。
4. 管理者画面reload後に「登録処理を再開」が表示されることを確認する。
5. GAS write成功後のresponse timeoutとdownstream write成功後のresponse timeoutを模擬し、READYへ照合されることを確認する。
6. duplicate approvalで同じ結果が返り、別templateや別deviceへ上書きされないことを確認する。
7. 既存登録済みdevice、revoke、membership registration、Android PWA更新経路の回帰を確認する。

Deployと実ブラウザ受入はユーザーがcommit反映後に別フェーズで実施する。
