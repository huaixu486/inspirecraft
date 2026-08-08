import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  ImportOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { OutputField, PromptRule, PromptScene, PromptTemplate, StructuredPrompt } from '../../../shared/types';
import { PROMPT_CATEGORY_LABELS, PROMPT_SCENE_CATEGORIES, PROMPT_SCENE_LABELS } from '../../../shared/promptScenes';
import { usePromptStore } from '../../stores/promptStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { assembleStructuredPrompt, extractPlaceholders } from '../../utils/promptComposer';
import { getAllStages } from '../../utils/timelineStages';

const { Text, Title } = Typography;
const { TextArea } = Input;

type RuleType = PromptRule['type'];

const RULE_TYPE_OPTIONS: Array<{ value: RuleType; label: string }> = [
  { value: 'must', label: '\u5fc5\u987b\u505a' },
  { value: 'must_not', label: '\u4e0d\u80fd\u505a' },
  { value: 'prefer', label: '\u4f18\u5148\u8003\u8651' },
];

const SCENE_INFO: Record<PromptScene, { usage: string; example: string }> = {
  draft: { usage: '在团队写作中生成非分章的完整第一稿时使用', example: '根据用户要求、模板、项目资料和阶段记忆直接生成可编辑初稿' },
  longFormSection: { usage: '技术报告、研究报告等长篇文档逐章生成时使用', example: '按本章要求、目标篇幅和相关资料生成一章完整正文' },
  sectionExpansion: { usage: '分章结果低于目标篇幅，需要二次扩写时使用', example: '继承用户要求和模板约束，将已有章节补充到目标篇幅' },
  precisionRewrite: { usage: '团队写作中只修订用户选中的文字时使用', example: '仅返回选区的替换文本，不修改选区外内容' },
  report: { usage: '\u5728\u9879\u76ee\u8be6\u60c5\u3001\u4efb\u52a1\u89c4\u5212\u6216\u5199\u4f5c\u9762\u677f\u4e2d\u751f\u6210\u9636\u6bb5\u62a5\u544a\u65f6\u4f7f\u7528', example: '\u751f\u6210\u5199\u4f5c\u65b9\u5411\u3001\u6750\u6599\u8ba1\u5212\u3001\u4eba\u5de5\u5f85\u529e\u548c AI \u5f85\u529e' },
  review: { usage: '\u5728\u6587\u6863\u5ba1\u67e5\u5de5\u4f5c\u53f0\u4e2d\u8ba9 AI \u68c0\u67e5\u7f3a\u5931\u3001\u683c\u5f0f\u548c\u5185\u5bb9\u504f\u5dee\u65f6\u4f7f\u7528', example: '\u6309\u6a21\u677f\u7ed3\u6784\u5217\u51fa\u95ee\u9898\u3001\u98ce\u9669\u548c\u4fee\u6539\u5efa\u8bae' },
  rewrite: { usage: '\u5728\u5199\u4f5c\u5de5\u4f5c\u53f0\u4e2d\u5bf9\u5355\u4e2a\u7ae0\u8282\u8fdb\u884c AI \u6539\u5199\u65f6\u4f7f\u7528', example: '\u6839\u636e\u5f53\u524d\u7ae0\u8282\u3001\u6a21\u677f\u8981\u6c42\u548c\u53c2\u8003\u6750\u6599\u751f\u6210\u66ff\u6362\u6587\u672c' },
  diff: { usage: '\u5728\u7248\u672c\u5bf9\u6bd4\u4e2d\u8ba9 AI \u5206\u6790\u4e24\u4e2a\u6587\u6863\u5dee\u5f02\u65f6\u4f7f\u7528', example: '\u603b\u7ed3\u5185\u5bb9\u53d8\u5316\u3001\u683c\u5f0f\u53d8\u5316\u3001\u98ce\u9669\u548c\u5efa\u8bae' },
  summary: { usage: '\u4e3a\u6587\u6863\u751f\u6210\u7b80\u660e\u6458\u8981\u65f6\u4f7f\u7528', example: '\u751f\u6210 100-200 \u5b57\u7684\u6587\u6863\u5185\u5bb9\u6982\u8ff0' },
  memory: { usage: '\u9636\u6bb5\u6587\u6863\u5b8c\u6210\u540e\uff0cAI \u63d0\u70bc\u53ef\u590d\u7528\u5199\u4f5c\u7ecf\u9a8c\u65f6\u4f7f\u7528', example: '\u63d0\u53d6\u5199\u4f5c\u5957\u8def\u3001\u5e38\u89c1\u95ee\u9898\u548c\u4e0b\u6b21\u53ef\u590d\u7528\u7684\u9636\u6bb5\u8bb0\u5fc6' },
  description: { usage: '\u5728\u7528\u6237\u6ca1\u6709\u624b\u52a8\u586b\u5199\u9879\u76ee\u63cf\u8ff0\u65f6\u81ea\u52a8\u751f\u6210\u4fa7\u8fb9\u680f\u7b80\u4ecb', example: '\u6839\u636e\u9879\u76ee\u540d\u3001\u9636\u6bb5\u548c\u6587\u4ef6\u5217\u8868\u751f\u6210\u4e00\u53e5\u8bdd\u6982\u62ec' },
  taskExecute: { usage: '\u6267\u884c\u4efb\u52a1\u89c4\u5212\u4e2d\u7684 AI \u4efb\u52a1\u65f6\u4f7f\u7528', example: '\u6309\u4efb\u52a1\u6307\u4ee4\u6269\u5199\u3001\u6da6\u8272\u3001\u6574\u7406\u6216\u8f6c\u6362\u6587\u6863\u5185\u5bb9' },
  sectionAnalysis: { usage: '\u5206\u6790\u5355\u4e2a\u7ae0\u8282\u5b8c\u6210\u5ea6\u65f6\u4f7f\u7528', example: '\u5224\u65ad\u7ae0\u8282\u662f\u5b8c\u6210\u3001\u90e8\u5206\u5b8c\u6210\u8fd8\u662f\u7f3a\u5931' },
  workflowPlanning: { usage: '在报告工作台生成按章节可选择的工作流草稿时使用', example: '把章节问题转换为可编辑、可勾选的人工或 AI 写作步骤' },
  templateExtract: { usage: '\u4ece\u5bfc\u5165\u6587\u6863\u4e2d\u63d0\u53d6\u6a21\u677f\u7ed3\u6784\u548c\u683c\u5f0f\u89c4\u5219\u65f6\u4f7f\u7528', example: '\u8bc6\u522b\u6807\u9898\u5c42\u7ea7\u3001\u586b\u5199\u8bf4\u660e\u3001\u8303\u6587\u5199\u6cd5\u548c\u683c\u5f0f\u7ea6\u675f' },
  templateExampleExtract: { usage: '导入范文并识别通用写法、方向和格式时使用', example: '从多篇范文提炼可迁移的写作方向，不照搬项目事实' },
  templateDirectExtract: { usage: '导入可直接套用的模板并识别结构与硬性要求时使用', example: '区分章节、填写说明、范文和格式规则' },
  templateExampleAnalysis: { usage: '首次分析模板关联范文的写作规律时使用', example: '形成风格、章节写法、篇幅及开头结尾模式分析' },
  templateExampleCompare: { usage: '新增范文后与已有分析进行增量比较时使用', example: '只记录新范文带来的结构、格式或写法差异' },
};

