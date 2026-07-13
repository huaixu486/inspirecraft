import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Notification } from 'electron';
import { net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as zlib from 'zlib';
import * as http from 'http';
import * as dgram from 'dgram';
import * as os from 'os';
import { Project, DocumentVersion, WritingTemplate, ReviewResult, ReviewIssue, ReviewConfig, AIConfig, AIModelConfig, TaskItem, AppSettings, ProjectDocument, SectionAnalysis, TemplateNode, StageMemoryEntry, ReferenceMaterial, PromptScene, PromptTemplate, SkillPackage, StructuredPrompt, PromptRule, OutputField } from './types';
import {
  checkWithinWorkspace,
  checkAllWithinWorkspace,
  checkParentWithinWorkspace,
  checkSafeChildName,
  checkPathInside,
} from './shared/pathGuard';
import {
  appendAiLog,
  loadAIConfigFromDisk,
  saveAIConfigToDisk,
  normalizeAIConfig,
  getEnabledAIModels,
  getActiveAIModel,
  callDefaultAI,
  callConfiguredAI,
  callAIWithConfig,
  callParallelAI,
  callParallelAIDetails,
  callAIModel,
} from './services/aiService';
import { getAIUsageRecords, getAIUsageStatistics, onAIActivity, runWithAIUsageContext, sumAIUsage } from './services/aiUsageService';
import { composePromptMain } from './shared/promptComposer';
import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
const JSZip = require('jszip');

let mainWindow: BrowserWindow | null = null;
const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const APP_USER_MODEL_ID = 'com.projecthub.desktop';
const APP_DISPLAY_NAME = 'ProjectHub';
let devReloadTimer: NodeJS.Timeout | null = null;
let didEnsureWindowsNotificationShortcut = false;

let collaborationServer: http.Server | null = null;
let collaborationPort = 0;
let collaborationDiscoverySocket: dgram.Socket | null = null;
let collaborationDiscoveryTimer: NodeJS.Timeout | null = null;
const COLLABORATION_DISCOVERY_PORT = 39219;
const COLLABORATION_PEER_TTL_MS = 12000;
const discoveredCollaborationPeers = new Map<string, LanPeerRecord>();

type CollaborationTaskPayload = {
  task?: TaskItem;
  projectName?: string;
  senderName?: string;
  sentAt?: string;
};

type CollaborationFriend = {
  id: string;
  name: string;
  nickname?: string;
  email?: string;
  deviceName?: string;
  host: string;
  port: number;
  source: 'lan' | 'email' | 'nickname' | 'manual' | 'invite';
  status: 'pending' | 'accepted' | 'blocked';
  addedAt: string;
  lastSeenAt?: string;
  online?: boolean;
};

type CollaborationFriendRequest = {
  id: string;
  fromId: string;
  fromName: string;
  fromDeviceName?: string;
  fromHost: string;
  fromPort: number;
  targetId?: string;
  message?: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
};

type LanPeerRecord = {
  id: string;
  name: string;
  deviceName?: string;
  host: string;
  port: number;
  lastSeenAt: string;
};

type CollaborationFileSendParams = {
  endpoint?: string;
  friendId?: string;
  filePath: string;
  projectName?: string;
  senderName?: string;
};

function getLanAddresses() {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).forEach(items => {
    (items || []).forEach(item => {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    });
  });
  return addresses;
}

function readRequestBody(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: any) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function getLocalCollaborationIdentity() {
  ensureDataDir();
  try {
    if (fs.existsSync(collaborationIdentityFile)) {
      const saved = JSON.parse(fs.readFileSync(collaborationIdentityFile, 'utf-8'));
      if (saved?.id) return saved as { id: string; name: string; deviceName: string };
    }
  } catch {}
  const identity = {
    id: 'peer-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    name: os.userInfo().username || os.hostname() || APP_DISPLAY_NAME,
    deviceName: os.hostname() || APP_DISPLAY_NAME,
  };
  fs.writeFileSync(collaborationIdentityFile, JSON.stringify(identity, null, 2), 'utf-8');
  return identity;
}

function isPeerOnline(lastSeenAt?: string) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < COLLABORATION_PEER_TTL_MS;
}

function loadCollaborationFriendsFromDisk(): CollaborationFriend[] {
  ensureDataDir();
  if (!fs.existsSync(collaborationFriendsFile)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(collaborationFriendsFile, 'utf-8'));
    if (!Array.isArray(rows)) return [];
    return rows.filter(item => item?.id && item?.host && item?.port).map(item => ({
      id: String(item.id),
      name: String(item.name || item.deviceName || item.host),
      nickname: item.nickname ? String(item.nickname) : undefined,
      email: item.email ? String(item.email) : undefined,
      deviceName: item.deviceName ? String(item.deviceName) : undefined,
      host: String(item.host),
      port: Number(item.port) || 39218,
      source: (item.source || 'lan') as CollaborationFriend['source'],
      status: (item.status || 'accepted') as CollaborationFriend['status'],
      addedAt: String(item.addedAt || new Date().toISOString()),
      lastSeenAt: item.lastSeenAt ? String(item.lastSeenAt) : undefined,
    }));
  } catch {
    return [];
  }
}

function saveCollaborationFriendsToDisk(friends: CollaborationFriend[]) {
  ensureDataDir();
  fs.writeFileSync(collaborationFriendsFile, JSON.stringify(friends, null, 2), 'utf-8');
}

function getCollaborationPeers() {
  const friends = loadCollaborationFriendsFromDisk();
  const friendIds = new Set(friends.map(friend => friend.id));
  const localId = getLocalCollaborationIdentity().id;
  return Array.from(discoveredCollaborationPeers.values())
    .filter(peer => peer.id !== localId)
    .map(peer => ({ ...peer, online: isPeerOnline(peer.lastSeenAt), added: friendIds.has(peer.id) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

function getCollaborationFriends() {
  const discovered = new Map(Array.from(discoveredCollaborationPeers.values()).map(peer => [peer.id, peer]));
  return loadCollaborationFriendsFromDisk().map(friend => {
    const live = discovered.get(friend.id);
    return {
      ...friend,
      host: live?.host || friend.host,
      port: live?.port || friend.port,
      lastSeenAt: live?.lastSeenAt || friend.lastSeenAt,
      online: isPeerOnline(live?.lastSeenAt || friend.lastSeenAt),
    };
  }).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

function emitCollaborationPeersChanged() {
  mainWindow?.webContents.send('collaboration:peersChanged', {
    peers: getCollaborationPeers(),
    friends: getCollaborationFriends(),
  });
}

function sendCollaborationDiscoveryBeat() {
  if (!collaborationDiscoverySocket || !collaborationPort) return;
  const identity = getLocalCollaborationIdentity();
  const payload = Buffer.from(JSON.stringify({
    type: 'projecthub:hello',
    id: identity.id,
    name: identity.name,
    deviceName: identity.deviceName,
    port: collaborationPort,
    app: APP_DISPLAY_NAME,
    sentAt: new Date().toISOString(),
  }));
  collaborationDiscoverySocket.send(payload, 0, payload.length, COLLABORATION_DISCOVERY_PORT, '255.255.255.255', () => {});
}

function startCollaborationDiscovery() {
  if (collaborationDiscoverySocket) return;
  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, rinfo) => {
      try {
        const payload = JSON.parse(message.toString('utf8'));
        if (payload?.type !== 'projecthub:hello' || !payload.id || payload.id === getLocalCollaborationIdentity().id) return;
        const peer: LanPeerRecord = {
          id: String(payload.id),
          name: String(payload.name || payload.deviceName || rinfo.address),
          deviceName: payload.deviceName ? String(payload.deviceName) : undefined,
          host: rinfo.address,
          port: Number(payload.port) || 39218,
          lastSeenAt: new Date().toISOString(),
        };
        discoveredCollaborationPeers.set(peer.id, peer);
        emitCollaborationPeersChanged();
      } catch {}
    });
    socket.on('error', () => { stopCollaborationDiscovery(); });
    socket.bind(COLLABORATION_DISCOVERY_PORT, () => {
      try { socket.setBroadcast(true); } catch {}
      sendCollaborationDiscoveryBeat();
      collaborationDiscoveryTimer = setInterval(sendCollaborationDiscoveryBeat, 3000);
    });
    collaborationDiscoverySocket = socket;
  } catch {}
}

function stopCollaborationDiscovery() {
  if (collaborationDiscoveryTimer) clearInterval(collaborationDiscoveryTimer);
  collaborationDiscoveryTimer = null;
  if (collaborationDiscoverySocket) {
    try { collaborationDiscoverySocket.close(); } catch {}
  }
  collaborationDiscoverySocket = null;
}

function resolveCollaborationTarget(params: { endpoint?: string; friendId?: string }) {
  if (params.endpoint) return normalizeCollaborationEndpoint(params.endpoint);
  if (!params.friendId) throw new Error('Missing collaboration target');
  const friend = getCollaborationFriends().find(item => item.id === params.friendId);
  if (!friend) throw new Error('Friend not found');
  const url = new URL('http://' + friend.host + ':' + friend.port);
  url.pathname = '/tasks';
  return url;
}

function sanitizeTransferFileName(name: string) {
  const value = path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return value || 'file';
}

function getUniqueTransferPath(targetPath: string) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const ext = path.extname(targetPath);
  const base = targetPath.slice(0, targetPath.length - ext.length);
  let index = 1;
  while (fs.existsSync(base + ' (' + index + ')' + ext)) index += 1;
  return base + ' (' + index + ')' + ext;
}

function getIncomingFilesDir() {
  const dir = path.join(app.getPath('downloads'), 'ProjectHub Received');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveIncomingCollaborationFile(req: http.IncomingMessage, requestUrl: URL) {
  const headerName = Array.isArray(req.headers['x-projecthub-file-name']) ? req.headers['x-projecthub-file-name'][0] : req.headers['x-projecthub-file-name'];
  const fileName = sanitizeTransferFileName(decodeURIComponent(String(headerName || requestUrl.searchParams.get('name') || 'file')));
  const senderName = decodeURIComponent(String(req.headers['x-projecthub-sender-name'] || requestUrl.searchParams.get('senderName') || ''));
  const projectName = decodeURIComponent(String(req.headers['x-projecthub-project-name'] || requestUrl.searchParams.get('projectName') || ''));
  const finalPath = getUniqueTransferPath(path.join(getIncomingFilesDir(), fileName));
  const tempPath = finalPath + '.part-' + Date.now();
  return new Promise<{ filePath: string; fileName: string; size: number }>((resolve, reject) => {
    let size = 0;
    const output = fs.createWriteStream(tempPath);
    req.on('data', chunk => { size += Buffer.byteLength(chunk); });
    req.on('error', reject);
    output.on('error', reject);
    output.on('finish', () => {
      try {
        fs.renameSync(tempPath, finalPath);
        const payload = { filePath: finalPath, fileName, size, senderName, projectName, receivedAt: new Date().toISOString() };
        mainWindow?.webContents.send('collaboration:fileReceived', payload);
        resolve({ filePath: finalPath, fileName, size });
      } catch (error) {
        reject(error);
      }
    });
    req.pipe(output);
  }).catch(error => {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    throw error;
  });
}

function sendFileToPeer(params: CollaborationFileSendParams) {
  const stat = fs.statSync(params.filePath);
  if (stat.isDirectory()) throw new Error('Folder transfer is not supported yet');
  const url = resolveCollaborationTarget(params);
  url.pathname = '/files';
  const fileName = path.basename(params.filePath);
  return new Promise<any>((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'X-ProjectHub-File-Name': encodeURIComponent(fileName),
        'X-ProjectHub-Sender-Name': encodeURIComponent(params.senderName || os.userInfo().username || APP_DISPLAY_NAME),
        'X-ProjectHub-Project-Name': encodeURIComponent(params.projectName || ''),
      },
    }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { response += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(response || '{}');
          if (res.statusCode && res.statusCode >= 400) reject(new Error(parsed.error || 'HTTP ' + res.statusCode));
          else resolve(parsed);
        } catch {
          if (res.statusCode && res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode));
          else resolve({ success: true, raw: response });
        }
      });
    });
    req.on('error', reject);
    fs.createReadStream(params.filePath).on('error', reject).pipe(req);
  });
}

function normalizeCollaborationEndpoint(endpoint: string) {
  const value = String(endpoint || '').trim();
  if (!value) throw new Error('Peer address is empty');
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  const url = new URL(withProtocol);
  if (!url.pathname || url.pathname === '/') url.pathname = '/tasks';
  return url;
}

function saveIncomingCollaborationTask(payload: CollaborationTaskPayload) {
  if (!payload.task) throw new Error('Missing task payload');
  const now = new Date().toISOString();
  const incoming = payload.task;
  const senderLine = payload.senderName || payload.projectName
    ? `\n\n[LAN] From ${payload.senderName || 'ProjectHub'}${payload.projectName ? ` / ${payload.projectName}` : ''}`
    : '';
  const task: TaskItem = {
    ...incoming,
    id: `lan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    status: 'pending',
    assigneeName: incoming.assigneeName || os.userInfo().username || 'Local user',
    description: `${incoming.description || ''}${senderLine}`.trim(),
    createdAt: now,
    completedAt: undefined,
    result: undefined,
  };
  const tasks = loadTasksFromDisk();
  saveTasksToDisk([...tasks, task]);
  mainWindow?.webContents.send('collaboration:taskReceived', {
    task,
    projectName: payload.projectName || '',
    senderName: payload.senderName || '',
    sentAt: payload.sentAt || now,
  });
  return task;
}

function createCollaborationHttpServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return writeJson(res, 200, { success: true });
      if (req.method === 'GET' && (req.url === '/status' || req.url === '/')) {
        return writeJson(res, 200, { success: true, app: APP_DISPLAY_NAME, port: collaborationPort });
      }
      const requestUrl = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
      if (req.method === 'POST' && requestUrl.pathname === '/files') {
        const file = await saveIncomingCollaborationFile(req, requestUrl);
        return writeJson(res, 200, { success: true, file });
      }
      if (req.method === 'POST' && requestUrl.pathname === '/friend-request') {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        // 保存收到的好友请求
        const requests = loadFriendRequestsFromDisk();
        const existing = requests.find(r => r.fromId === payload.fromId && r.status === 'pending');
        if (!existing) {
          const request: CollaborationFriendRequest = {
            id: `req-${Date.now()}-${payload.fromId}`,
            fromId: payload.fromId,
            fromName: payload.fromName || payload.fromDeviceName || 'Unknown',
            fromDeviceName: payload.fromDeviceName,
            fromHost: payload.fromHost || req.socket.remoteAddress || '',
            fromPort: payload.fromPort || 0,
            message: payload.message,
            createdAt: new Date().toISOString(),
            status: 'pending',
          };
          saveFriendRequestsToDisk([request, ...requests]);
          mainWindow?.webContents.send('collaboration:friendRequestReceived', request);
        }
        return writeJson(res, 200, { success: true });
      }
      if (req.method !== 'POST' || !String(req.url || '').startsWith('/tasks')) {
        return writeJson(res, 404, { success: false, error: 'Not found' });
      }
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || '{}') as CollaborationTaskPayload;
      const task = saveIncomingCollaborationTask(payload);
      return writeJson(res, 200, { success: true, taskId: task.id });
    } catch (error: any) {
      return writeJson(res, 400, { success: false, error: error?.message || String(error) });
    }
  });
}

function listenCollaborationServer(server: http.Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: any) => reject(error);
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

async function startCollaborationServer(preferredPort = 39218) {
  if (collaborationServer) {
    startCollaborationDiscovery();
    return {
      success: true,
      port: collaborationPort,
      addresses: getLanAddresses(),
      urls: getLanAddresses().map(address => `http://${address}:${collaborationPort}/tasks`),
      peers: getCollaborationPeers(),
      friends: getCollaborationFriends(),
    };
  }

  let server = createCollaborationHttpServer();
  try {
    collaborationPort = await listenCollaborationServer(server, preferredPort);
  } catch (firstError: any) {
    try {
      server.close();
    } catch {}
    server = createCollaborationHttpServer();
    try {
      collaborationPort = await listenCollaborationServer(server, 0);
    } catch (secondError: any) {
      throw new Error(secondError?.message || firstError?.message || 'Failed to start LAN receiver');
    }
  }

  collaborationServer = server;
  startCollaborationDiscovery();
  return {
    success: true,
    port: collaborationPort,
    addresses: getLanAddresses(),
    urls: getLanAddresses().map(address => `http://${address}:${collaborationPort}/tasks`),
    peers: getCollaborationPeers(),
    friends: getCollaborationFriends(),
  };
}

function stopCollaborationServer() {
  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    if (!collaborationServer) return resolve({ success: true });
    collaborationServer.close((error) => {
      collaborationServer = null;
      collaborationPort = 0;
      stopCollaborationDiscovery();
      resolve(error ? { success: false, error: error.message } : { success: true });
    });
  });
}

