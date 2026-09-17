# PALURU Secret Broker Live Acceptance — Human Copy/Paste Runbook

Status: **REVIEW ONLY — DO NOT EXECUTE YET**

This runbook creates and tests an isolated, synthetic-only Transport D environment.
It is not authorization for Codex to deploy anything. A Human performs every Google
Cloud and Apps Script mutation only after this runbook is reviewed.

Production PALURU Mini, `kaz-os-read-gateway`, production Secret Manager,
production Firestore, production credentials, production Apps Script projects,
and production deployments are out of scope. Do not open or modify them.

## Non-negotiable handling rules

- Never paste a project ID, account email, service-account email, OAuth client ID,
  raw Google `sub`, ID token, broker URL, or payload into ChatGPT/Codex, Git,
  screenshots, tickets, or the final evidence JSON.
- Keep identifiers in shell variables. Keep tokens only in process memory. Never
  use `set -x`, `--log-http`, or a command containing a literal token.
- Do not create service-account JSON keys.
- `echo` is not used. `printf` is used only for fixed safe status text, prompts,
  and piping the synthetic value from memory.
- Every Google Cloud mutation after project creation starts with
  `assert_poc_project || exit 1` and also supplies `--project="$POC_PROJECT"`.
- If any command prints administrative identifiers because Google itself includes
  them in an error, do not paste that output into chat. Classify it later as
  **tool/cloud administrative metadata**, not application leakage.
- A failed guard, an unexpected existing resource, or an unexpected IAM member is
  a hard stop. Do not reuse, rename, or repair it ad hoc.
- The initial Apps Script manifest has only `openid`,
  `script.external_request`, and `script.storage`. Do not add
  `userinfo.email` unless Step B14 reaches its narrowly defined fallback gate.

## Fixed logical names

| Resource | Fixed logical name |
|---|---|
| Region | `asia-northeast1` |
| Firestore database | `paluru-secret-poc` |
| Firestore collection | `poc_operations` |
| Artifact Registry repository | `poc-secret-broker` |
| Container image | `private-broker` |
| Cloud Run service | `paluru-secret-broker-poc` |
| Synthetic secret | `paluru-secret-poc-synthetic` |
| Runtime service account ID | `poc-broker-runtime` |
| Provisioner service account ID | `poc-broker-provisioner` |
| Primary Apps Script | `PALURU Secret Broker Live PoC` |
| Wrong-audience Apps Script | `PALURU Secret Broker Wrong Audience PoC` |

---

## Step B0 — Local variables

目的:

PoCの識別子をCloud Shellのメモリ内だけに保持し、以後の全mutationを
専用PoC projectへ固定する。実値はrunbook、chat、evidenceへ書かない。

Humanがやること:

1. Google Cloud Consoleを、PoC Apps Scriptを所有する予定のGoogle accountで開く。
2. Cloud Shellを開く。
3. 下のblockを1回だけ貼る。
4. PoC用に新しく決めたProject IDを2回、非表示promptへ入力する。
5. `B0 READY`だけが表示されることを確認する。

Cloud Shell:

```bash
set -euo pipefail
set +x
umask 077

read -r -s -p "New dedicated PoC Project ID: " POC_PROJECT
printf '\n'
read -r -s -p "Repeat the same PoC Project ID: " POC_PROJECT_CONFIRM
printf '\n'

test -n "$POC_PROJECT" || { printf 'STOP: empty project ID\n'; exit 1; }
test "$POC_PROJECT" = "$POC_PROJECT_CONFIRM" || {
  printf 'STOP: project IDs do not match\n'
  exit 1
}
unset POC_PROJECT_CONFIRM

export POC_PROJECT
export POC_REGION="asia-northeast1"
export POC_DB="paluru-secret-poc"
export POC_COLLECTION="poc_operations"
export POC_BROKER="paluru-secret-broker-poc"
export POC_SECRET="paluru-secret-poc-synthetic"
export POC_REPO="poc-secret-broker"
export POC_IMAGE="private-broker"
export POC_OPERATION_ALIAS="live_acceptance_op_01"
export RUNTIME_SA_ID="poc-broker-runtime"
export PROVISION_SA_ID="poc-broker-provisioner"
export EXPECTED_SOURCE_COMMIT="63b8fc2bab8dec164741cb1aaa63c1c3c0d63c8f"

ORIGINAL_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
OWNER_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"

test -n "$OWNER_ACCOUNT" || { printf 'STOP: no active gcloud account\n'; exit 1; }
test "$POC_PROJECT" != "$ORIGINAL_PROJECT" || {
  printf 'STOP: requested PoC project equals the current project\n'
  exit 1
}
test "$POC_REGION" = "asia-northeast1" || {
  printf 'STOP: region is not Tokyo\n'
  exit 1
}

assert_poc_project() {
  local current
  current="$(gcloud config get-value project 2>/dev/null || true)"
  test "$current" = "$POC_PROJECT" || {
    printf 'STOP: wrong project\n'
    return 1
  }
}

assert_fixed_names() {
  test "$POC_REGION" = "asia-northeast1" &&
  test "$POC_DB" = "paluru-secret-poc" &&
  test "$POC_COLLECTION" = "poc_operations" &&
  test "$POC_BROKER" = "paluru-secret-broker-poc" &&
  test "$POC_SECRET" = "paluru-secret-poc-synthetic" &&
  test "$POC_REPO" = "poc-secret-broker" || {
    printf 'STOP: fixed PoC names changed\n'
    return 1
  }
}

assert_fixed_names || exit 1
printf 'B0 READY\n'
```

成功確認:

- 表示は `B0 READY`。
- Project ID、account emailは画面へ出力されない。
- `set -x` は無効のまま。

失敗したら:

**STOP**。入力値をchatへ貼らない。Cloud Shellを閉じ、B0から新しいsessionでやり直す。

---

## Step B1 — Create dedicated PoC project

目的:

productionとは別の、削除可能なPoC専用Google Cloud projectを作る。

Humanがやること:

1. Cloud Consoleの **Billing > My billing accounts** を開く。
2. 使用するbilling accountがActiveであることだけ確認する。IDをchatへ貼らない。
3. Cloud Shellの非表示promptへbilling account IDを2回入力する。
4. command blockを上から実行する。
5. organization policyでproject parentが必須と言われた場合は、その場でSTOPする。
   既存projectへ切り替えない。

Cloud Shell:

```bash
if gcloud projects describe "$POC_PROJECT" --format=none >/dev/null 2>&1; then
  printf 'STOP: target project already exists; do not reuse it\n'
  exit 1
fi

read -r -s -p "Active billing account ID: " BILLING_ACCOUNT
printf '\n'
read -r -s -p "Repeat billing account ID: " BILLING_ACCOUNT_CONFIRM
printf '\n'
test -n "$BILLING_ACCOUNT" || { printf 'STOP: empty billing account\n'; exit 1; }
test "$BILLING_ACCOUNT" = "$BILLING_ACCOUNT_CONFIRM" || {
  printf 'STOP: billing account IDs do not match\n'
  exit 1
}
unset BILLING_ACCOUNT_CONFIRM

gcloud projects create "$POC_PROJECT" \
  --name="PALURU Secret Console PoC" \
  --labels="environment=poc,purpose=secret-console-live-acceptance" \
  --no-enable-cloud-apis \
  --format=none

gcloud config set project "$POC_PROJECT" >/dev/null
assert_poc_project || exit 1

gcloud billing projects link "$POC_PROJECT" \
  --billing-account="$BILLING_ACCOUNT" \
  --project="$POC_PROJECT" \
  --quiet \
  --format=none
unset BILLING_ACCOUNT

BILLING_ENABLED="$(
  gcloud billing projects describe "$POC_PROJECT" \
    --format='value(billingEnabled)' 2>/dev/null
)"
test "$BILLING_ENABLED" = "True" || {
  printf 'STOP: billing is not enabled\n'
  exit 1
}
unset BILLING_ENABLED

assert_poc_project || exit 1
PROJECT_PURPOSE_LABEL="$(
  gcloud projects describe "$POC_PROJECT" \
    --format='value(labels.purpose)' 2>/dev/null
)"
test "$PROJECT_PURPOSE_LABEL" = "secret-console-live-acceptance" || {
  printf 'STOP: PoC purpose label missing\n'
  exit 1
}
unset PROJECT_PURPOSE_LABEL ORIGINAL_PROJECT
printf 'B1 PASS\n'
```

成功確認:

- `B1 PASS`だけを記録する。
- current projectは新規PoC project。
- billingは有効、purpose labelはPoC用途。

失敗したら:

**STOP**。既存projectを代用しない。表示されたProject IDやbilling IDをchatへ貼らない。

---

## Step B2 — Enable required APIs

目的:

Step Aで決めたAPIだけをPoC projectで有効化する。Apps Script APIは有効化しない。

Humanがやること:

1. 下のblockをそのまま実行する。
2. `B2 PASS`を確認する。
3. Googleがproject作成時に管理するbaseline serviceは削除しない。

Cloud Shell:

```bash
assert_poc_project || exit 1

POC_APIS=(
  serviceusage.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  run.googleapis.com
  artifactregistry.googleapis.com
  cloudbuild.googleapis.com
  firestore.googleapis.com
  secretmanager.googleapis.com
  logging.googleapis.com
  cloudresourcemanager.googleapis.com
)

assert_poc_project || exit 1
gcloud services enable "${POC_APIS[@]}" \
  --project="$POC_PROJECT" \
  --quiet \
  --format=none

for api in "${POC_APIS[@]}"; do
  enabled="$(
    gcloud services list --enabled \
      --project="$POC_PROJECT" \
      --filter="config.name=${api}" \
      --format='value(config.name)' 2>/dev/null
  )"
  test "$enabled" = "$api" || {
    printf 'STOP: a required API is not enabled\n'
    exit 1
  }
done
unset enabled

SCRIPT_API_COUNT="$(
  gcloud services list --enabled \
    --project="$POC_PROJECT" \
    --filter='config.name=script.googleapis.com' \
    --format='value(config.name)' 2>/dev/null | wc -l
)"
test "$SCRIPT_API_COUNT" -eq 0 || {
  printf 'STOP: Apps Script API was unexpectedly enabled\n'
  exit 1
}
unset SCRIPT_API_COUNT
printf 'B2 PASS\n'
```

