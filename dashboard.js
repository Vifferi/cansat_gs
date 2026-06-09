// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
let totalPkts=0, isDark=true, prevPkt=null, lastStatus=-1;
const SM={}, pkgHist=[], speedHist=[];
let recState='idle', recStart=null, recPktCount=0;
const startTs=Date.now();


// Replay state
let replayData=[], replayIdx=0, replayTimer=null, replayPlaying=false;

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
function si(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function fm(v,d=1){return(v==null||!Number.isFinite(v))?'—':Number(v).toFixed(d);}
function nowStr(){return new Date().toLocaleTimeString('th-TH');}
function cv(v){return getComputedStyle(document.body).getPropertyValue(v).trim();}
function stdev(arr){if(arr.length<2)return null;const n=arr.length,m=arr.reduce((a,b)=>a+b,0)/n;return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/(n-1));}

// ══════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════
function toggleTheme(){
  isDark=!isDark;
  document.body.dataset.theme=isDark?'dark':'light';
  document.getElementById('tbtn').textContent=isDark?'☀ LIGHT':'🌙 DARK';
  rebuildChartTheme();
}
function rebuildChartTheme(){
  const fg=cv('--fg3'),b=cv('--border');
  const col=isDark?THEME_COLORS.dark:THEME_COLORS.light;

  // 1. Axis ticks/grid for every chart
  [...Object.values(C)].forEach(c=>{
    if(!c||!c.options?.scales)return;
    Object.values(c.options.scales).forEach(ax=>{
      if(ax.ticks)ax.ticks.color=fg;
      if(ax.grid)ax.grid.color=b;
      if(ax.border)ax.border.color=b;
      if(ax.title?.display)ax.title.color=fg;
    });
  });

  // 2. y2 axis accent colors (override generic grey set above)
  if(C.env?.options?.scales?.y2){
    C.env.options.scales.y2.ticks.color=col.y2envTick;
    C.env.options.scales.y2.border.color=col.y2envBd;
    if(C.env.options.scales.y2.title)C.env.options.scales.y2.title.color=col.y2envTick;
  }
  if(C.pwr?.options?.scales?.y2){
    C.pwr.options.scales.y2.ticks.color=col.y2pwrTick;
    C.pwr.options.scales.y2.border.color=col.y2pwrBd;
    if(C.pwr.options.scales.y2.title)C.pwr.options.scales.y2.title.color=col.y2pwrTick;
  }

  // 3. Dataset line / fill colors
  if(C.alt){C.alt.data.datasets[0].borderColor=col.alt.line;C.alt.data.datasets[0].backgroundColor=col.alt.fill;if(C.alt.data.datasets[1])C.alt.data.datasets[1].borderColor=col.altKf;}
  if(C.spd){C.spd.data.datasets[0].borderColor=col.spd.line;C.spd.data.datasets[0].backgroundColor=col.spd.fill;}
  if(C.vac){C.vac.data.datasets[0].borderColor=col.vac.line;C.vac.data.datasets[0].backgroundColor=col.vac.fill;}
  if(C.env){C.env.data.datasets[0].borderColor=col.temp;C.env.data.datasets[1].borderColor=col.hum;}
  if(C.acc){C.acc.data.datasets[0].borderColor=col.ax;C.acc.data.datasets[1].borderColor=col.ay;C.acc.data.datasets[2].borderColor=col.az;}
  if(C.pwr){C.pwr.data.datasets[0].borderColor=col.volt;C.pwr.data.datasets[1].borderColor=col.curr;}
  if(C.pm){C.pm.data.datasets[0].borderColor=col.pm1;C.pm.data.datasets[1].borderColor=col.pm25;C.pm.data.datasets[2].borderColor=col.pm10;}
  if(C.altFull){C.altFull.data.datasets[0].borderColor=col.alt.line;C.altFull.data.datasets[0].backgroundColor=col.alt.fill;if(C.altFull.data.datasets[1])C.altFull.data.datasets[1].borderColor=col.altKf;}
  if(C.as){C.as.data.datasets[0].borderColor=col.as.line;C.as.data.datasets[0].pointBackgroundColor=col.as.pt;}

  // 4. Legend label color
  LG.labels.color=col.lgc;
  [C.env,C.acc,C.pwr,C.pm].forEach(c=>{if(c)c.options.plugins.legend.labels.color=col.lgc;});

  // 5. Scatter axis title colors
  if(C.as?.options?.scales?.x?.title)C.as.options.scales.x.title.color=col.xTitleSpd;
  if(C.as?.options?.scales?.y?.title)C.as.options.scales.y.title.color=col.yTitleAlt;

  // 6. Flush
  [...Object.values(C)].forEach(c=>{if(c)c.update('none');});
}

// ══════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════
function goTab(i){
  document.querySelectorAll('.tbtn').forEach((b,j)=>b.classList.toggle('act',i===j));
  document.querySelectorAll('.tab-panel').forEach((p,j)=>p.classList.toggle('act',i===j));
  if(i===1){
    setTimeout(()=>{
      if(!accR)initAcc();
      else r3d('acc3d',accR,accC2);
      initAI();
      if(C.altFull)C.altFull.resize();
      refreshStats();
    },60);
  }
}

// ══════════════════════════════════════════════════════
// RECORDING
// ══════════════════════════════════════════════════════
function startRec(){
  if(recState==='recording')return;
  clearAll();
  if(ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({cmd:'start_session'}));
  recState='recording'; recStart=Date.now(); recPktCount=0;
  document.getElementById('rec-dot').classList.add('on');
  document.getElementById('btn-start').classList.add('dis');
  document.getElementById('btn-stop').classList.remove('dis');
  document.getElementById('rec-bar').style.display='block';
  si('rec-start-label',nowStr()); si('rec-pkt-count',0);
  showToast('⏺ Recording started — Excel จะสร้างเมื่อกด STOP');
}
function stopRec(){
  if(recState!=='recording')return;
  const s=Math.floor((Date.now()-recStart)/1000);
  const dur=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
  recState='idle'; recStart=null;
  document.getElementById('rec-dot').classList.remove('on');
  document.getElementById('btn-start').classList.remove('dis');
  document.getElementById('btn-stop').classList.add('dis');
  document.getElementById('rec-bar').style.display='none';
  si('rec-time','00:00');
  if(ws&&ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify({cmd:'stop_session'}));
    showToast(`■ Stopped — ${dur} / ${recPktCount} pkts — กำลัง Export Excel...`,5000);
  } else {
    showToast(`■ Stopped — ${dur} / ${recPktCount} pkts`,5000);
  }
}

