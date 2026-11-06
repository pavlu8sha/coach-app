import assert from "node:assert/strict";
import { parseWaitlist, waitlistCalls } from "../../supabase/functions/tg-bot/waitlist-logic.js";
import { buildCall } from "../../supabase/functions/tg-notify/notify-logic.js";

const W1 = "11111111-2222-3333-4444-555555555555";
const W2 = "99999999-2222-3333-4444-555555555555";

Deno.test("waitlist-logic: разбор данных кнопки", () => {
  assert.deepEqual(parseWaitlist(`w:${W1}`), { waitlist: W1 });
  for (const bad of ["next", `r:${W1}:y`, `w:не-uuid`, `w:${W1}:x`, undefined, null, 5]) {
    assert.equal(parseWaitlist(bad), null);
  }
});

const cb = {
  id: "cb1",
  message: {
    chat: { id: 42 },
    message_id: 7,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Занять место: Пётр", callback_data: `w:${W1}` }],
        [{ text: "Занять место: Павел", callback_data: `w:${W2}` }],
        [{ text: "Открыть приложение", web_app: { url: "https://mini.test/" } }],
      ],
    },
  },
};

Deno.test("waitlist-logic: место получено — подтверждение и кнопка этого ребёнка убирается", () => {
  const calls: any[] = waitlistCalls(cb, { waitlist: W1 }, { ok: true, player: "Иванов Пётр" });
  assert.equal(calls[0].method, "answerCallbackQuery");
  assert.equal(calls[0].body.text, "Место за вами: Иванов Пётр");
  assert.equal(calls[1].method, "editMessageReplyMarkup");
  const kb = calls[1].body.reply_markup.inline_keyboard;
  assert.equal(kb.length, 2);
  assert.equal(kb[0][0].callback_data, `w:${W2}`); // другой ребёнок остаётся
  assert.deepEqual(kb[1], cb.message.reply_markup.inline_keyboard[2]);
});

Deno.test("waitlist-logic: отказы — понятный текст, клавиатура не меняется", () => {
  for (const [code, part] of [["full", "уже заняли"], ["closed", "началось"], ["forbidden", "Нет доступа"], ["not_found", "уже нет"], ["weird", "Не получилось"]] as const) {
    const calls: any[] = waitlistCalls(cb, { waitlist: W1 }, { ok: false, code });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "answerCallbackQuery");
    assert.ok(calls[0].body.text.includes(part), `${code}: ${calls[0].body.text}`);
  }
});

Deno.test("tg-notify: кнопки очереди попадают в сообщение, данные не длиннее 64 байт", () => {
  const call = buildCall({ telegram_id: 1, text: "t", buttons: [[{ text: "Занять место: Пётр", data: `w:${W1}` }]] }, "https://mini.test/");
  assert.equal((call.body.reply_markup.inline_keyboard[0][0] as { callback_data?: string }).callback_data, `w:${W1}`);
  assert.ok(`w:${W1}`.length <= 64);
});
