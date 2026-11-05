import assert from "node:assert/strict";
import { parseRsvp, rsvpCalls } from "../../supabase/functions/tg-bot/rsvp-logic.js";
import { buildCall } from "../../supabase/functions/tg-notify/notify-logic.js";

const INV = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";

Deno.test("rsvp-logic: разбор данных кнопки", () => {
  assert.deepEqual(parseRsvp(`r:${INV}:y`), { invitation: INV, response: "yes" });
  assert.deepEqual(parseRsvp(`r:${INV}:n`), { invitation: INV, response: "no" });
  for (const bad of ["next", `r:${INV}:x`, `r:не-uuid:y`, `r:${INV}`, `x:${INV}:y`, undefined, null, 5]) {
    assert.equal(parseRsvp(bad), null);
  }
});

const cb = {
  id: "cb1",
  message: {
    chat: { id: 42 },
    message_id: 7,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Пётр: Будет", callback_data: `r:${INV}:y` }, { text: "Пётр: Не будет", callback_data: `r:${INV}:n` }],
        [{ text: "Павел: Будет", callback_data: `r:${OTHER}:y` }, { text: "Павел: Не будет", callback_data: `r:${OTHER}:n` }],
        [{ text: "Открыть приложение", web_app: { url: "https://mini.test/" } }],
      ],
    },
  },
};

Deno.test("rsvp-logic: успешный ответ — подтверждение и отметка выбранной кнопки", () => {
  const calls = rsvpCalls(cb, { invitation: INV, response: "yes" }, { ok: true, player: "Иванов Пётр" });
  assert.equal(calls[0].method, "answerCallbackQuery");
  assert.equal(calls[0].body.text, "Записано: Иванов Пётр — Будет");
  assert.equal(calls[1].method, "editMessageReplyMarkup");
  const kb = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(kb[0][0].text, "✅ Пётр: Будет");
  assert.equal(kb[0][1].text, "Пётр: Не будет");
  assert.equal(kb[1][0].text, "Павел: Будет"); // другой ребёнок не затронут
  assert.deepEqual(kb[2], cb.message.reply_markup.inline_keyboard[2]);
});

Deno.test("rsvp-logic: смена ответа переносит отметку", () => {
  const first = rsvpCalls(cb, { invitation: INV, response: "yes" }, { ok: true, player: "П" })[1].body.reply_markup;
  const again = rsvpCalls({ ...cb, message: { ...cb.message, reply_markup: first } }, { invitation: INV, response: "no" }, { ok: true, player: "П" });
  const kb = again[1].body.reply_markup.inline_keyboard;
  assert.equal(kb[0][0].text, "Пётр: Будет");
  assert.equal(kb[0][1].text, "✅ Пётр: Не будет");
});

Deno.test("rsvp-logic: отказ базы — понятное сообщение без правки кнопок", () => {
  for (const code of ["closed", "forbidden", "unknown_user", "not_found", "bad_request", "error"]) {
    const calls = rsvpCalls(cb, { invitation: INV, response: "yes" }, { ok: false, code });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "answerCallbackQuery");
    assert.equal(calls[0].body.show_alert, true);
    assert.ok(String(calls[0].body.text).length > 10);
  }
});

Deno.test("tg-notify: кнопки ответа идут над «Открыть приложение»", () => {
  const n = {
    telegram_id: 42,
    text: "t",
    buttons: [[{ text: "Пётр: Будет", data: `r:${INV}:y` }, { text: "Пётр: Не будет", data: `r:${INV}:n` }]],
  };
  const body = buildCall(n, "https://mini.test/").body;
  assert.deepEqual(body.reply_markup.inline_keyboard, [
    [{ text: "Пётр: Будет", callback_data: `r:${INV}:y` }, { text: "Пётр: Не будет", callback_data: `r:${INV}:n` }],
    [{ text: "Открыть приложение", web_app: { url: "https://mini.test/" } }],
  ]);
  // без кнопок или с мусором — как раньше
  for (const buttons of [null, undefined, [], [[]], "x", [[{ text: 1, data: "d" }]], [[{ text: "t", data: "x".repeat(65) }]]]) {
    assert.deepEqual(buildCall({ telegram_id: 1, text: "t", buttons }, "https://mini.test/").body.reply_markup.inline_keyboard,
      [[{ text: "Открыть приложение", web_app: { url: "https://mini.test/" } }]]);
  }
});
