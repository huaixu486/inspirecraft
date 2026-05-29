import React, { useState } from 'react';
import { Typography, Button, Space, Modal, Form, Input, Select, message, Checkbox } from 'antd';
import { PlusOutlined, ImportOutlined } from '@ant-design/icons';
import StatsCards from './StatsCards';
import GanttChart from './GanttChart';
import ProjectTable from './ProjectTable';
import DetailPanel from './DetailPanel';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Project, ProjectDocument } from '../../../shared/types';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import {
  buildProjectStageSegments,
  timelineStageMeta,
  TimelineStageSegment,
} from '../../utils/timelineStages';

const { Text } = Typography;

const fileTypeOptions = [
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'txt', label: '纯文本 (.txt)' },
];

const Overview: React.FC = () => {
  const { currentProject, addProject } = useProjectStore();
  const { templates } = useTemplateStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const { workspacePath } = useSettingsStore();

  // 新建项目
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form] = Form.useForm();
  const projectName = Form.useWatch('name', form);
  const folderPreview = workspacePath && projectName ? `${workspacePath}\\${projectName}` : '';

  // 导入完成阶段选择弹窗
  const [importCompleteOpen, setImportCompleteOpen] = useState(false);
  const [importProject, setImportProject] = useState<Project | null>(null);
  const [importSegments, setImportSegments] = useState<TimelineStageSegment[]>([]);
  const [selectedCompletedStages, setSelectedCompletedStages] = useState<string[]>([]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setIsCreating(true);

      const result = await window.electronAPI.createProjectFolder({
        projectName: values.name,
        workspacePath,
      });
      if (!result.success) {
        message.error(`创建文件夹失败: ${result.error}`);
        return;
      }
      const folderPath = result.folderPath || '';

      const fileResult = await window.electronAPI.createBlankFile({
        folderPath,
        fileName: values.name,
        fileType: values.fileType || 'docx',
      });

      const newProject: Project = {
        id: Date.now().toString(),
        name: values.name,
        description: values.description || '',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addProject(newProject);

      if (values.templateId) {
        const template = templates.find(t => t.id === values.templateId);
        if (template) {
          const doc: ProjectDocument = {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            projectId: newProject.id,
            templateId: values.templateId,
            name: `${values.name}-${template.name}`,
            sections: [],
            overallProgress: 0,
            sourceFilePath: fileResult.filePath,
            sourceFileCreatedAt: new Date().toISOString(),
            sourceFileModifiedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          await addProjectDoc(doc);
        }
      }

      await syncProjectStageFiles(newProject, { projectDocs: useProjectDocStore.getState().projectDocs, addProjectDoc, updateProjectDoc });

      setIsModalOpen(false);
      form.resetFields();
      message.success(fileResult.success ? `项目创建成功，已生成 ${values.name}.${values.fileType || 'docx'}` : '项目创建成功');
    } catch (error) {
      console.error('创建项目失败:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleImport = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (!folderPath) return;

    // 检查是否已导入
    const { projects } = useProjectStore.getState();
    if (projects.some(p => p.folderPath === folderPath)) {
      message.warning('该文件夹已导入为项目');
      return;
    }

    // 用文件夹名作为项目名
    const folderName = folderPath.split(/[/\\]/).pop() || '未命名项目';
    const newProject: Project = {
      id: Date.now().toString(),
      name: folderName,
      description: '',
      folderPath,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addProject(newProject);
    const syncResult = await syncProjectStageFiles(newProject, { projectDocs, addProjectDoc, updateProjectDoc });

    // 检测到阶段文件后，弹窗让用户选择已完成的阶段
    const latestDocs = useProjectDocStore.getState().projectDocs.filter(d => d.projectId === newProject.id);
    const segments = buildProjectStageSegments(newProject, latestDocs, templates, []);

    if (segments.length > 0) {
      setImportProject(newProject);
      setImportSegments(segments);
      setSelectedCompletedStages([]);
      setImportCompleteOpen(true);
    } else {
      message.success(`已导入项目：${folderName}`);
    }
  };

  const handleImportCompleteOk = async () => {
    if (!importProject) return;
    const now = new Date().toISOString();

    // 将用户选中的阶段标记为已完成
    for (const segment of importSegments) {
      if (selectedCompletedStages.includes(segment.stage)) {
        await Promise.all(segment.sourceDocIds.map(id => updateProjectDoc(id, { completedAt: now })));
      }
    }

    const completedCount = selectedCompletedStages.length;
    setImportCompleteOpen(false);
    setImportProject(null);
    setImportSegments([]);
    setSelectedCompletedStages([]);

    message.success(
      completedCount > 0
        ? `已导入项目，${completedCount} 个阶段标记为已完成`
        : '已导入项目',
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left main content */}
      <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
        {/* Top title bar */}
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}>项目总览</div>
            <Text type="secondary" style={{ fontSize: 13 }}>掌控全局，推进每个项目的成功</Text>
          </div>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} style={{ borderRadius: 6 }} onClick={() => setIsModalOpen(true)}>+ 新建项目</Button>
            <Button icon={<ImportOutlined />} style={{ borderRadius: 6 }} onClick={handleImport}>导入项目</Button>
          </Space>
        </div>

        {/* Stats cards */}
        <StatsCards />

        {/* Gantt chart timeline */}
        <div style={{ marginTop: 16 }}>
          <GanttChart />
        </div>

        {/* Project table */}
        <div style={{ marginTop: 16 }}>
          <ProjectTable />
        </div>
      </div>

      {/* Right detail panel */}
      <div style={{
        width: currentProject ? 340 : 0,
        borderLeft: currentProject ? '1px solid #f0f0f0' : 'none',
        overflow: 'hidden',
        background: '#fff',
        transition: 'width 0.2s',
      }}>
        <DetailPanel />
      </div>

      {/* 新建项目弹窗 */}
      <Modal
        title="新建项目"
        open={isModalOpen}
        onOk={handleCreate}
        onCancel={() => { setIsModalOpen(false); form.resetFields(); }}
        okText="创建"
        cancelText="取消"
        confirmLoading={isCreating}
      >
        <Form form={form} layout="vertical" initialValues={{ fileType: 'docx' }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：XX可研报告" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={2} placeholder="简要描述项目内容" />
          </Form.Item>
          <Form.Item name="fileType" label="创建文件类型" rules={[{ required: true, message: '请选择文件类型' }]}>
            <Select options={fileTypeOptions} placeholder="选择要创建的文件类型" />
          </Form.Item>
          <Form.Item name="templateId" label="关联模板（可选）">
            <Select allowClear placeholder="选择模板，用于跟踪文档进度"
              options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.category})` }))} />
          </Form.Item>
          {folderPreview && (
            <Form.Item label="项目文件夹（自动生成）">
              <Text type="secondary" style={{ fontSize: 12 }}>{folderPreview}</Text>
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 导入完成阶段选择弹窗 */}
      <Modal
        title="选择已完成的阶段"
        open={importCompleteOpen}
        onOk={handleImportCompleteOk}
        onCancel={() => { setImportCompleteOpen(false); setImportProject(null); setImportSegments([]); setSelectedCompletedStages([]); }}
        okText="确认"
        cancelText="跳过"
        width={420}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            已识别到以下阶段文件，请选择已经完成的阶段：
          </Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {importSegments.map(segment => {
            const color = timelineStageMeta[segment.stage].color;
            return (
              <div
                key={segment.stage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  background: selectedCompletedStages.includes(segment.stage) ? '#f6ffed' : '#fff',
                }}
              >
                <Checkbox
                  checked={selectedCompletedStages.includes(segment.stage)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedCompletedStages(prev => [...prev, segment.stage]);
                    } else {
                      setSelectedCompletedStages(prev => prev.filter(s => s !== segment.stage));
                    }
                  }}
                />
                <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13 }}>{segment.label}</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {segment.sourceDocNames.join(', ')}
                    </Text>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {importSegments.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>未识别到阶段文件</Text>
        )}
      </Modal>
    </div>
  );
};

export default Overview;

