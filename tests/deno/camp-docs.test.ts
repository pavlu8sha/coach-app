import assert from "node:assert/strict";
import { createSupabaseFake, createTelegramFake, envFor, startFunction } from "./harness.ts";

const CAMP = "00000000-0000-0000-0000-0000000000ca";
const DOC = "11111111-1111-1111-1111-111111111111";
const PATH = `${CAMP}/${DOC}.pdf`;
const USER = "Bearer user-jwt";
const SERVICE = "Bearer test-service-role-key";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n");

Deno.test("camp-docs: загрузка и выдача документов сбора", async (t) => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("camp-docs", { ...envFor(supa.url, telegram.url), SUPABASE_ANON_KEY: "test-anon-key" });
  const call = async (query: string, body: BodyInit | null, headers: Record<string, string> = { Authorization: USER }) => {
    const res = await fetch(fn.url + query, { method: "POST", headers, body });
    const text = await res.text();
    return { res, data: text ? JSON.parse(text) : null };
  };
  const link = (id: unknown, headers?: Record<string, string>) =>
    call("", JSON.stringify({ action: "link", id }), headers ?? { Authorization: USER, "Content-Type": "application/json" });
  const upload = (body: BodyInit, extra = "") => call(`?action=upload&camp=${CAMP}&title=${encodeURIComponent("Программа")}${extra}`, body);
  const seen = () => supa.state.requests.map((q) => `${q.method} ${q.path}`);
  const authOf = (suffix: string) => supa.state.requests.find((q) => q.path.endsWith(suffix) || q.path.includes(suffix))?.auth;

  try {
    await t.step("без входа и не POST: отказ без обращений к базе", async () => {
      const get = await fetch(fn.url, { method: "GET" });
      assert.equal(get.status, 405);
      await get.body?.cancel();
      assert.equal((await link(DOC, { "Content-Type": "application/json" })).res.status, 401);
      assert.equal((await link(DOC, { Authorization: SERVICE, "Content-Type": "application/json" })).res.status, 401);
      assert.equal(supa.state.requests.length, 0);
    });

    await t.step("OPTIONS отвечает 204 с CORS", async () => {
      const res = await fetch(fn.url, { method: "OPTIONS" });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://app.test");
    });

    await t.step("ссылка: права проверяет база от имени пользователя, подпись делает сервер на 60 секунд", async () => {
      supa.reset();
      supa.state.docPath = PATH;
      const r = await link(DOC);
      assert.equal(r.res.status, 200);
      assert.equal(r.data.expires_in, 60);
      assert.ok(String(r.data.url).includes(`/object/sign/camp-docs/${PATH}?token=signed-test-token`));
      assert.equal(r.res.headers.get("cache-control"), "no-store");
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_path", `POST /storage/v1/object/sign/camp-docs/${PATH}`]);
      assert.equal(authOf("camp_document_path"), USER);
      assert.equal(authOf("/object/sign/"), SERVICE);
      assert.deepEqual(supa.state.requests[0].body, { did: DOC });
      assert.deepEqual(supa.state.requests[1].body, { expiresIn: 60 });
    });

    await t.step("ссылка: отказ базы не доходит до хранилища", async () => {
      supa.reset();
      supa.state.docPathError = { code: "42501", message: "forbidden" };
      const r = await link(DOC);
      assert.equal(r.res.status, 403);
      assert.deepEqual(r.data, { error: "forbidden" });
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_path"]);
    });

    await t.step("ссылка: неверный id и путь не по шаблону отклоняются", async () => {
      supa.reset();
      assert.equal((await link("1; drop")).res.status, 400);
      assert.equal((await call("", "не json")).res.status, 400);
      assert.equal(supa.state.requests.length, 0);
      supa.state.docPath = "../other-bucket/secret.pdf";
      assert.equal((await link(DOC)).res.status, 403);
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_path"]);
    });

    await t.step("ссылка: сбой хранилища даёт 502 без подробностей", async () => {
      supa.reset();
      supa.state.docPath = PATH;
      supa.state.storageSignStatus = 500;
      const r = await link(DOC);
      assert.equal(r.res.status, 502);
      assert.deepEqual(r.data, { error: "storage" });
    });

    await t.step("загрузка: begin от имени пользователя, файл и finish сервисным ключом", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: PATH };
      const r = await upload(PDF);
      assert.equal(r.res.status, 200);
      assert.deepEqual(r.data, { id: DOC });
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_begin", `POST /storage/v1/object/camp-docs/${PATH}`, "POST /rest/v1/rpc/camp_document_finish"]);
      assert.deepEqual(supa.state.requests[0].body, { cid: CAMP, title: "Программа", size: PDF.length, replaces: null });
      assert.equal(supa.state.requests[0].auth, USER);
      assert.equal(supa.state.requests[1].auth, SERVICE);
      assert.deepEqual(supa.state.requests[2].body, { did: DOC, ok: true });
      assert.equal(supa.state.requests[2].auth, SERVICE);
    });

    await t.step("загрузка: не PDF, пустой и слишком большой файл отклоняются до базы", async () => {
      supa.reset();
      assert.deepEqual((await upload(new TextEncoder().encode("<html>%%EOF"))).data, { error: "not_pdf" });
      assert.deepEqual((await upload(new Uint8Array())).data, { error: "empty" });
      const big = new Uint8Array(10 * 1024 * 1024 + 1);
      big.set(PDF);
      assert.equal((await upload(big)).res.status, 413);
      assert.equal((await call(`?action=upload&camp=x&title=a`, PDF)).res.status, 400);
      assert.equal(supa.state.requests.length, 0);
    });

    await t.step("загрузка: отказ базы (не администратор) не доходит до хранилища", async () => {
      supa.reset();
      supa.state.docBeginError = { code: "42501", message: "forbidden" };
      const r = await upload(PDF);
      assert.equal(r.res.status, 403);
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_begin"]);
    });

    await t.step("загрузка: путь из базы не по шаблону в хранилище не пишется", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: `${CAMP}/../x.pdf` };
      assert.equal((await upload(PDF)).res.status, 500);
      assert.deepEqual(seen(), ["POST /rest/v1/rpc/camp_document_begin"]);
    });

    await t.step("загрузка: сбой хранилища помечает версию сорвавшейся", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: PATH };
      supa.state.storageUploadStatus = 500;
      const r = await upload(PDF);
      assert.equal(r.res.status, 502);
      assert.deepEqual(supa.state.requests.at(-1)?.body, { did: DOC, ok: false });
    });

    await t.step("загрузка: если публикация не подтвердилась, файл убирается из хранилища", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: PATH };
      supa.state.docFinishError = { code: "22023", message: "not pending" };
      const r = await upload(PDF);
      assert.equal(r.res.status, 409);
      const last = supa.state.requests.at(-1)!;
      assert.equal(`${last.method} ${last.path}`, "DELETE /storage/v1/object/camp-docs");
      assert.deepEqual(last.body, { prefixes: [PATH] });
      assert.equal(supa.state.requests.at(-2)?.auth, SERVICE);
    });

    await t.step("загрузка: ответ о публикации потерян, но версия опубликована: файл не удаляется", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: PATH };
      supa.state.docFinishError = { code: "XX000", message: "timeout" };
      supa.state.docStatus = "ready";
      const r = await upload(PDF);
      assert.equal(r.res.status, 200);
      assert.deepEqual(r.data, { id: DOC });
      assert.equal(supa.state.requests.filter((q) => q.method === "DELETE").length, 0);
    });

    await t.step("загрузка: статус версии узнать не удалось: файл не удаляется", async () => {
      supa.reset();
      supa.state.docBegin = { id: DOC, path: PATH };
      supa.state.docFinishError = { code: "XX000", message: "timeout" };
      supa.state.docStatusError = "down";
      const r = await upload(PDF);
      assert.equal(r.res.status, 502);
      assert.equal(supa.state.requests.filter((q) => q.method === "DELETE").length, 0);
    });

    await t.step("ссылка: большое тело запроса отклоняется без обращения к базе", async () => {
      supa.reset();
      const r = await call("", JSON.stringify({ action: "link", id: DOC, pad: "x".repeat(100000) }));
      assert.equal(r.res.status, 413);
      assert.equal(supa.state.requests.length, 0);
    });
  } finally {
    await fn.close();
    await supa.close();
    await telegram.close();
  }
});

Deno.test("camp-docs: без ключа проекта функция сообщает об ошибке настройки", async () => {
  const supa = createSupabaseFake();
  const telegram = createTelegramFake();
  const fn = await startFunction("camp-docs", { ...envFor(supa.url, telegram.url), SUPABASE_ANON_KEY: "" });
  try {
    const res = await fetch(fn.url, { method: "POST", headers: { Authorization: USER }, body: JSON.stringify({ action: "link", id: DOC }) });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "config" });
    assert.equal(supa.state.requests.length, 0);
  } finally {
    await fn.close();
    await supa.close();
    await telegram.close();
  }
});
