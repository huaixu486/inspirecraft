import React, { useEffect } from 'react';
import { message } from 'antd';
import { useCollaborationRuntimeStore } from '../../stores/collaborationRuntimeStore';
import { useCollaborationActivityStore } from '../../stores/collaborationActivityStore';

const CollaborationRuntime: React.FC = () => {
  const chatFriendId = useCollaborationRuntimeStore(state => state.chatFriend?.id);
  const setFriends = useCollaborationRuntimeStore(state => state.setFriends);
  const setFriendRequests = useCollaborationRuntimeStore(state => state.setFriendRequests);
  const setChatMessages = useCollaborationRuntimeStore(state => state.setChatMessages);
  const recordActivity = useCollaborationActivityStore(state => state.recordActivity);

  useEffect(() => {
    void window.electronAPI.listCollaborationFriends?.().then(result => {
      if (result?.success) setFriends(result.friends || []);
    });
    const offPeers = window.electronAPI.onCollaborationPeersChanged?.(payload => setFriends(payload.friends || []));
    const offFile = window.electronAPI.onCollaborationFileReceived?.(payload => {
      if (!payload.fileName) return;
      const itemLabel = payload.isDirectory ? '文件夹' : '文件';
      message.success(`已接收${itemLabel}：${payload.fileName}`);
      void window.electronAPI.showSystemNotification?.({ title: `收到新${itemLabel}`, body: `${payload.senderName || '好友'} 发送了${itemLabel}：${payload.fileName}${payload.projectName ? `（${payload.projectName}）` : ''}`, target: 'overview' });
    });
    const offTask = window.electronAPI.onCollaborationTaskReceived?.(payload => {
      if (!payload.task) return;
      message.success(`收到协作任务邀约：${payload.task.title || '未命名任务'}`);
      recordActivity({
        projectId: payload.task.projectId,
        projectName: payload.projectName,
        kind: 'friend',
        status: 'info',
        title: `收到 ${payload.senderName || '好友'} 的协作任务`,
        detail: payload.task.title || '未命名任务',
        createdAt: payload.sentAt,
      });
      void window.electronAPI.showSystemNotification?.({ title: '收到协作任务邀约', body: `${payload.senderName || '好友'} 邀请你协同处理：${payload.task.title || '未命名任务'}。请在消息中心接受或拒绝。`, target: 'overview' });
    });
    const offFriendReq = window.electronAPI.onFriendRequestReceived?.(payload => {
      if (!payload.fromName) return;
      message.info(`收到好友请求：${payload.fromName}`);
      void window.electronAPI.showSystemNotification?.({ title: '收到好友请求', body: `${payload.fromName}${payload.fromDeviceName ? ` (${payload.fromDeviceName})` : ''} 请求添加你为好友`, target: 'overview' });
      void window.electronAPI.listFriendRequests?.().then(result => { if (result?.success) setFriendRequests(result.requests || []); });
    });
    const offChat = window.electronAPI.onCollaborationChatReceived?.(chat => {
      if (chatFriendId === chat.friendId) setChatMessages(previous => previous.some(item => item.id === chat.id) ? previous : [...previous, chat]);
      void window.electronAPI.showSystemNotification?.({ title: `收到 ${chat.senderName || '好友'} 的消息`, body: chat.content.slice(0, 80), target: 'overview' });
    });
    return () => { offPeers?.(); offFile?.(); offTask?.(); offFriendReq?.(); offChat?.(); };
  }, [chatFriendId, recordActivity, setChatMessages, setFriendRequests, setFriends]);

  return null;
};

export default CollaborationRuntime;
