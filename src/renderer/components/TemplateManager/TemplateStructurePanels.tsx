import React from 'react';
import { Button, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface TemplateStructureToolbarProps {
  allFilteredSelected: boolean;
  someFilteredSelected: boolean;
  filteredCount: number;
  nodeTotal: number;
  requiredTotal: number;
  selectedFilteredCount: number;
  selectedCascadeCount: number;
  availableLevels: number[];
  activeLevels: number[];
  onToggleFilteredSelection: () => void;
  onLevelsChange: (levels: number[]) => void;
  onDeleteSelected: () => void;
  onAddNode: () => void;
}

export const TemplateStructureToolbar: React.FC<TemplateStructureToolbarProps> = ({
  allFilteredSelected,
  someFilteredSelected,
  filteredCount,
  nodeTotal,
  requiredTotal,
  selectedFilteredCount,
  selectedCascadeCount,
  availableLevels,
  activeLevels,
  onToggleFilteredSelection,
  onLevelsChange,
  onDeleteSelected,
  onAddNode,
}) => (
  <div className="template-node-toolbar">
    <div className="template-node-toolbar-title">
      <div className="template-node-bulk-select">
        <input
          type="checkbox"
          className="template-node-selectbox"
          checked={allFilteredSelected}
          ref={element => { if (element) element.indeterminate = someFilteredSelected; }}
          disabled={filteredCount === 0}
          onChange={onToggleFilteredSelection}
        />
      </div>
      <div>
        <Text strong>模板章节结构</Text>
        <div className="template-node-toolbar-meta">
          <span>共 {nodeTotal} 个章节</span>
          <span>{requiredTotal} 个必需项</span>
          <span>当前筛选 {filteredCount} 项</span>
          {selectedFilteredCount > 0 && <Tag color="blue">已选 {selectedFilteredCount} 项</Tag>}
          {selectedCascadeCount > selectedFilteredCount && <Tag color="orange">含子章节共 {selectedCascadeCount} 项</Tag>}
        </div>
      </div>
    </div>

    <Space wrap size={8}>
      {availableLevels.length > 0 && (
        <Select
          mode="multiple"
          size="small"
          className="template-node-filter-select"
          placeholder="筛选标题级别"
          value={activeLevels}
          onChange={onLevelsChange}
          maxTagCount={2}
          options={availableLevels.map(level => ({
            value: level,
            label: `${['一', '二', '三', '四'][level - 1] || level}级标题`,
          }))}
        />
      )}
      <Button
        size="small"
        disabled={filteredCount === 0}
        onClick={onToggleFilteredSelection}
      >
        {allFilteredSelected ? '取消全选' : '全选筛选结果'}
      </Button>
      {selectedFilteredCount > 0 && (
        <Popconfirm
          title={`确定删除当前选中的 ${selectedFilteredCount} 个筛选结果？`}
          description={selectedCascadeCount > selectedFilteredCount
            ? `其中包含父章节，删除后会连同子章节共删除 ${selectedCascadeCount} 个章节。`
            : '删除后会重新计算模板结构。'}
          onConfirm={onDeleteSelected}
        >
          <Button size="small" danger>删除选中 ({selectedFilteredCount})</Button>
        </Popconfirm>
      )}
      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={onAddNode}>
        添加章节
      </Button>
    </Space>
  </div>
);

interface TemplateStructurePreviewProps {
  hasNodes: boolean;
  rows: React.ReactNode;
}

export const TemplateStructurePreview: React.FC<TemplateStructurePreviewProps> = ({ hasNodes, rows }) => (
  <div className="template-editor-side">
    <Text strong>结构预览</Text>
    <div className="template-node-preview">
      {hasNodes ? rows : <Text type="secondary" style={{ fontSize: 12 }}>暂无章节</Text>}
    </div>
  </div>
);
