import React from 'react';
import { Modal, Select, Typography } from 'antd';
import type { FileItem } from './useProjectFileData';

const { Text } = Typography;

export interface ShareFriendOption {
  id: string;
  name: string;
  online?: boolean;
}

interface ProjectFileShareModalProps {
  item: FileItem | null;
  friends: ShareFriendOption[];
  friendId: string;
  sending: boolean;
  onFriendChange: (friendId: string) => void;
  onCancel: () => void;
  onSend: () => void;
}

const ProjectFileShareModal: React.FC<ProjectFileShareModalProps> = ({
  item,
  friends,
  friendId,
  sending,
  onFriendChange,
  onCancel,
  onSend,
}) => (
  <Modal
    title={item ? `发送给好友：${item.name}` : '发送给好友'}
    open={Boolean(item)}
    onCancel={() => { if (!sending) onCancel(); }}
    onOk={onSend}
    okText="发送"
    cancelText="取消"
    confirmLoading={sending}
    okButtonProps={{ disabled: !friendId }}
    destroyOnClose
  >
    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
      {item?.isDirectory ? '文件夹将保留原始目录结构直接发送给好友' : '选择要接收当前文件的好友'}
    </Text>
    <Select
      value={friendId || undefined}
      onChange={onFriendChange}
      style={{ width: '100%' }}
      placeholder="选择好友"
      options={friends.map(friend => ({
        value: friend.id,
        label: `${friend.name}${friend.online ? '（在线）' : '（离线）'}`,
        disabled: friend.online === false,
      }))}
    />
  </Modal>
);

export default ProjectFileShareModal;
