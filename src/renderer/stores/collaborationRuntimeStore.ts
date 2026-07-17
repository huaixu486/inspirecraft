import { create } from 'zustand';

type Updater<T> = T | ((previous: T) => T);
const resolve = <T,>(value: Updater<T>, previous: T) => typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;

interface CollaborationRuntimeState {
  workspaceOpen: boolean;
  friends: CollaborationPeerInfo[];
  addFriendOpen: boolean;
  friendRequests: CollaborationFriendRequest[];
  emailSearch: string;
  emailSearchResult: CollaborationPeerInfo | null;
  emailSearching: boolean;
  chatFriend: CollaborationPeerInfo | null;
  chatMessages: CollaborationChatMessage[];
  chatDraft: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatFileSending: boolean;
  setWorkspaceOpen: (value: boolean) => void;
  setFriends: (value: Updater<CollaborationPeerInfo[]>) => void;
  setAddFriendOpen: (value: boolean) => void;
  setFriendRequests: (value: Updater<CollaborationFriendRequest[]>) => void;
  setEmailSearch: (value: string) => void;
  setEmailSearchResult: (value: Updater<CollaborationPeerInfo | null>) => void;
  setEmailSearching: (value: boolean) => void;
  setChatFriend: (value: CollaborationPeerInfo | null) => void;
  setChatMessages: (value: Updater<CollaborationChatMessage[]>) => void;
  setChatDraft: (value: string) => void;
  setChatLoading: (value: boolean) => void;
  setChatSending: (value: boolean) => void;
  setChatFileSending: (value: boolean) => void;
}

export const useCollaborationRuntimeStore = create<CollaborationRuntimeState>(set => ({
  workspaceOpen: false,
  friends: [],
  addFriendOpen: false,
  friendRequests: [],
  emailSearch: '',
  emailSearchResult: null,
  emailSearching: false,
  chatFriend: null,
  chatMessages: [],
  chatDraft: '',
  chatLoading: false,
  chatSending: false,
  chatFileSending: false,
  setWorkspaceOpen: workspaceOpen => set({ workspaceOpen }),
  setFriends: value => set(state => ({ friends: resolve(value, state.friends) })),
  setAddFriendOpen: addFriendOpen => set({ addFriendOpen }),
  setFriendRequests: value => set(state => ({ friendRequests: resolve(value, state.friendRequests) })),
  setEmailSearch: emailSearch => set({ emailSearch }),
  setEmailSearchResult: value => set(state => ({ emailSearchResult: resolve(value, state.emailSearchResult) })),
  setEmailSearching: emailSearching => set({ emailSearching }),
  setChatFriend: chatFriend => set({ chatFriend }),
  setChatMessages: value => set(state => ({ chatMessages: resolve(value, state.chatMessages) })),
  setChatDraft: chatDraft => set({ chatDraft }),
  setChatLoading: chatLoading => set({ chatLoading }),
  setChatSending: chatSending => set({ chatSending }),
  setChatFileSending: chatFileSending => set({ chatFileSending }),
}));