function postJsonToPeer(endpoint: string, payload: any) {
  const url = normalizeCollaborationEndpoint(endpoint);
  const body = JSON.stringify(payload);
  return new Promise<any>((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { response += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(response || '{}');
          if (res.statusCode && res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch {
          if (res.statusCode && res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
          else resolve({ success: true, raw: response });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('Connection timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

function getWindowsNotificationShortcutPath() {
  const appData = app.getPath('appData');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_DISPLAY_NAME}.lnk`);
}

function ensureWindowsNotificationShortcut() {
  if (process.platform !== 'win32') return { success: true, skipped: true };
  try {
    const shortcutPath = getWindowsNotificationShortcutPath();
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
    const target = process.execPath;
    const appPath = app.getAppPath();
    const args = app.isPackaged ? '' : `"${appPath}"`;
    const ok = shell.writeShortcutLink(shortcutPath, 'replace', {
      target,
      args,
      cwd: app.isPackaged ? path.dirname(process.execPath) : appPath,
      description: APP_DISPLAY_NAME,
      appUserModelId: APP_USER_MODEL_ID,
      icon: process.execPath,
      iconIndex: 0,
    });
    didEnsureWindowsNotificationShortcut = ok;
    return { success: ok, shortcutPath, appUserModelId: APP_USER_MODEL_ID };
  } catch (error: any) {
    console.warn('Failed to ensure Windows notification shortcut:', error?.message || error);
    return { success: false, error: error?.message || String(error), appUserModelId: APP_USER_MODEL_ID };
  }
}

// 文件夹监听器
const folderWatchers: Map<string, fs.FSWatcher> = new Map();

// 数据存储路径
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'project-manager-data');
const projectsFile = path.join(dataDir, 'projects.json');
const versionsFile = path.join(dataDir, 'versions.json');
const templatesFile = path.join(dataDir, 'templates.json');
const reviewsFile = path.join(dataDir, 'reviews.json');
const aiConfigFile = path.join(dataDir, 'ai-config.json');
const tasksFile = path.join(dataDir, 'tasks.json');
const collaborationFriendsFile = path.join(dataDir, 'collaboration-friends.json');
const collaborationRequestsFile = path.join(dataDir, 'collaboration-requests.json');
const collaborationIdentityFile = path.join(dataDir, 'collaboration-identity.json');
const settingsFile = path.join(dataDir, 'settings.json');
const projectDocsFile = path.join(dataDir, 'project-documents.json');
const stageMemoriesFile = path.join(dataDir, 'stage-memories.json');
const referenceMaterialsFile = path.join(dataDir, 'reference-materials.json');
const promptTemplatesFile = path.join(dataDir, 'prompt-templates.json');
const skillPackagesFile = path.join(dataDir, 'skill-packages.json');
const templateFilesDir = path.join(dataDir, 'template-files');
const logsDir = path.join(userDataPath, 'logs');
const aiLogFile = path.join(logsDir, 'ai.log');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 读取所有项目
function loadProjectsFromDisk(): Project[] {
  ensureDataDir();
  if (!fs.existsSync(projectsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(projectsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存项目列表到磁盘
function saveProjectsToDisk(projects: Project[]) {
  ensureDataDir();
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2), 'utf-8');
}

// 读取所有版本
function loadVersionsFromDisk(): DocumentVersion[] {
  ensureDataDir();
  if (!fs.existsSync(versionsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(versionsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存版本列表到磁盘
function saveVersionsToDisk(versions: DocumentVersion[]) {
  ensureDataDir();
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2), 'utf-8');
}

// 读取所有模板
function loadTemplatesFromDisk(): WritingTemplate[] {
  ensureDataDir();
  if (!fs.existsSync(templatesFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(templatesFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存模板列表到磁盘
function saveTemplatesToDisk(templates: WritingTemplate[]) {
  ensureDataDir();
  fs.writeFileSync(templatesFile, JSON.stringify(templates, null, 2), 'utf-8');
}

// 读取所有审查结果
function loadReviewsFromDisk(): ReviewResult[] {
  ensureDataDir();
  if (!fs.existsSync(reviewsFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(reviewsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 保存审查结果到磁盘
function saveReviewsToDisk(reviews: ReviewResult[]) {
  ensureDataDir();
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2), 'utf-8');
}

// 读取所有任务
function loadTasksFromDisk(): TaskItem[] {
  ensureDataDir();
  if (!fs.existsSync(tasksFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(tasksFile, 'utf-8');
    return dedupeTasksForPersistence(JSON.parse(data));
  } catch {
    return [];
  }
}

// 保存任务列表到磁盘

function taskTimeMs(value?: string) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeTaskText(value?: string) {
  return String(value || '')
    .replace(/^\u6765\u81ea AI \u5199\u4f5c\u6846\u67b6\u5de5\u4f5c\u6d41\uff1a.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getTaskSemanticKey(task: TaskItem) {
  return [
    task.projectId,
    task.relatedDocId || '',
    task.source || 'manual',
    task.type,
    normalizeTaskText(task.title),
    normalizeTaskText(task.description),
  ].join('|');
}

function dedupeTasksForPersistence(tasks: TaskItem[]) {
  const byKey = new Map<string, TaskItem>();
  tasks.forEach((task) => {
    const key = getTaskSemanticKey(task);
    const existing = byKey.get(key);
    if (!existing || taskTimeMs(task.createdAt) >= taskTimeMs(existing.createdAt)) {
      byKey.set(key, task);
    }
  });
  return Array.from(byKey.values()).sort((a, b) => taskTimeMs(b.createdAt) - taskTimeMs(a.createdAt));
}

function saveTasksToDisk(tasks: TaskItem[]) {
  ensureDataDir();
  fs.writeFileSync(tasksFile, JSON.stringify(dedupeTasksForPersistence(tasks), null, 2), 'utf-8');
}

// 默认工作区路径
const defaultWorkspacePath = path.join(userDataPath, 'projects');

// 读取设置
function loadSettingsFromDisk(): AppSettings {
  ensureDataDir();
  if (!fs.existsSync(settingsFile)) {
    return { workspacePath: defaultWorkspacePath, workspaceCapacity: 10 };
  }
  try {
    const data = fs.readFileSync(settingsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { workspacePath: defaultWorkspacePath, workspaceCapacity: 10 };
  }
}

// Every model call, including calls made outside the task planner, reports a
// single lifecycle to both the renderer task center and Windows notifications.
// No prompt or document content is ever included in the notification body.
onAIActivity((activity) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai:activity', activity);
  }

  const settings = loadSettingsFromDisk();
  if (settings.enableSystemNotifications === false || !Notification.isSupported()) return;
  if (!didEnsureWindowsNotificationShortcut) ensureWindowsNotificationShortcut();

  const title = activity.status === 'started'
    ? `AI 正在处理：${activity.modelName}`
    : activity.status === 'completed'
      ? `AI 已完成：${activity.modelName}`
      : `AI 任务失败：${activity.modelName}`;
  const body = activity.status === 'started'
    ? '任务已加入 AI 任务中心，可在应用右上角查看进度。'
    : activity.status === 'completed'
      ? '任务处理完成，结果已返回到当前工作区。'
      : `处理未完成：${activity.error || '请检查模型配置或网络后重试。'}`;
  try {
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      app.focus({ steal: true });
    });
    notification.show();
  } catch (error) {
    console.warn('[AI] Failed to show Windows notification:', error);
  }
});

// 递归计算目录大小（字节）
async function getDirSize(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0;
  let totalSize = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirSize(fullPath);
      } else {
        try {
          const stat = await fs.promises.stat(fullPath);
          totalSize += stat.size;
        } catch {}
      }
    }
  } catch {}
  return totalSize;
}

type WorkspaceMigrationPathPair = { source: string; target: string };

function isSameOrChildPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function remapMigratedPath(value: string | undefined, paths: WorkspaceMigrationPathPair[]): string | undefined {
  if (!value) return value;
  const matchingPath = [...paths]
    .sort((a, b) => b.source.length - a.source.length)
    .find(item => isSameOrChildPath(value, item.source));
  if (!matchingPath) return value;
  return path.resolve(matchingPath.target, path.relative(matchingPath.source, value));
}

async function moveWorkspaceFolder(sourcePath: string, targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) throw new Error('目标工作区中已存在同名文件夹');
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error: any) {
    // 跨磁盘移动会触发 EXDEV，改为复制完成后删除源目录。
    if (error?.code !== 'EXDEV') throw error;
    await fs.promises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
    await fs.promises.rm(sourcePath, { recursive: true, force: false });
  }
}

const RECYCLE_BIN_DIR_NAME = '.projecthub-recycle-bin';
const RECYCLE_BIN_ENTRIES_DIR_NAME = 'entries';
const RECYCLE_BIN_INDEX_FILE_NAME = 'index.json';

type RecycleBinEntry = {
  id: string;
  name: string;
  originalPath: string;
  recycledPath: string;
  isDirectory: boolean;
  deletedAt: string;
  size: number;
};

function getActiveWorkspaceRoot(requestedWorkspacePath?: string): string {
  const configuredWorkspacePath = String(loadSettingsFromDisk().workspacePath || '').trim();
  if (!configuredWorkspacePath) throw new Error('尚未设置工作区路径');
  const configuredRoot = path.resolve(configuredWorkspacePath);
  if (requestedWorkspacePath && path.resolve(requestedWorkspacePath) !== configuredRoot) {
    throw new Error('回收站只能操作当前工作区');
  }
  return configuredRoot;
}

function getRecycleBinPaths(workspaceRoot: string) {
  const root = path.join(workspaceRoot, RECYCLE_BIN_DIR_NAME);
  return {
    root,
    entries: path.join(root, RECYCLE_BIN_ENTRIES_DIR_NAME),
    index: path.join(root, RECYCLE_BIN_INDEX_FILE_NAME),
  };
}

function loadRecycleBinEntries(workspaceRoot: string): RecycleBinEntry[] {
  const { index } = getRecycleBinPaths(workspaceRoot);
  if (!fs.existsSync(index)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(index, 'utf-8'));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function saveRecycleBinEntries(workspaceRoot: string, entries: RecycleBinEntry[]): void {
  const paths = getRecycleBinPaths(workspaceRoot);
  fs.mkdirSync(paths.entries, { recursive: true });
  const tempIndex = `${paths.index}.tmp`;
  fs.writeFileSync(tempIndex, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tempIndex, paths.index);
}

async function removeRecycleBinEntryFile(entry: RecycleBinEntry): Promise<void> {
  if (!fs.existsSync(entry.recycledPath)) return;
  if (entry.isDirectory) await fs.promises.rm(entry.recycledPath, { recursive: true, force: true });
  else await fs.promises.unlink(entry.recycledPath);
}

async function cleanupRecycleBinForWorkspace(workspaceRoot: string): Promise<number> {
  const retentionDays = Math.min(365, Math.max(1, Number(loadSettingsFromDisk().recycleBinRetentionDays || 30)));
  const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = loadRecycleBinEntries(workspaceRoot);
  const expired = entries.filter(entry => !Number.isFinite(new Date(entry.deletedAt).getTime()) || new Date(entry.deletedAt).getTime() <= threshold);
  await Promise.all(expired.map(removeRecycleBinEntryFile));
  if (expired.length) saveRecycleBinEntries(workspaceRoot, entries.filter(entry => !expired.includes(entry)));
  return expired.length;
}

async function movePathToRecycleBin(filePath: string): Promise<RecycleBinEntry> {
  const workspaceRoot = getActiveWorkspaceRoot();
  const sourcePath = path.resolve(filePath);
  const recyclePaths = getRecycleBinPaths(workspaceRoot);
  if (!isSameOrChildPath(sourcePath, workspaceRoot) || isSameOrChildPath(sourcePath, recyclePaths.root)) {
    throw new Error('只能将当前工作区中的文件或文件夹移入回收站');
  }
  if (!fs.existsSync(sourcePath)) throw new Error('文件或文件夹不存在');

  await cleanupRecycleBinForWorkspace(workspaceRoot);
  await fs.promises.mkdir(recyclePaths.entries, { recursive: true });
  const stat = await fs.promises.stat(sourcePath);
  const id = `recycle-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const recycledPath = path.join(recyclePaths.entries, `${id}-${path.basename(sourcePath)}`);
  if (stat.isDirectory()) await moveWorkspaceFolder(sourcePath, recycledPath);
  else {
    try {
      await fs.promises.rename(sourcePath, recycledPath);
    } catch (error: any) {
      if (error?.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(sourcePath, recycledPath, fs.constants.COPYFILE_EXCL);
      await fs.promises.unlink(sourcePath);
    }
  }
  const entry: RecycleBinEntry = {
    id,
    name: path.basename(sourcePath),
    originalPath: sourcePath,
    recycledPath,
    isDirectory: stat.isDirectory(),
    deletedAt: new Date().toISOString(),
    size: stat.isDirectory() ? await getDirSize(recycledPath) : stat.size,
  };
  saveRecycleBinEntries(workspaceRoot, [entry, ...loadRecycleBinEntries(workspaceRoot)]);
  return entry;
}

// 保存设置
function saveSettingsToDisk(settings: AppSettings) {
  ensureDataDir();
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

// ─── 提示词模板系统 ─────────────────────────────────────

/** 内置默认提示词 */
const BUILTIN_PROMPTS: Record<PromptScene, { name: string; content: string }> = {
  report: {
    name: '报告生成',
    content: `你是项目阶段文档的写作框架助手。请基于当前文档、关联模板、模板章节要求和范文写法，生成"报告详情页"可展示的 AI 写作框架报告。
注意：
1. 这不是审查结论，不要打分，不要泛泛说风险。
2. 如果模板里有范文，只提取范文的结构、写法、段落组织和表达特征，不要把范文事实当作当前项目要求；范文模板的标题只代表写作方向，不作为固定标题。
3. 模板格式要求是硬性规则；即使是范文模板，也必须把标题/正文/图表格式作为严格约束。
4. 输出必须是 JSON 对象，不要 Markdown，不要代码块。
4. 任务建议要贴合"AI先写初稿/人工补资料/AI再优化/人工确认/再审查"的工作流。
5. 七章节结构属于全局模板约束，不要在每个章节建议里反复输出；只有章节缺失、顺序错误或结构错乱时，才在对应章节提一次。
JSON 字段：
{
  "reportTitle": "标题",
  "reportSummary": "300字以内概述当前文档写作状态和下一步方向",
  "templateFit": [...],
  "writingStyleNotes": [...],
  "writingFramework": [...],
  "writingDirection": [...],
  "materialPlan": [...],
  "draftPlan": [...],
  "humanTasks": [...],
  "aiTasks": [...],
  "sectionAdvice": [...],
  "workflowPlan": [...]
}
项目：{{projectName}}
阶段：{{stage}}
文档：{{docName}}
文件名：{{fileName}}
创建时间：{{createdAt}}
完成度：{{progress}}%
模板：{{templateName}}
模板分类：{{templateCategory}}
模板说明：{{templateDescription}}
{{templateNodesLabel}}
{{templateNodes}}
Low-weight stage memory, for style and acceptance direction only: {{stageMemory}}
Low-weight project reference materials, for evidence type and structure only: {{reference}}
当前章节分析：{{sectionStatus}}
当前文档正文摘录：{{content}}`,
  },
  review: {
    name: '文档审查',
    content: `你是文档审查与改稿助手。请严格按模板章节输出审查建议。
目标：模板里有多个结构章节，例如"一、总体目标""二、研究内容"。只输出存在问题或需要优化的章节；没有问题的章节不要输出。每个章节下面固定包含"问题"和"建议"。
输出格式（必须严格遵守，不要添加其他标题、总体评估、寒暄或结尾）：
## 一、章节名称
问题：
- 用一句话说明该章节的核心问题。
- 如有第二个问题，再用一句话说明。
建议：
- 给出一条可执行修改建议。
- 如需补写正文，给出一条简短参考句式；缺少事实数据时写"需人工补充：..."。
规则：
1. 只输出有问题或需要优化的模板章节。
2. 章节标题必须尽量使用模板中的原始章节名。
3. 每个章节必须同时包含"问题："和"建议："。
4. 每个章节的问题最多 2 条，建议最多 3 条，每条不超过 80 字。
5. 不要把程序已经模糊匹配到的章节重新判定为缺失；如果标题写法不同，只说明它与模板章节如何对应。
6. 建议要围绕当前正文和模板要求，避免泛泛而谈。
7. 不要输出长段落、引用块、成段示例、总体评估、"以下是建议""好的"等非章节内容。
模板必需章节：{{requiredOutline}}
{{analysisContext}}程序审查结果：{{issueText}}
正文摘录：{{content}}`,
  },
  rewrite: {
    name: '章节改稿',
    content: `You are a Chinese technical document rewriting assistant.
Only output the final replacement body text for this section. Do not output the section title, markdown, explanations, or extra notes.
Section: {{sectionTitle}}
Writing requirements: {{requirement}}
Example/reference from template: {{example}}
Low-weight stage memory, for style and acceptance direction only:
{{stageMemory}}
Low-weight reference materials selected by the user:
{{reference}}
Current body: {{currentContent}}
Rules:
1. Priority order: current project facts and current body > template format and requirements > user selected references > stage memory.
2. Keep existing facts and project context. Do not invent data or copy facts from memory/reference materials as if they belong to this project.
3. If required data is missing, use a short placeholder such as "需补充...".
4. The output must be suitable for direct replacement of the current section body and keep the original section formatting when applied.`,
  },
  diff: {
    name: '版本对比',
    content: `你是一个文档版本对比分析专家。请对比以下两个版本的差异，并给出详细的分析报告。
## 版本A：{{versionAName}}
{{contentA}}
## 版本B：{{versionBName}}
{{contentB}}
请分析：
1. 主要变更内容概述
2. 新增了哪些内容
3. 删除了哪些内容
4. 修改了哪些内容
5. 这些变更对文档质量的影响评估
6. 建议和注意事项`,
  },
  summary: {
    name: '文档摘要',
    content: `请为以下文档内容生成一个简短的摘要（100-200字）：
{{content}}`,
  },
  memory: {
    name: '阶段记忆学习',
    content: `You are building a low-weight writing memory for a Chinese project document assistant.
Summarize the final accepted state of this stage. This memory is only a reference direction, not a hard requirement.
Do not copy project-specific confidential facts as reusable rules. Extract reusable writing patterns, acceptance signals, evidence types, structure tendencies, tone, and common quality checks.
Output concise Chinese bullets under these headings: 写作方向, 常见结构, 必备证据, 完成度特征, 注意事项.
Stage: {{stageName}}
Document: {{docName}}
Final content: {{content}}`,
  },
  description: {
    name: '项目描述生成',
    content: `用一句简明中文概括项目，最多35字，只输出描述，不要解释。
项目名：{{projectName}}
阶段：{{stages}}
本周期新增文件：{{pendingFiles}}
已有文件：{{existingFiles}}`,
  },
  taskExecute: {
    name: '任务执行',
    content: `你是一个文档处理助手。请根据以下指令处理文档内容：
指令：{{instruction}}
文档内容：{{content}}
请直接输出处理后的内容，不要添加额外说明。`,
  },
  sectionAnalysis: {
    name: '章节完成度分析',
    content: `你是一个文档审查专家。请分析以下章节内容的完成度。
章节标题：{{sectionTitle}}
{{requirement}}章节内容（前1000字）：{{content}}
请评估：
1. 内容是否满足模板要求，状态为 completed/partial/missing
2. 简短评语（30字以内）
请用 JSON 格式回复：{"status":"completed","comment":"评语"}`,
  },
  templateExtract: {
    name: '模板结构提取',
    content: `你是一位专业的文档写作分析助手。请分析以下范文，生成一份精炼的写作分析摘要，供后续写作时参考。
模板名称：{{templateName}}
模板章节结构：{{templateNodes}}
分析要求：
1. 整体格式特征
2. 写作风格总结
3. 各章节字数参考
4. 内容要点
5. 常见开头/结尾模式
请用以下 JSON 格式输出（仅输出JSON，不要其他文字）：
{ "overallStyle": ..., "formatFeatures": ..., "sectionGuidance": [...], "openingPatterns": ..., "closingPatterns": ..., "generalTips": ... }
范文内容：{{content}}`,
  },
};

/** 各场景默认结构化提示词 */
const DEFAULT_STRUCTURED: Record<PromptScene, Omit<StructuredPrompt, 'scene'>> = {
  report: {
    mode: 'structured',
    role: '项目阶段文档写作框架助手',
    goals: ['生成报告摘要', '提取模板要求', '给出写作方向', '拆分人工任务', '拆分AI任务'],
    rules: [
      { id: 'r1', text: '不要评分，不要泛泛说风险', enabled: true, type: 'must_not' },
      { id: 'r2', text: '范文事实不等于当前项目事实', enabled: true, type: 'must_not' },
      { id: 'r3', text: '模板格式要求是硬性规则', enabled: true, type: 'must' },
      { id: 'r4', text: '输出必须是 JSON 对象', enabled: true, type: 'must' },
      { id: 'r5', text: '任务建议贴合"AI写初稿→人工补资料→AI优化→人工确认"工作流', enabled: true, type: 'prefer' },
    ],
    outputFields: [
      { key: 'reportTitle', label: '报告标题', description: '建议的报告标题' },
      { key: 'reportSummary', label: '报告摘要', description: '300字以内概述当前写作状态和下一步方向' },
      { key: 'templateFit', label: '模板匹配说明', description: '模板要求转化成的写作约束' },
      { key: 'writingStyleNotes', label: '写作风格建议', description: '从范文或模板中提取的写法特征' },
      { key: 'writingFramework', label: '写作框架', description: '建议的章节框架或段落组织' },
      { key: 'writingDirection', label: '写作方向', description: '下一版写作方向' },
      { key: 'materialPlan', label: '资料补充计划', description: '需要人工补充的资料、数据' },
      { key: 'draftPlan', label: '初稿计划', description: 'AI可以执行的初稿、润色任务' },
      { key: 'humanTasks', label: '人工任务', description: '人工下一步任务' },
      { key: 'aiTasks', label: 'AI任务', description: 'AI下一步任务' },
      { key: 'sectionAdvice', label: '章节建议', description: '各章节的问题和建议' },
      { key: 'workflowPlan', label: '工作流计划', description: '按优先级排列的任务计划' },
    ],
  },
  review: {
    mode: 'structured',
    role: '文档审查与改稿助手',
    goals: ['按模板章节审查文档', '输出问题和修改建议'],
    rules: [
      { id: 'rv1', text: '只输出有问题或需要优化的章节', enabled: true, type: 'must' },
      { id: 'rv2', text: '章节标题使用模板中的原始名称', enabled: true, type: 'must' },
      { id: 'rv3', text: '每个章节最多2个问题、3个建议', enabled: true, type: 'must' },
      { id: 'rv4', text: '不要把已匹配的章节重新判定为缺失', enabled: true, type: 'must_not' },
      { id: 'rv5', text: '建议围绕正文和模板要求，避免泛泛而谈', enabled: true, type: 'prefer' },
    ],
    outputFields: [
      { key: 'sectionName', label: '章节名称', description: '模板章节标题' },
      { key: 'problems', label: '问题列表', description: '该章节存在的问题' },
      { key: 'suggestions', label: '建议列表', description: '修改建议' },
    ],
  },
  rewrite: {
    mode: 'structured',
    role: '中文技术文档改写助手',
    goals: ['输出可直接替换的正文内容', '保持原文格式'],
    rules: [
      { id: 'rw1', text: '当前项目事实和正文优先级最高', enabled: true, type: 'must' },
      { id: 'rw2', text: '不要编造数据或复制其他项目的事实', enabled: true, type: 'must_not' },
      { id: 'rw3', text: '缺少数据时用"需补充..."占位', enabled: true, type: 'must' },
      { id: 'rw4', text: '输出适合直接替换当前章节正文', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'rewrittenText', label: '改写后正文', description: '可直接替换原章节的正文内容' },
    ],
  },
  diff: {
    mode: 'structured',
    role: '文档版本对比分析专家',
    goals: ['对比两个版本的差异', '分析变更对文档质量的影响'],
    rules: [
      { id: 'd1', text: '不要假设A是模板、B是成品', enabled: true, type: 'must_not' },
      { id: 'd2', text: '只评价两个版本之间不同的地方', enabled: true, type: 'must' },
      { id: 'd3', text: '从内容、结构、格式、风险、建议五个角度总结', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'overview', label: '总体判断', description: '变更的整体评价' },
      { key: 'mainChanges', label: '主要变化', description: '关键变更内容' },
      { key: 'risks', label: '可能风险', description: '变更带来的风险' },
      { key: 'suggestions', label: '建议处理方式', description: '下一步建议' },
    ],
  },
  summary: {
    mode: 'structured',
    role: '文档摘要生成助手',
    goals: ['生成100-200字的简短摘要'],
    rules: [
      { id: 's1', text: '只输出摘要内容，不要添加额外说明', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'summary', label: '文档摘要', description: '100-200字的内容概述' },
    ],
  },
  memory: {
    mode: 'structured',
    role: '写作经验提炼助手',
    goals: ['提炼可复用的写作模式', '总结完成度特征和注意事项'],
    rules: [
      { id: 'm1', text: '不复制项目机密事实作为可复用规则', enabled: true, type: 'must_not' },
      { id: 'm2', text: '只作为参考方向，不作为硬性要求', enabled: true, type: 'must_not' },
      { id: 'm3', text: '输出简洁的中文要点', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'writingDirection', label: '写作方向', description: '该阶段的写作方向参考' },
      { key: 'commonStructure', label: '常见结构', description: '常见的文档结构' },
      { key: 'requiredEvidence', label: '必备证据', description: '必须包含的证据类型' },
      { key: 'completionFeatures', label: '完成度特征', description: '完成状态的判断依据' },
      { key: 'notes', label: '注意事项', description: '需要特别注意的事项' },
    ],
  },
  description: {
    mode: 'structured',
    role: '项目描述生成助手',
    goals: ['用一句简明中文概括项目，最多35字'],
    rules: [
      { id: 'ds1', text: '只输出描述，不要解释', enabled: true, type: 'must' },
      { id: 'ds2', text: '不超过35个字', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'description', label: '项目描述', description: '35字以内的项目概括' },
    ],
  },
  taskExecute: {
    mode: 'structured',
    role: '文档处理助手',
    goals: ['根据指令处理文档内容', '直接输出处理后的内容'],
    rules: [
      { id: 't1', text: '直接输出处理后的内容', enabled: true, type: 'must' },
      { id: 't2', text: '不要添加额外说明', enabled: true, type: 'must_not' },
    ],
    outputFields: [
      { key: 'result', label: '处理结果', description: '处理后的文档内容' },
    ],
  },
  sectionAnalysis: {
    mode: 'structured',
    role: '文档审查专家',
    goals: ['分析章节内容的完成度', '给出状态和评语'],
    rules: [
      { id: 'sa1', text: '状态必须是 completed/partial/missing 之一', enabled: true, type: 'must' },
      { id: 'sa2', text: '评语不超过30字', enabled: true, type: 'must' },
      { id: 'sa3', text: '用JSON格式回复', enabled: true, type: 'must' },
    ],
    outputFields: [
      { key: 'status', label: '完成状态', description: 'completed/partial/missing' },
      { key: 'comment', label: '评语', description: '30字以内的简短评语' },
    ],
  },
  templateExtract: {
    mode: 'structured',
    role: '文档写作分析助手',
    goals: ['分析范文的写作方法和格式特征', '生成写作指导摘要'],
    rules: [
      { id: 'te1', text: '输出JSON格式', enabled: true, type: 'must' },
      { id: 'te2', text: 'level只允许1-4', enabled: true, type: 'must' },
      { id: 'te3', text: 'title只能是干净的章节标题', enabled: true, type: 'must' },
      { id: 'te4', text: '不要把范文项目事实当成模板要求', enabled: true, type: 'must_not' },
    ],
    outputFields: [
      { key: 'overallStyle', label: '整体风格', description: '写作风格描述' },
      { key: 'formatFeatures', label: '格式特征', description: '格式规范描述' },
      { key: 'sectionGuidance', label: '章节指导', description: '各章节的写作建议' },
      { key: 'openingPatterns', label: '开头模式', description: '常见开头方式' },
      { key: 'closingPatterns', label: '结尾模式', description: '常见结尾方式' },
      { key: 'generalTips', label: '通用建议', description: '通用写作建议' },
    ],
  },
};

/** 生成内置默认模板列表 */
function getDefaultPromptTemplates(): PromptTemplate[] {
  const now = new Date().toISOString();
  return Object.entries(BUILTIN_PROMPTS).map(([scene, def]) => ({
    id: `builtin-${scene}`,
    scene: scene as PromptScene,
    name: def.name,
    content: def.content,
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
    structured: { ...DEFAULT_STRUCTURED[scene as PromptScene], scene: scene as PromptScene },
  }));
}

/** 加载提示词模板（首次自动生成内置默认） */
function loadPromptTemplatesFromDisk(): PromptTemplate[] {
  ensureDataDir();
  if (!fs.existsSync(promptTemplatesFile)) {
    const defaults = getDefaultPromptTemplates();
    savePromptTemplatesToDisk(defaults);
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(promptTemplatesFile, 'utf-8'));
  } catch {
    const defaults = getDefaultPromptTemplates();
    savePromptTemplatesToDisk(defaults);
    return defaults;
  }
}

/** 保存提示词模板 */
function savePromptTemplatesToDisk(templates: PromptTemplate[]) {
  ensureDataDir();
  fs.writeFileSync(promptTemplatesFile, JSON.stringify(templates, null, 2), 'utf-8');
}

// ─── IPC: 提示词模板 ────────────────────────────────────

ipcMain.handle('prompt:loadAll', () => {
  return loadPromptTemplatesFromDisk();
});

ipcMain.handle('prompt:save', (_event, template: PromptTemplate) => {
  const templates = loadPromptTemplatesFromDisk();
  const idx = templates.findIndex(t => t.id === template.id);
  if (idx >= 0) {
    templates[idx] = template;
  } else {
    templates.push(template);
  }
  savePromptTemplatesToDisk(templates);
});

ipcMain.handle('prompt:reset', (_event, id: string) => {
  const templates = loadPromptTemplatesFromDisk();
  const defaults = getDefaultPromptTemplates();
  const defaultTmpl = defaults.find(t => t.id === id);
  if (!defaultTmpl) return;
  const idx = templates.findIndex(t => t.id === id);
  if (idx >= 0) {
    templates[idx] = defaultTmpl;
  } else {
    templates.push(defaultTmpl);
  }
  savePromptTemplatesToDisk(templates);
});

// ─── Skill 包管理 ──────────────────────────────────────

function loadSkillPackagesFromDisk(): SkillPackage[] {
  ensureDataDir();
  if (!fs.existsSync(skillPackagesFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(skillPackagesFile, 'utf-8'));
  } catch { return []; }
}

function saveSkillPackagesToDisk(skills: SkillPackage[]) {
  ensureDataDir();
  fs.writeFileSync(skillPackagesFile, JSON.stringify(skills, null, 2), 'utf-8');
}

ipcMain.handle('skill:loadAll', () => {
  return loadSkillPackagesFromDisk();
});

ipcMain.handle('skill:import', (_event, pkg: SkillPackage) => {
  const skills = loadSkillPackagesFromDisk();
  const idx = skills.findIndex(s => s.id === pkg.id);
  if (idx >= 0) {
    skills[idx] = pkg;
  } else {
    skills.push(pkg);
  }
  saveSkillPackagesToDisk(skills);
  return pkg;
});

ipcMain.handle('skill:delete', (_event, id: string) => {
  const skills = loadSkillPackagesFromDisk();
  saveSkillPackagesToDisk(skills.filter(s => s.id !== id));
});

ipcMain.handle('skill:setEnabled', (_event, id: string, enabled: boolean) => {
  const skills = loadSkillPackagesFromDisk();
  const skill = skills.find(s => s.id === id);
  if (skill) {
    skill.enabled = enabled;
    saveSkillPackagesToDisk(skills);
  }
});

ipcMain.handle('skill:setWeight', (_event, id: string, weight: number) => {
  const skills = loadSkillPackagesFromDisk();
  const skill = skills.find(s => s.id === id);
  if (skill) {
    skill.weight = Math.max(0, Math.min(100, weight));
    saveSkillPackagesToDisk(skills);
  }
});

// 读取项目文档
function loadProjectDocsFromDisk(): ProjectDocument[] {
  ensureDataDir();
  if (!fs.existsSync(projectDocsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(projectDocsFile, 'utf-8'));
  } catch { return []; }
}

// 保存项目文档
function saveProjectDocsToDisk(docs: ProjectDocument[]) {
  ensureDataDir();
  fs.writeFileSync(projectDocsFile, JSON.stringify(docs, null, 2), 'utf-8');
}

// ==================== 章节提取算法 ====================

// 中文数字映射
const cnNumMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };

function loadStageMemoriesFromDisk(): StageMemoryEntry[] {
  ensureDataDir();
  if (!fs.existsSync(stageMemoriesFile)) return [];
  try { return JSON.parse(fs.readFileSync(stageMemoriesFile, 'utf-8')); } catch { return []; }
}

function saveStageMemoriesToDisk(entries: StageMemoryEntry[]) {
  ensureDataDir();
  fs.writeFileSync(stageMemoriesFile, JSON.stringify(entries, null, 2), 'utf-8');
}

function loadReferenceMaterialsFromDisk(): ReferenceMaterial[] {
  ensureDataDir();
  if (!fs.existsSync(referenceMaterialsFile)) return [];
  try { return JSON.parse(fs.readFileSync(referenceMaterialsFile, 'utf-8')); } catch { return []; }
}

function saveReferenceMaterialsToDisk(entries: ReferenceMaterial[]) {
  ensureDataDir();
  fs.writeFileSync(referenceMaterialsFile, JSON.stringify(entries, null, 2), 'utf-8');
}

function normalizeKnowledgeStageName(value?: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ') || 'unknown';
}

function clipKnowledgeText(value: string, maxLength = 12000): string {
  const normalized = normalizeExtractedText(String(value || '')).trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

async function extractKnowledgeTextFromFile(filePath?: string): Promise<{ success: boolean; content?: string; fileName?: string; error?: string }> {
  if (!filePath) return { success: false, error: 'missing file path' };
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);
    if (ext === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) return { success: true, content: clipKnowledgeText(docxContent), fileName };
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, content: clipKnowledgeText(result.value), fileName };
    }
    if (ext === '.doc') {
      const convertedPath = convertLegacyDocToDocx(filePath);
      if (convertedPath) {
        const convertedBuffer = fs.readFileSync(convertedPath);
        const docxContent = await extractDocxTextWithNumbering(convertedBuffer);
        if (docxContent) return { success: true, content: clipKnowledgeText(docxContent), fileName };
      }
      const content = extractLegacyDocText(buffer);
      return content ? { success: true, content: clipKnowledgeText(content), fileName } : { success: false, error: 'unable to extract legacy doc text' };
    }
    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return { success: true, content: clipKnowledgeText(data.text), fileName };
    }
    if (ext === '.pptx') {
      const content = await extractPptxText(buffer);
      return content ? { success: true, content: clipKnowledgeText(content), fileName } : { success: false, error: 'empty pptx text' };
    }
    if (ext === '.xlsx') {
      const content = await extractXlsxText(buffer);
      return content ? { success: true, content: clipKnowledgeText(content), fileName } : { success: false, error: 'empty xlsx text' };
    }
    if (ext === '.rtf') return { success: true, content: clipKnowledgeText(stripRtf(buffer.toString('utf8'))), fileName };
    if (ext === '.txt' || ext === '.md') return { success: true, content: clipKnowledgeText(fs.readFileSync(filePath, 'utf-8')), fileName };
    return { success: false, error: 'unsupported file format' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

function saveReferenceMaterialUpsert(material: ReferenceMaterial): ReferenceMaterial {
  const materials = loadReferenceMaterialsFromDisk();
  const index = materials.findIndex(item => item.id === material.id);
  if (index >= 0) materials[index] = material;
  else materials.push(material);
  saveReferenceMaterialsToDisk(materials);
  return material;
}

function normalizeTechnicalValueText(value: string): string {
  return String(value || '')
    .replace(/[，]/g, ',')
    .replace(/[．。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[－–—]/g, '-')
    .replace(/[～]/g, '~')
    .replace(/\s+/g, '');
}

function stripDocumentHeadingPrefix(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇][、.．：:\s]*/, '')
    .replace(/^[一二三四五六七八九十百千万零〇两]+[、.．）)]\s*/, '')
    .replace(/^\d+(?:[.．-]\d+)*[、.．）)]?\s*/, '')
    .replace(/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]\s*/, '');
}

function isLikelyTechnicalValueLine(value: string): boolean {
  const original = normalizeTechnicalValueText(value);
  const stripped = normalizeTechnicalValueText(stripDocumentHeadingPrefix(value));
  const raw = original || stripped;
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const hasCjk = /[\u4e00-\u9fa5]/.test(lower);
  const unit = '(?:km/h|m/s|kn|mn|mpa|kpa|pa|kg|mm|cm|km|kv|ma|hz|min|ms|rpm|kw|db|n|g|t|m|v|a|s|h|w|%|deg|rad|°|℃|nm|Ω)';
  const number = '[+-]?\\d+(?:\\.\\d+)?';
  const headingLikeEnding = /(?:系统|方案|设计|架构|功能|模块|流程|方法|算法|模型|平台|装置|应用|试验|测试|验证|分析|结果|原理|结构|小结|概述|现状|总结|展望)$/;
  if (hasCjk && headingLikeEnding.test(raw)) return false;

  const valueWithUnit = new RegExp(`^${number}${unit}(?:[~\\-至到,，;；、/]?${number}${unit}?)*`, 'i');
  if ((valueWithUnit.test(raw) || valueWithUnit.test(stripped)) && !headingLikeEnding.test(raw)) return true;

  const pureValueList = new RegExp(`^(?:${number}|${number}${unit})(?:[~\\-至到,，;；、/]?(?:${number}|${number}${unit}))*$`, 'i');
  if (!hasCjk && (pureValueList.test(raw) || pureValueList.test(stripped))) return true;

  const strippedKnown = lower
    .replace(new RegExp(unit, 'gi'), '')
    .replace(/\d+(?:\.\d+)?/g, '')
    .replace(/[+\-~～至到,，;；、:：\/\\()[\]{}<>≤≥=×x*%°℃′'″"·]/g, '');
  if (!hasCjk && strippedKnown.length === 0 && /\d/.test(lower)) return true;
  if (!hasCjk && new RegExp(unit, 'i').test(lower) && /^[\d.+\-~～,，;；、:：\/\\()[\]{}<>≤≥=×x*%°℃′'″"·a-zωΩ]+$/i.test(lower)) return true;
  return false;
}

function isLikelyTableOfContentsLine(value: string): boolean {
  const line = String(value || '').trim();
  if (!line) return false;
  if (/\.{3,}\s*\d+\s*$/.test(line)) return true;
  if (/[·•…]{3,}\s*\d+\s*$/.test(line)) return true;
  return /\s{2,}\d+\s*$/.test(line) && /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)+)/.test(line);
}

// 检测标题行
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (isLikelyTableOfContentsLine(trimmed)) return false;
  if (isLikelyTechnicalValueLine(trimmed)) return false;
  return /^([一二三四五六七八九十百千万零〇两]+[、.．）)]|第[一二三四五六七八九十百千万零〇两\d]+[章节部分篇]|\d+(?:[.．-]\d+)*[、.．）)]?|[（(][一二三四五六七八九十百千万零〇两\d]+[）)])\s*\S/.test(trimmed);
}

function getHeadingLevel(line: string): number {
  const trimmed = line.trim();
  if (/^第[一二三四五六七八九十百千万零〇两\d]+[章篇部分]/.test(trimmed)) return 1;
  if (/^[一二三四五六七八九十百千万零〇两]+[、.．）)]/.test(trimmed)) return 1;
  const decimal = trimmed.match(/^\d+(?:[.．-]\d+)+/);
  if (decimal) return Math.min(decimal[0].split(/[.．-]/).length, 4);
  if (/^\d+[、.．）)]/.test(trimmed)) return 2;
  if (/^[（(][一二三四五六七八九十百千万零〇两\d]+[）)]/.test(trimmed)) return 3;
  return 2;
}

