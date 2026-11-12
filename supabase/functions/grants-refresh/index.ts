// Supabase Edge Function entry (verify_jwt = false; auth is the x-grants-token header checked in the DB).
// Only Deno-specific file. Env: SUPABASE_DB_URL, SUPABASE_URL (auto), GRANTS_GOV_API_KEY, SAM_API_KEY (optional).
import postgres from "postgres";
import { handle } from "./handler.ts";
import { realClock } from "./types.ts";

declare const Deno: { env: { get(k: string): string | undefined }; createHttpClient(o: { http1?: boolean; http2?: boolean }): unknown; serve(h: (r: Request) => Response | Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = (k: string) => Deno.env.get(k) || undefined;

let h1Client: unknown; // created on first use
const fetchH1: typeof fetch = (input, init) => fetch(input, { ...init, client: (h1Client ??= Deno.createHttpClient({ http1: true, http2: false })) } as unknown as RequestInit);

Deno.serve((req) =>
  handle(req, {
    makeSql: () => postgres(env("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 5, connect_timeout: 10 }),
    env: { allowLocal: env("GRANTS_ALLOW_LOCAL") === "1", grantsGovKey: env("GRANTS_GOV_API_KEY"), samKey: env("SAM_API_KEY") },
    clock: realClock,
    fetchImpl: fetch,
    fetchH1,
    supabaseUrl: env("SUPABASE_URL"),
    waitUntil: typeof EdgeRuntime !== "undefined" ? (p) => EdgeRuntime!.waitUntil(p) : undefined,
  })
);
