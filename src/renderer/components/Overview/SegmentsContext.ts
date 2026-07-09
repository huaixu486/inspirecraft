import { createContext, useContext } from 'react';
import { TimelineStageSegment } from '../../utils/timelineStages';

// 首页共享的项目阶段段数据，由 Overview 统一计算，子组件通过 Context 获取
export const SegmentsContext = createContext<Map<string, TimelineStageSegment[]>>(new Map());

export const useSegmentsByProject = () => useContext(SegmentsContext);
