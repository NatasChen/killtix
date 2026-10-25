import { Alert, Empty as AntEmpty, Flex, Form, Select, Spin, Tag, Typography } from 'antd';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { ApiError } from '../api';
import { useI18n } from '../i18n';
import { PALETTES, PRIORITY_TONE, SLA_TONE, STATUS_TONE, tone, type Palette, type Tone } from '../palette';
import { useThemeMode } from '../theme';

/** The palette of the applied theme. */
export function usePalette(): Palette {
  return PALETTES[useThemeMode()];
}

/** Page title (an <h1>) with optional actions on the right. */
export function PageHeader({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children?: ReactNode }) {
  return (
    <Flex justify="space-between" align="flex-start" gap={12} wrap style={{ marginBottom: 16 }}>
      <div style={{ minWidth: 0 }}>
        {children}
        <Typography.Title level={1} style={{ fontSize: 22, margin: 0 }}>
          {title}
        </Typography.Title>
      </div>
      {extra && (
        <Flex gap={8} wrap>
          {extra}
        </Flex>
      )}
    </Flex>
  );
}

/** badge-pill: a soft tint with ink text, one hue per meaning (palette.ts). */
export function ToneTag({ tone: t, children }: { tone: Tone; children: ReactNode }) {
  const s = tone(usePalette(), t);
  return (
    <Tag variant="filled" style={{ background: s.soft, color: s.ink, fontWeight: 600, borderRadius: 9999, marginInlineEnd: 0 }}>
      {children}
    </Tag>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <ToneTag tone={STATUS_TONE[status] ?? 'grey'}>{t(`ticket.status.${status}`)}</ToneTag>;
}

export function PriorityBadge({ priority }: { priority: number }) {
  const { t } = useI18n();
  return <ToneTag tone={PRIORITY_TONE[priority] ?? 'grey'}>{t(`ticket.priority.${priority}`)}</ToneTag>;
}

export function SlaBadge({ status, paused }: { status: string; paused?: boolean }) {
  const { t } = useI18n();
  if (paused) return <ToneTag tone={SLA_TONE.paused}>{t('ui.sla.paused')}</ToneTag>;
  return <ToneTag tone={SLA_TONE[status] ?? 'grey'}>{t(`ticket.sla.${status}`)}</ToneTag>;
}

export function Tags({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
    </>
  );
}

export function DateTime({ value }: { value: string | null | undefined }) {
  const { locale } = useI18n();
  if (!value) return <span className="muted">—</span>;
  return <time dateTime={value}>{new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time>;
}

/**
 * A labelled form control. The label points at the control (htmlFor + id), so screen readers and
 * getByLabel() find it; the antd Form is used for layout only, values stay in component state.
 */
export function Field({ label, extra, required, children }: { label: ReactNode; extra?: ReactNode; required?: boolean; children: ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <Form.Item label={label} htmlFor={id} extra={extra} required={required} style={{ marginBottom: 12 }}>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </Form.Item>
  );
}

export type Option = { value: string | number; label: ReactNode };

/** antd Select over plain options; `empty` adds a first option with value '' (e.g. "—", "All"). */
export function Choice({
  value,
  onChange,
  options,
  empty,
  ...rest
}: {
  value: string | number;
  onChange: (v: string) => void;
  options: Option[];
  empty?: ReactNode;
  id?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  'aria-label'?: string;
}) {
  const all = empty === undefined ? options : [{ value: '', label: empty }, ...options];
  return (
    <Select
      {...rest}
      value={value}
      onChange={(v) => onChange(String(v))}
      options={all.map((o) => ({ value: o.value, label: o.label, title: typeof o.label === 'string' ? o.label : undefined }))}
      popupMatchSelectWidth={false}
      style={{ minWidth: 120, ...rest.style }}
    />
  );
}

/** antd multiple Select over plain options (values are ids); options carry `title` for e2e like <Choice>. */
export function MultiChoice({
  value,
  onChange,
  options,
  ...rest
}: {
  value: number[];
  onChange: (v: number[]) => void;
  options: Option[];
  id?: string;
  disabled?: boolean;
  placeholder?: ReactNode;
  style?: React.CSSProperties;
  'aria-label'?: string;
}) {
  return (
    <Select
      {...rest}
      mode="multiple"
      allowClear
      value={value}
      onChange={(v) => onChange((v as (string | number)[]).map(Number))}
      options={options.map((o) => ({ value: o.value, label: o.label, title: typeof o.label === 'string' ? o.label : undefined }))}
      popupMatchSelectWidth={false}
      style={{ minWidth: 160, ...rest.style }}
    />
  );
}

/** Shows an API error (localized title from the server, plus field details). */
export function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  if (error instanceof ApiError) {
    const rules = (error.body.rules as string[] | undefined) ?? [];
    const fields = (error.body.errors as { path: string; message: string }[] | undefined) ?? [];
    const details =
      rules.length > 0 || fields.length > 0 ? (
        <ul style={{ margin: 0, paddingInlineStart: 20 }}>
          {rules.map((r) => (
            <li key={r}>{t(`ui.password.rule.${r}`)}</li>
          ))}
          {fields.map((f) => (
            <li key={f.path + f.message}>
              <code>{f.path}</code> {f.message}
            </li>
          ))}
        </ul>
      ) : undefined;
    return <Alert type="error" role="alert" showIcon title={error.title} description={details} style={{ marginBottom: 12 }} />;
  }
  return <Alert type="error" role="alert" showIcon title={String((error as Error).message ?? error)} style={{ marginBottom: 12 }} />;
}

/** Loads data with loading / error state and a reload function. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(undefined);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <Spin description={t('ui.common.loading')} />
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description={children ?? t('ui.common.empty')} />;
}

/** Runs an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
