import React from 'react';
import { CheckOutlined, ExportOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Drawer, Modal, Typography } from 'antd';
import {
  type FolderImportMode,
  useFolderImportPreferenceStore,
} from '../../stores/folderImportPreferenceStore';

const { Text } = Typography;

type ModeCopy = {
  title: string;
  description: string;
};

const modeCopy: Record<FolderImportMode, ModeCopy> = {
  shortcut: {
    title: '仅导入快捷方式',
    description: '保留原文件夹位置，在项目中创建入口，不复制也不移动原文件。',
  },
  move: {
    title: '移动到工作区',
    description: '将整个文件夹移动到工作区或当前项目目录，之后由工作区统一管理。',
  },
};

const ModeCard: React.FC<{
  mode: FolderImportMode;
  selected?: boolean;
  onClick: () => void;
}> = ({ mode, selected = false, onClick }) => (
  <button
    type="button"
    className={`folder-import-mode-card${selected ? ' is-selected' : ''}`}
    onClick={onClick}
  >
    <span className="folder-import-mode-icon">
      {mode === 'shortcut' ? <ExportOutlined /> : <FolderOpenOutlined />}
    </span>
    <span className="folder-import-mode-copy">
      <Text strong>{modeCopy[mode].title}</Text>
      <Text type="secondary">{modeCopy[mode].description}</Text>
    </span>
    {selected && <CheckOutlined className="folder-import-mode-check" />}
  </button>
);

export const promptFolderImportMode = (title = '选择文件夹导入方式') => new Promise<FolderImportMode | null>(resolve => {
  let settled = false;
  let instance: ReturnType<typeof Modal.info>;
  const finish = (mode: FolderImportMode | null) => {
    if (settled) return;
    settled = true;
    instance.destroy();
    resolve(mode);
  };
  instance = Modal.info({
    title,
    icon: null,
    closable: true,
    maskClosable: true,
    width: 520,
    footer: null,
    onCancel: () => finish(null),
    content: (
      <div className="folder-import-mode-dialog">
        <Text type="secondary">本次操作选择一种方式；也可以在“新建”按钮右侧设置默认方式。</Text>
        <ModeCard mode="shortcut" onClick={() => finish('shortcut')} />
        <ModeCard mode="move" onClick={() => finish('move')} />
      </div>
    ),
  });
});

interface FolderImportModeDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const FolderImportModeDrawer: React.FC<FolderImportModeDrawerProps> = ({ open, onClose }) => {
  const defaultMode = useFolderImportPreferenceStore(state => state.defaultMode);
  const setDefaultMode = useFolderImportPreferenceStore(state => state.setDefaultMode);

  const toggleMode = (mode: FolderImportMode) => {
    setDefaultMode(defaultMode === mode ? null : mode);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="默认文件夹导入方式"
      placement="right"
      width={380}
      className="folder-import-mode-drawer"
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 14 }}>
        设置后，选择文件夹会直接按默认方式导入。再次点击已选卡片可取消默认设置。
      </Text>
      <ModeCard mode="shortcut" selected={defaultMode === 'shortcut'} onClick={() => toggleMode('shortcut')} />
      <ModeCard mode="move" selected={defaultMode === 'move'} onClick={() => toggleMode('move')} />
      {!defaultMode && <Text type="secondary" className="folder-import-mode-empty">当前未设置默认方式，每次导入都会询问。</Text>}
    </Drawer>
  );
};
