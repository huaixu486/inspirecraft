import React from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, List, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { FileAddOutlined, FileTextOutlined, FolderOutlined, RobotOutlined } from '@ant-design/icons';

const { Text } = Typography;
const { TextArea } = Input;

type NamedItem = { id: string; name: string };
type ExternalReference = { path: string; name: string; content?: string };
type MemoryItem = { id: string; stageName: string; docName: string; summary: string; model?: string; sourceVersionId?: string; updatedAt: string };

interface TeamWritingStudioProps {
  templates: NamedItem[];
  projectDocs: NamedItem[];
  selectedTemplateId: string;
  selectedDocIds: string[];
  externalReferences: ExternalReference[];
  instruction: string;
  draft: string;
  workflowPromptSuggestion: string;
  focusedWorkflowTaskId: string;
  memories: MemoryItem[];
  excludedMemoryIds: string[];
  generating: boolean;
  onTemplateChange: (value: string) => void;
  onInstructionChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onAddProjectReferences: () => void;
  onAddExternalReferences: () => void;
  onRemoveDoc: (id: string) => void;
  onRemoveExternalReference: (path: string) => void;
  onMemoryEnabledChange: (id: string, enabled: boolean) => void;
  onDeleteMemory: (id: string) => void;
  onGenerate: () => void;
  onExport: () => void;
}

const TeamWritingStudio: React.FC<TeamWritingStudioProps> = props => {
  return (
    <Card title={<Space><RobotOutlined style={{ color: '#1677ff' }} /><span>团队写作</span></Space>} size="small" className="team-ai-studio-card">
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary" className="team-ai-studio-description">选择模板、项目内参考文件和临时外部资料，结合项目阶段记忆生成第一版文稿。生成后可继续人工编辑，再导出 Word。</Text>
      <div className="team-ai-studio-controls team-writing-controls">
        <div><Text type="secondary" className="team-ai-studio-label">写作模板</Text><Select placeholder="选择模板" style={{ width: '100%' }} value={props.selectedTemplateId || undefined} onChange={props.onTemplateChange} options={props.templates.map(item => ({ value: item.id, label: item.name }))} /></div>
        <div><Text type="secondary" className="team-ai-studio-label">项目内参考文件</Text><Button block icon={<FolderOutlined />} onClick={props.onAddProjectReferences}>从项目文件中选择</Button></div>
        <div className="team-ai-studio-imports"><Text type="secondary" className="team-ai-studio-label">临时外部资料</Text><Button size="small" icon={<FileAddOutlined />} onClick={props.onAddExternalReferences}>导入资料</Button></div>
      </div>
      {props.selectedDocIds.length > 0 && <Space wrap>{props.selectedDocIds.map(id => { const doc = props.projectDocs.find(item => item.id === id); return doc ? <Tag key={id} color="blue" closable onClose={() => props.onRemoveDoc(id)}>{doc.name}</Tag> : null; })}</Space>}
      {props.externalReferences.length > 0 && <Space wrap>{props.externalReferences.map(item => <Tag key={item.path} closable onClose={() => props.onRemoveExternalReference(item.path)}>{item.name}</Tag>)}</Space>}
      {props.workflowPromptSuggestion && <Alert type="info" showIcon message={<Space><Tag color="blue">来自工作流</Tag>{props.focusedWorkflowTaskId && <Tag>关联任务</Tag>}</Space>} description="已带入任务提示；可按需修改后生成初稿。" />}
      <Collapse size="small" items={[{
        key: 'memories',
        label: `阶段记忆 ${props.memories.length} 条 · 本次使用 ${props.memories.filter(item => !props.excludedMemoryIds.includes(item.id)).length} 条`,
        children: <List size="small" dataSource={props.memories} locale={{ emptyText: '暂无阶段记忆' }} renderItem={memory => <List.Item actions={[<Popconfirm key="delete" title="删除这条阶段记忆？" onConfirm={() => props.onDeleteMemory(memory.id)}><Button type="link" danger size="small">删除</Button></Popconfirm>]}><Checkbox checked={!props.excludedMemoryIds.includes(memory.id)} onChange={event => props.onMemoryEnabledChange(memory.id, event.target.checked)}><Space direction="vertical" size={0}><Text>{memory.stageName} · {memory.docName}</Text><Text type="secondary" ellipsis style={{ maxWidth: 620 }}>{memory.summary}</Text><Text type="secondary" style={{ fontSize: 11 }}>{[memory.model, memory.sourceVersionId && `版本 ${memory.sourceVersionId}`].filter(Boolean).join(' · ') || '历史记忆'}</Text></Space></Checkbox></List.Item>} />,
      }]} />
      <TextArea value={props.instruction} onChange={event => props.onInstructionChange(event.target.value)} placeholder="补充本次写作目标、受众或重点要求（可选）" autoSize={{ minRows: 2, maxRows: 5 }} />
      <Space wrap><Button type="primary" icon={<RobotOutlined />} loading={props.generating} onClick={props.onGenerate}>生成第一版</Button>{props.workflowPromptSuggestion && <Button onClick={() => props.onInstructionChange(props.workflowPromptSuggestion)}>使用任务提示</Button>}</Space>
      {props.draft && <div className="team-draft-panel"><div className="team-panel-heading"><Text strong>初稿预览</Text><Button size="small" icon={<FileTextOutlined />} onClick={props.onExport}>导出 Word</Button></div><TextArea value={props.draft} onChange={event => props.onDraftChange(event.target.value)} autoSize={{ minRows: 10, maxRows: 24 }} /></div>}
    </Space>
    </Card>
  );
};

export default TeamWritingStudio;
