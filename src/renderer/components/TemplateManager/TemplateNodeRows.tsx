import React from 'react';
import { Button, Dropdown, Input, Typography } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  DownOutlined,
  HolderOutlined,
  MinusOutlined,
  PlusOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { TemplateNode } from '../../../shared/types';

const { Text } = Typography;
const { TextArea } = Input;

const nodeMatchesFilter = (node: TemplateNode, levels: number[]): boolean =>
  levels.includes(node.level) || Boolean(node.children?.some(child => nodeMatchesFilter(child, levels)));

interface TemplateNodeRowCommonProps {
  nodes: TemplateNode[];
  activeLevels: number[];
  collapsedNodeIds: Set<string>;
  activeNodeId: string;
  selectedNodeIds: Set<string>;
  onToggleCollapsed: (nodeId: string) => void;
  onSelectionChange: (nodeId: string, checked: boolean, shiftKey: boolean) => void;
}

interface TemplatePreviewNodeRowsProps extends TemplateNodeRowCommonProps {
  onFocus: (nodeId: string) => void;
}

export const TemplatePreviewNodeRows: React.FC<TemplatePreviewNodeRowsProps> = props => {
  const renderRows = (nodes: TemplateNode[], depth = 0, prefix: number[] = []): React.ReactNode[] =>
    nodes
      .filter(node => nodeMatchesFilter(node, props.activeLevels))
      .map((node, index) => {
        const hasChildren = Boolean(node.children?.length);
        const isCollapsed = props.collapsedNodeIds.has(node.id);
        const nodeNumber = [...prefix, index + 1];
        const nodeVisible = props.activeLevels.includes(node.level);
        const isSelected = props.selectedNodeIds.has(node.id);
        const rowClassName = [
          'template-node-preview-row',
          props.activeNodeId === node.id ? 'active' : '',
          isSelected ? 'selected' : '',
        ].filter(Boolean).join(' ');

        return (
          <React.Fragment key={node.id}>
            <div
              className={rowClassName}
              style={{ paddingLeft: 8 + depth * 16, opacity: nodeVisible ? 1 : 0.4 }}
              onClick={() => props.onFocus(node.id)}
            >
              {hasChildren ? (
                <Button
                  className="template-preview-collapse"
                  type="text"
                  size="small"
                  icon={isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                  onClick={event => {
                    event.stopPropagation();
                    props.onToggleCollapsed(node.id);
                  }}
                />
              ) : (
                <span className="template-preview-collapse-spacer" />
              )}
              <input
                type="checkbox"
                className="template-node-preview-selectbox"
                checked={nodeVisible && isSelected}
                disabled={!nodeVisible}
                title={nodeVisible ? '选择该章节' : '仅作为层级上下文显示'}
                onClick={event => event.stopPropagation()}
                onChange={event => {
                  if (!nodeVisible) return;
                  props.onSelectionChange(
                    node.id,
                    event.target.checked,
                    (event.nativeEvent as MouseEvent).shiftKey,
                  );
                }}
              />
              <span className="template-node-level">{nodeNumber.join('.')}</span>
              <Text strong style={{ fontSize: 12 }} ellipsis={{ tooltip: node.title }}>{node.title}</Text>
            </div>
            {hasChildren && !isCollapsed && (
              <div className="template-node-preview-children">
                <div className="template-node-preview-children-inner">
                  {renderRows(node.children || [], depth + 1, nodeNumber)}
                </div>
              </div>
            )}
          </React.Fragment>
        );
      });

  return <>{renderRows(props.nodes)}</>;
};

interface TemplateEditorNodeRowsProps extends TemplateNodeRowCommonProps {
  canMoveUp: (nodeId: string) => boolean;
  canMoveDown: (nodeId: string) => boolean;
  getRuleText: (node: TemplateNode) => string;
  onCardRef: (nodeId: string, element: HTMLDivElement | null) => void;
  onUpdate: (nodeId: string, updates: Partial<TemplateNode>) => void;
  onLevelChange: (nodeId: string, level: number) => void;
  onMove: (nodeId: string, direction: 'up' | 'down') => void;
  onRemove: (nodeId: string) => void;
}

export const TemplateEditorNodeRows: React.FC<TemplateEditorNodeRowsProps> = props => {
  const renderLevelControl = (node: TemplateNode) => {
    const level = Math.min(Math.max(node.level || 1, 1), 4);
    const setLevel = (nextLevel: number) => props.onLevelChange(node.id, Math.min(Math.max(nextLevel, 1), 4));

    return (
      <div className="template-node-level-stepper">
        <Button
          className="template-node-level-step"
          type="text"
          size="small"
          icon={<MinusOutlined />}
          disabled={level <= 1}
          onClick={() => setLevel(level - 1)}
        />
        <Dropdown
          trigger={['click']}
          menu={{
            selectedKeys: [String(level)],
            items: [1, 2, 3, 4].map(itemLevel => ({
              key: String(itemLevel),
              label: `第 ${itemLevel} 级`,
              onClick: () => setLevel(itemLevel),
            })),
          }}
        >
          <Button className="template-node-level-current" size="small">第 {level} 级</Button>
        </Dropdown>
        <Button
          className="template-node-level-step"
          type="text"
          size="small"
          icon={<PlusOutlined />}
          disabled={level >= 4}
          onClick={() => setLevel(level + 1)}
        />
      </div>
    );
  };

  const renderRows = (nodes: TemplateNode[], depth = 0, prefix: number[] = []): React.ReactNode[] =>
    nodes
      .filter(node => nodeMatchesFilter(node, props.activeLevels))
      .map((node, index) => {
        const hasChildren = Boolean(node.children?.length);
        const isCollapsed = props.collapsedNodeIds.has(node.id);
        const nodeNumber = [...prefix, index + 1];
        const isSelected = props.selectedNodeIds.has(node.id);
        const nodeVisible = props.activeLevels.includes(node.level);
        const ruleText = props.getRuleText(node);

        return (
          <React.Fragment key={node.id}>
            <div
              ref={element => props.onCardRef(node.id, element)}
              className={`template-node-card${props.activeNodeId === node.id ? ' active' : ''}${nodeVisible ? '' : ' filtered-context'}`}
              style={{ marginLeft: depth * 18 }}
            >
              <div className="template-node-order">
                <input
                  type="checkbox"
                  className="template-node-selectbox"
                  checked={nodeVisible && isSelected}
                  disabled={!nodeVisible}
                  title={nodeVisible ? '选择该筛选结果' : '仅作为层级上下文显示'}
                  onChange={event => {
                    if (!nodeVisible) return;
                    props.onSelectionChange(
                      node.id,
                      event.target.checked,
                      (event.nativeEvent as MouseEvent).shiftKey,
                    );
                  }}
                />
                {hasChildren ? (
                  <Button
                    className="template-node-collapse"
                    type="text"
                    size="small"
                    icon={isCollapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                    onClick={() => props.onToggleCollapsed(node.id)}
                  />
                ) : (
                  <span className="template-node-collapse-spacer" />
                )}
                <HolderOutlined className="template-node-handle" />
                <span className="template-node-index">{nodeNumber.join('.')}</span>
              </div>

              <div className="template-node-content">
                <Input
                  className="template-node-title-input"
                  value={node.title}
                  onChange={event => props.onUpdate(node.id, { title: event.target.value })}
                  placeholder="例如：一、项目概述"
                />
                <div className="template-node-subline">
                  {renderLevelControl(node)}
                  <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                    {ruleText ? '已识别章节写作规则/要求，可继续修改' : '可填写该章节的写作规则与审阅重点'}
                  </Text>
                </div>
                <TextArea
                  className="template-node-description-input"
                  value={ruleText}
                  onChange={event => props.onUpdate(node.id, {
                    description: event.target.value,
                    requirementText: event.target.value,
                  })}
                  placeholder="填写该章节的写作规则、内容要求、格式要求、写作方法或审阅重点"
                  autoSize={{ minRows: 1, maxRows: 4 }}
                />
              </div>

              <div className="template-node-actions">
                <Button
                  className={node.isRequired ? 'template-node-required active' : 'template-node-required'}
                  size="small"
                  onClick={() => props.onUpdate(node.id, { isRequired: !node.isRequired })}
                >
                  {node.isRequired ? '必需' : '可选'}
                </Button>
                <div className="template-node-move">
                  <Button
                    type="text"
                    size="small"
                    disabled={!props.canMoveUp(node.id)}
                    icon={<UpOutlined />}
                    onClick={() => props.onMove(node.id, 'up')}
                  />
                  <Button
                    type="text"
                    size="small"
                    disabled={!props.canMoveDown(node.id)}
                    icon={<DownOutlined />}
                    onClick={() => props.onMove(node.id, 'down')}
                  />
                </div>
                <Button
                  className="template-node-delete"
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => props.onRemove(node.id)}
                />
              </div>
            </div>
            {hasChildren && !isCollapsed && (
              <div className="template-node-editor-children">
                <div className="template-node-editor-children-inner">
                  {renderRows(node.children || [], depth + 1, nodeNumber)}
                </div>
              </div>
            )}
          </React.Fragment>
        );
      });

  return <>{renderRows(props.nodes)}</>;
};
