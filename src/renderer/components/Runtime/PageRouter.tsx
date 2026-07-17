import React, { lazy, Suspense, useEffect } from 'react';
import Overview from '../Overview/Overview';
import { AppPage, useNavigationStore } from '../../stores/navigationStore';
import { Project, WorkbenchFocus } from '../../../shared/types';

const LazyCalendarView = lazy(() => import('../Calendar/CalendarView'));
const LazyAISettings = lazy(() => import('../AISettings/AISettings'));
const LazyProgressBoard = lazy(() => import('../ProgressBoard/ProgressBoard'));
const LazyPlanManager = lazy(() => import('../PlanManager/PlanManager'));
const LazyTemplateManager = lazy(() => import('../TemplateManager/TemplateManager'));
const LazyTaskPlanner = lazy(() => import('../TaskPlanner/TaskPlanner'));
const LazyDocumentReviewer = lazy(() => import('../DocumentReviewer/DocumentReviewer'));
const LazyRecycleBinView = lazy(() => import('../RecycleBin/RecycleBinView'));
const ProjectFileExplorer = lazy(() => import('../ProjectList/ProjectFileExplorer'));
const MemoOverview = React.memo(Overview);

interface PageRouterProps {
  page: AppPage;
  currentProject: Project | null;
  focus: WorkbenchFocus | null;
  fallback: React.ReactNode;
  panelInitialTab: string;
  onBack: () => void;
  onCloseRecycleBin: () => void;
  onEnterProject: React.ComponentProps<typeof Overview>['onEnterProject'];
  onOpenProjectDetail: React.ComponentProps<typeof Overview>['onOpenProjectDetail'];
}

const PageRouter: React.FC<PageRouterProps> = props => {
  const acknowledgeFocus = useNavigationStore(state => state.acknowledgeActiveFocus);
  useEffect(() => {
    if (!props.focus) return;
    const passThroughTargets = new Set(['plan', 'templates', 'report', 'calendar']);
    if (passThroughTargets.has(props.focus.target)) acknowledgeFocus();
  }, [acknowledgeFocus, props.focus, props.page]);
  const content = (() => {
    if (props.page === 'overview') return <MemoOverview visible onEnterProject={props.onEnterProject} panelInitialTab={props.panelInitialTab} onOpenProjectDetail={props.onOpenProjectDetail} />;
    if (props.page === 'calendar') return <LazyCalendarView onBack={props.onBack} />;
    if (props.page === 'settings') return <LazyAISettings />;
    if (props.page === 'recycle-bin') return <LazyRecycleBinView onBack={props.onCloseRecycleBin} />;
    if (props.page === 'project-files' && props.currentProject) return <ProjectFileExplorer project={props.currentProject} onBack={props.onBack} focus={props.focus?.target === 'files' ? props.focus : undefined} />;
    if (props.page === 'project-plan') return <LazyPlanManager onBack={props.onBack} hideHeader />;
    if (props.page === 'project-team') return <LazyProgressBoard onBack={props.onBack} hideHeader />;
    if (props.page === 'project-templates') return <LazyTemplateManager onBack={props.onBack} hideHeader />;
    if (props.page === 'project-report') return <LazyTaskPlanner onBack={props.onBack} hideHeader focus={props.focus?.target === 'report' ? props.focus : undefined} />;
    if (props.page === 'project-review') return <LazyDocumentReviewer onBack={props.onBack} hideHeader focus={props.focus?.target === 'review' ? props.focus : undefined} />;
    return null;
  })();
  return <Suspense fallback={props.fallback}>{content}</Suspense>;
};

export default PageRouter;
