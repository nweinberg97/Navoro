import type { ReactNode } from 'react';
import type { ApplicationSummary } from '../../../../packages/contracts/src/admin-types.ts';
import { EmptyState, ErrorState, LinkButton, PageHeader, PageSkeleton } from '../../ui/index.ts';
import { useWorkspace } from '../session.tsx';
import { paths, useRouter } from '../router.tsx';
import { IconApplications, IconPlus } from '../icons.tsx';

/**
 * Renders children only when an application is selected; otherwise a
 * loading / error / "register an application" state under the given title.
 */
export function RequireApp({ title, description, children }: { title: string; description?: ReactNode; children: (app: ApplicationSummary) => ReactNode }) {
  const { selected, loading, error, reload } = useWorkspace();
  const { navigate } = useRouter();
  if (loading) return <PageSkeleton />;
  if (error)
    return (
      <>
        <PageHeader title={title} />
        <ErrorState message={error} onRetry={() => void reload()} />
      </>
    );
  if (!selected)
    return (
      <>
        <PageHeader title={title} description={description} />
        <div className="n-card">
          <EmptyState
            icon={<IconApplications />}
            title="Register an application first"
            action={
              <LinkButton
                variant="primary"
                href={`${paths.applications()}?register=1`}
                icon={<IconPlus size={16} />}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`${paths.applications()}?register=1`);
                }}
              >
                Register application
              </LinkButton>
            }
          >
            Navoro works per application. Register the web app you want to guide users through, then come back here.
          </EmptyState>
        </div>
      </>
    );
  return <>{children(selected)}</>;
}

export function ReadOnlyBanner() {
  return (
    <p className="readonly-banner" role="note">
      You have read-only access. Ask an owner or admin to make changes.
    </p>
  );
}

/** Wraps a section heading row inside a page body. */
export function SectionTitle({ children, actions, id }: { children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="section-title">
      <h2 id={id}>{children}</h2>
      {actions ? <div className="section-title__actions">{actions}</div> : null}
    </div>
  );
}
