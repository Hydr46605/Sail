import * as Dialog from "@radix-ui/react-dialog";
import { type FormEvent, useState } from "react";
import { KeyRound, X } from "lucide-react";
import type { StoredConsoleAuth } from "../auth.js";

export function TokenImportDialog(props: { onImport: (auth: StoredConsoleAuth) => void }) {
  const [open, setOpen] = useState(false);
  const [sessionToken, setSessionToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const canSubmit = sessionToken.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    props.onImport({
      sessionToken: sessionToken.trim(),
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    });
    setOpen(false);
    setSessionToken("");
    setSessionId("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="primary-button">
          <KeyRound aria-hidden="true" size={18} />
          <span>Import session</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <Dialog.Title>Import Sail session</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="Close">
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Import a Sail session token for local console testing.
          </Dialog.Description>
          <form className="dialog-form" onSubmit={submit}>
            <label className="field-label">
              <span>Session token</span>
              <input
                autoFocus
                type="password"
                value={sessionToken}
                onChange={(event) => setSessionToken(event.target.value)}
              />
            </label>
            <label className="field-label">
              <span>Session ID</span>
              <input
                type="text"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="ghost-button">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="primary-button" disabled={!canSubmit}>
                <KeyRound aria-hidden="true" size={18} />
                <span>Connect</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
