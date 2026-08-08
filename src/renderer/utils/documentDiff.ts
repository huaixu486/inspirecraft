import DiffMatchPatch from 'diff-match-patch';

export type DocumentDiffOperation = -1 | 0 | 1;
export type DocumentDiffRowKind = 'equal' | 'modified' | 'insert' | 'delete';

export interface DocumentDiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  lineA?: number;
  lineB?: number;
  charDiffs?: Array<[DocumentDiffOperation, string]>;
}

export interface DocumentDiffRow {
  kind: DocumentDiffRowKind;
  left?: DocumentDiffLine;
  right?: DocumentDiffLine;
}

export interface DocumentDiffStats {
  insert: number;
  delete: number;
  modified: number;
  equal: number;
  total: number;
}

interface Paragraph {
  text: string;
  comparable: string;
  lineNumber: number;
}

type RawLine = { type: 'equal' | 'insert' | 'delete'; paragraph: Paragraph };

const normalizeParagraph = (value: string): string => value
  .normalize('NFC')
  .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .trim();

const splitParagraphs = (value: string): Paragraph[] => String(value || '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((text, index) => ({ text, comparable: normalizeParagraph(text), lineNumber: index + 1 }))
  // Empty paragraphs are layout, not content. Word format comparison handles them separately.
  .filter(paragraph => paragraph.comparable.length > 0);

function buildRawLineDiff(left: Paragraph[], right: Paragraph[]): RawLine[] {
  const dmp = new DiffMatchPatch();
  const encoded = dmp.diff_linesToChars_(
    left.map(item => `${item.comparable}\n`).join(''),
    right.map(item => `${item.comparable}\n`).join(''),
  );
  const diffs = dmp.diff_main(encoded.chars1, encoded.chars2, false);
  const result: RawLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  for (const [operation, tokens] of diffs) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (operation === 0) {
        result.push({ type: 'equal', paragraph: left[leftIndex] });
        leftIndex += 1;
        rightIndex += 1;
      } else if (operation === -1) {
        result.push({ type: 'delete', paragraph: left[leftIndex] });
        leftIndex += 1;
      } else {
        result.push({ type: 'insert', paragraph: right[rightIndex] });
        rightIndex += 1;
      }
    }
  }
  return result;
}

function characterDiff(left: string, right: string): Array<[DocumentDiffOperation, string]> {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(left, right, false) as Array<[DocumentDiffOperation, string]>;
  dmp.diff_cleanupSemantic(diffs);
  return diffs.filter(([, text]) => text.length > 0);
}

function paragraphSimilarity(left: Paragraph, right: Paragraph): number {
  const maxLength = Math.max(left.comparable.length, right.comparable.length);
  if (maxLength === 0) return 1;
  const equalLength = characterDiff(left.comparable, right.comparable)
    .filter(([operation]) => operation === 0)
    .reduce((sum, [, text]) => sum + text.length, 0);
  return equalLength / maxLength;
}

function modifiedRow(left: Paragraph, right: Paragraph): DocumentDiffRow {
  const diffs = characterDiff(left.text, right.text);
  return {
    kind: 'modified',
    left: {
      type: 'delete',
      text: left.text,
      lineA: left.lineNumber,
      charDiffs: diffs.filter(([operation]) => operation !== 1),
    },
    right: {
      type: 'insert',
      text: right.text,
      lineB: right.lineNumber,
      charDiffs: diffs.filter(([operation]) => operation !== -1),
    },
  };
}

function alignChangedParagraphs(deletes: Paragraph[], inserts: Paragraph[]): DocumentDiffRow[] {
  const gapCost = 0.6;
  const scores = deletes.map(left => inserts.map(right => paragraphSimilarity(left, right)));
  const dp = Array.from({ length: deletes.length + 1 }, () => Array(inserts.length + 1).fill(0));

  for (let leftIndex = deletes.length - 1; leftIndex >= 0; leftIndex -= 1) {
    dp[leftIndex][inserts.length] = gapCost + dp[leftIndex + 1][inserts.length];
  }
  for (let rightIndex = inserts.length - 1; rightIndex >= 0; rightIndex -= 1) {
    dp[deletes.length][rightIndex] = gapCost + dp[deletes.length][rightIndex + 1];
  }

  for (let leftIndex = deletes.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = inserts.length - 1; rightIndex >= 0; rightIndex -= 1) {
      dp[leftIndex][rightIndex] = Math.min(
        (1 - scores[leftIndex][rightIndex]) + dp[leftIndex + 1][rightIndex + 1],
        gapCost + dp[leftIndex + 1][rightIndex],
        gapCost + dp[leftIndex][rightIndex + 1],
      );
    }
  }

  const rows: DocumentDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < deletes.length || rightIndex < inserts.length) {
    const matchCost = leftIndex < deletes.length && rightIndex < inserts.length
      ? (1 - scores[leftIndex][rightIndex]) + dp[leftIndex + 1][rightIndex + 1]
      : Number.POSITIVE_INFINITY;
    const deleteCost = leftIndex < deletes.length ? gapCost + dp[leftIndex + 1][rightIndex] : Number.POSITIVE_INFINITY;
    const insertCost = rightIndex < inserts.length ? gapCost + dp[leftIndex][rightIndex + 1] : Number.POSITIVE_INFINITY;
    if (matchCost <= deleteCost && matchCost <= insertCost) {
      rows.push(modifiedRow(deletes[leftIndex], inserts[rightIndex]));
      leftIndex += 1;
      rightIndex += 1;
    } else if (deleteCost <= insertCost) {
      const paragraph = deletes[leftIndex];
      rows.push({ kind: 'delete', left: { type: 'delete', text: paragraph.text, lineA: paragraph.lineNumber } });
      leftIndex += 1;
    } else {
      const paragraph = inserts[rightIndex];
      rows.push({ kind: 'insert', right: { type: 'insert', text: paragraph.text, lineB: paragraph.lineNumber } });
      rightIndex += 1;
    }
  }
  return rows;
}

export function computeDocumentDiffRows(textA: string, textB: string): DocumentDiffRow[] {
  const left = splitParagraphs(textA);
  const right = splitParagraphs(textB);
  const raw = buildRawLineDiff(left, right);
  const rows: DocumentDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (item.type === 'equal') {
      const leftParagraph = left[leftIndex];
      const rightParagraph = right[rightIndex];
      rows.push({
        kind: 'equal',
        left: { type: 'equal', text: leftParagraph.text, lineA: leftParagraph.lineNumber, lineB: rightParagraph.lineNumber },
        right: { type: 'equal', text: rightParagraph.text, lineA: leftParagraph.lineNumber, lineB: rightParagraph.lineNumber },
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    const deletes: Paragraph[] = [];
    const inserts: Paragraph[] = [];
    while (index < raw.length && raw[index].type !== 'equal') {
      if (raw[index].type === 'delete') {
        deletes.push(left[leftIndex]);
        leftIndex += 1;
      } else {
        inserts.push(right[rightIndex]);
        rightIndex += 1;
      }
      index += 1;
    }
    index -= 1;
    rows.push(...alignChangedParagraphs(deletes, inserts));
  }
  return rows;
}

export function summarizeDocumentDiff(rows: DocumentDiffRow[]): DocumentDiffStats {
  const stats: DocumentDiffStats = { insert: 0, delete: 0, modified: 0, equal: 0, total: rows.length };
  for (const row of rows) stats[row.kind] += 1;
  return stats;
}
