# Family Inbox GAS (Phase 1 + Phase 2 worker boundary + Phase 3 Review)

Family Inbox Phase 1専用の原本保存サービス。PALURU Miniからの内部APIだけを受け付ける。

必要なScript Properties（値はsourceへ置かない）:

- `FAMILY_INBOX_SERVICE_TOKEN`
- `FAMILY_INBOX_WORKER_TOKEN`（Mini tokenとは分離したworker専用credential）
- `FAMILY_INBOX_WORKER_ID`（例: `worker-home-01`。Family名・人物名を含めない）
- `FAMILY_INBOX_RAW_FOLDER_ID`
- `FAMILY_INBOX_LEDGER_SPREADSHEET_ID`

`Family_Inbox` Sheetのheaderは`FamilyInboxService.js`の`FAMILY_INBOX_HEADERS`を正本とする。コードはFolder、Spreadsheet、Sheet、headerを自動作成せず、未設定・不整合時は`CONFIGURATION_ERROR`でfail-closedする。

Web Appは匿名到達可能でも、正しい用途別tokenがなければDrive/Sheetへ触る前に拒否する。

Mini用operation:

- `familyInbox.submit`
- `familyInbox.getStatus`
- `familyInbox.listReviews`
- `familyInbox.getReview`
- `familyInbox.updateCandidate`
- `familyInbox.approveCandidate`
- `familyInbox.rejectCandidate`

Worker専用operation:

- `familyInbox.claimNext`
- `familyInbox.heartbeat`
- `familyInbox.getClaimedSource`
- `familyInbox.publishCandidates`
- `familyInbox.failClaim`

`Family_Candidates` Sheetは自動作成しない。必須header（順序は任意、重複不可）は次の28個。

```text
schemaVersion
candidateId
inboxId
homeId
candidateType
revision
status
createdAt
updatedAt
subjectMemberId
confidence
sourceSha256
profile
model
extractorVersion
promptVersion
payloadDigest
payloadJson
evidenceJson
warningsJson
questionsJson
publishRequestId
claimVersion
inputTokens
outputTokens
durationMs
reviewStatus
domainWriteResult
```

Phase 2は10分lease、1回1件、最大3 attempt。School Candidateは全件`proposed` / `reviewStatus=pending`で保存し、Inboxは`needs_review`にする。Calendar、School正本、Signageには書き込まない。

Phase 3 Reviewでは既存28列を並べ替えず、次の8列を末尾へ追加する。コードは列を自動追加せず、不足時はReview APIだけが`CONFIGURATION_ERROR`でfail-closedする。Phase 2 workerのpublishは従来28列のまま継続可能。

```text
reviewPayloadJson
reviewedAt
reviewedByMemberId
reviewAction
reviewReason
reviewNote
reviewRequestId
reviewHistoryJson
```

`payloadJson`はAI抽出時の原本として更新しない。人による修正後の有効payloadは`reviewPayloadJson`へ保存し、revisionごとの履歴を`reviewHistoryJson`へ保持する。Approve/Rejectは`reviewStatus`だけを確定し、Calendar、School正本、Signageへは書き込まない。全Candidateが確認済みでもInboxはPhase 3では`needs_review`のままとし、Domain write完了前に`completed`へ進めない。