// ══════════════════════════════════════════════════════
// CHARTS
// ══════════════════════════════════════════════════════
Chart.defaults.font.family="'Share Tech Mono',monospace";
Chart.defaults.font.size=9;
function cOpts(extra={}){
  const c=cv('--fg3'),b=cv('--border');
  return{responsive:true,maintainAspectRatio:false,animation:{duration:180},
    plugins:{legend:{display:false}},
    scales:{x:{ticks:{maxTicksLimit:6,color:c},grid:{color:b},border:{color:b}},
            y:{ticks:{color:c},grid:{color:b},border:{color:b}}},...extra};
}
function mkC(id,ds,ex={}){
  const el=document.getElementById(id);if(!el)return null;
  return new Chart(el,{type:'line',data:{labels:[],datasets:ds.map(d=>({data:[],pointRadius:0,borderWidth:1.5,tension:0.35,...d}))},options:cOpts(ex)});
}
const MP=200;

// ── Per-theme chart colour palettes ──────────────────
const THEME_COLORS={
  dark:{
    alt:{line:'#a78bfa',fill:'rgba(167,139,250,0.08)'},
    spd:{line:'#34d399',fill:'rgba(52,211,153,0.07)'},
    vac:{line:'#f87171',fill:'rgba(248,113,113,0.07)'},
    temp:'#34d399',hum:'#fbbf24',
    ax:'#f87171',ay:'#34d399',az:'#c084fc',
    volt:'#fbbf24',curr:'#22d3ee',
    pm1:'#22d3ee',pm25:'#67e8f9',pm10:'#a5f3fc',
    y2envTick:'rgba(251,191,36,0.5)',  y2envBd:'rgba(251,191,36,0.18)',
    y2pwrTick:'rgba(34,211,238,0.5)',  y2pwrBd:'rgba(34,211,238,0.18)',
    lgc:'rgba(200,210,255,0.55)',
    as:{line:'#34d399',pt:'#34d399'},
    altKf:'#00d4ff',
    xTitleSpd:'rgba(52,211,153,0.55)', yTitleAlt:'rgba(167,139,250,0.55)',
  },
  light:{
    alt:{line:'#6366f1',fill:'rgba(99,102,241,0.08)'},
    spd:{line:'#22c55e',fill:'rgba(34,197,94,0.07)'},
    vac:{line:'#ef4444',fill:'rgba(239,68,68,0.07)'},
    temp:'#22c55e',hum:'#f59e0b',
    ax:'#ef4444',ay:'#22c55e',az:'#8b5cf6',
    volt:'#f59e0b',curr:'#6366f1',
    pm1:'#0ea5e9',pm25:'#0284c7',pm10:'#075985',
    y2envTick:'rgba(245,158,11,0.55)', y2envBd:'rgba(245,158,11,0.2)',
    y2pwrTick:'rgba(99,102,241,0.55)', y2pwrBd:'rgba(99,102,241,0.2)',
    lgc:'rgba(30,60,120,0.65)',
    as:{line:'#22c55e',pt:'#22c55e'},
    altKf:'#0891b2',
    xTitleSpd:'rgba(34,197,94,0.6)',   yTitleAlt:'rgba(99,102,241,0.6)',
  }
};
const _d=THEME_COLORS.dark;

const LG={display:true,labels:{color:_d.lgc,boxWidth:7,font:{size:8,family:"'Share Tech Mono',monospace"}}};
const C={
  alt:mkC('ch0',[
    {label:'Raw',borderColor:_d.alt.line,backgroundColor:_d.alt.fill,fill:true,borderDash:[4,3],borderWidth:1.2},
    {label:'KF', borderColor:'#00d4ff',fill:false,borderWidth:2.2}
  ],{plugins:{legend:LG}}),
  spd:mkC('ch1',[{borderColor:_d.spd.line,backgroundColor:_d.spd.fill,fill:true}]),
  vac:mkC('ch2',[{borderColor:_d.vac.line,backgroundColor:_d.vac.fill,fill:true}]),
  env:mkC('ch3',[{label:'TEMP',borderColor:_d.temp,yAxisID:'y'},{label:'HUM',borderColor:_d.hum,yAxisID:'y2',borderDash:[4,2]}],
    {plugins:{legend:LG},scales:{...cOpts().scales,y2:{position:'right',ticks:{color:_d.y2envTick},grid:{drawOnChartArea:false},border:{color:_d.y2envBd}}}}),
  acc:mkC('ch4',[{label:'X',borderColor:_d.ax},{label:'Y',borderColor:_d.ay},{label:'Z',borderColor:_d.az}],{plugins:{legend:LG}}),
  pwr:mkC('ch5',[{label:'V',borderColor:_d.volt,yAxisID:'y'},{label:'mA',borderColor:_d.curr,yAxisID:'y2',borderDash:[4,2]}],
    {plugins:{legend:LG},scales:{...cOpts().scales,y2:{position:'right',ticks:{color:_d.y2pwrTick},grid:{drawOnChartArea:false},border:{color:_d.y2pwrBd}}}}),
  pm: mkC('ch6',[{label:'PM1',borderColor:_d.pm1},{label:'PM2.5',borderColor:_d.pm25},{label:'PM10',borderColor:_d.pm10}],{plugins:{legend:LG}}),
  altFull:mkC('ch_af',[
    {label:'Raw',borderColor:_d.alt.line,backgroundColor:_d.alt.fill,fill:true,borderDash:[4,3],borderWidth:1.2},
    {label:'KF', borderColor:'#00d4ff',fill:false,borderWidth:2.2}
  ],{plugins:{legend:LG}}),
  as: mkC('ch8',[{borderColor:_d.as.line,pointRadius:2,pointBackgroundColor:_d.as.pt,tension:0,showLine:true,fill:false}],
    {scales:{x:{...cOpts().scales.x,title:{display:true,text:'Speed (m/s)',color:_d.xTitleSpd,font:{size:8,family:"'Share Tech Mono'"}}},
              y:{...cOpts().scales.y,title:{display:true,text:'Alt (m)',color:_d.yTitleAlt,font:{size:8,family:"'Share Tech Mono'"}}}}}),
};
// ── Axis titles ───────────────────────────────────────
(()=>{
  const T='Time (s)';
  const axT=(text,col)=>({display:true,text,color:col||cv('--fg3'),font:{size:8,family:"'Share Tech Mono',monospace"}});
  const set=(chart,x,y,y2)=>{
    if(!chart)return;
    if(chart.options.scales.x)chart.options.scales.x.title=axT(x);
    if(chart.options.scales.y)chart.options.scales.y.title=axT(y);
    if(y2&&chart.options.scales.y2)chart.options.scales.y2.title=axT(y2,chart.options.scales.y2.ticks?.color);
  };
  set(C.alt,    T, 'Altitude (m)');
  set(C.spd,    T, 'Speed (m/s)');
  set(C.vac,    T, 'Vert Accel (m/s²)');
  set(C.env,    T, 'Temp (°C)',   'Humidity (%)');
  set(C.acc,    T, 'Accel (mg)');
  set(C.pwr,    T, 'Voltage (V)', 'Current (mA)');
  set(C.pm,     T, 'PM (µg/m³)');
  set(C.altFull,T, 'Altitude (m)');
})();

