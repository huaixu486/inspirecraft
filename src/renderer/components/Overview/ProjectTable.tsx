import React from 'react';
import { Card, Table, Tag, Progress, Typography, Space } from 'antd';
import { FolderOutlined, CalendarOutlined, WarningOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getAllStages, getStageMeta, detectTimelineStage } from '../../utils/timelineStages';
import type { StageConfig } from '../../utils/timelineStages';
import { Project } from '../../../shared/types';

const { Text } = Typography;

const ProjectTable: React.FC = () => {
  const { projects, setCurrentProject } = useProjectStore();
  const { projectDocs } = useProjectDocStore();
  const customStages = useSettingsStore((s) => s.customStages);
  const allStages = getAllStages(customStages);
  const stageMeta = getStageMeta(allStages);

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
        const stage = detectTimelineStage(allStages, ...docs.map(d => d.name));
        const meta = stageMeta[stage];
        return <Tag color={meta?.color || '#8c8c8c'}>{meta?.label || stage}</Tag>;
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

        // 判断逾期/即将逾期（与 GanttChart 一致）
        const hasTime = latest.getHours() !== 0 || latest.getMinutes() !== 0 || latest.getSeconds() !== 0;
        let isOverdue = false;
        let isAboutToExpire = false;
        const hasCompleted = docs.some(d => d.completedAt);
        if (!hasCompleted) {
          if (hasTime) {
            isOverdue = latest < now;
            isAboutToExpire = !isOverdue && now >= new Date(latest.getTime() - 24 * 60 * 60 * 1000);
          } else {
            isOverdue = (latest.getFullYear() < now.getFullYear())
              || (latest.getFullYear() === now.getFullYear() && latest.getMonth() < now.getMonth())
              || (latest.getFullYear() === now.getFullYear() && latest.getMonth() === now.getMonth() && latest.getDate() < now.getDate());
            isAboutToExpire = !isOverdue && latest.getFullYear() === now.getFullYear() && latest.getMonth() === now.getMonth() && latest.getDate() === now.getDate();
          }
        }

        const statusColor = isOverdue ? '#ff4d4f' : isAboutToExpire ? '#faad14' : '#999';
        return (
          <Space size={4}>
            {isOverdue && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />}
            {isAboutToExpire && <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 12 }} />}
            <CalendarOutlined style={{ color: statusColor, fontSize: 12 }} />
            <Text style={{ fontSize: 12, color: statusColor }}>
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
      className="dashboard-card project-table-card"
      title="项目列表"
      bordered={false}
      style={{}}
    >
      <Table
        className="overview-project-table"
        columns={columns}
        dataSource={projects}
        rowKey="id"
        pagination={false}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: '100%' }}
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
