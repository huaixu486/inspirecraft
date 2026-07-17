import React from 'react';
import { Button, Input, Popover } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

interface ProjectFileSearchControlProps {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
}

const ProjectFileSearchControl: React.FC<ProjectFileSearchControlProps> = ({
  open,
  query,
  onOpenChange,
  onQueryChange,
}) => (
  <>
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={onOpenChange}
      content={(
        <Input
          autoFocus
          allowClear
          size="middle"
          prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
          placeholder="搜索文件名 / 后缀"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onPressEnter={() => onOpenChange(false)}
          style={{ width: 260, borderRadius: 8 }}
        />
      )}
    >
      <Button type={query ? 'primary' : 'default'} icon={<SearchOutlined />} size="middle" style={{ borderRadius: 8 }}>
        搜索
      </Button>
    </Popover>
    <Input
      hidden
      allowClear
      size="middle"
      prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
      placeholder="搜索文件名 / 后缀"
      value={query}
      onChange={event => onQueryChange(event.target.value)}
      style={{ display: 'none' }}
    />
  </>
);

export default ProjectFileSearchControl;
