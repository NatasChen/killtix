import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Flex, Modal, Table, Tag, Upload, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { post } from '../../api';
import { ErrorBanner, ToneTag, useAction, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';

/* Teams from a CSV file (DECISIONS D26): download the template, upload, check every row, then import all or nothing. */

interface RowError {
  code: string;
  value?: string;
}
interface ImportRow {
  line: number;
  name: string;
  teamid: string | null;
  description: string;
  members: string[];
  errors: RowError[];
}
interface Preview {
  rows: ImportRow[];
  valid: boolean;
  teams: number;
  members: number;
}

/** Same limit as the server (IMPORT_MAX_BYTES). */
const MAX_BYTES = 1024 * 1024;

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export function TeamImport({ onImported }: { onImported: () => Promise<void> }) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const action = useAction();

  const reset = () => {
    setFile(null);
    setPreview(null);
    action.setError(undefined);
  };
  const choose = (f: File) => {
    reset();
    if (f.size > MAX_BYTES) {
      action.setError(new Error(t('ui.teams.import.too_large')));
      return;
    }
    void action.run(async () => {
      const data = await toBase64(f);
      setFile({ name: f.name, data });
      setPreview(await post<Preview>('/admin/teams/import/preview', { data }));
    });
  };
  const confirm = () =>
    void action.run(async () => {
      const { created } = await post<{ created: unknown[] }>('/admin/teams/import', { data: file!.data });
      void message.success(t('ui.teams.import.done', { n: created.length }));
      setOpen(false);
      reset();
      await onImported();
    });

  const columns: TableColumnsType<ImportRow> = [
    { key: 'line', title: t('ui.teams.import.line'), className: 'num', render: (_, r) => r.line },
    { key: 'name', title: t('ui.teams.import.col.name'), render: (_, r) => r.name || <span className="muted">—</span> },
    {
      key: 'teamid',
      title: t('ui.teams.import.col.teamid'),
      render: (_, r) => (r.teamid ? <span className="mono small">{r.teamid}</span> : <span className="muted small">{t('ui.teams.import.generated')}</span>),
    },
    { key: 'members', title: t('ui.teams.import.col.members'), render: (_, r) => (r.members.length ? r.members.map((m) => <Tag key={m}>{m}</Tag>) : <span className="muted">—</span>) },
    {
      key: 'result',
      title: t('ui.teams.import.result'),
      render: (_, r) =>
        r.errors.length ? (
          <Flex vertical gap={2}>
            {r.errors.map((e, i) => (
              <span key={i} className="small" style={{ color: p.danger }}>
                {t(`ui.teams.import.error.${e.code}`, { value: e.value ?? '' })}
              </span>
            ))}
          </Flex>
        ) : (
          <ToneTag tone="green">{t('ui.teams.import.ok')}</ToneTag>
        ),
    },
  ];
  const bad = preview ? preview.rows.filter((r) => r.errors.length).length : 0;

  return (
    <>
      <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>
        {t('ui.teams.import.button')}
      </Button>
      <Modal
        open={open}
        title={t('ui.teams.import.title')}
        width={960}
        onCancel={() => {
          setOpen(false);
          reset();
        }}
        destroyOnHidden
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setOpen(false);
              reset();
            }}>
            {t('ui.common.cancel')}
          </Button>,
          <Button key="ok" type="primary" loading={action.busy} disabled={action.busy || !preview?.valid} onClick={confirm}>
            {t('ui.teams.import.confirm', { n: preview?.teams ?? 0 })}
          </Button>,
        ]}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={t('ui.teams.import.hint')}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              <li>{t('ui.teams.import.hint_columns')}</li>
              <li>{t('ui.teams.import.hint_members')}</li>
              <li>{t('ui.teams.import.hint_rules')}</li>
            </ul>
          }
        />
        <Flex gap={8} wrap align="center" style={{ marginBottom: 12 }}>
          <Button icon={<DownloadOutlined />} href="/api/v1/admin/teams/import/template.csv">
            {t('ui.teams.import.template')}
          </Button>
          <Upload
            accept=".csv,text/csv"
            showUploadList={false}
            beforeUpload={(f) => {
              choose(f);
              return false; // sent as JSON, like the logo
            }}>
            <Button type="primary" ghost icon={<UploadOutlined />} loading={action.busy && !preview} disabled={action.busy}>
              {t('ui.teams.import.choose')}
            </Button>
          </Upload>
          {file && <span className="small muted">{file.name}</span>}
        </Flex>
        <ErrorBanner error={action.error} />
        {preview && (
          <>
            {preview.valid ? (
              <Alert type="success" showIcon style={{ marginBottom: 12 }} title={t('ui.teams.import.ready', { teams: preview.teams, members: preview.members })} />
            ) : (
              <Alert type="error" showIcon style={{ marginBottom: 12 }} title={t('ui.teams.import.has_errors', { n: bad })} />
            )}
            <Table<ImportRow>
              rowKey="line"
              size="small"
              columns={columns}
              dataSource={preview.rows}
              pagination={preview.rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
              scroll={{ x: 'max-content' }}
            />
          </>
        )}
      </Modal>
    </>
  );
}