function stripHeadingPrefix(value: string): string {
  return stripDocumentHeadingPrefix(value);
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function startsWithHeadingPattern(line: string): boolean {
  return isHeadingLine(String(line || ''));
}

function normalizeHeadingForMatch(value: string): string {
  return stripHeadingPrefix(value)
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>]/g, '')
    .toLowerCase();
}

// 从内容中提取章节。一级章节会包含其下属子标题和正文，直到下一个同级/上级标题。
function extractSections(content: string): { title: string; content: string; startPos: number; level: number }[] {
  const lines = content.split('\n');
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index, level: getHeadingLevel(line) }))
    .filter(item => isHeadingLine(item.line));

  return headings.map((heading, headingIndex) => {
    const nextSameOrHigher = headings
      .slice(headingIndex + 1)
      .find(item => item.level <= heading.level);
    const end = nextSameOrHigher ? nextSameOrHigher.index : lines.length;
    return {
      title: heading.line,
      content: lines.slice(heading.index + 1, end).join('\n').trim(),
      startPos: heading.index,
      level: heading.level,
    };
  });
}

// 模糊匹配章节标题
function matchHeading(extracted: string, templateTitle: string): boolean {
  const a = normalizeHeadingForMatch(extracted);
  const b = normalizeHeadingForMatch(templateTitle);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || a === b;
}

function normalizeContentForSectionMatch(value: string): string {
  return String(value || '')
    .replace(/[\s　：:；;，,。.【】\[\]（）()《》<>“”\"'‘’、.．]/g, '')
    .toLowerCase();
}

function countContentChars(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

function parseWordLengthRequirement(text = ''): { minComplete: number; source: string } | null {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized) return null;

  const rangeMatch = normalized.match(/(\d{1,5})[~\-\u2014\uff0d\u81f3\u5230](\d{1,5})\u5b57/);
  if (rangeMatch) {
    const low = Math.min(Number(rangeMatch[1]), Number(rangeMatch[2]));
    if (low > 0) return { minComplete: Math.max(1, Math.floor(low * 0.85)), source: rangeMatch[0] };
  }

  const minMatch = normalized.match(/(?:\u4e0d\u5c11\u4e8e|\u4e0d\u4f4e\u4e8e|\u81f3\u5c11|\u5927\u4e8e|\u8d85\u8fc7)(\d{1,5})\u5b57/);
  if (minMatch) {
    const min = Number(minMatch[1]);
    if (min > 0) return { minComplete: Math.max(1, Math.floor(min * 0.9)), source: minMatch[0] };
  }

  const aroundMatch = normalized.match(/(?:\u7ea6|\u5927\u7ea6|\u5de6\u53f3)?(\d{1,5})\u5b57(?:\u5de6\u53f3|\u4e0a\u4e0b)?/);
  if (aroundMatch && !/(\u4e0d\u8d85\u8fc7|\u4e0d\u591a\u4e8e|\u4ee5\u5185|\u4ee5\u4e0b|\u4e4b\u5185)/.test(normalized.slice(Math.max(0, aroundMatch.index || 0) - 8, (aroundMatch.index || 0) + aroundMatch[0].length + 8))) {
    const target = Number(aroundMatch[1]);
    if (target > 0) return { minComplete: Math.max(1, Math.floor(target * 0.75)), source: aroundMatch[0] };
  }

  const maxMatch = normalized.match(/(?:\u4e0d\u8d85\u8fc7|\u4e0d\u591a\u4e8e|\u4ee5\u5185|\u4ee5\u4e0b|\u4e4b\u5185)(\d{1,5})\u5b57/);
  if (maxMatch) return { minComplete: 1, source: maxMatch[0] };

  return null;
}

function getSectionLengthRequirement(node: TemplateNode, template?: WritingTemplate): { minComplete: number; minPartial: number; source: string } {
  if (template?.templateType === 'example') {
    return { minComplete: 1, minPartial: 1, source: '范文模板仅作写作方向参考' };
  }
  const textSources = [node.requirementText, node.description, template?.requirementText].filter(Boolean) as string[];
  for (const text of textSources) {
    const parsed = parseWordLengthRequirement(text);
    if (parsed) return { minComplete: parsed.minComplete, minPartial: Math.max(1, Math.floor(parsed.minComplete * 0.35)), source: '\u6a21\u677f\u8981\u6c42\uff1a' + parsed.source };
  }

  const exampleCount = countContentChars(node.exampleText || '');
  if (exampleCount > 0) {
    const minComplete = exampleCount <= 20 ? Math.max(1, Math.floor(exampleCount * 0.6)) : Math.max(10, Math.floor(exampleCount * 0.65));
    return { minComplete, minPartial: Math.max(1, Math.floor(minComplete * 0.35)), source: '\u8303\u6587\u53c2\u8003\u7ea6 ' + exampleCount + ' \u5b57' };
  }

  const title = node.title || '';
  if (/\u671f\u9650|\u65f6\u95f4|\u65e5\u671f|\u7ecf\u8d39|\u9650\u989d|\u5173\u952e\u8bcd|\u8054\u7cfb\u4eba|\u7535\u8bdd|\u90ae\u7bb1|\u7f16\u53f7|\u540d\u79f0|\u5355\u4f4d|\u91d1\u989d/.test(title)) {
    return { minComplete: 1, minPartial: 1, source: '\u77ed\u5b57\u6bb5\u7ae0\u8282' };
  }

  return { minComplete: 30, minPartial: 1, source: '\u9ed8\u8ba4\u77ed\u7ae0\u8282\u9608\u503c' };
}

function getSectionStatusByLength(wordCount: number, requirement: { minComplete: number; minPartial: number }): SectionAnalysis['status'] {
  if (wordCount <= 0) return 'missing';
  if (wordCount >= requirement.minComplete) return 'completed';
  if (wordCount >= requirement.minPartial) return 'partial';
  return 'missing';
}
function collectReviewEvidenceTerms(node: TemplateNode): string[] {
  const source = [node.title, node.requirementText, node.description]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeContentForSectionMatch(source);
  const terms = new Set<string>();

  const preferredTerms = [
    '技术需求', '技术现状', '研究工作', '研究内容', '项目需求', '对应性', '应用场景', '典型场景',
    '移相器', '潮流控制', '运行策略', '工程经济性', '考核指标', '关键技术', '实施期限',
    '支持经费', '预期成果', '国内外', '创新', '示范应用', '电网', '新能源', '轻量化', '直驱浮空风力发电',
  ];
  preferredTerms.forEach(term => {
    const normalizedTerm = normalizeContentForSectionMatch(term);
    if (normalizedTerm && normalized.includes(normalizedTerm)) terms.add(normalizedTerm);
  });

  for (let size = 6; size >= 2; size--) {
    for (let index = 0; index <= normalized.length - size; index++) {
      const term = normalized.slice(index, index + size);
      if (/^\d+$/.test(term)) continue;
      if (/^(分析|研究|项目|内容|技术|需求|工作|说明|章节)$/.test(term)) continue;
      terms.add(term);
      if (terms.size >= 18) return [...terms];
    }
  }
  return [...terms];
}

function findEvidenceInContent(node: TemplateNode, normalizedContent: string) {
  const normalizedTitle = normalizeHeadingForMatch(node.title);
  if (normalizedTitle && normalizedContent.includes(normalizedTitle)) {
    return { matched: true, confidence: 1, terms: [normalizedTitle] };
  }

  const terms = collectReviewEvidenceTerms(node);
  const hitTerms = terms.filter(term => term.length >= 2 && normalizedContent.includes(term));
  const strongHits = hitTerms.filter(term => term.length >= 4);
  const confidence = terms.length ? hitTerms.length / Math.min(terms.length, 12) : 0;

  return {
    matched: strongHits.length >= 2 || hitTerms.length >= 4 || confidence >= 0.35,
    confidence,
    terms: hitTerms.slice(0, 6),
  };
}

function findLooseSectionContent(content: string, node: TemplateNode): string {
  const lines = content.split('\n');
  const strippedTemplateTitle = stripHeadingPrefix(node.title).trim();
  const normalizedTemplateTitle = normalizeHeadingForMatch(node.title);
  if (!normalizedTemplateTitle) return '';

  const startIndex = lines.findIndex(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const preview = trimmed.slice(0, 180);
    return matchHeading(preview, node.title)
      || normalizeContentForSectionMatch(preview).startsWith(normalizedTemplateTitle);
  });
  if (startIndex < 0) return '';

  const startLevel = startsWithHeadingPattern(lines[startIndex]) ? getHeadingLevel(lines[startIndex]) : node.level;
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (startsWithHeadingPattern(lines[index]) && getHeadingLevel(lines[index]) <= startLevel) {
      endIndex = index;
      break;
    }
  }

  const firstLine = lines[startIndex].trim();
  const firstLineWithoutPrefix = stripHeadingPrefix(firstLine);
  const startTitlePattern = strippedTemplateTitle
    ? new RegExp('^' + escapeRegExp(strippedTemplateTitle) + '[：:\\s　]*')
    : null;
  const sameLineContent = startTitlePattern
    ? firstLineWithoutPrefix.replace(startTitlePattern, '')
    : firstLineWithoutPrefix;
  return [sameLineContent, ...lines.slice(startIndex + 1, endIndex)].join('\n').trim();
}

function findSectionForTemplateNode(
  node: TemplateNode,
  extracted: { title: string; content: string; startPos: number; level: number }[],
  normalizedContent: string,
  rawContent = '',
): { title: string; content: string; startPos: number; level: number; matchedBy: 'heading' | 'content' | 'evidence'; evidenceTerms?: string[]; confidence?: number } | null {
  const headingMatch = extracted.find(section => matchHeading(section.title, node.title));
  if (headingMatch) return { ...headingMatch, matchedBy: 'heading', confidence: 1 };

  const looseContent = rawContent ? findLooseSectionContent(rawContent, node) : '';
  if (looseContent) {
    return {
      title: node.title,
      content: looseContent,
      startPos: -1,
      level: node.level,
      matchedBy: 'content',
      confidence: 0.9,
    };
  }

  const evidence = findEvidenceInContent(node, normalizedContent);
  if (evidence.matched) {
    return {
      title: node.title,
      content: '',
      startPos: -1,
      level: node.level,
      matchedBy: evidence.terms.length === 1 && evidence.confidence === 1 ? 'content' : 'evidence',
      evidenceTerms: evidence.terms,
      confidence: evidence.confidence,
    };
  }

  return null;
}

function isOperationalTemplateNode(node: TemplateNode, template?: WritingTemplate): boolean {
  const title = String(node.title || '').trim();
  if (!title || isLikelyTechnicalValueLine(title)) return false;
  if (template?.templateType === 'example') return (node.level || 1) <= 1;
  return true;
}

function flattenNodes(nodes: TemplateNode[], template?: WritingTemplate): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const node of nodes || []) {
    if (!isOperationalTemplateNode(node, template)) continue;
    result.push(node);
    if (template?.templateType !== 'example' && node.children && node.children.length > 0) {
      result.push(...flattenNodes(node.children, template));
    }
  }
  return result;
}

// 按当前文档自身的标题生成章节状态，不把模板或范文标题混入文档结构。
function analyzeActualDocumentStructure(content: string): SectionAnalysis[] {
  const extracted = extractSections(content);
  if (!extracted.length) return [];

  const topLevel = extracted.filter(section => section.level === 1);
  const minimumLevel = Math.min(...extracted.map(section => section.level));
  const candidates = topLevel.length
    ? topLevel
    : extracted.filter(section => section.level === minimumLevel);
  const bestByTitle = new Map<string, typeof candidates[number]>();

  candidates.forEach(section => {
    const key = normalizeHeadingForMatch(section.title);
    if (!key) return;
    const existing = bestByTitle.get(key);
    // PDF 的目录和正文可能各出现一次同名标题，保留正文量更多的那一次。
    if (!existing || countContentChars(section.content) > countContentChars(existing.content)) {
      bestByTitle.set(key, section);
    }
  });

  return [...bestByTitle.values()]
    .sort((a, b) => a.startPos - b.startPos)
    .map((section, index) => {
      const wordCount = countContentChars(section.content);
      const status: SectionAnalysis['status'] = wordCount >= 80
        ? 'completed'
        : wordCount > 0 ? 'partial' : 'missing';
      return {
        nodeId: `document-heading:${index}:${section.startPos}`,
        title: section.title,
        status,
        wordCount,
        aiComment: wordCount === 0 ? '已识别到章节标题，但标题下暂未提取到正文。' : undefined,
      };
    });
}

// 基础分析（正则，无 AI）
function analyzeBasic(content: string, template: WritingTemplate): SectionAnalysis[] {
  const extracted = extractSections(content);
  const normalizedContent = normalizeContentForSectionMatch(content);
  const allNodes = flattenNodes(template.nodes, template);
  const isExampleTemplate = template.templateType === 'example';
  const results: SectionAnalysis[] = [];

  for (const node of allNodes) {
    const matched = findSectionForTemplateNode(node, extracted, normalizedContent, content);
    if (matched) {
      let wordCount = countContentChars(matched.content);
      const lengthRequirement = getSectionLengthRequirement(node, template);
      let status: SectionAnalysis['status'] = getSectionStatusByLength(wordCount, lengthRequirement);
      let aiComment: string | undefined;

      if (matched.matchedBy !== 'heading' && wordCount === 0) {
        wordCount = Math.max(1, Math.round((matched.confidence || 0.35) * 80));
        status = getSectionStatusByLength(wordCount, lengthRequirement);
        aiComment = matched.matchedBy === 'evidence'
          ? '依据关键词识别到对应内容：' + ((matched.evidenceTerms || []).join('、') || '相关内容')
          : '已在正文中识别到对应章节标题或内容。';
      } else if (matched.matchedBy !== 'heading') {
        aiComment = '\u5df2\u901a\u8fc7\u6b63\u6587\u5185\u5bb9\u5339\u914d\u5230\u8be5\u6a21\u677f\u7ae0\u8282\u3002';
      }
      if (status === 'partial') {
        aiComment = aiComment || '\u5f53\u524d\u7ea6 ' + wordCount + ' \u5b57\uff0c\u53c2\u8003\u6807\u51c6\uff1a' + lengthRequirement.source + '\uff0c\u5efa\u8bae\u8865\u81f3\u7ea6 ' + lengthRequirement.minComplete + ' \u5b57\u3002';
      } else if (status === 'completed' && lengthRequirement.source !== '\u9ed8\u8ba4\u77ed\u7ae0\u8282\u9608\u503c') {
        aiComment = aiComment || '\u5df2\u6ee1\u8db3\u5b57\u6570\u5224\u65ad\uff1a' + lengthRequirement.source + '\u3002';
      }

      results.push({
        nodeId: node.id,
        title: node.title,
        status,
        wordCount,
        aiComment,
      });
    } else {
      results.push({
        nodeId: node.id,
        title: node.title,
        status: isExampleTemplate ? 'partial' : 'missing',
        wordCount: 0,
        aiComment: isExampleTemplate ? '范文模板节点仅代表写作方向，未按固定标题判定缺失。' : undefined,
      });
    }
  }
  return results;
}



function scheduleDevServerReload(reason: string) {
  if (process.env.NODE_ENV !== 'development' || !mainWindow || mainWindow.isDestroyed()) return;
  if (devReloadTimer) return;
  console.warn(`[dev-server] renderer load interrupted: ${reason}; reloading shortly...`);
  devReloadTimer = setTimeout(() => {
    devReloadTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(DEV_SERVER_URL).catch((error) => {
      scheduleDevServerReload(error?.message || 'reload failed');
    });
  }, 900);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: '项目进度管理工具',
  });

  // Development loads the local Vite server; production loads bundled files.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (validatedURL?.startsWith(DEV_SERVER_URL) && [-21, -102, -105, -106, -118].includes(errorCode)) {
        scheduleDevServerReload(`${errorCode} ${errorDescription}`);
      }
    });
    mainWindow.webContents.on('did-fail-provisional-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (validatedURL?.startsWith(DEV_SERVER_URL) && [-21, -102, -105, -106, -118].includes(errorCode)) {
        scheduleDevServerReload(`${errorCode} ${errorDescription}`);
      }
    });
    mainWindow.loadURL(DEV_SERVER_URL).catch((error) => {
      scheduleDevServerReload(error?.message || 'initial load failed');
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    if (devReloadTimer) {
      clearTimeout(devReloadTimer);
      devReloadTimer = null;
    }
    mainWindow = null;
  });
}

