const SCHOOL_PRINT_FOLDER_NAME = 'SchoolPrint';
const SCHOOL_PRINT_INBOX_FOLDER_NAME = 'inbox';

function schoolPrintDriveSubmit_(trusted) {
  if (!trusted || trusted.documentType !== 'school_print' ||
      trusted.file?.mediaType !== 'application/pdf' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(trusted.clientRequestId || ''))) {
    throw familyInboxGatewayError_('INVALID_INPUT');
  }

  const inbox = schoolPrintDriveInboxFolder_();
  const bytes = Utilities.base64Decode(trusted.file.base64);
  const blob = Utilities.newBlob(bytes, trusted.file.mediaType, trusted.file.name);
  const file = inbox.createFile(blob);
  return { status: 'queued', fileId: file.getId() };
}

function schoolPrintDriveInboxFolder_() {
  const root = DriveApp.getRootFolder();
  const schoolPrint = schoolPrintGetOrCreateFolder_(root, SCHOOL_PRINT_FOLDER_NAME);
  return schoolPrintGetOrCreateFolder_(schoolPrint, SCHOOL_PRINT_INBOX_FOLDER_NAME);
}

function schoolPrintGetOrCreateFolder_(parent, folderName) {
  const folders = parent.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parent.createFolder(folderName);
}
