import React, { useEffect, useMemo, useState, useDeferredValue } from 'react';
import { Alert, Button, Card, Empty, List, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, RobotOutlined, SwapOutlined } from '@ant-design/icons';
import { DocumentVersion, ProjectDocument } from '../../../shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { composePromptAsync } from '../../utils/promptComposer';

const { Paragraph, Text, Title } = Typography;

type DifferenceKind = 'content' | 'structure' | 'format' | 'metadata';
type DifferenceSeverity = 'high' | 'medium' | 'low';
type ComparableSource = 'project-doc' | 'version' | 'project-file';

interface ScannedStageFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
}

interface ComparableDocument {
  id: string;
  projectId: string;
  source: ComparableSource;
  docId?: string;
  versionId?: string;
  fileName: string;
  filePath: string;
  fileType: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  progress?: number;
  hasLinkedVersion: boolean;
}

interface DifferenceItem {
  id: string;
  kind: DifferenceKind;
  severity: DifferenceSeverity;
  title: string;
  detail: string;
  before?: string;
  after?: string;
}

const kindMeta: Record<DifferenceKind, { label: string; color: string }> = {
  content: { label: '内容', color: 'blue' },
  structure: { label: '结构', color: 'purple' },
  format: { label: '格式/形态', color: 'orange' },
  metadata: { label: '文件信息', color: 'default' },
};

const severityMeta: Record<DifferenceSeverity, { label: string; color: string }> = {
  high: { label: '明显差异', color: 'red' },
  medium: { label: '一般差异', color: 'gold' },
  low: { label: '轻微差异', color: 'green' },
};

const comparableExts = new Set(['.doc', '.docx', '.pdf', '.txt', '.md', '.rtf', '.ppt', '.pptx', '.xls', '.xlsx']);

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const getBaseName = (filePath = '') => filePath.split(/[\\/]/).pop() || filePath;
const normalizePathKey = (value = '') => value.trim().toLowerCase();

const getFileExt = (value?: { fileName?: string; filePath?: string; fileType?: string }) => {
  const source = value?.fileName || value?.filePath || '';
  const ext = source.includes('.') ? source.split('.').pop() : value?.fileType;
  return String(ext || '').toLowerCase();
};

const inferFileType = (fileName = '', filePath = '') => {
  const ext = getFileExt({ fileName, filePath });
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'rtf'].includes(ext)) return 'txt';
  if (ext) return ext;
  return 'docx';
};

