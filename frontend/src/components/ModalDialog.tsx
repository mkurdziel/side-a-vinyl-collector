import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Toaster } from 'react-hot-toast';

interface ModalDialogProps {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export function ModalDialog({ labelledBy, onClose, children, returnFocusTo }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.showModal) return;

    const opener = returnFocusTo?.current ?? document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogRef}
      className="rh-dialog"
      aria-labelledby={labelledBy}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
      {typeof document !== 'undefined' && (
        <div className="rh-dialog-toaster">
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--rh-surface-2)',
                color: 'var(--rh-ink)',
                border: '1px solid var(--rh-edge)',
              },
            }}
          />
        </div>
      )}
    </dialog>
  );
}
