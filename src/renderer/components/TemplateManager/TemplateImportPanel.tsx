import React from 'react';
import { Button, Segmented, Typography } from 'antd';
import { DeleteOutlined, ImportOutlined } from '@ant-design/icons';

const { Text } = Typography;

export interface ImportedTemplateFile {
  filePath: string;
  text: string;
  fileName?: string;
}

interface StructureViewOption {
  value: string;
  label: string;
}

interface TemplateImportPanelProps {
  templateType?: string;
  files: ImportedTemplateFile[];
  structureView: string;
  structureViewOptions: StructureViewOption[];
  extracting: boolean;
  aiExtracting: boolean;
  aiExtractStatus: string;
  aiExtractElapsedSeconds: number;
  onRemoveFile: (index: number) => void;
  onStructureViewChange: (value: string) => void;
  onImport: () => void;
  onAiExtract: () => void;
  onResetAiExtract: () => void;
}

export const TemplateImportPanel: React.FC<TemplateImportPanelProps> = ({
  templateType,
  files,
  structureView,
  structureViewOptions,
  extracting,
  aiExtracting,
  aiExtractStatus,
  aiExtractElapsedSeconds,
  onRemoveFile,
  onStructureViewChange,
  onImport,
  onAiExtract,
  onResetAiExtract,
}) => (
  <div className="template-import-panel">
    <div>
      <Text strong>从文件导入结构</Text>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
        {templateType === 'example'
          ? '支持导入多个范文文件；可切换查看单篇范文结构，合并结构由 AI 综合生成建议性写作大纲。'
          : '支持 .doc/.docx/.ppt/.pptx/.xls/.xlsx/.pdf/.txt/.md/.rtf，自动识别章节标题并保留源文件用于后续创建文件。'}
      </Text>

      {files.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {files.map((file, index) => (
            <div key={`${file.filePath}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <Text type="secondary" ellipsis style={{ flex: 1 }}>
                {index + 1}. {file.fileName || file.filePath.split(/[/\\]/).pop()}
              </Text>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onRemoveFile(index)}
              />
            </div>
          ))}
        </div>
      )}

      {templateType === 'example' && files.length > 0 && (
        <div className="template-example-view-switch">
          <Text type="secondary" style={{ fontSize: 12 }}>结构视图</Text>
          <Segmented
            size="small"
            value={structureView}
            onChange={value => onStructureViewChange(String(value))}
            options={structureViewOptions}
          />
        </div>
      )}
    </div>

    <div className="template-import-actions">
      <Button block icon={<ImportOutlined />} loading={extracting} onClick={onImport}>
        {templateType === 'example' && files.length > 0 ? '继续添加文件' : '选择文件'}
      </Button>
      <Button
        block
        className={aiExtracting ? 'template-ai-running-button' : undefined}
        disabled={files.length === 0}
        loading={aiExtracting}
        onClick={onAiExtract}
      >
        {aiExtracting ? `AI识别中 ${aiExtractElapsedSeconds}s` : 'AI识别结构/规则/格式'}
      </Button>
      {(aiExtracting || aiExtractStatus) && (
        <div className="template-ai-status">
          {aiExtracting && <span className="template-ai-status-dot" />}
          <span>{aiExtractStatus || 'AI 正在运行'}</span>
          {aiExtracting && (
            <Button
              type="link"
              size="small"
              className="template-ai-status-reset"
              onClick={onResetAiExtract}
            >
              重置
            </Button>
          )}
        </div>
      )}
    </div>
  </div>
);
