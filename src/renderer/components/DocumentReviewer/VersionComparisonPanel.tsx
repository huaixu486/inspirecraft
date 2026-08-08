import React from 'react';
import { Button, Card, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ExclamationCircleOutlined, RobotOutlined, SwapOutlined } from '@ant-design/icons';
import type { DocumentDiffLine, DocumentDiffRowKind, DocumentDiffStats } from '../../utils/documentDiff';

const { Paragraph, Text } = Typography;

interface ComparableVersion { id: string; source: string; fileName: string; filePath?: string; content: string; createdAt: string }
interface FormatDiffItem { key: string; index: number; title: string; summary: string; fieldChanges: Array<{ fieldKey: string; text: string }> }
interface DiffRow { kind: DocumentDiffRowKind; left?: DocumentDiffLine; right?: DocumentDiffLine; formatDiff?: FormatDiffItem }

interface VersionComparisonPanelProps {
  stageName?: string;
  versions: ComparableVersion[];
  selectedA: string;
  selectedB: string;
  metaA?: ComparableVersion;
  metaB?: ComparableVersion;
  parsingById: Record<string, boolean>;
  isAnalyzing: boolean;
  diffStats: DocumentDiffStats;
  formatStatusById: Record<string, { loading?: boolean; error?: string }>;
  formatDiffs: FormatDiffItem[];
  selectedFormatDiffs: FormatDiffItem[];
  selectedFormatDiffKeys: Record<string, boolean>;
  diffRows: DiffRow[];
  applyingFormat: string;
  diffAnalysis: string;
  formatVersionDate: (date?: string) => string;
  getSourceLabel: (source: any) => string;
  canReadFormat: (version?: any) => boolean;
  onSelectA: (id: string) => void;
  onSelectB: (id: string) => void;
  onAnalyze: () => void;
  onSelectAllFormats: () => void;
  onToggleFormat: (key: string, selected: boolean) => void;
  onApplyFormat: (source: 'A' | 'B') => void;
}

