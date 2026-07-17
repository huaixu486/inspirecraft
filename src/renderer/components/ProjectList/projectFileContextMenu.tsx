import React from 'react';
import type { MenuProps } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  EditOutlined,
  ExperimentOutlined,
  ExportOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { FileItem } from './useProjectFileData';

export interface ProjectFileContextActions {
  onOpen: (item: FileItem) => void;
  onReveal: (item: FileItem) => void;
  onCopyPath: (item: FileItem) => void;
  onCompress: (item: FileItem) => void;
  onExtract: (item: FileItem) => void;
  onSendToWriting: (item: FileItem) => void;
  onSendToReview: (item: FileItem) => void;
  onSendToReport: (item: FileItem) => void;
  onShare: (item: FileItem) => void;
}

const createProjectFileContextMenu = (
  item: FileItem,
  actions: ProjectFileContextActions,
): NonNullable<MenuProps['items']> => [
  { key: 'open', icon: <ExportOutlined />, label: item.isDirectory ? '打开文件夹' : '打开文件', onClick: () => actions.onOpen(item) },
  { key: 'reveal', icon: <FolderOpenOutlined />, label: '在文件资源管理器中显示', onClick: () => actions.onReveal(item) },
  { key: 'copy-path', icon: <CopyOutlined />, label: '复制完整路径', onClick: () => actions.onCopyPath(item) },
  { key: 'compress', icon: <FileZipOutlined />, label: '压缩为 ZIP', onClick: () => actions.onCompress(item) },
  !item.isDirectory && item.ext.toLowerCase() === '.zip'
    ? { key: 'extract', icon: <FileZipOutlined />, label: '解压到同名文件夹', onClick: () => actions.onExtract(item) }
    : null,
  { type: 'divider' },
  !item.isDirectory
    ? { key: 'writing', icon: <EditOutlined />, label: '发送到团队写作', onClick: () => actions.onSendToWriting(item) }
    : null,
  !item.isDirectory
    ? { key: 'review', icon: <CheckCircleOutlined />, label: '发送到审阅', onClick: () => actions.onSendToReview(item) }
    : null,
  !item.isDirectory
    ? { key: 'report', icon: <ExperimentOutlined />, label: '发送到报告工作台', onClick: () => actions.onSendToReport(item) }
    : null,
  { key: 'share', icon: <SendOutlined />, label: item.isDirectory ? '发送文件夹给好友…' : '发送给好友…', onClick: () => actions.onShare(item) },
].filter(Boolean) as NonNullable<MenuProps['items']>;

export default createProjectFileContextMenu;
