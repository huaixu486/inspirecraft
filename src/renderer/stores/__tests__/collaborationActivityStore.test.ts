import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendCollaborationActivity,
  canRestoreCollaborationActivity,
  MAX_COLLABORATION_ACTIVITIES,
  type CollaborationActivity,
} from '../collaborationActivityStore';

const makeActivity = (index: number): CollaborationActivity => ({
  id: `activity-${index}`,
  projectId: 'project-1',
  kind: index % 2 === 0 ? 'ai-writing' : 'friend',
  status: 'success',
  title: `activity ${index}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
});

test('collaboration activity keeps the newest 100 records', () => {
  let activities: CollaborationActivity[] = [];
  for (let index = 0; index < 120; index += 1) {
    activities = appendCollaborationActivity(activities, makeActivity(index));
  }

  assert.equal(activities.length, MAX_COLLABORATION_ACTIVITIES);
  assert.equal(activities[0].id, 'activity-119');
  assert.equal(activities.at(-1)?.id, 'activity-20');
});

test('recording the same activity id updates it without duplication', () => {
  const original = makeActivity(1);
  const updated = { ...original, title: 'updated', status: 'failed' as const };
  const activities = appendCollaborationActivity([original], updated);

  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, 'updated');
  assert.equal(activities[0].status, 'failed');
});

test('only successful AI activities with saved prompts and content can be restored', () => {
  const writing: CollaborationActivity = {
    ...makeActivity(2),
    kind: 'ai-writing',
    resumeData: {
      type: 'ai-writing',
      prompt: '生成压接设备提案',
      content: '一、问题描述\n压接设备初稿',
      templateId: 'template-1',
    },
  };
  assert.equal(canRestoreCollaborationActivity(writing), true);
  assert.equal(canRestoreCollaborationActivity({ ...writing, status: 'failed' }), false);
  assert.equal(canRestoreCollaborationActivity(makeActivity(3)), false);
});
