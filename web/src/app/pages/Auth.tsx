import { useState, type FormEvent } from 'react';
import { api, ApiRequestError, errorMessage } from '../api.ts';
import { Link, paths, useRouter } from '../router.tsx';
import { useSession } from '../session.tsx';
import { useDocumentTitle } from '../hooks.ts';
import { Button, Field, Input, Logo, Notice } from '../../ui/index.ts';

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  // Only allow same-origin app paths.
  if (next && next.startsWith('/app') && !next.startsWith('//')) return next;
  return paths.overview();
}

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="auth">
      <header className="auth__brand">
        <a href="/" aria-label="navoro home">
          <Logo size={28} />
        </a>
      </header>
      <main className="auth__main" id="main">
        <div className="auth__card">
          <h1 className="auth__title">{title}</h1>
          <p className="auth__subtitle">{subtitle}</p>
          {children}
        </div>
        <p className="auth__footer">{footer}</p>
      </main>
      <footer className="auth__legal">
        <span>Less searching. More doing.</span>
      </footer>
    </div>
  );
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { setMe } = useSession();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const me = await api.login({ email: email.trim(), password });
      setMe(me);
      navigate(safeNext(), { replace: true });
    } catch (err) {
      setFormError(
        err instanceof ApiRequestError && (err.status === 401 || err.status === 400)
          ? err.message || 'That email and password don’t match.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back. Pick up where your team left off."
      footer={
        <>
          New to Navoro? <Link href={paths.signup()}>Create a workspace</Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={submit} noValidate>
        {formError ? (
          <Notice tone="danger" title="Couldn’t sign you in">
            {formError}
          </Notice>
        ) : null}
        <Field label="Email" error={errors.email}>
          {(ids) => <Input {...ids} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" error={errors.password}>
          {(ids) => <Input {...ids} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>
      <div className="auth__hint">
        <span className="auth__hint-dot" aria-hidden="true" />
        <p>
          Demo workspace: <code>demo@navoro.dev</code> / <code>navoro-demo-2026</code>
        </p>
      </div>
    </AuthFrame>
  );
}

export function SignupPage() {
  useDocumentTitle('Create workspace');
  const { setMe } = useSession();
  const { navigate } = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 10) next.password = 'Use at least 10 characters.';
    if (!form.organizationName.trim()) next.organizationName = 'Enter your organization’s name.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const me = await api.signup({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        organizationName: form.organizationName.trim(),
      });
      setMe(me);
      navigate(paths.overview(), { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Create your workspace"
      subtitle="Set up Navoro for your team. You’ll register your first application next."
      footer={
        <>
          Already have an account? <Link href={paths.login()}>Sign in</Link>
        </>
      }
    >
      <form className="auth__form" onSubmit={submit} noValidate>
        {formError ? (
          <Notice tone="danger" title="Couldn’t create your workspace">
            {formError}
          </Notice>
        ) : null}
        <Field label="Your name" error={errors.name}>
          {(ids) => <Input {...ids} autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Work email" error={errors.email}>
          {(ids) => <Input {...ids} type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" hint={errors.password ? undefined : 'At least 10 characters.'} error={errors.password}>
          {(ids) => <Input {...ids} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <Field label="Organization name" error={errors.organizationName}>
          {(ids) => <Input {...ids} autoComplete="organization" value={form.organizationName} onChange={set('organizationName')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Create workspace
        </Button>
      </form>
    </AuthFrame>
  );
}
