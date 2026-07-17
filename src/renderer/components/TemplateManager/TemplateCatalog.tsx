import React from 'react';
import { Button, Card, Empty, List, Modal, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, FileTextOutlined, LeftOutlined, PlusOutlined } from '@ant-design/icons';
import type { WritingTemplate } from '../../../shared/types';

const { Title, Text, Paragraph } = Typography;

export interface TemplateCatalogItem {
  template: WritingTemplate;
  nodeCount: number;
}

interface TemplateCatalogProps {
  items: TemplateCatalogItem[];
  hideHeader: boolean;
  onBack?: () => void;
  onCreate: () => void;
  onEdit: (template: WritingTemplate) => void;
  onDelete: (template: WritingTemplate) => void;
}

export const TemplateCatalog: React.FC<TemplateCatalogProps> = ({
  items,
  hideHeader,
  onBack,
  onCreate,
  onEdit,
  onDelete,
}) => (
  <section className="template-section">
    <div className="template-section-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!hideHeader && (
          <>
            {onBack && <Button type="text" icon={<LeftOutlined />} onClick={onBack} />}
            <div>
              <Title level={4} style={{ margin: 0 }}>模板管理</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>维护写作模板结构，可从 Word、PPT、Excel、PDF、文本等文档中提取章节</Text>
            </div>
          </>
        )}
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>创建模板</Button>
    </div>

    {items.length === 0 ? (
      <Empty description="暂无模板，请创建" />
    ) : (
      <List
        className="template-card-list"
        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
        pagination={items.length > 12 ? { pageSize: 12, size: 'small', showSizeChanger: false, hideOnSinglePage: true } : false}
        dataSource={items}
        renderItem={({ template, nodeCount }) => (
          <List.Item>
            <Card
              className="template-card"
              actions={[
                <Button key="edit" className="template-card-action" type="text" icon={<EditOutlined />} onClick={() => onEdit(template)} />,
                <Button
                  key="delete"
                  title="确定删除此模板？"
                  className="template-card-action"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onDelete(template)}
                />,
              ]}
            >
              <Card.Meta
                avatar={<FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />}
                title={template.name}
                description={(
                  <div>
                    <Tag color="blue" style={{ marginBottom: 8 }}>{template.category}</Tag>
                    <Tag color={template.templateType === 'example' ? 'green' : 'default'} style={{ marginBottom: 8 }}>
                      {template.templateType === 'example' ? '范文模板' : '直接套用'}
                    </Tag>
                    <br />
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>{template.description}</Paragraph>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {template.outputFileType?.toUpperCase() || 'DOCX'} · 包含 {nodeCount} 个章节{template.filePath ? ' · 已保存源文件' : ''}
                    </Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {template.formatRules ? `已配置格式规则 · 正文 ${template.bodyFontRequirement?.fontFamily || '宋体'}` : '未配置默认格式'}
                    </Text>
                  </div>
                )}
              />
            </Card>
          </List.Item>
        )}
      />
    )}
  </section>
);

interface TemplateDeleteModalProps {
  template: WritingTemplate | null;
  onDelete: (template: WritingTemplate) => void;
  onCancel: () => void;
}

export const TemplateDeleteModal: React.FC<TemplateDeleteModalProps> = ({ template, onDelete, onCancel }) => (
  <Modal
    title="删除模板"
    open={Boolean(template)}
    onOk={() => { if (template) onDelete(template); }}
    onCancel={onCancel}
    okText="删除"
    cancelText="取消"
    okButtonProps={{ danger: true }}
  >
    <Text>确定删除“{template?.name}”吗？此操作不会删除已保存的项目文档。</Text>
  </Modal>
);