const DEFAULT_STRUCTURED: Record<PromptScene, StructuredPrompt> = {
  draft: { scene: 'draft', mode: 'raw', role: '完整第一稿写作助手', goals: ['生成完整、可编辑的第一稿'], rules: [], outputFields: [{ key: 'draft', label: '第一稿正文', description: '完整正文' }] },
  longFormSection: { scene: 'longFormSection', mode: 'raw', role: '长篇分章写作助手', goals: ['生成当前章节完整正文'], rules: [], outputFields: [{ key: 'section', label: '章节正文', description: '当前章节正文' }] },
  sectionExpansion: { scene: 'sectionExpansion', mode: 'raw', role: '章节扩写助手', goals: ['扩写到目标篇幅'], rules: [], outputFields: [{ key: 'section', label: '扩写后正文', description: '扩写后的完整章节' }] },
  precisionRewrite: { scene: 'precisionRewrite', mode: 'raw', role: '选区精确修订助手', goals: ['只修改选中文字'], rules: [], outputFields: [{ key: 'text', label: '修订后选区', description: '用于替换选区的文本' }] },
  workflowPlanning: { scene: 'workflowPlanning', mode: 'raw', role: '阶段写作工作流规划助手', goals: ['生成可选择、可编辑的写作步骤'], rules: [], outputFields: [{ key: 'sectionAdvice', label: '章节建议', description: '可转换为工作流的章节写作步骤' }] },
  templateExampleExtract: { scene: 'templateExampleExtract', mode: 'raw', role: '范文模板识别助手', goals: ['提炼范文的通用写法与格式'], rules: [], outputFields: [{ key: 'nodes', label: '写作方向', description: '范文中可迁移的写作方向' }] },
  templateDirectExtract: { scene: 'templateDirectExtract', mode: 'raw', role: '直接套用模板识别助手', goals: ['识别模板结构、要求、范文和格式'], rules: [], outputFields: [{ key: 'nodes', label: '模板章节', description: '模板原始章节与约束' }] },
  templateExampleAnalysis: { scene: 'templateExampleAnalysis', mode: 'raw', role: '范文写法分析助手', goals: ['形成可复用的范文写作分析'], rules: [], outputFields: [{ key: 'sectionGuidance', label: '章节指导', description: '各章节的写法与篇幅参考' }] },
  templateExampleCompare: { scene: 'templateExampleCompare', mode: 'raw', role: '范文差异分析助手', goals: ['只输出新范文带来的差异'], rules: [], outputFields: [{ key: 'differences', label: '范文差异', description: '新增或不同的写法与格式' }] },
  report: {
    scene: 'report',
    mode: 'structured',
    role: '\u9879\u76ee\u9636\u6bb5\u6587\u6863\u5199\u4f5c\u89c4\u5212\u52a9\u624b',
    goals: ['\u6982\u8ff0\u5f53\u524d\u6587\u6863\u5199\u4f5c\u72b6\u6001', '\u6309\u6a21\u677f\u548c\u8303\u6587\u63d0\u70bc\u5199\u4f5c\u65b9\u5411', '\u7ed9\u51fa\u6750\u6599\u8ba1\u5212\u3001\u521d\u7a3f\u8ba1\u5212\u548c\u5f85\u529e\u4efb\u52a1'],
    rules: [
      { id: 'report-json', type: 'must', enabled: true, text: '\u8f93\u51fa\u5fc5\u987b\u662f JSON \u5bf9\u8c61\uff0c\u4e0d\u8981 Markdown' },
      { id: 'report-no-risk', type: 'must_not', enabled: true, text: '\u4e0d\u8981\u6cdb\u6cdb\u8c08\u98ce\u9669\uff0c\u53ea\u5728\u7ae0\u8282\u7f3a\u5931\u6216\u7ea6\u675f\u51b2\u7a81\u65f6\u63d0\u9192' },
      { id: 'report-template', type: 'must', enabled: true, text: '\u6a21\u677f\u683c\u5f0f\u8981\u6c42\u662f\u786c\u6027\u7ea6\u675f\uff0c\u8303\u6587\u53ea\u63d0\u53d6\u7ed3\u6784\u548c\u8868\u8fbe\u7279\u5f81' },
    ],
    outputFields: [
      { key: 'reportTitle', label: '\u62a5\u544a\u6807\u9898', description: '\u7b80\u77ed\u8bf4\u660e\u672c\u6b21\u5199\u4f5c\u89c4\u5212\u7684\u4e3b\u9898' },
      { key: 'reportSummary', label: '\u72b6\u6001\u6982\u8ff0', description: '300 \u5b57\u4ee5\u5185\u6982\u8ff0\u5f53\u524d\u6587\u6863\u72b6\u6001\u548c\u4e0b\u4e00\u6b65\u65b9\u5411' },
      { key: 'writingDirection', label: '\u5199\u4f5c\u65b9\u5411', description: '\u6309\u7ae0\u8282\u5217\u51fa\u63a5\u4e0b\u6765\u8981\u5199\u4ec0\u4e48' },
      { key: 'humanTasks', label: '\u4eba\u5de5\u4efb\u52a1', description: '\u9700\u8981\u7528\u6237\u8865\u6750\u6599\u6216\u786e\u8ba4\u7684\u4e8b\u9879' },
      { key: 'aiTasks', label: 'AI \u4efb\u52a1', description: '\u9002\u5408\u7cfb\u7edf\u81ea\u52a8\u6267\u884c\u7684\u5199\u4f5c\u6216\u68c0\u67e5\u4efb\u52a1' },
    ],
  },
  review: {
    scene: 'review',
    mode: 'structured',
    role: '\u6587\u6863\u5ba1\u67e5\u52a9\u624b',
    goals: ['\u68c0\u67e5\u7ae0\u8282\u7f3a\u5931', '\u68c0\u67e5\u5185\u5bb9\u662f\u5426\u504f\u79bb\u6a21\u677f\u8981\u6c42', '\u7ed9\u51fa\u53ef\u6267\u884c\u4fee\u6539\u5efa\u8bae'],
    rules: [
      { id: 'review-evidence', type: 'must', enabled: true, text: '\u6bcf\u4e2a\u95ee\u9898\u90fd\u8981\u5bf9\u5e94\u660e\u786e\u7684\u7ae0\u8282\u6216\u6587\u672c\u4f9d\u636e' },
      { id: 'review-no-score-only', type: 'must_not', enabled: true, text: '\u4e0d\u8981\u53ea\u7ed9\u5206\u6570\uff0c\u5fc5\u987b\u8bf4\u660e\u4fee\u6539\u4f4d\u7f6e\u548c\u65b9\u6cd5' },
    ],
    outputFields: [
      { key: 'summary', label: '\u5ba1\u67e5\u603b\u7ed3', description: '\u6982\u8ff0\u6574\u4f53\u95ee\u9898\u548c\u4fee\u6539\u4f18\u5148\u7ea7' },
      { key: 'issues', label: '\u95ee\u9898\u6e05\u5355', description: '\u9010\u6761\u5217\u51fa\u7f3a\u5931\u3001\u683c\u5f0f\u6216\u5185\u5bb9\u95ee\u9898' },
      { key: 'suggestions', label: '\u4fee\u6539\u5efa\u8bae', description: '\u7ed9\u51fa\u53ef\u76f4\u63a5\u6267\u884c\u7684\u6539\u6cd5' },
    ],
  },
  rewrite: {
    scene: 'rewrite',
    mode: 'structured',
    role: '\u7ae0\u8282\u6539\u5199\u52a9\u624b',
    goals: ['\u7406\u89e3\u5f53\u524d\u7ae0\u8282\u610f\u56fe', '\u6309\u6a21\u677f\u8981\u6c42\u6539\u5199\u6587\u672c', '\u4fdd\u7559\u5df2\u786e\u5b9a\u7684\u4e8b\u5b9e\u548c\u6570\u636e'],
    rules: [
      { id: 'rewrite-facts', type: 'must', enabled: true, text: '\u4e0d\u80fd\u6539\u5199\u6216\u865a\u6784\u7528\u6237\u5df2\u63d0\u4f9b\u7684\u5173\u952e\u4e8b\u5b9e' },
      { id: 'rewrite-style', type: 'prefer', enabled: true, text: '\u4f18\u5148\u4f7f\u7528\u6b63\u5f0f\u3001\u6e05\u6670\u3001\u53ef\u653e\u5165\u6587\u6863\u7684\u8868\u8fbe' },
    ],
    outputFields: [
      { key: 'rewrittenText', label: '\u6539\u5199\u540e\u6587\u672c', description: '\u53ef\u76f4\u63a5\u66ff\u6362\u539f\u7ae0\u8282\u7684\u5185\u5bb9' },
      { key: 'changeNotes', label: '\u6539\u5199\u8bf4\u660e', description: '\u7b80\u8981\u8bf4\u660e\u4fee\u6539\u91cd\u70b9' },
    ],
  },
  diff: {
    scene: 'diff',
    mode: 'structured',
    role: '\u6587\u6863\u7248\u672c\u5bf9\u6bd4\u52a9\u624b',
    goals: ['\u8bf4\u660e\u4e24\u4e2a\u7248\u672c\u7684\u5185\u5bb9\u5dee\u5f02', '\u8bf4\u660e\u683c\u5f0f\u548c\u7ed3\u6784\u5dee\u5f02', '\u7ed9\u51fa\u9700\u8981\u4eba\u5de5\u786e\u8ba4\u7684\u5efa\u8bae'],
    rules: [
      { id: 'diff-neutral', type: 'must', enabled: true, text: '\u53ea\u57fa\u4e8e\u4e24\u4e2a\u6587\u6863\u7684\u5dee\u5f02\u5206\u6790\uff0c\u4e0d\u9884\u8bbe\u54ea\u4e00\u7248\u66f4\u597d' },
      { id: 'diff-readable', type: 'must', enabled: true, text: '\u628a\u6280\u672f\u5b57\u6bb5\u8f6c\u6210\u666e\u901a\u7528\u6237\u80fd\u770b\u61c2\u7684\u8bf4\u6cd5' },
    ],
    outputFields: [
      { key: 'contentChanges', label: '\u5185\u5bb9\u5dee\u5f02', description: '\u5217\u51fa\u65b0\u589e\u3001\u5220\u9664\u3001\u4fee\u6539\u7684\u8981\u70b9' },
      { key: 'formatChanges', label: '\u683c\u5f0f\u5dee\u5f02', description: '\u5217\u51fa\u5b57\u4f53\u3001\u884c\u8ddd\u3001\u6807\u9898\u5c42\u7ea7\u7b49\u53d8\u5316' },
      { key: 'comment', label: 'AI \u8bc4\u8bed', description: '\u7528\u6237\u9700\u8981\u65f6\u751f\u6210\u7684\u5bf9\u6bd4\u8bc4\u4ef7' },
    ],
  },
  summary: { scene: 'summary', mode: 'structured', role: '\u6587\u6863\u6458\u8981\u52a9\u624b', goals: ['\u538b\u7f29\u6587\u6863\u4e3b\u8981\u4fe1\u606f', '\u4fdd\u7559\u5173\u952e\u7ed3\u8bba\u3001\u6570\u636e\u548c\u4e0b\u4e00\u6b65'], rules: [{ id: 'summary-short', type: 'must', enabled: true, text: '\u4f18\u5148\u7b80\u660e\uff0c\u4e0d\u8981\u91cd\u590d\u539f\u6587' }], outputFields: [{ key: 'summary', label: '\u6458\u8981', description: '\u7b80\u660e\u6982\u8ff0\u6587\u6863\u5185\u5bb9' }, { key: 'keyPoints', label: '\u5173\u952e\u8981\u70b9', description: '\u5217\u51fa\u91cd\u8981\u4e8b\u5b9e\u548c\u7ed3\u8bba' }] },
  memory: { scene: 'memory', mode: 'structured', role: '\u9636\u6bb5\u8bb0\u5fc6\u5b66\u4e60\u52a9\u624b', goals: ['\u4ece\u5b8c\u6210\u6587\u6863\u4e2d\u63d0\u70bc\u53ef\u590d\u7528\u7ecf\u9a8c', '\u8bb0\u5f55\u7f3a\u5931\u548c\u4e0b\u6b21\u53ef\u6539\u8fdb\u70b9', '\u6309\u9879\u76ee\u9636\u6bb5\u4fdd\u5b58\u8bb0\u5fc6'], rules: [{ id: 'memory-rollback', type: 'must', enabled: true, text: '\u5982\u679c\u9636\u6bb5\u6587\u6863\u88ab\u53d6\u6d88\uff0c\u5e94\u652f\u6301\u56de\u6eda\u5230\u4e0a\u4e00\u6b21\u6709\u6548\u8bb0\u5fc6' }, { id: 'memory-no-large-copy', type: 'must_not', enabled: true, text: '\u4e0d\u8981\u5927\u6bb5\u590d\u5236\u539f\u6587\uff0c\u53ea\u4fdd\u7559\u53ef\u590d\u7528\u89c4\u5219' }], outputFields: [{ key: 'lessons', label: '\u53ef\u590d\u7528\u7ecf\u9a8c', description: '\u672c\u9636\u6bb5\u5199\u4f5c\u4e2d\u503c\u5f97\u4fdd\u7559\u7684\u65b9\u6cd5' }, { key: 'gaps', label: '\u67e5\u7f3a\u8865\u6f0f', description: '\u4e0b\u6b21\u9700\u8981\u63d0\u524d\u8865\u9f50\u7684\u6750\u6599\u6216\u7ed3\u6784' }] },
  description: { scene: 'description', mode: 'structured', role: '\u9879\u76ee\u7b80\u4ecb\u751f\u6210\u52a9\u624b', goals: ['\u6839\u636e\u9879\u76ee\u540d\u548c\u6587\u4ef6\u53d8\u5316\u751f\u6210\u7b80\u77ed\u63cf\u8ff0', '\u5c3d\u91cf\u51cf\u5c11 token \u6d88\u8017'], rules: [{ id: 'description-short', type: 'must', enabled: true, text: '\u63cf\u8ff0\u8981\u7b80\u660e\uff0c\u4f18\u5148\u63a7\u5236\u5728\u4e00\u53e5\u8bdd\u5185' }, { id: 'description-manual', type: 'must_not', enabled: true, text: '\u7528\u6237\u5df2\u624b\u52a8\u586b\u5199\u9879\u76ee\u63cf\u8ff0\u65f6\u4e0d\u8981\u81ea\u52a8\u8986\u76d6' }], outputFields: [{ key: 'description', label: '\u9879\u76ee\u63cf\u8ff0', description: '\u4fa7\u8fb9\u680f\u5c55\u793a\u7684\u7b80\u77ed\u8bf4\u660e' }] },
  taskExecute: { scene: 'taskExecute', mode: 'structured', role: 'AI \u4efb\u52a1\u6267\u884c\u52a9\u624b', goals: ['\u7406\u89e3\u4efb\u52a1\u76ee\u6807', '\u57fa\u4e8e\u5f53\u524d\u6587\u6863\u548c\u9879\u76ee\u4e0a\u4e0b\u6587\u6267\u884c', '\u8f93\u51fa\u53ef\u76f4\u63a5\u4f7f\u7528\u7684\u7ed3\u679c'], rules: [{ id: 'task-scope', type: 'must', enabled: true, text: '\u4e25\u683c\u6309\u4efb\u52a1\u8303\u56f4\u5904\u7406\uff0c\u4e0d\u6269\u5927\u4fee\u6539\u9762' }], outputFields: [{ key: 'result', label: '\u6267\u884c\u7ed3\u679c', description: '\u4efb\u52a1\u5b8c\u6210\u540e\u7684\u4e3b\u8981\u5185\u5bb9' }, { key: 'notes', label: '\u8bf4\u660e', description: '\u5fc5\u8981\u65f6\u8bf4\u660e\u5047\u8bbe\u548c\u5f85\u786e\u8ba4\u4e8b\u9879' }] },
  sectionAnalysis: { scene: 'sectionAnalysis', mode: 'structured', role: '\u7ae0\u8282\u5b8c\u6210\u5ea6\u5206\u6790\u52a9\u624b', goals: ['\u5224\u65ad\u7ae0\u8282\u5b8c\u6210\u5ea6', '\u6307\u51fa\u7f3a\u5931\u5185\u5bb9', '\u7ed9\u51fa\u4e0b\u4e00\u6b65\u8865\u5168\u5efa\u8bae'], rules: [{ id: 'section-status', type: 'must', enabled: true, text: '\u72b6\u6001\u53ea\u80fd\u662f\u5df2\u5b8c\u6210\u3001\u90e8\u5206\u5b8c\u6210\u6216\u7f3a\u5931' }], outputFields: [{ key: 'status', label: '\u5b8c\u6210\u72b6\u6001', description: '\u7ae0\u8282\u5f53\u524d\u7684\u5b8c\u6210\u7a0b\u5ea6' }, { key: 'advice', label: '\u8865\u5168\u5efa\u8bae', description: '\u63a5\u4e0b\u6765\u9700\u8981\u8865\u5145\u7684\u5185\u5bb9' }] },
  templateExtract: { scene: 'templateExtract', mode: 'structured', role: '\u6587\u6863\u6a21\u677f\u7ed3\u6784\u63d0\u53d6\u52a9\u624b', goals: ['\u8bc6\u522b\u6587\u6863\u6807\u9898\u5c42\u7ea7', '\u63d0\u53d6\u586b\u5199\u8981\u6c42\u548c\u8303\u6587\u7279\u5f81', '\u63d0\u53d6\u53ef\u590d\u7528\u683c\u5f0f\u89c4\u5219'], rules: [{ id: 'template-hard-soft', type: 'must', enabled: true, text: '\u533a\u5206\u786c\u6027\u586b\u5199\u8981\u6c42\u548c\u8303\u6587\u8868\u8fbe\u7279\u5f81' }, { id: 'template-structure', type: 'must', enabled: true, text: '\u4fdd\u7559\u7ae0\u8282\u5c42\u7ea7\u5173\u7cfb' }], outputFields: [{ key: 'nodes', label: '\u6a21\u677f\u7ae0\u8282', description: '\u5e26\u5c42\u7ea7\u7684\u7ae0\u8282\u7ed3\u6784' }, { key: 'formatRules', label: '\u683c\u5f0f\u89c4\u5219', description: '\u6807\u9898\u3001\u6b63\u6587\u3001\u8868\u683c\u7b49\u683c\u5f0f\u8981\u6c42' }] },
};

