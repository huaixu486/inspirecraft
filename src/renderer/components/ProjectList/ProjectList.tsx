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
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { Project } from '../../../shared/types';
import ProjectFileExplorer from './ProjectFileExplorer';

const { Text } = Typography;

const ProjectList: React.FC = () => {
  const { projects, addProject, setCurrentProject, deleteProject } =
    useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [browsingProject, setBrowsingProject] = useState<Project | null>(null);
  const [form] = Form.useForm();

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const newProject: Project = {
        id: Date.now().toString(),
        name: values.name,
        description: values.description || '',
        folderPath: values.folderPath || '',
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addProject(newProject);
      await syncProjectStageFiles(newProject, { projectDocs, addProjectDoc, updateProjectDoc });
      setIsModalOpen(false);
      form.resetFields();
      message.success('项目创建成功');
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  const handleSelectFolder = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (folderPath) {
      form.setFieldsValue({ folderPath });
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
        onCancel={() => setIsModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="例如：XX可研报告" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={3} placeholder="简要描述项目内容" />
          </Form.Item>
          <Form.Item name="folderPath" label="项目文件夹">
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="选择项目文件夹" readOnly />
              <Button onClick={handleSelectFolder}>选择</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="status" label="初始状态" initialValue="active">
            <Select>
              <Select.Option value="active">进行中</Select.Option>
              <Select.Option value="paused">暂停</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProjectList;

