import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Input, Typography, Space, Tag } from 'antd';
import {
  SearchOutlined, ProjectOutlined, FileTextOutlined,
  CheckCircleOutlined, CalendarOutlined, TeamOutlined,
  ExperimentOutlined, SettingOutlined, DeleteOutlined,
  ReloadOutlined, BookOutlined, FolderOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useKnowledgeStore } from '../../stores/knowledgeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { WorkbenchPage } from '../../../shared/types';

const { Text } = Typography;

interface CommandItem {
  id: string;
  type: 'project' | 'file' | 'task' | 'template' | 'memory' | 'command';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  score: number;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onOverviewAction?: (action: string) => void;
}

const CommandPalette: React.FC<Props> = ({ open, onClose, onNavigate, onOverviewAction }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const projects = useProjectStore(s => s.projects);
  const currentProject = useProjectStore(s => s.currentProject);
  const projectDocs = useProjectDocStore(s => s.projectDocs);
  const tasks = useTaskStore(s => s.tasks);
  const templates = useTemplateStore(s => s.templates);
  const stageMemories = useKnowledgeStore(s => s.stageMemories);
  const navigate = useNavigationStore(s => s.navigate);

  // 构建搜索项
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // 项目
    projects.forEach(project => {
      items.push({
        id: `project:${project.id}`,
        type: 'project',
        title: project.name,
        subtitle: project.description?.slice(0, 40) || project.folderPath?.split(/[/\\]/).pop(),
        icon: <ProjectOutlined style={{ color: '#1677ff' }} />,
        score: 0,
        action: () => {
          useProjectStore.getState().setCurrentProject(project);
          onNavigate('overview');
          onClose();
        },
      });
    });

    // 项目文件
    projectDocs.forEach(doc => {
      items.push({
        id: `file:${doc.id}`,
        type: 'file',
        title: doc.name,
        subtitle: `项目文档 · ${doc.overallProgress ?? 0}%`,
        icon: <FileTextOutlined style={{ color: '#722ed1' }} />,
        score: 0,
        action: () => {
          const project = projects.find(p => p.id === doc.projectId);
          if (project) {
            useProjectStore.getState().setCurrentProject(project);
            navigate({ target: 'report', projectId: project.id, docId: doc.id, source: 'overview' });
          }
          onClose();
        },
      });
    });

    // 未完成任务
    tasks.filter(t => t.status !== 'completed').forEach(task => {
      const project = projects.find(p => p.id === task.projectId);
      items.push({
        id: `task:${task.id}`,
        type: 'task',
        title: task.title || '待办任务',
        subtitle: project ? `${project.name} · ${task.stageName || ''}` : task.stageName,
        icon: <CheckCircleOutlined style={{ color: task.priority === 'high' ? '#ff4d4f' : '#52c41a' }} />,
        score: 0,
        action: () => {
          if (project) {
            useProjectStore.getState().setCurrentProject(project);
            const target: WorkbenchPage = task.source === 'review' ? 'review' : task.source === 'report' ? 'report' : 'plan';
            navigate({ target, projectId: project.id, taskId: task.id, stageName: task.stageName, source: 'overview' });
          }
          onClose();
        },
      });
    });

    // 模板
    templates.forEach(template => {
      items.push({
        id: `template:${template.id}`,
        type: 'template',
        title: template.name,
        subtitle: template.category || '写作模板',
        icon: <BookOutlined style={{ color: '#faad14' }} />,
        score: 0,
        action: () => {
          onNavigate('project-templates');
          onClose();
        },
      });
    });

    // 阶段记忆
    stageMemories.forEach(memory => {
      items.push({
        id: `memory:${memory.id}`,
        type: 'memory',
        title: memory.stageName || '阶段记忆',
        subtitle: memory.summary?.slice(0, 40),
        icon: <BookOutlined style={{ color: '#13c2c2' }} />,
        score: 0,
        action: () => {
          const project = projects.find(p => p.id === memory.projectId);
          if (project) {
            useProjectStore.getState().setCurrentProject(project);
            navigate({ target: 'report', projectId: project.id, stageName: memory.stageName, source: 'knowledge' });
          }
          onClose();
        },
      });
    });

    // 命令
    const commands: Array<{ id: string; title: string; icon: React.ReactNode; action: () => void }> = [
      { id: 'cmd:new-project', title: '新建项目', icon: <ProjectOutlined style={{ color: '#1677ff' }} />, action: () => { onOverviewAction?.('create-project'); onNavigate('overview'); onClose(); } },
      { id: 'cmd:recycle-bin', title: '打开回收站', icon: <DeleteOutlined style={{ color: '#8c8c8c' }} />, action: () => { onNavigate('recycle-bin'); onClose(); } },
      { id: 'cmd:settings', title: '打开设置', icon: <SettingOutlined style={{ color: '#8c8c8c' }} />, action: () => { onNavigate('settings'); onClose(); } },
      { id: 'cmd:calendar', title: '打开日历', icon: <CalendarOutlined style={{ color: '#13c2c2' }} />, action: () => { onNavigate('calendar'); onClose(); } },
      { id: 'cmd:templates', title: '模板管理', icon: <FileTextOutlined style={{ color: '#faad14' }} />, action: () => { onNavigate('project-templates'); onClose(); } },
      { id: 'cmd:refresh', title: '刷新项目列表', icon: <ReloadOutlined style={{ color: '#52c41a' }} />, action: () => { useProjectStore.getState().loadProjects(); onClose(); } },
    ];

    if (currentProject) {
      commands.push(
        { id: 'cmd:files', title: `进入 ${currentProject.name} 文件`, icon: <FolderOutlined style={{ color: '#1677ff' }} />, action: () => { navigate({ target: 'files', projectId: currentProject.id, source: 'overview' }); onClose(); } },
        { id: 'cmd:plan', title: `进入 ${currentProject.name} 计划`, icon: <CalendarOutlined style={{ color: '#13c2c2' }} />, action: () => { navigate({ target: 'plan', projectId: currentProject.id, source: 'overview' }); onClose(); } },
        { id: 'cmd:report', title: `进入 ${currentProject.name} 报告`, icon: <ExperimentOutlined style={{ color: '#722ed1' }} />, action: () => { navigate({ target: 'report', projectId: currentProject.id, source: 'overview' }); onClose(); } },
        { id: 'cmd:review', title: `进入 ${currentProject.name} 审查`, icon: <CheckCircleOutlined style={{ color: '#ff4d4f' }} />, action: () => { navigate({ target: 'review', projectId: currentProject.id, source: 'overview' }); onClose(); } },
        { id: 'cmd:team', title: `进入 ${currentProject.name} 团队`, icon: <TeamOutlined style={{ color: '#52c41a' }} />, action: () => { navigate({ target: 'team', projectId: currentProject.id, source: 'overview' }); onClose(); } },
      );
    }

    commands.forEach(cmd => {
      items.push({
        id: cmd.id,
        type: 'command',
        title: cmd.title,
        icon: cmd.icon,
        score: 0,
        action: cmd.action,
      });
    });

    return items;
  }, [projects, projectDocs, tasks, templates, stageMemories, currentProject, navigate, onNavigate, onClose]);

  // 搜索评分
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allItems.slice(0, 20);

    const scored = allItems.map(item => {
      const titleLower = item.title.toLowerCase();
      const subtitleLower = (item.subtitle || '').toLowerCase();
      let score = 0;

      if (titleLower === q) score = 100;
      else if (titleLower.startsWith(q)) score = 80;
      else if (titleLower.includes(q)) score = 60;
      else if (subtitleLower.includes(q)) score = 40;
      else if (q.split('').every(char => titleLower.includes(char))) score = 30;

      return { ...item, score };
    }).filter(item => item.score > 0);

    scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return scored.slice(0, 15);
  }, [query, allItems]);

  // 重置
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 键盘导航
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[selectedIndex]?.action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [results, selectedIndex, onClose]);

  // 滚动到选中项
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  const typeColors: Record<string, string> = {
    project: 'blue',
    file: 'purple',
    task: 'green',
    template: 'gold',
    memory: 'cyan',
    command: 'default',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(15, 23, 42, 0.28)',
        backdropFilter: 'blur(8px)',
        display: 'flex', justifyContent: 'center', paddingTop: '15vh',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 'min(560px, calc(100vw - 48px))',
          maxHeight: 'min(480px, calc(100vh - 200px))',
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onKeyDown={handleKeyDown}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0' }}>
          <Input
            ref={inputRef}
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索项目、文件、任务、命令…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            allowClear
            style={{ borderRadius: 10 }}
          />
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {results.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <Text type="secondary">未找到匹配项</Text>
            </div>
          ) : (
            results.map((item, index) => (
              <div
                key={item.id}
                role="option"
                aria-selected={index === selectedIndex}
                onClick={() => item.action()}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8,
                  cursor: 'pointer',
                  background: index === selectedIndex ? '#f0f5ff' : 'transparent',
                  transition: 'background 100ms',
                }}
              >
                <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' }}>{item.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13, display: 'block' }} ellipsis>{item.title}</Text>
                  {item.subtitle && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }} ellipsis>{item.subtitle}</Text>
                  )}
                </div>
                <Tag color={typeColors[item.type] || 'default'} style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>
                  {item.type === 'project' ? '项目' : item.type === 'file' ? '文件' : item.type === 'task' ? '任务' : item.type === 'template' ? '模板' : item.type === 'memory' ? '记忆' : '命令'}
                </Tag>
              </div>
            ))
          )}
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 12 }}>
          <Text type="secondary" style={{ fontSize: 10 }}>↑↓ 导航</Text>
          <Text type="secondary" style={{ fontSize: 10 }}>Enter 执行</Text>
          <Text type="secondary" style={{ fontSize: 10 }}>Esc 关闭</Text>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
