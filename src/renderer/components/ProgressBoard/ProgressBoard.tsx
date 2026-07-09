import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Progress, List, Tag, Typography, Empty, Space, Statistic, Row, Col, Divider, Select, Input, message, Alert } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LeftOutlined,
  TeamOutlined,
  EditOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;
import dayjs from 'dayjs';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { buildProjectStageSegments, getAllStages, getProjectProgress, getStageMeta } from '../../utils/timelineStages';
import { composePrompt } from '../../utils/promptComposer';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';

const { Text, Title } = Typography;

interface ProgressBoardProps {
  onBack?: () => void;
}

type AiRewritePreview = {
  id: string;
  title: string;
  original: string;
  replacement: string;
  reason?: string;
  status?: 'pending' | 'accepted';
};

const ProgressBoard: React.FC<ProgressBoardProps> = ({ onBack }) => {
  const {
    currentProject,
    versions,
    pendingWorkflowFocus,
    setPendingWorkflowFocus,
    setCurrentStageName,
    loadVersions,
  } = useProjectStore();
  const { projectDocs, loadProjectDocs } = useProjectDocStore();
  const { customStages, userProfile } = useSettingsStore();
  const { tasks, loadTasks } = useTaskStore();
  const { templates, reviews, loadTemplates, loadReviews } = useTemplateStore();
  const [selectedWritingTemplateId, setSelectedWritingTemplateId] = useState<string>('');
  const [selectedWritingDocIds, setSelectedWritingDocIds] = useState<string[]>([]);
  const [writingContent, setWritingContent] = useState('');
  const [workflowPromptSuggestion, setWorkflowPromptSuggestion] = useState('');
  const [focusedWorkflowTaskId, setFocusedWorkflowTaskId] = useState('');
  const [aiRewritePreviews, setAiRewritePreviews] = useState<AiRewritePreview[]>([]);
  const [isGeneratingRewritePlan, setIsGeneratingRewritePlan] = useState(false);
  const [applyingRewriteId, setApplyingRewriteId] = useState('');
  const [collaborationStatus, setCollaborationStatus] = useState<{ running: boolean; port?: number; urls?: string[]; addresses?: string[] }>({ running: false });
  const [lanPeers, setLanPeers] = useState<CollaborationPeerInfo[]>([]);
  const [lanFriends, setLanFriends] = useState<CollaborationPeerInfo[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [sendingTaskId, setSendingTaskId] = useState('');

  const refreshCollaborationStatus = async () => {
    const result = await window.electronAPI.getCollaborationStatus?.();
    if (result?.success) {
      setCollaborationStatus({
        running: Boolean(result.running),
        port: result.port,
        urls: result.urls || [],
        addresses: result.addresses || [],
      });
      setLanPeers(result.peers || []);
      setLanFriends(result.friends || []);
    }
  };

  const handleStartCollaborationReceiver = async () => {
    const result = await window.electronAPI.startCollaborationReceiver?.();
    if (!result?.success) {
      message.error(result?.error || '\u5c40\u57df\u7f51\u63a5\u6536\u670d\u52a1\u542f\u52a8\u5931\u8d25');
      return;
    }
    setCollaborationStatus({ running: true, port: result.port, urls: result.urls || [], addresses: result.addresses || [] });
    setLanPeers(result.peers || []);
    setLanFriends(result.friends || []);
    message.success('\u5df2\u5f00\u542f\u5c40\u57df\u7f51\u4efb\u52a1\u63a5\u6536');
  };

  const handleStopCollaborationReceiver = async () => {
    const result = await window.electronAPI.stopCollaborationReceiver?.();
    if (!result?.success) {
      message.error(result?.error || '\u5c40\u57df\u7f51\u63a5\u6536\u670d\u52a1\u505c\u6b62\u5931\u8d25');
      return;
    }
    setCollaborationStatus({ running: false });
  };

  const handleAddCollaborationFriend = async (peer: CollaborationPeerInfo) => {
    const result = await window.electronAPI.addCollaborationFriend?.(peer);
    if (!result?.success) {
      message.error(result?.error || '\u6dfb\u52a0\u597d\u53cb\u5931\u8d25');
      return;
    }
    setLanFriends(result.friends || []);
    setLanPeers(prev => prev.map(item => item.id === peer.id ? { ...item, added: true } : item));
    message.success('\u5df2\u6dfb\u52a0\u5c40\u57df\u7f51\u597d\u53cb');
  };

  const handleRemoveCollaborationFriend = async (friendId: string) => {
    const result = await window.electronAPI.removeCollaborationFriend?.(friendId);
    if (!result?.success) {
      message.error(result?.error || '\u79fb\u9664\u597d\u53cb\u5931\u8d25');
      return;
    }
    setLanFriends(result.friends || []);
    if (selectedFriendId === friendId) setSelectedFriendId('');
  };

  const parseAiRewritePreviews = (raw: string): AiRewritePreview[] => {
    const text = String(raw || '').trim();
    const jsonText = text.match(/\[[\s\S]*\]/)?.[0] || text.match(/\{[\s\S]*\}/)?.[0] || '';
    try {
      const parsed = JSON.parse(jsonText);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
      return items
        .map((item: any, index: number) => ({
          id: 'team-rewrite-' + Date.now() + '-' + index,
          title: String(item.title || item.section || '修改建议 ' + (index + 1)).trim(),
          original: String(item.original || item.originalText || '').trim(),
          replacement: String(item.replacement || item.revised || item.revisedText || item.suggestion || '').trim(),
          reason: String(item.reason || item.explanation || '').trim(),
          status: 'pending' as const,
        }))
        .filter((item: AiRewritePreview) => item.original && item.replacement);
    } catch {
      return [];
    }
  };

  const updateAiRewritePreview = (id: string, updates: Partial<AiRewritePreview>) => {
    setAiRewritePreviews(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const getTargetWritingDoc = () => {
    const docId = selectedWritingDocIds[0];
    return docId ? projectDocsList.find(doc => doc.id === docId) : undefined;
  };

  const getTargetWritingDocPath = () => {
    const doc = getTargetWritingDoc();
    if (!doc) return '';
    const version = doc.versionId ? projectVersions.find(item => item.id === doc.versionId) : undefined;
    return doc.sourceFilePath || version?.filePath || '';
  };

  const handleGenerateRewritePlan = async () => {
    const instruction = (writingContent || workflowPromptSuggestion).trim();
    const filePath = getTargetWritingDocPath();
    if (!filePath) {
      message.warning('请先在参考文档中选择要修改的文档');
      return;
    }
    if (!instruction) {
      message.warning('请先填写或按 Tab 填充工作流提示词');
      return;
    }

    setIsGeneratingRewritePlan(true);
    try {
      const parsed = await window.electronAPI.parseDocument(filePath);
      if (!parsed.success || !parsed.content) {
        message.error(parsed.error || '未能读取文档内容');
        return;
      }
      const prompt = composePrompt('rewrite', {
        sectionTitle: '（全文改稿）',
        requirement: `修改要求：${instruction}`,
        example: 'None',
        stageMemory: 'None',
        reference: 'None',
        currentContent: parsed.content.slice(0, 16000),
      });
      const result = await useAIJobStore.getState().runAIJob<string>(
        {
          scene: 'rewrite',
          title: '生成修订预览',
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
      const previews = parseAiRewritePreviews(result);
      if (previews.length === 0) {
        message.warning('AI 未生成可直接替换的原文块，请补充更明确的问题描述后重试');
      }
      setAiRewritePreviews(previews);
    } catch (error: any) {
      message.error('生成修改预览失败：' + (error.message || String(error)));
    } finally {
      setIsGeneratingRewritePlan(false);
    }
  };

  const handleAcceptRewrite = async (preview: AiRewritePreview) => {
    const filePath = getTargetWritingDocPath();
    if (!filePath) {
      message.warning('未找到当前文档的源文件路径');
      return;
    }

    setApplyingRewriteId(preview.id);
    try {
      const result = await window.electronAPI.replaceDocumentText({
        filePath,
        originalText: preview.original,
        replacementText: preview.replacement,
      });
      if (!result.success) {
        message.error(result.error || '替换失败');
        return;
      }
      updateAiRewritePreview(preview.id, { status: 'accepted' });
      await loadVersions();
      message.success(result.backupPath ? '已替换原文，并已自动备份原文件' : '已替换原文');
    } catch (error: any) {
      message.error('接受修改失败：' + (error.message || String(error)));
    } finally {
      setApplyingRewriteId('');
    }
  };

  const handleQuickExport = async () => {
    const template = templates.find(t => t.id === selectedWritingTemplateId);
    if (!template || !currentProject) return;
    try {
      const result = await window.electronAPI.generateFromContent({
        template,
        sectionContents: { 'main': writingContent },
        folderPath: currentProject.folderPath,
        fileName: `${currentProject.name}-${template.name}`,
      });
      if (result.success) {
        message.success('文档已导出');
        if (result.filePath) await window.electronAPI.openInExplorer(result.filePath);
      } else {
        message.error(result.error || '导出失败');
      }
    } catch (error: any) {
      message.error(`导出失败：${error.message}`);
    }
  };

  const handleImportWritingDoc = async (docId: string): Promise<string> => {
    const doc = projectDocsList.find(d => d.id === docId);
    if (!doc) return '';
    const version = doc.versionId ? projectVersions.find(v => v.id === doc.versionId) : undefined;
    let content = version?.content || '';
    if (!content && doc.sourceFilePath) {
      try {
        const parsed = await window.electronAPI.parseDocument(doc.sourceFilePath);
        if (parsed.success && parsed.content?.trim()) content = parsed.content.trim();
      } catch {}
    }
    return content;
  };

  const handleBatchImportDocs = async (docIds: string[]) => {
    const contents: string[] = [];
    for (const docId of docIds) {
      const content = await handleImportWritingDoc(docId);
      if (content) contents.push(content);
    }
    if (contents.length > 0) {
      setWritingContent(prev => prev ? prev + '\n\n' + contents.join('\n\n') : contents.join('\n\n'));
      message.success(`已导入 ${contents.length} 个文档内容`);
    } else {
      message.warning('所选文档暂无文本内容');
    }
  };

  const handleImportAllDocs = async () => {
    const allDocIds = projectDocsList.map(d => d.id);
    if (allDocIds.length === 0) {
      message.warning('项目暂无关联文档');
      return;
    }
    await handleBatchImportDocs(allDocIds);
  };

  useEffect(() => {
    loadProjectDocs();
    loadTasks();
    loadTemplates();
    loadReviews();
  }, []);

  useEffect(() => {
    void refreshCollaborationStatus();
    const offPeers = window.electronAPI.onCollaborationPeersChanged?.((payload) => {
      setLanPeers(payload.peers || []);
      setLanFriends(payload.friends || []);
    });
    return () => { offPeers?.(); };
  }, []);


  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);
  const projectVersions = currentProject ? versions.filter((v) => v.projectId === currentProject.id) : [];
  const projectDocsList = currentProject ? projectDocs.filter((d) => d.projectId === currentProject.id) : [];
  const projectTasks = currentProject ? tasks.filter((t) => t.projectId === currentProject.id) : [];
  const projectReviews = currentProject ? reviews.filter((r) => r.projectId === currentProject.id) : [];
  const projectProgress = currentProject ? getProjectProgress(currentProject, projectDocsList, templates, projectVersions, allStages) : 0;
  const stageSegments = currentProject ? buildProjectStageSegments(currentProject, projectDocsList, templates, projectVersions, allStages) : [];

  const openTasks = projectTasks.filter(task => task.status !== 'completed');
  const completedTasks = projectTasks.filter(task => task.status === 'completed');
  const highPriorityTasks = openTasks.filter(task => task.priority === 'high');
  const reviewTasks = openTasks.filter(task => task.source === 'review');
  const latestReview = [...projectReviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  useEffect(() => {
    if (!pendingWorkflowFocus || pendingWorkflowFocus.target !== 'team') return;
    if (!currentProject || pendingWorkflowFocus.projectId !== currentProject.id) return;

    if (pendingWorkflowFocus.stageName) {
      setCurrentStageName(pendingWorkflowFocus.stageName);
    }

    if (pendingWorkflowFocus.relatedDocId) {
      const targetDoc = projectDocsList.find(doc => doc.id === pendingWorkflowFocus.relatedDocId);
      if (targetDoc) {
        if (targetDoc.templateId) setSelectedWritingTemplateId(targetDoc.templateId);
        setSelectedWritingDocIds([targetDoc.id]);
      }
    }

    setFocusedWorkflowTaskId(pendingWorkflowFocus.taskId || '');
    setWorkflowPromptSuggestion(pendingWorkflowFocus.prompt || '');
    setWritingContent('');
    setAiRewritePreviews([]);
    setPendingWorkflowFocus(null);
  }, [
    currentProject?.id,
    pendingWorkflowFocus,
    projectDocsList,
    setCurrentStageName,
    setPendingWorkflowFocus,
  ]);

  const stageRows = stageSegments.map(segment => {
    const docs = projectDocsList.filter(doc => segment.sourceDocIds.includes(doc.id));
    const progress = docs.length
      ? Math.round(docs.reduce((sum, doc) => sum + doc.overallProgress, 0) / docs.length)
      : segment.completedAt ? 100 : 0;
    const overdue = !segment.completedAt && segment.deadline && new Date(segment.deadline).getTime() < Date.now();
    const stageTasks = openTasks.filter(task => task.stageName === segment.stage || segment.sourceDocIds.includes(task.relatedDocId || ''));
    return { segment, progress, overdue, taskCount: stageTasks.length };
  });

  const workload = useMemo(() => {
    const map = new Map<string, { name: string; open: number; high: number; completed: number }>();
    projectTasks.forEach(task => {
      const name = task.assigneeName || (task.type === 'ai' ? 'AI 助手' : '未分配');
      const row = map.get(name) || { name, open: 0, high: 0, completed: 0 };
      if (task.status === 'completed') row.completed += 1;
      else {
        row.open += 1;
        if (task.priority === 'high') row.high += 1;
      }
      map.set(name, row);
    });
    return [...map.values()].sort((a, b) => b.open - a.open || b.high - a.high);
  }, [projectTasks]);

  const handleCopyCollaborationAddress = async () => {
    const url = collaborationStatus.urls?.[0] || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url.replace(/^http:\/\//, '').replace(/\/tasks$/, ''));
      message.success('\u5df2\u590d\u5236\u5c40\u57df\u7f51\u5730\u5740');
    } catch {
      message.info(url);
    }
  };

  const handleSendCollaborationTask = async (task: any) => {
    if (!currentProject) return;
    const targetFriendId = selectedFriendId || lanFriends.find(friend => friend.online)?.id || '';
    if (!targetFriendId) {
      message.warning('\u8bf7\u5148\u9009\u62e9\u5728\u7ebf\u597d\u53cb');
      return;
    }
    setSendingTaskId(task.id);
    try {
      const result = await window.electronAPI.sendCollaborationTask?.({
        friendId: targetFriendId,
        task: { ...task, assigneeName: task.assigneeName || '' },
        projectName: currentProject.name,
        senderName: userProfile?.nickname || currentProject.name,
      });
      if (!result?.success) {
        message.error(result?.error || '\u4efb\u52a1\u53d1\u9001\u5931\u8d25');
        return;
      }
      message.success('\u4efb\u52a1\u5df2\u53d1\u9001\u5230\u5bf9\u65b9');
    } finally {
      setSendingTaskId('');
    }
  };

  const recentActivities = [
    ...projectTasks.map(task => ({
      id: `task-${task.id}`,
      title: task.title,
      type: task.source === 'review' ? '审查任务' : task.source === 'report' ? '报告任务' : '任务',
      time: task.completedAt || task.createdAt,
      status: task.status,
    })),
    ...projectReviews.map(review => ({
      id: `review-${review.id}`,
      title: review.summary,
      type: '审查记录',
      time: review.createdAt,
      status: review.score >= 80 ? 'completed' : 'pending',
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} title="返回" />
          <Title level={4} style={{ margin: 0 }}>{currentProject.name} - 团队协同</Title>
        </div>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>阶段、审查和任务会在这里汇总，方便判断下一步该谁推进什么。</Text>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card>
            <Row gutter={16}>
              <Col span={6}><Statistic title="阶段进度" value={projectProgress} suffix="%" /></Col>
              <Col span={6}><Statistic title="待处理任务" value={openTasks.length} /></Col>
              <Col span={6}><Statistic title="高优先级" value={highPriorityTasks.length} valueStyle={{ color: highPriorityTasks.length ? '#ff4d4f' : undefined }} /></Col>
              <Col span={6}><Statistic title="最近审查" value={latestReview ? latestReview.score : 0} suffix={latestReview ? '分' : ''} /></Col>
            </Row>
            <Progress percent={projectProgress} style={{ marginTop: 12, marginBottom: 0 }} />
          </Card>

          {/* AI协同 */}
          <Card title="AI协同" size="small">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Select
                placeholder="选择模板"
                style={{ width: '100%' }}
                value={selectedWritingTemplateId || undefined}
                onChange={setSelectedWritingTemplateId}
                options={templates.map(t => ({ value: t.id, label: t.name }))}
              />
              <Select
                mode="multiple"
                placeholder="导入文稿参考（可多选）"
                style={{ width: '100%' }}
                value={selectedWritingDocIds}
                onChange={setSelectedWritingDocIds}
                options={projectDocsList.map(d => ({ value: d.id, label: d.name }))}
                maxTagCount={2}
                maxTagTextLength={12}
              />
              <Space size={4}>
                <Button size="small" onClick={() => handleBatchImportDocs(selectedWritingDocIds)} disabled={selectedWritingDocIds.length === 0}>
                  导入选中
                </Button>
                <Button size="small" onClick={handleImportAllDocs} disabled={projectDocsList.length === 0}>
                  导入全部
                </Button>
              </Space>
              {workflowPromptSuggestion && (
                <Card size="small" style={{ borderColor: '#91caff', background: '#f8fbff' }}>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color="blue">来自工作流</Tag>
                      {focusedWorkflowTaskId && <Tag>当前问题</Tag>}
                    </Space>
                    <Text type="secondary">点击下方输入框后按 Tab，自动填充这个报告问题的提示词。</Text>
                  </Space>
                </Card>
              )}
              <TextArea
                value={writingContent}
                onChange={(e) => setWritingContent(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Tab' && workflowPromptSuggestion && !writingContent.trim()) {
                    event.preventDefault();
                    setWritingContent(workflowPromptSuggestion);
                  }
                }}
                placeholder={workflowPromptSuggestion ? '点击后按 Tab 自动填充工作流提示词' : '在此填写 AI 修改要求，或导入参考文档后生成修改预览...'}
                autoSize={{ minRows: 4, maxRows: 12 }}
                style={{ fontSize: 13 }}
              />
              <Space wrap>
                {workflowPromptSuggestion && (
                  <Button size="small" onClick={() => setWritingContent(workflowPromptSuggestion)}>
                    填充提示词
                  </Button>
                )}
                <Button
                  size="small"
                  type="primary"
                  loading={isGeneratingRewritePlan}
                  onClick={handleGenerateRewritePlan}
                  disabled={selectedWritingDocIds.length === 0}
                >
                  生成修改预览
                </Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={handleQuickExport} disabled={!writingContent.trim() || !selectedWritingTemplateId}>
                  导出 Word
                </Button>
              </Space>

              {aiRewritePreviews.length > 0 && (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {aiRewritePreviews.map(preview => (
                    <Card
                      key={preview.id}
                      size="small"
                      title={preview.title}
                      extra={preview.status === 'accepted' ? <Tag color="green">已接受</Tag> : <Tag color="blue">待确认</Tag>}
                      style={{ background: '#fbfdff' }}
                    >
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        {preview.reason && <Text type="secondary">{preview.reason}</Text>}
                        <div>
                          <Text strong style={{ display: 'block', marginBottom: 6 }}>原文内容</Text>
                          <TextArea
                            value={preview.original}
                            autoSize={{ minRows: 3, maxRows: 8 }}
                            disabled={preview.status === 'accepted'}
                            onChange={(event) => updateAiRewritePreview(preview.id, { original: event.target.value })}
                          />
                        </div>
                        <div>
                          <Text strong style={{ display: 'block', marginBottom: 6 }}>建议修改</Text>
                          <TextArea
                            value={preview.replacement}
                            autoSize={{ minRows: 3, maxRows: 10 }}
                            disabled={preview.status === 'accepted'}
                            onChange={(event) => updateAiRewritePreview(preview.id, { replacement: event.target.value })}
                          />
                        </div>
                        <Space wrap>
                          <Button
                            type="primary"
                            size="small"
                            disabled={preview.status === 'accepted'}
                            loading={applyingRewriteId === preview.id}
                            onClick={() => handleAcceptRewrite(preview)}
                          >
                            接受并替换原文
                          </Button>
                          <Button
                            size="small"
                            disabled={preview.status === 'accepted'}
                            onClick={() => setAiRewritePreviews(prev => prev.filter(item => item.id !== preview.id))}
                          >
                            忽略
                          </Button>
                        </Space>
                      </Space>
                    </Card>
                  ))}
                </Space>
              )}
            </Space>
          </Card>

          <Row gutter={16}>
          <Col span={14}>
            <Card title="阶段推进">
              {stageRows.length === 0 ? (
                <Empty description="暂无阶段数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  dataSource={stageRows}
                  renderItem={({ segment, progress, overdue, taskCount }) => (
                    <List.Item>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: stageMeta[segment.stage]?.color || '#1677ff' }} />
                          <Text strong>{segment.label}</Text>
                          {segment.completedAt && <Tag color="green">已完成</Tag>}
                          {overdue && <Tag color="red">逾期</Tag>}
                          {taskCount > 0 && <Tag color="blue">{taskCount} 个待办</Tag>}
                          {segment.deadline && <Text type="secondary" style={{ marginLeft: 'auto' }}>截止 {dayjs(segment.deadline).format('MM-DD')}</Text>}
                        </div>
                        <Progress percent={progress} size="small" strokeColor={overdue ? '#ff4d4f' : stageMeta[segment.stage]?.color} />
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>

          <Col span={10}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Card title={'\u5c40\u57df\u7f51\u597d\u53cb\u4e0e\u4efb\u52a1\u5206\u6d3e'} size="small" styles={{ body: { padding: 12 } }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Alert
                    type={collaborationStatus.running ? 'success' : 'info'}
                    showIcon
                    message={collaborationStatus.running ? '\u5df2\u5728\u5c40\u57df\u7f51\u4e2d\u5728\u7ebf' : '\u672a\u5f00\u542f\u63a5\u6536'}
                    description={collaborationStatus.running
                      ? (collaborationStatus.urls?.[0] || '\u6b63\u5728\u7b49\u5f85\u5c40\u57df\u7f51\u5730\u5740')
                      : '\u5f00\u542f\u540e\uff0c\u540c\u7f51\u6bb5\u8bbe\u5907\u53ef\u81ea\u52a8\u53d1\u73b0\u8fd9\u53f0\u7535\u8111\u3002'}
                  />
                  <Space wrap size={6}>
                    {collaborationStatus.running ? (
                      <Button size="small" onClick={handleStopCollaborationReceiver}>{'\u505c\u6b62\u63a5\u6536'}</Button>
                    ) : (
                      <Button size="small" type="primary" onClick={handleStartCollaborationReceiver}>{'\u5f00\u542f\u63a5\u6536'}</Button>
                    )}
                    <Button size="small" disabled={!collaborationStatus.urls?.length} onClick={handleCopyCollaborationAddress}>{'\u590d\u5236\u672c\u673a\u5730\u5740'}</Button>
                    <Button size="small" onClick={refreshCollaborationStatus}>{'\u5237\u65b0'}</Button>
                  </Space>
                  <div>
                    <Text strong style={{ fontSize: 12 }}>{'\u597d\u53cb'}</Text>
                    <Select
                      size="small"
                      allowClear
                      style={{ width: '100%', marginTop: 6 }}
                      placeholder={'\u9009\u62e9\u5728\u7ebf\u597d\u53cb\u540e\u53d1\u9001\u4efb\u52a1'}
                      value={selectedFriendId || undefined}
                      onChange={(value) => setSelectedFriendId(value || '')}
                      options={lanFriends.map(friend => ({
                        value: friend.id,
                        disabled: !friend.online,
                        label: `${friend.name || friend.host} ${friend.online ? '\u00b7 \u5728\u7ebf' : '\u00b7 \u79bb\u7ebf'}`,
                      }))}
                    />
                  </div>
                  <List
                    size="small"
                    dataSource={lanPeers.filter(peer => !peer.added).slice(0, 4)}
                    locale={{ emptyText: '\u6682\u672a\u53d1\u73b0\u65b0\u8bbe\u5907' }}
                    renderItem={(peer) => (
                      <List.Item
                        actions={[
                          <Button key="add" size="small" type="link" onClick={() => handleAddCollaborationFriend(peer)}>{'\u52a0\u597d\u53cb'}</Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={<Space><Text>{peer.name || peer.host}</Text><Tag color={peer.online ? 'green' : 'default'}>{peer.online ? '\u5728\u7ebf' : '\u79bb\u7ebf'}</Tag></Space>}
                          description={<Text type="secondary">{peer.host}:{peer.port}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                  {lanFriends.length > 0 && (
                    <List
                      size="small"
                      dataSource={lanFriends.slice(0, 5)}
                      renderItem={(friend) => (
                        <List.Item
                          actions={[
                            <Button key="remove" size="small" type="link" onClick={() => handleRemoveCollaborationFriend(friend.id)}>{'\u79fb\u9664'}</Button>,
                          ]}
                        >
                          <List.Item.Meta
                            title={<Space><Text>{friend.name || friend.host}</Text><Tag color={friend.online ? 'green' : 'default'}>{friend.online ? '\u5728\u7ebf' : '\u79bb\u7ebf'}</Tag></Space>}
                            description={<Text type="secondary">{friend.host}:{friend.port}</Text>}
                          />
                        </List.Item>
                      )}
                    />
                  )}
                  <List
                    size="small"
                    dataSource={openTasks.slice(0, 5)}
                    locale={{ emptyText: '\u6682\u65e0\u53ef\u5206\u6d3e\u4efb\u52a1' }}
                    renderItem={(task) => (
                      <List.Item
                        actions={[
                          <Button key="send" size="small" type="link" loading={sendingTaskId === task.id} onClick={() => handleSendCollaborationTask(task)}>
                            {'\u53d1\u7ed9\u597d\u53cb'}
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={<Text ellipsis={{ tooltip: task.title }}>{task.title}</Text>}
                          description={<Text type="secondary">{task.stageName || task.source || '\u4efb\u52a1'} {'\u00b7'} {task.priority}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                </Space>
              </Card>

              <Card title={'\u534f\u540c\u8d1f\u8f7d'} size="small" styles={{ body: { padding: 12 } }}>
                {workload.length === 0 ? (
                  <Empty description={'\u6682\u65e0\u4efb\u52a1\u5206\u914d'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <List
                    dataSource={workload}
                    renderItem={(row) => (
                      <List.Item>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                          <Space>
                            <TeamOutlined />
                            <Text>{row.name}</Text>
                          </Space>
                          <Space>
                            <Tag color={row.high ? 'red' : 'default'}>{'\u9ad8'} {row.high}</Tag>
                            <Tag color="blue">{'\u5f85\u529e'} {row.open}</Tag>
                            <Tag color="green">{'\u5b8c\u6210'} {row.completed}</Tag>
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Space>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Card title="风险与待办">
              <List
                dataSource={openTasks.slice(0, 8)}
                locale={{ emptyText: '暂无待办任务' }}
                renderItem={(task) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space wrap>
                        {task.priority === 'high'
                          ? <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                          : <ClockCircleOutlined style={{ color: '#faad14' }} />}
                        <Text strong>{task.title}</Text>
                        <Tag>{task.source === 'review' ? '审查' : task.source === 'report' ? '报告' : '任务'}</Tag>
                        {task.assigneeName && <Tag color="blue">{task.assigneeName}</Tag>}
                      </Space>
                      {task.description && <Text type="secondary" ellipsis>{task.description}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Space>
                <Tag color="red">审查待办 {reviewTasks.length}</Tag>
                <Tag color="green">已完成任务 {completedTasks.length}</Tag>
              </Space>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="最近动态">
              <List
                dataSource={recentActivities}
                locale={{ emptyText: '暂无动态' }}
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      {item.status === 'completed'
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : <FileTextOutlined style={{ color: '#1677ff' }} />}
                      <div>
                        <Text>{item.title}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.type} · {dayjs(item.time).format('MM-DD HH:mm')}
                        </Text>
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
};

export default ProgressBoard;