成功確認:

- `B2 PASS`。
- `script.googleapis.com` はdisabled。
- production gateway関連APIを追加していない。

失敗したら:

**STOP**。不足APIを推測で追加しない。API名だけを安全なissueとして記録する。

---

## Step B3 — Create dedicated service accounts

目的:

runtimeとprovisioningを分離し、JSON keyなしで運用する。広いroleはPoC project内の
provisionerだけに閉じ、runtimeへはまだ付けない。

Humanがやること:

1. 下のblockを実行する。
2. `B3 PASS`を確認する。
3. 以降のGoogle Cloud mutationはprovisioner impersonationを使う。

Cloud Shell:

```bash
assert_poc_project || exit 1

RUNTIME_SA="${RUNTIME_SA_ID}@${POC_PROJECT}.iam.gserviceaccount.com"
PROVISION_SA="${PROVISION_SA_ID}@${POC_PROJECT}.iam.gserviceaccount.com"
export RUNTIME_SA PROVISION_SA

for sa in "$RUNTIME_SA" "$PROVISION_SA"; do
  if gcloud iam service-accounts describe "$sa" \
    --project="$POC_PROJECT" --format=none >/dev/null 2>&1; then
    printf 'STOP: a requested service account already exists\n'
    exit 1
  fi
done

assert_poc_project || exit 1
gcloud iam service-accounts create "$RUNTIME_SA_ID" \
  --display-name="PoC private broker runtime" \
  --description="Synthetic-only PALURU live acceptance runtime" \
  --project="$POC_PROJECT" \
  --format=none

assert_poc_project || exit 1
gcloud iam service-accounts create "$PROVISION_SA_ID" \
  --display-name="PoC private broker provisioner" \
  --description="Human-impersonated PoC-only provisioning identity" \
  --project="$POC_PROJECT" \
  --format=none

PROVISION_ROLES=(
  roles/serviceusage.serviceUsageAdmin
  roles/run.admin
  roles/artifactregistry.admin
  roles/cloudbuild.builds.editor
  roles/datastore.owner
  roles/secretmanager.admin
  roles/iam.serviceAccountAdmin
  roles/resourcemanager.projectIamAdmin
)

for role in "${PROVISION_ROLES[@]}"; do
  assert_poc_project || exit 1
  gcloud projects add-iam-policy-binding "$POC_PROJECT" \
    --member="serviceAccount:${PROVISION_SA}" \
    --role="$role" \
    --condition=None \
    --project="$POC_PROJECT" \
    --quiet \
    --format=none
done

assert_poc_project || exit 1
gcloud iam service-accounts add-iam-policy-binding "$PROVISION_SA" \
  --member="user:${OWNER_ACCOUNT}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$POC_PROJECT" \
  --quiet \
  --format=none

assert_poc_project || exit 1
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${PROVISION_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="$POC_PROJECT" \
  --quiet \
  --format=none

for sa in "$RUNTIME_SA" "$PROVISION_SA"; do
  USER_KEY_COUNT="$(
    gcloud iam service-accounts keys list \
      --iam-account="$sa" \
      --managed-by=user \
      --project="$POC_PROJECT" \
      --format='value(name)' 2>/dev/null | wc -l
  )"
  test "$USER_KEY_COUNT" -eq 0 || {
    printf 'STOP: a user-managed service-account key exists\n'
    exit 1
  }
done
unset USER_KEY_COUNT

GCLOUD_AS_PROVISIONER=(--impersonate-service-account="$PROVISION_SA")
export OWNER_ACCOUNT
printf 'B3 PASS\n'
```

成功確認:

- `B3 PASS`。
- Human accountはprovisionerをimpersonateできる。
- runtime/provisionerともuser-managed keyは0。
- runtimeにEditor、Owner、Admin roleはない。

失敗したら:

**STOP**。JSON keyを作るfallbackは禁止。production projectへIAMを付けない。

---

## Step B4 — Create Artifact Registry

目的:

Tokyo regionにPoC専用Docker repositoryを作り、tagの上書きを禁止する。

Humanがやること:

1. 下のblockを実行する。
2. `B4 PASS`を確認する。

Cloud Shell:

```bash
assert_poc_project || exit 1
if gcloud artifacts repositories describe "$POC_REPO" \
  --location="$POC_REGION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --format=none >/dev/null 2>&1; then
  printf 'STOP: Artifact Registry repository already exists\n'
  exit 1
fi

assert_poc_project || exit 1
gcloud artifacts repositories create "$POC_REPO" \
  --repository-format=docker \
  --location="$POC_REGION" \
  --description="Synthetic-only PALURU broker PoC" \
  --immutable-tags \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet \
  --format=none

REPO_FORMAT="$(
  gcloud artifacts repositories describe "$POC_REPO" \
    --location="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(format)' 2>/dev/null
)"
test "$REPO_FORMAT" = "DOCKER" || {
  printf 'STOP: repository format mismatch\n'
  exit 1
}
unset REPO_FORMAT
printf 'B4 PASS\n'
```

成功確認:

- `B4 PASS`。
- repositoryはPoC project / Tokyo / Docker / immutable tags。

失敗したら:

**STOP**。既存repositoryを再利用しない。

---

## Step B5 — Create named Firestore database

目的:

`(default)` databaseを使わず、PoC専用のNative mode named databaseをTokyoに作る。

Humanがやること:

1. 下の存在確認が0件であることを前提に、blockを実行する。
2. collection/documentは手動作成しない。

Cloud Shell:

```bash
assert_poc_project || exit 1
if gcloud firestore databases describe \
  --database="$POC_DB" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --format=none >/dev/null 2>&1; then
  printf 'STOP: Firestore database already exists; do not reuse it\n'
  exit 1
fi

assert_poc_project || exit 1
gcloud firestore databases create \
  --database="$POC_DB" \
  --location="$POC_REGION" \
  --type=firestore-native \
  --edition=standard \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet \
  --format=none

DB_LOCATION="$(
  gcloud firestore databases describe \
    --database="$POC_DB" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(locationId)' 2>/dev/null
)"
DB_TYPE="$(
  gcloud firestore databases describe \
    --database="$POC_DB" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(type)' 2>/dev/null
)"
test "$DB_LOCATION" = "$POC_REGION" || {
  printf 'STOP: Firestore location mismatch\n'
  exit 1
}
test "$DB_TYPE" = "FIRESTORE_NATIVE" || {
  printf 'STOP: Firestore mode mismatch\n'
  exit 1
}
unset DB_LOCATION DB_TYPE
printf 'B5 PASS\n'
```

成功確認:

- `B5 PASS`。
- database IDは`paluru-secret-poc`、Native mode、Tokyo。
- collectionはまだ0件でよい。

失敗したら:

**STOP**。`(default)` databaseへ切り替えない。同名databaseを再利用しない。

---

## Step B6 — Create synthetic secret

目的:

credential形式に似ていない固定synthetic valueだけを、TokyoのPoC secretへ保存する。

Humanがやること:

1. 下のblockを実行する。
2. promptには正確に `PALURU_SYNTHETIC_LIVE_ACCEPTANCE_VALUE` と入力する。
3. 値は非表示で、shell historyへ残らない。

Cloud Shell:

```bash
assert_poc_project || exit 1
if gcloud secrets describe "$POC_SECRET" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --format=none >/dev/null 2>&1; then
  printf 'STOP: synthetic secret already exists; do not reuse it\n'
  exit 1
fi

assert_poc_project || exit 1
gcloud secrets create "$POC_SECRET" \
  --replication-policy=user-managed \
  --locations="$POC_REGION" \
  --labels="environment=poc,purpose=live-acceptance" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet \
  --format=none

read -r -s -p "Synthetic value (exact fixed phrase): " SYNTH_VALUE
printf '\n'
test "$SYNTH_VALUE" = "PALURU_SYNTHETIC_LIVE_ACCEPTANCE_VALUE" || {
  unset SYNTH_VALUE
  printf 'STOP: synthetic value mismatch\n'
  exit 1
}

assert_poc_project || exit 1
SECRET_VERSION_RESOURCE="$(
  printf '%s' "$SYNTH_VALUE" | gcloud secrets versions add "$POC_SECRET" \
    --data-file=- \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --quiet \
    --format='value(name)'
)"
unset SYNTH_VALUE

POC_SECRET_VERSION="${SECRET_VERSION_RESOURCE##*/}"
unset SECRET_VERSION_RESOURCE
test "$POC_SECRET_VERSION" -ge 1 2>/dev/null || {
  printf 'STOP: secret version was not created\n'
  exit 1
}
export POC_SECRET_VERSION
printf 'B6 PASS\n'
```

成功確認:

- `B6 PASS`。
- secret version numberだけがshell variableへ残る。
- payloadはterminal、Git、log、evidenceへ出ない。

失敗したら:

**STOP**。production secret名やcredential文字列で再試行しない。

---

## Step B7 — Bind runtime IAM

目的:

runtimeへ、named Firestore databaseのread/writeと、synthetic secretのaccessだけを付ける。

Humanがやること:

1. 下のblockを実行する。
2. `B7 PASS`を確認する。

Cloud Shell:

