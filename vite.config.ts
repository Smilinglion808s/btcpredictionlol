// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Cloudflare made `nodejs_compat` the default on 2026-08-04 and now REJECTS
 * workers that still declare it, which made every published request fail with
 * a 502 ("The compatibility flag nodejs_compat became the default ... so does
 * not need to be specified anymore").
 *
 * Nitro's cloudflare preset unconditionally pushes `nodejs_compat` into the
 * emitted `dist/server/wrangler.json` whenever node compat is enabled, and it
 * offers no option to suppress that. We keep node compat on (we need Nitro's
 * unenv polyfills at bundle time) and simply strip the now-invalid flag from
 * the generated deploy config after the build writes it.
 */
function stripDefaultNodejsCompatFlag(): Plugin {
  return {
    name: "lovable:strip-default-nodejs-compat-flag",
    apply: "build",
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        const file = resolve(process.cwd(), "dist/server/wrangler.json");
        // Nitro writes this in its own closeBundle hook; wait briefly for it.
        for (let i = 0; i < 60 && !existsSync(file); i += 1) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!existsSync(file)) return;
        try {
          const cfg = JSON.parse(await readFile(file, "utf8")) as {
            compatibility_flags?: string[];
          };
          if (!Array.isArray(cfg.compatibility_flags)) return;
          const next = cfg.compatibility_flags.filter((f) => f !== "nodejs_compat");
          if (next.length === cfg.compatibility_flags.length) return;
          cfg.compatibility_flags = next;
          await writeFile(file, JSON.stringify(cfg, null, 2), "utf8");
          this.info?.("[cloudflare] removed default-on `nodejs_compat` flag from wrangler.json");
        } catch {
          // Never fail the build over this cleanup step.
        }
      },
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [stripDefaultNodejsCompatFlag()],
});
