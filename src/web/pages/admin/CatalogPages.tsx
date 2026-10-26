import { useI18n } from '../../i18n';
import { CrudPage } from './Crud';
import { useOptions } from './shared';
import { TeamMembers } from './TeamMembers';

/* Simple catalog resources (catalog:manage), each a CrudPage configuration. */

const yes = (v: unknown) => (v ? '✓' : '—');

export function TeamsPage() {
  const { t } = useI18n();
  return (
    <CrudPage
      title={t('ui.nav.teams')}
      path="/admin/teams"
      columns={[
        { label: t('ui.admin.name'), render: (r: any) => r.name },
        { label: t('ui.admin.description'), render: (r: any) => r.description },
        { label: t('ui.admin.members'), render: (r: any) => r.memberCount },
      ]}
      fields={[
        { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
        { key: 'description', label: t('ui.admin.description'), type: 'textarea' },
      ]}
      // expand a team to see its members and add or remove them
      expand={(r: any, reload) => <TeamMembers teamId={r.id} teamName={r.name} onChange={reload} />}
    />
  );
}

export function SlaPlansPage() {
  const { t } = useI18n();
  return (
    <CrudPage
      title={t('ui.nav.sla_plans')}
      path="/admin/sla-plans"
      columns={[
        { label: t('ui.admin.name'), render: (r: any) => r.name },
        { label: t('ui.admin.first_response_minutes'), render: (r: any) => r.firstResponseMinutes },
        { label: t('ui.admin.resolution_minutes'), render: (r: any) => r.resolutionMinutes },
        { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
      ]}
      fields={[
        { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
        { key: 'firstResponseMinutes', label: t('ui.admin.first_response_minutes'), type: 'number', required: true },
        { key: 'resolutionMinutes', label: t('ui.admin.resolution_minutes'), type: 'number', required: true },
        { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox', createOnly: false },
      ]}
      defaults={{ isActive: true }}
    />
  );
}

export function HelpTopicsPage() {
  const { t } = useI18n();
  const teams = useOptions('/admin/teams');
  const slaPlans = useOptions('/admin/sla-plans');
  const forms = useOptions('/admin/forms');
  const topics = useOptions('/admin/help-topics');
  return (
    <CrudPage
      title={t('ui.nav.help_topics')}
      path="/admin/help-topics"
      columns={[
        { label: t('ui.admin.name'), render: (r: any) => r.name },
        { label: 'slug', render: (r: any) => <span className="mono">{r.slug}</span> },
        { label: t('ui.nav.forms'), render: (r: any) => forms.find((f) => f.value === r.formId)?.label ?? '—' },
        { label: t('ui.nav.sla_plans'), render: (r: any) => slaPlans.find((s) => s.value === r.slaPlanId)?.label ?? '—' },
        { label: t('ui.admin.public'), render: (r: any) => yes(r.isPublic) },
        { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
      ]}
      fields={[
        { key: 'slug', label: 'slug', type: 'text', required: true },
        { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
        { key: 'description', label: t('ui.admin.description'), type: 'textarea' },
        { key: 'parentId', label: t('ui.admin.parent'), type: 'select', options: topics },
        { key: 'formId', label: t('ui.nav.forms'), type: 'select', options: forms },
        { key: 'slaPlanId', label: t('ui.nav.sla_plans'), type: 'select', options: slaPlans },
        { key: 'defaultTeamId', label: t('ui.admin.default_team'), type: 'select', options: teams },
        { key: 'autoTags', label: t('ui.admin.auto_tags'), type: 'tags' },
        { key: 'isPublic', label: t('ui.admin.public'), type: 'checkbox' },
        { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox' },
      ]}
      defaults={{ isPublic: true, isActive: true }}
    />
  );
}

export function CannedResponsesPage() {
  const { t } = useI18n();
  const teams = useOptions('/admin/teams');
  return (
    <CrudPage
      title={t('ui.nav.canned')}
      path="/admin/canned-responses"
      columns={[
        { label: t('ui.admin.name'), render: (r: any) => r.name },
        { label: t('ui.admin.body'), render: (r: any) => <span className="small">{String(r.body).slice(0, 120)}</span> },
        { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
      ]}
      fields={[
        { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
        { key: 'body', label: t('ui.admin.body_hint'), type: 'textarea', required: true },
        { key: 'teamId', label: t('ui.tickets.team'), type: 'select', options: teams },
        { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox' },
      ]}
      defaults={{ isActive: true }}
    />
  );
}
