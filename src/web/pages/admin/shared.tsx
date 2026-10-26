import { Alert, Button, Flex } from 'antd';
import { get } from '../../api';
import { useLoad, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';

export type Opt = { id: number; name: string };
export const useOptions = (path: string) => useLoad(() => get<Opt[]>(path), [path]).data?.map((o) => ({ value: o.id, label: o.name })) ?? [];
export const sectionTitle = (text: string) => <h2 style={{ fontSize: 16, margin: 0 }}>{text}</h2>;
export const tableProps = { rowKey: 'id', pagination: false, size: 'middle', scroll: { x: 'max-content' } } as const;

/** Shows a secret exactly once with a copy button. */
export function OneTimeSecret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const { t } = useI18n();
  const p = usePalette();
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      title={<strong>{label}</strong>}
      description={
        <>
          <div className="secret-box mono" style={{ margin: '8px 0', background: p.surface }}>
            {value}
          </div>
          <Flex gap={8}>
            <Button onClick={() => void navigator.clipboard?.writeText(value)}>{t('ui.common.copy')}</Button>
            <Button onClick={onClose}>{t('ui.common.close')}</Button>
          </Flex>
        </>
      }
    />
  );
}
