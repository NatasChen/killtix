import { Alert, Button, Card, Col, DatePicker, Flex, Form, Input, Row, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, patch, post } from '../api';
import { SEVERITIES } from '../components/advisory';
import { Choice, ErrorBanner, Field, Loading, MultiChoice, PageHeader, useAction, useLoad } from '../components/common';
import { useI18n } from '../i18n';

interface AdvisoryDraft {
  title: string;
  source: string;
  severity: string;
  summary: string;
  cves: string[];
  affectedProducts: string;
  iocs: string;
  references: string;
  recommendation: string;
  responseDueAt: string | null;
  teamIds: number[];
}
interface Loaded extends Omit<AdvisoryDraft, 'teamIds' | 'source'> {
  number: string;
  status: string;
  source: string | null;
  targets: { teamId: number; team: string; exposure: string }[];
}

/** Default answer deadline by severity, at 18:00: critical 1 day, high 3, medium 7, low 14. */
const DUE_DAYS: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };
const defaultDue = (severity: string) => dayjs().add(DUE_DAYS[severity] ?? 7, 'day').hour(18).minute(0).second(0).millisecond(0).toISOString();

const EMPTY: AdvisoryDraft = {
  title: '',
  source: '',
  severity: 'high',
  summary: '',
  cves: [],
  affectedProducts: '',
  iocs: '',
  references: '',
  recommendation: '',
  responseDueAt: defaultDue('high'),
  teamIds: [],
};

export function AdvisoryNewPage() {
  return <AdvisoryForm />;
}

export function AdvisoryEditPage() {
  const { id } = useParams();
  const { data, error, loading } = useLoad(() => get<Loaded>(`/advisories/${encodeURIComponent(id!)}`), [id]);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;
  return <AdvisoryForm loaded={data} />;
}

/**
 * Write or edit an advisory (HQ). A draft can be saved and published later; once published, content and deadline
 * stay editable and teams can be added (they are told right away). Teams that already answered cannot be removed.
 */
