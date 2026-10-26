import { Button, Card, Flex, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { get } from '../../api';
import { DateTime, ErrorBanner, PageHeader, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { tableProps } from './shared';

export function AuditPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => get<any[]>(`/admin/audit-logs?page=${page}`), [page]);
  const columns: TableColumnsType<any> = [
    { key: 'created', title: t('ui.tickets.created'), className: 'nowrap', render: (_, a) => <DateTime value={a.createdAt} /> },
    { key: 'actor', title: t('ui.audit.actor'), className: 'small', render: (_, a) => a.actorEmail ?? '—' },
    { key: 'action', title: t('ui.audit.action'), className: 'mono small', render: (_, a) => a.action },
    { key: 'target', title: t('ui.audit.target'), className: 'small', render: (_, a) => (a.targetType ? `${a.targetType}#${a.targetId}` : '—') },
    { key: 'ip', title: 'IP', className: 'small', render: (_, a) => a.ip },
    { key: 'detail', title: t('ui.audit.detail'), className: 'mono small', render: (_, a) => (a.detail ? JSON.stringify(a.detail) : '') },
  ];
  return (
    <>
      <PageHeader title={t('ui.nav.audit')} />
      <ErrorBanner error={error} />
      <Card>
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
        {/* the audit API pages by 100 rows and returns no total, so the pager only steps back and forth */}
        <Flex justify="flex-end" align="center" gap={8} style={{ marginTop: 12 }}>
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </Button>
          <span className="small">{page}</span>
          <Button disabled={(data?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>
            ›
          </Button>
        </Flex>
      </Card>
    </>
  );
}
