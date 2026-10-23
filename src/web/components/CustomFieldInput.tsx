export interface FieldDef {
  key: string;
  label: string;
  type: string;
  isRequired?: boolean;
  options: string[];
  visibility?: string;
}

/** Renders the input for one custom field type. */
export function CustomFieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const required = field.isRequired && field.visibility !== 'internal';
  switch (field.type) {
    case 'textarea':
      return <textarea required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
      return <input type="date" required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input type="email" required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'url':
      return <input type="url" required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <select
          multiple
          value={selected}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <input required={required} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function formatFieldValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}