// IPC 处理器
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目文件夹',
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('file:openInExplorer', async (_event: any, targetPath: string) => {
  try {
    if (!fs.existsSync(targetPath)) return { success: false, error: '路径不存在' };
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      shell.showItemInFolder(targetPath);
    } else {
      const error = await shell.openPath(targetPath);
      if (error) return { success: false, error };
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 用默认程序打开文件
ipcMain.handle('file:openWithDefaultApp', async (_event: any, filePath: string) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

let dragFileIconImage: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createDragIconPng(): Buffer {
  const width = 32;
  const height = 32;
  const rowSize = width * 4 + 1;
  const pixels = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    pixels[rowOffset] = 0; // PNG filter type: none
    for (let x = 0; x < width; x++) {
      const offset = rowOffset + 1 + x * 4;
      const border = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      pixels[offset] = border ? 0x16 : 0xff;
      pixels[offset + 1] = border ? 0x77 : 0xff;
      pixels[offset + 2] = border ? 0xff : 0xff;
      pixels[offset + 3] = 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function getDragFileIcon() {
  if (dragFileIconImage && !dragFileIconImage.isEmpty()) return dragFileIconImage;
  dragFileIconImage = nativeImage.createFromBuffer(createDragIconPng());
  if (dragFileIconImage.isEmpty()) {
    throw new Error('拖拽图标创建失败');
  }
  return dragFileIconImage;
}

// 原生文件拖拽：同步 IPC 保证 startDrag 在 renderer dragstart 事件结束前执行
ipcMain.on('shell:startDrag', (event: any, filePath: string) => {
  try {
    if (!filePath) {
      event.returnValue = { success: false, error: '文件路径为空' };
      return;
    }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      event.returnValue = { success: false, error: '文件不存在' };
      return;
    }
    event.sender.startDrag({
      file: resolvedPath,
      icon: getDragFileIcon(),
    });
    event.returnValue = { success: true };
  } catch (error: any) {
    console.warn('Native file drag failed:', error);
    event.returnValue = { success: false, error: error?.message || '系统拖拽启动失败' };
  }
});

ipcMain.handle('file:rename', async (_event: any, params: { filePath: string; newName: string }) => {
  try {
    const { filePath, newName } = params;
    const pathCheck = checkWithinWorkspace(filePath);
    if (!pathCheck.ok) return { success: false, error: pathCheck.error };
    const nameCheck = checkSafeChildName(newName);
    if (!nameCheck.ok) return { success: false, error: nameCheck.error };
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
    const safeName = path.basename(newName.trim());
    if (!safeName) return { success: false, error: '文件名不能为空' };
    if (safeName !== newName.trim()) return { success: false, error: '文件名不能包含路径' };
    const destPath = path.join(path.dirname(filePath), safeName);
    if (destPath === filePath) return { success: true, filePath };
    if (fs.existsSync(destPath)) return { success: false, error: '同名文件已存在' };
    fs.renameSync(filePath, destPath);
    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:importFiles', async (_event: any, params: { folderPath: string; filePaths: string[] }) => {
  try {
    const { folderPath, filePaths } = params;
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    if (!fs.statSync(folderPath).isDirectory()) return { success: false, error: '目标位置不是文件夹' };

    const targetResolved = path.resolve(folderPath);
    const imported: { name: string; path: string }[] = [];
    for (const sourcePath of filePaths) {
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const sourceResolved = path.resolve(sourcePath);
      const stat = fs.statSync(sourcePath);
      const isDirectory = stat.isDirectory();
      if (!isDirectory && !stat.isFile()) continue;

      // 防止把文件夹复制到自身或子文件夹里，避免递归膨胀。
      if (isDirectory && (targetResolved === sourceResolved || targetResolved.startsWith(sourceResolved + path.sep))) {
        continue;
      }

      const ext = isDirectory ? '' : path.extname(sourcePath);
      const base = path.basename(sourcePath, ext);
      let destPath = path.join(folderPath, path.basename(sourcePath));
      let index = 1;
      while (fs.existsSync(destPath) && path.resolve(destPath) !== sourceResolved) {
        destPath = path.join(folderPath, `${base} (${index})${ext}`);
        index += 1;
      }
      if (path.resolve(destPath) === sourceResolved) continue;

      if (isDirectory) {
        fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true });
      } else {
        fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
      }
      imported.push({ name: path.basename(destPath), path: destPath });
    }
    return { success: true, files: imported };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:move', async (_event: any, params: { sourcePaths: string[]; targetFolder: string }) => {
  try {
    const { sourcePaths, targetFolder } = params;
    if (!targetFolder) return { success: false, error: '目标文件夹无效' };
    for (const sp of sourcePaths) {
      const c = checkWithinWorkspace(sp);
      if (!c.ok) return { success: false, error: c.error };
    }
    const tc = checkWithinWorkspace(targetFolder);
    if (!tc.ok) return { success: false, error: tc.error };
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
    if (!fs.statSync(targetFolder).isDirectory()) return { success: false, error: '目标位置不是文件夹' };

    const targetResolved = path.resolve(targetFolder);
    const moved: { name: string; path: string; sourcePath: string; isDirectory: boolean }[] = [];
    const errors: string[] = [];

    for (const sourcePath of sourcePaths) {
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        errors.push(`${path.basename(sourcePath || '') || '项目'}不存在`);
        continue;
      }
      const sourceResolved = path.resolve(sourcePath);
      const stat = fs.statSync(sourcePath);
      const isDirectory = stat.isDirectory();
      if (!isDirectory && !stat.isFile()) continue;
      if (path.dirname(sourceResolved) === targetResolved) continue;
      if (isDirectory && (targetResolved === sourceResolved || targetResolved.startsWith(sourceResolved + path.sep))) {
        errors.push(`不能把“${path.basename(sourcePath)}”移动到自身或其子文件夹中`);
        continue;
      }

      const destPath = path.join(targetFolder, path.basename(sourcePath));
      if (fs.existsSync(destPath)) {
        errors.push(`“${path.basename(sourcePath)}”已存在于目标文件夹`);
        continue;
      }

      try {
        fs.renameSync(sourcePath, destPath);
      } catch (error: any) {
        if (error?.code !== 'EXDEV') throw error;
        if (isDirectory) {
          fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true });
          fs.rmSync(sourcePath, { recursive: true, force: false });
        } else {
          fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
          fs.unlinkSync(sourcePath);
        }
      }
      moved.push({ name: path.basename(destPath), path: destPath, sourcePath, isDirectory });
    }

    return { success: errors.length === 0, moved, errors, error: errors.join('；') || undefined };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:duplicate', async (_event: any, params: { sourcePaths: string[]; targetFolder: string }) => {
  try {
    const { sourcePaths, targetFolder } = params;
    for (const sp of sourcePaths) {
      const c = checkWithinWorkspace(sp);
      if (!c.ok) return { success: false, error: c.error };
    }
    const tc = checkWithinWorkspace(targetFolder);
    if (!tc.ok) return { success: false, error: tc.error };
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });
    const copies: { name: string; path: string; isDirectory: boolean }[] = [];

    for (const sourcePath of sourcePaths) {
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const stat = fs.statSync(sourcePath);
      const isDirectory = stat.isDirectory();
      if (!isDirectory && !stat.isFile()) continue;

      const ext = isDirectory ? '' : path.extname(sourcePath);
      const base = path.basename(sourcePath, ext);
      let suffix = ' - 副本';
      let destPath = path.join(targetFolder, `${base}${suffix}${ext}`);
      let index = 2;
      while (fs.existsSync(destPath)) {
        suffix = ` - 副本 (${index})`;
        destPath = path.join(targetFolder, `${base}${suffix}${ext}`);
        index += 1;
      }

      if (isDirectory) {
        fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true });
      } else {
        fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
      }
      copies.push({ name: path.basename(destPath), path: destPath, isDirectory });
    }

    return { success: true, copies };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 删除文件
ipcMain.handle('file:delete', async (_event: any, filePath: string, options?: { permanent?: boolean }) => {
  try {
    const check = checkWithinWorkspace(filePath);
    if (!check.ok) return { success: false, error: check.error };
    let recycleEntry: RecycleBinEntry | undefined;
    if (fs.existsSync(filePath)) {
      if (options?.permanent) fs.unlinkSync(filePath);
      else recycleEntry = await movePathToRecycleBin(filePath);
    }
    return { success: true, recycleEntry };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:read', async (_event: any, filePath: string) => {
  const check = checkWithinWorkspace(filePath);
  if (!check.ok) throw new Error(check.error);
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('file:readDir', async (_event: any, dirPath: string) => {
  const check = checkWithinWorkspace(dirPath);
  if (!check.ok) throw new Error(check.error);
  return fs.promises.readdir(dirPath);
});

const fallbackFontNames = [
  '宋体',
  '黑体',
  '微软雅黑',
  '仿宋',
  '楷体',
  '等线',
  'Arial',
  'Calibri',
  'Cambria',
  'Times New Roman',
];

function normalizeFontName(name: string): string {
  return name
    .replace(/\s*\((TrueType|OpenType|Type 1|Collection)\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listInstalledFonts(): string[] {
  const fontNames = new Set<string>(fallbackFontNames);

  if (process.platform === 'win32') {
    try {
      const command = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        windowsHide: true,
      });
      output.split(/\r?\n/).map(normalizeFontName).filter(Boolean).forEach(name => fontNames.add(name));
    } catch {}
  }

  return Array.from(fontNames).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

ipcMain.handle('system:listFonts', async () => {
  try {
    return { success: true, fonts: listInstalledFonts() };
  } catch (error: any) {
    return { success: false, fonts: fallbackFontNames, error: error.message };
  }
});


ipcMain.handle('system:notify', async (_event: any, params: { title?: string; body?: string; silent?: boolean; target?: string; projectId?: string }) => {
  try {
    const shortcut = didEnsureWindowsNotificationShortcut
      ? { success: true, appUserModelId: APP_USER_MODEL_ID }
      : ensureWindowsNotificationShortcut();
    if (!Notification.isSupported()) return { success: false, error: 'System notifications are not supported', shortcut };
    const title = String(params?.title || APP_DISPLAY_NAME);
    const body = String(params?.body || '');
    const target = typeof params?.target === 'string' ? params.target : undefined;
    const projectId = typeof params?.projectId === 'string' ? params.projectId : undefined;
    const notification = new Notification({ title, body, silent: Boolean(params?.silent) });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('system:notification-click', { target, projectId });
      }
      app.focus({ steal: true });
    });
    notification.on('show', () => {
      console.log('[Notification] 已显示:', title);
    });
    notification.on('close', () => {
      console.log('[Notification] 已关闭:', title);
    });
    notification.show();
    console.log('[Notification] 已调用 show():', title, body?.substring(0, 60));
    return { success: true, shortcut, appUserModelId: APP_USER_MODEL_ID };
  } catch (error: any) {
    return { success: false, error: error.message, appUserModelId: APP_USER_MODEL_ID };
  }
});

ipcMain.handle('system:notificationStatus', async () => {
  return {
    supported: Notification.isSupported(),
    shortcut: ensureWindowsNotificationShortcut(),
    appUserModelId: APP_USER_MODEL_ID,
  };
});

// 项目持久化
ipcMain.handle('project:save', async (_event: any, project: Project) => {
  const projects = loadProjectsFromDisk();
  const index = projects.findIndex(p => p.id === project.id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  saveProjectsToDisk(projects);
});

function getLatestProjectFolderModifiedAt(folderPath: string): string | undefined {
  if (!folderPath || !fs.existsSync(folderPath)) return undefined;

  let latest = 0;
  let visited = 0;
  const stack = [folderPath];
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build']);

  while (stack.length > 0 && visited < 5000) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      const stat = fs.statSync(current);
      latest = Math.max(latest, stat.mtimeMs);
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited >= 5000) break;
      const fullPath = path.join(current, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        latest = Math.max(latest, stat.mtimeMs);
        if (entry.isDirectory() && !ignoredDirs.has(entry.name)) {
          stack.push(fullPath);
        }
      } catch {}
    }
  }

  return latest > 0 ? new Date(latest).toISOString() : undefined;
}

ipcMain.handle('project:loadAll', async () => {
  // 直接返回缓存数据，不做实时目录扫描
  return loadProjectsFromDisk();
});

// 后台刷新指定项目的目录修改时间（异步、非阻塞）
ipcMain.handle('project:refreshFolderModifiedAt', async (_event: any, projectIds: string[]) => {
  const projects = loadProjectsFromDisk();
  const updates: { id: string; folderModifiedAt: string }[] = [];
  for (const project of projects) {
    if (projectIds.length > 0 && !projectIds.includes(project.id)) continue;
    if (!project.folderPath) continue;
    const folderModifiedAt = getLatestProjectFolderModifiedAt(project.folderPath) || project.updatedAt;
    if (folderModifiedAt) {
      updates.push({ id: project.id, folderModifiedAt });
      // 同时持久化到项目 JSON
      const idx = projects.findIndex(p => p.id === project.id);
      if (idx >= 0) projects[idx].folderModifiedAt = folderModifiedAt;
    }
  }
  if (updates.length > 0) saveProjectsToDisk(projects);
  return updates;
});

ipcMain.handle('project:delete', async (_event: any, projectId: string) => {
  const projects = loadProjectsFromDisk();
  const filtered = projects.filter(p => p.id !== projectId);
  saveProjectsToDisk(filtered);
});

// 文件选择对话框
ipcMain.handle('dialog:openFile', async (_event: any, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择文件',
    filters: filters || [
      { name: '文档文件', extensions: ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt', 'md', 'rtf'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async (_event: any, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: '选择文件',
    filters: filters || [
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths;
});

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getXmlAttr(fragment: string, attrName: string): string {
  const match = fragment.match(new RegExp(`${attrName}="([^"]*)"`));
  return match?.[1] || '';
}

function getWordVal(fragment: string, tagName: string): string {
  const match = fragment.match(new RegExp(`<w:${tagName}\\b[^>]*w:val="([^"]*)"`, 'i'));
  return match?.[1] || '';
}

function extractReadableBinaryText(buffer: Buffer): string {
  const candidates = [buffer.toString('utf16le'), buffer.toString('utf8'), buffer.toString('latin1')]
    .map(value => normalizeExtractedText(
      value
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/\s]/g, ' ')
        .split(/\n| {2,}/)
        .map(line => line.trim())
        .filter(line => line.length >= 2)
        .join('\n')
    ))
    .filter(Boolean);
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of slideFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const slideLines = Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => normalizeExtractedText(decodeXmlText(match[1])))
      .filter(Boolean);
    if (slideLines.length > 0) lines.push(...slideLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/g) as Iterable<RegExpMatchArray>).map(match => {
        const text = Array.from(match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
          .map(t => decodeXmlText(t[1]))
          .join('');
        return normalizeExtractedText(text);
      })
    : [];

  const sheetFiles = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0));

  const lines: string[] = [];
  for (const fileName of sheetFiles) {
    const xml = await zip.file(fileName)?.async('string');
    if (!xml) continue;
    const sheetLines: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g) as Iterable<RegExpMatchArray>) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g) as Iterable<RegExpMatchArray>) {
        const attrs = cellMatch[1] || '';
        const cellXml = cellMatch[2] || '';
        const type = getXmlAttr(attrs, 't');
        let value = '';
        if (type === 's') {
          const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || -1);
          value = sharedStrings[index] || '';
        } else if (type === 'inlineStr') {
          value = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g) as Iterable<RegExpMatchArray>)
            .map(match => decodeXmlText(match[1]))
            .join('');
        } else {
          value = decodeXmlText(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
        }
        const normalized = normalizeExtractedText(value);
        if (normalized) cells.push(normalized);
      }
      if (cells.length > 0) sheetLines.push(cells.join('  '));
    }
    if (sheetLines.length > 0) lines.push(...sheetLines);
  }
  return normalizeExtractedText(lines.join('\n'));
}

function chineseCounter(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const one = value % 10;
    return `${digits[ten]}十${one ? digits[one] : ''}`;
  }
  return String(value);
}

function romanCounter(value: number): string {
  const map: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let rest = value;
  let result = '';
  for (const [num, token] of map) {
    while (rest >= num) {
      result += token;
      rest -= num;
    }
  }
  return result || String(value);
}

function formatNumberByType(format: string, value: number): string {
  if (/chinese|japanese/i.test(format)) return chineseCounter(value);
  if (/lowerLetter/i.test(format)) return String.fromCharCode(96 + Math.max(1, Math.min(value, 26)));
  if (/upperLetter/i.test(format)) return String.fromCharCode(64 + Math.max(1, Math.min(value, 26)));
  if (/lowerRoman/i.test(format)) return romanCounter(value);
  if (/upperRoman/i.test(format)) return romanCounter(value).toUpperCase();
  return String(value);
}

async function extractDocxTextWithNumbering(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return '';
    const numberingXml = await zip.file('word/numbering.xml')?.async('string');

    const numToAbstract = new Map<string, string>();
    const levels = new Map<string, { format: string; text: string }>();
    if (numberingXml) {
      for (const numMatch of numberingXml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g)) {
        const block = numMatch[0];
        const numId = getXmlAttr(block.match(/<w:num\b[^>]*>/)?.[0] || '', 'w:numId');
        const abstractNumId = getWordVal(block, 'abstractNumId');
        if (numId && abstractNumId) numToAbstract.set(numId, abstractNumId);
      }

      for (const abstractMatch of numberingXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)) {
        const block = abstractMatch[0];
        const abstractId = getXmlAttr(block.match(/<w:abstractNum\b[^>]*>/)?.[0] || '', 'w:abstractNumId');
        if (!abstractId) continue;
        for (const levelMatch of block.matchAll(/<w:lvl\b[\s\S]*?<\/w:lvl>/g)) {
          const levelBlock = levelMatch[0];
          const ilvl = getXmlAttr(levelBlock.match(/<w:lvl\b[^>]*>/)?.[0] || '', 'w:ilvl') || '0';
          levels.set(`${abstractId}:${ilvl}`, {
            format: getWordVal(levelBlock, 'numFmt'),
            text: decodeXmlText(getWordVal(levelBlock, 'lvlText')),
          });
        }
      }
    }

    const counters = new Map<string, number[]>();
    const lines: string[] = [];
    for (const paraMatch of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
      const paragraph = paraMatch[0];
      const text = normalizeExtractedText(
        Array.from(paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
          .map(match => decodeXmlText(match[1]))
          .join('')
      );
      if (!text) continue;

      const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
      const numPr = pPr.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/)?.[0] || '';
      const numId = getWordVal(numPr, 'numId');
      const ilvl = Number(getWordVal(numPr, 'ilvl') || '0');
      const sizes = Array.from(paragraph.matchAll(/<w:sz\b[^>]*w:val="(\d+)"/g) as Iterable<RegExpMatchArray>).map(match => Number(match[1]));
      const maxSize = sizes.length ? Math.max(...sizes) : 0;
      const isBold = /<w:b\b/.test(paragraph);
      const shouldRestoreNumber = Boolean(numId) && text.length <= 90 && (maxSize >= 28 || (isBold && maxSize >= 24));

      if (!shouldRestoreNumber) {
        lines.push(text);
        continue;
      }

      const abstractId = numToAbstract.get(numId);
      const level = abstractId ? levels.get(`${abstractId}:${ilvl}`) : undefined;
      const numCounters = counters.get(numId) || [];
      numCounters[ilvl] = (numCounters[ilvl] || 0) + 1;
      numCounters.length = ilvl + 1;
      counters.set(numId, numCounters);

      let label = '';
      if (level) {
        label = level.text || `%${ilvl + 1}`;
        label = label.replace(/%(\d+)/g, (_all, indexText) => {
          const refLevel = Number(indexText) - 1;
          const refValue = numCounters[refLevel] || 1;
          const refRule = abstractId ? levels.get(`${abstractId}:${refLevel}`) : undefined;
          return formatNumberByType(refRule?.format || level.format, refValue);
        });
        if (/chinese|japanese/i.test(level.format) && !/[、.．)）]/.test(label)) {
          label = `${formatNumberByType(level.format, numCounters[ilvl])}、`;
        }
      }

      lines.push(label && !text.startsWith(label) ? `${label} ${text}` : text);
    }

    return normalizeExtractedText(lines.join('\n'));
  } catch {
    return '';
  }
}
type ExtractedTemplateStyleKey = 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' | 'caption' | 'tableTitle' | 'tableHeader';

interface ExtractedTemplateStyleSample {
  key: ExtractedTemplateStyleKey;
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  alignment?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  indentFirstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
}

interface ExtractedTemplateParagraphStyle extends ExtractedTemplateStyleSample {
  index: number;
  styleId?: string;
  styleName?: string;
  isTableCell?: boolean;
}

const styleKeyNames: Record<ExtractedTemplateStyleKey, string> = {
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  body: '正文',
  caption: '图题/图例',
  tableTitle: '表题',
  tableHeader: '表头',
};

function xmlTextFromBlock(block: string): string {
  return normalizeExtractedText(
    Array.from(block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) as Iterable<RegExpMatchArray>)
      .map(match => decodeXmlText(match[1]))
      .join('')
  );
}

function isWordToggleEnabled(xml: string, tagName: string): boolean | undefined {
  const match = xml.match(new RegExp(`<w:${tagName}\\b[^>]*>`, 'i'));
  if (!match) return undefined;
  const value = match[0].match(/\bw:val="([^"]+)"/i)?.[1];
  return value ? !/^(0|false|off)$/i.test(value) : true;
}

function parseStylePropsFromXml(xml: string): any {
  const fontFamily =
    xml.match(/<w:rFonts\b[^>]*(?:w:eastAsia|w:ascii|w:hAnsi)="([^"]+)"/)?.[1];
  const fontSizeRaw = xml.match(/<w:sz\b[^>]*w:val="(\d+)"/)?.[1];
  const lineRaw = xml.match(/<w:spacing\b[^>]*w:line="(\d+)"/)?.[1];
  const letterSpacingRaw = xml.match(/<w:spacing\b[^>]*w:val="(-?\d+)"/)?.[1];
  const alignmentRaw = xml.match(/<w:jc\b[^>]*w:val="([^"]+)"/)?.[1];
  const colorRaw = xml.match(/<w:color\b[^>]*w:val="([^"]+)"/)?.[1];
  const firstLineCharsRaw = xml.match(/<w:ind\b[^>]*w:firstLineChars="(\d+)"/)?.[1];
  const firstLineRaw = xml.match(/<w:ind\b[^>]*w:firstLine="(\d+)"/)?.[1];
  const beforeRaw = xml.match(/<w:spacing\b[^>]*w:before="(\d+)"/)?.[1];
  const afterRaw = xml.match(/<w:spacing\b[^>]*w:after="(\d+)"/)?.[1];
  const isBold = isWordToggleEnabled(xml, 'b');
  const isItalic = isWordToggleEnabled(xml, 'i');
  const alignmentMap: Record<string, string> = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', left: 'left' };
  return {
    fontFamily,
    fontSize: fontSizeRaw ? Number(fontSizeRaw) / 2 : undefined,
    fontWeight: isBold === undefined ? undefined : isBold ? 'bold' : 'normal',
    fontStyle: isItalic === undefined ? undefined : isItalic ? 'italic' : 'normal',
    alignment: alignmentRaw ? alignmentMap[alignmentRaw] : undefined,
    lineHeight: lineRaw ? Math.round((Number(lineRaw) / 240) * 100) / 100 : undefined,
    letterSpacing: letterSpacingRaw ? Math.round((Number(letterSpacingRaw) / 20) * 100) / 100 : undefined,
    color: colorRaw && colorRaw !== 'auto' ? `#${colorRaw}` : undefined,
    indentFirstLine: firstLineCharsRaw
      ? Number(firstLineCharsRaw) / 100
      : firstLineRaw ? Math.round((Number(firstLineRaw) / 240) * 100) / 100 : undefined,
    spaceBefore: beforeRaw ? Math.round((Number(beforeRaw) / 20) * 100) / 100 : undefined,
    spaceAfter: afterRaw ? Math.round((Number(afterRaw) / 20) * 100) / 100 : undefined,
  };
}

function parseStyleDefinitions(stylesXml?: string): Map<string, any> {
  const styles = new Map<string, any>();
  if (!stylesXml) return styles;
  for (const match of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
    const block = match[0];
    const start = block.match(/<w:style\b[^>]*>/)?.[0] || '';
    const styleId = getXmlAttr(start, 'w:styleId');
    if (!styleId) continue;
    const name = decodeXmlText(getWordVal(block, 'name'));
    styles.set(styleId, { styleId, name, ...parseStylePropsFromXml(block) });
  }
  return styles;
}

function mergeStyleProps(base: any = {}, override: any = {}) {
  return {
    fontFamily: override.fontFamily || base.fontFamily,
    fontSize: override.fontSize || base.fontSize,
    fontWeight: override.fontWeight || base.fontWeight,
    fontStyle: override.fontStyle || base.fontStyle,
    alignment: override.alignment || base.alignment,
    lineHeight: override.lineHeight || base.lineHeight,
    letterSpacing: override.letterSpacing ?? base.letterSpacing,
    color: override.color || base.color,
    indentFirstLine: override.indentFirstLine ?? base.indentFirstLine,
    spaceBefore: override.spaceBefore ?? base.spaceBefore,
    spaceAfter: override.spaceAfter ?? base.spaceAfter,
  };
}

function classifyTemplateText(text: string, styleId?: string, styleName?: string): ExtractedTemplateStyleKey {
  const normalized = text.trim();
  const styleText = `${styleId || ''} ${styleName || ''}`.toLowerCase();
  if (/heading\s*1|标题\s*1|标题 1|heading1/.test(styleText)) return 'heading1';
  if (/heading\s*2|标题\s*2|标题 2|heading2/.test(styleText)) return 'heading2';
  if (/heading\s*3|标题\s*3|标题 3|heading3/.test(styleText)) return 'heading3';
  if (/heading\s*4|标题\s*4|标题 4|heading4/.test(styleText)) return 'heading4';
  if (/caption|题注/.test(styleText)) return /^表/.test(normalized) ? 'tableTitle' : 'caption';
  if (/^(表|表格)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'tableTitle';
  if (/^(图|图表|图例)\s*[\d一二三四五六七八九十]/.test(normalized)) return 'caption';
  if (/^(第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.．])/.test(normalized)) return 'heading1';
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(normalized)) return 'heading2';
  if (/^\d+(?:[.．]\d+)+/.test(normalized)) return normalized.split(/[.．]/).length >= 3 ? 'heading3' : 'heading2';
  if (/^\d+[、.．)]/.test(normalized) && normalized.length < 80) return 'heading3';
  return 'body';
}

