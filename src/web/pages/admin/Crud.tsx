import { Button, Card, Checkbox, Col, Flex, Form, Input, Row, Table } from 'antd';
import { useState, type ReactNode } from 'react';
import { get, patch, post } from '../../api';
import { Choice, ErrorBanner, Field, PageHeader, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';

export interface CrudField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'tags';
  options?: { value: string | number; label: string }[];
  required?: boolean;
  /** Only editable when creating. */
  createOnly?: boolean;
}

export interface CrudColumn<T> {
  label: string;
  render: (row: T) => ReactNode;
}

type Row = { id: number } & Record<string, unknown>;

function toInput(field: CrudField, value: unknown): unknown {
  if (field.type === 'tags') return Array.isArray(value) ? value.join(', ') : '';
  if (field.type === 'checkbox') return Boolean(value);
  return value ?? '';
}

function fromInput(field: CrudField, value: unknown): unknown {
  if (field.type === 'tags') return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (field.type === 'number') return value === '' ? undefined : Number(value);
  if (field.type === 'select') return value === '' ? null : Number.isNaN(Number(value)) ? value : Number(value);
  if (field.type === 'checkbox') return Boolean(value);
  return value === '' ? undefined : value;
}

/** Generic list + create/edit page for simple admin resources. */
export function CrudPage<T extends Row>({
  title,
  path,
  listPath = path,
  columns,
  fields,
  defaults = {},
}: {
  title: string;
  path: string;
  listPath?: string;
  columns: CrudColumn<T>[];
  fields: CrudField[];
  defaults?: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<T[]>(listPath), [listPath]);
  const action = useAction();
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});

  const open = (row: T | 'new') => {
    setEditing(row);
    const source = row === 'new' ? defaults : row;
    setForm(Object.fromEntries(fields.map((f) => [f.key, toInput(f, source[f.key])])));
  };

  const submit = () => {
    const isNew = editing === 'new';
    const body = Object.fromEntries(
      fields
        .filter((f) => isNew || !f.createOnly)
        .map((f) => [f.key, fromInput(f, form[f.key])])
        .filter(([, v]) => v !== undefined),
    );
    void action.run(async () => {
      if (isNew) await post(path, body);
      else await patch(`${path}/${(editing as T).id}`, body);
      setEditing(null);
      await reload();
    });
  };

  return (
    <>
      <PageHeader
        title={title}
        extra={
          <Button type="primary" onClick={() => open('new')}>
            {t('ui.common.add')}
          </Button>
        }
      />
      {editing && (
        <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{editing === 'new' ? t('ui.common.add') : t('ui.common.edit')}</h2>} style={{ marginBottom: 16 }}>
          <Form layout="vertical" requiredMark={false} onFinish={submit}>
            <ErrorBanner error={action.error} />
            <Row gutter={12}>
              {fields.map((f) => {
                const disabled = editing !== 'new' && f.createOnly;
                const value = form[f.key];
                const set = (v: unknown) => setForm((s) => ({ ...s, [f.key]: v }));
                if (f.type === 'checkbox') {
                  return (
                    <Col key={f.key} xs={24} sm={12} lg={8}>
                      <Form.Item style={{ marginBottom: 12 }}>
                        <Checkbox checked={Boolean(value)} disabled={disabled} onChange={(e) => set(e.target.checked)}>
                          {f.label}
                        </Checkbox>
                      </Form.Item>
                    </Col>
                  );
                }
                return (
                  <Col key={f.key} xs={24} sm={12} lg={f.type === 'textarea' ? 24 : 8}>
                    <Field label={f.label}>
                      {f.type === 'textarea' ? (
                        <Input.TextArea required={f.required} disabled={disabled} autoSize={{ minRows: 3 }} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
                      ) : f.type === 'select' ? (
                        <Choice disabled={disabled} value={String(value ?? '')} onChange={set} empty="—" options={f.options ?? []} style={{ width: '100%' }} />
                      ) : (
                        <Input
                          type={f.type === 'number' ? 'number' : 'text'}
                          required={f.required}
                          disabled={disabled}
                          value={String(value ?? '')}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                    </Field>
                  </Col>
                );
              })}
            </Row>
            <Flex gap={8}>
              <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
                {t('ui.common.save')}
              </Button>
              <Button onClick={() => setEditing(null)}>{t('ui.common.cancel')}</Button>
            </Flex>
          </Form>
        </Card>
      )}
      <Card>
        <ErrorBanner error={error} />
        <Table<T>
          rowKey="id"
          dataSource={data ?? []}
          loading={loading && !data}
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
          columns={[
            ...columns.map((c) => ({ key: c.label, title: c.label, render: (_: unknown, row: T) => c.render(row) })),
            {
              key: '_edit',
              title: '',
              render: (_: unknown, row: T) => (
                <Button type="link" onClick={() => open(row)}>
                  {t('ui.common.edit')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
