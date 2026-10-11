import { EmptyState, PageHeader } from '../../ui/index.ts';
import { Link, paths } from '../router.tsx';
import { useDocumentTitle } from '../hooks.ts';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <>
      <PageHeader title="Page not found" />
      <div className="n-card">
        <EmptyState title="There’s nothing at this address" action={<Link href={paths.overview()} className="n-btn n-btn--primary n-btn--md">Go to Overview</Link>}>
          The link may be out of date, or the item was removed.
        </EmptyState>
      </div>
    </>
  );
}
