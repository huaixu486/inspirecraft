import React, { useEffect, useState } from 'react';
import {
  Card,
  Button,
  List,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Tag,
  message,
  Empty,
  Popconfirm,
  Spin,
  Divider,
  ColorPicker,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileTextOutlined,
  ImportOutlined,
  LockOutlined,
} from '@ant-design/icons';
import { useTemplateStore } from '../../stores/templateStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { WritingTemplate, TemplateNode, StageConfig } from '../../shared/types';
import { getAllStages, DEFAULT_STAGES } from '../../utils/timelineStages';
import { syncProjectStageFiles } from '../../utils/autoStageDocs';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ==================== 标题提取逻辑 ====================

// 检测标题行
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /^([一二三四五六七八九十十一十二]+[、.．）\)]|第[一-龥]{1,4}[章节部篇]|[\d]+[、.．）\)]|[\(（][\d一-龥]+[）\)])\s*\S/.test(trimmed);
}

// 推断层级
function inferLevel(line: string): number {
  const trimmed = line.trim();
  // 一、二、三、 → level 1
  if (/^[一二三四五六七八九十十一十二]+[、.．）\)]/.test(trimmed)) return 1;
  // 第X章 → level 1
  if (/^第[一-龥]{1,4}[章节部篇]/.test(trimmed)) return 1;
  // 1. 2. 3. → level 2
  if (/^[\d]+[、.．）\)]/.test(trimmed)) {
    // 1.1 → level 2, 1.1.1 → level 3
    const dots = trimmed.match(/^[\d]+(\.[\d]+)+/);
    if (dots) return dots[0].split('.').length + 1;
    return 2;
  }
  // (一) （1） → level 2
  if (/^[\(（][\d一-龥]+[）\)]/.test(trimmed)) return 2;
  return 1;
}

// 从文档内容提取章节结构为 TemplateNode[]（保留各章节内容）
function extractTemplateNodes(content: string): TemplateNode[] {
  const lines = content.split('\n');

  // 第一步：识别标题行及其位置
  const headingPositions: { lineIndex: number; title: string; level: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isHeadingLine(lines[i])) {
      headingPositions.push({ lineIndex: i, title: lines[i].trim(), level: inferLevel(lines[i]) });
    }
  }

  // 第二步：提取每个标题下方的内容
  const headingContents: { title: string; level: number; description: string }[] = [];
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i].lineIndex + 1;
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1].lineIndex : lines.length;
    const contentLines = lines.slice(start, end).filter(l => l.trim().length > 0);
    headingContents.push({
      title: headingPositions[i].title,
      level: headingPositions[i].level,
      description: contentLines.join('\n').trim(),
    });
  }

  // 第三步：构建树结构
  const nodes: TemplateNode[] = [];
  let idCounter = 0;

  for (const h of headingContents) {
    idCounter++;
    const node: TemplateNode = {
      id: String(idCounter),
      title: h.title,
      level: h.level,
      isRequired: true,
      description: h.description || undefined,
    };

    if (h.level === 1) {
      nodes.push(node);
    } else {
      const parent = nodes[nodes.length - 1];
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        nodes.push(node);
      }
    }
  }
  return nodes;
}

