import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("/dart/arrivals/")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        station_code: "BROCK",
        station_name: "Blackrock",
        last_updated: new Date().toISOString(),
        next_arrivals: [
          {
            train_code: "E123",
            origin: "Greystones",
            destination: "Malahide",
            direction: "Northbound",
            due_in_minutes: 4,
            minutes_late: 0,
            expected_arrival: "12:05",
            status: "En Route",
            last_location: "Booterstown",
          },
        ],
        total_dart_trains: 1,
        has_any_service: true,
      }),
    } as Response;
  }

  if (url.includes("/arrivals/")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stop_code: "cab",
        last_updated: new Date().toISOString(),
        next_arrivals: [
          {
            destination: "Broombridge",
            direction: "Inbound",
            due_minutes: 3,
            due_time: new Date().toISOString(),
          },
        ],
      }),
    } as Response;
  }

  return {
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response;
});

vi.stubGlobal("fetch", mockFetch);
