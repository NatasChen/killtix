import { Button, Card, Form, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { get, post } from '../../api';
import { Choice, DateTime, ErrorBanner, Field, PageHeader, ToneTag, useAction, useLoad, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';
import { tableProps } from './shared';

export function NotificationsPage() {
  const { t } = useI18n();
  const p = usePalette();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<any[]>(`/admin/notifications${status ? `?status=${status}` : ''}`), [status]);
  const action = useAction();
  const columns: TableColumnsType<any> = [
    { key: 'created', title: t('ui.tickets.created'), className: 'nowrap', render: (_, n) => <DateTime value={n.createdAt} /> },
    { key: 'channel', title: t('ui.notify.channel'), render: (_, n) => n.channel },
    { key: 'recipient', title: t('ui.notify.recipient'), className: 'small', render: (_, n) => n.recipient },
    {
      key: 'subject',
      title: t('ui.tickets.subject'),
      render: (_, n) => (
        <>
          {n.subject}
          {n.lastError && (
            <div className="small" style={{ color: p.danger }}>
              {n.lastError}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'status',
      title: t('ui.tickets.status'),
      render: (_, n) => <ToneTag tone={n.status === 'sent' ? 'green' : n.status === 'dead' ? 'red' : 'grey'}>{t(`ui.notify.${n.status}`)}</ToneTag>,
    },
    { key: 'attempts', title: t('ui.notify.attempts'), className: 'num', render: (_, n) => n.attempts },
    {
      key: 'retry',
      title: '',
      render: (_, n) =>
        ['dead', 'skipped', 'disabled'].includes(n.status) && (
          <Button type="link" onClick={() => void action.run(async () => { await post(`/admin/notifications/${n.id}/retry`); await reload(); })}>
            {t('ui.notify.retry')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title={t('ui.nav.notifications')} />
      <ErrorBanner error={action.error ?? error} />
      <Card>
        <Form layout="vertical" style={{ maxWidth: 260 }}>
          <Field label={t('ui.tickets.status')}>
            <Choice
              value={status}
              onChange={setStatus}
              empty={t('ui.common.all')}
              options={['pending', 'sent', 'dead', 'skipped', 'disabled'].map((x) => ({ value: x, label: t(`ui.notify.${x}`) }))}
              style={{ width: '100%' }}
            />
          </Field>
        </Form>
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
      </Card>
    </>
  );
}
