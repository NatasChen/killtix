import { Button, Card, Col, Form, Input, Row } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { CustomFieldInput, type FieldDef } from '../components/CustomFieldInput';
import { Choice, ErrorBanner, Field, PageHeader, useAction, useLoad } from '../components/common';
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
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [teamId, setTeamId] = useState<number | ''>('');
  const topic = topics.data?.find((tp) => tp.id === topicId);
  const staff = can('ticket:note');
  const canAssign = can('ticket:assign');
  const catalog = useLoad(
    () => (canAssign ? get<{ users?: { id: number; displayName: string; role: string }[]; teams?: { id: number; name: string }[] }>('/catalog') : Promise.resolve({ users: [], teams: [] })),
    [canAssign],
  );
  const assignable = (catalog.data?.users ?? []).filter((u) => ['super_admin', 'it_manager', 'agent', 'vendor'].includes(u.role));

  const submit = () => {
    void run(async () => {
      const customFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v != null));
      const created = await post<{ number: string }>('/tickets', {
        subject,
        description,
        priority,
        helpTopicId: topicId || undefined,
        customFields,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        assigneeId: assigneeId || undefined,
        teamId: teamId || undefined, // blank: the help topic's default team
      });
      navigate(`/tickets/${created.number}`);
    });
  };

  return (
    <>
      <PageHeader title={t('ui.nav.new_ticket')} />
      <Card style={{ maxWidth: 760 }}>
        <Form layout="vertical" requiredMark={false} onFinish={submit}>
          <ErrorBanner error={error} />
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Field label={t('ui.tickets.help_topic')} extra={topic?.description || undefined}>
                <Choice
                  value={topicId}
                  onChange={(v) => {
                    setTopicId(v ? Number(v) : '');
                    setFields({});
                  }}
                  empty="—"
                  options={topics.data?.map((tp) => ({ value: tp.id, label: tp.name })) ?? []}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
            <Col xs={24} sm={12}>
              <Field label={t('ui.tickets.priority')}>
                <Choice
                  value={priority}
                  onChange={(v) => setPriority(Number(v))}
                  options={[1, 2, 3, 4, 5].map((p) => ({ value: p, label: t(`ticket.priority.${p}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
          </Row>
          {canAssign && (
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Field label={t('ui.tickets.assignee')}>
                  <Choice
                    value={assigneeId}
                    onChange={(v) => setAssigneeId(v ? Number(v) : '')}
                    empty={t('ui.tickets.unassigned')}
                    options={assignable.map((u) => ({ value: u.id, label: `${u.displayName} (${t(`ui.role.${u.role}`)})` }))}
                    style={{ width: '100%' }}
                  />
                </Field>
              </Col>
              <Col xs={24} sm={12}>
                <Field label={t('ui.tickets.team')}>
                  <Choice
                    value={teamId}
                    onChange={(v) => setTeamId(v ? Number(v) : '')}
                    empty={t('ui.tickets.team_default')}
                    options={(catalog.data?.teams ?? []).map((tm) => ({ value: tm.id, label: tm.name }))}
                    style={{ width: '100%' }}
                  />
                </Field>
              </Col>
            </Row>
          )}
          <Field label={t('ui.tickets.subject')}>
            <Input required maxLength={512} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label={t('ui.tickets.description')}>
            <Input.TextArea autoSize={{ minRows: 5 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {topic && topic.fields.length > 0 && (
            <Row gutter={12}>
              {topic.fields.map((f) => (
                <Col key={f.key} xs={24} sm={12}>
                  <Field
                    label={
                      <>
                        {f.label}
                        {f.isRequired && f.visibility !== 'internal' ? ' *' : ''}
                        {f.visibility === 'internal' && <span className="small"> ({t('ui.tickets.internal_field')})</span>}
                      </>
                    }
                  >
                    <CustomFieldInput field={f} value={fields[f.key]} onChange={(v) => setFields((s) => ({ ...s, [f.key]: v }))} />
                  </Field>
                </Col>
              ))}
            </Row>
          )}
          <Field label={t('ui.tickets.tags')}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={staff ? 'vpn,network' : t('ui.tickets.tags_existing_only')} />
          </Field>
          <Button type="primary" htmlType="submit" loading={busy} disabled={busy}>
            {t('ui.tickets.submit')}
          </Button>
        </Form>
      </Card>
    </>
  );
}
