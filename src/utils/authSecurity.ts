import type { PlaystashUser } from "@/api";

/** Never persist authentication material in the desktop offline-user cache. */
export function serializeCachedUser(user: PlaystashUser): string {
  return JSON.stringify(user, (key, value: unknown) =>
    /^(password|api_key|access_token|refresh_token|sessions)$/i.test(key)
      ? undefined
      : value,
  );
}

export function parseCachedUser(raw: string): PlaystashUser {
  const user = JSON.parse(raw) as PlaystashUser;
  if (
    !user ||
    !Number.isInteger(user.id) ||
    user.id < 1 ||
    typeof user.username !== "string"
  ) {
    throw new Error("Invalid cached user");
  }
  return JSON.parse(serializeCachedUser(user)) as PlaystashUser;
}

/** Bound bearer credentials to the selected backend, including its API path. */
export function authenticatedRequestUrl(input: string, server: string): string {
  const base = new URL(server);
  const request = new URL(input, `${base.href.replace(/\/+$/, "")}/`);
  const apiPath = `${base.pathname.replace(/\/+$/, "")}/api`;
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    request.username ||
    request.password ||
    request.origin !== base.origin ||
    !(
      request.pathname === apiPath || request.pathname.startsWith(`${apiPath}/`)
    )
  ) {
    throw new Error(
      "Authenticated requests must target the selected PlayStash API.",
    );
  }
  return request.href;
}

export function fetchAuthenticated(
  input: string,
  server: string,
  token: string | undefined,
  init?: RequestInit,
): Promise<Response> {
  const url = authenticatedRequestUrl(input, server);
  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "*/*");
  return fetch(url, { ...init, headers, redirect: "error" });
}
