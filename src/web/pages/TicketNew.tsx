import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { CustomFieldInput, type FieldDef } from '../components/CustomFieldInput';
import { ErrorBanner, useAction, useLoad } from '../components/common';
import { useI18n } from '../i18n';

interface HelpTopic {
  id: number;
  name: string;
  description: string | null;
  fields: (FieldDef & { isRequired: boolean })[];
}

export function TicketNewPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const topics = useLoad(() => get<HelpTopic[]>('/help-topics'), []);
  const [topicId, setTopicId] = useState<number | ''>('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [tags, setTags] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const topic = topics.data?.find((tp) => tp.id === topicId);
  const staff = can('ticket:note');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const customFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v != null));
      const created = await post<{ number: string }>('/tickets', {
        subject,
        description,
        priority,
        helpTopicId: topicId || undefined,
        customFields,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      });
      navigate(`/tickets/${created.number}`);
    });
  };

  return (
    <>
      <h1>{t('ui.nav.new_ticket')}</h1>
      <form className="card form" onSubmit={submit} style={{ maxWidth: 760 }}>
        <ErrorBanner error={error} />
        <div className="form-row">
          <label>
            {t('ui.tickets.help_topic')}
            <select
              value={topicId}
              onChange={(e) => {
                setTopicId(e.target.value ? Number(e.target.value) : '');
                setFields({});
              }}
            >
              <option value="">—</option>
              {topics.data?.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ui.tickets.priority')}
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {t(`ticket.priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {topic?.description && <p className="muted small">{topic.description}</p>}
        <label>
          {t('ui.tickets.subject')}
          <input required maxLength={512} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          {t('ui.tickets.description')}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {topic && topic.fields.length > 0 && (
          <div className="form-row">
            {topic.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.isRequired && f.visibility !== 'internal' ? ' *' : ''}
                {f.visibility === 'internal' && <span className="small"> ({t('ui.tickets.internal_field')})</span>}
                <CustomFieldInput field={f} value={fields[f.key]} onChange={(v) => setFields((s) => ({ ...s, [f.key]: v }))} />
              </label>
            ))}
          </div>
        )}
        <label>
          {t('ui.tickets.tags')}
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={staff ? 'vpn,network' : t('ui.tickets.tags_existing_only')} />
        </label>
        <div className="actions">
          <button className="primary" disabled={busy}>
            {t('ui.tickets.submit')}
          </button>
        </div>
      </form>
    </>
  );
}
