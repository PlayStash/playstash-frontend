/**
 * Additional request headers sent with every request to the PlayStash server
 * (WP6 contract, Step 0 stub). WP6 applies them inside `authFetch`, pushes
 * them to Rust with `set_additional_request_headers` and passes them to
 * socket.io. Stub: no extra headers.
 */
export function getAdditionalRequestHeaders(): Record<string, string> {
  return {};
}
