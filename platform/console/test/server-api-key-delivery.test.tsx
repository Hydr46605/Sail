import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ServerApiKeyDeliveryModal } from "../src/components/ServerApiKeyDeliveryModal.js";

describe("ServerApiKeyDeliveryModal", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    serverId: "my-server",
    apiKey: "eyJhbGciOiJFUzI1NiJ9.test-key",
    claimCode: "a1b2c3d4e5f6g7h8",
  };

  it("renders three delivery method tabs", () => {
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    expect(screen.getByRole("tab", { name: /copy api key/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /claim code/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /direct setup/i })).toBeDefined();
  });

  it("copies API key to clipboard on copy button click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /copy to clipboard/i }));
    expect(writeText).toHaveBeenCalledWith(defaultProps.apiKey);
  });

  it("shows claim code in correct format", () => {
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /claim code/i }));
    expect(screen.getByText(defaultProps.claimCode)).toBeDefined();
    expect(screen.getByText(/\/sail code/)).toBeDefined();
  });

  it("shows direct setup command", () => {
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /direct setup/i }));
    expect(screen.getByText(/\/sail setup/)).toBeDefined();
    expect(
      screen.getByText((content) => content.includes(defaultProps.apiKey)),
    ).toBeDefined();
  });

  it("copies claim code command to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /claim code/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    expect(writeText).toHaveBeenCalledWith(`/sail code ${defaultProps.claimCode}`);
  });

  it("copies direct setup command to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ServerApiKeyDeliveryModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /direct setup/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    expect(writeText).toHaveBeenCalledWith(`/sail setup ${defaultProps.apiKey}`);
  });
});
