import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "@/App";

describe("App routes", () => {
  it("renders Luas landing page on root route", async () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(screen.getByText("Cabra Luas Tracker")).toBeInTheDocument();
    expect(screen.getByText("Live Arrivals")).toBeInTheDocument();
  });

  it("renders DART page on /dart route", async () => {
    window.history.pushState({}, "", "/dart");

    render(<App />);

    expect(screen.getByText(/Live data from the/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blackrock" })).toBeInTheDocument();
  });

  it("renders 404 page for unknown route", async () => {
    window.history.pushState({}, "", "/not-a-real-route");

    render(<App />);

    expect(screen.getByText("404")).toBeInTheDocument();
  });
});