// ── Universal pan/zoom chart store ───────────────────
const DEF_VIEW=300;
function makePanChart(chart,nDS=1){
  if(!chart)return null;
  const st={labels:[],data:Array.from({length:nDS},()=>[]),panIdx:0,viewSize:DEF_VIEW};
  function render(){
    const n=st.labels.length;if(!n)return;
    const view=Math.min(st.viewSize,n);
    const s=Math.max(0,Math.min(st.panIdx,n-view));
    chart.data.labels=st.labels.slice(s,s+view);
    st.data.forEach((d,i)=>{if(chart.data.datasets[i])chart.data.datasets[i].data=d.slice(s,s+view);});
    chart.update('none');
  }
  st.add=function(lbl,...vals){
    this.labels.push(lbl);vals.forEach((v,i)=>this.data[i]?.push(v));
    this.panIdx=Math.max(0,this.labels.length-this.viewSize);render();
  };
  st.batch=function(lbl,...vals){
    this.labels.push(lbl);vals.forEach((v,i)=>this.data[i]?.push(v));
  };
  st.flush=function(){
    this.panIdx=Math.max(0,this.labels.length-this.viewSize);render();
  };
  st.clear=function(){
    this.labels=[];this.data=this.data.map(()=>[]);
    this.panIdx=0;this.viewSize=DEF_VIEW;
    chart.data.labels=[];chart.data.datasets.forEach(d=>d.data=[]);
    delete chart.options.scales.y?.min;delete chart.options.scales.y?.max;
    chart.update('none');
  };
  // interactions
  const el=chart.canvas;
  let drag=false,dragX=0,snapIdx=0;
  el.style.cursor='crosshair';
  el.title='scroll=zoom X · shift+scroll=zoom Y · drag=pan · dblclick=reset';
  el.addEventListener('mousedown',e=>{drag=true;dragX=e.clientX;snapIdx=st.panIdx;el.style.cursor='grabbing';});
  window.addEventListener('mouseup',()=>{drag=false;if(el)el.style.cursor='crosshair';});
  el.addEventListener('mousemove',e=>{
    if(!drag)return;
    const n=st.labels.length;if(n<=st.viewSize)return;
    const pxPer=Math.max(1,el.clientWidth/st.viewSize);
    st.panIdx=Math.max(0,Math.min(n-st.viewSize,snapIdx+Math.round((dragX-e.clientX)/pxPer)));
    render();
  });
  el.addEventListener('wheel',e=>{
    e.preventDefault();
    const n=st.labels.length;if(!n)return;
    if(e.shiftKey){
      const ys=chart.scales.y;if(!ys)return;
      const f=e.deltaY>0?1.15:0.87;
      const lo=chart.options.scales.y.min??ys.min,hi=chart.options.scales.y.max??ys.max;
      const mid=(lo+hi)/2;
      chart.options.scales.y.min=mid-(hi-lo)/2*f;chart.options.scales.y.max=mid+(hi-lo)/2*f;
      chart.update('none');
    } else {
      const rect=el.getBoundingClientRect();
      const ratio=(e.clientX-rect.left)/rect.width;
      const oldV=st.viewSize;
      st.viewSize=Math.round(Math.max(10,Math.min(n,oldV*(e.deltaY>0?1.2:0.83))));
      st.panIdx=Math.max(0,Math.min(n-st.viewSize,Math.round(st.panIdx+ratio*(oldV-st.viewSize))));
      render();
    }
  },{passive:false});
  el.addEventListener('dblclick',()=>{
    st.viewSize=DEF_VIEW;st.panIdx=Math.max(0,st.labels.length-DEF_VIEW);
    delete chart.options.scales.y.min;delete chart.options.scales.y.max;render();
  });
  return st;
}
// Create stores for every chart (after chart objects exist)
const CS={
  alt:makePanChart(C.alt,2),  spd:makePanChart(C.spd,1),  vac:makePanChart(C.vac,1),
  env:makePanChart(C.env,2),  acc:makePanChart(C.acc,3),  pwr:makePanChart(C.pwr,2),
  pm:makePanChart(C.pm,3),    altFull:makePanChart(C.altFull,2),
};

// ══════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════
const SDEFS=[
  {key:'alt_baro',lbl:'Altitude',unit:'m'},{key:'temp',lbl:'Temperature',unit:'°C'},
  {key:'humidity',lbl:'Humidity',unit:'%'},{key:'speed',lbl:'Speed (calc)',unit:'m/s'},
  {key:'vacc',lbl:'Vert Accel',unit:'m/s²'},{key:'accel_mag',lbl:'|Accel| (calc)',unit:'mg'},
  {key:'voltage',lbl:'Voltage',unit:'V'},
  {key:'current',lbl:'Current',unit:'mA'},{key:'watt',lbl:'Power',unit:'W'},
  {key:'pm1_0',lbl:'PM 1.0',unit:'µg'},{key:'pm2_5',lbl:'PM 2.5',unit:'µg'},
  {key:'pm10',lbl:'PM 10',unit:'µg'},{key:'battery_percent',lbl:'Battery',unit:'%'},
];
function track(k,v){if(!SM[k])SM[k]={max:-1e9,min:1e9,sum:0,n:0,cur:0};const s=SM[k];s.cur=v;if(v>s.max)s.max=v;if(v<s.min)s.min=v;s.sum+=v;s.n++;}
function gst(k){const s=SM[k];if(!s||s.n===0)return null;return{cur:s.cur,max:s.max,min:s.min,avg:s.sum/s.n};}
function updateCards(){
  const vals=[[gst('alt_baro'),0],[gst('speed'),1],[gst('vacc'),2],[gst('accel_mag'),0],
              [gst('temp'),1],[gst('humidity'),0],[gst('voltage'),2],
              [gst('pm2_5'),1],[gst('battery_percent'),0]];
  vals.forEach(([s,d],i)=>{
    if(!s)return;
    si('m'+i,fm(s.cur,d));
    const el_mx=document.getElementById('mx'+i),el_mn=document.getElementById('mn'+i),el_ma=document.getElementById('ma'+i);
    if(el_mx)el_mx.textContent=fm(s.max,d);
    if(el_mn)el_mn.textContent=fm(s.min,d);
    if(el_ma)el_ma.textContent=fm(s.avg,d);
  });
}
function refreshStats(){
  const rows=SDEFS.map(def=>{
    const s=gst(def.key);
    const sd=SM[def.key]?stdev(pkgHist.map(p=>p[def.key]).filter(v=>v!=null)):null;
    if(!s)return`<tr><td>${def.lbl}</td><td colspan="5" style="color:var(--fg3)">—</td><td class="tdu">${def.unit}</td></tr>`;
    return`<tr><td>${def.lbl}</td><td>${fm(s.cur)}</td><td class="tdmx">${fm(s.max)}</td><td class="tdmn">${fm(s.min)}</td><td class="tdag">${fm(s.avg)}</td><td class="tdsd">${sd!=null?fm(sd,3):'—'}</td><td class="tdu">${def.unit}</td></tr>`;
  }).join('');
  document.getElementById('stbody').innerHTML=rows;
  si('st0',totalPkts);
  const as=gst('alt_baro'),ss=gst('speed'),ams=gst('accel_mag'),ps=gst('pm2_5'),ts=gst('temp'),vls=gst('voltage');
  if(as){si('st2',fm(as.max,0)+' m');}
  if(ss){si('st3',fm(ss.max,2)+' m/s');}
  if(ams){si('st4',fm(ams.max,0)+' mg');}
  if(ps){si('st5',fm(ps.avg,1)+' µg/m³');}
  if(ts){si('st6',fm(ts.avg,1)+' °C');}
  if(vls){si('st7',fm(vls.min,2)+' V');}
  if(pkgHist.length>1)si('st1',(pkgHist[pkgHist.length-1].time-pkgHist[0].time).toFixed(1)+'s');
}

