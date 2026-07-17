import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  InputNumber,
  Row,
  Select,
  Slider,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { CompositionWeightConfig, PromptScene } from '../../../shared/types';
import { PROMPT_SCENE_LABELS } from '../../../shared/promptScenes';
import {
  WEIGHT_CONSTANTS,
  SCENE_WEIGHT_KEYS,
  getCompositionRules,
  getCompositionSources,
} from '../../utils/promptComposer';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';

const { Title, Text, Paragraph } = Typography;

type WeightKey = keyof CompositionWeightConfig;

const WEIGHT_ITEMS: Array<{ key: WeightKey; title: string; description: string; min?: number; max?: number }> = [
  { key: 'CURRENT_DOCUMENT', title: '\u5f53\u524d\u6587\u6863\u4e8b\u5b9e', description: '\u5f53\u524d\u6253\u5f00\u3001\u9009\u4e2d\u6216\u6b63\u5728\u5904\u7406\u7684\u6587\u6863\u5185\u5bb9' },
  { key: 'TEMPLATE_REQUIREMENT', title: '\u6a21\u677f\u786c\u6027\u8981\u6c42', description: '\u6a21\u677f\u7ae0\u8282\u3001\u683c\u5f0f\u3001\u586b\u5199\u8bf4\u660e\u7b49\u5fc5\u987b\u9075\u5b88\u7684\u7ea6\u675f' },
  { key: 'USER_EXPLICIT_INPUT', title: '\u7528\u6237\u660e\u786e\u8f93\u5165', description: '\u7528\u6237\u5728\u5f53\u524d\u64cd\u4f5c\u4e2d\u8f93\u5165\u7684\u76f4\u63a5\u9700\u6c42' },
  { key: 'USER_CUSTOM_PROMPT', title: '\u7528\u6237\u81ea\u5b9a\u4e49\u63d0\u793a\u8bcd', description: '\u63d0\u793a\u8bcd\u6a21\u677f\u9875\u4fee\u6539\u540e\u4fdd\u5b58\u7684\u81ea\u5b9a\u4e49\u5185\u5bb9' },
  { key: 'STAGE_MEMORY', title: '\u9636\u6bb5\u8bb0\u5fc6', description: '\u5b8c\u6210\u9636\u6bb5\u540e\u7cfb\u7edf\u5b66\u4e60\u5e76\u6c89\u6dc0\u7684\u7ecf\u9a8c' },
  { key: 'SKILL_GLOBAL', title: '\u5168\u5c40 Skill \u6743\u91cd', description: '\u901a\u7528 Skill \u5305\u7684\u5f71\u54cd\u529b' },
  { key: 'SKILL_REPORT', title: '\u62a5\u544a Skill \u6743\u91cd', description: '\u62a5\u544a\u751f\u6210\u7c7b Skill \u5305\u7684\u5f71\u54cd\u529b' },
  { key: 'SKILL_REVIEW', title: '\u5ba1\u6838 Skill \u6743\u91cd', description: '\u5ba1\u67e5\u3001\u5bf9\u6bd4\u7c7b Skill \u5305\u7684\u5f71\u54cd\u529b' },
  { key: 'SKILL_WRITING', title: '\u5199\u4f5c Skill \u6743\u91cd', description: '\u6539\u5199\u3001\u6267\u884c\u5199\u4f5c\u4efb\u52a1\u7c7b Skill \u5305\u7684\u5f71\u54cd\u529b' },
  { key: 'SKILL_MAX_CAP', title: 'Skill \u6743\u91cd\u4e0a\u9650', description: '\u5355\u4e2a Skill \u53ef\u4ee5\u4ea7\u751f\u7684\u6700\u5927\u5f71\u54cd\u529b' },
  { key: 'REFERENCE_MATERIAL', title: '\u53c2\u8003\u6750\u6599', description: '\u5916\u90e8\u53c2\u8003\u6587\u6863\u548c\u7d20\u6750\u7684\u5f71\u54cd\u529b' },
  { key: 'SYSTEM_DEFAULT', title: '\u7cfb\u7edf\u9ed8\u8ba4\u6a21\u677f', description: '\u6ca1\u6709\u81ea\u5b9a\u4e49\u63d0\u793a\u8bcd\u65f6\u7684\u57fa\u7840\u89c4\u5219\u6743\u91cd' },
];

