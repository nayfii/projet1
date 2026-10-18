import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "@/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

const url = () => process.env.TEST_SUPABASE_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient(): Client {
  return createClient<Database>(url(), process.env.TEST_SUPABASE_SECRET_KEY!, options);
}

export function anonClient(): Client {
  return createClient<Database>(url(), process.env.TEST_SUPABASE_PUBLISHABLE_KEY!, options);
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

export type TestUser = { id: string; email: string; client: Client };

/** Creates a confirmed user and returns a client signed in as that user (real JWT, real RLS). */
export async function createUser(label: string, fullName?: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  const password = `pw-${randomUUID()}`;
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? label },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

export async function makePlatformAdmin(user: TestUser) {
  await sql("insert into public.platform_admins (user_id) values ($1) on conflict do nothing", [user.id]);
}

export async function createCompany(owner: TestUser, name: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_company", { p_name: name });
  if (error || !data) throw error ?? new Error("create_company failed");
  return data;
}

/** Invites `user` into `companyId` (as `inviter`) and accepts with the user's own session. */
export async function addMember(
  inviter: TestUser,
  companyId: string,
  user: TestUser,
  role: "member" | "admin" = "member",
  scopes: string[] = [],
  expertise: string[] = [],
) {
  const { data, error } = await inviter.client.rpc("create_invitation", {
    p_company: companyId,
    p_email: user.email,
    p_role: role,
    p_admin_scopes: scopes,
    p_expertise: expertise,
  });
  if (error || !data?.[0]) throw error ?? new Error("create_invitation failed");
  const { error: acceptError } = await user.client.rpc("accept_invitation", { p_token: data[0].token });
  if (acceptError) throw acceptError;
}

export async function createClientRecord(
  actor: TestUser,
  companyId: string,
  name: string,
  visibility: "open" | "restricted",
): Promise<string> {
  const { data, error } = await actor.client
    .from("clients")
    .insert({ company_id: companyId, name, visibility })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("client insert failed");
  return data.id;
}
