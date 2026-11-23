import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import App from "./App";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockImplementation((url, options) => {
    if (options?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ seenIndexes: [7], calculatedValues: { 7: 21 } }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ seenIndexes: [], calculatedValues: {} }),
    });
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

test("renders Fibonacci Calculator heading, form, and updates from POST response", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: /fibonacci calculator/i })
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^calculator$/i })).toHaveClass(
    "nav-link",
    "active"
  );
  const input = screen.getByLabelText(/enter your index/i);
  const button = screen.getByRole("button", { name: /calculate/i });
  expect(input).toBeInTheDocument();
  expect(button).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith("/api/values");

  await user.type(input, "7");
  await user.click(button);

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/values", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index: "7" }),
  });
  expect(await screen.findByText("fib(7)")).toBeInTheDocument();
  expect(screen.getByText("21")).toBeInTheDocument();
});
