import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { BarChartOutlined, ClockCircleOutlined, DatabaseOutlined, ReloadOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AIUsageStatistics, AITokenUsage, PromptScene } from '../../../shared/types';
import { PROMPT_SCENE_LABELS } from '../../../shared/promptScenes';
import { requireIpcObject } from '../../utils/ipcResult';

const { Text, Title } = Typography;
const formatTokens = (value?: number) => (value || 0).toLocaleString('zh-CN');
const emptyUsage: AITokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'reported' };
const sceneLabel = (scene?: string) => scene ? (PROMPT_SCENE_LABELS[scene as PromptScene] || scene) : '未标记场景';

const UsageCard: React.FC<{ title: string; usage: AITokenUsage; tone: string; icon: React.ReactNode }> = ({ title, usage, tone, icon }) => (
  <Card size="small" className="ai-usage-metric-card" style={{ borderTop: `3px solid ${tone}` }}>
    <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
      <div><Text type="secondary">{title}</Text><Statistic value={usage.totalTokens} formatter={value => formatTokens(Number(value))} suffix="Token" valueStyle={{ fontSize: 24, color: '#172b45' }} /></div>
      <span className="ai-usage-metric-icon" style={{ color: tone, background: `${tone}18` }}>{icon}</span>
    </Space>
    <div className="ai-usage-split"><span>输入 {formatTokens(usage.inputTokens)}</span><span>输出 {formatTokens(usage.outputTokens)}</span></div>
  </Card>
);

