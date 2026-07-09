import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Select, Button, Typography, message, Space, InputNumber,
  Avatar, Divider, Alert, Progress, Switch,
} from 'antd';
import { FolderOpenOutlined, UserOutlined } from '@ant-design/icons';
import { HolidayDataSource } from '../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';

const { Title, Text, Paragraph } = Typography;

const BasicSettings: React.FC = () => {
  const [profileForm] = Form.useForm();
  const {
    workspacePath, updateWorkspacePath,
    workspaceCapacity, updateWorkspaceCapacity,
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
    if (result) {
      await updateWorkspacePath(result);
      void refreshWorkspaceUsed();
      message.success('工作区路径已更新');
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
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectFolder}>
                选择
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
        </Form>
      </Card>

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