const SCENE_OPTIONS = Object.entries(PROMPT_CATEGORY_LABELS).map(([category, label]) => ({
  label,
  options: Object.entries(PROMPT_SCENE_LABELS)
    .filter(([scene]) => scene !== 'templateExtract' && PROMPT_SCENE_CATEGORIES[scene as PromptScene] === category)
    .map(([value, sceneLabel]) => ({ value: value as PromptScene, label: sceneLabel })),
}));

function createInternalOutputFieldKey(fields: OutputField[]) {
  const existingKeys = new Set(fields.map(field => field.key));
  let index = 1;
  while (existingKeys.has(`customField${index}`)) index += 1;
  return `customField${index}`;
}

function cloneDefault(scene: PromptScene): StructuredPrompt {
  const value = DEFAULT_STRUCTURED[scene];
  return {
    ...value,
    goals: [...value.goals],
    rules: value.rules.map(rule => ({ ...rule })),
    outputFields: value.outputFields.map(field => ({ ...field })),
  };
}

function isProbablyMojibake(value?: string): boolean {
  if (!value) return false;
  const markers = ['\uFFFD', '\u95c1', '\u951f', '\u9359', '\u93c2', '\u7011', '\u59af'];
  return markers.some(marker => value.includes(marker));
}

function normalizeStructured(template: PromptTemplate | null, scene: PromptScene): StructuredPrompt {
  const source = template?.structured;
  if (!source && template) {
    return { ...cloneDefault(scene), mode: 'raw', rawPrompt: template.content || '' };
  }
  if (!source || isProbablyMojibake(source.role)) {
    return cloneDefault(scene);
  }
  const defaults = cloneDefault(scene);
  return {
    scene,
    mode: source.mode === 'raw' ? 'raw' : 'structured',
    role: source.role || defaults.role,
    goals: Array.isArray(source.goals) && source.goals.length > 0 ? [...source.goals] : defaults.goals,
    rules: Array.isArray(source.rules) && source.rules.length > 0 ? source.rules.map(rule => ({ ...rule })) : defaults.rules,
    outputFields: Array.isArray(source.outputFields) && source.outputFields.length > 0 ? source.outputFields.map(field => ({ ...field })) : defaults.outputFields,
    rawPrompt: source.rawPrompt || template?.content || '',
  };
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function isRuleType(value: unknown): value is RuleType {
  return value === 'must' || value === 'must_not' || value === 'prefer';
}

function extractJsonObject(text: string): any {
  const cleaned = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('\u672a\u8bc6\u522b\u5230 JSON \u5bf9\u8c61');
  }
}