```bash
assert_poc_project || exit 1

DB_CONDITION="expression=resource.name==\"projects/${POC_PROJECT}/databases/${POC_DB}\",title=poc_named_database_only,description=PoC_named_database_only"
export DB_CONDITION

assert_poc_project || exit 1
gcloud projects add-iam-policy-binding "$POC_PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --condition="$DB_CONDITION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet \
  --format=none

assert_poc_project || exit 1
gcloud secrets add-iam-policy-binding "$POC_SECRET" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet \
  --format=none

PROJECT_POLICY="$(
  gcloud projects get-iam-policy "$POC_PROJECT" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format=json
)"
BAD_RUNTIME_ROLE_COUNT="$(
  POLICY_JSON="$PROJECT_POLICY" MEMBER="serviceAccount:${RUNTIME_SA}" python3 -c '
import json, os
p=json.loads(os.environ["POLICY_JSON"])
bad={"roles/owner","roles/editor","roles/secretmanager.admin","roles/run.admin","roles/iam.serviceAccountAdmin"}
print(sum(1 for b in p.get("bindings",[]) if b.get("role") in bad and os.environ["MEMBER"] in b.get("members",[])))
'
)"
unset PROJECT_POLICY
test "$BAD_RUNTIME_ROLE_COUNT" -eq 0 || {
  printf 'STOP: runtime received a forbidden broad role\n'
  exit 1
}
unset BAD_RUNTIME_ROLE_COUNT
printf 'B7 PASS\n'
```

成功確認:

- `B7 PASS`。
- runtimeのproject-level broad roleは0。
- Firestore bindingにはnamed database conditionがある。
- secret accessorはPoC secret resourceだけ。

失敗したら:

**STOP**。Editor/Owner/Adminを付けて回避しない。

---

## Step B8 — Verify source and build a digest-pinned image

目的:

review済みcommitのPoC sourceだけをclean worktreeから検証し、Cloud Buildでbuildして
Artifact Registryへpushする。deploy用参照はtagではなくdigestに固定する。

Humanがやること:

1. **ローカル端末**で、repoのreview済みcommitからclean worktreeを作る。
2. git check、secret scan、`npm test`を通す。
3. そのcommitだけからtar.gzを作る。
4. Cloud Shell右上の **More > Upload** でtar.gzをuploadする。
5. Cloud Shell blockを実行してhash照合、build、digest取得を行う。
6. commit SHAとbuild resultは安全情報だが、Project ID等をchatへ貼らない。

ローカルPowerShell:

```powershell
$Repo = 'C:\Users\alles\Alle_apps\Projects\HomeApps\paruru-mini'
$Expected = '63b8fc2bab8dec164741cb1aaa63c1c3c0d63c8f'
$Worktree = Join-Path $env:TEMP 'paluru-secret-broker-reviewed'
$Archive = Join-Path $env:TEMP 'private-broker-source.tar.gz'

if (Test-Path -LiteralPath $Worktree) { throw 'STOP: clean worktree path already exists' }
if (Test-Path -LiteralPath $Archive) { throw 'STOP: source archive already exists' }

git -C $Repo rev-parse --verify "$Expected^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'STOP: expected source commit missing' }
git -C $Repo worktree add --detach $Worktree $Expected
if ($LASTEXITCODE -ne 0) { throw 'STOP: clean worktree creation failed' }

$Dirty = git -C $Worktree status --porcelain
if ($Dirty) { throw 'STOP: reviewed worktree is not clean' }
git -C $Worktree diff --check "$Expected^" $Expected -- secret-console/poc/private-broker
if ($LASTEXITCODE -ne 0) { throw 'STOP: git diff --check failed' }

$Source = Join-Path $Worktree 'secret-console\poc\private-broker'
$SecretHits = rg -l -I -g '!node_modules/**' `
  -e 'AIza[0-9A-Za-z_-]{20,}' `
  -e 'ya29\.[0-9A-Za-z._-]{20,}' `
  -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' `
  -e 'Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}' $Source
if ($LASTEXITCODE -eq 0 -or $SecretHits) { throw 'STOP: secret scan found a candidate' }
if ($LASTEXITCODE -ne 1) { throw 'STOP: secret scan could not complete' }

Push-Location $Source
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'STOP: Node.js 22+ is required' }
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'STOP: npm ci failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'STOP: npm test failed' }
npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'STOP: npm audit failed' }
Pop-Location

git -C $Worktree archive --format=tar.gz --output=$Archive $Expected secret-console/poc/private-broker
if ($LASTEXITCODE -ne 0) { throw 'STOP: source archive failed' }
Get-FileHash -Algorithm SHA256 -LiteralPath $Archive
```

Cloud Shell:

```bash
assert_poc_project || exit 1
test -f "$HOME/private-broker-source.tar.gz" || {
  printf 'STOP: reviewed source archive not uploaded\n'
  exit 1
}

read -r -s -p "SHA-256 shown by local Get-FileHash: " EXPECTED_ARCHIVE_SHA256
printf '\n'
ACTUAL_ARCHIVE_SHA256="$(sha256sum "$HOME/private-broker-source.tar.gz" | cut -d' ' -f1)"
test "$ACTUAL_ARCHIVE_SHA256" = "$EXPECTED_ARCHIVE_SHA256" || {
  printf 'STOP: source archive hash mismatch\n'
  exit 1
}
unset EXPECTED_ARCHIVE_SHA256 ACTUAL_ARCHIVE_SHA256

SOURCE_ROOT="$(mktemp -d)"
tar -xzf "$HOME/private-broker-source.tar.gz" -C "$SOURCE_ROOT"
SOURCE_DIR="$SOURCE_ROOT/secret-console/poc/private-broker"
test -f "$SOURCE_DIR/Dockerfile" || { printf 'STOP: Dockerfile missing\n'; exit 1; }
test -f "$SOURCE_DIR/package-lock.json" || { printf 'STOP: lockfile missing\n'; exit 1; }

SOURCE_SECRET_HIT_COUNT="$(
  grep -RIlE --exclude-dir=node_modules --exclude='*.md' \
    '(AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._-]{20,})' \
    "$SOURCE_DIR" 2>/dev/null | wc -l
)"
test "$SOURCE_SECRET_HIT_COUNT" -eq 0 || {
  printf 'STOP: uploaded source secret scan failed\n'
  exit 1
}
unset SOURCE_SECRET_HIT_COUNT

BUILD_SA_RESOURCE="$(
  gcloud builds get-default-service-account \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(serviceAccountEmail)' 2>/dev/null
)"
BUILD_SA="${BUILD_SA_RESOURCE##*/}"
unset BUILD_SA_RESOURCE
test -n "$BUILD_SA" || { printf 'STOP: no default Cloud Build identity\n'; exit 1; }

assert_poc_project || exit 1
gcloud artifacts repositories add-iam-policy-binding "$POC_REPO" \
  --location="$POC_REGION" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" --quiet --format=none

assert_poc_project || exit 1
gcloud iam service-accounts add-iam-policy-binding "$BUILD_SA" \
  --member="serviceAccount:${PROVISION_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" --quiet --format=none

BUILD_ALIAS="src-${EXPECTED_SOURCE_COMMIT:0:12}"
IMAGE_URI="${POC_REGION}-docker.pkg.dev/${POC_PROJECT}/${POC_REPO}/${POC_IMAGE}"
export BUILD_ALIAS IMAGE_URI

cd "$SOURCE_DIR"
assert_poc_project || exit 1
BUILD_ID="$(
  gcloud builds submit . \
    --tag="${IMAGE_URI}:${BUILD_ALIAS}" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --suppress-logs --quiet --format='value(id)'
)"
test -n "$BUILD_ID" || { printf 'STOP: Cloud Build ID missing\n'; exit 1; }

BUILD_STATUS="$(
  gcloud builds describe "$BUILD_ID" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(status)' 2>/dev/null
)"
test "$BUILD_STATUS" = "SUCCESS" || {
  printf 'STOP: Cloud Build did not succeed\n'
  exit 1
}

IMAGE_DIGEST="$(
  gcloud artifacts docker images describe "${IMAGE_URI}:${BUILD_ALIAS}" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(image_summary.digest)' 2>/dev/null
)"
case "$IMAGE_DIGEST" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) printf 'STOP: image digest invalid\n'; exit 1 ;;
esac
export IMAGE_DIGEST
case "$SOURCE_ROOT" in
  /tmp/tmp.*) ;;
  *) printf 'STOP: unexpected temporary source path\n'; exit 1 ;;
esac
rm -rf -- "$SOURCE_ROOT"
rm -f -- "$HOME/private-broker-source.tar.gz"
unset BUILD_STATUS BUILD_ID SOURCE_DIR SOURCE_ROOT
printf 'B8 PASS\n'
```

Cloud Build成功後、ローカルPowerShellでもreview用copyを削除する:

```powershell
git -C $Repo worktree remove $Worktree
if ($LASTEXITCODE -ne 0) { throw 'STOP: reviewed worktree cleanup failed' }
Remove-Item -LiteralPath $Archive
```

成功確認:

- Local: clean detached worktree、`git diff --check`、secret scan、tests、auditがPASS。
- Cloud Build statusは`SUCCESS`。
- `IMAGE_DIGEST`は`sha256:` + 64 hexで、deployには`${IMAGE_URI}@${IMAGE_DIGEST}`を使う。
- Cloud Build / Artifact Registry以外へimageをpushしていない。
- Cloud Shell/localのsource copyは削除済み。Cloud Build source staging objectはPoC project削除時に消す。

失敗したら:

**STOP**。dirty working treeからbuildしない。tagだけでdeployしない。別repositoryへpushしない。

---

## Step B9 — Deploy private Cloud Run broker

目的:

privateなCloud Run serviceを、digest pin・runtime SA・min 0・max 1・concurrency 1で
まずbootstrap設定へdeployする。Apps Script audienceはまだ登録しない。

Humanがやること:

1. 下のblockを実行する。
2. deploy時のOIDC audienceとowner hashは、呼出不能なbootstrap placeholderである。
3. service URLはshell variableへ保持し、出力しない。

Cloud Shell:

```bash
assert_poc_project || exit 1
if gcloud run services describe "$POC_BROKER" \
  --region="$POC_REGION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --format=none >/dev/null 2>&1; then
  printf 'STOP: Cloud Run service already exists; do not reuse it\n'
  exit 1
fi

BOOTSTRAP_AUDIENCE="poc-bootstrap-invalid-audience"
BOOTSTRAP_OWNER_HASH="0000000000000000000000000000000000000000000000000000000000000000"

