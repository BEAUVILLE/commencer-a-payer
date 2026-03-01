// pay-proof.js (REST upload direct -> Supabase Storage)
// + Enregistrement Cockpit (subscription_payments) via RPC digiy_pay_create_payment (RLS safe)
// + Phone obligatoire
// + Slug optionnel -> auto-généré si vide (driver-xxxxxxxx)
// + Focus + blocage avant upload
// + WhatsApp admin + Redirect vers wait.html après upload

(function(){
  "use strict";

  const SUPPORT_WA = "+221771342889";
  const BUCKET = "pay-proofs";
  const PUBLIC_FOLDER = "proofs";
  const MAX_MB = 8;

  // ✅ Où se trouve la page d'attente
  const WAIT_PAGE = "./wait.html";
  const $ = (id) => document.getElementById(id);

  function setMsg(text, ok){
    const el = $("payMsg");
    if(!el) return;
    el.textContent = text;
    el.style.color = ok ? "#22c55e" : "#ef4444";
  }

  function focusField(el){
    try{
      if(!el) return;
      el.scrollIntoView({ behavior:"smooth", block:"center" });
      el.focus({ preventScroll:true });
      el.style.outline = "2px solid rgba(239,68,68,.8)";
      setTimeout(()=>{ el.style.outline = ""; }, 900);
    }catch(_){}
  }

  function wa(msg){
    const num = SUPPORT_WA.replace(/\+/g,"");
    location.href = "https://wa.me/" + num + "?text=" + encodeURIComponent(msg);
  }

  function safeName(name){
    return String(name || "proof")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]/g, "");
  }

  function normalizePhone(raw){
    const v = String(raw || "").trim();
    const digits = v.replace(/[^\d]/g, "");
    if(digits.length < 9) return "";
    return digits;
  }

  function normalizeSlug(raw){
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function genSlug(prefix){
    const p = normalizeSlug(prefix || "driver") || "driver";
    const rand = Math.random().toString(16).slice(2, 10);
    return `${p}-${rand}`;
  }

  function getOrder(){
    try{
      const fn = window.DIGIY_PAY_STATE?.getOrder;
      if(typeof fn === "function") return fn() || {};
    }catch(_){}
    return {};
  }

  function buildReference(){
    return "DIGIY-" + Math.random().toString(16).slice(2, 10).toUpperCase();
  }

  function buildWaMessage(order, proofPath, paymentId, reference){
    const code   = order.code || "";
    const plan   = order.plan || "";
    const amount = order.amount || 0;
    const phone  = order.phone || "";
    const slug   = order.slug || "";

    const boostCode = order.boost_code || order.boostCode || "";
    const boostAmt  = order.boost_amount_xof || order.boostAmount || 0;

    let msg = "DIGIY — Preuve paiement Wave (UPLOAD)\n\n";
    msg += "Bénéficiaire: JB BEAUVILLE\n";
    msg += "Support: " + SUPPORT_WA + "\n\n";
    if(phone) msg += "Téléphone client: " + phone + "\n";
    if(code)  msg += "Code menu: " + code + "\n";
    if(plan)  msg += "Plan/Module: " + plan + "\n";
    if(amount) msg += "Montant TOTAL: " + amount + " FCFA\n";
    if(boostCode) msg += "BOOST: " + boostCode + " (" + (boostAmt||0) + " FCFA)\n";
    if(slug)  msg += "Slug: " + slug + "\n";
    if(reference) msg += "Reference: " + reference + "\n";
    if(paymentId) msg += "Payment ID: " + paymentId + "\n";
    msg += "\nPreuve (Storage path):\n" + proofPath + "\n\n";
    msg += "Merci de valider & activer. — DIGIY";
    return msg;
  }

  function requireSupabaseEnv(){
    const url = (window.DIGIY_SUPABASE_URL || "").trim();
    const key = (window.DIGIY_SUPABASE_ANON_KEY || "").trim();

    if(!url) throw new Error("SUPABASE_URL manquant (window.DIGIY_SUPABASE_URL)");
    if(!key) throw new Error("ANON KEY manquante (window.DIGIY_SUPABASE_ANON_KEY)");

    const parts = key.split(".");
    if(parts.length !== 3) throw new Error("ANON KEY invalide (JWT doit avoir 3 parties)");

    return { url, key };
  }

  async function uploadStorageREST({ url, key, bucket, path, file }){
    const endpoint = `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "apikey": key,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: file
    });

    const text = await res.text();
    if(!res.ok){
      let msg = text;
      try{
        const j = JSON.parse(text);
        msg = j?.message || j?.error || text;
      }catch(_){}
      throw new Error(`Upload refusé (${res.status}) : ${msg}`);
    }

    try{ return JSON.parse(text); } catch(_){ return { ok:true, raw:text }; }
  }

  function getPhoneAndSlugFallback(order){
    let phone = normalizePhone(order.phone);
    let slug = normalizeSlug(order.slug);

    const phoneEl = $("payPhone") || $("phone");
    const slugEl  = $("paySlug")  || $("slug");

    if(!phone){
      phone = normalizePhone(phoneEl?.value || "");
    }
    if(!slug){
      slug = normalizeSlug(slugEl?.value || "");
    }

    return { phone, slug, phoneEl, slugEl };
  }

  function setSlugToUI(slug, slugEl){
    try{
      if(slugEl) slugEl.value = slug;
      const out = $("slugAuto") || $("paySlugAuto");
      if(out) out.textContent = "Slug auto : " + slug;
    }catch(_){}
  }

  function redirectToWait({ phone, module, slug, reference }){
    const q = new URLSearchParams();
    q.set("phone", phone);
    q.set("module", module);
    q.set("slug", slug);
    if(reference) q.set("ref", reference);
    location.href = WAIT_PAGE + "?" + q.toString();
  }

  // ✅ INSERT payment via RPC (RLS safe)
  async function createSubscriptionPaymentRPC({ order, proofPath }){
    if(!window.sb || typeof window.sb.rpc !== "function"){
      throw new Error("Supabase client (window.sb) introuvable. Vérifie supabase-js.");
    }

    const reference = buildReference();

    const module = String(order.module || order.plan || "").trim().toUpperCase();
    const plan   = String(order.plan || "").trim();

    const boost_code = String(order.boost_code || order.boostCode || "").trim() || null;
    const boost_amount_xof = Number(order.boost_amount_xof || order.boostAmount || 0) || 0;

    const payload = {
      p_city: order.city || null,
      p_amount: Number(order.amount || 0) || null,          // TOTAL
      p_pro_name: order.pro_name || order.proName || null,
      p_pro_phone: order.phone || null,                     // digits
      p_reference: reference,
      p_module: module || null,
      p_plan: plan || null,
      p_boost_code: boost_code,
      p_boost_amount_xof: boost_amount_xof,
      p_slug: order.slug || null,
      p_meta: {
        code: order.code || null,
        slug: order.slug || null,
        module: module || null,
        plan: plan || null,
        boost_code,
        boost_amount_xof: boost_code ? boost_amount_xof : 0,
        amount_total: Number(order.amount || 0) || 0,
        proof_path: proofPath,
        ts: new Date().toISOString()
      }
    };

    const { data, error } = await window.sb.rpc("digiy_pay_create_payment", payload);
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.error || "payment_insert_failed");

    return { id: data.id || null, reference: data.reference || reference };
  }

  async function uploadAndPrepare(){
    try{
      const { url, key } = requireSupabaseEnv();

      const fileInput = $("proofFile");
      const file = fileInput?.files?.[0];
      if(!file) throw new Error("Sélectionne la capture Wave");

      if(!/^image\//.test(file.type)) throw new Error("Image uniquement (jpg/png)");
      if(file.size > MAX_MB * 1024 * 1024) throw new Error(`Fichier trop lourd (max ${MAX_MB}MB)`);

      const order = getOrder();

      // plan & amount obligatoires
      if(!order.amount || !order.plan){
        throw new Error("Choisis un code dans la grille avant l’upload.");
      }

      // ✅ phone obligatoire + slug auto si vide
      const { phone, slug, phoneEl, slugEl } = getPhoneAndSlugFallback(order);

      if(!phone){
        setMsg("❌ Téléphone obligatoire (ex: 221771234567).", false);
        focusField(phoneEl);
        throw new Error("Téléphone obligatoire (ex: 221771234567).");
      }

      let finalSlug = slug;
      if(!finalSlug || finalSlug.length < 3){
        const base = String(order.plan || "driver").toLowerCase();
        finalSlug = genSlug(base);
        setSlugToUI(finalSlug, slugEl);
      }

      // injecte dans order pour enregistrement
      order.phone = phone;
      order.slug = finalSlug;

      // ✅ module optionnel (par défaut = plan)
      if(!order.module) order.module = String(order.plan || "").toUpperCase();

      const ext = safeName(file.name).split(".").pop() || "jpg";
      const proofPath = `${PUBLIC_FOLDER}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      setMsg("⏳ Upload en cours…", false);

      // 1) Upload Storage
      await uploadStorageREST({
        url,
        key,
        bucket: BUCKET,
        path: proofPath,
        file
      });

      // 2) Insert subscription_payments (cockpit) via RPC (RLS safe)
      const payment = await createSubscriptionPaymentRPC({ order, proofPath });

      window.DIGIY_LAST_PROOF_PATH = proofPath;
      window.DIGIY_LAST_PAYMENT_REFERENCE = payment?.reference || null;

      const hint = $("manualHint");
      if(hint) hint.textContent = "Preuve envoyée (path): " + proofPath;

      setMsg("✅ Upload OK. Validation en cours…", true);

      // 3) WhatsApp admin
      const msg = buildWaMessage(order, proofPath, payment?.id, payment?.reference);
      wa(msg);

      if(fileInput) fileInput.value = "";

      // 4) Redirect attente validation (auto)
      setTimeout(()=>{
        redirectToWait({
          phone,
          module: String(order.module || order.plan || "").toUpperCase(),
          slug: finalSlug,
          reference: payment?.reference
        });
      }, 900);

    }catch(e){
      console.error(e);
      if(!String(e?.message||"").startsWith("Téléphone obligatoire")){
        setMsg("❌ " + (e?.message || "Erreur"), false);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const btn = $("btnSendProof");
    if(btn) btn.addEventListener("click", uploadAndPrepare);
  });

})();
