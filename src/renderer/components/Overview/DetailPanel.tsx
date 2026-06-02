import React, { useState } from 'react';
import { Typography, Tabs, Progress, List, Button, Space, Tag, Empty, Modal, Select, Collapse, message, Popconfirm, DatePicker } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  FolderOutlined, FileOutlined, ExclamationCircleOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, ExperimentOutlined,
  RightOutlined, DownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { ProjectDocument, WritingTemplate } from '../../../shared/types';
import {
  buildProjectStageSegments,
  getStageMeta,
  getAllStages,
  getProjectProgress,
  TimelineStageSegment,
  detectTimelineStage,
} from '../../utils/timelineStages';
import { useSettingsStore } from '../../stores/settingsStore';

const { Title, Text, Paragraph } = Typography;

const DetailPanel: React.FC = () => {
  const { currentProject, setCurrentProject, versions } = useProjectStore();
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc, updateProjectDoc, deleteProjectDoc } = useProjectDocStore();
  const { customStages } = useSettingsStore();
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  const isOverdue = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return d.getTime() < Date.now();
    const now = new Date();
    return (d.getFullYear() < now.getFullYear())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())
      || (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() < now.getDate());
  };

  const isAboutToExpire = (deadline?: string, completedAt?: string) => {
    if (!deadline || completedAt || isOverdue(deadline, completedAt)) return false;
    const d = new Date(deadline);
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return Date.now() >= d.getTime() - 24 * 60 * 60 * 1000;
    const now = new Date();
    return now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
  };

  if (!currentProject) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
        请选择一个项目查看详情
      </div>
    );
  }

  const projectVersions = versions.filter(v => v.projectId === currentProject.id);
  const projectDocsList = projectDocs.filter(d => d.projectId === currentProject.id);
  const selectedDoc = projectDocsList.find(d => d.id === selectedDocId) || null;
  const planSegments = buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages);

  // 使用统一的项目进度（基于已完成阶段）
  const avgProgress = getProjectProgress(currentProject, projectDocsList, templates, projectVersions, allStages);

  const statusMap: Record<string, { color: string; label: string }> = {
    active: { color: 'blue', label: '进行中' },
    completed: { color: 'green', label: '已完成' },
    paused: { color: 'orange', label: '已暂停' },
  };
  const statusInfo = statusMap[currentProject.status] || { color: 'default', label: '未知' };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '未设置';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 按模板分组（未关联模板的文件通过关键字自动匹配）
  const groupedByTemplate = () => {
    const map = new Map<string, ProjectDocument[]>();
    for (const doc of projectDocsList) {
      let templateId = doc.templateId;
      // 未关联模板时，通过关键字自动匹配
      if (!templateId) {
        const stage = detectTimelineStage(allStages, doc.name, doc.sourceFilePath);
        const matched = templates.find(t =>
          t.name.includes(stage) || t.category?.includes(stage) || detectTimelineStage(allStages, t.name, t.category) === stage
        );
        templateId = matched?.id || '__unmatched__';
      }
      const arr = map.get(templateId) || [];
      arr.push(doc);
      map.set(templateId, arr);
    }
    const groups: { templateId: string; templateName: string; docs: ProjectDocument[] }[] = [];
    for (const [templateId, docs] of map) {
      const template = templates.find(t => t.id === templateId);
      groups.push({
        templateId,
        templateName: template?.name || (templateId === '__unmatched__' ? '未匹配模板' : '未知模板'),
        docs,
      });
    }
    return groups;
  };

  // 可选的模板列表（已有模板 + 未使用的新模板）
  const templateOptions = () => {
    const usedTemplateIds = new Set(projectDocsList.map(d => d.templateId));
    const options: { value: string; label: string; isNew: boolean }[] = [];
    // 已使用的模板（可继续添加文件）
    for (const tid of usedTemplateIds) {
      const t = templates.find(t => t.id === tid);
      if (t) options.push({ value: t.id, label: `${t.name}（添加文件）`, isNew: false });
    }
    // 未使用的新模板
    for (const t of templates) {
      if (!usedTemplateIds.has(t.id)) {
        options.push({ value: t.id, label: `${t.name} (${t.category})`, isNew: true });
      }
    }
    return options;
  };

  // 关联文件：创建 ProjectDocument
  const handleAddDoc = async () => {
    if (!selectedTemplateId || !selectedVersionId) {
      message.warning('请选择模板和文件版本');
      return;
    }
    const template = templates.find(t => t.id === selectedTemplateId);
    const version = versions.find(v => v.id === selectedVersionId);
    if (!template || !version) return;

    // 命名：项目名称-模板名称，如果同模板有多个文件则加上文件名
    const existingDocs = projectDocsList.filter(d => d.templateId === selectedTemplateId);
    let docName = `${currentProject.name}-${template.name}`;
    if (existingDocs.length > 0) {
      const baseName = version.fileName.replace(/\.[^.]+$/, '');
      docName = `${currentProject.name}-${template.name}(${baseName})`;
    }

    const newDoc: ProjectDocument = {
      id: Date.now().toString(),
      projectId: currentProject.id,
      templateId: selectedTemplateId,
      versionId: selectedVersionId,
      name: docName,
      sections: [],
      overallProgress: 0,
      createdAt: new Date().toISOString(),
    };

    await addProjectDoc(newDoc);
    setAddModalOpen(false);
    setSelectedTemplateId('');
    setSelectedVersionId('');
    message.success('已关联文件，正在分析...');

    // 自动执行基础分析
    await runAnalysis(newDoc.id, version.content, template, false);
  };

  // 执行分析
  const runAnalysis = async (docId: string, content: string, template: WritingTemplate, useAI: boolean) => {
    setIsAnalyzing(true);
    try {
      const result = await window.electronAPI.analyzeProjectDoc({ content, template, useAI });
      if (result.success && result.sections) {
        await updateProjectDoc(docId, {
          sections: result.sections,
          overallProgress: result.overallProgress ?? 0,
          analyzedAt: new Date().toISOString(),
        });
        message.success(useAI ? 'AI 分析完成' : '基础分析完成');
      }
    } catch (error) {
      console.error('Analysis failed:', error);
      message.error('分析失败');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async (doc: ProjectDocument, useAI: boolean) => {
    const version = versions.find(v => v.id === doc.versionId);
    const template = templates.find(t => t.id === doc.templateId);
    if (!version || !template) {
      message.error('找不到关联的文件或模板');
      return;
    }
    await runAnalysis(doc.id, version.content, template, useAI);
  };

  const handleStageDeadline = async (segment: TimelineStageSegment, deadline?: string) => {
    const normalized = deadline ? (() => { const d = new Date(deadline); d.setHours(0, 0, 0, 0); return d.toISOString(); })() : undefined;
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { deadline: normalized })));
    message.success(deadline ? '已更新计划截止时间' : '已清除计划截止时间');
  };

  const handleStageComplete = async (segment: TimelineStageSegment) => {
    const completedAt = new Date().toISOString();
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt })));
    message.success('已标记阶段完成');
  };

  const handleStageReopen = async (segment: TimelineStageSegment) => {
    await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt: undefined })));
    message.success('已取消完成状态');
  };

  // 状态图标
  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />;
    if (status === 'partial') return <ClockCircleOutlined style={{ color: '#faad14', fontSize: 14 }} />;
    return <CloseOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />;
  };

  const tabItems = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <div>
          <Title level={5} style={{ fontSize: 14, marginBottom: 8 }}>项目描述</Title>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 20 }}>
            {currentProject.description || '暂无描述'}
          </Paragraph>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>状态</Text>
              <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 11 }}>{statusInfo.label}</Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>创建时间</Text>
              <Text style={{ fontSize: 12 }}>{formatDate(currentProject.createdAt)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>文件版本</Text>
              <Text style={{ fontSize: 12 }}>{projectVersions.length} 个</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>关联文档</Text>
              <Text style={{ fontSize: 12 }}>{projectDocsList.length} 份</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>关联文件夹</Text>
              <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: currentProject.folderPath }}>
                {currentProject.folderPath ? currentProject.folderPath.split(/[/\\]/).pop() : '未关联'}
              </Text>
            </div>
          </div>

          {/* 文档完成度 - 圆形进度 + 百分比统计 */}
          <Title level={5} style={{ fontSize: 14, marginBottom: 12 }}>文档完成度</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
            <Progress
              type="circle"
              percent={avgProgress}
              size={80}
              strokeColor={avgProgress >= 80 ? '#52c41a' : avgProgress >= 40 ? '#1890ff' : '#faad14'}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              {(() => {
                const completed = projectDocsList.filter(d => d.overallProgress >= 80).length;
                const inProgress = projectDocsList.filter(d => d.overallProgress > 0 && d.overallProgress < 80).length;
                const notStarted = projectDocsList.filter(d => d.overallProgress === 0).length;
                const total = projectDocsList.length || 1;
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#52c41a', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>已完成</Text></Space>
                      <Text style={{ fontSize: 12 }}>{Math.round(completed / total * 100)}%</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#1890ff', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>待完成</Text></Space>
                      <Text style={{ fontSize: 12 }}>{Math.round(inProgress / total * 100)}%</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={4}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#d9d9d9', display: 'inline-block' }} /><Text style={{ fontSize: 12 }}>待开始</Text></Space>
                      <Text style={{ fontSize: 12 }}>{Math.round(notStarted / total * 100)}%</Text>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* 下一步计划/建议 */}
          {planSegments.length > 0 && (
            <>
              <Title level={5} style={{ fontSize: 14, marginBottom: 10 }}>下一步计划</Title>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {planSegments.filter(s => !s.completedAt).slice(0, 3).map(segment => {
                  const color = stageMeta[segment.stage].color;
                  const segOverdue = isOverdue(segment.deadline, segment.completedAt);
                  const segAboutToExpire = isAboutToExpire(segment.deadline, segment.completedAt);
                  return (
                    <div key={`${segment.stage}-${segment.sourceDocIds.join('-')}`} style={{
                      padding: '8px 10px', borderRadius: 6, border: `1px solid ${segOverdue ? '#ffccc7' : segAboutToExpire ? '#ffe58f' : '#f0f0f0'}`,
                      background: segOverdue ? '#fff7f6' : segAboutToExpire ? '#fffbe6' : '#fafafa',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: segOverdue ? '#ff4d4f' : segAboutToExpire ? '#faad14' : color, flexShrink: 0 }} />
                        <Text strong style={{ fontSize: 12 }}>{segment.label}</Text>
                        {segment.deadline && (
                          <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>截止 {formatDate(segment.deadline)}</Text>
                        )}
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {segOverdue ? '已逾期，请尽快完成' : segAboutToExpire ? '今天到期，请抓紧完成' : `包含 ${segment.sourceDocNames.length} 个文件，继续推进中`}
                      </Text>
                    </div>
                  );
                })}
                {planSegments.filter(s => !s.completedAt).length === 0 && (
                  <div style={{ padding: '12px', textAlign: 'center' }}>
                    <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a', marginBottom: 8 }} />
                    <div><Text type="secondary" style={{ fontSize: 12 }}>所有阶段已完成</Text></div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 近期任务汇总 - 跨项目统计 */}
          {(() => {
            const { projects: allProjects } = useProjectStore.getState();
            const allDocs = useProjectDocStore.getState().projectDocs;
            const allTemplates = useTemplateStore.getState().templates;
            const stageOrder = allStages.map(s => s.name);
            const stageSummary = stageOrder.map(stage => {
              let total = 0;
              let completed = 0;
              for (const p of allProjects) {
                const segs = buildProjectStageSegments(p, allDocs.filter(d => d.projectId === p.id), allTemplates, [], allStages);
                const seg = segs.find(s => s.stage === stage);
                if (seg) {
                  total += 1;
                  if (seg.completedAt) completed += 1;
                }
              }
              return { stage, total, completed };
            }).filter(s => s.total > 0);

            if (stageSummary.length === 0) return null;
            return (
              <>
                <Title level={5} style={{ fontSize: 14, marginBottom: 10 }}>近期任务</Title>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stageSummary.map(({ stage, total, completed }) => (
                    <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: stageMeta[stage].color, flexShrink: 0 }} />
                      <Text style={{ fontSize: 12, flex: 1 }}>{stageMeta[stage].label}</Text>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>{completed}/{total}</Text>
                      <Progress
                        percent={Math.round(completed / total * 100)}
                        size="small"
                        style={{ width: 60, margin: 0 }}
                        showInfo={false}
                        strokeColor={completed === total ? '#52c41a' : '#1890ff'}
                      />
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      ),
    },
    {
      key: 'files',
      label: '文件',
      children: (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>关联文档 ({projectDocsList.length})</Text>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              关联文件
            </Button>
          </div>
          {projectDocsList.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupedByTemplate().map(group => {
                const avgProgress = group.docs.length > 0
                  ? Math.round(group.docs.reduce((acc, d) => acc + d.overallProgress, 0) / group.docs.length)
                  : 0;
                const isExpanded = expandedTemplate === group.templateId;
                return (
                  <div key={group.templateId}>
                    {/* 模板标题行 */}
                    <div
                      onClick={() => setExpandedTemplate(isExpanded ? null : group.templateId)}
                      style={{
                        padding: '8px 10px',
                        border: `1px solid ${isExpanded ? '#1890ff' : '#f0f0f0'}`,
                        borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                        background: isExpanded ? '#fafafa' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <FileOutlined style={{ color: '#1890ff', fontSize: 13 }} />
                          <Text strong style={{ fontSize: 12 }}>{group.templateName}</Text>
                          <Tag style={{ margin: 0, fontSize: 10 }}>{group.docs.length} 份</Tag>
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {!isExpanded && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 19 }}>
                          <Progress percent={avgProgress} size="small" showInfo={false} style={{ flex: 1, marginBottom: 0 }} strokeColor={avgProgress >= 80 ? '#52c41a' : '#1890ff'} />
                          <Text style={{ fontSize: 11, minWidth: 32 }}>{avgProgress}%</Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    {isExpanded && (
                      <div style={{
                        border: '1px solid #1890ff',
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                          <Button
                            type="link" size="small" icon={<PlusOutlined />}
                            onClick={(e) => { e.stopPropagation(); setSelectedTemplateId(group.templateId); setAddModalOpen(true); }}
                            style={{ padding: 0, fontSize: 11 }}
                          >
                            添加文件
                          </Button>
                        </div>
                        {group.docs.map(doc => {
                          const version = versions.find(v => v.id === doc.versionId);
                          return (
                            <div
                              key={doc.id}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: 4,
                                background: '#fafafa',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: version?.fileName || doc.name, style: { maxWidth: 130 } }}>
                                  {version?.fileName || doc.name}
                                </Text>
                                <Space size={2}>
                                  <Button type="text" size="small" icon={<ReloadOutlined />} loading={isAnalyzing} onClick={() => handleAnalyze(doc, false)} style={{ padding: '0 4px' }} />
                                  <Button type="text" size="small" icon={<ExperimentOutlined />} loading={isAnalyzing} onClick={() => handleAnalyze(doc, true)} style={{ padding: '0 4px' }} />
                                  <Popconfirm title="确定删除？" onConfirm={() => deleteProjectDoc(doc.id)}>
                                    <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ padding: '0 4px' }} />
                                  </Popconfirm>
                                </Space>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Progress percent={doc.overallProgress} size="small" showInfo={false} style={{ flex: 1, marginBottom: 0 }} />
                                <Text style={{ fontSize: 10, minWidth: 28 }}>{doc.overallProgress}%</Text>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂未关联文档" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                关联文件
              </Button>
            </Empty>
          )}

          {/* 关联文件弹窗 */}
          <Modal
            title="关联文件"
            open={addModalOpen}
            onOk={handleAddDoc}
            onCancel={() => setAddModalOpen(false)}
            okText="关联并分析"
            cancelText="取消"
            width={420}
          >
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择模板</Text>
              <Select
                placeholder="选择文档模板（如提案表、可研报告）"
                style={{ width: '100%' }}
                value={selectedTemplateId || undefined}
                onChange={setSelectedTemplateId}
                options={templateOptions()}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>选择文件版本</Text>
              <Select
                placeholder="选择已导入的文件"
                style={{ width: '100%' }}
                value={selectedVersionId || undefined}
                onChange={setSelectedVersionId}
                options={projectVersions.map(v => ({
                  value: v.id,
                  label: `${v.fileName} (${v.fileType.toUpperCase()})`,
                }))}
              />
            </div>
            {projectVersions.length === 0 && (
              <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                请先在"文件"页面导入文档
              </Text>
            )}
          </Modal>
        </div>
      ),
    },
    {
      key: 'plan',
      label: '计划',
      children: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Text strong style={{ fontSize: 13 }}>阶段计划 ({planSegments.length})</Text>
          </div>

          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage].color;
                const isCompleted = Boolean(segment.completedAt);
                const segOverdue = isOverdue(segment.deadline, segment.completedAt);
                const segAboutToExpire = isAboutToExpire(segment.deadline, segment.completedAt);
                const statusColor = segOverdue ? '#ff4d4f' : segAboutToExpire ? '#faad14' : color;

                return (
                  <div
                    key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${segOverdue ? '#ffccc7' : segAboutToExpire ? '#ffe58f' : '#f0f0f0'}`,
                      borderRadius: 8,
                      background: segOverdue ? '#fff7f6' : segAboutToExpire ? '#fffbe6' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <Space size={6}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: statusColor, display: 'inline-block' }} />
                        <Text strong style={{ fontSize: 13 }}>{segment.label}</Text>
                        {isCompleted ? (
                          <Tag color="green" style={{ margin: 0, fontSize: 11 }}>已完成</Tag>
                        ) : segOverdue ? (
                          <Tag color="red" style={{ margin: 0, fontSize: 11 }}>逾期</Tag>
                        ) : segAboutToExpire ? (
                          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>即将逾期</Tag>
                        ) : (
                          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>进行中</Tag>
                        )}
                      </Space>
                      {isCompleted ? (
                        <Button size="small" onClick={() => handleStageReopen(segment)}>
                          取消完成
                        </Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => handleStageComplete(segment)}>
                          完成
                        </Button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>文件数</Text>
                        <Text style={{ fontSize: 11 }}>{segment.sourceDocNames.length} 个</Text>
                      </div>
                      <div>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>截止时间</Text>
                        <DatePicker
                          showTime
                          allowClear
                          size="small"
                          style={{ width: '100%' }}
                          value={segment.deadline ? dayjs(segment.deadline) : null}
                          placeholder="设置计划截止时间"
                          onChange={(value) => handleStageDeadline(segment, value ? value.toDate().toISOString() : undefined)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty description="暂无可计划的阶段" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
                关联文件
              </Button>
            </Empty>
          )}
        </div>
      ),
    },
    {
      key: 'tasks',
      label: '进度',
      children: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Text strong style={{ fontSize: 13 }}>阶段进度</Text>
          </div>
          {planSegments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {planSegments.map(segment => {
                const color = stageMeta[segment.stage]?.color || '#8c8c8c';
                const isCompleted = Boolean(segment.completedAt);
                const isExpanded = expandedStage === segment.stage;
                const latestDocName = segment.sourceDocNames[segment.sourceDocNames.length - 1] || '';
                const docsInStage = projectDocsList.filter(d => segment.sourceDocIds.includes(d.id));
                const latestDoc = docsInStage[docsInStage.length - 1];

                return (
                  <div key={`${segment.stage}-${segment.sourceDocIds.join('-')}`}>
                    {/* 阶段标题行 */}
                    <div
                      onClick={() => setExpandedStage(isExpanded ? null : segment.stage)}
                      style={{
                        padding: '8px 10px',
                        border: `1px solid ${isExpanded ? color : '#f0f0f0'}`,
                        borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                        background: isExpanded ? '#fafafa' : '#fff',
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={6}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                          <Text strong style={{ fontSize: 12 }}>{segment.label}</Text>
                          {isCompleted ? (
                            <Tag color="green" style={{ margin: 0, fontSize: 10 }}>已完成</Tag>
                          ) : (
                            <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{segment.sourceDocNames.length} 个文件</Tag>
                          )}
                        </Space>
                        <DownOutlined style={{ fontSize: 10, color: '#999', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {!isExpanded && latestDoc && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingLeft: 14 }}>
                          <Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: latestDocName, style: { maxWidth: 160 } }}>
                            最新：{latestDocName}
                          </Text>
                          <Text style={{ fontSize: 11, color: latestDoc.overallProgress >= 80 ? '#52c41a' : '#1890ff', fontWeight: 600 }}>
                            {latestDoc.overallProgress}%
                          </Text>
                        </div>
                      )}
                    </div>
                    {/* 展开的文档列表 */}
                    {isExpanded && (
                      <div style={{
                        border: `1px solid ${color}`,
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        padding: '8px 10px',
                        background: '#fff',
                      }}>
                        {docsInStage.length > 0 ? docsInStage.map((doc, idx) => {
                          const isLatest = idx === docsInStage.length - 1;
                          return (
                            <div
                              key={doc.id}
                              onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
                              style={{
                                padding: '6px 8px',
                                borderRadius: 6,
                                marginBottom: idx < docsInStage.length - 1 ? 4 : 0,
                                background: selectedDocId === doc.id ? '#e6f7ff' : '#fafafa',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                                <Space size={4}>
                                  <Text style={{ fontSize: 11 }} ellipsis={{ tooltip: doc.name, style: { maxWidth: 130 } }}>{doc.name}</Text>
                                  {isLatest && <Tag color="blue" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>最新</Tag>}
                                </Space>
                                <Text style={{ fontSize: 10, fontWeight: 600 }}>{doc.overallProgress}%</Text>
                              </div>
                              <Progress percent={doc.overallProgress} size="small" showInfo={false} style={{ marginBottom: 0 }} />
                            </div>
                          );
                        }) : (
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', textAlign: 'center', padding: 8 }}>暂无文档</Text>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <ExclamationCircleOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 12 }} />
              <div>
                <Text type="secondary" style={{ fontSize: 13 }}>暂无阶段数据</Text>
              </div>
              <Button type="link" size="small" onClick={() => setAddModalOpen(true)} style={{ marginTop: 8 }}>
                关联文件
              </Button>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'members',
      label: '成员',
      children: (
        <Empty description="团队成员管理功能开发中" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ),
    },
  ];

  return (
    <div style={{ padding: '16px 20px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, background: '#e6f7ff', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FolderOutlined style={{ fontSize: 20, color: '#1890ff' }} />
          </div>
          <div>
            <Title level={5} style={{ margin: 0, fontSize: 15 }}>{currentProject.name}</Title>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Tag color={statusInfo.color} style={{ margin: 0, fontSize: 11 }}>{statusInfo.label}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{avgProgress}% 文档完成度</Text>
            </div>
          </div>
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={() => setCurrentProject(null)} size="small" />
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <Progress
          percent={avgProgress} size="small"
          strokeColor={avgProgress >= 80 ? '#52c41a' : '#1890ff'}
          showInfo={false}
        />
      </div>

      <Tabs items={tabItems} size="small" style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
};

export default DetailPanel;