// ══════════════════════════════════════════════════════
// PHYSICS
// ══════════════════════════════════════════════════════
const R_EARTH=6371000;
function calcDerived(d){
  let speed=0,vacc=0,vspeed=0;
  if(prevPkt&&d.time>prevPkt.time){
    const dt=d.time-prevPkt.time;
    if(dt>0&&dt<5){
      const gpsValid=(prevPkt.lat!==-1&&prevPkt.lon!==-1&&d.lat!==-1&&d.lon!==-1);
      let dH=0;
      if(gpsValid){
        const dLat=(d.lat-prevPkt.lat)*Math.PI/180;
        const dLon=(d.lon-prevPkt.lon)*Math.PI/180;
        const a=Math.sin(dLat/2)**2+Math.cos(prevPkt.lat*Math.PI/180)*Math.cos(d.lat*Math.PI/180)*Math.sin(dLon/2)**2;
        dH=R_EARTH*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
      }
      const dV=(d.alt_baro===0||prevPkt.alt_baro===0)?0:d.alt_baro-prevPkt.alt_baro;
      speed=Math.sqrt(dH*dH+dV*dV)/dt;
      vspeed=dV/dt;
      const pvs=speedHist.length>0?speedHist[speedHist.length-1].vs:0;
      vacc=(vspeed-pvs)/dt;
    }
  }
  speedHist.push({speed,vs:vspeed});
  return{speed:Math.max(0,speed),vacc};
}

// ══════════════════════════════════════════════════════
// EVENT LOG
// ══════════════════════════════════════════════════════
function logEvt(msg,type=''){
  const log=document.getElementById('elog');
  const d=document.createElement('div');
  d.className=`ev ${type}`;
  d.innerHTML=`<span class="evt">${nowStr()}</span><span class="evm">${msg}</span>`;
  log.appendChild(d);log.scrollTop=log.scrollHeight;
}
function chkEvents(d){
  const s=d.status||0;
  if(s!==lastStatus){
    if(s&1)logEvt('🚀 ASCENT','ok');
    if(s&2)logEvt('🎯 APOGEE — '+d.alt_baro.toFixed(0)+'m','ok');
    if(s&4)logEvt('🪂 DEPLOY','warn');
    if(s&8)logEvt('⬇ DESCENT','');
    if(s&16)logEvt('🏁 LANDED','ok');
    lastStatus=s;
  }
  if(d.battery_percent<20)logEvt(`⚡ Low bat: ${d.battery_percent.toFixed(0)}%`,'crit');
}

// ══════════════════════════════════════════════════════
// SENSOR HEALTH (chips only)
// ══════════════════════════════════════════════════════
function setChip(s,cls,label){
  const el=document.getElementById('sc-'+s);
  if(el){el.className='sys-chip'+(cls?(' '+cls):'');if(label)el.textContent=s.toUpperCase()+' '+label;}
}
function updateHealth(d){
  // ENV
  const t=d.temp;
  if(t!=null){const st=t<-10||t>60?'fail':t<0||t>55?'warn':'ok';setChip('env',st,'');}
  // GPS
  const sat=d.sat!=null?d.sat:null;
  if(sat!=null){const st=sat===0?'fail':sat<4?'warn':'ok';setChip('gps',st,'');}
  // IMU
  const mag=d.acc_x!=null?Math.sqrt(d.acc_x**2+d.acc_y**2+d.acc_z**2):null;
  if(mag!=null){const st=Math.abs(mag-981)<200?'ok':'warn';setChip('imu',st,'');}
  // AIR
  const pm=d.pm2_5;
  if(pm!=null){const st=pm<=12?'ok':pm<=55?'warn':'fail';setChip('air',st,'');}
  // PWR
  const v=d.voltage;
  if(v!=null){const st=v<3.0?'fail':v<3.4?'warn':'ok';setChip('pwr',st,'');}
}

