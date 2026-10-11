import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button.tsx';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Traps Tab focus inside `ref`, closes on Escape, and restores focus on unmount. */
function useModalBehavior(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusFirst = () => {
      if (!node) return;
      const target =
        initialFocus?.current ??
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        node.querySelector<HTMLElement>(FOCUSABLE) ??
        node;
      target.focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (event: KeyboardEvent) => {
      if (!node) return;
      if (event.key === 'Escape') {
        // Only the top-most modal handles Escape.
        const layers = document.querySelectorAll('[data-n-modal]');
        if (layers[layers.length - 1] !== node) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const layers = document.querySelectorAll('[data-n-modal]');
      if (layers[layers.length - 1] !== node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, ref, initialFocus]);
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  initialFocus?: RefObject<HTMLElement | null>;
  /** Prevent closing via backdrop click (e.g. during submission). */
  dismissible?: boolean;
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocus, dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalBehavior(ref, open, () => dismissible && onClose(), initialFocus);
  if (!open) return null;
  return createPortal(
    <div className="n-overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div
        ref={ref}
        className={`n-dialog n-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-n-modal=""
      >
        <header className="n-dialog__header">
          <div>
            <h2 className="n-dialog__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="n-dialog__desc" id={descId}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose} disabled={!dismissible} size="sm">
            <CloseIcon />
          </IconButton>
        </header>
        <div className="n-dialog__body">{children}</div>
        {footer ? <footer className="n-dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

/** Right-hand side sheet; modal, same focus behavior as Dialog. */
export function Sheet({ open, onClose, title, description, children, footer }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useModalBehavior(ref, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="n-overlay n-overlay--sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="n-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-n-modal=""
      >
        <header className="n-sheet__header">
          <div>
            <h2 className="n-dialog__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="n-dialog__desc" id={descId}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" onClick={onClose} size="sm">
            <CloseIcon />
          </IconButton>
        </header>
        <div className="n-sheet__body">{children}</div>
        {footer ? <footer className="n-sheet__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger, busy }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      initialFocus={cancelRef}
      dismissible={!busy}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="n-prose-sm">{body}</div>
    </Dialog>
  );
}
