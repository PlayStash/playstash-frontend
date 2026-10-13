// @vitest-environment jsdom
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GameWebsites } from "./GameWebsites";
afterEach(cleanup);
it("shows every safe website once and rejects executable URL schemes", () => {
  render(
    <GameWebsites
      urls={[
        "https://game.test",
        "https://wiki.test",
        "https://game.test",
        "javascript:alert(1)",
        "broken",
      ]}
    />,
  );
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://game.test",
    "https://wiki.test",
  ]);
  expect(
    links.every((link) => link.getAttribute("rel") === "noopener noreferrer"),
  ).toBe(true);
});
