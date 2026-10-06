import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_STORAGE_KEY, useSidebarPreference } from "./use-sidebar-preference";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useSidebarPreference", () => {
  it("starts expanded when nothing is stored", () => {
    const { result } = renderHook(() => useSidebarPreference());
    expect(result.current[0]).toBe(true);
  });

  it("restores a collapsed sidebar", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "false");
    const { result } = renderHook(() => useSidebarPreference());
    expect(result.current[0]).toBe(false);
  });

  it("remembers the new state", () => {
    const { result } = renderHook(() => useSidebarPreference());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("false");
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const { result } = renderHook(() => useSidebarPreference());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
  });
});
