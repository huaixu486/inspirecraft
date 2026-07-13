import React, { useState } from 'react';
import {
  Card,
  Button,
  List,
  Tag,
  Progress,
  Modal,
  Form,
  Input,
  Select,
  Checkbox,
  Dropdown,
  message,
  Space,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  ImportOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  FileZipOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { buildProjectStageSegments, getAllStages, getStageMeta, getGlobalStageProgress as calcProjectProgress, TimelineStageSegment, StageConfig } from '../../utils/timelineStages';
import { Project, ProjectDocument } from '../../../shared/types';

const { Text } = Typography;

const fileTypeOptions = [
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'txt', label: '纯文本 (.txt)' },
];

interface Props {
  onEnterProject: (project: Project) => void;
}

const ProjectList: React.FC<Props> = ({ onEnterProject }) => {
  const { projects, addProject, deleteProject, versions } =
    useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const { workspacePath, customStages } = useSettingsStore();
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  // 使用统一的进度计算函数
  const getProjectProgress = (projectId: string): number => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return 0;
    return calcProjectProgress(
      project,
      projectDocs.filter(d => d.projectId === projectId),
      templates,
      versions.filter(v => v.projectId === projectId),
      allStages,
    );
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [form] = Form.useForm();

  // 导入项目相关
  const [importCompleteOpen, setImportCompleteOpen] = useState(false);
  const [importProject, setImportProject] = useState<Project | null>(null);
  const [importSegments, setImportSegments] = useState<TimelineStageSegment[]>([]);
  const [selectedCompletedStages, setSelectedCompletedStages] = useState<string[]>([]);

  const projectName = Form.useWatch('name', form);
  const folderPreview = workspacePath && projectName
    ? `${workspacePath}\\${projectName}`
    : '';

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setIsCreating(true);

      // 在 workspace 中自动创建项目文件夹
      const result = await window.electronAPI.createProjectFolder({
        projectName: values.name,
        workspacePath,
      });

      if (!result.success) {
        message.error(`创建文件夹失败: ${result.error}`);
        return;
      }

      const folderPath = result.folderPath || '';

      // 创建初始文件
      const fileResult = await window.electronAPI.createBlankFile({
        folderPath,
        fileName: values.name,
        fileType: values.fileType || 'docx',
      });

      const newProject: Project = {
        id: Date.now().toString(),
        name: values.name,
        description: values.description || '',
        descriptionSource: values.description?.trim() ? 'manual' : 'auto',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await addProject(newProject);

      // 如果选择了模板，自动创建 ProjectDocument
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

      await syncProjectStageFiles(newProject, {
        allStages,
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
      });

      setIsModalOpen(false);
      form.resetFields();

      if (fileResult.success) {
        message.success(`项目创建成功，已生成 ${values.name}.${values.fileType || 'docx'}`);
      } else {
        message.success('项目创建成功');
      }
    } catch (error) {
      console.error('创建项目失败:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleImportFromFolder = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (!folderPath) return;

    const { projects } = useProjectStore.getState();
    if (projects.some(p => p.folderPath === folderPath)) {
      message.warning('该文件夹已导入为项目');
      return;
    }

    const folderName = folderPath.split(/[/\\]/).pop() || '未命名项目';
    const newProject: Project = {
      id: Date.now().toString(),
      name: folderName,
      description: '',
      descriptionSource: 'auto',
      folderPath,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addProject(newProject);
    await syncProjectStageFiles(newProject, { allStages, projectDocs, templates, addProjectDoc, updateProjectDoc });

    const latestDocs = useProjectDocStore.getState().projectDocs.filter(d => d.projectId === newProject.id);
    const segments = buildProjectStageSegments(newProject, latestDocs, templates, [], allStages);

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

  const handleImportFromZip = async () => {
    const zipPath = await window.electronAPI.openZipFile();
    if (!zipPath) return;

    const result = await window.electronAPI.importFromZip({
      zipPath,
      workspacePath,
    });

    if (!result.success) {
      message.error(`导入失败: ${result.error}`);
      return;
    }

    if (result.project) {
      await useProjectStore.getState().loadProjects();

      const projects = useProjectStore.getState().projects;
      const importedProject = projects.find(p => p.id === result.project.id);
      if (importedProject) {
        await syncProjectStageFiles(importedProject, {
          allStages,
          projectDocs: useProjectDocStore.getState().projectDocs,
          templates,
          addProjectDoc,
          updateProjectDoc,
        });

        const latestDocs = useProjectDocStore.getState().projectDocs.filter(
          d => d.projectId === importedProject.id
        );
        const segments = buildProjectStageSegments(
          importedProject, latestDocs, templates, [], allStages
        );

        if (segments.length > 0) {
          setImportProject(importedProject);
          setImportSegments(segments);
          setSelectedCompletedStages([]);
          setImportCompleteOpen(true);
        } else {
          message.success(`已导入项目：${importedProject.name}`);
        }
      } else {
        message.success('项目已导入');
      }
    }
  };

  const handleExportZip = async (project: Project) => {
    if (!project.folderPath) {
      message.warning('该项目未关联文件夹，无法导出');
      return;
    }

    const savePath = await window.electronAPI.saveZipFile(project.name);
    if (!savePath) return;

    const docs = useProjectDocStore.getState().projectDocs.filter(
      d => d.projectId === project.id
    );

    const result = await window.electronAPI.exportZip({
      project,
      savePath,
      projectDocs: docs,
    });

    if (result.success) {
      message.success(`项目已导出到: ${savePath}`);
    } else {
      message.error(`导出失败: ${result.error}`);
    }
  };

  const statusColors = {
    active: 'green',
    completed: 'blue',
    paused: 'orange',
  };

  const statusLabels = {
    active: '进行中',
    completed: '已完成',
    paused: '已暂停',
  };

  // 拖入文件到项目卡片：导入到项目文件夹
  const handleDropToProject = async (event: React.DragEvent<HTMLDivElement>, project: Project) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverProjectId(null);
    if (!project.folderPath) return;
    if (!event.dataTransfer.types.includes('Files')) return;
    const filePaths = Array.from(event.dataTransfer.files)
      .map(file => (file as any).path as string | undefined)
      .filter(Boolean) as string[];
    if (filePaths.length === 0) return;
    const result = await window.electronAPI.importFiles({ folderPath: project.folderPath, filePaths });
    if (!result.success) {
      message.error(result.error || '导入失败');
      return;
    }
    const imported = result.files || [];
    if (imported.length > 0) {
      message.success(`已导入 ${imported.length} 个文件到「${project.name}」`);
      await syncProjectStageFiles(project, {
        allStages,
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
      });
    }
  };

  const handleDragOverProject = (event: React.DragEvent<HTMLDivElement>, project: Project) => {
    if (!project.folderPath) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOverProjectId(project.id);
  };

  const handleDragLeaveProject = (event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as HTMLElement;
    if (related && event.currentTarget.contains(related)) return;
    setDragOverProjectId(null);
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 18 }}>
          我的项目
        </Text>
        <Space size={8}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsModalOpen(true)}
          >
            新建项目
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'folder', icon: <FolderOpenOutlined />, label: '从文件夹导入' },
                { key: 'zip', icon: <FileZipOutlined />, label: '从 ZIP 导入' },
              ],
              onClick: ({ key }) => {
                if (key === 'folder') handleImportFromFolder();
                else if (key === 'zip') handleImportFromZip();
              },
            }}
          >
            <Button icon={<ImportOutlined />}>导入</Button>
          </Dropdown>
        </Space>
      </div>

      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
        dataSource={projects}
        renderItem={(project) => (
          <List.Item>
            <div
              onDragOver={(e) => handleDragOverProject(e, project)}
              onDragLeave={handleDragLeaveProject}
              onDrop={(e) => handleDropToProject(e, project)}
              style={{
                borderRadius: 12,
                border: dragOverProjectId === project.id ? '2px dashed #1890ff' : '2px solid transparent',
                background: dragOverProjectId === project.id ? '#f0f7ff' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
            <Card
              hoverable
              onDoubleClick={() => onEnterProject(project)}
              actions={[
                <Button
                  type="link"
                  icon={<ExportOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportZip(project);
                  }}
                >
                  导出
                </Button>,
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteProject(project.id)
                      .then(() => message.success('项目已移入回收站'))
                      .catch((error: Error) => message.error(error.message || '删除项目失败'));
                  }}
                >
                  删除
                </Button>,
              ]}
            >
              <Card.Meta
                title={project.name}
                description={project.description || '暂无描述'}
              />
              <div style={{ marginTop: 12 }}>
                <Space>
                  <Tag color={statusColors[project.status]}>
                    {statusLabels[project.status]}
                  </Tag>
                </Space>
                <Progress
                  percent={getProjectProgress(project.id)}
                  size="small"
                  style={{ marginTop: 8 }}
                />
              </div>
            </Card>
            </div>
          </List.Item>
        )}
      />

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
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="例如：XX可研报告" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={2} placeholder="简要描述项目内容" />
          </Form.Item>
          <Form.Item
            name="fileType"
            label="创建文件类型"
            rules={[{ required: true, message: '请选择文件类型' }]}
          >
            <Select options={fileTypeOptions} placeholder="选择要创建的文件类型" />
          </Form.Item>
          <Form.Item name="templateId" label="关联模板（可选）">
            <Select
              allowClear
              placeholder="选择模板，用于跟踪文档进度"
              options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.category})` }))}
            />
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
            const color = stageMeta[segment.stage].color;
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

export default ProjectList;
