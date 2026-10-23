import assert from "node:assert/strict";
import { signLoginWidget } from "../../supabase/functions/tg-login/login-widget.js";
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
  overrides: Record<string, string | number> = {},
  token = TOKEN,
) => ({
  auth: await signLoginWidget(
    {
      id: 777,
      first_name: "Anna",
      last_name: "Ivanova",
      username: "anna_p",
      auth_date: now - 30,
      ...overrides,
    },
    token,
  ),
});

Deno.test("tg-login: HTTP → Supabase Auth/PostgREST", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-login", envFor(supa.url, telegram.url));
  const send = (body: unknown) => postJson(fn.url, body);

  try {
    await t.step("OPTIONS, wrong method and malformed body", async () => {
      const options = await fetch(fn.url, { method: "OPTIONS" });
      assert.equal(options.status, 204);
      const get = await fetch(fn.url, { method: "GET" });
      assert.equal(get.status, 405);

      const malformed = await fetch(fn.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(malformed.status, 400);

      const empty = await send({ auth: null });
      assert.equal(empty.res.status, 401);
      assert.deepEqual(empty.data, { error: "unauthorized", reason: "empty" });
    });

    await t.step("bad signature is rejected before Supabase", async () => {
      supa.reset();
      const r = await send(await payload({}, "other:token"));
      assert.equal(r.res.status, 401);
      assert.deepEqual(r.data, { error: "unauthorized", reason: "bad_hash" });
      assert.equal(supa.state.requests.length, 0);

      const tampered = { ...(await payload()).auth, id: 1 };
      const tamperedRes = await send({ auth: tampered });
      assert.equal(tamperedRes.res.status, 401);
      assert.deepEqual(tamperedRes.data, {
        error: "unauthorized",
        reason: "bad_hash",
      });
      assert.equal(supa.state.requests.length, 0);
    });

    await t.step("expired signature is rejected", async () => {
      supa.reset();
      const r = await send(await payload({ auth_date: now - 7200 }));
      assert.equal(r.res.status, 401);
      assert.deepEqual(r.data, { error: "unauthorized", reason: "expired" });
      assert.equal(supa.state.requests.length, 0);
    });

    await t.step(
      "new user is created in Auth and linked in users",
      async () => {
        supa.reset();
        const r = await send(await payload());
        assert.equal(r.res.status, 200);
        assert.deepEqual(r.data, {
          token_hash: "token-1",
          email: "tg777@telegram.invalid",
        });
        assert.deepEqual(supa.state.users, [{
          id: AUTH_ID,
          telegram_id: 777,
          display_name: "Anna Ivanova",
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
        telegram_id: 777,
        display_name: "Anna Ivanova",
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

    await t.step("per-user rate limit returns 429", async () => {
      supa.reset();
      supa.state.rates["tg:777"] = false;
      const r = await send(await payload());
      assert.equal(r.res.status, 429);
      assert.equal(r.res.headers.get("retry-after"), "600");
      assert.equal(
        supa.state.requests.filter((x) => x.path === "/auth/v1/admin/users")
          .length,
        0,
      );
    });

    await t.step("new-users rate limit returns 429", async () => {
      supa.reset();
      supa.state.rates["tg:777"] = true;
      supa.state.rates.new_users = false;
      const r = await send(await payload());
      assert.equal(r.res.status, 429);
      assert.equal(r.res.headers.get("retry-after"), "3600");
    });

    await t.step("identity mismatch returns 409", async () => {
      supa.reset();
      supa.state.users = [{ id: OTHER_AUTH_ID, telegram_id: 777 }];
      const r = await send(await payload());
      assert.equal(r.res.status, 409);
      assert.deepEqual(r.data, { error: "identity_mismatch" });
    });

    await t.step("Supabase failures are reported with their code", async () => {
      supa.reset();
      supa.state.usersSelectError = "users down";
      let r = await send(await payload());
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
