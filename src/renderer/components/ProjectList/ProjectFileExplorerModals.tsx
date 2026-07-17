import React from 'react';
import { Button, DatePicker, Input, Modal, Select, Space, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import type { WritingTemplate } from '../../../shared/types';

const { Text } = Typography;

interface ProjectFolderCreateModalProps {
  open: boolean;
  name: string;
  creating: boolean;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}

export const ProjectFolderCreateModal: React.FC<ProjectFolderCreateModalProps> = ({
  open,
  name,
  creating,
  onNameChange,
  onCreate,
  onCancel,
}) => (
  <Modal
    title="新建文件夹"
    open={open}
    onOk={onCreate}
    onCancel={() => { if (!creating) onCancel(); }}
    okText="创建"
    cancelText="取消"
    confirmLoading={creating}
    width={400}
    destroyOnClose
  >
    <Text strong style={{ display: 'block', marginBottom: 6 }}>文件夹名称</Text>
    <Input
      autoFocus
      placeholder="输入文件夹名称"
      value={name}
      onChange={event => onNameChange(event.target.value)}
      onPressEnter={onCreate}
      maxLength={120}
    />
    <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
      文件夹将创建在当前目录中
    </Text>
  </Modal>
);

interface ProjectFileCreateModalProps {
  open: boolean;
  templates: WritingTemplate[];
  selectedTemplateId: string;
  fileType: string;
  fileName: string;
  deadline: Dayjs | null;
  fileTypeOptions: Array<{ value: string; label: string }>;
  onTemplateChange: (templateId: string) => void;
  onFileTypeChange: (fileType: string) => void;
  onFileNameChange: (fileName: string) => void;
  onDeadlineChange: (deadline: Dayjs | null) => void;
  onCreate: () => void;
  onCancel: () => void;
}

export const ProjectFileCreateModal: React.FC<ProjectFileCreateModalProps> = ({
  open,
  templates,
  selectedTemplateId,
  fileType,
  fileName,
  deadline,
  fileTypeOptions,
  onTemplateChange,
  onFileTypeChange,
  onFileNameChange,
  onDeadlineChange,
  onCreate,
  onCancel,
}) => (
  <Modal title="新建文件" open={open} onOk={onCreate} onCancel={onCancel} okText="创建" cancelText="取消" width={400}>
    {templates.length > 0 && (
      <div style={{ marginBottom: 14 }}>
        <Text strong style={{ display: 'block', marginBottom: 6 }}>从模板创建（可选）</Text>
        <Select
          allowClear
          placeholder="选择模板，自动填充文件名和类型"
          style={{ width: '100%' }}
          value={selectedTemplateId || undefined}
          onChange={value => onTemplateChange(value || '')}
          options={templates.map(template => ({
            value: template.id,
            label: `${template.name} (${template.category} · ${(template.outputFileType || 'docx').toUpperCase()})`,
          }))}
        />
      </div>
    )}
    <div style={{ marginBottom: 14 }}>
      <Text strong style={{ display: 'block', marginBottom: 6 }}>文件类型</Text>
      <Select
        style={{ width: '100%' }}
        value={fileType}
        onChange={onFileTypeChange}
        options={fileTypeOptions}
        disabled={Boolean(selectedTemplateId)}
      />
      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
        {selectedTemplateId
          ? '选择模板后文件类型使用该模板的创建类型'
          : '未选择模板时会创建真正的空白文件，不会写入默认标题或示例内容。'}
      </Text>
    </div>
    <div style={{ marginBottom: 14 }}>
      <Text strong style={{ display: 'block', marginBottom: 6 }}>文件名</Text>
      <Input
        placeholder="输入文件名（不含扩展名）"
        value={fileName}
        onChange={event => onFileNameChange(event.target.value)}
        onPressEnter={onCreate}
        addonAfter={`.${fileType}`}
      />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 6 }}>截止日期（可选）</Text>
      <DatePicker
        style={{ width: '100%' }}
        placeholder="设置截止日期，用于跟踪进度"
        value={deadline}
        onChange={onDeadlineChange}
        allowClear
      />
      <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
        设定后将在时间线中显示，逾期会自动提醒
      </Text>
    </div>
  </Modal>
);

export interface ImportFileOption {
  name: string;
  path: string;
  size: number;
}

interface ProjectFileImportModalProps {
  open: boolean;
  source: 'folder' | 'zip';
  files: ImportFileOption[];
  selectedPaths: string[];
  importing: boolean;
  onSelectionChange: (paths: string[]) => void;
  onImport: () => void;
  onCancel: () => void;
}

export const ProjectFileImportModal: React.FC<ProjectFileImportModalProps> = ({
  open,
  source,
  files,
  selectedPaths,
  importing,
  onSelectionChange,
  onImport,
  onCancel,
}) => (
  <Modal
    title={source === 'folder' ? '从文件夹导入' : '从 ZIP 导入'}
    open={open}
    onOk={onImport}
    onCancel={onCancel}
    okText={`导入已选 (${selectedPaths.length})`}
    cancelText="取消"
    confirmLoading={importing}
    width={520}
  >
    <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text type="secondary">共 {files.length} 个文件，点击勾选需要导入的文件</Text>
      <Space size={8}>
        <Button size="small" onClick={() => onSelectionChange(files.map(file => file.path))}>全选</Button>
        <Button size="small" onClick={() => onSelectionChange([])}>全不选</Button>
      </Space>
    </div>
    <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
      {files.map(file => {
        const selected = selectedPaths.includes(file.path);
        return (
          <label
            key={file.path}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', cursor: 'pointer',
              borderBottom: '1px solid #f5f5f5',
              background: selected ? '#f0f7ff' : '#fff',
              transition: 'background 0.15s',
            }}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={event => onSelectionChange(
                event.target.checked
                  ? [...selectedPaths, file.path]
                  : selectedPaths.filter(path => path !== file.path),
              )}
            />
            <FileTextOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
            <Text style={{ flex: 1, fontSize: 12 }} ellipsis={{ tooltip: file.name }}>{file.name}</Text>
            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{(file.size / 1024).toFixed(1)}KB</Text>
          </label>
        );
      })}
    </div>
  </Modal>
);