// ══════════════════════════════════════════════════════
// MAIN UPDATE
// ══════════════════════════════════════════════════════
function doUpdate(d){
  document.getElementById('overlay').classList.add('gone');
  totalPkts++;
  const der=calcDerived(d);
  d.speed=der.speed; d.vacc=der.vacc;
  d.accel_mag=Math.sqrt((d.acc_x||0)**2+(d.acc_y||0)**2+(d.acc_z||0)**2);
  pkgHist.push(d); prevPkt=d;

  if(d.team_id)si('v-team',d.team_id);

  const sf=d.status_flags||{ascending:!!(d.status&1),apogee:!!(d.status&2),deployment:!!(d.status&4),descending:!!(d.status&8),landed:!!(d.status&16)};
  [['b-asc','ascending'],['b-apg','apogee'],['b-dep','deployment'],['b-dsc','descending'],['b-lnd','landed']]
    .forEach(([id,k])=>document.getElementById(id).classList.toggle('act',!!sf[k]));

  si('vpkt','#'+String(d.packet_id).padStart(4,'0'));
  si('vtim','t='+d.time.toFixed(1)+'s');
  si('vtot',totalPkts); si('vtot-sys',totalPkts);

  ['alt_baro','temp','humidity','voltage','pm1_0','pm2_5','pm10','current','watt','battery_percent','accel_mag']
    .forEach(k=>{if(d[k]!=null)track(k,d[k]);});
  track('speed',d.speed); track('vacc',d.vacc);
  updateCards();
  updateHealth(d);

  si('vlat',d.lat.toFixed(6)+'°'); si('vlon',d.lon.toFixed(6)+'°'); si('vsat',d.sat+' sats');
  si('vcurr',fm(d.current,0)+' mA');
  const watt=d.watt!=null?d.watt:(d.voltage&&d.current?d.voltage*d.current/1000:null);
  si('vwatt',fm(watt,3)+' W');
  const bat=Math.min(100,Math.max(0,d.battery_percent||0));
  const bf=document.getElementById('bfill');
  bf.style.width=bat+'%'; bf.style.background=bat>50?'#00ff88':bat>20?'#ffc040':'#ff4060';

  const pmx=Math.max(d.pm10||1,1);
  si('pv0',fm(d.pm1_0)); si('pv1',fm(d.pm2_5)); si('pv2',fm(d.pm10));
  document.getElementById('pb0').style.width=((d.pm1_0||0)/pmx*100)+'%';
  document.getElementById('pb1').style.width=((d.pm2_5||0)/pmx*100)+'%';
  document.getElementById('pb2').style.width=((d.pm10||0)/pmx*100)+'%';

  const lbl=d.time.toFixed(1);
  CS.alt.add(lbl,d.alt_baro,d.alt_baro_kf??d.alt_baro); CS.spd.add(lbl,d.speed); CS.vac.add(lbl,d.vacc);
  CS.env.add(lbl,d.temp,d.humidity); CS.acc.add(lbl,d.acc_x,d.acc_y,d.acc_z);
  CS.pwr.add(lbl,d.voltage,d.current); CS.pm.add(lbl,d.pm1_0,d.pm2_5,d.pm10);
  CS.altFull.add(lbl,d.alt_baro,d.alt_baro_kf??d.alt_baro);
  if(C.as){C.as.data.datasets[0].data.push({x:d.speed,y:d.alt_baro});if(C.as.data.datasets[0].data.length>MP)C.as.data.datasets[0].data.shift();C.as.update('none');}

  si('ax',fm(d.acc_x,0)); si('ay',fm(d.acc_y,0)); si('az',fm(d.acc_z,0));
  si('amag',fm(d.accel_mag,0));
  updAcc(d.acc_x,d.acc_y,d.acc_z);
  updOrientation(d.acc_x,d.acc_y,d.acc_z);

  chkEvents(d);
  if(totalPkts%10===0)refreshStats();
  if(recState==='recording'){recPktCount++;si('rec-pkt-count',recPktCount);}
}

function loadHist(h){
  h.forEach(d=>{
    const der=calcDerived(d); d.speed=der.speed; d.vacc=der.vacc;
    d.accel_mag=Math.sqrt((d.acc_x||0)**2+(d.acc_y||0)**2+(d.acc_z||0)**2);
    pkgHist.push(d); prevPkt=d; totalPkts++;
    const lbl=d.time.toFixed(1);
    CS.alt.batch(lbl,d.alt_baro,d.alt_baro_kf??d.alt_baro); CS.spd.batch(lbl,d.speed); CS.vac.batch(lbl,d.vacc);
    CS.env.batch(lbl,d.temp,d.humidity); CS.acc.batch(lbl,d.acc_x,d.acc_y,d.acc_z);
    CS.pwr.batch(lbl,d.voltage,d.current); CS.pm.batch(lbl,d.pm1_0,d.pm2_5,d.pm10);
    CS.altFull.batch(lbl,d.alt_baro,d.alt_baro_kf??d.alt_baro);
    if(C.as)C.as.data.datasets[0].data.push({x:d.speed,y:d.alt_baro});
    ['alt_baro','temp','humidity','voltage','pm1_0','pm2_5','pm10','current','watt','battery_percent','accel_mag']
      .forEach(k=>{if(d[k]!=null)track(k,d[k]);});
    track('speed',d.speed); track('vacc',d.vacc);
    updateHealth(d);
  });
  si('vtot',totalPkts); si('vtot-sys',totalPkts);
  Object.values(CS).forEach(s=>s?.flush());
  if(C.as)C.as.update();
  refreshStats();
  if(h.length)si('v-team',h[h.length-1].team_id||'—');
}

// ══════════════════════════════════════════════════════
// CLEAR ALL
// ══════════════════════════════════════════════════════
function clearAll(){
  totalPkts=0; prevPkt=null; lastStatus=-1;
  pkgHist.length=0; speedHist.length=0;
  Object.keys(SM).forEach(k=>delete SM[k]);
  Object.values(CS).forEach(s=>s?.clear());
  if(C.as){C.as.data.datasets[0].data=[];C.as.update('none');}
  ['env','gps','imu','air','pwr'].forEach(s=>setChip(s,'',''));
  si('vtot','0'); si('vtot-sys','0'); si('v-team','—');
  document.getElementById('elog').innerHTML='';
  document.getElementById('stbody').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--fg3);padding:20px;">Cleared.</td></tr>';
  ['st0','st1','st2','st3','st4','st5','st6','st7'].forEach(id=>si(id,'—'));
  for(let i=0;i<9;i++){si('m'+i,'—');const mx=document.getElementById('mx'+i);const mn=document.getElementById('mn'+i);const ma=document.getElementById('ma'+i);if(mx)mx.textContent='—';if(mn)mn.textContent='—';if(ma)ma.textContent='—';}
  document.getElementById('bfill').style.width='0%';
  showToast('↺ Cleared');
}