assert_poc_project || exit 1
gcloud run deploy "$POC_BROKER" \
  --image="${IMAGE_URI}@${IMAGE_DIGEST}" \
  --region="$POC_REGION" \
  --platform=managed \
  --execution-environment=gen2 \
  --service-account="$RUNTIME_SA" \
  --no-allow-unauthenticated \
  --ingress=all \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=1 \
  --cpu=1 \
  --memory=256Mi \
  --timeout=60s \
  --set-env-vars="POC_OPERATION_STORE_MODE=firestore,POC_SECRET_STORE_MODE=gcp,POC_GCP_PROJECT_ID=${POC_PROJECT},POC_FIRESTORE_DATABASE_ID=${POC_DB},POC_FIRESTORE_COLLECTION=${POC_COLLECTION},POC_SYNTHETIC_SECRET_ID=${POC_SECRET},POC_SYNTHETIC_SECRET_VERSION=${POC_SECRET_VERSION},POC_OPERATION_ALIAS=${POC_OPERATION_ALIAS},POC_OIDC_AUDIENCE=${BOOTSTRAP_AUDIENCE},POC_OWNER_SUBJECT_SHA256=${BOOTSTRAP_OWNER_HASH}" \
  --labels="environment=poc,purpose=secret-console-live-acceptance" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

BROKER_URL="$(
  gcloud run services describe "$POC_BROKER" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(status.url)' 2>/dev/null
)"
case "$BROKER_URL" in
  https://*.run.app) ;;
  *) printf 'STOP: Cloud Run URL invalid\n'; exit 1 ;;
esac
export BROKER_URL

RUN_POLICY="$(
  gcloud run services get-iam-policy "$POC_BROKER" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format=json
)"
PUBLIC_INVOKER_COUNT="$(
  POLICY_JSON="$RUN_POLICY" python3 -c '
import json, os
p=json.loads(os.environ["POLICY_JSON"])
public={"allUsers","allAuthenticatedUsers"}
print(sum(1 for b in p.get("bindings",[]) if b.get("role")=="roles/run.invoker" for m in b.get("members",[]) if m in public))
'
)"
unset RUN_POLICY
test "$PUBLIC_INVOKER_COUNT" -eq 0 || {
  printf 'STOP: public Cloud Run invoker exists\n'
  exit 1
}
unset PUBLIC_INVOKER_COUNT BOOTSTRAP_AUDIENCE BOOTSTRAP_OWNER_HASH
printf 'B9 PASS\n'
```

成功確認:

- `B9 PASS`。
- unauthenticated memberは0。
- runtime identityは専用SA。
- imageはdigest pin。
- initial scalingはmin 0 / max 1 / concurrency 1。
- applicationへSecret Manager payloadをenv injectionしていない。
- Cloud RunはHTTP endpointを持つが、IAM認証なしでは到達できない。

失敗したら:

**STOP**。`--allow-unauthenticated`へ切り替えない。production gatewayへdeployしない。

---

## Step B10 — Create standalone Apps Script PoC

目的:

production Miniと完全に別のstandalone Apps Scriptへ、transport検証に必要な最小codeだけを置く。
Standard Cloud Projectへの変更、Apps Script API executable、Web App deploymentは作らない。

Humanがやること:

1. production Miniを閉じる。`script.new`を新しいtabで開く。
2. Project titleを **PALURU Secret Broker Live PoC** にする。
3. 左の **Project Settings** を開き、Time zoneを **(GMT+09:00) Tokyo** にする。
4. **Show "appsscript.json" manifest file in editor** をONにする。
5. `Code.gs`の内容を、review済みsourceの
   `secret-console/poc/private-broker/apps-script/Code.js` 全体で置き換える。
6. `appsscript.json`を、同directoryの`appsscript.json`全体で置き換える。
7. `AcceptanceHarness.gs`を追加し、下のacceptance-only codeを貼る。
8. **Deploy** は押さない。Web App / API executableを作らない。
9. Project Settingsの **Script properties > Add script property** で、
   key `POC_PRIVATE_BROKER_URL` を追加する。valueはCloud Consoleの
   **Cloud Run > paluru-secret-broker-poc > URL** からコピーする。
   URLをchatやscreenshotへ貼らない。
10. Cloud project欄は変更しない。default projectのままでよい。

Apps Script — `AcceptanceHarness.gs`:

```javascript
'use strict';

function pocStageIdentityBindingForBootstrap_() {
  var metadata = pocIdentityBindingMetadata_();
  if (!metadata.issuer_valid || !metadata.has_exp || !metadata.has_iat) {
    throw new Error('POC_IDENTITY_METADATA_INVALID');
  }
  PropertiesService.getScriptProperties().setProperties({
    POC_BOOTSTRAP_AUDIENCE: metadata.audience,
    POC_BOOTSTRAP_OWNER_SUBJECT_SHA256: metadata.owner_subject_sha256
  }, false);
  return { success: true, code: 'BOOTSTRAP_METADATA_STAGED' };
}

function pocClearIdentityBindingBootstrap_() {
  var properties = PropertiesService.getScriptProperties();
  properties.deleteProperty('POC_BOOTSTRAP_AUDIENCE');
  properties.deleteProperty('POC_BOOTSTRAP_OWNER_SUBJECT_SHA256');
  return { success: true, code: 'BOOTSTRAP_METADATA_CLEARED' };
}

function pocAcceptanceDeps_(hooks) {
  var properties = PropertiesService.getScriptProperties();
  var brokerUrl = properties.getProperty(POC_BROKER_KEYS_.BROKER_URL);
  if (!brokerUrl || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(brokerUrl)) {
    throw new Error('POC_CONFIGURATION_INVALID');
  }
  brokerUrl = brokerUrl.replace(/\/$/, '');
  var identityToken = ScriptApp.getIdentityToken();
  if (!identityToken) throw new Error('POC_IDENTITY_TOKEN_UNAVAILABLE');

  return {
    get: function (key) { return properties.getProperty(key); },
    setMany: function (values) { properties.setProperties(values, false); },
    deleteMany: function (keys) {
      keys.forEach(function (key) { properties.deleteProperty(key); });
    },
    request: function (path, body) {
      var response = UrlFetchApp.fetch(brokerUrl + path, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + identityToken },
        payload: JSON.stringify(body || {}),
        muteHttpExceptions: true
      });
      var status = response.getResponseCode();
      var parsed;
      try {
        parsed = JSON.parse(response.getContentText());
      } catch (ignored) {
        throw new Error('POC_BROKER_RESPONSE_INVALID');
      }
      if (status < 200 || status >= 300) {
        var safeCode = parsed && parsed.error && parsed.error.code;
        throw new Error(/^[-A-Z0-9_]{1,64}$/.test(safeCode || '')
          ? safeCode
          : 'POC_BROKER_REQUEST_FAILED');
      }
      return parsed;
    },
    hooks: hooks || {}
  };
}

function pocLogObservedResult_(testId, startedAt, action) {
  try {
    var result = action();
    var safeCode = result && /^[-A-Z0-9_]{1,64}$/.test(result.code || '')
      ? result.code
      : 'OK';
    var operationAlias = result && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result.operation_alias || '')
      ? result.operation_alias
      : null;
    console.log(JSON.stringify({
      test_id: testId,
      status: result && result.success === false ? 'FAIL' : 'PASS',
      safe_code: safeCode,
      elapsed_ms: Date.now() - startedAt,
      operation_alias: operationAlias,
      timestamp: new Date().toISOString()
    }));
    return result;
  } catch (error) {
    var errorCode = pocSafeErrorCode_(error);
    console.log(JSON.stringify({
      test_id: testId,
      status: 'FAIL',
      safe_code: errorCode,
      elapsed_ms: Date.now() - startedAt,
      operation_alias: null,
      timestamp: new Date().toISOString()
    }));
    throw new Error(errorCode);
  }
}

function pocObservedPrivateBrokerTick_() {
  var startedAt = Date.now();
  return pocLogObservedResult_('manual_tick', startedAt, function () {
    return pocPrivateBrokerTick_();
  });
}

function pocObservedNoLockTick_() {
  var startedAt = Date.now();
  return pocLogObservedResult_('no_lock_competitor', startedAt, function () {
    return pocPrivateBrokerTickWithDeps_(pocAcceptanceDeps_({}));
  });
}

function pocAckLossOnce_() {
  var startedAt = Date.now();
  return pocLogObservedResult_('ack_loss_once', startedAt, function () {
    return pocPrivateBrokerTickWithDeps_(pocAcceptanceDeps_({
      beforeAck: function () {
        throw new Error('POC_ACK_LOSS_INJECTED');
      }
    }));
  });
}
```

Cloud Shell:

```bash
# No mutation in this step. Keep the existing shell session and variables alive.
assert_poc_project || exit 1
printf 'B10 UI CHECKPOINT\n'
```

成功確認:

- 新規standalone projectだけが開いている。
- manifest scopeは次の3件だけ。
  - `openid`
  - `https://www.googleapis.com/auth/script.external_request`
  - `https://www.googleapis.com/auth/script.storage`
- `userinfo.email`、Calendar、Spreadsheet、Drive、`script.scriptapp`はない。
- `doPost`、Web App、API executable、production property nameはない。
- Cloud Projectは変更していない。

失敗したら:

**STOP**。production Miniへ貼らない。Standard Cloud Projectへ変更しない。

---

## Step B11 — Obtain Apps Script audience and owner binding

目的:

ID tokenそのものやraw `sub`を表示せず、OIDC audienceと`sub`のSHA-256だけを
一時Script Property経由でHumanのCloud Shellへ移す。値は最終evidenceへ残さない。

Humanがやること:

1. Apps Script editor上部のfunction selectorで
   `pocStageIdentityBindingForBootstrap_` を選び、**Run**を押す。
2. このPoC scriptだけのOAuth consentを行う。要求scopeがB10の3件と一致しなければSTOP。
3. 左の **Project Settings > Script properties** を開く。
4. `POC_BOOTSTRAP_AUDIENCE` のvalueをコピーし、Cloud Shellの最初の非表示promptへ貼る。
5. `POC_BOOTSTRAP_OWNER_SUBJECT_SHA256` のvalueをコピーし、2番目の非表示promptへ貼る。
6. 値をchat、screenshot、メモ、Gitへ貼らない。
7. Cloud Shell blockを実行する。
8. Apps Scriptで`pocClearIdentityBindingBootstrap_`を1回Runする。
9. Project Settingsへ戻り、2つの`POC_BOOTSTRAP_*` propertyが消えたことを確認する。

