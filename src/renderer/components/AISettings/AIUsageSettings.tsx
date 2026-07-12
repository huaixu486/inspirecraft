import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { AIUsageStatistics, AITokenUsage } from '../../../shared/types';

const { Text } = Typography;

const formatTokens = (value?: number) => (value || 0).toLocaleString('zh-CN');

const UsageCard: React.FC<{ title: string; usage: AITokenUsage }> = ({ title, usage }) => (
  <Card size="small" style={{ height: '100%' }}>
    <Statistic title={title} value={usage.totalTokens} formatter={(value) => formatTokens(Number(value))} suffix="token" />
    <Space size={10} style={{ marginTop: 6 }}>
      <Text type="secondary">输入 {formatTokens(usage.inputTokens)}</Text>
      <Text type="secondary">输出 {formatTokens(usage.outputTokens)}</Text>
    </Space>
  </Card>
);

const AIUsageSettings: React.FC = () => {
  const [statistics, setStatistics] = useState<AIUsageStatistics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatistics(await window.electronAPI.getAIUsageStatistics());
    } catch (error) {
      console.error('Failed to load AI usage statistics:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!statistics && !loading) {
    return <Empty description="暂未记录 AI Token 消耗" />;
  }

  const sourceIsEstimated = statistics && [statistics.total, statistics.hourly, statistics.daily, statistics.monthly]
    .some(usage => usage.source === 'estimated');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>Token 消耗统计</Typography.Title>
          <Text type="secondary">按模型记录 AI 调用的输入、输出与总 Token。</Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
      </div>

      {sourceIsEstimated && (
        <Alert
          type="info"
          showIcon
          message="部分服务商未返回 usage，本页已按文本长度估算并标注“估算”；返回 usage 的调用均为实际值。"
        />
      )}

      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}><UsageCard title="本小时" usage={statistics?.hourly || { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' }} /></Col>
        <Col xs={24} sm={12} lg={6}><UsageCard title="今日" usage={statistics?.daily || { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' }} /></Col>
        <Col xs={24} sm={12} lg={6}><UsageCard title="本月" usage={statistics?.monthly || { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' }} /></Col>
        <Col xs={24} sm={12} lg={6}><UsageCard title="累计" usage={statistics?.total || { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' }} /></Col>
      </Row>

      <Card title="按模型统计" size="small" bodyStyle={{ padding: 0 }}>
        <Table
          size="small"
          rowKey={(record) => `${record.modelId || ''}:${record.model}`}
          loading={loading}
          dataSource={statistics?.byModel || []}
          pagination={false}
          locale={{ emptyText: '尚无 AI 调用记录' }}
          columns={[
            {
              title: '模型',
              key: 'model',
              render: (_, record) => (
                <Space size={6}>
                  <Text strong>{record.modelName}</Text>
                  <Tag style={{ margin: 0 }}>{record.provider}</Tag>
                </Space>
              ),
            },
            { title: '输入', dataIndex: 'inputTokens', align: 'right', render: formatTokens },
            { title: '输出', dataIndex: 'outputTokens', align: 'right', render: formatTokens },
            { title: '总量', dataIndex: 'totalTokens', align: 'right', render: formatTokens },
            { title: '来源', key: 'source', width: 82, render: (_, record) => <Tag color={record.source === 'reported' ? 'green' : 'gold'}>{record.source === 'reported' ? '实际' : '估算'}</Tag> },
          ]}
        />
      </Card>
    </Space>
  );
};

export default AIUsageSettings;