function normalizeRules(value: unknown): PromptRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): PromptRule | null => {
      if (typeof item === 'string') {
        return { id: nextId(`rule-${index}`), type: 'must', enabled: true, text: item };
      }
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<PromptRule>;
      const text = String(raw.text || '').trim();
      if (!text) return null;
      return {
        id: raw.id || nextId(`rule-${index}`),
        type: isRuleType(raw.type) ? raw.type : 'must',
        enabled: raw.enabled !== false,
        text,
      };
    })
    .filter((item): item is PromptRule => Boolean(item));
}

function normalizeOutputFields(value: unknown): OutputField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): OutputField | null => {
      if (typeof item === 'string') {
        return { key: `field${index + 1}`, label: item, description: item };
      }
      if (!item || typeof item !== 'object') return null;
      const raw = item as Partial<OutputField>;
      const label = String(raw.label || raw.key || '').trim();
      const description = String(raw.description || '').trim();
      if (!label && !description) return null;
      return {
        key: String(raw.key || `field${index + 1}`).trim(),
        label: label || String(raw.key || `field${index + 1}`),
        description,
      };
    })
    .filter((item): item is OutputField => Boolean(item));
}

function buildStructuredFromJson(value: any, scene: PromptScene, fallback: StructuredPrompt): StructuredPrompt {
  const goals = Array.isArray(value?.goals)
    ? value.goals.map((item: unknown) => String(item).trim()).filter(Boolean)
    : [];
  const rules = normalizeRules(value?.rules);
  const outputFields = normalizeOutputFields(value?.outputFields);
  return {
    scene,
    mode: 'structured',
    role: String(value?.role || fallback.role).trim(),
    goals: goals.length > 0 ? goals : fallback.goals,
    rules: rules.length > 0 ? rules : fallback.rules,
    outputFields: outputFields.length > 0 ? outputFields : fallback.outputFields,
    rawPrompt: typeof value?.rawPrompt === 'string' ? value.rawPrompt : fallback.rawPrompt,
  };
}

