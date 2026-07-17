import React from 'react';
import { FileOutlined, FolderOutlined } from '@ant-design/icons';
import type { TreeStats } from './useProjectFileData';
import { formatFileSize } from './ProjectFileListRow';

interface ProjectFileStatsProps {
  stats: TreeStats;
  activeFilter: string | null;
  onFilterChange: (filter: string | null) => void;
}

const typeAccent = (ext: string) => {
  if (ext === '.doc' || ext === '.docx') return '#2f80ed';
  if (ext === '.pdf') return '#ef5350';
  if (ext === '.xls' || ext === '.xlsx') return '#2fb344';
  if (ext === '.ppt' || ext === '.pptx') return '#f59e0b';
  if (ext === '其他') return '#7b8794';
  return '#6c7a89';
};

const ProjectFileStats: React.FC<ProjectFileStatsProps> = ({ stats, activeFilter, onFilterChange }) => {
  const typeStats = Object.entries(stats.typeCount || {})
    .sort(([leftExt, leftCount], [rightExt, rightCount]) => {
      const leftIsEmpty = Number(leftCount) === 0;
      const rightIsEmpty = Number(rightCount) === 0;
      if (leftIsEmpty !== rightIsEmpty) return leftIsEmpty ? 1 : -1;
      const countDelta = Number(rightCount) - Number(leftCount);
      return countDelta || leftExt.localeCompare(rightExt);
    });

  return (
    <section className="file-explorer-stats" aria-label="文件统计">
      <div className="file-explorer-stats-primary">
        <button
          type="button"
          className={`file-explorer-stat-primary${activeFilter === null ? ' is-active' : ''}`}
          onClick={() => onFilterChange(null)}
        >
          <FileOutlined className="file-explorer-stat-icon" />
          <span className="file-explorer-stat-copy">
            <strong>{stats.fileCount.toLocaleString()}</strong>
            <span>文件</span>
          </span>
        </button>
        <div className="file-explorer-stat-size">
          <span>数据占用</span>
          <strong>{formatFileSize(stats.totalSize)}</strong>
        </div>
        <button
          type="button"
          className={`file-explorer-stat-folder${activeFilter === '__dir__' ? ' is-active' : ''}`}
          onClick={() => onFilterChange(activeFilter === '__dir__' ? null : '__dir__')}
        >
          <FolderOutlined />
          <span><strong>{stats.folderCount.toLocaleString()}</strong> 文件夹</span>
        </button>
      </div>

      {typeStats.length > 0 && (
        <div className="file-explorer-stats-types" aria-label="文件类型筛选">
          <span className="file-explorer-stats-types-label">按类型</span>
          {typeStats.map(([ext, count]) => (
            <button
              key={ext}
              type="button"
              className={`file-explorer-type-stat${activeFilter === ext ? ' is-active' : ''}${Number(count) === 0 ? ' is-empty' : ''}`}
              style={{ '--type-accent': typeAccent(ext) } as React.CSSProperties}
              onClick={() => onFilterChange(activeFilter === ext ? null : ext)}
            >
              <i aria-hidden="true" />
              <span>{ext.replace('.', '').toUpperCase() || '其他'}</span>
              <strong>{Number(count).toLocaleString()}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export default ProjectFileStats;
