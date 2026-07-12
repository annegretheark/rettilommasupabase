import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return out({error:"Bruk POST."},405);
 const url=Deno.env.get("SUPABASE_URL")||"", serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"", anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!url||!serviceKey||!anon||!token) return out({error:"Mangler konfigurasjon eller innlogging."},401);
 const service=createClient(url,serviceKey,{auth:{persistSession:false}}), userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:u,error:ue}=await userClient.auth.getUser(token); const email=String(u?.user?.email||"").toLowerCase(); if(ue||!email) return out({error:"Ugyldig innlogging."},401);
 const {data:a}=await service.from("hand_ansatt").select("rolle,aktiv,firma_id").ilike("epost",email).eq("aktiv",true).limit(1).maybeSingle();
 const {data:s}=await service.from("hand_sysadm").select("id").ilike("epost",email).eq("aktiv",true).limit(1).maybeSingle();
 const role=String(a?.rolle||"").toLowerCase(), isSys=!!s||["sysadm","sysadmin","systemadmin"].includes(role), isAdmin=isSys||["admin","administrator","eier","firmaadmin"].includes(role);
 if(!isAdmin) return out({error:"Kun admin eller sysadmin kan se backup."},403);
 const body=await req.json().catch(()=>({})); const requested=String(body?.firma_id||"");
 if(!isSys && requested && requested!==String(a?.firma_id||"")) return out({error:"Du kan bare se eget firma."},403);
 const rows:any[]=[];
 for(const kind of ["auto","manual","pre-restore"]){ const {data:days,error}=await service.storage.from("handverker-backups").list(kind,{limit:100,sortBy:{column:"name",order:"desc"}}); if(error && kind==="auto") return out({error:error.message},500); for(const day of days||[]){ if(!day.name) continue; const {data:dayFiles}=await service.storage.from("handverker-backups").list(`${kind}/${day.name}`,{limit:100,sortBy:{column:"name",order:"desc"}}); for(const f of dayFiles||[]){ rows.push({type:kind,path:`${kind}/${day.name}/${f.name}`,name:f.name,created_at:f.created_at||f.updated_at||day.name,size:f.metadata?.size||null}); } } }
 rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 return out({ok:true,is_sysadmin:isSys,firma_id:a?.firma_id||null,backups:rows.slice(0,200)});
});
