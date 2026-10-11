import { useEffect, useState, type FormEvent } from 'react';
import type { ConfigVersionDTO } from '../../../packages/contracts/src/admin-types.ts';
import type { EnvironmentName } from '../../../packages/contracts/src/sdk-types.ts';
import { api, errorMessage } from './api.ts';
import { Button, Dialog, ErrorState, Field, Select, Textarea, useToast } from '../ui/index.ts';

export function PublishDialog({
  open,
  onClose,
  applicationId,
  applicationName,
  defaultEnvironment = 'development',
  allowedEnvironments,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  applicationName: string;
  defaultEnvironment?: EnvironmentName;
  allowedEnvironments?: EnvironmentName[];
  onPublished?: (v: ConfigVersionDTO) => void;
}) {
  const toast = useToast();
  const [env, setEnv] = useState<EnvironmentName>(defaultEnvironment);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEnv(defaultEnvironment);
      setNotes('');
      setError(null);
    }
  }, [open, defaultEnvironment]);

  const envs: EnvironmentName[] = allowedEnvironments && allowedEnvironments.length ? allowedEnvironments : ['development', 'production'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = await api.publish(applicationId, { environment: env, notes: notes.trim() || undefined });
      toast.success(`Published v${v.version} to ${v.environment}`, `${v.summary.publishedWorkflows} published workflows, ${v.summary.blockedRegions} blocked regions.`);
      onPublished?.(v);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Publish configuration"
      description={`Snapshots ${applicationName}’s published workflows, mappings and privacy policy into a new version. The SDK picks it up on its next init.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="publish-config" loading={busy}>
            Publish to {env}
          </Button>
        </>
      }
    >
      <form id="publish-config" onSubmit={submit} className="form-stack" noValidate>
        {error ? <ErrorState title="Publish failed" message={error} /> : null}
        <Field label="Environment">
          {(ids) => (
            <Select {...ids} value={env} onChange={(e) => setEnv(e.target.value as EnvironmentName)} data-autofocus="">
              {envs.map((e) => (
                <option key={e} value={e}>
                  {e === 'development' ? 'Development' : 'Production'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {env === 'production' ? (
          <p className="publish-warn">Production users will see these changes on their next page load.</p>
        ) : null}
        <Field label="Release notes" optional hint="Shown in the version history.">
          {(ids) => <Textarea {...ids} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed and why" />}
        </Field>
      </form>
    </Dialog>
  );
}
