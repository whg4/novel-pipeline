import { useState } from 'react';
import { Modal, Checkbox, Button, Tag, message as antdMessage, Tooltip, Space } from 'antd';
import { AppstoreOutlined, UploadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { Skill } from '../types';

interface SkillSelectorModalProps {
  open: boolean;
  onClose: () => void;
  skills: Skill[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  extraSkillText: string;
  onExtraSkillTextChange: (text: string) => void;
  /** 自动内置的 skill keys（已包含在 prompt 中，不需要用户选择） */
  builtinKeys?: string[];
  /** 需要从列表中排除的 skill keys（不适用于当前阶段） */
  excludeKeys?: string[];
  title?: string;
}

// 类别显示配置
const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  workflow: { label: '工作流', color: '#888888' },
  template: { label: '模板', color: '#1677ff' },
  rule: { label: '写作规则', color: '#52c41a' },
  logic_check: { label: '审查规则', color: '#faad14' },
  blurb: { label: '营销', color: '#eb2f96' },
};

export default function SkillSelectorModal({
  open,
  onClose,
  skills,
  selectedKeys,
  onChange,
  extraSkillText,
  onExtraSkillTextChange,
  builtinKeys = [],
  excludeKeys = [],
  title = '选择 Skill',
}: SkillSelectorModalProps) {
  const [showUpload, setShowUpload] = useState(false);

  // 过滤掉排除项和已内置项，按类别分组
  const availableSkills = skills.filter(
    s => !excludeKeys.includes(s.key) && !builtinKeys.includes(s.key)
  );

  const builtinSkills = skills.filter(s => builtinKeys.includes(s.key));

  // 按类别分组
  const grouped = availableSkills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const cat = skill.category || 'rule';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  const handleToggle = (key: string) => {
    onChange(
      selectedKeys.includes(key)
        ? selectedKeys.filter(k => k !== key)
        : [...selectedKeys, key]
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onExtraSkillTextChange((ev.target?.result as string) || '');
      antdMessage.success(`已加载临时 Skill: ${file.name}`);
      setShowUpload(false);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppstoreOutlined /> {title}
          {selectedKeys.length > 0 && (
            <Tag color="black" style={{ marginLeft: 4 }}>{selectedKeys.length} 已选</Tag>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      width={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            icon={<UploadOutlined />}
            size="small"
            onClick={() => setShowUpload(!showUpload)}
          >
            上传临时 Skill
          </Button>
          <Button type="primary" onClick={onClose}>完成</Button>
        </div>
      }
    >
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {/* 已内置的 skill（只读展示） */}
        {builtinSkills.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#888888',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
            }}>
              已自动包含
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {builtinSkills.map(s => (
                <Tooltip key={s.key} title={s.description || s.name}>
                  <Tag
                    style={{ fontSize: 11, cursor: 'default' }}
                  >
                    {s.name}
                    <InfoCircleOutlined style={{ fontSize: 9, marginLeft: 4, color: '#bbb' }} />
                  </Tag>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* 按类别分组的可选 skill */}
        {Object.entries(grouped).map(([category, categorySkills]) => {
          const config = CATEGORY_CONFIG[category] || { label: category, color: '#888' };
          return (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: config.color,
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: config.color, display: 'inline-block',
                }} />
                {config.label}
              </div>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {categorySkills.map(skill => (
                  <div
                    key={skill.key}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '6px 8px', borderRadius: 6,
                      background: selectedKeys.includes(skill.key) ? '#f0f0f0' : 'transparent',
                      cursor: 'pointer', transition: 'background 0.1s',
                    }}
                    onClick={() => handleToggle(skill.key)}
                  >
                    <Checkbox
                      checked={selectedKeys.includes(skill.key)}
                      style={{ marginTop: 2 }}
                      onClick={e => e.stopPropagation()}
                      onChange={() => handleToggle(skill.key)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#171717' }}>
                        {skill.name}
                      </div>
                      {skill.description && (
                        <div style={{ fontSize: 10, color: '#888', marginTop: 2, lineHeight: 1.4 }}>
                          {skill.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </Space>
            </div>
          );
        })}

        {availableSkills.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: '#bbb', fontSize: 12 }}>
            没有可选的 Skill
          </div>
        )}

        {/* 临时 Skill 上传区域 */}
        {showUpload && (
          <div style={{
            borderTop: '1px solid #eaeaea', paddingTop: 12, marginTop: 8,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 8 }}>
              上传临时 Skill（本次生成有效）
            </div>
            {extraSkillText ? (
              <div style={{
                background: '#f5f5f5', padding: 8, borderRadius: 6,
                fontSize: 11, color: '#333', marginBottom: 8,
                maxHeight: 80, overflow: 'hidden', position: 'relative',
              }}>
                {extraSkillText.slice(0, 200)}{extraSkillText.length > 200 ? '...' : ''}
                <Button
                  size="small" type="link" danger
                  style={{ position: 'absolute', top: 4, right: 4, fontSize: 10 }}
                  onClick={() => onExtraSkillTextChange('')}
                >
                  清除
                </Button>
              </div>
            ) : (
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: '12px 0', border: '1px dashed #d9d9d9',
                borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#888',
              }}>
                <UploadOutlined /> 点击上传 .md / .txt 文件
                <input
                  type="file" accept=".txt,.md"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