function getPromptJsonSchemaText(): string {
  return JSON.stringify({
    role: '\u8fd9\u4e2a\u573a\u666f\u4e0b AI \u7684\u89d2\u8272',
    goals: ['\u76ee\u6807 1', '\u76ee\u6807 2'],
    rules: [
      { type: 'must', enabled: true, text: '\u5fc5\u987b\u9075\u5b88\u7684\u89c4\u5219' },
      { type: 'must_not', enabled: true, text: '\u4e0d\u80fd\u505a\u7684\u4e8b' },
      { type: 'prefer', enabled: true, text: '\u4f18\u5148\u8003\u8651\u7684\u504f\u597d' },
    ],
    outputFields: [
      { key: 'summary', label: '\u7ed9\u7528\u6237\u770b\u7684\u540d\u79f0', description: '\u8fd9\u4e2a\u8f93\u51fa\u9879\u8981\u5305\u542b\u4ec0\u4e48' },
    ],
  }, null, 2);
}

function buildExternalRuleTemplate(scene: PromptScene, info: { usage: string; example: string }, current: StructuredPrompt): string {
  return [
    '\u8bf7\u5e2e\u6211\u4e3a\u4e00\u4e2a\u9879\u76ee\u7ba1\u7406\u8f6f\u4ef6\u751f\u6210\u63d0\u793a\u8bcd\u914d\u7f6e\u3002',
    '',
    `\u573a\u666f\uff1a${PROMPT_SCENE_LABELS[scene]}`,
    `\u7528\u9014\uff1a${info.usage}`,
    `\u793a\u4f8b\uff1a${info.example}`,
    '',
    '\u8f93\u51fa\u8981\u6c42\uff1a',
    '1. \u53ea\u8f93\u51fa JSON \u5bf9\u8c61\uff0c\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\u6587\u5b57\u3002',
    '2. role \u5199 AI \u7684\u89d2\u8272\uff0c\u8981\u77ed\u800c\u51c6\u3002',
    '3. goals \u5199 AI \u8981\u5b8c\u6210\u7684\u76ee\u6807\uff0c\u4f7f\u7528\u5b57\u7b26\u4e32\u6570\u7ec4\u3002',
    '4. rules \u5199\u6267\u884c\u89c4\u5219\uff0ctype \u53ea\u80fd\u662f must\u3001must_not\u3001prefer\uff0cenabled \u9ed8\u8ba4 true\u3002',
    '5. outputFields \u5199 AI \u9700\u8981\u8f93\u51fa\u7684\u5185\u5bb9\u9879\uff0ckey \u7528\u82f1\u6587\u6216\u62fc\u97f3\uff0clabel \u7ed9\u666e\u901a\u7528\u6237\u770b\uff0cdescription \u5199\u6e05\u542b\u4e49\u3002',
    '6. \u4e0d\u8981\u8f93\u51fa\u6700\u7ec8\u5927\u6bb5 prompt \u6e90\u7801\uff0c\u53ea\u8f93\u51fa\u8fd9\u4efd\u7ed3\u6784\u5316 JSON\u3002',
    '',
    '\u5fc5\u987b\u4f7f\u7528\u8fd9\u4e2a JSON \u7ed3\u6784\uff1a',
    getPromptJsonSchemaText(),
    '',
    '\u5f53\u524d\u53c2\u8003\u914d\u7f6e\uff1a',
    JSON.stringify({
      role: current.role,
      goals: current.goals,
      rules: current.rules.map(rule => ({ type: rule.type, enabled: rule.enabled, text: rule.text })),
      outputFields: current.outputFields,
    }, null, 2),
  ].join('\n');
}