const AIUsageSettings: React.FC = () => {
  const [statistics, setStatistics] = useState<AIUsageStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatistics(requireIpcObject<AIUsageStatistics>(
        await window.electronAPI.getAIUsageStatistics(),
        '加载 Token 统计失败',
      ));
    }
    catch (error) { console.error('Failed to load AI usage statistics:', error); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const maxTrend = useMemo(() => Math.max(1, ...(statistics?.trend || []).map(item => item.totalTokens)), [statistics]);
  const hasEstimated = Boolean(statistics && [statistics.total, statistics.hourly, statistics.daily, statistics.monthly].some(item => item.source === 'estimated'));
  const totalRequests = statistics?.byTask.reduce((sum, item) => sum + item.requestCount, 0) || 0;

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div className="ai-usage-page-heading">
      <div><Space size={8}><BarChartOutlined style={{ color: '#1677ff' }} /><Title level={5} style={{ margin: 0 }}>Token 使用账本</Title></Space><Text type="secondary">按时间、任务、模型和输入输出拆分每一次 AI 请求。</Text></div>
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新数据</Button>
    </div>
    {hasEstimated && <Alert type="info" showIcon message="部分模型未返回官方 usage，已按文本长度估算并在账本中标记；其余为接口返回的实际 Token。" />}
    <Row gutter={[12, 12]}>
      <Col xs={24} sm={12} lg={6}><UsageCard title="本小时" usage={statistics?.hourly || emptyUsage} tone="#1677ff" icon={<ClockCircleOutlined />} /></Col>
      <Col xs={24} sm={12} lg={6}><UsageCard title="今日" usage={statistics?.daily || emptyUsage} tone="#13c2c2" icon={<RiseOutlined />} /></Col>
      <Col xs={24} sm={12} lg={6}><UsageCard title="本月" usage={statistics?.monthly || emptyUsage} tone="#722ed1" icon={<BarChartOutlined />} /></Col>
      <Col xs={24} sm={12} lg={6}><UsageCard title="累计" usage={statistics?.total || emptyUsage} tone="#fa8c16" icon={<DatabaseOutlined />} /></Col>
    </Row>
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={15}>
        <Card size="small" title="近 7 天消耗趋势" className="ai-usage-chart-card" extra={<Text type="secondary">共 {totalRequests} 次模型请求</Text>}>
          {(statistics?.trend?.length || 0) > 0 ? <div className="ai-usage-trend">{statistics!.trend.map(item => <Tooltip key={item.date} title={`${item.date}：${formatTokens(item.totalTokens)} Token · ${item.requestCount} 次请求`}><div className="ai-usage-trend-column"><div className="ai-usage-trend-value">{item.totalTokens ? formatTokens(item.totalTokens) : ''}</div><div className="ai-usage-trend-track"><div className="ai-usage-trend-bar" style={{ height: `${Math.max(3, Math.round((item.totalTokens / maxTrend) * 100))}%` }} /></div><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(item.date).format('MM/DD')}</Text></div></Tooltip>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未记录 Token 消耗" />}
        </Card>
      </Col>
      <Col xs={24} xl={9}>
        <Card size="small" title="模型消耗占比" className="ai-usage-chart-card">
          {(statistics?.byModel?.length || 0) > 0 ? <Space direction="vertical" size={10} style={{ width: '100%' }}>{statistics!.byModel.slice(0, 5).map((model, index) => { const total = statistics!.total.totalTokens || 1; const percent = Math.round((model.totalTokens / total) * 100); return <div key={`${model.modelId || ''}:${model.model}`}><Space style={{ width: '100%', justifyContent: 'space-between' }}><Text ellipsis style={{ maxWidth: 220 }}>{model.modelName}</Text><Text type="secondary">{formatTokens(model.totalTokens)} · {percent}%</Text></Space><Progress percent={percent} showInfo={false} size="small" strokeColor={['#1677ff', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96'][index]} /></div>; })}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模型数据" />}
        </Card>
      </Col>
    </Row>
    <Card size="small" title="模型明细" className="ai-usage-table-card" bodyStyle={{ padding: 0 }}>
      <Table size="small" rowKey={record => `${record.modelId || ''}:${record.model}`} loading={loading} dataSource={statistics?.byModel || []} pagination={false} locale={{ emptyText: '尚无 AI 调用记录' }} columns={[
        { title: '模型', key: 'model', render: (_, record) => <Space size={6}><Text strong>{record.modelName}</Text><Tag>{record.provider}</Tag></Space> },
        { title: '输入', dataIndex: 'inputTokens', align: 'right', render: formatTokens }, { title: '输出', dataIndex: 'outputTokens', align: 'right', render: formatTokens }, { title: '总量', dataIndex: 'totalTokens', align: 'right', render: formatTokens },
        { title: '计量', key: 'source', render: (_, record) => <Tag color={record.source === 'reported' ? 'green' : 'gold'}>{record.source === 'reported' ? '接口实际值' : '文本估算'}</Tag> },
      ]} />
    </Card>
    <Card size="small" title="最近 AI 任务与请求记录" className="ai-usage-table-card" bodyStyle={{ padding: 0 }} extra={<Text type="secondary">同一任务中的重试、并行模型会分别计入请求次数</Text>}>
      <Table size="small" rowKey={record => record.requestId || `${record.lastAt}-${record.requestTitle}`} loading={loading} dataSource={statistics?.byTask.slice(0, 100) || []} pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 980 }} locale={{ emptyText: '暂无可追溯的 AI 任务' }} columns={[
        { title: '执行时间', dataIndex: 'lastAt', width: 160, render: value => <Space size={5}><ClockCircleOutlined style={{ color: '#8ca0b3' }} /><Text>{dayjs(value).format('YYYY-MM-DD HH:mm:ss')}</Text></Space> },
        { title: '任务', key: 'task', render: (_, record) => <Space direction="vertical" size={2}><Text strong>{record.requestTitle}</Text><Space size={4}><Tag color={record.requestId ? 'blue' : 'default'}>{sceneLabel(record.scene)}</Tag>{!record.requestId && <Tag>历史记录</Tag>}</Space></Space> },
        { title: '模型', dataIndex: 'models', render: models => <Text>{models.join('、')}</Text> },
        { title: '请求', dataIndex: 'requestCount', align: 'center', width: 80, render: value => <Tag color={value > 1 ? 'orange' : 'blue'}>{value} 次</Tag> },
        { title: '输入', dataIndex: 'inputTokens', align: 'right', width: 100, render: formatTokens }, { title: '输出', dataIndex: 'outputTokens', align: 'right', width: 100, render: formatTokens }, { title: '总 Token', dataIndex: 'totalTokens', align: 'right', width: 110, render: value => <Text strong>{formatTokens(value)}</Text> },
        { title: '计量', key: 'source', width: 88, render: (_, record) => <Tag color={record.source === 'reported' ? 'green' : 'gold'}>{record.source === 'reported' ? '实际' : '估算'}</Tag> },
      ]} />
    </Card>
  </Space>;
};

export default AIUsageSettings;
