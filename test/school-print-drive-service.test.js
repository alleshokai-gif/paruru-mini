'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'gas', 'SchoolPrintDriveService.js'), 'utf8');

function makeFolder(name) {
  const children = [];
  const folder = {
    name,
    children,
    getName() { return name; },
    getFoldersByName(childName) {
      const matches = children.filter(child => child.name === childName);
      let index = 0;
      return {
        hasNext() { return index < matches.length; },
        next() { return matches[index++]; },
      };
    },
    createFolder(childName) {
      const child = makeFolder(childName);
      children.push(child);
      return child;
    },
  };
  return folder;
}

function loadWithRoot(rootFolder) {
  let rootReads = 0;
  const context = {
    DriveApp: { getRootFolder() { rootReads++; return rootFolder; } },
    PropertiesService: { getScriptProperties() { throw new Error('must not read Script Properties'); } },
    Object,
    String,
    JSON,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'gas/SchoolPrintDriveService.js' });
  return { context, rootReads: () => rootReads };
}

{
  const rootFolder = makeFolder('My Drive');
  const loaded = loadWithRoot(rootFolder);
  const first = loaded.context.schoolPrintDriveFolders_();
  assert.equal(first.root, rootFolder);
  assert.equal(first.schoolPrint.name, 'SchoolPrint');
  assert.equal(first.inbox.name, 'inbox');
  assert.deepEqual(Object.keys(first).sort(), ['inbox', 'root', 'schoolPrint']);
  assert.equal(rootFolder.children.length, 1, 'SchoolPrint should be created once');
  assert.equal(first.schoolPrint.children.length, 1, 'inbox should be created once');

  const second = loaded.context.schoolPrintDriveFolders_();
  assert.equal(second.schoolPrint, first.schoolPrint, 'existing SchoolPrint folder should be reused');
  assert.equal(second.inbox, first.inbox, 'existing inbox folder should be reused');
  assert.equal(rootFolder.children.length, 1, 'repeat lookup must not create another SchoolPrint folder');
  assert.equal(first.schoolPrint.children.length, 1, 'repeat lookup must not create another inbox folder');
  assert.equal(loaded.rootReads(), 2);
}

{
  const rootFolder = makeFolder('My Drive');
  const schoolPrint = rootFolder.createFolder('SchoolPrint');
  const existingInbox = schoolPrint.createFolder('inbox');
  const loaded = loadWithRoot(rootFolder);
  const folders = loaded.context.schoolPrintDriveFolders_();
  assert.equal(folders.schoolPrint, schoolPrint);
  assert.equal(folders.inbox, existingInbox);
  assert.equal(rootFolder.children.length, 1);
  assert.equal(schoolPrint.children.length, 1);
}

{
  const inbox = { searchFiles(query) {
    assert.match(query, /skv3-client-request__/);
    return { hasNext() { return false; }, next() { throw new Error('unexpected file'); } };
  } };
  const loaded = loadWithRoot(makeFolder('My Drive'));
  assert.equal(loaded.context.schoolPrintFindRequest_(inbox, 'client-request'), null);
}

console.log('PASS SchoolPrint/inbox get-or-create and inbox-only lookup');
