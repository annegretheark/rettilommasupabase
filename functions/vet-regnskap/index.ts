import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const clean=(v:unknown)=>String(v??"").trim();
async function read(res:Response){const t=await res.text();try{return t?JSON.parse(t):null}catch{return {raw:t}}}

const url=Deno.env.get("SUPABASE_URL")!;
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

async function authorize(req:Request,clinicId:string){
  const bearer=clean(req.headers.get("Authorization")).replace(/^Bearer\s+/i,"");
  if(!bearer)throw {status:401,message:"Mangler innlogging"};
  const {data,error}=await admin.auth.getUser(bearer);if(error||!data.user)throw {status:401,message:"Ugyldig innlogging"};
  const email=clean(data.user.email).toLowerCase();
  let roleQuery=admin.from("vet_klinikk_brukere").select("rolle,klinikk_id,aktiv").eq("aktiv",true);
  roleQuery=email?roleQuery.or(`auth_user_id.eq.${data.user.id},epost.eq.${email}`):roleQuery.eq("auth_user_id",data.user.id);
  const {data:rows,error:roleError}=await roleQuery;
  if(roleError)throw {status:403,message:"Kunne ikke kontrollere rolle"};
  const ok=(rows||[]).some((r:any)=>{const role=clean(r.rolle).toLowerCase().replace(/[\s_-]+/g,"");const system=["systemadmin","systemadministrator","sysadmin"].includes(role),clinicAdmin=["admin","klinikkadmin","klinikkadministrator","klinikkadm","kjedeadmin","kjedeadministrator","konsernadmin","konsernadministrator","chainadmin"].includes(role);return system||(clinicAdmin&&String(r.klinikk_id)===String(clinicId));});
  if(!ok)throw {status:403,message:"Bare admin kan administrere integrasjoner"};return data.user;
}