const VersionComparisonPanel: React.FC<VersionComparisonPanelProps> = ({
  stageName, versions, selectedA, selectedB, metaA, metaB, parsingById, isAnalyzing, diffStats, formatStatusById, formatDiffs, selectedFormatDiffs, selectedFormatDiffKeys, diffRows, applyingFormat, diffAnalysis, formatVersionDate, getSourceLabel, canReadFormat, onSelectA, onSelectB, onAnalyze, onSelectAllFormats, onToggleFormat, onApplyFormat,
}) => {
  const selectedKeySet = new Set(selectedFormatDiffs.map(item => item.key));
  const renderCell = (line: DocumentDiffLine | undefined, side: 'left' | 'right', isLast: boolean) => {
    const textColor = !line ? '#64748b' : line.type === 'equal' ? '#cbd5e1' : line.type === 'delete' || side === 'left' ? '#fca5a5' : '#86efac';
    const background = !line ? '#0f172a' : line.type === 'equal' ? '#111827' : line.type === 'delete' || side === 'left' ? '#3a1a1a' : '#16351f';
    return (
      <div style={{ minHeight: 32, display: 'flex', alignItems: 'stretch', minWidth: 0, fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace", fontSize: 12.5, lineHeight: 1.65, background, borderBottom: isLast ? 'none' : '1px solid rgba(148, 163, 184, 0.16)', borderRight: side === 'left' ? '1px solid #d1d5db' : undefined, borderLeft: side === 'right' ? '1px solid #d1d5db' : undefined }}>
        <span style={{ width: 42, flexShrink: 0, padding: '5px 6px 5px 0', textAlign: 'right', color: line ? '#64748b' : '#334155', background: 'rgba(255,255,255,0.04)', borderRight: '1px solid rgba(255,255,255,0.08)', userSelect: 'none' }}>{side === 'left' ? line?.lineA || '' : line?.lineB || ''}</span>
        <span style={{ width: 20, flexShrink: 0, padding: '5px 0', textAlign: 'center', color: textColor, fontWeight: 700, userSelect: 'none' }}>{!line ? '' : line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' '}</span>
        <span style={{ flex: 1, minWidth: 0, padding: '5px 10px 5px 4px', color: textColor, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{line?.charDiffs?.length ? line.charDiffs.map(([operation, text], index) => <span key={`${index}-${operation}`} style={{ color: operation === 0 ? '#e5e7eb' : textColor, background: operation === 0 ? 'transparent' : side === 'left' ? 'rgba(239, 68, 68, 0.28)' : 'rgba(34, 197, 94, 0.24)', borderRadius: operation === 0 ? 0 : 2 }}>{text}</span>) : line?.text || ' '}</span>
      </div>
    );
  };

  return (
    <Card
      title={stageName ? `版本对比 · ${stageName}` : '版本对比'}
      size="small"
      className="review-version-compare-card"
      styles={{ body: { overflow: 'hidden' } }}
      extra={<Space size={8} wrap>{selectedA && selectedB && <Button icon={<SwapOutlined />} size="small" onClick={() => { onSelectA(selectedB); onSelectB(selectedA); }} title="交换 A/B 版本" />}<Button type="primary" icon={<RobotOutlined />} loading={isAnalyzing} disabled={!selectedA || !selectedB || Boolean(parsingById[selectedA] || parsingById[selectedB])} onClick={onAnalyze}>AI 分析对比</Button></Space>}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'stretch', width: '100%', minWidth: 0 }}>
          {[{ label: '基准 (A)', placeholder: '选择基准版本', value: selectedA, meta: metaA, onChange: onSelectA }, { label: '对比 (B)', placeholder: '选择对比版本', value: selectedB, meta: metaB, onChange: onSelectB }].map(item => (
            <div key={item.label} className="review-version-selector">
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{item.label}</Text>
              <Select showSearch size="small" style={{ width: '100%', marginTop: 6, minWidth: 0 }} placeholder={item.placeholder} value={item.value || undefined} optionFilterProp="label" onChange={item.onChange} options={versions.map(version => ({ value: version.id, label: `${version.fileName} · ${formatVersionDate(version.createdAt)}` }))} />
              {item.meta && <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 11 }} ellipsis={{ tooltip: item.meta.fileName }}>{item.meta.content.length.toLocaleString()} 字 · {getSourceLabel(item.meta.source)} · {item.meta.fileName}</Text>}
            </div>
          ))}
        </div>

        {selectedA && selectedB ? (
          <>
            <div style={{ display: 'flex', gap: 16, rowGap: 6, flexWrap: 'wrap', padding: '8px 16px', background: '#f6f8fa', borderRadius: 8, fontSize: 13 }}>
              <span style={{ color: '#8c8c8c' }}>共 <strong>{diffStats.total}</strong> 段</span><span style={{ color: '#52c41a' }}>+{diffStats.insert} 新增</span><span style={{ color: '#ff4d4f' }}>-{diffStats.delete} 删除</span><span style={{ color: '#fa8c16' }}>{diffStats.modified} 修改</span><span style={{ color: '#8c8c8c' }}>{diffStats.equal} 未变</span>
              {diffStats.total > 0 && <span style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 12, whiteSpace: 'nowrap' }}>变更率 {((diffStats.insert + diffStats.delete + diffStats.modified) / diffStats.total * 100).toFixed(1)}%</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, rowGap: 6, flexWrap: 'wrap', padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffe7ba', borderRadius: 8 }}>
              {!metaA || !metaB ? <Text type="secondary">请选择两个文档后查看格式差异</Text> : !canReadFormat(metaA) || !canReadFormat(metaB) ? <Text type="secondary">格式对比暂只支持 Word 文档，当前仅显示内容差异</Text> : formatStatusById[metaA.id]?.loading || formatStatusById[metaB.id]?.loading ? <><Spin size="small" /><Text type="secondary">正在提取段落格式...</Text></> : formatStatusById[metaA.id]?.error || formatStatusById[metaB.id]?.error ? <Text type="secondary">格式提取失败：{formatStatusById[metaA.id]?.error || formatStatusById[metaB.id]?.error}</Text> : <><Tag color={formatDiffs.length > 0 ? 'orange' : 'green'} style={{ margin: 0 }}>格式差异 {formatDiffs.length} 处</Tag><Text type="secondary" style={{ fontSize: 12 }}>格式差异已用行首感叹号标注，悬停查看说明，点击即可选择</Text>{formatDiffs.length > 0 && <Button size="small" onClick={onSelectAllFormats}>全选格式差异</Button>}<Button size="small" disabled={selectedFormatDiffs.length === 0 || !canReadFormat(metaA) || !metaB?.filePath} loading={applyingFormat === 'A'} onClick={() => onApplyFormat('A')}>套用 A 格式到 B</Button><Button size="small" disabled={selectedFormatDiffs.length === 0 || !canReadFormat(metaB) || !metaA?.filePath} loading={applyingFormat === 'B'} onClick={() => onApplyFormat('B')}>套用 B 格式到 A</Button></>}
            </div>

            {formatDiffs.length > 0 && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, rowGap: 6, flexWrap: 'wrap', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8 }}><Text strong style={{ fontSize: 12, flex: '0 0 auto' }}>已选择格式：</Text>{selectedFormatDiffs.length === 0 ? <Text type="secondary" style={{ fontSize: 12 }}>点击内容行前的感叹号，选择要套用格式的段落</Text> : <Space size={6} wrap style={{ flex: 1, minWidth: 0 }}>{selectedFormatDiffs.map(item => <Tag key={item.key} color="orange" closable onClose={() => onToggleFormat(item.key, false)} style={{ maxWidth: 520, whiteSpace: 'normal', lineHeight: 1.5, margin: 0 }}>{item.title}：{item.summary}</Tag>)}</Space>}</div>}

            <div style={{ maxHeight: 520, overflowY: 'auto', overflowX: 'hidden', background: '#f8fafc', border: '1px solid #d1d5db', borderRadius: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 34px minmax(0, 1fr)', width: '100%', minWidth: 0 }}>
                <div style={{ position: 'sticky', top: 0, zIndex: 3, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', color: '#374151', fontWeight: 600 }}>A 文档</div><div style={{ position: 'sticky', top: 0, zIndex: 3, background: '#f8fafc', borderBottom: '1px solid #d1d5db' }} /><div style={{ position: 'sticky', top: 0, zIndex: 3, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #d1d5db', borderLeft: '1px solid #d1d5db', color: '#374151', fontWeight: 600 }}>B 文档</div>
                {diffRows.map((row, index) => {
                  const isLast = index === diffRows.length - 1;
                  const formatDiff = row.formatDiff;
                  return <React.Fragment key={index}>{renderCell(row.left, 'left', isLast)}<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 32, background: '#f8fafc', borderBottom: isLast ? 'none' : '1px solid #e5e7eb' }}>{formatDiff && <Tooltip placement="top" title={<div style={{ maxWidth: 360 }}><div style={{ fontWeight: 600, marginBottom: 4 }}>{formatDiff.title}</div>{formatDiff.fieldChanges.slice(0, 6).map(change => <div key={change.fieldKey} style={{ lineHeight: 1.7 }}>{change.text}</div>)}{formatDiff.fieldChanges.length > 6 && <div>还有 {formatDiff.fieldChanges.length - 6} 项格式差异</div>}<div style={{ marginTop: 6, opacity: 0.8 }}>点击图标可选择或取消该段格式</div></div>}><button type="button" aria-label={`${formatDiff.title}，点击选择或取消`} aria-pressed={Boolean(selectedFormatDiffKeys[formatDiff.key])} onClick={(event) => { event.stopPropagation(); onToggleFormat(formatDiff.key, !selectedFormatDiffKeys[formatDiff.key]); }} style={{ width: 19, height: 19, borderRadius: '50%', border: selectedKeySet.has(formatDiff.key) ? '1px solid #d97706' : '1px solid #f59e0b', background: selectedKeySet.has(formatDiff.key) ? '#f59e0b' : '#fff7ed', color: selectedKeySet.has(formatDiff.key) ? '#111827' : '#d97706', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', boxShadow: selectedKeySet.has(formatDiff.key) ? '0 0 0 2px rgba(245, 158, 11, 0.22)' : 'none' }}><ExclamationCircleOutlined style={{ fontSize: 13 }} /></button></Tooltip>}</div>{renderCell(row.right, 'right', isLast)}</React.Fragment>;
                })}
              </div>
              {diffRows.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>两个版本内容完全相同</div>}
            </div>
          </>
        ) : <div className="review-compare-placeholder"><SwapOutlined /><div><Text strong>{versions.length >= 2 ? '选择两个版本开始对比' : '当前阶段缺少可对比版本'}</Text><Text type="secondary">{versions.length >= 2 ? '在上方分别选择基准版本与对比版本' : '至少需要两个文档版本，可先导入或新建阶段文件'}</Text></div></div>}

        {diffAnalysis && <div style={{ border: '1px solid #dbeafe', borderRadius: 8, background: '#f0f7ff', padding: '12px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><RobotOutlined style={{ color: '#1677ff' }} /><Text strong style={{ color: '#1677ff' }}>AI 分析报告</Text></div><Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13, lineHeight: 1.8 }}>{diffAnalysis}</Paragraph></div>}
      </Space>
    </Card>
  );
};

export default VersionComparisonPanel;
