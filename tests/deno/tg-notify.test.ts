import assert from "node:assert/strict";
import {
  APP_URL,
  createSupabaseFake,
  createTelegramFake,
  envFor,
  NOTIFY_SECRET,
  postJson,
  startFunction,
} from "./harness.ts";

const rows = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    telegram_id: 42,
    text: "Первый",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    telegram_id: 43,
    text: "Второй",
  },
];

Deno.test("tg-notify: HTTP → claim/finish + Telegram", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-notify", envFor(supa.url, telegram.url));
  const send = (secret = NOTIFY_SECRET) =>
    postJson(fn.url, {}, { "x-notify-secret": secret });

  try {
    await t.step("rejects non-POST and wrong secret", async () => {
      const get = await fetch(fn.url, { method: "GET" });
      assert.equal(get.status, 403);
      const missing = await postJson(fn.url, {});
      assert.equal(missing.res.status, 403);
      const wrong = await send("wrong");
      assert.equal(wrong.res.status, 403);
      assert.equal(telegram.state.calls.length, 0);
      assert.equal(supa.state.requests.length, 0);
    });

    await t.step("empty queue is a successful no-op", async () => {
      supa.reset();
      telegram.reset();
      const r = await send();
      assert.equal(r.res.status, 200);
      assert.deepEqual(r.data, { claimed: 0, sent: 0, failed: 0 });
      assert.equal(telegram.state.calls.length, 0);
    });

    await t.step(
      "200 sends all claimed notifications and finishes them",
      async () => {
        supa.reset();
        telegram.reset();
        supa.state.notifications = rows;
        const r = await send();
        assert.equal(r.res.status, 200);
        assert.deepEqual(r.data, { claimed: 2, sent: 2, failed: 0 });
        assert.deepEqual(telegram.state.calls.map((c) => c.method), [
          "sendMessage",
          "sendMessage",
        ]);
        assert.equal(telegram.state.calls[0].body?.chat_id, 42);
        assert.equal(telegram.state.calls[1].body?.chat_id, 43);
        assert.deepEqual(telegram.state.calls[0].body?.reply_markup, {
          inline_keyboard: [[{
            text: "Открыть приложение",
            web_app: { url: APP_URL },
          }]],
        });
        assert.deepEqual(supa.state.finish, [
          { id: rows[0].id, ok: true, err: null, give_up: false },
          { id: rows[1].id, ok: true, err: null, give_up: false },
        ]);
      },
    );

    await t.step("403 marks the notification as give-up", async () => {
      supa.reset();
      telegram.reset();
      supa.state.notifications = [rows[0]];
      telegram.state.status = 403;
      telegram.state.text = "Forbidden: bot was blocked by the user";
      const r = await send();
      assert.deepEqual(r.data, { claimed: 1, sent: 0, failed: 1 });
      assert.deepEqual(supa.state.finish, [
        {
          id: rows[0].id,
          ok: false,
          err: "403 Forbidden: bot was blocked by the user",
          give_up: true,
        },
      ]);
    });

    await t.step(
      "429 records the error and stops before the next row",
      async () => {
        supa.reset();
        telegram.reset();
        supa.state.notifications = rows;
        telegram.state.status = 429;
        telegram.state.text = "Too Many Requests";
        const r = await send();
        assert.deepEqual(r.data, { claimed: 2, sent: 0, failed: 1 });
        assert.equal(telegram.state.calls.length, 1);
        assert.deepEqual(supa.state.finish, [
          {
            id: rows[0].id,
            ok: false,
            err: "429 Too Many Requests",
            give_up: false,
          },
        ]);
      },
    );

    await t.step("500 records the error and continues", async () => {
      supa.reset();
      telegram.reset();
      supa.state.notifications = rows;
      telegram.state.status = 500;
      telegram.state.text = "oops";
      const r = await send();
      assert.deepEqual(r.data, { claimed: 2, sent: 0, failed: 2 });
      assert.equal(telegram.state.calls.length, 2);
      assert.deepEqual(
        supa.state.finish.map((f) => [f.id, f.ok, f.err, f.give_up]),
        [
          [rows[0].id, false, "500 oops", false],
          [rows[1].id, false, "500 oops", false],
        ],
      );
    });

    await t.step("claim failure returns 500", async () => {
      supa.reset();
      telegram.reset();
      supa.state.claimError = "queue is locked";
      const r = await send();
      assert.equal(r.res.status, 500);
      assert.deepEqual(r.data, { error: "internal" });
      assert.equal(telegram.state.calls.length, 0);
    });
  } finally {
    await fn.close();
    await telegram.close();
    await supa.close();
  }
});
