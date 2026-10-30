# Family Inbox / Health service token rotation

These shared credentials authenticate existing server-to-server calls. They do
not identify a family member, grant a role, enroll a device, or replace Firebase.

| Property | Caller | Receiver | Other consumers |
| --- | --- | --- | --- |
| FAMILY_INBOX_SERVICE_TOKEN | Mini Script Properties; FamilyInboxGatewayService | Family Inbox Script Properties; familyInboxAuthenticate_ | Submit, status and Mini review APIs |
| HEALTH_SERVICE_TOKEN | Mini Script Properties; HealthGatewayService / PetHealthGatewayService | Health Script Properties; healthToken_ | Human health and pet-health APIs |

The school worker and PC Review use separate credentials. The service values are
not shipped to PWA assets. Secret Console / private broker code is a non-production
PoC, not a configuration updater for these properties. Existing Kaz OS Secret
Manager bindings are unrelated; do not rotate or repoint them for this task.

## Safe inspection

Settings pages contain plaintext values, including in disabled inputs. The 2026-10-30
incident came from an accessibility snapshot that included key inputs and their
adjacent value inputs. Filtering an AX tree *after* emitting it is too late.

Use a DOM read that returns only explicitly allowlisted presence booleans:

```js
await tab.playwright.evaluate(() => {
  const keys = ['FAMILY_INBOX_SERVICE_TOKEN', 'HEALTH_SERVICE_TOKEN'];
  const inputs = Array.from(document.querySelectorAll('input'));
  return keys.map(key => ({ key, present: inputs.some(input => input.value === key) }));
});
```

Do not call getAXState/getScreenshot on a settings page, print body text, or log
input values. A property name's presence is not proof its value matches another
project; establish that through authenticated business probes instead.

## Bounded cutover

1. Inventory all actual callers and preserve current source plus the published
   version's manifest. HEAD can differ from the published Web App configuration.
2. Generate each new credential using 32 cryptographically random bytes. Keep
   values out of source, arguments, logs and plaintext diagnostic files. A local
   handoff file, if unavoidable, uses Windows DPAPI CurrentUser protection and is
   excluded from Git. Do not paste a credential into a chat.
3. If the existing receiver accepts one value only, a narrowly scoped temporary
   verifier for the new credential's SHA-256 digest can provide bounded overlap.
   It must have a fixed expiry, require the current property to remain configured,
   use the existing request field and permissions, and add no admin route.
4. Verify both old and new credentials through actual read APIs before cutover.
5. **Update Mini's two caller properties and save first.** Then update the matching
   receiver property in Family Inbox, followed by Health. Receiver-first would
   reject a caller still using the old value. When a browser policy requires a
   human to enter/save credentials, hand off only these concrete saves.
6. Verify new accepted / old rejected for both services. Remove the temporary
   verifier and restore single-value checks, preserving the correct published
   manifest. Independently pull and compare final source.
7. Verify Mini list/subject/PDF submission authentication without uploading another
   original, worker and PC Review authentication, health and pet-health reads,
   and safe write validation. Invalid write probes must fail before persistence;
   alternatively replay an already committed idempotency key exactly.
8. Compare relevant business data with the pre-cutover snapshot. Do not overwrite
   legitimate concurrent changes. Clear the handoff clipboard and remove encrypted
   temporary values after verification; retain only redacted operational evidence.

A clipboard helper should exclude history and device synchronization using the
Windows CanIncludeInClipboardHistory and CanUploadToCloudClipboard DWORD formats.
Do not claim these protections were exercised if only compilation was tested.

## Completion evidence

Record property names, caller/receiver aliases, source/deployment versions, safe
probe outcomes, old-value rejection, unchanged business data and remaining human
work. A successful deployment, staged second credential, or unit test is not a
completed rotation. Never erase an incident's original managed history merely to
make a scan pass; identify residual copies and make the old credential unusable.

References: [Apps Script remote execution prerequisites](https://developers.google.com/apps-script/api/how-tos/execute),
[Windows clipboard exclusion formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats#cloud-clipboard-and-clipboard-history-formats).
