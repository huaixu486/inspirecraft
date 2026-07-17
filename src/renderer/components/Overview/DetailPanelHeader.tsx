import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Input, Space, Typography } from 'antd';
import type { InputRef } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
} from '@ant-design/icons';

const { Title } = Typography;

interface DetailPanelHeaderProps {
  projectName: string;
  deleting: boolean;
  onRename: (name: string) => Promise<boolean>;
  onDelete: (mode: 'unregister' | 'delete-folder') => void;
  onClose: () => void;
}

const DetailPanelHeader: React.FC<DetailPanelHeaderProps> = ({
  projectName,
  deleting,
  onRename,
  onDelete,
  onClose,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!editing) setDraftName(projectName);
  }, [editing, projectName]);

  const startEditing = () => {
    setDraftName(projectName);
    setEditing(true);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraftName(projectName);
    setEditing(false);
  };

  const saveName = async () => {
    if (saving) return;
    const nextName = draftName.trim();
    if (!nextName) {
      inputRef.current?.focus();
      return;
    }
    if (nextName === projectName) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      if (await onRename(nextName)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="detail-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
      <div className="detail-panel-project-heading">
        <div className="detail-panel-project-icon">
          <FolderOutlined style={{ fontSize: 20, color: '#1890ff' }} />
        </div>
        <div className="detail-panel-project-name-wrap">
          {editing ? (
            <div className="detail-panel-project-name-editor">
              <Input
                ref={inputRef}
                value={draftName}
                maxLength={80}
                status={draftName.trim() ? undefined : 'error'}
                aria-label="项目名称"
                onChange={event => setDraftName(event.target.value)}
                onPressEnter={() => void saveName()}
                onKeyDown={event => {
                  if (event.key === 'Escape') cancelEditing();
                }}
                disabled={saving}
              />
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                title="保存项目名称"
                aria-label="保存项目名称"
                loading={saving}
                disabled={!draftName.trim()}
                onClick={() => void saveName()}
              />
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                title="取消修改"
                aria-label="取消修改"
                disabled={saving}
                onClick={cancelEditing}
              />
            </div>
          ) : (
            <div className="detail-panel-project-name-display">
              <Title level={5} title={projectName} ellipsis style={{ margin: 0, fontSize: 15 }}>
                {projectName}
              </Title>
              <Button
                className="detail-panel-project-rename-button"
                type="text"
                size="small"
                icon={<EditOutlined />}
                title="修改项目名称"
                aria-label="修改项目名称"
                onClick={startEditing}
              />
            </div>
          )}
        </div>
      </div>
      <Space size={2}>
        <Dropdown
          trigger={['click']}
          menu={{ items: [
            { key: 'unregister', label: '仅移除注册关系', onClick: () => onDelete('unregister') },
            { type: 'divider' },
            { key: 'delete-folder', danger: true, label: '删除项目文件夹', onClick: () => onDelete('delete-folder') },
          ] }}
        >
          <Button type="text" danger icon={<DeleteOutlined />} size="small" title="删除项目" loading={deleting} />
        </Dropdown>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          size="small"
          title="关闭侧边窗"
          aria-label="关闭侧边窗"
          style={{ transition: 'transform 0.15s ease, background 0.15s ease' }}
          onMouseEnter={event => { (event.currentTarget as HTMLElement).style.transform = 'rotate(90deg)'; }}
          onMouseLeave={event => { (event.currentTarget as HTMLElement).style.transform = 'rotate(0deg)'; }}
        />
      </Space>
    </div>
  );
};

export default DetailPanelHeader;
