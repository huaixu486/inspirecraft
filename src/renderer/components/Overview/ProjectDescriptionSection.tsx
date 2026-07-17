import React from 'react';
import { Button, Input, Popconfirm, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { Project } from '../../../shared/types';
import type { AutoProjectDescriptionStatus } from '../../utils/autoProjectDescription';

const { Title, Paragraph } = Typography;

interface ProjectDescriptionSectionProps {
  project: Project;
  status: AutoProjectDescriptionStatus;
  editing: boolean;
  draft: string;
  editorRef: React.RefObject<any>;
  onStartEditing: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClear: () => void;
}

const ProjectDescriptionSection: React.FC<ProjectDescriptionSectionProps> = ({
  project,
  status,
  editing,
  draft,
  editorRef,
  onStartEditing,
  onDraftChange,
  onSave,
  onCancel,
  onClear,
}) => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <Title level={5} style={{ fontSize: 14, margin: 0 }}>项目描述</Title>
      {status === 'completed' && <Tag color="green" style={{ margin: 0, fontSize: 11 }}>AI 编写完毕</Tag>}
      {status === 'pending' && <Tag color="gold" style={{ margin: 0, fontSize: 11 }}>待 AI 编写</Tag>}
      {status === 'failed' && <Tag color="red" style={{ margin: 0, fontSize: 11 }}>AI 编写失败，等待重试</Tag>}
      {status === 'manual' && <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>手动编辑</Tag>}
      {!editing && (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined />}
          onClick={onStartEditing}
          style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 11 }}
          title={project.description ? '编辑描述' : '添加描述'}
        />
      )}
    </div>

    {editing ? (
      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input.TextArea
          ref={editorRef}
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          placeholder="输入项目描述…"
          autoSize={{ minRows: 2, maxRows: 6 }}
          style={{ fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="small" type="primary" onClick={onSave}>保存</Button>
          <Button size="small" onClick={onCancel}>取消</Button>
          {project.description && (
            <Popconfirm title="确定清空描述？" onConfirm={onClear}>
              <Button size="small" danger>清空</Button>
            </Popconfirm>
          )}
        </div>
      </div>
    ) : (
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 20 }}>
        {project.description
          || (status === 'failed'
            ? 'AI 编写失败，系统将在下次重试时间后自动再试。'
            : status === 'pending'
              ? '满足至少两个文件且三天无更新后，将自动编写项目描述。'
              : '暂无描述')}
      </Paragraph>
    )}
  </>
);

export default ProjectDescriptionSection;
