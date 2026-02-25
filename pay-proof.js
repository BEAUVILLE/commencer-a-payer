// pay-proof.js
(function(){
  "use strict";

  function getSupabaseClient(){
    return (
      window.DIGIY_GUARD?.supabase ||
      window.DIGIY_GUARD?.sb ||
      window.supabase ||
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
      if(!sb) throw new Error("Supabase non disponible");

      const { data: u } = await sb.auth.getUser();
      const user = u?.user;
      if(!user) throw new Error("Non connecté");

      const fileInput = document.getElementById("proofFile");
      const file = fileInput?.files?.[0];
      if(!file) throw new Error("Sélectionne une capture Wave");

      if(!/^image\//.test(file.type))
        throw new Error("Image uniquement (jpg/png)");

      if(file.size > 8 * 1024 * 1024)
        throw new Error("Fichier trop lourd (max 8MB)");

      const amount = 12900;
      const session = window.DIGIY_GUARD?.getSession?.() || {};

      const ext = safeName(file.name).split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      setMsg("⏳ Upload en cours...", false);

      // Upload bucket privé
      const up = await sb.storage
        .from("digiy-proofs")
        .upload(path, file, { contentType: file.type, upsert:false });

      if(up.error) throw up.error;

      // Appel RPC
      const { data, error } = await sb.rpc("digiy_driver_submit_payment_proof", {
        p_amount_fcfa: amount,
        p_payer_phone: session.phone || null,
        p_tx_ref: null,
        p_proof_url: path,
        p_note: "Abonnement DRIVER PRO"
      });

      if(error) throw error;

      setMsg("✅ Paiement reçu. Validation en cours frérot.", true);

      fileInput.value = "";

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
