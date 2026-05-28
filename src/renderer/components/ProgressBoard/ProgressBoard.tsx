import React from 'react';
import { Card, Progress, List, Tag, Typography, Empty, Space, Statistic } from 'antd';
import { useProjectStore } from '../../stores/projectStore';

const { Text } = Typography;

const ProgressBoard: React.FC = () => {
  const { currentProject, versions } = useProjectStore();

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectVersions = versions.filter(
    (v) => v.projectId === currentProject.id
  );

  const statusColors = {
    active: 'green',
    completed: 'blue',
    paused: 'orange',
  };

  const statusLabels = {
    active: '进行中',
    completed: '已完成',
    paused: '已暂停',
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 18 }}>
          {currentProject.name} - 项目进度
        </Text>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <Statistic title="项目状态" valueRender={() => (
              <Tag color={statusColors[currentProject.status]}>
                {statusLabels[currentProject.status]}
              </Tag>
            )} />
            <Statistic title="完成进度" value={currentProject.progress} suffix="%" />
            <Statistic title="版本数量" value={projectVersions.length} />
          </div>
        </Card>

        <Card title="整体进度">
          <Progress
            percent={currentProject.progress}
            status="active"
            strokeColor={{
              '0%': '#108ee9',
              '100%': '#87d068',
            }}
          />
        </Card>

        <Card title="最近版本">
          <List
            dataSource={projectVersions.slice(0, 5)}
            renderItem={(version, index) => (
              <List.Item>
                <Space>
                  <Tag>{projectVersions.length - index}</Tag>
                  <Text>{version.fileName}</Text>
                  <Text type="secondary">
                    {new Date(version.createdAt).toLocaleString('zh-CN')}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </Space>
    </div>
  );
};

export default ProgressBoard;
