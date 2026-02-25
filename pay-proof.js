// pay-proof.js
(function(){
  "use strict";

  function getSupabaseClient(){
    // ✅ IMPORTANT: window.supabase = librairie, PAS le client
    return (
      window.sb ||                       // ✅ client global créé dans index.html : window.sb = createClient(...)
      window.DIGIY_GUARD?.supabase ||     // si un jour tu passes par guard.js ici
      window.DIGIY_GUARD?.sb ||
      null
    );
  }

  function safeName(name){
    return String(name || "proof")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9._-]/g, "");
  }

  function setMsg(text, ok){
    const el = document.getElementById("payMsg");
    if(!el) return;
    el.textContent = text;
    el.style.color = ok ? "#16a34a" : "#f87171";
  }

  async function uploadAndSubmit(){
    try{
      const sb = getSupabaseClient();
      if(!sb) throw new Error("Supabase client introuvable (window.sb)");

      // Auth
      const { data: u, error: ue } = await sb.auth.getUser();
      if(ue) throw ue;
      const user = u?.user;
      if(!user) throw new Error("Non connecté (session absente)");

      // File
      const fileInput = document.getElementById("proofFile");
      const file = fileInput?.files?.[0];
      if(!file) throw new Error("Sélectionne une capture Wave");

      if(!/^image\//.test(file.type))
        throw new Error("Image uniquement (jpg/png)");

      if(file.size > 8 * 1024 * 1024)
        throw new Error("Fichier trop lourd (max 8MB)");

      // Amount (C1: DRIVER PRO fixe pour l’instant)
      const amount = 12900;

      // Phone (si dispo via guard, sinon vide)
      const session = window.DIGIY_GUARD?.getSession?.() || {};
      const payerPhone = session.phone || null;

      // Path storage privé: <user.id>/timestamp-rand.ext
      const ext = safeName(file.name).split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      setMsg("⏳ Upload en cours...", false);

      // Upload bucket privé
      const up = await sb.storage
        .from("digiy-proofs")
        .upload(path, file, { contentType: file.type, upsert:false });

      if(up.error) throw up.error;

      // RPC submit proof
      const { data, error } = await sb.rpc("digiy_driver_submit_payment_proof", {
        p_amount_fcfa: amount,
        p_payer_phone: payerPhone,
        p_tx_ref: null,
        p_proof_url: path,               // ✅ on stocke le PATH (bucket privé)
        p_note: "Abonnement DRIVER PRO"
      });

      if(error) throw error;

      setMsg("✅ Preuve reçue. Validation en cours frérot.", true);
      if(fileInput) fileInput.value = "";

    }catch(e){
      console.error(e);
      setMsg("❌ " + (e.message || "Erreur paiement"), false);
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    const btn = document.getElementById("btnSendProof");
    if(btn) btn.addEventListener("click", uploadAndSubmit);
  });

})();