function buildAiFillPrompt(scene: PromptScene, info: { usage: string; example: string }, requirement: string, current: StructuredPrompt): string {
  return [
    '\u4f60\u662f\u4e00\u4e2a\u63d0\u793a\u8bcd\u914d\u7f6e\u8bbe\u8ba1\u52a9\u624b\u3002',
    '\u8bf7\u6839\u636e\u7528\u6237\u9700\u6c42\uff0c\u4e3a\u8f6f\u4ef6\u751f\u6210\u53ef\u7ed3\u6784\u5316\u7f16\u8f91\u7684\u63d0\u793a\u8bcd\u914d\u7f6e\u3002',
    '',
    `\u573a\u666f\uff1a${PROMPT_SCENE_LABELS[scene]}`,
    `\u7528\u9014\uff1a${info.usage}`,
    `\u793a\u4f8b\uff1a${info.example}`,
    '',
    `\u7528\u6237\u9700\u6c42\uff1a${requirement}`,
    '',
    '\u8f93\u51fa\u8981\u6c42\uff1a\u53ea\u8f93\u51fa JSON \u5bf9\u8c61\uff0c\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\u3002',
    '\u89c4\u5219 type \u53ea\u80fd\u662f must\u3001must_not\u3001prefer\u3002',
    '\u8f93\u51fa\u7ed3\u6784\uff1a',
    getPromptJsonSchemaText(),
    '',
    '\u53ef\u53c2\u8003\u5f53\u524d\u914d\u7f6e\uff1a',
    JSON.stringify({
      role: current.role,
      goals: current.goals,
      rules: current.rules.map(rule => ({ type: rule.type, enabled: rule.enabled, text: rule.text })),
      outputFields: current.outputFields,
    }, null, 2),
  ].join('\n');
}

