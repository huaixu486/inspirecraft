import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Tag, Typography, message } from 'antd';
import { EnterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  keyboardEventToShortcut,
  shortcutActionLabels,
  validateKeyboardShortcut,
} from '../../utils/keyboardShortcuts';

const { Text, Title } = Typography;

const ShortcutKeys: React.FC<{ value: string }> = ({ value }) => (
  <Space size={4} wrap>
    {value.split('+').map(key => <Tag key={key} className="shortcut-key-tag">{key}</Tag>)}
  </Space>
);

const ShortcutSettings: React.FC = () => {
  const shortcuts = useSettingsStore(state => state.keyboardShortcuts);
  const updateKeyboardShortcut = useSettingsStore(state => state.updateKeyboardShortcut);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(false);
        return;
      }
      const shortcut = keyboardEventToShortcut(event);
      if (!shortcut) return;
      const error = validateKeyboardShortcut(shortcut);
      if (error) {
        message.warning(error);
        return;
      }
      setRecording(false);
      void updateKeyboardShortcut('globalSearch', shortcut)
        .then(() => message.success(`全局搜索快捷键已改为 ${shortcut}`))
        .catch(errorValue => message.error(errorValue instanceof Error ? errorValue.message : '快捷键保存失败'));
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, updateKeyboardShortcut]);

  const resetShortcut = () => {
    void updateKeyboardShortcut('globalSearch', DEFAULT_KEYBOARD_SHORTCUTS.globalSearch)
      .then(() => message.success('已恢复默认快捷键 Ctrl+K'))
      .catch(errorValue => message.error(errorValue instanceof Error ? errorValue.message : '快捷键保存失败'));
  };

  return (
    <div className="shortcut-settings">
      <div className="settings-section-heading">
        <Title level={5}>快捷键分配</Title>
        <Text type="secondary">查看和调整应用级快捷键，修改后立即生效。</Text>
      </div>

      <div className="shortcut-settings-grid">
        <section className="shortcut-settings-section">
          <div className="shortcut-section-heading">
            <Text strong>可修改快捷键</Text>
            <Text type="secondary">点击按键区域后，直接录入新的组合键</Text>
          </div>
          <Card className={`shortcut-setting-card${recording ? ' is-recording' : ''}`}>
            <div className="shortcut-setting-row">
              <div className="shortcut-setting-copy">
                <Text strong>{shortcutActionLabels.globalSearch.title}</Text>
                <Text type="secondary">{shortcutActionLabels.globalSearch.description}</Text>
              </div>
              <Space className="shortcut-setting-actions">
                <Button
                  className="shortcut-recorder-button"
                  type={recording ? 'primary' : 'default'}
                  onClick={() => setRecording(value => !value)}
                >
                  {recording ? '请按新的组合键…' : <ShortcutKeys value={shortcuts.globalSearch} />}
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  disabled={shortcuts.globalSearch === DEFAULT_KEYBOARD_SHORTCUTS.globalSearch}
                  onClick={resetShortcut}
                >
                  恢复默认
                </Button>
              </Space>
            </div>
            {recording && <Text className="shortcut-recording-hint" type="secondary">正在录入，按 Esc 取消</Text>}
          </Card>
        </section>

        <section className="shortcut-settings-section">
          <div className="shortcut-section-heading">
            <Text strong>固定操作快捷键</Text>
            <Text type="secondary">这些按键用于搜索面板和文件操作</Text>
          </div>
          <Card size="small" className="shortcut-reference-card">
            <div className="shortcut-reference-row">
              <span>选择搜索结果</span>
              <ShortcutKeys value="ArrowUp+ArrowDown" />
              <Text type="secondary">上下移动选中项</Text>
            </div>
            <div className="shortcut-reference-row">
              <span>打开搜索结果</span>
              <Tag className="shortcut-key-tag"><EnterOutlined /> Enter</Tag>
              <Text type="secondary">打开当前选中的项目、文件或命令</Text>
            </div>
            <div className="shortcut-reference-row">
              <span>关闭全局搜索</span>
              <ShortcutKeys value="Escape" />
              <Text type="secondary">退出命令面板</Text>
            </div>
            <div className="shortcut-reference-row">
              <span>文件详情撤销</span>
              <ShortcutKeys value="Ctrl+Z" />
              <Text type="secondary">撤销文件详情中的最近操作</Text>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
};

export default ShortcutSettings;
