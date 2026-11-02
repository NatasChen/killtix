import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { Alert, App, Button, Flex, List, Modal, Popconfirm } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post } from '../../api';
import { ErrorBanner, Loading, useAction, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';

/*
 * Deactivate, reactivate or delete a team (DECISIONS D27), system administrators only. The dialog first shows what
 * still uses the team; deactivating needs no members, no unresolved tickets, no help topic default and no unfinished
 * advisory answer; deleting also needs no ticket and no advisory history at all.
 */

type Blocker = 'members' | 'open_tickets' | 'help_topics' | 'advisories' | 'tickets' | 'advisory_history';
interface Report {
  team: { id: number; name: string; archivedAt: string | null };
  usage: { members: number; openTickets: number; tickets: number; helpTopics: string[]; advisoryTargets: number; unfinishedAdvisories: number };
  blockers: { archive: Blocker[]; delete: Blocker[] };
}

const OPEN = 'new,open,pending_user';

export function TeamRemoval({ team, onChange }: { team: { id: number; name: string; archivedAt: string | null }; onChange: () => Promise<void> }) {
  const { t } = useI18n();
  const p = usePalette();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const action = useAction();

  const show = () => {
    setOpen(true);
    setReport(null);
    void action.run(async () => setReport(await get<Report>(`/admin/teams/${team.id}/usage`)));
  };
  const done = async (text: string) => {
    void message.success(text);
    setOpen(false);
    await onChange();
  };
  const archive = () =>
    void action.run(async () => {
      await post(`/admin/teams/${team.id}/archive`);
      await done(t('ui.teams.archived_done', { name: team.name }));
    });
  const remove = () =>
    void action.run(async () => {
      await del(`/admin/teams/${team.id}`);
      await done(t('ui.teams.deleted_done', { name: team.name }));
    });
  const restore = () =>
    void action.run(async () => {
      await post(`/admin/teams/${team.id}/restore`);
      await done(t('ui.teams.restored_done', { name: team.name }));
    });

  /** One condition: met or not, with what it counts and where to fix it. */
  const item = (ok: boolean, label: ReactNode, fix?: ReactNode) => ({ ok, label, fix });
  const checks = (r: Report) => {
    const u = r.usage;
    const tickets = `/tickets?teamId=${team.id}`;
    return {
      both: [
        item(!u.members, t('ui.teams.check.members', { n: u.members }), u.members ? t('ui.teams.check.members_fix') : undefined),
        item(
          !u.openTickets,
          t('ui.teams.check.open_tickets', { n: u.openTickets }),
          u.openTickets ? <Link to={`${tickets}&status=${OPEN}`}>{t('ui.teams.check.open_tickets_fix')}</Link> : undefined,
        ),
        item(
          !u.helpTopics.length,
          t('ui.teams.check.help_topics', { names: u.helpTopics.join(', ') || '—' }),
          u.helpTopics.length ? <Link to="/admin/help-topics">{t('ui.teams.check.help_topics_fix')}</Link> : undefined,
        ),
        item(
          !u.unfinishedAdvisories,
          t('ui.teams.check.advisories', { n: u.unfinishedAdvisories }),
          u.unfinishedAdvisories ? <Link to="/advisories?status=published">{t('ui.teams.check.advisories_fix')}</Link> : undefined,
        ),
      ],
      deleteOnly: [
        item(!u.tickets, t('ui.teams.check.tickets', { n: u.tickets })),
        item(!u.advisoryTargets, t('ui.teams.check.advisory_history', { n: u.advisoryTargets })),
      ],
    };
  };
  const checklist = (items: ReturnType<typeof item>[]) => (
    <List
      size="small"
      dataSource={items}
      renderItem={(i) => (
        <List.Item>
          <Flex gap={8} align="flex-start">
            {i.ok ? <CheckCircleFilled style={{ color: p.success, marginTop: 4 }} aria-hidden /> : <CloseCircleFilled style={{ color: p.danger, marginTop: 4 }} aria-hidden />}
            <div>
              <div>{i.label}</div>
              {i.fix && <div className="small muted">{i.fix}</div>}
            </div>
          </Flex>
        </List.Item>
      )}
    />
  );

  const archived = !!team.archivedAt;
  const canArchive = !!report && !archived && !report.blockers.archive.length;
  const canDelete = !!report && !report.blockers.delete.length;

  return (
    <>
      {archived ? (
        <Popconfirm title={t('ui.teams.restore_confirm', { name: team.name })} okText={t('ui.teams.restore')} cancelText={t('ui.common.cancel')} onConfirm={restore}>
          <Button type="link">{t('ui.teams.restore')}</Button>
        </Popconfirm>
      ) : null}
      <Button type="link" danger onClick={show}>
        {archived ? t('ui.common.delete') : t('ui.teams.remove')}
      </Button>
      <Modal
        open={open}
        title={t(archived ? 'ui.teams.delete_title' : 'ui.teams.remove_title', { name: team.name })}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        width={640}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            {t('ui.common.cancel')}
          </Button>,
          ...(archived
            ? []
            : [
                <Button key="archive" loading={action.busy && !!report} disabled={action.busy || !canArchive} onClick={archive}>
                  {t('ui.teams.archive')}
                </Button>,
              ]),
          <Popconfirm key="delete" title={t('ui.teams.delete_confirm', { name: team.name })} okText={t('ui.common.delete')} okButtonProps={{ danger: true }} cancelText={t('ui.common.cancel')} onConfirm={remove} disabled={!canDelete}>
            <Button danger type="primary" disabled={action.busy || !canDelete}>
              {t('ui.common.delete')}
            </Button>
          </Popconfirm>,
        ]}>
        <ErrorBanner error={action.error} />
        {!report ? (
          action.error ? null : <Loading />
        ) : (
          <>
            {!archived && (
              <>
                <p style={{ marginTop: 0 }}>{t('ui.teams.archive_explain')}</p>
                {checklist(checks(report).both)}
              </>
            )}
            <p>{t('ui.teams.delete_explain')}</p>
            {checklist(checks(report).deleteOnly)}
            {!canDelete && canArchive && <Alert type="info" showIcon style={{ marginTop: 12 }} title={t('ui.teams.archive_instead')} />}
          </>
        )}
      </Modal>
    </>
  );
}
