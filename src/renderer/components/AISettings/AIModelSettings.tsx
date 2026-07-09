import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, Select, Button, Typography, message, Space,
  InputNumber, Checkbox, Alert,
} from 'antd';
import { SaveOutlined, ApiOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { AIConfig, AIModelConfig, AIProvider } from '../../../shared/types';
import { isAIJobCancelledError, useAIJobStore } from '../../stores/aiJobStore';

const { Title, Text, Paragraph } = Typography;

interface Props {
  config: AIConfig | null;
  onConfigChange: (config: AIConfig) => void;
}

const AIModelSettings: React.FC<Props> = ({ config, onConfigChange }) => {
  const [form] = Form.useForm();
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);

  const watchedModels = Form.useWatch('models', form) as AIModelConfig[] | undefined;
  const watchedMultiModelMode = Form.useWatch('multiModelMode', form) as AIConfig['multiModelMode'] | undefined;
  const watchedParallelModelIds = Form.useWatch('parallelModelIds', form) as string[] | undefined;
  const selectedParallelCount = (watchedParallelModelIds || []).length;

  useEffect(() => {
    if (config) {
      form.setFieldsValue(config);
    }
  }, [config]);

  const normalizeAIConfig = (c: any): AIConfig => ({
    models: Array.isArray(c?.models) ? c.models : [],
    activeModelId: c?.activeModelId || '',
    multiModelMode: c?.multiModelMode || 'single',
    parallelModelIds: Array.isArray(c?.parallelModelIds) ? c.parallelModelIds : [],
  });

  const makeDefaultModel = (): AIModelConfig => ({
    id: `model-${Date.now()}`,
    name: '',
    provider: 'openai' as AIProvider,
    apiKey: '',
    model: '',
    endpoint: '',
    enabled: true,
  });

  const handleSave = async (values: any) => {
    setIsLoading(true);
    try {
      const normalized = normalizeAIConfig(values);
      await window.electronAPI.saveAIConfig(normalized);
      onConfigChange(normalized);
      message.success('AI 配置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      await useAIJobStore.getState().runAIJob<string>(
        {
          scene: 'general',
          title: '测试 AI 连接',
          resultPreview: (value) => value,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(40);
          const value = await window.electronAPI.callAI({ prompt: '你好，请回复"连接成功"' });
          throwIfCancelled();
          setProgress(90);
          return String(value || '');
        },
      );
      message.success('AI 连接正常');
    } catch (error: any) {
      if (isAIJobCancelledError(error)) {
        message.info('已取消 AI 连接测试');
      } else {
        message.error('连接失败：' + (error.message || String(error)));
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestModel = async (index: number) => {
    setTestingModelId(`model-${index}`);
    try {
      await useAIJobStore.getState().runAIJob<string>(
        {
          scene: 'general',
          title: `测试模型连接：${watchedModels?.[index]?.name || watchedModels?.[index]?.model || index + 1}`,
          resultPreview: (value) => value,
        },
        async ({ setProgress, throwIfCancelled }) => {
          setProgress(40);
          const value = await window.electronAPI.callAI({
            prompt: '你好，请回复"连接成功"',
            modelId: watchedModels?.[index]?.id,
          });
          throwIfCancelled();
          setProgress(90);
          return String(value || '');
        },
      );
      message.success('模型连接正常');
    } catch (error: any) {
      message.error('连接失败：' + (error.message || String(error)));
    } finally {
      setTestingModelId(null);
    }
  };

  const modelOptions = (watchedModels || []).map(model => ({
    value: model.id,
    label: `${model.name || model.model || '未命名模型'}${model.enabled === false ? '（已停用）' : ''}`,
    disabled: model.enabled === false,
  }));

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Title level={5}>AI 模型配置</Title>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item label="多模型模式" name="multiModelMode">
            <Select
              options={[
                { value: 'single', label: '单模型调用' },
                { value: 'parallel', label: '多模型并行' },
              ]}
            />
          </Form.Item>

          {watchedMultiModelMode === 'parallel' && (
            <Card size="small" style={{ marginBottom: 16, background: '#f6ffed' }}>
              <Title level={5}>并行模型选择</Title>
              <Paragraph type="secondary">选择参与并行调用的模型（至少 2 个）。</Paragraph>
              <Form.Item name="parallelModelIds">
                <Select mode="multiple" options={modelOptions} placeholder="选择并行模型" />
              </Form.Item>
              {selectedParallelCount > 0 && selectedParallelCount < 2 && (
                <Alert type="warning" showIcon message="至少需要选择 2 个模型才能启用并行模式" />
              )}
            </Card>
          )}

          {watchedMultiModelMode === 'parallel' && selectedParallelCount >= 2 && (
            <Card size="small" style={{ marginBottom: 16, background: '#e6f7ff' }}>
              <Title level={5}>综合结果模型</Title>
              <Form.Item name="activeModelId">
                <Select options={modelOptions} placeholder="选择综合模型（可选）" allowClear />
              </Form.Item>
            </Card>
          )}

          {watchedMultiModelMode !== 'parallel' && (
            <Card size="small" style={{ marginBottom: 16, background: '#f6ffed' }}>
              <Title level={5}>默认模型</Title>
              <Form.Item name="activeModelId">
                <Select options={modelOptions} placeholder="选择默认模型" />
              </Form.Item>
            </Card>
          )}

          <Form.List name="models">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text strong>模型配置</Text>
                  <Button icon={<PlusOutlined />} onClick={() => add(makeDefaultModel())}>添加模型</Button>
                </div>
                {fields.map((field, index) => {
                  const model = watchedModels?.[field.name];
                  const provider = model?.provider as AIProvider | undefined;
                  return (
                    <Card
                      key={field.key} size="small"
                      style={{ marginBottom: 12, background: '#fbfdff' }}
                      title={`模型 ${index + 1}`}
                      extra={
                        <Space>
                          <Button size="small" icon={<ApiOutlined />} loading={testingModelId === `model-${index}`} onClick={() => handleTestModel(index)}>测试</Button>
                          <Form.Item name={[field.name, 'enabled']} valuePropName="checked" style={{ margin: 0 }}><Checkbox>启用</Checkbox></Form.Item>
                          <Button danger size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                        </Space>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'name']} label="显示名称"><Input placeholder="我的模型" /></Form.Item>
                        <Form.Item name={[field.name, 'provider']} label="提供商">
                          <Select options={[{ value: 'claude', label: 'Claude' }, { value: 'openai', label: 'OpenAI' }, { value: 'custom', label: '自定义' }]} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'apiKey']} label="API Key"><Input.Password placeholder="sk-..." /></Form.Item>
                        <Form.Item name={[field.name, 'model']} label="模型名称"><Input placeholder={provider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o'} /></Form.Item>
                        {provider === 'custom' && (
                          <Form.Item name={[field.name, 'endpoint']} label="自定义端点" style={{ gridColumn: '1 / -1' }}><Input placeholder="https://api.example.com/v1/chat/completions" /></Form.Item>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>

          <Form.Item style={{ marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={isLoading}>保存配置</Button>
              <Button onClick={handleTest} loading={isTesting}>测试连接</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Title level={5}>使用说明</Title>
        <ul>
          <li><Text strong>Claude</Text>: 访问 <Text code>console.anthropic.com</Text> 获取 API Key</li>
          <li><Text strong>OpenAI</Text>: 访问 <Text code>platform.openai.com</Text> 获取 API Key</li>
          <li><Text strong>自定义</Text>: 支持任何兼容 OpenAI 格式的 API 端点</li>
        </ul>
        <Alert message="安全提示" description="API Key 将保存在本地配置文件中，请勿分享或泄露。" type="warning" showIcon style={{ marginTop: 16 }} />
      </Card>
    </>
  );
};

export default AIModelSettings;
