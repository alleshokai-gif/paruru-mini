# ナースおかん Phase 0 design

## Architecture

```text
PALURU Mini PWA
  -> PALURU Mini GAS
     - Device Pairing authentication
     - Home Membership authorization
  -> New Health GAS
  -> New Health Spreadsheet
```

Nurse Okan MVP stores daily meals, condition, and future weight records in its own Health Spreadsheet. It does not migrate historical Growth data, read the Growth API, write measurements to Growth, synchronize with Growth, or use `Growth_Member_Links`. A future phase may separately consider Growth integration for the second son when height and weight recording is added to Nurse Okan.

## Membership

`Home_Members` stores household members and roles. `Device_Memberships` binds only an already paired device to a member. The server resolves the actor from `deviceId + pairingToken`; PWA-supplied `homeId`, `userId`, and `recordedBy` are not authoritative.

Pilot roles are `father/admin` and `second_son/self_record`. Bootstrap is a manual Apps Script operation after the required Script Properties and active pairing records are confirmed. It is not a Web API route.

## Future Health operations

Allowed operations will be `health.daily.get`, `health.daily.recordSlot`, `health.weight.history`, `health.weight.record`, and `health.summary.get`. Daily slots are `morning`, `lunch`, `post_training`, `dinner`, and `condition`. `null` means not recorded; `false`, `0`, and `none` mean recorded as absent.

`Nutrition_Daily` will store deterministic assessment fields (`ruleCodes`, `ruleVersion`, `evaluatedAt`). AI, n8n, and PALURU_OS are not part of the authoritative write or assessment path.
