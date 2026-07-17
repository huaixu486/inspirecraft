import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Tour, Typography } from 'antd';
import type { TourProps } from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  TeamOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

export const FIRST_USE_GUIDE_STORAGE_KEY = 'projecthub.first-use-guide.v1';
export type GuidePage = 'overview' | 'project-files' | 'project-plan' | 'project-report' | 'project-review' | 'project-team' | 'project-templates' | 'calendar' | 'settings';

export const hasCompletedFirstUseGuide = () => {
  try {
    return localStorage.getItem(FIRST_USE_GUIDE_STORAGE_KEY) === 'completed';
  } catch {
    return false;
  }
};

const markFirstUseGuideCompleted = () => {
  try {
    localStorage.setItem(FIRST_USE_GUIDE_STORAGE_KEY, 'completed');
  } catch {
    // The guide still works when browser storage is unavailable.
  }
};

interface FirstUseGuideProps {
  open: boolean;
  activePage: GuidePage;
  hasProject: boolean;
  onClose: () => void;
  onNavigate: (page: GuidePage) => void;
}

const target = (selector: string) => () => document.querySelector<HTMLElement>(selector) || document.body;

type GuideStep = NonNullable<TourProps['steps']>[number] & { page: GuidePage };

const FirstUseGuide: React.FC<FirstUseGuideProps> = ({ open, activePage, hasProject, onClose, onNavigate }) => {
  const [tourOpen, setTourOpen] = useState(false);
  const [tourCurrent, setTourCurrent] = useState(0);
  const [changingPage, setChangingPage] = useState(false);
  const navigationTimerRef = useRef<number>(0);

  useEffect(() => {
    if (!open) {
      setTourOpen(false);
      setTourCurrent(0);
      setChangingPage(false);
    }
  }, [open]);

  useEffect(() => () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
  }, []);

  const finish = () => {
    markFirstUseGuideCompleted();
    setTourOpen(false);
    onClose();
  };

  const begin = () => {
    onNavigate('overview');
    setTourCurrent(0);
    window.setTimeout(() => setTourOpen(true), activePage === 'overview' ? 120 : 520);
  };

  const steps = useMemo<GuideStep[]>(() => {
    const overviewSteps: GuideStep[] = [
    {
      page: 'overview',
      title: '从项目总览开始',
      description: '点击左上角 P 可随时返回项目总览；在其他页面再次点击，可以回到上次打开的位置。',
      target: target('.app-topbar-logo'),
    },
    {
      page: 'overview',
      title: '掌握所有项目状态',
      description: '这里汇总项目数量、已完成阶段、临期与逾期情况。点击统计卡片可以查看对应项目列表。',
      target: target('.stats-grid'),
    },
    {
      page: 'overview',
      title: '创建或导入项目',
      description: '可新建空项目，也可导入现有文件夹或 ZIP。单击项目打开侧边详情，双击直接进入文件。',
      target: target('.project-table-card .ant-card-extra'),
      placement: 'bottomRight',
    },
    {
      page: 'overview',
      title: '项目都在这张列表里',
      description: '列表展示阶段、进度、最近文件和下一步计划；搜索可按名称、描述或路径快速定位。',
      target: target('.overview-project-table-wrap'),
    },
    ];

    const projectSteps: GuideStep[] = hasProject ? [
    {
      page: 'project-files',
      title: '文件详情：项目资料入口',
      description: '在这里浏览目录、搜索、新建和导入文件或文件夹，也可以拖拽、复制、移动、重命名及打开历史版本。顶部导航可直接前往计划、报告、审查和团队。',
      target: target('.project-file-explorer'),
    },
    {
      page: 'project-plan',
      title: '计划：统一编排任务',
      description: '报告和审查产生的任务会集中到这里。你可以区分人工与 AI 任务、调整执行方式、处理依赖并查看工作流完成情况。',
      target: target('.plan-dispatch-center'),
    },
    {
      page: 'project-report',
      title: '报告：从文档问题形成工作流',
      description: '先按阶段选择文档，再分析章节完成度与问题。AI 建议可以逐条选择和修改，选中的建议会进入可编辑的工作流草稿。',
      target: target('.report-stage-card'),
    },
    {
      page: 'project-review',
      title: '审查：检查内容与格式',
      description: '选择阶段、模板和待审文件，可检查缺失章节、格式以及内容偏差；审查结果能继续生成修订任务或进行版本对比。',
      target: target('.review-setup-card'),
    },
    {
      page: 'project-team',
      title: '团队协同：AI 写作',
      description: '选择写作模板和项目资料，让 AI 生成初稿。阶段记忆、范文与临时资料都可以作为写作参考。',
      target: target('.team-main-left .team-ai-studio-anchor:first-child'),
    },
    {
      page: 'project-team',
      title: '团队协同：精确修订',
      description: '载入项目文档后选择具体内容，AI 只针对选区提出修订；确认后再写回文件，并保留原文件备份。',
      target: target('.team-main-left .team-ai-studio-anchor:last-child'),
    },
    {
      page: 'project-team',
      title: '团队协同：任务派发',
      description: '人工、AI 和审查任务均可独立勾选，也支持一次选择多个任务并发送给同一位在线好友。',
      target: target('.team-main-right .team-ai-studio-anchor'),
      placement: 'left',
    },
    ] : [{
      page: 'overview',
      title: '创建项目后继续项目内导览',
      description: '文件、计划、报告、审查和团队协作都需要项目上下文。请先新建或导入一个项目，然后点击顶栏问号重新打开完整导览。',
      target: target('.project-table-card .ant-card-extra'),
      placement: 'bottomRight',
    }];

    const globalSteps: GuideStep[] = [
    {
      page: 'project-templates',
      title: '模板：约束 AI 输出和文档格式',
      description: '模板分为直接模板和范文模板，可导入 Word/PDF 等文件，维护章节结构、写作要求和字体段落规则。',
      target: target('.template-manager-page'),
    },
    {
      page: 'calendar',
      title: '日历：集中查看时间安排',
      description: '查看项目截止日期、个人行程和节假日；可以记录工作状态、备注并设置系统提醒。',
      target: target('.calendar-page-layout'),
    },
    {
      page: 'settings',
      title: '设置：配置工作区和 AI',
      description: '在这里设置工作区、AI 模型、提示词、Skill、合成规则、自动化和 Token 统计。首次使用 AI 前请先完成模型配置。',
      target: target('.ai-settings-page'),
    },
    {
      page: 'settings',
      title: '切换项目与系统设置',
      description: '左下角工具栏可快速切换项目、打开回收站和设置；顶栏问号按钮可以随时重新查看完整导览。',
      target: target('.app-fab-dock'),
      placement: 'right',
    },
    ];
    return [...overviewSteps, ...projectSteps, ...globalSteps];
  }, [hasProject]);

  const changeStep = (next: number) => {
    const nextStep = steps[next];
    if (!nextStep) return;
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current);
    if (nextStep.page === activePage) {
      setTourCurrent(next);
      return;
    }
    setChangingPage(true);
    onNavigate(nextStep.page);
    navigationTimerRef.current = window.setTimeout(() => {
      navigationTimerRef.current = 0;
      setTourCurrent(next);
      setChangingPage(false);
    }, 620);
  };

  const features = [
    { icon: <FolderOpenOutlined />, title: '文件', text: '导入、整理、搜索并跟踪项目文件版本' },
    { icon: <CalendarOutlined />, title: '计划', text: '编排人工与 AI 任务，查看阶段时间线' },
    { icon: <RobotOutlined />, title: 'AI 写作', text: '结合模板、范文和项目资料生成与修订内容' },
    { icon: <FileTextOutlined />, title: '报告', text: '分析章节问题，自由选择建议并生成工作流' },
    { icon: <CheckCircleOutlined />, title: '审查', text: '检查缺失章节、格式与内容偏差' },
    { icon: <TeamOutlined />, title: '协作', text: '向好友多选派发人工、AI 和审查任务' },
  ];

  return (
    <>
      <Modal
        open={open && !tourOpen}
        centered
        width={680}
        closable={false}
        maskClosable={false}
        className="first-use-guide-modal"
        footer={[
          <Button key="skip" onClick={finish}>跳过引导</Button>,
          <Button key="start" type="primary" onClick={begin}>开始界面引导</Button>,
        ]}
      >
        <div className="first-use-guide-hero">
          <span className="first-use-guide-logo">P</span>
          <div>
            <Title level={3}>欢迎使用 ProjectHub</Title>
            <Text type="secondary">围绕项目文件，把计划、AI 写作、报告审查和团队协作串成一条工作流。</Text>
          </div>
        </div>
        <div className="first-use-guide-features">
          {features.map(feature => (
            <div key={feature.title} className="first-use-guide-feature">
              <span>{feature.icon}</span>
              <div><b>{feature.title}</b><small>{feature.text}</small></div>
            </div>
          ))}
        </div>
        <div className="first-use-guide-tip">建议从“导入现有项目文件夹”开始，软件会保留原文件夹位置，也可按需移动到工作区。</div>
      </Modal>
      <Tour
        open={open && tourOpen && !changingPage}
        current={tourCurrent}
        steps={steps}
        onChange={changeStep}
        onClose={finish}
        onFinish={finish}
        indicatorsRender={(current, total) => <span>{current + 1} / {total}</span>}
      />
    </>
  );
};

export default FirstUseGuide;
