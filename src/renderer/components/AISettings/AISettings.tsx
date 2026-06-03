import React, { useEffect, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Typography,
  message,
  Space,
  Divider,
  Alert,
  InputNumber,
  Avatar,
  Modal,
  Checkbox,
  Spin,
} from 'antd';
import { SaveOutlined, ApiOutlined, FolderOpenOutlined, UserOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { AIConfig, AIModelConfig, AIProvider } from '../../shared/types';
import { useProjectStore } from '../../stores/projectStore';

const { Title, Text, Paragraph } = Typography;

import { useSettingsStore } from '../../stores/settingsStore';

const AISettings: React.FC = () => {
  const [form] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const { projects, addProject } = useProjectStore();
  const {
    workspacePath, updateWorkspacePath,
    workspaceCapacity, updateWorkspaceCapacity,
    userProfile, updateUserProfile,
  } = useSettingsStore();
  const watchedModels = Form.useWatch('models', form) as AIModelConfig[] | undefined;

  const makeDefaultModel = (): AIModelConfig => ({
    id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '默认模型',
    provider: 'custom',
    apiKey: '',
    model: '',
    endpoint: 'https://api.example.com/v1/chat/completions',
    enabled: true,
  });

  const normalizeAIConfig = (value: AIConfig | null): AIConfig => {
    if (value?.models?.length) {
      const models = value.models.map((model: AIModelConfig, index: number) => ({
        ...model,
        id: model.id || `model-${Date.now()}-${index}`,
        name: model.name || model.model || `模型 ${index + 1}`,
        enabled: model.enabled !== false,
      }));
      const activeModelId = value.activeModelId && models.some((m: AIModelConfig) => m.id === value.activeModelId)
        ? value.activeModelId
        : models[0].id;
      return {
        models,
        activeModelId,
        parallelModelIds: value.parallelModelIds?.length ? value.parallelModelIds : [activeModelId],
        multiModelMode: value.multiModelMode || 'single',
      };
    }
    if (value?.provider && value.apiKey && value.model) {
      const model: AIModelConfig = {
        id: 'default',
        name: value.model,
        provider: value.provider,
        apiKey: value.apiKey,
        model: value.model,
        endpoint: value.endpoint,
        enabled: true,
      };
      return { models: [model], activeModelId: model.id, parallelModelIds: [model.id], multiModelMode: 'single' };
    }
    const model = makeDefaultModel();
    return { models: [model], activeModelId: model.id, parallelModelIds: [model.id], multiModelMode: 'single' };
  };

  // 导入文件夹选择弹窗状态
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFolders, setImportFolders] = useState<string[]>([]);
  const [selectedImportFolders, setSelectedImportFolders] = useState<string[]>([]);
  const [pendingNewPath, setPendingNewPath] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (userProfile) {
      profileForm.setFieldsValue(userProfile);
    }
  }, [userProfile]);

  const loadConfig = async () => {
    try {
      const savedConfig = await window.electronAPI.loadAIConfig();
      const normalized = normalizeAIConfig(savedConfig);
      setConfig(normalized);
      form.setFieldsValue(normalized);
    } catch (error) {
      console.error('Failed to load AI config:', error);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const normalized = normalizeAIConfig(values);
      setIsLoading(true);
      await window.electronAPI.saveAIConfig(normalized);
      setConfig(normalized);
      form.setFieldsValue(normalized);
      message.success('AI 配置已保存');
    } catch (error: any) {
      message.error(`保存失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectWorkspace = async () => {
    const newPath = await window.electronAPI.openFolder();
    if (!newPath || newPath === workspacePath) return;

    setIsProcessing(true);

    try {
      // Step 1: 检查旧工作区下是否有已注册的项目文件夹
      if (workspacePath) {
        const projectsToMigrate = projects.filter(p =>
          p.folderPath && p.folderPath.startsWith(workspacePath)
        );

        if (projectsToMigrate.length > 0) {
          const shouldMigrate = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: '迁移项目文件',
              content: `原工作区包含 ${projectsToMigrate.length} 个已添加的项目文件夹，是否迁移到新位置？`,
              okText: '迁移',
              cancelText: '不迁移',
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });

          if (shouldMigrate) {
            let migrated = 0;
            for (const project of projectsToMigrate) {
              const folderName = project.folderPath.split(/[/\\]/).pop();
              const dest = `${newPath}\\${folderName}`;
              const moveResult = await window.electronAPI.moveFolder({ src: project.folderPath, dest });
              if (moveResult.success) {
                // 更新项目的 folderPath
                const { updateProject } = useProjectStore.getState();
                await updateProject(project.id, { folderPath: dest });
                migrated++;
              }
            }
            message.success(`已迁移 ${migrated} 个项目文件夹`);
          }
        }
      }

      // Step 2: 检查新工作区是否已有文件夹（排除已注册的项目）
      const newResult = await window.electronAPI.listWorkspaceFolders(newPath);
      const existingFolderPaths = new Set(projects.map(p => p.folderPath));
      const newFolders = newResult.success
        ? newResult.folders.filter(f => !existingFolderPaths.has(`${newPath}\\${f}`))
        : [];
      if (newFolders.length > 0) {
        // 弹窗询问如何处理
        const action = await new Promise<'import' | 'delete' | 'cancel'>((resolve) => {
          Modal.confirm({
            title: '新工作区已有文件',
            content: `新工作区已包含 ${newFolders.length} 个未导入的文件夹，如何处理？`,
            okText: '导入为项目',
            cancelText: '取消',
            footer: (_, { OkBtn, CancelBtn }) => (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button danger onClick={() => { Modal.destroyAll(); resolve('delete'); }}>
                  删除
                </Button>
                <CancelBtn />
                <OkBtn />
              </div>
            ),
            onOk: () => resolve('import'),
            onCancel: () => resolve('cancel'),
          });
        });

        if (action === 'cancel') {
          setIsProcessing(false);
          return;
        }

        if (action === 'delete') {
          let deleted = 0;
          for (const folder of newFolders) {
            const folderPath = `${newPath}\\${folder}`;
            const delResult = await window.electronAPI.deleteFolder(folderPath);
            if (delResult.success) deleted++;
          }
          message.success(`已删除 ${deleted} 个文件夹`);
        }

        if (action === 'import') {
          // 打开选择弹窗
          setPendingNewPath(newPath);
          setImportFolders(newFolders);
          setSelectedImportFolders(newFolders); // 默认全选
          setImportModalOpen(true);
          setIsProcessing(false);
          return;
        }
      }

      // Step 3: 更新路径
      await updateWorkspacePath(newPath);
      message.success('工作区路径已更新');
    } catch (error) {
      console.error('切换工作区失败:', error);
      message.error('操作失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmImport = async () => {
    setIsProcessing(true);
    let imported = 0;
    for (const folder of selectedImportFolders) {
      const folderPath = `${pendingNewPath}\\${folder}`;
      // 检查是否已经导入过（根据 folderPath 去重）
      const alreadyImported = projects.some(p => p.folderPath === folderPath);
      if (alreadyImported) continue;

      const newProject = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        name: folder,
        description: '',
        folderPath,
        status: 'active' as const,
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addProject(newProject);
      imported++;
    }

    // 删除未选中的文件夹
    const unselectedFolders = importFolders.filter(f => !selectedImportFolders.includes(f));
    for (const folder of unselectedFolders) {
      const folderPath = `${pendingNewPath}\\${folder}`;
      await window.electronAPI.deleteFolder(folderPath);
    }

    await updateWorkspacePath(pendingNewPath);
    setImportModalOpen(false);
    setIsProcessing(false);
    message.success(`已导入 ${imported} 个项目，工作区路径已更新`);
  };

  const handleCancelImport = async () => {
    // 取消 = 不导入、不删除、不更新路径
    setImportModalOpen(false);
    setPendingNewPath('');
    setImportFolders([]);
    setSelectedImportFolders([]);
    message.info('已取消切换工作区');
  };

  const handleSaveProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      await updateUserProfile(values);
      message.success('个人信息已保存');
    } catch (error: any) {
      if (error.errorFields) return; // form validation
      message.error(`保存失败: ${error.message}`);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const avatar = reader.result as string;
      const current = profileForm.getFieldsValue();
      const profile = { ...current, avatar };
      profileForm.setFieldsValue({ avatar });
      await updateUserProfile(profile);
      message.success('头像已更新');
    };
    reader.readAsDataURL(file);
  };

  const handleTest = async () => {
    try {
      setIsTesting(true);
      const formValues = await form.validateFields();
      const values = normalizeAIConfig(formValues);
      const result = await window.electronAPI.callAI({
        prompt: '你好，请回复"连接成功"',
        modelId: values.activeModelId,
        modelIds: values.parallelModelIds,
        mode: values.multiModelMode,
        config: values,
      });
      message.success(`测试成功: ${result.substring(0, 50)}...`);
    } catch (error: any) {
      message.error(`测试失败: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestModel = async (modelIndex: number) => {
    try {
      setTestingModelId(`model-${modelIndex}`);
      const formValues = await form.validateFields();
      const values = normalizeAIConfig(formValues);
      const model = values.models[modelIndex];
      if (!model) {
        message.error('模型配置不存在');
        return;
      }
      const result = await window.electronAPI.callAI({
        prompt: '你好，请回复"连接成功"',
        modelId: model.id,
        config: { ...values, models: [model], activeModelId: model.id },
      });
      message.success(`[${model.name || model.model}] 测试成功: ${result.substring(0, 50)}...`);
    } catch (error: any) {
      message.error(`测试失败: ${error.message}`);
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
    <div>
      <Title level={4}>设置</Title>

      {/* Workspace settings */}
      <Card style={{ marginBottom: 16 }}>
        <Title level={5}>通用设置</Title>
        <div style={{ marginBottom: 16 }}>
          <Text strong>项目工作区路径</Text>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            新建项目时，项目文件夹将自动创建在此路径下。
          </Paragraph>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={workspacePath}
              readOnly
              placeholder="未设置"
            />
            <Button icon={<FolderOpenOutlined />} onClick={handleSelectWorkspace} loading={isProcessing}>
              更改
            </Button>
          </Space.Compact>
        </div>
        <div>
          <Text strong>工作区容量上限</Text>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            设置工作区的最大存储空间，侧边栏将实时显示用量。
          </Paragraph>
          <Space>
            <InputNumber
              min={1}
              max={10240}
              value={workspaceCapacity}
              onChange={(v) => v && updateWorkspaceCapacity(v)}
              addonAfter="GB"
              style={{ width: 160 }}
            />
          </Space>
        </div>
      </Card>

      {/* User profile */}
      <Card style={{ marginBottom: 16 }}>
        <Title level={5}>个人信息</Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          设置后将显示在侧边栏左下角。
        </Paragraph>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ position: 'relative' }}>
            {userProfile?.avatar ? (
              <Avatar size={64} src={userProfile.avatar} />
            ) : (
              <Avatar size={64} icon={<UserOutlined />} style={{ background: '#f5f5f5' }} />
            )}
            <label style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 22, height: 22, borderRadius: '50%',
              background: '#1890ff', color: '#fff', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', border: '2px solid #fff',
            }}>
              +
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: 500 }}>{userProfile?.nickname || '未登录'}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{userProfile?.email || '未设置邮箱'}</Text>
          </div>
        </div>
        <Form form={profileForm} layout="vertical">
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="输入昵称" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="输入邮箱地址" />
          </Form.Item>
          <Form.Item name="avatar" hidden>
            <Input />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveProfile}>
              保存个人信息
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* AI settings */}
      <Title level={4}>AI 设置</Title>
      <Paragraph type="secondary">
        配置 AI API 密钥，用于文档摘要生成、审查建议等功能。
      </Paragraph>

      <Card>
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16 }}>
            <Form.Item
              name="activeModelId"
              label="默认模型"
              rules={[{ required: true, message: '请选择默认模型' }]}
            >
              <Select placeholder="选择默认模型" options={modelOptions} />
            </Form.Item>
            <Form.Item name="multiModelMode" label="调用模式" initialValue="single">
              <Select
                options={[
                  { value: 'single', label: '单模型调用' },
                  { value: 'parallel', label: '多模型并行输出' },
                ]}
              />
            </Form.Item>
            <Form.Item name="parallelModelIds" label="并行模型">
              <Select
                mode="multiple"
                placeholder="选择参与并行输出的模型"
                options={modelOptions}
              />
            </Form.Item>
          </div>

          <Form.List name="models">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text strong>模型配置</Text>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => add(makeDefaultModel())}
                  >
                    添加模型
                  </Button>
                </div>

                {fields.map((field, index) => {
                  const model = watchedModels?.[field.name];
                  const provider = model?.provider as AIProvider | undefined;
                  return (
                    <Card
                      key={field.key}
                      size="small"
                      style={{ marginBottom: 12, background: '#fbfdff' }}
                      title={`模型 ${index + 1}`}
                      extra={
                        <Space>
                          <Button
                            size="small"
                            icon={<ApiOutlined />}
                            loading={testingModelId === `model-${index}`}
                            onClick={() => handleTestModel(index)}
                          >
                            测试
                          </Button>
                          <Form.Item name={[field.name, 'enabled']} valuePropName="checked" style={{ margin: 0 }}>
                            <Checkbox>启用</Checkbox>
                          </Form.Item>
                          <Button
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                            disabled={fields.length <= 1}
                          />
                        </Space>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 1fr', gap: 12 }}>
                        <Form.Item
                          name={[field.name, 'name']}
                          label="显示名称"
                          rules={[{ required: true, message: '请输入显示名称' }]}
                        >
                          <Input placeholder="例如：DeepSeek R1 / GPT-4o / 本地模型" />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'provider']}
                          label="提供商"
                          rules={[{ required: true, message: '请选择提供商' }]}
                        >
                          <Select
                            options={[
                              { value: 'custom', label: '自定义 API' },
                              { value: 'openai', label: 'OpenAI' },
                              { value: 'claude', label: 'Claude' },
                            ]}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'model']}
                          label="模型名称"
                          rules={[{ required: true, message: '请输入模型名称' }]}
                        >
                          <Input placeholder="例如：deepseek-chat、gpt-4o、claude-3-5-sonnet-latest" />
                        </Form.Item>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Form.Item
                          name={[field.name, 'apiKey']}
                          label="API Key"
                          rules={[{ required: true, message: '请输入 API Key' }]}
                        >
                          <Input.Password placeholder="输入该模型的 API Key" />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'endpoint']}
                          label={provider === 'claude' ? 'Claude 端点（可选）' : 'API 端点'}
                          rules={provider === 'custom' ? [{ required: true, message: '请输入 API 端点' }] : []}
                        >
                          <Input placeholder={provider === 'claude' ? 'https://api.anthropic.com/v1/messages' : 'https://api.example.com/v1/chat/completions'} />
                        </Form.Item>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>

          <Divider />

          <Form.Item>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={isLoading}
              >
                保存配置
              </Button>
              <Button
                icon={<ApiOutlined />}
                onClick={handleTest}
                loading={isTesting}
                disabled={!config}
              >
                测试连接
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Title level={5}>使用说明</Title>
        <ul>
          <li>
            <Text strong>Claude</Text>: 访问 <Text code>console.anthropic.com</Text> 获取 API Key
          </li>
          <li>
            <Text strong>OpenAI</Text>: 访问 <Text code>platform.openai.com</Text> 获取 API Key
          </li>
          <li>
            <Text strong>自定义</Text>: 支持任何兼容 OpenAI 格式的 API 端点
          </li>
        </ul>

        <Alert
          message="安全提示"
          description="API Key 将保存在本地配置文件中，请勿分享或泄露。"
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      </Card>

      {/* 导入文件夹选择弹窗 */}
      <Modal
        title="选择要导入的文件夹"
        open={importModalOpen}
        onOk={handleConfirmImport}
        onCancel={handleCancelImport}
        okText={`导入选中 (${selectedImportFolders.length})`}
        cancelText="取消切换"
        confirmLoading={isProcessing}
        width={480}
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          以下文件夹将导入为项目。未选中的文件夹将被删除。
        </Paragraph>
        <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
          <Checkbox
            checked={selectedImportFolders.length === importFolders.length}
            indeterminate={selectedImportFolders.length > 0 && selectedImportFolders.length < importFolders.length}
            onChange={(e) => setSelectedImportFolders(e.target.checked ? [...importFolders] : [])}
            style={{ marginBottom: 8, fontWeight: 500 }}
          >
            全选
          </Checkbox>
          <Divider style={{ margin: '8px 0' }} />
          {importFolders.map((folder) => (
            <div key={folder} style={{ padding: '4px 0' }}>
              <Checkbox
                checked={selectedImportFolders.includes(folder)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedImportFolders(prev => [...prev, folder]);
                  } else {
                    setSelectedImportFolders(prev => prev.filter(f => f !== folder));
                  }
                }}
              >
                {folder}
              </Checkbox>
            </div>
          ))}
        </div>
      </Modal>

      {/* 全局加载遮罩 */}
      {isProcessing && !importModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(255,255,255,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <Spin size="large" tip="处理中..." />
        </div>
      )}
    </div>
  );
};

export default AISettings;
