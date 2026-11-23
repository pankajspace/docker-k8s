import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import axios from "axios";
import App from "./App";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({ data: { seenIndexes: [], calculatedValues: {} } })
    ),
    post: vi.fn(() => Promise.resolve({ data: { working: true } })),
  },
}));

test("renders Fibonacci Calculator heading and form", async () => {
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: /fibonacci calculator/i })
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/enter your index/i)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /calculate/i })
  ).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledWith("/api/values");
});
