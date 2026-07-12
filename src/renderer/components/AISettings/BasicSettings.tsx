import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Select, Button, Typography, message, Space, InputNumber,
  Avatar, Divider, Alert, Progress, Switch, Modal, Checkbox, Tag,
} from 'antd';
import { FolderOpenOutlined, UserOutlined } from '@ant-design/icons';
import { HolidayDataSource } from '../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';

const { Title, Text, Paragraph } = Typography;

const BasicSettings: React.FC = () => {
  const [profileForm] = Form.useForm();
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [migrationTargetPath, setMigrationTargetPath] = useState('');
  const [migrationProjects, setMigrationProjects] = useState<Array<{
    id: string;
    name: string;
    folderPath: string;
    folderName: string;
    exists: boolean;
  }>>([]);
  const [selectedMigrationIds, setSelectedMigrationIds] = useState<string[]>([]);
  const [preparingMigration, setPreparingMigration] = useState(false);
  const [migratingWorkspace, setMigratingWorkspace] = useState(false);
  const {
    workspacePath, updateWorkspacePath,
    workspaceCapacity, updateWorkspaceCapacity,
    recycleBinRetentionDays, updateRecycleBinRetentionDays,
    workspaceUsedBytes, refreshWorkspaceUsed,
    userProfile, updateUserProfile,
    enableSystemNotifications, updateSystemNotifications,
    holidayDataSource, holidayApiUrl, updateHolidaySettings,
  } = useSettingsStore();

  const formatStorageSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  };

  const workspaceLimitBytes = Math.max(1, workspaceCapacity || 0) * 1024 * 1024 * 1024;
  const workspaceUsagePercent = Math.min(100, Math.round((workspaceUsedBytes / workspaceLimitBytes) * 100));
  const workspaceUsageStatus = workspaceUsagePercent >= 90 ? 'exception' : workspaceUsagePercent >= 75 ? 'active' : 'normal';

  useEffect(() => {
    void refreshWorkspaceUsed();
  }, []);

  useEffect(() => {
    if (userProfile) {
      profileForm.setFieldsValue(userProfile);
    }
  }, [userProfile]);

  const handleHolidaySourceChange = async (source: HolidayDataSource) => {
    await updateHolidaySettings({ source });
    message.success('节假日数据源已更新');
  };

  const handleSelectFolder = async () => {
    const result = await window.electronAPI.openFolder();
    if (!result || result === workspacePath) return;

    setPreparingMigration(true);
    try {
      const preview = await window.electronAPI.listWorkspaceMigrationProjects({ sourceWorkspacePath: workspacePath });
      if (!preview.success) {
        message.error(preview.error || '无法读取原工作区的项目记录');
        return;
      }
      const projects = preview.projects || [];
      if (projects.length === 0) {
        await updateWorkspacePath(result);
        void refreshWorkspaceUsed();
        message.success('工作区路径已更新');
        return;
      }
      setMigrationTargetPath(result);
      setMigrationProjects(projects);
      setSelectedMigrationIds(projects.map(project => project.id));
      setMigrationModalOpen(true);
    } finally {
      setPreparingMigration(false);
    }
  };

  const handleConfirmWorkspaceMigration = async () => {
    setMigratingWorkspace(true);
    try {
      const result = await window.electronAPI.migrateWorkspaceProjects({
        sourceWorkspacePath: workspacePath,
        targetWorkspacePath: migrationTargetPath,
        projectIds: selectedMigrationIds,
      });
      if (!result.success) {
        message.error(result.error || '工作区迁移失败');
        return;
      }

      await updateWorkspacePath(migrationTargetPath);
      await Promise.all([
        useProjectStore.getState().loadProjects(),
        useProjectStore.getState().loadVersions(),
        useProjectDocStore.getState().loadProjectDocs(),
        useTaskStore.getState().loadTasks(),
        useTemplateStore.getState().loadTemplates(),
        useTemplateStore.getState().loadReviews(),
        useKnowledgeStore.getState().loadKnowledge(),
      ]);
      const projectState = useProjectStore.getState();
      const currentProjectId = projectState.currentProject?.id;
      projectState.setCurrentProject(
        currentProjectId ? projectState.projects.find(project => project.id === currentProjectId) || null : null,
      );
      void refreshWorkspaceUsed();
      setMigrationModalOpen(false);
      const migratedCount = result.migratedProjectIds?.length || 0;
      if (result.failed?.length) {
        message.warning(`已迁移 ${migratedCount} 个项目；${result.failed.length} 个项目未迁移，已从新列表中移除。`);
      } else {
        message.success(`工作区已更新，已迁移 ${migratedCount} 个项目。`);
      }
    } finally {
      setMigratingWorkspace(false);
    }
  };

  return (
    <>
      {/* 工作区设置 */}
      <Card>
        <Title level={5}>工作区设置</Title>
        <Form layout="vertical">
          <Form.Item label="工作区路径">
            <Space.Compact style={{ width: '100%' }}>
              <Input value={workspacePath} readOnly />
              <Button icon={<FolderOpenOutlined />} loading={preparingMigration} onClick={handleSelectFolder}>
                更改路径
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label={`工作区容量限制（GB）— 已使用 ${formatStorageSize(workspaceUsedBytes)}`}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <InputNumber
                value={workspaceCapacity}
                onChange={(val) => val && updateWorkspaceCapacity(val)}
                min={1}
                max={1000}
                style={{ width: '100%' }}
              />
              <Progress
                percent={workspaceUsagePercent}
                status={workspaceUsageStatus}
                size="small"
                format={() => `${formatStorageSize(workspaceUsedBytes)} / ${workspaceCapacity} GB`}
              />
            </Space>
          </Form.Item>
          <Form.Item label="回收站自动清理">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <InputNumber
                value={recycleBinRetentionDays}
                onChange={(value) => value && void updateRecycleBinRetentionDays(value)}
                min={1}
                max={365}
                addonAfter="天"
                style={{ width: 180 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                删除的文件和文件夹会保留在工作区回收站中，并计入工作区已用容量；最长可保留一年。
              </Text>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Modal
        title="迁移工作区项目"
        open={migrationModalOpen}
        closable={!migratingWorkspace}
        maskClosable={!migratingWorkspace}
        onCancel={() => !migratingWorkspace && setMigrationModalOpen(false)}
        footer={[
          <Button key="cancel" disabled={migratingWorkspace} onClick={() => setMigrationModalOpen(false)}>取消</Button>,
          <Button key="confirm" type="primary" loading={migratingWorkspace} onClick={() => void handleConfirmWorkspaceMigration()}>
            迁移已选项目（{selectedMigrationIds.length}）
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="项目文件夹和关联记录会一起迁移"
          description="默认全选。取消勾选的项目不会迁入新工作区，并会从迁移后的项目列表中移除。"
        />
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>原工作区</Text>
          <Text ellipsis={{ tooltip: workspacePath }} style={{ display: 'block' }}>{workspacePath}</Text>
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>新工作区</Text>
          <Text ellipsis={{ tooltip: migrationTargetPath }} style={{ display: 'block' }}>{migrationTargetPath}</Text>
        </div>
        <Checkbox
          checked={migrationProjects.length > 0 && selectedMigrationIds.length === migrationProjects.length}
          indeterminate={selectedMigrationIds.length > 0 && selectedMigrationIds.length < migrationProjects.length}
          disabled={migratingWorkspace}
          onChange={(event) => setSelectedMigrationIds(event.target.checked ? migrationProjects.map(project => project.id) : [])}
        >
          全选可迁移项目（{migrationProjects.length}）
        </Checkbox>
        <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8, border: '1px solid #edf1f5', borderRadius: 8 }}>
          {migrationProjects.map(project => (
            <div key={project.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #f1f5f9' }}>
              <Checkbox
                checked={selectedMigrationIds.includes(project.id)}
                disabled={migratingWorkspace}
                onChange={(event) => setSelectedMigrationIds(current => event.target.checked
                  ? [...current, project.id]
                  : current.filter(id => id !== project.id))}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text strong ellipsis={{ tooltip: project.name }} style={{ display: 'block' }}>{project.name}</Text>
                <Text type="secondary" ellipsis={{ tooltip: project.folderPath }} style={{ display: 'block', fontSize: 12 }}>{project.folderPath}</Text>
              </div>
              {project.exists ? <Tag color="green">可迁移</Tag> : <Tag color="orange">文件夹缺失</Tag>}
            </div>
          ))}
        </div>
      </Modal>

      {/* 通知设置 */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5}>通知设置</Title>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text>启用系统通知</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              开启后将在任务完成、文件接收等事件时显示 Windows 系统通知
            </Text>
          </div>
          <Switch
            checked={enableSystemNotifications}
            onChange={updateSystemNotifications}
          />
        </div>
      </Card>

      {/* 日历与节假日 */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5}>日历与节假日</Title>
        <Form layout="vertical">
          <Form.Item label="节假日数据源">
            <Select
              value={holidayDataSource || 'auto'}
              onChange={handleHolidaySourceChange}
              options={[
                { value: 'auto', label: '自动（推荐）' },
                { value: 'online', label: '在线 API' },
                { value: 'local', label: '本地数据' },
              ]}
            />
          </Form.Item>
          {holidayDataSource === 'online' && (
            <Form.Item label="节假日 API URL">
              <Input
                value={holidayApiUrl}
                onChange={(e) => updateHolidaySettings({ apiUrl: e.target.value })}
                placeholder="https://timor.tech/api/holiday/year/{year}"
              />
            </Form.Item>
          )}
        </Form>
      </Card>

      {/* 个人信息 */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5}>个人信息</Title>
        <Form
          form={profileForm}
          layout="vertical"
          onFinish={async (values) => {
            await updateUserProfile(values);
            message.success('个人信息已保存');
          }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <Avatar size={64} icon={<UserOutlined />} src={userProfile?.avatar} />
            <div style={{ flex: 1 }}>
              <Form.Item name="nickname" label="昵称">
                <Input placeholder="请输入昵称" />
              </Form.Item>
              <Form.Item name="email" label="邮箱">
                <Input placeholder="请输入邮箱" />
              </Form.Item>
            </div>
          </div>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存</Button>
          </Form.Item>
        </Form>
      </Card>
    </>
  );
};

export default BasicSettings;
