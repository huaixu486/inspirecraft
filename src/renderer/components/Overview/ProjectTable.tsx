import React, { useMemo, useState } from 'react';
import { Card, Table, Tag, Progress, Typography, Space, Button, Dropdown, Modal, Form, Input, message } from 'antd';
import {
  FolderOutlined, CalendarOutlined, WarningOutlined, ExclamationCircleOutlined,
  PlusOutlined, FolderOpenOutlined, FileZipOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTemplateStore } from '../../stores/templateStore';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';
import { getAllStages, getStageMeta, detectTimelineStage, getGlobalStageProgress } from '../../utils/timelineStages';
import type { ProjectDocument } from '../../../shared/types';
import type { StageConfig } from '../../utils/timelineStages';
import { Project } from '../../../shared/types';

const { Text } = Typography;

interface Props {
  onEnterProject: (project: Project, initialTab?: string) => void;
}

const ProjectTable: React.FC<Props> = ({ onEnterProject }) => {
  const { projects, versions, addProject } = useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const { templates } = useTemplateStore();
  const { workspacePath, customStages } = useSettingsStore();
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

  // 按更新时间降序排序
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [projects],
  );

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const result = await window.electronAPI.createProjectFolder({
        projectName: values.name,
        workspacePath,
      });
      if (!result.success) {
        message.error(`创建失败: ${result.error}`);
        return;
      }
      const folderPath = result.folderPath || '';
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
      await syncProjectStageFiles(newProject, {
        allStages,
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
      });
      setCreateModalOpen(false);
      form.resetFields();
      message.success(`项目「${values.name}」创建成功`);
    } catch (error) {
      console.error('创建项目失败:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleImportFromFolder = async () => {
    const folderPath = await window.electronAPI.openFolder();
    if (!folderPath) return;
    if (projects.some(p => p.folderPath === folderPath)) {
      message.warning('该文件夹已导入为项目');
      return;
    }
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
    await syncProjectStageFiles(newProject, { allStages, projectDocs, templates, addProjectDoc, updateProjectDoc });
    message.success(`已导入项目：${folderName}`);
  };

  const handleImportFromZip = async () => {
    const zipPath = await window.electronAPI.openZipFile();
    if (!zipPath) return;
    const result = await window.electronAPI.importFromZip({ zipPath, workspacePath });
    if (result.success) {
      const folderPath = result.project?.folderPath || '';
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
      await syncProjectStageFiles(newProject, { allStages, projectDocs, templates, addProjectDoc, updateProjectDoc });
      message.success(`已导入项目：${folderName}`);
    } else {
      message.error(result.error || '导入失败');
    }
  };

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space size={8}>
          <FolderOutlined style={{ color: '#1890ff', fontSize: 16 }} />
          <Text strong style={{ fontSize: 13 }}>{name}</Text>
        </Space>
      ),
    },
    {
      title: '阶段',
      key: 'stage',
      width: 110,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id);
        const stage = detectTimelineStage(allStages, ...docs.map(d => d.name));
        const meta = stageMeta[stage];
        return <Tag color={meta?.color || '#8c8c8c'}>{meta?.label || stage}</Tag>;
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 180,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id);
        const avg = getGlobalStageProgress(
          record,
          docs,
          templates,
          versions.filter(v => v.projectId === record.id),
          allStages,
        );
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={avg}
              size="small"
              showInfo={false}
              strokeColor={avg >= 80 ? '#52c41a' : avg >= 50 ? '#1890ff' : avg >= 30 ? '#faad14' : '#ff4d4f'}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Text style={{ fontSize: 12, color: '#666', minWidth: 32 }}>{avg}%</Text>
          </div>
        );
      },
    },
    {
      title: '截止日期',
      key: 'deadline',
      width: 150,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id && d.deadline);
        if (docs.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>未设置</Text>;

        const now = new Date();
        const latest = docs.reduce((max, d) => {
          const dl = new Date(d.deadline!);
          return dl > max ? dl : max;
        }, new Date(0));

        // 判断逾期/即将逾期（与 GanttChart 一致）
        const hasTime = latest.getHours() !== 0 || latest.getMinutes() !== 0 || latest.getSeconds() !== 0;
        let isOverdue = false;
        let isAboutToExpire = false;
        const hasCompleted = docs.some(d => d.completedAt);
        if (!hasCompleted) {
          if (hasTime) {
            isOverdue = latest < now;
            isAboutToExpire = !isOverdue && now >= new Date(latest.getTime() - 24 * 60 * 60 * 1000);
          } else {
            isOverdue = (latest.getFullYear() < now.getFullYear())
              || (latest.getFullYear() === now.getFullYear() && latest.getMonth() < now.getMonth())
              || (latest.getFullYear() === now.getFullYear() && latest.getMonth() === now.getMonth() && latest.getDate() < now.getDate());
            isAboutToExpire = !isOverdue && latest.getFullYear() === now.getFullYear() && latest.getMonth() === now.getMonth() && latest.getDate() === now.getDate();
          }
        }

        const statusColor = isOverdue ? '#ff4d4f' : isAboutToExpire ? '#faad14' : '#999';
        return (
          <Space size={4}>
            {isOverdue && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />}
            {isAboutToExpire && <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 12 }} />}
            <CalendarOutlined style={{ color: statusColor, fontSize: 12 }} />
            <Text style={{ fontSize: 12, color: statusColor }}>
              {latest.toLocaleDateString('zh-CN')}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '下一步计划',
      key: 'nextPlan',
      render: (_: any, record: Project) => (
        <Text type="secondary" ellipsis style={{ maxWidth: 200, fontSize: 12 }}>
          {record.description || '暂无计划'}
        </Text>
      ),
    },
  ];

  return (
    <>
    <Card
      className="dashboard-card project-table-card animate-slide-up stagger-4"
      title="项目列表"
      bordered={false}
      style={{}}
      extra={
        <Space size={4}>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
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
            <Button size="small">导入 ▾</Button>
          </Dropdown>
        </Space>
      }
    >
      <Table
        className="overview-project-table"
        columns={columns}
        dataSource={sortedProjects}
        rowKey="id"
        pagination={false}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: '100%' }}
        locale={{
          emptyText: (
            <div style={{ padding: '40px 0', color: '#94a3b8' }}>
              <FolderOutlined style={{ fontSize: 36, marginBottom: 12, display: 'block', opacity: 0.4 }} />
              <div style={{ fontSize: 14 }}>暂无项目</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>点击右上角创建或导入项目</div>
            </div>
          ),
        }}
        onRow={(record) => ({
          onClick: () => onEnterProject(record),
          onDoubleClick: () => onEnterProject(record, 'files'),
          style: { cursor: 'pointer' },
        })}
        rowClassName={(record) =>
          record.id === useProjectStore.getState().currentProject?.id ? 'ant-table-row-selected' : ''
        }
      />
    </Card>

    <Modal
      title="新建项目"
      open={createModalOpen}
      onOk={handleCreate}
      onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
      okText="创建"
      cancelText="取消"
      confirmLoading={creating}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input placeholder="例如：XX可行性研究项目" />
        </Form.Item>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={2} placeholder="可选" />
        </Form.Item>
      </Form>
    </Modal>
    </>
  );
};

export default ProjectTable;
