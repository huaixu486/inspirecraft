import React from 'react';
import { Alert, Card, Space, Switch, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../stores/settingsStore';

const { Title, Text } = Typography;

const AutomationSettings: React.FC = () => {
  const enabled = useSettingsStore(state => state.autoProjectDescriptionEnabled);
  const updateEnabled = useSettingsStore(state => state.updateAutoProjectDescriptionEnabled);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={5} style={{ margin: 0 }}>自动化</Title>
        <Text type="secondary">控制项目后台自动处理，不影响手动操作。</Text>
      </div>

      <Card size="small">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
          <Space align="start" size={12}>
            <div style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#e6f4ff', color: '#1677ff', flexShrink: 0 }}>
              <FileTextOutlined />
            </div>
            <div>
              <Text strong>AI 自动编写项目概述</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                项目文件不少于 2 个且连续 3 天无更新时，仅为未手动填写概述的项目生成一次简短概述。
              </Text>
            </div>
          </Space>
          <Switch checked={enabled} onChange={(checked) => void updateEnabled(checked)} />
        </div>
      </Card>

      <Alert
        type="info"
        showIcon
        message={enabled ? '已开启：后续满足条件的项目会按既有规则自动生成概述。' : '已关闭：不会扫描文件活动，也不会发起项目概述 AI 请求。'}
        description="关闭不会清除已有概述或修改用户手动填写的内容；重新开启后只处理之后检测到的文件活动。"
      />
    </Space>
  );
};

export default AutomationSettings;
