import React from 'react';
import { Card, Typography, Empty, Timeline, Tag, Space } from 'antd';
import {
  FileTextOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';

const { Text, Title } = Typography;

const DiffViewer: React.FC = () => {
  const { currentProject, versions } = useProjectStore();

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectVersions = versions
    .filter(v => v.projectId === currentProject.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getVersionColor = (fileType: string) => {
    switch (fileType?.toLowerCase()) {
      case 'docx':
      case 'doc':
        return '#1890ff';
      case 'pdf':
        return '#ff4d4f';
      case 'xlsx':
      case 'xls':
        return '#52c41a';
      case 'pptx':
      case 'ppt':
        return '#faad14';
      default:
        return '#999';
    }
  };

  return (
    <div>
      <Title level={4}>版本历史</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        记录项目的文件版本变更时间线
      </Text>

      {projectVersions.length === 0 ? (
        <Empty description="暂无版本记录" />
      ) : (
        <Card>
          <Timeline
            items={projectVersions.map(version => ({
              dot: (
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: getVersionColor(version.fileType),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <FileTextOutlined style={{ color: '#fff', fontSize: 12 }} />
                </div>
              ),
              children: (
                <div style={{ paddingBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <Text strong style={{ fontSize: 14 }}>{version.fileName}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Tag color={getVersionColor(version.fileType)}>
                          {version.fileType?.toUpperCase() || '未知'}
                        </Tag>
                        {version.description && (
                          <Text type="secondary" style={{ fontSize: 12 }}>{version.description}</Text>
                        )}
                      </div>
                    </div>
                    <Space size={4}>
                      <ClockCircleOutlined style={{ color: '#999', fontSize: 12 }} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(version.createdAt).toLocaleString('zh-CN')}
                      </Text>
                    </Space>
                  </div>
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </div>
  );
};

export default DiffViewer;
