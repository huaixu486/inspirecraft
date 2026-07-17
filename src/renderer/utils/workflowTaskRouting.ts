import { TaskItem, WorkbenchPage } from '../../shared/types';

const REVISION_LANGUAGE = /修改|修订|改写|改稿|优化|润色|补写|扩写|格式|审查问题|审查建议|问题|建议|完善|调整/i;

export const isRevisionTask = (task: TaskItem): boolean => task.source === 'review'
  || REVISION_LANGUAGE.test([
    task.title,
    task.description,
    task.workflowName,
    task.sectionTitle,
  ].filter(Boolean).join(' '));

export const buildTaskPrompt = (task: TaskItem): string => [
  task.title,
  task.sectionTitle ? `定位段落：${task.sectionTitle}` : '',
  task.sourceLineNumber ? `原始行号：第 ${task.sourceLineNumber} 行` : '',
  task.description ? `处理要求：${task.description}` : '',
].filter(Boolean).join('\n');

export const resolveTaskTarget = (task: TaskItem): WorkbenchPage => {
  if (isRevisionTask(task)) return 'team';
  if (task.source === 'report') return task.type === 'ai' ? 'team' : 'report';
  if (task.relatedDocId && task.type === 'ai') return 'team';
  if (task.source === 'stage' || task.stageName) return 'plan';
  return 'team';
};

export const isRevisionWorkflowFocus = (
  focus: {
    source?: string;
    intent?: 'writing' | 'revision' | 'dispatch';
    prompt?: string;
  },
): boolean => focus.intent === 'revision'
  || focus.source === 'review'
  || REVISION_LANGUAGE.test(focus.prompt || '');
