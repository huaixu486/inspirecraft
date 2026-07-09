import React, { useEffect, useState } from 'react';
import { Typography, Tabs, message } from 'antd';
import {
  SettingOutlined, RobotOutlined, FileTextOutlined, AppstoreOutlined, BranchesOutlined,
} from '@ant-design/icons';
import { AIConfig } from '../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { usePromptStore } from '../../stores/promptStore';
import { useSkillStore } from '../../stores/skillStore';
import BasicSettings from './BasicSettings';
import AIModelSettings from './AIModelSettings';
import PromptSettings from './PromptSettings';
import SkillSettings from './SkillSettings';
import CompositionSettings from './CompositionSettings';

const { Title } = Typography;

const AISettings: React.FC = () => {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const { loadTemplates } = usePromptStore();
  const { loadSkills } = useSkillStore();

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const savedConfig = await window.electronAPI.loadAIConfig();
        setConfig(savedConfig || { models: [], activeModelId: '', multiModelMode: 'single', parallelModelIds: [] });
      } catch (error) {
        console.error('Failed to load AI config:', error);
      }
    };
    void loadConfig();
    void loadTemplates();
    void loadSkills();
  }, []);

  const tabItems = [
    {
      key: 'basic',
      label: <span><SettingOutlined /> 基础设置</span>,
      children: <BasicSettings />,
    },
    {
      key: 'ai-model',
      label: <span><RobotOutlined /> AI 模型</span>,
      children: <AIModelSettings config={config} onConfigChange={setConfig} />,
    },
    {
      key: 'prompt',
      label: <span><FileTextOutlined /> 提示词模板</span>,
      children: <PromptSettings />,
    },
    {
      key: 'skill',
      label: <span><AppstoreOutlined /> Skill 包</span>,
      children: <SkillSettings />,
    },
    {
      key: 'composition',
      label: <span><BranchesOutlined /> 合成规则</span>,
      children: <CompositionSettings />,
    },
  ];

  return (
    <div>
      <Title level={4}>设置</Title>
      <Tabs items={tabItems} defaultActiveKey="basic" />
    </div>
  );
};

export default AISettings;
