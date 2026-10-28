import { Button, Card, Checkbox, Col, Form, Input, Row, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { del, get, patch, put } from '../../api';
import { Choice, ErrorBanner, Field, PageHeader, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { LogoSettings } from './LogoSettings';
import { MailSettingsCard } from './MailSettingsCard';
import { NotifySettingsCard } from './NotifySettingsCard';
import { sectionTitle, tableProps } from './shared';

export function SettingsPage() {
  const { t, locales } = useI18n();
  const settings = useLoad(() => get<{ '2faEnforced': boolean }>('/admin/settings'), []);
  const glossary = useLoad(() => get<any[]>('/admin/glossary'), []);
  const action = useAction();
  const [term, setTerm] = useState({ locale: locales[0] ?? 'zh-TW', key: '', value: '' });

  const columns: TableColumnsType<any> = [
    { key: 'locale', title: t('ui.common.language'), render: (_, g) => g.locale },
    { key: 'key', title: 'key', className: 'mono', render: (_, g) => g.key },
    { key: 'value', title: t('ui.settings.value'), render: (_, g) => g.value },
    {
      key: 'remove',
      title: '',
      render: (_, g) => (
        <Button type="link" onClick={() => void action.run(async () => { await del(`/admin/glossary/${g.id}`); await glossary.reload(); })}>
          {t('ui.common.remove')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.settings')} />
      <ErrorBanner error={action.error ?? settings.error} />
      <Card title={sectionTitle(t('ui.settings.security'))} style={{ marginBottom: 16 }}>
        {settings.data && (
          <Checkbox
            checked={settings.data['2faEnforced']}
            onChange={(e) =>
              void action.run(async () => {
                await patch('/admin/settings', { '2faEnforced': e.target.checked });
                await settings.reload();
              })
            }
          >
            {t('ui.settings.enforce_2fa')}
          </Checkbox>
        )}
        <p className="small muted">{t('ui.settings.enforce_2fa_hint')}</p>
      </Card>
      <LogoSettings />
      <NotifySettingsCard />
      <MailSettingsCard />
      <Card title={sectionTitle(t('ui.settings.glossary'))}>
        <p className="small muted">{t('ui.settings.glossary_hint')}</p>
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={() =>
            void action.run(async () => {
              await put('/admin/glossary', term);
              setTerm({ ...term, key: '', value: '' });
              await glossary.reload();
            })
          }
        >
          <Row gutter={12} align="bottom">
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.common.language')}>
                <Choice
                  value={term.locale}
                  onChange={(v) => setTerm({ ...term, locale: v })}
                  options={locales.map((l) => ({ value: l, label: t(`ui.locale.${l}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Field label="key">
                <Input required value={term.key} onChange={(e) => setTerm({ ...term, key: e.target.value })} placeholder="ticket.status.open" />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.value')}>
                <Input required value={term.value} onChange={(e) => setTerm({ ...term, value: e.target.value })} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={4}>
              <Form.Item style={{ marginBottom: 12 }}>
                <Button type="primary" htmlType="submit">
                  {t('ui.common.save')}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {glossary.data && glossary.data.length > 0 && <Table {...tableProps} columns={columns} dataSource={glossary.data} />}
      </Card>
    </>
  );
}
