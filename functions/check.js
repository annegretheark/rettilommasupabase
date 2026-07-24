


(function(){
  var key='hov_language', allowed=['nb','sv','en'];
  function current(){var v=localStorage.getItem(key)||'nb';return allowed.indexOf(v)>=0?v:'nb';}
  function sync(){document.querySelectorAll('.hov-lang-select').forEach(function(el){el.value=current();});}
  document.addEventListener('change',function(e){if(e.target&&e.target.classList.contains('hov-lang-select')){var v=e.target.value;if(allowed.indexOf(v)>=0){localStorage.setItem(key,v);location.reload();}}});
  function syncCountry(){var q=document.getElementById('hovCountryQuick');if(q)q.value=(['NO','SE','GB','US'].includes(localStorage.getItem('hov_country_quick'))?localStorage.getItem('hov_country_quick'):'NO');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){sync();syncCountry();});else{sync();syncCountry();}
})();






  // Fallback dersom appen hostes fra et annet nivå enn forventet.
  (function(){
    if(window.supabaseClient || !window.supabase || typeof window.supabase.createClient !== 'function') return;
    const SUPABASE_URL = "https://DITT_SVENSKE_PROJECT_REF.supabase.co";
    const SUPABASE_ANON_KEY = "DIN_SVENSKE_PUBLISHABLE_KEY";
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storage:window.localStorage }
    });
    console.warn('Bruker innebygd Supabase fallback-konfig.');
  })();
  