注意:

Apps ScriptのProject Settingsに表示される **Script ID** はOIDC audienceではない。
Google公式手順でもclient IDはID tokenの`aud` claimから得る。このrunbookはtokenとraw
`sub`をpersist/logせず、既存helperが返すaudienceとhashだけを一時退避する。

Cloud Shell:

```bash
read -r -s -p "PoC Apps Script OIDC audience: " OIDC_AUDIENCE
printf '\n'
read -r -s -p "PoC owner subject SHA-256: " OWNER_SUBJECT_SHA256
printf '\n'

test -n "$OIDC_AUDIENCE" || { printf 'STOP: empty audience\n'; exit 1; }
test "${#OWNER_SUBJECT_SHA256}" -eq 64 || {
  printf 'STOP: owner digest length invalid\n'
  exit 1
}
case "$OWNER_SUBJECT_SHA256" in
  *[!0-9a-f]*) printf 'STOP: owner digest format invalid\n'; exit 1 ;;
esac
export OIDC_AUDIENCE OWNER_SUBJECT_SHA256

assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --add-custom-audiences="$OIDC_AUDIENCE" \
  --update-env-vars="POC_OIDC_AUDIENCE=${OIDC_AUDIENCE},POC_OWNER_SUBJECT_SHA256=${OWNER_SUBJECT_SHA256}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

assert_poc_project || exit 1
SERVICE_AUDIENCES_JSON="$(
  gcloud run services describe "$POC_BROKER" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format=json
)"
AUDIENCE_PRESENT="$(
  SERVICE_JSON="$SERVICE_AUDIENCES_JSON" EXPECTED="$OIDC_AUDIENCE" python3 -c '
import json, os
s=json.loads(os.environ["SERVICE_JSON"])
raw=((s.get("metadata") or {}).get("annotations") or {}).get("run.googleapis.com/custom-audiences","[]")
try: values=json.loads(raw)
except Exception: values=[]
print("yes" if os.environ["EXPECTED"] in values else "no")
'
)"
unset SERVICE_AUDIENCES_JSON
test "$AUDIENCE_PRESENT" = "yes" || {
  printf 'STOP: custom audience was not applied\n'
  exit 1
}
unset AUDIENCE_PRESENT
printf 'B11 CLOUD PASS\n'
```

成功確認:

- `B11 CLOUD PASS`。
- Cloud Run custom audienceにPoC Apps Scriptのaudienceがある。
- new revisionは同じdigest imageを使い、envのaudience/hashだけが変わった。
- Script Propertiesの`POC_BOOTSTRAP_*`は削除済み。
- raw token、raw `sub`、emailは一度もlog/persistしていない。

失敗したら:

**STOP**。Script IDを代用しない。tokenをdecodeして画面へ出さない。Standard Cloud Projectへ
変更しない。

---

## Step B12 — Grant owner-only Cloud Run Invoker

目的:

PoC Apps Scriptを所有するHuman accountだけに、PoC Cloud Run service単位のInvokerを付ける。

Humanがやること:

1. Apps ScriptとCloud Shellが同じHuman accountであることをbrowser profileで確認する。
2. account emailを口頭・chat・screenshotへ出さず、下のblockを実行する。
3. third-party account、group、production identityは追加しない。

Cloud Shell:

```bash
assert_poc_project || exit 1
gcloud run services add-iam-policy-binding "$POC_BROKER" \
  --region="$POC_REGION" \
  --member="user:${OWNER_ACCOUNT}" \
  --role="roles/run.invoker" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

RUN_POLICY="$(
  gcloud run services get-iam-policy "$POC_BROKER" \
    --region="$POC_REGION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format=json
)"
EXPECTED_OWNER_COUNT="$(
  POLICY_JSON="$RUN_POLICY" MEMBER="user:${OWNER_ACCOUNT}" python3 -c '
import json, os
p=json.loads(os.environ["POLICY_JSON"])
print(sum(1 for b in p.get("bindings",[]) if b.get("role")=="roles/run.invoker" and os.environ["MEMBER"] in b.get("members",[])))
'
)"
PUBLIC_COUNT="$(
  POLICY_JSON="$RUN_POLICY" python3 -c '
import json, os
p=json.loads(os.environ["POLICY_JSON"])
public={"allUsers","allAuthenticatedUsers"}
print(sum(1 for b in p.get("bindings",[]) if b.get("role")=="roles/run.invoker" for m in b.get("members",[]) if m in public))
'
)"
unset RUN_POLICY
test "$EXPECTED_OWNER_COUNT" -eq 1 || {
  printf 'STOP: owner-only invoker binding missing or duplicated\n'
  exit 1
}
test "$PUBLIC_COUNT" -eq 0 || {
  printf 'STOP: public invoker exists\n'
  exit 1
}
unset EXPECTED_OWNER_COUNT PUBLIC_COUNT
printf 'B12 PASS\n'
```

成功確認:

- `B12 PASS`。
- InvokerはHuman owner 1件、public principal 0件。
- runtime/provisioner/production identityへInvokerを追加していない。

失敗したら:

**STOP**。anonymousへ開けない。別accountを追加しない。

---

## Step B13 — Create the installable trigger

目的:

PoC Apps Scriptだけに5分間隔のinstallable triggerを1個作り、実Human identityで実行させる。

Humanがやること:

1. **PALURU Secret Broker Live PoC** のApps Script editorを開く。
2. 左の時計icon **Triggers** を開く。
3. 右下 **Add Trigger** を押す。
4. 次を選ぶ。
   - Choose which function to run: `pocPrivateBrokerTick_`
   - Choose which deployment should run: `Head`
   - Select event source: `Time-driven`
   - Select type of time based trigger: `Minutes timer`
   - Select minute interval: `Every 5 minutes`
5. **Save**。OAuth画面が出たら、このPoC scriptだけを認可する。
6. Trigger一覧に1件だけあることを確認する。
7. production MiniのTriggers画面は開かない。

Cloud Shell:

```bash
# No Cloud mutation. The trigger is created only in the isolated Apps Script UI.
assert_poc_project || exit 1
printf 'B13 UI CHECKPOINT\n'
```

成功確認:

- PoC projectに`pocPrivateBrokerTick_` / Time-driven / Every 5 minutesが1件。
- trigger creatorはB12と同じHuman。
- production Mini trigger変更は0。

失敗したら:

**STOP**。programmatic trigger作成のために`script.scriptapp` scopeを追加しない。

---

## Step B14 — First safe smoke and three scheduled observations

目的:

synthetic operationだけで、real Apps Script OIDC、Cloud Run IAM、broker、Firestore、
Secret Manager、A/B slot、ACKのend-to-endを確認する。最低3回はinstallable triggerの
実executionを待つ。

Humanがやること:

1. trigger作成後、最低15分待つ。Apps Scriptの時刻は多少ずれるため最大20分見る。
2. Apps Script左の **Executions** を開く。
3. Functionが`pocPrivateBrokerTick_`、Typeが`Time Driven`のexecutionを3件確認する。
4. 3件すべてのStart time、Duration、Statusだけを確認する。画面全体のscreenshotは貼らない。
5. Cloud Consoleで **Firestore > Databases > paluru-secret-poc > Data** を開く。
6. `poc_operations`の対象documentで、最終stateが`APPLIED_ACKNOWLEDGED`、
   `acknowledged=true`、`attempt_count=1`であることを確認する。
7. Apps Script **Project Settings > Script properties** でactive slotが`A`または`B`、
   そのslotだけにsynthetic valueがあることを目視する。valueはコピーしない。
8. Cloud Run logsでは、最初のexecutionにpoll / lease / redeem / ackのsafe requestがあり、
   後続はpollだけであることを確認する。

Cloud Shell:

```bash
assert_poc_project || exit 1

APP_LOG_COUNT="$(
  gcloud logging read \
    "resource.type=cloud_run_revision AND resource.labels.service_name=${POC_BROKER} AND logName:\"run.googleapis.com%2Fstdout\" AND (textPayload:\"broker_request\" OR jsonPayload.event=\"broker_request\")" \
    --freshness=60m \
    --limit=100 \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --format='value(insertId)' 2>/dev/null | wc -l
)"
test "$APP_LOG_COUNT" -ge 5 || {
  printf 'STOP: too few safe broker request logs for three observations\n'
  exit 1
}
unset APP_LOG_COUNT
printf 'B14 CLOUD LOG CHECK PASS\n'
```

成功確認:

- real trigger executions >= 3。
- first flowは`READY -> LEASED -> REDEEMED -> APPLIED_ACKNOWLEDGED`。
- apply countは1、duplicate applyは0。
- 後続triggerはno-operationで成功。
- synthetic payloadは意図されたPoC Script Property slot以外へ出ていない。

`openid`のみで失敗した場合の限定fallback:

1. Cloud Run application logが1件もなく、IAM front doorで401/403になったことを確認する。
2. custom audience、owner Invoker、同一accountを再確認する。
3. それでも同じなら、Human reviewを挟んでからだけ、manifestへ
   `https://www.googleapis.com/auth/userinfo.email`を追加し再認可する。
4. 成功した場合は`EMAIL_SCOPE_REQUIRED`、変化なしなら削除して`EMAIL_SCOPE_NOT_CAUSAL`。
5. email claimをapplication logへ出さない。

失敗したら:

**STOP**。production設定へ波及させない。推測でemail scopeを足さない。

---

## Step B15 — Negative, concurrency, recovery, and expiry tests

目的:

認証拒否、owner binding、duplicate、Firestore atomicity、ACK loss、restart、cold start、
temporary Firestore failure、expired OIDCをPoC内だけで確認する。

Humanがやること:

1. B14で3 executionsを確認後、Apps Script **Triggers** で5分triggerを削除する。
   negative test中の予期しないscheduled callを防ぐ。
2. 以下を番号順に行う。
3. 各testはsafe code / HTTP status / elapsed timeだけをB16 evidenceへ入れる。
4. identity、token、URL、payloadを保存しない。

### B15-1 Missing token

Cloud Shell:

```bash
assert_poc_project || exit 1
MISSING_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --header 'Content-Type: application/json' \
    --data '{}' \
    "${BROKER_URL}/v1/operations/poll"
)"
case "$MISSING_STATUS" in
  401|403) printf 'B15-1 PASS\n' ;;
  *) printf 'STOP: missing token was not rejected\n'; exit 1 ;;
esac
unset MISSING_STATUS
```

成功確認:

- 401または403。
- application actionは0。

失敗したら:

**STOP**。serviceがpublicになっていないか確認する。

### B15-2 Malformed token

Cloud Shell:

```bash
assert_poc_project || exit 1
MALFORMED_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request POST \
    --header 'Content-Type: application/json' \
    --header 'Authorization: Bearer malformed-poc-token' \
    --data '{}' \
    "${BROKER_URL}/v1/operations/poll"
)"
case "$MALFORMED_STATUS" in
  401|403) printf 'B15-2 PASS\n' ;;
  *) printf 'STOP: malformed token was not rejected\n'; exit 1 ;;
esac
unset MALFORMED_STATUS
```

成功確認:

- 401または403。
- literalはcredential形式ではなく、安全なmalformed marker。

失敗したら:

**STOP**。

### B15-3 Wrong audience

Human UI:

1. `script.new`で2個目のstandalone projectを作り、
   **PALURU Secret Broker Wrong Audience PoC** と名付ける。
2. manifestはprimaryと同じ`openid`、`script.external_request`、`script.storage`だけにする。
3. Script Property `POC_PRIVATE_BROKER_URL`へ同じPoC broker URLを設定する。
4. 下のcodeを`Code.gs`へ貼り、`pocWrongAudienceProbe_`をRunする。
5. Execution logに`WRONG_AUDIENCE_REJECTED`だけが出ればPASS。
6. client ID/tokenは表示・保存しない。このscriptへtriggerは作らない。

Apps Script:

```javascript
function pocWrongAudienceProbe_() {
  var url = PropertiesService.getScriptProperties()
    .getProperty('POC_PRIVATE_BROKER_URL');
  if (!url || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(url)) {
    throw new Error('POC_CONFIGURATION_INVALID');
  }
  var token = ScriptApp.getIdentityToken();
  if (!token) throw new Error('POC_IDENTITY_TOKEN_UNAVAILABLE');
  var response = UrlFetchApp.fetch(
    url.replace(/\/$/, '') + '/v1/operations/poll',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: '{}',
      muteHttpExceptions: true
    }
  );
  var status = response.getResponseCode();
  if (status === 401 || status === 403) {
    console.log('WRONG_AUDIENCE_REJECTED');
    return;
  }
  throw new Error('WRONG_AUDIENCE_NOT_REJECTED');
}
```

成功確認:

- second PoC scriptのreal Google ID tokenは401/403。
- primary Apps Script audienceは変更していない。

失敗したら:

**STOP**。second client IDをcustom audienceへ追加しない。

### B15-4 Wrong owner simulation

Cloud Shell:

```bash
WRONG_OWNER_HASH="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --update-env-vars="POC_OWNER_SUBJECT_SHA256=${WRONG_OWNER_HASH}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
```

Human UI:

1. primary Apps Scriptで`pocObservedPrivateBrokerTick_`をRunする。
2. `TOKEN_OWNER_INVALID`だけがsafe errorとして出ることを確認する。
3. 直ちに次のrestore blockを実行する。

Cloud Shell — restore:

```bash
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --update-env-vars="POC_OWNER_SUBJECT_SHA256=${OWNER_SUBJECT_SHA256}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
unset WRONG_OWNER_HASH
printf 'B15-4 RESTORED\n'
```

成功確認:

- Google IAMは同じHuman tokenを通すが、application owner bindingが403で拒否する。
- 第三者accountは使っていない。
- owner hashはprimary値へrestore済み。

失敗したら:

**STOP**。まずrestore blockだけを実行する。第三者accountを招待しない。

### B15-5 Duplicate trigger and competing lease

Cloud Shell — prepare a new synthetic operation:

```bash
POC_OPERATION_ALIAS="live_acceptance_duplicate_01"
export POC_OPERATION_ALIAS
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --max-instances=1 \
  --concurrency=1 \
  --update-env-vars="POC_OPERATION_ALIAS=${POC_OPERATION_ALIAS}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
```

Human UI — ScriptLock duplicate:

1. primary Apps Scriptを2つのbrowser tabで開く。
2. 両方で`pocObservedPrivateBrokerTick_`を選び、ほぼ同時にRunする。
3. 一方がapplyし、もう一方が`TRIGGER_BUSY`であることをsafe logで確認する。
4. Firestoreの`attempt_count=1`、final state `APPLIED_ACKNOWLEDGED`を確認する。

Cloud Shell — real Firestore competition / max two instances:

```bash
POC_OPERATION_ALIAS="live_acceptance_compete_01"
export POC_OPERATION_ALIAS
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --max-instances=2 \
  --concurrency=1 \
  --update-env-vars="POC_OPERATION_ALIAS=${POC_OPERATION_ALIAS}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
```

Human UI — no-lock competitors:

1. primary Apps Scriptの2つのtabで`pocObservedNoLockTick_`をほぼ同時にRunする。
2. 1件だけがredeem/applyすることを確認する。
3. 他方は`LEASE_ALREADY_REDEEMED`等のsafe conflict、または同じleaseのidempotent結果でよい。
4. Firestoreで`attempt_count=1`、1つの`lease_alias`、final state
   `APPLIED_ACKNOWLEDGED`を確認する。
5. Cloud Run system/request logsで異なるinstance IDが2つ観測できればtwo-instance PASS。
   1つしか観測できなければFirestore atomicityは判定できるが、two-instanceは`UNKNOWN`。
   無制限に再試行しない。

成功確認:

- ScriptLock duplicate apply = 0。
- real Firestore transactionでsecret redeem/apply = 1。
- two instanceの実観測はPASSまたはUNKNOWNを分離する。

失敗したら:

**STOP**。Firestore documentを手動修正しない。

### B15-6 ACK loss plus restart recovery

Cloud Shell — prepare operation:

```bash
POC_OPERATION_ALIAS="live_acceptance_ack_loss_01"
export POC_OPERATION_ALIAS
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --max-instances=1 \
  --concurrency=1 \
  --update-env-vars="POC_OPERATION_ALIAS=${POC_OPERATION_ALIAS}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
```

Human UI:

1. primary Apps Scriptで`pocAckLossOnce_`をRunする。
2. safe error `POC_ACK_LOSS_INJECTED`を確認する。
3. Firestore stateが`REDEEMED`、Apps Script側のsafe apply markerが残ることを確認する。
4. payload/tokenは見ない・コピーしない。

Cloud Shell — force a new revision/restart:

```bash
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --update-env-vars="POC_RESTART_NONCE=restart_01" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
```

Human UI:

1. primary Apps Scriptで`pocObservedPrivateBrokerTick_`をRunする。
2. safe code `ACK_RECONCILED`を確認する。
3. Firestore final state `APPLIED_ACKNOWLEDGED`、`attempt_count=1`を確認する。
4. Script Propertiesのapply markerが消え、last-applied markerだけが残ることを確認する。

成功確認:

- ACK前failureでもslot二重applyは0。
- new Cloud Run revision後にACK-only reconciliationが成功。

失敗したら:

**STOP**。Script PropertiesやFirestore documentを手動で成功状態へ書き換えない。

### B15-7 Cold start

Humanがやること:

1. Cloud Runがmin 0であることを確認する。
2. triggerは削除済みのまま、20分trafficを送らない。
3. 20分後にprimary Apps Scriptで`pocObservedPrivateBrokerTick_`を1回Runする。
4. Cloud Runの`broker_started` logが新しいinstanceから出たか確認する。
5. scale-to-zeroは即時保証ではない。30分まで待っても新instanceが確認できなければ
   `UNKNOWN`。無制限に待たない。

Cloud Shell:

```bash
assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=1 \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
printf 'WAIT 20 MINUTES WITHOUT TRAFFIC\n'
```

成功確認:

- cold instanceからpollが成功し、Firestore stateを失わない。

失敗したら:

**STOP**。cold start未観測をPASSにしない。

### B15-8 Temporary Firestore failure

Humanがやること:

1. 下のremove blockを実行する。
2. すぐprimary Apps Scriptで`pocObservedPrivateBrokerTick_`を1回Runする。
3. warm instanceなら`STATE_STORE_UNAVAILABLE`を確認する。もし同時にcold startが起きた場合は、
   Cloud Run 503とsafe startup log `STARTUP_FAILED`でもfail-closedは確認できるが、
   request-pathのFirestore error codeは`UNKNOWN`として分離する。
4. 必ずrestore blockを実行する。

Cloud Shell — temporarily remove only the conditional runtime binding:

```bash
restore_poc_db_access() {
  assert_poc_project || return 1
  gcloud projects add-iam-policy-binding "$POC_PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/datastore.user" \
    --condition="$DB_CONDITION" \
    --project="$POC_PROJECT" \
    "${GCLOUD_AS_PROVISIONER[@]}" \
    --quiet --format=none
}
trap restore_poc_db_access EXIT

assert_poc_project || exit 1
gcloud projects remove-iam-policy-binding "$POC_PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --condition="$DB_CONDITION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none
printf 'RUN ONE FIRESTORE FAILURE PROBE NOW\n'
```

Cloud Shell — restore immediately after the probe:

```bash
restore_poc_db_access
trap - EXIT
printf 'B15-8 RESTORED\n'
```

成功確認:

- temporary failureはfail closed。warm pathの`STATE_STORE_UNAVAILABLE`未観測時はその項目だけUNKNOWN。
- payloadやinternal provider errorを返さない。
- runtime database accessはrestore済み。