function mostCommon<T>(values: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  values.filter(Boolean).forEach(value => counts.set(value as T, (counts.get(value as T) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function buildTemplateFormatRulesFromSamples(samples: ExtractedTemplateStyleSample[]) {
  const rules: Record<string, any> = {};
  const evidence: string[] = [];
  const keys: ExtractedTemplateStyleKey[] = ['heading1', 'heading2', 'heading3', 'heading4', 'body', 'caption', 'tableTitle', 'tableHeader'];
  keys.forEach(key => {
    const group = samples.filter(sample => sample.key === key);
    if (!group.length) return;
    const fontFamily = mostCommon(group.map(item => item.fontFamily));
    const fontSize = mostCommon(group.map(item => item.fontSize));
    const fontWeight = mostCommon(group.map(item => item.fontWeight));
    const fontStyle = mostCommon(group.map(item => item.fontStyle));
    const alignment = mostCommon(group.map(item => item.alignment));
    const lineHeight = mostCommon(group.map(item => item.lineHeight));
    const letterSpacing = mostCommon(group.map(item => item.letterSpacing));
    const color = mostCommon(group.map(item => item.color));
    const indentFirstLine = mostCommon(group.map(item => item.indentFirstLine));
    const spaceBefore = mostCommon(group.map(item => item.spaceBefore));
    const spaceAfter = mostCommon(group.map(item => item.spaceAfter));
    rules[key] = {
      fontRequirement: { fontFamily, fontSize, fontWeight, fontStyle, lineHeight, letterSpacing, color },
      paragraphRequirement: { alignment, indentFirstLine, spaceBefore, spaceAfter },
    };
    evidence.push(`${styleKeyNames[key]}：${fontFamily || '未知字体'} ${fontSize || '未知字号'}pt${fontWeight === 'bold' ? ' 加粗' : ''}；样本「${group[0].text.slice(0, 36)}」`);
  });
  return { rules, evidence };
}

function styleRuleFromExtractedSample(sample: ExtractedTemplateStyleSample) {
  return {
    fontRequirement: {
      fontFamily: sample.fontFamily,
      fontSize: sample.fontSize,
      fontWeight: sample.fontWeight,
      fontStyle: sample.fontStyle,
      lineHeight: sample.lineHeight,
      letterSpacing: sample.letterSpacing,
      color: sample.color,
    },
    paragraphRequirement: {
      alignment: sample.alignment,
      indentFirstLine: sample.indentFirstLine,
      spaceBefore: sample.spaceBefore,
      spaceAfter: sample.spaceAfter,
    },
  };
}

function describeTemplateStyleRule(rule: any): string {
  const font = rule?.fontRequirement || {};
  return [
    font.fontFamily,
    font.fontSize ? `${font.fontSize}pt` : '',
    font.fontWeight === 'bold' ? '加粗' : font.fontWeight === 'normal' ? '常规' : '',
  ].filter(Boolean).join(' ');
}

const templateStyleLabels: Record<string, string> = {
  heading1: '一级标题',
  heading2: '二级标题',
  heading3: '三级标题',
  heading4: '四级标题',
  body: '正文',
  caption: '图题/图例',
  tableTitle: '表题',
  tableHeader: '表头',
};

function alignmentLabel(value?: string) {
  const labels: Record<string, string> = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' };
  return value ? labels[value] || value : '';
}

function compareNumberField(label: string, expected?: number, actual?: number, unit = '', tolerance = 0.1) {
  if (expected === undefined || actual === undefined || Math.abs(Number(expected) - Number(actual)) < tolerance) return '';
  return `${label}应为 ${expected}${unit}，当前识别为 ${actual}${unit}`;
}

function collectFormatMismatches(expectedRule: any = {}, actualRule: any = {}) {
  const expectedFont = expectedRule?.fontRequirement || {};
  const actualFont = actualRule?.fontRequirement || {};
  const expectedParagraph = expectedRule?.paragraphRequirement || {};
  const actualParagraph = actualRule?.paragraphRequirement || {};
  const mismatches: string[] = [];

  if (expectedFont.fontFamily && actualFont.fontFamily && expectedFont.fontFamily !== actualFont.fontFamily) {
    mismatches.push(`字体应为 ${expectedFont.fontFamily}，当前识别为 ${actualFont.fontFamily}`);
  }
  const fontSizeMismatch = compareNumberField('字号', expectedFont.fontSize, actualFont.fontSize, 'pt', 0.5);
  if (fontSizeMismatch) mismatches.push(fontSizeMismatch);
  if (expectedFont.fontWeight && actualFont.fontWeight && expectedFont.fontWeight !== actualFont.fontWeight) {
    mismatches.push(`字重应为 ${expectedFont.fontWeight === 'bold' ? '加粗' : '常规'}，当前识别为 ${actualFont.fontWeight === 'bold' ? '加粗' : '常规'}`);
  }
  if (expectedFont.fontStyle && actualFont.fontStyle && expectedFont.fontStyle !== actualFont.fontStyle) {
    mismatches.push(`字形应为 ${expectedFont.fontStyle === 'italic' ? '斜体' : '常规'}，当前识别为 ${actualFont.fontStyle === 'italic' ? '斜体' : '常规'}`);
  }
  const lineHeightMismatch = compareNumberField('行距', expectedFont.lineHeight, actualFont.lineHeight, '', 0.05);
  if (lineHeightMismatch) mismatches.push(lineHeightMismatch);
  const letterSpacingMismatch = compareNumberField('字间距', expectedFont.letterSpacing, actualFont.letterSpacing, 'pt', 0.1);
  if (letterSpacingMismatch) mismatches.push(letterSpacingMismatch);
  if (expectedFont.color && actualFont.color && expectedFont.color.toLowerCase() !== actualFont.color.toLowerCase()) {
    mismatches.push(`颜色应为 ${expectedFont.color}，当前识别为 ${actualFont.color}`);
  }
  if (expectedParagraph.alignment && actualParagraph.alignment && expectedParagraph.alignment !== actualParagraph.alignment) {
    mismatches.push(`对齐方式应为 ${alignmentLabel(expectedParagraph.alignment)}，当前识别为 ${alignmentLabel(actualParagraph.alignment)}`);
  }
  const indentMismatch = compareNumberField('首行缩进', expectedParagraph.indentFirstLine, actualParagraph.indentFirstLine, '字符', 0.2);
  if (indentMismatch) mismatches.push(indentMismatch);
  const beforeMismatch = compareNumberField('段前间距', expectedParagraph.spaceBefore, actualParagraph.spaceBefore, 'pt', 0.5);
  if (beforeMismatch) mismatches.push(beforeMismatch);
  const afterMismatch = compareNumberField('段后间距', expectedParagraph.spaceAfter, actualParagraph.spaceAfter, 'pt', 0.5);
  if (afterMismatch) mismatches.push(afterMismatch);

  return mismatches;
}

function previewParagraphText(text: string) {
  return text.replace(/\s+/g, ' ').slice(0, 42);
}

function compareTemplateFormatRules(expected: any = {}, actual: any = {}, actualParagraphs: ExtractedTemplateParagraphStyle[] = []) {
  const issues: ReviewIssue[] = [];
  const detailedLimit = 20;
  const formatSeverity = (key: string): ReviewIssue['severity'] =>
    ['heading1', 'heading2', 'heading3', 'heading4', 'body'].includes(key) ? 'error' : 'warning';

  if (actualParagraphs.length > 0) {
    for (const paragraph of actualParagraphs) {
      if (issues.length >= detailedLimit) break;
      const expectedRule = expected?.[paragraph.key];
      if (!expectedRule) continue;
      const actualRule = styleRuleFromExtractedSample(paragraph);
      const mismatches = collectFormatMismatches(expectedRule, actualRule);
      if (!mismatches.length) continue;
      const label = templateStyleLabels[paragraph.key] || paragraph.key;
      issues.push({
        id: `format_para_${paragraph.index}_${issues.length}`,
        type: 'wrong_format',
        severity: formatSeverity(paragraph.key),
        sectionTitle: label,
        lineNumber: paragraph.index + 1,
        message: `第 ${paragraph.index + 1} 段「${previewParagraphText(paragraph.text)}」${label}格式不一致：${mismatches.slice(0, 4).join('；')}`,
        suggestion: `格式规则为硬性要求：${describeTemplateStyleRule(expectedRule)}。请严格按${label}格式调整该段。`,
      });
    }
    if (issues.length >= detailedLimit) {
      issues.push({
        id: `format_more_${issues.length}`,
        type: 'wrong_format',
        severity: 'warning',
        sectionTitle: '格式检查',
        message: `已列出前 ${detailedLimit} 个段落格式问题，其余相同类型问题请按模板规则继续检查。`,
        suggestion: '建议先统一修改标题样式和正文样式，再重新运行模板审查。',
      });
    }
    return issues;
  }

  Object.entries(expected).forEach(([key, expectedRule]: [string, any]) => {
    const actualRule = actual?.[key];
    if (!actualRule) return;
    const mismatches = collectFormatMismatches(expectedRule, actualRule);
    if (!mismatches.length) return;
    issues.push({
      id: `format_${key}_${issues.length}`,
      type: 'wrong_format',
      severity: formatSeverity(key),
      sectionTitle: templateStyleLabels[key] || key,
      message: `${templateStyleLabels[key] || key}格式可能不一致：${mismatches.join('；')}`,
      suggestion: `格式规则为硬性要求：${describeTemplateStyleRule(expectedRule)}。请检查并严格统一文档中${templateStyleLabels[key] || key}的实际格式。`,
    });
  });
  return issues;
}
async function extractDocxTemplateFormatRules(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const sourcePath = ext === '.doc' ? convertLegacyDocToDocx(filePath) : filePath;
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.docx') {
    return { success: false, error: ext === '.doc' ? '旧版 .doc 自动转换为 .docx 失败，请确认本机安装了 Microsoft Word 或 LibreOffice。' : '仅 .docx 支持读取实际段落和表格格式' };
  }
  const buffer = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) return { success: false, error: '未找到 word/document.xml' };
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const styles = parseStyleDefinitions(stylesXml);
  const samples: ExtractedTemplateStyleSample[] = [];
  const paragraphs: ExtractedTemplateParagraphStyle[] = [];

  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const paragraph = match[0];
    const text = xmlTextFromBlock(paragraph);
    if (!text) continue;
    const pPr = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
    const styleId = getWordVal(pPr, 'pStyle');
    const style = styleId ? styles.get(styleId) : undefined;
    const runPr = paragraph.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
    const props = mergeStyleProps(style, mergeStyleProps(parseStylePropsFromXml(pPr), parseStylePropsFromXml(runPr)));
    const key = classifyTemplateText(text, styleId, style?.name);
    paragraphs.push({
      index: paragraphs.length,
      key,
      text: text.slice(0, 600),
      styleId,
      styleName: style?.name,
      ...props,
    });
    if (text.length > 600) continue;
    if (key === 'body' && (text.length < 30 || samples.filter(sample => sample.key === 'body').length >= 12)) continue;
    samples.push({ key, text, ...props });
  }

  for (const tableMatch of documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const firstRow = tableMatch[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0];
    if (!firstRow) continue;
    for (const cellMatch of firstRow.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const cell = cellMatch[0];
      const text = xmlTextFromBlock(cell);
      if (!text) continue;
      const runPr = cell.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
      const props = parseStylePropsFromXml(runPr);
      samples.push({ key: 'tableHeader', text, ...props });
      paragraphs.push({
        index: paragraphs.length,
        key: 'tableHeader',
        text: text.slice(0, 600),
        isTableCell: true,
        ...props,
      });
    }
  }

  const { rules, evidence } = buildTemplateFormatRulesFromSamples(samples);
  return {
    success: true,
    formatRules: rules,
    paragraphs,
    evidence: [`已逐段识别 ${paragraphs.length} 段文字格式`, ...evidence],
    sampleCount: samples.length,
    paragraphCount: paragraphs.length,
  };
}

function stripRtf(value: string): string {
  return normalizeExtractedText(
    value
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+\d* ?/g, '')
      .replace(/[{}]/g, ' ')
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function convertedDocxPathFor(filePath: string): string {
  ensureDataDir();
  const convertedDir = path.join(dataDir, 'converted-docx');
  if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true });
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const safeBase = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*]+/g, '_').slice(0, 80);
  const stamp = stat ? `${Math.round(stat.mtimeMs)}-${stat.size}` : String(Date.now());
  return path.join(convertedDir, `${safeBase}-${stamp}.docx`);
}

