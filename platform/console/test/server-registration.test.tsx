import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { ServerRegistrationForm } from "../src/components/ServerRegistrationForm.js";
import { useServerRegistration } from "../src/hooks/useServerRegistration.js";
import { RuntimeConfigContext } from "../src/contexts/RuntimeConfigContext.js";

describe("ServerRegistrationForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders form fields", () => {
    const onSubmit = vi.fn();
    render(<ServerRegistrationForm onSubmit={onSubmit} isLoading={false} />);
    expect(screen.getByLabelText(/server id/i)).toBeDefined();
    expect(screen.getByLabelText(/display name/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /register server/i })).toBeDefined();
  });

  it("validates server_id format", async () => {
    const onSubmit = vi.fn();
    render(<ServerRegistrationForm onSubmit={onSubmit} isLoading={false} />);
    const input = screen.getByLabelText(/server id/i);
    fireEvent.change(input, { target: { value: "invalid server!" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByText(/lowercase letters, numbers, hyphens/i)).toBeDefined();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with valid data", async () => {
    const onSubmit = vi.fn();
    render(<ServerRegistrationForm onSubmit={onSubmit} isLoading={false} />);
    fireEvent.change(screen.getByLabelText(/server id/i), {
      target: { value: "my-survival" },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "My Survival Server" },
    });
    fireEvent.click(screen.getByRole("button", { name: /register server/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        server_id: "my-survival",
        display_name: "My Survival Server",
      });
    });
  });
});

const createWrapper = () => {
  const queryClient = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => (
    <RuntimeConfigContext.Provider value={{ defaultRegistryUrl: "http://localhost:8787", registryLocked: false }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RuntimeConfigContext.Provider>
  );
};

describe("useServerRegistration", () => {
  it("returns register function and loading state", () => {
    const { result } = renderHook(() => useServerRegistration(), {
      wrapper: createWrapper(),
    });
    expect(typeof result.current.register).toBe("function");
    expect(result.current.isLoading).toBe(false);
  });
});
