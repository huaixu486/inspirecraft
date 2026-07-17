import React from 'react';
import { AutoComplete, Form, InputNumber, Select, Switch, Tag, Typography } from 'antd';
import { formatRuleRows } from './templateFormatRuleConfig';

const { Text } = Typography;

const fontSizeOptions = [
  { value: 22, label: '二号 / 22pt' },
  { value: 16, label: '三号 / 16pt' },
  { value: 15, label: '小三 / 15pt' },
  { value: 14, label: '四号 / 14pt' },
  { value: 12, label: '小四 / 12pt' },
  { value: 10.5, label: '五号 / 10.5pt' },
  { value: 9, label: '小五 / 9pt' },
];

interface FontOption {
  value: string;
}

interface TemplateFormatRulesSectionProps {
  enabled: boolean;
  evidence: string[];
  fontOptions: FontOption[];
}

export const TemplateFormatRulesSection: React.FC<TemplateFormatRulesSectionProps> = ({
  enabled,
  evidence,
  fontOptions,
}) => (
  <>
    <div className="template-format-toggle">
      <div>
        <Text strong>默认格式规则</Text>
        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          可选；开启后会在脚本创建 Word 文档时写入标题和正文样式。
        </Text>
      </div>
      <Form.Item name="enableFormatRules" valuePropName="checked" style={{ margin: 0 }}>
        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
      </Form.Item>
    </div>

    {enabled && evidence.length > 0 && (
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#f8fbff', marginBottom: 10 }}>
        <Text strong style={{ fontSize: 12 }}>格式识别依据</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {evidence.map(item => <Tag key={item} color="blue" style={{ margin: 0 }}>{item}</Tag>)}
        </div>
      </div>
    )}

    {enabled && (
      <div className="template-format-table">
        <div className="template-format-head">
          <span>样式</span>
          <span>字体</span>
          <span>字号</span>
          <span>字间距</span>
          <span>行间距</span>
          <span>字重</span>
        </div>
        {formatRuleRows.map(row => (
          <div className="template-format-row" key={row.key}>
            <Text strong style={{ fontSize: 12 }}>{row.label}</Text>
            <Form.Item name={['formatRules', row.key, 'fontFamily']} style={{ margin: 0 }}>
              <AutoComplete
                options={fontOptions}
                placeholder="字体"
                filterOption={(input, option) =>
                  String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name={['formatRules', row.key, 'fontSize']} style={{ margin: 0 }}>
              <Select options={fontSizeOptions} placeholder="字号" />
            </Form.Item>
            <Form.Item name={['formatRules', row.key, 'letterSpacing']} style={{ margin: 0 }}>
              <InputNumber min={0} max={20} step={0.5} addonAfter="pt" />
            </Form.Item>
            <Form.Item name={['formatRules', row.key, 'lineHeight']} style={{ margin: 0 }}>
              <InputNumber min={1} max={3} step={0.1} />
            </Form.Item>
            <Form.Item name={['formatRules', row.key, 'fontWeight']} style={{ margin: 0 }}>
              <Select options={[{ value: 'normal', label: '常规' }, { value: 'bold', label: '加粗' }]} />
            </Form.Item>
          </div>
        ))}
      </div>
    )}
  </>
);
