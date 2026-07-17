import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const adminRoles=["admin","administrator","eier","firmaadmin"],sysRoles=["sysadm","sysadmin","systemadmin"];
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return out({error:"Bruk POST."},405);
 const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ak=Deno.env.get("SUPABASE_ANON_KEY")||"",token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!url||!sk||!ak||!token)return out({error:"Mangler konfigurasjon eller innlogging."},401);
 const svc=createClient(url,sk,{auth:{persistSession:false}}),uc=createClient(url,ak,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const {data:u,error:ue}=await uc.auth.getUser(token);const email=String(u?.user?.email||"").toLowerCase();if(ue||!email)return out({error:"Ugyldig innlogging."},401);
 const {data:a}=await svc.from("hand_ansatt").select("rolle,aktiv,firma_id").ilike("epost",email).eq("aktiv",true).limit(1).maybeSingle();
 const {data:s}=await svc.from("hand_sysadm").select("id").ilike("epost",email).eq("aktiv",true).limit(1).maybeSingle();
 const role=String(a?.rolle||"").toLowerCase(),isSys=!!s||sysRoles.includes(role),isAdmin=isSys||adminRoles.includes(role);if(!isAdmin)return out({error:"Kun admin eller sysadmin kan se backup."},403);
 const body=await req.json().catch(()=>({}));let requested=String(body?.firma_id||"");if(!isSys)requested=String(a?.firma_id||"");if(!requested&&!isSys)return out({error:"Fant ikke firma."},403);
 const wantAll=isSys&&(requested==="__alle__"||body?.scope==="all"||!requested);if(wantAll)requested="";
 const rows:any[]=[];
 for(const kind of ["auto","manual","pre-restore"]){
  const {data:days}=await svc.storage.from("handverker-backups").list(kind,{limit:100,sortBy:{column:"name",order:"desc"}});
  for(const day of days||[]){if(!day.name)continue;const {data:files}=await svc.storage.from("handverker-backups").list(`${kind}/${day.name}`,{limit:200,sortBy:{column:"name",order:"desc"}});
   for(const f of files||[]){if(!f.name?.endsWith(".json"))continue;const name=f.name;const fileScope=name.includes("-alle-")?"all":name.includes("-firma-")?"firma":"legacy";let fileFirma:string|null=null;const m=name.match(/-firma-(.+)-\d{14}\.json$/);if(m)fileFirma=m[1];
    if(requested && !(fileScope==="all"||fileFirma===requested||fileScope==="legacy"))continue;if(!requested&&fileScope==="firma")continue;
    rows.push({type:kind,path:`${kind}/${day.name}/${name}`,name,created_at:f.created_at||f.updated_at||day.name,size:f.metadata?.size||null,scope:fileScope,firma_id:fileFirma});
   }
  }
 }
 rows.sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at)));return out({ok:true,is_sysadmin:isSys,selected_scope:requested?"firma":"all",firma_id:requested||null,backups:rows.slice(0,300)});
});
