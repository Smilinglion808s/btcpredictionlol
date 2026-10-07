import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Public observation of one synthetic paper account only. There are no write server functions.
export const getDotPaperSnapshot = createServerFn({ method: "GET" }).handler(
  async () => {
    const { readPaperSnapshot } = await import("./dot-paper.server");
    return readPaperSnapshot();
  },
);
export const getDotPaperPage = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      kind: z.enum(["trades", "calls"]),
      before: z.number().int().nonnegative().safe(),
    }),
  )
  .handler(async ({ data }) => {
    const { readPaperPage } = await import("./dot-paper.server");
    return readPaperPage(data.kind, data.before);
  });
