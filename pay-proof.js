// pay-proof.js (ANON upload -> Storage privé, folder public/ + WhatsApp)
// Requis dans index.html : window.sb = supabase client
// Optionnel : window.DIGIY_PAY_STATE.getOrder() pour lire plan/montant/code/phone/slug

(function(){
  "use strict";

  const SUPPORT_WA = "+221771342889";
  const BUCKET = "digiy-proofs";
  const PUBLIC_FOLDER = "public";
  const MAX_MB = 8;

  const $ = (id) => document.getElementById(id);

  function getSupabaseClient(){
    return window.sb || null; // ✅ ton client global créé dans index.html
  }

  function safeName(name){
    return String(name || "proof")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]/g, "");
  }

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

  async function uploadAndPrepare(){
    try{
      const sb = getSupabaseClient();
      if(!sb) throw new Error("Supabase client introuvable (window.sb)");

      // file
      const fileInput = $("proofFile");
      const file = fileInput?.files?.[0];
      if(!file) throw new Error("Sélectionne la capture Wave");

      if(!/^image\//.test(file.type))
        throw new Error("Image uniquement (jpg/png)");

      if(file.size > MAX_MB * 1024 * 1024)
        throw new Error(`Fichier trop lourd (max ${MAX_MB}MB)`);

      const order = getOrder();
      if(!order.amount || !order.plan){
        throw new Error("Choisis un code dans la grille avant l’upload.");
      }

      // path ANON: public/<ts>-<rand>.<ext>
      const ext = safeName(file.name).split(".").pop() || "jpg";
      const proofPath = `${PUBLIC_FOLDER}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      setMsg("⏳ Upload en cours…", false);

      const up = await sb.storage
        .from(BUCKET)
        .upload(proofPath, file, { contentType: file.type, upsert:false });

      if(up.error) throw up.error;

      // UI success
      setMsg("✅ Upload OK. Clique WhatsApp pour valider.", true);

      // expose for debug / buttons
      window.DIGIY_LAST_PROOF_PATH = proofPath;

      // show path if element exists
      const hint = $("manualHint");
      if(hint){
        hint.textContent = "Preuve envoyée (path): " + proofPath;
      }

      // auto open whatsapp (option)
      const auto = $("chkAutoWhatsApp");
      const doAuto = auto ? !!auto.checked : true;

      if(doAuto){
        const msg = buildWaMessage(order, proofPath);
        wa(msg);
      }

      if(fileInput) fileInput.value = "";

    }catch(e){
      console.error(e);
      setMsg("❌ " + (e?.message || "Erreur"), false);
    }
  }

  function sendWhatsAppManually(){
    try{
      const proofPath = window.DIGIY_LAST_PROOF_PATH;
      if(!proofPath) throw new Error("Aucune preuve uploadée pour l’instant.");
      const order = getOrder();
      const msg = buildWaMessage(order, proofPath);
      wa(msg);
    }catch(e){
      setMsg("❌ " + (e?.message || "Erreur"), false);
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const btn = $("btnSendProof");
    if(btn) btn.addEventListener("click", uploadAndPrepare);

    const btnWa = $("btnSendProofWA");
    if(btnWa) btnWa.addEventListener("click", sendWhatsAppManually);
  });

})();
