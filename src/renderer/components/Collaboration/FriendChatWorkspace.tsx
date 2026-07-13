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
  BellOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useAIJobStore } from '../../stores/aiJobStore';
import type { AIJob, ProjectDocument, ReviewResult } from '../../../shared/types';

const { Text } = Typography;

type NotificationTarget = 'overview' | 'project-plan' | 'project-report' | 'project-review';
type ConversationKey = 'system' | 'ai' | `friend:${string}`;

type SystemMessage = {
  id: string;
  category: '报告' | '审查' | '截止';
  severity: 'high' | 'medium' | 'low';
  title: string;
  content: string;
  createdAt: string;
  target: NotificationTarget;
  projectId?: string;
};

type LocalReply = { id: string; messageId: string; content: string; createdAt: string };

const DISMISSED_KEY = 'projecthub.message-center.dismissed.v1';
const REPLIES_KEY = 'projecthub.message-center.replies.v1';

const safeDateMs = (value?: string) => {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const saveLocal = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

const buildSystemMessages = (projects: { id: string; name: string }[], docs: ProjectDocument[], reviews: ReviewResult[]): SystemMessage[] => {
  const now = Date.now();
  const entries: SystemMessage[] = [];
  for (const project of projects) {
    const reportDocs = docs
      .filter(doc => doc.projectId === project.id && Boolean(doc.aiReport))
      .sort((a, b) => safeDateMs(b.analyzedAt || b.createdAt) - safeDateMs(a.analyzedAt || a.createdAt));
    if (reportDocs[0]) {
      const latest = reportDocs[0];
      entries.push({
        id: `report:${project.id}:${latest.id}:${latest.analyzedAt || latest.createdAt}`,
        category: '报告', severity: 'low', title: `报告已生成 · ${project.name}`,
        content: reportDocs.length > 1 ? `已生成或更新 ${reportDocs.length} 份报告，最新为《${latest.name}》。` : `《${latest.name}》已生成，可进入报告工作台查看。`,
        createdAt: latest.analyzedAt || latest.createdAt, target: 'project-report', projectId: project.id,
      });
    }

    const latestReview = reviews
      .filter(review => review.projectId === project.id)
      .sort((a, b) => safeDateMs(b.createdAt) - safeDateMs(a.createdAt))[0];
    if (latestReview) {
      const issueCount = latestReview.issues?.length || 0;
      const errorCount = latestReview.issues?.filter(issue => issue.severity === 'error').length || 0;
      entries.push({
        id: `review:${project.id}:${latestReview.id}`,
        category: '审查', severity: errorCount || latestReview.score < 60 ? 'high' : issueCount || latestReview.score < 80 ? 'medium' : 'low',
        title: `审查已完成 · ${project.name}`,
        content: `本次得分 ${latestReview.score} 分，发现 ${issueCount} 个问题${errorCount ? `，其中 ${errorCount} 个需要优先处理` : ''}。`,
        createdAt: latestReview.createdAt, target: 'project-review', projectId: project.id,
      });
    }

    const deadlines = docs
      .filter(doc => doc.projectId === project.id && doc.deadline && !doc.completedAt)
      .map(doc => ({ doc, deadline: safeDateMs(doc.deadline) }))
      .filter(item => item.deadline && item.deadline - now <= 3 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.deadline - b.deadline);
    if (deadlines[0]) {
      const overdue = deadlines.filter(item => item.deadline < now).length;
      entries.push({
        id: `deadline:${project.id}:${deadlines[0].doc.id}:${deadlines[0].doc.deadline}`,
        category: '截止', severity: overdue ? 'high' : 'medium', title: overdue ? `有逾期事项 · ${project.name}` : `临近截止 · ${project.name}`,
        content: overdue ? `${overdue} 个阶段已逾期，请优先安排处理。` : `共有 ${deadlines.length} 个阶段临近截止，最近截止时间为 ${formatTime(deadlines[0].doc.deadline || '')}。`,
        createdAt: new Date(Math.max(now, deadlines[0].deadline)).toISOString(), target: 'project-plan', projectId: project.id,
      });
    }
  }
  return entries.sort((a, b) => safeDateMs(b.createdAt) - safeDateMs(a.createdAt));
};

const aiStatusMeta: Record<AIJob['status'], { label: string; color: string }> = {
  queued: { label: '排队中', color: 'default' },
  running: { label: '进行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
};

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
  onSendFolder: () => void;
  onShareProject: () => void;
  onOpenAddFriend: () => void;
  onRefresh: () => void;
  onRemoveFriend: (friendId: string) => void;
  onOpenSystemTarget: (target: NotificationTarget, projectId?: string) => void;
}

const FriendChatWorkspace = ({
  open, friends, selectedFriend, messages, loadingMessages, draft, sending, sendingFile, pendingRequestCount,
  onClose, onSelectFriend, onDraftChange, onSendMessage, onSendFile, onSendFolder, onShareProject,
  onOpenAddFriend, onRefresh, onRemoveFriend, onOpenSystemTarget,
}: FriendChatWorkspaceProps) => {
  const projects = useProjectStore(state => state.projects);
  const projectDocs = useProjectDocStore(state => state.projectDocs);
  const reviews = useTemplateStore(state => state.reviews);
  const { jobs: aiJobs, cancelJob, retryJob, clearJob } = useAIJobStore();
  const [keyword, setKeyword] = useState('');
  const [activeKey, setActiveKey] = useState<ConversationKey>('system');
  const [dismissedIds, setDismissedIds] = useState<string[]>(() => loadLocal<string[]>(DISMISSED_KEY, []));
  const [replies, setReplies] = useState<LocalReply[]>(() => loadLocal<LocalReply[]>(REPLIES_KEY, []));
  const [systemDraft, setSystemDraft] = useState('');
  const messageEndRef = useRef<HTMLDivElement>(null);

  const systemMessages = useMemo(
    () => buildSystemMessages(projects, projectDocs, reviews).filter(item => !dismissedIds.includes(item.id)),
    [dismissedIds, projectDocs, projects, reviews],
  );
  const visibleFriends = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    if (!query) return friends;
    return friends.filter(friend => [friend.name, friend.nickname, friend.email, friend.host]
      .filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(query)));
  }, [friends, keyword]);
  const sortedJobs = useMemo(() => [...aiJobs].sort((a, b) => safeDateMs(b.updatedAt) - safeDateMs(a.updatedAt)), [aiJobs]);
  const selectedName = selectedFriend?.name || selectedFriend?.nickname || selectedFriend?.email || selectedFriend?.host || '';
  const activeSystemReplies = useMemo(() => replies.filter(reply => reply.messageId === 'system-reply'), [replies]);

  useEffect(() => {
    if (!open) return;
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [activeKey, loadingMessages, messages, open, activeSystemReplies.length, sortedJobs.length]);

  const selectFriend = (friend: CollaborationPeerInfo) => {
    setActiveKey(`friend:${friend.id}`);
    onSelectFriend(friend);
  };
  const dismissSystem = (id: string) => {
    const next = [...new Set([...dismissedIds, id])].slice(-400);
    setDismissedIds(next);
    saveLocal(DISMISSED_KEY, next);
  };
  const replyToSystem = () => {
    const content = systemDraft.trim();
    if (!content) return;
    const reply: LocalReply = { id: `reply-${Date.now()}`, messageId: 'system-reply', content, createdAt: new Date().toISOString() };
    const next = [...replies, reply].slice(-300);
    setReplies(next);
    saveLocal(REPLIES_KEY, next);
    setSystemDraft('');
  };

  const avatarName = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase() || 'P';
  const currentFriendConversation = activeKey.startsWith('friend:');
  const activeFriend = currentFriendConversation ? selectedFriend : null;

  return (
    <Modal title={null} open={open} onCancel={onClose} footer={null} width={1060} style={{ top: 38 }} styles={{ body: { padding: 0 } }} destroyOnClose={false} className="message-center-modal">
      <div className="message-center-shell">
        <aside className="message-center-sidebar">
          <div className="message-center-sidebar-head">
            <div className="message-center-brand">
              <Avatar size={36} icon={<MessageOutlined />} />
              <div><Text strong>消息中心</Text><Text type="secondary">系统 · AI · 好友</Text></div>
            </div>
            <Space size={0}>
              <Tooltip title="刷新好友状态"><Button type="text" icon={<ReloadOutlined />} onClick={onRefresh} /></Tooltip>
              <Badge count={pendingRequestCount} size="small" offset={[-1, 2]}><Tooltip title="添加好友"><Button type="text" icon={<PlusOutlined />} onClick={onOpenAddFriend} /></Tooltip></Badge>
            </Space>
          </div>
          <Input value={keyword} onChange={event => setKeyword(event.target.value)} prefix={<SearchOutlined />} placeholder="搜索好友" allowClear />
          <div className="message-center-conversations">
            <button className={`message-center-conversation ${activeKey === 'system' ? 'is-active' : ''}`} onClick={() => setActiveKey('system')}>
              <Avatar style={{ background: '#e6f4ff', color: '#1677ff' }} icon={<BellOutlined />} />
              <span><b>系统消息</b><small>{systemMessages[0]?.title || '项目状态与提醒'}</small></span>
              {systemMessages.length > 0 && <Badge count={systemMessages.length} size="small" overflowCount={99} />}
            </button>
            <button className={`message-center-conversation ${activeKey === 'ai' ? 'is-active' : ''}`} onClick={() => setActiveKey('ai')}>
              <Avatar style={{ background: '#f3e8ff', color: '#7c3aed' }} icon={<RobotOutlined />} />
              <span><b>AI 任务</b><small>{aiJobs.some(job => job.status === 'running') ? '有任务正在执行' : '查看任务执行记录'}</small></span>
              {aiJobs.filter(job => job.status === 'running' || job.status === 'queued').length > 0 && <Badge status="processing" />}
            </button>
            <div className="message-center-section-label">好友</div>
            {visibleFriends.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无好友" imageStyle={{ height: 34 }}><Button type="link" size="small" onClick={onOpenAddFriend}>添加好友</Button></Empty> : (
              <List split={false} dataSource={visibleFriends} renderItem={friend => {
                const name = friend.name || friend.nickname || friend.email || friend.host;
                const active = activeKey === `friend:${friend.id}`;
                return <List.Item className={`message-center-friend ${active ? 'is-active' : ''}`} onClick={() => selectFriend(friend)}>
                  <Badge dot color={friend.online ? '#52c41a' : '#bfbfbf'} offset={[-1, 28]}><Avatar>{avatarName(name)}</Avatar></Badge>
                  <span><b>{name}</b><small>{friend.online ? '在线' : '离线'}{friend.email ? ` · ${friend.email}` : ''}</small></span>
                </List.Item>;
              }} />
            )}
          </div>
        </aside>

        <section className="message-center-chat">
          {activeKey === 'system' && <>
            <header className="message-center-chat-head"><Space><Avatar style={{ background: '#e6f4ff', color: '#1677ff' }} icon={<BellOutlined />} /><div><Text strong>系统消息</Text><Text type="secondary">项目报告、审查与截止提醒</Text></div></Space><Button size="small" onClick={() => dismissedIds.length && (setDismissedIds([]), saveLocal(DISMISSED_KEY, []))}>恢复已删除</Button></header>
            <div className="message-center-thread">
              {systemMessages.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统消息" style={{ marginTop: 110 }} /> : systemMessages.map(item => <div className="message-bubble-row" key={item.id}>
                <Avatar size={30} style={{ background: item.severity === 'high' ? '#fff1f0' : item.severity === 'medium' ? '#fff7e6' : '#e6f4ff', color: item.severity === 'high' ? '#ff4d4f' : item.severity === 'medium' ? '#fa8c16' : '#1677ff' }} icon={<BellOutlined />} />
                <div className="message-bubble message-bubble-system"><Space size={6}><Text strong>{item.title}</Text><Tag color={item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'gold' : 'blue'}>{item.category}</Tag></Space><Text>{item.content}</Text><div className="message-bubble-meta"><span>{formatTime(item.createdAt)}</span><Button type="link" size="small" onClick={() => setSystemDraft(`回复「${item.title}」：`)}>回复</Button><Button type="link" size="small" onClick={() => { onOpenSystemTarget(item.target, item.projectId); onClose(); }}>查看</Button><Popconfirm title="删除这条消息？" onConfirm={() => dismissSystem(item.id)}><Button type="link" danger size="small">删除</Button></Popconfirm></div></div>
              </div>)}
              {activeSystemReplies.map(reply => <div className="message-bubble-row is-outgoing" key={reply.id}><div className="message-bubble message-bubble-outgoing"><Text>{reply.content}</Text><span className="message-bubble-meta">{formatTime(reply.createdAt)}</span></div></div>)}
              <div ref={messageEndRef} />
            </div>
            <footer className="message-center-composer"><Input.TextArea value={systemDraft} onChange={event => setSystemDraft(event.target.value)} onPressEnter={event => { if (!event.shiftKey) { event.preventDefault(); replyToSystem(); } }} placeholder="回复或记录处理备注（仅保存到本机）" autoSize={{ minRows: 2, maxRows: 4 }} /><div><Text type="secondary">Enter 发送，Shift + Enter 换行</Text><Button type="primary" icon={<SendOutlined />} disabled={!systemDraft.trim()} onClick={replyToSystem}>回复</Button></div></footer>
          </>}

          {activeKey === 'ai' && <>
            <header className="message-center-chat-head"><Space><Avatar style={{ background: '#f3e8ff', color: '#7c3aed' }} icon={<RobotOutlined />} /><div><Text strong>AI 任务</Text><Text type="secondary">任务进度、结果和失败原因</Text></div></Space></header>
            <div className="message-center-thread">{sortedJobs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AI 任务" style={{ marginTop: 110 }} /> : sortedJobs.map(job => {
              const meta = aiStatusMeta[job.status]; const active = job.status === 'queued' || job.status === 'running';
              return <div className="message-bubble-row" key={job.id}><Avatar size={30} style={{ background: '#f3e8ff', color: '#7c3aed' }} icon={<RobotOutlined />} /><div className={`message-bubble message-bubble-system ${job.status === 'failed' ? 'is-failed' : ''}`}><Space size={6}><Text strong>{job.title}</Text><Tag color={meta.color}>{meta.label}</Tag></Space><Text>{job.error || job.resultPreview || (active ? `已完成 ${job.progress || 0}%` : '任务已结束')}</Text>{active && <div className="message-progress"><span style={{ width: `${job.progress || 0}%` }} /></div>}<div className="message-bubble-meta"><span>{formatTime(job.finishedAt || job.startedAt || job.createdAt)}</span>{active && <Button type="link" danger size="small" onClick={() => cancelJob(job.id)}>取消</Button>}{job.status === 'failed' && job.canRetry && <Button type="link" size="small" onClick={() => void retryJob(job.id)}>重试</Button>}{!active && <Button type="link" danger size="small" onClick={() => clearJob(job.id)}>删除</Button>}</div></div></div>;
            })}<div ref={messageEndRef} /></div>
          </>}

          {currentFriendConversation && activeFriend && <>
            <header className="message-center-chat-head"><Space><Badge dot color={activeFriend.online ? '#52c41a' : '#bfbfbf'} offset={[-1, 29]}><Avatar>{avatarName(selectedName)}</Avatar></Badge><div><Text strong>{selectedName}</Text><Text type="secondary">{activeFriend.online ? '在线，可发送消息和文件' : '离线，暂不能发送'}</Text></div></Space><Space size={2}><Tooltip title="发送当前项目进度"><Button type="text" icon={<FolderOpenOutlined />} onClick={onShareProject} /></Tooltip><Tooltip title="发送文件"><Button type="text" icon={<PaperClipOutlined />} loading={sendingFile} disabled={!activeFriend.online} onClick={onSendFile} /></Tooltip><Tooltip title="发送文件夹"><Button type="text" icon={<FolderOutlined />} loading={sendingFile} disabled={!activeFriend.online} onClick={onSendFolder} /></Tooltip><Popconfirm title="移除这位好友？" onConfirm={() => onRemoveFriend(activeFriend.id)}><Button type="text" danger icon={<UserDeleteOutlined />} /></Popconfirm></Space></header>
            <div className="message-center-thread">{loadingMessages ? <div className="message-loading">正在加载聊天记录…</div> : messages.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无消息，发一句问候吧" style={{ marginTop: 110 }} /> : messages.map(item => <div className={`message-bubble-row ${item.direction === 'outgoing' ? 'is-outgoing' : ''}`} key={item.id}>{item.direction === 'incoming' && <Avatar size={30}>{avatarName(selectedName)}</Avatar>}<div className={`message-bubble ${item.direction === 'outgoing' ? 'message-bubble-outgoing' : ''}`}><Text>{item.content}</Text><span className="message-bubble-meta">{formatTime(item.createdAt)}</span></div></div>)}<div ref={messageEndRef} /></div>
            <footer className="message-center-composer"><Input.TextArea value={draft} onChange={event => onDraftChange(event.target.value)} onPressEnter={event => { if (!event.shiftKey) { event.preventDefault(); onSendMessage(); } }} placeholder={activeFriend.online ? '输入消息，Enter 发送' : '好友离线，暂不能发送'} autoSize={{ minRows: 2, maxRows: 4 }} disabled={!activeFriend.online || sending} /><div><Space><Tooltip title="发送文件"><Button type="text" icon={<PaperClipOutlined />} disabled={!activeFriend.online} onClick={onSendFile} /></Tooltip><Tooltip title="发送文件夹"><Button type="text" icon={<FolderOutlined />} disabled={!activeFriend.online} onClick={onSendFolder} /></Tooltip><Tooltip title="分享当前项目"><Button type="text" icon={<FileOutlined />} onClick={onShareProject} /></Tooltip></Space><Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!draft.trim() || !activeFriend.online} onClick={onSendMessage}>发送</Button></div></footer>
          </>}
        </section>
      </div>
    </Modal>
  );
};

export default FriendChatWorkspace;
