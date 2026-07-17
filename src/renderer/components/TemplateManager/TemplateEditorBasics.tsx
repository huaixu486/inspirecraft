import React from 'react';
import { Form, Input, Modal, Select, Spin, Typography } from 'antd';
import type { FormInstance } from 'antd';
import type { StageConfig, TemplateOutputFileType, WritingTemplate } from '../../../shared/types';

const { Text } = Typography;
const { TextArea } = Input;

interface TemplateEditorModalProps {
  open: boolean;
  editingTemplate: WritingTemplate | null;
  form: FormInstance;
  preparing: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

export const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({
  open,
  editingTemplate,
  form,
  preparing,
  onSubmit,
  onCancel,
  children,
}) => (
  <Modal
    className="template-editor-modal"
    rootClassName="template-editor-modal-root"
    title={editingTemplate ? '编辑模板' : '创建模板'}
    open={open}
    onOk={onSubmit}
    onCancel={onCancel}
    afterClose={() => document.body.classList.remove('template-editor-modal-open')}
    destroyOnClose
    width="min(88vw, 1560px)"
    okText="保存模板"
    cancelText="取消"
    transitionName="template-modal-motion"
    maskTransitionName="template-modal-mask-motion"
    style={{ top: 0, maxHeight: 'calc(100vh - 16px)' }}
    styles={{ body: { overflow: 'hidden' } }}
    okButtonProps={{ disabled: preparing }}
  >
    {preparing ? (
      <div className="template-editor-loading">
        <Spin tip="正在准备模板..." />
      </div>
    ) : (
      <Form form={form} layout="vertical" className="template-editor-form">
        {children}
      </Form>
    )}
  </Modal>
);

interface FileTypeOption {
  value: TemplateOutputFileType;
  label: string;
}

interface TemplateBasicInfoSectionProps {
  stages: StageConfig[];
  fileTypeOptions: FileTypeOption[];
}

export const TemplateBasicInfoSection: React.FC<TemplateBasicInfoSectionProps> = ({
  stages,
  fileTypeOptions,
}) => (
  <>
    <Text strong>基础信息</Text>
    <div className="template-form-row">
      <Form.Item
        name="name"
        label="模板名称"
        rules={[{ required: true, message: '请输入模板名称' }]}
      >
        <Input placeholder="例如：可研报告模板" />
      </Form.Item>

      <Form.Item
        name="category"
        label="关联阶段"
        rules={[{ required: true, message: '请选择关联阶段' }]}
      >
        <Select
          placeholder="选择阶段"
          options={stages.map(stage => ({ value: stage.name, label: stage.name }))}
        />
      </Form.Item>

      <Form.Item
        name="outputFileType"
        label="创建文件类型"
        rules={[{ required: true, message: '请选择创建文件类型' }]}
      >
        <Select placeholder="选择文件类型" options={fileTypeOptions} />
      </Form.Item>
    </div>

    <Form.Item
      name="templateType"
      label="模板类型"
      extra="直接套用模板：要求文字作为硬性检查标准；范文模板：作为格式和风格参考，字数为建议值"
    >
      <Select
        options={[
          { value: 'direct', label: '直接套用模板' },
          { value: 'example', label: '范文模板' },
        ]}
      />
    </Form.Item>

    <Form.Item name="description" label="模板说明">
      <TextArea rows={2} placeholder="简要说明模板用途、适用范围或填写要求" />
    </Form.Item>
  </>
);
