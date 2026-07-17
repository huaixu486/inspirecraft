import type { TaskItem } from '../../../shared/types';

export interface AiWorkflowPlanItem {
  type: 'manual' | 'ai';
  title: string;
  description?: string;
  priority?: TaskItem['priority'];
  reason?: string;
}

export interface AiSectionAdvice {
  title: string;
  problems?: string[];
  suggestions?: string[];
}

export interface AiReportVariant {
  id: string;
  modelId?: string;
  modelName: string;
  ok: boolean;
  rawText: string;
  error?: string;
  report?: AiStageReport;
}

export interface AiStageReport {
  reportTitle?: string;
  reportSummary?: string;
  qualityAssessment?: string[];
  templateFit?: string[];
  writingStyleNotes?: string[];
  writingFramework?: string[];
  writingDirection?: string[];
  materialPlan?: string[];
  draftPlan?: string[];
  contentGaps?: string[];
  optimizationFocus?: string[];
  risks?: string[];
  humanTasks?: string[];
  aiTasks?: string[];
  workflowPlan?: AiWorkflowPlanItem[];
  sectionAdvice?: AiSectionAdvice[];
  rawText?: string;
  parallelVersions?: AiReportVariant[];
  synthesisModelName?: string;
}

export interface WorkflowDraftItem {
  id: string;
  type: 'manual' | 'ai';
  title: string;
  description: string;
  priority: TaskItem['priority'];
  order: number;
  reason?: string;
  sourceAdviceId?: string;
}

export interface SectionAdviceDraftItem {
  id: string;
  sectionTitle: string;
  problem: string;
  suggestion: string;
  selected: boolean;
}
