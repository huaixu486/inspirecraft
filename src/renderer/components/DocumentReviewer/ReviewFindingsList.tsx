import React from 'react';
import { Button, Checkbox, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { CloseOutlined, DeleteOutlined, EditOutlined, SaveOutlined } from '@ant-design/icons';
import type { ReviewIssue, ReviewResult } from '../../../shared/types';

const { Paragraph, Text } = Typography;

export interface ReviewSectionFinding {
  key: string;
  title: string;
  issues: ReviewIssue[];
  aiProblems: string[];
  aiSuggestions: string[];
}

interface ReviewFindingsListProps {
  review: ReviewResult;
  findings: ReviewSectionFinding[];
  selectedKeys: Record<string, boolean>;
  deletedSuggestionKeys: Record<string, boolean>;
  createdSuggestionTaskKeys: Record<string, boolean>;
  suggestionDrafts: Record<string, string>;
  editingSuggestionKey: string;
  expandedSuggestionKey: string;
  getIssueTaskKey: (reviewId: string, issueId: string) => string;
  getSuggestionTaskKey: (reviewId: string, sectionTitle: string, index: number) => string;
  hasTaskForIssue: (reviewId: string, issueId: string) => boolean;
  onToggleSelection: (key: string, checked: boolean) => void;
  onSuggestionDraftChange: (key: string, value: string) => void;
  onEditingSuggestionChange: (key: string) => void;
  onExpandedSuggestionChange: (key: string) => void;
  onDeleteSuggestion: (key: string) => void;
}

const cleanLine = (value = '') => value
  .replace(/^[-*\s]+/, '')
  .replace(/^\d+[.、)]\s*/, '')
  .replace(/^【(.+)】$/, '$1')
  .replace(/^#+\s*/, '')
  .trim();
const normalizeKey = (value = '') => cleanLine(value)
  .replace(/^章节[:：]\s*/, '')
  .replace(/^部分[:：]\s*/, '')
  .replace(/^项目\d+\s*[-—:：]\s*/, '')
  .replace(/^第\s*\d+\s*部分\s*[:：-]?\s*/, '')
  .replace(/\s+/g, '')
  .replace(/[：:，,。；;（）()【】\[\]《》<>“”"'\-—_]/g, '')
  .toLowerCase();
const normalizeItems = (lines: string[], maxItems = 6) => {
  const seen = new Set<string>();
  return lines
    .flatMap(line => String(line || '').replace(/\r/g, '').replace(/^>\s*/gm, '').replace(/[“”]/g, '"').replace(/^['"]|['"]$/g, '').replace(/\n+/g, '\n').split(/\n|(?<=。)\s*(?=同样|例如|在原有|采用|建议|当前|程序|需人工|具体|补充)/))
    .map(line => cleanLine(line).replace(/^[-•·]\s*/, '').replace(/^[:：]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter(line => line && !/^(具体|表达|补充材料\/表达|以下是具体的改稿|的回应)$/.test(line))
    .filter(line => {
      const key = normalizeKey(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
};

const issueTag = (type: string) => {
  if (type === 'missing_section') return <Tag color="red">缺失章节</Tag>;
  if (type === 'wrong_format') return <Tag color="orange">格式错误</Tag>;
  if (type === 'content_deviation') return <Tag color="yellow">内容偏差</Tag>;
  return <Tag>其他</Tag>;
};

const NumberedItems: React.FC<{ items: string[]; tone: 'problem' | 'suggestion' }> = ({ items, tone }) => {
  if (!items.length) return <Text type="secondary">{tone === 'problem' ? '暂无具体问题描述。' : '暂无建议。'}</Text>;
  const color = tone === 'problem' ? '#ff4d4f' : '#1677ff';
  return <Space direction="vertical" size={8} style={{ width: '100%' }}>{items.map((item, index) => <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ width: 20, height: 20, lineHeight: '20px', textAlign: 'center', borderRadius: 10, background: tone === 'problem' ? '#fff1f0' : '#e6f4ff', color, fontSize: 12, flex: '0 0 auto', marginTop: 2 }}>{index + 1}</span><Paragraph style={{ marginBottom: 0, color: '#1f2937', lineHeight: 1.85, fontSize: 14 }} ellipsis={item.length > 260 ? { rows: 3, expandable: true, symbol: tone === 'problem' ? '展开问题' : '展开建议' } : false}>{item}</Paragraph></div>)}</Space>;
};

const ReviewFindingsList: React.FC<ReviewFindingsListProps> = ({ review, findings, selectedKeys, deletedSuggestionKeys, createdSuggestionTaskKeys, suggestionDrafts, editingSuggestionKey, expandedSuggestionKey, getIssueTaskKey, getSuggestionTaskKey, hasTaskForIssue, onToggleSelection, onSuggestionDraftChange, onEditingSuggestionChange, onExpandedSuggestionChange, onDeleteSuggestion }) => {
  if (!findings.length) return <Empty description="暂未发现需要处理的问题" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {findings.map(section => {
        const suggestionItems = normalizeItems(section.issues.map(issue => issue.suggestion).filter(Boolean) as string[], 5);
        const aiSuggestionItems = normalizeItems(section.aiSuggestions, 5);
        return (
          <div key={section.key} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
              <Text strong style={{ fontSize: 16, marginRight: 4 }}>{section.title}</Text>
              {section.issues.map(issue => <span key={issue.id}>{issueTag(issue.type)}</span>)}
              {section.aiProblems.length > 0 || section.aiSuggestions.length > 0 ? <Tag color="blue">AI补充</Tag> : null}
            </div>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ borderLeft: '3px solid #ff7875', background: '#fffafa', padding: '12px 14px', borderRadius: 6 }}>
                <Text strong style={{ display: 'block', marginBottom: 8, color: '#a8071a' }}>问题</Text>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {section.issues.length ? section.issues.map((issue, index) => {
                    const key = getIssueTaskKey(review.id, issue.id);
                    const disabled = hasTaskForIssue(review.id, issue.id);
                    return <div key={issue.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><Checkbox checked={Boolean(selectedKeys[key])} disabled={disabled} onChange={(event) => onToggleSelection(key, event.target.checked)} style={{ marginTop: 3 }} /><span style={{ width: 20, height: 20, lineHeight: '20px', textAlign: 'center', borderRadius: 10, background: '#fff1f0', color: '#ff4d4f', fontSize: 12, flex: '0 0 auto', marginTop: 2 }}>{index + 1}</span><div style={{ flex: 1, minWidth: 0 }}><Space size={6} wrap style={{ marginBottom: 4 }}>{issueTag(issue.type)}{disabled && <Tag color="green">已生成任务</Tag>}{issue.id.startsWith('custom-') && <Tag color="purple">用户补充</Tag>}</Space><Paragraph style={{ marginBottom: issue.suggestion ? 4 : 0, color: '#1f2937', lineHeight: 1.85, fontSize: 14 }}>{issue.message}</Paragraph>{issue.suggestion && <Text type="secondary" style={{ display: 'block', lineHeight: 1.7 }}>建议：{issue.suggestion}</Text>}</div></div>;
                  }) : <Text type="secondary">暂无具体问题描述。</Text>}
                  {section.aiProblems.length > 0 && <div style={{ marginTop: section.issues.length ? 10 : 0 }}><NumberedItems items={normalizeItems(section.aiProblems, 5)} tone="problem" /></div>}
                </Space>
              </div>
              <div style={{ borderLeft: '3px solid #69b1ff', background: '#f8fbff', padding: '12px 14px', borderRadius: 6 }}>
                <Text strong style={{ display: 'block', marginBottom: 8, color: '#0958d9' }}>建议</Text>
                {suggestionItems.length > 0 && <NumberedItems items={suggestionItems} tone="suggestion" />}
                {aiSuggestionItems.length > 0 && <div style={{ marginTop: suggestionItems.length ? 10 : 0, paddingTop: suggestionItems.length ? 10 : 0, borderTop: suggestionItems.length ? '1px solid #dbeafe' : 'none' }}><Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>点击建议条目后可编辑、删除或生成任务</Text><Space direction="vertical" size={8} style={{ width: '100%' }}>{aiSuggestionItems.map((item, originalIndex) => {
                  const suggestionKey = getSuggestionTaskKey(review.id, section.title, originalIndex);
                  if (deletedSuggestionKeys[suggestionKey]) return null;
                  const value = suggestionDrafts[suggestionKey] ?? item;
                  const editing = editingSuggestionKey === suggestionKey;
                  const expanded = expandedSuggestionKey === suggestionKey || editing;
                  const created = createdSuggestionTaskKeys[suggestionKey];
                  return <div key={suggestionKey} style={{ border: expanded ? '1px solid #91caff' : '1px solid #e5eefc', background: expanded ? '#fff' : '#f8fbff', borderRadius: 8, padding: expanded ? '10px 12px' : '8px 12px', cursor: editing ? 'default' : 'pointer', boxShadow: expanded ? '0 4px 14px rgba(22, 119, 255, 0.08)' : 'none' }} onClick={() => { if (!editing) onExpandedSuggestionChange(expanded ? '' : suggestionKey); }}><div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 28 }}><Checkbox checked={Boolean(selectedKeys[suggestionKey])} disabled={created} onClick={event => event.stopPropagation()} onChange={event => onToggleSelection(suggestionKey, event.target.checked)} /><span style={{ width: 22, height: 22, lineHeight: '22px', textAlign: 'center', borderRadius: 11, background: expanded ? '#1677ff' : '#e6f4ff', color: expanded ? '#fff' : '#1677ff', fontSize: 12, flex: '0 0 auto' }}>{suggestionItems.length + originalIndex + 1}</span><Text style={{ flex: 1, minWidth: 0, color: '#1f2937' }} ellipsis={!expanded ? { tooltip: value } : false}>{value}</Text>{created && <Tag color="green" style={{ marginInlineEnd: 0 }}>已生成</Tag>}</div>{expanded && <div style={{ marginTop: 10, paddingLeft: 32 }} onClick={event => event.stopPropagation()}>{editing ? <Input.TextArea value={value} autoSize={{ minRows: 2, maxRows: 6 }} onChange={event => onSuggestionDraftChange(suggestionKey, event.target.value)} /> : <Paragraph style={{ marginBottom: 0, color: '#334155', lineHeight: 1.8, fontSize: 14 }}>{value}</Paragraph>}<Space size={8} wrap style={{ marginTop: 8 }}>{editing ? <><Button size="small" icon={<SaveOutlined />} onClick={() => { onEditingSuggestionChange(''); message.success('已更新建议内容'); }}>保存</Button><Button size="small" icon={<CloseOutlined />} onClick={() => { onSuggestionDraftChange(suggestionKey, item); onEditingSuggestionChange(''); }}>取消</Button></> : <Button size="small" icon={<EditOutlined />} onClick={() => { onSuggestionDraftChange(suggestionKey, value); onExpandedSuggestionChange(suggestionKey); onEditingSuggestionChange(suggestionKey); }}>编辑</Button>}<Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeleteSuggestion(suggestionKey)}>删除</Button></Space></div>}</div>;
                })}</Space></div>}
              </div>
            </Space>
          </div>
        );
      })}
    </Space>
  );
};

export default ReviewFindingsList;