// ══════════════════════════════════════════════════════
// 3D ACCELEROMETER
// ══════════════════════════════════════════════════════
let accS,accC2,accR,rocketGroup,accDrag=false,accPrev={x:0,y:0};
let aiCtx=null,aiW=150,aiH=230;
function initAcc(){
  const el=document.getElementById('acc3d');const W=el.clientWidth,H=230;
  accS=new THREE.Scene();
  accC2=new THREE.PerspectiveCamera(48,W/H,.1,1000);
  accC2.position.set(3.0,2.8,3.0);accC2.lookAt(0,1.0,0);
  accR=new THREE.WebGLRenderer({antialias:true,alpha:true});
  accR.setSize(W,H);accR.setClearColor(0,0);accR.setPixelRatio(window.devicePixelRatio||1);
  el.appendChild(accR.domElement);
  accS.add(new THREE.GridHelper(4,8,0x112233,0x0a1628));
  accS.add(new THREE.AmbientLight(0xffffff,.7));
  const dLight=new THREE.DirectionalLight(0xaaccff,.65);dLight.position.set(3,5,2);accS.add(dLight);
  const dLight2=new THREE.DirectionalLight(0xffeedd,.2);dLight2.position.set(-2,1,-1);accS.add(dLight2);
  // Vertical reference line (true up) — rocket is 2.0 units = 99 cm
  const refGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,2.6,0)]);
  const refLine=new THREE.Line(refGeo,new THREE.LineDashedMaterial({color:0x334466,dashSize:.14,gapSize:.09,transparent:true,opacity:.5}));
  refLine.computeLineDistances();accS.add(refLine);
  // Height measurement annotation (1 unit = 0.495m → 2.0 units ≈ 99 cm)
  const mPts=[
    new THREE.Vector3(-.52,0,0),new THREE.Vector3(-.44,0,0),   // bottom tick
    new THREE.Vector3(-.48,0,0),new THREE.Vector3(-.48,2.0,0), // vertical bar
    new THREE.Vector3(-.52,2.0,0),new THREE.Vector3(-.44,2.0,0) // top tick
  ];
  accS.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(mPts),new THREE.LineBasicMaterial({color:0x446688,transparent:true,opacity:.5})));
  const lblC=document.createElement('canvas');lblC.width=180;lblC.height=40;
  const lblX=lblC.getContext('2d');lblX.fillStyle='#5599cc';lblX.font='bold 17px monospace';
  lblX.textAlign='center';lblX.textBaseline='middle';lblX.fillText('99.0 cm',90,20);
  const lblSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(lblC),transparent:true}));
  lblSprite.scale.set(.75,.17,1);lblSprite.position.set(-.78,1.0,0);accS.add(lblSprite);
  // Rocket group — total height 2.0 units (body 1.30 + nose 0.70)
  rocketGroup=new THREE.Group();
  const bodyMat=new THREE.MeshPhongMaterial({color:0xaaccee,shininess:70});
  const noseMat=new THREE.MeshPhongMaterial({color:0x00d4ff,shininess:130,emissive:0x002233});
  const finMat=new THREE.MeshPhongMaterial({color:0x1a3a55,shininess:25});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,1.30,14),bodyMat);
  body.position.y=.65;rocketGroup.add(body);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.13,.70,14),noseMat);
  nose.position.y=1.65;rocketGroup.add(nose);
  for(let i=0;i<3;i++){
    const a=i*Math.PI*2/3;
    const fin=new THREE.Mesh(new THREE.BoxGeometry(.022,.40,.26),finMat);
    fin.position.set(Math.cos(a)*.152,.20,Math.sin(a)*.152);rocketGroup.add(fin);
  }
  accS.add(rocketGroup);
  const dom=accR.domElement;
  dom.addEventListener('mousedown',e=>{accDrag=true;accPrev={x:e.clientX,y:e.clientY};});
  window.addEventListener('mousemove',e=>{
    if(!accDrag)return;
    const sph=new THREE.Spherical().setFromVector3(accC2.position);
    sph.theta-=(e.clientX-accPrev.x)*.01;
    sph.phi=Math.max(.1,Math.min(Math.PI-.1,sph.phi+(e.clientY-accPrev.y)*.01));
    accC2.position.setFromSpherical(sph);accC2.lookAt(0,1.0,0);
    accPrev={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('mouseup',()=>accDrag=false);
  (function anim(){requestAnimationFrame(anim);if(accR)accR.render(accS,accC2);})();
}
function updAcc(vx,vy,vz){
  if(!rocketGroup)return;
  // Map sensor axes to Three.js: sensor-Z (rocket long axis) → 3D-Y (up)
  const d=new THREE.Vector3(vx,vz,vy).normalize();
  if(d.length()>.01){
    rocketGroup.setRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d)
    );
  }
}
function updOrientation(vx,vy,vz){
  if(vx==null||vy==null||vz==null)return;
  const R2D=180/Math.PI;
  const pitch=Math.atan2(vy,Math.sqrt(vx*vx+vz*vz))*R2D;
  const roll=Math.atan2(-vx,vz)*R2D;
  const tilt=Math.atan2(Math.sqrt(vx*vx+vy*vy),vz)*R2D;
  // ANALYSIS tab
  si('apitch',fm(pitch,1));si('aroll',fm(roll,1));si('atilt',fm(tilt,1));
  // MONITOR tab metric cards
  si('mc-pitch',fm(pitch,1));si('mc-roll',fm(roll,1));si('mc-tilt',fm(tilt,1));
  const tiltColor=tilt<10?'var(--green)':tilt<30?'var(--amber)':'var(--red)';
  const tiltLabel=document.getElementById('mc-tilt-label');
  if(tiltLabel){tiltLabel.textContent=tilt<10?'STRAIGHT':tilt<30?'TILTING':'LEANING';tiltLabel.style.color=tiltColor;}
  const tiltCard=document.getElementById('mc-tilt-card');
  if(tiltCard)tiltCard.style.setProperty('--a',tiltColor);
  // Attitude Indicator
  updAI(pitch,roll,tilt);
}
function initAI(){
  const c=document.getElementById('att-ind');
  if(!c||aiCtx)return;
  const dpr=window.devicePixelRatio||1;
  aiW=150;aiH=230;
  c.width=aiW*dpr;c.height=aiH*dpr;
  c.style.width=aiW+'px';c.style.height=aiH+'px';
  aiCtx=c.getContext('2d');
  aiCtx.scale(dpr,dpr);
  updAI(0,0,0);
}
function updAI(pitch,roll,tilt=0){
  if(!aiCtx)return;
  const W=aiW,H=aiH,cx=W/2,cy=H/2;
  const r=Math.min(W,H)/2-3;
  const R2=Math.PI/180;
  const ps=r/50; // 50 deg fills half-height
  aiCtx.clearRect(0,0,W,H);
  // ── Rotated sphere (sky / earth) ──────────────────────
  aiCtx.save();
  aiCtx.beginPath();aiCtx.arc(cx,cy,r,0,Math.PI*2);aiCtx.clip();
  aiCtx.translate(cx,cy);
  aiCtx.rotate(-roll*R2);
  const py=pitch*ps;
  // Sky gradient
  const sg=aiCtx.createLinearGradient(0,-r+py,0,py);
  sg.addColorStop(0,'#0a1e52');sg.addColorStop(1,'#1f4aba');
  aiCtx.fillStyle=sg;aiCtx.fillRect(-W*2,-H*2+py,W*4,H*2);
  // Earth gradient
  const eg=aiCtx.createLinearGradient(0,py,0,r+py);
  eg.addColorStop(0,'#7a3e14');eg.addColorStop(1,'#2e1005');
  aiCtx.fillStyle=eg;aiCtx.fillRect(-W*2,py,W*4,H*2);
  // Pitch marks every 10°
  for(let p=-50;p<=50;p+=10){
    if(p===0)continue;
    const y=py-p*ps;
    if(Math.abs(y)>r+4)continue;
    const maj=p%20===0;
    const len=maj?30:18;
    aiCtx.strokeStyle=maj?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.45)';
    aiCtx.lineWidth=maj?1.8:1;
    aiCtx.beginPath();aiCtx.moveTo(-len,y);aiCtx.lineTo(len,y);aiCtx.stroke();
    if(maj){
      aiCtx.fillStyle='rgba(255,255,255,0.85)';
      aiCtx.font='bold 9px monospace';
      aiCtx.textAlign='right';aiCtx.fillText(Math.abs(p)+'°',-len-3,y+3);
      aiCtx.textAlign='left'; aiCtx.fillText(Math.abs(p)+'°', len+3,y+3);
    }
  }
  // Horizon line (sharp + shadow)
  aiCtx.shadowColor='rgba(0,0,0,0.9)';aiCtx.shadowBlur=5;
  aiCtx.strokeStyle='#ffffff';aiCtx.lineWidth=2.5;
  aiCtx.beginPath();aiCtx.moveTo(-W*2,py);aiCtx.lineTo(W*2,py);aiCtx.stroke();
  aiCtx.shadowBlur=0;
  aiCtx.restore();
  // ── Fixed aircraft wings ──────────────────────────────
  aiCtx.save();aiCtx.translate(cx,cy);aiCtx.lineCap='round';
  aiCtx.shadowColor='rgba(0,0,0,1)';aiCtx.shadowBlur=6;
  aiCtx.strokeStyle='#ff9200';aiCtx.lineWidth=3;
  aiCtx.beginPath();aiCtx.moveTo(-r*.67,0);aiCtx.lineTo(-r*.24,0);aiCtx.lineTo(-r*.24,r*.13);aiCtx.stroke();
  aiCtx.beginPath();aiCtx.moveTo( r*.67,0);aiCtx.lineTo( r*.24,0);aiCtx.lineTo( r*.24,r*.13);aiCtx.stroke();
  aiCtx.shadowBlur=0;
  aiCtx.fillStyle='#ff9200';aiCtx.beginPath();aiCtx.arc(0,0,4,0,Math.PI*2);aiCtx.fill();
  aiCtx.strokeStyle='rgba(255,146,0,0.6)';aiCtx.lineWidth=1.5;
  aiCtx.beginPath();aiCtx.arc(0,0,9,0,Math.PI*2);aiCtx.stroke();
  aiCtx.restore();
  // ── Roll arc & tick marks ─────────────────────────────
  aiCtx.save();aiCtx.translate(cx,cy);
  // Arc background
  aiCtx.strokeStyle='rgba(100,150,210,0.25)';aiCtx.lineWidth=5;
  aiCtx.beginPath();aiCtx.arc(0,0,r-4,-Math.PI*.75,-Math.PI*.25);aiCtx.stroke();
  // Tick marks
  [-60,-45,-30,-20,-10,0,10,20,30,45,60].forEach(a=>{
    const maj=a%30===0;
    aiCtx.save();aiCtx.rotate((a-90)*R2);
    aiCtx.strokeStyle=maj?'rgba(220,230,255,0.8)':'rgba(160,180,220,0.4)';
    aiCtx.lineWidth=maj?1.5:1;
    aiCtx.beginPath();aiCtx.moveTo(0,-(r-2));aiCtx.lineTo(0,maj?-(r-10):-(r-6));aiCtx.stroke();
    if(maj&&a!==0){
      aiCtx.fillStyle='rgba(200,215,240,0.75)';aiCtx.font='7px monospace';aiCtx.textAlign='center';
      aiCtx.fillText(Math.abs(a),0,-(r-14));
    }
    aiCtx.restore();
  });
  // 0° center mark
  aiCtx.save();aiCtx.rotate(-Math.PI/2);
  aiCtx.strokeStyle='rgba(255,255,255,0.9)';aiCtx.lineWidth=2;
  aiCtx.beginPath();aiCtx.moveTo(0,-(r-1));aiCtx.lineTo(0,-(r-12));aiCtx.stroke();
  aiCtx.restore();
  // Roll pointer (moves with roll)
  aiCtx.rotate(-roll*R2);
  aiCtx.shadowColor='rgba(0,0,0,0.7)';aiCtx.shadowBlur=4;
  aiCtx.fillStyle='#ffe000';
  aiCtx.beginPath();aiCtx.moveTo(0,-(r-1));aiCtx.lineTo(-5.5,-(r-14));aiCtx.lineTo(5.5,-(r-14));aiCtx.closePath();aiCtx.fill();
  aiCtx.shadowBlur=0;
  aiCtx.restore();
  // ── Bezel (double ring) ───────────────────────────────
  aiCtx.strokeStyle='rgba(50,90,150,0.7)';aiCtx.lineWidth=2.5;
  aiCtx.beginPath();aiCtx.arc(cx,cy,r+1,0,Math.PI*2);aiCtx.stroke();
  aiCtx.strokeStyle='rgba(100,160,230,0.2)';aiCtx.lineWidth=1;
  aiCtx.beginPath();aiCtx.arc(cx,cy,r+4,0,Math.PI*2);aiCtx.stroke();
  // ── Bottom data strip ─────────────────────────────────
  const tc=tilt<10?'#00ff88':tilt<30?'#ffaa00':'#ff4060';
  aiCtx.fillStyle='rgba(3,14,26,0.82)';
  aiCtx.beginPath();
  aiCtx.arc(cx,cy,r+1,0.08*Math.PI,0.92*Math.PI);
  aiCtx.lineTo(cx-r,cy+r);aiCtx.lineTo(cx+r,cy+r);aiCtx.closePath();
  aiCtx.fill();
  aiCtx.font='bold 9px monospace';
  aiCtx.textAlign='left'; aiCtx.fillStyle='rgba(150,190,230,0.95)';
  aiCtx.fillText('P '+pitch.toFixed(1)+'°',cx-r+5,cy+r-5);
  aiCtx.textAlign='center';aiCtx.fillStyle=tc;
  aiCtx.fillText(tilt.toFixed(1)+'°',cx,cy+r-5);
  aiCtx.textAlign='right'; aiCtx.fillStyle='rgba(150,190,230,0.95)';
  aiCtx.fillText('R '+roll.toFixed(1)+'°',cx+r-5,cy+r-5);
}
function r3d(id,renderer,cam){
  if(!renderer)return;const el=document.getElementById(id);if(!el)return;
  const W=el.clientWidth,H=parseInt(el.style.height);renderer.setSize(W,H);cam.aspect=W/H;cam.updateProjectionMatrix();
}

