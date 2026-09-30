/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY } from './buttonStyles';
import { ConfirmContext, useConfirm } from './confirmContext';
import type { ConfirmFn, ConfirmOptions } from './confirmContext';
import { Dialog, DialogFooter } from './Dialog';

export { useConfirm };
export type { ConfirmFn, ConfirmOptions };

interface PendingConfirm {
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Hosts a single confirm dialog for the whole app and exposes `confirm()` via
 * `useConfirm()`. Concurrent calls are queued and shown one after another.
 */
export function ConfirmProvider({ children }: { children?: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const queueRef = useRef<PendingConfirm[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const nextId = useRef(0);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++;
        setQueue((q) => [...q, { id, options, resolve }]);
      }),
    [],
  );

  // Mirror the queue so unmount can settle anything still waiting.
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(
    () => () => {
      for (const pending of queueRef.current) pending.resolve(false);
    },
    [],
  );

  const current = queue[0] ?? null;

  const settle = useCallback(
    (value: boolean) => {
      if (!current) return;
      current.resolve(value);
      setQueue((q) => q.filter((item) => item !== current));
    },
    [current],
  );

  const tone = current?.options.tone ?? 'default';
  const isDanger = tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        key={current?.id ?? 'idle'}
        open={current !== null}
        onClose={() => settle(false)}
        title={current?.options.title ?? 'Confirm'}
        description={current?.options.message}
        size="sm"
        role="alertdialog"
        layer="confirm"
        showCloseButton={false}
        initialFocusRef={isDanger ? cancelRef : confirmRef}
      >
        <DialogFooter bordered={false} className="pt-1">
          <button type="button" ref={cancelRef} className={BTN_SECONDARY} onClick={() => settle(false)}>
            {current?.options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={isDanger ? BTN_DANGER : BTN_PRIMARY}
            onClick={() => settle(true)}
          >
            {current?.options.confirmLabel ?? 'Confirm'}
          </button>
        </DialogFooter>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
