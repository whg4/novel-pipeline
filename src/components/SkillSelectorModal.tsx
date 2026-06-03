import { useRef } from 'react';
import { Modal, Checkbox, Button, Tag, message as antdMessage, Tooltip, Space } from 'antd';
import { AppstoreOutlined, UploadOutlined, InfoCircleOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { Skill } from '../types';

interface SkillSelectorModalProps {
  open: boolean;
  onClose: () => void;
  skills: Skill[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  extraSkillTexts: string[];
  onExtraSkillTextsChange: (texts: string[]) => void;
  builtinKeys?: string[];
  excludeKeys?: string[];
  title?: string;
}

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
  extraSkillTexts,
  onExtraSkillTextsChange,
  builtinKeys = [],
  excludeKeys = [],
  title = '选择 Skill',
}: SkillSelectorModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableSkills = skills.filter(
    s => !excludeKeys.includes(s.key) && !builtinKeys.includes(s.key)
  );
  const builtinSkills = skills.filter(s => builtinKeys.includes(s.key));

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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const readPromises = Array.from(files).map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve((ev.target?.result as string) || '');
        reader.readAsText(file, 'utf-8');
      });
    });

    Promise.all(readPromises).then(texts => {
      const validTexts = texts.filter(t => t.trim());
      if (validTexts.length > 0) {
        onExtraSkillTextsChange([...extraSkillTexts, ...validTexts]);
        antdMessage.success(`已添加 ${validTexts.length} 个临时 Skill`);
      }
    });

    e.target.value = '';
  };

  const handleRemoveOne = (index: number) => {
    onExtraSkillTextsChange(extraSkillTexts.filter((_, i) => i !== index));
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AppstoreOutlined /> {title}
          {(selectedKeys.length + extraSkillTexts.length) > 0 && (
            <Tag color="black" style={{ marginLeft: 4 }}>
              {selectedKeys.length + extraSkillTexts.length} 已选
            </Tag>
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
            onClick={() => fileInputRef.current?.click()}
          >
            上传临时 Skill
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <Button type="primary" onClick={onClose}>完成</Button>
        </div>
      }
    >
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {/* 已内置的 skill */}
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
                  <Tag style={{ fontSize: 11, cursor: 'default' }}>
                    {s.name}
                    <InfoCircleOutlined style={{ fontSize: 9, marginLeft: 4, color: '#bbb' }} />
                  </Tag>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* 临时 Skill 列表 */}
        {extraSkillTexts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#fa8c16',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#fa8c16', display: 'inline-block',
              }} />
              临时 Skill（{extraSkillTexts.length}）
            </div>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {extraSkillTexts.map((text, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '8px 10px', borderRadius: 6,
                    background: '#fff7e6', border: '1px solid #ffe0b2',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11, color: '#333', lineHeight: 1.6,
                      whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden',
                    }}>
                      {text.length > 200 ? text.slice(0, 200) + '...' : text}
                    </div>
                    <div style={{ fontSize: 9, color: '#bbb', marginTop: 4 }}>
                      {text.length} 字
                    </div>
                  </div>
                  <Button
                    size="small" type="text" danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveOne(index)}
                    style={{ flexShrink: 0 }}
                  />
                </div>
              ))}
              <Button
                size="small" type="dashed" block
                icon={<PlusOutlined />}
                onClick={() => fileInputRef.current?.click()}
              >
                添加更多
              </Button>
            </Space>
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

        {availableSkills.length === 0 && extraSkillTexts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: '#bbb', fontSize: 12 }}>
            没有可选的 Skill，请上传临时 Skill 或前往 Skill 管理页面创建
          </div>
        )}
      </div>
    </Modal>
  );
}
