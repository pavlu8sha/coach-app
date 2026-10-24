export const TOKEN = "123456:TEST_TOKEN_NOT_REAL";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const NOTIFY_SECRET = "test-notify-secret";
export const APP_URL = "https://mini.test/";
export const AUTH_ID = "00000000-0000-0000-0000-000000000001";
export const OTHER_AUTH_ID = "00000000-0000-0000-0000-000000000002";

type Json = Record<string, unknown>;

export interface SupabaseState {
  rates: Record<string, boolean | boolean[]>;
  rateError: string | null;
  users: Array<
    { id: string; telegram_id: number; display_name?: string | null }
  >;
  authId: string;
  authCreateError: string | null;
  linkError: string | null;
  usersSelectError: string | null;
  usersInsertError: string | null;
  claimError: string | null;
  notifications: Array<{ id: string; telegram_id: number; text: string }>;
  finish: Array<
    { id: string; ok: boolean; err: string | null; give_up: boolean }
  >;
  requests: Array<
    { method: string; path: string; query: string; body: Json | null }
  >;
}

function freshState(): SupabaseState {
  return {
    rates: {},
    rateError: null,
    users: [],
    authId: AUTH_ID,
    authCreateError: null,
    linkError: null,
    usersSelectError: null,
    usersInsertError: null,
    claimError: null,
    notifications: [],
    finish: [],
    requests: [],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function postgrestError(message: string): Response {
  return json({ code: "XX000", message, details: null, hint: null }, 400);
}

function takeRate(state: SupabaseState, key: string): boolean {
  const value = state.rates[key];
  if (Array.isArray(value)) return value.length === 0 ? true : value.shift()!;
  return value ?? true;
}

async function bodyOf(req: Request): Promise<Json | null> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
}

export function createSupabaseFake() {
  const state = freshState();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    const body = await bodyOf(req);
    state.requests.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      body,
    });

    if (url.pathname === "/rest/v1/rpc/rate_limit_hit") {
      if (state.rateError) return postgrestError(state.rateError);
      return json(takeRate(state, String(body?.k ?? "")));
    }

    if (url.pathname === "/rest/v1/rpc/claim_notifications") {
      if (state.claimError) return postgrestError(state.claimError);
      return json(state.notifications);
    }

    if (url.pathname === "/rest/v1/rpc/finish_notification") {
      state.finish.push({
        id: String(body?.i ?? ""),
        ok: Boolean(body?.ok),
        err: (body?.err as string | null) ?? null,
        give_up: Boolean(body?.give_up),
      });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/rest/v1/users" && req.method === "GET") {
      if (state.usersSelectError) return postgrestError(state.usersSelectError);
      const telegramId = Number(
        String(url.searchParams.get("telegram_id") ?? "").replace(/^eq\./, ""),
      );
      return json(state.users.filter((u) => u.telegram_id === telegramId));
    }

    if (url.pathname === "/rest/v1/users" && req.method === "POST") {
      if (state.usersInsertError) return postgrestError(state.usersInsertError);
      const rows = Array.isArray(body) ? body : [body];
      for (const row of rows) {
        if (row && typeof row === "object") {
          state.users.push(row as SupabaseState["users"][number]);
        }
      }
      return new Response(null, { status: 201 });
    }

    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      if (state.authCreateError) {
        return json({ message: state.authCreateError }, 422);
      }
      return json({ user: { id: state.authId, email: body?.email } });
    }

    if (
      url.pathname === "/auth/v1/admin/generate_link" && req.method === "POST"
    ) {
      if (state.linkError) return json({ message: state.linkError }, 422);
      return json({
        hashed_token: `token-${state.authId.slice(-1)}`,
        id: state.authId,
        email: body?.email,
      });
    }

    return json({ message: `unexpected ${req.method} ${url.pathname}` }, 404);
  });
  const port = (server.addr as Deno.NetAddr).port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    reset() {
      Object.assign(state, freshState());
    },
    close() {
      return server.shutdown();
    },
  };
}

export interface TelegramState {
  status: number;
  text: string;
  calls: Array<{ method: string; body: Json | null }>;
}

export function createTelegramFake() {
  const state: TelegramState = { status: 200, text: "{}", calls: [] };
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    const method = url.pathname.split("/").pop() ?? "";
    state.calls.push({ method, body: await bodyOf(req) });
    return new Response(state.text, {
      status: state.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  const port = (server.addr as Deno.NetAddr).port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    reset() {
      state.status = 200;
      state.text = "{}";
      state.calls = [];
    },
    close() {
      return server.shutdown();
    },
  };
}

const ROOT = new URL("../../", import.meta.url);

function bootstrapPath(): string {
  return Deno.realPathSync(new URL("./bootstrap.ts", import.meta.url));
}

async function freePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

export async function startFunction(name: string, env: Record<string, string>) {
  const port = await freePort();
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      bootstrapPath(),
    ],
    cwd: Deno.realPathSync(ROOT),
    env: {
      ...Deno.env.toObject(),
      ...env,
      EDGE_PORT: String(port),
      EDGE_FUNCTION: name,
    },
    stdout: "null",
    stderr: "piped",
  }).spawn();

  let stderr = "";
  const pump = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) stderr += decoder.decode(chunk);
  })();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return {
        url: `http://127.0.0.1:${port}`,
        async close() {
          try {
            child.kill("SIGTERM");
          } catch {
            // already stopped
          }
          await child.status;
          await pump;
        },
        stderr() {
          return stderr;
        },
      };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // already stopped
  }
  await child.status;
  await pump;
  throw new Error(`function ${name} did not start: ${stderr}`);
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, text, data };
}

export function envFor(
  supaUrl: string,
  telegramUrl: string,
): Record<string, string> {
  return {
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NOTIFY_SECRET,
    SUPABASE_URL: supaUrl,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    ALLOWED_ORIGIN: "https://app.test",
    MINI_APP_URL: APP_URL,
    TELEGRAM_API_BASE: telegramUrl,
  };
}
