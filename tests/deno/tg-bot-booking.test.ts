// Запись на тренировку из бота (Issue #274): настоящий index.ts tg-bot, база и Telegram подменены заглушками.
import assert from "node:assert/strict";
import {
  createSupabaseFake,
  createTelegramFake,
  envFor,
  postJson,
  startFunction,
  WEBHOOK_SECRET,
} from "./harness.ts";

const S = "0b9d3f2e-7a51-4c3e-9f10-2d6b8e4a1c77";
const press = (data: string, from = 77, chat = { id: 77, type: "private" }) => ({
  update_id: 6,
  callback_query: { id: "cb1", from: { id: from }, data, message: { chat, message_id: 9 } },
});

Deno.test("tg-bot: запись на тренировку из Telegram", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("tg-bot", envFor(supa.url, telegram.url));
  const send = (body: unknown) => postJson(fn.url, body, { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET });
  const rpcs = () => supa.state.requests.filter((q) => q.path.includes("/rpc/")).map((q) => q.path.split("/").pop());

  try {
    await t.step("«Записаться» показывает занятия из базы, Telegram ID из from", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingResults.booking_options_by_telegram = {
        ok: true,
        sessions: [{ id: S, kind: "individual", label: "Пт 07.11 19:00", free: true, children: [{ id8: "a1b2c3d4", name: "Аня" }] }],
      };
      const r = await send(press("bk"));
      assert.equal(r.res.status, 200);
      const q = supa.state.requests.find((x) => x.path.endsWith("booking_options_by_telegram"));
      assert.deepEqual(q?.body, { p_telegram_id: 77 });
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery", "editMessageText"]);
    });

    await t.step("запись: база получает Telegram ID, занятие и ребёнка; ответ — подтверждение и снятие кнопок", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingResults.booking_signup_by_telegram = { ok: true, code: "ok", player: "Аня", label: "Пт 07.11 19:00" };
      await send(press(`bc:${S}:a1b2c3d4`));
      const q = supa.state.requests.find((x) => x.path.endsWith("booking_signup_by_telegram"));
      assert.deepEqual(q?.body, { p_telegram_id: 77, p_session: S, p_child: "a1b2c3d4" });
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery", "editMessageReplyMarkup"]);
      assert.match(String(telegram.state.calls[0].body?.text), /Запись подтверждена: Аня/);
    });

    await t.step("повторное нажатие: «Уже записаны», запись создаёт база только один раз", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingResults.booking_signup_by_telegram = { ok: false, code: "already", player: "Аня", label: "Пт" };
      await send(press(`bc:${S}:a1b2c3d4`));
      assert.match(String(telegram.state.calls[0].body?.text), /Уже записаны: Аня/);
    });

    await t.step("мест нет: показывается отказ, в очередь автоматически не ставит", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingResults.booking_signup_by_telegram = { ok: false, code: "full" };
      await send(press(`bc:${S}:a1b2c3d4`));
      assert.deepEqual(rpcs(), ["booking_signup_by_telegram"]);
      assert.deepEqual(telegram.state.calls.map((c) => c.method), ["answerCallbackQuery"]);
    });

    await t.step("очередь только по кнопке bw", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingResults.waitlist_join_by_telegram = { ok: true, code: "ok", player: "Аня", label: "Пт" };
      await send(press(`bw:${S}:a1b2c3d4`));
      assert.deepEqual(rpcs(), ["waitlist_join_by_telegram"]);
      assert.match(String(telegram.state.calls[0].body?.text), /Вы в очереди: Аня/);
    });

    await t.step("групповой чат и чужой chat.id: база не вызывается", async () => {
      supa.reset();
      telegram.reset();
      await send(press("bk", 77, { id: -100, type: "group" }));
      await send(press(`bc:${S}:a1b2c3d4`, 77, { id: 88, type: "private" }));
      assert.deepEqual(rpcs(), []);
      assert.equal(telegram.state.calls.length, 2);
    });

    await t.step("испорченные данные кнопки не доходят до базы", async () => {
      supa.reset();
      telegram.reset();
      await send(press(`bc:${S}:ZZZZZZZZ`));
      await send(press("bs:not-a-uuid"));
      assert.deepEqual(rpcs(), []);
    });

    await t.step("ошибка базы не ломает webhook", async () => {
      supa.reset();
      telegram.reset();
      supa.state.bookingError = "boom";
      const r = await send(press(`bc:${S}:a1b2c3d4`));
      assert.equal(r.res.status, 200);
      assert.equal(telegram.state.calls[0].body?.show_alert, true);
    });
  } finally {
    await fn.close();
    await telegram.close();
    await supa.close();
  }
});
