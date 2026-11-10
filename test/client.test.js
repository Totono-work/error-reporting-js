import test from "node:test";
import assert from "node:assert/strict";
import { init } from "../node.js";

const options = {
  key: "ttr_" + "a".repeat(43), release: "test", captureFatal: false,
};

test("concurrent Node scopes do not share user or tag context", async () => {
  const sent = [];
  const client = init({ ...options, fetch: async (_, request) => {
    sent.push(...JSON.parse(request.body).events);
    return new Response(null, { status: 202 });
  } });
  await Promise.all(["first", "second"].map(id => client.withScope({ user: { id }, tags: { id } }, async () => {
    await Promise.resolve();
    client.captureException(new Error(id));
  })));
  await client.close();
  assert.deepEqual(sent.map(event => [event.user.id, event.tags.id]).sort(), [["first", "first"], ["second", "second"]]);
});

test("a report restored after temporary failure reuses its original ID", async () => {
  let queue = [];
  const storage = { load: () => queue, save: value => { queue = structuredClone(value); } };
  const offline = init({ ...options, storage, fetch: async () => { throw new Error("offline"); } });
  const id = offline.captureException(new Error("delivery retry"));
  assert.equal(await offline.close(), false);
  const online = init({ ...options, storage, fetch: async (_, request) => {
    assert.equal(JSON.parse(request.body).events[0].id, id);
    return new Response(null, { status: 202 });
  } });
  assert.equal(await online.close(), true);
  assert.deepEqual(queue, []);
});
