'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'SchoolPrintDriveService.js'), 'utf8');

function makeFolder(name, calls, options = {}) {
  const children = [];
  const folder = {
    name,
    children,
    getName() { return name; },
    getFoldersByName(childName) {
      calls.push(`getFoldersByName:${childName}`);
      const matches = children.filter(child => child.name === childName);
      let index = 0;
      return {
        hasNext() { return index < matches.length; },
        next() { return matches[index++]; },
      };
    },
    createFolder(childName) {
      calls.push(`createFolder:${childName}`);
      const child = makeFolder(childName, calls, options);
      children.push(child);
      return child;
    },
    createFile(blob) {
      calls.push('createFile');
      if (options.createFileError) throw options.createFileError;
      return { getId() { return 'file-123'; }, blob };
    },
  };
  return folder;
}

function loadWithRoot(rootFolder, calls, options = {}) {
  const context = {
    DriveApp: { getRootFolder() { calls.push('getRootFolder'); return rootFolder; } },
    Utilities: {
      base64Decode(value) {
        calls.push('base64Decode');
        if (options.decodeError) throw options.decodeError;
        assert.equal(value, 'AQID');
        return [1, 2, 3];
      },
      newBlob(bytes, mediaType, name) {
        calls.push('newBlob');
        assert.deepEqual(bytes, [1, 2, 3]);
        assert.equal(mediaType, 'application/pdf');
        assert.equal(name, 'school.pdf');
        return { bytes, mediaType, name };
      },
    },
    familyInboxGatewayError_(code) { const error = new Error(code); error.code = code; return error; },
    Object,
    String,
    JSON,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'gas/SchoolPrintDriveService.js' });
  return { context };
}

{
  const calls = [];
  const rootFolder = makeFolder('My Drive', calls);
  const loaded = loadWithRoot(rootFolder, calls);
  const first = loaded.context.schoolPrintDriveInboxFolder_();
  assert.equal(first.name, 'inbox');
  assert.equal(rootFolder.children.length, 1, 'SchoolPrint should be created once');
  assert.equal(rootFolder.children[0].children.length, 1, 'inbox should be created once');

  const second = loaded.context.schoolPrintDriveInboxFolder_();
  assert.equal(second, first, 'existing inbox folder should be reused');
  assert.equal(rootFolder.children.length, 1, 'repeat lookup must not create another SchoolPrint folder');
  assert.equal(rootFolder.children[0].children.length, 1, 'repeat lookup must not create another inbox folder');
}

{
  const calls = [];
  const rootFolder = makeFolder('My Drive', calls);
  const loaded = loadWithRoot(rootFolder, calls);
  const result = loaded.context.schoolPrintDriveSubmit_({
    documentType: 'school_print', clientRequestId: '00000000-0000-4000-8000-000000000101',
    file: { base64: 'AQID', mediaType: 'application/pdf', name: 'school.pdf' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'queued', fileId: 'file-123' });
  assert.deepEqual(calls, [
    'getRootFolder', 'getFoldersByName:SchoolPrint', 'createFolder:SchoolPrint',
    'getFoldersByName:inbox', 'createFolder:inbox', 'base64Decode', 'newBlob', 'createFile',
  ]);
}

{
  const calls = [];
  const failure = new Error('Drive createFile failed');
  const rootFolder = makeFolder('My Drive', calls, { createFileError: failure });
  const loaded = loadWithRoot(rootFolder, calls);
  assert.throws(() => loaded.context.schoolPrintDriveSubmit_({
    documentType: 'school_print', clientRequestId: '00000000-0000-4000-8000-000000000101',
    file: { base64: 'AQID', mediaType: 'application/pdf', name: 'school.pdf' },
  }), error => error === failure, 'the Apps Script exception should propagate unchanged');
}

{
  const calls = [];
  const failure = new Error('base64 decode failed');
  const rootFolder = makeFolder('My Drive', calls);
  const loaded = loadWithRoot(rootFolder, calls, { decodeError: failure });
  assert.throws(() => loaded.context.schoolPrintDriveSubmit_({
    documentType: 'school_print', clientRequestId: '00000000-0000-4000-8000-000000000101',
    file: { base64: 'AQID', mediaType: 'application/pdf', name: 'school.pdf' },
  }), error => error === failure, 'decode exception should propagate unchanged');
}

console.log('PASS minimal SchoolPrint/inbox save sequence and raw error propagation');
