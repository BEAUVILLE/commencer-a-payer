// pay-proof.js (REST upload direct -> Supabase Storage)
// Objectif: éviter supabase-js Storage qui déclenche "Invalid Compact JWS"
// Requis: window.DIGIY_SUPABASE_URL + window.DIGIY_SUPABASE_ANON_KEY (dans index.html)
// Optionnel: window.DIGIY_PAY_STATE.getOrder()

(function(){
  "use strict";

  const SUPPORT_WA = "+221771342889";
  const BUCKET = "digiy-proofs";
  const PUBLIC_FOLDER = "public";
  const MAX_MB = 8;

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

  function getOrder(){
    try{
      const fn = window.DIGIY_PAY_STATE?.getOrder;
      if(typeof fn === "function") return fn() || {};
    }catch(_){}
    return {};
  }

  function buildWaMessage(order, proofPath){
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
    if(plan)  msg += "Plan: " + plan + "\n";
    if(amount) msg += "Montant: " + amount + " FCFA\n";
    if(slug)  msg += "Slug: " + slug + "\n";
    msg += "\nPreuve (Storage path):\n" + proofPath + "\n\n";
    msg += "Merci de valider & activer. — DIGIY";
    return msg;
  }

  function requireSupabaseEnv(){
    const url = (window.DIGIY_SUPABASE_URL || "").trim();
    const key = (window.DIGIY_SUPABASE_ANON_KEY || "").trim();

    if(!url) throw new Error("SUPABASE_URL manquant (window.DIGIY_SUPABASE_URL)");
    if(!key) throw new Error("ANON KEY manquante (window.DIGIY_SUPABASE_ANON_KEY)");

    // mini check JWT: 3 segments
    const parts = key.split(".");
    if(parts.length !== 3) throw new Error("ANON KEY invalide (JWT doit avoir 3 parties)");

    return { url, key };
  }

  async function uploadStorageREST({ url, key, bucket, path, file }){
    // Endpoint Supabase Storage
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
      // Supabase renvoie souvent du JSON, mais parfois non
      let msg = text;
      try{
        const j = JSON.parse(text);
        msg = j?.message || j?.error || text;
      }catch(_){}
      throw new Error(`Upload refusé (${res.status}) : ${msg}`);
    }

    // succès : souvent JSON avec {Key: "..."} selon versions
    try{ return JSON.parse(text); } catch(_){ return { ok:true, raw:text }; }
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
      if(!order.amount || !order.plan){
        throw new Error("Choisis un code dans la grille avant l’upload.");
      }

      const ext = safeName(file.name).split(".").pop() || "jpg";
      const proofPath = `${PUBLIC_FOLDER}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      setMsg("⏳ Upload en cours…", false);

      await uploadStorageREST({
        url,
        key,
        bucket: BUCKET,
        path: proofPath,
        file
      });

      window.DIGIY_LAST_PROOF_PATH = proofPath;

      const hint = $("manualHint");
      if(hint) hint.textContent = "Preuve envoyée (path): " + proofPath;

      setMsg("✅ Upload OK. Clique WhatsApp pour valider.", true);

      // Auto WhatsApp (par défaut: oui)
      const msg = buildWaMessage(order, proofPath);
      wa(msg);

      if(fileInput) fileInput.value = "";

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
