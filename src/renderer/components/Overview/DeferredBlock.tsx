import React, { useState, useEffect } from 'react';

/**
 * 分区块延迟渲染包装器。
 * 先显示 skeleton，延迟 delayMs 后渲染真实内容。
 * 多个 DeferredBlock 按不同 delay 错开，各自独立完成，互不等待。
 */
interface DeferredBlockProps {
  /** 骨架屏占位内容 */
  skeleton: React.ReactNode;
  /** 真实内容 */
  children: React.ReactNode;
  /** 延迟毫秒数，默认 0 = 下一帧 */
  delayMs?: number;
}

const DeferredBlock: React.FC<DeferredBlockProps> = ({ skeleton, children, delayMs = 0 }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (delayMs <= 0) {
      const raf = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(raf);
    }
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return <>{ready ? children : skeleton}</>;
};

export default React.memo(DeferredBlock);
