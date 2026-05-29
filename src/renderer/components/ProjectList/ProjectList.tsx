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
  message,
  Space,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { Project, ProjectDocument } from '../../../shared/types';
import ProjectFileExplorer from './ProjectFileExplorer';

const { Text } = Typography;

const fileTypeOptions = [
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'txt', label: '纯文本 (.txt)' },
];

const ProjectList: React.FC = () => {
  const { projects, addProject, setCurrentProject, deleteProject } =
    useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const { workspacePath } = useSettingsStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [browsingProject, setBrowsingProject] = useState<Project | null>(null);
  const [form] = Form.useForm();

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

  if (browsingProject) {
    return <ProjectFileExplorer project={browsingProject} onBack={() => setBrowsingProject(null)} />;
  }

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
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsModalOpen(true)}
        >
          新建项目
        </Button>
      </div>

      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
        dataSource={projects}
        renderItem={(project) => (
          <List.Item>
            <Card
              hoverable
              onClick={() => setCurrentProject(project)}
              actions={[
                <Button
                  type="link"
                  icon={<FolderOpenOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (project.folderPath) {
                      setBrowsingProject(project);
                    } else {
                      message.warning('该项目未关联文件夹');
                    }
                  }}
                >
                  打开
                </Button>,
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProject(project.id);
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
                  percent={project.progress}
                  size="small"
                  style={{ marginTop: 8 }}
                />
              </div>
            </Card>
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
    </div>
  );
};

export default ProjectList;

