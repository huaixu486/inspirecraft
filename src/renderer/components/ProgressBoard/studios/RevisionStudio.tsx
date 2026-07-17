import React from 'react';
import { Button, Card, Empty, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { EditOutlined, FileSearchOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';

const { Text } = Typography;
const { TextArea } = Input;

interface RevisionStudioProps {
  documents: Array<{ id: string; name: string }>;
  selectedDocumentId: string;
  documentContent: string;
  selection: string;
  instruction: string;
  promptSuggestion: string;
  proposal: string;
  proposalSelection: string;
  modalOpen: boolean;
  generating: boolean;
  applying: boolean;
  onDocumentChange: (value: string) => void;
  onLoad: () => void;
  onCaptureSelection: (target: HTMLTextAreaElement) => void;
  onOpenDialog: () => void;
  onInstructionChange: (value: string) => void;
  onGenerate: () => void;
  onProposalChange: (value: string) => void;
  onProposalSelectionChange: (value: string) => void;
  onApply: (value: string) => void;
  onClose: () => void;
  onDiscard: () => void;
}

const RevisionStudio: React.FC<RevisionStudioProps> = props => <>
  <Card title={<Space><EditOutlined style={{ color: '#7c3aed' }} /><span>AI 修订</span><Tag color="purple">精确修改</Tag></Space>} size="small" className="team-ai-studio-card">
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Text type="secondary" className="team-ai-studio-description">载入项目文件全文，用鼠标拖选要调整的内容，AI 只修改选区；确认后写回文件并保留备份。</Text>
      <div className="team-revision-toolbar"><Select placeholder="选择要修订的项目文件" style={{ minWidth: 280, flex: 1 }} value={props.selectedDocumentId || undefined} onChange={props.onDocumentChange} options={props.documents.map(item => ({ value: item.id, label: item.name }))} /><Button icon={<FileSearchOutlined />} onClick={props.onLoad}>载入全文</Button><Button type="primary" icon={<SendOutlined />} disabled={!props.selection.trim()} onClick={props.onOpenDialog}>修订选中内容</Button></div>
      {props.documentContent ? <><Text type="secondary">{props.selection ? `已选中 ${props.selection.length} 个字符` : '在下方全文中鼠标拖选一段内容后即可修订'}</Text><TextArea className="team-revision-document" value={props.documentContent} readOnly onSelect={event => props.onCaptureSelection(event.currentTarget)} autoSize={{ minRows: 12, maxRows: 28 }} /></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个项目文件后载入全文" />}
    </Space>
  </Card>
  <Modal open={props.modalOpen} width={980} title="AI 修订对比" onCancel={props.onClose} footer={null} destroyOnClose>
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Text type="secondary">说明修改要求后生成建议；可编辑建议文本，或拖选其中一部分后接受。</Text>
      {props.promptSuggestion && <Text type="secondary">按 Tab 可带入任务修改提示，执行前仍可编辑。</Text>}
      <TextArea value={props.instruction} onChange={event => props.onInstructionChange(event.target.value)} onKeyDown={event => { if (event.key !== 'Tab' || !props.promptSuggestion) return; event.preventDefault(); props.onInstructionChange(props.promptSuggestion); }} placeholder="例如：压缩为更正式的报告语言，并保留所有数字与结论" autoSize={{ minRows: 2, maxRows: 4 }} />
      <Button type="primary" icon={<RobotOutlined />} loading={props.generating} onClick={props.onGenerate}>生成修订建议</Button>
      {props.proposal && <div className="team-revision-diff"><div><Text strong>原文</Text><TextArea value={props.selection} readOnly autoSize={{ minRows: 9, maxRows: 18 }} /></div><div><Text strong>AI 建议</Text><TextArea value={props.proposal} onChange={event => props.onProposalChange(event.target.value)} onSelect={event => { const { selectionStart, selectionEnd, value } = event.currentTarget; props.onProposalSelectionChange(value.slice(selectionStart || 0, selectionEnd || 0)); }} autoSize={{ minRows: 9, maxRows: 18 }} /></div></div>}
      {props.proposal && <Space wrap><Button type="primary" loading={props.applying} onClick={() => props.onApply(props.proposal)}>接受全部修订</Button><Button loading={props.applying} onClick={() => { if (!props.proposalSelection.trim()) { message.info('请先在“AI 建议”文本框中拖选要接受的部分'); return; } props.onApply(props.proposalSelection); }}>接受当前拖选部分</Button><Button onClick={props.onDiscard}>丢弃建议</Button></Space>}
    </Space>
  </Modal>
</>;

export default RevisionStudio;