function findLibreOfficeExecutable(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'soffice.exe',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate === 'soffice.exe' || fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function convertDocWithWordCom(filePath: string, targetPath: string): boolean {
  const command = `
$ErrorActionPreference = 'Stop'
$source = ${quotePowerShellString(filePath)}
$target = ${quotePowerShellString(targetPath)}
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($source, $false, $true)
  $doc.SaveAs2($target, 16)
} finally {
  if ($doc -ne $null) { $doc.Close($false) }
  if ($word -ne $null) { $word.Quit() }
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('Word COM doc conversion failed:', error);
    return false;
  }
}

function convertDocWithLibreOffice(filePath: string, targetPath: string): boolean {
  const soffice = findLibreOfficeExecutable();
  if (!soffice) return false;
  const outDir = path.dirname(targetPath);
  try {
    execFileSync(soffice, ['--headless', '--convert-to', 'docx', '--outdir', outDir, filePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
    });
    const generatedPath = path.join(outDir, `${path.basename(filePath, path.extname(filePath))}.docx`);
    if (fs.existsSync(generatedPath) && generatedPath !== targetPath) {
      fs.copyFileSync(generatedPath, targetPath);
    }
    return fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (error) {
    console.warn('LibreOffice doc conversion failed:', error);
    return false;
  }
}

function convertLegacyDocToDocx(filePath: string): string | null {
  if (path.extname(filePath).toLowerCase() !== '.doc') return null;
  const targetPath = convertedDocxPathFor(filePath);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) return targetPath;
  if (convertDocWithWordCom(filePath, targetPath)) return targetPath;
  if (convertDocWithLibreOffice(filePath, targetPath)) return targetPath;
  return null;
}
function extractLegacyDocText(buffer: Buffer): string {
  const utf16 = normalizeExtractedText(buffer.toString('utf16le'));
  const utf8 = normalizeExtractedText(buffer.toString('utf8'));
  const best = utf16.length > utf8.length ? utf16 : utf8;
  return best
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && /[\u4e00-\u9fa5A-Za-z0-9]/.test(line))
    .join('\n');
}

function isReadableExtractedText(value: string): boolean {
  const compact = value.replace(/\s/g, '');
  if (compact.length < 20) return false;
  const readable = compact.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：！？（）()《》.\-_/]/g)?.length || 0;
  const replacement = compact.match(/�/g)?.length || 0;
  return readable / compact.length > 0.68 && replacement / compact.length < 0.05;
}

// 解析 Word 文档

function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getBackupPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return path.join(dir, `${base}.bak-${stamp}${ext}`);
}

function normalizeForSearch(value: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  Array.from(value).forEach((char, index) => {
    if (/\s/.test(char)) return;
    chars.push(char);
    map.push(index);
  });
  return { text: chars.join(''), map };
}

function findTextRange(haystack: string, needle: string): { start: number; end: number; mode: 'exact' | 'compact' } | null {
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0) return { start: exactIndex, end: exactIndex + needle.length, mode: 'exact' };
  const compactHaystack = normalizeForSearch(haystack);
  const compactNeedle = normalizeForSearch(needle);
  if (!compactNeedle.text) return null;
  const compactIndex = compactHaystack.text.indexOf(compactNeedle.text);
  if (compactIndex < 0) return null;
  return {
    start: compactHaystack.map[compactIndex],
    end: compactHaystack.map[compactIndex + compactNeedle.text.length - 1] + 1,
    mode: 'compact',
  };
}

function replaceDocxXmlText(xml: string, originalText: string, replacementText: string) {
  const segments: Array<{ start: number; end: number; inner: string; text: string }> = [];
  const textRegex = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let fullText = '';
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml))) {
    const text = decodeXmlText(match[2]);
    segments.push({ start: fullText.length, end: fullText.length + text.length, inner: match[2], text });
    fullText += text;
  }

  const range = findTextRange(fullText, originalText);
  if (!range) return { replaced: false, xml, mode: 'none' as const };

  let inserted = false;
  let segmentIndex = 0;
  const nextXml = xml.replace(textRegex, (_all, open: string, inner: string, close: string) => {
    const segment = segments[segmentIndex++];
    if (!segment || segment.end <= range.start || segment.start >= range.end) return open + inner + close;
    const overlapStart = Math.max(range.start, segment.start);
    const overlapEnd = Math.min(range.end, segment.end);
    const before = overlapStart > segment.start ? segment.text.slice(0, overlapStart - segment.start) : '';
    const after = overlapEnd < segment.end ? segment.text.slice(overlapEnd - segment.start) : '';
    const nextText = inserted ? after : before + replacementText + after;
    inserted = true;
    return open + encodeXmlText(nextText) + close;
  });

  return { replaced: true, xml: nextXml, mode: range.mode };
}

async function replaceDocumentText(params: { filePath: string; originalText: string; replacementText: string }) {
  const filePath = String(params?.filePath || '');
  const originalText = String(params?.originalText || '').trim();
  const replacementText = String(params?.replacementText || '').trim();
  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: '文件不存在或路径无效' };
  if (!originalText) return { success: false, error: '原文内容不能为空' };
  if (!replacementText) return { success: false, error: '建议修改内容不能为空' };

  const ext = path.extname(filePath).toLowerCase();
  const backupPath = getBackupPath(filePath);
  fs.copyFileSync(filePath, backupPath);

  try {
    if (ext === '.txt' || ext === '.md') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const range = findTextRange(raw, originalText);
      if (!range) return { success: false, error: '未在文档中找到匹配的原文内容，请调整原文后重试', backupPath };
      fs.writeFileSync(filePath, raw.slice(0, range.start) + replacementText + raw.slice(range.end), 'utf-8');
      return { success: true, replacedCount: 1, backupPath, matchMode: range.mode };
    }

    if (ext === '.docx') {
      const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
      const docFile = zip.file('word/document.xml');
      if (!docFile) return { success: false, error: '未找到 docx 主文档内容', backupPath };
      const xml = await docFile.async('string');
      const result = replaceDocxXmlText(xml, originalText, replacementText);
      if (!result.replaced) return { success: false, error: '未在 docx 中找到匹配的原文内容，请调整原文后重试', backupPath };
      zip.file('word/document.xml', result.xml);
      fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
      return { success: true, replacedCount: 1, backupPath, matchMode: result.mode };
    }

    return { success: false, error: '暂只支持 .docx、.txt、.md 的自动替换', backupPath };
  } catch (error: any) {
    try {
      if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, filePath);
    } catch {}
    return { success: false, error: error.message || '替换失败，已尝试恢复原文件', backupPath };
  }
}


ipcMain.handle('file:replaceDocumentText', async (_event: any, params: { filePath: string; originalText: string; replacementText: string }) => replaceDocumentText(params));

ipcMain.handle('file:parseWord', async (_event: any, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    if (path.extname(filePath).toLowerCase() === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) {
        return {
          success: true,
          content: docxContent,
          fileName: path.basename(filePath),
        };
      }
    }
    const result = await mammoth.extractRawText({ buffer });
    return {
      success: true,
      content: result.value,
      fileName: path.basename(filePath),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
});

interface DocxParagraphBlock {
  xml: string;
  text: string;
  start: number;
  end: number;
}

function collectDocxParagraphBlocks(documentXml: string): DocxParagraphBlock[] {
  const blocks: DocxParagraphBlock[] = [];
  const regex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(documentXml))) {
    const xml = match[0];
    const text = xmlTextFromBlock(xml);
    if (!text) continue;
    blocks.push({ xml, text, start: match.index, end: match.index + xml.length });
  }
  return blocks;
}

function replaceParagraphProperties(targetParagraph: string, sourceParagraph: string): string {
  const sourcePPr = sourceParagraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || '';
  const sourceRPr = sourceParagraph.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || '';
  let next = targetParagraph;

  if (sourcePPr) {
    if (/<w:pPr\b[\s\S]*?<\/w:pPr>/.test(next)) {
      next = next.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/, sourcePPr);
    } else {
      next = next.replace(/(<w:p\b[^>]*>)/, `$1${sourcePPr}`);
    }
  }

  if (sourceRPr) {
    next = next.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (runXml) => {
      if (/<w:rPr\b[\s\S]*?<\/w:rPr>/.test(runXml)) {
        return runXml.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/, sourceRPr);
      }
      return runXml.replace(/(<w:r\b[^>]*>)/, `$1${sourceRPr}`);
    });
  }

  return next;
}

async function applyDocumentParagraphFormats(params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) {
  const sourcePath = String(params?.sourcePath || '');
  const targetPath = String(params?.targetPath || '');
  const paragraphIndices = Array.from(new Set((params?.paragraphIndices || []).map(Number).filter(index => Number.isInteger(index) && index >= 0))).sort((a, b) => a - b);
  if (!sourcePath || !targetPath) return { success: false, error: '源文件或目标文件路径无效' };
  if (paragraphIndices.length === 0) return { success: false, error: '请先选择要套用格式的段落' };

  const sourceCheck = checkWithinWorkspace(sourcePath);
  if (!sourceCheck.ok) return { success: false, error: sourceCheck.error };
  const targetCheck = checkWithinWorkspace(targetPath);
  if (!targetCheck.ok) return { success: false, error: targetCheck.error };
  if (!fs.existsSync(sourcePath) || !fs.existsSync(targetPath)) return { success: false, error: '源文件或目标文件不存在' };

  const sourceExt = path.extname(sourcePath).toLowerCase();
  const targetExt = path.extname(targetPath).toLowerCase();
  const resolvedSource = sourceExt === '.doc' ? convertLegacyDocToDocx(sourcePath) : sourcePath;
  if (!resolvedSource || path.extname(resolvedSource).toLowerCase() !== '.docx') {
    return { success: false, error: '源文件需要是 .docx，旧版 .doc 需要能自动转换为 .docx' };
  }
  if (targetExt !== '.docx') {
    return { success: false, error: '目前只支持把格式套用到 .docx 目标文件' };
  }

  const backupPath = getBackupPath(targetPath);
  fs.copyFileSync(targetPath, backupPath);

  try {
    const sourceZip = await JSZip.loadAsync(fs.readFileSync(resolvedSource));
    const targetZip = await JSZip.loadAsync(fs.readFileSync(targetPath));
    const sourceDoc = sourceZip.file('word/document.xml');
    const targetDoc = targetZip.file('word/document.xml');
    if (!sourceDoc || !targetDoc) return { success: false, error: '未找到 docx 主文档内容', backupPath };

    const sourceXml = await sourceDoc.async('string');
    const targetXml = await targetDoc.async('string');
    const sourceParagraphs = collectDocxParagraphBlocks(sourceXml);
    const targetParagraphs = collectDocxParagraphBlocks(targetXml);

    let nextXml = targetXml;
    let appliedCount = 0;
    for (const index of paragraphIndices.slice().sort((a, b) => b - a)) {
      const sourceParagraph = sourceParagraphs[index];
      const targetParagraph = targetParagraphs[index];
      if (!sourceParagraph || !targetParagraph) continue;
      const replacement = replaceParagraphProperties(targetParagraph.xml, sourceParagraph.xml);
      nextXml = nextXml.slice(0, targetParagraph.start) + replacement + nextXml.slice(targetParagraph.end);
      appliedCount++;
    }

    if (appliedCount === 0) return { success: false, error: '没有找到可套用的对应段落', backupPath };
    targetZip.file('word/document.xml', nextXml);
    fs.writeFileSync(targetPath, await targetZip.generateAsync({ type: 'nodebuffer' }));
    return { success: true, appliedCount, backupPath };
  } catch (error: any) {
    try {
      if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, targetPath);
    } catch {}
    return { success: false, error: error.message || '套用格式失败，已尝试恢复原文件', backupPath };
  }
}

ipcMain.handle('file:applyDocumentParagraphFormats', async (_event: any, params: { sourcePath: string; targetPath: string; paragraphIndices: number[] }) => applyDocumentParagraphFormats(params));
ipcMain.handle('file:extractTemplateFormatRules', async (_event: any, filePath: string) => {
  try {
    return await extractDocxTemplateFormatRules(filePath);
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('file:parseDocument', async (_event: any, filePath: string) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    if (ext === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) return { success: true, content: docxContent, fileName };
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, content: normalizeExtractedText(result.value), fileName };
    }

    if (ext === '.doc') {
      const convertedPath = convertLegacyDocToDocx(filePath);
      if (convertedPath) {
        const convertedBuffer = fs.readFileSync(convertedPath);
        const docxContent = await extractDocxTextWithNumbering(convertedBuffer);
        if (docxContent) return { success: true, content: docxContent, fileName, convertedFilePath: convertedPath };
      }
      try {
        const result = await mammoth.extractRawText({ buffer });
        const content = normalizeExtractedText(result.value);
        if (content) return { success: true, content, fileName };
      } catch {}

      const content = extractLegacyDocText(buffer);
      if (!content || !isReadableExtractedText(content)) {
        return { success: false, error: '旧版 .doc 自动转换失败，且未提取到可读文本。请确认本机安装了 Microsoft Word 或 LibreOffice，或手动另存为 .docx。' };
      }
      return { success: true, content, fileName };
    }

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return { success: true, content: normalizeExtractedText(data.text), fileName, pages: data.numpages };
    }

    if (ext === '.pptx') {
      const content = await extractPptxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 PPTX 中提取到可识别文本' };
    }

    if (ext === '.xlsx') {
      const content = await extractXlsxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 Excel 中提取到可识别文本' };
    }

    if (ext === '.ppt' || ext === '.xls') {
      const content = extractReadableBinaryText(buffer);
      return content && isReadableExtractedText(content)
        ? { success: true, content, fileName }
        : { success: false, error: '旧版 .ppt/.xls 为二进制格式，未提取到可识别文本；建议另存为 .pptx/.xlsx 后导入' };
    }

    if (ext === '.rtf') {
      return { success: true, content: stripRtf(buffer.toString('utf8')), fileName };
    }

    if (ext === '.txt' || ext === '.md') {
      return { success: true, content: normalizeExtractedText(fs.readFileSync(filePath, 'utf-8')), fileName };
    }

    return { success: false, error: '不支持的文件格式' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:parseDocumentSilent', async (_event: any, filePath: string) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    if (ext === '.docx') {
      const docxContent = await extractDocxTextWithNumbering(buffer);
      if (docxContent) return { success: true, content: docxContent, fileName };
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, content: normalizeExtractedText(result.value), fileName };
    }

    if (ext === '.doc') {
      const convertedPath = convertLegacyDocToDocx(filePath);
      if (convertedPath) {
        const convertedBuffer = fs.readFileSync(convertedPath);
        const docxContent = await extractDocxTextWithNumbering(convertedBuffer);
        if (docxContent) return { success: true, content: docxContent, fileName, convertedFilePath: convertedPath };
      }
      try {
        const result = await mammoth.extractRawText({ buffer });
        const content = normalizeExtractedText(result.value);
        if (content) return { success: true, content, fileName };
      } catch {}

      const content = extractLegacyDocText(buffer);
      if (content && isReadableExtractedText(content)) {
        return { success: true, content, fileName };
      }
      return { success: false, error: '旧版 .doc 自动转换失败，且未提取到可读文本。请确认本机安装了 Microsoft Word 或 LibreOffice，或手动另存为 .docx。' };
    }

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return { success: true, content: normalizeExtractedText(data.text), fileName, pages: data.numpages };
    }

    if (ext === '.pptx') {
      const content = await extractPptxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 PPTX 中提取到可识别文本' };
    }

    if (ext === '.xlsx') {
      const content = await extractXlsxText(buffer);
      return content
        ? { success: true, content, fileName }
        : { success: false, error: '未从 Excel 中提取到可识别文本' };
    }

    if (ext === '.ppt' || ext === '.xls') {
      const content = extractReadableBinaryText(buffer);
      return content && isReadableExtractedText(content)
        ? { success: true, content, fileName }
        : { success: false, error: '旧版 .ppt/.xls 为二进制格式，未提取到可识别文本；建议另存为 .pptx/.xlsx 后导入' };
    }

    if (ext === '.rtf') {
      return { success: true, content: stripRtf(buffer.toString('utf8')), fileName };
    }

    if (ext === '.txt' || ext === '.md') {
      return { success: true, content: normalizeExtractedText(fs.readFileSync(filePath, 'utf-8')), fileName };
    }

    return { success: false, error: '不支持的文件格式' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 解析 PDF 文档
ipcMain.handle('file:parsePdf', async (_event: any, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return {
      success: true,
      content: data.text,
      fileName: path.basename(filePath),
      pages: data.numpages,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
});

// 版本操作
ipcMain.handle('version:save', async (_event: any, version: DocumentVersion) => {
  const versions = loadVersionsFromDisk();
  const index = versions.findIndex(v => v.id === version.id);
  if (index >= 0) {
    versions[index] = version;
  } else {
    versions.push(version);
  }
  saveVersionsToDisk(versions);
});

ipcMain.handle('version:loadAll', async () => {
  return loadVersionsFromDisk();
});

ipcMain.handle('version:delete', async (_event: any, versionId: string) => {
  const versions = loadVersionsFromDisk();
  const filtered = versions.filter(v => v.id !== versionId);
  saveVersionsToDisk(filtered);
});

// 模板操作
ipcMain.handle('template:save', async (_event: any, template: WritingTemplate) => {
  const templates = loadTemplatesFromDisk();
  const index = templates.findIndex(t => t.id === template.id);
  if (index >= 0) {
    templates[index] = template;
  } else {
    templates.push(template);
  }
  saveTemplatesToDisk(templates);
});

// 存储模板源文件（导入模板时调用）
ipcMain.handle('template:storeFile', async (_event: any, params: { templateId: string; sourcePath: string }) => {
  try {
    if (!fs.existsSync(templateFilesDir)) {
      fs.mkdirSync(templateFilesDir, { recursive: true });
    }
    const ext = path.extname(params.sourcePath);
    const destPath = path.join(templateFilesDir, `${params.templateId}${ext}`);
    fs.copyFileSync(params.sourcePath, destPath);
    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('template:loadAll', async () => {
  return loadTemplatesFromDisk();
});

ipcMain.handle('template:delete', async (_event: any, templateId: string) => {
  const templates = loadTemplatesFromDisk();
  const filtered = templates.filter(t => t.id !== templateId);
  saveTemplatesToDisk(filtered);
});

// 范文分析：解析范文并生成AI分析摘要，支持多次分析对比差异
ipcMain.handle('template:analyzeExamples', async (_event: any, params: {
  exampleContents: string[];
  templateNodes: Array<{ id: string; title: string; level: number }>;
  templateName: string;
  existingAnalysis?: string;
}) => {
  const combinedContent = params.exampleContents
    .map((content, i) => `【范文${i + 1}】\n${content.slice(0, 15000)}`)
    .join('\n\n---\n\n');

  const hasExisting = params.existingAnalysis && params.existingAnalysis.trim().length > 10;

  const prompt = hasExisting
    ? `你是一位专业的文档写作分析助手。已有之前的范文分析结果，现在又导入了一篇新范文，请对比分析，只列出新范文与已有分析的差异点。

已有分析结果：
${params.existingAnalysis}

新范文内容：
${combinedContent}

要求：
1. 只列出新范文与已有分析的差异，相同部分不需要重复
2. 如果新范文的章节结构、字数、风格与已有分析一致，输出"无显著差异"
3. 如果有差异，按以下格式列出：
- 整体风格差异：...
- 格式差异：...
- 章节差异（仅列出不同的章节）：...
- 字数差异（仅列出不同的章节）：...

请用简洁的文本输出，不需要JSON格式。`
    : `你是一位专业的文档写作分析助手。请分析以下${params.exampleContents.length}篇范文，生成一份精炼的写作分析摘要，供后续写作时参考。

模板名称：${params.templateName}
模板章节结构：
${params.templateNodes.map(n => `${'  '.repeat(n.level - 1)}${n.title}`).join('\n')}

分析要求：
1. 整体格式特征：范文的章节组织方式、标题编号风格、段落划分习惯
2. 写作风格总结：正式程度、论述方式（举例/数据/引用）、语言特点
3. 各章节字数参考：给出每个主要章节的建议字数范围（基于范文实际字数）
4. 内容要点：每个章节应包含的核心内容要素
5. 常见开头/结尾模式：是否有固定套话或结构

请用以下JSON格式输出（仅输出JSON，不要其他文字）：
{
  "overallStyle": "整体写作风格描述（100字以内）",
  "formatFeatures": "格式特征描述（80字以内）",
  "sectionGuidance": [
    { "title": "章节标题", "suggestedWordCount": "建议字数范围", "keyPoints": "核心内容要点", "writingTip": "写作技巧" }
  ],
  "openingPatterns": "常见开头模式",
  "closingPatterns": "常见结尾模式",
  "generalTips": "通用写作建议"
}

范文内容：
${combinedContent}`;

  try {
    const result = await callConfiguredAI(prompt);

    if (hasExisting) {
      // 对比模式：直接返回文本结果
      const summary = `【已有分析】\n${params.existingAnalysis}\n\n【新范文差异】\n${result}`;
      return { success: true, analysis: summary, rawAnalysis: null };
    }

    // 首次分析：尝试解析JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      const summary = [
        `【整体风格】${analysis.overallStyle || ''}`,
        `【格式特征】${analysis.formatFeatures || ''}`,
        '',
        '【各章节参考】',
        ...(analysis.sectionGuidance || []).map((s: any) =>
          `  ${s.title}：建议${s.suggestedWordCount || '适量'}字。${s.keyPoints ? `要点：${s.keyPoints}` : ''}${s.writingTip ? ` 技巧：${s.writingTip}` : ''}`
        ),
        '',
        `【开头模式】${analysis.openingPatterns || ''}`,
        `【结尾模式】${analysis.closingPatterns || ''}`,
        `【通用建议】${analysis.generalTips || ''}`,
      ].filter(Boolean).join('\n');
      return { success: true, analysis: summary, rawAnalysis: analysis };
    }
    return { success: true, analysis: result, rawAnalysis: null };
  } catch (error: any) {
    return { success: false, error: error.message || '范文分析失败' };
  }
});

// 文档审查功能
ipcMain.handle('review:execute', async (_event: any, params: {
  versionId: string;
  templateId: string;
  config: ReviewConfig;
  usageRequestId?: string;
}) => {
  const versions = loadVersionsFromDisk();
  const templates = loadTemplatesFromDisk();

  const version = versions.find(v => v.id === params.versionId);
  const template = templates.find(t => t.id === params.templateId);

  if (!version || !template) {
    return { success: false, error: '版本或模板不存在' };
  }

  const issues: ReviewIssue[] = [];
  const content = version.content;
  const isExampleTemplate = template.templateType === 'example';
  const allTemplateNodes = flattenNodes(template.nodes, template);
  const extractedSections = extractSections(content);
  const normalizedContent = normalizeContentForSectionMatch(content);
  const sectionMatches = new Map<string, ReturnType<typeof findSectionForTemplateNode>>();
  const getSectionMatch = (node: TemplateNode) => {
    if (!sectionMatches.has(node.id)) {
      sectionMatches.set(node.id, findSectionForTemplateNode(node, extractedSections, normalizedContent, content));
    }
    return sectionMatches.get(node.id) || null;
  };

  // 检查缺失章节：复用项目文档完成度的章节提取与模糊匹配，避免因编号、空格、标点或 Word 解析换行误判。
  if (params.config.checkMissingSections && !isExampleTemplate) {
    for (const node of allTemplateNodes) {
      if (!node.isRequired) continue;
      const matched = getSectionMatch(node);
      if (!matched) {
        issues.push({
          id: `missing_${node.id}`,
          type: 'missing_section',
          severity: 'error',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `未识别到必需章节：${node.title}`,
          suggestion: `请确认正文中是否有"${node.title}"对应标题或内容；如已有内容，请检查标题编号、标题文字是否与模板结构可对应。${node.description ? ' ' + node.description : ''}`,
        });
      } else if (matched.matchedBy === 'evidence') {
        issues.push({
          id: `section_mapping_${node.id}`,
          type: 'suggestion',
          severity: 'warning',
          nodeId: node.id,
          sectionTitle: node.title,
          message: `正文中发现与「${node.title}」相关的内容证据，未按缺失处理。`,
          suggestion: `建议人工确认该内容是否对应模板章节。匹配关键词：${(matched.evidenceTerms || []).join('、') || '相关内容'}。`,
        });
      }
    }
  }

  if (params.config.checkContentDeviation) {
    const isExample = template.templateType === 'example';
    for (const node of allTemplateNodes) {
      if (!node.isRequired) continue;
      const matched = getSectionMatch(node);
      if (!matched || matched.matchedBy !== 'heading') continue;
      const wordCount = countContentChars(matched.content);
      const lengthRequirement = getSectionLengthRequirement(node, template);
      if (wordCount > 0 && wordCount < lengthRequirement.minComplete) {
        issues.push({
          id: `content_short_${node.id}`,
          type: 'content_deviation',
          severity: isExample ? 'info' : 'warning',
          nodeId: node.id,
          sectionTitle: node.title,
          message: isExample
            ? `\u7ae0\u8282\u5185\u5bb9\u53c2\u8003\uff1a${node.title}\uff08\u7ea6 ${wordCount} \u5b57\uff0c\u8303\u6587\u53c2\u8003\u7ea6 ${lengthRequirement.minComplete} \u5b57\uff09`
            : `\u7ae0\u8282\u5185\u5bb9\u53ef\u80fd\u504f\u5c11\uff1a${node.title}\uff08\u7ea6 ${wordCount} \u5b57\uff0c\u53c2\u8003\u6807\u51c6\uff1a${lengthRequirement.source}\uff0c\u5efa\u8bae\u7ea6 ${lengthRequirement.minComplete} \u5b57\uff09`,
          suggestion: isExample
            ? `\u5f53\u524d\u4e3a\u8303\u6587\u6a21\u677f\uff0c\u5b57\u6570\u4ec5\u4f9b\u53c2\u8003\uff0c\u53ef\u6839\u636e\u5b9e\u9645\u5185\u5bb9\u7075\u6d3b\u8c03\u6574\u3002`
            : (node.requirementText || node.description
              ? `\u8bf7\u5bf9\u7167\u6a21\u677f\u8981\u6c42\u8865\u5145\u8be5\u7ae0\u8282\uff1a${node.requirementText || node.description}`
              : `\u8bf7\u786e\u8ba4\u8be5\u7ae0\u8282\u662f\u5426\u9700\u8981\u8865\u5145\u4e8b\u5b9e\u3001\u6570\u636e\u3001\u4f9d\u636e\u6216\u5c55\u5f00\u8bf4\u660e\uff1b\u5f53\u524d\u53c2\u8003\u6807\u51c6\u4e3a\uff1a${lengthRequirement.source}\u3002`),
        });
      }
    }
  }

  if (params.config.checkFormatting && template.formatRules && ['.docx', '.doc'].includes(path.extname(version.filePath || '').toLowerCase())) {
    try {
      const formatResult: any = await extractDocxTemplateFormatRules(version.filePath);
      if (formatResult.success && formatResult.formatRules) {
        issues.push(...compareTemplateFormatRules(template.formatRules, formatResult.formatRules, formatResult.paragraphs || []));
      }
    } catch (error) {
      console.warn('Format review failed:', error);
    }
  }

  // 计算得分：范文模板不因标题不一致扣分，但格式规则一旦配置/识别出来就是硬性要求。
  const requiredNodes = isExampleTemplate ? [] : allTemplateNodes.filter(n => n.isRequired);
  const missingCount = issues.filter(i => i.type === 'missing_section').length;
  const formatErrorCount = issues.filter(i => i.type === 'wrong_format' && i.severity === 'error').length;
  const formatWarningCount = issues.filter(i => i.type === 'wrong_format' && i.severity === 'warning').length;
  const contentWarningCount = issues.filter(i => i.type === 'content_deviation').length;
  const structureScore = requiredNodes.length > 0
    ? Math.round(((requiredNodes.length - missingCount) / requiredNodes.length) * 100)
    : 100;
  const score = Math.max(0, structureScore - formatErrorCount * 8 - formatWarningCount * 4 - contentWarningCount * 2);

  // 生成总结
  let summary = '';
  if (issues.length === 0) {
    summary = isExampleTemplate ? '文档可按范文模板继续优化；范文标题仅作写作方向参考，格式规则仍按硬性要求审查。' : '文档结构完整，符合模板要求。';
  } else {
    const advisoryCount = isExampleTemplate ? issues.filter(i => i.type === 'content_deviation').length : 0;
    const formatCount = formatErrorCount + formatWarningCount;
    summary = isExampleTemplate
      ? `发现 ${issues.length} 个问题，其中 ${formatCount} 个格式硬性问题，${advisoryCount} 个内容参考建议；范文标题未按固定标题判缺失。`
      : `发现 ${issues.length} 个问题，其中 ${missingCount} 个必需章节缺失，${formatCount} 个格式问题。`;
  }

  let aiSuggestions: string | undefined;
  if (params.config.enableAI && getActiveAIModel(loadAIConfigFromDisk())) {
    try {
      const issueText = issues.length
        ? issues.map(issue => `- [${issue.severity}] ${issue.sectionTitle || ''}：${issue.message}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`).join('\n')
        : '当前未发现结构性问题。';
      const requiredOutline = allTemplateNodes
        .filter(node => !isExampleTemplate && node.isRequired)
        .map(node => `- ${node.title}${node.requirementText || node.description ? `：${node.requirementText || node.description}` : ''}`)
        .join('\n');
      const exampleDirections = isExampleTemplate
        ? allTemplateNodes.map(node => `- ${node.title}${node.description || node.exampleText ? `：${node.description || node.exampleText}` : ''}`).join('\n')
        : '';
      const analysisContext = isExampleTemplate && template.exampleAnalysis
        ? `\n范文分析摘要：\n${template.exampleAnalysis.slice(0, 2000)}\n`
        : '';
      const reviewPrompt = composePromptMain('review', {
        requiredOutline: isExampleTemplate
          ? `范文写作方向：\n${exampleDirections || '无'}`
          : `模板必需章节：\n${requiredOutline || '无'}`,
        analysisContext,
        issueText,
        content: content.slice(0, 6000),
      });
      aiSuggestions = params.usageRequestId
        ? await runWithAIUsageContext(params.usageRequestId, () => callDefaultAI(reviewPrompt))
        : await callDefaultAI(reviewPrompt);
    } catch (error) {
      console.warn('AI review suggestion failed:', error);
    }
  }

  const reviewResult: ReviewResult = {
    id: Date.now().toString(),
    projectId: version.projectId,
    versionId: params.versionId,
    templateId: params.templateId,
    issues,
    score,
    summary,
    aiSuggestions,
    createdAt: new Date().toISOString(),
  };

  // 保存审查结果
  const reviews = loadReviewsFromDisk();
  reviews.push(reviewResult);
  saveReviewsToDisk(reviews);

  return { success: true, result: reviewResult };
});

ipcMain.handle('review:loadAll', async () => {
  return loadReviewsFromDisk();
});

ipcMain.handle('review:delete', async (_event: any, reviewId: string) => {
  const reviews = loadReviewsFromDisk();
  const filtered = reviews.filter(r => r.id !== reviewId);
  saveReviewsToDisk(filtered);
});

// AI 配置操作
ipcMain.handle('ai:loadConfig', async () => {
  return loadAIConfigFromDisk();
});

ipcMain.handle('ai:saveConfig', async (_event: any, config: AIConfig) => {
  saveAIConfigToDisk(config);
});

// AI 调用
ipcMain.handle('ai:call', async (_event: any, prompt: string | { prompt: string; modelId?: string; modelIds?: string[]; mode?: 'single' | 'parallel'; config?: AIConfig; usageRequestId?: string }) => {
  try {
    if (typeof prompt === 'string') return await callConfiguredAI(prompt);
    const execute = async () => {
      if (prompt.config) {
        return callAIWithConfig(prompt.config, prompt.prompt, prompt.modelId, prompt.modelIds, prompt.mode);
      }
      return prompt.mode === 'parallel'
        ? callParallelAI(prompt.prompt, prompt.modelIds)
        : callDefaultAI(prompt.prompt, prompt.modelId);
    };
    return prompt.usageRequestId
      ? await runWithAIUsageContext(prompt.usageRequestId, execute)
      : await execute();
  } catch (error: any) {
    throw new Error(`AI 调用失败: ${error.message}`);
  }
});

ipcMain.handle('ai:usageStatistics', async () => getAIUsageStatistics());
ipcMain.handle('ai:usageForRequest', async (_event: any, requestId: string) => sumAIUsage(getAIUsageRecords(requestId)));


ipcMain.handle('ai:callParallelDetails', async (_event: any, params: { prompt: string; modelId?: string; modelIds?: string[]; config?: AIConfig }) => {
  try {
    return await callParallelAIDetails(params.prompt, params.modelIds, params.config, params.modelId);
  } catch (error: any) {
    throw new Error(`AI parallel details failed: ${error.message}`);
  }
});

// AI 生成摘要
ipcMain.handle('ai:generateSummary', async (_event: any, content: string) => {
  const prompt = composePromptMain('summary', {
    content: content.substring(0, 3000),
  });

  try {
    const summary = await callConfiguredAI(prompt);
    return { success: true, summary };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// AI 审查建议
ipcMain.handle('ai:reviewSuggestion', async (_event: any, params: { content: string; template: string }) => {
  const prompt = composePromptMain('review', {
    requiredOutline: params.template,
    analysisContext: '',
    issueText: '',
    content: params.content.substring(0, 3000),
  });

  try {
    const suggestions = await callConfiguredAI(prompt);
    return { success: true, suggestions };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 文件夹监听
ipcMain.handle('folder:startWatch', async (_event: any, params: { projectId: string; folderPath: string }) => {
  try {
    // 如果已经在监听，先停止
    if (folderWatchers.has(params.projectId)) {
      folderWatchers.get(params.projectId)?.close();
    }

    const watcher = fs.watch(params.folderPath, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;

      const ext = path.extname(filename).toLowerCase();
      const supportedExts = ['.docx', '.pdf', '.txt'];

      if (!supportedExts.includes(ext)) return;

      const filePath = path.join(params.folderPath, filename);

      // 检查文件是否存在（可能是删除操作）
      if (!fs.existsSync(filePath)) return;

      // 通知渲染进程有新文件
      if (mainWindow) {
        mainWindow.webContents.send('folder:fileDetected', {
          projectId: params.projectId,
          filePath,
          fileName: filename,
          fileType: ext.substring(1),
        });
      }
    });

    folderWatchers.set(params.projectId, watcher);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('folder:stopWatch', async (_event: any, projectId: string) => {
  try {
    if (folderWatchers.has(projectId)) {
      folderWatchers.get(projectId)?.close();
      folderWatchers.delete(projectId);
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('folder:listFiles', async (_event: any, folderPath: string) => {
  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error, files: [] };
    const files = fs.readdirSync(folderPath);
    const supportedExts = ['.docx', '.pdf', '.txt'];
    const filteredFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return supportedExts.includes(ext);
    });
    return { success: true, files: filteredFiles };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 获取文件夹完整内容（含元数据）— 异步 I/O 避免阻塞主进程
ipcMain.handle('folder:getContents', async (_event: any, folderPath: string) => {
  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error, items: [] };
    if (!fs.existsSync(folderPath)) return { success: true, items: [] };
    const entries = (await fs.promises.readdir(folderPath, { withFileTypes: true }))
      .filter(entry => entry.name !== RECYCLE_BIN_DIR_NAME);
    const items = await Promise.all(entries.map(async entry => {
      const fullPath = path.join(folderPath, entry.name);
      let size = 0;
      let modifiedAt = '';
      try {
        const stat = await fs.promises.stat(fullPath);
        size = entry.isDirectory() ? 0 : stat.size;
        modifiedAt = stat.mtime.toISOString();
      } catch {}
      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        ext: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        size,
        modifiedAt,
        path: fullPath,
      };
    }));
    // 目录在前，文件在后，各自按名称排序
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { success: true, items };
  } catch (error: any) {
    return { success: false, items: [], error: error.message };
  }
});

interface SearchedProjectFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

const normalizeFileSearchText = (value: string) =>
  String(value || '').trim().replace(/\s+/g, '').toLowerCase();

async function searchProjectFiles(
  folderPath: string,
  query: string,
  output: SearchedProjectFile[] = [],
  state = { visited: 0 },
): Promise<SearchedProjectFile[]> {
  if (!fs.existsSync(folderPath) || output.length >= 500) return output;
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  const needle = normalizeFileSearchText(query);

  for (const entry of entries) {
    if (state.visited >= 10000 || output.length >= 500) break;
    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredScanDirs.has(entry.name)) {
        await searchProjectFiles(fullPath, query, output, state);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    state.visited += 1;

    const ext = path.extname(entry.name).toLowerCase();
    const fileNameText = normalizeFileSearchText(entry.name);
    const extText = normalizeFileSearchText(ext.replace('.', ''));
    if (!fileNameText.includes(needle) && !extText.includes(needle)) continue;

    try {
      const stat = await fs.promises.stat(fullPath);
      output.push({
        name: entry.name,
        path: fullPath,
        ext,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {}
  }

  return output;
}

ipcMain.handle('folder:searchFiles', async (_event: any, params: { folderPath: string; query: string }) => {
  try {
    const { folderPath, query } = params;
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error, files: [] };
    const normalizedQuery = normalizeFileSearchText(query);
    if (!normalizedQuery) return { success: true, files: [] };
    const files = (await searchProjectFiles(folderPath, normalizedQuery))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { success: true, files };
  } catch (error: any) {
    return { success: false, files: [], error: error.message };
  }
});

interface ScannedStageFile {
  name: string;
  path: string;
  ext: string;
  size: number;
  createdAt: string;
  modifiedAt: string;
}

const stageScanExts = new Set(['.doc', '.docx', '.pdf', '.txt', '.ppt', '.pptx', '.xls', '.xlsx']);
const ignoredScanDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', RECYCLE_BIN_DIR_NAME]);

async function scanStageFiles(folderPath: string, output: ScannedStageFile[] = []): Promise<ScannedStageFile[]> {
  if (!fs.existsSync(folderPath)) return output;
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredScanDirs.has(entry.name)) await scanStageFiles(fullPath, output);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!stageScanExts.has(ext)) continue;

    try {
      const stat = await fs.promises.stat(fullPath);
      output.push({
        name: entry.name,
        path: fullPath,
        ext,
        size: stat.size,
        createdAt: (stat.birthtimeMs > 0 ? stat.birthtime : stat.ctime).toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {}
  }
  return output;
}

ipcMain.handle('folder:scanStageFiles', async (_event: any, folderPath: string) => {
  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error, files: [] };
    const files = (await scanStageFiles(folderPath))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { success: true, files };
  } catch (error: any) {
    return { success: false, files: [], error: error.message };
  }
});
// ---- workspace:scanProjectFiles ----
// 轻量扫描：只返回文件路径、大小、修改时间，不读内容，不识别阶段
ipcMain.handle('workspace:scanProjectFiles', async (_event: any, folderPath: string) => {
  const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '.projecthub-recycle-bin', '.projecthub-data']);
  const SKIP_PREFIXES = ['.', '~$', '.~'];
  const result: Array<{ path: string; size: number; modifiedAt: string }> = [];
  const MAX_FILES = 5000;

  const walk = async (dir: string) => {
    if (result.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (result.length >= MAX_FILES) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_PREFIXES.some(p => entry.name.startsWith(p))) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          result.push({
            path: fullPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch { /* skip unreadable files */ }
      }
    }
  };

  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error, files: [] };
    await walk(folderPath);
    return { success: true, files: result };
  } catch (error: any) {
    return { success: false, files: [], error: error.message };
  }
});

// ---- folder:getTreeStats ----
interface TreeFileEntry {
  name: string;
  path: string;
  relativePath: string;
  ext: string;
  size: number;
  modifiedAt: string;
}

interface TreeFolderEntry {
  name: string;
  path: string;
  relativePath: string;
}

interface TreeStatsResult {
  success: boolean;
  stats?: {
    fileCount: number;
    folderCount: number;
    totalSize: number;
    typeCount: Record<string, number>;
  };
  files?: TreeFileEntry[];
  folders?: TreeFolderEntry[];
  error?: string;
}

const TREE_STATS_MAX_FILES = 20000;
const TREE_STATS_MAX_FOLDERS = 5000;

async function collectTreeStats(
  rootPath: string,
  currentDir: string,
  files: TreeFileEntry[],
  folders: TreeFolderEntry[],
  typeCount: Record<string, number>,
  knownExts: Set<string>,
): Promise<{ fileCount: number; folderCount: number; totalSize: number }> {
  if (!fs.existsSync(currentDir)) return { fileCount: 0, folderCount: 0, totalSize: 0 };
  const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  let fileCount = 0;
  let folderCount = 0;
  let totalSize = 0;

  for (const entry of entries) {
    if (files.length >= TREE_STATS_MAX_FILES && folders.length >= TREE_STATS_MAX_FOLDERS) break;
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      if (ignoredScanDirs.has(entry.name)) continue;
      folderCount += 1;
      if (folders.length < TREE_STATS_MAX_FOLDERS) {
        folders.push({ name: entry.name, path: fullPath, relativePath });
      }
      const sub = await collectTreeStats(rootPath, fullPath, files, folders, typeCount, knownExts);
      fileCount += sub.fileCount;
      folderCount += sub.folderCount;
      totalSize += sub.totalSize;
      continue;
    }

    if (!entry.isFile()) continue;
    fileCount += 1;

    let size = 0;
    let modifiedAt = '';
    try {
      const stat = await fs.promises.stat(fullPath);
      size = stat.size;
      modifiedAt = stat.mtime.toISOString();
      totalSize += size;
    } catch {}

    const ext = path.extname(entry.name).toLowerCase();
    const typeKey = knownExts.has(ext) ? ext : '其他';
    typeCount[typeKey] = (typeCount[typeKey] || 0) + 1;

    if (files.length < TREE_STATS_MAX_FILES) {
      files.push({ name: entry.name, path: fullPath, relativePath, ext, size, modifiedAt });
    }
  }

  return { fileCount, folderCount, totalSize };
}

ipcMain.handle('folder:getTreeStats', async (_event: any, folderPath: string): Promise<TreeStatsResult> => {
  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error };
    if (!fs.existsSync(folderPath)) {
      return {
        success: true,
        stats: { fileCount: 0, folderCount: 0, totalSize: 0, typeCount: {} },
        files: [],
        folders: [],
      };
    }

    const knownExts = new Set(['.docx', '.doc', '.pdf', '.xlsx', '.xls', '.pptx', '.ppt', '.txt']);
    const typeCount: Record<string, number> = {};
    for (const ext of knownExts) typeCount[ext] = 0;
    typeCount['其他'] = 0;

    const files: TreeFileEntry[] = [];
    const folders: TreeFolderEntry[] = [];
    const { fileCount, folderCount, totalSize } = await collectTreeStats(
      folderPath, folderPath, files, folders, typeCount, knownExts,
    );

    files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return {
      success: true,
      stats: { fileCount, folderCount, totalSize, typeCount },
      files,
      folders,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 任务操作
ipcMain.handle('task:save', async (_event: any, task: TaskItem) => {
  const tasks = loadTasksFromDisk();
  const index = tasks.findIndex(t => t.id === task.id);
  if (index >= 0) {
    tasks[index] = task;
  } else {
    tasks.push(task);
  }
  saveTasksToDisk(tasks);
});

ipcMain.handle('task:loadAll', async () => {
  return loadTasksFromDisk();
});


ipcMain.handle('collaboration:startReceiver', async (_event: any, params?: { port?: number }) => {
  try {
    return await startCollaborationServer(params?.port || 39218);
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:stopReceiver', async () => stopCollaborationServer());

ipcMain.handle('collaboration:getStatus', async () => ({
  success: true,
  running: Boolean(collaborationServer),
  port: collaborationPort,
  addresses: getLanAddresses(),
  urls: collaborationServer ? getLanAddresses().map(address => `http://${address}:${collaborationPort}/tasks`) : [],
  peers: getCollaborationPeers(),
  friends: getCollaborationFriends(),
}));

