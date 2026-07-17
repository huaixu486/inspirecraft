import React, { useState } from 'react';
import { Button, ColorPicker, Divider, Form, Input, List, Modal, Popconfirm, Space, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { StageConfig } from '../../../shared/types';

const { Title, Text } = Typography;

interface ProjectStageSectionProps {
  stages: StageConfig[];
  onCreate: () => void;
  onEdit: (stage: StageConfig) => void;
  onDelete: (stageId: string) => void;
}

export const ProjectStageSection: React.FC<ProjectStageSectionProps> = ({
  stages,
  onCreate,
  onEdit,
  onDelete,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <Divider className="template-page-divider" />
      <section className="template-section stage-section">
        <div
          className="template-section-header"
          style={{
            marginBottom: expanded ? 16 : 0,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <Title level={4} style={{ margin: 0 }}>项目阶段管理</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              阶段会参与文件识别、进度计算、统计卡片、甘特图和项目表；列表已按需展开，避免进入模板页时卡顿。
            </Text>
          </div>
          <Space>
            <Button onClick={() => setExpanded(value => !value)}>
              {expanded ? '收起阶段' : `展开阶段（${stages.length}）`}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              新增阶段
            </Button>
          </Space>
        </div>

        {expanded && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
              新增或修改阶段后，系统会重新扫描所有项目文件夹，并按新的阶段规则刷新项目进度。
            </Text>
            <List
              className="stage-list"
              dataSource={stages}
              renderItem={stage => (
                <List.Item
                  actions={[
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(stage)}>
                      编辑
                    </Button>,
                    <Popconfirm
                      title="确定删除此阶段？删除后会重新计算所有项目进度。"
                      onConfirm={() => onDelete(stage.id)}
                    >
                      <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={(
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          background: stage.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontSize: 14,
                          fontWeight: 'bold',
                        }}
                      >
                        {stage.name.charAt(0)}
                      </div>
                    )}
                    title={stage.name}
                    description={(
                      <span style={{ fontSize: 12, color: '#999' }}>
                        关键词：{stage.keywords.length > 0 ? stage.keywords.join('、') : '（无）'}
                      </span>
                    )}
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </section>
    </>
  );
};

interface ProjectStageModalProps {
  open: boolean;
  editingStage: StageConfig | null;
  form: FormInstance;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ProjectStageModal: React.FC<ProjectStageModalProps> = ({
  open,
  editingStage,
  form,
  onSubmit,
  onCancel,
}) => (
  <Modal
    title={editingStage ? '编辑阶段' : '新增阶段'}
    open={open}
    onOk={onSubmit}
    onCancel={onCancel}
    okText="保存"
    cancelText="取消"
    width={420}
  >
    <Form form={form} layout="vertical">
      <Form.Item
        name="name"
        label="阶段名称"
        rules={[{ required: true, message: '请输入阶段名称' }]}
      >
        <Input placeholder="例如：立项、招标、验收" />
      </Form.Item>
      <Form.Item
        name="keywords"
        label="识别关键词"
        extra="多个关键词用逗号分隔，文件名包含任一关键词即识别为该阶段"
      >
        <Input placeholder="例如：立项, 招标, 验收" />
      </Form.Item>
      <Form.Item
        name="color"
        label="阶段颜色"
        rules={[{ required: true, message: '请选择颜色' }]}
      >
        <ColorPicker format="hex" showText />
      </Form.Item>
    </Form>
  </Modal>
);
