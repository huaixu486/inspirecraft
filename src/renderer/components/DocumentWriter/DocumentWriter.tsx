import React, { useEffect, useState, useMemo } from 'react';
import {
  Button, Card, Select, Typography, Space, Tag, Collapse, Input,
  Progress, message, Divider, Tooltip, Empty, Spin,
} from 'antd';
import {
  LeftOutlined, FileTextOutlined, DownloadOutlined, ImportOutlined,
  BookOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { ReferenceMaterial, StageMemoryEntry, WritingTemplate, TemplateNode, ProjectDocument } from '../../../shared/types';
import { composePrompt } from '../../utils/promptComposer';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const knowledgeText = {
  referenceMaterials: '\u53c2\u8003\u8d44\u6599',
  importReference: '\u5bfc\u5165\u53c2\u8003\u8d44\u6599',
  lowWeightHint: '\u4ec5\u4f5c\u4f4e\u6743\u91cd\u53c2\u8003\uff0c\u4e0d\u8986\u76d6\u6a21\u677f\u683c\u5f0f\u3001\u6a21\u677f\u8981\u6c42\u548c\u5f53\u524d\u9879\u76ee\u4e8b\u5b9e',
  learnFinal: '\u5b66\u4e60\u8be5\u9636\u6bb5\u7ec8\u7a3f',
  learning: '\u5b66\u4e60\u4e2d',
  memory: '\u9636\u6bb5\u8bb0\u5fc6',
  selectDocFirst: '\u8bf7\u5148\u9009\u62e9\u8981\u5b66\u4e60\u7684\u6587\u7a3f',
  selectTemplateFirst: '\u8bf7\u5148\u9009\u62e9\u6a21\u677f\u6216\u9636\u6bb5',
  learned: '\u5df2\u5b66\u4e60\u4e3a\u9636\u6bb5\u8bb0\u5fc6\uff0c\u540e\u7eed AI \u4f1a\u4f4e\u6743\u91cd\u53c2\u8003',
  learnFailed: '\u9636\u6bb5\u5b66\u4e60\u5931\u8d25',
  imported: '\u5df2\u52a0\u5165\u53c2\u8003\u8d44\u6599',
  importFailed: '\u53c2\u8003\u8d44\u6599\u5bfc\u5165\u5931\u8d25',
  noProjectReferences: '\u6682\u65e0\u9879\u76ee\u53c2\u8003\u8d44\u6599',
};

const normalizeStageNameForKnowledge = (value?: string) => String(value || '').trim().replace(/\s+/g, ' ') || 'unknown';

const formatKnowledgeItems = (items: Array<StageMemoryEntry | ReferenceMaterial>, type: 'memory' | 'reference') =>
  items
    .slice(0, 4)
    .map((item, index) => {
      const body = type === 'memory'
        ? (item as StageMemoryEntry).summary
        : ((item as ReferenceMaterial).summary || (item as ReferenceMaterial).contentPreview || '');
      const name = type === 'memory' ? (item as StageMemoryEntry).docName : (item as ReferenceMaterial).name;
      return String(index + 1) + '. ' + (name || 'item') + '\n' + String(body || '').slice(0, type === 'memory' ? 1200 : 1600);
    })
    .filter(Boolean)
    .join('\n\n');


interface Props {
  onBack?: () => void;
  focus?: import('../../../shared/types').WorkbenchFocus;
  hideHeader?: boolean;
}

type RewriteVariant = {
  id: string;
  modelName: string;
  ok: boolean;
  output: string;
  error?: string;
};

// 扁平化模板节点

const isLikelyGeneratedStructureNoise = (title = '') => {
  const stripped = String(title)
    .replace(/^第[一二三四五六七八九十百千万\d]+[章节部篇][\s　]*/, '')
    .replace(/^[一二三四五六七八九十百千万\d]+[、.．）)]\s*/, '')
    .replace(/^\d+(?:[.．-]\d+)*[、.．）)]?\s*/, '')
    .replace(/^[（(][一二三四五六七八九十百千万\d]+[）)]\s*/, '')
    .replace(/\s+/g, '');
  if (!stripped) return true;
  const lower = stripped.toLowerCase();
  const hasCjk = /[\u4e00-\u9fa5]/.test(lower);
  const unit = /(?:km\/h|m\/s|kn|mn|mpa|kpa|pa|kg|mm|cm|km|kv|ma|hz|min|ms|rpm|kw|db|n|g|t|m|v|a|s|h|w|%|deg|rad|°|℃|nm|Ω)/i;
  if (!hasCjk && /\d/.test(lower) && unit.test(lower)) return true;
  if (!hasCjk && /^[\d.+\-~～,，;；、:：/\\()[\]{}<>≤≥=×x*%°℃′'″"·a-zωΩ]+$/i.test(lower)) return true;
  return false;
};
const flattenNodes = (nodes: TemplateNode[] = [], depth = 0): (TemplateNode & { depth: number })[] =>
  nodes.flatMap(node => [
    { ...node, depth },
    ...flattenNodes(node.children || [], depth + 1),
  ]);

// 格式要求展示
const FormatBadge: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <Tag style={{ fontSize: 11, margin: '2px 4px 2px 0' }}>
      {label}: {value}
    </Tag>
  );
};

