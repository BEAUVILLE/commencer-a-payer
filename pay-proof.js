// pay-proof.js (REST upload direct -> Supabase Storage)
// + Enregistrement Cockpit (digiy_pay_orders)
// + Phone + Slug obligatoires
// + Redirect vers wait.html après upload

(function(){
  "use strict";

  const SUPPORT_WA = "+221771342889";
  const BUCKET = "pay-proofs";
  const PUBLIC_FOLDER = "public";
  const MAX_MB = 8;

  // ✅ Où se trouve la page d'attente (ajuste selon ton arborescence)
  // Exemple si tu poses wait.html dans /abos/
  const WAIT_PAGE = "/abos/wait.html";

  const $ = (id) => document.getElementById(id);

  function setMsg(text, ok){
    const el = $("payMsg");
    if(!el) return;
    el.textContent = text;
    el.style.color = ok ? "#22c55e" : "#ef4444";
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
    // garde chiffres seulement
    const digits = v.replace(/[^\d]/g, "");
    // accepte 9 à 15 digits (SN = 12 souvent: 221 + 9 digits)
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

  function getOrder(){
    try{
      const fn = window.DIGIY_PAY_STATE?.getOrder;
      if(typeof fn === "function") return fn() || {};
    }catch(_){}
    return {};
  }

  function buildWaMessage(order, proofPath, orderId){
    const code = order.code || "";
    const plan = order.plan || "";
    const amount = order.amount || 0;
    const phone = order.phone || "";
    const slug = order.slug || "";

    let msg = "DIGIY — Preuve paiement Wave (UPLOAD)\n\n";
    msg += "Bénéficiaire: JB BEAUVILLE\n";
    msg += "Support: " + SUPPORT_WA + "\n\n";
    if(phone) msg += "Téléphone client: " + phone + "\n";
    if(code)  msg += "Code menu: " + code + "\n";
    if(plan)  msg += "Plan/Module: " + plan + "\n";
    if(amount) msg += "Montant: " + amount + " FCFA\n";
    if(slug)  msg += "Slug: " + slug + "\n";
    if(orderId) msg += "Order ID: " + orderId + "\n";
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

  async function createCockpitOrder({ url, key, order, proofPath }){
    const payload = {
      phone: order.phone || null,
      code: order.code || null,
      plan: order.plan || null,
      amount: order.amount || null,
      slug: order.slug || null,
      proof_path: proofPath,
      status: "pending"
    };

    // ✅ On veut récupérer l'id -> return=representation
    const res = await fetch(url + "/rest/v1/digiy_pay_orders?select=id", {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if(!res.ok){
      let msg = text;
      try{
        const j = JSON.parse(text);
        msg = j?.message || j?.hint || j?.details || j?.error || text;
      }catch(_){}
      throw new Error(`Cockpit: insert refusé (${res.status}) : ${msg}`);
    }

    // Response = array de lignes
    try{
      const arr = JSON.parse(text);
      return arr?.[0]?.id || null;
    }catch(_){
      return null;
    }
  }

  function getPhoneAndSlugFallback(order){
    // 1) depuis order
    let phone = normalizePhone(order.phone);
    let slug = normalizeSlug(order.slug);

    // 2) fallback inputs UI si présents
    if(!phone){
      const v = $("payPhone")?.value || $("phone")?.value || "";
      phone = normalizePhone(v);
    }
    if(!slug){
      const v = $("paySlug")?.value || $("slug")?.value || "";
      slug = normalizeSlug(v);
    }

    return { phone, slug };
  }

  function redirectToWait({ phone, module, slug, orderId }){
    const q = new URLSearchParams();
    q.set("phone", phone);
    q.set("module", module);
    q.set("slug", slug);
    if(orderId) q.set("order_id", orderId);

    location.href = WAIT_PAGE + "?" + q.toString();
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

      // ✅ Phone + slug obligatoires (pour routing & abo auto)
      const { phone, slug } = getPhoneAndSlugFallback(order);
      if(!phone) throw new Error("Téléphone obligatoire (ex: 221771234567).");
      if(!slug || slug.length < 3) throw new Error("Slug obligatoire (au moins 3 caractères).");

      // injecte dans order pour enregistrement
      order.phone = phone;
      order.slug = slug;

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

      // 2) Insert cockpit
      const orderId = await createCockpitOrder({ url, key, order, proofPath });

      window.DIGIY_LAST_PROOF_PATH = proofPath;

      const hint = $("manualHint");
      if(hint) hint.textContent = "Preuve envoyée (path): " + proofPath;

      setMsg("✅ Upload OK. Validation en cours…", true);

      // 3) WhatsApp admin
      const msg = buildWaMessage(order, proofPath, orderId);
      wa(msg);

      if(fileInput) fileInput.value = "";

      // 4) Redirect vers attente validation (auto)
      // Petit délai pour laisser WhatsApp s’ouvrir si besoin
      setTimeout(()=>{
        redirectToWait({ phone, module: String(order.plan).toUpperCase(), slug, orderId });
      }, 900);

    }catch(e){
      console.error(e);
      setMsg("❌ " + (e?.message || "Erreur"), false);
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const btn = $("btnSendProof");
    if(btn) btn.addEventListener("click", uploadAndPrepare);
  });

})();
