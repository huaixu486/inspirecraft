import { create } from 'zustand';

export const MAX_COLLABORATION_ACTIVITIES = 100;
const STORAGE_KEY = 'projecthub.collaboration.activities.v1';

export type CollaborationActivityKind = 'friend' | 'ai-writing' | 'ai-revision';
export type CollaborationActivityStatus = 'success' | 'failed' | 'info';

export type CollaborationActivityResumeData = {
  type: 'ai-writing';
  prompt: string;
  content: string;
  templateId?: string;
  templateName?: string;
  selectedDocIds?: string[];
} | {
  type: 'ai-revision';
  prompt: string;
  content: string;
  documentId?: string;
  documentName?: string;
  sourceText: string;
};

export interface CollaborationActivity {
  id: string;
  projectId?: string;
  projectName?: string;
  kind: CollaborationActivityKind;
  status: CollaborationActivityStatus;
  title: string;
  detail?: string;
  resumeData?: CollaborationActivityResumeData;
  createdAt: string;
}

type NewCollaborationActivity = Omit<CollaborationActivity, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

interface CollaborationActivityState {
  activities: CollaborationActivity[];
  recordActivity: (activity: NewCollaborationActivity) => CollaborationActivity;
}

const isActivity = (value: unknown): value is CollaborationActivity => {
  const item = value as Partial<CollaborationActivity> | null;
  return Boolean(
    item
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.createdAt === 'string'
    && ['friend', 'ai-writing', 'ai-revision'].includes(String(item.kind))
    && ['success', 'failed', 'info'].includes(String(item.status)),
  );
};

export const appendCollaborationActivity = (
  activities: CollaborationActivity[],
  activity: CollaborationActivity,
) => [activity, ...activities.filter(item => item.id !== activity.id)]
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .slice(0, MAX_COLLABORATION_ACTIVITIES);

export const canRestoreCollaborationActivity = (activity: CollaborationActivity) => Boolean(
  activity.status === 'success'
  && activity.resumeData
  && activity.resumeData.type === activity.kind
  && typeof activity.resumeData.prompt === 'string'
  && typeof activity.resumeData.content === 'string'
  && activity.resumeData.content.trim(),
);

const loadActivities = (): CollaborationActivity[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(isActivity).slice(0, MAX_COLLABORATION_ACTIVITIES);
  } catch {
    return [];
  }
};

const saveActivities = (activities: CollaborationActivity[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activities));
  } catch {}
};

const createActivityId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `collaboration-activity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const useCollaborationActivityStore = create<CollaborationActivityState>((set) => ({
  activities: loadActivities(),
  recordActivity: input => {
    const activity: CollaborationActivity = {
      ...input,
      id: input.id || createActivityId(),
      createdAt: input.createdAt || new Date().toISOString(),
    };
    set(state => {
      const activities = appendCollaborationActivity(state.activities, activity);
      saveActivities(activities);
      return { activities };
    });
    return activity;
  },
}));
