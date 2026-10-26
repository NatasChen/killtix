import { Button, Card, Col, Flex, Row, Upload } from 'antd';
import { useState } from 'react';
import { del, put } from '../../api';
import { useBranding, type LogoUrls } from '../../branding';
import { ErrorBanner, useAction, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';
import { sectionTitle } from './shared';

export function LogoSettings() {
  const { t } = useI18n();
  const p = usePalette();
  const { logo, setLogo } = useBranding();
  const action = useAction();
  const [active, setActive] = useState<keyof LogoUrls>(); // the variant being uploaded, for its button's spinner
  const upload = (variant: keyof LogoUrls, file: File) =>
    void action.run(async () => {
      setActive(variant);
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
      <p className="small muted" style={{ marginTop: 0 }}>{t('ui.settings.logo_hint')}</p>
      <ErrorBanner error={action.error} />
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