const TemplateManager: React.FC = () => {
  const { templates, loadTemplates, addTemplate, updateTemplate, deleteTemplate } = useTemplateStore();
  const { customStages, addStage, updateStage, deleteStage } = useSettingsStore();
  const { projects } = useProjectStore();
  const { projectDocs, addProjectDoc, updateProjectDoc } = useProjectDocStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WritingTemplate | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [importedFilePath, setImportedFilePath] = useState<string>('');
  const [form] = Form.useForm();

  // 阶段管理状态
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<StageConfig | null>(null);
  const [stageForm] = Form.useForm();
  const allStages = getAllStages(customStages);

  // 模板结构编辑器状态
  const [templateNodes, setTemplateNodes] = useState<TemplateNode[]>([]);

  // 已使用的颜色（排除用于颜色选择器）
  const usedColors = allStages.map(s => s.color);

  // 模板结构编辑器操作
  const addTemplateNode = () => {
    const newNode: TemplateNode = {
      id: Date.now().toString(),
      title: '',
      level: 1,
      isRequired: true,
    };
    setTemplateNodes([...templateNodes, newNode]);
  };

  const removeTemplateNode = (id: string) => {
    setTemplateNodes(templateNodes.filter(n => n.id !== id));
  };

  const updateTemplateNode = (id: string, updates: Partial<TemplateNode>) => {
    setTemplateNodes(templateNodes.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const moveTemplateNode = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= templateNodes.length) return;
    const newNodes = [...templateNodes];
    [newNodes[index], newNodes[newIndex]] = [newNodes[newIndex], newNodes[index]];
    setTemplateNodes(newNodes);
  };

  // 从 JSON 字符串解析节点
  const parseNodesFromJson = (json: string): TemplateNode[] => {
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  };

  // 打开弹窗时初始化节点
  const initTemplateNodes = (template: WritingTemplate | null) => {
    if (template?.nodes) {
      setTemplateNodes(template.nodes);
    } else {
      setTemplateNodes([
        { id: '1', title: '一、项目概述', level: 1, isRequired: true },
        { id: '2', title: '二、需求分析', level: 1, isRequired: true },
        { id: '3', title: '三、方案设计', level: 1, isRequired: true },
      ]);
    }
  };

  // 重新扫描所有项目的阶段文件
  const resyncAllProjects = async (stages: StageConfig[]) => {
    let totalMatched = 0;
    for (const project of projects) {
      if (!project.folderPath) continue;
      const result = await syncProjectStageFiles(project, {
        projectDocs: useProjectDocStore.getState().projectDocs,
        templates,
        addProjectDoc,
        updateProjectDoc,
        allStages: stages,
      });
      totalMatched += result.matched;
    }
    if (totalMatched > 0) {
      message.info(`已重新扫描，匹配到 ${totalMatched} 个阶段文件`);
    }
  };

  const handleCreateStage = () => {
    setEditingStage(null);
    stageForm.resetFields();
    stageForm.setFieldsValue({ color: '#1890ff' });
    setIsStageModalOpen(true);
  };

  const handleEditStage = (stage: StageConfig) => {
    setEditingStage(stage);
    stageForm.setFieldsValue({
      name: stage.name,
      keywords: stage.keywords.join(', '),
      color: stage.color,
    });
    setIsStageModalOpen(true);
  };

  const handleDeleteStage = async (id: string) => {
    await deleteStage(id);
    message.success('阶段已删除');
    // 阶段删除后重新扫描
    const updatedStages = getAllStages(customStages.filter(s => s.id !== id));
    await resyncAllProjects(updatedStages);
  };

  const handleStageSubmit = async () => {
    try {
      const values = await stageForm.validateFields();
      const keywords = values.keywords
        ? values.keywords.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean)
        : [];

      // 检查名称是否与已有阶段重复
      const exists = allStages.some(s =>
        s.name === values.name && s.id !== editingStage?.id
      );
      if (exists) {
        message.error('阶段名称已存在');
        return;
      }

      const color = typeof values.color === 'string' ? values.color : values.color?.toHexString?.() || '#1890ff';

      if (editingStage) {
        await updateStage(editingStage.id, {
          name: values.name,
          keywords,
          color,
        });
        message.success('阶段已更新');
      } else {
        const newStage: StageConfig = {
          id: `custom-${Date.now()}`,
          name: values.name,
          keywords,
          color,
          isSystem: false,
        };
        await addStage(newStage);
        message.success('阶段已创建');
      }

      setIsStageModalOpen(false);

      // 阶段变更后重新扫描所有项目
      const updatedStages = getAllStages(
        editingStage
          ? customStages.map(s => s.id === editingStage.id ? { ...s, name: values.name, keywords, color } : s)
          : [...customStages, { id: `custom-${Date.now()}`, name: values.name, keywords, color, isSystem: false }]
      );
      await resyncAllProjects(updatedStages);
    } catch (error) {
      console.error('Stage submit error:', error);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleCreate = () => {
    setEditingTemplate(null);
    setImportedFilePath('');
    form.resetFields();
    initTemplateNodes(null);
    setIsModalOpen(true);
  };

  const handleEdit = (template: WritingTemplate) => {
    setEditingTemplate(template);
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      category: template.category,
    });
    initTemplateNodes(template);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    message.success('模板已删除');
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (templateNodes.length === 0) {
        message.error('请至少添加一个章节');
        return;
      }

      // 验证每个节点都有标题
      const emptyTitle = templateNodes.find(n => !n.title.trim());
      if (emptyTitle) {
        message.error('请填写所有章节的标题');
        return;
      }

      const nodes = templateNodes;

      const templateId = editingTemplate?.id || Date.now().toString();
      const templateData: WritingTemplate = {
        id: templateId,
        name: values.name,
        description: values.description,
        category: values.category,
        nodes,
        filePath: editingTemplate?.filePath,
        createdAt: editingTemplate?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 如果有导入的源文件，存储到模板目录
      if (importedFilePath) {
        const storeResult = await window.electronAPI.storeTemplateFile({
          templateId,
          sourcePath: importedFilePath,
        });
        if (storeResult.success && storeResult.filePath) {
          templateData.filePath = storeResult.filePath;
        }
      }

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, templateData);
        message.success('模板已更新');
      } else {
        await addTemplate(templateData);
        message.success('模板已创建');
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleImportFromDoc = async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: '文档文件', extensions: ['docx', 'pdf', 'txt'] },
      ]);
      if (!filePath) return;

      setIsExtracting(true);
      let content = '';

      const ext = filePath.split('.').pop()?.toLowerCase();
      if (ext === 'docx') {
        const result = await window.electronAPI.parseWordDocument(filePath);
        if (!result.success || !result.content) {
          message.error('解析 Word 文档失败');
          return;
        }
        content = result.content;
      } else if (ext === 'pdf') {
        const result = await window.electronAPI.parsePdfDocument(filePath);
        if (!result.success || !result.content) {
          message.error('解析 PDF 文档失败');
          return;
        }
        content = result.content;
      } else if (ext === 'txt') {
        content = await window.electronAPI.readFile(filePath);
      } else {
        message.error('不支持的文件格式');
        return;
      }

      const nodes = extractTemplateNodes(content);
      if (nodes.length === 0) {
        message.warning('未从文档中检测到章节标题。请确保文档使用了一、二、三 或 1. 2. 3. 等编号格式。');
        return;
      }

      // 自动填充表单
      const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '';
      const currentName = form.getFieldValue('name');
      if (!currentName) {
        form.setFieldsValue({ name: fileName });
      }

      // 推断分类：用阶段关键词匹配
      const currentCategory = form.getFieldValue('category');
      if (!currentCategory) {
        for (const stage of allStages) {
          if (stage.keywords.some(kw => fileName.includes(kw))) {
            form.setFieldsValue({ category: stage.name });
            break;
          }
        }
      }

      setTemplateNodes(nodes);
      setImportedFilePath(filePath);
      message.success(`已提取 ${nodes.length} 个章节，请检查并调整`);
    } catch (error) {
      console.error('Import failed:', error);
      message.error('导入失败');
    } finally {
      setIsExtracting(false);
    }
  };

  const getDefaultTemplateJson = () => {
    const defaultNodes: TemplateNode[] = [
      {
        id: '1',
        title: '一、项目概述',
        level: 1,
        description: '简要描述项目背景、目的和意义',
        isRequired: true,
        children: [
          {
            id: '1-1',
            title: '1.1 项目背景',
            level: 2,
            description: '说明项目的背景和起因',
            isRequired: true,
          },
          {
            id: '1-2',
            title: '1.2 项目目的',
            level: 2,
            description: '说明项目要达成的目标',
            isRequired: true,
          },
        ],
      },
      {
        id: '2',
        title: '二、需求分析',
        level: 1,
        description: '分析项目的业务需求和技术需求',
        isRequired: true,
      },
      {
        id: '3',
        title: '三、方案设计',
        level: 1,
        description: '提出解决方案和技术路线',
        isRequired: true,
      },
    ];
    return JSON.stringify(defaultNodes, null, 2);
  };

  return (
    <div className="template-manager-page">
      <section className="template-section">
      <div className="template-section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          模板管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          创建模板
        </Button>
      </div>

      {templates.length === 0 ? (
        <Empty description="暂无模板，请创建" />
      ) : (
        <List
          className="template-card-list"
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
          dataSource={templates}
          renderItem={(template) => (
            <List.Item>
              <Card
                actions={[
                  <EditOutlined key="edit" onClick={() => handleEdit(template)} />,
                  <Popconfirm
                    key="delete"
                    title="确定删除此模板？"
                    onConfirm={() => handleDelete(template.id)}
                  >
                    <DeleteOutlined />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                  title={template.name}
                  description={
                    <div>
                      <Text type="secondary">{template.category}</Text>
                      <br />
                      <Text ellipsis={{ rows: 2 }}>{template.description}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        包含 {template.nodes.length} 个章节
                      </Text>
                    </div>
                  }
                />
              </Card>
            </List.Item>
          )}
        />
      )}
      </section>

      <Modal
        title={editingTemplate ? '编辑模板' : '创建模板'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => setIsModalOpen(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input placeholder="例如：可研报告模板" />
          </Form.Item>

          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select
              placeholder="选择分类"
              options={allStages.map(s => ({ value: s.name, label: s.name }))}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label="模板说明"
          >
            <TextArea rows={2} placeholder="简要说明模板用途" />
          </Form.Item>

          {/* 模板结构编辑器 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>模板章节结构</Text>
              <Space>
                <Button
                  type="link"
                  size="small"
                  icon={<ImportOutlined />}
                  loading={isExtracting}
                  onClick={handleImportFromDoc}
                  style={{ padding: 0 }}
                >
                  从文档提取
                </Button>
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={addTemplateNode}
                >
                  添加章节
                </Button>
              </Space>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', padding: '2px 0' }}>
              {templateNodes.map((node, index) => (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: '#fafafa',
                    borderRadius: 6,
                    border: '1px solid #f0f0f0',
                  }}
                >
                  {/* 层级指示 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                    <Button
                      type="text"
                      size="small"
                      disabled={index === 0}
                      onClick={() => moveTemplateNode(index, 'up')}
                      style={{ padding: 0, height: 14, minWidth: 14, fontSize: 10, lineHeight: '14px' }}
                    >
                      ▲
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      disabled={index === templateNodes.length - 1}
                      onClick={() => moveTemplateNode(index, 'down')}
                      style={{ padding: 0, height: 14, minWidth: 14, fontSize: 10, lineHeight: '14px' }}
                    >
                      ▼
                    </Button>
                  </div>
                  {/* 章节标题 */}
                  <Input
                    value={node.title}
                    onChange={(e) => updateTemplateNode(node.id, { title: e.target.value })}
                    placeholder="例如：一、项目概述"
                    style={{ flex: 1 }}
                    size="small"
                  />
                  {/* 必需标记 */}
                  <div
                    onClick={() => updateTemplateNode(node.id, { isRequired: !node.isRequired })}
                    style={{
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: node.isRequired ? '#e6f7ff' : '#f5f5f5',
                      border: `1px solid ${node.isRequired ? '#91d5ff' : '#d9d9d9'}`,
                      fontSize: 10,
                      color: node.isRequired ? '#1890ff' : '#999',
                      flexShrink: 0,
                    }}
                  >
                    {node.isRequired ? '必需' : '可选'}
                  </div>
                  {/* 删除 */}
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeTemplateNode(node.id)}
                    style={{ padding: '0 4px', flexShrink: 0 }}
                  />
                </div>
              ))}
            </div>
            {templateNodes.length === 0 && (
              <div style={{ textAlign: 'center', padding: 16, color: '#999', fontSize: 12 }}>
                点击"添加章节"或"从文档提取"开始构建模板结构
              </div>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
              支持 .docx/.pdf/.txt，自动提取章节标题
            </Text>
          </div>
        </Form>
      </Modal>

      {/* ========== 项目阶段管理 ========== */}
      <Divider className="template-page-divider" />
      <section className="template-section stage-section">
      <div className="template-section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>
          项目阶段管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateStage}>
          新增阶段
        </Button>
      </div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        自定义阶段名称、识别关键词和颜色，用于自动识别文件所属阶段
      </Text>

      <List
        className="stage-list"
        dataSource={allStages}
        renderItem={(stage) => (
          <List.Item
            actions={[
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditStage(stage)}>编辑</Button>,
              <Popconfirm title="确定删除此阶段？" onConfirm={() => handleDeleteStage(stage.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: stage.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 'bold',
                }}>
                  {stage.name.charAt(0)}
                </div>
              }
              title={stage.name}
              description={
                <span style={{ fontSize: 12, color: '#999' }}>
                  关键词：{stage.keywords.length > 0 ? stage.keywords.join('、') : '（无）'}
                </span>
              }
            />
          </List.Item>
        )}
      />
      </section>

      {/* 新增/编辑阶段弹窗 */}
      <Modal
        title={editingStage ? '编辑阶段' : '新增阶段'}
        open={isStageModalOpen}
        onOk={handleStageSubmit}
        onCancel={() => setIsStageModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <Form form={stageForm} layout="vertical">
          <Form.Item
            name="name"
            label="阶段名称"
            rules={[{ required: true, message: '请输入阶段名称' }]}
          >
            <Input placeholder="例如：立项、招标、验收" />
          </Form.Item>
          <Form.Item
            name="keywords"
            label="识别关键词"
            extra="多个关键词用逗号分隔，文件名包含任一关键词即识别为该阶段"
          >
            <Input placeholder="例如：立项, 招标, 验收" />
          </Form.Item>
          <Form.Item
            name="color"
            label="阶段颜色"
            rules={[{ required: true, message: '请选择颜色' }]}
          >
            <ColorPicker format="hex" showText />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TemplateManager;