失敗したら:

**STOP**。他testへ進む前にrestoreだけを完了する。

### B15-9 Expired real Google OIDC token — last test

重要:

Apps Script実行時間を超えてtokenを揮発memoryだけで保持する安全な仕組みは現行PoCにない。
そのため、expired **Apps Script-issued** tokenは捏造せず`UNKNOWN`とする。代替として、同じ
PoC projectのprovisioner SAがGoogleから取得したreal OIDC tokenをCloud Shell memoryだけに
保持し、expiry後のCloud Run/application rejectionを検証できる。第三者accountは使わない。

この代替試験は約1時間Cloud Shell sessionを開いたままにできる場合だけ実行する。
実行できなければ`EXPIRED_APPS_SCRIPT_TOKEN_UNKNOWN`としてoverallをCONDITIONALにする。

Cloud Shell:

```bash
EXPIRED_TEST_AUDIENCE="paluru-expired-oidc-poc"

restore_expired_probe() {
  set +e
  if assert_poc_project >/dev/null 2>&1; then
    gcloud run services update "$POC_BROKER" \
      --region="$POC_REGION" \
      --update-env-vars="POC_OIDC_AUDIENCE=${OIDC_AUDIENCE},POC_OWNER_SUBJECT_SHA256=${OWNER_SUBJECT_SHA256}" \
      --remove-custom-audiences="$EXPIRED_TEST_AUDIENCE" \
      --project="$POC_PROJECT" \
      "${GCLOUD_AS_PROVISIONER[@]}" \
      --quiet --format=none >/dev/null 2>&1
    gcloud run services remove-iam-policy-binding "$POC_BROKER" \
      --region="$POC_REGION" \
      --member="serviceAccount:${PROVISION_SA}" \
      --role="roles/run.invoker" \
      --project="$POC_PROJECT" \
      "${GCLOUD_AS_PROVISIONER[@]}" \
      --quiet --format=none >/dev/null 2>&1
  fi
  unset EXPIRED_TEST_TOKEN EXPIRED_TEST_OWNER_HASH EXPIRED_TEST_AUDIENCE
  set -e
}
trap restore_expired_probe EXIT

assert_poc_project || exit 1
gcloud run services add-iam-policy-binding "$POC_BROKER" \
  --region="$POC_REGION" \
  --member="serviceAccount:${PROVISION_SA}" \
  --role="roles/run.invoker" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --add-custom-audiences="$EXPIRED_TEST_AUDIENCE" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

EXPIRED_TEST_TOKEN="$(
  gcloud auth print-identity-token \
    --impersonate-service-account="$PROVISION_SA" \
    --audiences="$EXPIRED_TEST_AUDIENCE" 2>/dev/null
)"
test -n "$EXPIRED_TEST_TOKEN" || { printf 'STOP: test token unavailable\n'; exit 1; }

EXPIRED_TEST_OWNER_HASH="$(
  TOKEN="$EXPIRED_TEST_TOKEN" python3 -c '
import base64, hashlib, json, os
p=os.environ["TOKEN"].split(".")[1]
p += "=" * (-len(p) % 4)
claims=json.loads(base64.urlsafe_b64decode(p.encode()))
print(hashlib.sha256(str(claims["sub"]).encode()).hexdigest())
'
)"
test "${#EXPIRED_TEST_OWNER_HASH}" -eq 64 || {
  printf 'STOP: test owner hash invalid\n'
  exit 1
}
case "$EXPIRED_TEST_OWNER_HASH" in
  *[!0-9a-f]*) printf 'STOP: test owner hash invalid\n'; exit 1 ;;
esac

assert_poc_project || exit 1
gcloud run services update "$POC_BROKER" \
  --region="$POC_REGION" \
  --update-env-vars="POC_OIDC_AUDIENCE=${EXPIRED_TEST_AUDIENCE},POC_OWNER_SUBJECT_SHA256=${EXPIRED_TEST_OWNER_HASH}" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

FRESH_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${EXPIRED_TEST_TOKEN}" \
    "${BROKER_URL}/v1/operations/${POC_OPERATION_ALIAS}/status"
)"
test "$FRESH_STATUS" = "200" || {
  printf 'STOP: fresh real OIDC token was not accepted\n'
  exit 1
}
unset FRESH_STATUS

WAIT_SECONDS="$(
  TOKEN="$EXPIRED_TEST_TOKEN" python3 -c '
import base64, json, os, time
p=os.environ["TOKEN"].split(".")[1]
p += "=" * (-len(p) % 4)
claims=json.loads(base64.urlsafe_b64decode(p.encode()))
print(max(1, int(claims["exp"] - time.time()) + 5))
'
)"
test "$WAIT_SECONDS" -le 3700 || {
  printf 'STOP: unexpected token lifetime\n'
  exit 1
}
printf 'WAITING IN VOLATILE MEMORY; KEEP CLOUD SHELL OPEN\n'
sleep "$WAIT_SECONDS"
unset WAIT_SECONDS

EXPIRED_STATUS="$(
  curl --silent --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${EXPIRED_TEST_TOKEN}" \
    "${BROKER_URL}/v1/operations/${POC_OPERATION_ALIAS}/status"
)"
case "$EXPIRED_STATUS" in
  401|403) printf 'B15-9 EXPIRED GOOGLE OIDC REJECTED\n' ;;
  *) printf 'STOP: expired token was not rejected\n'; exit 1 ;;
esac
unset EXPIRED_STATUS EXPIRED_TEST_TOKEN EXPIRED_TEST_OWNER_HASH

restore_expired_probe
trap - EXIT
printf 'B15 COMPLETE\n'
```

成功確認:

- fresh Google OIDCは200、expiry後は401/403。
- tokenはenvironment memoryだけで、file/log/evidenceへ保存していない。
- primary Apps Script audience/owner bindingへrestore済み。
- provisionerのtemporary Invokerとtemporary custom audienceは削除済み。
- **Apps Script-issued expired token自体はUNKNOWN** と正直に残す。

失敗したら:

**STOP**。tokenをfileへ保存して再開しない。Cloud Shell sessionが切れたらtokenは破棄し、
primary audience/hashをB11で再取得してrestoreしてから終了する。

---

## Step B16 — Collect redacted evidence and inspect leakage

目的:

application leakage、Google-managed infrastructure audit identity、Human tool transcriptを分離し、
最終保存物を`live-acceptance-evidence.redacted.json`だけに限定する。

Humanがやること:

1. Cloud Run application logs、request logs、Cloud Audit Logs、Firestore、Apps Script
   Executions/error detailsを確認する。
2. Google-managed Cloud Audit Logsにprincipalがあるだけならapplication leakage failureにしない。
3. application-controlled log/storageにtoken、email、raw `sub`、Authorization、payload、request bodyが
   ないことを確認する。
4. final JSONには許可fieldだけを使う。
5. project/account/client ID/URL等が出たraw admin outputはevidenceへコピーしない。

Cloud Shell — inspect application-controlled log text only:

```bash
assert_poc_project || exit 1
SCAN_DIR="$(mktemp -d)"

gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${POC_BROKER} AND (logName:\"run.googleapis.com%2Fstdout\" OR logName:\"run.googleapis.com%2Fstderr\")" \
  --freshness=24h \
  --limit=1000 \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --format=json > "$SCAN_DIR/run-app.json"

jq -r '.[] | (.textPayload // (.jsonPayload | tostring) // empty)' \
  "$SCAN_DIR/run-app.json" > "$SCAN_DIR/run-app-text.txt"

SYNTHETIC_HITS="$(grep -Fci 'PALURU_SYNTHETIC_LIVE_ACCEPTANCE_VALUE' "$SCAN_DIR/run-app-text.txt" || true)"
JWT_HITS="$(grep -Eci 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' "$SCAN_DIR/run-app-text.txt" || true)"
AUTH_HITS="$(grep -Eci 'Authorization|Bearer[[:space:]]' "$SCAN_DIR/run-app-text.txt" || true)"
EMAIL_HITS="$(grep -Eci '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' "$SCAN_DIR/run-app-text.txt" || true)"
RAW_SUB_HITS="$(grep -Eci '(^|[^A-Za-z])sub([^A-Za-z]|$)|owner_subject|principal_subject' "$SCAN_DIR/run-app-text.txt" || true)"
BODY_HITS="$(grep -Eci 'synthetic_payload|request_body|requestBody' "$SCAN_DIR/run-app-text.txt" || true)"

test "$SYNTHETIC_HITS" -eq 0 || { printf 'STOP: synthetic payload in application log\n'; exit 1; }
test "$JWT_HITS" -eq 0 || { printf 'STOP: JWT in application log\n'; exit 1; }
test "$AUTH_HITS" -eq 0 || { printf 'STOP: authorization data in application log\n'; exit 1; }
test "$EMAIL_HITS" -eq 0 || { printf 'STOP: email in application log\n'; exit 1; }
test "$RAW_SUB_HITS" -eq 0 || { printf 'STOP: identity field in application log\n'; exit 1; }
test "$BODY_HITS" -eq 0 || { printf 'STOP: request body or payload in application log\n'; exit 1; }

unset SYNTHETIC_HITS JWT_HITS AUTH_HITS EMAIL_HITS RAW_SUB_HITS BODY_HITS
printf 'APPLICATION LEAKAGE SCAN PASS\n'
```

Firestore manual inspection:

1. `poc_operations`の全documentで、fieldが次だけであることを確認する。
   - `operation_id`
   - `state`
   - `lease_alias`
   - `lease_owner_alias`
   - `lease_expires_at`
   - `attempt_count`
   - `acknowledged`
   - `created_at`
   - `updated_at`
   - `safe_error_code`
   - `secret_version_alias`
2. `synthetic_payload`、token、Authorization、email、raw `sub`、request bodyは0件。

Apps Script manual inspection:

1. **Executions**で全PoC executionを開く。
2. acceptance harness logは許可fieldだけであることを確認する。
3. failure detailにtoken/email/raw `sub`/payload/URLがないことを確認する。
4. intended destinationであるsynthetic A/B Script Propertyはleakage scan対象外。ただし値をevidenceへ
   コピーしない。

