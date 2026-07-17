import React, { useState } from 'react';
import { Card, Button, Typography, message, Space, Tag, Switch, InputNumber, Modal, Input, Alert, Popconfirm, Select, Form, Divider, Descriptions } from 'antd';
import { PlusOutlined, DeleteOutlined, EyeOutlined, ImportOutlined } from '@ant-design/icons';
import { PromptScene, SkillPackage } from '../../../shared/types';
import { PROMPT_SCENE_LABELS } from '../../../shared/promptScenes';
import { useSkillStore } from '../../stores/skillStore';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const SkillSettings: React.FC = () => {
  const { skills, importSkill, importExternalSkill, deleteSkill, setEnabled, setWeight } = useSkillStore();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  // 表单模式
  const [formMode, setFormMode] = useState<'form' | 'json'>('form');
  const [form] = Form.useForm();

  const handleImportJson = async () => {
    setImportError('');
    try {
      const parsed = JSON.parse(importJson);
      if (!parsed.id || !parsed.name || !parsed.version || !Array.isArray(parsed.type) || !parsed.prompts) {
        setImportError('JSON 缺少必需字段：id, name, version, type, prompts');
        return;
      }
      await doImport(parsed);
    } catch (err: any) {
      setImportError(err.message || 'JSON 解析失败');
    }
  };

  const handleImportForm = async () => {
    try {
      const values = await form.validateFields();
      const prompts: Partial<Record<PromptScene, string>> = {};
      for (const scene of values.scenes) {
        const promptKey = `prompt_${scene}`;
        if (values[promptKey]) {
          prompts[scene as PromptScene] = values[promptKey];
        }
      }
      if (Object.keys(prompts).length === 0) {
        message.warning('请至少填写一个场景的提示词');
        return;
      }
      await doImport({
        id: values.id,
        name: values.name,
        version: values.version || '1.0.0',
        type: values.scenes,
        scope: values.scope || 'global',
        weight: values.weight ?? 50,
        prompts,
        rules: values.rules ? values.rules.split('\n').filter((r: string) => r.trim()) : [],
      });
    } catch (err: any) {
      if (err.errorFields) return; // form validation error
      message.error('导入失败：' + (err.message || String(err)));
    }
  };

  const doImport = async (parsed: any) => {
    const pkg: SkillPackage = {
      id: parsed.id,
      name: parsed.name,
      version: parsed.version,
      type: parsed.type,
      scope: parsed.scope || 'global',
      weight: parsed.weight ?? 50,
      enabled: parsed.enabled ?? true,
      prompts: parsed.prompts || {},
      rules: parsed.rules || [],
      importedAt: new Date().toISOString(),
    };
    await importSkill(pkg);
    setImportModalOpen(false);
    setImportJson('');
    form.resetFields();
    message.success(`已导入 Skill 包：${pkg.name}`);
  };

  const openImportModal = () => {
    setImportModalOpen(true);
    setImportError('');
    setFormMode('form');
    form.resetFields();
  };

  const handleImportExternal = async () => {
    const result = await importExternalSkill();
    if (result.cancelled) return;
    if (!result.success) {
      message.error(result.error || '导入外部 Skill 包失败');
      return;
    }
    message.success(`已导入外部 Skill 包：${result.pkg?.name || ''}`);
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>Skill 包管理</Title>
            <Text type="secondary">Skill 包可以为特定场景的 AI 提示词添加额外指导，增强写作、审查等能力</Text>
          </div>
          <Space>
            <Button icon={<ImportOutlined />} onClick={() => void handleImportExternal}>导入外部包</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openImportModal}>添加 Skill 包</Button>
          </Space>
        </div>

        {skills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#999' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
            <div style={{ fontSize: 14 }}>暂无 Skill 包</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>点击上方按钮添加，为 AI 提示词注入专业能力</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {skills.map(pkg => (
              <Card key={pkg.id} size="small" style={{ border: pkg.enabled ? undefined : '1px dashed #d9d9d9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text strong>{pkg.name}</Text>
                      <Tag>v{pkg.version}</Tag>
                      {pkg.type.map(t => <Tag key={t} color="blue">{PROMPT_SCENE_LABELS[t] || t}</Tag>)}
                      {!pkg.enabled && <Tag color="red">已禁用</Tag>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>权重：{pkg.weight}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>规则：{pkg.rules.length} 条</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>导入：{new Date(pkg.importedAt).toLocaleDateString()}</Text>
                    </div>
                  </div>
                  <Space>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>启用</Text>
                      <Switch checked={pkg.enabled} onChange={(checked) => setEnabled(pkg.id, checked)} size="small" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>权重</Text>
                      <InputNumber value={pkg.weight} min={0} max={100} size="small" style={{ width: 56 }}
                        onChange={(val) => val !== null && setWeight(pkg.id, val)} />
                    </div>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => {
                      Modal.info({
                        title: `Skill 包详情：${pkg.name}`, width: 600,
                        content: (
                          <div>
                            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
                              <Descriptions.Item label="版本">v{pkg.version}</Descriptions.Item>
                              <Descriptions.Item label="作用范围">{pkg.scope === 'global' ? '全局' : '项目'}</Descriptions.Item>
                              <Descriptions.Item label="适用场景">{pkg.type.map(t => PROMPT_SCENE_LABELS[t]).join('、')}</Descriptions.Item>
                            </Descriptions>
                            {Object.entries(pkg.prompts).map(([scene, prompt]) => (
                              <div key={scene} style={{ marginBottom: 12 }}>
                                <Tag color="blue" style={{ marginBottom: 4 }}>{PROMPT_SCENE_LABELS[scene as PromptScene] || scene}</Tag>
                                <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{prompt}</div>
                              </div>
                            ))}
                            {pkg.rules.length > 0 && (
                              <div>
                                <Text strong>规则：</Text>
                                <ul style={{ marginTop: 4 }}>{pkg.rules.map((r, i) => <li key={i} style={{ fontSize: 13 }}>{r}</li>)}</ul>
                              </div>
                            )}
                          </div>
                        ),
                      });
                    }} />
                    <Popconfirm title="确定删除此 Skill 包？" onConfirm={() => deleteSkill(pkg.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* 添加 Skill 包弹窗 */}
      <Modal
        title="添加 Skill 包"
        open={importModalOpen}
        onOk={formMode === 'form' ? handleImportForm : handleImportJson}
        onCancel={() => { setImportModalOpen(false); setImportJson(''); setImportError(''); form.resetFields(); }}
        okText="添加" cancelText="取消" width={640}
      >
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button type={formMode === 'form' ? 'primary' : 'default'} size="small" onClick={() => setFormMode('form')}>表单填写</Button>
            <Button type={formMode === 'json' ? 'primary' : 'default'} size="small" icon={<ImportOutlined />} onClick={() => setFormMode('json')}>导入 JSON</Button>
          </Space>
        </div>

        {formMode === 'form' ? (
          <Form form={form} layout="vertical" initialValues={{ version: '1.0.0', scope: 'global', weight: 50 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item name="name" label="Skill 包名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：可研报告写作包" />
              </Form.Item>
              <Form.Item name="id" label="唯一标识" rules={[{ required: true, message: '请输入标识' }]}>
                <Input placeholder="如：feasibility-report-pack" />
              </Form.Item>
              <Form.Item name="version" label="版本号">
                <Input placeholder="1.0.0" />
              </Form.Item>
              <Form.Item name="weight" label="权重（0-100，越高越优先）">
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Form.Item name="scenes" label="适用场景" rules={[{ required: true, message: '请选择至少一个场景' }]}>
              <Select mode="multiple" placeholder="选择此 Skill 包适用的场景"
                options={Object.entries(PROMPT_SCENE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.scenes !== cur.scenes}>
              {({ getFieldValue }) => {
                const scenes: PromptScene[] = getFieldValue('scenes') || [];
                return scenes.map(scene => (
                  <Form.Item key={scene} name={`prompt_${scene}`} label={`${PROMPT_SCENE_LABELS[scene]} — 附加提示词`}>
                    <TextArea rows={3} placeholder={`为"${PROMPT_SCENE_LABELS[scene]}"场景添加额外指导...`} />
                  </Form.Item>
                ));
              }}
            </Form.Item>
            <Divider style={{ margin: '12px 0' }} />
            <Form.Item name="rules" label="增强规则（每行一条）">
              <TextArea rows={3} placeholder={'不要替代模板硬性章节\n不要复制范文事实'} />
            </Form.Item>
          </Form>
        ) : (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              粘贴 Skill 包的 JSON 内容。适用于从他人分享的文件中导入。
            </Paragraph>
            {importError && <Alert message={importError} type="error" showIcon style={{ marginBottom: 12 }} />}
            <TextArea value={importJson} onChange={e => { setImportJson(e.target.value); setImportError(''); }} rows={14}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder={`{\n  "id": "my-skill-pack",\n  "name": "我的 Skill 包",\n  "version": "1.0.0",\n  "type": ["report", "review"],\n  "weight": 55,\n  "prompts": {\n    "report": "生成报告时强调..."\n  },\n  "rules": ["不要替代模板硬性章节"]\n}`} />
          </>
        )}
      </Modal>
    </>
  );
};

export default SkillSettings;