function cloneWeights(weights: CompositionWeightConfig): CompositionWeightConfig {
  return { ...weights };
}

const CompositionSettings: React.FC = () => {
  const [selectedScene, setSelectedScene] = useState<PromptScene>('report');
  const {
    compositionWeights,
    compositionWeightsByScene,
    loadSettings,
    updateCompositionWeightsForScene,
  } = useSettingsStore();
  const [draftWeights, setDraftWeights] = useState<CompositionWeightConfig>(() => cloneWeights(WEIGHT_CONSTANTS));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setDraftWeights(cloneWeights(compositionWeightsByScene[selectedScene] || compositionWeights || WEIGHT_CONSTANTS));
  }, [compositionWeights, compositionWeightsByScene, selectedScene]);

  const isCustom = Boolean(compositionWeightsByScene[selectedScene] || compositionWeights);
  const sceneWeightItems = useMemo(() => WEIGHT_ITEMS.filter(item => SCENE_WEIGHT_KEYS[selectedScene].includes(item.key)), [selectedScene]);
  const rules = useMemo(() => getCompositionRules(selectedScene, draftWeights), [selectedScene, draftWeights]);
  const sources = useMemo(() => getCompositionSources(selectedScene, draftWeights), [selectedScene, draftWeights]);

  const updateWeight = (key: WeightKey, value: number | null) => {
    setDraftWeights(prev => ({ ...prev, [key]: value ?? 0 }));
  };

  const saveCustom = async () => {
    setSaving(true);
    try {
      await updateCompositionWeightsForScene(selectedScene, draftWeights);
      message.success(`已保存 ${PROMPT_SCENE_LABELS[selectedScene]} 的独立权重配置`);
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = async () => {
    setDraftWeights(cloneWeights(WEIGHT_CONSTANTS));
    await updateCompositionWeightsForScene(selectedScene, null);
    message.success(`已恢复 ${PROMPT_SCENE_LABELS[selectedScene]} 的默认权重配置`);
  };

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Space align="center" wrap>
            <Title level={5} style={{ margin: 0 }}>{'\u5408\u6210\u89c4\u5219\u4e0e\u6743\u91cd'}</Title>
            <Tag color={isCustom ? 'blue' : 'default'}>
              {isCustom ? '\u81ea\u5b9a\u4e49\u914d\u7f6e' : '\u9ed8\u8ba4\u914d\u7f6e'}
            </Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
            {'\u6743\u91cd\u51b3\u5b9a\u4e0d\u540c\u6765\u6e90\u5728\u6700\u7ec8\u63d0\u793a\u8bcd\u4e2d\u7684\u5f71\u54cd\u529b\u3002\u4fee\u6539\u540e\u70b9\u51fb\u4fdd\u5b58\uff0c\u7cfb\u7edf\u4f1a\u4f5c\u4e3a\u81ea\u5b9a\u4e49\u914d\u7f6e\u4f7f\u7528\u3002'}
          </Paragraph>
        </div>

        <Alert
          type="info"
          showIcon
          message={'\u5efa\u8bae\uff1a\u5f53\u524d\u6587\u6863\u3001\u6a21\u677f\u8981\u6c42\u548c\u7528\u6237\u660e\u786e\u8f93\u5165\u4e0d\u5efa\u8bae\u8c03\u5f97\u8fc7\u4f4e\uff0c\u5426\u5219 AI \u53ef\u80fd\u88ab Skill \u6216\u53c2\u8003\u6750\u6599\u5e26\u504f\u3002'}
        />

        <Row gutter={[24, 16]}>
          <Col xs={24} xl={13}>
            <Card
              size="small"
              title={'\u6743\u91cd\u914d\u7f6e'}
              extra={(
                <Space wrap>
                  <Button icon={<UndoOutlined />} onClick={() => void resetDefault()}>{'\u6062\u590d\u9ed8\u8ba4'}</Button>
                  <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveCustom()}>{'\u4fdd\u5b58\u81ea\u5b9a\u4e49'}</Button>
                </Space>
              )}
            >
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                {sceneWeightItems.map(item => (
                  <div key={item.key}>
                    <Row gutter={12} align="middle">
                      <Col xs={24} md={8}>
                        <Text strong>{item.title}</Text>
                        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{item.description}</Text>
                      </Col>
                      <Col xs={16} md={12}>
                        <Slider
                          min={item.min ?? 0}
                          max={item.max ?? 120}
                          value={draftWeights[item.key]}
                          onChange={value => updateWeight(item.key, value)}
                        />
                      </Col>
                      <Col xs={8} md={4}>
                        <InputNumber
                          min={item.min ?? 0}
                          max={item.max ?? 120}
                          value={draftWeights[item.key]}
                          onChange={value => updateWeight(item.key, value)}
                          style={{ width: '100%' }}
                        />
                      </Col>
                    </Row>
                  </div>
                ))}
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={11}>
            <Card size="small" title={'\u9884\u89c8\u5f53\u524d\u89c4\u5219'}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ marginRight: 8 }}>{'\u67e5\u770b\u573a\u666f\uff1a'}</Text>
                <Select
                  value={selectedScene}
                  onChange={setSelectedScene}
                  style={{ width: 220 }}
                  options={Object.entries(PROMPT_SCENE_LABELS).map(([value, label]) => ({ value, label }))}
                />
              </div>

              <Text strong style={{ display: 'block', marginBottom: 8 }}>{'\u6743\u91cd\u89c4\u5219'}</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                {rules.map((rule, index) => (
                  <div key={rule} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    backgroundColor: index === 0 ? '#e6f7ff' : index < 3 ? '#f6ffed' : '#fafafa',
                    border: index === 0 ? '1px solid #91d5ff' : index < 3 ? '1px solid #b7eb8f' : '1px solid #f0f0f0',
                  }}>
                    <Tag color={index === 0 ? 'blue' : index < 3 ? 'green' : 'default'} style={{ margin: 0 }}>{index + 1}</Tag>
                    <Text style={{ fontSize: 12 }}>{rule}</Text>
                  </div>
                ))}
              </div>

              <Text strong style={{ display: 'block', marginBottom: 8 }}>{`${PROMPT_SCENE_LABELS[selectedScene]} \u6765\u6e90\u9884\u89c8`}</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sources.map(source => (
                  <div key={`${source.type}-${source.label}`} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    backgroundColor: source.isUsed ? '#f6ffed' : '#fff1f0',
                    border: source.isUsed ? '1px solid #b7eb8f' : '1px solid #ffa39e',
                    opacity: source.isUsed ? 1 : 0.65,
                  }}>
                    <Tag color={source.type === 'system' ? 'default' : source.type === 'user' ? 'green' : source.type === 'skill' ? 'blue' : 'purple'} style={{ margin: 0 }}>
                      {source.type === 'system' ? '\u7cfb\u7edf' : source.type === 'user' ? '\u7528\u6237' : source.type === 'skill' ? 'Skill' : '\u9879\u76ee'}
                    </Tag>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 12 }}>{source.label}</Text>
                      <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>{source.description}</Text>
                    </div>
                    <Tag style={{ margin: 0 }}>{`\u6743\u91cd ${source.weight}`}</Tag>
                    {!source.isUsed && <Tag color="red" style={{ margin: 0 }}>{'\u5df2\u88ab\u8986\u76d6'}</Tag>}
                  </div>
                ))}
              </div>

              {(() => {
                const enabledSkills = useSkillStore.getState().getEnabledByScene(selectedScene);
                const allRules = enabledSkills.flatMap(skill => skill.rules);
                if (allRules.length === 0) return null;
                return (
                  <div style={{ marginTop: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>{'Skill \u589e\u5f3a\u89c4\u5219'}</Text>
                    <div style={{ backgroundColor: '#f5f5f5', padding: 8, borderRadius: 6 }}>
                      {allRules.map((rule, index) => <div key={`${index}-${rule}`} style={{ fontSize: 12, padding: '2px 0' }}>{index + 1}. {rule}</div>)}
                    </div>
                  </div>
                );
              })()}
            </Card>
          </Col>
        </Row>
      </Space>
    </Card>
  );
};

export default CompositionSettings;