const DocumentWriter: React.FC<Props> = ({ onBack, focus, hideHeader = false }) => {
  const { currentProject, versions } = useProjectStore();
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc } = useProjectDocStore();
  const { stageMemories, referenceMaterials, loadKnowledge, learnStageFinal, importReferenceFiles } = useKnowledgeStore();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [sectionContents, setSectionContents] = useState<Record<string, string>>({});
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [rewritingNodeId, setRewritingNodeId] = useState<string | null>(null);
  const [rewriteVariants, setRewriteVariants] = useState<Record<string, RewriteVariant[]>>({});
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [learningStage, setLearningStage] = useState(false);

  useEffect(() => {
    if (currentProject) void loadKnowledge();
  }, [currentProject?.id, loadKnowledge]);

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const isExampleTemplate = selectedTemplate?.templateType === 'example';
  const currentStageName = useMemo(
    () => normalizeStageNameForKnowledge(selectedTemplate?.category || selectedTemplate?.name),
    [selectedTemplate?.category, selectedTemplate?.name],
  );

  const stageMemoryCandidates = useMemo(
    () => stageMemories
      .filter(item => normalizeStageNameForKnowledge(item.stageName) === currentStageName)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()),
    [stageMemories, currentStageName],
  );

  const projectReferenceMaterials = useMemo(
    () => currentProject ? referenceMaterials.filter(item => item.projectId === currentProject.id) : [],
    [currentProject?.id, referenceMaterials],
  );

  const selectedReferenceMaterials = useMemo(
    () => projectReferenceMaterials.filter(item => selectedReferenceIds.includes(item.id)),
    [projectReferenceMaterials, selectedReferenceIds],
  );

  const flatNodes = useMemo(() => {
    const nodes = flattenNodes(selectedTemplate?.nodes)
      .filter(node => !isLikelyGeneratedStructureNoise(node.title));
    if (selectedTemplate?.templateType === 'example') {
      return nodes.filter(node => (node.level || 1) <= 1);
    }
    return nodes;
  }, [selectedTemplate?.nodes, selectedTemplate?.templateType]);

  // 可选的项目文档列表
  const projectDocsList = useMemo(
    () => currentProject ? projectDocs.filter(d => d.projectId === currentProject.id) : [],
    [currentProject, projectDocs],
  );

  // 加载文稿内容到对应章节
  const handleImportDoc = async (docId: string) => {
    setSelectedDocId(docId);
    const doc = projectDocsList.find(d => d.id === docId);
    if (!doc) return;

    const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
    let content = version?.content || '';

    // 尝试从源文件读取
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) {
          content = parsed.content.trim();
        }
      } catch {}
    }

    if (!content) {
      message.warning('该文档暂无文本内容');
      return;
    }

    // 按标题匹配填充到章节
    if (selectedTemplate?.nodes) {
      const newContents = { ...sectionContents };
      const lines = content.split('\n');
      let currentNodeId: string | null = null;
      let currentContent: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // 检查是否是标题行
        const matchedNode = flatNodes.find(node => {
          const title = node.title.replace(/^[\d一二三四五六七八九十百千万]+[、.．）)]\s*/, '').trim();
          return trimmed.includes(title) || title.includes(trimmed);
        });

        if (matchedNode) {
          // 保存上一个章节的内容
          if (currentNodeId && currentContent.length > 0) {
            newContents[currentNodeId] = currentContent.join('\n').trim();
          }
          currentNodeId = matchedNode.id;
          currentContent = [];
        } else if (currentNodeId && trimmed) {
          currentContent.push(line);
        }
      }
      // 保存最后一个章节
      if (currentNodeId && currentContent.length > 0) {
        newContents[currentNodeId] = currentContent.join('\n').trim();
      }

      setSectionContents(newContents);
      message.success('文稿内容已填充到对应章节');
    }
  };

  // 更新章节内容
  const handleImportReferenceFiles = async () => {
    if (!currentProject) return;
    try {
      const filePaths = await window.electronAPI.openFiles?.([{ name: 'Reference files', extensions: ['doc', 'docx', 'pdf', 'txt', 'md', 'pptx', 'xlsx', 'rtf'] }]);
      if (!filePaths?.length) return;
      const materials = await importReferenceFiles(currentProject.id, filePaths, 'external');
      if (materials.length) {
        setSelectedReferenceIds(prev => Array.from(new Set([...prev, ...materials.map(item => item.id)])));
        message.success(knowledgeText.imported + ' ' + materials.length);
      }
    } catch (error: any) {
      message.error(knowledgeText.importFailed + ': ' + (error.message || error));
    }
  };

  const handleLearnCurrentDocAsMemory = async () => {
    if (!currentProject) return;
    if (!selectedTemplate) { message.warning(knowledgeText.selectTemplateFirst); return; }
    const doc = projectDocsList.find(d => d.id === selectedDocId);
    if (!doc) { message.warning(knowledgeText.selectDocFirst); return; }
    setLearningStage(true);
    try {
      const version = doc.versionId ? versions.find(v => v.id === doc.versionId) : undefined;
      const entry = await learnStageFinal({
        projectId: currentProject.id,
        projectName: currentProject.name,
        stageName: currentStageName,
        docId: doc.id,
        docName: doc.name,
        sourceFilePath: doc.sourceFilePath,
        content: version?.content,
      });
      if (entry) message.success(knowledgeText.learned);
      else message.error(knowledgeText.learnFailed);
    } catch (error: any) {
      message.error(knowledgeText.learnFailed + ': ' + (error.message || error));
    } finally {
      setLearningStage(false);
    }
  };
  const handleContentChange = (nodeId: string, value: string) => {
    setSectionContents(prev => ({ ...prev, [nodeId]: value }));
  };

  // 切换展开/折叠

  const handleGenerateRewrite = async (node: TemplateNode & { depth: number }) => {
    const currentContent = sectionContents[node.id] || '';
    setRewritingNodeId(node.id);
    try {
      const aiConfig = await window.electronAPI.loadAIConfig();
      const prompt = composePrompt('rewrite', {
        sectionTitle: node.title,
        requirement: node.requirementText || node.description || 'None',
        example: node.exampleText || 'None',
        stageMemory: formatKnowledgeItems(stageMemoryCandidates, 'memory') || 'None',
        reference: formatKnowledgeItems(selectedReferenceMaterials, 'reference') || 'None',
        currentContent: currentContent || 'This section is empty. Please draft a body based on the section requirements.',
      });
      const useParallel = aiConfig?.multiModelMode === 'parallel' && (aiConfig.parallelModelIds?.length || 0) > 1 && window.electronAPI.callAIParallelDetails;
      if (useParallel) {
        const details = await useAIJobStore.getState().runAIJob<{ variants: Array<{ modelId: string; modelName: string; ok: boolean; output: string; error?: string }> }>(
          {
            scene: 'rewrite',
            title: `改写章节：${node.title}`,
            projectId: currentProject?.id,
            resultPreview: () => '已生成多个改写版本',
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAIParallelDetails({ prompt, config: aiConfig, modelIds: aiConfig.parallelModelIds, modelId: aiConfig.activeModelId });
            throwIfCancelled();
            setProgress(85);
            return value;
          },
        );
        setRewriteVariants(prev => ({
          ...prev,
          [node.id]: details.variants.map((variant, index) => ({
            id: `${variant.modelId}-${index}`,
            modelName: variant.modelName,
            ok: variant.ok,
            output: variant.output,
            error: variant.error,
          })),
        }));
      } else {
        const output = await useAIJobStore.getState().runAIJob<string>(
          {
            scene: 'rewrite',
            title: `改写章节：${node.title}`,
            projectId: currentProject?.id,
            resultPreview: (value) => value,
          },
          async ({ setProgress, throwIfCancelled }) => {
            setProgress(35);
            const value = await window.electronAPI.callAI({ prompt });
            throwIfCancelled();
            setProgress(85);
            return String(value || '');
          },
        );
        setRewriteVariants(prev => ({ ...prev, [node.id]: [{ id: 'single', modelName: 'AI\u7248\u672c', ok: true, output }] }));
      }
      message.success('\u5df2\u751f\u6210\u6539\u5199\u7248\u672c\uff0c\u8bf7\u9009\u62e9\u91c7\u7528');
    } catch (error: any) {
      message.error(`AI\u6539\u5199\u5931\u8d25\uff1a${error.message}`);
    } finally {
      setRewritingNodeId(null);
    }
  };

  const handleApplyRewriteVariant = (nodeId: string, variant: RewriteVariant) => {
    if (!variant.ok || !variant.output.trim()) return;
    setSectionContents(prev => ({ ...prev, [nodeId]: variant.output.trim() }));
    message.success('\u5df2\u91c7\u7528\u8be5\u7248\u672c\uff0c\u5bfc\u51fa\u65f6\u4f1a\u7ee7\u7eed\u4f7f\u7528\u6a21\u677f\u683c\u5f0f\u89c4\u5219');
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // 统计完成度
  const completedCount = flatNodes.filter(n => sectionContents[n.id]?.trim()).length;
  const progressPercent = flatNodes.length > 0 ? Math.round((completedCount / flatNodes.length) * 100) : 0;

  // 导出 Word
  const handleExport = async () => {
    if (!selectedTemplate || !currentProject) {
      message.warning('请先选择模板');
      return;
    }
    setExporting(true);
    try {
      const result = await window.electronAPI.generateFromContent({
        template: selectedTemplate,
        sectionContents,
        folderPath: currentProject.folderPath,
        fileName: `${currentProject.name}-${selectedTemplate.name}`,
      });
      if (result.success) {
        message.success(`文档已导出：${result.filePath}`);
        // 打开文件所在位置
        if (result.filePath) {
          await window.electronAPI.openInExplorer(result.filePath);
        }
      } else {
        message.error(result.error || '导出失败');
      }
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!currentProject) {
    return <Empty description="请先选择一个项目" />;
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      {!hideHeader && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
            <Title level={4} style={{ margin: 0 }}>智能写作</Title>
          </div>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>
            选择模板，导入文稿参考，按章节编写内容并导出格式化文档
          </Text>
        </div>
      </div>}

      {/* 选择模板和文稿 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={12} style={{ width: '100%' }}>
          <div style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>选择模板</Text>
            <Select
              placeholder="选择写作模板"
              style={{ width: '100%' }}
              value={selectedTemplateId || undefined}
              onChange={(v) => { setSelectedTemplateId(v); setSectionContents({}); }}
              options={templates.map(t => ({
                value: t.id,
                label: `${t.name} (${t.category})`,
              }))}
            />
          </div>
          <div style={{ minWidth: 200 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>导入文稿参考</Text>
            <Select
              placeholder="选择已有文档导入"
              style={{ width: '100%' }}
              value={selectedDocId || undefined}
              onChange={handleImportDoc}
              allowClear
              onClear={() => setSelectedDocId('')}
              options={projectDocsList.map(d => ({
                value: d.id,
                label: d.name,
              }))}
            />
          </div>
          <div style={{ minWidth: 280, flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{knowledgeText.referenceMaterials}</Text>
            <Select
              mode="multiple"
              placeholder={knowledgeText.noProjectReferences}
              style={{ width: '100%' }}
              value={selectedReferenceIds}
              onChange={setSelectedReferenceIds}
              maxTagCount="responsive"
              options={projectReferenceMaterials.map(item => ({ value: item.id, label: item.name }))}
            />
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>{knowledgeText.lowWeightHint}</Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <Button icon={<ImportOutlined />} onClick={handleImportReferenceFiles}>
              {knowledgeText.importReference}
            </Button>
            <Button icon={<BookOutlined />} onClick={handleLearnCurrentDocAsMemory} loading={learningStage} disabled={!selectedTemplate || !selectedDocId}>
              {learningStage ? knowledgeText.learning : knowledgeText.learnFinal}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting} disabled={!selectedTemplate}>
              ?? Word
            </Button>
          </div>
        </Space>
      </Card>

      {/* 主体内容 */}
      {selectedTemplate ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
          {/* 左侧：章节编辑区 */}
          <div>
            {flatNodes.length > 0 ? (
              flatNodes.map(node => {
                const isExpanded = expandedNodes.has(node.id);
                const hasContent = Boolean(sectionContents[node.id]?.trim());
                const indent = node.depth * 16;
                return (
                  <div
                    key={node.id}
                    style={{
                      marginBottom: 12,
                      marginLeft: indent,
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      background: hasContent ? '#f0f9ff' : '#fff',
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                  >
                    {/* 章节标题行 */}
                    <div
                      onClick={() => toggleNode(node.id)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        borderBottom: isExpanded ? '1px solid #f0f0f0' : 'none',
                      }}
                    >
                      {hasContent ? (
                        <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
                      ) : (
                        <ClockCircleOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />
                      )}
                      <Text strong style={{ fontSize: 13, flex: 1 }}>{node.title}</Text>
                      {node.isRequired && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>必需</Tag>}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {isExpanded ? '收起' : '展开'}
                      </Text>
                    </div>

                    {/* 展开内容 */}
                    {isExpanded && (
                      <div style={{ padding: '10px 14px' }}>
                        {/* 格式要求 */}
                        {(node.fontRequirement || node.paragraphRequirement) && (
                          <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>格式要求</Text>
                            <Space wrap size={4}>
                              <FormatBadge label="字体" value={node.fontRequirement?.fontFamily} />
                              <FormatBadge label="字号" value={node.fontRequirement?.fontSize ? `${node.fontRequirement.fontSize}pt` : undefined} />
                              <FormatBadge label="行距" value={node.fontRequirement?.lineHeight ? `${node.fontRequirement.lineHeight}` : undefined} />
                              <FormatBadge label="加粗" value={node.fontRequirement?.fontWeight === 'bold' ? '是' : undefined} />
                              <FormatBadge label="首行缩进" value={node.paragraphRequirement?.indentFirstLine ? `${node.paragraphRequirement.indentFirstLine}字符` : undefined} />
                            </Space>
                          </div>
                        )}

                        {/* 写作参考/写作要求 */}
                        {(node.description || node.requirementText) && (
                          <div style={{ marginBottom: 10, padding: '8px 10px', background: isExampleTemplate ? '#f6ffed' : '#fff7e6', borderRadius: 6, borderLeft: `3px solid ${isExampleTemplate ? '#52c41a' : '#faad14'}` }}>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>{isExampleTemplate ? '写作参考' : '写作要求'}</Text>
                            {node.description && <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{node.description}</Text>}
                            {node.requirementText && <Text style={{ fontSize: 12, color: '#666' }}>{node.requirementText}</Text>}
                          </div>
                        )}

                        {/* 范文参考 */}
                        {node.exampleText && (
                          <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f6ffed', borderRadius: 6, borderLeft: '3px solid #52c41a' }}>
                            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>范文参考</Text>
                            <Text style={{ fontSize: 12, color: '#555' }}>{node.exampleText}</Text>
                          </div>
                        )}

                        {/* 编辑区 */}
                        <TextArea
                          value={sectionContents[node.id] || ''}
                          onChange={(e) => handleContentChange(node.id, e.target.value)}
                          placeholder={`在此编写「${node.title}」的内容...`}
                          autoSize={{ minRows: 4, maxRows: 20 }}
                          style={{ fontSize: 13 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                          {(sectionContents[node.id] || '').length} 字{isExampleTemplate && <Text type="secondary" style={{ fontSize: 10 }}> (参考)</Text>}
                        </Text>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <Empty description="该模板暂无章节结构" />
            )}
          </div>

          {/* 右侧：格式预览和统计 */}
          <div>
            <Card size="small" title="文档信息" style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>模板</Text>
                <div><Text strong>{selectedTemplate.name}</Text></div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>分类</Text>
                <div><Tag>{selectedTemplate.category}</Tag></div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>输出格式</Text>
                <div><Tag color="blue">{(selectedTemplate.outputFileType || 'docx').toUpperCase()}</Tag></div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{knowledgeText.memory}</Text>
                <div>
                  <Tag color="purple">{stageMemoryCandidates.length}</Tag>
                  <Tag color="geekblue">{selectedReferenceMaterials.length}</Tag>
                </div>
              </div>              <Divider style={{ margin: '8px 0' }} />
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>完成度</Text>
                <Progress percent={progressPercent} size="small" style={{ marginTop: 4 }} />
                <Text style={{ fontSize: 11 }}>{completedCount}/{flatNodes.length} 章节已完成</Text>
              </div>
            </Card>

            <Card size="small" title="格式规范">
              {selectedTemplate.formatRules ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(selectedTemplate.formatRules).map(([key, rule]) => (
                    <div key={key} style={{ padding: '6px 8px', background: '#f6f8fa', borderRadius: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                      </Text>
                      <Space wrap size={2}>
                        <FormatBadge label="字体" value={rule.fontRequirement?.fontFamily} />
                        <FormatBadge label="字号" value={rule.fontRequirement?.fontSize ? `${rule.fontRequirement.fontSize}pt` : undefined} />
                        <FormatBadge label="行距" value={rule.fontRequirement?.lineHeight ? `${rule.fontRequirement.lineHeight}` : undefined} />
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>暂无格式规范</Text>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <Empty description="请先选择一个模板开始编写" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );
};

export default DocumentWriter;
