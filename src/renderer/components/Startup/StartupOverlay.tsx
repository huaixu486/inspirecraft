import React, { useState, useEffect, useCallback } from 'react';
import { Spin, Typography } from 'antd';

const { Text } = Typography;

/** 启动阶段 */
export type BootPhase = 'init' | 'settings' | 'projects' | 'docs' | 'ready';

const PHASE_LABELS: Record<BootPhase, string> = {
  init: '正在初始化...',
  settings: '加载配置...',
  projects: '加载项目列表...',
  docs: '加载文档索引...',
  ready: '就绪',
};

interface Props {
  phase: BootPhase;
  onDone: () => void;
}

const StartupOverlay: React.FC<Props> = ({ phase, onDone }) => {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (phase === 'ready') {
      // 延迟一小段时间让用户看到"就绪"，然后淡出
      const timer = setTimeout(() => {
        setFading(true);
        setTimeout(() => {
          setVisible(false);
          onDone();
        }, 400);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [phase, onDone]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s ease-out',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {/* 品牌 */}
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: 'rgba(255,255,255,0.2)',
          backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#fff' }}>P</span>
        </div>
        <div style={{ fontSize: 28, fontWeight: 600, color: '#fff', letterSpacing: 2 }}>
          ProjectHub
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
          项目进度管理工具
        </div>
      </div>

      {/* 加载状态 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spin size="small" />
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
          {PHASE_LABELS[phase]}
        </Text>
      </div>

      {/* 进度条 */}
      <div style={{
        width: 240, height: 3, borderRadius: 2,
        background: 'rgba(255,255,255,0.2)',
        marginTop: 16, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: 'rgba(255,255,255,0.8)',
          transition: 'width 0.3s ease',
          width: phase === 'init' ? '15%'
            : phase === 'settings' ? '35%'
            : phase === 'projects' ? '60%'
            : phase === 'docs' ? '85%'
            : '100%',
        }} />
      </div>
    </div>
  );
};

export default StartupOverlay;
