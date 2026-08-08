import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Empty, Input, Progress, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, FolderOpenOutlined, FolderOutlined, LeftOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useProjectPickerStore, ProjectPickerFile } from '../../stores/projectPickerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { detectTimelineStage, getAllStages } from '../../utils/timelineStages';
import type { Project } from '../../../shared/types';

const { Text } = Typography;

type DirectoryEntry = { name: string; path: string; isDirectory: boolean; modifiedAt?: string; size?: number };

const ProjectSwitcherCard = memo<{ project: Project; selected: boolean; docCount: number; onSelect: (project: Project) => void }>(({ project, selected, docCount, onSelect }) => {
  return <button type="button" className={`project-switcher-card is-visible${selected ? ' is-selected' : ''}`} onClick={() => onSelect(project)}>
    <span className="project-switcher-icon"><FolderOpenOutlined /></span>
    <span className="project-switcher-copy"><Text strong ellipsis>{project.name}</Text><Text type="secondary" ellipsis>{docCount} 个已关联文档 · {project.status === 'completed' ? '已完成' : '进行中'}</Text><Progress percent={project.progress || 0} showInfo={false} size="small" /></span>
    {selected && <CheckOutlined className="project-switcher-check" />}
  </button>;
});

interface ProjectQuickDrawerProps {
  onOpenProjectFiles: (project: Project) => void;
}

