/**
 * 主进程提示词合成引擎
 *
 * 从磁盘加载提示词模板，替换 {{变量}} 占位符。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PromptScene, PromptTemplate } from '../types';
import { readVersionedJsonFile } from './versionedJson';

/** 替换模板中的 {{变量}} 占位符 */
function fillTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] ?? '';
  });
}

function normalizeStageName(value?: string): string {
  return String(value || '').trim().toLocaleLowerCase();
}

/** 从磁盘加载提示词模板 */
function loadTemplatesFromDisk(): PromptTemplate[] {
  try {
    const dataDir = path.join(app.getPath('userData'), 'project-manager-data');
    const filePath = path.join(dataDir, 'prompt-templates.json');
    if (!fs.existsSync(filePath)) return [];
    return readVersionedJsonFile<PromptTemplate[]>(filePath, []).data;
  } catch {
    return [];
  }
}

/**
 * 合成指定场景的最终提示词（主进程版本）
 *
 * @param scene 提示词场景
 * @param context 变量上下文
 * @returns 合成后的提示词，若无模板则返回空字符串
 */
export function composePromptMain(
  scene: PromptScene,
  context: Record<string, string>,
): string {
  const templates = loadTemplatesFromDisk();
  const sceneTemplates = templates.filter(t => t.scene === scene);
  const stageName = normalizeStageName(context.stage || context.stageName || context.currentStage);
  const chosen = (stageName
    ? sceneTemplates.find(template => normalizeStageName(template.stageName) === stageName)
    : undefined)
    || sceneTemplates.find(template => !template.stageId && !template.stageName)
    || sceneTemplates[0];

  if (!chosen) {
    console.warn(`[promptComposer:main] No template found for scene: ${scene}`);
    return '';
  }

  const header = `[提示词配置]\n场景：${scene}\n阶段：${chosen.stageName || context.stage || context.stageName || '通用'}\n配置：${chosen.name}`;
  return `${header}\n\n${fillTemplate(chosen.content, context)}`;
}
