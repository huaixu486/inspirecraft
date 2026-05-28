import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Card, Typography, Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectDocStore } from '../../stores/projectDocStore';

const { Text } = Typography;

const stageColors: Record<string, string> = {
  '提案': '#1890ff', '中标': '#52c41a', '指南编写': '#faad14', '指南投标': '#722ed1', '其他': '#8c8c8c',
};
const getStage = (names: string[]) => {
  const j = names.join(' ');
  if (j.includes('指南')) return '指南编写';
  if (j.includes('提案')) return '提案';
  return '其他';
};
const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (ms: number) => { const d = new Date(ms); return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DAY = 86400000;

const GanttChart: React.FC = () => {
  const { projects } = useProjectStore();
  const { projectDocs } = useProjectDocStore();
  const ref = useRef<HTMLDivElement>(null);

  // 所有视图状态用 ref，完全绕过 React 批处理
  const viewRef = useRef({ center: 0, span: DAY, min: 0, max: DAY, now: Date.now() });
  const [, bump] = useState(0);

  // 数据变化时重算
  useEffect(() => {
    const now = Date.now();
    const dates = [now];
    for (const p of projects) dates.push(new Date(p.createdAt).getTime());
    for (const d of projectDocs) {
      if (d.deadline) dates.push(new Date(d.deadline).getTime());
      if (d.completedAt) dates.push(new Date(d.completedAt).getTime());
    }
    const min = Math.min(...dates) - 5 * DAY;
    const max = Math.max(...dates) + 10 * DAY;
    const span = Math.max(DAY, max - min);
    viewRef.current = { center: (min + max) / 2, span, min, max, now };
    bump(n => n + 1);
  }, [projects, projectDocs]);

  const { center, span, min, max, now } = viewRef.current;
  const visStart = center - span / 2;
  const toPct = (ms: number) => ((ms - visStart) / span) * 100;

  // 滚轮缩放：直接改 ref，一次 bump 触发渲染
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;

    const v = viewRef.current;
    const mousePct = (e.clientX - rect.left) / rect.width;
    const mouseTime = (v.center - v.span / 2) + mousePct * v.span;

    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    const totalRange = v.max - v.min;
    let newSpan = Math.max(DAY / 4, Math.min(totalRange, v.span * factor));
    let newCenter = mouseTime + newSpan * (0.5 - mousePct);

    // 钳制不超出边界
    const half = newSpan / 2;
    if (newCenter - half < v.min) newCenter = v.min + half;
    if (newCenter + half > v.max) newCenter = v.max - half;

    viewRef.current = { ...v, center: newCenter, span: newSpan };
    bump(n => n + 1);
  }, []);

  // 生成标签
  const labels: { text: string; pct: number; major: boolean }[] = [];
  const visEnd = center + span / 2;
  const visStartDate = new Date(visStart);
  const visEndDate = new Date(visEnd);

  if (span > DAY * 365) {
    const d = new Date(visStartDate.getFullYear(), visStartDate.getMonth(), 1);
    while (d <= visEndDate) {
      const pct = toPct(d.getTime());
      if (pct > -2 && pct < 102) labels.push({ text: `${d.getFullYear()}/${pad(d.getMonth()+1)}`, pct, major: d.getMonth() % 3 === 0 });
      d.setMonth(d.getMonth() + 1);
    }
  } else if (span > DAY * 60) {
    const d = new Date(visStartDate); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7));
    while (d <= visEndDate) {
      const pct = toPct(d.getTime());
      if (pct > -2 && pct < 102) labels.push({ text: `${pad(d.getMonth()+1)}/${pad(d.getDate())}`, pct, major: d.getDate() <= 7 });
      d.setDate(d.getDate() + 7);
    }
  } else if (span > DAY * 10) {
    const d = new Date(visStartDate); d.setHours(0,0,0,0);
    while (d <= visEndDate) {
      const pct = toPct(d.getTime());
      if (pct > -2 && pct < 102) labels.push({ text: `${pad(d.getMonth()+1)}/${pad(d.getDate())}`, pct, major: d.getDate() === 1 });
      d.setDate(d.getDate() + 1);
    }
  } else if (span > DAY * 2) {
    const d = new Date(visStartDate); d.setMinutes(0,0,0); d.setHours(d.getHours() - (d.getHours()%6));
    while (d <= visEndDate) {
      const pct = toPct(d.getTime());
      if (pct > -2 && pct < 102) {
        const h0 = d.getHours() === 0;
        labels.push({ text: h0 ? `${pad(d.getMonth()+1)}/${pad(d.getDate())} 00:00` : `${pad(d.getHours())}:00`, pct, major: h0 });
      }
      d.setHours(d.getHours() + 6);
    }
  } else {
    const d = new Date(visStartDate); d.setMinutes(0,0,0);
    while (d <= visEndDate) {
      const pct = toPct(d.getTime());
      if (pct > -2 && pct < 102) {
        const h0 = d.getHours() === 0;
        labels.push({ text: h0 ? `${pad(d.getMonth()+1)}/${pad(d.getDate())} 00:00` : `${pad(d.getHours())}:00`, pct, major: h0 });
      }
      d.setHours(d.getHours() + 1);
    }
  }

  const fs = labels.length > 50 ? 9 : labels.length > 25 ? 10 : 11;
  const todayPct = toPct(now);

  return (
    <Card title="整体计划时间线" bordered={false} style={{ borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.09)' }}>
      <div ref={ref} onWheel={onWheel} style={{ position: 'relative', overflow: 'hidden' }}>
        {/* 标签行 */}
        <div style={{ position: 'relative', height: 18, marginBottom: 6, marginLeft: 130 }}>
          {labels.map((l, i) => (
            <span key={i} style={{
              position: 'absolute', left: `${l.pct}%`, transform: 'translateX(-50%)',
              fontSize: l.major ? fs : fs - 1, color: l.major ? '#555' : '#bbb',
              whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none',
            }}>{l.text}</span>
          ))}
        </div>

        {/* 网格线 */}
        <div style={{ position: 'absolute', top: 24, bottom: 0, left: 130, right: 0, pointerEvents: 'none' }}>
          {labels.filter(l => l.major).map((l, i) => (
            <div key={i} style={{ position: 'absolute', left: `${l.pct}%`, top: 0, bottom: 0, width: 1, background: '#f0f0f0' }} />
          ))}
        </div>

        {/* 项目行 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
          {projects.map((project) => {
            const docs = projectDocs.filter(d => d.projectId === project.id);
            const stage = getStage(docs.map(d => d.name));
            const color = stageColors[stage] || stageColors['其他'];

            const deadlines = docs.filter(d => d.deadline).map(d => new Date(d.deadline!).getTime());
            const latestDL = deadlines.length > 0 ? Math.max(...deadlines) : null;
            const allDone = docs.length > 0 && docs.every(d => d.completedAt);
            const isOverdue = latestDL && latestDL < now && !allDone;

            const startMs = new Date(project.createdAt).getTime();
            const endMs = allDone
              ? Math.max(...docs.filter(d => d.completedAt).map(d => new Date(d.completedAt!).getTime()))
              : now;

            const barL = toPct(startMs);
            const barR = toPct(endMs);
            const barW = Math.max(0, barR - barL);
            if (barR < -5 || barL > 105) return null;

            return (
              <div key={project.id} style={{ display: 'flex', alignItems: 'center', minHeight: 34 }}>
                <div style={{ width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Text ellipsis style={{ fontSize: 12 }}>{project.name}</Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 5, height: 5, borderRadius: 1, background: color }} />
                    <Text type="secondary" style={{ fontSize: 9 }}>{stage}</Text>
                    {isOverdue && (
                      <Tooltip title={`逾期：${fmtDate(latestDL)}`}>
                        <WarningOutlined style={{ fontSize: 9, color: '#ff4d4f' }} />
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, position: 'relative', height: 24, overflow: 'hidden' }}>
                  {/* 彩条：从创建时间到现在（或完成时间） */}
                  <div style={{
                    position: 'absolute', left: `${barL}%`, width: `${barW}%`,
                    top: 3, height: 18, borderRadius: 3,
                    background: isOverdue ? '#ff4d4f18' : `${color}18`,
                    border: `1px solid ${isOverdue ? '#ff4d4f30' : color + '30'}`,
                    display: 'flex', alignItems: 'center', paddingLeft: 5, overflow: 'hidden',
                  }}>
                    <Text style={{ fontSize: 9, whiteSpace: 'nowrap', color: isOverdue ? '#ff4d4f' : color }}>
                      {stage}{latestDL && ` → ${fmtDate(latestDL)}`}{isOverdue && ' (逾期)'}
                    </Text>
                  </div>
                  {/* deadline 标记线 */}
                  {latestDL && latestDL > now && (() => {
                    const p = toPct(latestDL);
                    return p >= 0 && p <= 100
                      ? <div style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: 1.5, background: color, zIndex: 1 }} />
                      : null;
                  })()}
                </div>
              </div>
            );
          })}

          {/* 今天标记 */}
          <div style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, width: 1.5, background: '#1890ff50', zIndex: 3, pointerEvents: 'none' }} />
          <span style={{
            position: 'absolute', left: `${todayPct}%`, top: -14, transform: 'translateX(-50%)',
            background: '#1890ff', color: '#fff', fontSize: 8, padding: '1px 4px',
            borderRadius: 2, whiteSpace: 'nowrap', zIndex: 4, pointerEvents: 'none',
          }}>{fmtDate(now)}</span>

          {projects.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无项目数据</div>}
        </div>
      </div>
    </Card>
  );
};

export default GanttChart;
