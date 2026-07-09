/**
 * 主进程提示词合成引擎
 *
 * 从磁盘加载提示词模板，替换 {{变量}} 占位符。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { PromptScene, PromptTemplate } from '../types';

/** 替换模板中的 {{变量}} 占位符 */
function fillTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] ?? '';
  });
}

/** 从磁盘加载提示词模板 */
function loadTemplatesFromDisk(): PromptTemplate[] {
  try {
    const dataDir = path.join(app.getPath('userData'), 'project-manager-data');
    const filePath = path.join(dataDir, 'prompt-templates.json');
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
  const userTemplate = sceneTemplates.find(t => !t.isBuiltin);
  const builtinTemplate = sceneTemplates.find(t => t.isBuiltin);
  const chosen = userTemplate || builtinTemplate;

  if (!chosen) {
    console.warn(`[promptComposer:main] No template found for scene: ${scene}`);
    return '';
  }

  return fillTemplate(chosen.content, context);
}
