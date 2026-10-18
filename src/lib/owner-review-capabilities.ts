/** Public release capabilities, not identity or authorization.
 * Both stay UNSET until the corresponding installation/host/protocol review is
 * explicitly approved. Public project configuration alone cannot enable either.
 * A first owner sign-in may be a separately authorized preservation canary;
 * this marker never means end-to-end success or owner access.
 */
export const reviewedCallbackProtocol: "reviewed-pkce-code-flow-v2" | undefined = "reviewed-pkce-code-flow-v2";
export const reviewedOwnerApiPolicy: "app-session-jwt-age300-v1" | undefined = undefined;
