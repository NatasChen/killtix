import { Button, Card, Checkbox, Col, Flex, Form, Input, Row, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '../../api';
import { Choice, ErrorBanner, Field, PageHeader, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { tableProps } from './shared';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'url'];

export function FormsPage() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<any[]>('/admin/forms'), []);
  const action = useAction();
  const [formName, setFormName] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const empty = { key: '', label: '', type: 'text', isRequired: false, options: '', regex: '', visibility: 'public', isFilterable: false };
  const [field, setField] = useState(empty);
  const current = data?.find((f) => f.id === selected) ?? data?.[0];
  const toggle = (id: number, key: string) => (e: { target: { checked: boolean } }) =>
    void action.run(async () => { await patch(`/admin/fields/${id}`, { [key]: e.target.checked }); await reload(); });

  const columns: TableColumnsType<any> = [
    { key: 'key', title: 'key', className: 'mono', render: (_, f) => f.key },
    {
      key: 'label',
      title: t('ui.admin.label'),
      render: (_, f) => (
        <>
          {f.label}
          {f.options?.length > 0 && <div className="small muted">{f.options.join(', ')}</div>}
        </>
      ),
    },
    { key: 'type', title: t('ui.admin.type'), render: (_, f) => f.type },
    { key: 'required', title: t('ui.admin.required'), render: (_, f) => <Checkbox checked={f.isRequired} onChange={toggle(f.id, 'isRequired')} aria-label={t('ui.admin.required')} /> },
    { key: 'visibility', title: t('ui.admin.visibility'), render: (_, f) => t(`ui.visibility.${f.visibility}`) },
    { key: 'filterable', title: t('ui.admin.filterable'), render: (_, f) => <Checkbox checked={f.isFilterable} onChange={toggle(f.id, 'isFilterable')} aria-label={t('ui.admin.filterable')} /> },
    { key: 'active', title: t('ui.admin.active'), render: (_, f) => <Checkbox checked={f.isActive} onChange={toggle(f.id, 'isActive')} aria-label={t('ui.admin.active')} /> },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.forms')} />
      <ErrorBanner error={action.error ?? error} />
      <Card style={{ marginBottom: 16 }}>
        <Form
          onFinish={() =>
            void action.run(async () => {
              const created = await post('/admin/forms', { name: formName });
              setFormName('');
              setSelected(created.id);
              await reload();
            })
          }
        >
          <Flex gap={8} wrap>
            <Input required placeholder={t('ui.admin.form_name')} value={formName} onChange={(e) => setFormName(e.target.value)} aria-label={t('ui.admin.form_name')} style={{ maxWidth: 320 }} />
            <Button type="primary" htmlType="submit">
              {t('ui.admin.add_form')}
            </Button>
          </Flex>
        </Form>
      </Card>
      <Card loading={loading && !data}>
        {data && data.length > 0 && (
          <>
            <Flex gap={8} wrap style={{ marginBottom: 12 }}>
              {data.map((f) => (
                <Button key={f.id} type={f.id === current?.id ? 'primary' : 'default'} onClick={() => setSelected(f.id)}>
                  {f.name}
                </Button>
              ))}
            </Flex>
            <p className="small muted">{t('ui.admin.form_hint')}</p>
          </>
        )}
        <Table {...tableProps} columns={columns} dataSource={current?.fields ?? []} />
        {current && (
          <Form
            layout="vertical"
            requiredMark={false}
            style={{ marginTop: 16 }}
            onFinish={() =>
              void action.run(async () => {
                await post(`/admin/forms/${current.id}/fields`, {
                  ...field,
                  regex: field.regex || null,
                  options: field.options.split(',').map((x) => x.trim()).filter(Boolean),
                });
                setField(empty);
                await reload();
              })
            }
          >
            <h3>{t('ui.admin.add_field')}</h3>
            <Row gutter={12}>
              <Col xs={24} sm={12} lg={6}>
                <Field label="key">
                  <Input required pattern="[A-Za-z0-9_\-]{1,64}" value={field.key} onChange={(e) => setField({ ...field, key: e.target.value })} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.label')}>
                  <Input required value={field.label} onChange={(e) => setField({ ...field, label: e.target.value })} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.type')}>
                  <Choice value={field.type} onChange={(v) => setField({ ...field, type: v })} options={FIELD_TYPES.map((ft) => ({ value: ft, label: ft }))} style={{ width: '100%' }} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.visibility')}>
                  <Choice
                    value={field.visibility}
                    onChange={(v) => setField({ ...field, visibility: v })}
                    options={[
                      { value: 'public', label: t('ui.visibility.public') },
                      { value: 'internal', label: t('ui.visibility.internal') },
                    ]}
                    style={{ width: '100%' }}
                  />
                </Field>
              </Col>
              {(field.type === 'select' || field.type === 'multiselect') && (
                <Col xs={24} sm={12} lg={6}>
                  <Field label={t('ui.admin.options')}>
                    <Input required value={field.options} onChange={(e) => setField({ ...field, options: e.target.value })} placeholder="prod, dev" />
                  </Field>
                </Col>
              )}
              {(field.type === 'text' || field.type === 'textarea') && (
                <Col xs={24} sm={12} lg={6}>
                  <Field label={t('ui.admin.regex')}>
                    <Input value={field.regex} onChange={(e) => setField({ ...field, regex: e.target.value })} placeholder="^[A-Z0-9-]+$" />
                  </Field>
                </Col>
              )}
            </Row>
            <Flex gap={16} align="center" wrap>
              <Checkbox checked={field.isRequired} onChange={(e) => setField({ ...field, isRequired: e.target.checked })}>
                {t('ui.admin.required')}
              </Checkbox>
              <Checkbox checked={field.isFilterable} onChange={(e) => setField({ ...field, isFilterable: e.target.checked })}>
                {t('ui.admin.filterable')}
              </Checkbox>
              <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
                {t('ui.common.add')}
              </Button>
            </Flex>
          </Form>
        )}
      </Card>
    </>
  );
}
