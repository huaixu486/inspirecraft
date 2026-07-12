import React, { useEffect, useState, useCallback } from 'react';
import {
  Typography, Button, Space, Empty, Spin, message, Popconfirm, Table, Tag,
} from 'antd';
import dayjs from 'dayjs';
import {
  DeleteOutlined, UndoOutlined, ReloadOutlined,
  ArrowLeftOutlined, FolderOutlined, FileOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';

const { Text } = Typography;

interface RecycleBinEntry {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  deletedAt: string;
  size: number;
}

interface RecycleBinViewProps {
  onBack: () => void;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const RecycleBinView: React.FC<RecycleBinViewProps> = ({ onBack }) => {
  const workspacePath = useSettingsStore(s => s.workspacePath);
  const [items, setItems] = useState<RecycleBinEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadItems = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const result = await window.electronAPI.listRecycleBin({ workspacePath });
      if (result.success) {
        setItems(result.entries || []);
      }
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleRestore = async (id: string) => {
    const result = await window.electronAPI.restoreRecycleBinItem({ workspacePath, id });
    if (!result.success) {
      message.error(result.error || '恢复失败');
      return;
    }
    message.success('已恢复到原位置');
    await Promise.all([
      loadItems(),
      useSettingsStore.getState().refreshWorkspaceUsed(),
      useProjectStore.getState().loadProjects({ silent: true }),
      useProjectDocStore.getState().loadProjectDocs(),
    ]);
  };

  const handlePermanentDelete = async (id: string) => {
    const result = await window.electronAPI.permanentlyDeleteRecycleBinItem({ workspacePath, id });
    if (!result.success) {
      message.error(result.error || '彻底删除失败');
      return;
    }
    message.success('已彻底删除');
    await Promise.all([loadItems(), useSettingsStore.getState().refreshWorkspaceUsed()]);
  };

  const handleEmpty = async () => {
    const result = await window.electronAPI.emptyRecycleBin({ workspacePath });
    if (!result.success) {
      message.error(result.error || '清空回收站失败');
      return;
    }
    message.success(`已清空 ${result.removed || 0} 个项目`);
    await Promise.all([loadItems(), useSettingsStore.getState().refreshWorkspaceUsed()]);
  };

  const columns = [
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Space size={8}>
          {record.isDirectory
            ? <FolderOutlined style={{ color: '#d48806', fontSize: 16 }} />
            : <FileOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          }
          <Text strong ellipsis={{ tooltip: record.name }} style={{ maxWidth: 280 }}>{record.name}</Text>
        </Space>
      ),
    },
    {
      title: '原位置',
      key: 'originalPath',
      ellipsis: true,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Text type="secondary" ellipsis={{ tooltip: record.originalPath }} style={{ fontSize: 12, maxWidth: 300 }}>
          {record.originalPath}
        </Text>
      ),
    },
    {
      title: '删除时间',
      key: 'deletedAt',
      width: 160,
      sorter: (a: RecycleBinEntry, b: RecycleBinEntry) => dayjs(a.deletedAt).valueOf() - dayjs(b.deletedAt).valueOf(),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(record.deletedAt).format('YYYY-MM-DD HH:mm')}</Text>
      ),
    },
    {
      title: '大小',
      key: 'size',
      width: 100,
      sorter: (a: RecycleBinEntry, b: RecycleBinEntry) => a.size - b.size,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(record.size)}</Text>
      ),
    },
    {
      title: '类型',
      key: 'type',
      width: 80,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Tag color={record.isDirectory ? 'orange' : 'blue'}>
          {record.isDirectory ? '文件夹' : '文件'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: RecycleBinEntry) => (
        <Space size={4}>
          <Button size="small" icon={<UndoOutlined />} onClick={() => void handleRestore(record.id)}>
            恢复
          </Button>
          <Popconfirm
            title={`彻底删除 ${record.name}？此操作无法撤销。`}
            onConfirm={() => void handlePermanentDelete(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} title="彻底删除" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '0 4px' }}>
      {/* 顶部工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: 'rgba(255,255,255,0.96)',
        border: '1px solid #e5e7eb', borderRadius: 12,
      }}>
        <Space size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回主页</Button>
          <Text strong style={{ fontSize: 15 }}>回收站</Text>
          <Tag color="default">{items.length} 项</Tag>
        </Space>
        <Space size={8}>
          <Button icon={<ReloadOutlined />} onClick={() => void loadItems()} loading={loading}>刷新</Button>
          <Popconfirm
            title="确定彻底清空回收站吗？此操作无法撤销。"
            onConfirm={() => void handleEmpty()}
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
          >
            <Button danger icon={<DeleteOutlined />} disabled={items.length === 0}>
              清空回收站
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* 提示信息 */}
      <Text type="secondary" style={{ fontSize: 12, padding: '0 4px' }}>
        回收站位于当前工作区内，会占用工作区容量；到期项目会按设置自动清理。
      </Text>

      {/* 表格 */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ y: 'calc(100vh - 300px)' }}
          locale={{ emptyText: <Empty description="回收站为空" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </div>
    </div>
  );
};

export default RecycleBinView;
