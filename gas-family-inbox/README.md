# Family Inbox GAS (Phase 1-4A)

Family Inbox Phase 1専用の原本保存サービス。PALURU Miniからの内部APIだけを受け付ける。

必要なScript Properties（値はsourceへ置かない）:

- `FAMILY_INBOX_SERVICE_TOKEN`
- `FAMILY_INBOX_WORKER_TOKEN`（Mini tokenとは分離したworker専用credential）
- `FAMILY_INBOX_WORKER_ID`（例: `worker-home-01`。Family名・人物名を含めない）
- `FAMILY_INBOX_WORKER_PROFILE`（`school-v1`または`school-v1-long`。未設定時は後方互換の`school-v1`）
- `FAMILY_INBOX_RAW_FOLDER_ID`
- `FAMILY_INBOX_LEDGER_SPREADSHEET_ID`

PC Batch Reviewを使う場合のみ追加（worker credentialとは分離する）:

- `FAMILY_INBOX_PC_REVIEW_TOKEN`（十分なentropyを持つ専用token。source・Sheet・ログへ保存しない）
- `FAMILY_INBOX_PC_REVIEW_ID`（例: `home-review-01`。Family名・人物名を含めない）
- `FAMILY_INBOX_PC_REVIEW_HOME_ID`（このPC Review identityが閲覧できるhomeのserver-owned scope）

Drive Drop手動PoCを使う場合のみ追加:

- `FAMILY_INBOX_DRIVE_DROP_FOLDER_ID`（専用Drop Folder。raw folderと同一は禁止）
- `FAMILY_INBOX_DRIVE_DROP_HOME_ID`
- `FAMILY_INBOX_DRIVE_DROP_DEFAULT_SUBJECT_MEMBER_ID`（PoC限定のserver-owned固定member）
- `FAMILY_INBOX_DRIVE_DROP_SUBMITTED_BY_MEMBER_ID`（import actor。Family名・人物名を値へ含めない）

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

PC Review専用operation（worker/source/Drive/Domain operationは許可しない）:

- `familyInbox.pcReview.list`
- `familyInbox.pcReview.get`
- `familyInbox.pcReview.update`
- `familyInbox.pcReview.approve`
- `familyInbox.pcReview.reject`
- `familyInbox.pcReview.bulkApproveCanonical`

## Drive Drop manual PoC

`DriveDropImporter.js`の`runFamilyInboxDriveDropImportOnce()`をGASエディタから手動実行する。Web App operationやtriggerは追加しない。設定済みDrop Folderだけを読み、PDF以外は無視し、新規PDFを最大1件だけraw folderへコピーして`source=drive_drop`でledgerへ登録する。元PDFは移動・改名・削除しない。

Drive file IDから決定的な`clientRequestId`を生成するため、同じfileを再scanしてもraw copyとledger rowは増えない。同じbytesを別Drive fileとして置いた場合はPhase 1既存方針どおりraw copyを保持し、`status=duplicate`と`duplicateOfInboxId`を記録する。Drive file ID自体はledger・ログ・Hermesへ渡さない。ImporterはFamily Inbox既存上限に合わせてPDFを5 MiB以下に制限し、magic bytesも検証する。

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

Phase 4Aでは`Family_Candidates`の末尾へ次の3列も追加する。既存列は並べ替えない。

```text
reviewedByServiceId
reviewChannel
sourceReviewItemId
```

`reviewedByServiceId`はPC service identity、`reviewChannel`は`pc_backoffice`、`sourceReviewItemId`は人が補完したFragmentから昇格したCandidateの出典を保持する。Family member actorの`reviewedByMemberId`とは混同しない。

未解決Page FragmentはCanonical Candidateと混在させず、同じSpreadsheet内の`Family_Review_Items` Sheetへ保存する。Sheetは自動作成しない。必須header（順序は任意、重複不可）は次の38個。

```text
schemaVersion
reviewItemId
inboxId
homeId
reviewType
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
reviewPayloadJson
evidenceJson
warningsJson
questionsJson
publishRequestId
claimVersion
fragmentCount
inputTokens
outputTokens
durationMs
reviewedAt
reviewedByServiceId
reviewChannel
reviewAction
reviewReason
reviewNote
reviewRequestId
reviewHistoryJson
promotedCandidateId
```

`school-v1`は最大8件でReview Itemなし、`school-v1-long`はCanonical CandidateとReview Itemの合計最大40件。profileは`FAMILY_INBOX_WORKER_PROFILE`からGASが決め、worker requestの値だけで上限を拡張しない。publish payload全体の128 KiB上限は両profileで維持する。

Review Itemの補完・昇格はGAS内でCanonical schemaを再検証し、新しい`candidateId`をserver-side生成する。同じ`reviewRequestId`の再送や同じ`sourceReviewItemId`の復旧でCandidateを増殖させない。元Fragmentは`promoted`となり、昇格Candidateは別途承認する。全件をreviewedにしてもInboxは`needs_review`のままで、Domain writeは行わない。

## Web App deploy recommendation

manifestの推奨値は`executeAs=USER_DEPLOYING`、`access=ANYONE_ANONYMOUS`。Browserやworkerから到達可能にしつつ、用途別tokenを各operationのDrive/Sheet accessより前に検証してfail-closedする。公開URLそのものを認証境界にしない。deploy前にSheet/headerとScript Propertiesを用意し、source反映後は新しいversionをdeployする。既存deploymentの更新・Property設定・Sheet作成は手動運用であり、このrepositoryのlocal testでは実行しない。
