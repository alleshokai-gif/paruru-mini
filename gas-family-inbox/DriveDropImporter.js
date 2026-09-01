const FAMILY_INBOX_DRIVE_DROP_PROPERTIES = Object.freeze({
  folderId: 'FAMILY_INBOX_DRIVE_DROP_FOLDER_ID',
  homeId: 'FAMILY_INBOX_DRIVE_DROP_HOME_ID',
  subjectMemberId: 'FAMILY_INBOX_DRIVE_DROP_DEFAULT_SUBJECT_MEMBER_ID',
  submittedByMemberId: 'FAMILY_INBOX_DRIVE_DROP_SUBMITTED_BY_MEMBER_ID',
});
const FAMILY_INBOX_DRIVE_DROP_MEDIA_TYPE = 'application/pdf';
const FAMILY_INBOX_DRIVE_DROP_MAX_SCAN_FILES = 100;

/**
 * Manual PoC entry point. Imports at most one new PDF and never moves, renames,
 * trashes, or edits the source file in the configured Drop Folder.
 */
function runFamilyInboxDriveDropImportOnce() {
  const startedAt = Date.now();
  const trace = { traceId: 'drive_drop_manual', operation: 'familyInbox.driveDropImport' };
  try {
    const config = familyInboxLoadDriveDropConfig_();
    const folder = familyInboxOpenDriveDropFolder_(config.folderId);
    const files = folder.getFiles();
    let scanned = 0;

    while (files.hasNext() && scanned < FAMILY_INBOX_DRIVE_DROP_MAX_SCAN_FILES) {
      const file = files.next();
      scanned += 1;
      if (String(file.getMimeType() || '').toLowerCase() !== FAMILY_INBOX_DRIVE_DROP_MEDIA_TYPE) continue;

      const input = familyInboxDriveDropInput_(file, config);
      const inputTrace = Object.assign({}, trace, {
        mediaType: input.mediaType,
        sizeBytes: input.bytes.length,
        sha256Prefix: input.sha256.slice(0, 12),
      });
      const result = familyInboxPersistInput_(input, 'drive_drop', inputTrace, startedAt);
      if (result.idempotency.replayed) continue;

      familyInboxLog_(Object.assign(inputTrace, {
        inboxId: result.inboxId,
        stage: 'imported',
        status: result.status,
        durationMs: Date.now() - startedAt,
      }));
      return {
        imported: true,
        inboxId: result.inboxId,
        status: result.status,
        scannedCount: scanned,
      };
    }

    familyInboxLog_(Object.assign(trace, {
      stage: 'completed',
      status: 'no_new_pdf',
      durationMs: Date.now() - startedAt,
    }));
    return { imported: false, status: 'no_new_pdf', scannedCount: scanned };
  } catch (error) {
    familyInboxLog_(Object.assign(trace, {
      stage: 'failed',
      status: 'failed',
      errorCode: familyInboxSafeErrorCode_(error),
      durationMs: Date.now() - startedAt,
    }));
    throw error;
  }
}

function familyInboxLoadDriveDropConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const baseConfig = familyInboxLoadConfig_();
  const config = {
    folderId: String(properties.getProperty(FAMILY_INBOX_DRIVE_DROP_PROPERTIES.folderId) || '').trim(),
    homeId: String(properties.getProperty(FAMILY_INBOX_DRIVE_DROP_PROPERTIES.homeId) || '').trim(),
    subjectMemberId: String(properties.getProperty(FAMILY_INBOX_DRIVE_DROP_PROPERTIES.subjectMemberId) || '').trim(),
    submittedByMemberId: String(properties.getProperty(FAMILY_INBOX_DRIVE_DROP_PROPERTIES.submittedByMemberId) || '').trim(),
  };
  if (!config.folderId || config.folderId === baseConfig.rawFolderId) throw familyInboxError_('CONFIGURATION_ERROR');
  try {
    config.homeId = familyInboxRequiredIdentifier_(config.homeId);
    config.subjectMemberId = familyInboxRequiredIdentifier_(config.subjectMemberId);
    config.submittedByMemberId = familyInboxRequiredIdentifier_(config.submittedByMemberId);
  } catch (_) {
    throw familyInboxError_('CONFIGURATION_ERROR');
  }
  return config;
}

function familyInboxOpenDriveDropFolder_(folderId) {
  try { return DriveApp.getFolderById(folderId); } catch (_) { throw familyInboxError_('CONFIGURATION_ERROR'); }
}

function familyInboxDriveDropInput_(file, config) {
  let fileId;
  let originalName;
  let bytes;
  try {
    fileId = String(file.getId() || '');
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('invalid file id');
    originalName = familyInboxSanitizeOriginalName_(file.getName());
    const size = Number(file.getSize());
    if (!Number.isFinite(size) || size <= 0) throw familyInboxError_('INVALID_INPUT');
    if (size > FAMILY_INBOX_MAX_FILE_BYTES) throw familyInboxError_('FILE_TOO_LARGE');
    bytes = file.getBlob().getBytes();
  } catch (error) {
    if (error && error.code) throw error;
    throw familyInboxError_('STORAGE_ERROR');
  }
  if (!bytes || !bytes.length) throw familyInboxError_('INVALID_INPUT');
  if (bytes.length > FAMILY_INBOX_MAX_FILE_BYTES) throw familyInboxError_('FILE_TOO_LARGE');
  familyInboxValidateSignature_(FAMILY_INBOX_DRIVE_DROP_MEDIA_TYPE, bytes);
  return {
    clientRequestId: familyInboxDriveDropRequestId_(fileId),
    homeId: config.homeId,
    submittedByMemberId: config.submittedByMemberId,
    subjectMemberId: config.subjectMemberId,
    userNote: '',
    originalName: originalName,
    mediaType: FAMILY_INBOX_DRIVE_DROP_MEDIA_TYPE,
    bytes: bytes,
    sha256: familyInboxSha256_(bytes),
  };
}

function familyInboxDriveDropRequestId_(fileId) {
  const seed = 'drive-drop:v1:' + String(fileId || '');
  const seedBytes = Array.from(seed).map(function(character) { return character.charCodeAt(0) & 0xff; });
  const hex = familyInboxSha256_(seedBytes).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return hex.slice(0, 8).join('') + '-' + hex.slice(8, 12).join('') + '-' + hex.slice(12, 16).join('') + '-' + hex.slice(16, 20).join('') + '-' + hex.slice(20, 32).join('');
}
