(function(){
"use strict";

const SUPABASE_URL = "https://wesqmwjjtsefyjnluosj.supabase.co";
const SUPABASE_ANON_KEY =
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indlc3Ftd2pqdHNlZnlqbmx1b3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxNzg4ODIsImV4cCI6MjA4MDc1NDg4Mn0.dZfYOc2iL2_wRYL3zExZFsFSBK6AbMeOid2LrIjcTdA";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const KEY="DIGIY_PAY_SESSION";
const TTL=8*60*60*1000;

function load(){
 try{
  const s=JSON.parse(localStorage.getItem(KEY));
  if(!s) return null;
  if(Date.now()-s.ts>TTL) return null;
  return s;
 }catch(e){return null;}
}

function save(p){
 const s={...p,ts:Date.now()};
 localStorage.setItem(KEY,JSON.stringify(s));
 return s;
}

function clear(){localStorage.removeItem(KEY);}

window.DIGIY_GUARD={
 sb,
 requireSession(){
  const s=load();
  if(!s) throw new Error("NO_SESSION");
  return s;
 },
 setSession:save,
 logout(){
  clear();
  sb.auth.signOut();
 }
};

})();
