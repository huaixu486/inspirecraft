import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CURRENT_DATA_SCHEMA_VERSION,
  readVersionedJsonFile,
  writeVersionedJsonFile,
} from '../versionedJson';
import { extractRegisteredProjectPaths } from '../registeredProjectPaths';

const withTempFile = (callback: (filePath: string) => void) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-schema-'));
  try {
    callback(path.join(directory, 'data.json'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('legacy data remains readable and is backed up before first versioned write', () => {
  withTempFile(filePath => {
    fs.writeFileSync(filePath, JSON.stringify([{ id: 'legacy' }]), 'utf-8');
    assert.equal(readVersionedJsonFile<any[]>(filePath, []).source, 'legacy');

    writeVersionedJsonFile(filePath, [{ id: 'current' }]);
    assert.equal(fs.existsSync(`${filePath}.schema-v0.bak`), true);
    assert.deepEqual(readVersionedJsonFile<any[]>(filePath, []).data, [{ id: 'current' }]);
    assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf-8')).schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
  });
});

test('corrupted files return fallback data and cannot be overwritten', () => {
  withTempFile(filePath => {
    fs.writeFileSync(filePath, '{broken', 'utf-8');
    const result = readVersionedJsonFile(filePath, ['fallback']);
    assert.equal(result.source, 'invalid');
    assert.deepEqual(result.data, ['fallback']);
    assert.throws(() => writeVersionedJsonFile(filePath, []), /Refusing to overwrite unsafe data file/);
  });
});

test('future schema versions are preserved instead of downgraded', () => {
  withTempFile(filePath => {
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 99, data: ['future'] }), 'utf-8');
    const result = readVersionedJsonFile(filePath, ['fallback']);
    assert.equal(result.source, 'unsupported');
    assert.deepEqual(result.data, ['fallback']);
    assert.throws(() => writeVersionedJsonFile(filePath, []), /Unsupported schema version/);
  });
});

test('registered external project roots are read from legacy and versioned project data', () => {
  const externalRoot = path.resolve('D:\\external-project');
  const rows = [{ id: 'external', folderPath: externalRoot }];

  assert.deepEqual(extractRegisteredProjectPaths(rows), [externalRoot]);
  assert.deepEqual(extractRegisteredProjectPaths({
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    data: rows,
  }), [externalRoot]);
  assert.deepEqual(extractRegisteredProjectPaths({
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION + 1,
    data: rows,
  }), []);
});
