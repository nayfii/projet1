import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, createCompany, createUser, serviceClient, sql, type TestUser } from "../helpers/supabase";

/**
 * Step 11: personal avatars. Only the server sets the avatar; images sit in a private bucket that
 * signed-in people cannot reach directly; the cost is set by our team only.
 */
let owner: TestUser, colleague: TestUser, outsider: TestUser;
let company: string;

beforeAll(async () => {
  [owner, colleague, outsider] = await Promise.all([createUser("av-owner", "Owner"), createUser("av-colleague", "Colleague"), createUser("av-outsider", "Outsider")]);
  company = await createCompany(owner, "Avatar Co");
  await addMember(owner, company, colleague);
  await createCompany(outsider, "Other Co");
});

describe("the avatar URL", () => {
  it("cannot be set by the person (only by the server, after generation)", async () => {
    const { error } = await owner.client.from("profiles").update({ avatar_url: `/api/avatars/${owner.id}?v=${randomUUID()}` }).eq("id", owner.id);
    expect(error).not.toBeNull();
  });

  it("can only point at our own avatar route, even for the server", async () => {
    const bad = await serviceClient().from("profiles").update({ avatar_url: "https://tracker.example/pixel.png" }).eq("id", owner.id);
    expect(bad.error).not.toBeNull();
    const good = await serviceClient().from("profiles").update({ avatar_url: `/api/avatars/${owner.id}?v=${randomUUID()}` }).eq("id", owner.id);
    expect(good.error).toBeNull();
  });

  it("is visible to colleagues, not to people of another company", async () => {
    expect((await colleague.client.from("profiles").select("avatar_url").eq("id", owner.id)).data).toHaveLength(1);
    expect((await outsider.client.from("profiles").select("avatar_url").eq("id", owner.id)).data).toEqual([]);
  });
});

describe("the avatars bucket", () => {
  it("is private and closed to signed-in people: the server reads and writes it", async () => {
    const path = `${owner.id}/${randomUUID()}.webp`;
    const upload = await owner.client.storage.from("avatars").upload(path, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
    expect(upload.error).not.toBeNull();
    const byServer = await serviceClient().storage.from("avatars").upload(path, new Uint8Array([1, 2, 3]), { contentType: "image/webp" });
    expect(byServer.error).toBeNull();
    expect((await colleague.client.storage.from("avatars").download(path)).data).toBeNull();
    expect((await owner.client.storage.from("avatars").download(path)).data).toBeNull();
    const [{ public: isPublic }] = await sql<{ public: boolean }>("select public from storage.buckets where id = 'avatars'");
    expect(isPublic).toBe(false);
  });
});

describe("the avatar rate", () => {
  it("is set by the platform team only, and avatar generations are counted as usage", async () => {
    expect((await owner.client.rpc("platform_set_avatar_rate", { p_credits: 1, p_cost_usd: 0 })).error?.message).toBe("forbidden");
    const { error } = await serviceClient()
      .from("usage_events")
      .insert({ company_id: company, user_id: owner.id, feature: "avatar", provider: "openai", model_id: "gpt-image-1.5", credits: 50, status: "ok" });
    expect(error).toBeNull();
  });
});
