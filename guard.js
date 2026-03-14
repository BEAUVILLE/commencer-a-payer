(function () {
  "use strict";

  /* =========================================================
     DIGIY GUARD — v2026-03-14
     Soft / slug-first / anti-boucle / accès DIGIY
     ---------------------------------------------------------
     Usage minimal:
       <script>
         window.DIGIY_MODULE = "EXPLORE";
       </script>
       <script src="./guard.js"></script>

     Puis dans ta page:
       window.DIGIY_GUARD.ready.then((ctx) => {
         console.log(ctx);
       });

     Soft by default:
       - ne redirige PAS automatiquement
       - expose goPay() / requireAccess({ redirect:true })

     Dépendances:
       - Supabase JS v2 chargé avant ce fichier
       - view public.digiy_subscriptions_public (slug, phone, module ...)
       - rpc public.digiy_has_access(phone,module)
  ========================================================= */

  const VERSION = "2026-03-14-digiy";

  const EMBEDDED_SUPABASE_URL = "https://wesqmwjjtsefyjnluosj.supabase.co";
  const EMBEDDED_SUPABASE_ANON = "sb_publishable_tGHItRgeWDmGjnd0CK1DVQ_BIep4Ug3";

  const DEFAULT_PAY_URL = "https://commencer-a-payer.digiylyfe.com/";
  const SESSION_KEY = "DIGIY_GUARD_SESSION_V4";
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

  /* =========================================================
     CANONICAL MODULE ACCESS
     ---------------------------------------------------------
     Ici on normalise vers le code attendu côté accès / subscription.
     Le tunnel paiement peut ensuite remapper si besoin.
  ========================================================= */
  const MODULE_ALIAS = {
    CAISSE: "POS",
    CAISSE_BOUTIQUE: "POS",
    POS: "POS",
    POS_PRO: "POS",

    DRIVER: "DRIVER",
    LOC: "LOC",

    RESA: "RESA",
    RESA_TABLE: "RESA",
    RESTO_RESA: "RESA",

    RESTO: "RESTO",
    MARKET: "MARKET",
    BUILD: "BUILD",
    MULTI_SERVICE: "BUILD",
    EXPLORE: "EXPLORE",

    FRET_PRO: "FRET_PRO",
    FRET_CHAUF: "FRET_PRO",
    FRET_CLIENT: "FRET_CLIENT_PRO",
    FRET_CLIENT_PRO: "FRET_CLIENT_PRO"
  };

  const CFG = {
    supabaseUrl:
      (window.DIGIY_SUPABASE_URL ||
        window.DIGIY_SUPABASE__?.url ||
        EMBEDDED_SUPABASE_URL ||
        "").trim(),

    supabaseAnon:
      (window.DIGIY_SUPABASE_ANON_KEY ||
        window.DIGIY_SUPABASE_ANON ||
        window.DIGIY_SUPABASE__?.anon ||
        EMBEDDED_SUPABASE_ANON ||
        "").trim(),

    module: "",
    payUrl: (window.DIGIY_PAY_URL || DEFAULT_PAY_URL || "").trim()
  };

  let sb = null;

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function nowMs() {
    return Date.now();
  }

  function safeUrl(raw, fallback = "") {
    const value = String(raw || "").trim();
    if (!value) return fallback;
    try {
      const u = new URL(value, window.location.href);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
      return fallback;
    } catch {
      return fallback;
    }
  }

  function normalizePhone(value) {
    return String(value || "").trim().replace(/[^\d]/g, "");
  }

  function normalizeSlug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function normalizeModule(value) {
    const raw = String(value || "").trim().toUpperCase();
    return MODULE_ALIAS[raw] || raw || "";
  }

  function displayPhone(value) {
    const p = normalizePhone(value);
    if (!p) return "";
    return p.startsWith("221") ? `+${p}` : p;
  }

  function inferModule() {
    const fromWindow = normalizeModule(window.DIGIY_MODULE);
    if (fromWindow) return fromWindow;

    const bodyModule = normalizeModule(document.body?.dataset?.digiyModule);
    if (bodyModule) return bodyModule;

    const htmlModule = normalizeModule(document.documentElement?.dataset?.digiyModule);
    if (htmlModule) return htmlModule;

    const fromUrl = normalizeModule(qs("module"));
    if (fromUrl) return fromUrl;

    return "";
  }

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const s = safeJsonParse(raw);
      if (!s || typeof s !== "object") {
        clearSession();
        return null;
      }

      if (!s.ts || nowMs() - Number(s.ts) > SESSION_TTL_MS) {
        clearSession();
        return null;
      }

      return {
        phone: normalizePhone(s.phone),
        slug: normalizeSlug(s.slug),
        module: normalizeModule(s.module),
        access: s.access === true,
        source: String(s.source || "session"),
        ts: Number(s.ts)
      };
    } catch (_) {
      clearSession();
      return null;
    }
  }

  function saveSession(payload) {
    const session = {
      phone: normalizePhone(payload?.phone),
      slug: normalizeSlug(payload?.slug),
      module: normalizeModule(payload?.module),
      access: payload?.access === true,
      source: String(payload?.source || "manual"),
      ts: nowMs()
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (_) {}

    return session;
  }

  function requireSupabaseLib() {
    if (!window.supabase?.createClient) {
      throw new Error("SUPABASE_NOT_LOADED");
    }
  }

  function getClient() {
    if (sb) return sb;

    requireSupabaseLib();

    if (!CFG.supabaseUrl || !CFG.supabaseAnon) {
      throw new Error("SUPABASE_CONFIG_MISSING");
    }

    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnon, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        }
      }
    });

    return sb;
  }

  async function resolvePhoneFromSlug(slug, module) {
    const cleanSlug = normalizeSlug(slug);
    const cleanModule = normalizeModule(module);
    if (!cleanSlug) return null;

    const client = getClient();

    async function run(filtered) {
      let query = client
        .from("digiy_subscriptions_public")
        .select("slug, phone, module")
        .eq("slug", cleanSlug)
        .limit(10);

      if (filtered && cleanModule) {
        query = query.eq("module", cleanModule);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) return null;

      const row = rows[0];
      return {
        phone: normalizePhone(row.phone),
        slug: normalizeSlug(row.slug),
        module: normalizeModule(row.module || cleanModule)
      };
    }

    const filteredHit = await run(true);
    if (filteredHit) return filteredHit;

    return await run(false);
  }

  async function checkAccess(phone, module) {
    const cleanPhone = normalizePhone(phone);
    const cleanModule = normalizeModule(module);

    if (!cleanPhone || !cleanModule) return false;

    const client = getClient();
    const { data, error } = await client.rpc("digiy_has_access", {
      p_phone: cleanPhone,
      p_module: cleanModule
    });

    if (error) {
      throw error;
    }

    return !!data;
  }

  function buildPayUrl(opts = {}) {
    const baseUrl = safeUrl(opts.payUrl || CFG.payUrl || DEFAULT_PAY_URL, DEFAULT_PAY_URL);
    const u = new URL(baseUrl, window.location.origin);

    const ctx = opts.ctx || {};
    const module = normalizeModule(opts.module || ctx.module || inferModule());
    const phone = normalizePhone(opts.phone || ctx.phone);
    const slug = normalizeSlug(opts.slug || ctx.slug);
    const ret = safeUrl(opts.returnUrl || window.location.href, window.location.href);

    if (module) u.searchParams.set("module", module);
    if (phone) u.searchParams.set("phone", phone);
    if (slug) u.searchParams.set("slug", slug);
    if (ret) u.searchParams.set("return", ret);

    if (!u.searchParams.get("source")) {
      u.searchParams.set("source", "digiy-guard");
    }

    return u.toString();
  }

  async function goPay(opts = {}) {
    const ctx = opts.ctx || (await resolveContext());
    const url = buildPayUrl({ ...opts, ctx });

    if (opts.newTab === true) {
      window.open(url, "_blank", "noopener,noreferrer");
      return url;
    }

    window.location.href = url;
    return url;
  }

  async function resolveContext() {
    const urlPhone = normalizePhone(qs("phone"));
    const urlSlug = normalizeSlug(qs("slug"));
    const urlModule = normalizeModule(qs("module"));

    const session = loadSession();
    const inferredModule = normalizeModule(
      CFG.module || inferModule() || urlModule || session?.module
    );

    let phone = urlPhone || session?.phone || "";
    let slug = urlSlug || session?.slug || "";
    let source = urlPhone || urlSlug ? "url" : (session ? "session" : "none");

    if (!phone && slug) {
      try {
        const row = await resolvePhoneFromSlug(slug, inferredModule);
        if (row?.phone) {
          phone = row.phone;
          slug = row.slug || slug;
          source = "slug";
        }
      } catch (err) {
        console.warn("[DIGIY_GUARD] resolvePhoneFromSlug error:", err);
      }
    }

    let access = false;
    if (phone && inferredModule) {
      try {
        access = await checkAccess(phone, inferredModule);
      } catch (err) {
        console.warn("[DIGIY_GUARD] checkAccess error:", err);
      }
    }

    const ctx = {
      ok: !!(phone && inferredModule),
      access,
      phone,
      phone_display: displayPhone(phone),
      slug,
      module: inferredModule,
      source,
      has_session: !!session,
      version: VERSION
    };

    if (ctx.phone || ctx.slug || ctx.module) {
      saveSession({
        phone: ctx.phone,
        slug: ctx.slug,
        module: ctx.module,
        access: ctx.access,
        source: ctx.source
      });
    }

    return ctx;
  }

  async function requireAccess(opts = {}) {
    const ctx = opts.ctx || (await resolveContext());

    if (ctx.access) return ctx;

    if (opts.redirect === true) {
      await goPay({
        ctx,
        returnUrl: opts.returnUrl || window.location.href,
        payUrl: opts.payUrl || CFG.payUrl,
        newTab: opts.newTab === true
      });
    }

    const err = new Error("NO_ACCESS");
    err.code = "NO_ACCESS";
    err.ctx = ctx;
    throw err;
  }

  async function logout() {
    clearSession();
    try {
      await getClient().auth.signOut();
    } catch (_) {}
  }

  function isLoggedIn() {
    return !!loadSession();
  }

  function setSession(payload) {
    return saveSession(payload);
  }

  const API = {
    version: VERSION,

    get sb() {
      return getClient();
    },

    ready: null,
    session: null,

    normalizePhone,
    normalizeSlug,
    normalizeModule,
    displayPhone,

    loadSession,
    setSession,
    clearSession,
    isLoggedIn,
    logout,

    getClient,
    resolve: resolveContext,
    resolvePhoneFromSlug,
    checkAccess,
    requireAccess,
    buildPayUrl,
    goPay
  };

  API.ready = resolveContext()
    .then((ctx) => {
      API.session = ctx;
      return ctx;
    })
    .catch((err) => {
      console.error("[DIGIY_GUARD] boot error:", err);
      const fallback = {
        ok: false,
        access: false,
        phone: "",
        phone_display: "",
        slug: "",
        module: normalizeModule(CFG.module || inferModule()),
        source: "error",
        has_session: false,
        version: VERSION,
        error: String(err?.message || err)
      };
      API.session = fallback;
      return fallback;
    });

  window.DIGIY_GUARD = API;
})();
