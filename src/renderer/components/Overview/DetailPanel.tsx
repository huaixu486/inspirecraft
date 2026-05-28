import React, { useState } from 'react';
import { Typography, Tabs, Progress, List, Button, Space, Tag, Empty, Modal, Select, message, Popconfirm } from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  FolderOutlined, FileOutlined, ExclamationCircleOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { ProjectDocument, WritingTemplate } from '../../../shared/types';

const { Title, Text, Paragraph } = Typography;

const DetailPanel: React.FC = () => {
  const { currentProject, setCurrentProject, versions } = useProjectStore();
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc, updateProjectDoc, deleteProjectDoc } = useProjectDocStore();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  // 文档平均进度
  const avgProgress = projectDocsList.length > 0
    ? Math.round(projectDocsList.reduce((acc, d) => acc + d.overallProgress, 0) / projectDocsList.length)
    : 0;

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

  // 按模板分组
  const groupedByTemplate = () => {
    const groups: { templateId: string; templateName: string; docs: ProjectDocument[] }[] = [];
    const map = new Map<string, ProjectDocument[]>();
    for (const doc of projectDocsList) {
      const arr = map.get(doc.templateId) || [];
      arr.push(doc);
      map.set(doc.templateId, arr);
    }
    for (const [templateId, docs] of map) {
      const template = templates.find(t => t.id === templateId);
      groups.push({ templateId, templateName: template?.name || '未知模板', docs });
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

          <Title level={5} style={{ fontSize: 14, marginBottom: 16 }}>文档完成度</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Progress
              type="circle"
              percent={avgProgress}
              size={100}
              strokeColor={avgProgress >= 80 ? '#52c41a' : avgProgress >= 40 ? '#1890ff' : '#faad14'}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projectDocsList.map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 2,
                    background: doc.overallProgress >= 80 ? '#52c41a' : doc.overallProgress >= 40 ? '#1890ff' : '#faad14',
                  }} />
                  <Text style={{ fontSize: 11 }} ellipsis>{doc.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{doc.overallProgress}%</Text>
                </div>
              ))}
              {projectDocsList.length === 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>暂无关联文档</Text>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'files',
      label: '文件',
      children: (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>关联文档 ({projectDocsList.length})</Text>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              关联文件
            </Button>
          </div>
          {projectDocsList.length > 0 ? (
            groupedByTemplate().map(group => (
              <div key={group.templateId} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 12, color: '#1890ff' }}>{group.templateName}</Text>
                  <Button
                    type="link" size="small" icon={<PlusOutlined />}
                    onClick={() => { setSelectedTemplateId(group.templateId); setAddModalOpen(true); }}
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
                        padding: '8px 10px', border: '1px solid #f0f0f0', borderRadius: 8,
                        marginBottom: 4, cursor: 'pointer',
                        background: selectedDocId === doc.id ? '#e6f7ff' : '#fff',
                      }}
                      onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 12 }}>{version?.fileName || doc.name}</Text>
                        <Space size={4}>
                          <Button
                            type="text" size="small" icon={<ReloadOutlined />}
                            loading={isAnalyzing}
                            onClick={(e) => { e.stopPropagation(); handleAnalyze(doc, false); }}
                            title="基础分析"
                          />
                          <Button
                            type="text" size="small" icon={<ExperimentOutlined />}
                            loading={isAnalyzing}
                            onClick={(e) => { e.stopPropagation(); handleAnalyze(doc, true); }}
                            title="AI 深度分析"
                          />
                          <Popconfirm title="确定删除？" onConfirm={() => deleteProjectDoc(doc.id)}>
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                          </Popconfirm>
                        </Space>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Progress percent={doc.overallProgress} size="small" showInfo={false} style={{ flex: 1, marginBottom: 0 }} />
                        <Text style={{ fontSize: 11, minWidth: 32 }}>{doc.overallProgress}%</Text>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
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
      key: 'tasks',
      label: '进度',
      children: selectedDoc ? (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong style={{ fontSize: 13 }}>{selectedDoc.name}</Text>
            <Space size={4}>
              <Button size="small" icon={<ReloadOutlined />} loading={isAnalyzing} onClick={() => handleAnalyze(selectedDoc, false)}>
                基础分析
              </Button>
              <Button size="small" type="primary" icon={<ExperimentOutlined />} loading={isAnalyzing} onClick={() => handleAnalyze(selectedDoc, true)}>
                AI 分析
              </Button>
            </Space>
          </div>

          {/* 整体进度 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, padding: '10px 12px', background: '#f6f8fa', borderRadius: 8 }}>
            <Progress
              type="circle"
              percent={selectedDoc.overallProgress}
              size={60}
              strokeColor={selectedDoc.overallProgress >= 80 ? '#52c41a' : '#1890ff'}
            />
            <div>
              <Text style={{ fontSize: 12 }}>整体完成度</Text>
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <Text style={{ fontSize: 11, color: '#52c41a' }}>
                  完成 {selectedDoc.sections.filter(s => s.status === 'completed').length}
                </Text>
                <Text style={{ fontSize: 11, color: '#faad14' }}>
                  部分 {selectedDoc.sections.filter(s => s.status === 'partial').length}
                </Text>
                <Text style={{ fontSize: 11, color: '#d9d9d9' }}>
                  缺失 {selectedDoc.sections.filter(s => s.status === 'missing').length}
                </Text>
              </div>
            </div>
          </div>

          {/* 各章节列表 */}
          <List
            size="small"
            dataSource={selectedDoc.sections}
            renderItem={section => (
              <List.Item style={{ padding: '8px 0', border: 'none' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {statusIcon(section.status)}
                    <Text strong style={{ fontSize: 12, flex: 1 }}>{section.title}</Text>
                    <Text type="secondary" style={{ fontSize: 10 }}>{section.wordCount} 字</Text>
                  </div>
                  {section.aiComment && (
                    <div style={{ marginLeft: 22, marginTop: 4, padding: '4px 8px', background: '#f6f8fa', borderRadius: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        <ExperimentOutlined style={{ fontSize: 10, marginRight: 4 }} />
                        {section.aiComment}
                      </Text>
                    </div>
                  )}
                </div>
              </List.Item>
            )}
          />

          {selectedDoc.analyzedAt && (
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 8 }}>
              上次分析：{formatDate(selectedDoc.analyzedAt)}
            </Text>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <ExclamationCircleOutlined style={{ fontSize: 32, color: '#d9d9d9', marginBottom: 12 }} />
          <div>
            <Text type="secondary" style={{ fontSize: 13 }}>请先在"文件"标签中选择一个文档</Text>
          </div>
          {projectDocsList.length === 0 && (
            <Button type="link" size="small" onClick={() => setAddModalOpen(true)} style={{ marginTop: 8 }}>
              关联文件
            </Button>
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
    <div style={{ padding: '16px 20px' }}>
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

      <Tabs items={tabItems} size="small" />
    </div>
  );
};

export default DetailPanel;
