import React, { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import NotificationCenter from '../Notifications/NotificationCenter';
import { useSettingsStore } from '../../stores/settingsStore';
import { AppPage } from '../../stores/navigationStore';

interface NotificationRuntimeProps {
  onOpenTarget: (targetPage: AppPage, projectId?: string) => void;
}

const NotificationRuntime: React.FC<NotificationRuntimeProps> = ({ onOpenTarget }) => {
  const enableSystemNotifications = useSettingsStore(state => state.enableSystemNotifications);
  const calendarItineraries = useSettingsStore(state => state.calendarItineraries);
  const updateCalendarItineraryById = useSettingsStore(state => state.updateCalendarItineraryById);
  const inFlightReminderIdsRef = useRef(new Set<string>());
  const failedReminderBackoffRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enableSystemNotifications) return;
    let disposed = false;
    const notifyDueItineraries = async () => {
      const now = Date.now();
      const dueItems = calendarItineraries.filter(item => {
        if (!item.reminderAt || item.notifiedAt || inFlightReminderIdsRef.current.has(item.id)) return false;
        if (now < (failedReminderBackoffRef.current.get(item.id) || 0)) return false;
        return dayjs(item.reminderAt).valueOf() <= now;
      });
      for (const item of dueItems) {
        inFlightReminderIdsRef.current.add(item.id);
        try {
          const result = await window.electronAPI.showSystemNotification?.({
            title: `行程提醒：${item.title}`,
            body: item.note || `${dayjs(item.date).format('M 月 D 日')} 的个人行程即将开始`,
            target: 'overview',
          });
          if (disposed) return;
          if (result?.success) {
            await updateCalendarItineraryById(item.id, { notifiedAt: new Date().toISOString() });
            failedReminderBackoffRef.current.delete(item.id);
          } else {
            failedReminderBackoffRef.current.set(item.id, Date.now() + 5 * 60 * 1000);
          }
        } catch (error) {
          console.warn('Failed to show calendar reminder:', error);
          failedReminderBackoffRef.current.set(item.id, Date.now() + 5 * 60 * 1000);
        } finally {
          inFlightReminderIdsRef.current.delete(item.id);
        }
      }
    };
    void notifyDueItineraries();
    const timer = window.setInterval(() => void notifyDueItineraries(), 30_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [calendarItineraries, enableSystemNotifications, updateCalendarItineraryById]);

  useEffect(() => {
    const validTargets = new Set<AppPage>(['overview', 'project-plan', 'project-report', 'project-review']);
    const unsubscribe = window.electronAPI.onSystemNotificationClick?.(payload => {
      const targetPage = validTargets.has(payload?.target as AppPage) ? payload.target as AppPage : 'overview';
      onOpenTarget(targetPage, payload?.projectId);
    });
    return () => unsubscribe?.();
  }, [onOpenTarget]);

  return <NotificationCenter hidden onOpenTarget={onOpenTarget} />;
};

export default NotificationRuntime;