function AdvisoryForm({ loaded }: { loaded?: Loaded }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const teams = useLoad(() => get<{ teams?: { id: number; name: string }[] }>('/catalog'), []);
  const action = useAction();
  const [a, setA] = useState<AdvisoryDraft>(() =>
    loaded
      ? {
          title: loaded.title,
          source: loaded.source ?? '',
          severity: loaded.severity,
          summary: loaded.summary,
          cves: loaded.cves,
          affectedProducts: loaded.affectedProducts,
          iocs: loaded.iocs,
          references: loaded.references,
          recommendation: loaded.recommendation,
          responseDueAt: loaded.responseDueAt,
          teamIds: loaded.targets.map((x) => x.teamId),
        }
      : EMPTY,
  );
  // the deadline follows the severity until someone picks one
  const [dueTouched, setDueTouched] = useState(!!loaded);
  const set = (p: Partial<AdvisoryDraft>) => setA((x) => ({ ...x, ...p }));
  const draft = !loaded || loaded.status === 'draft';
  const answered = new Set((loaded?.targets ?? []).filter((x) => x.exposure !== 'pending').map((x) => x.teamId));

  const save = (publish: boolean) =>
    void action.run(async () => {
      const body = { ...a, source: a.source || null };
      let number = loaded?.number;
      if (loaded) await patch(`/advisories/${loaded.number}`, body);
      else number = (await post<{ number: string }>('/advisories', { ...body, publish })).number;
      if (loaded && publish) await post(`/advisories/${number}/publish`);
      navigate(`/advisories/${number}`);
    });

  const text = (key: keyof AdvisoryDraft, label: string, rows = 4, extra?: string) => (
    <Field label={label} extra={extra}>
      <Input.TextArea rows={rows} value={a[key] as string} onChange={(e) => set({ [key]: e.target.value })} />
    </Field>
  );

  return (
    <>
      <PageHeader title={loaded ? t('ui.advisory.edit_title', { number: loaded.number }) : t('ui.advisory.new')}>
        <div className="mono muted">
          <Link to="/advisories">{t('ui.nav.advisories')}</Link>
          {loaded && (
            <>
              {' / '}
              <Link to={`/advisories/${loaded.number}`}>{loaded.number}</Link>
            </>
          )}
        </div>
      </PageHeader>
      <Form layout="vertical" onFinish={() => save(false)}>
        <ErrorBanner error={action.error} />
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} lg={16}>
            <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{t('ui.advisory.content')}</h2>}>
              <Field label={t('ui.advisory.title')} required>
                <Input required maxLength={512} value={a.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              {text('summary', t('ui.advisory.summary'), 6, t('ui.advisory.summary_hint'))}
              <Field label={t('ui.advisory.cves')} extra={t('ui.advisory.cves_hint')}>
                <Select
                  mode="tags"
                  value={a.cves}
                  tokenSeparators={[',', ' ', '\n']}
                  onChange={(v: string[]) => set({ cves: v.map((x) => x.trim().toUpperCase()).filter(Boolean) })}
                  open={false}
                  suffixIcon={null}
                />
              </Field>
              {text('affectedProducts', t('ui.advisory.affected_products'), 3)}
              {text('iocs', t('ui.advisory.iocs'), 4, t('ui.advisory.iocs_hint'))}
              {text('recommendation', t('ui.advisory.recommendation'), 4)}
              {text('references', t('ui.advisory.references'), 3, t('ui.advisory.references_hint'))}
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{t('ui.advisory.dispatch')}</h2>}>
              <Field label={t('ui.advisory.severity')}>
                <Choice
                  value={a.severity}
                  onChange={(v) => set({ severity: v, ...(dueTouched ? {} : { responseDueAt: defaultDue(v) }) })}
                  options={SEVERITIES.map((s) => ({ value: s, label: t(`ui.advisory.severity.${s}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label={t('ui.advisory.source')}>
                <Input maxLength={255} value={a.source} onChange={(e) => set({ source: e.target.value })} placeholder={t('ui.advisory.source_placeholder')} />
              </Field>
              <Field label={t('ui.advisory.response_due')} required extra={t('ui.advisory.response_due_hint')}>
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  style={{ width: '100%' }}
                  value={a.responseDueAt ? dayjs(a.responseDueAt) : null}
                  onChange={(d: Dayjs | null) => {
                    setDueTouched(true);
                    set({ responseDueAt: d ? d.toISOString() : null });
                  }}
                />
              </Field>
              <Field label={t('ui.advisory.teams')} required extra={!draft ? t('ui.advisory.teams_hint_published') : undefined}>
                <MultiChoice
                  value={a.teamIds}
                  onChange={(v) => set({ teamIds: v })}
                  options={[
                    ...(teams.data?.teams ?? []).map((tm) => ({ value: tm.id, label: answered.has(tm.id) ? `${tm.name} ✓` : tm.name })),
                    // teams already on the advisory that have since been deactivated (D27) stay, but cannot be added anew
                    ...(loaded?.targets ?? [])
                      .filter((x) => teams.data?.teams && !teams.data.teams.some((tm) => tm.id === x.teamId))
                      .map((x) => ({ value: x.teamId, label: t('ui.teams.archived_label', { name: x.team }) })),
                  ]}
                  placeholder={t('ui.advisory.teams_placeholder')}
                  style={{ width: '100%' }}
                />
              </Field>
              {!teams.loading && !teams.data?.teams?.length && <Alert type="warning" showIcon title={t('ui.dashboard.no_teams')} style={{ marginBottom: 12 }} />}
              <Flex gap={8} wrap>
                {draft ? (
                  <>
                    <Button type="primary" loading={action.busy} disabled={action.busy || !a.title} onClick={() => save(true)}>
                      {t('ui.advisory.save_publish')}
                    </Button>
                    <Button htmlType="submit" loading={action.busy} disabled={action.busy || !a.title}>
                      {t('ui.advisory.save_draft')}
                    </Button>
                  </>
                ) : (
                  <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy || !a.title}>
                    {t('ui.common.save')}
                  </Button>
                )}
                <Button onClick={() => navigate(loaded ? `/advisories/${loaded.number}` : '/advisories')}>{t('ui.common.cancel')}</Button>
              </Flex>
              {draft && <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>{t('ui.advisory.publish_hint')}</p>}
            </Card>
          </Col>
        </Row>
      </Form>
    </>
  );
}
