import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import axios from "axios";
import App from "./App";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({ data: { seenIndexes: [], calculatedValues: {} } })
    ),
    post: vi.fn(() =>
      Promise.resolve({
        data: { seenIndexes: [7], calculatedValues: { 7: 21 } },
      })
    ),
  },
}));

test("renders Fibonacci Calculator heading, form, and updates from POST response", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: /fibonacci calculator/i })
  ).toBeInTheDocument();
  const input = screen.getByLabelText(/enter your index/i);
  const button = screen.getByRole("button", { name: /calculate/i });
  expect(input).toBeInTheDocument();
  expect(button).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledWith("/api/values");

  await user.type(input, "7");
  await user.click(button);

  expect(axios.post).toHaveBeenCalledWith("/api/values", { index: "7" });
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("fib(7)")).toBeInTheDocument();
  expect(screen.getByText("21")).toBeInTheDocument();
});