const ProjectQuickDrawer: React.FC<ProjectQuickDrawerProps> = ({ onOpenProjectFiles }) => {
  const projects = useProjectStore(state => state.projects);
  const currentProject = useProjectStore(state => state.currentProject);
  const projectDocs = useProjectDocStore(state => state.projectDocs);
  const customStages = useSettingsStore(state => state.customStages);
  const { open, mode, projectId, title, selectedPaths, searchQuery: initialSearchQuery, stageName, close, confirmFiles } = useProjectPickerStore();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerWidth, setDrawerWidth] = useState(390);
  const requestIdRef = useRef(0);
  const resizingRef = useRef(false);
  const drawerWrapperRef = useRef<HTMLElement | null>(null);
  const pendingDrawerWidthRef = useRef(drawerWidth);
  const resizeFrameRef = useRef<number | null>(null);

  const targetProject = useMemo(() => projects.find(project => project.id === projectId) || currentProject, [projects, projectId, currentProject]);
  const allStages = useMemo(() => getAllStages(customStages), [customStages]);
  const currentPath = pathStack[pathStack.length - 1] || targetProject?.folderPath || '';

  const loadEntries = useCallback(async (folderPath: string, query = '') => {
    if (!folderPath) { setEntries([]); return; }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      // A stage scope must use stage recognition, not a literal stage-name
      // search: a stage may have several keywords and a filename only needs
      // to match one of them. Scan the project root so nested files are not
      // lost, then apply the exact same recognizer used by stage documents.
      let nextEntries: DirectoryEntry[] = [];
      if (stageName && targetProject?.folderPath) {
        const result = await window.electronAPI.scanStageFiles(targetProject.folderPath);
        nextEntries = result?.success
          ? (result.files || [])
            .filter(file => detectTimelineStage(allStages, file.name, file.path) === stageName)
            .filter(file => !query.trim() || `${file.name} ${file.path}`.toLowerCase().includes(query.trim().toLowerCase()))
            .map(file => ({ ...file, isDirectory: false }))
          : [];
      } else if (query.trim()) {
        const result = await window.electronAPI.searchProjectFiles({ folderPath, query });
        nextEntries = result?.success ? (result.files || []).map(file => ({ ...file, isDirectory: false })) : [];
      } else {
        const result = await window.electronAPI.listDirectoryEntries?.(folderPath);
        nextEntries = result?.success ? result.entries || [] : [];
      }
      if (requestId !== requestIdRef.current) return;
      setEntries(nextEntries);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [allStages, stageName, targetProject?.folderPath]);

  useEffect(() => {
    if (!open || mode !== 'files') return;
    const root = targetProject?.folderPath || '';
    setPathStack(root ? [root] : []);
    setPicked(new Set(selectedPaths));
    setSearchQuery(initialSearchQuery);
  }, [open, mode, targetProject?.id, initialSearchQuery, selectedPaths, stageName]);

  useEffect(() => {
    if (!open || mode !== 'files' || !currentPath) return;
    void loadEntries(currentPath, searchQuery);
  }, [open, mode, currentPath, searchQuery, loadEntries]);

  useEffect(() => {
    const clampWidth = (width: number) => Math.min(Math.max(width, 390), window.innerWidth);
    const applyPendingWidth = () => {
      resizeFrameRef.current = null;
      drawerWrapperRef.current?.style.setProperty('width', `${pendingDrawerWidthRef.current}px`);
    };
    const handleMove = (event: MouseEvent) => {
      if (!resizingRef.current) return;
      pendingDrawerWidthRef.current = clampWidth(event.clientX);
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = window.requestAnimationFrame(applyPendingWidth);
      }
    };
    const handleUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
        applyPendingWidth();
      }
      setDrawerWidth(pendingDrawerWidthRef.current);
      drawerWrapperRef.current = null;
    };
    const handleResize = () => setDrawerWidth(previous => clampWidth(previous));
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('resize', handleResize);
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, []);

  const chooseProject = useCallback((project: typeof projects[number]) => {
    setDrawerWidth(390);
    close();
    onOpenProjectFiles(project);
  }, [close, onOpenProjectFiles]);

  const projectDocCounts = useMemo(() => {
    const counts = new Map<string, number>();
    projectDocs.forEach(doc => counts.set(doc.projectId, (counts.get(doc.projectId) || 0) + 1));
    return counts;
  }, [projectDocs]);
  const fileEntries = entries.filter(entry => !entry.isDirectory);
  const folderEntries = (searchQuery.trim() || stageName) ? [] : entries.filter(entry => entry.isDirectory);

  const toggleFile = (entry: DirectoryEntry) => setPicked(previous => {
    const next = new Set(previous);
    if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
    return next;
  });

  const finishSelection = () => {
    const files: ProjectPickerFile[] = fileEntries
      .filter(entry => picked.has(entry.path))
      .map(entry => ({ path: entry.path, name: entry.name }));
    // Preserve selections from an already visited sibling folder as well.
    const known = new Map(files.map(file => [file.path, file]));
    picked.forEach(path => { if (!known.has(path)) known.set(path, { path, name: path.split(/[\\/]/).pop() || path }); });
    confirmFiles([...known.values()]);
  };

  return (
    <Drawer
      open={open}
      forceRender
      onClose={close}
      placement="left"
      width={drawerWidth}
      mask={false}
      closable={false}
      className="project-quick-drawer"
      styles={{ body: { padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      <div
        className="project-drawer-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整列表窗宽度"
        onMouseDown={event => {
          event.preventDefault();
          drawerWrapperRef.current = event.currentTarget.closest('.ant-drawer-content-wrapper') as HTMLElement | null;
          pendingDrawerWidthRef.current = drawerWrapperRef.current?.getBoundingClientRect().width || drawerWidth;
          resizingRef.current = true;
        }}
      />
      {mode === 'switch' ? <>
        <div className="project-drawer-heading"><div><Text strong>项目列表</Text><Text type="secondary">选择项目后直接进入文件详情</Text></div><Button className="project-drawer-close" type="text" icon={<CloseOutlined />} onClick={close}>关闭</Button></div>
        <div className="project-switcher-list">
          {projects.map(project => {
            const selected = project.id === currentProject?.id;
            const docCount = projectDocCounts.get(project.id) || 0;
            return <ProjectSwitcherCard key={project.id} project={project} selected={selected} docCount={docCount} onSelect={chooseProject} />;
          })}
          {!projects.length && <Empty description="暂无项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </div>
      </> : <>
        <div className="project-drawer-heading"><div><Text strong>{title}</Text><Text type="secondary" ellipsis>{targetProject?.name || '未选择项目'} · 项目根目录</Text></div><Button className="project-drawer-close" type="text" icon={<CloseOutlined />} onClick={close}>关闭</Button></div>
        <div className="project-picker-path"><FolderOpenOutlined /> <Text ellipsis>{currentPath || '项目根目录不可用'}</Text></div>
        <Input
          className="project-picker-search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索文件名 / 后缀"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
        />
        {stageName && <Tag className="project-picker-search-tag" color="blue">已按阶段识别筛选：{stageName}</Tag>}
        {searchQuery.trim() && <Tag className="project-picker-search-tag" color="blue">文件详情搜索：{searchQuery.trim()}</Tag>}
        <Space size={6} className="project-picker-actions">
          <Button size="small" icon={<LeftOutlined />} disabled={pathStack.length <= 1} onClick={() => {
            const next = pathStack.slice(0, -1);
            setPathStack(next);
            void loadEntries(next[next.length - 1] || '', searchQuery);
          }}>上一级</Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadEntries(currentPath, searchQuery)}>刷新</Button>
          <Text type="secondary">已选 {picked.size} 项</Text>
        </Space>
        <div className="project-picker-list">
          {loading ? <div className="project-picker-loading"><Spin size="small" /> 正在读取目录…</div> : <>
            {folderEntries.map(entry => <button key={entry.path} type="button" className="project-picker-entry is-folder" onClick={() => { const next = [...pathStack, entry.path]; setPathStack(next); void loadEntries(entry.path); }}><FolderOutlined /><Tooltip title={entry.name} mouseEnterDelay={0.35}><Text ellipsis>{entry.name}</Text></Tooltip><span>进入</span></button>)}
            {fileEntries.map(entry => <button key={entry.path} type="button" className={`project-picker-entry${picked.has(entry.path) ? ' is-picked' : ''}`} onClick={() => toggleFile(entry)}><span className="project-picker-check">{picked.has(entry.path) && <CheckOutlined />}</span><Tooltip title={entry.name} mouseEnterDelay={0.35}><Text ellipsis>{entry.name}</Text></Tooltip><span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleDateString() : ''}</span></button>)}
            {!entries.length && <Empty description={searchQuery.trim() ? '没有匹配的项目文件' : '该目录暂无可选择的文件'} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </>}
        </div>
        <Button className="project-picker-confirm" type="primary" disabled={!picked.size} onClick={finishSelection}>添加已选资料 ({picked.size})</Button>
      </>}
    </Drawer>
  );
};

export default ProjectQuickDrawer;
