import React from 'react';
import { Card, Space, Switch, Typography } from 'antd';
import { FileTextOutlined, RobotOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../stores/settingsStore';

const { Title, Text } = Typography;

const AutomationSettings: React.FC = () => {
  const enabled = useSettingsStore(state => state.autoProjectDescriptionEnabled);
  const updateEnabled = useSettingsStore(state => state.updateAutoProjectDescriptionEnabled);
  const stageMemoryEnabled = useSettingsStore(state => state.autoStageMemoryEnabled);
  const updateStageMemoryEnabled = useSettingsStore(state => state.updateAutoStageMemoryEnabled);

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

      <Card size="small">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
          <Space align="start" size={12}>
            <div style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#f3e8ff', color: '#7c3aed', flexShrink: 0 }}>
              <RobotOutlined />
            </div>
            <div>
              <Text strong>阶段完成后沉淀 AI 写作记忆</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                完成阶段时，仅选择该阶段截至完成时最后修改的一份文档，提炼结构、证据类型、表达方式和验收要点，供后续同类初稿低权重参考。每个阶段文档只沉淀一次；重新打开阶段会释放该记忆资格。
              </Text>
            </div>
          </Space>
          <Switch checked={stageMemoryEnabled} onChange={(checked) => void updateStageMemoryEnabled(checked)} />
        </div>
      </Card>

    </Space>
  );
};

export default AutomationSettings;