Cloud Shell — create the only final artifact:

```bash
EVIDENCE_FILE="$HOME/live-acceptance-evidence.redacted.json"
test ! -e "$EVIDENCE_FILE" || {
  printf 'STOP: redacted evidence file already exists\n'
  exit 1
}

cat > "$EVIDENCE_FILE" <<'JSON'
[
  {"test_id":"isolation_topology","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"apis_iam_minimum","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"real_apps_script_oidc","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_op_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"minimum_oauth_scope","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"scheduled_trigger_3","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_op_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"missing_token","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"malformed_token","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"wrong_audience","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"wrong_owner","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"firestore_atomic_lease","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_compete_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"two_broker_instances","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_compete_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"duplicate_apply","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_duplicate_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"ack_reconciliation","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_ack_loss_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"restart_recovery","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"live_acceptance_ack_loss_01","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"cold_start","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"firestore_temp_failure","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"expired_google_oidc","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"expired_apps_script_token","status":"UNKNOWN","safe_code":"SAFE_HARNESS_UNAVAILABLE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"application_secret_leakage","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"application_identity_leakage","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"infrastructure_audit_identity","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"tool_transcript_exposure","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"production_resources_touched","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"cleanup_status","status":"BLOCKED","safe_code":"PENDING_CLEANUP","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"},
  {"test_id":"overall_gate","status":"REPLACE","safe_code":"REPLACE","elapsed_ms":0,"operation_alias":"none","build_alias":"src-63b8fc2bab8d","timestamp":"REPLACE_WITH_RFC3339"}
]
JSON

printf 'Edit only REPLACE fields with safe values, then run validation.\n'
```

HumanはCloud Shell editorで`REPLACE`とtimestampだけを埋める。許可statusは
`PASS` / `FAIL` / `UNKNOWN` / `BLOCKED`。次のvalidationを通す。

```bash
ALLOWED_KEYS_JSON='["test_id","status","safe_code","elapsed_ms","operation_alias","build_alias","timestamp"]'

jq -e --argjson allowed "$ALLOWED_KEYS_JSON" '
  type == "array" and length > 0 and
  all(.[];
    type == "object" and
    ((keys_unsorted - $allowed) | length == 0) and
    (.test_id | type == "string" and test("^[a-z0-9_]{1,64}$")) and
    (.status | IN("PASS","FAIL","UNKNOWN","BLOCKED")) and
    (.safe_code | type == "string" and test("^[-A-Z0-9_]{1,64}$")) and
    (.elapsed_ms | type == "number" and . >= 0) and
    (.operation_alias | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")) and
    (.build_alias | type == "string" and test("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")) and
    (.timestamp | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
  )
' "$EVIDENCE_FILE" >/dev/null || {
  printf 'STOP: evidence schema validation failed\n'
  exit 1
}

if grep -Eqi \
  '(@|eyJ[A-Za-z0-9_-]+\.|Authorization|Bearer[[:space:]]|https?://|projects/|serviceAccounts/|PALURU_SYNTHETIC_LIVE_ACCEPTANCE_VALUE|client[_ -]?id|project[_ -]?id|raw[_ -]?sub)' \
  "$EVIDENCE_FILE"; then
  printf 'STOP: forbidden evidence content found\n'
  exit 1
fi

rm -f "$SCAN_DIR/run-app-text.txt" "$SCAN_DIR/run-app.json"
rmdir "$SCAN_DIR"
unset SCAN_DIR ALLOWED_KEYS_JSON
printf 'B16 PASS — REDACTED EVIDENCE ONLY\n'
```

成功確認:

- final fileは`live-acceptance-evidence.redacted.json`だけ。
- fieldは7種類だけ。
- Secret material = 0。
- Application-controlled identity leakage = 0。
- Infrastructure audit identityは別分類。
- Tool/cloud admin metadataは別分類で、chatへ貼っていない。

失敗したら:

**STOP**。raw logをevidenceへ添付しない。禁止値を伏字で残すのではなく、fieldごと削除する。

---

## Step B17 — Cleanup

目的:

Live Acceptance終了後、PoC resourceをproductionへ流用せず削除する。cleanupもHumanだけが行う。

Humanがやること:

1. cleanupはEvidence review後にだけ行う。
2. primary / wrong-audience Apps ScriptのTriggersをすべて削除する。
3. `script.google.com`のproject一覧で、2つのPoC Apps ScriptをTrashへ移す。
4. 下のCloud Shell blockを順番どおり実行する。
5. project deletion後は同Project IDを再利用しない。

Cloud Shell:

```bash
read -r -p "Type DELETE-ISOLATED-POC to continue cleanup: " CLEANUP_CONFIRM
test "$CLEANUP_CONFIRM" = "DELETE-ISOLATED-POC" || {
  unset CLEANUP_CONFIRM
  printf 'STOP: cleanup not confirmed\n'
  exit 1
}
unset CLEANUP_CONFIRM

assert_poc_project || exit 1
gcloud run services delete "$POC_BROKER" \
  --region="$POC_REGION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

assert_poc_project || exit 1
gcloud secrets delete "$POC_SECRET" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

assert_poc_project || exit 1
gcloud firestore databases delete \
  --database="$POC_DB" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

assert_poc_project || exit 1
gcloud artifacts repositories delete "$POC_REPO" \
  --location="$POC_REGION" \
  --project="$POC_PROJECT" \
  "${GCLOUD_AS_PROVISIONER[@]}" \
  --quiet --format=none

# From here, use the Human bootstrap identity. The provisioner cannot delete itself.
assert_poc_project || exit 1
gcloud iam service-accounts disable "$RUNTIME_SA" \
  --project="$POC_PROJECT" --quiet --format=none
assert_poc_project || exit 1
gcloud iam service-accounts delete "$RUNTIME_SA" \
  --project="$POC_PROJECT" --quiet --format=none

assert_poc_project || exit 1
gcloud iam service-accounts disable "$PROVISION_SA" \
  --project="$POC_PROJECT" --quiet --format=none
assert_poc_project || exit 1
gcloud iam service-accounts delete "$PROVISION_SA" \
  --project="$POC_PROJECT" --quiet --format=none

assert_poc_project || exit 1
gcloud projects delete "$POC_PROJECT" --quiet --format=none

EVIDENCE_NOW="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
jq --arg now "$EVIDENCE_NOW" '
  map(if .test_id == "cleanup_status"
      then .status = "PASS" | .safe_code = "CLEANUP_REQUESTED" | .timestamp = $now
      else . end)
' "$EVIDENCE_FILE" > "${EVIDENCE_FILE}.tmp"
mv "${EVIDENCE_FILE}.tmp" "$EVIDENCE_FILE"
unset EVIDENCE_NOW

unset OWNER_ACCOUNT RUNTIME_SA PROVISION_SA BUILD_SA
unset OIDC_AUDIENCE OWNER_SUBJECT_SHA256 BROKER_URL IMAGE_DIGEST IMAGE_URI
unset POC_SECRET_VERSION POC_PROJECT POC_REGION POC_DB POC_COLLECTION
unset POC_BROKER POC_SECRET POC_REPO POC_IMAGE POC_OPERATION_ALIAS
printf 'B17 CLEANUP REQUESTED\n'
```

成功確認:

- PoC triggers: 0。
- PoC Apps Script projects: Trash。
- Cloud Run、secret、Firestore、Artifact Registry: deletedまたはdeletion in progress。
- dedicated service accounts: disabled then deleted。
- dedicated project: deletion requested。
- production資産への昇格・流用: 0。
- `cleanup_status`はsafe code `CLEANUP_REQUESTED`へ更新済み。
- B16のschema/leakage validationをもう一度実行する。
- Cloud Shellの **Download** でredacted evidenceだけをHumanのprivate local storageへ保存する。
- download後、`rm -f -- "$EVIDENCE_FILE"`でCloud Shell copyを削除する。

失敗したら:

**STOP**。production resourceを削除対象へ追加しない。PoC project内の未削除logical nameだけを
安全なcodeとして記録する。

---

## Gate interpretation

Transport D Live Acceptanceを**GO**にできるのは、次がすべてPASSの場合だけ。

- real Apps Script OIDC success
- wrong audience reject
- unauthenticated reject
- owner authorization verified
- real trigger >= 3 executions
- Firestore lease atomic
- duplicate apply = 0
- ACK loss recoverable
- restart/cold-start recoverable
- application-controlled secret leakage = 0
- application-controlled identity leakage = 0
- production resource changes = 0

このrunbookでは、Apps Script-issued tokenをexpiryまで安全に揮発保持する仕組みがないため、
そのtestは既定で`UNKNOWN`。Google-issued service-account tokenのexpiry testは安全な代替証拠であり、
Apps Script-issued expiryそのもののPASSとは書かない。また、Cloud Runの異なる2 instanceが実観測
できなければ、Firestore transaction PASSとtwo-instance UNKNOWNを分離する。

したがって未達が残る場合は、勝手にGOへ丸めず`CONDITIONAL GO`または`NO-GO`とする。

## Official references used by this runbook

- [Apps ScriptからCloud RunへOIDC接続](https://developers.google.com/apps-script/guides/services/cloud-run)
- [Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- [Cloud Run custom audiences](https://cloud.google.com/run/docs/configuring/custom-audiences)
- [Cloud Run private invocation](https://cloud.google.com/run/docs/authenticating/developers)
- [Firestore named databases and per-database IAM conditions](https://cloud.google.com/firestore/docs/manage-databases)
- [Artifact Registry repository creation](https://cloud.google.com/artifact-registry/docs/repositories/create-repos)
- [Cloud Build Docker image build](https://cloud.google.com/build/docs/building/build-containers)
- [Google Cloud project billing link](https://cloud.google.com/sdk/gcloud/reference/billing/projects/link)

---

## Review stop

Do not execute this runbook yet. Review ends here. Do not continue to production
implementation, production credential migration, or Substep 4.
