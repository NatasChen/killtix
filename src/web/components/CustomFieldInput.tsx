import { Checkbox, Input, Select } from 'antd';

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  isRequired?: boolean;
  options: string[];
  visibility?: string;
}

/** Renders the input for one custom field type. `id` ties it to its <Field> label. */
export function CustomFieldInput({ field, value, onChange, id }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; id?: string }) {
  const required = field.isRequired && field.visibility !== 'internal';
  const text = (value as string) ?? '';
  switch (field.type) {
    case 'textarea':
      return <Input.TextArea id={id} required={required} autoSize={{ minRows: 3 }} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input id={id} type="number" required={required} value={text} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
    case 'email':
    case 'url':
      return <Input id={id} type={field.type} required={required} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <Checkbox id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'select':
      return (
        <Select
          id={id}
          value={text}
          onChange={(v) => onChange(v)}
          options={[{ value: '', label: '—' }, ...field.options.map((o) => ({ value: o, label: o, title: o }))]}
        />
      );
    case 'multiselect':
      return (
        <Select
          id={id}
          mode="multiple"
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
          options={field.options.map((o) => ({ value: o, label: o, title: o }))}
        />
      );
    default:
      return <Input id={id} required={required} value={text} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function formatFieldValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}