ipcMain.handle('collaboration:sendTask', async (_event: any, params: { endpoint?: string; friendId?: string; task: TaskItem; projectName?: string; senderName?: string }) => {
  try {
    const endpoint = resolveCollaborationTarget(params).toString();
    const result = await postJsonToPeer(endpoint, {
      task: params.task,
      projectName: params.projectName || '',
      senderName: params.senderName || os.userInfo().username || APP_DISPLAY_NAME,
      sentAt: new Date().toISOString(),
    });
    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:listPeers', async () => ({
  success: true,
  peers: getCollaborationPeers(),
  friends: getCollaborationFriends(),
}));

ipcMain.handle('collaboration:addFriend', async (_event: any, peer: Partial<LanPeerRecord> & { source?: string; status?: string }) => {
  try {
    if (!peer?.id || !peer.host || !peer.port) throw new Error('Invalid peer');
    const friends = loadCollaborationFriendsFromDisk();
    const next: CollaborationFriend = {
      id: String(peer.id),
      name: String(peer.name || peer.deviceName || peer.host),
      deviceName: peer.deviceName ? String(peer.deviceName) : undefined,
      host: String(peer.host),
      port: Number(peer.port),
      source: (['lan', 'email', 'nickname', 'manual', 'invite'].includes(peer.source as string) ? peer.source : 'lan') as CollaborationFriend['source'],
      status: (['pending', 'accepted', 'blocked'].includes(peer.status as string) ? peer.status : 'accepted') as CollaborationFriend['status'],
      addedAt: new Date().toISOString(),
      lastSeenAt: peer.lastSeenAt ? String(peer.lastSeenAt) : new Date().toISOString(),
    };
    saveCollaborationFriendsToDisk([next, ...friends.filter(item => item.id !== next.id)]);
    emitCollaborationPeersChanged();
    return { success: true, friend: next, friends: getCollaborationFriends() };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:removeFriend', async (_event: any, friendId: string) => {
  const friends = loadCollaborationFriendsFromDisk().filter(item => item.id !== friendId);
  saveCollaborationFriendsToDisk(friends);
  emitCollaborationPeersChanged();
  return { success: true, friends: getCollaborationFriends() };
});

ipcMain.handle('collaboration:listFriends', async () => ({
  success: true,
  friends: getCollaborationFriends(),
}));

ipcMain.handle('collaboration:sendFile', async (_event: any, params: CollaborationFileSendParams) => {
  try {
    const result = await sendFileToPeer(params);
    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

// ─── 好友请求 ────────────────────────────────────────────

function loadFriendRequestsFromDisk(): CollaborationFriendRequest[] {
  try {
    if (!fs.existsSync(collaborationRequestsFile)) return [];
    return JSON.parse(fs.readFileSync(collaborationRequestsFile, 'utf-8'));
  } catch {
    return [];
  }
}

function saveFriendRequestsToDisk(requests: CollaborationFriendRequest[]) {
  fs.writeFileSync(collaborationRequestsFile, JSON.stringify(requests, null, 2), 'utf-8');
}

ipcMain.handle('collaboration:sendFriendRequest', async (_event: any, params: { targetId: string; targetHost: string; targetPort: number; message?: string }) => {
  try {
    const identity = getLocalCollaborationIdentity();
    const requests = loadFriendRequestsFromDisk();
    const existing = requests.find(r => r.fromId === identity.id && r.targetId === params.targetId && r.status === 'pending');
    if (existing) return { success: false, error: '已发送过好友请求，等待对方确认' };

    // 通过 HTTP 发送请求给目标
    const targetUrl = `http://${params.targetHost}:${params.targetPort}/friend-request`;
    const payload = {
      fromId: identity.id,
      fromName: identity.name,
      fromDeviceName: identity.deviceName,
      fromHost: getLanAddresses()[0] || '127.0.0.1',
      fromPort: collaborationPort,
      message: params.message || '',
    };
    try {
      await postJsonToPeer(targetUrl, payload);
    } catch {
      // 目标可能不在线，仍然记录请求
    }

    const request: CollaborationFriendRequest = {
      id: `req-${Date.now()}-${identity.id}`,
      fromId: identity.id,
      fromName: identity.name,
      fromDeviceName: identity.deviceName,
      fromHost: payload.fromHost,
      fromPort: payload.fromPort,
      targetId: params.targetId,
      message: params.message,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    saveFriendRequestsToDisk([request, ...requests]);
    return { success: true, request };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:listFriendRequests', async () => ({
  success: true,
  requests: loadFriendRequestsFromDisk(),
}));

ipcMain.handle('collaboration:acceptFriendRequest', async (_event: any, requestId: string) => {
  try {
    const requests = loadFriendRequestsFromDisk();
    const req = requests.find(r => r.id === requestId);
    if (!req) return { success: false, error: '请求不存在' };

    // 更新请求状态
    req.status = 'accepted';
    saveFriendRequestsToDisk(requests);

    // 自动添加为好友
    const friends = loadCollaborationFriendsFromDisk();
    const already = friends.some(f => f.id === req.fromId);
    if (!already) {
      const friend: CollaborationFriend = {
        id: req.fromId,
        name: req.fromName,
        deviceName: req.fromDeviceName,
        host: req.fromHost,
        port: req.fromPort,
        source: 'lan',
        status: 'accepted',
        addedAt: new Date().toISOString(),
      };
      saveCollaborationFriendsToDisk([friend, ...friends]);
    }
    emitCollaborationPeersChanged();
    return { success: true, friends: getCollaborationFriends() };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:rejectFriendRequest', async (_event: any, requestId: string) => {
  try {
    const requests = loadFriendRequestsFromDisk();
    const req = requests.find(r => r.id === requestId);
    if (!req) return { success: false, error: '请求不存在' };
    req.status = 'rejected';
    saveFriendRequestsToDisk(requests);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) };
  }
});

// 在 HTTP server 中添加好友请求路由
const originalCreateServer = createCollaborationHttpServer;

ipcMain.handle('task:delete', async (_event: any, taskId: string) => {
  const tasks = loadTasksFromDisk();
  const filtered = tasks.filter(t => t.id !== taskId);
  saveTasksToDisk(filtered);
});

// AI 执行任务
ipcMain.handle('task:executeAI', async (_event: any, params: { taskId: string; content: string; instruction: string; usageRequestId?: string }) => {
  const prompt = composePromptMain('taskExecute', {
    instruction: params.instruction,
    content: params.content.substring(0, 3000),
  });

  try {
    const usageRequestId = params.usageRequestId || `task:${params.taskId}:${Date.now()}`;
    const result = await runWithAIUsageContext(usageRequestId, () => callConfiguredAI(prompt));
    const usage = sumAIUsage(getAIUsageRecords(usageRequestId));

    // 更新任务状态
    const tasks = loadTasksFromDisk();
    const taskIndex = tasks.findIndex(t => t.id === params.taskId);
    if (taskIndex >= 0) {
      tasks[taskIndex].status = 'completed';
      tasks[taskIndex].result = result;
      saveTasksToDisk(tasks);
    }

    return { success: true, result, usage };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 设置操作
ipcMain.handle('settings:load', async () => {
  return loadSettingsFromDisk();
});

ipcMain.handle('settings:save', async (_event: any, settings: AppSettings) => {
  saveSettingsToDisk(settings);
});

// 获取工作区已用大小
ipcMain.handle('workspace:getSize', async (_event: any, workspacePath: string) => {
  try {
    const bytes = await getDirSize(workspacePath);
    return { success: true, bytes };
  } catch (error: any) {
    return { success: true, bytes: 0 };
  }
});

ipcMain.handle('workspace:listRecycleBin', async (_event: any, params: { workspacePath: string }) => {
  try {
    const workspaceRoot = getActiveWorkspaceRoot(params?.workspacePath);
    await cleanupRecycleBinForWorkspace(workspaceRoot);
    const allEntries = loadRecycleBinEntries(workspaceRoot);
    // 过滤掉实体文件已不存在的残留条目，并持久化清理
    const validEntries = allEntries.filter(entry => fs.existsSync(entry.recycledPath));
    if (validEntries.length !== allEntries.length) {
      saveRecycleBinEntries(workspaceRoot, validEntries);
    }
    const sorted = validEntries.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
    return { success: true, entries: sorted };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('workspace:restoreRecycleBinItem', async (_event: any, params: { workspacePath: string; id: string }) => {
  try {
    const workspaceRoot = getActiveWorkspaceRoot(params?.workspacePath);
    const entries = loadRecycleBinEntries(workspaceRoot);
    const entry = entries.find(item => item.id === params?.id);
    if (!entry) return { success: false, error: '回收站项目不存在' };
    if (!fs.existsSync(entry.recycledPath)) return { success: false, error: '回收站中的文件已不存在' };
    if (!isSameOrChildPath(entry.originalPath, workspaceRoot)) return { success: false, error: '原始路径不在当前工作区' };
    if (fs.existsSync(entry.originalPath)) return { success: false, error: '原位置已有同名文件或文件夹，请先处理冲突' };
    if (entry.isDirectory) await moveWorkspaceFolder(entry.recycledPath, entry.originalPath);
    else {
      await fs.promises.mkdir(path.dirname(entry.originalPath), { recursive: true });
      await fs.promises.rename(entry.recycledPath, entry.originalPath);
    }
    saveRecycleBinEntries(workspaceRoot, entries.filter(item => item.id !== entry.id));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('workspace:permanentlyDeleteRecycleBinItem', async (_event: any, params: { workspacePath: string; id: string }) => {
  try {
    const workspaceRoot = getActiveWorkspaceRoot(params?.workspacePath);
    const entries = loadRecycleBinEntries(workspaceRoot);
    const entry = entries.find(item => item.id === params?.id);
    if (!entry) return { success: false, error: '回收站项目不存在' };
    await removeRecycleBinEntryFile(entry);
    saveRecycleBinEntries(workspaceRoot, entries.filter(item => item.id !== entry.id));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('workspace:emptyRecycleBin', async (_event: any, params: { workspacePath: string }) => {
  try {
    const workspaceRoot = getActiveWorkspaceRoot(params?.workspacePath);
    const entries = loadRecycleBinEntries(workspaceRoot);
    await Promise.all(entries.map(removeRecycleBinEntryFile));
    saveRecycleBinEntries(workspaceRoot, []);
    return { success: true, removed: entries.length };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('workspace:cleanupRecycleBin', async (_event: any, params: { workspacePath: string }) => {
  try {
    const workspaceRoot = getActiveWorkspaceRoot(params?.workspacePath);
    return { success: true, removed: await cleanupRecycleBinForWorkspace(workspaceRoot) };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

// 工作区迁移：由主进程在切换设置前完成，避免新旧工作区的路径校验互相影响。
ipcMain.handle('workspace:listMigrationProjects', async (_event: any, params: { sourceWorkspacePath: string }) => {
  try {
    const sourceWorkspacePath = String(params?.sourceWorkspacePath || '').trim();
    const sourceRoot = sourceWorkspacePath ? path.resolve(sourceWorkspacePath) : '';
    const projects = loadProjectsFromDisk();
    const candidates = sourceRoot
      ? projects.filter(project => project.folderPath && isSameOrChildPath(project.folderPath, sourceRoot))
      : projects;
    return {
      success: true,
      projects: candidates.map(project => ({
        id: project.id,
        name: project.name,
        folderPath: project.folderPath,
        folderName: path.basename(project.folderPath || project.name),
        exists: Boolean(project.folderPath && fs.existsSync(project.folderPath)),
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('workspace:migrateProjects', async (_event: any, params: {
  sourceWorkspacePath: string;
  targetWorkspacePath: string;
  projectIds: string[];
}) => {
  try {
    const sourceWorkspacePath = String(params?.sourceWorkspacePath || '').trim();
    const targetWorkspacePath = String(params?.targetWorkspacePath || '').trim();
    if (!targetWorkspacePath) return { success: false, error: '请选择新的工作区路径' };

    const sourceRoot = sourceWorkspacePath ? path.resolve(sourceWorkspacePath) : '';
    const targetRoot = path.resolve(targetWorkspacePath);
    if (sourceRoot && sourceRoot.toLowerCase() === targetRoot.toLowerCase()) {
      return { success: false, error: '新旧工作区路径相同，无需迁移' };
    }

    const allProjects = loadProjectsFromDisk();
    const sourceProjects = sourceRoot
      ? allProjects.filter(project => project.folderPath && isSameOrChildPath(project.folderPath, sourceRoot))
      : allProjects;
    const selectedIds = new Set((params?.projectIds || []).map(String));
    const selectedProjects = sourceProjects.filter(project => selectedIds.has(project.id));

    if (selectedProjects.some(project => project.folderPath && isSameOrChildPath(targetRoot, project.folderPath))) {
      return { success: false, error: '新的工作区不能位于待迁移项目文件夹内部' };
    }

    await fs.promises.mkdir(targetRoot, { recursive: true });
    const migrated: Array<{ project: Project; folderPath: string }> = [];
    const failed: Array<{ id: string; name: string; error: string }> = [];

    for (const project of selectedProjects) {
      try {
        const sourceFolder = path.resolve(project.folderPath || '');
        if (!project.folderPath || !fs.existsSync(sourceFolder)) throw new Error('原项目文件夹不存在');
        const targetFolder = path.join(targetRoot, path.basename(sourceFolder));
        await moveWorkspaceFolder(sourceFolder, targetFolder);
        const watcher = folderWatchers.get(project.id);
        if (watcher) {
          watcher.close();
          folderWatchers.delete(project.id);
        }
        migrated.push({ project, folderPath: targetFolder });
      } catch (error: any) {
        failed.push({ id: project.id, name: project.name, error: error?.message || String(error) });
      }
    }

    const pathPairs = migrated.map(item => ({ source: path.resolve(item.project.folderPath), target: item.folderPath }));
    const migratedIds = new Set(migrated.map(item => item.project.id));
    const now = new Date().toISOString();
    const migratedProjects = migrated.map(({ project, folderPath }) => ({ ...project, folderPath, updatedAt: now }));

    // 迁移后仅保留成功迁移的项目及其关联记录；未勾选和失败项不会出现在新列表中。
    saveProjectsToDisk(migratedProjects);
    saveVersionsToDisk(loadVersionsFromDisk()
      .filter(version => migratedIds.has(version.projectId))
      .map(version => ({ ...version, filePath: remapMigratedPath(version.filePath, pathPairs) || version.filePath })));
    saveProjectDocsToDisk(loadProjectDocsFromDisk()
      .filter(doc => migratedIds.has(doc.projectId))
      .map(doc => ({ ...doc, sourceFilePath: remapMigratedPath(doc.sourceFilePath, pathPairs) })));
    saveTasksToDisk(loadTasksFromDisk().filter(task => migratedIds.has(task.projectId)));
    saveReviewsToDisk(loadReviewsFromDisk().filter(review => migratedIds.has(review.projectId)));
    saveStageMemoriesToDisk(loadStageMemoriesFromDisk()
      .filter(entry => migratedIds.has(entry.projectId))
      .map(entry => ({ ...entry, sourceFilePath: remapMigratedPath(entry.sourceFilePath, pathPairs) })));
    saveReferenceMaterialsToDisk(loadReferenceMaterialsFromDisk()
      .filter(material => migratedIds.has(material.projectId))
      .map(material => ({ ...material, filePath: remapMigratedPath(material.filePath, pathPairs) })));
    saveTemplatesToDisk(loadTemplatesFromDisk().map(template => ({
      ...template,
      filePath: remapMigratedPath(template.filePath, pathPairs),
    })));
    saveSettingsToDisk({ ...loadSettingsFromDisk(), workspacePath: targetRoot });

    return { success: true, migratedProjectIds: Array.from(migratedIds), failed };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
});

// ==================== 项目文档操作 ====================

ipcMain.handle('projectDoc:save', async (_event: any, doc: ProjectDocument) => {
  const docs = loadProjectDocsFromDisk();
  const index = docs.findIndex(d => d.id === doc.id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.push(doc);
  }
  saveProjectDocsToDisk(docs);
});

ipcMain.handle('projectDoc:loadAll', async () => {
  return loadProjectDocsFromDisk();
});

ipcMain.handle('projectDoc:delete', async (_event: any, docId: string) => {
  const docs = loadProjectDocsFromDisk();
  saveProjectDocsToDisk(docs.filter(d => d.id !== docId));
  removeStageMemoriesForDoc(docId);
});

// 项目文档分析
// Knowledge and reference materials
ipcMain.handle('knowledge:loadStageMemories', async () => loadStageMemoriesFromDisk());

ipcMain.handle('knowledge:saveStageMemory', async (_event: any, entry: StageMemoryEntry) => {
  const entries = loadStageMemoriesFromDisk();
  const index = entries.findIndex(item => item.id === entry.id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  saveStageMemoriesToDisk(entries);
  return entry;
});

ipcMain.handle('knowledge:deleteStageMemory', async (_event: any, memoryId: string) => {
  const entries = loadStageMemoriesFromDisk();
  saveStageMemoriesToDisk(entries.filter(item => item.id !== memoryId));
});

function removeStageMemoriesForDoc(docId?: string): number {
  if (!docId) return 0;
  const entries = loadStageMemoriesFromDisk();
  const nextEntries = entries.filter(item => item.docId !== docId);
  if (nextEntries.length !== entries.length) saveStageMemoriesToDisk(nextEntries);
  return entries.length - nextEntries.length;
}

ipcMain.handle('knowledge:deleteStageMemoriesForDoc', async (_event: any, docId: string) => {
  return { success: true, removed: removeStageMemoriesForDoc(docId) };
});

ipcMain.handle('knowledge:learnStageFinal', async (_event: any, params: {
  projectId: string;
  projectName: string;
  stageName: string;
  docId?: string;
  docName: string;
  sourceFilePath?: string;
  content?: string;
}) => {
  try {
    let content = clipKnowledgeText(params.content || '', 18000);
    if (!content && params.sourceFilePath) {
      const extracted = await extractKnowledgeTextFromFile(params.sourceFilePath);
      if (!extracted.success || !extracted.content) return { success: false, error: extracted.error || 'unable to extract text' };
      content = clipKnowledgeText(extracted.content, 18000);
    }
    if (!content) return { success: false, error: 'empty final document content' };
    const stageName = normalizeKnowledgeStageName(params.stageName);
    const prompt = composePromptMain('memory', {
      stageName,
      docName: params.docName,
      content,
    });
    const summary = await callConfiguredAI(prompt);
    const now = new Date().toISOString();
    const entries = loadStageMemoriesFromDisk();
    const existingIndex = params.docId
      ? entries.findIndex(item =>
          item.projectId === params.projectId &&
          normalizeKnowledgeStageName(item.stageName) === stageName &&
          item.docId === params.docId
        )
      : -1;
    const previous = existingIndex >= 0 ? entries[existingIndex] : undefined;
    const entry: StageMemoryEntry = {
      id: previous?.id || `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      projectId: params.projectId,
      projectName: params.projectName,
      stageName,
      docId: params.docId,
      docName: params.docName,
      sourceFilePath: params.sourceFilePath,
      summary: String(summary || '').trim(),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    if (existingIndex >= 0) entries[existingIndex] = entry;
    else entries.push(entry);
    saveStageMemoriesToDisk(entries);
    return { success: true, entry };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('knowledge:loadReferenceMaterials', async () => loadReferenceMaterialsFromDisk());

ipcMain.handle('knowledge:saveReferenceMaterial', async (_event: any, material: ReferenceMaterial) => saveReferenceMaterialUpsert(material));

ipcMain.handle('knowledge:deleteReferenceMaterial', async (_event: any, materialId: string) => {
  const materials = loadReferenceMaterialsFromDisk();
  saveReferenceMaterialsToDisk(materials.filter(item => item.id !== materialId));
});

ipcMain.handle('knowledge:importReferenceFiles', async (_event: any, params: { projectId: string; filePaths: string[]; source?: 'project-file' | 'external' }) => {
  try {
    const imported: ReferenceMaterial[] = [];
    for (const filePath of params.filePaths || []) {
      const extracted = await extractKnowledgeTextFromFile(filePath);
      const now = new Date().toISOString();
      const material: ReferenceMaterial = {
        id: `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        projectId: params.projectId,
        name: extracted.fileName || path.basename(filePath),
        filePath,
        source: params.source || 'external',
        contentPreview: extracted.success ? clipKnowledgeText(extracted.content || '', 6000) : '',
        summary: extracted.success ? undefined : extracted.error,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(saveReferenceMaterialUpsert(material));
    }
    return { success: true, materials: imported };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('projectDoc:analyze', async (_event: any, params: {
  content: string;
  template: WritingTemplate;
  useAI?: boolean;
  actualStructure?: boolean;
}) => {
  try {
    const { content, template, useAI, actualStructure } = params;

    // 报告工作台使用当前文档自身结构；模板匹配仍保留给审查等功能。
    const sections = actualStructure
      ? analyzeActualDocumentStructure(content)
      : analyzeBasic(content, template);

    // AI 深度分析
    if (useAI && !actualStructure) {
      if (getActiveAIModel(loadAIConfigFromDisk())) {
        const extracted = extractSections(content);
        const allTemplateNodes = flattenNodes(template.nodes, template);
        for (const section of sections) {
          if (section.status === 'missing') continue;
          const matched = extracted.find(e => matchHeading(e.title, section.title));
          if (!matched || matched.content.length < 10) continue;
          const templateNode = allTemplateNodes.find(node => node.id === section.nodeId);
          const requirement = templateNode?.description?.trim();

          const prompt = composePromptMain('sectionAnalysis', {
            sectionTitle: section.title,
            requirement: requirement ? `模板要求：\n${requirement}\n` : '',
            content: matched.content.substring(0, 1000),
          });

          try {
            const response = await callConfiguredAI(prompt);
            // 尝试解析 AI 回复
            const jsonMatch = response.match(/\{[^}]+\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.status) section.status = parsed.status;
              if (parsed.comment) section.aiComment = parsed.comment;
            }
          } catch {}
        }
      }
    }

    // 计算整体进度
    const total = sections.length;
    const completed = sections.filter(s => s.status === 'completed').length;
    const partial = sections.filter(s => s.status === 'partial').length;
    const overallProgress = total > 0
      ? Math.round(((completed + partial * 0.5) / total) * 100)
      : 0;

    return { success: true, sections, overallProgress };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 创建项目文件夹
ipcMain.handle('project:createFolder', async (_event: any, params: { projectName: string; workspacePath: string }) => {
  try {
    const { projectName, workspacePath } = params;

    // 确保工作区目录存在
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    // 生成文件夹名，处理重名
    let folderName = projectName;
    let folderPath = path.join(workspacePath, folderName);
    let counter = 1;
    while (fs.existsSync(folderPath)) {
      folderName = `${projectName}-${counter}`;
      folderPath = path.join(workspacePath, folderName);
      counter++;
    }

    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true, folderPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 列出目录下的子文件夹
ipcMain.handle('workspace:listFolders', async (_event: any, dirPath: string) => {
  try {
    if (!fs.existsSync(dirPath)) return { success: true, folders: [] };
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
    return { success: true, folders };
  } catch (error: any) {
    return { success: false, folders: [], error: error.message };
  }
});

// 移动文件夹
ipcMain.handle('workspace:moveFolder', async (_event: any, params: { src: string; dest: string }) => {
  try {
    const { src, dest } = params;
    const sc = checkWithinWorkspace(src);
    if (!sc.ok) return { success: false, error: sc.error };
    const dc = checkWithinWorkspace(dest);
    if (!dc.ok) return { success: false, error: dc.error };
    if (!fs.existsSync(src)) {
      return { success: false, error: '源文件夹不存在' };
    }
    // 确保目标父目录存在
    const destParent = path.dirname(dest);
    if (!fs.existsSync(destParent)) {
      fs.mkdirSync(destParent, { recursive: true });
    }
    fs.renameSync(src, dest);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 删除文件夹
ipcMain.handle('workspace:deleteFolder', async (_event: any, folderPath: string, options?: { permanent?: boolean }) => {
  try {
    const check = checkWithinWorkspace(folderPath);
    if (!check.ok) return { success: false, error: check.error };
    if (!fs.existsSync(folderPath)) return { success: true };
    let recycleEntry: RecycleBinEntry | undefined;
    if (options?.permanent) fs.rmSync(folderPath, { recursive: true, force: true });
    else recycleEntry = await movePathToRecycleBin(folderPath);
    return { success: true, recycleEntry };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 在当前目录创建普通文件夹
ipcMain.handle('file:createFolder', async (_event: any, params: { folderPath: string; folderName: string }) => {
  try {
    const parentPath = path.resolve(String(params.folderPath || '').trim());
    const parentCheck = checkParentWithinWorkspace(parentPath);
    if (!parentCheck.ok) return { success: false, error: parentCheck.error };
    const rawName = String(params.folderName || '').trim();
    const safeName = path.basename(rawName);
    if (!rawName) return { success: false, error: '文件夹名称不能为空' };
    if (safeName !== rawName || /[<>:"/\\|?*]/.test(rawName)) {
      return { success: false, error: '文件夹名称包含无效字符' };
    }
    if (/[. ]$/.test(rawName)) {
      return { success: false, error: '文件夹名称不能以点或空格结尾' };
    }
    if (!fs.existsSync(parentPath)) fs.mkdirSync(parentPath, { recursive: true });
    const folderPath = path.join(parentPath, safeName);
    if (fs.existsSync(folderPath)) return { success: false, error: '同名文件或文件夹已存在' };
    fs.mkdirSync(folderPath);
    return { success: true, folderPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
// 创建空白文件
ipcMain.handle('file:createBlank', async (_event: any, params: { folderPath: string; fileName: string; fileType: string }) => {
  try {
    const { folderPath, fileName, fileType } = params;
    const parentCheck = checkParentWithinWorkspace(folderPath);
    if (!parentCheck.ok) return { success: false, error: parentCheck.error };
    const nameCheck = checkSafeChildName(fileName);
    if (!nameCheck.ok) return { success: false, error: nameCheck.error };
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const normalizedType = normalizeFileType(fileType);
    const filePath = path.join(folderPath, `${fileName}.${normalizedType}`);
    if (!fs.existsSync(filePath)) {
      await createFileByType(filePath, normalizedType);
    }
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 根据模板和用户内容生成 Word 文档
ipcMain.handle('file:generateFromContent', async (_event: any, params: {
  template: WritingTemplate;
  sectionContents: Record<string, string>;
  folderPath: string;
  fileName: string;
}) => {
  try {
    const { template, sectionContents, folderPath, fileName } = params;
    const parentCheck = checkParentWithinWorkspace(folderPath);
    if (!parentCheck.ok) return { success: false, error: parentCheck.error };
    const nameCheck = checkSafeChildName(fileName);
    if (!nameCheck.ok) return { success: false, error: nameCheck.error };
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const fileType = template.outputFileType || 'docx';
    const filePath = path.join(folderPath, `${fileName}.${fileType}`);
    await writeDocxFileWithContent(filePath, template, sectionContents);
    return { success: true, filePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 从模板创建文件（直接复制模板源文件并重命名）
ipcMain.handle('file:createFromTemplate', async (_event: any, params: { folderPath: string; fileName: string; template: WritingTemplate; fileType?: string }) => {
  try {
    const { folderPath, fileName, template } = params;
    const parentCheck = checkParentWithinWorkspace(folderPath);
    if (!parentCheck.ok) return { success: false, error: parentCheck.error };
    const nameCheck = checkSafeChildName(fileName);
    if (!nameCheck.ok) return { success: false, error: nameCheck.error };
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const outputFileType = normalizeFileType(params.fileType || template.outputFileType || 'docx');
    const outputExt = `.${outputFileType}`;

    if (!template.filePath || !fs.existsSync(template.filePath)) {
      if (template.templateType !== 'example') {
        return { success: false, error: '直接套用模板的源文件不存在，请重新编辑模板并导入源文件' };
      }
      const destPath = path.join(folderPath, `${fileName}${outputExt}`);
      if (!fs.existsSync(destPath)) {
        await createFileByType(destPath, outputFileType, template);
      }
      return { success: true, filePath: destPath };
    }

    const sourceExt = path.extname(template.filePath).toLowerCase();
    if (template.templateType !== 'example') {
      // 直接套用模板必须原样复制，不能重新生成，否则会丢失源文档的排版、图片和页眉页脚。
      const directDestPath = path.join(folderPath, `${fileName}${sourceExt || outputExt}`);
      fs.copyFileSync(template.filePath, directDestPath, fs.constants.COPYFILE_EXCL);
      return { success: true, filePath: directDestPath };
    }

    const destPath = path.join(folderPath, `${fileName}${outputExt}`);
    if (sourceExt === outputExt.toLowerCase() && outputFileType !== 'docx') {
      fs.copyFileSync(template.filePath, destPath, fs.constants.COPYFILE_EXCL);
    } else {
      await createFileByType(destPath, outputFileType, template);
    }

    return { success: true, filePath: destPath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// ========== ZIP 导入导出 ==========

// 递归添加文件夹到zip
function addFolderToZip(zip: any, folderPath: string, basePath: string) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      addFolderToZip(zip, fullPath, basePath);
    } else {
      const content = fs.readFileSync(fullPath);
      zip.file(relativePath, content);
    }
  }
}

function escapeXml(value: string = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeFileType(fileType?: string): string {
  return (fileType || 'docx').replace(/^\./, '').toLowerCase();
}

function styleRuleFromTemplate(template?: WritingTemplate, key: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body' = 'body') {
  const fallbackTitle = template?.titleFontRequirement || {};
  const fallbackBody = template?.bodyFontRequirement || {};
  const isHeading = key.startsWith('heading');
  return template?.formatRules?.[key] || {
    fontRequirement: isHeading ? fallbackTitle : fallbackBody,
    paragraphRequirement: {},
  };
}

function fontSizeToHalfPoints(size?: number, fallback = 12): number {
  return Math.round((size || fallback) * 2);
}

function pointsToTwips(value?: number): number {
  return Math.round((value || 0) * 20);
}

function lineHeightToWordLine(value?: number): number {
  return Math.round((value || 1.5) * 240);
}

function flattenTemplateNodes(nodes: TemplateNode[], output: TemplateNode[] = []): TemplateNode[] {
  for (const node of nodes || []) {
    output.push(node);
    if (node.children?.length) flattenTemplateNodes(node.children, output);
  }
  return output;
}

function buildWordStyle(styleId: string, name: string, rule: ReturnType<typeof styleRuleFromTemplate>, defaults: { font: string; size: number; bold?: boolean }) {
  const font = rule.fontRequirement || {};
  const paragraph = rule.paragraphRequirement || {};
  const fontFamily = escapeXml(font.fontFamily || defaults.font);
  const size = fontSizeToHalfPoints(font.fontSize, defaults.size);
  const color = (font.color || '#000000').replace('#', '');
  const bold = font.fontWeight === 'bold' || defaults.bold;
  const italic = font.fontStyle === 'italic';
  const spacing = font.letterSpacing ? `<w:spacing w:val="${pointsToTwips(font.letterSpacing)}"/>` : '';
  const align = paragraph.alignment ? `<w:jc w:val="${paragraph.alignment}"/>` : '';
  const firstLine = paragraph.indentFirstLine ? `<w:ind w:firstLineChars="${Math.round(paragraph.indentFirstLine * 100)}"/>` : '';

  return `
    <w:style w:type="paragraph" w:styleId="${styleId}">
      <w:name w:val="${escapeXml(name)}"/>
      <w:qFormat/>
      <w:pPr>
        ${align}
        ${firstLine}
        <w:spacing w:before="${pointsToTwips(paragraph.spaceBefore)}" w:after="${pointsToTwips(paragraph.spaceAfter)}" w:line="${lineHeightToWordLine(font.lineHeight)}" w:lineRule="auto"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}" w:eastAsia="${fontFamily}"/>
        ${bold ? '<w:b/><w:bCs/>' : ''}
        ${italic ? '<w:i/><w:iCs/>' : ''}
        ${spacing}
        <w:color w:val="${color}"/>
        <w:sz w:val="${size}"/>
        <w:szCs w:val="${size}"/>
      </w:rPr>
    </w:style>`;
}

function buildWordStylesXml(template?: WritingTemplate): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  ${buildWordStyle('Normal', '正文', styleRuleFromTemplate(template, 'body'), { font: '宋体', size: 12 })}
  ${buildWordStyle('Heading1', '标题 1', styleRuleFromTemplate(template, 'heading1'), { font: '黑体', size: 16, bold: true })}
  ${buildWordStyle('Heading2', '标题 2', styleRuleFromTemplate(template, 'heading2'), { font: '黑体', size: 15, bold: true })}
  ${buildWordStyle('Heading3', '标题 3', styleRuleFromTemplate(template, 'heading3'), { font: '黑体', size: 14, bold: true })}
  ${buildWordStyle('Heading4', '标题 4', styleRuleFromTemplate(template, 'heading4'), { font: '黑体', size: 12, bold: true })}
</w:styles>`;
}

// 带用户内容的 Word XML 生成
function buildWordDocumentXmlWithContent(template: WritingTemplate, sectionContents: Record<string, string>): string {
  const nodes = flattenTemplateNodes(template.nodes || []);
  const paragraphs = nodes.length > 0
    ? nodes.map(node => {
      const level = Math.min(Math.max(node.level || 1, 1), 4);
      const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${escapeXml(node.title)}</w:t></w:r></w:p>`;
      const userContent = sectionContents[node.id] || '';
      if (!userContent) return headingXml;
      const bodyParagraphs = userContent.split('\n').filter(line => line.trim()).map(line =>
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapeXml(line.trim())}</w:t></w:r></w:p>`
      ).join('');
      return headingXml + bodyParagraphs;
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>新建文档</w:t></w:r></w:p>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

// 带用户内容的 docx 写入
async function writeDocxFileWithContent(filePath: string, template: WritingTemplate, sectionContents: Record<string, string>) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  zip.file('[Content_Types].xml', contentTypes);

  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.folder('word')?.file('document.xml', buildWordDocumentXmlWithContent(template, sectionContents));
  zip.folder('word')?.file('styles.xml', buildWordStylesXml(template));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

function buildWordDocumentXml(template?: WritingTemplate): string {
  const nodes = flattenTemplateNodes(template?.nodes || []);
  const paragraphs = nodes.length > 0
    ? nodes.map(node => {
      const level = Math.min(Math.max(node.level || 1, 1), 4);
      const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${escapeXml(node.title)}</w:t></w:r></w:p>`;
      // 输出节点的描述/原始内容作为正文段落
      const bodyText = node.description || node.requirementText || '';
      if (!bodyText) return headingXml;
      const bodyParagraphs = bodyText.split('\n').filter(line => line.trim()).map(line =>
        `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapeXml(line.trim())}</w:t></w:r></w:p>`
      ).join('');
      return headingXml + bodyParagraphs;
    }).join('')
    : '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>新建文档</w:t></w:r></w:p>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t></w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

async function writeDocxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word')?.file('document.xml', buildWordDocumentXml(template));
  zip.folder('word')?.file('styles.xml', buildWordStylesXml(template));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

async function writePptxFile(filePath: string, template?: WritingTemplate) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.folder('ppt')?.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>`);
  zip.folder('ppt')?.folder('_rels')?.file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  const title = escapeXml(template?.name || '新建演示文稿');
  zip.folder('ppt')?.folder('slides')?.file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

async function writeXlsxFile(filePath: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.folder('xl')?.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, buffer);
}

function writeRtfCompatibleFile(filePath: string) {
  fs.writeFileSync(filePath, '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0 SimSun;}}\\f0\\fs24\\par}', 'utf-8');
}

function writePdfFile(filePath: string) {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000208 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
257
%%EOF`;
  fs.writeFileSync(filePath, pdf, 'utf-8');
}

async function createFileByType(filePath: string, fileType: string, template?: WritingTemplate) {
  const normalized = normalizeFileType(fileType);
  if (normalized === 'docx') {
    await writeDocxFile(filePath, template);
    return;
  }
  if (normalized === 'pptx') {
    await writePptxFile(filePath, template);
    return;
  }
  if (normalized === 'xlsx') {
    await writeXlsxFile(filePath);
    return;
  }
  if (normalized === 'doc' || normalized === 'rtf') {
    writeRtfCompatibleFile(filePath);
    return;
  }
  if (normalized === 'pdf') {
    writePdfFile(filePath);
    return;
  }
  fs.writeFileSync(filePath, '', 'utf-8');
}

// 打开ZIP文件对话框
ipcMain.handle('dialog:openZip', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: '选择 ZIP 文件',
    filters: [
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// 保存ZIP文件对话框
ipcMain.handle('dialog:saveZip', async (_event: any, projectName: string) => {
  const defaultName = projectName ? `${projectName}.zip` : 'project-export.zip';
  const result = await dialog.showSaveDialog({
    title: '导出项目为 ZIP',
    defaultPath: defaultName,
    filters: [
      { name: 'ZIP 压缩包', extensions: ['zip'] },
    ],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePath;
});

// 从ZIP导入项目
ipcMain.handle('project:importFromZip', async (_event: any, params: { zipPath: string; workspacePath: string }) => {
  try {
    const { zipPath, workspacePath } = params;
    const wsCheck = checkWithinWorkspace(workspacePath);
    if (!wsCheck.ok) return { success: false, error: wsCheck.error };

    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'ZIP 文件不存在' };
    }

    const buffer = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);

    // 确定项目文件夹名（取ZIP文件名，去掉.zip后缀）
    const zipBaseName = path.basename(zipPath, '.zip');
    let projectFolderName = zipBaseName;

    // 检查是否只有一个顶级目录
    const rootEntries: string[] = [];
    zip.forEach((relativePath: string) => {
      const parts = relativePath.split('/');
      if (parts.length > 1 && parts[0]) {
        rootEntries.push(parts[0]);
      }
    });
    const uniqueRoots = [...new Set(rootEntries)];
    if (uniqueRoots.length === 1) {
      // 只有一个顶级目录，用它作为文件夹名 — 但必须是安全的 basename
      const rootName = uniqueRoots[0];
      const nameCheck = checkSafeChildName(rootName);
      if (nameCheck.ok) {
        projectFolderName = rootName;
      }
      // 如果不安全，回退到 zipBaseName（已由 path.basename 保证）
    }

    // 在workspace中创建项目文件夹
    let folderPath = path.join(workspacePath, projectFolderName);
    if (fs.existsSync(folderPath)) {
      // 文件夹已存在，加后缀
      let i = 1;
      while (fs.existsSync(path.join(workspacePath, `${projectFolderName}-${i}`))) {
        i++;
      }
      projectFolderName = `${projectFolderName}-${i}`;
      folderPath = path.join(workspacePath, projectFolderName);
    }
    fs.mkdirSync(folderPath, { recursive: true });

    // 提取project.json（如果存在）
    let metadata: any = null;
    const projectJsonEntry = zip.file('project.json');
    if (projectJsonEntry) {
      const content = await projectJsonEntry.async('string');
      metadata = JSON.parse(content);
    }

    // 解压文件到项目文件夹（跳过project.json）
    let hasFiles = false;
    const filesToExtract: { path: string; data: any }[] = [];
    zip.forEach((relativePath: string, zipEntry: any) => {
      if (zipEntry.dir || relativePath === 'project.json') return;

      // 去掉顶级目录前缀（如果有）
      let cleanPath = relativePath;
      if (uniqueRoots.length === 1 && cleanPath.startsWith(uniqueRoots[0] + '/')) {
        cleanPath = cleanPath.substring(uniqueRoots[0].length + 1);
      }
      if (!cleanPath) return;

      filesToExtract.push({ path: cleanPath, data: zipEntry });
    });

    const resolvedFolder = path.resolve(folderPath);
    for (const file of filesToExtract) {
      // Zip Slip 防护：显式拒绝 ../ 和绝对路径
      if (file.path.includes('..') || path.isAbsolute(file.path)) {
        return { success: false, error: `ZIP 条目包含不安全路径: ${file.path}` };
      }
      const fullPath = path.resolve(folderPath, file.path);
      const slipCheck = checkPathInside(fullPath, resolvedFolder);
      if (!slipCheck.ok) return { success: false, error: `ZIP 条目 "${file.path}" ${slipCheck.error}` };
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = await file.data.async('nodebuffer');
      fs.writeFileSync(fullPath, content);
      hasFiles = true;
    }

    if (!hasFiles && !metadata) {
      return { success: false, error: 'ZIP 文件为空，未找到任何项目文件' };
    }

    // 构建项目记录
    let project: any;
    if (metadata && metadata.project) {
      project = {
        ...metadata.project,
        id: Date.now().toString(),
        folderPath,
        updatedAt: new Date().toISOString(),
      };
    } else {
      project = {
        id: Date.now().toString(),
        name: projectFolderName,
        description: '',
        folderPath,
        status: 'active',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 保存项目
    const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8')) as any[];
    projects.push(project);
    fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));

    // 如果有文档记录，也保存
    if (metadata && metadata.documents && Array.isArray(metadata.documents)) {
      const docs = JSON.parse(fs.readFileSync(projectDocsFile, 'utf-8')) as any[];
      for (const doc of metadata.documents) {
        docs.push({
          ...doc,
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          projectId: project.id,
          sourceFilePath: '', // 路径在不同机器上可能不同
        });
      }
      fs.writeFileSync(projectDocsFile, JSON.stringify(docs, null, 2));
    }

    return { success: true, project };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 列出ZIP中的文件
ipcMain.handle('zip:listFiles', async (_event: any, zipPath: string) => {
  try {
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'ZIP 文件不存在' };
    }
    const buffer = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);
    const files: { name: string; path: string; size: number; isDirectory: boolean }[] = [];
    zip.forEach((relativePath: string, zipEntry: any) => {
      if (zipEntry.dir) return;
      files.push({
        name: path.basename(relativePath),
        path: relativePath,
        size: zipEntry._data?.uncompressedSize || 0,
        isDirectory: false,
      });
    });
    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 从ZIP中提取指定文件到目标文件夹
ipcMain.handle('zip:extractFiles', async (_event: any, params: { zipPath: string; targetPath: string; filePaths: string[] }) => {
  try {
    const { zipPath, targetPath, filePaths } = params;
    const targetCheck = checkWithinWorkspace(targetPath);
    if (!targetCheck.ok) return { success: false, error: targetCheck.error };
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'ZIP 文件不存在' };
    }
    const buffer = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);
    const resolvedTarget = path.resolve(targetPath);
    const extracted: string[] = [];
    for (const filePath of filePaths) {
      const zipEntry = zip.file(filePath);
      if (!zipEntry) continue;
      // Zip Slip 防护：用 path.resolve 而非 path.basename，显式拒绝 ../
      const fullPath = path.resolve(targetPath, filePath);
      const slipCheck = checkPathInside(fullPath, resolvedTarget);
      if (!slipCheck.ok) return { success: false, error: `ZIP 条目 "${filePath}" ${slipCheck.error}` };
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = await zipEntry.async('nodebuffer');
      fs.writeFileSync(fullPath, content);
      extracted.push(path.basename(filePath));
    }
    return { success: true, files: extracted };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 导出项目为ZIP
ipcMain.handle('project:exportZip', async (_event: any, params: { project: any; savePath: string; projectDocs: any[] }) => {
  try {
    const { project, savePath, projectDocs } = params;

    if (!project.folderPath || !fs.existsSync(project.folderPath)) {
      return { success: false, error: '项目文件夹不存在' };
    }

    const zip = new JSZip();

    // 添加项目文件
    addFolderToZip(zip, project.folderPath, project.folderPath);

    // 添加project.json元数据
    const metadata = {
      version: 1,
      project,
      documents: projectDocs,
    };
    zip.file('project.json', JSON.stringify(metadata, null, 2));

    // 生成ZIP并写入文件
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(savePath, buffer);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  ensureWindowsNotificationShortcut();
  createWindow();
  startCollaborationServer().catch(() => {});

  // 启动后自动清理回收站过期条目
  try {
    const settings = loadSettingsFromDisk();
    if (settings.workspacePath) {
      cleanupRecycleBinForWorkspace(settings.workspacePath).catch((err) => {
        console.warn('[RecycleBin] Startup cleanup failed:', err);
      });
    }
  } catch {}

  // 每 12 小时自动清理回收站
  setInterval(() => {
    try {
      const settings = loadSettingsFromDisk();
      if (settings.workspacePath) {
        cleanupRecycleBinForWorkspace(settings.workspacePath).catch((err) => {
          console.warn('[RecycleBin] Periodic cleanup failed:', err);
        });
      }
    } catch {}
  }, 12 * 60 * 60 * 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
