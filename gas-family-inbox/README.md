# Family Inbox GAS (Phase 1)

Family Inbox Phase 1専用の原本保存サービス。PALURU Miniからの内部APIだけを受け付ける。

必要なScript Properties（値はsourceへ置かない）:

- `FAMILY_INBOX_SERVICE_TOKEN`
- `FAMILY_INBOX_RAW_FOLDER_ID`
- `FAMILY_INBOX_LEDGER_SPREADSHEET_ID`

`Family_Inbox` Sheetのheaderは`FamilyInboxService.js`の`FAMILY_INBOX_HEADERS`を正本とする。コードはFolder、Spreadsheet、Sheet、headerを自動作成せず、未設定・不整合時は`CONFIGURATION_ERROR`でfail-closedする。

Web Appは匿名到達可能でも、正しい内部tokenがなければDrive/Sheetへ触る前に拒否する。Phase 1では`familyInbox.submit`と`familyInbox.getStatus`以外を受け付けない。
