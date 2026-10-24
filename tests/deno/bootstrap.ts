const port = Number(Deno.env.get("EDGE_PORT") ?? "0");
const name = Deno.env.get("EDGE_FUNCTION") ?? "";
const originalServe = Deno.serve.bind(Deno);

Object.defineProperty(Deno, "serve", {
  value: (
    handler: (req: Request) => Response | Promise<Response>,
    options: Record<string, unknown> = {},
  ) => originalServe({ ...options, port, hostname: "127.0.0.1" }, handler),
});

await import(
  new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url).href
);
