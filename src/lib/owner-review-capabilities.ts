/** Public release capabilities, not identity or authorization.
 * These pinned capabilities are staged for the separately approved installation.
 * Public project configuration alone cannot enable a different protocol or policy.
 * A first owner sign-in may be a separately authorized preservation canary;
 * this marker never means end-to-end success or owner access.
 */
export const reviewedCallbackProtocol: "reviewed-pkce-code-flow-v2" | undefined = "reviewed-pkce-code-flow-v2";
export const reviewedOwnerApiPolicy: "app-session-jwt-age300-v1" | undefined = "app-session-jwt-age300-v1";
