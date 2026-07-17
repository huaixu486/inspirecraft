import React from 'react';
import { Button, Card, Col, Input, Row, Space, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

const { Paragraph, Text } = Typography;

interface RewriteVariant { id: string; modelName: string; ok: boolean; replacement: string; reason?: string; error?: string }
interface RewritePreview { id: string; title: string; original: string; replacement: string; reason?: string; status?: 'pending' | 'accepted'; variants?: RewriteVariant[] }

interface AiReviewAssistPanelProps {
  visible: boolean;
  fromWorkflow: boolean;
  prompt: string;
  suggestedPrompt: string;
  previews: RewritePreview[];
  isGenerating: boolean;
  applyingRewriteId: string;
  onPromptChange: (prompt: string) => void;
  onGenerate: () => void;
  onAccept: (preview: RewritePreview, variant: RewriteVariant) => void;
}

const AiReviewAssistPanel: React.FC<AiReviewAssistPanelProps> = ({ visible, fromWorkflow, prompt, suggestedPrompt, previews, isGenerating, applyingRewriteId, onPromptChange, onGenerate, onAccept }) => {
  if (!visible) return null;
  return (
    <Card title="审查 - AI协作" style={{ marginBottom: 16, borderColor: '#91caff' }} extra={fromWorkflow ? <Tag color="blue">来自工作流</Tag> : null}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text type="secondary">点击输入框后按 Tab，自动填充当前工作流问题的提示词。</Text>
        <Input.TextArea
          value={prompt}
          autoSize={{ minRows: 4, maxRows: 10 }}
          placeholder="按 Tab 自动填充提示词"
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !prompt.trim()) {
              event.preventDefault();
              onPromptChange(suggestedPrompt);
            }
          }}
        />
        <Space wrap>
          <Button size="small" onClick={() => onPromptChange(suggestedPrompt)}>填充提示词</Button>
          <Button size="small" onClick={() => onPromptChange('')}>清空</Button>
          <Button size="small" type="primary" icon={<RobotOutlined />} loading={isGenerating} onClick={onGenerate}>生成修改预览</Button>
        </Space>
        {previews.length > 0 && (
          <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
            {previews.map(preview => (
              <div key={preview.id} style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 12, background: '#f8fbff' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap><Text strong>{preview.title}</Text>{preview.status === 'accepted' ? <Tag color="green">已采用</Tag> : null}</Space>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, background: '#fff' }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>待替换原文</Text>
                    <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 3, expandable: true }}>{preview.original}</Paragraph>
                  </div>
                  <Row gutter={[10, 10]}>
                    {(preview.variants?.length ? preview.variants : [{ id: 'default', modelName: 'AI版本', ok: true, replacement: preview.replacement, reason: preview.reason }]).map(variant => (
                      <Col key={variant.id} xs={24} md={preview.variants && preview.variants.length > 1 ? 12 : 24}>
                        <div style={{ height: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                              <Tag color={variant.ok ? 'blue' : 'red'}>{variant.modelName}</Tag>
                              <Button size="small" type="primary" disabled={!variant.ok || !variant.replacement.trim() || preview.status === 'accepted'} loading={applyingRewriteId === `${preview.id}:${variant.id}`} onClick={() => onAccept(preview, variant)}>采用此版本</Button>
                            </Space>
                            {variant.error ? <Text type="danger">{variant.error}</Text> : null}
                            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 5, expandable: true }}>{variant.replacement}</Paragraph>
                            {variant.reason ? <Text type="secondary">{variant.reason}</Text> : null}
                          </Space>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Space>
              </div>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  );
};

export default AiReviewAssistPanel;
