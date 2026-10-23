import { useState, type FormEvent, type ReactNode } from 'react';
import { get, patch, post } from '../../api';
import { Empty, ErrorBanner, Loading, useAction, useLoad } from '../../components/common';
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
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
      <div className="topline">
        <h1>{title}</h1>
        <button className="primary" onClick={() => open('new')}>
          {t('ui.common.add')}
        </button>
      </div>
      {editing && (
        <form className="card form" onSubmit={submit}>
          <h2>{editing === 'new' ? t('ui.common.add') : t('ui.common.edit')}</h2>
          <ErrorBanner error={action.error} />
          <div className="form-row">
            {fields.map((f) => {
              const disabled = editing !== 'new' && f.createOnly;
              const value = form[f.key];
              const set = (v: unknown) => setForm((s) => ({ ...s, [f.key]: v }));
              if (f.type === 'checkbox') {
                return (
                  <label key={f.key} className="inline">
                    <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => set(e.target.checked)} />
                    {f.label}
                  </label>
                );
              }
              return (
                <label key={f.key}>
                  {f.label}
                  {f.type === 'textarea' ? (
                    <textarea required={f.required} disabled={disabled} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
                  ) : f.type === 'select' ? (
                    <select required={f.required} disabled={disabled} value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
                      <option value="">—</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      required={f.required}
                      disabled={disabled}
                      value={String(value ?? '')}
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <div className="actions">
            <button className="primary" disabled={action.busy}>
              {t('ui.common.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              {t('ui.common.cancel')}
            </button>
          </div>
        </form>
      )}
      <div className="card">
        <ErrorBanner error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.label}>{c.label}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.label}>{c.render(row)}</td>
                    ))}
                    <td>
                      <button className="link" onClick={() => open(row)}>
                        {t('ui.common.edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
