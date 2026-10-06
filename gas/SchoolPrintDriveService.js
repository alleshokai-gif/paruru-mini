const SCHOOL_PRINT_FOLDER_NAME = 'SchoolPrint';
const SCHOOL_PRINT_INBOX_FOLDER_NAME = 'inbox';

function schoolPrintDriveSubmit_(trusted) {
  if (!trusted || trusted.documentType !== 'school_print' ||
      trusted.file?.mediaType !== 'application/pdf' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(trusted.clientRequestId || ''))) {
    throw familyInboxGatewayError_('INVALID_INPUT');
  }

  const lock = LockService.getScriptLock();
  let locked = false;
  let createdFile = null;
  let folders = null;
  try {
    lock.waitLock(10000);
    locked = true;
    folders = schoolPrintDriveFolders_();
    const bytes = Utilities.base64Decode(trusted.file.base64);
    const sha256 = schoolPrintSha256_(bytes);
    const replay = schoolPrintFindRequest_(folders.inbox, trusted.clientRequestId);
    if (replay) {
      if (replay.metadata.sha256 !== sha256) throw familyInboxGatewayError_('DUPLICATE_REQUEST');
      return { status: 'queued', fileId: replay.file.getId(), idempotency: { replayed: true } };
    }

    const originalName = schoolPrintSafeFileName_(trusted.file.name);
    const initialName = `skv3-${trusted.clientRequestId}__${originalName}`;
    const blob = Utilities.newBlob(bytes, 'application/pdf', initialName);
    createdFile = folders.inbox.createFile(blob);
    createdFile.setName(`skv3-${trusted.clientRequestId}__${createdFile.getId()}__${originalName}`);
    createdFile.setDescription(JSON.stringify({
      type: 'school_print_v3',
      clientRequestId: trusted.clientRequestId,
      sha256: sha256,
      originalName: originalName,
      userNote: String(trusted.userNote || ''),
      receivedAt: new Date().toISOString(),
    }));
    return { status: 'queued', fileId: createdFile.getId(), idempotency: { replayed: false } };
  } catch (error) {
    if (createdFile) try { createdFile.setTrashed(true); } catch (_) {}
    if (error && ['INVALID_INPUT', 'UNSUPPORTED_MEDIA_TYPE', 'DUPLICATE_REQUEST', 'STORAGE_ERROR', 'CONFIGURATION_ERROR'].indexOf(error.code) >= 0) throw error;
    throw familyInboxGatewayError_('STORAGE_ERROR');
  } finally {
    if (locked) lock.releaseLock();
  }
}

function schoolPrintDriveFolders_() {
  const root = DriveApp.getRootFolder();
  const schoolPrint = schoolPrintGetOrCreateFolder_(root, SCHOOL_PRINT_FOLDER_NAME);
  return {
    root: root,
    schoolPrint: schoolPrint,
    inbox: schoolPrintGetOrCreateFolder_(schoolPrint, SCHOOL_PRINT_INBOX_FOLDER_NAME),
  };
}

function schoolPrintGetOrCreateFolder_(parent, folderName) {
  const folders = parent.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parent.createFolder(folderName);
}

function schoolPrintFindRequest_(inbox, clientRequestId) {
  const query = `title contains "skv3-${clientRequestId}__"`;
  const files = inbox.searchFiles(query);
  while (files.hasNext()) {
    const file = files.next();
    let metadata;
    try { metadata = JSON.parse(String(file.getDescription() || '')); } catch (_) { continue; }
    if (metadata.type === 'school_print_v3' && metadata.clientRequestId === clientRequestId) return { file: file, metadata: metadata };
  }
  return null;
}

function schoolPrintSha256_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map((value) => ('0' + (Number(value) & 0xff).toString(16)).slice(-2)).join('');
}

function schoolPrintSafeFileName_(value) {
  const name = String(value || '').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
  return name || 'school-print.pdf';
}