// ══════════════════════════════════════════════════════
// EXPORT / TOAST
// ══════════════════════════════════════════════════════
function exportExcel(){
  if(ws&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({cmd:'export_excel'}));showToast('⏳ Exporting...');}
  else showToast('⚠ ยังไม่ได้เชื่อมต่อ');
}
function showToast(msg,ms=4000){const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',ms);}

// ══════════════════════════════════════════════════════
// REPLAY
// ══════════════════════════════════════════════════════
function loadReplayFile(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array'});
      const wsName=wb.SheetNames.find(n=>n.includes('Telemetry'))||wb.SheetNames[0];
      const ws=wb.Sheets[wsName];
      if(!ws){showToast('⚠ ไม่พบ Telemetry sheet');return;}
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      // row 0: title, row 1: raw keys (machine), row 2: display headers, row 3+: data
      // If only 2 header rows, adjust
      let keyRow=1, dataStart=3;
      const r1=rows[1]||[], r2=rows[2]||[];
      // Detect: row with 'team_id' or 'time' is the key row
      if(r1.includes('team_id')||r1.includes('time')){keyRow=1;dataStart=3;}
      else if(r2.includes('team_id')||r2.includes('time')){keyRow=2;dataStart=4;}
      else{keyRow=0;dataStart=1;} // fallback: first row is keys
      const headers=rows[keyRow];
      const data=rows.slice(dataStart).filter(r=>r.some(v=>v!==''));
      replayData=data.map(r=>{
        const d={};
        headers.forEach((h,i)=>{if(h)d[String(h).toLowerCase()]=r[i];});
        return mapReplayRow(d);
      });
      replayIdx=0;
      si('replay-info',replayData.length+' pkts');
      si('replay-pos-label','0/'+replayData.length);
      document.getElementById('rprog').style.width='0%';
      showToast('📊 Loaded '+replayData.length+' packets');
    }catch(err){showToast('⚠ Parse error: '+err.message);console.error(err);}
  };
  reader.readAsArrayBuffer(file);
}

