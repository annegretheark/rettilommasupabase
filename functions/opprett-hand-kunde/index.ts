import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

async function requireAdmin(req: Request, admin: any): Promise<{ id: string; email: string }> {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Mangler innlogget bruker-token.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Ugyldig eller utløpt innlogging.");
  const id = String(data.user.id);
  const email = String(data.user.email || "").trim().toLowerCase();
  const roles = ["admin","administrator","eier","owner","firmaadmin","sysadm","sysadmin","systemadmin"];
  const [{ data: a }, { data: f }, { data: s }] = await Promise.all([
    admin.from("hand_ansatt").select("rolle,aktiv").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_firma_bruker").select("rolle").eq("user_id", id).limit(1).maybeSingle(),
    admin.from("hand_sysadm").select("aktiv").ilike("epost", email).eq("aktiv", true).limit(1).maybeSingle(),
  ]);
  const role = String(a?.rolle || f?.rolle || "").toLowerCase();
  if (!s && (a?.aktiv === false || !roles.includes(role))) throw new Error("Kun administrator kan utføre handlingen.");
  return { id, email };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:CORS });
  if (req.method !== "POST") return Response.json({ok:false,error:"Bruk POST."},{status:405,headers:CORS});
  let createdId = "";
  try {
    const url=Deno.env.get("SUPABASE_URL")||"";
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!url||!key) throw new Error("Mangler Supabase-secrets.");
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    await requireAdmin(req,admin);
    const body=await req.json().catch(()=>({}));
    const epost=String(body.epost||"").trim().toLowerCase();
    const passord=String(body.passord||"");
    const navn=String(body.navn||"").trim();
    const firma_id=String(body.firma_id||"").trim();
    const rolle=String(body.rolle||"admin").trim().toLowerCase();
    if(!epost.includes("@")||!navn||!firma_id) throw new Error("Mangler gyldig e-post, navn eller firma_id.");
    if(passord.length<10) throw new Error("Passord må ha minst 10 tegn.");
    const {data:authUser,error:authError}=await admin.auth.admin.createUser({email:epost,password:passord,email_confirm:false});
    if(authError||!authUser.user) throw authError||new Error("Bruker ble ikke opprettet.");
    createdId=authUser.user.id;
    const {error:rowError}=await admin.from("hand_ansatt").insert({user_id:createdId,navn,epost,rolle,firma_id,aktiv:true,ma_bytte_passord:true});
    if(rowError){ await admin.auth.admin.deleteUser(createdId); throw rowError; }
    return Response.json({ok:true,user_id:createdId},{headers:CORS});
  } catch(e){
    const msg=e instanceof Error?e.message:String(e);
    return Response.json({ok:false,error:msg},{status:/Kun administrator|token|innlogging/i.test(msg)?403:400,headers:CORS});
  }
});
