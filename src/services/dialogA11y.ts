/**
 * Keyboard and focus behaviour for every [role="dialog"] in the app, in one place:
 * - when a dialog opens, focus moves to it, and comes back to where it was when it closes
 * - Tab and Shift+Tab stay inside the top dialog (the page behind can't be reached)
 * - Escape presses the dialog's close button ([data-dialog-close], or a button labelled close)
 * Started once from main.tsx; returns a stop function.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CLOSE_LABEL = /жабу|закрыть|close|болдырмау|отмена|артқа|назад/i;

function topDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return all.length ? all[all.length - 1] : null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function startDialogA11y(): () => void {
  if (typeof document === 'undefined') return () => {};
  const returnFocus = new Map<HTMLElement, Element | null>();

  const onKeyDown = (e: KeyboardEvent) => {
    const dialog = topDialog();
    if (!dialog) return;
    if (e.key === 'Escape') {
      const close =
        dialog.querySelector<HTMLElement>('[data-dialog-close]') ||
        Array.from(dialog.querySelectorAll<HTMLElement>('button[aria-label]')).find((b) => CLOSE_LABEL.test(b.getAttribute('aria-label') || ''));
      if (close) {
        e.preventDefault();
        close.click();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const observer = new MutationObserver(() => {
    const open = new Set(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')));
    // Newly opened: remember the focused element, then move focus into the dialog
    open.forEach((dialog) => {
      if (returnFocus.has(dialog)) return;
      returnFocus.set(dialog, document.activeElement);
      if (!dialog.contains(document.activeElement)) {
        // The dialog itself takes focus (no input gets it, so no keyboard pops up on phones);
        // the next Tab goes to its first control
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        dialog.focus({ preventScroll: true });
      }
    });
    // Closed: give focus back
    returnFocus.forEach((previous, dialog) => {
      if (open.has(dialog)) return;
      returnFocus.delete(dialog);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true });
    });
  });

  document.addEventListener('keydown', onKeyDown);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    observer.disconnect();
  };
}
