import { Button, Checkbox, DatePicker, Flex, Form, Input, Radio, Timeline } from 'antd';
import dayjs from 'dayjs';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { ACTION_TONE, ADVISORY_STATUS_TONE, EXPOSURE_TONE, SEVERITY_TONE } from '../palette';
import { Choice, DateTime, ErrorBanner, Field, ToneTag } from './common';

/* Shared pieces of the advisory pages (DECISIONS D24): badges, a team's answer form and its history. */

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const PLANS = ['patch', 'mitigate', 'accept_risk', 'other'] as const;
export const ACTION_STATUSES = ['not_started', 'in_progress', 'done'] as const;

export interface Answer {
  exposure: string;
  affectedScope: string;
  actionPlan: string | null;
  actionDetail: string;
  actionStatus: string | null;
  targetDate: string | null;
}
export interface HistoryEntry extends Answer {
  id: number;
  note: string;
  createdAt: string;
  author: { id: number; displayName: string } | null;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useI18n();
  return <ToneTag tone={SEVERITY_TONE[severity] ?? 'grey'}>{t(`ui.advisory.severity.${severity}`)}</ToneTag>;
}
export function AdvisoryStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <ToneTag tone={ADVISORY_STATUS_TONE[status] ?? 'grey'}>{t(`ui.advisory.status.${status}`)}</ToneTag>;
}
export function ExposureBadge({ exposure }: { exposure: string }) {
  const { t } = useI18n();
  return <ToneTag tone={EXPOSURE_TONE[exposure] ?? 'grey'}>{t(`ui.advisory.exposure.${exposure}`)}</ToneTag>;
}
export function ActionBadge({ status }: { status: string | null }) {
  const { t } = useI18n();
  if (!status) return <span className="muted">—</span>;
  return <ToneTag tone={ACTION_TONE[status] ?? 'grey'}>{t(`ui.advisory.action_status.${status}`)}</ToneTag>;
}

/** Short text of how an exposed team handles it: plan, status and planned date. */
export function ActionSummary({ answer }: { answer: Answer }) {
  const { t } = useI18n();
  if (answer.exposure !== 'affected' && !answer.actionPlan) return <span className="muted">—</span>;
  return (
    <Flex vertical gap={4}>
      <Flex gap={6} wrap align="center">
        {answer.actionPlan && <span>{t(`ui.advisory.plan.${answer.actionPlan}`)}</span>}
        <ActionBadge status={answer.actionStatus} />
      </Flex>
      {answer.targetDate && <span className="small muted">{t('ui.advisory.target_date_value', { date: answer.targetDate })}</span>}
    </Flex>
  );
}

/**
 * A team's answer: exposed or not in its environment and, if exposed, how and by when it is handled.
 * Values stay in component state (AGENTS.md: antd Form only lays out and submits).
 */
export function ResponseForm({ initial, busy, error, onSubmit, onCancel }: {
  initial: Answer;
  busy: boolean;
  error: unknown;
  onSubmit: (answer: Answer & { note: string }) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [a, setA] = useState<Answer>({ ...initial, exposure: initial.exposure === 'pending' ? '' : initial.exposure });
  const [note, setNote] = useState('');
  const set = (patch: Partial<Answer>) => setA((x) => ({ ...x, ...patch }));
  const affected = a.exposure === 'affected';
  const showAction = affected || a.exposure === 'investigating';
  return (
    <Form layout="vertical" onFinish={() => onSubmit({ ...a, note })}>
      <ErrorBanner error={error} />
      <Field label={t('ui.advisory.exposure')} required>
        <Radio.Group
          value={a.exposure}
          onChange={(e) => set({ exposure: e.target.value })}
          options={['investigating', 'not_affected', 'affected'].map((x) => ({ value: x, label: t(`ui.advisory.exposure.${x}`) }))}
        />
      </Field>
      {showAction && (
        <>
          <Field label={t('ui.advisory.affected_scope')} extra={t('ui.advisory.affected_scope_hint')}>
            <Input.TextArea rows={2} value={a.affectedScope} onChange={(e) => set({ affectedScope: e.target.value })} />
          </Field>
          <Flex wrap gap="0 12px">
            <div style={{ minWidth: 180 }}>
              <Field label={t('ui.advisory.action_plan')} required={affected}>
                <Choice
                  value={a.actionPlan ?? ''}
                  onChange={(v) => set({ actionPlan: v || null })}
                  empty="—"
                  options={PLANS.map((x) => ({ value: x, label: t(`ui.advisory.plan.${x}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
            </div>
            <div style={{ minWidth: 160 }}>
              <Field label={t('ui.advisory.action_status')} required={affected}>
                <Choice
                  value={a.actionStatus ?? ''}
                  onChange={(v) => set({ actionStatus: v || null })}
                  empty="—"
                  options={ACTION_STATUSES.map((x) => ({ value: x, label: t(`ui.advisory.action_status.${x}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label={t('ui.advisory.target_date')} required={affected && a.actionStatus !== 'done'}>
                <DatePicker
                  value={a.targetDate ? dayjs(a.targetDate) : null}
                  format="YYYY-MM-DD"
                  style={{ width: '100%' }}
                  onChange={(d) => set({ targetDate: d ? d.format('YYYY-MM-DD') : null })}
                />
              </Field>
            </div>
          </Flex>
          <Field label={t('ui.advisory.action_detail')}>
            <Input.TextArea rows={3} value={a.actionDetail} onChange={(e) => set({ actionDetail: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={t('ui.advisory.note')}>
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Flex gap={8}>
        <Button type="primary" htmlType="submit" loading={busy} disabled={busy || !a.exposure}>
          {t('ui.advisory.submit_response')}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t('ui.common.cancel')}</Button>}
      </Flex>
    </Form>
  );
}

/** Every saved answer of one team, newest first. */
export function ResponseHistory({ entries }: { entries: HistoryEntry[] }) {
  const { t } = useI18n();
  if (!entries.length) return <p className="muted small">{t('ui.advisory.no_history')}</p>;
  return (
    <Timeline
      items={entries.map((h) => ({
        key: h.id,
        content: (
          <div>
            <div className="small muted">
              <DateTime value={h.createdAt} /> · {h.author?.displayName ?? '—'}
            </div>
            <Flex gap={6} wrap align="center" style={{ margin: '4px 0' }}>
              <ExposureBadge exposure={h.exposure} />
              {h.actionPlan && <span>{t(`ui.advisory.plan.${h.actionPlan}`)}</span>}
              {h.actionStatus && <ActionBadge status={h.actionStatus} />}
              {h.targetDate && <span className="small muted">{t('ui.advisory.target_date_value', { date: h.targetDate })}</span>}
            </Flex>
            {h.affectedScope && <Pre label={t('ui.advisory.affected_scope')}>{h.affectedScope}</Pre>}
            {h.actionDetail && <Pre label={t('ui.advisory.action_detail')}>{h.actionDetail}</Pre>}
            {h.note && <Pre label={t('ui.advisory.note')}>{h.note}</Pre>}
          </div>
        ),
      }))}
    />
  );
}

function Pre({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
      <span className="muted">{label}: </span>
      {children}
    </div>
  );
}

/** Responder-only list filter. */
export function TodoCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)}>
      {t('ui.advisory.todo_only')}
    </Checkbox>
  );
}
