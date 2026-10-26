import { Button, Flex, Form, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post } from '../../api';
import { ErrorBanner, Field, MultiChoice, ToneTag, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { tableProps } from './shared';

type Member = {
  id: number;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  lockedUntil: string | null;
  openAssigned: number;
  seesTeamTickets: boolean;
};
type Candidate = { id: number; displayName: string; email: string; role: string };

const OPEN = 'new,open,pending_user';

/** A team's members and their current state, with add / remove (DECISIONS D18); shown in an expanded team row. */
export function TeamMembers({ teamId, teamName, onChange }: { teamId: number; teamName: string; onChange: () => Promise<void> }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<{ members: Member[]; candidates: Candidate[] }>(`/admin/teams/${teamId}/members`), [teamId]);
  const action = useAction();
  const [adding, setAdding] = useState<number[]>([]);
  // the team list shows the member count, so it reloads too
  const changed = async () => {
    await reload();
    await onChange();
  };
  const add = () =>
    void action.run(async () => {
      await post(`/admin/teams/${teamId}/members`, { userIds: adding });
      setAdding([]);
      await changed();
    });
  const remove = (m: Member) =>
    void action.run(async () => {
      await del(`/admin/teams/${teamId}/members/${m.id}`);
      await changed();
    });

  const columns: TableColumnsType<Member> = [
    {
      key: 'name',
      title: t('ui.admin.name'),
      render: (_, m) => (
        <>
          {m.displayName}
          <div className="muted small">{m.email}</div>
        </>
      ),
    },
    {
      key: 'role',
      title: t('ui.admin.role'),
      render: (_, m) => (
        <>
          {t(`ui.role.${m.role}`)}
          {!m.seesTeamTickets && <div className="muted small">{t('ui.teams.no_team_tickets')}</div>}
        </>
      ),
    },
    {
      key: 'state',
      title: t('ui.teams.state'),
      render: (_, m) =>
        !m.isActive ? (
          <ToneTag tone="grey">{t('ui.teams.inactive')}</ToneTag>
        ) : m.lockedUntil && new Date(m.lockedUntil) > new Date() ? (
          <ToneTag tone="red">{t('ui.admin.locked')}</ToneTag>
        ) : (
          <ToneTag tone="green">{t('ui.admin.active')}</ToneTag>
        ),
    },
    {
      key: 'open',
      title: t('ui.teams.open_assigned'),
      render: (_, m) => (m.openAssigned ? <Link to={`/tickets?assignee=${m.id}&status=${OPEN}`}>{m.openAssigned}</Link> : 0),
    },
    {
      key: 'remove',
      title: '',
      render: (_, m) => (
        <Button size="small" onClick={() => remove(m)} disabled={action.busy} aria-label={t('ui.teams.remove_member', { name: m.displayName })}>
          {t('ui.common.remove')}
        </Button>
      ),
    },
  ];

  return (
    <section aria-label={t('ui.teams.members_of', { team: teamName })}>
      <ErrorBanner error={error ?? action.error} />
      <Table<Member>
        {...tableProps}
        size="small"
        dataSource={data?.members ?? []}
        loading={loading && !data}
        columns={columns}
        locale={{ emptyText: t('ui.teams.no_members') }}
      />
      <Form layout="vertical" requiredMark={false} onFinish={add} style={{ marginTop: 12 }}>
        <Flex gap={8} align="flex-end" wrap>
          <div style={{ flex: '1 1 280px', maxWidth: 520 }}>
            <Field label={t('ui.teams.add_members')}>
              <MultiChoice
                value={adding}
                onChange={setAdding}
                options={(data?.candidates ?? []).map((u) => ({ value: u.id, label: `${u.displayName} (${t(`ui.role.${u.role}`)})` }))}
                style={{ width: '100%' }}
              />
            </Field>
          </div>
          <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy || !adding.length} style={{ marginBottom: 12 }}>
            {t('ui.common.add')}
          </Button>
        </Flex>
      </Form>
    </section>
  );
}
