import { Alert, Button, Card, Col, Flex, Form, Input, Row, Upload } from 'antd';
import { useState } from 'react';
import { del, put } from '../../api';
import { useBranding, type LogoUrls } from '../../branding';
import { ErrorBanner, Field, useAction, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';
import { sectionTitle } from './shared';

export function LogoSettings() {
  const { t } = useI18n();
  const p = usePalette();
  const { logo, setLogo, name, setName } = useBranding();
  const action = useAction();
  const [active, setActive] = useState<keyof LogoUrls | 'name'>(); // what is being saved, for its button's spinner
  const [draft, setDraft] = useState<string>();
  const [saved, setSaved] = useState(false);
  const saveName = () =>
    void action.run(async () => {
      setActive('name');
      setSaved(false);
      setName((await put<{ name: string }>('/admin/branding/name', { name: draft ?? name })).name);
      setDraft(undefined);
      setSaved(true);
    });
  const upload = (variant: keyof LogoUrls, file: File) =>
    void action.run(async () => {
      setActive(variant);
      setSaved(false);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      setLogo((await put<{ logo: LogoUrls }>(`/admin/branding/logo/${variant}`, { data })).logo);
    });
  const remove = (variant: keyof LogoUrls) =>
    void action.run(async () => setLogo((await del<{ logo: LogoUrls }>(`/admin/branding/logo/${variant}`)).logo));

  const variants = [
    { key: 'light' as const, label: t('ui.settings.logo_light'), bg: p.surface, hint: undefined },
    { key: 'dark' as const, label: t('ui.settings.logo_dark'), bg: p.nav.bg, hint: t('ui.settings.logo_dark_hint') },
  ];
  return (
    <Card title={sectionTitle(t('ui.settings.logo'))} style={{ marginBottom: 16 }}>
      <ErrorBanner error={action.error} />
      {saved && <Alert type="success" showIcon title={t('ui.common.saved')} style={{ marginBottom: 12 }} />}
      <Form layout="vertical" onFinish={saveName} style={{ maxWidth: 480 }}>
        <Field label={t('ui.settings.brand_name')} extra={t('ui.settings.brand_name_hint')} required>
          <Input required maxLength={40} value={draft ?? name} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <Button htmlType="submit" type="primary" loading={action.busy && active === 'name'} disabled={action.busy}>
          {t('ui.common.save')}
        </Button>
      </Form>
      <p className="small muted" style={{ marginTop: 16 }}>{t('ui.settings.logo_hint')}</p>
      <Row gutter={[16, 16]}>
        {variants.map((v) => (
          <Col key={v.key} xs={24} md={12}>
            <section aria-label={v.label}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{v.label}</h3>
              {/* preview on the background the logo will sit on */}
              <div className="logo-preview" style={{ background: v.bg, borderColor: p.hairline }}>
                {logo[v.key] ? (
                  <img className="brand-logo" src={logo[v.key]!} alt={v.label} />
                ) : (
                  <span className="small" style={{ color: v.key === 'dark' ? p.nav.muted : p.ink3 }}>{t('ui.settings.logo_none')}</span>
                )}
              </div>
              {v.hint && <p className="small muted">{v.hint}</p>}
              <Flex gap={8} style={{ marginTop: 8 }}>
                <Upload
                  accept="image/png"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    upload(v.key, file);
                    return false; // we send it ourselves as JSON
                  }}
                >
                  <Button loading={action.busy && active === v.key} disabled={action.busy}>
                    {t('ui.settings.logo_upload')}
                  </Button>
                </Upload>
                {logo[v.key] && (
                  <Button disabled={action.busy} onClick={() => remove(v.key)}>
                    {t('ui.common.remove')}
                  </Button>
                )}
              </Flex>
            </section>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

/** Mail settings (DECISIONS D13). Secrets are write-only: blank fields keep the saved value. */
