import React, { useState, useMemo } from 'react';
import { Select, Card, Typography, Empty, Space, Tag, Statistic, Row, Col } from 'antd';
import { useProjectStore } from '../../stores/projectStore';
import DiffMatchPatch from 'diff-match-patch';

const { Text } = Typography;

interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  lineNumA?: number;
  lineNumB?: number;
}

const DiffViewer: React.FC = () => {
  const { currentProject, versions } = useProjectStore();
  const [selectedVersionA, setSelectedVersionA] = useState<string | null>(null);
  const [selectedVersionB, setSelectedVersionB] = useState<string | null>(null);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectVersions = versions.filter(
    (v) => v.projectId === currentProject.id
  );

  const getVersionContent = (versionId: string | null) => {
    if (!versionId) return '';
    const version = versions.find((v) => v.id === versionId);
    return version?.content || '';
  };

  const computeDiff = (textA: string, textB: string): DiffLine[] => {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(textA, textB);
    dmp.diff_cleanupSemantic(diffs);

    const lines: DiffLine[] = [];
    let lineNumA = 1;
    let lineNumB = 1;

    for (const [operation, text] of diffs) {
      const textLines = text.split('\n');

      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i];
        const isLastLine = i === textLines.length - 1;

        if (operation === DiffMatchPatch.DIFF_EQUAL) {
          lines.push({
            type: 'equal',
            text: line,
            lineNumA: lineNumA,
            lineNumB: lineNumB,
          });
          if (!isLastLine || line.length > 0) {
            lineNumA++;
            lineNumB++;
          }
        } else if (operation === DiffMatchPatch.DIFF_DELETE) {
          lines.push({
            type: 'delete',
            text: line,
            lineNumA: lineNumA,
          });
          if (!isLastLine || line.length > 0) {
            lineNumA++;
          }
        } else if (operation === DiffMatchPatch.DIFF_INSERT) {
          lines.push({
            type: 'insert',
            text: line,
            lineNumB: lineNumB,
          });
          if (!isLastLine || line.length > 0) {
            lineNumB++;
          }
        }
      }
    }

    return lines;
  };

  const contentA = getVersionContent(selectedVersionA);
  const contentB = getVersionContent(selectedVersionB);

  const diffResult = useMemo(() => {
    if (!selectedVersionA || !selectedVersionB) return [];
    return computeDiff(contentA, contentB);
  }, [contentA, contentB, selectedVersionA, selectedVersionB]);

  const stats = useMemo(() => {
    const equal = diffResult.filter(l => l.type === 'equal').length;
    const insert = diffResult.filter(l => l.type === 'insert').length;
    const deleteCount = diffResult.filter(l => l.type === 'delete').length;
    return { equal, insert, delete: deleteCount, total: diffResult.length };
  }, [diffResult]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 18 }}>
          {currentProject.name} - 版本对比
        </Text>
      </div>

      <Space style={{ marginBottom: 16 }} size="large">
        <div>
          <Text>基准版本：</Text>
          <Select
            style={{ width: 250 }}
            placeholder="选择基准版本"
            onChange={(value) => setSelectedVersionA(value)}
            options={projectVersions.map((v) => ({
              value: v.id,
              label: `${v.fileName} - ${new Date(v.createdAt).toLocaleDateString('zh-CN')}`,
            }))}
          />
        </div>
        <div>
          <Text>对比版本：</Text>
          <Select
            style={{ width: 250 }}
            placeholder="选择对比版本"
            onChange={(value) => setSelectedVersionB(value)}
            options={projectVersions.map((v) => ({
              value: v.id,
              label: `${v.fileName} - ${new Date(v.createdAt).toLocaleDateString('zh-CN')}`,
            }))}
          />
        </div>
      </Space>

      {selectedVersionA && selectedVersionB && (
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="总行数" value={stats.total} />
            </Col>
            <Col span={6}>
              <Statistic
                title="新增"
                value={stats.insert}
                valueStyle={{ color: '#52c41a' }}
                prefix="+"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="删除"
                value={stats.delete}
                valueStyle={{ color: '#ff4d4f' }}
                prefix="-"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="未变更"
                value={stats.equal}
                valueStyle={{ color: '#999' }}
              />
            </Col>
          </Row>
        </Card>
      )}

      {!selectedVersionA || !selectedVersionB ? (
        <Empty description="请选择两个版本进行对比" />
      ) : diffResult.length === 0 ? (
        <Empty description="两个版本内容完全相同" />
      ) : (
        <Card>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.8,
              maxHeight: 600,
              overflow: 'auto',
              background: '#fafafa',
              borderRadius: 4,
            }}
          >
            {diffResult.map((line, index) => {
              let bgColor = 'transparent';
              let lineColor = '#999';
              let prefix = ' ';

              if (line.type === 'insert') {
                bgColor = '#e6ffec';
                lineColor = '#52c41a';
                prefix = '+';
              } else if (line.type === 'delete') {
                bgColor = '#ffebe9';
                lineColor = '#ff4d4f';
                prefix = '-';
              }

              const lineNum = line.type === 'delete'
                ? (line.lineNumA?.toString() || '')
                : (line.lineNumB?.toString() || '');

              return (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    background: bgColor,
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      textAlign: 'right',
                      paddingRight: 8,
                      color: '#999',
                      borderRight: '1px solid #f0f0f0',
                      userSelect: 'none',
                    }}
                  >
                    {lineNum}
                  </div>
                  <div
                    style={{
                      width: 20,
                      textAlign: 'center',
                      color: lineColor,
                      fontWeight: 'bold',
                      userSelect: 'none',
                    }}
                  >
                    {prefix}
                  </div>
                  <div style={{ flex: 1, padding: '0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {line.text || <span style={{ color: '#ccc' }}>&nbsp;</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};

export default DiffViewer;
