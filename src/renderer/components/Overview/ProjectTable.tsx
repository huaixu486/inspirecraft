import React from 'react';
import { Card, Table, Tag, Progress, Typography, Space } from 'antd';
import { FolderOutlined, CalendarOutlined, WarningOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { Project } from '../../../shared/types';

const { Text } = Typography;

const stageMap: Record<string, { color: string; label: string }> = {
  '提案': { color: 'blue', label: '提案阶段' },
  '中标': { color: 'green', label: '中标阶段' },
  '指南编写': { color: 'orange', label: '指南编写' },
  '指南投标': { color: 'purple', label: '指南投标' },
  '其他': { color: 'default', label: '进行中' },
};

const getStage = (docNames: string[]) => {
  const joined = docNames.join(' ');
  if (joined.includes('指南')) return '指南编写';
  if (joined.includes('提案')) return '提案';
  return '其他';
};

const ProjectTable: React.FC = () => {
  const { projects, setCurrentProject } = useProjectStore();
  const { projectDocs } = useProjectDocStore();

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space size={8}>
          <FolderOutlined style={{ color: '#1890ff', fontSize: 16 }} />
          <Text strong style={{ fontSize: 13 }}>{name}</Text>
        </Space>
      ),
    },
    {
      title: '阶段',
      key: 'stage',
      width: 110,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id);
        const stage = getStage(docs.map(d => d.name));
        const info = stageMap[stage] || stageMap['其他'];
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 180,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id);
        const avg = docs.length > 0
          ? Math.round(docs.reduce((acc, d) => acc + d.overallProgress, 0) / docs.length)
          : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress
              percent={avg}
              size="small"
              showInfo={false}
              strokeColor={avg >= 80 ? '#52c41a' : avg >= 50 ? '#1890ff' : avg >= 30 ? '#faad14' : '#ff4d4f'}
              style={{ flex: 1, marginBottom: 0 }}
            />
            <Text style={{ fontSize: 12, color: '#666', minWidth: 32 }}>{avg}%</Text>
          </div>
        );
      },
    },
    {
      title: '截止日期',
      key: 'deadline',
      width: 150,
      render: (_: any, record: Project) => {
        const docs = projectDocs.filter(d => d.projectId === record.id && d.deadline);
        if (docs.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>未设置</Text>;

        const now = new Date();
        const latest = docs.reduce((max, d) => {
          const dl = new Date(d.deadline!);
          return dl > max ? dl : max;
        }, new Date(0));

        const isOverdue = latest < now;
        return (
          <Space size={4}>
            {isOverdue && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />}
            <CalendarOutlined style={{ color: isOverdue ? '#ff4d4f' : '#999', fontSize: 12 }} />
            <Text style={{ fontSize: 12, color: isOverdue ? '#ff4d4f' : undefined }}>
              {latest.toLocaleDateString('zh-CN')}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '下一步计划',
      key: 'nextPlan',
      render: (_: any, record: Project) => (
        <Text type="secondary" ellipsis style={{ maxWidth: 200, fontSize: 12 }}>
          {record.description || '暂无计划'}
        </Text>
      ),
    },
  ];

  return (
    <Card
      title="项目列表"
      bordered={false}
      style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.09)' }}
    >
      <Table
        columns={columns}
        dataSource={projects}
        rowKey="id"
        pagination={false}
        size="middle"
        onRow={(record) => ({
          onClick: () => setCurrentProject(record),
          style: { cursor: 'pointer' },
        })}
        rowClassName={(record) =>
          record.id === useProjectStore.getState().currentProject?.id ? 'ant-table-row-selected' : ''
        }
      />
    </Card>
  );
};

export default ProjectTable;
