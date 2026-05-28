import React, { useEffect, useState } from 'react';
import {
  Card,
  List,
  Tag,
  Typography,
  Empty,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskItem } from '../../../shared/types';

const { Text, Paragraph } = Typography;

const TaskPlanner: React.FC = () => {
  const { currentProject } = useProjectStore();
  const { tasks, loadTasks, addTask, deleteTask, executeAITask, updateTask } = useTaskStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadTasks();
  }, []);

  if (!currentProject) {
    return (
      <Empty
        description="请先选择一个项目"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const projectTasks = tasks.filter((t) => t.projectId === currentProject.id);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const newTask: TaskItem = {
        id: Date.now().toString(),
        projectId: currentProject.id,
        title: values.title,
        description: values.description || '',
        type: values.type,
        status: 'pending',
        priority: values.priority,
        createdAt: new Date().toISOString(),
      };
      await addTask(newTask);
      setIsModalOpen(false);
      form.resetFields();
      message.success('任务创建成功');
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  const handleExecuteAI = async (task: TaskItem) => {
    if (!currentProject) return;

    // 获取最新版本的内容作为参考
    const versions = await window.electronAPI.loadVersions();
    const projectVersions = versions
      .filter((v: any) => v.projectId === currentProject.id)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const latestContent = projectVersions.length > 0 ? projectVersions[0].content : '';

    setExecutingTaskId(task.id);
    try {
      const result = await executeAITask(task.id, latestContent, task.description || task.title);
      if (result.success) {
        message.success('AI 任务执行完成');
      } else {
        message.error(`执行失败: ${result.error}`);
      }
    } catch (error: any) {
      message.error(`执行失败: ${error.message}`);
    } finally {
      setExecutingTaskId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      message.success('任务已删除');
    } catch (error: any) {
      message.error(`删除失败: ${error.message}`);
    }
  };

  const handleStatusChange = async (taskId: string, status: TaskItem['status']) => {
    try {
      await updateTask(taskId, { status });
      message.success('状态已更新');
    } catch (error: any) {
      message.error(`更新失败: ${error.message}`);
    }
  };

  const priorityColors = {
    high: 'red',
    medium: 'orange',
    low: 'green',
  };

  const priorityLabels = {
    high: '高',
    medium: '中',
    low: '低',
  };

  const statusLabels = {
    pending: '待处理',
    in_progress: '进行中',
    completed: '已完成',
  };

  const statusIcons = {
    pending: <SyncOutlined spin={false} />,
    in_progress: <SyncOutlined spin />,
    completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  };

  const renderTaskItem = (task: TaskItem) => (
    <List.Item
      actions={[
        task.type === 'ai' && task.status === 'pending' && (
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            loading={executingTaskId === task.id}
            onClick={() => handleExecuteAI(task)}
          >
            执行
          </Button>
        ),
        task.status !== 'completed' && (
          <Select
            size="small"
            value={task.status}
            onChange={(value) => handleStatusChange(task.id, value)}
            style={{ width: 100 }}
            options={[
              { value: 'pending', label: '待处理' },
              { value: 'in_progress', label: '进行中' },
              { value: 'completed', label: '已完成' },
            ]}
          />
        ),
        <Popconfirm
          title="确定删除此任务？"
          onConfirm={() => handleDeleteTask(task.id)}
        >
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>,
      ].filter(Boolean)}
    >
      <List.Item.Meta
        avatar={
          task.type === 'ai'
            ? <RobotOutlined style={{ color: '#1890ff', fontSize: 18 }} />
            : <UserOutlined style={{ color: '#52c41a', fontSize: 18 }} />
        }
        title={
          <Space>
            <Text delete={task.status === 'completed'}>{task.title}</Text>
            <Tag color={priorityColors[task.priority]}>
              {priorityLabels[task.priority]}
            </Tag>
            <Tag icon={statusIcons[task.status]}>
              {statusLabels[task.status]}
            </Tag>
          </Space>
        }
        description={
          <div>
            {task.description && (
              <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>
                {task.description}
              </Paragraph>
            )}
            {task.result && (
              <div style={{
                marginTop: 8,
                padding: 8,
                background: '#f6f8fa',
                borderRadius: 4,
                fontSize: 12,
              }}>
                <Text type="secondary">AI 执行结果：</Text>
                <br />
                <Paragraph ellipsis={{ rows: 3, expandable: true }} style={{ marginBottom: 0 }}>
                  {task.result}
                </Paragraph>
              </div>
            )}
          </div>
        }
      />
    </List.Item>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 18 }}>
          {currentProject.name} - 任务规划
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsModalOpen(true)}
        >
          新建任务
        </Button>
      </div>

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card title="AI处理任务" size="small">
          <List
            dataSource={projectTasks.filter((t) => t.type === 'ai')}
            renderItem={renderTaskItem}
            locale={{ emptyText: '暂无AI任务' }}
          />
        </Card>

        <Card title="人工处理任务" size="small">
          <List
            dataSource={projectTasks.filter((t) => t.type === 'manual')}
            renderItem={renderTaskItem}
            locale={{ emptyText: '暂无手动任务' }}
          />
        </Card>
      </Space>

      <Modal
        title="新建任务"
        open={isModalOpen}
        onOk={handleCreate}
        onCancel={() => setIsModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="任务标题"
            rules={[{ required: true, message: '请输入任务标题' }]}
          >
            <Input placeholder="例如：修改第三章内容" />
          </Form.Item>
          <Form.Item name="description" label="任务描述">
            <Input.TextArea rows={3} placeholder="详细描述任务要求，AI 将根据此描述执行任务" />
          </Form.Item>
          <Form.Item
            name="type"
            label="处理方式"
            rules={[{ required: true, message: '请选择处理方式' }]}
          >
            <Select>
              <Select.Option value="ai">AI处理</Select.Option>
              <Select.Option value="manual">人工处理</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="priority"
            label="优先级"
            initialValue="medium"
          >
            <Select>
              <Select.Option value="high">高</Select.Option>
              <Select.Option value="medium">中</Select.Option>
              <Select.Option value="low">低</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TaskPlanner;
