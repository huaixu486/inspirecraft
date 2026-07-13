import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  FileOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface FriendChatWorkspaceProps {
  open: boolean;
  friends: CollaborationPeerInfo[];
  selectedFriend: CollaborationPeerInfo | null;
  messages: CollaborationChatMessage[];
  loadingMessages: boolean;
  draft: string;
  sending: boolean;
  sendingFile: boolean;
  pendingRequestCount: number;
  onClose: () => void;
  onSelectFriend: (friend: CollaborationPeerInfo) => void;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
  onSendFile: () => void;
  onShareProject: () => void;
  onOpenAddFriend: () => void;
  onRefresh: () => void;
  onRemoveFriend: (friendId: string) => void;
}

const FriendChatWorkspace = ({
  open,
  friends,
  selectedFriend,
  messages,
  loadingMessages,
  draft,
  sending,
  sendingFile,
  pendingRequestCount,
  onClose,
  onSelectFriend,
  onDraftChange,
  onSendMessage,
  onSendFile,
  onShareProject,
  onOpenAddFriend,
  onRefresh,
  onRemoveFriend,
}: FriendChatWorkspaceProps) => {
  const [keyword, setKeyword] = useState('');
  const messageEndRef = useRef<HTMLDivElement>(null);

  const visibleFriends = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    if (!query) return friends;
    return friends.filter(friend => [friend.name, friend.nickname, friend.email, friend.host]
      .filter(Boolean)
      .some(value => String(value).toLocaleLowerCase().includes(query)));
  }, [friends, keyword]);

  useEffect(() => {
    if (!open) return;
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loadingMessages, open, selectedFriend?.id]);

  const selectedName = selectedFriend?.name || selectedFriend?.nickname || selectedFriend?.email || selectedFriend?.host || '';

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1000}
      style={{ top: 44 }}
      styles={{ body: { padding: 0 } }}
      destroyOnClose={false}
    >
      <div style={{ height: 'min(650px, calc(100vh - 100px))', display: 'flex', overflow: 'hidden', borderRadius: 10, background: '#fff' }}>
        <aside style={{ width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#f7faff', borderRight: '1px solid #e7edf5' }}>
          <div style={{ padding: '18px 16px 12px', borderBottom: '1px solid #e7edf5', background: 'linear-gradient(145deg, #f8fbff 0%, #edf6ff 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Space size={8}>
                <Avatar size={32} style={{ color: '#1677ff', background: '#e6f4ff' }} icon={<MessageOutlined />} />
                <div>
                  <Text strong style={{ display: 'block', color: '#1f2937' }}>好友消息</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>局域网内安全协作</Text>
                </div>
              </Space>
              <Space size={0}>
                <Tooltip title="刷新好友状态"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefresh} /></Tooltip>
                <Badge count={pendingRequestCount} size="small" offset={[-1, 2]}>
                  <Tooltip title="添加好友与处理请求"><Button size="small" type="text" icon={<PlusOutlined />} onClick={onOpenAddFriend} /></Tooltip>
                </Badge>
              </Space>
            </div>
            <Input
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              placeholder="搜索好友"
              allowClear
              size="middle"
              style={{ borderRadius: 8 }}
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
            {visibleFriends.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={friends.length ? '没有匹配的好友' : '还没有好友'}
                style={{ marginTop: 48 }}
              >
                {!friends.length && <Button type="link" size="small" onClick={onOpenAddFriend}>添加局域网好友</Button>}
              </Empty>
            ) : (
              <List
                split={false}
                dataSource={visibleFriends}
                renderItem={friend => {
                  const active = selectedFriend?.id === friend.id;
                  const name = friend.name || friend.nickname || friend.email || friend.host;
                  return (
                    <List.Item
                      key={friend.id}
                      onClick={() => onSelectFriend(friend)}
                      style={{
                        cursor: 'pointer',
                        padding: '10px 9px',
                        marginBottom: 4,
                        borderRadius: 10,
                        background: active ? '#e6f4ff' : 'transparent',
                        border: active ? '1px solid #bae0ff' : '1px solid transparent',
                      }}
                    >
                      <List.Item.Meta
                        avatar={
                          <Badge dot color={friend.online ? '#52c41a' : '#bfbfbf'} offset={[-1, 27]}>
                            <Avatar style={{ background: active ? '#1677ff' : '#dbeafe', color: active ? '#fff' : '#2563eb' }}>
                              {name.slice(0, 1).toLocaleUpperCase()}
                            </Avatar>
                          </Badge>
                        }
                        title={<Text ellipsis={{ tooltip: name }} style={{ maxWidth: 150, color: '#1f2937' }}>{name}</Text>}
                        description={<Text type="secondary" style={{ fontSize: 11 }}>{friend.online ? '在线' : '离线'}{friend.email ? ` · ${friend.email}` : ''}</Text>}
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {selectedFriend ? (
            <>
              <header style={{ minHeight: 68, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #edf1f5' }}>
                <Space size={10}>
                  <Badge dot color={selectedFriend.online ? '#52c41a' : '#bfbfbf'} offset={[-1, 29]}>
                    <Avatar size={36} style={{ background: '#e6f4ff', color: '#1677ff' }}>{selectedName.slice(0, 1).toLocaleUpperCase()}</Avatar>
                  </Badge>
                  <div>
                    <Text strong style={{ display: 'block', color: '#1f2937' }}>{selectedName}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{selectedFriend.online ? '在线，可实时发送消息和文件' : '离线，暂不能发送'}</Text>
                  </div>
                </Space>
                <Space size={4}>
                  <Tooltip title="将当前项目名称和进度发送到会话"><Button type="text" icon={<FolderOpenOutlined />} onClick={onShareProject}>分享项目</Button></Tooltip>
                  <Tooltip title="选择文件并发送给该好友"><Button type="text" icon={<PaperClipOutlined />} loading={sendingFile} disabled={!selectedFriend.online} onClick={onSendFile}>发送文件</Button></Tooltip>
                  <Popconfirm title="移除这位好友？" okText="移除" cancelText="取消" onConfirm={() => onRemoveFriend(selectedFriend.id)}>
                    <Tooltip title="移除好友"><Button type="text" danger icon={<UserDeleteOutlined />} /></Tooltip>
                  </Popconfirm>
                </Space>
              </header>

              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px', background: 'linear-gradient(180deg, #fbfdff 0%, #f6f9fc 100%)' }}>
                {loadingMessages ? (
                  <div style={{ paddingTop: 80, textAlign: 'center' }}><Text type="secondary">正在加载聊天记录…</Text></div>
                ) : messages.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无消息，发一句问候吧" style={{ marginTop: 90 }} />
                ) : (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {messages.map(item => {
                      const outgoing = item.direction === 'outgoing';
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: outgoing ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '72%', padding: '9px 12px 7px', borderRadius: outgoing ? '12px 3px 12px 12px' : '3px 12px 12px 12px', background: outgoing ? '#1677ff' : '#fff', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)', border: outgoing ? 'none' : '1px solid #edf1f5' }}>
                            <Text style={{ color: outgoing ? '#fff' : '#334155', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>{item.content}</Text>
                            <Text style={{ display: 'block', color: outgoing ? 'rgba(255,255,255,.72)' : '#94a3b8', fontSize: 10, marginTop: 4, textAlign: outgoing ? 'right' : 'left' }}>
                              {new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </Space>
                )}
              </div>

              <footer style={{ padding: '12px 16px 14px', borderTop: '1px solid #edf1f5', background: '#fff' }}>
                <Input.TextArea
                  value={draft}
                  onChange={event => onDraftChange(event.target.value)}
                  onPressEnter={event => {
                    if (!event.shiftKey) {
                      event.preventDefault();
                      onSendMessage();
                    }
                  }}
                  placeholder={selectedFriend.online ? '输入消息，Enter 发送，Shift + Enter 换行' : '好友离线，暂不能发送'}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  disabled={!selectedFriend.online || sending}
                  style={{ borderRadius: 9, resize: 'none' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <Space size={4}>
                    <Tooltip title="发送文件"><Button type="text" icon={<PaperClipOutlined />} disabled={!selectedFriend.online} onClick={onSendFile} /></Tooltip>
                    <Tooltip title="分享当前项目"><Button type="text" icon={<FileOutlined />} onClick={onShareProject} /></Tooltip>
                    <Text type="secondary" style={{ fontSize: 11 }}>仅在局域网内传输</Text>
                  </Space>
                  <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!draft.trim() || !selectedFriend.online} onClick={onSendMessage}>发送</Button>
                </div>
              </footer>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #fbfdff 0%, #f6f9fc 100%)' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一位好友，开始聊天" />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};

export default FriendChatWorkspace;
