/** Values safe to expose to the browser (NEXT_PUBLIC_*). Never put a secret here. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  googleAuthEnabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
};
