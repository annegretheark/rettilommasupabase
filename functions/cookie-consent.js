(function(){
  'use strict';
  var MEASUREMENT_ID='G-M9FVWRMH67';
  var STORAGE_KEY='ril_analytics_consent_v1';
  var analyticsLoaded=false;

  function loadAnalytics(){
    if(analyticsLoaded) return;
    analyticsLoaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
    window.gtag('js',new Date());
    window.gtag('config',MEASUREMENT_ID,{anonymize_ip:true});
    var script=document.createElement('script');
    script.async=true;
    script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(script);
  }

  function saveChoice(value){
    try{localStorage.setItem(STORAGE_KEY,value);}catch(e){}
    if(value==='accepted') loadAnalytics();
    render(false);
  }

  function getChoice(){
    try{return localStorage.getItem(STORAGE_KEY)||'';}catch(e){return '';}
  }

  function render(showBanner){
    var banner=document.getElementById('ril-cookie-banner');
    var settings=document.getElementById('ril-cookie-settings');
    if(!banner||!settings) return;
    banner.hidden=!showBanner;
    settings.hidden=true;
  }

  function init(){
    var banner=document.createElement('section');
    banner.id='ril-cookie-banner';
    banner.setAttribute('role','dialog');
    banner.setAttribute('aria-modal','true');
    banner.setAttribute('aria-labelledby','ril-cookie-title');
    banner.innerHTML='<h2 id="ril-cookie-title">Valg av informasjonskapsler</h2><p>Vi bruker nødvendige informasjonskapsler for at nettstedet skal fungere. Med samtykke bruker vi også Google Analytics for å forstå hvordan nettstedet brukes. Analytics lastes ikke før du velger «Godta analyse».</p><div class="ril-cookie-actions"><button id="ril-cookie-accept" type="button">Godta analyse</button><button id="ril-cookie-reject" type="button">Kun nødvendige</button></div>';
    var settings=document.createElement('button');
    settings.id='ril-cookie-settings';
    settings.type='button';
    settings.textContent='Personvernvalg';
    settings.hidden=true;
    document.body.appendChild(banner);
    document.body.appendChild(settings);
    document.getElementById('ril-cookie-accept').addEventListener('click',function(){saveChoice('accepted');});
    document.getElementById('ril-cookie-reject').addEventListener('click',function(){saveChoice('rejected');});
    settings.addEventListener('click',function(){render(true);});
    var choice=getChoice();
    if(choice==='accepted'){loadAnalytics();render(false);}else if(choice==='rejected'){render(false);}else{render(true);}
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