(function(){
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tr = (s) => window.HOV_I18N?.t?.(String(s)) || String(s);
  const app = { sb:null, session:null, user:null, profile:null, role:'hovslager', isSysadm:false, firma:null, firmaId:null, voiceRecognition:null, voiceActive:false, voiceStopping:false, voiceProcessing:false, lastVoiceJobbId:null, voiceAutoStopTimer:null, edit:{kunde:null,hest:null,jobb:null,pris:null}, data:{kunder:[],hester:[],jobber:[],fakturaer:[],kreditnotaer:[],priser:[],adminFirmaer:[],adminProfiler:[],backupLogg:[],hestBilder:[],jobbBilder:[]}, pendingJobbFiles:[], currentJobbPreview:[] };
  const LOCAL_LOCK_KEY = 'hov_local_lock_v1';
  const REMEMBER_LOGIN_KEY = 'hov_remember_login_v1';
  const COUNTRY_SETTINGS_KEY = 'hov_country_settings_v3';
  window.hovApp = app;
  window.hovAppReadLastJobb = function(){ readLastJobbAsNew(); };
  window.hovAppStartVoiceJobb = function(){ startVoiceNyJobb(); };
  window.hovAppStopVoiceJobb = function(){ stopVoiceJobb(false); };
  window.hovAppUseVoiceTextJobb = function(){ applyVoiceTextAsJobb({autoSave:false}); };

  function msg(id, text, type){ const el=$(id); if(!el) return; el.innerHTML = text ? `<div class="msg ${type||''}">${esc(text)}</div>` : ''; }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function kr(v){ const n=Number(v||0); return n.toLocaleString((window.HOV_I18N?.locale?.()||'nb-NO'),{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function today(){ return new Date().toISOString().slice(0,10); }
  function fmtDateTime(v){
    if(!v) return '';
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return String(v || '').replace('T',' ').slice(0,19);
    return d.toLocaleString((window.HOV_I18N?.locale?.()||'nb-NO'), {
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'2-digit',
      minute:'2-digit',
      second:'2-digit'
    }).replace(',', '');
  }
  function val(id){ return ($(id)?.value ?? '').trim(); }
  function num(id){ const n=Number(String($(id)?.value ?? '0').replace(',','.')); return Number.isFinite(n)?n:0; }
  function setVal(id,v){ const el=$(id); if(el) el.value = v ?? ''; }
  function setText(id, text){ const el=$(id); if(el) el.textContent = text; }
  function setChecked(id,v){ const el=$(id); if(el) el.checked = !!v; }
  function countrySettingsKey(){ return COUNTRY_SETTINGS_KEY+':' +(app.firmaId || app.user?.id || 'default'); }
  function loadCountrySettings(){
    const fallback={country:'NO',currency:'NOK',fskatt:false,swish:'',mobilepay:'',ideal:'',stripe:'',iban:'',bic:'',bankgiro:'',plusgiro:'',saleType:'FARRIER',workCountry:'NO',customerCountry:'NO',customerType:'PRIVATE',customerVatNumber:'',vatVerified:false,autoTax:true,taxMode:'DOMESTIC',manualTaxRate:25,taxInvoiceNote:''};
    try{ return {...fallback,...(JSON.parse(localStorage.getItem(countrySettingsKey())||'{}')||{})}; }catch(_){ return fallback; }
  }
  function saveCountrySettings(){
    const row={country:val('firmaLand')||'NO',currency:val('firmaValuta')||'NOK',fskatt:!!$('firmaFskatt')?.checked,swish:val('firmaSwishNr'),mobilepay:val('firmaMobilePayNr'),ideal:val('firmaIdealLink'),stripe:val('firmaStripeLink'),iban:val('firmaIban'),bic:val('firmaBic'),bankgiro:val('firmaBankgiro'),plusgiro:val('firmaPlusgiro'),saleType:val('firmaSaleType')||'FARRIER',workCountry:val('firmaArbeidsland')||'NO',customerCountry:val('firmaCustomerCountry')||'NO',customerType:val('firmaKundetype')||'PRIVATE',customerVatNumber:val('firmaCustomerVatNumber'),vatVerified:!!$('firmaVatVerified')?.checked,autoTax:!!$('firmaAutoTax')?.checked,taxMode:val('firmaTaxMode')||'DOMESTIC',manualTaxRate:num('firmaManualTaxRate'),taxInvoiceNote:val('firmaTaxInvoiceNote')};
    localStorage.setItem(countrySettingsKey(),JSON.stringify(row));
    return row;
  }
  function updatePaymentSettingsPreview(){
    const lang=(window.HovI18n?.getLanguage?.()||localStorage.getItem('hov_language')||'nb').slice(0,2);
    const country=val('firmaLand')||loadCountrySettings().country||'NO';
    const labels={
      nb:{title:'💳 Betaling på faktura',help:'Velg land. Norge viser Vipps, Sverige viser Swish, og engelske land viser bank/IBAN og kortlenke. Opplysningene kommer automatisk med på fakturaen.',empty:'Ingen betalingsopplysninger er lagret ennå.',shown:'Dette vises på fakturaen:'},
      sv:{title:'💳 Betalning på faktura',help:'Välj land. Norge visar Vipps, Sverige visar Swish och engelskspråkiga länder visar bank/IBAN och kortlänk. Uppgifterna visas automatiskt på fakturan.',empty:'Inga betalningsuppgifter har sparats ännu.',shown:'Detta visas på fakturan:'},
      en:{title:'💳 Invoice payment details',help:'Choose a country. Norway shows Vipps, Sweden shows Swish, and English-speaking countries show bank/IBAN and a card-payment link. The details are added to invoices automatically.',empty:'No payment details have been saved yet.',shown:'This will appear on the invoice:'}
    };
    const t=labels[lang]||labels.nb;
    setText('paymentSettingsTitle',t.title); setText('paymentSettingsHelp',t.help);
    const badges=$('paymentMethodBadges');
    if(badges){
      const methods=country==='NO'?['Bankkonto','Vipps']:country==='SE'?['Bankkonto','Swish','Bankgiro','Plusgiro']:['Local bank','IBAN','BIC / SWIFT','Card link'];
      badges.innerHTML=methods.map(x=>`<span class="payment-method-badge active">${esc(x)}</span>`).join('');
    }
    const firma={kontonr:val('firmaKontonr'),vippsnummer:val('firmaVippsNr'),vipps_mottaker:val('firmaVippsMottaker')};
    const lines=paymentDetailsLines(firma).map(([a,b])=>a+': '+b);
    setText('paymentSettingsPreview',lines.length?t.shown+'\n'+lines.join('\n'):t.empty);
  }

  function applyCountryUi(setDefaults){
    const country=val('firmaLand')||loadCountrySettings().country||'NO';
    const sweden=country==='SE', norway=country==='NO', nordicMobile=['DK','FI'].includes(country), netherlands=country==='NL';
    const international=!['NO','SE'].includes(country);
    $('firmaFskattWrap')?.classList.toggle('hidden',!sweden);
    $('firmaSwishWrap')?.classList.toggle('hidden',!sweden);
    $('firmaMobilePayWrap')?.classList.toggle('hidden',!nordicMobile);
    $('firmaIdealWrap')?.classList.toggle('hidden',!netherlands);
    $('firmaStripeWrap')?.classList.toggle('hidden',country==='NO' || country==='SE');
    $('firmaIbanWrap')?.classList.toggle('hidden',!international);
    $('firmaBicWrap')?.classList.toggle('hidden',!international);
    $('firmaBankgiroWrap')?.classList.toggle('hidden',!sweden);
    $('firmaPlusgiroWrap')?.classList.toggle('hidden',!sweden);
    if($('firmaOrgnrLabel')) $('firmaOrgnrLabel').childNodes[0].nodeValue=sweden?'Organisationsnummer':country==='GB'?'Company number':country==='US'?'Business ID / EIN':'Org.nr / bedriftsnr';
    if($('firmaMvaNrLabel')) $('firmaMvaNrLabel').childNodes[0].nodeValue=sweden?'Momsregistreringsnummer':country==='GB'?'VAT number':country==='US'?'Tax ID':'MVA/VAT-nr';
    if($('firmaKontonrLabel')) $('firmaKontonrLabel').childNodes[0].nodeValue=sweden?'Bankkonto':international?'Local bank account':'Kontonr';
    if($('firmaVippsNrLabel')) $('firmaVippsNrLabel').classList.toggle('hidden',!norway);
    if($('firmaVippsMottakerLabel')) $('firmaVippsMottakerLabel').classList.toggle('hidden',!norway);
    const quick=$('hovCountryQuick'); if(quick) quick.value=country;
    localStorage.setItem('hov_country_quick',country);
    if(setDefaults){
      const defaults={NO:['NOK',25],SE:['SEK',25],DK:['DKK',25],FI:['EUR',25.5],GB:['GBP',20],NL:['EUR',21],DE:['EUR',19],US:['USD',0],INT:['EUR',0]};
      const d=defaults[country]||defaults.INT; setVal('firmaValuta',d[0]); setVal('firmaMvaSats',d[1]);
    }
    updatePaymentSettingsPreview();
  }
  function activeCountrySettings(){ return {...loadCountrySettings(),country:val('firmaLand')||loadCountrySettings().country,currency:val('firmaValuta')||loadCountrySettings().currency}; }
  function suggestTaxProfile(cs=activeCountrySettings()){
    const seller=cs.country||'NO', customer=cs.customerCountry||seller, work=cs.workCountry||seller;
    const type=cs.customerType||'PRIVATE', sale=cs.saleType||'FARRIER';
    const validBusinessVat=type==='BUSINESS' && !!String(cs.customerVatNumber||'').trim() && !!cs.vatVerified;
    if(sale==='DIGITAL'){
      if(type==='BUSINESS' && customer!==seller && validBusinessVat) return {mode:'REVERSE',rate:0,note:customer==='SE'?'Omvänd betalningsskyldighet – köparen redovisar moms':'Reverse charge'};
      if(type==='PRIVATE' && customer==='SE') return {mode:'EU_B2C_DIGITAL',rate:25,note:'Svensk moms på elektronisk tjänst till privatkund'};
      if(type==='PRIVATE' && customer==='EU') return {mode:'REVIEW',rate:0,note:'EU-moms etter kundens land. Kontroller sats og OSS/non-Union OSS før fakturering.'};
    }
    if(sale==='FARRIER'){
      if(work===seller) return {mode:'DOMESTIC',rate:Number(app.firma?.standard_mva_sats??25),note:''};
      return {mode:'REVIEW',rate:0,note:'Hovslagertjeneste utført i et annet land må vurderes etter reglene i arbeidslandet før fakturering.'};
    }
    if(sale==='GOODS' && customer!==seller) return {mode:'REVIEW',rate:0,note:'Grensekryssende varesalg krever vurdering av eksport, import og eventuell IOSS/registrering.'};
    if(type==='BUSINESS' && customer!==seller && validBusinessVat) return {mode:'REVERSE',rate:0,note:customer==='SE'?'Omvänd betalningsskyldighet':'Reverse charge'};
    if(customer===seller) return {mode:'DOMESTIC',rate:Number(app.firma?.standard_mva_sats??25),note:''};
    return {mode:'REVIEW',rate:0,note:'Avgiftsbehandlingen må kontrolleres før faktura sendes.'};
  }
  function applyTaxSuggestion(){
    const cs={...loadCountrySettings(),country:val('firmaLand')||'NO',saleType:val('firmaSaleType')||'FARRIER',workCountry:val('firmaArbeidsland')||'NO',customerCountry:val('firmaCustomerCountry')||'NO',customerType:val('firmaKundetype')||'PRIVATE',customerVatNumber:val('firmaCustomerVatNumber'),vatVerified:!!$('firmaVatVerified')?.checked};
    const business=cs.customerType==='BUSINESS';
    $('firmaCustomerVatWrap')?.classList.toggle('hidden',!business);
    $('firmaVatVerifiedWrap')?.classList.toggle('hidden',!business);
    if(!$('firmaAutoTax')?.checked) return;
    const x=suggestTaxProfile(cs); setVal('firmaTaxMode',x.mode); setVal('firmaManualTaxRate',x.rate); setVal('firmaTaxInvoiceNote',x.note); applyTaxModeUi();
  }
  function applyTaxModeUi(){
    const mode=val('firmaTaxMode')||loadCountrySettings().taxMode||'DOMESTIC';
    $('firmaManualTaxWrap')?.classList.toggle('hidden',mode!=='MANUAL' && mode!=='EU_B2C_DIGITAL');
    const note=$('firmaTaxInvoiceNote');
    if(note && !note.value){
      if(mode==='REVERSE') note.value=(val('firmaLand')==='SE'?'Omvänd betalningsskyldighet':'Reverse charge / omvendt avgiftsplikt');
      else if(mode==='ZERO') note.value=(val('firmaLand')==='SE'?'0 % moms – grund måste dokumenteras':'0 % MVA – grunnlag må dokumenteres');
      else if(mode==='REVIEW') note.value='Må vurderes før fakturering';
    }
  }
  function invoiceTaxProfile(){
    const cs=activeCountrySettings();
    const suggested=cs.autoTax?suggestTaxProfile(cs):null;
    const mode=suggested?.mode || cs.taxMode||'DOMESTIC';
    let rate=suggested?Number(suggested.rate):Number(app.firma?.standard_mva_sats ?? 25);
    if(mode==='REVERSE' || mode==='ZERO' || mode==='REVIEW') rate=0;
    if(mode==='MANUAL' || mode==='EU_B2C_DIGITAL') rate=Number(cs.manualTaxRate||suggested?.rate||0);
    const note=String(suggested?.note||cs.taxInvoiceNote||'').trim() || (mode==='REVERSE'?'Reverse charge / omvendt avgiftsplikt':mode==='ZERO'?'0 % avgift – grunnlag må dokumenteres':'');
    return {mode,rate:Number.isFinite(rate)?rate:0,note,workCountry:cs.workCountry||cs.country,customerCountry:cs.customerCountry||cs.country,customerType:cs.customerType||'PRIVATE',saleType:cs.saleType||'FARRIER',customerVatNumber:cs.customerVatNumber||'',vatVerified:!!cs.vatVerified,requiresReview:mode==='REVIEW'};
  }
  function calculateInvoiceAmounts(exVat){
    const tax=invoiceTaxProfile();
    const eks=Number(exVat||0);
    const vat=+(eks*tax.rate/100).toFixed(2);
    return {eks,mva:vat,inkl:+(eks+vat).toFixed(2),tax};
  }
  function taxMarker(tax){ return ` [TAXMODE=${tax.mode};RATE=${tax.rate};WORK=${tax.workCountry};COUNTRY=${tax.customerCountry||''};CUSTOMER=${tax.customerType};SALE=${tax.saleType||''};VATNO=${encodeURIComponent(tax.customerVatNumber||'')};VATOK=${tax.vatVerified?'1':'0'};NOTE=${encodeURIComponent(tax.note||'')}]`; }
  function parseTaxMeta(f){
    const text=String(f?.tekst||'');
    const m=text.match(/\[TAXMODE=([^;]+);RATE=([^;]+);WORK=([^;]+);COUNTRY=([^;]*);CUSTOMER=([^;]+);SALE=([^;]*);VATNO=([^;]*);VATOK=([^;]*);NOTE=([^\]]*)\]/);
    if(m) return {mode:m[1],rate:Number(m[2]||0),workCountry:m[3],customerCountry:m[4],customerType:m[5],saleType:m[6],customerVatNumber:decodeURIComponent(m[7]||''),vatVerified:m[8]==='1',note:decodeURIComponent(m[9]||'')};
    const old=text.match(/\[TAXMODE=([^;]+);RATE=([^;]+);WORK=([^;]+);CUSTOMER=([^;]+);NOTE=([^\]]*)\]/);
    if(!old) return {rate:Number(f?.eks_mva)?+(Number(f?.mva||0)/Number(f.eks_mva)*100).toFixed(2):0,note:'',mode:'DOMESTIC'};
    return {mode:old[1],rate:Number(old[2]||0),workCountry:old[3],customerType:old[4],note:decodeURIComponent(old[5]||'')};
  }
  function paymentDetailsHtml(firma){
    const cs=activeCountrySettings();
    if(cs.country==='SE') return ['Swish: '+(cs.swish||''),'Bankkonto: '+(firma.kontonr||''),'Bankgiro: '+(cs.bankgiro||''),'Plusgiro: '+(cs.plusgiro||''),cs.fskatt?'Godkänd för F-skatt':''].filter(x=>!x.endsWith(': ')).join('<br>');
    if(['DK','FI'].includes(cs.country)) return ['MobilePay: '+(cs.mobilepay||''),'IBAN: '+(cs.iban||''),'BIC: '+(cs.bic||''),'Kort: '+(cs.stripe||'')].filter(x=>!x.endsWith(': ')).join('<br>');
    if(cs.country==='NL') return ['iDEAL: '+(cs.ideal||''),'IBAN: '+(cs.iban||''),'BIC: '+(cs.bic||''),'Kort: '+(cs.stripe||'')].filter(x=>!x.endsWith(': ')).join('<br>');
    if(cs.country!=='NO') return ['IBAN: '+(cs.iban||''),'BIC: '+(cs.bic||''),'Card payment: '+(cs.stripe||'')].filter(x=>!x.endsWith(': ')).join('<br>');
    return ['Kontonr: '+(firma.kontonr||''),'Vipps: '+(firma.vippsnummer||'')+' '+(firma.vipps_mottaker||'')].filter(Boolean).join('<br>');
  }
  function paymentDetailsLines(firma){
    const cs=activeCountrySettings();
    if(cs.country==='SE') return [['Swish',cs.swish||''],['Bankkonto',firma.kontonr||''],['Bankgiro',cs.bankgiro||''],['Plusgiro',cs.plusgiro||''],['F-skatt',cs.fskatt?'Godkänd':'']].filter(x=>x[1]);
    if(['DK','FI'].includes(cs.country)) return [['MobilePay',cs.mobilepay||''],['IBAN',cs.iban||''],['BIC',cs.bic||''],['Kort',cs.stripe||'']].filter(x=>x[1]);
    if(cs.country==='NL') return [['iDEAL',cs.ideal||''],['IBAN',cs.iban||''],['BIC',cs.bic||''],['Kort',cs.stripe||'']].filter(x=>x[1]);
    if(cs.country!=='NO') return [['IBAN',cs.iban||''],['BIC',cs.bic||''],['Card payment',cs.stripe||'']].filter(x=>x[1]);
    return [['Kontonr',firma.kontonr||''],['Vipps',(firma.vippsnummer||'')+' '+(firma.vipps_mottaker||'')]].filter(x=>x[1].trim());
  }

  function selectedRowClass(type,id){ if(type==='jobb' && app.viewJobbId && String(app.viewJobbId)===String(id)) return ' selected-row'; return app.edit[type] && String(app.edit[type])===String(id) ? ' selected-row' : ''; }
  function bindClickableRows(containerId, type, handler){ const el=$(containerId); if(!el) return; el.querySelectorAll('tr.click-row[data-id]').forEach(row=>row.addEventListener('click',()=>handler(row.dataset.id))); }
  function showLogin(show){ $('loginCard')?.classList.toggle('hidden', !show); $('appCard')?.classList.toggle('hidden', show); }
  function safeName(name){ return String(name||'logo').toLowerCase().replace(/[^a-z0-9_.-]+/g,'-').replace(/-+/g,'-').slice(0,80); }
  const PRIVATE_IMAGE_BUCKET = 'hovslager-bilder';
  const SIGNED_IMAGE_SECONDS = 60 * 60;
  function imgUrl(row){ return row?._signed_bilde_url || row?.bilde_signed_url || row?.bilde_url || row?.image_url || row?.foto_url || row?.photo_url || ''; }
  function storagePathFromPublicUrl(url){
    const text=String(url||'');
    const marker='/storage/v1/object/public/'+PRIVATE_IMAGE_BUCKET+'/';
    const i=text.indexOf(marker);
    if(i<0) return '';
    return decodeURIComponent(text.slice(i+marker.length).split('?')[0]);
  }
  async function signedImageUrl(pathOrUrl){
    const raw=String(pathOrUrl||'').trim();
    if(!raw || !app.sb) return '';
    const path = raw.startsWith('http') ? storagePathFromPublicUrl(raw) : raw;
    if(!path) return raw.startsWith('http') ? raw : '';
    const { data, error } = await app.sb.storage.from(PRIVATE_IMAGE_BUCKET).createSignedUrl(path, SIGNED_IMAGE_SECONDS);
    if(error){ console.warn('Kunne ikke lage signed URL', error); return raw.startsWith('http') ? raw : ''; }
    return data?.signedUrl || '';
  }
  async function loadHestBilder(){
    if(!app.firmaId){ app.data.hestBilder=[]; return; }
    const {data,error}=await app.sb.from('hov_hest_bilder').select('*').eq('firma_id', app.firmaId).order('created_at',{ascending:false});
    if(error){ console.warn('hov_hest_bilder', error); app.data.hestBilder=[]; return; }
    app.data.hestBilder=data||[];
  }
  async function loadJobbBilder(){
    if(!app.firmaId){ app.data.jobbBilder=[]; return; }
    const {data,error}=await app.sb.from('hov_jobb_bilder').select('*').eq('firma_id', app.firmaId).order('created_at',{ascending:false});
    if(error){ console.warn('hov_jobb_bilder', error); app.data.jobbBilder=[]; return; }
    app.data.jobbBilder=data||[];
  }
  async function signHestBilder(){
    await loadHestBilder();
    for(const h of (app.data.hester||[])){
      const mine=(app.data.hestBilder||[]).filter(b=>String(b.hest_id)===String(h.id));
      h._hest_bilder=[];
      for(const b of mine){
        const source=b.path || b.bilde_path || storagePathFromPublicUrl(b.url || b.bilde_url) || b.url || b.bilde_url || '';
        const signed=source ? await signedImageUrl(source) : '';
        h._hest_bilder.push({...b, url:signed || b.url || b.bilde_url || '', path:source});
      }
      const first=h._hest_bilder[0];
      const fallback=h.bilde_path || storagePathFromPublicUrl(h.bilde_url) || h.bilde_url || h.image_url || h.foto_url || h.photo_url || '';
      h._signed_bilde_url = first?.url || (fallback ? await signedImageUrl(fallback) : '');
    }
  }
  async function signJobbBilder(){
    await loadJobbBilder();
    for(const j of (app.data.jobber||[])){
      const mine=(app.data.jobbBilder||[]).filter(b=>String(b.jobb_id)===String(j.id));
      const bilder=mine.length ? mine.map(b=>({
        url:b.url || b.bilde_url || '',
        path:b.path || b.bilde_path || storagePathFromPublicUrl(b.url || b.bilde_url) || null,
        dato:b.dato || b.bilde_dato || b.created_at || j.dato,
        tekst:b.tekst || b.note || b.beskrivelse || ''
      })) : jobBilder(j, {preferStored:true});
      j._signed_bilder=[];
      for(const b of bilder){
        const source=b.path || storagePathFromPublicUrl(b.url) || b.url || '';
        const signed=source ? await signedImageUrl(source) : '';
        j._signed_bilder.push({...b, url:signed || b.url, original_url:b.url || '', path:b.path || storagePathFromPublicUrl(b.url) || null});
      }
    }
  }
  function jobBildeDato(item, fallback){
    const d = item?.dato || item?.date || item?.created_at || item?.createdAt || fallback || '';
    return String(d || '').slice(0,10);
  }
  function jobBilder(row, opts){
    if(!opts?.preferStored && Array.isArray(row?._signed_bilder)) return row._signed_bilder;
    const raw = row?.bilder || row?.bilde_urls || row?.image_urls || row?.photos || row?.bilder_url || [];
    let arr = [];
    if(Array.isArray(raw)) arr = raw;
    else if(typeof raw === 'string' && raw.trim()){
      try{ const parsed=JSON.parse(raw); arr = Array.isArray(parsed) ? parsed : [raw]; }
      catch(_){ arr = [raw]; }
    }
    return arr.map(x=>{
      if(typeof x === 'string') return { url:x, dato: jobBildeDato(null, row?.dato), path:storagePathFromPublicUrl(x) || null };
      return { url:x?.url || x?.bilde_url || x?.image_url || x?.src || '', path:x?.path || x?.bilde_path || storagePathFromPublicUrl(x?.url || x?.bilde_url || x?.image_url || x?.src) || null, dato: jobBildeDato(x, row?.dato), tekst:x?.tekst || x?.note || '' };
    }).filter(x=>x.url || x.path).sort((a,b)=>String(a.dato||'').localeCompare(String(b.dato||'')));
  }
  function renderImagePreview(id, url){
    const el=$(id); if(!el) return;
    if(url){ el.innerHTML=`<img class="thumb clickable-img" src="${esc(url)}" data-full-src="${esc(url)}" alt="Bilde" title="Klikk for større bilde">`; }
    else el.innerHTML='<span class="muted">Ingen bilde valgt.</span>';
  }
  function normalizePreviewItem(x){
    if(typeof x === 'string') return {url:x,dato:val('jobbBildeDato')||val('jobbDato')||today(), pending:false};
    return x || null;
  }
  function renderJobbBildePreview(items){
    const el=$('jobbBildePreview'); if(!el) return;
    const bilder=(items||[]).map(normalizePreviewItem).filter(x=>x && x.url);
    el.innerHTML = bilder.length ? bilder.map((x,idx)=>{
      const dato=esc(jobBildeDato(x, val('jobbDato')||today()) || 'Uten dato');
      const pending=x.pending?'<br><span class="pending-photo-badge">nytt bilde</span>':'';
      const key=x.key || '';
      const id=x.id || x.bilde_id || '';
      const path=x.path || x.bilde_path || storagePathFromPublicUrl(x.url) || '';
      const delAttrs = x.pending
        ? `data-delete-jobb-bilde="pending" data-pending-key="${esc(key)}"`
        : `data-delete-jobb-bilde="stored" data-bilde-id="${esc(id)}" data-bilde-path="${esc(path)}" data-preview-index="${idx}"`;
      return `<figure class="timeline-photo"><button type="button" class="delete-photo-btn" ${delAttrs} title="Slett bilde">🗑</button><button type="button" class="analyze-photo-btn" data-analyze-src="${esc(x.url)}" data-analyze-date="${dato}" title="Analyser bildet">📐 Analyser</button><img class="thumb clickable-img" src="${esc(x.url)}" data-full-src="${esc(x.url)}" alt="Jobb-bilde" title="Klikk for større bilde"><figcaption>${dato}${pending}</figcaption></figure>`;
    }).join('') : '<span class="muted">Ingen bilder valgt.</span>';
  }
  function renderCombinedJobbBildePreview(){
    const pending=(app.pendingJobbFiles||[]).map(x=>({url:x.url, dato:x.dato, pending:true, key:x.key}));
    renderJobbBildePreview([...(app.currentJobbPreview||[]), ...pending]);
  }
  function previewSelectedHestBilde(){ const file=$('hestBildeFile')?.files?.[0]; renderImagePreview('hestBildePreview', file ? URL.createObjectURL(file) : ''); }
  function previewSelectedJobbBilder(){
    const input=$('jobbBildeFiles');
    const files=Array.from(input?.files || []);
    const dato=val('jobbBildeDato') || val('jobbDato') || today();
    app.pendingJobbFiles = app.pendingJobbFiles || [];
    const seen=new Set(app.pendingJobbFiles.map(x=>x.key));
    for(const f of files){
      const key=[f.name,f.size,f.lastModified].join(':');
      if(seen.has(key)) continue;
      seen.add(key);
      app.pendingJobbFiles.push({file:f, url:URL.createObjectURL(f), dato, key});
    }
    if(input) input.value='';
    renderCombinedJobbBildePreview();
  }

  function setJobbFormVisible(visible){
    $('jobbFormGrid')?.classList.toggle('hidden', !visible);
    $('jobbFormActions')?.classList.toggle('hidden', !visible);
  }
  function hidePostSavePrompt(){
    $('jobbSavedPrompt')?.classList.add('hidden');
    app.postSaveJobbId = null;
    const input=$('jobbSavedBildeFiles'); if(input) input.value='';
    const preview=$('jobbSavedBildePreview'); if(preview){ preview.innerHTML=''; preview.classList.add('hidden'); }
    $('uploadSavedJobbBilderBtn')?.classList.add('hidden');
  }
  function showPostSavePrompt(saved){
    app.postSaveJobbId = saved?.id || app.postSaveJobbId || null;
    showTab('jobber');
    setText('jobbFormTitle','Jobb lagret');
    $('jobbSavedPrompt')?.classList.remove('hidden');
    setJobbFormVisible(false);
    msg('jobbMsg','','ok');
    setTimeout(()=>{ $('jobbFormTitle')?.scrollIntoView({behavior:'smooth', block:'start'}); }, 50);
  }
  function previewSavedJobbBilder(){
    const files=Array.from($('jobbSavedBildeFiles')?.files || []);
    const preview=$('jobbSavedBildePreview');
    if(!preview) return;
    preview.classList.toggle('hidden', !files.length);
    $('uploadSavedJobbBilderBtn')?.classList.toggle('hidden', !files.length);
    preview.innerHTML = files.length ? files.map(f=>`<figure class="timeline-photo"><img class="thumb" src="${esc(URL.createObjectURL(f))}" alt="Valgt bilde"><figcaption>${esc(f.name||'Bilde')}</figcaption></figure>`).join('') : '';
  }
  async function uploadSavedJobbBilder(){
    const jobbId=app.postSaveJobbId;
    const files=Array.from($('jobbSavedBildeFiles')?.files || []);
    if(!jobbId){ msg('jobbMsg','Fant ikke lagret jobb. Åpne jobben og legg til bilder derfra.','err'); return; }
    if(!files.length){ msg('jobbMsg','Velg ett eller flere bilder først.','err'); return; }
    const j=(app.data.jobber||[]).find(x=>String(x.id)===String(jobbId));
    try{
      msg('jobbMsg','Lagrer bilde(r) ...','ok');
      const rows=[];
      for(const file of files){
        const up=await uploadAppFile(file,'jobber');
        rows.push({firma_id:app.firmaId, jobb_id:jobbId, hest_id:j?.hest_id||null, path:up.path, bilde_url:up.url, dato:today(), filnavn:file.name||null, mime_type:file.type||null});
      }
      const br=await app.sb.from('hov_jobb_bilder').insert(rows);
      if(br.error){ msg('jobbMsg','Bildet ble lastet opp, men ikke registrert: '+br.error.message,'err'); return; }
      const input=$('jobbSavedBildeFiles'); if(input) input.value='';
      previewSavedJobbBilder();
      await loadJobber();
      msg('jobbMsg', rows.length+' bilde(r) lagret på jobben.','ok');
    }catch(err){ msg('jobbMsg','Kunne ikke lagre bilde(r): '+(err.message||String(err)),'err'); }
  }
  async function deleteJobbBildeFromPreview(btn){
    const mode=btn?.dataset?.deleteJobbBilde;
    if(!mode) return;
    if(mode==='pending'){
      const key=btn.dataset.pendingKey || '';
      app.pendingJobbFiles=(app.pendingJobbFiles||[]).filter(x=>String(x.key)!==String(key));
      renderCombinedJobbBildePreview();
      msg('jobbMsg','Bilde fjernet fra opplasting.','ok');
      return;
    }
    const bildeId=btn.dataset.bildeId || '';
    const path=btn.dataset.bildePath || '';
    if(!confirm('Slette dette bildet?')) return;
    try{
      if(!bildeId){
        msg('jobbMsg','Fant ikke bilde-ID. Bildet kan ikke slettes automatisk.','err');
        return;
      }
      const {error}=await app.sb.from('hov_jobb_bilder').delete().eq('id', bildeId).eq('firma_id', app.firmaId);
      if(error){ msg('jobbMsg','Kunne ikke slette bilde fra databasen: '+error.message,'err'); return; }
      if(path){
        try{ await app.sb.storage.from(PRIVATE_IMAGE_BUCKET).remove([path]); }
        catch(e){ console.warn('Kunne ikke slette bildefil fra storage', e); }
      }
      app.currentJobbPreview=(app.currentJobbPreview||[]).filter(x=>String(x.id||x.bilde_id||'')!==String(bildeId));
      renderCombinedJobbBildePreview();
      await loadJobbBilder();
      msg('jobbMsg','Bildet er slettet.','ok');
    }catch(err){
      msg('jobbMsg','Kunne ikke slette bilde: '+(err.message||String(err)),'err');
    }
  }

  const hoofImageEditor={
    image:null, imageObjectUrl:'', canvas:null, ctx:null, modal:null, tool:'none', color:'#ff2d2d', width:4,
    objects:[], autoObjects:[], draft:null, dragging:false, sourceDate:'', guides:true, autoAnalysis:true, status:null
  };
  function hoofEditorSetStatus(text,isError){
    const el=hoofImageEditor.status;
    if(!el) return;
    el.textContent=text||'';
    el.style.color=isError?'#ffb4b4':'#cbd5e1';
  }
  function ensureHoofEditor(){
    if(hoofImageEditor.modal) return hoofImageEditor.modal;
    const style=document.createElement('style');
    style.textContent=`
      .analyze-photo-btn{position:absolute;left:7px;top:7px;z-index:6;border:0;border-radius:8px;padding:8px 10px;background:#175d46;color:#fff;font-weight:800;cursor:pointer;box-shadow:0 2px 8px #0008}.timeline-photo{position:relative}
      .hoof-editor-modal{position:fixed;inset:0;z-index:2147483000;background:#050a10f2;display:none;flex-direction:column;color:#fff}.hoof-editor-modal.open{display:flex}.hoof-editor-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;background:#101d2c;border-bottom:1px solid #38516a}.hoof-editor-head strong{margin-right:auto}.hoof-editor-tools{display:flex;gap:6px;flex-wrap:wrap}.hoof-editor-modal button{border:0;border-radius:8px;padding:9px 11px;background:#28425c;color:#fff;font-weight:750;cursor:pointer;touch-action:manipulation}.hoof-editor-modal button.active{background:#c48a20}.hoof-editor-modal button:disabled{opacity:.5;cursor:not-allowed}.hoof-editor-tools input[type=color]{width:42px;height:38px;border:0;background:transparent}.hoof-editor-tools input[type=range]{width:90px}.hoof-editor-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px;background:#07111d}.hoof-editor-stage canvas{max-width:100%;max-height:100%;box-shadow:0 10px 35px #000;border-radius:6px;touch-action:none;background:#111}.hoof-editor-help{padding:8px 12px;background:#101d2c;color:#cbd5e1;font-size:13px;display:flex;gap:12px;flex-wrap:wrap}.hoof-editor-status{font-weight:700}.hoof-editor-save{background:#198754!important}.hoof-editor-close{background:#8c2d35!important}@media(max-width:700px){.hoof-editor-head{align-items:flex-start}.hoof-editor-head strong{width:100%}.hoof-editor-modal button{padding:8px;font-size:12px}.hoof-editor-help{font-size:12px}}
    `;
    document.head.appendChild(style);
    const modal=document.createElement('div');
    modal.className='hoof-editor-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML=`<div class="hoof-editor-head"><strong>📐 Bildeanalyse</strong><div class="hoof-editor-tools"><button type="button" data-eaction="auto" class="active">Autoanalyse</button><button type="button" data-etool="line">Linje</button><button type="button" data-etool="angle">Vinkel</button><button type="button" data-etool="draw">Frihånd</button><button type="button" data-etool="text">Tekst</button><button type="button" data-eaction="guides" class="active">Hjelpelinjer</button><input id="hoofEditorColor" type="color" value="#ff2d2d" title="Farge"><input id="hoofEditorWidth" type="range" min="1" max="12" value="4" title="Tykkelse"><button type="button" data-eaction="undo">↶ Angre</button><button type="button" data-eaction="clear">Nullstill</button></div><button type="button" class="hoof-editor-save" data-eaction="save">Lagre kopi i jobben</button><button type="button" class="hoof-editor-close" data-eaction="close">Lukk</button></div><div class="hoof-editor-stage"><canvas width="900" height="600"></canvas></div><div class="hoof-editor-help"><span>Automatiske linjer og vinkler vises ved åpning. Velg et verktøy bare når du vil legge til noe manuelt.</span><span class="hoof-editor-status">Klar.</span></div>`;
    document.body.appendChild(modal);
    hoofImageEditor.modal=modal;
    hoofImageEditor.canvas=modal.querySelector('canvas');
    hoofImageEditor.ctx=hoofImageEditor.canvas.getContext('2d');
    hoofImageEditor.status=modal.querySelector('.hoof-editor-status');

    modal.querySelectorAll('[data-etool]').forEach(btn=>btn.onclick=function(ev){
      ev.preventDefault(); ev.stopPropagation();
      hoofImageEditor.tool=this.dataset.etool;
      modal.querySelectorAll('[data-etool]').forEach(b=>b.classList.toggle('active',b===this));
      hoofImageEditor.draft=null; hoofImageEditor.dragging=false; drawHoofEditor();
      hoofEditorSetStatus('Verktøy: '+this.textContent.trim());
    });
    const actionButton=name=>modal.querySelector(`[data-eaction="${name}"]`);
    actionButton('auto').onclick=function(ev){ev.preventDefault();hoofImageEditor.autoAnalysis=!hoofImageEditor.autoAnalysis;this.classList.toggle('active',hoofImageEditor.autoAnalysis);if(hoofImageEditor.autoAnalysis&&hoofImageEditor.image)hoofImageEditor.autoObjects=buildAutomaticHoofAnalysis();drawHoofEditor();hoofEditorSetStatus(hoofImageEditor.autoAnalysis?'Automatisk analyse vises.':'Automatisk analyse skjult.');};
    actionButton('close').onclick=function(ev){ev.preventDefault();closeHoofEditor();};
    actionButton('undo').onclick=function(ev){ev.preventDefault();hoofImageEditor.objects.pop();hoofImageEditor.draft=null;drawHoofEditor();hoofEditorSetStatus('Siste markering er fjernet.');};
    actionButton('clear').onclick=function(ev){ev.preventDefault();if(confirm('Fjerne alle markeringer?')){hoofImageEditor.objects=[];hoofImageEditor.draft=null;drawHoofEditor();hoofEditorSetStatus('Alle markeringer er fjernet.');}};
    actionButton('guides').onclick=function(ev){ev.preventDefault();hoofImageEditor.guides=!hoofImageEditor.guides;this.classList.toggle('active',hoofImageEditor.guides);drawHoofEditor();hoofEditorSetStatus(hoofImageEditor.guides?'Hjelpelinjer på.':'Hjelpelinjer av.');};
    actionButton('save').onclick=function(ev){ev.preventDefault();saveHoofEditorCopy();};
    modal.querySelector('#hoofEditorColor').oninput=e=>hoofImageEditor.color=e.target.value;
    modal.querySelector('#hoofEditorWidth').oninput=e=>hoofImageEditor.width=Number(e.target.value)||4;
    const c=hoofImageEditor.canvas;
    c.onpointerdown=hoofEditorPointerDown;
    c.onpointermove=hoofEditorPointerMove;
    c.onpointerup=hoofEditorPointerUp;
    c.onpointercancel=hoofEditorPointerUp;
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))closeHoofEditor();});
    return modal;
  }
  function hoofEditorPoint(ev){
    const r=hoofImageEditor.canvas.getBoundingClientRect();
    return {x:(ev.clientX-r.left)*(hoofImageEditor.canvas.width/r.width),y:(ev.clientY-r.top)*(hoofImageEditor.canvas.height/r.height)};
  }
  async function loadHoofEditorImage(src){
    let usableSrc=src;
    if(hoofImageEditor.imageObjectUrl){URL.revokeObjectURL(hoofImageEditor.imageObjectUrl);hoofImageEditor.imageObjectUrl='';}
    if(/^https?:/i.test(src)){
      try{
        const response=await fetch(src,{mode:'cors',credentials:'omit',cache:'no-store'});
        if(!response.ok) throw new Error('HTTP '+response.status);
        const blob=await response.blob();
        usableSrc=URL.createObjectURL(blob);
        hoofImageEditor.imageObjectUrl=usableSrc;
      }catch(err){
        console.warn('Blob-innlasting feilet, prøver direkte bilde-URL.',err);
      }
    }
    return await new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Bildet kunne ikke lastes inn.'));
      img.src=usableSrc;
    });
  }
  async function openHoofEditor(src,date){
    if(!src){alert('Fant ingen bildeadresse.');return;}
    const modal=ensureHoofEditor();
    modal.classList.add('open');
    hoofImageEditor.image=null; hoofImageEditor.objects=[]; hoofImageEditor.autoObjects=[]; hoofImageEditor.draft=null; hoofImageEditor.tool='none'; modal.querySelectorAll('[data-etool]').forEach(b=>b.classList.remove('active'));  hoofImageEditor.sourceDate=date||today();
    hoofEditorSetStatus('Laster bilde ...');
    const ctx=hoofImageEditor.ctx,c=hoofImageEditor.canvas;
    ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#111';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#fff';ctx.font='bold 24px system-ui';ctx.textAlign='center';ctx.fillText('Laster bilde ...',c.width/2,c.height/2);
    try{
      const img=await loadHoofEditorImage(src);
      const max=1800,ratio=Math.min(1,max/Math.max(img.naturalWidth||1,img.naturalHeight||1));
      c.width=Math.max(1,Math.round(img.naturalWidth*ratio));c.height=Math.max(1,Math.round(img.naturalHeight*ratio));
      hoofImageEditor.image=img;hoofImageEditor.autoObjects=buildAutomaticHoofAnalysis();drawHoofEditor();hoofEditorSetStatus('Automatiske linjer og vinkler vises. Velg et verktøy bare for manuelle tillegg.');
    }catch(err){
      console.error(err);hoofEditorSetStatus('Kunne ikke åpne bildet. Last det eventuelt opp på nytt.',true);
    }
  }
  function closeHoofEditor(){
    hoofImageEditor.modal?.classList.remove('open');hoofImageEditor.draft=null;hoofImageEditor.dragging=false;
  }
  function hoofEditorPointerDown(ev){
    if(!hoofImageEditor.image){hoofEditorSetStatus('Bildet er ikke ferdig lastet.',true);return;}
    if(hoofImageEditor.tool==='none'){hoofEditorSetStatus('Velg Linje, Vinkel, Frihånd eller Tekst for å tegne manuelt.');return;}
    ev.preventDefault();const p=hoofEditorPoint(ev),e=hoofImageEditor;
    if(e.tool==='text'){const text=prompt('Skriv tekst:','');if(text){e.objects.push({type:'text',p,text,color:e.color,width:e.width});drawHoofEditor();}return;}
    if(e.tool==='angle'){
      if(!e.draft||e.draft.type!=='angle')e.draft={type:'angle',points:[p],color:e.color,width:e.width};else e.draft.points.push(p);
      if(e.draft.points.length===3){e.objects.push(e.draft);e.draft=null;hoofEditorSetStatus('Vinkel er lagt til.');}else hoofEditorSetStatus('Vinkel: velg punkt '+(e.draft.points.length+1)+' av 3.');
      drawHoofEditor();return;
    }
    e.dragging=true;e.canvas.setPointerCapture?.(ev.pointerId);
    e.draft=e.tool==='draw'?{type:'draw',points:[p],color:e.color,width:e.width}:{type:'line',a:p,b:p,color:e.color,width:e.width};drawHoofEditor();
  }
  function hoofEditorPointerMove(ev){if(!hoofImageEditor.dragging||!hoofImageEditor.draft)return;ev.preventDefault();const p=hoofEditorPoint(ev);if(hoofImageEditor.draft.type==='draw')hoofImageEditor.draft.points.push(p);else hoofImageEditor.draft.b=p;drawHoofEditor();}
  function hoofEditorPointerUp(ev){if(!hoofImageEditor.dragging)return;ev.preventDefault();hoofImageEditor.dragging=false;if(hoofImageEditor.draft){hoofImageEditor.objects.push(hoofImageEditor.draft);hoofImageEditor.draft=null;drawHoofEditor();hoofEditorSetStatus('Markering er lagt til.');}}

  function buildAutomaticHoofAnalysis(){
    const e=hoofImageEditor,c=e.canvas,ctx=e.ctx,img=e.image;if(!c||!ctx||!img)return [];
    const w=c.width,h=c.height;
    let data;try{ctx.drawImage(img,0,0,w,h);data=ctx.getImageData(0,0,w,h).data;}catch(_){return fallbackAutomaticHoofAnalysis(w,h);}
    const step=Math.max(2,Math.round(Math.max(w,h)/700));
    const lum=(x,y)=>{const i=(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};
    let border=[];for(let x=0;x<w;x+=step){border.push(lum(x,Math.round(h*.08)),lum(x,Math.round(h*.92)));}for(let y=0;y<h;y+=step){border.push(lum(Math.round(w*.05),y),lum(Math.round(w*.95),y));}
    border.sort((a,b)=>a-b);const bg=border[Math.floor(border.length*.65)]||180;const threshold=Math.max(45,Math.min(175,bg-28));
    const rows=[];for(let y=Math.round(h*.18);y<Math.round(h*.96);y+=step){let left=-1,right=-1;for(let x=Math.round(w*.12);x<Math.round(w*.88);x+=step){if(lum(x,y)<threshold){if(left<0)left=x;right=x;}}if(left>=0&&right-left>w*.12)rows.push({y,left,right});}
    if(rows.length<8)return fallbackAutomaticHoofAnalysis(w,h);
    const low=rows.filter(r=>r.y>h*.48), bottom=rows[rows.length-1], top=rows[Math.max(0,Math.floor(rows.length*.2))];
    const fit=(arr,key)=>{let sx=0,sy=0,sxy=0,syy=0,n=0;arr.forEach(r=>{const y=r.y,x=r[key];sx+=x;sy+=y;sxy+=x*y;syy+=y*y;n++;});const den=n*syy-sy*sy;if(!den)return {a:0,b:sx/n};const a=(n*sxy-sx*sy)/den,b=(sx-a*sy)/n;return {a,b};};
    const lf=fit(low,'left'),rf=fit(low,'right');const y1=Math.max(h*.42,top.y),y2=Math.min(h*.93,bottom.y);
    const lp1={x:lf.a*y1+lf.b,y:y1},lp2={x:lf.a*y2+lf.b,y:y2},rp1={x:rf.a*y1+rf.b,y:y1},rp2={x:rf.a*y2+rf.b,y:y2};
    const baseY=Math.min(h*.95,bottom.y),baseA={x:Math.max(0,bottom.left-w*.03),y:baseY},baseB={x:Math.min(w,bottom.right+w*.03),y:baseY};
    const centerX=(bottom.left+bottom.right)/2;
    return [
      {type:'autoLine',a:{x:centerX,y:Math.max(0,top.y-h*.08)},b:{x:centerX,y:baseY},color:'#00e5ff',width:Math.max(2,w/550),label:'Senterakse'},
      {type:'autoLine',a:baseA,b:baseB,color:'#ffe066',width:Math.max(2,w/550),label:'Underlag'},
      {type:'autoLine',a:lp1,b:lp2,color:'#ff5d5d',width:Math.max(3,w/450),label:'Hovvegg'},
      {type:'autoLine',a:rp1,b:rp2,color:'#ff5d5d',width:Math.max(3,w/450),label:'Hovvegg'},
      {type:'angle',points:[lp1,lp2,{x:lp2.x+Math.max(w*.16,120),y:lp2.y}],color:'#ff5d5d',width:Math.max(3,w/450),auto:true},
      {type:'angle',points:[{x:rp2.x-Math.max(w*.16,120),y:rp2.y},rp2,rp1],color:'#ff5d5d',width:Math.max(3,w/450),auto:true}
    ];
  }
  function fallbackAutomaticHoofAnalysis(w,h){
    return [
      {type:'autoLine',a:{x:w*.5,y:h*.08},b:{x:w*.5,y:h*.92},color:'#00e5ff',width:3,label:'Senterakse'},
      {type:'autoLine',a:{x:w*.16,y:h*.88},b:{x:w*.84,y:h*.88},color:'#ffe066',width:3,label:'Underlag'},
      {type:'autoLine',a:{x:w*.34,y:h*.42},b:{x:w*.22,y:h*.88},color:'#ff5d5d',width:4,label:'Hovvegg'},
      {type:'autoLine',a:{x:w*.66,y:h*.42},b:{x:w*.78,y:h*.88},color:'#ff5d5d',width:4,label:'Hovvegg'},
      {type:'angle',points:[{x:w*.34,y:h*.42},{x:w*.22,y:h*.88},{x:w*.42,y:h*.88}],color:'#ff5d5d',width:4,auto:true},
      {type:'angle',points:[{x:w*.58,y:h*.88},{x:w*.78,y:h*.88},{x:w*.66,y:h*.42}],color:'#ff5d5d',width:4,auto:true}
    ];
  }

  function drawHoofGuides(ctx,w,h){
    ctx.save();ctx.strokeStyle='rgba(0,255,255,.72)';ctx.lineWidth=Math.max(1,Math.round(Math.min(w,h)/700));ctx.setLineDash([12,10]);
    const xs=[w/3,w/2,2*w/3],ys=[h/3,h/2,2*h/3];
    xs.forEach(x=>{ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();});ys.forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();});ctx.restore();
  }
  function drawHoofEditor(){
    const e=hoofImageEditor,c=e.canvas,ctx=e.ctx,img=e.image;if(!c||!ctx)return;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#111';ctx.fillRect(0,0,c.width,c.height);if(!img)return;ctx.drawImage(img,0,0,c.width,c.height);if(e.guides)drawHoofGuides(ctx,c.width,c.height);if(e.autoAnalysis)[...(e.autoObjects||[])].forEach(o=>drawHoofObject(ctx,o));[...e.objects,...(e.draft?[e.draft]:[])].forEach(o=>drawHoofObject(ctx,o));
  }
  function drawHoofObject(ctx,o){
    ctx.save();ctx.strokeStyle=o.color||'#ff2d2d';ctx.fillStyle=o.color||'#ff2d2d';ctx.lineWidth=o.width||4;ctx.lineCap='round';ctx.lineJoin='round';
    const dot=p=>{ctx.beginPath();ctx.arc(p.x,p.y,Math.max(5,(o.width||4)*1.7),0,Math.PI*2);ctx.fill();};
    if(o.type==='autoLine'){ctx.setLineDash([14,8]);ctx.beginPath();ctx.moveTo(o.a.x,o.a.y);ctx.lineTo(o.b.x,o.b.y);ctx.stroke();ctx.setLineDash([]);if(o.label){ctx.font='bold 18px system-ui';ctx.lineWidth=4;ctx.strokeStyle='#000';ctx.strokeText(o.label,(o.a.x+o.b.x)/2+8,(o.a.y+o.b.y)/2-8);ctx.fillStyle=o.color;ctx.fillText(o.label,(o.a.x+o.b.x)/2+8,(o.a.y+o.b.y)/2-8);}}
    if(o.type==='line'){ctx.beginPath();ctx.moveTo(o.a.x,o.a.y);ctx.lineTo(o.b.x,o.b.y);ctx.stroke();dot(o.a);dot(o.b);const d=Math.hypot(o.b.x-o.a.x,o.b.y-o.a.y);ctx.font='bold 22px system-ui';ctx.lineWidth=4;ctx.strokeStyle='#000';const t=Math.round(d)+' px';ctx.strokeText(t,(o.a.x+o.b.x)/2+8,(o.a.y+o.b.y)/2-8);ctx.fillStyle=o.color||'#ff2d2d';ctx.fillText(t,(o.a.x+o.b.x)/2+8,(o.a.y+o.b.y)/2-8);}
    if(o.type==='draw'&&o.points.length){ctx.beginPath();ctx.moveTo(o.points[0].x,o.points[0].y);o.points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();}
    if(o.type==='text'){ctx.font=`bold ${Math.max(22,(o.width||4)*6)}px system-ui`;ctx.lineWidth=Math.max(3,o.width||4);ctx.strokeStyle='#000';ctx.strokeText(o.text,o.p.x,o.p.y);ctx.fillStyle=o.color||'#ff2d2d';ctx.fillText(o.text,o.p.x,o.p.y);}
    if(o.type==='angle'){const ps=o.points||[];if(ps.length){ps.forEach(dot);ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);if(ps[1])ctx.lineTo(ps[1].x,ps[1].y);if(ps[2])ctx.lineTo(ps[2].x,ps[2].y);ctx.stroke();}if(ps.length===3){const a=Math.atan2(ps[0].y-ps[1].y,ps[0].x-ps[1].x),b=Math.atan2(ps[2].y-ps[1].y,ps[2].x-ps[1].x);let deg=Math.abs((b-a)*180/Math.PI);if(deg>180)deg=360-deg;ctx.font='bold 25px system-ui';ctx.lineWidth=4;ctx.strokeStyle='#000';const t=deg.toFixed(1)+'°';ctx.strokeText(t,ps[1].x+14,ps[1].y-14);ctx.fillStyle=o.color||'#ff2d2d';ctx.fillText(t,ps[1].x+14,ps[1].y-14);}}
    ctx.restore();
  }
  function saveHoofEditorCopy(){
    const e=hoofImageEditor;if(!e.image){hoofEditorSetStatus('Ingen bilde å lagre.',true);return;}drawHoofEditor();hoofEditorSetStatus('Lager bildekopi ...');
    try{e.canvas.toBlob(blob=>{if(!blob){hoofEditorSetStatus('Kunne ikke lage bildekopi.',true);return;}const stamp=new Date().toISOString().replace(/[:.]/g,'-');const file=new File([blob],`hovanalyse-${stamp}.jpg`,{type:'image/jpeg'});const key=[file.name,file.size,file.lastModified].join(':');app.pendingJobbFiles=app.pendingJobbFiles||[];app.pendingJobbFiles.push({file,url:URL.createObjectURL(file),dato:e.sourceDate||val('jobbBildeDato')||val('jobbDato')||today(),key});renderCombinedJobbBildePreview();closeHoofEditor();msg('jobbMsg','Analysert bilde er lagt til som ny kopi. Trykk Lagre jobb for å laste det opp.','ok');},'image/jpeg',0.93);}catch(err){console.error(err);hoofEditorSetStatus('Lagring ble blokkert av nettleseren.',true);}
  }
  function openImageLightbox(src){
    if(!src) return;
    let box=document.getElementById('imageLightbox');
    if(!box){
      box=document.createElement('div');
      box.id='imageLightbox';
      box.className='image-lightbox';
      box.innerHTML='<button type="button" aria-label="Lukk bilde">×</button><img alt="Stort bilde">';
      document.body.appendChild(box);
      box.addEventListener('click',ev=>{ if(ev.target===box || ev.target.tagName==='BUTTON') box.classList.remove('open'); });
      document.addEventListener('keydown',ev=>{ if(ev.key==='Escape') box.classList.remove('open'); });
    }
    box.querySelector('img').src=src;
    box.classList.add('open');
  }
  document.addEventListener('click',ev=>{
    const analyze=ev.target.closest && ev.target.closest('[data-analyze-src]');
    if(analyze){ ev.preventDefault(); ev.stopPropagation(); openHoofEditor(analyze.dataset.analyzeSrc, analyze.dataset.analyzeDate); return; }
    const del=ev.target.closest && ev.target.closest('[data-delete-jobb-bilde]');
    if(del){ ev.preventDefault(); ev.stopPropagation(); deleteJobbBildeFromPreview(del); return; }
    const img=ev.target.closest && ev.target.closest('[data-full-src]');
    if(img){ ev.preventDefault(); openImageLightbox(img.dataset.fullSrc || img.src); }
  });
  async function uploadAppFile(file, folder){
    if(!file) return null;
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=`${app.firmaId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName(file.name||('bilde.'+ext))}`;
    const up=await app.sb.storage.from(PRIVATE_IMAGE_BUCKET).upload(path,file,{upsert:true,contentType:file.type||'image/jpeg'});
    if(up.error) throw new Error('Bilde kunne ikke lastes opp: '+up.error.message+' (Sjekk at storage bucket '+PRIVATE_IMAGE_BUCKET+' finnes, er privat, og har policy for innlogget opplasting.)');
    const url=await signedImageUrl(path);
    return {url,path};
  }

  async function init(){
    app.sb = window.supabaseClient;
    if(!app.sb){ alert('Mangler Supabase-klient. Sjekk ../js/hovslager/config.js'); return; }
    bind();
    $('jobbDato') && ($('jobbDato').value = today());
    setVal('jobbKmPris','5,30');
    setVal('jobbVarer','');
    setVal('jobbKm','');
    setVal('jobbBildeDato', today());
    const remember = localStorage.getItem(REMEMBER_LOGIN_KEY);
    if($('rememberLogin')) $('rememberLogin').checked = remember !== '0';
    const { data } = await app.sb.auth.getSession();
    app.session = data.session;
    app.user = data.session?.user || null;
    if(app.user){
      const ok = await requireLocalUnlockIfEnabled();
      if(ok) await startApp();
      else { await app.sb.auth.signOut(); app.session=null; app.user=null; showLogin(true); msg('loginMsg','Appen er låst. Logg inn med passord for å fortsette.','err'); }
    } else showLogin(true);
  }

  async function testTripletexConnection(){
    const button=$('testTripletexBtn');
    const result=$('tripletexTestResult');
    if(!app.sb){ msg('tripletexTestMsg','Supabase-klienten er ikke klar. Logg inn og prøv igjen.','err'); return; }
    if(button){ button.disabled=true; button.textContent='Tester ...'; }
    if(result){ result.classList.add('hidden'); result.textContent=''; }
    msg('tripletexTestMsg','Kontakter Tripletex-funksjonen ...');
    try{
      const {data,error}=await app.sb.functions.invoke('tripletex',{body:{appId:'hov',action:'test_connection'}});
      if(error) throw error;
      msg('tripletexTestMsg','Tripletex-funksjonen svarte. Se resultatet under.','ok');
      if(result){ result.textContent=JSON.stringify(data,null,2); result.classList.remove('hidden'); }
    }catch(e){
      let responseBody=null;
      let status=null;
      try{
        if(e?.context instanceof Response){
          status=e.context.status;
          const text=await e.context.text();
          try{ responseBody=JSON.parse(text); }catch(_){ responseBody=text||null; }
        }
      }catch(_){ /* behold originalfeilen hvis responsen ikke kan leses */ }
      const details={message:e?.message||String(e), name:e?.name||'', status, response:responseBody};
      const specific=responseBody?.error||responseBody?.message||details.message;
      msg('tripletexTestMsg','Testen feilet: '+specific,'err');
      if(result){ result.textContent=JSON.stringify(details,null,2); result.classList.remove('hidden'); }
      console.error('Tripletex-test feilet',e,details);
    }finally{
      if(button){ button.disabled=false; button.textContent='Test Tripletex'; }
    }
  }

  function ensureTripletexTestUi(){
    const loadButton=$('loadFakturaBtn');
    if(!loadButton) return;
    let button=$('testTripletexBtn');
    if(!button){
      button=document.createElement('button');
      button.id='testTripletexBtn';
      button.type='button';
      button.textContent='Test Tripletex';
      loadButton.insertAdjacentElement('afterend', button);
    }
    const actions=loadButton.closest('.actions');
    const section=loadButton.closest('#fakturaer');
    if(section && !$('tripletexTestMsg')){
      const message=document.createElement('div');
      message.id='tripletexTestMsg';
      (actions || loadButton).insertAdjacentElement('afterend', message);
    }
    if(section && !$('tripletexTestResult')){
      const result=document.createElement('pre');
      result.id='tripletexTestResult';
      result.className='hidden';
      result.style.cssText='white-space:pre-wrap;word-break:break-word;background:#0b1220;border:1px solid var(--border);border-radius:12px;padding:12px;max-height:320px;overflow:auto';
      const message=$('tripletexTestMsg');
      (message || actions || loadButton).insertAdjacentElement('afterend', result);
    }
  }


  const ECONOMY_PROVIDER_NAMES={tripletex:'Tripletex',fiken:'Fiken',poweroffice:'PowerOffice Go',fortnox:'Fortnox',visma:'Visma eAccounting',none:'Kun Hovslager'};
  function economyStorageKey(){ return 'hov_economy_provider_'+String(app.firmaId||'default'); }
  function selectedEconomyProvider(){
    const cfg=window.HovIntegrationCore?.loadConfig(app.firmaId);
    return cfg?.provider || localStorage.getItem(economyStorageKey()) || 'tripletex';
  }
  function invoiceIsTripletex(f){ return !!tripletexInvoiceId(f) || /Tripletex/i.test(String(f?.tekst||'')); }
  function integrationCore(){ return window.HovIntegrationCore || null; }
  function integrationConfigFromUi(){
    const core=integrationCore();
    const provider=document.querySelector('input[name="economyProvider"]:checked')?.value || selectedEconomyProvider();
    const scopes={}; document.querySelectorAll('[data-integration-scope]').forEach(el=>scopes[el.dataset.integrationScope]=!!el.checked);
    const old=core?.loadConfig(app.firmaId)||{};
    return Object.assign({},old,{provider,companyId:$('integrationCompanyId')?.value?.trim()||'',backendUrl:$('integrationBackendUrl')?.value?.trim()||'',direction:$('integrationDirection')?.value||'push',intervalMinutes:Number($('integrationInterval')?.value||60),autoSync:!!$('integrationAutoSync')?.checked,enabled:!!$('integrationEnabled')?.checked,scopes});
  }
  function renderIntegrationLists(){
    const core=integrationCore(); if(!core) return;
    const queue=core.listQueue(app.firmaId), logs=core.listLog(app.firmaId);
    if($('integrationQueueCount')) $('integrationQueueCount').textContent=String(queue.filter(x=>x.status==='pending').length);
    if($('integrationLastActivity')) $('integrationLastActivity').textContent=logs[0]?.createdAt ? new Date(logs[0].createdAt).toLocaleString() : 'Ingen';
    if($('integrationQueueList')) $('integrationQueueList').innerHTML=queue.length?queue.slice(0,20).map(q=>'<div class="integration-row"><span class="integration-badge">'+esc(q.status||'pending')+'</span> <strong>'+esc(q.operation||'sync')+'</strong><small>'+esc(q.entityType||q.entity_type||'data')+' · '+esc(q.provider||selectedEconomyProvider())+' · '+new Date(q.createdAt).toLocaleString()+'</small></div>').join(''):'<p class="muted">Køen er tom.</p>';
    if($('integrationLogList')) $('integrationLogList').innerHTML=logs.length?logs.slice(0,20).map(l=>'<div class="integration-row"><span class="integration-badge">'+esc(l.level||'info')+'</span> <strong>'+esc(l.event||'aktivitet')+'</strong><small>'+esc(l.message||'')+' · '+new Date(l.createdAt).toLocaleString()+'</small></div>').join(''):'<p class="muted">Ingen aktivitet er logget.</p>';
  }
  function renderIntegrationConfig(){
    const core=integrationCore(); if(!core){ msg('integrationConfigMsg','Integrasjonsmodulen kunne ikke lastes.','err'); return; }
    const cfg=core.loadConfig(app.firmaId);
    document.querySelectorAll('input[name="economyProvider"]').forEach(r=>r.checked=r.value===activeProvider);
    document.querySelectorAll('[data-provider-card]').forEach(c=>c.classList.toggle('selected',c.dataset.providerCard===activeProvider));
    if($('integrationCompanyId')) $('integrationCompanyId').value=cfg.companyId||'';
    if($('integrationBackendUrl')) $('integrationBackendUrl').value=cfg.backendUrl||'';
    if($('integrationDirection')) $('integrationDirection').value=cfg.direction||'push';
    if($('integrationInterval')) $('integrationInterval').value=String(cfg.intervalMinutes||60);
    if($('integrationAutoSync')) $('integrationAutoSync').checked=!!cfg.autoSync;
    if($('integrationEnabled')) $('integrationEnabled').checked=!!cfg.enabled;
    document.querySelectorAll('[data-integration-scope]').forEach(el=>el.checked=!!cfg.scopes?.[el.dataset.integrationScope]);
    const v=core.validate(cfg);
    if($('integrationReadiness')) $('integrationReadiness').textContent=activeProvider==='none'?'Lokal drift':(v.ok && !v.warnings.length?'Klar for API':'Klargjøring mangler');
    renderIntegrationLists();
  }
  function renderEconomyPage(){
    const provider=selectedEconomyProvider();
    document.querySelectorAll('input[name="economyProvider"]').forEach(r=>{ r.checked=r.value===provider; });
    document.querySelectorAll('[data-provider-card]').forEach(c=>c.classList.toggle('selected',c.dataset.providerCard===provider));
    const fs=app.data.fakturaer||[];
    if($('economySelectedName')) $('economySelectedName').textContent=ECONOMY_PROVIDER_NAMES[provider]||provider;
    if($('economyInvoiceCount')) $('economyInvoiceCount').textContent=String(fs.length);
    const workflow=$('economyWorkflow');
    if(workflow){
      if(provider==='tripletex') workflow.innerHTML='<ol><li>Lagre integrasjonsoppsettet.</li><li>Registrer sikker legitimasjon i backend/Edge Function.</li><li>Test eksisterende Tripletex-funksjon.</li><li>Koble kø og logger til database før automatisk synkronisering aktiveres.</li></ol>';
      else if(provider==='poweroffice') workflow.innerHTML='<ol><li>Velg PowerOffice Go og lagre systemvalget.</li><li>Distribuer Edge Function og registrer nøklene som Supabase secrets.</li><li>Trykk Test tilkobling.</li><li>Når testen er grønn, kobles kunder og fakturautkast til samme adapter.</li></ol>';
      else if(provider==='none') workflow.innerHTML='<p>Fakturaer opprettes og følges opp lokalt i Hovslager. Ingen data sendes til et eksternt økonomisystem.</p>';
      else workflow.innerHTML='<ol><li>Velg hvilke data som skal synkroniseres.</li><li>Angi firma-ID og backend-adresse.</li><li>Implementer OAuth/API-adapteren på sikker backend.</li><li>Test mot leverandørens sandbox.</li><li>Aktiver automatisk synkronisering etter godkjent test.</li></ol>';
    }
    renderIntegrationConfig();
  }
  function saveEconomyProvider(){
    const core=integrationCore(); const picked=document.querySelector('input[name="economyProvider"]:checked')?.value || 'tripletex';
    localStorage.setItem(economyStorageKey(),picked);
    if(core){const cfg=core.loadConfig(app.firmaId);cfg.provider=picked;core.saveConfig(app.firmaId,cfg);core.addLog(app.firmaId,{provider:picked,event:'provider_selected',message:'Valgt system: '+(ECONOMY_PROVIDER_NAMES[picked]||picked)});}
    renderEconomyPage(); msg('economyMsg','Systemvalg lagret: '+(ECONOMY_PROVIDER_NAMES[picked]||picked)+'.','ok');
  }
  function saveIntegrationConfig(){
    const core=integrationCore(); if(!core) return;
    const cfg=integrationConfigFromUi();
    if(selectedEconomyProvider()==='poweroffice' || cfg.provider==='poweroffice'){ cfg.provider='poweroffice'; cfg.companyId=cfg.companyId||'poweroffice'; cfg.backendUrl='supabase:functions/poweroffice'; }
    const validation=core.validate(cfg);
    if(cfg.enabled && !validation.ok){msg('integrationConfigMsg',validation.errors.join(' '),'err');return;}
    core.saveConfig(app.firmaId,cfg); localStorage.setItem(economyStorageKey(),cfg.provider);
    core.addLog(app.firmaId,{provider:cfg.provider,event:'config_saved',message:'Integrasjonsoppsett lagret.'});
    renderEconomyPage();
    const extra=validation.warnings.length?' '+validation.warnings.join(' '):'';
    msg('integrationConfigMsg','Oppsettet er lagret.'+extra,validation.warnings.length?'err':'ok');
  }
  function validateIntegrationConfig(){
    const core=integrationCore(); if(!core) return;
    const cfg=integrationConfigFromUi(), v=core.validate(cfg);
    const parts=[]; if(v.errors.length) parts.push('Feil: '+v.errors.join(' ')); if(v.warnings.length) parts.push('Mangler: '+v.warnings.join(' ')); if(!parts.length) parts.push('Klargjøringen er komplett. Neste steg er å implementere og teste leverandørens API på backend.');
    msg('integrationConfigMsg',parts.join(' '),v.ok&&!v.warnings.length?'ok':'err');
  }

  async function callPowerOffice(payload){
    const response=await fetch('https://yxzdwrstpfxvxnbswyjf.supabase.co/functions/v1/poweroffice',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload||{})
    });
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch(_){data={message:text};}
    if(!response.ok){throw new Error(data?.error||data?.message||('PowerOffice svarte med HTTP '+response.status));}
    return data;
  }

  async function testIntegrationPlaceholder(){
    const core=integrationCore(); if(!core) return;
    const cfg=integrationConfigFromUi(), v=core.validate(cfg);
    if(cfg.provider==='poweroffice'){
      const button=$('testIntegrationPlaceholderBtn');
      const oldText=button?.textContent;
      try{
        if(button){button.disabled=true;button.textContent='Tester PowerOffice ...';}
        msg('integrationConfigMsg','Kontakter PowerOffice Go demo via sikker backend ...');
        const data=await callPowerOffice({action:'test_connection',firmaId:app.firmaId});
        if(!data?.ok) throw new Error(data?.error||'PowerOffice svarte uten bekreftelse.');
        const saved=Object.assign({},cfg,{credentialStatus:'ready',companyId:data.clientId||cfg.companyId||'demo',backendUrl:cfg.backendUrl||'supabase:functions/poweroffice'});
        core.saveConfig(app.firmaId,saved);
        core.addLog(app.firmaId,{provider:'poweroffice',event:'connection_test_ok',message:'PowerOffice-tilkoblingen er bekreftet.'});
        renderEconomyPage();
        msg('integrationConfigMsg','PowerOffice Go er tilkoblet. Token og API-tilgang ble godkjent.','ok');
      }catch(e){
        core.addLog(app.firmaId,{provider:'poweroffice',level:'error',event:'connection_test_failed',message:e?.message||String(e)});
        renderIntegrationLists();
        msg('integrationConfigMsg','PowerOffice-testen feilet: '+(e?.message||String(e)),'err');
      }finally{if(button){button.disabled=false;button.textContent=oldText||'Test tilkobling';}}
      return;
    }
    core.addLog(app.firmaId,{provider:cfg.provider,level:v.ok?'info':'error',event:'connection_precheck',message:v.ok?'Forhåndskontroll bestått.':v.errors.join(' ')});
    renderIntegrationLists();
    msg('integrationConfigMsg',v.ok?'Forhåndskontrollen bestod. API-adapter for valgt system er ikke aktivert ennå.':'Tilkoblingen kan ikke testes: '+v.errors.join(' '),v.ok?'ok':'err');
  }
  function addIntegrationTestQueue(){
    const core=integrationCore(); if(!core) return; const cfg=integrationConfigFromUi();
    core.addQueueItem(app.firmaId,{provider:cfg.provider,entityType:'invoice',operation:'test_sync',payload:{dryRun:true}});
    core.addLog(app.firmaId,{provider:cfg.provider,event:'queue_test_added',message:'Testjobb lagt i lokal kø.'}); renderIntegrationLists();
  }
  function clearIntegrationQueue(){const core=integrationCore();if(!core||!confirm('Tømme hele den lokale synkroniseringskøen?'))return;core.clearQueue(app.firmaId);core.addLog(app.firmaId,{provider:selectedEconomyProvider(),event:'queue_cleared',message:'Lokal kø tømt.'});renderIntegrationLists();}
  function clearIntegrationLog(){const core=integrationCore();if(!core||!confirm('Tømme aktivitetsloggen?'))return;core.clearLog(app.firmaId);renderIntegrationLists();}
  function exportIntegrationConfig(){
    const core=integrationCore();if(!core)return;const blob=new Blob([JSON.stringify(core.exportBundle(app.firmaId),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='hovslager-integrasjon-'+String(app.firmaId||'firma')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  async function refreshEconomyOverview(){msg('economyMsg','Oppdaterer fakturaoversikten ...');await loadFakturaer();renderEconomyPage();msg('economyMsg','Økonomioversikten er oppdatert.','ok');}
  async function testTripletexFromEconomy(){const status=$('economyTripletexStatus');if(status)status.textContent='Tester tilkoblingen ...';await testTripletexConnection();if(status)status.textContent='Testen er kjørt. Se detaljene under Faktura.';}



  // Kalender og GPS
  const calendarState={date:new Date(), currentPosition:null};
  function localIsoDate(d){ const x=new Date(d.getTime()-d.getTimezoneOffset()*60000); return x.toISOString().slice(0,10); }
  function jobCustomer(j){ return app.data.kunder.find(k=>String(k.id)===String(j?.kunde_id)); }
  function jobHorse(j){ return app.data.hester.find(h=>String(h.id)===String(j?.hest_id)); }
  function jobsOnDate(date){ return (app.data.jobber||[]).filter(j=>String(j.dato||'').slice(0,10)===date).sort((a,b)=>String(a.id).localeCompare(String(b.id))); }
  function norwegianMonth(d){ return new Intl.DateTimeFormat('nb-NO',{month:'long',year:'numeric'}).format(d); }
  function renderCalendar(){
    const grid=$('calendarGrid'); if(!grid) return;
    const d=calendarState.date, year=d.getFullYear(), month=d.getMonth();
    setText('calendarTitle',norwegianMonth(d));
    const first=new Date(year,month,1); const mondayOffset=(first.getDay()+6)%7;
    const start=new Date(year,month,1-mondayOffset); const todayIso=localIsoDate(new Date());
    const weekdays=['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
    let html=weekdays.map(x=>`<div class="calendar-weekday">${x}</div>`).join('');
    for(let i=0;i<42;i++){
      const day=new Date(start); day.setDate(start.getDate()+i); const iso=localIsoDate(day); const jobs=jobsOnDate(iso);
      const cls=['calendar-day',day.getMonth()!==month?'outside':'',iso===todayIso?'today':'',jobs.length?'has-jobs':''].filter(Boolean).join(' ');
      html+=`<div class="${cls}" data-date="${iso}"><div class="calendar-day-number">${day.getDate()}</div>${jobs.slice(0,4).map(j=>{const k=jobCustomer(j),h=jobHorse(j);return `<button type="button" class="calendar-job" data-job-id="${esc(j.id)}"><strong>${esc(h?.navn||'Pasient')}</strong><span>${esc(k?.navn||'Ukjent kunde')}</span></button>`}).join('')}${jobs.length>4?`<div class="muted">+${jobs.length-4} flere</div>`:''}</div>`;
    }
    grid.innerHTML=html;
    grid.querySelectorAll('.calendar-job').forEach(btn=>btn.addEventListener('click',()=>viewJobb(btn.dataset.jobId)));
  }
  function changeCalendarMonth(delta){ calendarState.date=new Date(calendarState.date.getFullYear(),calendarState.date.getMonth()+delta,1); renderCalendar(); }
  function customerAddressForJob(j){ return String(jobCustomer(j)?.adresse||'').trim(); }
  function mapsSearchUrl(address){ return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address); }
  function mapsDirectionsUrl(address){
    let url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address)+'&travelmode=driving&dir_action=navigate';
    if(calendarState.currentPosition) url+='&origin='+encodeURIComponent(calendarState.currentPosition.lat+','+calendarState.currentPosition.lng);
    return url;
  }
  let navigationReturnState=null;
  function ensureNavigationReturnButton(){
    let btn=document.getElementById('navigationReturnButton');
    if(btn)return btn;
    btn=document.createElement('button');
    btn.id='navigationReturnButton';
    btn.type='button';
    btn.textContent='← Tilbake til HovSpr';
    btn.setAttribute('aria-label','Tilbake til HovSpr');
    btn.style.cssText='position:fixed;left:16px;bottom:16px;z-index:99999;padding:14px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:#b58524;color:#fff;font-weight:800;font-size:15px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:none;cursor:pointer';
    btn.addEventListener('click',()=>{
      btn.style.display='none';
      const state=navigationReturnState;
      navigationReturnState=null;
      if(state?.jobId){ viewJobb(state.jobId); return; }
      if(typeof showSection==='function') showSection(state?.section||'gps');
    });
    document.body.appendChild(btn);
    return btn;
  }
  function navigationPanelLabels(){
    const lang=(window.HovI18n?.getLanguage?.()||localStorage.getItem('hov_language')||'nb').slice(0,2);
    if(lang==='sv') return {title:'HovSpr navigering',back:'← Tillbaka till HovSpr',close:'Stäng kartan och gå tillbaka',hint:'Den här lilla HovSpr-rutan ligger ovanpå Google Maps.'};
    if(lang==='en') return {title:'HovSpr navigation',back:'← Back to HovSpr',close:'Close map and return',hint:'This small HovSpr panel stays visible above Google Maps.'};
    return {title:'HovSpr navigering',back:'← Tilbake til HovSpr',close:'Lukk kartet og gå tilbake',hint:'Denne lille HovSpr-ruten ligger synlig over Google Maps.'};
  }
  function returnFromNavigation(state,mapWindow,closeMap){
    if(closeMap && mapWindow && !mapWindow.closed){ try{ mapWindow.close(); }catch(e){} }
    try{ window.focus(); }catch(e){}
    navigationReturnState=null;
    const btn=document.getElementById('navigationReturnButton'); if(btn) btn.style.display='none';
    if(state?.jobId){ viewJobb(state.jobId); return; }
    if(typeof showSection==='function') showSection(state?.section||'gps');
  }
  async function showNavigationCompanion(returnState,mapWindow){
    const labels=navigationPanelLabels();
    const buildPanel=(doc,hostWindow,isPip)=>{
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${labels.title}</title><style>
        *{box-sizing:border-box}body{margin:0;background:#0d1624;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:14px}main{display:grid;gap:10px;height:100%;align-content:center}.brand{font-weight:900;font-size:18px;color:#f1c15b}.hint{font-size:12px;line-height:1.35;color:#cbd5e1}.back{width:100%;border:0;border-radius:12px;padding:14px 12px;background:#b58524;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.close{width:100%;border:1px solid #64748b;border-radius:12px;padding:11px 10px;background:#243247;color:#fff;font-weight:700;font-size:13px;cursor:pointer}</style></head><body><main><div class="brand">🐎 HovSpr</div><div class="hint">${labels.hint}</div><button id="hovBack" class="back">${labels.back}</button><button id="hovClose" class="close">${labels.close}</button></main></body></html>`);
      doc.close();
      doc.getElementById('hovBack')?.addEventListener('click',()=>{ returnFromNavigation(returnState,mapWindow,false); if(isPip) try{hostWindow.close()}catch(e){} });
      doc.getElementById('hovClose')?.addEventListener('click',()=>{ returnFromNavigation(returnState,mapWindow,true); try{hostWindow.close()}catch(e){} });
    };
    if('documentPictureInPicture' in window){
      try{
        const pipWindow=await window.documentPictureInPicture.requestWindow({width:310,height:210});
        buildPanel(pipWindow.document,pipWindow,true);
        return;
      }catch(e){ console.warn('Kunne ikke åpne bilde-i-bilde-panel:',e); }
    }
    try{
      const mini=window.open('','HovSprNavigationPanel','popup=yes,width=330,height=240,left=24,top=80');
      if(mini){ buildPanel(mini.document,mini,false); try{mini.focus()}catch(e){} }
    }catch(e){ console.warn('Kunne ikke åpne navigasjonspanel:',e); }
  }
  function openExternalUrl(url,returnState){
    navigationReturnState=returnState||{section:'gps'};
    const state=navigationReturnState;
    const returnBtn=ensureNavigationReturnButton();
    const mapWindow=window.open('about:blank','_blank');
    showNavigationCompanion(state,mapWindow);
    if(!mapWindow){
      window.location.href=url;
      return;
    }
    try{ mapWindow.opener=null; }catch(e){}
    mapWindow.location.href=url;
    setTimeout(()=>{ returnBtn.style.display='block'; },250);
  }
  window.addEventListener('focus',()=>{
    if(navigationReturnState) ensureNavigationReturnButton().style.display='block';
  });
  function navigateToJob(id){ const j=(app.data.jobber||[]).find(x=>String(x.id)===String(id)); if(!j)return; const a=customerAddressForJob(j); if(!a){alert('Kunden mangler adresse. Legg inn adresse under Kunder først.');return;} openExternalUrl(mapsDirectionsUrl(a),{jobId:j.id,section:'gps'}); }
  function navigateOpenJobb(){ const id=app.viewJobbId||app.edit.jobb; if(id) navigateToJob(id); }
  function renderGps(){
    const date=$('gpsDate')?.value||localIsoDate(new Date()); const jobs=jobsOnDate(date); const list=$('gpsList'); if(!list)return;
    const withAddress=jobs.filter(j=>customerAddressForJob(j)); const totalKm=jobs.reduce((n,j)=>n+(Number(j.km)||0),0);
    $('gpsSummary').innerHTML=`<div class="gps-stat"><span class="muted">Pasienter</span><strong>${jobs.length}</strong></div><div class="gps-stat"><span class="muted">Med adresse</span><strong>${withAddress.length}</strong></div><div class="gps-stat"><span class="muted">Registrert km</span><strong>${totalKm.toLocaleString('nb-NO')}</strong></div>`;
    if(!jobs.length){list.innerHTML='<div class="calendar-empty">Ingen jobber denne dagen.</div>';return;}
    list.innerHTML=jobs.map((j,i)=>{const k=jobCustomer(j),h=jobHorse(j),a=customerAddressForJob(j);return `<article class="gps-card"><div class="gps-card-head"><div><h3>${esc(h?.navn||'Pasient')}</h3><div>${esc(k?.navn||'Ukjent kunde')}</div><div class="gps-address">${a?esc(a):'⚠️ Kunden mangler adresse'}</div></div><span class="gps-order">${i+1}</span></div><div class="actions"><button type="button" class="secondary gps-open-job" data-id="${esc(j.id)}">Åpne jobb</button><button type="button" class="gps-navigate" data-id="${esc(j.id)}" ${a?'':'disabled'}>📍 Naviger</button>${a?`<button type="button" class="secondary gps-map" data-address="${esc(a)}">Vis kart</button>`:''}</div></article>`}).join('');
    list.querySelectorAll('.gps-open-job').forEach(b=>b.addEventListener('click',()=>viewJobb(b.dataset.id)));
    list.querySelectorAll('.gps-navigate').forEach(b=>b.addEventListener('click',()=>navigateToJob(b.dataset.id)));
    list.querySelectorAll('.gps-map').forEach(b=>b.addEventListener('click',()=>openExternalUrl(mapsSearchUrl(b.dataset.address))));
    renderRouteLegs();
  }
  function gpsErrorText(err){
    if(!err) return 'Ukjent GPS-feil.';
    if(err.code===1) return 'Tilgang til posisjon er avslått. Åpne innstillinger for nettleseren/appen og tillat posisjon.';
    if(err.code===2) return 'Posisjonen kunne ikke bestemmes. Slå på stedstjenester/GPS og prøv igjen utendørs.';
    if(err.code===3) return 'GPS-søket tok for lang tid. Prøv igjen, gjerne utendørs.';
    return err.message || 'Kunne ikke hente GPS-posisjon.';
  }
  function showGpsPositionActions(show){ $('gpsPositionActions')?.classList.toggle('hidden',!show); }
  async function locateUser(){
    showGpsPositionActions(false);
    if(!window.isSecureContext && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
      msg('gpsPosition','GPS krever HTTPS. Åpne appen fra en HTTPS-adresse (eller localhost), ikke vanlig http:// på lokal IP. Navigasjon til kunde virker fortsatt uten denne posisjonen.','err');
      return;
    }
    if(!navigator.geolocation){msg('gpsPosition','GPS støttes ikke av denne enheten eller nettleseren.','err');return;}
    if(navigator.permissions?.query){
      try{
        const permission=await navigator.permissions.query({name:'geolocation'});
        if(permission.state==='denied'){
          msg('gpsPosition','Posisjon er blokkert. Tillat posisjon i nettleserens eller appens innstillinger, og last siden på nytt.','err');
          return;
        }
      }catch(_){ /* Safari støtter ikke alltid Permissions API for geolocation. */ }
    }
    setText('gpsPosition','Finner posisjonen din …');
    navigator.geolocation.getCurrentPosition(pos=>{
      calendarState.currentPosition={lat:pos.coords.latitude,lng:pos.coords.longitude};
      setText('gpsPosition',`Posisjon funnet · nøyaktighet ca. ${Math.round(pos.coords.accuracy)} m`);
      showGpsPositionActions(true);
      renderGps();
    },err=>{
      calendarState.currentPosition=null;
      msg('gpsPosition',gpsErrorText(err),'err');
      showGpsPositionActions(false);
    },{enableHighAccuracy:true,timeout:20000,maximumAge:30000});
  }
  function openCurrentPosition(){
    const p=calendarState.currentPosition;
    if(!p){ locateUser(); return; }
    openExternalUrl('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.lat+','+p.lng));
  }
  function routeAddressesForDate(date){
    const seen=new Set();
    return jobsOnDate(date).map(customerAddressForJob).filter(address=>{
      const key=String(address||'').trim().toLocaleLowerCase('nb-NO');
      if(!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function routeUrlForAddresses(addresses, origin){
    if(!addresses.length) return '';
    const destination=addresses[addresses.length-1];
    const waypoints=addresses.slice(0,-1);
    let url='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(destination)+'&travelmode=driving&dir_action=navigate';
    if(origin) url+='&origin='+encodeURIComponent(origin);
    if(waypoints.length) url+='&waypoints='+encodeURIComponent(waypoints.join('|'));
    return url;
  }
  function routeLegs(addresses){
    const maxStops=9; // Del lange dager i pålitelige kart-etapper.
    const legs=[];
    for(let i=0;i<addresses.length;i+=maxStops) legs.push(addresses.slice(i,i+maxStops));
    return legs;
  }
  function renderRouteLegs(){
    const date=$('gpsDate')?.value||localIsoDate(new Date());
    const addresses=routeAddressesForDate(date);
    const holder=$('gpsRouteLegs');
    const info=$('gpsRouteInfo');
    if(!holder||!info) return;
    holder.innerHTML=''; holder.classList.add('hidden');
    if(!addresses.length){ info.textContent='Ingen registrerte adresser for valgt dag.'; return; }
    const legs=routeLegs(addresses);
    info.textContent=addresses.length+' stopp i dagens rute'+(legs.length>1?' · delt i '+legs.length+' etapper':'')+'.';
    if(legs.length>1){
      holder.innerHTML=legs.map((leg,i)=>`<button type="button" class="secondary gps-route-leg" data-leg="${i}">Etappe ${i+1} · ${leg.length} stopp</button>`).join('');
      holder.classList.remove('hidden');
      holder.querySelectorAll('.gps-route-leg').forEach(btn=>btn.addEventListener('click',()=>openRouteLeg(Number(btn.dataset.leg))));
    }
  }
  function openRouteLeg(index){
    const date=$('gpsDate')?.value||localIsoDate(new Date());
    const legs=routeLegs(routeAddressesForDate(date));
    const leg=legs[index]; if(!leg?.length) return;
    let origin='';
    if(index===0 && calendarState.currentPosition) origin=calendarState.currentPosition.lat+','+calendarState.currentPosition.lng;
    else if(index>0) origin=legs[index-1][legs[index-1].length-1];
    openExternalUrl(routeUrlForAddresses(leg,origin));
  }
  function openWholeRoute(){
    const date=$('gpsDate')?.value||localIsoDate(new Date());
    const addresses=routeAddressesForDate(date);
    if(!addresses.length){alert('Ingen kunde-adresser er registrert denne dagen.');return;}
    const legs=routeLegs(addresses);
    if(legs.length>1){
      renderRouteLegs();
      alert('Dagens rute har '+addresses.length+' stopp og er delt i '+legs.length+' etapper. Første etappe åpnes nå. De neste kan åpnes fra GPS-siden.');
    }
    openRouteLeg(0);
  }

  function openJobbSmsMenu(){
    const id=app.viewJobbId || app.edit.jobb;
    const jobb=(app.data.jobber||[]).find(j=>String(j.id)===String(id));
    if(!jobb){ alert('Åpne en jobb først.'); return; }
    const kunde=jobCustomer(jobb);
    const telefon=String(kunde?.telefon||'').trim();
    if(!telefon){ alert('Kunden mangler telefonnummer. Legg inn telefonnummer på kunden først.'); return; }
    const recipient=$('jobSmsRecipient');
    if(recipient) recipient.textContent=(kunde?.navn||'Kunde')+' · '+telefon;
    const dialog=$('jobSmsDialog');
    if(dialog?.showModal) dialog.showModal(); else dialog?.setAttribute('open','');
  }
  function closeJobbSmsMenu(){ const dialog=$('jobSmsDialog'); if(dialog?.close) dialog.close(); else dialog?.removeAttribute('open'); }
  function smsTemplateText(kind,jobb,kunde,hest){
    const navn=kunde?.navn||'kunde';
    const pasient=hest?.navn ? ' for '+hest.navn : '';
    const dato=jobb?.dato ? ' '+jobb.dato : '';
    if(kind==='onway') return `Hei ${navn}! Jeg er på vei til avtalen${pasient}. Hilsen hovslageren.`;
    if(kind==='delay') return `Hei ${navn}! Jeg blir litt forsinket til avtalen${pasient}${dato}. Beklager forsinkelsen. Hilsen hovslageren.`;
    if(kind==='reminder') return `Hei ${navn}! Dette er en påminnelse om avtalen${pasient}${dato}. Hilsen hovslageren.`;
    return '';
  }
  function openSmsComposer(kind){
    const id=app.viewJobbId || app.edit.jobb;
    const jobb=(app.data.jobber||[]).find(j=>String(j.id)===String(id));
    const kunde=jobCustomer(jobb), hest=jobHorse(jobb);
    const telefon=String(kunde?.telefon||'').trim();
    if(!jobb || !telefon){ closeJobbSmsMenu(); alert('Fant ikke jobb eller telefonnummer.'); return; }
    let text=smsTemplateText(kind,jobb,kunde,hest);
    if(kind==='custom'){
      const custom=prompt('Skriv SMS-meldingen:','Hei '+(kunde?.navn||'')+'! ');
      if(custom===null) return;
      text=custom.trim();
      if(!text){ alert('Meldingen er tom.'); return; }
    }
    closeJobbSmsMenu();
    const cleanPhone=telefon.replace(/[^+\d]/g,'');
    const separator=/iPad|iPhone|iPod/.test(navigator.userAgent)?'&':'?';
    location.href='sms:'+cleanPhone+separator+'body='+encodeURIComponent(text);
  }

  function bind(){
    ensureTripletexTestUi();
    $('loginBtn')?.addEventListener('click', login);
    $('resetBtn')?.addEventListener('click', resetPassword);
    $('logoutBtn')?.addEventListener('click', logout);
    $('enableBioBtn')?.addEventListener('click', enableLocalLock);
    $('rememberLogin')?.addEventListener('change', ()=>localStorage.setItem(REMEMBER_LOGIN_KEY, $('rememberLogin')?.checked ? '1' : '0'));
    $('refreshBtn')?.addEventListener('click', loadAll);
    $('calendarPrevBtn')?.addEventListener('click',()=>changeCalendarMonth(-1));
    $('calendarNextBtn')?.addEventListener('click',()=>changeCalendarMonth(1));
    $('calendarTodayBtn')?.addEventListener('click',()=>{calendarState.date=new Date();renderCalendar();});
    $('gpsDate')?.addEventListener('change',renderGps);
    $('gpsMyPositionBtn')?.addEventListener('click',locateUser);
    $('gpsOpenRouteBtn')?.addEventListener('click',openWholeRoute);
    $('gpsOpenPositionBtn')?.addEventListener('click',openCurrentPosition);
    $('readLastJobbBtn')?.addEventListener('click', readLastJobbAsNew);
    $('navReadLastJobbBtn')?.addEventListener('click', startVoiceNyJobb);
    $('voiceNewJobbBtn')?.addEventListener('click', handleOneVoiceJobbButton);
    $('voiceStopJobbBtn')?.addEventListener('click', ()=>stopVoiceJobb(false));
    $('voiceUseTextJobbBtn')?.addEventListener('click', ()=>applyVoiceTextAsJobb({autoSave:true, restart:false}));
    $('voiceNewAgainBtn')?.addEventListener('click', startVoiceNyJobb);
    $('voiceJobbText')?.addEventListener('input', ()=>setVoiceButtons(!!app.voiceActive));
    $('voiceOpenLastJobbBtn')?.addEventListener('click', openLastVoiceJobb);
    $('voiceDeleteLastJobbBtn')?.addEventListener('click', deleteLastVoiceJobb);
    $('voiceBeskrivelseBtn')?.addEventListener('click', startVoiceBeskrivelse);
    $('voiceBeskrivelseStopBtn')?.addEventListener('click', stopVoiceBeskrivelse);
    $('newJobbFromDashBtn')?.addEventListener('click', openBlankJobbFromDashboard);
    document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{ showTab(b.dataset.tab); }));
    document.querySelectorAll('.nav-more [data-tab]').forEach(b=>b.addEventListener('click',()=>{ const d=b.closest('details'); if(d) d.open=false; }));
    $('saveFirmaBtn')?.addEventListener('click', saveFirma);
    $('firmaLand')?.addEventListener('change', ()=>{applyCountryUi(true); applyTaxSuggestion(); applyTaxModeUi();});
    ['firmaKontonr','firmaVippsNr','firmaVippsMottaker','firmaSwishNr','firmaStripeLink','firmaIban','firmaBic','firmaBankgiro','firmaPlusgiro'].forEach(id=>$(id)?.addEventListener('input',updatePaymentSettingsPreview));
    $('paymentSettingsBtn')?.addEventListener('click',()=>setTimeout(()=>{$('paymentSettingsCard')?.scrollIntoView({behavior:'smooth',block:'start'});},80));
    $('hovCountryQuick')?.addEventListener('change', e=>{ const c=e.target.value; localStorage.setItem('hov_country_quick',c); setVal('firmaLand',c); applyCountryUi(true); saveCountrySettings(); applyTaxSuggestion(); applyTaxModeUi(); msg('firmaMsg','Land er endret. Språk velges separat.','ok'); });
    $('firmaTaxMode')?.addEventListener('change', applyTaxModeUi);
    ['firmaSaleType','firmaArbeidsland','firmaCustomerCountry','firmaKundetype','firmaCustomerVatNumber','firmaVatVerified','firmaAutoTax'].forEach(id=>$(id)?.addEventListener('change',applyTaxSuggestion));
    $('uploadLogoBtn')?.addEventListener('click', uploadLogo);
    $('deleteLogoBtn')?.addEventListener('click', deleteLogo);
    $('saveKundeBtn')?.addEventListener('click', saveKunde);
    $('newKundeBtn')?.addEventListener('click', clearKundeForm);
    $('deleteKundeBtn')?.addEventListener('click', deleteKunde);
    $('saveHestBtn')?.addEventListener('click', saveHest);
    $('newHestBtn')?.addEventListener('click', clearHestForm);
    $('deleteHestBtn')?.addEventListener('click', deleteHest);
    $('saveJobbBtn')?.addEventListener('click', saveJobb);
    $('jobMobileBackBtn')?.addEventListener('click', closeJobbMobileFocus);
    $('jobMobileEditBtn')?.addEventListener('click', editOpenJobbFromFocus);
    $('jobMobileNavigateBtn')?.addEventListener('click', navigateOpenJobb);
    $('jobMobileSmsBtn')?.addEventListener('click', openJobbSmsMenu);
    $('jobSmsCancelBtn')?.addEventListener('click', closeJobbSmsMenu);
    document.querySelectorAll('[data-sms-template]').forEach(b=>b.addEventListener('click',()=>openSmsComposer(b.dataset.smsTemplate)));
    $('jobSmsDialog')?.addEventListener('click',e=>{ if(e.target===$('jobSmsDialog')) closeJobbSmsMenu(); });
    $('editSelectedJobbBtn')?.addEventListener('click', ()=>{ if(app.viewJobbId) editJobb(app.viewJobbId); });
    $('newJobbBtn')?.addEventListener('click', openNewJobbForm);
    $('deleteJobbBtn')?.addEventListener('click', deleteJobb);
    $('loadFakturaBtn')?.addEventListener('click', loadFakturaer);
    $('testTripletexBtn')?.addEventListener('click', testTripletexConnection);
    $('saveEconomyProviderBtn')?.addEventListener('click', saveEconomyProvider);
    $('economyTestTripletexBtn')?.addEventListener('click', testTripletexFromEconomy);
    $('economyRefreshBtn')?.addEventListener('click', refreshEconomyOverview);
    $('saveIntegrationConfigBtn')?.addEventListener('click', saveIntegrationConfig);
    $('validateIntegrationBtn')?.addEventListener('click', validateIntegrationConfig);
    $('testIntegrationPlaceholderBtn')?.addEventListener('click', testIntegrationPlaceholder);
    $('exportIntegrationConfigBtn')?.addEventListener('click', exportIntegrationConfig);
    $('addIntegrationTestQueueBtn')?.addEventListener('click', addIntegrationTestQueue);
    $('clearIntegrationQueueBtn')?.addEventListener('click', clearIntegrationQueue);
    $('clearIntegrationLogBtn')?.addEventListener('click', clearIntegrationLog);
    document.querySelectorAll('input[name="economyProvider"]').forEach(r=>r.addEventListener('change',()=>{ const cfg=integrationConfigFromUi(); cfg.provider=r.value; integrationCore()?.saveConfig(app.firmaId,cfg); renderEconomyPage(); }));
    document.querySelectorAll('input[name="economyProvider"]').forEach(r=>r.addEventListener('change',renderEconomyPage));
    $('importPrisCsvBtn')?.addEventListener('click', importPriserFraCsv);
    $('savePrisBtn')?.addEventListener('click', savePris);
    $('newPrisBtn')?.addEventListener('click', clearPrisForm);
    $('deletePrisBtn')?.addEventListener('click', deletePris);
    $('reloadPriserBtn')?.addEventListener('click', async ()=>{ await loadPriser(); renderPriser(); msg('prisImportMsg','Prisliste oppdatert.','ok'); });
    $('adminReloadBtn')?.addEventListener('click', loadAdminData);
    $('adminSubFirma')?.addEventListener('change', renderAdminSubscriptionBox);
    $('adminStartTrialBtn')?.addEventListener('click', adminStartTrial);
    $('adminActivatePaidBtn')?.addEventListener('click', adminActivatePaid);
    $('adminCreateSubInvoiceBtn')?.addEventListener('click', adminCreateSubscriptionInvoice);
    $('adminDeactivateSubBtn')?.addEventListener('click', adminDeactivateSubscription);
    $('adminFirmaReloadBtn')?.addEventListener('click', loadAdminData);
    $('adminSwitchFirmaBtn')?.addEventListener('click', adminSwitchFirma);
    $('adminCreateFirmaBtn')?.addEventListener('click', adminCreateFirma);
    $('adminResendInviteBtn')?.addEventListener('click', adminResendInvite);
    $('adminClearFirmaBtn')?.addEventListener('click', clearAdminFirmaForm);
    $('adminFirmaNewBtn')?.addEventListener('click', ()=>{ clearAdminFirmaForm(); document.getElementById('adminFirmaNavn')?.scrollIntoView({behavior:'smooth', block:'center'}); });
    $('adminFirmaLogoFile')?.addEventListener('change', previewAdminFirmaLogo);
    $('adminCreateUserBtn')?.addEventListener('click', adminCreateLoginUser);
    $('adminSetPasswordBtn')?.addEventListener('click', adminSetNewPasswordNoEmail);
    $('adminClearUserBtn')?.addEventListener('click', clearAdminUserForm);
    $('adminSaveProfileBtn')?.addEventListener('click', adminSaveProfile);
    $('adminBackupFirmaBtn')?.addEventListener('click', adminRunFirmaBackup);
    $('adminBackupSystemBtn')?.addEventListener('click', adminRunSystemBackup);
    $('adminBackupReloadBtn')?.addEventListener('click', loadBackupLogg);
    $('adminRestoreReloadBtn')?.addEventListener('click', loadBackupLogg);
    $('adminRestoreBackupBtn')?.addEventListener('click', adminRestoreBackup);
    $('appLagFakturaBtn')?.addEventListener('click', lagAppFaktura);
    $('appOppdaterFakturaBtn')?.addEventListener('click', renderAppFakturaer);
    $('appLagreFakturaDesignBtn')?.addEventListener('click', saveAppFakturaSettings);
    $('appFjernFakturaLogoBtn')?.addEventListener('click', clearAppFakturaLogo);
    $('appFakturaLogoFile')?.addEventListener('change', readAppFakturaLogo);
    $('firmaBackupBtn')?.addEventListener('click', runFirmaBackup);
    $('firmaBackupReloadBtn')?.addEventListener('click', loadFirmaBackupLogg);
    $('firmaRestoreReloadBtn')?.addEventListener('click', loadFirmaBackupLogg);
    $('firmaRestoreBtn')?.addEventListener('click', restoreFirmaBackup);
    $('jobbKunde')?.addEventListener('change', onJobbKundeChange);
    $('jobbHest')?.addEventListener('change', onJobbHestChange);
    $('jobbType')?.addEventListener('change', applySelectedJobbTypePris);
    $('hestBildeFile')?.addEventListener('change', previewSelectedHestBilde);
    $('jobbBildeFiles')?.addEventListener('change', previewSelectedJobbBilder);
    $('jobbSavedBildeFiles')?.addEventListener('change', previewSavedJobbBilder);
    $('uploadSavedJobbBilderBtn')?.addEventListener('click', uploadSavedJobbBilder);
    $('postSaveNewJobbBtn')?.addEventListener('click', openNewJobbForm);
    $('jobbBildeDato')?.addEventListener('change', ()=>{ const dato=val('jobbBildeDato') || val('jobbDato') || today(); (app.pendingJobbFiles||[]).forEach(x=>x.dato=dato); renderCombinedJobbBildePreview(); });
    bindReadLastJobbButton();
  }

  function bindReadLastJobbButton(){
    const btn = $('readLastJobbBtn');
    if(!btn) return;
    btn.onclick = function(ev){
      if(ev){ ev.preventDefault(); ev.stopPropagation(); }
      readLastJobbAsNew();
      return false;
    };
  }

  async function login(){
    msg('loginMsg','Logger inn...');
    localStorage.setItem(REMEMBER_LOGIN_KEY, $('rememberLogin')?.checked ? '1' : '0');
    const { data, error } = await app.sb.auth.signInWithPassword({ email: val('loginEmail'), password: val('loginPassword') });
    if(error){ msg('loginMsg', error.message, 'err'); return; }
    app.session=data.session; app.user=data.user;
    if($('rememberLogin') && !$('rememberLogin').checked){
      // Brukeren valgte å ikke huske innloggingen. Økten fungerer nå, men lagres ikke neste gang.
      try{ localStorage.removeItem('sb-'+new URL(window.supabaseClient.supabaseUrl).host.split('.')[0]+'-auth-token'); }catch(_){ }
    }
    await startApp();
  }

  function base64urlFromBytes(bytes){
    let bin=''; new Uint8Array(bytes).forEach(b=>bin+=String.fromCharCode(b));
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function bytesFromBase64url(text){
    const b64=String(text||'').replace(/-/g,'+').replace(/_/g,'/');
    const bin=atob(b64 + '==='.slice((b64.length+3)%4));
    const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out;
  }
  function randomBytes(len){ const a=new Uint8Array(len); crypto.getRandomValues(a); return a; }
  function localLockLoad(){ try{ return JSON.parse(localStorage.getItem(LOCAL_LOCK_KEY)||'null'); }catch(_){ return null; } }
  function localLockSave(row){ localStorage.setItem(LOCAL_LOCK_KEY, JSON.stringify(row||{})); updateLocalLockButton(); }
  function localLockClear(){ localStorage.removeItem(LOCAL_LOCK_KEY); updateLocalLockButton(); }
  function localLockIsEnabled(){ const r=localLockLoad(); return !!(r && (r.credentialId || r.pinHash)); }
  function updateLocalLockButton(){
    const b=$('enableBioBtn'); if(!b) return;
    const on=localLockIsEnabled();
    b.textContent = on ? '🔐 Biometri/PIN på' : '🔐 Biometri/PIN';
    b.classList.toggle('bio-on', on);
    b.title = on ? 'Biometri/PIN er aktiv på denne enheten' : 'Aktiver lokal lås med Face ID, fingeravtrykk eller PIN';
  }
  async function sha256Text(text){
    const data=new TextEncoder().encode(text);
    const hash=await crypto.subtle.digest('SHA-256', data);
    return base64urlFromBytes(hash);
  }
  async function askAndStorePin(existing){
    const pin=prompt(existing ? 'Skriv ny lokal PIN-kode for denne enheten (minst 4 tegn):' : 'Velg en lokal PIN-kode for denne enheten (minst 4 tegn):');
    if(!pin || pin.length<4) throw new Error('PIN må være minst 4 tegn.');
    const salt=base64urlFromBytes(randomBytes(16));
    return { salt, pinHash: await sha256Text(salt + ':' + pin) };
  }
  async function checkPin(lock){
    const pin=prompt('Biometri var ikke tilgjengelig. Skriv lokal PIN-kode:');
    if(!pin) return false;
    return (await sha256Text(lock.salt + ':' + pin)) === lock.pinHash;
  }
  function webAuthnAvailable(){ return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext); }
  async function createBiometricCredential(){
    if(!webAuthnAvailable()) return null;
    const userId=randomBytes(16);
    const cred=await navigator.credentials.create({ publicKey:{
      challenge: randomBytes(32),
      rp:{ name:'HovslagerSystem' },
      user:{ id:userId, name:app.user?.email || 'hovslager', displayName:app.user?.email || 'Hovslager' },
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{ userVerification:'required', residentKey:'discouraged' },
      timeout:60000,
      attestation:'none'
    }});
    if(!cred) return null;
    return { credentialId: base64urlFromBytes(cred.rawId) };
  }
  async function verifyBiometric(lock){
    if(!webAuthnAvailable() || !lock?.credentialId) return false;
    try{
      const assertion=await navigator.credentials.get({ publicKey:{
        challenge: randomBytes(32),
        allowCredentials:[{ type:'public-key', id:bytesFromBase64url(lock.credentialId) }],
        userVerification:'required',
        timeout:60000
      }});
      return !!assertion;
    }catch(e){ console.warn('Biometri/PIN ble ikke godkjent', e); return false; }
  }
  async function requireLocalUnlockIfEnabled(){
    const lock=localLockLoad();
    if(!lock || (!lock.credentialId && !lock.pinHash)) return true;
    msg('loginMsg','Låser opp med biometri/PIN ...');
    if(await verifyBiometric(lock)) return true;
    if(lock.pinHash && await checkPin(lock)) return true;
    return false;
  }
  async function enableLocalLock(){
    if(!app.user){ msg('loginMsg','Logg inn først.','err'); return; }
    const existing=localLockLoad();
    if(existing && confirm('Biometri/PIN er allerede aktiv. Vil du slå den av på denne enheten?')){
      localLockClear();
      msg('dashMsg','Biometri/PIN er slått av på denne enheten.','ok');
      return;
    }
    try{
      msg('dashMsg','Aktiverer biometri/PIN på denne enheten ...');
      let lock={ enabledAt:new Date().toISOString(), email:app.user.email || '' };
      const bio=await createBiometricCredential();
      if(bio) lock={...lock,...bio};
      const pin=await askAndStorePin(false);
      lock={...lock,...pin};
      localLockSave(lock);
      msg('dashMsg', bio ? 'Biometri/PIN er aktivert. Neste gang appen åpnes, låses den opp med Face ID/fingeravtrykk eller PIN.' : 'Lokal PIN er aktivert. Biometri krever HTTPS og støtte i nettleseren.', 'ok');
    }catch(err){
      msg('dashMsg','Kunne ikke aktivere biometri/PIN: '+(err.message||String(err)),'err');
    }
  }

  async function resetPassword(){
    const email=val('loginEmail'); if(!email){ msg('loginMsg','Skriv e-post først.','err'); return; }
    const { error } = await app.sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('./reset.html', window.location.href).href });
    msg('loginMsg', error ? error.message : 'Passordlenke sendt hvis brukeren finnes.', error?'err':'ok');
  }
  async function logout(){ await app.sb.auth.signOut(); location.reload(); }

  async function startApp(){
    showLogin(false);
    $('userPill').textContent = app.user?.email || '';
    await ensureFirma();
    await loadAll();
    showTab('jobber');
    bindReadLastJobbButton();
  }

  const KRISE_FIRMA_ID = '441fee94-6af6-4090-ba27-dceed27d5a9a';

  async function countRowsForFirmaId(firmaId){
    if(!firmaId || !app.sb) return 0;
    let total = 0;
    for(const table of ['hov_kunder','hov_hester','hov_jobber','hov_priser']){
      try{
        const r = await app.sb.from(table).select('id', { count:'exact', head:true }).eq('firma_id', firmaId);
        if(!r.error && typeof r.count === 'number') total += r.count;
      }catch(e){ console.warn('Klarte ikke telle '+table, e); }
    }
    return total;
  }

  async function readFirmaById(firmaId){
    if(!firmaId || !app.sb) return null;
    try{
      const r = await app.sb.from('hov_firma').select('*').eq('id', firmaId).maybeSingle();
      if(r.error && r.error.code !== 'PGRST116') console.warn('Kunne ikke lese hov_firma '+firmaId, r.error);
      return r.data || null;
    }catch(e){ console.warn('Kunne ikke lese hov_firma '+firmaId, e); return null; }
  }

  async function findVisibleFirmaWithData(currentFirma, profile, email){
    const byId = new Map();
    const add = f => { if(f && f.id) byId.set(String(f.id), f); };
    add(currentFirma);
    add(await readFirmaById(KRISE_FIRMA_ID));
    try{
      if(profile?.firma_id) add(await readFirmaById(profile.firma_id));
    }catch(_){ }
    try{
      const r = await app.sb.from('hov_firma').select('*').eq('auth_user_id', app.user.id).limit(50);
      (r.data||[]).forEach(add);
    }catch(_){ }
    try{
      if(email){
        const r = await app.sb.from('hov_firma').select('*').ilike('epost', email).limit(50);
        (r.data||[]).forEach(add);
      }
    }catch(_){ }

    let best = null;
    let bestCount = -1;
    for(const f of byId.values()){
      const c = await countRowsForFirmaId(f.id);
      if(String(f.id) === KRISE_FIRMA_ID && c > 0){
        best = f; bestCount = c; break;
      }
      if(c > bestCount){ best = f; bestCount = c; }
    }
    if(best && currentFirma?.id && String(best.id)!==String(currentFirma.id)){
      console.warn('Bytter aktivt firma til firma med synlige data', {fra:currentFirma.id, til:best.id, rader:bestCount});
      msg('dashMsg','Fant eksisterende data på firma-ID '+best.id+'. Bruker dette firmaet.','ok');
    }
    return best || currentFirma || null;
  }

  async function repairProfileFirmaId(firmaId, email){
    if(!firmaId || !app.user?.id || !app.sb || app.isSysadm) return;
    try{
      await app.sb.from('hov_firma').update({ auth_user_id: app.user.id, epost: email || app.user.email || null }).eq('id', firmaId);
    }catch(e){ console.warn('Kunne ikke sette auth_user_id på firma', e); }
    try{
      const r = await app.sb.from('hov_profiles').upsert({
        auth_user_id: app.user.id,
        firma_id: firmaId,
        rolle: app.role || 'hovslager',
        epost: email || app.user.email || null
      }, { onConflict:'auth_user_id' }).select('*').single();
      if(!r.error && r.data){ app.profile = r.data; app.role = r.data.rolle || app.role || 'hovslager'; app.isSysadm = app.role === 'sysadm'; }
      if(r.error) console.warn('Kunne ikke oppdatere hov_profiles automatisk', r.error);
    }catch(e){ console.warn('Kunne ikke oppdatere hov_profiles automatisk', e); }
  }

  async function ensureFirma(){
    const email = app.user?.email || '';

    // Ny flerbruker-modell: hov_profiles bestemmer firma og rolle.
    // Sysadm kan få tilgang til alle firma via RLS, men appen bruker valgt/tilknyttet firma i daglig registrering.
    let profile = null;
    try{
      const pr = await app.sb.from('hov_profiles').select('*').eq('auth_user_id', app.user.id).maybeSingle();
      if(pr.error && pr.error.code !== 'PGRST116') console.warn('Kunne ikke lese hov_profiles', pr.error);
      profile = pr.data || null;
    }catch(e){
      console.warn('hov_profiles er ikke opprettet ennå. Kjør SQL-filen i pakken.', e);
    }
    app.profile = profile;
    app.role = profile?.rolle || 'hovslager';
    app.isSysadm = app.role === 'sysadm';
    if(app.role === 'deaktivert'){
      showLogin(false);
      const card=$('appCard');
      if(card) card.innerHTML = '<section class="card"><h2>Tilgang deaktivert</h2><p>Abonnementet er ikke betalt. Ta kontakt for å aktivere kontoen igjen.</p><button id="logoutBtnBlocked" class="danger">Logg ut</button></section>';
      $('logoutBtnBlocked')?.addEventListener('click', logout);
      throw new Error('Konto deaktivert');
    }

    let firma = null;
    if(profile?.firma_id){
      const r = await app.sb.from('hov_firma').select('*').eq('id', profile.firma_id).maybeSingle();
      firma = r.data || null;
    }

    // Bakoverkompatibilitet for eksisterende installasjon før profiles-tabellen er fylt.
    if(!firma){
      let { data:firmaOld, error } = await app.sb.from('hov_firma').select('*').eq('auth_user_id', app.user.id).maybeSingle();
      if(error && error.code !== 'PGRST116') throw new Error(error.message);
      firma = firmaOld || null;
    }
    if(!firma && email){
      const r = await app.sb.from('hov_firma').select('*').ilike('epost', email).maybeSingle();
      firma = r.data || null;
    }
    if(!firma){
      firma = await readFirmaById(KRISE_FIRMA_ID);
    }
    if(!firma){
      msg('dashMsg','Fant ikke firma for brukeren. Ingen nytt tomt firma ble opprettet automatisk, for å unngå at eksisterende data skjules. Kjør SQL-fiksen som følger med ZIP-en.','err');
      return;
    } else if(!firma.auth_user_id && !app.isSysadm) {
      const r = await app.sb.from('hov_firma').update({auth_user_id:app.user.id, epost:firma.epost||email}).eq('id', firma.id).select('*').single();
      if(!r.error) firma = r.data;
    }

    // Opprett/oppdater profil automatisk for vanlig hovslager hvis den mangler.
    if(!profile && firma?.id){
      try{
        const r = await app.sb.from('hov_profiles').upsert({
          auth_user_id: app.user.id,
          firma_id: firma.id,
          rolle: 'hovslager',
          epost: email
        }, { onConflict:'auth_user_id' }).select('*').single();
        if(!r.error){ app.profile = r.data; app.role = r.data.rolle || 'hovslager'; app.isSysadm = app.role === 'sysadm'; }
      }catch(e){ console.warn('Kunne ikke opprette profil automatisk', e); }
    }

    firma = await findVisibleFirmaWithData(firma, profile, email);
    if(!firma?.id){ msg('dashMsg','Fant ikke tilgjengelig firma med data. Kjør SQL-fiksen som følger med ZIP-en.','err'); return; }
    await repairProfileFirmaId(firma.id, email);

    app.firma=firma; app.firmaId=firma.id;
    if(!app.isSysadm){
      const st=subscriptionState(firma);
      if(st.key==='deaktivert' || st.key==='expired'){
        showLogin(false);
        const card=$('appCard');
        if(card) card.innerHTML = '<section class="card"><h2>Prøveperiode / abonnement</h2><p>Prøveperioden er utløpt eller abonnementet er deaktivert. Ta kontakt med RettiLomma for å aktivere kontoen.</p><button id="logoutBtnBlocked" class="danger">Logg ut</button></section>';
        $('logoutBtnBlocked')?.addEventListener('click', logout);
        throw new Error('Abonnement ikke aktivt');
      }
    }
    renderFirma(); updateHeader(); updateAdminVisibility();
  }

  function updateAdminVisibility(){
    const btn=$('adminTabBtn');
    if(btn) btn.classList.toggle('hidden', !app.isSysadm);
    const topBtn=$('sysadmTopBtn');
    if(topBtn) topBtn.classList.toggle('hidden', !app.isSysadm);
  }

  function updateHeader(){
    $('headerTitle').textContent = app.firma?.navn || 'HovslagerSystem';
    $('headerSub').textContent = (app.firma?.epost || app.user?.email || '') + (app.isSysadm ? ' · sysadm' : '');
    const url = app.firma?.logo_url;
    const img=$('headerLogo'), fb=$('headerLogoFallback');
    if(url){ img.src=url; img.classList.remove('hidden'); fb.classList.add('hidden'); }
    else { img.removeAttribute('src'); img.classList.add('hidden'); fb.classList.remove('hidden'); }
    updateLocalLockButton();
  }

  function showTab(id){
    document.querySelectorAll('.tab').forEach(s=>s.classList.toggle('hidden', s.id!==id));
    if(id==='firma'){ renderFirma(); loadFirmaBackupLogg(); }
    if(id==='hester'){ setHestLayout('listFirst'); }
    if(id==='jobber'){ setJobbLayout('listFirst'); }
    if(id==='priser') renderPriser();
    if(id==='kalender') renderCalendar();
    if(id==='gps'){ if($('gpsDate')&&!$('gpsDate').value) $('gpsDate').value=localIsoDate(new Date()); renderGps(); }
    if(id==='okonomi') renderEconomyPage();
    if(id==='admin'){ if(!app.isSysadm){ msg('dashMsg','SysAdm-panelet er bare for systemadministrator.','err'); showTab('dashboard'); return; } loadAdminData(); loadBackupLogg(); loadAppFakturaSettingsForm(); renderAppFakturaer(); }
  }

  async function loadAll(){
    if(!app.firmaId){ msg('dashMsg','Mangler firma-ID. Data kan ikke lastes.','err'); return; }
    msg('dashMsg','Laster data for firma '+app.firmaId+' ...');
    await Promise.all([loadKunder(), loadHester(), loadJobber(), loadFakturaer(), loadKreditnotaer(), loadPriser()]);
    renderAll();
    const counts = {kunder:(app.data.kunder||[]).length, hester:(app.data.hester||[]).length, jobber:(app.data.jobber||[]).length, priser:(app.data.priser||[]).length};
    const type = (counts.kunder+counts.hester+counts.jobber+counts.priser) ? 'ok' : 'err';
    msg('dashMsg',`Data oppdatert for firma ${app.firmaId}. Kunder: ${counts.kunder}, Hester: ${counts.hester}, Jobber: ${counts.jobber}, Priser: ${counts.priser}.`+(type==='err'?' Hvis dette er 0, kjør SQL-fiksen i ZIP-en: brukerprofil/RLS peker fortsatt til feil firma.':''), type);
  }
  async function selectTable(table, order){
    let q = app.sb.from(table).select('*').eq('firma_id', app.firmaId);
    if(order) q=q.order(order,{ascending:false});
    const {data,error}=await q;
    if(error){ console.error(table,error); msg('dashMsg',`Feil ved lasting av ${table}: ${error.message}. Aktiv firma_id: ${app.firmaId}`,'err'); return []; }
    return data||[];
  }
  async function loadKunder(){ app.data.kunder = await selectTable('hov_kunder','created_at'); fillKundeSelects(); renderKunder(); }
  async function loadHester(){ app.data.hester = await selectTable('hov_hester','created_at'); await signHestBilder(); fillHestSelects(); renderHester(); }
  async function loadJobber(){ app.data.jobber = await selectTable('hov_jobber','dato'); await signJobbBilder(); renderJobber(); }
  async function loadFakturaer(){ app.data.fakturaer = await selectTable('hov_fakturaer','dato'); await loadKreditnotaer(); renderFakturaer(); }
  async function loadKreditnotaer(){ app.data.kreditnotaer = await selectTable('hov_kreditnotaer','created_at'); }
  async function loadPriser(){
    let q = app.sb.from('hov_priser').select('*').limit(500);
    if(app.firmaId) q = q.or(`firma_id.eq.${app.firmaId},firma_id.is.null`);
    const {data,error}=await q;
    if(error){ console.error('hov_priser', error); msg('dashMsg','Feil ved lasting av hov_priser: '+error.message+'. Aktiv firma_id: '+app.firmaId,'err'); app.data.priser = []; fillJobbTypeSelect(); return; }
    app.data.priser = data || [];
    fillJobbTypeSelect();
  }
  function standardFirmaNavnForEpost(email){ return ''; }

  function abonnementPris(f){ return Number(f?.app_mnd_pris ?? f?.abonnement_pris ?? f?.monthly_price ?? 500) || 500; }
  function abonnementStatus(f){ return String(f?.abonnement_status || f?.subscription_status || '').toLowerCase(); }
  function abonnementTrialEnd(f){ return String(f?.trial_end || f?.proveperiode_slutt || f?.trial_slutt || '').slice(0,10); }
  function abonnementBetaltTil(f){ return String(f?.abonnement_betalt_til || f?.betalt_til || '').slice(0,10); }
  function daysBetweenDates(a,b){ const da=new Date(String(a||today()).slice(0,10)+'T00:00:00'); const db=new Date(String(b||today()).slice(0,10)+'T00:00:00'); return Math.ceil((db-da)/86400000); }
  function subscriptionState(f){
    const raw=abonnementStatus(f);
    const trialEnd=abonnementTrialEnd(f);
    const paidUntil=abonnementBetaltTil(f);
    if(raw==='deaktivert' || raw==='stengt') return {key:'deaktivert', label:'Deaktivert', days:null};
    if(raw==='aktiv' || raw==='active') return {key:'active', label: paidUntil ? 'Aktiv til '+paidUntil : 'Aktiv', days: paidUntil ? daysBetweenDates(today(), paidUntil) : null};
    if(raw==='trial' || raw==='prove' || trialEnd){
      const d=trialEnd ? daysBetweenDates(today(), trialEnd) : null;
      if(d !== null && d < 0) return {key:'expired', label:'Prøve utløpt', days:d};
      return {key:'trial', label: d === null ? 'Gratis test' : 'Gratis test '+d+' dager igjen', days:d};
    }
    return {key:'', label:'Ikke satt', days:null};
  }
  function subscriptionBadge(f){ const s=subscriptionState(f); return `<span class="sub-pill ${esc(s.key)}">${esc(s.label)}</span>`; }
  function renderAdminSubscriptionBox(){
    const id=val('adminSubFirma') || val('adminActiveFirma') || app.firmaId;
    const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(id));
    const el=$('adminSubInfo'); if(!el) return;
    if(!f){ el.innerHTML='<div class="msg">Velg firma for å se abonnement.</div>'; return; }
    const st=subscriptionState(f);
    setVal('adminSubPrice', abonnementPris(f));
    el.innerHTML=`<div class="msg"><strong>${esc(f.navn||f.epost||f.id)}</strong><br>${subscriptionBadge(f)}<div class="subscription-summary"><div class="mini"><span class="muted">Pris</span><strong>${kr(abonnementPris(f))}</strong><span class="muted">kr/mnd eks. mva</span></div><div class="mini"><span class="muted">Trial slutt</span><strong>${esc(abonnementTrialEnd(f)||'-')}</strong></div><div class="mini"><span class="muted">Betalt til</span><strong>${esc(abonnementBetaltTil(f)||'-')}</strong></div><div class="mini"><span class="muted">Status</span><strong>${esc(st.label)}</strong></div></div></div>`;
  }
  async function updateFirmaSubscription(payload, okText){
    if(!app.isSysadm) return;
    const firmaId=val('adminSubFirma') || val('adminActiveFirma');
    if(!firmaId){ msg('adminSubInfo','Velg firma først.','err'); return; }
    msg('adminSubInfo','Lagrer abonnement ...');
    const {error}=await app.sb.from('hov_firma').update(payload).eq('id', firmaId);
    if(error){ msg('adminSubInfo','Kunne ikke lagre abonnement: '+error.message+' Kjør SQL-filen i ZIP-en først hvis kolonnene mangler.','err'); return; }
    await loadAdminData();
    setVal('adminSubFirma', firmaId);
    renderAdminSubscriptionBox();
    msg('adminSubInfo', okText || 'Abonnement oppdatert.','ok');
  }
  async function adminStartTrial(){
    const days=Number(val('adminTrialDays')||30) || 30;
    const price=Number(val('adminSubPrice')||500) || 500;
    await updateFirmaSubscription({abonnement_status:'trial', trial_start:today(), trial_end:datePlusDays(days), app_mnd_pris:price}, days+' dager gratis prøveperiode er startet.');
  }
  async function adminActivatePaid(){
    const price=Number(val('adminSubPrice')||500) || 500;
    await updateFirmaSubscription({abonnement_status:'aktiv', abonnement_betalt_til:datePlusDays(30), app_mnd_pris:price}, 'Kunden er satt aktiv/betalt for 30 dager.');
  }
  async function adminDeactivateSubscription(){
    const firmaId=val('adminSubFirma') || val('adminActiveFirma');
    if(!firmaId){ msg('adminSubInfo','Velg firma først.','err'); return; }
    if(!confirm('Deaktivere abonnement og tilgang for valgt firma?')) return;
    await updateFirmaSubscription({abonnement_status:'deaktivert'}, 'Abonnement er deaktivert.');
    try{ await setAppFirmaRolle(firmaId,'deaktivert'); }catch(e){ console.warn('Kunne ikke deaktivere profiler', e); }
  }
  async function adminCreateSubscriptionInvoice(){
    const firmaId=val('adminSubFirma') || val('adminActiveFirma');
    const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(firmaId));
    if(!f){ msg('adminSubInfo','Velg firma først.','err'); return; }
    setVal('appFakturaFirma', firmaId);
    setVal('appFakturaBelop', abonnementPris(f));
    setVal('appFakturaForfallDager','14');
    setVal('appFakturaTekst','Abonnement HovslagerSystem - '+kr(abonnementPris(f))+' kr/mnd eks. mva');
    await lagAppFaktura();
    msg('adminSubInfo','Faktura for abonnement er laget. Se SysAdm: fakturer hovslagere.','ok');
  }
  async function rettStandardFirmaNavn(){ return; }


  async function repairKnownFirmaUserMappings(){
    if(!app.isSysadm || !app.sb || !app.user?.id) return;
    try{
      const {data:firmaer,error:firmaError}=await app.sb.from('hov_firma').select('*');
      if(firmaError) throw firmaError;
      const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,'');
      const andersen=(firmaer||[]).find(f=>norm(f.navn)==='hovslagerandersen');
      const firma123=(firmaer||[]).find(f=>norm(f.navn)==='hovslager123');
      if(!andersen || !firma123) return;

      const updates=[];
      if(String(andersen.epost||'').toLowerCase()!=='salg@rettilomma.com'){
        updates.push(app.sb.from('hov_firma').update({epost:'salg@rettilomma.com'}).eq('id',andersen.id));
      }
      if(String(firma123.epost||'').toLowerCase()!=='greknuts@online.no' || String(firma123.auth_user_id||'')!==String(app.user.id)){
        updates.push(app.sb.from('hov_firma').update({epost:'greknuts@online.no',auth_user_id:app.user.id}).eq('id',firma123.id));
      }
      if(updates.length) await Promise.all(updates);

      await app.sb.from('hov_profiles').update({firma_id:firma123.id,epost:'greknuts@online.no'}).eq('auth_user_id',app.user.id);
      const {data:salgProfiler}=await app.sb.from('hov_profiles').select('auth_user_id').ilike('epost','salg@rettilomma.com');
      for(const pr of (salgProfiler||[])){
        await app.sb.from('hov_profiles').update({firma_id:andersen.id}).eq('auth_user_id',pr.auth_user_id);
        await app.sb.from('hov_firma').update({auth_user_id:pr.auth_user_id}).eq('id',andersen.id);
      }

      if(String(app.firmaId||'')!==String(firma123.id)){
        const refreshed=(await app.sb.from('hov_firma').select('*').eq('id',firma123.id).single()).data;
        if(refreshed){ app.firma=refreshed; app.firmaId=refreshed.id; app.profile={...(app.profile||{}),firma_id:refreshed.id,epost:'greknuts@online.no'}; }
      }
    }catch(e){ console.warn('Kunne ikke rette firmakoblinger automatisk',e); }
  }

  async function loadAdminData(){
    if(!app.isSysadm){ msg('adminMsg','Du er ikke sysadm.','err'); return; }
    msg('adminMsg','Laster adminliste...');
    await repairKnownFirmaUserMappings();
    const [firmaRes, profRes] = await Promise.all([
      app.sb.from('hov_firma').select('*').order('navn',{ascending:true}),
      app.sb.from('hov_profiles').select('*').order('created_at',{ascending:false})
    ]);
    if(firmaRes.error){ msg('adminMsg','Kunne ikke laste firmaer: '+firmaRes.error.message,'err'); return; }
    if(profRes.error){ msg('adminMsg','Kunne ikke laste profiler: '+profRes.error.message,'err'); return; }
    app.data.adminFirmaer = firmaRes.data || [];
    app.data.adminProfiler = profRes.data || [];
    renderAdmin();
    msg('adminMsg','Adminliste oppdatert.','ok');
  }


  // Robust SYSADM edit handler: uses event delegation so the button keeps working
  // even when the company table is rendered again after loading/saving.
  document.addEventListener('click', function(event){
    const target = event.target instanceof Element ? event.target.closest('[data-admin-edit-firma]') : null;
    if(!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const firmaId = target.getAttribute('data-admin-edit-firma');
    const f = (app.data.adminFirmaer || []).find(x => String(x.id) === String(firmaId));
    if(!f){ msg('adminMsg','Fant ikke firmaet som skal redigeres. Trykk Oppdater firmaliste og prøv igjen.','err'); return; }
    app.adminEditFirmaId = f.id;
    setVal('adminFirmaNavn', f.navn || '');
    setVal('adminFirmaEpost', f.epost || '');
    setVal('adminFirmaTelefon', f.telefon || '');
    setVal('adminFirmaOrgnr', f.orgnr || f.org_nr || f.bedriftsnr || '');
    setVal('adminFirmaAdresse', f.adresse || '');
    setVal('adminActiveFirma', f.id);
    const title = $('adminFirmaTitle'); if(title) title.textContent = 'Rediger firma';
    const help = $('adminFirmaHelp'); if(help) help.textContent = 'Du redigerer valgt firma. Endre feltene og trykk Lagre endringer.';
    const saveBtn = $('adminCreateFirmaBtn'); if(saveBtn) saveBtn.textContent = 'Lagre endringer';
    const card = $('adminFirmaCard') || $('adminFirmaNavn');
    if(card){ card.scrollIntoView({behavior:'smooth', block:'start'}); }
    setTimeout(() => $('adminFirmaNavn')?.focus(), 250);
    msg('adminMsg','Redigerer firma: ' + (f.navn || f.epost || f.id) + '.','ok');
  }, true);

  function renderAdmin(){
    const firmaer = app.data.adminFirmaer || [];
    const profiler = app.data.adminProfiler || [];
    const opts = '<option value="">Velg firma</option>' + firmaer.map(f=>`<option value="${esc(f.id)}">${esc(f.navn || f.epost || f.id)}</option>`).join('');
    ['adminActiveFirma','adminSubFirma','adminProfileFirma','adminUserFirma','adminBackupFirma','appFakturaFirma'].forEach(id=>{ const el=$(id); if(el){ const old=el.value; el.innerHTML=opts; el.value = old || ((id==='adminActiveFirma' || id==='adminBackupFirma') ? app.firmaId : ''); }});

    const firmaRows = firmaer.map(f=>`<tr>
      <td><strong>${esc(f.navn||'Uten navn')}</strong>${String(f.id)===String(app.firmaId)?'<br><span class="pill">Aktivt firma</span>':''}<br>${subscriptionBadge(f)}</td>
      <td>${esc(f.epost||'')}</td>
      <td>${esc(f.telefon||'')}</td>
      <td>${esc(f.orgnr || f.org_nr || f.bedriftsnr || '')}</td>
      <td class="admin-firma-actions"><button type="button" class="small-btn secondary" data-admin-use-firma="${esc(f.id)}">Åpne</button><button type="button" class="small-btn" data-admin-edit-firma="${esc(f.id)}">Rediger</button><button type="button" class="small-btn secondary" data-admin-user-firma="${esc(f.id)}">Lag bruker</button><button type="button" class="small-btn secondary" data-admin-password-firma="${esc(f.id)}">Sett passord</button><button type="button" class="small-btn danger" data-admin-delete-firma="${esc(f.id)}">Slett</button></td>
    </tr>`);
    const firmaList=$('adminFirmaList');
    if(firmaList){
      firmaList.innerHTML = `<div class="msg">Antall lagrede firmaer vist: ${firmaer.length}. Hvis du forventer flere, må de finnes i Supabase-tabellen <code>hov_firma</code> og SysAdm-brukeren må ha tilgang via RLS.</div>` + table(['Firma / abonnement','E-post','Telefon','Org.nr','Handling'], firmaRows);
      firmaList.querySelectorAll('[data-admin-use-firma]').forEach(btn=>btn.addEventListener('click', async ()=>{
        setVal('adminActiveFirma', btn.dataset.adminUseFirma);
        await adminSwitchFirma();
      }));
      firmaList.querySelectorAll('[data-admin-edit-firma]').forEach(btn=>btn.addEventListener('click', ()=>{
        const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(btn.dataset.adminEditFirma));
        if(!f){ msg('adminMsg','Fant ikke firmaet som skal redigeres.','err'); return; }
        app.adminEditFirmaId = f.id;
        setVal('adminFirmaNavn', f.navn||'');
        setVal('adminFirmaEpost', f.epost||'');
        setVal('adminFirmaTelefon', f.telefon||'');
        setVal('adminFirmaOrgnr', f.orgnr || f.org_nr || f.bedriftsnr || '');
        setVal('adminFirmaAdresse', f.adresse||'');
        setVal('adminActiveFirma', f.id);
        const title=$('adminFirmaTitle'); if(title) title.textContent='Rediger firma';
        const help=$('adminFirmaHelp'); if(help) help.textContent='Du redigerer valgt firma. Endre feltene og trykk Lagre endringer.';
        const btn=$('adminCreateFirmaBtn'); if(btn) btn.textContent='Lagre endringer';
        const card=$('adminFirmaCard') || $('adminFirmaNavn');
        setTimeout(()=>card?.scrollIntoView({behavior:'smooth', block:'start'}), 50);
        msg('adminMsg','Redigerer firma: '+(f.navn||f.epost||f.id)+'. Endre feltene og trykk Lagre endringer.','ok');
      }));
      firmaList.querySelectorAll('[data-admin-user-firma]').forEach(btn=>btn.addEventListener('click', ()=>{
        const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(btn.dataset.adminUserFirma));
        if(!f){ msg('adminMsg','Fant ikke firmaet.','err'); return; }
        clearAdminUserForm(false);
        setVal('adminUserFirma', f.id);
        setVal('adminUserEpost', f.epost || '');
        document.getElementById('adminUserEpost')?.scrollIntoView({behavior:'smooth', block:'center'});
        msg('adminUserMsg','Fyll inn e-post/navn og midlertidig passord for bruker til '+(f.navn||f.epost||'firma')+'.','ok');
      }));
      firmaList.querySelectorAll('[data-admin-password-firma]').forEach(btn=>btn.addEventListener('click', ()=>{
        const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(btn.dataset.adminPasswordFirma));
        if(!f){ msg('adminMsg','Fant ikke firmaet.','err'); return; }
        clearAdminUserForm(false);
        setVal('adminUserFirma', f.id);
        setVal('adminUserEpost', f.epost || '');
        setVal('adminUserPassword', randomTempPassword());
        document.getElementById('adminUserPassword')?.scrollIntoView({behavior:'smooth', block:'center'});
        msg('adminUserMsg','Kontroller/endre passordet og trykk Sett nytt passord uten e-post for '+(f.navn||f.epost||'firma')+'.','ok');
      }));
      firmaList.querySelectorAll('[data-admin-delete-firma]').forEach(btn=>btn.addEventListener('click', async ()=>{
        const f=(app.data.adminFirmaer||[]).find(x=>String(x.id)===String(btn.dataset.adminDeleteFirma));
        if(!f){ msg('adminMsg','Fant ikke firmaet som skal slettes.','err'); return; }
        if(!confirm('Slette firma '+(f.navn||f.epost||f.id)+'? Dette kan ikke angres.')) return;
        const {error}=await app.sb.from('hov_firma').delete().eq('id', f.id);
        if(error){ msg('adminMsg','Kunne ikke slette firma: '+error.message,'err'); return; }
        await loadAdminData();
        msg('adminMsg','Firma slettet.','ok');
      }));
    }

    $('adminProfileList').innerHTML = table(['E-post','Navn','Rolle','Firma','Auth User ID'], profiler.map(pr=>`<tr><td>${esc(pr.epost||'')}</td><td>${esc(pr.navn||'')}</td><td>${esc(pr.rolle||'')}</td><td>${esc(firmaer.find(f=>String(f.id)===String(pr.firma_id))?.navn || pr.firma_id || '')}</td><td><code>${esc(pr.auth_user_id||'')}</code></td></tr>`));
    renderAppFakturaer();
    renderAdminSubscriptionBox();
  }

  async function adminSwitchFirma(){
    if(!app.isSysadm) return;
    const id=val('adminActiveFirma');
    if(!id){ msg('adminMsg','Velg firma først.','err'); return; }
    const firma = (app.data.adminFirmaer||[]).find(f=>String(f.id)===String(id));
    if(!firma){ msg('adminMsg','Fant ikke valgt firma.','err'); return; }
    app.firma = firma;
    app.firmaId = firma.id;
    setVal('adminSubFirma', firma.id);
    updateHeader();
    renderFirma();
    await loadAll();
    msg('adminMsg','Aktivt firma byttet til '+(firma.navn||firma.epost||firma.id)+'.','ok');
    showTab('dashboard');
  }

  function clearAdminFirmaForm(){
    app.adminEditFirmaId = null;
    ['adminFirmaNavn','adminFirmaEpost','adminFirmaTelefon','adminFirmaOrgnr','adminFirmaAdresse'].forEach(id=>setVal(id,''));
    const invite=$('adminFirmaSendInvite'); if(invite) invite.checked=true;
    const file=$('adminFirmaLogoFile');
    if(file) file.value='';
    const title=$('adminFirmaTitle'); if(title) title.textContent='Nytt firma';
    const help=$('adminFirmaHelp'); if(help) help.textContent='Start med blankt skjema. Logo/bilde er tomt til du velger en fil.';
    const btn=$('adminCreateFirmaBtn'); if(btn) btn.textContent='Lagre firma';
    renderAdminFirmaLogoPreview('');
    msg('adminMsg','Klart for nytt firma. Logo/bilde er blankt.','ok');
  }

  function renderAdminFirmaLogoPreview(url){
    const el=$('adminFirmaLogoPreview');
    if(!el) return;
    el.innerHTML = url ? `<img class="thumb" src="${esc(url)}" alt="Firmalogo">` : '<span class="muted">Ingen logo valgt.</span>';
  }

  function previewAdminFirmaLogo(){
    const file=$('adminFirmaLogoFile')?.files?.[0];
    renderAdminFirmaLogoPreview(file ? URL.createObjectURL(file) : '');
  }

  async function uploadFirmaLogoForFirma(file, firmaId){
    if(!file || !firmaId) return null;
    const ext=(file.name.split('.').pop()||'png').toLowerCase();
    const path=`${firmaId}/${Date.now()}-${safeName(file.name||('logo.'+ext))}`;
    const up=await app.sb.storage.from('hovslager-logo').upload(path, file, { upsert:true, contentType:file.type || 'image/png' });
    if(up.error) throw new Error('Logo ble ikke lastet opp: '+up.error.message+' (Sjekk bucket hovslager-logo og policy.)');
    const pub=app.sb.storage.from('hovslager-logo').getPublicUrl(path);
    return { logo_url: pub.data.publicUrl, logo_path: path };
  }

  async function adminCreateFirma(){
    if(!app.isSysadm) return;
    const navn=val('adminFirmaNavn');
    if(!navn){ msg('adminMsg','Skriv firmanavn før du lagrer firma.','err'); return; }
    const file=$('adminFirmaLogoFile')?.files?.[0] || null;
    const sendInvite=!!$('adminFirmaSendInvite')?.checked;
    const payload={navn, epost:val('adminFirmaEpost')||null, telefon:val('adminFirmaTelefon')||null, orgnr:val('adminFirmaOrgnr')||null, adresse:val('adminFirmaAdresse')||null, betalingsfrist_dager:14, faktura_prefix:'F', neste_fakturanr:1, standard_mva_sats:25};
    if(sendInvite && !payload.epost){ msg('adminMsg','Skriv firmaets e-post før du sender invitasjon.','err'); return; }
    msg('adminMsg', app.adminEditFirmaId ? 'Lagrer endringer...' : 'Lagrer firma...');
    let saved=null;
    if(app.adminEditFirmaId){
      // Lagre firmaopplysninger direkte. Ingen e-postregel eller gammel Edge Function får overskrive navnet.
      const {data,error}=await app.sb.from('hov_firma').update(payload).eq('id', app.adminEditFirmaId).select('*').single();
      if(error){ msg('adminMsg','Kunne ikke oppdatere firma: '+error.message,'err'); return; }
      saved=data;
      if(file && saved?.id){
        try{
          const logo=await uploadFirmaLogoForFirma(file, saved.id);
          const up=await app.sb.from('hov_firma').update(logo).eq('id', saved.id).select('*').single();
          if(!up.error) saved=up.data;
        }catch(e){ msg('adminMsg','Firma oppdatert, men logo kunne ikke lastes opp: '+(e.message||String(e)),'err'); }
      }
      if(saved?.id && String(saved.id)===String(app.firmaId)){
        app.firma=saved;
        updateHeader();
        renderFirma();
      }
      clearAdminFirmaForm();
      await loadAdminData();
      if(saved?.id) setVal('adminActiveFirma', saved.id);
      msg('adminMsg','Firma er oppdatert og listen er lastet på nytt.','ok');
      return;
    }

    // Nytt firma: invitasjonsvalget er separat og rører ikke den eksisterende brukerkatalogen.
    // Uten invitasjon beholdes tidligere arbeidsflyt med valgfritt midlertidig passord i brukerskjemaet.
    const createPayload={...payload, passord:val('adminUserPassword')||undefined};
    try{
      if(!sendInvite && payload.epost && createPayload.passord){
        const {data,error}=await app.sb.functions.invoke('opprett-hov-kunde', { body:createPayload });
        if(error) throw error;
        if(!data || data.ok === false) throw new Error(data?.error || data?.message || 'Ukjent feil fra opprett-hov-kunde.');
        saved=data.firma || {id:data.firma_id};
      }else{
        const {data,error}=await app.sb.from('hov_firma').insert([{...payload, logo_url:null, logo_path:null}]).select('*').single();
        if(error) throw error;
        saved=data;
      }
    }catch(err){ msg('adminMsg','Kunne ikke lagre firma: '+(err.message||String(err)),'err'); return; }
    let inviteResult=null;
    let inviteError=null;
    if(sendInvite && saved?.id){
      try{
        const redirectTo=new URL('reset.html', window.location.href).href;
        const {data,error}=await app.sb.functions.invoke('opprett-hov-kunde', { body:{
          mode:'send_invite_pa_nytt',
          firma_id:saved.id,
          epost:payload.epost,
          navn,
          linknavn:saved.linknavn || '',
          redirect_to:redirectTo
        }});
        if(error) throw error;
        if(!data || data.ok===false) throw new Error(data?.error || data?.message || 'Ukjent feil fra opprett-hov-kunde.');
        inviteResult=data;
      }catch(e){
        inviteError=e;
      }
    }
    if(file && saved?.id){
      try{
        const logo=await uploadFirmaLogoForFirma(file, saved.id);
        const up=await app.sb.from('hov_firma').update(logo).eq('id', saved.id).select('*').single();
        if(up.error){ msg('adminMsg','Firma lagret, men logo kunne ikke lagres: '+up.error.message,'err'); }
        else saved=up.data;
      }catch(e){
        msg('adminMsg','Firma lagret, men logo kunne ikke lastes opp: '+(e.message||String(e)),'err');
      }
    }
    clearAdminFirmaForm();
    await loadAdminData();
    if(saved?.id) setVal('adminActiveFirma', saved.id);
    if(inviteError){
      msg('adminMsg','Firma lagret, men invitasjonen kunne ikke sendes: '+(inviteError.message||String(inviteError))+'. Kontroller at Edge Function opprett-hov-kunde er deployet.','err');
    }else if(inviteResult){
      msg('adminMsg','Firma lagret. Invitasjon er sendt til '+payload.epost+', og brukeren er koblet til firmaet i Supabase Auth.','ok');
    }else{
      msg('adminMsg','Firma lagret. Husk å koble en brukerprofil til firmaet.','ok');
    }
  }

  async function adminResendInvite(){
    if(!app.isSysadm) return;
    const firmaId=app.adminEditFirmaId || val('adminActiveFirma');
    const firma=(app.data.adminFirmaer||[]).find(f=>String(f.id)===String(firmaId));
    const epost=val('adminFirmaEpost') || firma?.epost || '';
    const navn=val('adminFirmaNavn') || firma?.navn || '';
    if(!firmaId){ msg('adminMsg','Velg eller åpne firmaet først.','err'); return; }
    if(!epost){ msg('adminMsg','Firmaet mangler e-postadresse.','err'); return; }
    msg('adminMsg','Sender invitasjon på nytt...');
    try{
      const redirectTo=new URL('reset.html', window.location.href).href;
      const {data,error}=await app.sb.functions.invoke('opprett-hov-kunde', { body:{
        mode:'send_invite_pa_nytt', firma_id:firmaId, epost, navn, linknavn:firma?.linknavn || '', redirect_to:redirectTo
      }});
      if(error) throw error;
      if(!data || data.ok===false) throw new Error(data?.error || data?.message || 'Ukjent feil.');
      msg('adminMsg', data.melding || data.message || ('E-post sendt til '+epost+'.'),'ok');
    }catch(e){
      msg('adminMsg','Kunne ikke sende invitasjonen: '+(e.message||String(e)),'err');
    }
  }

  function clearAdminUserForm(showMsg){
    ['adminUserEpost','adminUserNavn','adminUserPassword'].forEach(id=>setVal(id,''));
    setVal('adminUserRole','hovslager');
    if(showMsg !== false) msg('adminUserMsg','Brukerskjema tømt.','ok');
  }

  function randomTempPassword(){
    return 'Hov' + Math.random().toString(36).slice(2,8) + '!' + String(Math.floor(100+Math.random()*900));
  }

  async function adminSetNewPasswordNoEmail(){
    if(!app.isSysadm) return;
    const firmaId=val('adminUserFirma');
    let password=val('adminUserPassword');
    if(!firmaId){ msg('adminUserMsg','Velg firma først.','err'); return; }
    if(!password){ password=randomTempPassword(); setVal('adminUserPassword', password); }
    if(password.length < 6){ msg('adminUserMsg','Passord må være minst 6 tegn.','err'); return; }
    const firma=(app.data.adminFirmaer||[]).find(f=>String(f.id)===String(firmaId));
    if(!confirm('Sette nytt passord for '+((firma && (firma.navn||firma.epost)) || 'valgt firma')+' uten å sende e-post?')) return;
    msg('adminUserMsg','Setter nytt passord uten e-post ...');
    try{
      const body={ firma_id:firmaId, passord:password, nytt_passord:password, password, reset_passord:true, no_email:true, email_confirm:true };
      const {data,error}=await app.sb.functions.invoke('oppdater-hov-kunde', { body });
      if(error) throw error;
      if(!data || data.ok === false) throw new Error(data?.error || data?.message || 'Ukjent feil fra oppdater-hov-kunde.');
      await loadAdminData();
      msg('adminUserMsg','Nytt passord er satt uten e-post. Gi dette til brukeren manuelt: '+password,'ok');
    }catch(err){
      const tekst=(err && (err.message || err.error_description || err.name)) ? (err.message || err.error_description || err.name) : String(err||'Ukjent feil');
      msg('adminUserMsg','Kunne ikke sette nytt passord uten e-post. Sjekk at Edge Function oppdater-hov-kunde støtter passordendring via firma_id. Feil: '+tekst,'err');
    }
  }

  async function adminCreateLoginUser(){
    if(!app.isSysadm) return;
    const firmaId=val('adminUserFirma');
    const email=val('adminUserEpost');
    const navn=val('adminUserNavn');
    const rolle=val('adminUserRole') || 'hovslager';
    let password=val('adminUserPassword');
    if(!firmaId){ msg('adminUserMsg','Velg firma brukeren skal høre til.','err'); return; }
    if(!email){ msg('adminUserMsg','Skriv e-post til brukeren.','err'); return; }
    if(!password){ password=randomTempPassword(); setVal('adminUserPassword', password); }
    if(password.length < 6){ msg('adminUserMsg','Passord må være minst 6 tegn.','err'); return; }
    msg('adminUserMsg','Oppretter innloggingsbruker ...');
    try{
      const {data,error}=await app.sb.functions.invoke('oppdater-hov-kunde', { body:{ firma_id:firmaId, epost:email, passord:password, navn_bruker:navn, rolle, email_confirm:true } });
      if(error) throw error;
      if(!data || data.ok === false) throw new Error(data?.error || data?.message || 'Ukjent feil fra oppdater-hov-kunde.');
      await loadAdminData();
      msg('adminUserMsg','Bruker er opprettet/oppdatert og koblet til firma. Send e-post og passord til brukeren: '+email+' / '+password,'ok');
    }catch(err){
      const tekst=(err && (err.message || err.error_description || err.name)) ? (err.message || err.error_description || err.name) : String(err||'Ukjent feil');
      msg('adminUserMsg','Kunne ikke opprette innloggingsbruker. Sjekk at Supabase Edge Function oppdater-hov-kunde er deployet. Feil: '+tekst,'err');
    }
  }

  async function adminSaveProfile(){
    if(!app.isSysadm) return;
    const authId=val('adminProfileAuthId');
    if(!authId){ msg('adminMsg','Skriv Auth User ID fra Supabase Auth.','err'); return; }
    const payload={auth_user_id:authId, firma_id:val('adminProfileFirma')||null, rolle:val('adminProfileRole')||'hovslager', epost:val('adminProfileEpost')||null, navn:val('adminProfileNavn')||null};
    const {error}=await app.sb.from('hov_profiles').upsert(payload,{onConflict:'auth_user_id'});
    if(error){ msg('adminMsg','Kunne ikke lagre profil: '+error.message,'err'); return; }
    ['adminProfileAuthId','adminProfileEpost','adminProfileNavn'].forEach(id=>setVal(id,''));
    setVal('adminProfileRole','hovslager');
    await loadAdminData();
    msg('adminMsg','Profil lagret/oppdatert.','ok');
  }




  async function runFirmaBackup(){
    if(!app.firmaId){ msg('firmaBackupMsg','Mangler firma-ID. Logg inn på nytt.','err'); return; }
    msg('firmaBackupMsg','Starter backup av eget firma...');
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'backup', mode:'manual', scope:'firma' } });
      if(error){ msg('firmaBackupMsg','Backup feilet: '+(error.message||JSON.stringify(error)),'err'); return; }
      if(data && data.ok){
        const size = data.file_size ? ` (${Math.round(Number(data.file_size)/1024)} KB)` : '';
        const link = data.signed_url ? ` <a href="${esc(data.signed_url)}" target="_blank" rel="noopener">Last ned ZIP</a>` : '';
        const el=$('firmaBackupMsg');
        if(el) el.innerHTML = `<div class="msg ok">Backup ferdig${esc(size)}: ${esc(data.file_path||'')}.${link}</div>`;
      }else msg('firmaBackupMsg','Backup svarte uventet: '+esc(JSON.stringify(data||{})),'err');
      await loadFirmaBackupLogg();
    }catch(err){ msg('firmaBackupMsg','Backup feilet: '+(err.message||String(err)),'err'); }
  }

  function renderBackupOptions(backups){
    const sel=$('firmaRestoreSelect'); if(!sel) return;
    const old=sel.value;
    sel.innerHTML = '<option value="">Velg backup</option>' + (backups||[]).map(b=>{
      const t=fmtDateTime(b.created_at);
      const label=`${t} - ${b.file_size ? Math.round(Number(b.file_size)/1024)+' KB' : 'backup'}`;
      return `<option value="${esc(b.file_path||'')}">${esc(label)}</option>`;
    }).join('');
    if(old) sel.value=old;
  }

  async function loadFirmaBackupLogg(){
    if(!app.firmaId) return;
    const el=$('firmaBackupList');
    if(el) el.innerHTML='<div class="msg">Laster backup-logg...</div>';
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'list' } });
      if(error){ if(el) el.innerHTML='<div class="msg err">Kunne ikke lese backup-logg: '+esc(error.message)+'</div>'; return; }
      const backups=(data && data.ok) ? (data.backups||[]) : [];
      renderBackupOptions(backups);
      const rows=backups.map(b=>{
        const dl=b.signed_url ? `<a href="${esc(b.signed_url)}" target="_blank" rel="noopener">Last ned</a>` : '';
        return `<tr><td>${esc(fmtDateTime(b.created_at))}</td><td>${esc(b.status||'')}</td><td>${esc(b.backup_scope||'firma')}</td><td>${esc(b.file_path||'')}</td><td>${b.file_size ? esc(Math.round(Number(b.file_size)/1024)+' KB') : ''}</td><td>${dl}</td></tr>`;
      });
      if(el) el.innerHTML = table(['Tid','Status','Omfang','Fil','Str.','Last ned'], rows);
    }catch(err){ if(el) el.innerHTML='<div class="msg err">Kunne ikke lese backup-logg: '+esc(err.message||String(err))+'</div>'; }
  }

  async function restoreFirmaBackup(){
    const filePath=val('firmaRestoreSelect');
    if(!filePath){ msg('firmaBackupMsg','Velg backup som skal gjenopprettes.','err'); return; }
    if(!confirm('Gjenopprette valgt backup? Dette oppdaterer data med innholdet i backupen.')) return;
    msg('firmaBackupMsg','Gjenoppretter backup...');
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'restore', filsti:filePath, file_path:filePath, backup_path:filePath, confirm:true } });
      if(error){ msg('firmaBackupMsg','Restore feilet: '+(error.message||JSON.stringify(error)),'err'); return; }
      if(data && data.ok){ msg('firmaBackupMsg','Backup er gjenopprettet. Laster data på nytt...','ok'); await loadAll(); await loadFirmaBackupLogg(); }
      else msg('firmaBackupMsg','Restore svarte uventet: '+esc(JSON.stringify(data||{})),'err');
    }catch(err){ msg('firmaBackupMsg','Restore feilet: '+(err.message||String(err)),'err'); }
  }


  async function loadBackupLogg(){
    if(!app.isSysadm) return;
    const el=$('adminBackupList');
    if(el) el.innerHTML='<div class="msg">Laster backup-logg...</div>';
    try{
      // Bruk Edge Function i stedet for direkte tabell-lesing.
      // Da får sysadm også signed_url, og samme logikk fungerer for slettede firma.
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'list' } });
      if(error){
        if(el) el.innerHTML='<div class="msg err">Kunne ikke lese backup-logg: '+esc(error.message||JSON.stringify(error))+'</div>';
        return;
      }
      if(!data || !data.ok){
        if(el) el.innerHTML='<div class="msg err">Kunne ikke lese backup-logg: '+esc(JSON.stringify(data||{}))+'</div>';
        return;
      }
      app.data.backupLogg=data.backups||[];
      renderBackupLogg();
    }catch(err){
      if(el) el.innerHTML='<div class="msg err">Kunne ikke lese backup-logg: '+esc(err.message||String(err))+'</div>';
    }
  }

  function backupMeta(b){ return (b && typeof b.meta === 'object' && b.meta) ? b.meta : {}; }
  function adminBackupFirmaNavn(b){
    const firmaer = app.data.adminFirmaer || [];
    const meta = backupMeta(b);
    const idFromPath = String(b?.file_path||b?.backup_prefix||'').match(/^firma\/([^\/]+)/)?.[1] || '';
    const id = b?.firma_id || meta.firma_id || idFromPath;
    const live = id ? firmaer.find(f=>String(f.id)===String(id)) : null;
    // Hvis firmaet finnes i admin-listen, er det aktivt uansett hva eldre list-kall sier.
    if(live) return live.navn || live.epost || live.id;
    const navn = b?.firma_navn || meta.firma_navn || meta.firma?.navn || '';
    if(navn) return b?.firma_deleted ? navn + ' (slettet)' : navn;
    if(id) return b?.firma_deleted ? id + ' (slettet)' : id;
    return '';
  }
  function adminBackupFirmaEier(b){
    const meta = backupMeta(b);
    return b?.firma_epost || meta.firma_epost || meta.owner_email || b?.requested_email || '';
  }
  function adminBackupFirmaOrgnr(b){
    const meta = backupMeta(b);
    return b?.firma_orgnr || meta.firma_orgnr || meta.orgnr || '';
  }

  function renderAdminRestoreOptions(){
    const sel=$('adminRestoreSelect'); if(!sel) return;
    const old=sel.value;
    const backups=(app.data.backupLogg||[]).filter(b=>b.status==='ok' && b.file_path && String(b.backup_type||'') !== 'restore');
    sel.innerHTML = '<option value="">Velg backup</option>' + backups.map(b=>{
      const t=fmtDateTime(b.created_at);
      const firma=adminBackupFirmaNavn(b) || 'Slettet/ukjent firma';
      const eier=adminBackupFirmaEier(b);
      const org=adminBackupFirmaOrgnr(b);
      const size=b.file_size ? ` - ${Math.round(Number(b.file_size)/1024)} KB` : '';
      const label=`${t} - ${firma}${eier ? ' - '+eier : ''}${org ? ' - org '+org : ''}${size}`;
      // Bruk backup-logg ID i GUI. Edge Function finner file_path selv.
      return `<option value="${esc(b.id||b.file_path||'')}" data-file-path="${esc(b.file_path||'')}">${esc(label)}</option>`;
    }).join('');
    if(old) sel.value=old;
  }

  function backupSearchText(b){
    return [fmtDateTime(b.created_at), b.status, b.backup_scope, adminBackupFirmaNavn(b), adminBackupFirmaEier(b), adminBackupFirmaOrgnr(b), b.backup_type, b.file_path, b.backup_prefix, b.error_message]
      .map(x=>String(x||'').toLowerCase()).join(' ');
  }

  function renderBackupToolbar(list){
    const total=(app.data.backupLogg||[]).length;
    const shown=list.length;
    const filter=app.adminBackupFilter||'all';
    const btn=(key,label)=>`<button type="button" class="small-btn ${filter===key?'ok':'secondary'}" data-backup-filter="${key}">${label}</button>`;
    return `<div class="msg" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <strong>Backup v2</strong>
      ${btn('all','Alle')}${btn('active','Aktive firma')}${btn('deleted','Slettede firma')}${btn('system','System')}
      <input id="adminBackupSearch" type="search" placeholder="Søk firma, e-post, org.nr, dato ..." value="${esc(app.adminBackupSearch||'')}" style="min-width:320px;max-width:100%;padding:8px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e5e7eb">
      <span class="muted">Viser ${shown} av ${total}. Velg Alle for å se både aktive og slettede firma.</span>
    </div>`;
  }

  function backupFilterMatch(b){
    const filter=app.adminBackupFilter||'all';
    if(filter==='active'){
      const idFromPath = String(b?.file_path||b?.backup_prefix||'').match(/^firma\/([^\/]+)/)?.[1] || '';
      const firmaId = b?.firma_id || backupMeta(b).firma_id || idFromPath;
      const liveFirma = firmaId ? (app.data.adminFirmaer||[]).some(f=>String(f.id)===String(firmaId)) : false;
      return b.backup_scope==='firma' && (liveFirma || !b.firma_deleted);
    }
    if(filter==='deleted'){
      const idFromPath = String(b?.file_path||b?.backup_prefix||'').match(/^firma\/([^\/]+)/)?.[1] || '';
      const firmaId = b?.firma_id || backupMeta(b).firma_id || idFromPath;
      const liveFirma = firmaId ? (app.data.adminFirmaer||[]).some(f=>String(f.id)===String(firmaId)) : false;
      return b.backup_scope==='firma' && !!b.firma_deleted && !liveFirma;
    }
    if(filter==='system') return b.backup_scope==='system';
    return true;
  }

  function renderBackupLogg(){
    const search=String(app.adminBackupSearch||'').trim().toLowerCase();
    const list=(app.data.backupLogg||[])
      .filter(b=>backupFilterMatch(b))
      .filter(b=>!search || backupSearchText(b).includes(search))
      .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    const rows=list.map(b=>{
      const firmaNavn = adminBackupFirmaNavn(b) || (b.backup_scope === 'firma' ? 'Slettet/ukjent firma' : 'Systembackup');
      const eier=adminBackupFirmaEier(b);
      const org=adminBackupFirmaOrgnr(b);
      const file=b.file_path || b.backup_prefix || '';
      const idFromPath = String(b?.file_path||b?.backup_prefix||'').match(/^firma\/([^\/]+)/)?.[1] || '';
      const firmaId = b?.firma_id || backupMeta(b).firma_id || idFromPath;
      const liveFirma = firmaId ? (app.data.adminFirmaer||[]).find(f=>String(f.id)===String(firmaId)) : null;
      const isDeleted = b.backup_scope==='firma' && !!firmaId && !liveFirma && !!b.firma_deleted;
      const deleted=isDeleted ? '<br><span class="pill">Slettet firma</span>' : (b.backup_scope==='firma' ? '<br><span class="pill">Aktivt firma</span>' : '');
      const dl=b.signed_url ? `<a href="${esc(b.signed_url)}" target="_blank" rel="noopener">Last ned</a>` : '';
      const restoreBtn=(b.status==='ok' && b.file_path && String(b.backup_type||'') !== 'restore')
        ? `<button type="button" class="small-btn ok" data-admin-restore-id="${esc(b.id||b.file_path||'')}">Gjenopprett</button>` : '<span class="muted">Logg</span>';
      const actions=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${restoreBtn}${dl}</div>`;
      return `<tr><td>${esc(fmtDateTime(b.created_at))}</td><td>${esc(b.status||'')}</td><td>${esc(b.backup_scope||'system')}</td><td><strong>${esc(firmaNavn)}</strong>${deleted}${org ? '<br><span class="muted">Org: '+esc(org)+'</span>' : ''}</td><td>${esc(eier)}</td><td>${esc(b.backup_type||'')}</td><td>${esc(file)}</td><td>${b.file_size ? esc(Math.round(Number(b.file_size)/1024)+' KB') : ''}</td><td>${actions}</td><td>${esc(b.error_message||'')}</td></tr>`;
    });
    renderAdminRestoreOptions();
    const el=$('adminBackupList');
    if(el){
      el.innerHTML = renderBackupToolbar(list) + table(['Tid','Status','Omfang','Firma','Eier/e-post','Type','Fil/prefix','Str.','Handling','Feil'], rows);
      const searchEl=$('adminBackupSearch');
      if(searchEl){ searchEl.addEventListener('input',()=>{ app.adminBackupSearch=searchEl.value; renderBackupLogg(); }); }
      el.querySelectorAll('[data-backup-filter]').forEach(btn=>btn.addEventListener('click',()=>{ app.adminBackupFilter=btn.dataset.backupFilter||'all'; renderBackupLogg(); }));
      el.querySelectorAll('[data-admin-restore-id]').forEach(btn=>btn.addEventListener('click',()=>adminRestoreBackup(btn.dataset.adminRestoreId)));
    }
  }

  async function adminRestoreBackup(backupIdArg){
    if(!app.isSysadm){ msg('adminBackupMsg','Bare sysadm kan gjenopprette backup fra adminpanelet.','err'); return; }
    const backupId=backupIdArg || val('adminRestoreSelect');
    if(!backupId){ msg('adminBackupMsg','Velg backup som skal gjenopprettes.','err'); return; }
    const backup=(app.data.backupLogg||[]).find(b=>String(b.id)===String(backupId) || String(b.file_path)===String(backupId));
    const firma=backup ? (adminBackupFirmaNavn(backup) || 'slettet/ukjent firma') : 'valgt backup';
    if(!confirm('Gjenopprette backup for '+firma+'? Dette vil skrive tilbake data fra backupfilen. Fortsette?')) return;
    msg('adminBackupMsg','Gjenoppretter backup...');
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'restore', backup_id:backup?.id||'', filsti:backup?.file_path||backupId, file_path:backup?.file_path||backupId, backup_path:backup?.file_path||backupId, confirm:true } });
      if(error){ msg('adminBackupMsg','Restore feilet: '+(error.message||JSON.stringify(error)),'err'); return; }
      if(data && data.ok){
        msg('adminBackupMsg','Backup er gjenopprettet. Laster adminliste og backup-logg på nytt...','ok');
        await loadAdminData();
        await loadBackupLogg();
        if(backup?.file_path && String(backup.file_path).startsWith('firma/') && app.firmaId){ await loadAll(); }
      }else{
        msg('adminBackupMsg','Restore svarte uventet: '+esc(JSON.stringify(data||{})),'err');
      }
    }catch(err){
      msg('adminBackupMsg','Restore feilet: '+(err.message||String(err)),'err');
    }
  }

  async function runBackup(body){
    if(!app.isSysadm){ msg('adminBackupMsg','Bare sysadm kan ta backup fra adminpanelet.','err'); return; }
    msg('adminBackupMsg','Starter backup. Dette kan ta litt tid...');
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body });
      if(error){ msg('adminBackupMsg','Backup feilet: '+(error.message||JSON.stringify(error)),'err'); return; }
      if(data && data.ok){
        msg('adminBackupMsg','Backup ferdig: '+(data.file_path||data.prefix||'')+' ('+(data.backup_scope||body.scope||'')+')','ok');
      } else {
        msg('adminBackupMsg','Backup svarte uventet: '+esc(JSON.stringify(data||{})),'err');
      }
      await loadBackupLogg();
    }catch(err){
      msg('adminBackupMsg','Backup feilet: '+(err.message||String(err)),'err');
    }
  }

  async function adminRunFirmaBackup(){
    const firmaId = val('adminBackupFirma') || app.firmaId;
    if(!firmaId){ msg('adminBackupMsg','Velg firma først.','err'); return; }
    await runBackup({ mode:'manual', scope:'firma', firma_id:firmaId });
  }

  function appFakturaSettingsKey(){ return 'hov_app_faktura_settings_v1'; }
  function defaultAppFakturaSettings(){
    const f=app.firma||{};
    return {
      logo:'',
      brevhode:f.navn || 'Rettilomma',
      orgnr:f.orgnr || f.org_nr || '',
      adresse:f.adresse || '',
      epost:f.epost || 'salg@rettilomma.com',
      telefon:f.telefon || '',
      kontonr:f.kontonr || '',
      standardTekst:'Abonnement HovslagerSystem',
      bunntekst:'Takk for handelen.'
    };
  }
  function loadAppFakturaSettings(){
    try{ return {...defaultAppFakturaSettings(), ...(JSON.parse(localStorage.getItem(appFakturaSettingsKey()) || '{}') || {})}; }
    catch(_){ return defaultAppFakturaSettings(); }
  }
  function saveAppFakturaSettingsObject(settings){ localStorage.setItem(appFakturaSettingsKey(), JSON.stringify(settings || {})); }
  function loadAppFakturaSettingsForm(){
    if(!app.isSysadm) return;
    const s=loadAppFakturaSettings();
    setVal('appFakturaBrevhode', s.brevhode);
    setVal('appFakturaOrgNr', s.orgnr);
    setVal('appFakturaKonto', s.kontonr);
    setVal('appFakturaAvsenderEpost', s.epost);
    setVal('appFakturaAvsenderTelefon', s.telefon);
    setVal('appFakturaAvsenderAdresse', s.adresse);
    setVal('appFakturaStandardTekst', s.standardTekst);
    setVal('appFakturaBunntekst', s.bunntekst);
    const p=$('appFakturaLogoPreview');
    if(p) p.innerHTML = s.logo ? `<img class="thumb" src="${esc(s.logo)}" alt="Logo">` : '<span class="muted">Ingen logo valgt.</span>';
  }
  function saveAppFakturaSettings(){
    if(!app.isSysadm){ msg('appFakturaDesignMsg','Bare sysadm kan endre disse innstillingene.','err'); return; }
    const old=loadAppFakturaSettings();
    const settings={
      ...old,
      brevhode:val('appFakturaBrevhode') || old.brevhode || 'Rettilomma',
      orgnr:val('appFakturaOrgNr'),
      kontonr:val('appFakturaKonto'),
      epost:val('appFakturaAvsenderEpost'),
      telefon:val('appFakturaAvsenderTelefon'),
      adresse:val('appFakturaAvsenderAdresse'),
      standardTekst:val('appFakturaStandardTekst') || 'Abonnement HovslagerSystem',
      bunntekst:val('appFakturaBunntekst')
    };
    saveAppFakturaSettingsObject(settings);
    loadAppFakturaSettingsForm();
    msg('appFakturaDesignMsg','Fakturainnstillinger er lagret.','ok');
  }
  function readAppFakturaLogo(){
    if(!app.isSysadm) return;
    const file=$('appFakturaLogoFile')?.files?.[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      const s=loadAppFakturaSettings();
      s.logo=String(reader.result||'');
      saveAppFakturaSettingsObject(s);
      loadAppFakturaSettingsForm();
      msg('appFakturaDesignMsg','Logo er lagret.','ok');
    };
    reader.readAsDataURL(file);
  }
  function clearAppFakturaLogo(){
    if(!app.isSysadm){ msg('appFakturaDesignMsg','Bare sysadm kan fjerne logo.','err'); return; }
    const s=loadAppFakturaSettings();
    s.logo='';
    saveAppFakturaSettingsObject(s);
    const f=$('appFakturaLogoFile'); if(f) f.value='';
    loadAppFakturaSettingsForm();
    msg('appFakturaDesignMsg','Logo er fjernet.','ok');
  }

  function appFakturaStorageKey(){ return 'hov_app_fakturaer_v1'; }
  function loadAppFakturaerLocal(){
    try{ return JSON.parse(localStorage.getItem(appFakturaStorageKey()) || '[]') || []; }
    catch(_){ return []; }
  }
  function saveAppFakturaerLocal(rows){ localStorage.setItem(appFakturaStorageKey(), JSON.stringify(rows || [])); }
  function appFakturaNr(){
    const rows=loadAppFakturaerLocal();
    const max=rows.reduce((m,r)=>Math.max(m, Number(String(r.nr||'').replace(/\D/g,''))||0), 0);
    return 'APP-' + String(max + 1).padStart(4,'0');
  }
  function appFirmaById(id){ return (app.data.adminFirmaer||[]).find(f=>String(f.id)===String(id)) || {}; }
  function datePlusDays(days){ const d=new Date(); d.setDate(d.getDate()+Number(days||14)); return d.toISOString().slice(0,10); }
  function invoiceLang(){
    const l=localStorage.getItem('hov_language')||'nb';
    return ['nb','sv','en'].includes(l)?l:'nb';
  }
  function invoiceT(key){
    const dict={
      nb:{invoice:'Faktura',invoiceDraft:'Fakturautkast',preview:'Forhåndsvisning – ikke fakturert',customer:'Kunde',date:'Dato',due:'Forfall',description:'Beskrivelse',horse:'Hest',amountExVat:'Beløp eks. mva',amountInclVat:'Beløp inkl. mva',vat:'MVA',total:'Å betale',payment:'Betaling',account:'Kontonr',statusSent:'sendt',farrierWork:'Hovslagerjobb',credited:'Kreditert beløp',reminder:'Purring',creditNote:'Kreditnota',from:'fra',hello:'Hei',regards:'Hilsen',attachedInvoice:'Vedlagt/gjeldende faktura',amount:'Beløp',print:'Skriv ut',sendEmail:'Send på e-post',close:'Lukk'},
      sv:{invoice:'Faktura',invoiceDraft:'Fakturautkast',preview:'Förhandsvisning – inte fakturerad',customer:'Kund',date:'Datum',due:'Förfallodatum',description:'Beskrivning',horse:'Häst',amountExVat:'Belopp exkl. moms',amountInclVat:'Belopp inkl. moms',vat:'Moms',total:'Att betala',payment:'Betalning',account:'Bankkonto',statusSent:'skickad',farrierWork:'Hovslagararbete',credited:'Krediterat belopp',reminder:'Påminnelse',creditNote:'Kreditnota',from:'från',hello:'Hej',regards:'Vänliga hälsningar',attachedInvoice:'Bifogad/gällande faktura',amount:'Belopp',print:'Skriv ut',sendEmail:'Skicka med e-post',close:'Stäng'},
      en:{invoice:'Invoice',invoiceDraft:'Invoice draft',preview:'Preview – not invoiced',customer:'Customer',date:'Invoice date',due:'Due date',description:'Description',horse:'Horse',amountExVat:'Amount excl. VAT',amountInclVat:'Amount incl. VAT',vat:'VAT',total:'Amount due',payment:'Payment details',account:'Account number',statusSent:'sent',farrierWork:'Farrier service',credited:'Credited amount',reminder:'Payment reminder',creditNote:'Credit note',from:'from',hello:'Hello',regards:'Kind regards',attachedInvoice:'Attached/current invoice',amount:'Amount',print:'Print',sendEmail:'Send by email',close:'Close'}
    };
    return (dict[invoiceLang()]&&dict[invoiceLang()][key])||dict.nb[key]||key;
  }
  function appFakturaHtml(f, opts){
    const settings=loadAppFakturaSettings();
    const kunde=f.kunde||appFirmaById(f.firma_id)||{};
    const title=invoiceT('invoice')+' '+(f.nr||'');
    const logo=settings.logo ? `<img class="logo" src="${esc(settings.logo)}" alt="Logo">` : '';
    const printScript = opts?.autoPrint === false ? '' : '<script>window.print && setTimeout(()=>window.print(),300)<\/script>';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:Arial,sans-serif;padding:30px;color:#111}.top{display:flex;justify-content:space-between;gap:40px;align-items:flex-start}.logo{max-height:85px;max-width:220px;margin-bottom:12px}h1{margin:0 0 10px}.sender{text-align:right;line-height:1.45}.box{border:1px solid #ddd;padding:14px;margin:14px 0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}.right{text-align:right}.total{font-size:20px;font-weight:bold}.muted{color:#666}.status{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:6px 10px}.footer{margin-top:35px;border-top:1px solid #ddd;padding-top:12px;color:#555;white-space:pre-line}
/* MOBILVENNLIG LES-INN: bare én funksjon/knapp vises */
#navReadLastJobbBtn{display:none!important}
#voiceStopJobbBtn,#voiceUseTextJobbBtn,#voiceOpenLastJobbBtn,#voiceDeleteLastJobbBtn{display:none!important}
#voiceNewJobbBtn.voice-on{position:sticky;bottom:12px;z-index:50;width:100%;justify-content:center;font-size:20px;padding:18px;border-radius:16px}
.voice-saved-actions{display:none!important}
.quick-job .muted{font-size:15px;line-height:1.35}
@media(max-width:800px){.quick-job{padding:14px}.quick-job .actions{display:grid;grid-template-columns:1fr}.quick-job textarea{min-height:130px}}

</style>
      </head><body>
      <div class="top"><div>${logo}<h1>${esc(title)}</h1><div class="status">${esc(f.status||invoiceT('statusSent'))}</div></div><div class="sender"><strong>${esc(settings.brevhode||'Rettilomma')}</strong><br>${settings.orgnr ? 'Org.nr: '+esc(settings.orgnr)+'<br>' : ''}${esc(settings.adresse||'')}<br>${esc(settings.epost||'')}<br>${esc(settings.telefon||'')}</div></div>
      <div class="box"><strong>${esc(invoiceT('customer'))}</strong><br>${esc(kunde.navn||'')}<br>${esc(kunde.adresse||'')}<br>${esc(kunde.epost||'')}</div>
      <p><strong>${esc(invoiceT('date')+':')}</strong> ${esc(f.dato||'')}<br><strong>${esc(invoiceT('due')+':')}</strong> ${esc(f.forfall||'')}</p>
      <table><thead><tr><th>${esc(invoiceT('description'))}</th><th class="right">${esc(invoiceT('amountInclVat'))}</th></tr></thead><tbody>
      <tr><td>${esc(f.tekst||settings.standardTekst||'Abonnement HovslagerSystem')}</td><td class="right">${kr(f.belop||0)}</td></tr>
      </tbody></table>
      <p class="right total">${esc(invoiceT('total'))}: ${kr(f.belop||0)}</p>
      <div class="box"><strong>${esc(invoiceT('payment'))}</strong><br>${esc(invoiceT('account'))}: ${esc(settings.kontonr||'')}</div>
      ${settings.bunntekst ? `<div class="footer">${esc(settings.bunntekst)}</div>` : ''}
      ${printScript}</body></html>`;
  }
  function visAppFaktura(id){
    if(!app.isSysadm){ msg('dashMsg','Bare sysadm kan vise appfaktura.','err'); return; }
    const f=loadAppFakturaerLocal().find(x=>String(x.id)===String(id));
    if(!f){ msg('appFakturaMsg','Fant ikke faktura.','err'); return; }
    const w=window.open('', '_blank');
    if(!w){ msg('appFakturaMsg','Nettleseren blokkerte popup. Tillat popup for å vise faktura.','err'); return; }
    w.document.open(); w.document.write(appFakturaHtml(f)); w.document.close();
  }
  function sendAppFakturaEpost(id){
    if(!app.isSysadm){ msg('dashMsg','Bare sysadm kan sende appfaktura.','err'); return; }
    const f=loadAppFakturaerLocal().find(x=>String(x.id)===String(id));
    if(!f){ msg('appFakturaMsg','Fant ikke faktura.','err'); return; }
    const kunde=f.kunde||appFirmaById(f.firma_id)||{};
    if(!kunde.epost){ msg('appFakturaMsg','Kunden mangler e-postadresse.','err'); return; }
    const settings=loadAppFakturaSettings();
    const subject=invoiceT('invoice')+' '+(f.nr||'')+' '+invoiceT('from')+' '+(settings.brevhode||app.firma?.navn||'Rettilomma');
    const body=[
      invoiceT('hello')+' '+(kunde.navn||'')+',',
      '',
      invoiceT('attachedInvoice')+' '+(f.nr||'')+' for '+(f.tekst||'abonnement')+'.',
      invoiceT('amount')+': '+kr(f.belop||0),
      invoiceT('due')+': '+(f.forfall||''),
      '',
      invoiceT('account')+': '+(settings.kontonr||''),
      '',
      invoiceT('regards'),
      settings.brevhode||app.firma?.navn||'Rettilomma'
    ].filter(x=>x!==null).join('\n');
    window.location.href='mailto:'+encodeURIComponent(kunde.epost)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    msg('appFakturaMsg','Hovslagerens eget e-postprogram er åpnet. Kontroller og send meldingen derfra.','ok');
  }
  async function setAppFirmaRolle(firmaId, rolle){
    const profiler=(app.data.adminProfiler||[]).filter(p=>String(p.firma_id)===String(firmaId));
    let feil=[];
    for(const p of profiler){
      const {error}=await app.sb.from('hov_profiles').update({rolle}).eq('auth_user_id', p.auth_user_id);
      if(error) feil.push(error.message);
    }
    if(feil.length) throw new Error(feil[0]);
    await loadAdminData();
  }
  async function appFakturaBetalt(id){
    if(!app.isSysadm){ msg('appFakturaMsg','Bare sysadm kan sette appfaktura betalt.','err'); return; }
    const rows=loadAppFakturaerLocal();
    const f=rows.find(x=>String(x.id)===String(id));
    if(!f) return;
    f.status='betalt'; f.betalt_dato=today(); saveAppFakturaerLocal(rows);
    try{ await setAppFirmaRolle(f.firma_id,'hovslager'); msg('appFakturaMsg','Faktura er satt betalt og brukeren er aktivert.','ok'); }
    catch(e){ msg('appFakturaMsg','Faktura satt betalt, men kunne ikke aktivere bruker: '+(e.message||e),'err'); }
    renderAppFakturaer();
  }
  async function appFakturaDeaktiver(id){
    if(!app.isSysadm){ msg('appFakturaMsg','Bare sysadm kan deaktivere hovslagere.','err'); return; }
    const rows=loadAppFakturaerLocal();
    const f=rows.find(x=>String(x.id)===String(id));
    if(!f) return;
    if(!confirm('Deaktivere tilgang for '+((f.kunde&&f.kunde.navn)||'kunden')+'?')) return;
    f.status='deaktivert'; f.deaktivert_dato=today(); saveAppFakturaerLocal(rows);
    try{ await setAppFirmaRolle(f.firma_id,'deaktivert'); msg('appFakturaMsg','Kunden er deaktivert.','ok'); }
    catch(e){ msg('appFakturaMsg','Faktura markert deaktivert, men kunne ikke deaktivere bruker: '+(e.message||e),'err'); }
    renderAppFakturaer();
  }
  async function lagAppFaktura(){
    if(!app.isSysadm){ msg('appFakturaMsg','Bare sysadm kan lage appfaktura til hovslagere.','err'); return; }
    const firmaId=val('appFakturaFirma');
    const kunde=appFirmaById(firmaId);
    if(!firmaId || !kunde.id){ msg('appFakturaMsg','Velg hovslager/firma først.','err'); return; }
    const belop=num('appFakturaBelop');
    if(!belop){ msg('appFakturaMsg','Skriv beløp først.','err'); return; }
    const rows=loadAppFakturaerLocal();
    const settings=loadAppFakturaSettings();
    const f={id:String(Date.now())+'-'+Math.random().toString(36).slice(2), nr:appFakturaNr(), firma_id:firmaId, kunde:{navn:kunde.navn||'', epost:kunde.epost||'', adresse:kunde.adresse||''}, dato:today(), forfall:datePlusDays(val('appFakturaForfallDager')||14), tekst:val('appFakturaTekst')||settings.standardTekst||'Abonnement HovslagerSystem', belop, status:'opprettet'};
    rows.unshift(f); saveAppFakturaerLocal(rows); renderAppFakturaer(); msg('appFakturaMsg','Faktura '+f.nr+' er laget. Bruk Vis og Send e-post.','ok'); visAppFaktura(f.id);
  }
  function renderAppFakturaer(){
    const el=$('appFakturaList'); if(!el) return;
    if(!app.isSysadm){ el.innerHTML=''; return; }
    const rows=loadAppFakturaerLocal();
    const html=rows.map(f=>`<tr><td>${esc(f.dato||'')}</td><td>${esc(f.nr||'')}</td><td>${esc((f.kunde&&f.kunde.navn)||appFirmaById(f.firma_id).navn||'')}</td><td>${esc((f.kunde&&f.kunde.epost)||'')}</td><td>${kr(f.belop||0)}</td><td>${esc(f.forfall||'')}</td><td>${esc(f.status||'')}</td><td class="actions"><button type="button" class="small-btn secondary" data-app-vis="${esc(f.id)}">Vis</button><button type="button" class="small-btn" data-app-send="${esc(f.id)}">Send e-post</button>${f.status==='betalt'?'':`<button type="button" class="small-btn ok" data-app-betalt="${esc(f.id)}">Sett betalt</button>`}<button type="button" class="small-btn danger" data-app-deaktiver="${esc(f.id)}">Deaktiver</button></td></tr>`);
    el.innerHTML=table(['Dato','Nr','Hovslager','E-post','Beløp','Forfall','Status','Handling'], html);
    el.querySelectorAll('[data-app-vis]').forEach(b=>b.addEventListener('click',()=>visAppFaktura(b.dataset.appVis)));
    el.querySelectorAll('[data-app-send]').forEach(b=>b.addEventListener('click',()=>sendAppFakturaEpost(b.dataset.appSend)));
    el.querySelectorAll('[data-app-betalt]').forEach(b=>b.addEventListener('click',()=>appFakturaBetalt(b.dataset.appBetalt)));
    el.querySelectorAll('[data-app-deaktiver]').forEach(b=>b.addEventListener('click',()=>appFakturaDeaktiver(b.dataset.appDeaktiver)));
  }

  async function adminRunSystemBackup(){
    if(!app.isSysadm){ msg('adminBackupMsg','Bare sysadm kan ta backup av alle firmaer.','err'); return; }
    const antall=(app.data.adminFirmaer||[]).length;
    const tekst=antall ? `Ta backup av alle ${antall} registrerte firmaer nå?` : 'Ta backup av alle registrerte firmaer nå?';
    if(!confirm(tekst+' Det blir laget én separat backupfil per firma.')) return;
    const btn=$('adminBackupSystemBtn');
    if(btn){ btn.disabled=true; btn.textContent='Tar backup av alle firmaer...'; }
    msg('adminBackupMsg','Starter backup av alle firmaer. Ikke lukk siden før resultatet vises...');
    try{
      const {data,error}=await app.sb.functions.invoke('backup-hovslager-firma', { body:{ action:'backup', mode:'manual', scope:'system' } });
      if(error){ msg('adminBackupMsg','Backup av alle firmaer feilet: '+(error.message||JSON.stringify(error)),'err'); return; }
      const ok=Number(data?.antall_ok||0), feil=Number(data?.antall_feil||0), total=Number(data?.antall_firma||ok+feil);
      if(data && (data.ok || ok>0)){
        msg('adminBackupMsg',`Backup ferdig: ${ok} av ${total} firmaer sikkerhetskopiert${feil ? `, ${feil} feilet` : ''}.`,feil?'err':'ok');
      }else{
        msg('adminBackupMsg','Backup svarte uventet: '+esc(JSON.stringify(data||{})),'err');
      }
      await loadBackupLogg();
    }catch(err){
      msg('adminBackupMsg','Backup av alle firmaer feilet: '+(err.message||String(err)),'err');
    }finally{
      if(btn){ btn.disabled=false; btn.textContent='Ta backup av alle firmaer'; }
    }
  }



  function fakturaForJobb(jobbId){
    return (app.data.fakturaer||[]).find(f =>
      String(f.jobb_id||'') === String(jobbId) ||
      String(f.jobb_ids||'').includes(String(jobbId)) ||
      (Array.isArray(f.jobber) && f.jobber.map(String).includes(String(jobbId)))
    );
  }

  function kreditnotaForFaktura(fakturaId){
    return (app.data.kreditnotaer||[]).find(k =>
      String(k.faktura_id||'') === String(fakturaId) ||
      String(k.original_faktura_id||'') === String(fakturaId)
    );
  }

  function fakturaNr(){
    const prefix = app.firma?.faktura_prefix || 'F';
    const neste = Number(app.firma?.neste_fakturanr || 1);
    return prefix + String(neste).padStart(4,'0');
  }

  async function incrementFakturaNr(){
    const neste = Number(app.firma?.neste_fakturanr || 1) + 1;
    const {data,error}=await app.sb.from('hov_firma').update({neste_fakturanr:neste}).eq('id',app.firmaId).select('*').single();
    if(!error && data){ app.firma=data; renderFirma(); }
  }


  async function sendJobbTilTripletex(jobbId, button){
    const j=(app.data.jobber||[]).find(x=>String(x.id)===String(jobbId));
    if(!j){ msg('fakturaMsg','Fant ikke jobben.','err'); return; }
    if(j.fakturert || fakturaForJobb(j.id)){ msg('fakturaMsg','Jobben er allerede fakturert.','err'); return; }
    const kunde=(app.data.kunder||[]).find(k=>String(k.id)===String(j.kunde_id));
    if(!kunde){ msg('fakturaMsg','Fant ikke kunden på jobben.','err'); return; }
    if(!confirm('Overføre kunden og lage faktura i Tripletex?')) return;
    const oldText=button?.textContent;
    if(button){ button.disabled=true; button.textContent='Sender ...'; }
    try{
      const dato=today();
      const forfall=new Date();
      forfall.setDate(forfall.getDate()+Number(app.firma?.betalingsfrist_dager || 14));
      const forfallsdato=forfall.toISOString().slice(0,10);
      const rawEks=Number(j.arbeid_belop||0)+Number(j.varer_belop||0)+(Number(j.km||0)*Number(j.km_pris||0));
      const amounts=calculateInvoiceAmounts(rawEks); const eks=amounts.eks, mva=amounts.mva, inkl=amounts.inkl, tax=amounts.tax;
      if(tax.requiresReview){ throw new Error('Avgiftsbehandlingen må vurderes og settes manuelt før faktura kan sendes. '+(tax.note||'')); }
      msg('fakturaMsg','Overfører kunde og faktura til Tripletex ...');
      const {data,error}=await app.sb.functions.invoke('tripletex',{body:{
        appId:'hov', action:'create_invoice',
        customer:{name:kunde.navn,email:kunde.epost,phone:kunde.telefon,address:kunde.adresse,postalCode:kunde.postnr,city:kunde.poststed,organizationNumber:kunde.orgnr||kunde.org_nr},
        job:{id:j.id,date:j.dato,jobbtype:j.jobbtype,description:(j.jobbtype||'Hovslagerarbeid')+(hestNavn(j.hest_id)?' - '+hestNavn(j.hest_id):'')},
        invoice:{date:dato,dueDate:forfallsdato,amountExVat:eks,vat:mva,total:inkl,description:'Hovslagerarbeid '+(j.jobbtype||'')+' '+(j.dato||''),vatRate:tax.rate,taxTreatment:tax.mode,taxNote:tax.note}
      }});
      if(error) throw error;
      if(!data?.ok) throw new Error(data?.error || 'Tripletex svarte uten bekreftelse.');
      const tripletexNr=String(data?.invoice?.invoiceNumber || data?.invoice?.number || data?.invoice?.id || fakturaNr());
      const txInvoiceId=String(data?.invoice?.id||'');
      const txCustomerId=String(data?.customer?.id||'');
      const txOrderId=String(data?.order?.id||'');
      const marker=' [Tripletex invoiceId='+txInvoiceId+' customerId='+txCustomerId+' orderId='+txOrderId+']';
      const payload={firma_id:app.firmaId,kunde_id:j.kunde_id,jobb_id:j.id,fakturanr:tripletexNr,dato,forfallsdato,eks_mva:eks,mva,inkl_mva:inkl,status:'ubetalt',betalingsstatus:'ubetalt',tekst:'Tripletex-faktura for jobb '+(j.jobbtype||'')+' '+(j.dato||'')+marker+taxMarker(tax),tripletex_invoice_id:txInvoiceId||null,tripletex_customer_id:txCustomerId||null,tripletex_order_id:txOrderId||null};
      let saved=await app.sb.from('hov_fakturaer').insert(payload).select('*').single();
      if(saved.error && /column|schema cache|tripletex_/i.test(saved.error.message||'')){
        const fallback={...payload}; delete fallback.tripletex_invoice_id; delete fallback.tripletex_customer_id; delete fallback.tripletex_order_id;
        saved=await app.sb.from('hov_fakturaer').insert(fallback).select('*').single();
      }
      if(saved.error) throw new Error('Fakturaen ble laget i Tripletex, men kunne ikke lagres lokalt: '+saved.error.message);
      const up=await app.sb.from('hov_jobber').update({fakturert:true}).eq('id',j.id).eq('firma_id',app.firmaId);
      if(up.error) throw new Error('Fakturaen ble laget i Tripletex, men jobben kunne ikke merkes fakturert: '+up.error.message);
      await loadJobber(); await loadFakturaer(); renderFakturaer();
      msg('fakturaMsg','Faktura '+tripletexNr+' er laget i Tripletex. '+(data.customerCreated?'Kunden ble også opprettet.':'Eksisterende kunde ble brukt.'),'ok');
    }catch(e){
      let detail=e?.message||String(e);
      try{ if(e?.context?.json) detail=JSON.stringify(await e.context.json()); }catch(_){ }
      msg('fakturaMsg','Kunne ikke sende til Tripletex: '+detail,'err');
      console.error('Tripletex create_invoice feilet',e);
    }finally{
      if(button){ button.disabled=false; button.textContent=oldText||'Send til Tripletex'; }
    }
  }

  async function lagFakturaFraJobb(jobbId){
    const j=(app.data.jobber||[]).find(x=>String(x.id)===String(jobbId));
    if(!j){ msg('fakturaMsg','Fant ikke jobben.','err'); return; }
    if(j.fakturert || fakturaForJobb(j.id)){
      msg('fakturaMsg','Jobben er allerede fakturert. Åpner fakturakopi i stedet.','err');
      visFakturaForJobb(j.id);
      return;
    }
    const kunde=(app.data.kunder||[]).find(k=>String(k.id)===String(j.kunde_id));
    const nr=fakturaNr();
    const dato=today();
    const forfall=new Date();
    forfall.setDate(forfall.getDate()+Number(app.firma?.betalingsfrist_dager || 14));
    const forfallsdato=forfall.toISOString().slice(0,10);
    const rawEks=Number(j.arbeid_belop||0)+Number(j.varer_belop||0)+(Number(j.km||0)*Number(j.km_pris||0));
    const amounts=calculateInvoiceAmounts(rawEks); const eks=amounts.eks, mva=amounts.mva, inkl=amounts.inkl, tax=amounts.tax;
    if(tax.requiresReview){ msg('fakturaMsg','Avgiftsbehandlingen må vurderes og settes manuelt før faktura kan opprettes. '+(tax.note||''),'err'); return; }
    const payload={
      firma_id:app.firmaId,
      kunde_id:j.kunde_id,
      jobb_id:j.id,
      fakturanr:nr,
      dato,
      forfallsdato,
      eks_mva:eks,
      mva,
      inkl_mva:inkl,
      status:'ubetalt',
      betalingsstatus:'ubetalt',
      tekst:'Faktura for jobb '+(j.jobbtype||'')+' '+(j.dato||'')+taxMarker(tax)
    };
    const {data,error}=await app.sb.from('hov_fakturaer').insert(payload).select('*').single();
    if(error){ msg('fakturaMsg','Kunne ikke lage faktura: '+error.message,'err'); return; }
    const up=await app.sb.from('hov_jobber').update({fakturert:true}).eq('id',j.id).eq('firma_id',app.firmaId);
    if(up.error){ msg('fakturaMsg','Faktura laget, men jobb ble ikke merket fakturert: '+up.error.message,'err'); }
    await incrementFakturaNr();
    await loadJobber(); await loadFakturaer(); renderFakturaer();
    msg('fakturaMsg','Faktura '+nr+' er laget.','ok');
    visDokumentPdfModal(data,'faktura','Faktura');
  }

  const DOC_TEXT_DEFAULTS = {
    nb:{
      faktura:'Takk for oppdraget!\n\nDenne fakturaen gjelder arbeid utført i henhold til avtale. Ta gjerne kontakt dersom du har spørsmål.\n\nBetalingsfrist: {forfallsdato}.',
      purring:'Dette er en påminnelse om faktura {fakturanr}, som hadde forfall {forfallsdato}. Vi ber om at utestående beløp på {belop} betales så snart som mulig. Ta kontakt dersom betalingen allerede er utført.',
      kreditnota:'Denne kreditnotaen gjelder faktura {fakturanr}. Beløpet er kreditert. Ta gjerne kontakt dersom du har spørsmål.'
    },
    sv:{
      faktura:'Tack för uppdraget!\n\nDenna faktura avser arbete som utförts enligt överenskommelse. Kontakta oss gärna om du har några frågor.\n\nBetalningsfrist: {forfallsdato}.',
      purring:'Detta är en påminnelse om faktura {fakturanr}, som förföll {forfallsdato}. Vänligen betala det utestående beloppet {belop} så snart som möjligt. Kontakta oss om betalningen redan har genomförts.',
      kreditnota:'Denna kreditnota avser faktura {fakturanr}. Beloppet har krediterats. Kontakta oss gärna om du har några frågor.'
    },
    en:{
      faktura:'Thank you for your business!\n\nThis invoice covers work performed as agreed. Please contact us if you have any questions.\n\nPayment due: {forfallsdato}.',
      purring:'This is a reminder regarding invoice {fakturanr}, which was due on {forfallsdato}. Please pay the outstanding amount of {belop} as soon as possible. Contact us if payment has already been made.',
      kreditnota:'This credit note relates to invoice {fakturanr}. The amount has been credited. Please contact us if you have any questions.'
    }
  };
  function docTextKey(){ return 'hov_doc_text_'+String(app.firmaId||'default')+'_'+invoiceLang(); }
  function localizedDocDefaults(){ return {...(DOC_TEXT_DEFAULTS[invoiceLang()]||DOC_TEXT_DEFAULTS.nb)}; }
  function loadDocTexts(){
    const defs=localizedDocDefaults();
    try{
      const saved=JSON.parse(localStorage.getItem(docTextKey())||'{}');
      return {...defs,...saved};
    }catch(_){ return {...defs}; }
  }
  function saveDocTexts(){
    const defs=localizedDocDefaults(); const texts={faktura:val('firmaFakturaTekst')||defs.faktura,purring:val('firmaPurringTekst')||defs.purring,kreditnota:val('firmaKreditnotaTekst')||defs.kreditnota};
    localStorage.setItem(docTextKey(),JSON.stringify(texts)); return texts;
  }
  function fillDocText(template,f,kunde){
    const firma=app.firma||{};
    return String(template||'').replaceAll('{kundenavn}',kunde?.navn||'').replaceAll('{fakturanr}',f.fakturanr||f.kreditnotanr||'').replaceAll('{forfallsdato}',f.forfallsdato||'').replaceAll('{belop}',kr(Math.abs(Number(f.inkl_mva||0)))).replaceAll('{firmanavn}',firma.navn||'');
  }
  function documentData(f,type){
    const kunde=(app.data.kunder||[]).find(k=>String(k.id)===String(f.kunde_id))||{};
    const texts=loadDocTexts();
    const title=type==='purring'?invoiceT('reminder'):type==='kreditnota'?invoiceT('creditNote'):invoiceT('invoice');
    const number=type==='kreditnota'?(f.kreditnotanr||''):(f.fakturanr||'');
    const text=fillDocText(texts[type]||'',f,kunde);
    return {kunde,title,number,text};
  }
  function makeDocumentPdf(f,type){
    if(!window.jspdf?.jsPDF) throw new Error('PDF-biblioteket ble ikke lastet. Kontroller internettforbindelsen.');
    const {jsPDF}=window.jspdf; const pdf=new jsPDF(); const firma=app.firma||{}; const d=documentData(f,type);
    let y=18; pdf.setFontSize(18); pdf.text(d.title+' '+d.number,14,y); y+=10;
    pdf.setFontSize(10); pdf.text(String(firma.navn||''),140,18); pdf.text(String(firma.adresse||''),140,24); pdf.text(String((firma.postnr||'')+' '+(firma.poststed||'')),140,30); pdf.text(String(firma.epost||''),140,36);
    pdf.setFontSize(11); pdf.text(invoiceT('customer')+':',14,y); y+=6; pdf.text(String(d.kunde.navn||''),14,y); y+=6; pdf.text(String(d.kunde.adresse||''),14,y); y+=10;
    pdf.text(invoiceT('date')+': '+String(f.dato||today()),14,y); y+=6; if(f.forfallsdato){pdf.text(invoiceT('due')+': '+f.forfallsdato,14,y); y+=8;}
    const lines=pdf.splitTextToSize(d.text,180); pdf.text(lines,14,y); y+=lines.length*5+8;
    const taxMeta=parseTaxMeta(f); const taxLabel=invoiceT('vat')+' '+taxMeta.rate+' %:';
    pdf.text(invoiceT('amountExVat')+': '+kr(f.eks_mva||0),14,y); y+=6; pdf.text(taxLabel+' '+kr(f.mva||0),14,y); y+=6; if(taxMeta.note){ pdf.setFontSize(9); const taxLines=pdf.splitTextToSize(taxMeta.note,180); pdf.text(taxLines,14,y); y+=taxLines.length*5+2; } pdf.setFontSize(14); pdf.text((type==='kreditnota'?invoiceT('credited'):invoiceT('total'))+': '+kr(Math.abs(Number(f.inkl_mva||0))),14,y); y+=10;
    pdf.setFontSize(10); for(const [label,value] of paymentDetailsLines(firma)){ pdf.text(tr(label+':')+' '+String(value),14,y); y+=5; }
    const filename=(d.title+'-'+(d.number||Date.now())).replace(/[^a-zA-Z0-9_-]+/g,'-')+'.pdf';
    return {pdf,filename,blob:pdf.output('blob'),data:d};
  }
  function lagreDokumentPdf(f,type){ try{const x=makeDocumentPdf(f,type);x.pdf.save(x.filename);msg('fakturaMsg',x.data.title+' er lagret som PDF.','ok')}catch(e){msg('fakturaMsg',e.message||String(e),'err')} }
  let aktivDokumentModalUrl = null;
  function lukkDokumentModal(){
    const modal=document.getElementById('dokumentPdfModal');
    if(modal) modal.remove();
    if(aktivDokumentModalUrl){ URL.revokeObjectURL(aktivDokumentModalUrl); aktivDokumentModalUrl=null; }
  }
  function visDokumentPdfModal(f,type,label){
    try{
      lukkDokumentModal();
      const x=makeDocumentPdf(f,type);
      aktivDokumentModalUrl=URL.createObjectURL(x.blob);
      const modal=document.createElement('div');
      modal.id='dokumentPdfModal';
      modal.innerHTML=`<div class="doc-modal-backdrop"></div><section class="doc-modal-card" role="dialog" aria-modal="true" aria-label="${esc(x.data.title)}"><header class="doc-modal-head"><strong>${esc(x.data.title)} ${esc(x.data.number||'')}</strong><button type="button" class="doc-modal-x" aria-label="${esc(invoiceT('close'))}">×</button></header><div class="doc-modal-body"><iframe class="doc-pdf-frame" title="PDF ${esc(x.data.title)}" src="${aktivDokumentModalUrl}"></iframe><aside class="doc-modal-actions"><div class="doc-summary"><h3>${esc(x.data.title)} ${esc(x.data.number||'')}</h3><p><strong>${esc(invoiceT('customer'))}:</strong> ${esc(x.data.kunde?.navn||'')}</p><p><strong>${esc(invoiceT('amount'))}:</strong> ${kr(Math.abs(Number(f.inkl_mva||0)))}</p></div><button type="button" class="doc-action-btn secondary" data-doc-print>🖨 ${esc(invoiceT('print'))}</button><button type="button" class="doc-action-btn" data-doc-email>✉ ${esc(invoiceT('sendEmail'))}</button><button type="button" class="doc-action-btn secondary" data-doc-close>${esc(invoiceT('close'))}</button></aside></div></section>`;
      document.body.appendChild(modal);
      modal.querySelector('.doc-modal-backdrop').addEventListener('click',lukkDokumentModal);
      modal.querySelector('.doc-modal-x').addEventListener('click',lukkDokumentModal);
      modal.querySelector('[data-doc-close]').addEventListener('click',lukkDokumentModal);
      modal.querySelector('[data-doc-print]').addEventListener('click',()=>{
        const frame=modal.querySelector('.doc-pdf-frame');
        try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(_){ window.open(aktivDokumentModalUrl,'_blank'); }
      });
      modal.querySelector('[data-doc-email]').addEventListener('click',()=>sendDokumentEpost(f,type));
    }catch(e){ msg('fakturaMsg','Kunne ikke vise PDF: '+(e.message||e),'err'); }
  }
  async function sendDokumentEpost(f,type){
    try{
      const x=makeDocumentPdf(f,type);
      const email=String(x.data.kunde.epost||'').trim();
      if(!email){msg('fakturaMsg','Kunden mangler e-postadresse.','err');return false;}

      // Åpne alltid standard e-postklient direkte. Web Share gir Windows-delingsvinduet
      // og fyller normalt ikke inn kundens e-postadresse.
      x.pdf.save(x.filename);
      const subject=x.data.title+' '+x.data.number+' '+tr('fra')+' '+(app.firma?.navn||'');
      const body=x.data.text+'\n\n'+tr('PDF-filen er lastet ned. Legg den ved i e-posten.').replace('PDF-filen','PDF-filen «'+x.filename+'»');
      const mailto='mailto:'+email+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
      window.location.href=mailto;
      msg('fakturaMsg','E-postprogrammet er åpnet med kundens e-postadresse ferdig utfylt. PDF-en er lastet ned og må legges ved.','ok');
      return true;
    }catch(e){
      if(e?.name!=='AbortError') msg('fakturaMsg','Kunne ikke åpne e-post: '+(e.message||e),'err');
      return false;
    }
  }
  function sendFakturaEpost(id){const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(id));if(f)sendDokumentEpost(f,'faktura')}
  function lagreFakturaPdf(id){const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(id));if(f)lagreDokumentPdf(f,'faktura')}
  function lagrePurringPdf(id){sendPurring(id,'pdf')}
  function sendPurringEpost(id){sendPurring(id,'epost')}
  function visKreditnotaForFaktura(id){const k=kreditnotaForFaktura(id);if(k)lagreDokumentPdf(k,'kreditnota');else msg('fakturaMsg','Fant ikke kreditnota.','err')}
  function sendKreditnotaForFaktura(id){const k=kreditnotaForFaktura(id);if(k)sendDokumentEpost(k,'kreditnota');else msg('fakturaMsg','Fant ikke kreditnota.','err')}

  function fakturaHtml(f, opts){
    const options = opts || {};
    const kunde=(app.data.kunder||[]).find(k=>String(k.id)===String(f.kunde_id)) || {};
    const jobb=(app.data.jobber||[]).find(j=>String(j.id)===String(f.jobb_id)) || f._jobb || {};
    const hest=(app.data.hester||[]).find(h=>String(h.id)===String(jobb.hest_id)) || {};
    const firma=app.firma||{};
    const label = options.label || (f._preview ? invoiceT('preview') : '');
    const title = f._preview ? `${invoiceT('invoiceDraft')} ${esc(f.fakturanr||'')}` : `${invoiceT('invoice')} ${esc(f.fakturanr||'')}`;
    const printScript = options.autoPrint === false ? '' : '<script>window.print && setTimeout(()=>window.print(),300)<\\/script>';
    const taxMeta=parseTaxMeta(f); const taxName=invoiceT('vat');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Arial,sans-serif;padding:30px;color:#111}h1{margin:0 0 10px}.top{display:flex;justify-content:space-between;gap:40px}.box{border:1px solid #ddd;padding:14px;margin:14px 0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}.right{text-align:right}.muted{color:#666}.total{font-size:20px;font-weight:bold}.preview{display:inline-block;background:#fff3cd;border:1px solid #e0b94f;border-radius:999px;padding:6px 10px;color:#6b4e00;font-weight:bold}
/* MOBILVENNLIG LES-INN: bare én funksjon/knapp vises */
#navReadLastJobbBtn{display:none!important}
#voiceStopJobbBtn,#voiceUseTextJobbBtn,#voiceOpenLastJobbBtn,#voiceDeleteLastJobbBtn{display:none!important}
#voiceNewJobbBtn.voice-on{position:sticky;bottom:12px;z-index:50;width:100%;justify-content:center;font-size:20px;padding:18px;border-radius:16px}
.voice-saved-actions{display:none!important}
.quick-job .muted{font-size:15px;line-height:1.35}
@media(max-width:800px){.quick-job{padding:14px}.quick-job .actions{display:grid;grid-template-columns:1fr}.quick-job textarea{min-height:130px}}

</style>

</head><body>
      <div class="top"><div><h1>${title}</h1>${label ? `<div class="preview">${esc(label)}</div>` : ''}</div><div><strong>${esc(firma.navn||'')}</strong><br>${esc(firma.adresse||'')}<br>${esc(firma.postnr||'')} ${esc(firma.poststed||'')}<br>${esc(firma.epost||'')}<br>${esc(firma.telefon||'')}</div></div>
      <div class="box"><strong>${esc(invoiceT('customer'))}</strong><br>${esc(kunde.navn||'')}<br>${esc(kunde.adresse||'')}<br>${esc(kunde.epost||'')}</div>
      <p><strong>${esc(invoiceT('date')+':')}</strong> ${esc(f.dato||'')}<br><strong>${esc(invoiceT('due')+':')}</strong> ${esc(f.forfallsdato||'')}</p>
      <table><thead><tr><th>${esc(invoiceT('description'))}</th><th>${esc(invoiceT('horse'))}</th><th class="right">${esc(invoiceT('amountExVat'))}</th></tr></thead><tbody>
      <tr><td>${esc(jobb.jobbtype||f.tekst||invoiceT('farrierWork'))}<br><span class="muted">${esc(jobb.beskrivelse||'')}</span></td><td>${esc(hest.navn||'')}</td><td class="right">${kr(f.eks_mva||0)}</td></tr>
      </tbody></table>
      <p class="right">${esc(taxName)} ${esc(taxMeta.rate)} %: ${kr(f.mva||0)}</p>${taxMeta.note?`<p class="right muted">${esc(taxMeta.note)}</p>`:''}
      <p class="right total">${esc(invoiceT('total'))}: ${kr(f.inkl_mva||0)}</p>
      <div class="box"><strong>${esc(invoiceT('payment'))}</strong><br>${paymentDetailsHtml(firma)}</div>
      ${printScript}
      </body></html>`;
  }

  function visFaktura(f, opts){
    if(!f){ msg('fakturaMsg','Fant ikke faktura.','err'); return; }
    const w=window.open('', '_blank');
    if(!w){ msg('fakturaMsg','Nettleseren blokkerte popup. Tillat popup for å vise faktura.','err'); return; }
    w.document.open(); w.document.write(fakturaHtml(f, opts)); w.document.close();
  }

  function visFakturaForJobb(jobbId){
    const f=fakturaForJobb(jobbId);
    if(!f){ msg('fakturaMsg','Fant ingen faktura for denne jobben.','err'); return; }
    visDokumentPdfModal(f,'faktura','Faktura');
  }

  function fakturaUtkastFraJobb(jobbId){
    const j=(app.data.jobber||[]).find(x=>String(x.id)===String(jobbId));
    if(!j){ msg('fakturaMsg','Fant ikke jobben.','err'); return null; }
    const forfall=new Date();
    forfall.setDate(forfall.getDate()+Number(app.firma?.betalingsfrist_dager || 14));
    const rawEks=Number(j.arbeid_belop||0)+Number(j.varer_belop||0)+(Number(j.km||0)*Number(j.km_pris||0));
    const amounts=calculateInvoiceAmounts(rawEks); const eks=amounts.eks, mva=amounts.mva, inkl=amounts.inkl, tax=amounts.tax;
    return {
      firma_id:app.firmaId,
      kunde_id:j.kunde_id,
      jobb_id:j.id,
      fakturanr:fakturaNr(),
      dato:today(),
      forfallsdato:forfall.toISOString().slice(0,10),
      eks_mva:eks,
      mva,
      inkl_mva:inkl,
      status:'forhåndsvisning',
      betalingsstatus:'ikke opprettet',
      tekst:'Fakturautkast for jobb '+(j.jobbtype||'')+' '+(j.dato||'')+taxMarker(tax),
      _preview:true,
      _jobb:j
    };
  }

  function forhåndsvisFakturaFraJobb(jobbId){
    const f=fakturaUtkastFraJobb(jobbId);
    if(!f) return;
    visFaktura(f, {autoPrint:false, label:'Forhåndsvisning - ikke fakturert'});
  }

  async function sendPurring(fakturaId, leveringsmate){
    const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(fakturaId));
    if(!f){ msg('fakturaMsg','Fant ikke faktura for purring.','err'); return; }
    const nyStatus='purret';
    if(leveringsmate==='pdf'){
      const {error}=await app.sb.from('hov_fakturaer').update({status:nyStatus, betalingsstatus:nyStatus, purret_dato:today()}).eq('id',f.id);
      if(error){ msg('fakturaMsg','Kunne ikke markere purring: '+error.message,'err'); return; }
      await loadFakturaer(); renderFakturaer();
      msg('fakturaMsg','Faktura '+(f.fakturanr||'')+' er markert som purret. Lager PDF.','ok');
      lagreDokumentPdf(f,'purring');
    }else{
      const sendt=await sendDokumentEpost(f,'purring');
      if(!sendt) return;
      const {error}=await app.sb.from('hov_fakturaer').update({status:nyStatus, betalingsstatus:nyStatus, purret_dato:today()}).eq('id',f.id);
      if(error){ msg('fakturaMsg','Purringen ble sendt, men status kunne ikke oppdateres: '+error.message,'err'); return; }
      await loadFakturaer(); renderFakturaer();
    }
  }

  function tripletexInvoiceId(f){
    if(f?.tripletex_invoice_id) return String(f.tripletex_invoice_id);
    const m=String(f?.tekst||'').match(/Tripletex invoiceId=(\d+)/i);
    return m?m[1]:'';
  }

  async function oppdaterTripletexStatus(fakturaId, button){
    const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(fakturaId));
    if(!f){ msg('fakturaMsg','Fant ikke fakturaen.','err'); return; }
    const invoiceId=tripletexInvoiceId(f);
    if(!invoiceId){ msg('fakturaMsg','Denne fakturaen mangler Tripletex faktura-ID.','err'); return; }
    const old=button?.textContent; if(button){button.disabled=true;button.textContent='Henter ...';}
    try{
      const {data,error}=await app.sb.functions.invoke('tripletex',{body:{appId:'hov',action:'get_invoice',invoiceId}});
      if(error) throw error; if(!data?.ok) throw new Error(data?.error||'Ukjent svar fra Tripletex');
      const status=data.status||'ubetalt';
      const update={status,betalingsstatus:status}; if(status==='betalt') update.betalt_dato=today();
      const {error:updateError}=await app.sb.from('hov_fakturaer').update(update).eq('id',f.id);
      if(updateError) throw updateError;
      await loadFakturaer(); renderFakturaer(); msg('fakturaMsg','Status fra Tripletex: '+status+'.','ok');
    }catch(e){ msg('fakturaMsg','Kunne ikke hente status fra Tripletex: '+(e?.message||String(e)),'err'); }
    finally{ if(button){button.disabled=false;button.textContent=old||'Oppdater fra Tripletex';} }
  }

  async function settFakturaBetalt(fakturaId){
    const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(fakturaId));
    if(!f){ msg('fakturaMsg','Fant ikke fakturaen som skal settes betalt.','err'); return; }
    const payload={status:'betalt', betalingsstatus:'betalt', betalt_dato:today()};
    const {error}=await app.sb.from('hov_fakturaer').update(payload).eq('id',f.id);
    if(error){ msg('fakturaMsg','Kunne ikke sette faktura betalt: '+error.message,'err'); return; }
    await loadFakturaer(); renderFakturaer();
    msg('fakturaMsg','Faktura '+(f.fakturanr||'')+' er satt som betalt.','ok');
  }

  async function lagKreditnota(fakturaId){
    const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(fakturaId));
    if(!f){ msg('fakturaMsg','Fant ikke faktura.','err'); return; }
    if(kreditnotaForFaktura(f.id)){ msg('fakturaMsg','Det finnes allerede kreditnota på denne fakturaen.','err'); return; }
    if(!confirm('Lage kreditnota for faktura '+(f.fakturanr||'')+'?')) return;
    const payload={
      firma_id:app.firmaId,
      kunde_id:f.kunde_id,
      faktura_id:f.id,
      original_faktura_id:f.id,
      kreditnotanr:'K-'+(f.fakturanr||Date.now()),
      dato:today(),
      eks_mva:-Math.abs(Number(f.eks_mva||0)),
      mva:-Math.abs(Number(f.mva||0)),
      inkl_mva:-Math.abs(Number(f.inkl_mva||0)),
      status:'kreditert',
      tekst:'Kreditnota for faktura '+(f.fakturanr||'')
    };
    const {data:kreditData,error}=await app.sb.from('hov_kreditnotaer').insert(payload).select('*').single();
    if(error){ msg('fakturaMsg','Kunne ikke lage kreditnota: '+error.message,'err'); return; }
    await app.sb.from('hov_fakturaer').update({status:'kreditert', betalingsstatus:'kreditert'}).eq('id',f.id);
    if(f.jobb_id){
      await app.sb.from('hov_jobber').update({fakturert:false}).eq('id',f.jobb_id).eq('firma_id',app.firmaId);
    }
    await loadKreditnotaer(); await loadFakturaer(); await loadJobber(); renderFakturaer();
    msg('fakturaMsg','Kreditnota er laget. Jobben er åpnet for ny fakturering.','ok'); if(kreditData) await sendDokumentEpost(kreditData,'kreditnota');
  }

  function fakturaStatus(f){
    return f.betalingsstatus || f.status || '';
  }

  function renderFakturaer(){
    const el=$('fakturaList'); if(!el) return;
    const jobber=app.data.jobber||[];
    const fakturaer=app.data.fakturaer||[];
    const rows=[];

    for(const j of jobber){
      const f=fakturaForJobb(j.id);
      const kunde=kundeNavn(j.kunde_id);
      const hest=hestNavn(j.hest_id);
      if(f || j.fakturert){
        rows.push(`<tr><td>${esc(j.dato||'')}</td><td>${esc(kunde)}</td><td>${esc(hest)}</td><td>${esc(j.jobbtype||'')}</td><td>${kr(j.total||f?.inkl_mva||0)}</td><td><span class="pill">Fakturert</span><br>${esc(f?.fakturanr||'Mangler fakturanr')}</td><td>${esc(f?fakturaStatus(f):'')}</td><td class="actions"><button type="button" class="small-btn" data-vis-faktura="${esc(j.id)}">Vis faktura</button>${f&&tripletexInvoiceId(f)?`<button type="button" class="small-btn secondary" data-tripletex-status="${esc(f.id)}">Oppdater fra Tripletex</button>`:''}${f?`${kreditnotaForFaktura(f.id)?`<button type="button" class="small-btn secondary" data-vis-kredit="${esc(f.id)}">PDF kreditnota</button><button type="button" class="small-btn" data-send-kredit="${esc(f.id)}">Send kreditnota</button>`:''}${fakturaStatus(f)==='betalt' ? '' : `<button type="button" class="small-btn ok" data-sett-betalt="${esc(f.id)}">Sett betalt</button>`}<button type="button" class="small-btn secondary" data-purr-pdf="${esc(f.id)}">PDF purring</button><button type="button" class="small-btn secondary" data-purr-epost="${esc(f.id)}">Send purring</button><button type="button" class="small-btn danger" data-kredit="${esc(f.id)}">Kreditt</button>`:''}</td></tr>`);
      }else{
        rows.push(`<tr><td>${esc(j.dato||'')}</td><td>${esc(kunde)}</td><td>${esc(hest)}</td><td>${esc(j.jobbtype||'')}</td><td>${kr(j.total||0)}</td><td><span class="pill">Ikke fakturert</span></td><td>klar</td><td class="actions"><button type="button" class="small-btn secondary" data-preview-faktura="${esc(j.id)}">Forhåndsvis</button><button type="button" class="small-btn" data-fakturer="${esc(j.id)}">Lag faktura</button><button type="button" class="small-btn ok" data-tripletex-send="${esc(j.id)}">Send til Tripletex</button></td></tr>`);
      }
    }

    for(const f of fakturaer){
      if(f.jobb_id && jobber.some(j=>String(j.id)===String(f.jobb_id))) continue;
      rows.push(`<tr><td>${esc(f.dato||'')}</td><td>${esc(kundeNavn(f.kunde_id))}</td><td></td><td>${esc(f.tekst||'Faktura')}</td><td>${kr(f.inkl_mva||0)}</td><td><span class="pill">Fakturert</span><br>${esc(f.fakturanr||'')}</td><td>${esc(fakturaStatus(f))}</td><td class="actions"><button type="button" class="small-btn" data-vis-faktura-id="${esc(f.id)}">Vis faktura</button>${tripletexInvoiceId(f)?`<button type="button" class="small-btn secondary" data-tripletex-status="${esc(f.id)}">Oppdater fra Tripletex</button>`:''}${kreditnotaForFaktura(f.id)?`<button type="button" class="small-btn secondary" data-vis-kredit="${esc(f.id)}">PDF kreditnota</button><button type="button" class="small-btn" data-send-kredit="${esc(f.id)}">Send kreditnota</button>`:''}${fakturaStatus(f)==='betalt' ? '' : `<button type="button" class="small-btn ok" data-sett-betalt="${esc(f.id)}">Sett betalt</button>`}<button type="button" class="small-btn secondary" data-purr-pdf="${esc(f.id)}">PDF purring</button><button type="button" class="small-btn secondary" data-purr-epost="${esc(f.id)}">Send purring</button><button type="button" class="small-btn danger" data-kredit="${esc(f.id)}">Kreditt</button></td></tr>`);
    }

    const head=['Dato','Kunde','Hest','Jobb/Faktura','Beløp','Fakturastatus','Betaling','Handling'];
    el.innerHTML = table(head, rows);
    bindFakturaActions();
    const sumAlle=jobber.length;
    const sumUfakt=jobber.filter(j=>!j.fakturert && !fakturaForJobb(j.id)).length;
    const sumFakt=sumAlle-sumUfakt;
    const msgEl=$('fakturaMsg');
    if(msgEl && !msgEl.innerHTML) msgEl.innerHTML=`<div class="msg">Jobber: ${sumAlle}. Ikke fakturert: ${sumUfakt}. Fakturert: ${sumFakt}.</div>`;
  }

  function bindFakturaActions(){
    const el=$('fakturaList'); if(!el) return;
    el.querySelectorAll('[data-preview-faktura]').forEach(b=>b.addEventListener('click',()=>forhåndsvisFakturaFraJobb(b.dataset.previewFaktura)));
    el.querySelectorAll('[data-fakturer]').forEach(b=>b.addEventListener('click',()=>lagFakturaFraJobb(b.dataset.fakturer)));
    el.querySelectorAll('[data-tripletex-send]').forEach(b=>b.addEventListener('click',()=>sendJobbTilTripletex(b.dataset.tripletexSend,b)));
    el.querySelectorAll('[data-vis-faktura]').forEach(b=>b.addEventListener('click',()=>visFakturaForJobb(b.dataset.visFaktura)));
    el.querySelectorAll('[data-vis-faktura-id]').forEach(b=>b.addEventListener('click',()=>{
      const f=(app.data.fakturaer||[]).find(x=>String(x.id)===String(b.dataset.visFakturaId));
      visDokumentPdfModal(f,'faktura','Fakturakopi');
    }));
    el.querySelectorAll('[data-lagre-pdf]').forEach(b=>b.addEventListener('click',()=>lagreFakturaPdf(b.dataset.lagrePdf)));
    el.querySelectorAll('[data-send-faktura]').forEach(b=>b.addEventListener('click',()=>sendFakturaEpost(b.dataset.sendFaktura)));
    el.querySelectorAll('[data-vis-kredit]').forEach(b=>b.addEventListener('click',()=>visKreditnotaForFaktura(b.dataset.visKredit)));
    el.querySelectorAll('[data-send-kredit]').forEach(b=>b.addEventListener('click',()=>sendKreditnotaForFaktura(b.dataset.sendKredit)));
    el.querySelectorAll('[data-tripletex-status]').forEach(b=>b.addEventListener('click',()=>oppdaterTripletexStatus(b.dataset.tripletexStatus,b)));
    el.querySelectorAll('[data-sett-betalt]').forEach(b=>b.addEventListener('click',()=>settFakturaBetalt(b.dataset.settBetalt)));
    el.querySelectorAll('[data-purr-pdf]').forEach(b=>b.addEventListener('click',()=>lagrePurringPdf(b.dataset.purrPdf)));
    el.querySelectorAll('[data-purr-epost]').forEach(b=>b.addEventListener('click',()=>sendPurringEpost(b.dataset.purrEpost)));
    el.querySelectorAll('[data-kredit]').forEach(b=>b.addEventListener('click',()=>lagKreditnota(b.dataset.kredit)));
  }


  function renderAll(){ renderDashboard(); renderKunder(); renderHester(); renderJobber(); renderFakturaer(); renderPriser(); fillKundeSelects(); fillHestSelects(); fillJobbTypeSelect(); renderCalendar(); if($('gpsDate')&&!$('gpsDate').value) $('gpsDate').value=localIsoDate(new Date()); renderGps(); }
  function renderDashboard(){
    const rows=[['Kunder',app.data.kunder.length],['Hester',app.data.hester.length],['Jobber',app.data.jobber.length],['Fakturaer',app.data.fakturaer.length],['Kreditnotaer',app.data.kreditnotaer.length]];
    $('dashCounts').innerHTML = rows.map(r=>`<div class="col-3"><div class="card"><h3>${r[1]}</h3><div class="muted">${r[0]}</div></div></div>`).join('');
  }
  function table(headers, rows){
    if(!rows.length) return '<div class="msg">Ingen data å vise.</div>';
    const labelledRows = rows.map(row=>{
      let idx = 0;
      return String(row).replace(/<td(\s[^>]*)?>/g, (m, attrs)=>{
        const label = esc(headers[idx++] || '');
        return `<td${attrs || ''} data-label="${label}">`;
      });
    }).join('');
    return `<div style="overflow:auto"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${labelledRows}</tbody></table></div>`;
  }
  function kundeNavn(id){ return app.data.kunder.find(k=>String(k.id)===String(id))?.navn || id || ''; }
  function hestNavn(id){ return app.data.hester.find(h=>String(h.id)===String(id))?.navn || id || ''; }
  function renderKunder(){ $('kundeList').innerHTML = table(['Navn','Telefon','E-post','Adresse',''], app.data.kunder.map(k=>`<tr class="click-row${selectedRowClass('kunde',k.id)}" data-id="${esc(k.id)}"><td>${esc(k.navn)}</td><td>${esc(k.telefon)}</td><td>${esc(k.epost)}</td><td>${esc(k.adresse)}</td></tr>`)); bindClickableRows('kundeList','kunde', editKunde); }
  const SHOE_PROFILE_START='[HOVSPR_SHOE_PROFILE]';
  const SHOE_PROFILE_END='[/HOVSPR_SHOE_PROFILE]';
  function parseHorseShoeProfile(notes){
    const text=String(notes||'');
    const start=text.indexOf(SHOE_PROFILE_START), end=text.indexOf(SHOE_PROFILE_END);
    if(start<0 || end<start) return {profile:{},notes:text.trim()};
    let profile={};
    try{ profile=JSON.parse(text.slice(start+SHOE_PROFILE_START.length,end).trim())||{}; }catch(_){ profile={}; }
    const clean=(text.slice(0,start)+text.slice(end+SHOE_PROFILE_END.length)).trim();
    return {profile,notes:clean};
  }
  function buildHorseNotes(notes,profile){
    const clean=String(notes||'').trim();
    const values=Object.values(profile||{}).some(v=>String(v||'').trim());
    if(!values) return clean||null;
    const block=SHOE_PROFILE_START+'\n'+JSON.stringify(profile)+'\n'+SHOE_PROFILE_END;
    return (clean?clean+'\n\n':'')+block;
  }
  function horseShoeProfile(h){ return parseHorseShoeProfile(h?.notater).profile; }
  function horseShoeSummary(h){
    const p=horseShoeProfile(h);
    const front=[p.vf,p.hf].filter(Boolean).join('/');
    const back=[p.vb,p.hb].filter(Boolean).join('/');
    if(!front&&!back) return '–';
    return [front?'F '+front:'',back?'B '+back:''].filter(Boolean).join(' · ');
  }

  function renderHester(){ $('hestList').innerHTML = table(['Bilde','Navn','Eier','Rase','Skostørrelse','Neste besøk'], app.data.hester.map(h=>`<tr class="click-row${selectedRowClass('hest',h.id)}" data-id="${esc(h.id)}"><td>${imgUrl(h)?`<img class="thumb small" src="${esc(imgUrl(h))}" alt="Hest">`:''}</td><td>${esc(h.navn)}</td><td>${esc(kundeNavn(h.kunde_id))}</td><td>${esc(h.rase)}</td><td><span class="shoe-size-summary">${esc(horseShoeSummary(h))}</span></td><td>${esc(h.neste_besok)}</td></tr>`)); bindClickableRows('hestList','hest', editHest); }
  function setHestLayout(mode){
    const section=$('hester'), list=$('hestList'), title=$('hestFormTitle');
    if(!section || !list || !title) return;
    const grid = title.nextElementSibling;
    const actions = grid ? grid.nextElementSibling : null;
    const msgEl = $('hestMsg');
    if(mode === 'formFirst'){
      section.insertBefore(title, list);
      if(grid) section.insertBefore(grid, list);
      if(actions) section.insertBefore(actions, list);
      if(msgEl) section.insertBefore(msgEl, list);
    } else {
      section.insertBefore(list, title);
    }
  }

  function setJobbLayout(mode){
    const section=$('jobber');
    const list=$('jobbList');
    const title=$('jobbFormTitle');
    const savedPrompt=$('jobbSavedPrompt');
    const grid=$('jobbFormGrid');
    const actions=$('jobbFormActions');
    const msgEl=$('jobbMsg');
    if(!section || !list || !title) return;
    if(mode === 'formFirst'){
      section.insertBefore(title, list);
      if(savedPrompt) section.insertBefore(savedPrompt, list);
      if(grid) section.insertBefore(grid, list);
      if(actions) section.insertBefore(actions, list);
      if(msgEl) section.insertBefore(msgEl, list);
    } else {
      section.insertBefore(list, title);
    }
  }

  function renderJobber(){
    const rows=(app.data.jobber||[]).map(j=>{
      const bildeAnt = jobBilder(j).length;
      const bildeTekst = bildeAnt ? ('📷 ' + bildeAnt) : '–';
      return `<tr class="click-row${selectedRowClass('jobb',j.id)}" data-id="${esc(j.id)}"><td>${esc(j.dato||'')}</td><td>${esc(kundeNavn(j.kunde_id))}</td><td>${esc(hestNavn(j.hest_id))}</td><td>${esc(j.jobbtype||'')}</td><td>${kr(j.total||0)}</td><td>${esc(bildeTekst)}</td><td>${j.fakturert?'Ja':'Nei'}</td></tr>`;
    });
    const cards=(app.data.jobber||[]).map(j=>{
      const faktura = (typeof fakturaForJobb === 'function') ? fakturaForJobb(j.id) : null;
      const mangler = !j.hest_id || !j.kunde_id;
      const forelopig = mangler || /foreløpig|forelopig|ukjent/i.test(String(j.status||j.beskrivelse||j.jobbtype||''));
      const status = j.fakturert || faktura ? 'Fakturert' : forelopig ? 'Mangler hest/eier' : 'Ikke fakturert';
      const statusClass = j.fakturert || faktura ? 'ok' : forelopig ? 'warn' : 'plain';
      const hest = hestNavn(j.hest_id) || (mangler ? 'Mangler hest' : 'Ukjent hest');
      const kunde = kundeNavn(j.kunde_id) || (mangler ? 'Mangler eier' : 'Ukjent kunde');
      const bildeAnt = jobBilder(j).length;
      const bildeTekst = bildeAnt ? ('📷 ' + bildeAnt + ' bilde' + (bildeAnt === 1 ? '' : 'r')) : 'Ingen bilder';
      return `<button type="button" class="jobb-mobile-card ${selectedRowClass('jobb',j.id)}" data-id="${esc(j.id)}"><span class="jobb-card-top"><strong>🐴 ${esc(hest)}</strong><span>${kr(j.total||0)}</span></span><span>👤 ${esc(kunde)}</span><span>${esc(bildeTekst)}</span><span class="jobb-card-bottom"><span>📅 ${esc(j.dato||'')}</span><span class="jobb-status ${statusClass}">${esc(status)}</span></span></button>`;
    }).join('');
    $('jobbList').innerHTML = `<div class="jobb-desktop-list">${table(['Dato','Kunde','Hest','Jobbtype','Total','Bilder','Fakturert'], rows)}</div><div class="jobb-mobile-list">${cards || '<div class="msg">Ingen jobber registrert ennå.</div>'}</div>`;
    bindClickableRows('jobbList','jobb', viewJobb);
    document.querySelectorAll('#jobbList .jobb-mobile-card').forEach(el=>el.addEventListener('click',()=>viewJobb(el.dataset.id)));
  }

  function renderPriser(){
    const rows=(app.data.priser||[]).map(p=>`<tr class="click-row${selectedRowClass('pris',p.id)}" data-id="${esc(p.id)}"><td>${esc(p.kategori||'')}</td><td>${esc(displayPrisVarenr(p))}</td><td>${esc(p.navn||p.jobbtype||p.vare||p.type||'')}</td><td>${esc(p.enhet||'')}</td><td>${kr(p.pris_eks_mva ?? p.pris ?? p.belop ?? p.eks_mva)}</td><td>${kr(p.pris_inkl_mva ?? 0)}</td><td>${esc(p.aktiv === false ? 'Nei' : 'Ja')}</td><td>${esc(p.beskrivelse||'')}</td><td><button type="button" class="danger small delete-pris-row" data-id="${esc(p.id)}">Slett</button></td></tr>`);
    $('prisList').innerHTML = table(['Kategori','Varenr','Navn','Enhet','Eks. mva','Inkl. mva','Aktiv','Beskrivelse',''], rows);
    bindClickableRows('prisList','pris', editPris);
    document.querySelectorAll('#prisList .delete-pris-row').forEach(btn=>btn.addEventListener('click', async (e)=>{ e.preventDefault(); e.stopPropagation(); await deletePrisById(btn.dataset.id); }));
  }

  function fillSelect(sel, rows, valueKey, textFn, empty){ const el=$(sel); if(!el) return; const old=el.value; el.innerHTML = `<option value="">${empty||'Velg'}</option>` + rows.map(r=>`<option value="${esc(r[valueKey])}">${esc(textFn(r))}</option>`).join(''); if(old) el.value=old; }
  function fillKundeSelects(){ fillSelect('hestKunde',app.data.kunder,'id',k=>k.navn,'Velg kunde'); fillSelect('jobbKunde',app.data.kunder,'id',k=>k.navn,'Velg kunde'); fillJobbHester(); syncJobbKundeHestLock(); }
  function fillHestSelects(){ fillJobbHester(); syncJobbKundeHestLock(); }
  function valgtJobbHest(){ const hid=$('jobbHest')?.value; return hid ? app.data.hester.find(h=>String(h.id)===String(hid)) : null; }
  function setJobbKundeLocked(locked){
    const el=$('jobbKunde'); if(!el) return;
    el.disabled = !!locked;
    el.classList.toggle('locked-field', !!locked);
    el.title = locked ? 'Kunde/eier låses automatisk av valgt hest.' : '';
  }
  function syncJobbKundeHestLock(){
    const h=valgtJobbHest();
    if(h && h.kunde_id){ setVal('jobbKunde', h.kunde_id); setJobbKundeLocked(true); }
    else setJobbKundeLocked(false);
  }
  function fillJobbHester(){
    const kid=$('jobbKunde')?.value;
    const rows=kid?app.data.hester.filter(h=>String(h.kunde_id)===String(kid)):app.data.hester;
    fillSelect('jobbHest',rows,'id',h=>h.navn,'Velg hest');
  }
  function onJobbKundeChange(){
    setJobbKundeLocked(false);
    fillJobbHester();
    const h=valgtJobbHest();
    const kid=$('jobbKunde')?.value;
    if(h && kid && String(h.kunde_id)!==String(kid)) setVal('jobbHest','');
  }
  function onJobbHestChange(){
    const h=valgtJobbHest();
    if(h && h.kunde_id){ setVal('jobbKunde', h.kunde_id); setJobbKundeLocked(true); }
    else setJobbKundeLocked(false);
  }

  function prisNavn(p){ return p?.navn || p?.jobbtype || p?.vare || p?.type || ''; }
  function prisEksMva(p){ return Number(p?.pris_eks_mva ?? p?.pris ?? p?.belop ?? p?.eks_mva ?? 0) || 0; }
  function fillJobbTypeSelect(){
    const el=$('jobbType'); if(!el) return;
    const old=el.value;
    const aktive=(app.data.priser||[])
      .filter(p=>p && p.aktiv !== false && prisNavn(p))
      .sort((a,b)=>prisNavn(a).localeCompare(prisNavn(b),'nb'));
    const seen=new Set();
    let html='<option value="">Velg jobbtype/pris</option>';
    for(const p of aktive){
      const navn=prisNavn(p); const key=navn.toLowerCase();
      if(seen.has(key)) continue; seen.add(key);
      const eks=prisEksMva(p);
      const label = eks ? `${navn} - ${kr(eks)} eks. mva` : navn;
      html += `<option value="${esc(navn)}" data-pris-id="${esc(p.id)}">${esc(label)}</option>`;
    }
    if(old && !seen.has(String(old).toLowerCase())) html += `<option value="${esc(old)}">${esc(old)}</option>`;
    el.innerHTML=html;
    if(old) el.value=old;
  }
  function applySelectedJobbTypePris(){
    const el=$('jobbType'); if(!el) return;
    const opt=el.selectedOptions?.[0];
    const id=opt?.dataset?.prisId;
    const p=id ? app.data.priser.find(x=>String(x.id)===String(id)) : null;
    if(!p) return;
    const eks=prisEksMva(p);
    if(eks) setVal('jobbArbeid', eks);
    if(!val('jobbBeskrivelse') && p.beskrivelse) setVal('jobbBeskrivelse', p.beskrivelse);
  }




  function speechApi(){ return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function clearVoiceAutoStop(){
    if(app.voiceAutoStopTimer){ clearTimeout(app.voiceAutoStopTimer); app.voiceAutoStopTimer=null; }
  }
  function scheduleVoiceAutoStop(){
    clearVoiceAutoStop();
    app.voiceAutoStopTimer=setTimeout(()=>{
      if(app.voiceRecognition && app.voiceActive && val('voiceJobbText')){
        msg('voiceJobbMsg','Automatisk stopp: ingen ny tale. Lagrer jobben nå ...','ok');
        stopVoiceJobb(false);
      }
    }, 3500);
  }

  function showVoiceSavedActions(show){
    $('voiceSavedActions')?.classList.toggle('hidden', !show);
  }
  function voiceSavedMessage(){
    showVoiceSavedActions(false);
    hidePostSavePrompt();
    setVal('voiceJobbText','');
    msg('voiceJobbMsg','✅ Jobben er lagret. Klar for ny jobb.','ok');
  }
  function openLastVoiceJobb(){
    if(!app.lastVoiceJobbId){ msg('voiceJobbMsg','Fant ingen nylig innlest jobb å vise.','err'); return; }
    showTab('jobber');
    editJobb(app.lastVoiceJobbId);
  }
  async function deleteLastVoiceJobb(){
    if(!app.lastVoiceJobbId){ msg('voiceJobbMsg','Fant ingen nylig innlest jobb å slette.','err'); return; }
    if(!confirm('Slette den innleste jobben? Dette kan ikke angres.')) return;
    const id=app.lastVoiceJobbId;
    const {error}=await app.sb.from('hov_jobber').delete().eq('id',id).eq('firma_id',app.firmaId);
    if(error){ msg('voiceJobbMsg','Kunne ikke slette jobben: '+error.message,'err'); return; }
    app.lastVoiceJobbId=null;
    showVoiceSavedActions(false);
    await loadJobber(); renderAll();
    msg('voiceJobbMsg','🗑️ Den innleste jobben er slettet. Du kan lese inn på nytt.','ok');
  }
  async function finishVoiceJobbFromText(reason){
    if(app.voiceProcessing) return;
    const textNow=val('voiceJobbText');
    setVoiceButtons(false);
    if(!textNow){ msg('voiceJobbMsg','Stoppet. Ingen tekst å lagre.','ok'); return; }
    msg('voiceJobbMsg',(reason||'Stoppet')+'. Lagrer innlest jobb uten å hoppe til listen ...','ok');
    await applyVoiceTextAsJobb({autoSave:true, restart:false});
  }


  function openNewJobbWindowFromNav(){
    // Toppknappen skal åpne ny jobb-vinduet, ikke starte/skjule mikrofon direkte.
    stopVoiceJobb(true);
    clearJobbForm();
    setJobbFormReadOnly(false);
    showTab('jobber');
    setText('jobbFormTitle','Ny jobb');
    setText('saveJobbBtn','Lagre jobb');
    $('deleteJobbBtn')?.classList.add('hidden');
    msg('jobbMsg','Ny jobb er åpnet. Skriv inn jobben, eller bruk Les inn beskrivelse på skjemaet.','ok');
    setJobbLayout('formFirst');
    setTimeout(()=>{ const section=$('jobber'); if(section) section.scrollIntoView({behavior:'smooth', block:'start'}); }, 50);
  }

  function handleOneVoiceJobbButton(){
    if(app.voiceActive || app.voiceRecognition){ stopVoiceJobb(false); return; }
    if(app.lastVoiceJobbId && val('voiceJobbText')){ startVoiceNyJobb(); return; }
    if(val('voiceJobbText')){ finishVoiceJobbFromText('Skrevet tekst'); return; }
    startVoiceNyJobb();
  }

  function startVoiceNyJobb(){
    // Egen flyt for NY jobb: aldri rediger eksisterende jobb.
    if(app.voiceActive || app.voiceRecognition){
      msg('voiceJobbMsg','Lytter allerede. Trykk Stopp og lagre jobb når du er ferdig.','ok');
      return;
    }
    app.edit.jobb = null;
    app.voiceStopping = false;
    app.voiceProcessing = false;
    app.lastVoiceJobbId = null;
    showVoiceSavedActions(false);
    clearJobbForm();
    showTab('jobber');
    setJobbLayout('formFirst');
    setText('jobbFormTitle','Ny jobb');
    setText('saveJobbBtn','Lagre jobb');
    $('deleteJobbBtn')?.classList.add('hidden');
    setVal('voiceJobbText','');
    startVoiceJobb();
  }
  function startVoiceJobb(){
    const Speech = speechApi();
    if(!Speech){ msg('voiceJobbMsg','Denne nettleseren støtter ikke talegjenkjenning. Bruk Chrome/Edge på PC eller Android, eller skriv teksten i feltet og trykk Bruk skrevet tekst.','err'); return; }
    try{
      if(app.voiceActive || app.voiceRecognition){
        msg('voiceJobbMsg','Lytter allerede. Trykk Stopp og lagre jobb når du er ferdig.','ok');
        return;
      }
      clearVoiceAutoStop();
      const rec = new Speech();
      app.voiceRecognition = rec;
      app.voiceActive = true;
      app.voiceStopping = false;
      rec.lang = (window.HOV_I18N?.speechLocale?.() || 'nb-NO');
      rec.interimResults = true;
      rec.continuous = true;
      let finalText = '';
      setVoiceButtons(true);
      msg('voiceJobbMsg','🎙️ Lytter ... teksten vises under. Trykk Stopp og lagre jobb når du er ferdig.','ok');
      rec.onstart = () => {
        setVoiceButtons(true);
        msg('voiceJobbMsg','🎙️ Lytter ... teksten vises under. Trykk Stopp og lagre jobb når du er ferdig.','ok');
      };
      rec.onerror = (ev) => {
        clearVoiceAutoStop();
        const current=val('voiceJobbText');
        if(app.voiceStopping || ev.error === 'aborted') return;
        app.voiceActive = false;
        app.voiceStopping = false;
        if(app.voiceRecognition === rec) app.voiceRecognition = null;
        setVoiceButtons(false);
        if((ev.error === 'no-speech' || ev.error === 'audio-capture') && current){ finishVoiceJobbFromText('Mikrofonen stoppet'); return; }
        msg('voiceJobbMsg','Mikrofon/tale feilet: '+(ev.error || 'ukjent feil')+'. Sjekk at siden har tilgang til mikrofon.','err');
      };
      rec.onend = () => {
        clearVoiceAutoStop();
        const shouldAutoSave = !app.voiceStopping && !!val('voiceJobbText');
        app.voiceActive = false;
        app.voiceStopping = false;
        if(app.voiceRecognition === rec) app.voiceRecognition = null;
        setVoiceButtons(false);
        if(shouldAutoSave) finishVoiceJobbFromText('Talen stoppet automatisk');
        else if(!val('voiceJobbText')) msg('voiceJobbMsg','Mikrofon stoppet uten tekst. Trykk Snakk inn ny jobb for å prøve igjen.','ok');
      };
      rec.onresult = (ev) => {
        let interim = '';
        for(let i=ev.resultIndex; i<ev.results.length; i++){
          const txt = ev.results[i][0]?.transcript || '';
          if(ev.results[i].isFinal) finalText = (finalText + ' ' + txt).trim();
          else interim += txt;
        }
        const heard=(finalText + (interim ? ' ' + interim : '')).trim();
        setVal('voiceJobbText', heard);
        if(heard){
          scheduleVoiceAutoStop();
        }
      };
      rec.start();
    }catch(err){
      app.voiceActive = false;
      app.voiceStopping = false;
      app.voiceRecognition = null;
      setVoiceButtons(false);
      msg('voiceJobbMsg','Kunne ikke starte mikrofon: '+(err.message || err),'err');
    }
  }
  function setVoiceButtons(listening){
    const start=$('voiceNewJobbBtn'), top=$('navReadLastJobbBtn'), stop=$('voiceStopJobbBtn'), use=$('voiceUseTextJobbBtn'), empty=$('newJobbFromDashBtn'), txt=$('voiceJobbText');
    const hasText = !!val('voiceJobbText');
    let label = '🎙 Les inn jobb';
    if(listening) label = '⏹ Stopp og lagre';
    else if(app.lastVoiceJobbId && hasText) label = '🎙 Les inn ny jobb';
    else if(hasText) label = '💾 Lagre jobb';
    if(start){
      start.textContent = label;
      start.disabled = false;
      start.classList.toggle('voice-on', !!listening);
      start.style.width = listening ? '100%' : '';
      start.style.justifyContent = listening ? 'center' : '';
      start.style.fontSize = listening ? '20px' : '';
      start.style.padding = listening ? '18px' : '';
    }
    if(top){ top.style.display='none'; top.hidden=true; }
    for(const b of [stop,use]){ if(b){ b.style.display='none'; b.hidden=true; b.disabled=true; } }
    if(empty){ empty.hidden=false; empty.style.display=''; empty.disabled=!!listening; }
    if(txt) txt.classList.toggle('voice-listening', !!listening);
  }

  function stopVoiceJobb(silent){
    clearVoiceAutoStop();
    const rec = app.voiceRecognition;
    app.voiceStopping = true;
    app.voiceActive = false;
    app.voiceRecognition = null;
    setVoiceButtons(false);

    if(rec){
      try{ rec.stop(); }
      catch(_){ try{ rec.abort(); }catch(__){} }
    }

    if(!silent) finishVoiceJobbFromText('Stoppet');
    else app.voiceStopping=false;
  }
  function cleanDictationText(text){
    let out=String(text||'').trim();
    if(!out) return '';
    out=out.replace(/\s+/g,' ');
    out=out.replace(/\bpunktum\b/gi,'.').replace(/\bkomma\b/gi,',').replace(/\bny linje\b/gi,'\n').replace(/\bnytt avsnitt\b/gi,'\n\n');
    out=out.replace(/\s+([.,!?])/g,'$1');
    out=out.replace(/([.!?])\s+([a-zæøå])/g,(m,a,b)=>a+' '+b.toUpperCase());
    out=out.charAt(0).toUpperCase()+out.slice(1);
    if(!/[.!?]$/.test(out)) out+='.';
    return out;
  }
  function appendJobbBeskrivelse(text){
    const cleaned=cleanDictationText(text);
    if(!cleaned) return;
    const old=val('jobbBeskrivelse');
    setVal('jobbBeskrivelse', old ? (old.replace(/\s+$/,'')+'\n\n'+cleaned) : cleaned);
  }
  function setDescriptionVoiceButtons(listening){
    const start=$('voiceBeskrivelseBtn'), stop=$('voiceBeskrivelseStopBtn');
    if(start){ start.textContent=listening?'🎤 Lytter til beskrivelse ...':'🎤 Les inn beskrivelse'; start.disabled=!!listening; }
    if(stop){ stop.classList.toggle('voice-on', !!listening); stop.style.display=listening?'inline-flex':'none'; stop.disabled=!listening; }
  }
  function startVoiceBeskrivelse(){
    const Speech=speechApi();
    if(!Speech){ msg('voiceBeskrivelseMsg','Denne nettleseren støtter ikke talegjenkjenning. Bruk Chrome/Edge på PC eller Android.','err'); return; }
    try{
      stopVoiceJobb(true);
      const rec=new Speech();
      app.voiceRecognition=rec;
      app.voiceActive=true;
      app.voiceStopping=false;
      app.voiceMode='beskrivelse';
      rec.lang=(window.HOV_I18N?.speechLocale?.() || 'nb-NO');
      rec.interimResults=true;
      rec.continuous=true;
      let finalText='';
      rec.onstart=()=>{ setDescriptionVoiceButtons(true); msg('voiceBeskrivelseMsg','Lytter ... si beskrivelsen. Trykk Stopp beskrivelse når du er ferdig.','ok'); };
      rec.onerror=(ev)=>{ app.voiceActive=false; app.voiceMode=null; setDescriptionVoiceButtons(false); msg('voiceBeskrivelseMsg','Mikrofon/tale feilet: '+(ev.error||'ukjent feil'),'err'); };
      rec.onend=()=>{
        const wasActive=app.voiceActive;
        app.voiceActive=false;
        if(app.voiceRecognition===rec) app.voiceRecognition=null;
        const shouldAppend = finalText.trim() && (!app.voiceStopping || app.voiceMode==='beskrivelse');
        app.voiceMode=null;
        setDescriptionVoiceButtons(false);
        if(shouldAppend){ appendJobbBeskrivelse(finalText); msg('voiceBeskrivelseMsg','Beskrivelsen er lagt til.','ok'); }
        else if(wasActive && !app.voiceStopping) msg('voiceBeskrivelseMsg','Mikrofon stoppet uten tekst.','err');
      };
      rec.onresult=(ev)=>{
        let interim='';
        for(let i=ev.resultIndex;i<ev.results.length;i++){
          const txt=ev.results[i][0]?.transcript || '';
          if(ev.results[i].isFinal) finalText=(finalText+' '+txt).trim();
          else interim+=txt;
        }
        msg('voiceBeskrivelseMsg','Hører: '+esc((finalText+' '+interim).trim()),'ok');
      };
      rec.start();
    }catch(err){ app.voiceActive=false; app.voiceMode=null; setDescriptionVoiceButtons(false); msg('voiceBeskrivelseMsg','Kunne ikke starte mikrofon: '+(err.message||err),'err'); }
  }
  function stopVoiceBeskrivelse(){
    const rec=app.voiceRecognition;
    app.voiceStopping=true;
    setDescriptionVoiceButtons(false);
    if(rec){ try{ rec.stop(); }catch(_){ try{ rec.abort(); }catch(__){} } }
  }

  function normText(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
  function findNamed(rows, text, keys){
    const ntext = normText(text);
    const compactText = ntext.replace(/[^a-z0-9æøå]+/g,'');
    const sorted = (rows||[]).slice().sort((a,b)=>String(b.navn||'').length-String(a.navn||'').length);
    for(const r of sorted){
      for(const key of keys){
        const name = normText(r?.[key] || '');
        const compactName = name.replace(/[^a-z0-9æøå]+/g,'');
        if(name && (ntext.includes(name) || (compactName && compactText.includes(compactName)))) return r;
      }
    }
    return null;
  }
  function numberAfter(text, words){
    const ntext = normText(text).replace(/,/g,'.');
    for(const w of words){
      const re = new RegExp('(?:'+w+')\\s*(?:er|pa|på|=|:)?\\s*(\\d+(?:\\.\\d+)?)','i');
      const m = ntext.match(re);
      if(m) return m[1];
    }
    return '';
  }
  function numberNear(text, words){
    const ntext = normText(text).replace(/,/g,'.');
    const wordPattern = words.join('|');
    const after = new RegExp('(?:'+wordPattern+')\\s*(?:er|pa|på|=|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:km|kilometer)?','i');
    const before = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:km|kilometer)?\\s*(?:'+wordPattern+')','i');
    const plainKm = ntext.match(/(\\d+(?:\\.\\d+)?)\\s*(?:km|kilometer)\\b/i);
    const m = ntext.match(after) || ntext.match(before) || plainKm;
    return m ? m[1] : '';
  }
  function isSkoingText(text){
    const ntext = normText(text);
    return /\b(skodde|trodde|trådde|trodde|sko(dd|ing|e)?|skoing|beslag|fullbeslag)\b/i.test(ntext);
  }
  function isAkupunkturText(text){
    const ntext = normText(text).replace(/[^a-z0-9æøå]+/g,' ');
    const compact = ntext.replace(/[^a-z0-9æøå]/g,'');
    return /\bakupunktur\b/i.test(ntext)
      || /\bakup?ung?tur\b/i.test(ntext)
      || compact.includes('akupunktur')
      || compact.includes('akuoungtur')
      || compact.includes('akoungtur')
      || compact.includes('akupungtur');
  }
  function findFullbeslagPris(){
    return (app.data.priser||[]).find(p=>/full\s*beslag|fullbeslag/i.test(normText(prisNavn(p)))) || null;
  }
  function findAkupunkturPris(){
    return (app.data.priser||[]).find(p=>/akupunktur|aku\s*punktur/i.test(normText(prisNavn(p)))) || null;
  }
  function setJobbTypeByName(name){
    fillJobbTypeSelect();
    const el=$('jobbType'); if(!el) return;
    const wanted = normText(name);
    const opt = Array.from(el.options || []).find(o=>normText(o.value)===wanted || normText(o.textContent).includes(wanted));
    if(opt){ el.value = opt.value; applySelectedJobbTypePris(); return; }
    const old = el.value;
    el.innerHTML += `<option value="${esc(name)}">${esc(name)}</option>`;
    el.value = name;
    if(!old) setVal('jobbArbeid', val('jobbArbeid') || 0);
  }
  function textAfter(text, words){
    const ntext = String(text||'');
    for(const w of words){
      const re = new RegExp(w+'\\s*[:,-]?\\s*(.+)$','i');
      const m = ntext.match(re);
      if(m) return m[1].trim();
    }
    return '';
  }



  function normalizeVoiceJobText(value){
    let s = String(value || '').replace(/\s+/g,' ').trim();
    if(!s) return '';
    // Talegjenkjenning limer av og til handling og hestenavn sammen,
    // f.eks. "skoddeaya" eller "skoddeøya".
    s = s.replace(/\b(skodde|trodde|trådde|skoing|beskar|beskjærte|beskjaerte|trimmet)(?=[A-Za-zÆØÅæøå])/gi, '$1 ');
    s = s.replace(/\b(kjørte|kjorte|kjørt|kjort)(?=\d)/gi, '$1 ');
    return s.replace(/\s+/g,' ').trim();
  }
  function voiceEditDistance(a,b){
    a=normText(a).replace(/[^a-z0-9æøå]/g,'');
    b=normText(b).replace(/[^a-z0-9æøå]/g,'');
    const m=a.length,n=b.length;
    if(!m) return n; if(!n) return m;
    const prev=Array.from({length:n+1},(_,i)=>i), cur=new Array(n+1);
    for(let i=1;i<=m;i++){
      cur[0]=i;
      for(let j=1;j<=n;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      for(let j=0;j<=n;j++) prev[j]=cur[j];
    }
    return prev[n];
  }
  function findLooseVoiceHorse(name){
    const wanted=normText(name).replace(/[^a-z0-9æøå]/g,'');
    if(!wanted) return null;
    let best=null,bestDist=999;
    for(const h of (app.data.hester||[])){
      const hn=normText(h.navn||'').replace(/[^a-z0-9æøå]/g,'');
      if(!hn) continue;
      if(hn===wanted) return h;
      const d=voiceEditDistance(wanted,hn);
      const maxAllowed=Math.max(wanted.length,hn.length)<=4 ? 1 : 2;
      if(d<=maxAllowed && d<bestDist){ best=h; bestDist=d; }
    }
    return best;
  }

  function extractVoiceHorseName(text){
    const raw = normalizeVoiceJobText(text).replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
    if(!raw) return '';
    const stopWords = new Set(['jeg','vi','du','han','hun','den','det','i','på','pa','og','for','med','hos','til','fra','kjørte','kjorte','kjørt','kjort','kjøring','kjoring','km','kilometer','arbeid','jobb','beløp','belop','pris','varer','utlegg','materialer','beskrivelse','notat','kommentar']);
    const patterns = [
      /\b(?:skodde|trodde|trådde|trodde|sko(?:dde|dd|ing)?|beskar|beskjærte|beskjaerte|trimmet)\s+([A-Za-zÆØÅæøå][A-Za-zÆØÅæøå0-9'\- ]{0,60})/i,
      /\bhest(?:en)?\s+(?:heter\s+)?([A-Za-zÆØÅæøå][A-Za-zÆØÅæøå0-9'\- ]{0,60})/i,
      /\bfor\s+([A-Za-zÆØÅæøå][A-Za-zÆØÅæøå0-9'\- ]{0,60})/i
    ];
    for(const re of patterns){
      const m = raw.match(re);
      if(!m) continue;
      const words = String(m[1] || '').trim().split(/\s+/).filter(Boolean);
      const name = [];
      for(const w of words){
        const nw = normText(w).replace(/[^a-z0-9æøå]/g,'');
        if(!nw || stopWords.has(nw) || /^\d+$/.test(nw)) break;
        name.push(w.replace(/[^A-Za-zÆØÅæøå0-9'\-]/g,''));
        if(name.length >= 2) break;
      }
      const out = name.join(' ').trim();
      if(out) return out;
    }
    return '';
  }

  async function createHorseFromVoiceName(name, kundeId){
    const horseName = String(name || '').trim();
    if(!horseName) return null;
    const payload = {firma_id: app.firmaId, kunde_id: kundeId || null, navn: horseName, rase: null, sist_skodd: null, neste_besok: null, notater: 'Opprettet fra innlest jobb'};
    const {data,error} = await app.sb.from('hov_hester').insert(payload).select('*').single();
    if(error) throw new Error('Hesten kunne ikke opprettes: ' + error.message);
    app.data.hester = [data, ...(app.data.hester || []).filter(h => String(h.id) !== String(data.id))];
    try{ fillHestSelects(); renderHester(); }catch(_){ }
    return data;
  }



  function openCreateHorseFromVoice(spokenHestName, voiceText){
    const name = String(spokenHestName || '').trim();
    app.pendingVoiceJobbText = String(voiceText || val('voiceJobbText') || '').trim();
    try{ clearHestForm(); }catch(_){ app.edit.hest=null; }
    showTab('hester');
    setHestLayout('formFirst');
    setVal('hestNavn', name);
    setVal('hestNotater', 'Opprettet fra innlest jobb. Husk å velge riktig eier/kunde før lagring.');
    setText('hestFormTitle','Ny hest fra innlest jobb');
    setText('saveHestBtn','Lagre hest');
    $('deleteHestBtn')?.classList.add('hidden');
    msg('hestMsg','Velg eier/kunde for "' + name + '" og trykk Lagre hest. Jobben er IKKE lagret ennå. Gå tilbake til Les inn jobb etterpå for å lagre/redigere jobben.', 'err');
    setTimeout(()=>{ const el=$('hestKunde'); if(el) el.focus(); }, 80);
  }

  function numText(v){ return Number(String(v||'0').replace(/\s/g,'').replace(',', '.')) || 0; }


  function findBestPrisFromVoiceText(text){
    const ntext = normText(text);
    const compactText = ntext.replace(/[^a-z0-9æøå]/g,'');
    const priser = (app.data.priser || []).filter(p => p && p.aktiv !== false);
    if(!priser.length) return null;
    const containsAny = (words) => words.some(w => new RegExp('\\b'+w+'\\b','i').test(ntext));
    const aliasScore = (name) => {
      let score = 0;
      if(/akupunktur|aku\s*punktur/.test(name) && isAkupunkturText(text)) score += 160;
      if(/full\s*beslag|fullbeslag/.test(name) && !isAkupunkturText(text) && containsAny(['fullbeslag','full','skodde','trodde','trådde','trodde','skoing'])) score += 90;
      if(/halv\s*beslag.*foran|foran.*halv\s*beslag/.test(name) && containsAny(['halvbeslag','foran','fram','frem'])) score += 90;
      if(/halv\s*beslag.*bak|bak.*halv\s*beslag/.test(name) && containsAny(['halvbeslag','bak'])) score += 90;
      if(/barfot|beskj/.test(name) && containsAny(['barfot','beskjaering','beskjæring','trim','trimmet'])) score += 90;
      if(/akutt/.test(name) && containsAny(['akutt','akuttbesok','akuttbesøk','haster'])) score += 100;
      if(/kontroll/.test(name) && containsAny(['kontroll','etterkontroll','sjekk'])) score += 90;
      if(/lim/.test(name) && containsAny(['lim','limbeslag','liming'])) score += 90;
      if(/syke|sjuke/.test(name) && containsAny(['sykebeslag','sjukebeslag','syke','sjuke'])) score += 90;
      if(/brodd/.test(name) && containsAny(['brodd','brodder'])) score += 90;
      if(/såle|sale|pads|pad/.test(name) && containsAny(['såle','sale','saler','såler','pads','pad'])) score += 90;
      return score;
    };
    const scorePris = (p) => {
      const name = normText(prisNavn(p));
      const compactName = name.replace(/[^a-z0-9æøå]/g,'');
      const desc = normText(p.beskrivelse || p.kategori || '');
      let score = 0;
      if(name && ntext.includes(name)) score += 120 + Math.min(name.length, 40);
      if(compactName && compactName.length >= 5 && compactText.includes(compactName)) score += 120;
      const parts = name.split(/[^a-z0-9æøå]+/).filter(w => w.length >= 3);
      for(const w of parts){ if(new RegExp('\\b'+w+'\\b','i').test(ntext)) score += 14; }
      if(desc){
        const dparts = desc.split(/[^a-z0-9æøå]+/).filter(w => w.length >= 4);
        for(const w of dparts){ if(new RegExp('\\b'+w+'\\b','i').test(ntext)) score += 3; }
      }
      score += aliasScore(name);
      return score;
    };
    let best = null, bestScore = 0, secondScore = 0;
    for(const p of priser){
      const s = scorePris(p);
      if(s > bestScore){ secondScore = bestScore; bestScore = s; best = p; }
      else if(s > secondScore){ secondScore = s; }
    }
    // Ikke gjett. Behandlingen velges bare automatisk ved tydelig treff.
    if(best && bestScore >= 35 && bestScore >= secondScore + 10) return best;
    return null;
  }

  async function applyVoiceTextAsJobb(options){
    const opts = options && !options.target ? options : {};
    if(opts.autoSave && app.voiceProcessing) return false;
    if(opts.autoSave) app.voiceProcessing = true;
    const rawText = val('voiceJobbText').trim();
    const text = normalizeVoiceJobText(rawText);
    if(text !== rawText) setVal('voiceJobbText', text);
    if(!text){
      if(opts.autoSave) app.voiceProcessing = false;
      msg('voiceJobbMsg','Snakk inn eller skriv tekst først.','err');
      return false;
    }

    try{
      // Ikke hopp til jobblisten / redigeringsliste når innlesingen stoppes.
      // Vi lager payload direkte fra teksten og lar brukeren bli stående i Les inn-feltet.
      app.edit.jobb = null;
      let hest = findNamed(app.data.hester, text, ['navn']);
      const kunde = findNamed(app.data.kunder, text, ['navn','kontaktperson']);
      const spokenHestName = extractVoiceHorseName(text);
      if(!hest && spokenHestName){
        const svar = prompt('Fant ikke hesten "' + spokenHestName + '".\n\nSkriv 1 for å opprette hesten og velge eier/kunde.\nTrykk Avbryt hvis navnet er feil og skal rettes.\n\nJobben lagres ikke før hest er valgt.', '1');
        if(svar === null){
          app.voiceProcessing = false;
          msg('voiceJobbMsg','Hesten "' + spokenHestName + '" finnes ikke. Jobben er IKKE lagret. Rett navnet i feltet og lagre på nytt.','err');
          return false;
        }
        const valg = String(svar).trim();
        if(valg === '1'){
          app.voiceProcessing = false;
          openCreateHorseFromVoice(spokenHestName, text);
          msg('voiceJobbMsg','Hesten "' + spokenHestName + '" finnes ikke. Jobben er IKKE lagret før hest/eier er valgt.','err');
          return false;
        }
        app.voiceProcessing = false;
        msg('voiceJobbMsg','Ugyldig valg. Jobben er IKKE lagret. Velg/opprett hest først.','err');
        return false;
      }
      if(!hest){
        app.voiceProcessing = false;
        msg('voiceJobbMsg','Fant ingen hest i innlesingen. Jobben er IKKE lagret. Si eller skriv hestenavnet, eller velg hest i skjemaet først.','err');
        return false;
      }
      const pris = findBestPrisFromVoiceText(text);
      const km = numberNear(text, ['km','kilometer','kjoring','kjøring','kjorte','kjørte','kjort','kjørt','kjoriig','kjøriig']);
      const arbeidTale = numberAfter(text, ['arbeid','jobb','belop','beløp','pris']);
      const varer = numberAfter(text, ['varer','utlegg','materialer']);
      let beskrivelse = textAfter(text, ['beskrivelse','notat','kommentar']) || text;

      let kundeId = kunde?.id || null;
      let hestId = hest?.id || null;
      if(hest && hest.kunde_id) kundeId = hest.kunde_id;

      let jobbtype = pris ? prisNavn(pris) : '';
      if(!jobbtype){
        setVal('jobbDato', today());
        setJobbKundeLocked(false);
        if(kundeId) setVal('jobbKunde', kundeId);
        fillJobbHester();
        if(hestId) setVal('jobbHest', hestId);
        syncJobbKundeHestLock();
        fillJobbTypeSelect();
        setVal('jobbType', '');
        setVal('jobbKm', km ? numText(km) : '');
        setVal('jobbKmPris', '5,30');
        setVal('jobbArbeid', arbeidTale ? numText(arbeidTale) : '');
        setVal('jobbVarer', varer ? numText(varer) : '');
        setVal('jobbBeskrivelse', beskrivelse);
        setJobbFormVisible(true);
        showTab('jobber');
        setJobbLayout('formFirst');
        setText('jobbFormTitle','Velg behandling for innlest jobb');
        app.voiceProcessing = false;
        msg('voiceJobbMsg','Fant hest, men ingen sikker behandling. Velg behandling i Jobbtype/pris og trykk Lagre jobb. Jobben er IKKE lagret ennå.','err');
        msg('jobbMsg','Velg behandling i Jobbtype/pris. Jobben er ikke lagret før du trykker Lagre jobb.','err');
        setTimeout(()=>{ const el=$('jobbType'); if(el) el.focus(); }, 100);
        return false;
      }

      const prisArbeid = pris ? (prisEksMva(pris) || 0) : 0;
      const arbeid = arbeidTale ? numText(arbeidTale) : prisArbeid;
      const kmTall = km ? numText(km) : 0;
      const varerTall = varer ? numText(varer) : 0;
      const kmPris = 5.30;
      const sats = Number(app.firma?.standard_mva_sats ?? app.firma?.mva_sats ?? 25);
      const eks = arbeid + varerTall + (kmTall * kmPris);
      const mva = eks * sats / 100;
      const total = eks + mva;

      const payload = { dato: today(), kunde_id: kundeId, hest_id: hestId, jobbtype, beskrivelse, km: kmTall, km_pris: kmPris, arbeid_belop: arbeid, varer_belop: varerTall, mva, total, fakturert: false, firma_id: app.firmaId };

      // Fyll også ut skjemaet under, men uten å scrolle eller bytte visning.
      setVal('jobbDato', payload.dato);
      setJobbKundeLocked(false);
      if(payload.kunde_id) setVal('jobbKunde', payload.kunde_id);
      fillJobbHester();
      if(payload.hest_id) setVal('jobbHest', payload.hest_id);
      syncJobbKundeHestLock();
      fillJobbTypeSelect();
      if($('jobbType') && !Array.from($('jobbType').options||[]).some(o=>o.value===payload.jobbtype)) $('jobbType').innerHTML += `<option value="${esc(payload.jobbtype)}">${esc(payload.jobbtype)}</option>`;
      setVal('jobbType', payload.jobbtype);
      setVal('jobbKm', payload.km || '');
      setVal('jobbKmPris', payload.km_pris);
      setVal('jobbArbeid', payload.arbeid_belop || 0);
      setVal('jobbVarer', payload.varer_belop || '');
      setVal('jobbBeskrivelse', payload.beskrivelse);

      if(opts.autoSave){
        msg('voiceJobbMsg','Lagrer innlest jobb ...','ok');
        // Bruk den samme lagringen som vanlig Lagre jobb, men uten å hoppe til listen.
        // Dette unngår heng/feil fra ekstra direkte-lagring og holder brukeren på Les inn.
        app.edit.jobb = null;
        const saved = await saveJobb({fromVoice:true, forceNew:true, stayOnVoice:true});
        if(!saved) throw new Error('Vanlig lagring returnerte ikke lagret jobb.');
        app.lastVoiceJobbId = saved.id || null;
        showVoiceSavedActions(false);
        hidePostSavePrompt();
        setVal('voiceJobbText','');
        msg('voiceJobbMsg','✅ Jobben er lagret. Klar for ny jobb.','ok');
        app.voiceProcessing = false;
        return true;
      }

      app.voiceProcessing = false;
      msg('voiceJobbMsg','Teksten er lagt inn i ny jobb. Trykk Bruk og lagre skrevet tekst for å lagre.','ok');
      return true;
    }catch(err){
      app.voiceProcessing = false;
      msg('voiceJobbMsg','Jobben ble ikke lagret: '+(err.message || String(err))+'. Du står fortsatt på Les inn, og teksten ligger i feltet.','err');
      return false;
    }
  }
  function openBlankJobbFromDashboard(skipMsg){
    hidePostSavePrompt(); setJobbFormVisible(true);
    clearJobbForm();
    setJobbFormReadOnly(false);
    showTab('jobber');
    setJobbLayout('formFirst');
    setText('jobbFormTitle','Ny jobb');
    if(!skipMsg) msg('jobbMsg','Ny tom jobb åpnet. Du kan fylle ut eller bruke mikrofon fra forsiden.','ok');
    setTimeout(()=>{ const formTitle=$('jobbFormTitle'); if(formTitle) formTitle.scrollIntoView({behavior:'smooth', block:'start'}); }, 50);
  }

  function bindLesInnJobbButtons(){
    const el=$('jobbList'); if(!el) return;
    el.querySelectorAll('button.small-btn[data-id]').forEach(btn=>{
      btn.addEventListener('click',(ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        readJobbAsNew(btn.dataset.id);
      });
    });
  }

  async function readLastJobbAsNew(){
    if(!app.firmaId){ msg('dashMsg','Data er ikke ferdig lastet. Prøv igjen om et øyeblikk.','err'); return; }
    if(!app.data.jobber || !app.data.jobber.length){
      msg('dashMsg','Henter jobber...','');
      await loadJobber();
    }
    const j=(app.data.jobber||[])[0];
    if(!j){ msg('dashMsg','Ingen tidligere jobber å lese inn.','err'); return; }
    readJobbAsNew(j.id);
  }

  function readJobbAsNew(id){
    hidePostSavePrompt(); setJobbFormVisible(true);
    const j = app.data.jobber.find(x=>String(x.id)===String(id));
    if(!j){ msg('dashMsg','Fant ikke jobben som skulle leses inn.','err'); return; }
    app.edit.jobb = null;
    showTab('jobber');
    setText('jobbFormTitle','Ny jobb');
    setText('saveJobbBtn','Lagre jobb');
    $('deleteJobbBtn')?.classList.add('hidden');
    setVal('jobbDato', today());
    setJobbKundeLocked(false);
    setVal('jobbKunde', j.kunde_id || '');
    fillJobbHester();
    setVal('jobbHest', j.hest_id || '');
    syncJobbKundeHestLock();
    fillJobbTypeSelect();
    setVal('jobbType', j.jobbtype || '');
    setVal('jobbKm', j.km ?? '');
    setVal('jobbKmPris', j.km_pris ?? '5,30');
    setVal('jobbArbeid', j.arbeid_belop ?? 0);
    setVal('jobbVarer', j.varer_belop ?? '');
    setVal('jobbBeskrivelse', j.beskrivelse || '');
    setVal('jobbBildeDato', today());
    if($('jobbBildeFiles')) $('jobbBildeFiles').value='';
    app.pendingJobbFiles=[]; app.currentJobbPreview=[]; renderCombinedJobbBildePreview();
    setJobbFormReadOnly(false);
    setJobbLayout('formFirst');
    renderJobber();
    msg('jobbMsg','Leste inn jobb: '+(hestNavn(j.hest_id)||'')+' - '+(j.jobbtype||'')+'. Kontroller dato og lagre som ny jobb.','ok');
    document.getElementById('jobber')?.scrollIntoView({behavior:'smooth', block:'start'});
  }


  function editKunde(id){
    const k = app.data.kunder.find(x=>String(x.id)===String(id)); if(!k) return;
    app.edit.kunde = k.id;
    setVal('kundeNavn',k.navn); setVal('kundeTelefon',k.telefon); setVal('kundeEpost',k.epost); setVal('kundeKontakt',k.kontaktperson); setVal('kundeAdresse',k.adresse);
    setText('kundeFormTitle','Rediger kunde'); setText('saveKundeBtn','Oppdater kunde'); $('deleteKundeBtn')?.classList.remove('hidden'); renderKunder(); msg('kundeMsg','Redigerer kunde: '+(k.navn||''),'ok');
  }
  function clearKundeForm(){ app.edit.kunde=null; ['kundeNavn','kundeTelefon','kundeEpost','kundeKontakt','kundeAdresse'].forEach(id=>setVal(id,'')); setText('kundeFormTitle','Ny kunde'); setText('saveKundeBtn','Lagre kunde'); $('deleteKundeBtn')?.classList.add('hidden'); renderKunder(); msg('kundeMsg',''); }
  async function deleteKunde(){
    if(!app.edit.kunde){ msg('kundeMsg','Velg en kunde først.','err'); return; }
    if(!confirm('Slette valgt kunde?')) return;
    const {error}=await app.sb.from('hov_kunder').delete().eq('id',app.edit.kunde).eq('firma_id',app.firmaId);
    msg('kundeMsg', error?error.message:'Kunde slettet.', error?'err':'ok'); if(!error){ clearKundeForm(); await loadKunder(); await loadHester(); await loadJobber(); }
  }

  function editHest(id){
    const h = app.data.hester.find(x=>String(x.id)===String(id)); if(!h) return;
    app.edit.hest = h.id;
    setVal('hestKunde',h.kunde_id); setVal('hestNavn',h.navn); setVal('hestRase',h.rase); setVal('hestSist',h.sist_skodd); setVal('hestNeste',h.neste_besok); const shoeData=parseHorseShoeProfile(h.notater); setVal('hestNotater',shoeData.notes); setVal('hestSkoVF',shoeData.profile.vf); setVal('hestSkoHF',shoeData.profile.hf); setVal('hestSkoVB',shoeData.profile.vb); setVal('hestSkoHB',shoeData.profile.hb); setVal('hestSkoType',shoeData.profile.type); setVal('hestSkoProdusent',shoeData.profile.produsent); setVal('hestSomType',shoeData.profile.som); setVal('hestPads',shoeData.profile.pads); setVal('hestBrodder',shoeData.profile.brodder); setVal('hestLim',shoeData.profile.lim); setVal('hestBeslagNotat',shoeData.profile.notat); renderImagePreview('hestBildePreview', imgUrl(h)); if($('hestBildeFile')) $('hestBildeFile').value='';
    setText('hestFormTitle','Rediger hest'); setText('saveHestBtn','Oppdater hest'); $('deleteHestBtn')?.classList.remove('hidden'); renderHester(); setHestLayout('formFirst'); msg('hestMsg','Redigerer hest: '+(h.navn||''),'ok');
  }
  function clearHestForm(){ app.edit.hest=null; ['hestNavn','hestRase','hestSist','hestNeste','hestNotater','hestSkoVF','hestSkoHF','hestSkoVB','hestSkoHB','hestSkoType','hestSkoProdusent','hestSomType','hestPads','hestBrodder','hestLim','hestBeslagNotat'].forEach(id=>setVal(id,'')); setVal('hestKunde',''); if($('hestBildeFile')) $('hestBildeFile').value=''; renderImagePreview('hestBildePreview',''); setText('hestFormTitle','Ny hest'); setText('saveHestBtn','Lagre hest'); $('deleteHestBtn')?.classList.add('hidden'); renderHester(); msg('hestMsg',''); }
  async function deleteHest(){
    if(!app.edit.hest){ msg('hestMsg','Velg en hest først.','err'); return; }
    if(!confirm('Slette valgt hest?')) return;
    const {error}=await app.sb.from('hov_hester').delete().eq('id',app.edit.hest).eq('firma_id',app.firmaId);
    msg('hestMsg', error?error.message:'Hest slettet.', error?'err':'ok'); if(!error){ clearHestForm(); await loadHester(); await loadJobber(); }
  }

  function setJobbFormReadOnly(readOnly){
    const ids=['jobbDato','jobbKunde','jobbHest','jobbType','jobbKm','jobbKmPris','jobbArbeid','jobbVarer','jobbBeskrivelse','jobbBildeDato','jobbBildeFiles','voiceBeskrivelseBtn','voiceBeskrivelseStopBtn'];
    ids.forEach(id=>{ const el=$(id); if(el) el.disabled = !!readOnly; });
  }

  function openNewJobbForm(){
    hidePostSavePrompt(); setJobbFormVisible(true);
    clearJobbForm();
    setJobbFormReadOnly(false);
    setJobbLayout('formFirst');
    showTab('jobber');
    msg('jobbMsg','Ny jobb er klar. Fyll ut skjemaet og trykk Lagre jobb.','ok');
    setTimeout(()=>{ const section=$('jobber'); if(section) section.scrollIntoView({behavior:'smooth', block:'start'}); }, 50);
  }

  function fillJobbFormFromRow(j){
    setVal('jobbDato',j.dato); setJobbKundeLocked(false); setVal('jobbKunde',j.kunde_id); fillJobbHester(); setVal('jobbHest',j.hest_id); syncJobbKundeHestLock(); fillJobbTypeSelect(); setVal('jobbType',j.jobbtype); setVal('jobbKm',j.km); setVal('jobbKmPris',j.km_pris ?? '5,30'); setVal('jobbArbeid',j.arbeid_belop); setVal('jobbVarer',j.varer_belop ?? ''); setVal('jobbBeskrivelse',j.beskrivelse); setVal('jobbBildeDato',j.dato || today()); app.pendingJobbFiles=[]; app.currentJobbPreview=jobBilder(j); renderCombinedJobbBildePreview(); if($('jobbBildeFiles')) $('jobbBildeFiles').value='';
  }
  let jobbListScrollY = 0;
  function openJobbMobileFocus(j, mode){
    if(!document.body.classList.contains('job-mobile-focus')) jobbListScrollY = window.scrollY || 0;
    const section=$('jobber');
    if(!section) return;
    section.classList.add('mobile-job-focus');
    section.classList.toggle('focus-view', mode !== 'edit');
    section.classList.toggle('focus-edit', mode === 'edit');
    document.body.classList.add('job-mobile-focus');
    setText('jobMobileFocusTitle', mode === 'edit' ? 'Rediger jobb' : 'Jobbdetaljer');
    const kunde=kundeNavn(j?.kunde_id)||'Ukjent kunde';
    const hest=hestNavn(j?.hest_id)||'Ukjent hest';
    setText('jobMobileFocusMeta', hest+' · '+kunde+(j?.dato?' · '+j.dato:''));
    $('jobMobileEditBtn')?.classList.toggle('hidden', mode === 'edit');
    section.scrollTop=0;
  }
  function editOpenJobbFromFocus(){
    const id=app.viewJobbId || app.edit.jobb;
    if(id) editJobb(id);
  }
  function closeJobbMobileFocus(){
    const section=$('jobber');
    if(section){ section.classList.remove('mobile-job-focus','focus-view','focus-edit'); section.scrollTop=0; }
    document.body.classList.remove('job-mobile-focus');
    $('jobMobileEditBtn')?.classList.remove('hidden');
    setJobbLayout('listFirst');
    renderJobber();
    setTimeout(()=>window.scrollTo({top:jobbListScrollY, behavior:'auto'}), 20);
  }

  function focusJobbForm(){
    const title=$('jobbFormTitle');
    if(!title) return;
    title.setAttribute('tabindex','-1');
    if(!document.body.classList.contains('job-mobile-focus')) title.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
    setTimeout(()=>title.focus({preventScroll:true}), 350);
  }

  function viewJobb(id){
    hidePostSavePrompt(); setJobbFormVisible(true);
    const j = app.data.jobber.find(x=>String(x.id)===String(id)); if(!j) return;
    // Klikk på en jobb skal bare VISE jobben. Redigering skjer bare via knappen "Rediger jobb".
    app.edit.jobb = null;
    app.viewJobbId = j.id;
    fillJobbFormFromRow(j);
    setJobbFormReadOnly(true);
    setText('jobbFormTitle','Jobb');
    setText('saveJobbBtn','Lagre jobb');
    $('saveJobbBtn')?.classList.add('hidden');
    $('deleteJobbBtn')?.classList.add('hidden');
    $('editSelectedJobbBtn')?.classList.remove('hidden');
    renderJobber();
    setJobbLayout('formFirst');
    msg('jobbMsg','Klikk Rediger jobb for å endre denne jobben.','ok');
    openJobbMobileFocus(j, 'view');
    setTimeout(focusJobbForm, 50);
  }
  function editJobb(id){
    hidePostSavePrompt(); setJobbFormVisible(true);
    const j = app.data.jobber.find(x=>String(x.id)===String(id)); if(!j) return;
    app.edit.jobb = j.id;
    app.viewJobbId = j.id;
    fillJobbFormFromRow(j);
    setJobbFormReadOnly(false);
    setText('jobbFormTitle','Rediger jobb'); setText('saveJobbBtn','Oppdater jobb'); $('saveJobbBtn')?.classList.remove('hidden'); $('editSelectedJobbBtn')?.classList.add('hidden'); $('deleteJobbBtn')?.classList.remove('hidden'); renderJobber(); setJobbLayout('formFirst'); msg('jobbMsg','Redigerer jobb fra '+(j.dato||''),'ok');
    openJobbMobileFocus(j, 'edit');
    setTimeout(focusJobbForm, 50);
  }
  function clearJobbForm(){ hidePostSavePrompt(); setJobbFormVisible(true); app.edit.jobb=null; app.viewJobbId=null; setJobbFormReadOnly(false); setJobbFormReadOnly(false); ['jobbBeskrivelse'].forEach(id=>setVal(id,'')); setVal('jobbType',''); setVal('jobbDato',today()); setVal('jobbBildeDato',today()); setJobbKundeLocked(false); setVal('jobbKunde',''); fillJobbHester(); setVal('jobbHest',''); setVal('jobbKm',''); setVal('jobbKmPris','5,30'); setVal('jobbArbeid',0); setVal('jobbVarer',''); app.pendingJobbFiles=[]; app.currentJobbPreview=[]; if($('jobbBildeFiles')) $('jobbBildeFiles').value=''; renderCombinedJobbBildePreview(); setText('jobbFormTitle','Ny jobb'); setText('saveJobbBtn','Lagre jobb'); $('saveJobbBtn')?.classList.remove('hidden'); $('editSelectedJobbBtn')?.classList.add('hidden'); $('deleteJobbBtn')?.classList.add('hidden'); renderJobber(); msg('jobbMsg',''); }
  async function deleteJobb(){
    if(!app.edit.jobb){ msg('jobbMsg','Velg en jobb først.','err'); return; }
    if(!confirm('Slette valgt jobb?')) return;
    const {error}=await app.sb.from('hov_jobber').delete().eq('id',app.edit.jobb).eq('firma_id',app.firmaId);
    msg('jobbMsg', error?error.message:'Jobb slettet.', error?'err':'ok'); if(!error){ clearJobbForm(); await loadJobber(); }
  }


  function prisErBehandling(kategori, navn){
    const k = normText((kategori || '') + ' ' + (navn || ''));
    return /\b(beh|behandling|behandler|massasje|terapi|laser|fysio|akupunktur|osteopati|kinesiologi)\b/.test(k);
  }
  function prisVarenrPrefix(kategori, navn){
    return prisErBehandling(kategori || val('prisKategori') || '', navn || val('prisNavn') || '') ? 'beh-' : 'hov-';
  }
  function normalizePrisVarenr(value, kategori, navn){
    const prefix = prisVarenrPrefix(kategori, navn);
    const raw = String(value || '').trim().toLowerCase();
    if(!raw) return '';
    const digits = raw.match(/(\d{1,8})/);
    if(!digits) return raw;
    return prefix + String(Number(digits[1]));
  }
  function displayPrisVarenr(p){
    return normalizePrisVarenr(p?.varenr, p?.kategori, prisNavn(p)) || '';
  }
  function generatePrisVarenr(kategori, navn){
    const prefix = prisVarenrPrefix(kategori, navn);
    const used = new Set((app.data.priser || []).map(p => displayPrisVarenr(p).toLowerCase()).filter(Boolean));
    let max = 1000;
    for(const p of (app.data.priser || [])){
      const normalized = displayPrisVarenr(p).toLowerCase();
      const m = normalized.match(/^(hov-|beh-)(\d{1,8})$/i);
      if(!m || m[1].toLowerCase() !== prefix) continue;
      max = Math.max(max, Number(m[2]) || 0);
    }
    let next = max + 1;
    let varenr = prefix + next;
    while(used.has(varenr.toLowerCase())){
      next += 1;
      varenr = prefix + next;
    }
    return varenr;
  }
  function ensurePrisVarenr(){
    const kategori = val('prisKategori');
    const navn = val('prisNavn');
    const existing = val('prisVarenr');
    if(existing){
      const normalized = normalizePrisVarenr(existing, kategori, navn);
      setVal('prisVarenr', normalized);
      return normalized;
    }
    const generated = generatePrisVarenr(kategori, navn);
    setVal('prisVarenr', generated);
    return generated;
  }

  function editPris(id){
    const p = app.data.priser.find(x=>String(x.id)===String(id)); if(!p) return;
    app.edit.pris = p.id;
    setVal('prisKategori',p.kategori); setVal('prisVarenr',displayPrisVarenr(p)); setVal('prisNavn',p.navn||p.jobbtype||p.vare||p.type); setVal('prisEnhet',p.enhet||'stk'); setVal('prisEksMva',p.pris_eks_mva ?? p.pris ?? p.belop ?? p.eks_mva ?? 0); setVal('prisMvaSats',p.mva_sats ?? app.firma?.standard_mva_sats ?? 25); setVal('prisInklMva',p.pris_inkl_mva ?? 0); setChecked('prisAktiv',p.aktiv !== false); setVal('prisBeskrivelse',p.beskrivelse);
    setText('prisFormTitle','Rediger pris'); setText('savePrisBtn','Oppdater pris'); $('deletePrisBtn')?.classList.remove('hidden'); renderPriser(); msg('prisImportMsg','Redigerer pris: '+(p.navn||p.jobbtype||p.vare||''),'ok');
  }
  function clearPrisForm(){ app.edit.pris=null; ['prisKategori','prisVarenr','prisNavn','prisBeskrivelse'].forEach(id=>setVal(id,'')); setVal('prisEnhet','stk'); setVal('prisEksMva',0); setVal('prisMvaSats',app.firma?.standard_mva_sats ?? 25); setVal('prisInklMva',0); setChecked('prisAktiv',true); setText('prisFormTitle','Ny pris'); setText('savePrisBtn','Lagre pris'); $('deletePrisBtn')?.classList.add('hidden'); renderPriser(); msg('prisImportMsg','Varenr genereres automatisk som hov-1001 eller beh-1001 når prisen lagres. Eksisterende tall rettes til riktig prefix.','ok'); }
  async function savePris(){
    const eks=num('prisEksMva'); const sats=num('prisMvaSats'); const inkl = num('prisInklMva') || +(eks * (1 + sats/100)).toFixed(2);
    const payload={firma_id:app.firmaId, kategori:val('prisKategori')||null, varenr:ensurePrisVarenr(), navn:val('prisNavn'), enhet:val('prisEnhet')||'stk', pris_eks_mva:eks, mva_sats:sats, pris_inkl_mva:inkl, aktiv:$('prisAktiv')?.checked !== false, beskrivelse:val('prisBeskrivelse')||null};
    if(!payload.navn){ msg('prisImportMsg','Skriv navn på prisen.','err'); return; }
    const q = app.edit.pris ? app.sb.from('hov_priser').update(payload).eq('id',app.edit.pris).select('*').single() : app.sb.from('hov_priser').insert(payload).select('*').single();
    const {error}=await q;
    msg('prisImportMsg', error?error.message:(app.edit.pris?'Pris oppdatert.':'Pris lagret.'), error?'err':'ok'); if(!error){ clearPrisForm(); await loadPriser(); renderPriser(); }
  }
  async function deletePrisById(id){
    if(!id){ msg('prisImportMsg','Velg en pris først.','err'); return; }
    const p = (app.data.priser || []).find(x=>String(x.id)===String(id));
    const navn = p ? (p.navn || p.jobbtype || p.vare || p.type || p.varenr || 'valgt pris') : 'valgt pris';
    if(!confirm('Slette pris: ' + navn + '?')) return;
    const {error}=await app.sb.from('hov_priser').delete().eq('id',id).eq('firma_id',app.firmaId);
    msg('prisImportMsg', error?error.message:'Pris slettet.', error?'err':'ok');
    if(!error){ if(String(app.edit.pris||'')===String(id)) clearPrisForm(); await loadPriser(); renderPriser(); fillJobbTypeSelect(); }
  }
  async function deletePris(){
    if(!app.edit.pris){ msg('prisImportMsg','Velg en pris først, eller trykk Slett i prislisten.','err'); return; }
    await deletePrisById(app.edit.pris);
  }

  async function saveKunde(){
    const payload={navn:val('kundeNavn'), telefon:val('kundeTelefon')||null, epost:val('kundeEpost')||null, kontaktperson:val('kundeKontakt')||null, adresse:val('kundeAdresse')||null, firma_id:app.firmaId};
    if(!payload.navn){ msg('kundeMsg','Skriv kundenavn.','err'); return; }
    const q = app.edit.kunde ? app.sb.from('hov_kunder').update(payload).eq('id',app.edit.kunde).eq('firma_id',app.firmaId) : app.sb.from('hov_kunder').insert(payload);
    const {error}=await q;
    msg('kundeMsg', error?error.message:(app.edit.kunde?'Kunde oppdatert.':'Kunde lagret.'), error?'err':'ok'); if(!error){ clearKundeForm(); await loadKunder(); }
  }
  async function saveHest(){
    const shoeProfile={vf:val('hestSkoVF'),hf:val('hestSkoHF'),vb:val('hestSkoVB'),hb:val('hestSkoHB'),type:val('hestSkoType'),produsent:val('hestSkoProdusent'),som:val('hestSomType'),pads:val('hestPads'),brodder:val('hestBrodder'),lim:val('hestLim'),notat:val('hestBeslagNotat')};
    const payload={kunde_id: val('hestKunde')||null, navn:val('hestNavn'), rase:val('hestRase')||null, sist_skodd:val('hestSist')||null, neste_besok:val('hestNeste')||null, notater:buildHorseNotes(val('hestNotater'),shoeProfile), firma_id:app.firmaId};
    if(!payload.kunde_id || !payload.navn){ msg('hestMsg','Velg kunde og skriv hestenavn.','err'); return; }
    try{
      const file=$('hestBildeFile')?.files?.[0];
      let saved=null;
      if(app.edit.hest){
        const {data,error}=await app.sb.from('hov_hester').update(payload).eq('id',app.edit.hest).eq('firma_id',app.firmaId).select('*').single();
        if(error){ msg('hestMsg',error.message,'err'); return; }
        saved=data;
      }else{
        const {data,error}=await app.sb.from('hov_hester').insert(payload).select('*').single();
        if(error){ msg('hestMsg',error.message,'err'); return; }
        saved=data;
      }
      if(file && saved?.id){
        const uploaded=await uploadAppFile(file,'hester');
        const bpayload={firma_id:app.firmaId, hest_id:saved.id, path:uploaded.path, bilde_url:uploaded.url, filnavn:file.name||null, mime_type:file.type||null, tittel:'Bilde av hest'};
        const br=await app.sb.from('hov_hest_bilder').insert(bpayload);
        if(br.error){ msg('hestMsg','Hest lagret, men bilde ble ikke registrert: '+br.error.message,'err'); await loadHester(); return; }
      }
      msg('hestMsg', app.edit.hest?'Hest oppdatert.':'Hest lagret.', 'ok');
      clearHestForm(); await loadHester();
    }catch(err){ msg('hestMsg', err.message || String(err), 'err'); }
  }

  function inferJobbtypeFromDescription(){
    const select=$('jobbType');
    if(!select || val('jobbType')) return val('jobbType') || '';
    const text=String(val('jobbBeskrivelse')||val('voiceJobbText')||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    if(!text.trim()) return '';
    const prices=(app.data.priser||[]).filter(p=>p && p.aktiv!==false);
    const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9æøå]+/g,' ').trim();
    const hay=' '+normalize(text)+' ';
    let best=null;
    for(const p of prices){
      const name=prisNavn(p);
      const needle=normalize(name);
      if(!needle) continue;
      if(hay.includes(' '+needle+' ')){
        if(!best || needle.length>best.needle.length) best={p,needle};
      }
    }
    if(!best){
      const aliases=[
        {words:['konsultasjon','konsultasjon'], match:['konsultasjon','konsult']},
        {words:['fullbeslag','skodde','skoing'], match:['fullbeslag','skoing','skodd']},
        {words:['beskjæring','beskjar','trim'], match:['beskj','trim']}
      ];
      for(const group of aliases){
        if(!group.words.some(w=>hay.includes(' '+normalize(w)+' '))) continue;
        const p=prices.find(x=>group.match.some(m=>normalize(prisNavn(x)).includes(normalize(m))));
        if(p){ best={p,needle:normalize(prisNavn(p))}; break; }
      }
    }
    if(best){
      fillJobbTypeSelect();
      const name=prisNavn(best.p);
      setVal('jobbType',name);
      applySelectedJobbTypePris();
      return val('jobbType') || name;
    }
    return '';
  }

  function resetJobbInputForNextJob(){
    clearJobbForm();
    setVal('voiceJobbText','');
    app.voiceTranscript='';
    app.voiceFinal='';
    app.voiceInterim='';
    app.voiceProcessing=false;
    app.voiceActive=false;
    clearVoiceAutoStop();
    showVoiceSavedActions(false);
    hidePostSavePrompt();
    setJobbFormVisible(false);
    setJobbLayout('listFirst');
  }

  async function saveJobb(options){
    const opts = options && !options.target ? options : {};
    if(!val('jobbType')) inferJobbtypeFromDescription();
    const arbeid=num('jobbArbeid'), varer=num('jobbVarer'), km=num('jobbKm'), kmPris=num('jobbKmPris') || 5.30;
    const eks=arbeid+varer+(km*kmPris); const sats=Number(app.firma?.standard_mva_sats ?? app.firma?.mva_sats ?? 25); const mva=eks*sats/100; const total=eks+mva;
    const payload={dato:val('jobbDato')||today(), kunde_id:val('jobbKunde')||null, hest_id:val('jobbHest')||null, jobbtype:val('jobbType')||null, beskrivelse:val('jobbBeskrivelse')||null, km, km_pris:kmPris, arbeid_belop:arbeid, varer_belop:varer, mva, total, fakturert:false, firma_id:app.firmaId};
    const hest = payload.hest_id ? app.data.hester.find(h=>String(h.id)===String(payload.hest_id)) : null;
    if(opts.fromVoice && !payload.jobbtype){
      payload.jobbtype = 'Innlest jobb';
      if($('jobbType')){
        const el=$('jobbType');
        if(!Array.from(el.options||[]).some(o=>o.value==='Innlest jobb')) el.innerHTML += '<option value="Innlest jobb">Innlest jobb</option>';
        el.value='Innlest jobb';
      }
    }
    if(hest && hest.kunde_id){ payload.kunde_id = hest.kunde_id; setVal('jobbKunde', hest.kunde_id); setJobbKundeLocked(true); }
    if(!payload.hest_id){
      const targetMsg = opts.fromVoice ? 'voiceJobbMsg' : 'jobbMsg';
      msg(targetMsg,'Velg hest før jobben lagres. Jobben er IKKE lagret.','err');
      return false;
    }
    if(!hest){
      const targetMsg = opts.fromVoice ? 'voiceJobbMsg' : 'jobbMsg';
      msg(targetMsg,'Valgt hest finnes ikke. Velg hest på nytt før jobben lagres.','err');
      return false;
    }
    if(!payload.kunde_id || !payload.jobbtype){ msg('jobbMsg','Velg jobbtype/pris. Du kan også skrive navnet på behandlingen i beskrivelsen, for eksempel Konsultasjon.','err'); $('jobbType')?.focus(); return false; }
    if(payload.kunde_id && String(hest.kunde_id)!==String(payload.kunde_id)){ msg('jobbMsg','Hest og kunde/eier matcher ikke. Velg hest på nytt.','err'); return false; }
    try{
      let saved=null;
      if(app.edit.jobb && !opts.forceNew){
        const {data,error}=await app.sb.from('hov_jobber').update(payload).eq('id',app.edit.jobb).eq('firma_id',app.firmaId).select('*').single();
        if(error){ msg('jobbMsg',error.message,'err'); return false; }
        saved=data;
      }else{
        const {data,error}=await app.sb.from('hov_jobber').insert(payload).select('*').single();
        if(error){ msg('jobbMsg',error.message,'err'); return false; }
        saved=data;
      }
      const files=(app.pendingJobbFiles||[]).map(x=>x.file).filter(Boolean);
      if(files.length && saved?.id){
        const bildeDato=val('jobbBildeDato') || payload.dato || today();
        const rows=[];
        for(const file of files){
          const up=await uploadAppFile(file,'jobber');
          const meta=(app.pendingJobbFiles||[]).find(x=>x.file===file);
          rows.push({firma_id:app.firmaId, jobb_id:saved.id, hest_id:payload.hest_id, path:up.path, bilde_url:up.url, dato:(meta?.dato || bildeDato), filnavn:file.name||null, mime_type:file.type||null});
        }
        const br=await app.sb.from('hov_jobb_bilder').insert(rows);
        if(br.error){ msg('jobbMsg','Jobb lagret, men bilde ble ikke registrert: '+br.error.message,'err'); await loadJobber(); return false; }
      }
      msg('jobbMsg', app.edit.jobb?'Jobb oppdatert.':'Jobb lagret.', 'ok');
      resetJobbInputForNextJob();
      if(opts.fromVoice && saved){
        app.data.jobber = [saved, ...(app.data.jobber||[]).filter(j=>String(j.id)!==String(saved.id))];
        try{ renderDashboard(); }catch(_){}
        if(!opts.stayOnVoice){ try{ renderJobber(); }catch(_){} }
        // Ikke vent på eller scroll til jobblisten etter innlesing.
        setTimeout(()=>{ loadJobber().then(()=>{ try{ renderDashboard(); if(!opts.stayOnVoice) renderAll(); }catch(_){} }).catch(()=>{}); }, 0);
        return saved;
      }
      await loadJobber(); if(document.body.classList.contains('job-mobile-focus')) closeJobbMobileFocus(); return saved || true;
    }catch(err){ msg('jobbMsg', err.message || String(err), 'err'); return false; }
  }


  function parseCsvLine(line, delimiter){
    const out=[]; let cur=''; let q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q && line[i+1]==='"'){ cur+='"'; i++; }
        else q=!q;
      } else if(ch===delimiter && !q){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur);
    return out.map(x=>x.trim());
  }

  function parsePrisCsv(text){
    text = String(text||'').replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
    if(lines.length < 2) throw new Error('CSV-filen mangler rader.');
    const delimiter = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';
    const headers = parseCsvLine(lines[0], delimiter).map(h=>h.toLowerCase().trim());
    const rows=[];
    for(const line of lines.slice(1)){
      const cols=parseCsvLine(line, delimiter);
      const obj={}; headers.forEach((h,i)=>obj[h]=cols[i] ?? '');
      const eks = Number(String(obj.pris_eks_mva || obj.pris || obj.belop || '0').replace(',', '.')) || 0;
      const sats = Number(String(obj.mva_sats || '25').replace(',', '.')) || 0;
      const inkl = obj.pris_inkl_mva ? (Number(String(obj.pris_inkl_mva).replace(',', '.')) || 0) : +(eks * (1 + sats/100)).toFixed(2);
      rows.push({
        firma_id: app.firmaId,
        kategori: obj.kategori || null,
        varenr: normalizePrisVarenr(obj.varenr || obj.varenummer || '', obj.kategori || '', obj.navn || obj.jobbtype || obj.vare || '' ) || null,
        navn: obj.navn || obj.jobbtype || obj.vare || null,
        beskrivelse: obj.beskrivelse || null,
        enhet: obj.enhet || 'stk',
        pris_eks_mva: eks,
        mva_sats: sats,
        pris_inkl_mva: inkl,
        aktiv: !/^(nei|false|0|no)$/i.test(obj.aktiv || 'ja')
      });
    }
    return rows.filter(r=>r.navn);
  }

  async function importPriserFraCsv(){
    const file = $('prisCsvFile')?.files?.[0];
    if(!file){ msg('prisImportMsg','Velg CSV-filen først.','err'); return; }
    if(!app.firmaId){ msg('prisImportMsg','Mangler firma-ID. Logg inn på nytt.','err'); return; }
    try{
      msg('prisImportMsg','Leser CSV...');
      const text = await file.text();
      const rows = parsePrisCsv(text);
      if(!rows.length){ msg('prisImportMsg','Fant ingen priser i CSV-filen.','err'); return; }
      const uniqueRows = Array.from(new Map(rows.map(r=>[String(r.navn||'').trim().toLowerCase(), r])).values());
      const { error } = await app.sb
        .from('hov_priser')
        .upsert(uniqueRows, { onConflict: 'navn', ignoreDuplicates: false });
      if(error){
        msg('prisImportMsg','Kunne ikke importere priser: '+error.message,'err');
        return;
      }
      await loadPriser(); renderPriser();
      const duplikater = rows.length - uniqueRows.length;
      msg('prisImportMsg',`Importerte/oppdaterte ${uniqueRows.length} priser fra CSV${duplikater ? ` (${duplikater} duplikater i CSV ble slått sammen)` : ''}.`, 'ok');
    }catch(err){
      msg('prisImportMsg','CSV-import feilet: '+(err.message || err), 'err');
    }
  }

  function renderFirma(){
    const f=app.firma||{};
    const cs=loadCountrySettings(); setVal('firmaLand',cs.country||(['NO','SE','GB','US'].includes(localStorage.getItem('hov_country_quick'))?localStorage.getItem('hov_country_quick'):'NO')); setVal('firmaValuta',cs.currency); setChecked('firmaFskatt',cs.fskatt); setVal('firmaSwishNr',cs.swish); setVal('firmaMobilePayNr',cs.mobilepay); setVal('firmaIdealLink',cs.ideal); setVal('firmaStripeLink',cs.stripe); setVal('firmaIban',cs.iban); setVal('firmaBic',cs.bic); setVal('firmaBankgiro',cs.bankgiro); setVal('firmaPlusgiro',cs.plusgiro); setVal('firmaSaleType',cs.saleType); setVal('firmaArbeidsland',cs.workCountry); setVal('firmaCustomerCountry',cs.customerCountry); setVal('firmaKundetype',cs.customerType); setVal('firmaCustomerVatNumber',cs.customerVatNumber); setChecked('firmaVatVerified',cs.vatVerified); setChecked('firmaAutoTax',cs.autoTax); setVal('firmaTaxMode',cs.taxMode); setVal('firmaManualTaxRate',cs.manualTaxRate); setVal('firmaTaxInvoiceNote',cs.taxInvoiceNote);
    setVal('firmaNavn',f.navn); setVal('firmaOrgnr',f.orgnr || f.org_nr); setVal('firmaMvaNr',f.mva_nr); setVal('firmaAdresse',f.adresse); setVal('firmaPostnr',f.postnr); setVal('firmaPoststed',f.poststed); setVal('firmaTelefon',f.telefon); setVal('firmaEpost',f.epost || app.user?.email); setVal('firmaNettside',f.nettside); setVal('firmaKontonr',f.kontonr); setVal('firmaVippsNr',f.vippsnummer || f.vipps_nr); setVal('firmaVippsMottaker',f.vipps_mottaker); setVal('firmaBetalingsfrist',f.betalingsfrist_dager ?? 14); setVal('firmaFakturaPrefix',f.faktura_prefix ?? 'F'); setVal('firmaNesteFakturanr',f.neste_fakturanr ?? 1); setVal('firmaMvaSats',f.standard_mva_sats ?? f.mva_sats ?? 25); applyCountryUi(false); applyTaxSuggestion(); applyTaxModeUi(); const dt=loadDocTexts(); setVal('firmaFakturaTekst',dt.faktura); setVal('firmaPurringTekst',dt.purring); setVal('firmaKreditnotaTekst',dt.kreditnota);
    const img=$('firmaLogoPreview'), info=$('firmaLogoInfo');
    if(f.logo_url){ img.src=f.logo_url; img.classList.remove('hidden'); info.textContent='Logo er lagret.'; } else { img.removeAttribute('src'); img.classList.add('hidden'); info.textContent='Ingen logo lagret.'; }
  }
  function firmaPayload(){ return { navn:val('firmaNavn')||'Hovslager', orgnr:val('firmaOrgnr')||null, mva_nr:val('firmaMvaNr')||null, adresse:val('firmaAdresse')||null, postnr:val('firmaPostnr')||null, poststed:val('firmaPoststed')||null, telefon:val('firmaTelefon')||null, epost:val('firmaEpost')||app.user?.email||null, nettside:val('firmaNettside')||null, kontonr:val('firmaKontonr')||null, vippsnummer:val('firmaVippsNr')||null, vipps_mottaker:val('firmaVippsMottaker')||null, betalingsfrist_dager:num('firmaBetalingsfrist')||14, faktura_prefix:val('firmaFakturaPrefix')||'F', neste_fakturanr:num('firmaNesteFakturanr')||1, standard_mva_sats:num('firmaMvaSats')||25, auth_user_id:app.user.id }; }
  async function saveFirma(){
    msg('firmaMsg','Lagrer firma...');
    const {data,error}=await app.sb.from('hov_firma').update(firmaPayload()).eq('id',app.firmaId).select('*').single();
    if(error){ msg('firmaMsg',error.message,'err'); return; }
    app.firma=data; saveCountrySettings(); saveDocTexts(); updateHeader(); renderFirma(); msg('firmaMsg','Firmaoppsett, landvalg og dokumenttekster lagret.','ok');
  }
  async function uploadLogo(){
    const file=$('firmaLogoFile')?.files?.[0];
    if(!file){ msg('firmaMsg','Velg en logo-fil først.','err'); return; }
    if(!app.firmaId){ msg('firmaMsg','Mangler firma-ID.','err'); return; }
    msg('firmaMsg','Laster opp logo...');
    const ext = (file.name.split('.').pop()||'png').toLowerCase();
    const path = `${app.firmaId}/${Date.now()}-${safeName(file.name||('logo.'+ext))}`;
    const up = await app.sb.storage.from('hovslager-logo').upload(path, file, { upsert:true, contentType:file.type || 'image/png' });
    if(up.error){ msg('firmaMsg','Logo ble ikke lastet opp: '+up.error.message+'  (Sjekk at bucket hovslager-logo finnes og policy er satt.)','err'); return; }
    const pub = app.sb.storage.from('hovslager-logo').getPublicUrl(path);
    const logo_url = pub.data.publicUrl;
    const {data,error}=await app.sb.from('hov_firma').update({logo_url, logo_path:path}).eq('id',app.firmaId).select('*').single();
    if(error){ msg('firmaMsg','Logo lastet opp, men kunne ikke lagre URL: '+error.message,'err'); return; }
    app.firma=data; updateHeader(); renderFirma(); msg('firmaMsg','Logo lastet opp og lagret.','ok');
  }
  async function deleteLogo(){
    if(!confirm('Slette logo fra firmaoppsettet?')) return;
    const oldPath = app.firma?.logo_path;
    if(oldPath){ await app.sb.storage.from('hovslager-logo').remove([oldPath]); }
    const {data,error}=await app.sb.from('hov_firma').update({logo_url:null, logo_path:null}).eq('id',app.firmaId).select('*').single();
    if(error){ msg('firmaMsg',error.message,'err'); return; }
    app.firma=data; updateHeader(); renderFirma(); msg('firmaMsg','Logo slettet.','ok');
  }

  document.addEventListener('DOMContentLoaded', init);
})();

  

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js?v=20260718-tripletex-send').catch(function(){});
}
