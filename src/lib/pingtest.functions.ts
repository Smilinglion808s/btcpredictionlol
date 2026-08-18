import { createServerFn } from "@tanstack/react-start";

export const pingTest = createServerFn({ method: "GET" }).handler(async () => ({ ok: true }));
