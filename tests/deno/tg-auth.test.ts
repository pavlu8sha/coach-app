import assert from "node:assert/strict";
import { signInitData } from "../../supabase/functions/tg-auth/init-data.js";
import {
  AUTH_ID,
  createSupabaseFake,
  createTelegramFake,
  envFor,
  OTHER_AUTH_ID,
  postJson,
  startFunction,
  TOKEN,
} from "./harness.ts";

const now = Math.floor(Date.now() / 1000);
const payload = async (
  overrides: Record<string, string> = {},
  token = TOKEN,
) => ({
  initData: await signInitData(
    {
      auth_date: String(now - 30),
      query_id: "AAH",
      user: JSON.stringify({ id: 42, first_name: "Ivan", last_name: "Petrov" }),
      ...overrides,
    },
    token,
  ),
});

Deno.test("tg-auth: HTTP → Supabase Auth/PostgREST", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-auth", envFor(supa.url, telegram.url));
  const send = (body: unknown) => postJson(fn.url, body);

  try {
    await t.step("OPTIONS, wrong method and malformed body", async () => {
      const options = await fetch(fn.url, { method: "OPTIONS" });
      assert.equal(options.status, 204);
      assert.equal(
        options.headers.get("access-control-allow-origin"),
        "https://app.test",
      );

      const get = await fetch(fn.url, { method: "GET" });
      assert.equal(get.status, 405);

      const malformed = await fetch(fn.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(malformed.status, 400);

      const empty = await send({});
      assert.equal(empty.res.status, 401);
      assert.deepEqual(empty.data, { error: "unauthorized", reason: "empty" });
    });

    await t.step(
      "bad and expired signatures are rejected before Supabase",
      async () => {
        supa.reset();
        const bad = await send(await payload({}, "other:token"));
        assert.equal(bad.res.status, 401);
        assert.deepEqual(bad.data, {
          error: "unauthorized",
          reason: "bad_hash",
        });
        assert.equal(supa.state.requests.length, 0);

        const expired = await send(
          await payload({ auth_date: String(now - 7200) }),
        );
        assert.equal(expired.res.status, 401);
        assert.deepEqual(expired.data, {
          error: "unauthorized",
          reason: "expired",
        });
        assert.equal(supa.state.requests.length, 0);
      },
    );

    await t.step(
      "new user is created in Auth and linked in users",
      async () => {
        supa.reset();
        const r = await send(await payload());
        assert.equal(r.res.status, 200);
        assert.deepEqual(r.data, {
          token_hash: "token-1",
          email: "tg42@telegram.invalid",
        });
        assert.deepEqual(supa.state.users, [{
          id: AUTH_ID,
          telegram_id: 42,
          display_name: "Ivan Petrov",
        }]);
        const paths = supa.state.requests.map((x) => `${x.method} ${x.path}`);
        assert.ok(paths.includes("POST /auth/v1/admin/users"));
        assert.ok(paths.includes("POST /auth/v1/admin/generate_link"));
        assert.ok(paths.includes("POST /rest/v1/users"));
      },
    );

    await t.step("known user is not inserted again", async () => {
      supa.reset();
      supa.state.users = [{
        id: AUTH_ID,
        telegram_id: 42,
        display_name: "Ivan Petrov",
      }];
      const r = await send(await payload());
      assert.equal(r.res.status, 200);
      assert.equal(supa.state.users.length, 1);
      assert.equal(
        supa.state.requests.filter((x) =>
          x.method === "POST" && x.path === "/rest/v1/users"
        ).length,
        0,
      );
    });

    await t.step("already-registered Auth error is tolerated", async () => {
      supa.reset();
      supa.state.authCreateError = "User already registered";
      supa.state.users = [{ id: AUTH_ID, telegram_id: 42 }];
      const r = await send(await payload());
      assert.equal(r.res.status, 200);
    });

    await t.step("per-user rate limit returns 429", async () => {
      supa.reset();
      supa.state.rates["tg:42"] = false;
      const r = await send(await payload());
      assert.equal(r.res.status, 429);
      assert.deepEqual(r.data, { error: "rate_limited" });
      assert.equal(r.res.headers.get("retry-after"), "600");
      assert.equal(
        supa.state.requests.filter((x) => x.path === "/auth/v1/admin/users")
          .length,
        0,
      );
    });

    await t.step("new-users rate limit returns 429", async () => {
      supa.reset();
      supa.state.rates["tg:42"] = true;
      supa.state.rates.new_users = false;
      const r = await send(await payload());
      assert.equal(r.res.status, 429);
      assert.equal(r.res.headers.get("retry-after"), "3600");
    });

    await t.step("identity mismatch returns 409", async () => {
      supa.reset();
      supa.state.users = [{ id: OTHER_AUTH_ID, telegram_id: 42 }];
      const r = await send(await payload());
      assert.equal(r.res.status, 409);
      assert.deepEqual(r.data, { error: "identity_mismatch" });
      assert.equal(supa.state.users[0].id, OTHER_AUTH_ID);
    });

    await t.step("Supabase failures are reported with their code", async () => {
      supa.reset();
      supa.state.rateError = "limiter down";
      let r = await send(await payload());
      assert.equal(r.res.status, 500);
      assert.match(
        String((r.data as { detail?: string }).detail),
        /rate_limit: limiter down/,
      );

      supa.reset();
      supa.state.usersSelectError = "users down";
      r = await send(await payload());
      assert.equal(r.res.status, 500);
      assert.deepEqual(r.data, { error: "users_select", detail: "users down" });

      supa.reset();
      supa.state.authCreateError = "create failed";
      r = await send(await payload());
      assert.equal(r.res.status, 500);
      assert.deepEqual(r.data, {
        error: "auth_create",
        detail: "create failed",
      });

      supa.reset();
      supa.state.linkError = "link failed";
      r = await send(await payload());
      assert.equal(r.res.status, 500);
      assert.deepEqual(r.data, { error: "auth_link", detail: "link failed" });

      supa.reset();
      supa.state.usersInsertError = "insert failed";
      r = await send(await payload());
      assert.equal(r.res.status, 500);
      assert.deepEqual(r.data, {
        error: "users_insert",
        detail: "insert failed",
      });
    });
  } finally {
    await fn.close();
    await telegram.close();
    await supa.close();
  }
});