const normalizeText = (value = '') => value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
const getLines = (value = '') => normalizeText(value).split(/\n+/).map(line => line.trim()).filter(Boolean);
const getParagraphs = (value = '') => normalizeText(value).split(/\n\s*\n|\n+/).map(line => line.trim()).filter(Boolean);
const getHeadings = (value = '') => getLines(value).filter(line => /^(第[一二三四五六七八九十百千万\d]+[章节部分]|[一二三四五六七八九十\d]+[、.．]|#{1,6}\s+)/.test(line));
const countWords = (value = '') => {
  const text = normalizeText(value);
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  return chinese + words;
};

const buildStats = (version?: ComparableDocument) => {
  const content = version?.content || '';
  const paragraphs = getParagraphs(content);
  const headings = getHeadings(content);
  const words = countWords(content);
  return {
    ext: getFileExt(version),
    fileType: version?.fileType || '',
    words,
    paragraphs: paragraphs.length,
    headings: headings.length,
    avgParagraphLength: paragraphs.length ? Math.round(words / paragraphs.length) : 0,
    empty: normalizeText(content).length === 0,
  };
};

const sourceLabel = (source: ComparableSource) => {
  if (source === 'project-doc') return '项目文档';
  if (source === 'project-file') return '项目文件';
  return '版本记录';
};

const pushIfDifferent = (
  list: DifferenceItem[],
  kind: DifferenceKind,
  title: string,
  before: string | number | undefined,
  after: string | number | undefined,
  detail: string,
  severity: DifferenceSeverity = 'medium',
) => {
  if (String(before ?? '') === String(after ?? '')) return;
  list.push({
    id: `${kind}-${title}-${list.length}`,
    kind,
    severity,
    title,
    detail,
    before: String(before ?? '-'),
    after: String(after ?? '-'),
  });
};

const sampleDifferentLines = (baseLines: string[], targetLines: string[], limit = 6) => {
  const targetSet = new Set(targetLines);
  return baseLines.filter(line => !targetSet.has(line)).slice(0, limit);
};

const getDocumentVersion = (doc: ProjectDocument, projectVersions: DocumentVersion[]) => {
  if (doc.versionId) {
    const byId = projectVersions.find(version => version.id === doc.versionId);
    if (byId) return byId;
  }
  return projectVersions.find(version =>
    Boolean(doc.sourceFilePath && version.filePath === doc.sourceFilePath) ||
    version.fileName === doc.name
  );
};

const buildComparableDocuments = (
  projectId: string,
  versions: DocumentVersion[],
  projectDocs: ProjectDocument[],
  scannedFiles: ScannedStageFile[],
  parsedContentById: Record<string, string>,
): ComparableDocument[] => {
  const projectVersions = versions.filter(version => version.projectId === projectId);
  const projectDocuments = projectDocs.filter(doc => doc.projectId === projectId);
  const usedVersionIds = new Set<string>();
  const usedFilePaths = new Set<string>();

  const docItems = projectDocuments.map(doc => {
    const linkedVersion = getDocumentVersion(doc, projectVersions);
    if (linkedVersion) usedVersionIds.add(linkedVersion.id);
    const id = `doc:${doc.id}`;
    const filePath = doc.sourceFilePath || linkedVersion?.filePath || '';
    if (filePath) usedFilePaths.add(normalizePathKey(filePath));
    const fileName = linkedVersion?.fileName || getBaseName(filePath) || doc.name || '未命名文档';
    return {
      id,
      projectId,
      source: 'project-doc' as const,
      docId: doc.id,
      versionId: linkedVersion?.id || doc.versionId,
      fileName,
      filePath,
      fileType: inferFileType(fileName, filePath || linkedVersion?.filePath),
      content: parsedContentById[id] || linkedVersion?.content || '',
      createdAt: doc.sourceFileCreatedAt || linkedVersion?.createdAt || doc.createdAt,
      updatedAt: doc.sourceFileModifiedAt || doc.analyzedAt || linkedVersion?.createdAt || doc.createdAt,
      progress: doc.overallProgress,
      hasLinkedVersion: Boolean(linkedVersion),
    };
  });

  const versionItems = projectVersions
    .filter(version => !usedVersionIds.has(version.id))
    .map(version => {
      const id = `version:${version.id}`;
      if (version.filePath) usedFilePaths.add(normalizePathKey(version.filePath));
      return {
        id,
        projectId,
        source: 'version' as const,
        versionId: version.id,
        fileName: version.fileName || getBaseName(version.filePath) || '未命名版本',
        filePath: version.filePath || '',
        fileType: version.fileType || inferFileType(version.fileName, version.filePath),
        content: parsedContentById[id] || version.content || '',
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
        hasLinkedVersion: true,
      };
    });

  const fileItems = scannedFiles
    .filter(file => comparableExts.has(String(file.ext || '').toLowerCase()))
    .filter(file => !usedFilePaths.has(normalizePathKey(file.path)))
    .map(file => {
      const id = `file:${file.path}`;
      return {
        id,
        projectId,
        source: 'project-file' as const,
        fileName: file.name || getBaseName(file.path) || '未命名文件',
        filePath: file.path,
        fileType: inferFileType(file.name, file.path),
        content: parsedContentById[id] || '',
        createdAt: file.createdAt,
        updatedAt: file.modifiedAt || file.createdAt,
        hasLinkedVersion: false,
      };
    });

  return [...docItems, ...versionItems, ...fileItems].sort((a, b) => {
    const bTime = new Date(b.updatedAt || b.createdAt).getTime();
    const aTime = new Date(a.updatedAt || a.createdAt).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
};

const buildDifferences = (versionA?: ComparableDocument, versionB?: ComparableDocument): DifferenceItem[] => {
  if (!versionA || !versionB) return [];
  const differences: DifferenceItem[] = [];
  const statsA = buildStats(versionA);
  const statsB = buildStats(versionB);

  pushIfDifferent(differences, 'metadata', '文件名不同', versionA.fileName, versionB.fileName, '两个版本的文件名不同，可能来自不同阶段或不同交付物。', 'low');
  pushIfDifferent(differences, 'metadata', '来源记录不同', sourceLabel(versionA.source), sourceLabel(versionB.source), '两个对象来自不同记录体系，一个可能是阶段文档、项目文件或手动导入版本。', 'low');
  pushIfDifferent(differences, 'format', '文件类型不同', statsA.ext || statsA.fileType, statsB.ext || statsB.fileType, '文件扩展名或解析类型不同，可能影响版式、分页、图片和表格保真度。', 'high');

  if (statsA.empty || statsB.empty) {
    differences.push({
      id: 'metadata-content-readiness',
      kind: 'metadata',
      severity: 'medium',
      title: '文本内容未完全就绪',
      detail: '至少一个文档暂时没有解析出的正文，因此当前只能对文件信息、类型和可用文本做有限对比。',
      before: statsA.empty ? '未解析到正文' : '已有正文',
      after: statsB.empty ? '未解析到正文' : '已有正文',
    });
    return differences;
  }

  const wordDelta = statsB.words - statsA.words;
  if (wordDelta !== 0) {
    differences.push({
      id: 'content-word-count',
      kind: 'content',
      severity: Math.abs(wordDelta) > 300 ? 'high' : Math.abs(wordDelta) > 80 ? 'medium' : 'low',
      title: '正文长度变化',
      detail: `B 相比 A ${wordDelta > 0 ? '增加' : '减少'} ${Math.abs(wordDelta)} 个字/词。`,
      before: `${statsA.words}`,
      after: `${statsB.words}`,
    });
  }

  pushIfDifferent(differences, 'structure', '段落数量不同', statsA.paragraphs, statsB.paragraphs, '段落数量变化，可能表示章节拆分、合并或正文增删。', Math.abs(statsB.paragraphs - statsA.paragraphs) > 5 ? 'medium' : 'low');
  pushIfDifferent(differences, 'structure', '疑似标题数量不同', statsA.headings, statsB.headings, '标题数量变化，可能表示目录结构或章节层级发生调整。', Math.abs(statsB.headings - statsA.headings) > 2 ? 'medium' : 'low');
  pushIfDifferent(differences, 'format', '平均段落长度不同', statsA.avgParagraphLength, statsB.avgParagraphLength, '平均段落长度变化，可能反映排版密度、段落拆分方式或表达详略变化。', Math.abs(statsB.avgParagraphLength - statsA.avgParagraphLength) > 80 ? 'medium' : 'low');

  const linesA = getLines(versionA.content);
  const linesB = getLines(versionB.content);
  sampleDifferentLines(linesA, linesB).forEach((line, index) => {
    differences.push({
      id: `removed-${index}`,
      kind: 'content',
      severity: 'medium',
      title: 'A 中存在但 B 中未找到',
      detail: '这段内容在 B 版本中没有找到完全一致的文本。',
      before: line,
      after: '',
    });
  });
  sampleDifferentLines(linesB, linesA).forEach((line, index) => {
    differences.push({
      id: `added-${index}`,
      kind: 'content',
      severity: 'medium',
      title: 'B 中新增或改写内容',
      detail: '这段内容在 A 版本中没有找到完全一致的文本。',
      before: '',
      after: line,
    });
  });

  return differences;
};

const buildAiPrompt = async (versionA: ComparableDocument, versionB: ComparableDocument, differences: DifferenceItem[]) => {
  const diffText = differences.slice(0, 30).map((item, index) => [
    `${index + 1}. [${kindMeta[item.kind].label}/${severityMeta[item.severity].label}] ${item.title}`,
    item.detail,
    item.before ? `A: ${item.before}` : '',
    item.after ? `B: ${item.after}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return composePromptAsync('diff', {
    versionAName: `${versionA.fileName}，时间：${formatDate(versionA.updatedAt || versionA.createdAt)}`,
    contentA: diffText || '未发现明显差异。',
    versionBName: `${versionB.fileName}，时间：${formatDate(versionB.updatedAt || versionB.createdAt)}`,
    contentB: '',
  });
};

const VersionCompareViewer: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { currentProject, versions, loadVersions } = useProjectStore();
  const { projectDocs, loadProjectDocs } = useProjectDocStore();
  const [versionAId, setVersionAId] = useState<string>();
  const [versionBId, setVersionBId] = useState<string>();
  const [scannedFiles, setScannedFiles] = useState<ScannedStageFile[]>([]);
  const [scanningFiles, setScanningFiles] = useState(false);
  const [parsedContentById, setParsedContentById] = useState<Record<string, string>>({});
  const [parsingIds, setParsingIds] = useState<Record<string, boolean>>({});
  const [aiComment, setAiComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (versions.length === 0) void loadVersions();
    if (projectDocs.length === 0) void loadProjectDocs();
  }, [loadProjectDocs, loadVersions, projectDocs.length, versions.length]);

  const loadScannedProjectFiles = async () => {
    if (!currentProject?.folderPath) {
      setScannedFiles([]);
      return;
    }
    setScanningFiles(true);
    try {
      const result = await window.electronAPI.scanStageFiles(currentProject.folderPath);
      setScannedFiles(result.success ? result.files || [] : []);
      if (!result.success && result.error) console.warn('Failed to scan compare files:', result.error);
    } catch (error) {
      console.warn('Failed to scan compare files:', error);
      setScannedFiles([]);
    } finally {
      setScanningFiles(false);
    }
  };

  useEffect(() => {
    void loadScannedProjectFiles();
  }, [currentProject?.id, currentProject?.folderPath]);

  const comparableDocuments = useMemo(() => {
    if (!currentProject) return [];
    return buildComparableDocuments(currentProject.id, versions, projectDocs, scannedFiles, parsedContentById);
  }, [currentProject?.id, parsedContentById, projectDocs, scannedFiles, versions]);

  useEffect(() => {
    const ids = new Set(comparableDocuments.map(version => version.id));
    const nextA = versionAId && ids.has(versionAId) ? versionAId : comparableDocuments[0]?.id;
    const nextB = versionBId && ids.has(versionBId) && versionBId !== nextA
      ? versionBId
      : comparableDocuments.find(version => version.id !== nextA)?.id;
    if (nextA !== versionAId) setVersionAId(nextA);
    if (nextB !== versionBId) setVersionBId(nextB);
    setAiComment('');
  }, [currentProject?.id, comparableDocuments.length]);

  const versionA = comparableDocuments.find(version => version.id === versionAId);
  const versionB = comparableDocuments.find(version => version.id === versionBId);
  const deferredVersionA = useDeferredValue(versionA);
  const deferredVersionB = useDeferredValue(versionB);
  const differences = useMemo(() => buildDifferences(deferredVersionA, deferredVersionB), [deferredVersionA, deferredVersionB]);

  const ensureParsedContent = async (doc?: ComparableDocument) => {
    if (!doc || doc.content || !doc.filePath || parsedContentById[doc.id] || parsingIds[doc.id]) return;
    setParsingIds(prev => ({ ...prev, [doc.id]: true }));
    try {
      const parser = window.electronAPI.parseDocumentSilent || window.electronAPI.parseDocument;
      const parsed = await parser(doc.filePath);
      let content = parsed.success ? parsed.content?.trim() || '' : '';
      if (!content && ['txt', 'md'].includes(getFileExt(doc))) {
        content = (await window.electronAPI.readFile(doc.filePath)).trim();
      }
      if (content) {
        setParsedContentById(prev => ({ ...prev, [doc.id]: content }));
      }
    } catch (error) {
      console.warn('Failed to parse compare document:', error);
    } finally {
      setParsingIds(prev => ({ ...prev, [doc.id]: false }));
    }
  };

  useEffect(() => {
    void ensureParsedContent(versionA);
    void ensureParsedContent(versionB);
  }, [versionAId, versionBId, versionA?.filePath, versionB?.filePath]);

  const selectOptions = comparableDocuments.map(doc => {
    const contentLabel = doc.content ? '已解析' : doc.filePath ? '可解析' : '无文件路径';
    const progressLabel = typeof doc.progress === 'number' ? ` · 进度 ${doc.progress}%` : '';
    return {
      value: doc.id,
      label: `${doc.fileName} · ${formatDate(doc.updatedAt || doc.createdAt)} · ${sourceLabel(doc.source)} · ${contentLabel}${progressLabel}`,
    };
  });

  const isParsingSelected = Boolean((versionAId && parsingIds[versionAId]) || (versionBId && parsingIds[versionBId]));

  const handleRefresh = async () => {
    setAiComment('');
    await Promise.all([loadVersions(), loadProjectDocs(), loadScannedProjectFiles()]);
  };

  const handleSwap = () => {
    setVersionAId(versionBId);
    setVersionBId(versionAId);
    setAiComment('');
  };

  const handleAiComment = async () => {
    if (!versionA || !versionB) return;
    setAiLoading(true);
    setAiComment('');
    try {
      const result = await useAIJobStore.getState().runAIJob<string>(
        {
          scene: 'diff',
          title: '生成 AI 对比评语',
          resultPreview: (value) => value,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(35);
          const prompt = await buildAiPrompt(versionA, versionB, differences);
          const value = await window.electronAPI.callAI(prompt);
          throwIfCancelled();
          setProgress(85);
          return String(value || '');
        },
      );
      setAiComment(result || 'AI 未返回评语。');
    } catch (error: any) {
      if (isAIJobCancelledError(error)) {
        message.info('已取消 AI 对比评语');
      } else {
        message.error(error?.message || 'AI 对比评语生成失败');
      }
    } finally {
      setAiLoading(false);
    }
  };

  if (!currentProject) {
    return <Empty description="请先选择一个项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Space size={10}>
          {onBack && <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} />}
          <Title level={4} style={{ margin: 0 }}>版本对比 · {currentProject.name}</Title>
          <Tag color="blue">{comparableDocuments.length} 个可对比文档</Tag>
          {(isParsingSelected || scanningFiles) && <Spin size="small" />}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新文档</Button>
      </div>

      <Card styles={{ body: { padding: 14 } }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto minmax(240px, 1fr)', gap: 12, alignItems: 'end' }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>版本 A</Text>
            <Select
              showSearch
              allowClear
              placeholder="选择第一个版本/文件"
              value={versionAId}
              onChange={(value) => { setVersionAId(value); setAiComment(''); }}
              options={selectOptions}
              optionFilterProp="label"
              style={{ width: '100%' }}
            />
          </div>
          <Button icon={<SwapOutlined />} onClick={handleSwap} disabled={!versionA || !versionB} />
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>版本 B</Text>
            <Select
              showSearch
              allowClear
              placeholder="选择第二个版本/文件"
              value={versionBId}
              onChange={(value) => { setVersionBId(value); setAiComment(''); }}
              options={selectOptions}
              optionFilterProp="label"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Card>

      {comparableDocuments.length < 2 ? (
        <Empty description="当前项目至少需要两个版本、项目文档或项目文件才能对比" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : !versionA || !versionB ? (
        <Empty description="请选择两个需要对比的版本或文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : versionA.id === versionB.id ? (
        <Alert type="warning" showIcon message="请选择两个不同版本或文档" />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 10 }}>
            <Card size="small"><Text type="secondary">内容差异</Text><div style={{ fontSize: 22, fontWeight: 700 }}>{differences.filter(item => item.kind === 'content').length}</div></Card>
            <Card size="small"><Text type="secondary">结构差异</Text><div style={{ fontSize: 22, fontWeight: 700 }}>{differences.filter(item => item.kind === 'structure').length}</div></Card>
            <Card size="small"><Text type="secondary">格式/形态</Text><div style={{ fontSize: 22, fontWeight: 700 }}>{differences.filter(item => item.kind === 'format').length}</div></Card>
            <Card size="small"><Text type="secondary">文件信息</Text><div style={{ fontSize: 22, fontWeight: 700 }}>{differences.filter(item => item.kind === 'metadata').length}</div></Card>
          </div>

          <Card
            title="差异清单"
            extra={
              <Button type="primary" icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiComment}>
                AI 对比评语
              </Button>
            }
            styles={{ body: { padding: differences.length ? 0 : 24 } }}
          >
            {differences.length === 0 ? (
              <Empty description="未发现明显差异" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                dataSource={differences}
                renderItem={(item) => (
                  <List.Item style={{ padding: '12px 16px' }}>
                    <div style={{ width: '100%' }}>
                      <Space size={6} wrap style={{ marginBottom: 6 }}>
                        <Tag color={kindMeta[item.kind].color}>{kindMeta[item.kind].label}</Tag>
                        <Tag color={severityMeta[item.severity].color}>{severityMeta[item.severity].label}</Tag>
                        <Text strong>{item.title}</Text>
                      </Space>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{item.detail}</Text>
                      {(item.before || item.after) && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div style={{ background: '#fff1f0', border: '1px solid #ffccc7', borderRadius: 6, padding: 8, minWidth: 0 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>A</Text>
                            <Paragraph ellipsis={{ rows: 3, expandable: true }} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.before || '无'}</Paragraph>
                          </div>
                          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: 8, minWidth: 0 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>B</Text>
                            <Paragraph ellipsis={{ rows: 3, expandable: true }} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.after || '无'}</Paragraph>
                          </div>
                        </div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>

          {(aiLoading || aiComment) && (
            <Card title="AI 对比评语">
              {aiLoading ? <Spin /> : <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{aiComment}</Paragraph>}
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default VersionCompareViewer;
