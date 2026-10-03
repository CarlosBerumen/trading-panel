const sma=(a,n)=>a.map((_,i)=>i<n-1?NaN:a.slice(i-n+1,i+1).reduce((x,y)=>x+y,0)/n);
const ema=(a,n)=>{const k=2/(n+1);let e=a[0];return a.map((v,i)=>i?e=v*k+e*(1-k):e)};
const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1))};
function parse(t){const L=t.trim().split(/\r?\n/).filter(Boolean);if(L.length<31)throw'Faltan filas: se necesitan al menos 30 días.';
const sep=[',',';','\t'].reduce((a,b)=>L[0].split(b).length>L[0].split(a).length?b:a);
const H=L[0].split(sep).map(s=>s.replace(/"/g,'').trim().toLowerCase()),ix=r=>H.findIndex(h=>r.test(h));
let iC=ix(/^(close|cierre|último|ultimo)/);if(iC<0)iC=ix(/adj/);if(iC<0)throw'No encontré la columna de cierre (Close o Cierre).';
const iD=ix(/date|fecha|time/),iH=ix(/^(high|máx|max)/),iL=ix(/^(low|mín|min)/);
const rows=L.slice(1).map(s=>s.split(sep).map(x=>x.replace(/"/g,'').trim())).map(a=>({t:a[iD]||'',c:parseFloat(a[iC]),h:parseFloat(a[iH]),l:parseFloat(a[iL])})).filter(r=>r.c>0);
if(rows.length<30)throw'No pude leer 30 cierres válidos. Revisa el formato.';
if(Date.parse(rows[0].t)>Date.parse(rows[rows.length-1].t))rows.reverse();
return{c:rows.map(r=>r.c),h:rows.map(r=>r.h>0?r.h:r.c),l:rows.map(r=>r.l>0?r.l:r.c)}}
function st(rs,A){const m=rs.reduce((a,b)=>a+b,0)/rs.length,s=sd(rs);let e=1,pk=1,dd=0;rs.forEach(x=>{e*=1+x;pk=Math.max(pk,e);dd=Math.min(dd,e/pk-1)});const y=rs.length/A,sr=s>1e-12?m/s*Math.sqrt(A):0;return{cagr:Math.pow(e,1/y)-1,vol:s*Math.sqrt(A),sr,se:Math.sqrt((1+sr*sr/2)/y),dd}}
function bt(c,R,cost){const {s50,s100,s200}=R;let p=0,tr=0,inv=0;const rs=[],bh=[];for(let i=1;i<c.length;i++){const r=c[i]/c[i-1]-1;let x=p*r,np=p;if(!isNaN(s200[i])){if(!p){if(c[i]>s200[i]&&s50[i]>s200[i]&&c[i]>s50[i])np=1}else if(c[i]<s100[i])np=0}if(np!=p){x-=cost;tr++}if(p)inv++;p=np;rs.push(x);bh.push(r)}return{rs,bh,tr,inv:inv/rs.length}}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fscore(v){const k=['rev0','rev1','cogs0','cogs1','ni0','ni1','ta0','ta1','ta2','cfo','ltd0','ltd1','ca0','ca1','cl0','cl1'];if(!k.every(x=>Number.isFinite(v[x])))return null;
const r0=v.ni0/v.ta1,r1=v.ni1/v.ta2,cf=v.cfo/v.ta1;
return[['ROA positivo',r0>0],['Flujo operativo positivo',cf>0],['ROA mejoró',r0>r1],['Flujo operativo mayor que ROA',cf>r0],['Apalancamiento bajó',v.ltd0/((v.ta0+v.ta1)/2)<v.ltd1/((v.ta1+v.ta2)/2)],['Razón circulante mejoró',v.ca0/v.cl0>v.ca1/v.cl1],['No emitió acciones',!v.issued],['Margen bruto mejoró',(v.rev0-v.cogs0)/v.rev0>(v.rev1-v.cogs1)/v.rev1],['Rotación de activos mejoró',v.rev0/v.ta1>v.rev1/v.ta2]]}
const altman=v=>3.25+6.56*(v.ca-v.cl)/v.ta+3.26*v.re/v.ta+6.72*v.ebit/v.ta+1.05*v.eq/v.tl;
const zone=z=>!Number.isFinite(z)?'':z>2.6?'segura':z>1.1?'gris':'riesgo';
function sizing(cap,rp,k,atr,price){const u0=cap*rp/100/(k*atr),u=Math.min(u0,cap/price);return{units:u,value:u*price,stop:price-k*atr,loss:u*k*atr,capped:u<u0}}
function validate(o){try{const n=o.c.length,ok=a=>Array.isArray(a)&&a.length===n&&a.every(x=>Number.isFinite(x)&&x>0);return n>=30&&n<=20000&&ok(o.c)&&ok(o.h)&&ok(o.l)&&Array.isArray(o.t)&&o.t.length===n}catch(e){return false}}
if(typeof module!=='undefined')module.exports={sma,ema,sd,parse,st,bt,esc,fscore,altman,zone,sizing,validate};
