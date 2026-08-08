import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDocumentDiffRows, summarizeDocumentDiff } from '../documentDiff';

test('an inserted paragraph does not mark following identical paragraphs as changed', () => {
  const rows = computeDocumentDiffRows(
    '项目背景\n技术方案\n实施计划\n预期成效',
    '项目背景\n新增说明\n技术方案\n实施计划\n预期成效',
  );
  assert.deepEqual(rows.map(row => row.kind), ['equal', 'insert', 'equal', 'equal', 'equal']);
  assert.deepEqual(summarizeDocumentDiff(rows), { insert: 1, delete: 0, modified: 0, equal: 4, total: 5 });
});

test('a few changed characters are shown as one modified paragraph with character highlights', () => {
  const rows = computeDocumentDiffRows(
    '采用自动旋入装置，提高作业效率。',
    '采用智能旋入装置，显著提高作业效率。',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'modified');
  assert.ok(rows[0].left?.charDiffs?.some(([operation]) => operation === -1));
  assert.ok(rows[0].right?.charDiffs?.some(([operation]) => operation === 1));
  assert.ok(rows[0].left?.charDiffs?.some(([operation, text]) => operation === 0 && text.includes('采用')));
});

test('visual-only whitespace and blank lines do not create content changes', () => {
  const rows = computeDocumentDiffRows(
    '项目背景\n\n技术 方案',
    ' 项目背景 \n技术   方案\n',
  );
  assert.deepEqual(rows.map(row => row.kind), ['equal', 'equal']);
});

test('a fully replaced paragraph is shown as one paragraph modification', () => {
  const rows = computeDocumentDiffRows('旧版财务预算说明', '新版施工安全措施');
  assert.deepEqual(rows.map(row => row.kind), ['modified']);
});
