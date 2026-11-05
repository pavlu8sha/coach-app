import assert from "node:assert/strict";
import {
  BEFORE_START,
  WELCOME,
} from "../../supabase/functions/tg-bot/bot-logic.js";
import {
  APP_URL,
  createSupabaseFake,
  createTelegramFake,
  envFor,
  postJson,
  startFunction,
  WEBHOOK_SECRET,
} from "./harness.ts";

const update = (text: string) => ({
  update_id: 1,
  message: { chat: { id: 42, type: "private" }, text },
});

Deno.test("tg-bot: HTTP → Telegram", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-bot", envFor(supa.url, telegram.url));
  const send = (body: unknown, secret = WEBHOOK_SECRET) =>
    postJson(fn.url, body, { "x-telegram-bot-api-secret-token": secret });

  try {
    await t.step("rejects non-POST and wrong secret", async () => {
      telegram.reset();
      const get = await fetch(fn.url, { method: "GET" });
      assert.equal(get.status, 403);
      const wrong = await send(update("/start"), "wrong");
      assert.equal(wrong.res.status, 403);
      assert.equal(telegram.state.calls.length, 0);
    });

    await t.step("/start sends the welcome and the next button", async () => {
      telegram.reset();
      const r = await send(update("/start"));
      assert.equal(r.res.status, 200);
      assert.equal(r.text, "ok");
      assert.equal(telegram.state.calls.length, 1);
      const call = telegram.state.calls[0];
      assert.equal(call.method, "sendMessage");
      assert.equal(call.body?.chat_id, 42);
      assert.equal(call.body?.text, WELCOME);
      assert.deepEqual(call.body?.reply_markup, {
        inline_keyboard: [[{ text: "Далее ➡️", callback_data: "next" }]],
      });
    });

    await t.step("/start@bot and other private text are routed", async () => {
      telegram.reset();
      await send(update("/start@kicksapp_bot"));
      assert.equal(telegram.state.calls[0].body?.text, WELCOME);

      telegram.reset();
      await send(update("привет"));
      assert.equal(
        telegram.state.calls[0].body?.text,
        "Всё находится в приложении. Нажмите кнопку ниже, чтобы открыть его.",
      );
    });

    await t.step(
      "callback next answers and sends the second screen",
      async () => {
        telegram.reset();
        const r = await send({
          callback_query: {
            id: "q1",
            data: "next",
            message: { chat: { id: 42, type: "private" } },
          },
        });
        assert.equal(r.res.status, 200);
        assert.deepEqual(telegram.state.calls.map((c) => c.method), [
          "answerCallbackQuery",
          "sendMessage",
        ]);
        assert.equal(telegram.state.calls[0].body?.callback_query_id, "q1");
        assert.equal(telegram.state.calls[1].body?.text, BEFORE_START);
        const rows = (telegram.state.calls[1].body?.reply_markup as {
          inline_keyboard: Array<
            Array<{ url?: string; web_app?: { url: string } }>
          >;
        }).inline_keyboard;
        assert.equal(rows[0][0].url, "https://t.me/fc_kickstart_tbs");
        assert.deepEqual(rows[1][0].web_app, { url: APP_URL });
      },
    );

    await t.step("unknown callback only acknowledges", async () => {
      telegram.reset();
      await send({
        callback_query: {
          id: "q2",
          data: "other",
          message: { chat: { id: 42, type: "private" } },
        },
      });
      assert.deepEqual(telegram.state.calls, [{
        method: "answerCallbackQuery",
        body: { callback_query_id: "q2" },
      }]);
    });

    await t.step(
      "group chats and malformed JSON do not call Telegram",
      async () => {
        telegram.reset();
        const group = await send({
          message: { chat: { id: 1, type: "group" }, text: "/start" },
        });
        assert.equal(group.res.status, 200);
        const malformed = await fetch(fn.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
          },
          body: "{",
        });
        assert.equal(malformed.status, 200);
        assert.equal(telegram.state.calls.length, 0);
      },
    );

    for (const status of [403, 429, 500]) {
      await t.step(
        `Telegram ${status} does not break the webhook`,
        async () => {
          telegram.reset();
          telegram.state.status = status;
          telegram.state.text = JSON.stringify({
            ok: false,
            description: `error ${status}`,
          });
          const r = await send(update("/start"));
          assert.equal(r.res.status, 200);
          assert.equal(r.text, "ok");
          assert.equal(telegram.state.calls.length, 1);
        },
      );
    }
  } finally {
    await fn.close();
    await telegram.close();
    await supa.close();
  }
});

Deno.test("tg-bot: кнопки «Будет» / «Не будет» в уведомлении о матче", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-bot", envFor(supa.url, telegram.url));
  const send = (body: unknown) =>
    postJson(fn.url, body, { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET });
  const INV = "11111111-2222-3333-4444-555555555555";
  const press = (data: string) => ({
    update_id: 5,
    callback_query: {
      id: "cb1",
      from: { id: 77 },
      data,
      message: {
        chat: { id: 77, type: "private" },
        message_id: 9,
        reply_markup: { inline_keyboard: [[{ text: "Пётр: Будет", callback_data: `r:${INV}:y` }, { text: "Пётр: Не будет", callback_data: `r:${INV}:n` }]] },
      },
    },
  });

  try {
    await t.step("записывает ответ через базу под Telegram-аккаунтом нажавшего", async () => {
      supa.reset();
      telegram.reset();
      const r = await send(press(`r:${INV}:y`));
      assert.equal(r.res.status, 200);
      const rpc = supa.state.requests.find((q) => q.path === "/rest/v1/rpc/rsvp_answer_by_telegram");
      assert.deepEqual(rpc?.body, { p_telegram_id: 77, p_invitation: INV, p_response: "yes" });
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery", "editMessageReplyMarkup"]);
      assert.equal(telegram.state.calls[0].body?.text, "Записано: Иванов Пётр — Будет");
    });

    await t.step("отказ базы показывается нажавшему", async () => {
      supa.reset();
      telegram.reset();
      supa.state.rsvpResult = { ok: false, code: "closed" };
      await send(press(`r:${INV}:n`));
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery"]);
      assert.equal(telegram.state.calls[0].body?.show_alert, true);
    });

    await t.step("ошибка базы не ломает webhook", async () => {
      supa.reset();
      telegram.reset();
      supa.state.rsvpError = "boom";
      const r = await send(press(`r:${INV}:y`));
      assert.equal(r.res.status, 200);
      assert.equal(telegram.state.calls[0].method, "answerCallbackQuery");
      assert.equal(telegram.state.calls[0].body?.show_alert, true);
    });

    await t.step("чужие кнопки по-прежнему только подтверждаются", async () => {
      supa.reset();
      telegram.reset();
      await send(press("unknown"));
      assert.equal(supa.state.requests.filter((q) => q.path.includes("rsvp_answer_by_telegram")).length, 0);
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery"]);
    });
  } finally {
    await fn.close();
    await telegram.close();
    await supa.close();
  }
});
