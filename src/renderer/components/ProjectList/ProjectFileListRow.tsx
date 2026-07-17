import React from 'react';
import { Button, Dropdown, Input, Popconfirm, Tag, Typography } from 'antd';
import {
  DeleteOutlined,
  FileExcelOutlined,
  FileOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import type { FileItem } from './useProjectFileData';

const { Text } = Typography;
const FILE_LIST_ROW_HEIGHT = 44;

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const fileIcon = (ext: string, isDirectory: boolean) => {
  if (isDirectory) return <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} />;
  switch (ext) {
    case '.docx': case '.doc': return <FileWordOutlined style={{ color: '#1890ff', fontSize: 18 }} />;
    case '.pdf': return <FilePdfOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />;
    case '.xlsx': case '.xls': return <FileExcelOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
    case '.pptx': case '.ppt': return <FilePptOutlined style={{ color: '#ff7a45', fontSize: 18 }} />;
    case '.txt': return <FileTextOutlined style={{ color: '#666', fontSize: 18 }} />;
    default: return <FileOutlined style={{ color: '#999', fontSize: 18 }} />;
  }
};

const extColorMap: Record<string, string> = {
  '.docx': 'blue', '.doc': 'blue',
  '.pdf': 'red',
  '.xlsx': 'green', '.xls': 'green',
  '.pptx': 'orange', '.ppt': 'orange',
  '.txt': 'default',
};

interface ProjectFileListRowProps {
  item: FileItem;
  menu: React.ComponentProps<typeof Dropdown>['menu'];
  highlighted: boolean;
  selected: boolean;
  directoryDragOver: boolean;
  dragging: boolean;
  renaming: boolean;
  renameValue: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onRowDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onRowDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onRowDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: () => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onNativeDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onNativeDragEnd: () => void;
  onRenameChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

const ProjectFileListRow: React.FC<ProjectFileListRowProps> = ({
  item,
  menu,
  highlighted,
  selected,
  directoryDragOver,
  dragging,
  renaming,
  renameValue,
  onPointerDown,
  onRowDragStart,
  onRowDragEnd,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  onClick,
  onContextMenu,
  onDoubleClick,
  onNativeDragStart,
  onNativeDragEnd,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onDelete,
}) => (
  <Dropdown menu={menu} trigger={['contextMenu']} placement="bottomLeft">
    <div
      draggable={false}
      data-folder-path={item.isDirectory ? item.path : undefined}
      onPointerDown={onPointerDown}
      onDragStart={onRowDragStart}
      onDragEnd={onRowDragEnd}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: FILE_LIST_ROW_HEIGHT,
        minHeight: FILE_LIST_ROW_HEIGHT,
        padding: '0 12px',
        boxSizing: 'border-box',
        borderRadius: 6,
        cursor: 'grab',
        marginBottom: 2,
        userSelect: 'none',
        background: directoryDragOver ? '#e6f7ff' : selected ? '#e6f7ff' : highlighted ? '#f0f5ff' : 'transparent',
        border: directoryDragOver ? '1px dashed #1890ff' : selected ? '1px solid #91d5ff' : '1px solid transparent',
        transition: 'background 0.15s, border-color 0.15s',
        opacity: dragging ? 0.5 : 1,
      }}
      onMouseEnter={event => { if (!selected && !directoryDragOver) event.currentTarget.style.background = '#f5f5f5'; }}
      onMouseLeave={event => { if (!selected && !directoryDragOver) event.currentTarget.style.background = 'transparent'; }}
    >
      <div
        data-native-file-drag="true"
        draggable={!renaming}
        onDragStart={onNativeDragStart}
        onDragEnd={onNativeDragEnd}
        style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, height: '100%', userSelect: 'none', cursor: 'grab' }}
        title={item.isDirectory ? '拖动可发送文件夹；拖动行空白处可移动，按住 Ctrl 可复制' : '拖动名称可发送文件；拖动行空白处可移动，按住 Ctrl 可复制'}
      >
        {fileIcon(item.ext, item.isDirectory)}
        <div data-file-rename-trigger="true" style={{ flex: 1, marginLeft: 10, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          {renaming ? (
            <Input
              size="small"
              value={renameValue}
              autoFocus
              onChange={event => onRenameChange(event.target.value)}
              onClick={event => event.stopPropagation()}
              onDoubleClick={event => event.stopPropagation()}
              onBlur={onCommitRename}
              onPressEnter={onCommitRename}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  onCancelRename();
                }
              }}
            />
          ) : (
            <Text
              data-file-rename-trigger="true"
              style={{ display: 'block', maxWidth: '100%', fontSize: 13, lineHeight: '20px', fontWeight: selected ? 600 : 400, whiteSpace: 'nowrap' }}
              ellipsis
            >
              {item.name}
            </Text>
          )}
          {highlighted && <Tag color="blue" style={{ flexShrink: 0, fontSize: 9, lineHeight: '16px', marginLeft: 6, padding: '0 4px' }}>新</Tag>}
        </div>
      </div>
      {!item.isDirectory && item.ext && (
        <Tag color={extColorMap[item.ext] || 'default'} style={{ flexShrink: 0, fontSize: 10, lineHeight: '18px', margin: '0 8px' }}>
          {item.ext.replace('.', '').toUpperCase()}
        </Tag>
      )}
      <Text type="secondary" style={{ width: 80, flexShrink: 0, fontSize: 11, lineHeight: '20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {item.isDirectory ? '-' : formatFileSize(item.size)}
      </Text>
      <Text type="secondary" style={{ width: 140, flexShrink: 0, fontSize: 11, lineHeight: '20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {formatDate(item.modifiedAt)}
      </Text>
      <div data-no-file-drag="true" style={{ width: 34, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Popconfirm
          title={`确定删除 ${item.name}？`}
          onConfirm={event => { event?.stopPropagation(); onDelete(); }}
          onCancel={event => event?.stopPropagation()}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={event => event.stopPropagation()} title="删除" />
        </Popconfirm>
      </div>
    </div>
  </Dropdown>
);

export default ProjectFileListRow;
