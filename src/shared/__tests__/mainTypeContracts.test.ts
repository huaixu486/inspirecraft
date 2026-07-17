import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Project as MainProject,
  ProjectDocument as MainProjectDocument,
  TaskItem as MainTaskItem,
} from '../../main/types';
import type {
  Project as SharedProject,
  ProjectDocument as SharedProjectDocument,
  TaskItem as SharedTaskItem,
} from '../types';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Value extends true> = Value;

const projectMatches: Assert<Equal<MainProject, SharedProject>> = true;
const taskMatches: Assert<Equal<MainTaskItem, SharedTaskItem>> = true;
const documentMatches: Assert<Equal<MainProjectDocument, SharedProjectDocument>> = true;

test('main-process entity mirrors remain structurally identical to shared contracts', () => {
  assert.equal(projectMatches && taskMatches && documentMatches, true);
});