const PromptSettings: React.FC = () => {
  const { templates, saveTemplate, resetTemplate } = usePromptStore();
  const customStages = useSettingsStore(state => state.customStages);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const [selectedScene, setSelectedScene] = useState<PromptScene>('report');
  const [selectedStageId, setSelectedStageId] = useState('common');
  const [draft, setDraft] = useState<StructuredPrompt>(() => cloneDefault('report'));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [aiFillOpen, setAiFillOpen] = useState(false);
  const [aiRequirement, setAiRequirement] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  const selectedStage = allStages.find(stage => stage.id === selectedStageId);
  const exactTemplate = useMemo(() => {
    const sceneTemplates = templates.filter(template => template.scene === selectedScene);
    return selectedStageId === 'common'
      ? sceneTemplates.find(template => !template.stageId && !template.stageName) || null
      : sceneTemplates.find(template => template.stageId === selectedStageId || template.stageName === selectedStage?.name) || null;
  }, [selectedScene, selectedStage?.name, selectedStageId, templates]);
  const currentTemplate = useMemo(() => exactTemplate || (
    templates.find(template => template.scene === selectedScene && !template.stageId && !template.stageName) || null
  ), [exactTemplate, selectedScene, templates]);

  useEffect(() => {
    const normalized = normalizeStructured(currentTemplate, selectedScene);
    setDraft(normalized);
    setSourceDraft(normalized.rawPrompt || currentTemplate?.content || assembleStructuredPrompt(normalized));
  }, [currentTemplate, selectedScene]);

  const finalPrompt = useMemo(() => (
    draft.mode === 'raw' ? (draft.rawPrompt || sourceDraft) : assembleStructuredPrompt(draft)
  ), [draft, sourceDraft]);

  const placeholders = useMemo(() => extractPlaceholders(finalPrompt), [finalPrompt]);
  const sceneInfo = SCENE_INFO[selectedScene];
  const externalRuleTemplate = useMemo(
    () => buildExternalRuleTemplate(selectedScene, sceneInfo, draft),
    [draft, sceneInfo, selectedScene],
  );

  const updateDraft = (updates: Partial<StructuredPrompt>) => {
    setDraft(prev => ({ ...prev, ...updates, mode: updates.mode || 'structured' }));
  };

  const updateGoal = (index: number, value: string) => {
    setDraft(prev => ({ ...prev, mode: 'structured', goals: prev.goals.map((goal, goalIndex) => (goalIndex === index ? value : goal)) }));
  };

  const updateRule = (id: string, updates: Partial<PromptRule>) => {
    setDraft(prev => ({ ...prev, mode: 'structured', rules: prev.rules.map(rule => (rule.id === id ? { ...rule, ...updates } : rule)) }));
  };

  const updateField = (index: number, updates: Partial<OutputField>) => {
    setDraft(prev => ({ ...prev, mode: 'structured', outputFields: prev.outputFields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...updates } : field)) }));
  };

  const save = async (nextDraft = draft) => {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const structured: StructuredPrompt = { ...nextDraft, scene: selectedScene, rawPrompt: sourceDraft };
      const content = structured.mode === 'raw' ? sourceDraft : assembleStructuredPrompt(structured);
      const base = exactTemplate;
      const template: PromptTemplate = {
        id: base?.id || `user-${selectedScene}-${selectedStageId}`,
        scene: selectedScene,
        stageId: selectedStage?.id,
        stageName: selectedStage?.name,
        name: base?.name && !isProbablyMojibake(base.name)
          ? base.name
          : `${PROMPT_SCENE_LABELS[selectedScene]} - ${selectedStage?.name || '通用'}`,
        content,
        isBuiltin: false,
        createdAt: base?.createdAt || now,
        updatedAt: now,
        structured,
      };
      await saveTemplate(template);
      message.success('\u63d0\u793a\u8bcd\u5df2\u4fdd\u5b58');
    } finally {
      setSaving(false);
    }
  };

  const saveRawMode = async () => {
    const nextDraft: StructuredPrompt = { ...draft, mode: 'raw', rawPrompt: sourceDraft };
    setDraft(nextDraft);
    setSourceOpen(false);
    await save(nextDraft);
  };

  const restoreDefault = async () => {
    if (exactTemplate) {
      await resetTemplate(exactTemplate.id);
      message.success('\u5df2\u6062\u590d\u9ed8\u8ba4\u63d0\u793a\u8bcd');
      return;
    }
    const normalized = cloneDefault(selectedScene);
    setDraft(normalized);
    setSourceDraft(assembleStructuredPrompt(normalized));
    message.info('\u5df2\u8fd8\u539f\u672c\u5730\u9ed8\u8ba4\u914d\u7f6e');
  };

  const copyRuleTemplate = async () => {
    await navigator.clipboard.writeText(externalRuleTemplate);
    message.success('\u89c4\u5219\u6a21\u677f\u5df2\u590d\u5236');
  };

  const applyStructuredJsonText = (text: string) => {
    const parsed = extractJsonObject(text);
    const next = buildStructuredFromJson(parsed, selectedScene, draft);
    setDraft(next);
    setSourceDraft(assembleStructuredPrompt(next));
    message.success('\u5df2\u8bc6\u522b\u5e76\u586b\u5145\u5230\u8868\u5355');
  };

  const importStructuredPrompt = () => {
    try {
      applyStructuredJsonText(importText);
      setImportOpen(false);
      setImportText('');
    } catch (error: any) {
      message.error(error?.message || '\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u7c98\u8d34\u7684\u662f JSON \u7ed3\u6784');
    }
  };

  const generatePromptWithAI = async () => {
    if (!aiRequirement.trim()) {
      message.warning('\u8bf7\u5148\u8f93\u5165\u4f60\u60f3\u8981\u7684\u63d0\u793a\u8bcd\u9700\u6c42');
      return;
    }
    setAiGenerating(true);
    try {
      const prompt = buildAiFillPrompt(selectedScene, sceneInfo, aiRequirement.trim(), draft);
      const result = await useAIJobStore.getState().runAIJob<string>(
        {
          scene: selectedScene,
          title: `生成提示词配置：${PROMPT_SCENE_LABELS[selectedScene]}`,
          resultPreview: (value) => value,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(35);
          const value = await window.electronAPI.callAI(prompt);
          throwIfCancelled();
          setProgress(85);
          return String(value || '');
        },
      );
      applyStructuredJsonText(result);
      setAiFillOpen(false);
    } catch (error: any) {
      if (isAIJobCancelledError(error)) {
        message.info('已取消 AI 生成');
      } else {
        message.error(error?.message || '\u5185\u7f6e AI \u751f\u6210\u5931\u8d25');
      }
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={7}>
            <Text strong>{'\u9009\u62e9\u63d0\u793a\u8bcd\u573a\u666f'}</Text>
            <Select value={selectedScene} options={SCENE_OPTIONS} onChange={(value: PromptScene) => setSelectedScene(value)} style={{ width: '100%', marginTop: 8 }} />
            <Text strong style={{ display: 'block', marginTop: 12 }}>适用项目阶段</Text>
            <Select
              value={selectedStageId}
              onChange={setSelectedStageId}
              style={{ width: '100%', marginTop: 8 }}
              options={[
                { value: 'common', label: '通用（所有阶段的默认版本）' },
                ...allStages.map(stage => ({ value: stage.id, label: stage.name })),
              ]}
            />
            {selectedStage && !exactTemplate && <Text type="secondary">当前继承通用版本，保存后将创建“{selectedStage.name}”专用提示词。</Text>}
          </Col>
          <Col xs={24} md={17}>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
              <Row>
                <Col span={4} style={{ padding: '10px 12px', background: '#fafafa' }}><Text type="secondary">{'\u7528\u9014'}</Text></Col>
                <Col span={20} style={{ padding: '10px 12px' }}>{sceneInfo.usage}</Col>
              </Row>
              <Row style={{ borderTop: '1px solid #f0f0f0' }}>
                <Col span={4} style={{ padding: '10px 12px', background: '#fafafa' }}><Text type="secondary">{'\u793a\u4f8b'}</Text></Col>
                <Col span={20} style={{ padding: '10px 12px' }}>{sceneInfo.example}</Col>
              </Row>
              <Row style={{ borderTop: '1px solid #f0f0f0' }}>
                <Col span={4} style={{ padding: '10px 12px', background: '#fafafa' }}><Text type="secondary">{'\u72b6\u6001'}</Text></Col>
                <Col span={20} style={{ padding: '10px 12px' }}>
                  <Space wrap>
                    <Tag color="blue">可编辑配置</Tag>
                    <Tag color={draft.mode === 'raw' ? 'orange' : 'green'}>{draft.mode === 'raw' ? '\u9ad8\u7ea7\u6e90\u7801\u6a21\u5f0f' : '\u53ef\u8bfb\u7ed3\u6784\u6a21\u5f0f'}</Tag>
                    {placeholders.map(key => <Tag key={key}>{`{{${key}}}`}</Tag>)}
                  </Space>
                </Col>
              </Row>
            </div>
          </Col>
        </Row>
      </Card>

      {draft.mode === 'raw' && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={'\u5f53\u524d\u6b63\u5728\u4f7f\u7528\u9ad8\u7ea7\u6e90\u7801\u6a21\u5f0f'} description={'\u666e\u901a\u7f16\u8f91\u533a\u7684\u53c2\u6570\u4e0d\u4f1a\u751f\u6210\u6700\u7ec8\u63d0\u793a\u8bcd\u3002'} />
      )}

      <Card
        title={<Space><Title level={5} style={{ margin: 0 }}>{'\u53ef\u8bfb\u7f16\u8f91'}</Title><Text type="secondary">{'\u628a prompt \u53c2\u6570\u62c6\u6210\u666e\u901a\u7528\u6237\u80fd\u770b\u61c2\u7684\u9879'}</Text></Space>}
        extra={(
          <Space wrap>
            <Button icon={<CopyOutlined />} onClick={() => void copyRuleTemplate()}>{'\u89c4\u5219\u6a21\u677f'}</Button>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>{'\u7c98\u8d34\u8bc6\u522b'}</Button>
            <Button icon={<RobotOutlined />} onClick={() => setAiFillOpen(true)}>{'AI \u81ea\u52a8\u586b\u5145'}</Button>
            <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>{'\u9884\u89c8\u6700\u7ec8\u63d0\u793a\u8bcd'}</Button>
            <Button icon={<WarningOutlined />} onClick={() => setSourceOpen(true)}>{'\u9ad8\u7ea7\uff1a\u6e90\u7801'}</Button>
            <Button icon={<UndoOutlined />} onClick={() => void restoreDefault()}>{'\u6062\u590d\u9ed8\u8ba4'}</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>{'\u4fdd\u5b58'}</Button>
          </Space>
        )}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card size="small" title={'1. AI \u7684\u89d2\u8272'}>
              <Input value={draft.role} onChange={event => updateDraft({ role: event.target.value })} placeholder={'\u4f8b\uff1a\u9879\u76ee\u62a5\u544a\u5199\u4f5c\u52a9\u624b'} />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>{'\u5b9a\u4e49 AI \u5728\u8fd9\u4e2a\u573a\u666f\u4e0b\u5e94\u8be5\u626e\u6f14\u4ec0\u4e48\u89d2\u8272\u3002'}</Text>
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card size="small" title={'2. AI \u8981\u5b8c\u6210\u4ec0\u4e48'} extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', goals: [...prev.goals, ''] }))}>{'\u6dfb\u52a0\u76ee\u6807'}</Button>}>
              {draft.goals.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {draft.goals.map((goal, index) => (
                    <Input key={`${index}-${draft.goals.length}`} value={goal} prefix={<Text type="secondary">{index + 1}</Text>} onChange={event => updateGoal(index, event.target.value)} addonAfter={<Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', goals: prev.goals.filter((_, goalIndex) => goalIndex !== index) }))} />} />
                  ))}
                </Space>
              )}
            </Card>
          </Col>
        </Row>

        <Card size="small" title={'3. AI \u5fc5\u987b\u9075\u5b88\u7684\u89c4\u5219'} extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', rules: [...prev.rules, { id: nextId('rule'), text: '', enabled: true, type: 'must' }] }))}>{'\u6dfb\u52a0\u89c4\u5219'}</Button>} style={{ marginTop: 16 }}>
          <List
            dataSource={draft.rules}
            locale={{ emptyText: '\u6682\u65e0\u89c4\u5219' }}
            renderItem={rule => (
              <List.Item
                style={{ alignItems: 'flex-start' }}
                actions={[<Tooltip title={rule.enabled ? '\u5df2\u542f\u7528' : '\u5df2\u505c\u7528'} key="switch"><Switch size="small" checked={rule.enabled} onChange={enabled => updateRule(rule.id, { enabled })} /></Tooltip>, <Button key="delete" type="text" danger icon={<DeleteOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', rules: prev.rules.filter(item => item.id !== rule.id) }))} />]}
              >
                <div style={{ display: 'flex', width: '100%', gap: 12, flexWrap: 'wrap' }}>
                  <Select value={rule.type} options={RULE_TYPE_OPTIONS} style={{ width: 140 }} onChange={(value: RuleType) => updateRule(rule.id, { type: value })} />
                  <Input
                    value={rule.text}
                    onChange={event => updateRule(rule.id, { text: event.target.value })}
                    placeholder={'\u8f93\u5165\u4e00\u6761\u89c4\u5219'}
                    style={{ flex: '1 1 520px', minWidth: 320 }}
                  />
                </div>
              </List.Item>
            )}
          />
        </Card>

        <Card size="small" title={'4. AI \u9700\u8981\u8f93\u51fa\u54ea\u4e9b\u5185\u5bb9'} extra={<Button size="small" icon={<PlusOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', outputFields: [...prev.outputFields, { key: createInternalOutputFieldKey(prev.outputFields), label: '', description: '' }] }))}>{'\u6dfb\u52a0\u8f93\u51fa\u9879'}</Button>} style={{ marginTop: 16 }}>
          <List
            dataSource={draft.outputFields}
            locale={{ emptyText: '\u6682\u65e0\u8f93\u51fa\u9879' }}
            renderItem={(field, index) => (
              <List.Item actions={[<Button key="delete" type="text" danger icon={<DeleteOutlined />} onClick={() => setDraft(prev => ({ ...prev, mode: 'structured', outputFields: prev.outputFields.filter((_, fieldIndex) => fieldIndex !== index) }))} />]}>
                <Row gutter={12} style={{ width: '100%' }}>
                  <Col xs={24} md={7}><Input value={field.label} onChange={event => updateField(index, { label: event.target.value })} placeholder={'\u8f93\u51fa\u9879\u540d\u79f0'} /></Col>
                  <Col xs={24} md={17}><Input value={field.description} onChange={event => updateField(index, { description: event.target.value })} placeholder={'\u8bf4\u660e\u8fd9\u4e2a\u8f93\u51fa\u9879\u5e94\u8be5\u5305\u542b\u4ec0\u4e48'} /></Col>
                </Row>
              </List.Item>
            )}
          />
        </Card>
      </Card>


      <Modal
        title={'\u7c98\u8d34\u8bc6\u522b\u63d0\u793a\u8bcd\u914d\u7f6e'}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => setImportOpen(false)}>{'\u53d6\u6d88'}</Button>,
          <Button key="import" type="primary" icon={<ImportOutlined />} onClick={importStructuredPrompt}>{'\u8bc6\u522b\u5e76\u586b\u5145'}</Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={'\u652f\u6301\u7c98\u8d34 JSON\uff0c\u4e5f\u652f\u6301\u5e26 ```json \u4ee3\u7801\u5757\u7684\u5185\u5bb9\u3002'}
        />
        <TextArea
          value={importText}
          onChange={event => setImportText(event.target.value)}
          placeholder={'\u628a\u5916\u90e8 AI \u751f\u6210\u7684 JSON \u7c98\u8d34\u5230\u8fd9\u91cc'}
          autoSize={{ minRows: 14, maxRows: 28 }}
        />
      </Modal>

      <Modal
        title={'AI \u81ea\u52a8\u586b\u5145\u63d0\u793a\u8bcd'}
        open={aiFillOpen}
        onCancel={() => setAiFillOpen(false)}
        width={760}
        footer={[
          <Button key="cancel" onClick={() => setAiFillOpen(false)}>{'\u53d6\u6d88'}</Button>,
          <Button key="generate" type="primary" icon={<RobotOutlined />} loading={aiGenerating} onClick={() => void generatePromptWithAI()}>{'\u751f\u6210\u5e76\u586b\u5145'}</Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={'\u8f93\u5165\u4f60\u5e0c\u671b\u8fd9\u4e2a\u573a\u666f\u7684 AI \u600e\u4e48\u5de5\u4f5c\uff0c\u7cfb\u7edf\u4f1a\u7528\u5185\u7f6e AI \u751f\u6210\u89d2\u8272\u3001\u76ee\u6807\u3001\u89c4\u5219\u548c\u8f93\u51fa\u9879\u3002'}
        />
        <TextArea
          value={aiRequirement}
          onChange={event => setAiRequirement(event.target.value)}
          placeholder={'\u4f8b\uff1a\u6211\u5e0c\u671b\u62a5\u544a\u751f\u6210\u66f4\u504f\u5411\u79d1\u7814\u9879\u76ee\uff0c\u8981\u5f3a\u8c03\u6280\u672f\u8def\u7ebf\u3001\u6750\u6599\u7f3a\u53e3\u548c\u4e0b\u4e00\u6b65\u4efb\u52a1\uff0c\u4e0d\u8981\u7a7a\u6cdb\u5957\u8bdd\u3002'}
          autoSize={{ minRows: 8, maxRows: 16 }}
        />
      </Modal>

      <Modal title={'\u9884\u89c8\u6700\u7ec8\u63d0\u793a\u8bcd'} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => setPreviewOpen(false)}>{'\u5173\u95ed'}</Button>} width={900}>
        <TextArea value={finalPrompt} autoSize={{ minRows: 16, maxRows: 28 }} readOnly />
      </Modal>

      <Modal
        title={'\u9ad8\u7ea7\uff1a\u6e90\u7801\u6a21\u5f0f'}
        open={sourceOpen}
        onCancel={() => setSourceOpen(false)}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => setSourceOpen(false)}>{'\u53d6\u6d88'}</Button>,
          <Button key="structured" onClick={() => { setSourceDraft(assembleStructuredPrompt({ ...draft, mode: 'structured' })); setDraft(prev => ({ ...prev, mode: 'structured' })); }}>{'\u7528\u5f53\u524d\u8868\u5355\u751f\u6210\u6e90\u7801'}</Button>,
          <Button key="save" type="primary" danger onClick={() => void saveRawMode()}>{'\u4fdd\u5b58\u4e3a\u6e90\u7801\u6a21\u5f0f'}</Button>,
        ]}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={'\u6e90\u7801\u6a21\u5f0f\u9002\u5408\u719f\u6089 prompt \u7684\u9ad8\u7ea7\u7528\u6237'} description={'\u4fdd\u5b58\u4e3a\u6e90\u7801\u6a21\u5f0f\u540e\uff0cAI \u5c06\u76f4\u63a5\u4f7f\u7528\u4e0b\u65b9\u6587\u672c\uff0c\u4e0d\u518d\u6309\u4e0a\u9762\u7684\u8868\u5355\u53c2\u6570\u91cd\u65b0\u7ec4\u88c5\u3002'} />
        <TextArea value={sourceDraft} onChange={event => setSourceDraft(event.target.value)} autoSize={{ minRows: 18, maxRows: 30 }} />
      </Modal>
    </div>
  );
};

export default PromptSettings;
