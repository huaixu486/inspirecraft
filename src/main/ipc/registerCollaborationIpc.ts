import { defineIpcHandler } from './registry';

export const isCollaborationIpc = (channel: string) => /^(collaboration|communication):/.test(channel);

export const defineCollaborationIpc = (deps: {
  startReceiver: (params?: { port?: number }) => Promise<unknown>;
  stopReceiver: () => Promise<unknown>;
  getStatus: () => unknown;
  sendTask: (params: any) => Promise<unknown>;
  respondTaskOffer: (params: any) => Promise<unknown>;
  searchByEmail: (email: string) => Promise<unknown>;
  addFriend: (peer: any) => Promise<unknown>;
  removeFriend: (friendId: string) => Promise<unknown>;
  listFriends: () => Promise<unknown>;
  listChatMessages: (friendId: string) => Promise<unknown>;
  sendChatMessage: (params: any) => Promise<unknown>;
  sendFile: (params: any) => Promise<unknown>;
  loadMessageCenterState: () => Promise<unknown>;
  saveMessageCenterState: (state: any) => Promise<unknown>;
  sendFriendRequest: (params: any) => Promise<unknown>;
  listFriendRequests: () => unknown;
  acceptFriendRequest: (requestId: string) => Promise<unknown>;
  rejectFriendRequest: (requestId: string) => Promise<unknown>;
}) => {
  defineIpcHandler('collaboration:startReceiver', async (_event, params?: { port?: number }) => deps.startReceiver(params));
  defineIpcHandler('collaboration:stopReceiver', async () => deps.stopReceiver());
  defineIpcHandler('collaboration:getStatus', async () => deps.getStatus());
  defineIpcHandler('collaboration:sendTask', async (_event, params: any) => deps.sendTask(params));
  defineIpcHandler('collaboration:respondTaskOffer', async (_event, params: any) => deps.respondTaskOffer(params));
  defineIpcHandler('collaboration:searchByEmail', async (_event, email: string) => deps.searchByEmail(email));
  defineIpcHandler('collaboration:addFriend', async (_event, peer: any) => deps.addFriend(peer));
  defineIpcHandler('collaboration:removeFriend', async (_event, friendId: string) => deps.removeFriend(friendId));
  defineIpcHandler('collaboration:listFriends', async () => deps.listFriends());
  defineIpcHandler('collaboration:listChatMessages', async (_event, friendId: string) => deps.listChatMessages(friendId));
  defineIpcHandler('collaboration:sendChatMessage', async (_event, params: any) => deps.sendChatMessage(params));
  defineIpcHandler('collaboration:sendFile', async (_event, params: any) => deps.sendFile(params));
  defineIpcHandler('communication:loadMessageCenterState', async () => deps.loadMessageCenterState());
  defineIpcHandler('communication:saveMessageCenterState', async (_event, state: any) => deps.saveMessageCenterState(state));
  defineIpcHandler('collaboration:sendFriendRequest', async (_event, params: any) => deps.sendFriendRequest(params));
  defineIpcHandler('collaboration:listFriendRequests', async () => deps.listFriendRequests());
  defineIpcHandler('collaboration:acceptFriendRequest', async (_event, requestId: string) => deps.acceptFriendRequest(requestId));
  defineIpcHandler('collaboration:rejectFriendRequest', async (_event, requestId: string) => deps.rejectFriendRequest(requestId));
};
