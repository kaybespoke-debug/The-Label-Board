/* ===== LAUNCH SPLASH =====
   Once per browser session, not once per load: somebody moving between screens
   should not sit through it again. Tap skips it. Anyone who has asked their
   device for less motion gets it gone in well under a second rather than a
   stripped animation they still have to wait out. */
function hideSplash(){var s=document.getElementById('splash');if(!s)return;try{s.classList.add('hide');}catch(e){}try{setTimeout(function(){if(s)s.style.display='none';},600);}catch(e){s.style.display='none';}}
function initSplash(){var s=document.getElementById('splash');if(!s)return;
  try{if(sessionStorage.getItem('tlb_partner_splash_seen')==='1'){s.style.display='none';return;}sessionStorage.setItem('tlb_partner_splash_seen','1');}catch(e){}
  var reduce=false;try{reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);}catch(e){}
  try{s.addEventListener('click',hideSplash);}catch(e){}
  try{setTimeout(hideSplash,reduce?700:2900);}catch(e){hideSplash();}
}
try{initSplash();}catch(e){try{hideSplash();}catch(_){}}