function mapReplayRow(r){
  const n=k=>{ const v=r[k]; return v===''||v==null?0:parseFloat(v)||0; };
  const s=n('status');
  return{
    team_id:r['team_id']||r['team id']||'',
    time:n('time'), packet_id:n('packet_id')||n('packet id'),
    lat:n('lat')||n('latitude'), lon:n('lon')||n('longitude'),
    sat:n('sat')||n('satellites'), temp:n('temp'),
    humidity:n('humidity'), alt_baro:n('alt_baro')||n('altitude'),
    acc_x:n('acc_x')||n('acc x'), acc_y:n('acc_y')||n('acc y'),
    acc_z:n('acc_z')||n('acc z'), heading:n('heading'),
    pm1_0:n('pm1_0')||n('pm1.0'), pm2_5:n('pm2_5')||n('pm2.5'),
    pm10:n('pm10'), voltage:n('voltage'), current:n('current'),
    watt:n('watt'), battery_percent:n('battery_percent')||n('battery'),
    status:s,
    status_flags:{ascending:!!(s&1),apogee:!!(s&2),deployment:!!(s&4),descending:!!(s&8),landed:!!(s&16)},
  };
}

function replayPlay(){
  if(!replayData.length){showToast('⚠ Load Excel ก่อน');return;}
  if(replayPlaying)return;
  if(replayIdx>=replayData.length){replayIdx=0;clearAll();}
  else if(replayIdx===0)clearAll();
  replayPlaying=true;
  document.getElementById('overlay').classList.add('gone');
  replayTick();
}
function replayTick(){
  if(!replayPlaying||replayIdx>=replayData.length){
    replayPlaying=false;
    if(replayIdx>=replayData.length){showToast('⏹ Replay complete');refreshStats();}
    return;
  }
  const d=replayData[replayIdx];
  doUpdate(d);
  const pos=replayIdx+1;
  si('replay-pos-label',pos+'/'+replayData.length);
  document.getElementById('rprog').style.width=(pos/replayData.length*100)+'%';
  replayIdx++;
  const sp=parseInt(document.getElementById('replay-speed').value);
  let delay=sp===0?0:50;
  if(sp>0&&replayIdx<replayData.length){
    const dt=(replayData[replayIdx].time-replayData[replayIdx-1].time)*1000;
    if(dt>0)delay=Math.max(0,dt/sp);
  }
  replayTimer=setTimeout(replayTick,delay);
}
function replayPause(){replayPlaying=false;clearTimeout(replayTimer);}
function replayStop(){
  replayPlaying=false;clearTimeout(replayTimer);replayIdx=0;
  si('replay-pos-label','0/'+(replayData.length||0));
  document.getElementById('rprog').style.width='0%';
}

// ══════════════════════════════════════════════════════
// CLOCK + UPTIME + REC TIMER
// ══════════════════════════════════════════════════════
setInterval(()=>{
  document.getElementById('clock').textContent=new Date().toLocaleTimeString('th-TH');
  const s=Math.floor((Date.now()-startTs)/1000);
  si('uptime-val',String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'));
  if(recState==='recording'&&recStart){const rs=Math.floor((Date.now()-recStart)/1000);si('rec-time',String(Math.floor(rs/60)).padStart(2,'0')+':'+String(rs%60).padStart(2,'0'));}
},1000);

// ══════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════
const badge=document.getElementById('ws-badge');
let ws,reconnT;
function connect(){
  ws=new WebSocket('ws://localhost:8765');
  ws.onopen=()=>{badge.textContent='● CONNECTED';badge.classList.add('on');clearTimeout(reconnT);logEvt('Connected','ok');};
  ws.onmessage=e=>{
    try{
      const msg=JSON.parse(e.data);
      document.getElementById('overlay').classList.add('gone');
      if(msg.type==='history')loadHist(msg.data);
      else if(msg.type==='telemetry')doUpdate(msg);
      else if(msg.type==='sensor'){
        // Update health chips from sensor-only messages
        updateHealth(msg);
        if(recState==='recording'){recPktCount++;si('rec-pkt-count',recPktCount);}
        totalPkts++;si('vtot',totalPkts);si('vtot-sys',totalPkts);
      }
      else if(msg.type==='export_done'){showToast(`✅ ${msg.filename} (${msg.rows} rows)`,6000);logEvt('Exported: '+msg.filename,'ok');refreshStats();}
      else if(msg.type==='serial_status'){
        if(msg.connected){badge.textContent='● CONNECTED · '+msg.port;badge.classList.add('on');logEvt('Serial connected: '+msg.port,'ok');}
        else{badge.textContent='● NO SERIAL';badge.classList.remove('on');logEvt('Serial disconnected','warn');}
      }
      else if(msg.type==='session_started'){logEvt('⏺ Session started at '+msg.time,'ok');}
    }catch(err){console.warn(err);}
  };
  ws.onclose=()=>{badge.textContent='● RECONNECTING';badge.classList.remove('on');logEvt('Disconnected','warn');reconnT=setTimeout(connect,3000);};
  ws.onerror=()=>ws.close();
}

window.addEventListener('resize',()=>{r3d('acc3d',accR,accC2);if(C.altFull)C.altFull.resize();});
connect();
