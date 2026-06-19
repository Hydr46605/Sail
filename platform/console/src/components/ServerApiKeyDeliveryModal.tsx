import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Copy, Check, Key, Hash, Terminal } from "lucide-react";

interface ServerApiKeyDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  apiKey: string;
  claimCode: string;
}

type DeliveryTab = "copy" | "claim" | "direct";

export function ServerApiKeyDeliveryModal({
  isOpen,
  onClose,
  serverId,
  apiKey,
  claimCode,
}: ServerApiKeyDeliveryModalProps) {
  const [activeTab, setActiveTab] = useState<DeliveryTab>("copy");
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content delivery-modal">
          <Dialog.Title className="dialog-title">
            API Key Delivery — {serverId}
          </Dialog.Title>

          <div className="delivery-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "copy"}
              className={`delivery-tab ${activeTab === "copy" ? "active" : ""}`}
              onClick={() => setActiveTab("copy")}
            >
              <Key size={16} /> Copy API Key
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "claim"}
              className={`delivery-tab ${activeTab === "claim" ? "active" : ""}`}
              onClick={() => setActiveTab("claim")}
            >
              <Hash size={16} /> Claim Code
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "direct"}
              className={`delivery-tab ${activeTab === "direct" ? "active" : ""}`}
              onClick={() => setActiveTab("direct")}
            >
              <Terminal size={16} /> Direct Setup
            </button>
          </div>

          <div className="delivery-content">
            {activeTab === "copy" && (
              <div className="delivery-method">
                <p>Copy your API key and paste it into your gateway's <code>config.yml</code>:</p>
                <div className="code-block">
                  <code>sail.registry.api-key: "{apiKey}"</code>
                </div>
                <button
                  className="primary-button"
                  onClick={() => copyToClipboard(apiKey)}
                >
                  {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy to Clipboard</>}
                </button>
              </div>
            )}

            {activeTab === "claim" && (
              <div className="delivery-method">
                <p>Use this claim code on the server to retrieve the API key:</p>
                <div className="code-block claim-code">
                  <code>{claimCode}</code>
                </div>
                <p className="field-hint">
                  Run <code>/sail code {claimCode}</code> in-game or paste the code when prompted.
                </p>
                <button
                  className="primary-button"
                  onClick={() => copyToClipboard(`/sail code ${claimCode}`)}
                >
                  {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy Command</>}
                </button>
              </div>
            )}

            {activeTab === "direct" && (
              <div className="delivery-method">
                <p>Run this command directly on the server (requires operator permission):</p>
                <div className="code-block">
                  <code>/sail setup {apiKey}</code>
                </div>
                <button
                  className="primary-button"
                  onClick={() => copyToClipboard(`/sail setup ${apiKey}`)}
                >
                  {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy Command</>}
                </button>
              </div>
            )}
          </div>

          <Dialog.Close asChild>
            <button className="icon-button dialog-close" aria-label="Close">
              <X size={16} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