async function tripletexSession(secret:any){
  const base=secret.environment==="test"?"https://api-test.tripletex.tech/v2":"https://tripletex.no/v2";
  const u=new URL(base+"/token/session/:create");u.searchParams.set("consumerToken",secret.consumer_token);u.searchParams.set("employeeToken",secret.employee_token);u.searchParams.set("expirationDate",new Date(Date.now()+86400000).toISOString().slice(0,10));
  const res=await fetch(u,{method:"PUT",headers:{Accept:"application/json"}}),body=await read(res);if(!res.ok||!body?.value?.token)throw {status:502,message:"Tripletex avviste tokenene",details:body};return {base,token:body.value.token};
}
async function tx(base:string,token:string,path:string,init:RequestInit={}){const res=await fetch(base+path,{...init,headers:{Authorization:"Basic "+btoa("0:"+token),Accept:"application/json","Content-Type":"application/json",...(init.headers||{})}}),body=await read(res);if(!res.ok)throw {status:502,message:"Tripletex-kallet feilet",details:body};return body;}
async function testProvider(provider:string,secret:any){
  if(provider==="tripletex"){const s=await tripletexSession(secret);await tx(s.base,s.token,"/token/session/>whoAmI");return true;}
  if(provider==="fiken"){const res=await fetch("https://api.fiken.no/api/v2/companies",{headers:{Authorization:"Bearer "+secret.api_token,Accept:"application/json"}}),body=await read(res);if(!res.ok)throw {status:502,message:"Fiken avviste API-tokenet",details:body};const companies=Array.isArray(body)?body:body?._embedded?.companies||[];if(secret.company_slug&&!companies.some((x:any)=>clean(x.slug)===clean(secret.company_slug)))throw {status:400,message:"Fant ikke valgt firma i Fiken"};return true;}
  if(provider==="poweroffice"){
    const appKey=Deno.env.get(secret.environment==="test"?"POWEROFFICE_DEMO_APPLICATION_KEY":"POWEROFFICE_APPLICATION_KEY");if(!appKey)throw {status:503,message:"Rett i Lomma mangler applikasjonsnøkkel fra PowerOffice"};
    const endpoint=secret.environment==="test"?"https://goapi.poweroffice.net/Demo/OAuth/Token":"https://goapi.poweroffice.net/OAuth/Token";
    const res=await fetch(endpoint,{method:"POST",headers:{Authorization:"Basic "+btoa(appKey+":"+secret.client_key),"Ocp-Apim-Subscription-Key":secret.subscription_key,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"}),body=await read(res);if(!res.ok||!body?.access_token)throw {status:502,message:"PowerOffice avviste nøklene",details:body};return true;
  }
  throw {status:400,message:"Ukjent leverandør"};
}
async function getSecret(clinicId:string,provider:string){const {data,error}=await admin.from("vet_integrasjon_hemmeligheter").select("hemmelighet").eq("klinikk_id",clinicId).eq("leverandor",provider).maybeSingle();if(error)throw error;return data?.hemmelighet||null;}
async function log(clinicId:string,provider:string,action:string,status:string,message:string,ref?:string,external?:string,details?:unknown){await admin.from("vet_integrasjon_logg").insert({klinikk_id:clinicId,integrasjonstype:"regnskap",leverandor:provider,handling:action,status,referanse:ref||null,ekstern_referanse:external||null,melding:message,detaljer:details||{}});}

async function sendTripletex(secret:any,payload:any){
  const s=await tripletexSession(secret),customer=payload.kunde||{},email=clean(customer.epost),org=clean(customer.organisasjonsnummer).replace(/\D/g,""),name=clean(customer.navn);if(!name)throw {status:400,message:"Kunden mangler navn"};
  const search=new URLSearchParams({count:"100",fields:"id,name,email,phoneNumber,organizationNumber,postalAddress"});if(org)search.set("organizationNumber",org);else if(email)search.set("email",email);else search.set("name",name);
  const found=await tx(s.base,s.token,"/customer?"+search),values=found?.values||[];let cust=values.find((x:any)=>email?clean(x.email).toLowerCase()===email.toLowerCase():clean(x.name).toLowerCase()===name.toLowerCase());
  if(!cust){const rawAddress=clean(customer.adresse),match=rawAddress.match(/^(.*?)[,\s]+(\d{4})\s+(.+)$/),postalAddress=rawAddress?{addressLine1:match?clean(match[1]):rawAddress,postalCode:match?.[2]||undefined,city:match?clean(match[3]):undefined}:undefined;const created=await tx(s.base,s.token,"/customer",{method:"POST",body:JSON.stringify({name,isCustomer:true,email:email||undefined,phoneNumber:clean(customer.telefon)||undefined,organizationNumber:org||undefined,invoiceSendMethod:payload.send_ehf&&org?"EHF":undefined,singleCustomerInvoice:payload.send_ehf&&org?false:undefined,postalAddress})});cust=created?.value||created;}
  const vatTypeId=Number(Deno.env.get("TRIPLETEX_VAT_TYPE_ID")||3),date=clean(payload.dato)||new Date().toISOString().slice(0,10),due=clean(payload.forfallsdato)||date;
  const orderLines=(payload.linjer||[]).map((l:any)=>({description:clean(l.tekst)||"Veterinærbehandling",count:Number(l.antall||1),unitPriceExcludingVatCurrency:Number(l.pris??l.sum??0),vatType:{id:vatTypeId}}));
  if(!orderLines.length)orderLines.push({description:"Veterinærbehandling",count:1,unitPriceExcludingVatCurrency:Number(payload.eks_mva||0),vatType:{id:vatTypeId}});
  const createdOrder=await tx(s.base,s.token,"/order",{method:"POST",body:JSON.stringify({customer:{id:Number(cust.id)},orderDate:date,deliveryDate:date,orderLines})}),order=createdOrder?.value||createdOrder;
  const createdInvoice=await tx(s.base,s.token,"/invoice",{method:"POST",body:JSON.stringify({invoiceDate:date,invoiceDueDate:due,orders:[{id:Number(order.id)}]})}),invoice=createdInvoice?.value||createdInvoice;
  let ehfSent=false;if(payload.send_ehf&&org){if(!Number(invoice.id))throw {status:502,message:"Kan ikke sende EHF fordi Tripletex ikke returnerte faktura-ID"};await tx(s.base,s.token,`/invoice/${Number(invoice.id)}/:send?sendType=EHF`,{method:"PUT"});ehfSent=true;}
  return {customer:cust,order,invoice,ehf_sent:ehfSent,external_reference:clean(invoice.invoiceNumber||invoice.id)};
}

serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return reply({ok:false,error:"Kun POST er tillatt"},405);
  try{
    const body=await req.json(),clinicId=clean(body.klinikk_id),provider=clean(body.provider).toLowerCase();if(!clinicId||!provider)throw {status:400,message:"Klinikk og leverandør må oppgis"};await authorize(req,clinicId);
    if(body.action==="configure"){
      const input=body.credentials||{},secret:any={environment:body.environment==="test"?"test":"production"};
      if(provider==="tripletex"){secret.consumer_token=clean(input.consumer_token);secret.employee_token=clean(input.employee_token);}
      if(provider==="fiken"){secret.api_token=clean(input.api_token);secret.company_slug=clean(input.company_slug);}
      if(provider==="poweroffice"){secret.client_key=clean(input.client_key);secret.subscription_key=clean(input.subscription_key);}
      if(Object.values(secret).some(v=>v===""))throw {status:400,message:"Alle tilgangsfeltene må fylles ut"};await testProvider(provider,secret);
      const {error}=await admin.from("vet_integrasjon_hemmeligheter").upsert({klinikk_id:clinicId,leverandor:provider,hemmelighet:secret,oppdatert_at:new Date().toISOString()},{onConflict:"klinikk_id,leverandor"});if(error)throw error;
      await admin.from("vet_integrasjoner").upsert({klinikk_id:clinicId,integrasjonstype:"regnskap",leverandor:provider,tilkoblet:true,aktiv:true,sist_kontrollert_at:new Date().toISOString(),oppdatert_at:new Date().toISOString()},{onConflict:"klinikk_id,integrasjonstype"});await log(clinicId,provider,"configure","ok","Tilkoblingen ble kontrollert og lagret.");return reply({ok:true,connected:true,message:"Tilkoblingen er kontrollert og lagret."});
    }
    const secret=await getSecret(clinicId,provider);if(!secret)return reply({ok:true,connected:false,message:"Leverandørtilgang er ikke lagret."});
    if(body.action==="status"){await testProvider(provider,secret);await admin.from("vet_integrasjoner").update({tilkoblet:true,sist_kontrollert_at:new Date().toISOString()}).eq("klinikk_id",clinicId).eq("integrasjonstype","regnskap");return reply({ok:true,connected:true,message:"Tilkoblingen virker."});}
    if(body.action==="send_invoice"){
      if(provider!=="tripletex")throw {status:501,message:"Automatisk fakturaoverføring er foreløpig aktivert for Tripletex. Bruk CSV-eksport for valgt leverandør."};
      try{const result=await sendTripletex(secret,body.invoice||{});await log(clinicId,provider,"send_invoice","ok","Faktura overført til Tripletex.",body.invoice?.fakturanr,result.external_reference,result);const sync={regnskap_leverandor:provider,ekstern_faktura_id:result.external_reference||null,regnskap_status:"overfort",regnskap_synkronisert_at:new Date().toISOString()};await admin.from("fakturaer").update(sync).eq("fakturanr",body.invoice?.fakturanr);await admin.from("vet_journal").update(sync).eq("klinikk_id",clinicId).eq("fakturanr",body.invoice?.fakturanr);await admin.from("vet_integrasjoner").update({sist_synkronisert_at:new Date().toISOString()}).eq("klinikk_id",clinicId).eq("integrasjonstype","regnskap");return reply({ok:true,...result});}
      catch(e:any){await log(clinicId,provider,"send_invoice","feilet",e?.message||"Overføring feilet",body.invoice?.fakturanr,undefined,e?.details);throw e;}
    }
    throw {status:400,message:"Ukjent handling"};
  }catch(e:any){return reply({ok:false,error:e?.message||"Regnskapskallet feilet",details:e?.details||null},Number(e?.status)||500);}
});
