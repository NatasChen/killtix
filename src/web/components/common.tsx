import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { useI18n } from '../i18n';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`badge ${status}`}>{t(`ticket.status.${status}`)}</span>;
}

export function PriorityBadge({ priority }: { priority: number }) {
  const { t } = useI18n();
  return <span className={`badge p${priority}`}>{t(`ticket.priority.${priority}`)}</span>;
}

export function SlaBadge({ status, paused }: { status: string; paused?: boolean }) {
  const { t } = useI18n();
  if (paused) return <span className="badge pending_user">{t('ui.sla.paused')}</span>;
  return <span className={`badge ${status}`}>{t(`ticket.sla.${status}`)}</span>;
}

export function Tags({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
        </span>
      ))}
    </>
  );
}

export function DateTime({ value }: { value: string | null | undefined }) {
  const { locale } = useI18n();
  if (!value) return <span className="muted">—</span>;
  return <time dateTime={value}>{new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time>;
}

/** Shows an API error (localized title from the server, plus field details). */
export function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  if (error instanceof ApiError) {
    const rules = (error.body.rules as string[] | undefined) ?? [];
    const fields = (error.body.errors as { path: string; message: string }[] | undefined) ?? [];
    return (
      <div className="banner error" role="alert">
        {error.title}
        {rules.length > 0 && (
          <ul>
            {rules.map((r) => (
              <li key={r}>{t(`ui.password.rule.${r}`)}</li>
            ))}
          </ul>
        )}
        {fields.length > 0 && (
          <ul>
            {fields.map((f) => (
              <li key={f.path + f.message}>
                <code>{f.path}</code> {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="banner error" role="alert">
      {String((error as Error).message ?? error)}
    </div>
  );
}

/** Loads data with loading / error state and a reload function. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(undefined);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('ui.common.loading')}</p>;
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <p className="muted empty-state">{children ?? t('ui.common.empty')}</p>;
}

/** Runs an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
