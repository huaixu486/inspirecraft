import React, { useEffect, useState } from 'react';
import { Card, List, Tag, Typography, Empty, Button, Space, message, Switch } from 'antd';
import { FileTextOutlined, FilePdfOutlined, UploadOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { DocumentVersion } from '../../../shared/types';

const { Text, Paragraph } = Typography;

const VersionViewer: React.FC = () => {
  const { currentProject, versions, loadVersions, addVersion, deleteVersion } = useProjectStore();
  const [isWatching, setIsWatching] = useState(false);

  useEffect(() => {
    loadVersions();
  }, []);

  useEffect(() => {
    // 监听文件夹检测到的新文件
    const unsubscribe = window.electronAPI.onFileDetected(async (data) => {
      if (!currentProject || data.projectId !== currentProject.id) return;

      message.info(`检测到新文件: ${data.fileName}`);

      try {
        if (data.fileType === 'docx') {
          const result = await window.electronAPI.parseWordDocument(data.filePath);
          if (result.success) {
            const newVersion: DocumentVersion = {
              id: Date.now().toString(),
              projectId: currentProject.id,
              fileName: result.fileName || data.fileName,
              filePath: data.filePath,
              fileType: 'docx',
              content: result.content || '',
              createdAt: new Date().toISOString(),
            };
            await addVersion(newVersion);
            message.success(`自动导入: ${data.fileName}`);
          }
        } else if (data.fileType === 'pdf') {
          const result = await window.electronAPI.parsePdfDocument(data.filePath);
          if (result.success) {
            const newVersion: DocumentVersion = {
              id: Date.now().toString(),
              projectId: currentProject.id,
              fileName: result.fileName || data.fileName,
              filePath: data.filePath,
              fileType: 'pdf',
              content: result.content || '',
              createdAt: new Date().toISOString(),
            };
            await addVersion(newVersion);
            message.success(`自动导入: ${data.fileName}`);
          }
        } else {
          const content = await window.electronAPI.readFile(data.filePath);
          const newVersion: DocumentVersion = {
            id: Date.now().toString(),
            projectId: currentProject.id,
            fileName: data.fileName,
            filePath: data.filePath,
            fileType: 'txt',
            content: content,
            createdAt: new Date().toISOString(),
          };
          await addVersion(newVersion);
          message.success(`自动导入: ${data.fileName}`);
        }
      } catch (error: any) {
        message.error(`自动导入失败: ${error.message}`);
      }
    });
    return unsubscribe;
  }, [currentProject]);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectVersions = versions
    .filter((v) => v.projectId === currentProject.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'docx':
        return <FileTextOutlined style={{ color: '#2b579a' }} />;
      case 'pdf':
        return <FilePdfOutlined style={{ color: '#e74c3c' }} />;
      default:
        return <FileTextOutlined />;
    }
  };

  const handleToggleWatch = async (checked: boolean) => {
    if (!currentProject?.folderPath) {
      message.warning('请先关联项目文件夹');
      return;
    }

    if (checked) {
      const result = await window.electronAPI.startFolderWatch({
        projectId: currentProject.id,
        folderPath: currentProject.folderPath,
      });
      if (result.success) {
        setIsWatching(true);
        message.success('已开始监听文件夹变化');
      } else {
        message.error(`监听失败: ${result.error}`);
      }
    } else {
      const result = await window.electronAPI.stopFolderWatch(currentProject.id);
      if (result.success) {
        setIsWatching(false);
        message.success('已停止监听');
      }
    }
  };

  const handleImportDocument = async () => {
    try {
      const filePath = await window.electronAPI.openFile([
        { name: '文档文件', extensions: ['docx', 'pdf', 'txt'] },
      ]);

      if (!filePath) return;

      const ext = filePath.split('.').pop()?.toLowerCase();

      if (ext === 'docx') {
        const result = await window.electronAPI.parseWordDocument(filePath);
        if (!result.success) {
          message.error(`解析失败: ${result.error}`);
          return;
        }
        const newVersion: DocumentVersion = {
          id: Date.now().toString(),
          projectId: currentProject.id,
          fileName: result.fileName || 'unknown.docx',
          filePath: filePath,
          fileType: 'docx',
          content: result.content || '',
          createdAt: new Date().toISOString(),
        };
        await addVersion(newVersion);
        message.success('Word 文档导入成功');
      } else if (ext === 'pdf') {
        const result = await window.electronAPI.parsePdfDocument(filePath);
        if (!result.success) {
          message.error(`解析失败: ${result.error}`);
          return;
        }
        const newVersion: DocumentVersion = {
          id: Date.now().toString(),
          projectId: currentProject.id,
          fileName: result.fileName || 'unknown.pdf',
          filePath: filePath,
          fileType: 'pdf',
          content: result.content || '',
          createdAt: new Date().toISOString(),
        };
        await addVersion(newVersion);
        message.success(`PDF 文档导入成功（${result.pages} 页）`);
      } else {
        const content = await window.electronAPI.readFile(filePath);
        const fileName = filePath.split('\\').pop() || 'unknown.txt';
        const newVersion: DocumentVersion = {
          id: Date.now().toString(),
          projectId: currentProject.id,
          fileName: fileName,
          filePath: filePath,
          fileType: 'txt',
          content: content,
          createdAt: new Date().toISOString(),
        };
        await addVersion(newVersion);
        message.success('文本文件导入成功');
      }
    } catch (error: any) {
      message.error(`导入失败: ${error.message}`);
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    try {
      await deleteVersion(versionId);
      message.success('版本已删除');
    } catch (error: any) {
      message.error(`删除失败: ${error.message}`);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong style={{ fontSize: 18 }}>
          {currentProject.name} - 版本列表
        </Text>
        <Space>
          {currentProject.folderPath && (
            <Space>
              <Text>自动监听：</Text>
              <Switch
                checked={isWatching}
                onChange={handleToggleWatch}
                checkedChildren="开"
                unCheckedChildren="关"
              />
            </Space>
          )}
          <Button type="primary" icon={<UploadOutlined />} onClick={handleImportDocument}>
            导入文档
          </Button>
        </Space>
      </div>

      {projectVersions.length === 0 ? (
        <Empty description="暂无版本记录，请导入文档" />
      ) : (
        <List
          dataSource={projectVersions}
          renderItem={(version) => (
            <Card style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <Space>
                  {getFileIcon(version.fileType)}
                  <div>
                    <Text strong>{version.fileName}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(version.createdAt).toLocaleString('zh-CN')}
                    </Text>
                  </div>
                </Space>
                <Space>
                  <Tag>{version.fileType.toUpperCase()}</Tag>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    size="small"
                    onClick={() => handleDeleteVersion(version.id)}
                  />
                </Space>
              </div>
              <Paragraph
                ellipsis={{ rows: 3, expandable: true }}
                style={{ marginTop: 12, marginBottom: 0 }}
              >
                {(version.content || '').substring(0, 200)}...
              </Paragraph>
              {version.summary && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    background: '#f6f8fa',
                    borderRadius: 4,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    AI摘要：
                  </Text>
                  <br />
                  <Text>{version.summary}</Text>
                </div>
              )}
            </Card>
          )}
        />
      )}
    </div>
  );
};

export default VersionViewer;
