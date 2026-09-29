'use strict';
/* REGARD — 影片校稿工具 */
const $=id=>document.getElementById(id);
const video=$('video');
let marks=[]; // {t, tc, note, sev, shot, refs:[{type:'url'|'img', url?, dataURL?}]}
let pendingShot=null, pendingT=0, pendingRefs=[];
let currentFile=null;

/* ---- 自製下拉引擎（完全取代原生 select） ---- */
function xselInit(id,onChange){
  const box=$(id);if(!box)return null;
  const btn=box.querySelector('.xsel-btn'),pop=box.querySelector('.xsel-pop'),txt=box.querySelector('.xsel-txt');
  const sync=v=>{
    box.dataset.value=v;
    pop.querySelectorAll('.xsel-opt').forEach(o=>{
      const on=o.dataset.v===String(v);
      o.classList.toggle('sel',on);
      if(on)txt.textContent=o.textContent;
    });
  };
  btn.onclick=e=>{
    e.preventDefault();
    const willOpen=!box.classList.contains('open');
    window.closeAllMenus&&window.closeAllMenus();
    document.querySelectorAll('.xsel.open').forEach(x=>{if(x!==box)x.classList.remove('open')});
    box.classList.toggle('open',willOpen);
    if(willOpen){
      const r=box.getBoundingClientRect();
      const popH=Math.max(box.querySelector('.xsel-pop').offsetHeight||140,140);
      const below=r.bottom+popH+8 <= innerHeight;   // 向下展開是否放得下
      const above=r.top-popH-8 >= 0;                 // 向上展開是否放得下
      // .xsel.up 的 CSS 意義是「向下展開」；優先選放得下的一側
      let down = below;
      if(below && above) down = true;                // 都放得下：預設向下（貼近操作）
      else if(!below && !above) down = (r.top <= innerHeight - r.bottom); // 都不行：選空間大側（向下優先）
      box.classList.toggle('up', down);
      box.classList.toggle('left', r.right + 8 > innerWidth);
    }
  };
  pop.querySelectorAll('.xsel-opt').forEach(o=>o.onclick=e=>{
    e.stopPropagation();sync(o.dataset.v);box.classList.remove('open');
    if(onChange)onChange(o.dataset.v);
  });
  sync(box.dataset.value);
  box.setValue=sync;
  return box;
}

/* ---- 自製 alert / confirm（取代瀏覽器原生視窗） ---- */
function appAlert(msg,title){
  return new Promise(res=>{
    $('amTitle').textContent=title||T('hintTitle')||'提示';
    $('amMsg').textContent=msg;
    $('amCancel').style.display='none';
    $('amOk').textContent=T('ok')||'確定';
    $('appModal').classList.add('show');
    const done=()=>{$('appModal').classList.remove('show');$('amOk').onclick=null;res(true)};
    $('amOk').onclick=done;
  });
}
function appConfirm(msg,title){
  return new Promise(res=>{
    $('amTitle').textContent=title||T('confirmTitle')||'請確認';
    $('amMsg').textContent=msg;
    $('amCancel').style.display='';
    $('amCancel').textContent=T('cancel')||'取消';
    $('amOk').textContent=T('ok')||'確定';
    $('appModal').classList.add('show');
    const close=v=>{$('appModal').classList.remove('show');$('amOk').onclick=null;$('amCancel').onclick=null;res(v)};
    $('amOk').onclick=()=>close(true);
    $('amCancel').onclick=()=>close(false);
  });
}
document.addEventListener('keydown',e=>{
  if(!$('appModal').classList.contains('show'))return;
  if(e.key==='Escape'){e.preventDefault();$('amCancel').style.display==='none'?$('amOk').click():$('amCancel').click();}
  if(e.key==='Enter'){e.preventDefault();$('amOk').click();}
},true);

/* ================= 繪圖標註引擎 ================= */
const Draw={
  tool:'pen',color:'#ff453a',width:5,
  strokes:[],cur:null,ctx:null,cv:null,dpr:1,
  baseShot:null,onApply:null,
  init(){
    this.cv=$('drawCanvas');this.ctx=this.cv.getContext('2d');
    const bar=$('drawBar');
    const penBtn=bar.querySelector('.tool-btn[data-tool="pen"]');
    const shapeWrap=$('shapeSel'),shapeBtn=$('shapeBtn'),shapePop=$('shapePop'),shapeIcon=$('shapeIcon');
    const SHAPE_ICON={arrow:'#i-arrow',line:'#i-line',rect:'#i-rect',ellipse:'#i-circle'};
    // 統一設定目前工具：筆刷與形狀鈕互斥高亮，形狀鈕的圖示同步為所選形狀
    const setTool=(t)=>{
      this.tool=t;
      const isPen=(t==='pen');
      penBtn.classList.toggle('active',isPen);
      shapeBtn.classList.toggle('active',!isPen);
      if(!isPen){
        shapeIcon.setAttribute('href',SHAPE_ICON[t]||'#i-arrow');
        shapeWrap.dataset.shape=t;
      }
      shapePop.querySelectorAll('.shape-opt').forEach(o=>o.classList.toggle('sel',o.dataset.tool===t));
    };
    this.setTool=setTool;
    penBtn.onclick=e=>{e.preventDefault();window.closeAllMenus&&window.closeAllMenus();setTool('pen')};
    // 形狀鈕：單擊套用目前形狀；點箭頭區（或已是形狀工具時）展開選單
    shapeBtn.onclick=e=>{
      e.preventDefault();
      const willOpen=!shapeWrap.classList.contains('open');
      window.closeAllMenus&&window.closeAllMenus();
      shapeWrap.classList.toggle('open',willOpen);
      if(willOpen){
        const r=shapeBtn.getBoundingClientRect();
        const ph=shapePop.offsetHeight||150;
        shapeWrap.classList.toggle('up', r.bottom+ph+8>innerHeight && r.top-ph-8>=0);
      }
      // 展開的同時就把工具切到目前形狀，單擊即可直接使用
      setTool(shapeWrap.dataset.shape||'arrow');
    };
    shapePop.querySelectorAll('.shape-opt').forEach(o=>o.onclick=e=>{
      e.stopPropagation();
      setTool(o.dataset.tool);
      shapeWrap.classList.remove('open');
    });
    setTool('pen');
    shapeWrap.dataset.shape='arrow';
    // 顏色：單一色塊顯示當前色，點擊開啟自製選單（預設色 + 自製 SV/Hue 選color器 + HEX）
    const PRESETS=['#ff453a','#ff9f0a','#ffd60a','#30d158','#0a84ff','#bf5af2','#ffffff','#c8a97e'];
    const cur=$('colorCurrent'),pop=$('colorPop'),hexIn=$('drawHex'),
          presetBox=$('colorPresets'),
          svBox=$('cpSV'),svKnob=$('cpSVKnob'),hueBox=$('cpHue'),hueKnob=$('cpHueKnob');
    let HSV={h:4,s:.75,v:1};   // 目前色的 HSV（驅動自製選色器）
    const hsv2hex=(h,s,v)=>{
      const f=n=>{const k=(n+h/60)%6;const x=v-v*s*Math.max(0,Math.min(k,4-k,1));
        return Math.round(x*255).toString(16).padStart(2,'0');};
      return '#'+f(5)+f(3)+f(1);
    };
    const hex2hsv=hex=>{
      const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
      const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
      let h=0;
      if(d){ if(mx===r)h=60*(((g-b)/d)%6); else if(mx===g)h=60*((b-r)/d+2); else h=60*((r-g)/d+4); }
      if(h<0)h+=360;
      return {h,s:mx?d/mx:0,v:mx};
    };
    const paintPicker=()=>{
      svBox.style.background=`hsl(${HSV.h},100%,50%)`;
      svKnob.style.left=(HSV.s*100)+'%';
      svKnob.style.top=((1-HSV.v)*100)+'%';
      svKnob.style.background=hsv2hex(HSV.h,HSV.s,HSV.v);
      hueKnob.style.left=(HSV.h/360*100)+'%';
      hueKnob.style.background=`hsl(${HSV.h},100%,50%)`;
    };
    const applyColor=(hex,opts)=>{
      opts=opts||{};
      hex=this._norm(hex);
      if(!/^#[0-9a-fA-F]{6}$/.test(hex))return;
      this.color=hex;
      cur.style.background=hex;
      hexIn.value=hex;   // 輸入框含 #
      if(!opts.fromPicker){HSV=hex2hsv(hex);paintPicker();}
      presetBox.querySelectorAll('button').forEach(x=>x.classList.toggle('sel',this._norm(x.dataset.c)===hex));
    };
    // ---- 自製選色器拖曳 ----
    const dragOn=(el,handler)=>{
      const run=ev=>{const r=el.getBoundingClientRect();
        handler(Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)),
                Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height)));};
      el.addEventListener('pointerdown',ev=>{ev.preventDefault();el.setPointerCapture(ev.pointerId);run(ev);
        const mv=e2=>run(e2);
        const up=()=>{el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);};
        el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);});
    };
    dragOn(svBox,(x,y)=>{HSV.s=x;HSV.v=1-y;paintPicker();applyColor(hsv2hex(HSV.h,HSV.s,HSV.v),{fromPicker:true});});
    dragOn(hueBox,x=>{HSV.h=x*360;paintPicker();applyColor(hsv2hex(HSV.h,HSV.s,HSV.v),{fromPicker:true});});
    // ---- HEX：自由輸入，只擋非法字元；不足 6 碼在確認時才補 0 ----
    hexIn.addEventListener('input',()=>{
      const pos=hexIn.selectionStart;
      // 確保 # 在最前；過濾非法字元
      let v=hexIn.value;
      if(!v.startsWith('#'))v='#'+v.replace(/[^0-9a-fA-F]/g,'');
      else v='#'+v.slice(1).replace(/[^0-9a-fA-F]/g,'');
      v=v.slice(0,7);
      if(v!==hexIn.value)hexIn.value=v;
      if(v.length===7)applyColor(v,{keepHexText:true});   // 滿 6 碼即時預覽
    });
    const commitHex=()=>{
      let v=hexIn.value;
      if(!v.startsWith('#'))v='#'+v.replace(/[^0-9a-fA-F]/g,'');
      else v='#'+v.slice(1).replace(/[^0-9a-fA-F]/g,'');
      v=v.slice(0,7);
      if(v.length<2){hexIn.value=this.color;return;}
      const full='#'+(v.slice(1)+'000000').slice(0,6);
      applyColor(full);    // 離開/Enter 時自動補 0
    };
    hexIn.addEventListener('blur',commitHex);
    hexIn.addEventListener('keydown',e=>{
      // 防止在色碼框按 Enter 觸發標註完成（已在全域 keydown 過濾）
      if(e.key==='Enter'){e.preventDefault();commitHex();}
      // # 在首位時阻止刪除
      if((e.key==='Backspace'||e.key==='Delete')&&hexIn.selectionStart<=1&&hexIn.selectionEnd<=1){e.preventDefault();}
    });
    // 建預設色按鈕
    presetBox.innerHTML=PRESETS.map(c=>`<button type="button" data-c="${c}" style="background:${c}"></button>`).join('');
    presetBox.querySelectorAll('button').forEach(btn=>btn.onclick=()=>applyColor(btn.dataset.c));
    cur.onclick=e=>{e.stopPropagation();window.closeAllMenus&&window.closeAllMenus();pop.classList.toggle('show');};
    // 點外部關閉選單
    // color-pop 關閉：capture 階段確保任何點擊外部都能關閉（不受 stopPropagation 影響）
    document.addEventListener('click',e=>{
      if(pop.classList.contains('show')&&!$('colorPop').contains(e.target)&&e.target!==cur)
        pop.classList.remove('show');
    },true);
    applyColor(this.color);
    // 工具大小：下拉 S/M/L
    xselInit('drawWidth',v=>{this.width=+v;});
    $('drawUndo').onclick=()=>{this.strokes.pop();this.redraw()};
    $('drawClear').onclick=()=>{this.strokes=[];this.redraw()};
    $('drawCancel').onclick=()=>$('drawDlg').close();
    $('drawX').onclick=()=>$('drawDlg').close();
    $('drawDone').onclick=async()=>{
      const out=await this.flatten(this.baseShot);
      $('drawDlg').close();
      if(this.onApply)this.onApply(out,this.strokes.length>0);
    };
    const P=e=>{
      const r=this.cv.getBoundingClientRect();
      return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
    };
    this.cv.addEventListener('pointerdown',e=>{
      e.preventDefault();this.cv.setPointerCapture(e.pointerId);
      this.cur={tool:this.tool,color:this.color,width:this.width,pts:[P(e)]};
    });
    this.cv.addEventListener('pointermove',e=>{
      if(!this.cur)return;
      const p=P(e);
      if(this.cur.tool==='pen')this.cur.pts.push(p);else this.cur.pts[1]=p;
      this.redraw(this.cur);
    });
    const end=()=>{
      if(!this.cur)return;
      if(this.cur.pts.length>1||this.cur.tool==='pen')this.strokes.push(this.cur);
      this.cur=null;this.redraw();
    };
    this.cv.addEventListener('pointerup',end);
    this.cv.addEventListener('pointercancel',end);
    window.addEventListener('resize',()=>{if($('drawDlg').open)this.fit()});
  },
  _norm(hex){return (hex||'').length===4?('#'+[...hex.slice(1)].map(c=>c+c).join('')):hex;},
  /* 開啟標註視窗：baseShot = 原始截圖；existing = 既有筆畫 */
  open(baseShot,existing,onApply){
    this.baseShot=baseShot;
    this.strokes=existing?JSON.parse(JSON.stringify(existing)):[];
    this.onApply=onApply;this.cur=null;
    const img=$('drawImg');
    img.onload=()=>{this.fit();centerDlg($('drawDlg'))};
    img.src=baseShot;
    $('drawDlg').showModal();
    if(img.complete)requestAnimationFrame(()=>{this.fit();centerDlg($('drawDlg'))});
  },
  fit(){
    const img=$('drawImg'),dlg=$('drawDlg');
    const nw=img.naturalWidth||16,nh=img.naturalHeight||9,ar=nw/nh;
    const portrait=ar<1;
    const barW=$('drawBar').scrollWidth||440;
    // 可用空間：扣掉對話框內距與標題列／工具列／按鈕列，等比縮放使圖完整落在範圍內
    const maxW=Math.max(160,innerWidth-80);
    const maxH=Math.max(150,innerHeight-(portrait?210:230));
    let w=maxW,h=w/ar;
    if(h>maxH){h=maxH;w=h*ar;}
    w=Math.round(w);h=Math.round(h);
    img.style.width=w+'px';img.style.height=h+'px';
    this.dpr=window.devicePixelRatio||1;
    this.cv.style.width=w+'px';this.cv.style.height=h+'px';
    this.cv.width=Math.round(w*this.dpr);this.cv.height=Math.round(h*this.dpr);
    dlg.style.width=(Math.max(w,barW)+32)+'px';
    dlg.style.maxWidth='96vw';
    this.redraw();
  },
  redraw(extra){
    const c=this.ctx;if(!c)return;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,this.cv.width,this.cv.height);
    c.scale(this.dpr,this.dpr);
    const W=this.cv.width/this.dpr,H=this.cv.height/this.dpr;
    (extra?this.strokes.concat([extra]):this.strokes).forEach(s=>this.paint(c,s,W,H));
  },
  paint(c,s,W,H){
    c.save();
    c.strokeStyle=s.color;c.fillStyle=s.color;
    c.lineWidth=s.width;c.lineCap='round';c.lineJoin='round';
    c.shadowColor='rgba(0,0,0,.35)';c.shadowBlur=3;
    const p=s.pts.map(q=>({x:q.x*W,y:q.y*H}));
    if(s.tool==='pen'){
      if(p.length<2){c.beginPath();c.arc(p[0].x,p[0].y,s.width/2,0,7);c.fill();c.restore();return}
      c.beginPath();c.moveTo(p[0].x,p[0].y);
      for(let i=1;i<p.length;i++)c.lineTo(p[i].x,p[i].y);
      c.stroke();
    }else if(p.length>1){
      const [a,b]=p;
      if(s.tool==='rect')c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
      else if(s.tool==='line'){
        c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      }
      else if(s.tool==='ellipse'){
        c.beginPath();
        c.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,7);
        c.stroke();
      }else if(s.tool==='arrow'){
        const ang=Math.atan2(b.y-a.y,b.x-a.x),hl=Math.max(12,s.width*3.2);
        // 線段收在箭頭底部，避免蓋住箭頭尖端
        c.beginPath();c.moveTo(a.x,a.y);
        c.lineTo(b.x-Math.cos(ang)*hl*.82,b.y-Math.sin(ang)*hl*.82);c.stroke();
        // 箭頭三角形
        c.beginPath();c.moveTo(b.x,b.y);
        c.lineTo(b.x-hl*Math.cos(ang-Math.PI/7),b.y-hl*Math.sin(ang-Math.PI/7));
        c.lineTo(b.x-hl*Math.cos(ang+Math.PI/7),b.y-hl*Math.sin(ang+Math.PI/7));
        c.closePath();c.fill();
      }
    }
    c.restore();
  },
  flatten(baseDataURL){
    if(!this.strokes.length)return Promise.resolve(baseDataURL);
    const strokes=this.strokes;
    return new Promise(res=>{
      const img=new Image();
      img.onload=()=>{
        const cv=document.createElement('canvas');
        cv.width=img.naturalWidth;cv.height=img.naturalHeight;
        const c=cv.getContext('2d');
        c.drawImage(img,0,0);
        const scale=Math.max(cv.width,cv.height)/800;
        strokes.forEach(s=>this.paint(c,{...s,width:Math.max(2,s.width*scale)},cv.width,cv.height));
        res(cv.toDataURL('image/jpeg',0.92));
      };
      img.onerror=()=>res(baseDataURL);
      img.src=baseDataURL;
    });
  }
};

/* ---------- 語言 & 主題 ---------- */
const I18N={
 zh:{changeVideo:'開啟影片',videoInfo:'影片資訊',hotkeys:'快捷鍵',export:'匯出報告',projPh:'請先輸入專案名稱',toggleTheme:'明亮／暗色',appearance:'外觀',language:'語言',info:'資訊',toolArrow:'箭頭',toolLine:'直線',toolRect:'矩形',toolEllipse:'橢圓',
  dropHere:'把影片拖到這裡，或',pickFile:'選擇影片檔案',dropNote:'支援 mp4 / mov / webm · 影片不會上傳到任何地方',
  play:'播放',pause:'暫停',markBtn:'修改此時間點',markList:'修改清單',markTitle:'修改此時間點',
  notePh:'修改備註，例如：字幕錯字「的→得」；3:42 音樂突然斷掉請補 fade',
  refLabel:'參考資料（選填）— 貼上網址按 Enter 加入，或上傳參考圖片',refUrlPh:'https://... 參考網址（按 Enter 加入）',
  uploadRef:'上傳參考圖片',draw:'標註',more:'（點擊查看完整內容）',dwTitle:'瀏覽器無法解碼此影片',dwBody:'檔案已成功載入（資訊與時間碼可正常使用），但此編碼瀏覽器不支援預覽。<br>常見於 Sony XAVC、ProRes、HEVC 10bit、MXF 等專業素材。<br><br>建議先轉成 H.264 MP4 代理檔再審片。',drawTitle:'截圖標註',applyDraw:'套用標註',marked:'已標註',goto:'跳到此時間點',del:'刪除',edit:'編輯',sev1:'必須修改',sev2:'建議修改',sev3:'僅提醒',cancel:'取消',save:'儲存',close:'關閉',
  emptyHint:'<span class="hk-hint">播放影片時按 <kbd>M</kbd> 或</span>點擊「修改此時間點」<br>就會在這裡建立時間點備註<br>建立後點擊項目可重新編輯與標註<br><br><span class="hk-hint">按 <kbd>?</kbd> 看全部快捷鍵</span>',
  hkPlay:'播放 / 暫停',hkSeek:'往後 5 秒 / 往前 5 秒',hkMark:'在此時間點加入修改',hkSpeed:'降低 / 提高播放速度',
  hkInfo:'顯示影片資訊',hkExport:'開啟匯出選單',hkNew:'開啟影片（清空目前清單）',hkHelp:'顯示本快捷鍵表',hkEsc:'關閉視窗 / 取消',hkSave:'（修改視窗內）儲存',
  tcLabel:'時間碼',noNote:'（無備註）',needName:'請先在左上角輸入「專案名稱」，才能匯出報告',noMarks:'目前沒有修改紀錄',
  pickVideo:'請選擇影片檔案',reportTitle:'審片回饋',itemsCount:'筆修改',analyzing:'解析中…',noVideo:'尚未載入影片',
  secGeneral:'一般資訊',secVideo:'視訊軌',secAudio:'音訊軌',
  fFile:'檔案名稱',fFormat:'封裝格式',fMime:'MIME 類型',fSize:'檔案大小',fDur:'影片長度',fOverall:'整體位元率',
  fCodec:'編碼格式',fProfile:'設定檔',fLevel:'層級',fRes:'解析度',fDar:'畫面比例',fOrient:'畫面方向',
  fFps:'畫面更新率',fFrames:'總影格數',fChroma:'色度取樣',fDepth:'位元深度',fVBitrate:'視訊位元率',
  fABitrate:'位元率',fSample:'取樣率',fChannels:'聲道數',fBits:'取樣位元數',fNoAudio:'此檔案沒有音訊軌',
  landscape:'橫式',portrait:'直式',mono:'單聲道',stereo:'立體聲',ch:'聲道',px:'像素',bit:'位元',approx:'約',
  measured:'實測',defaultVal:'預設值，播放一次即校正',onlyMp4:'深入解析僅支援 MP4／MOV 封裝',
  colNo:'編號',colTc:'時間碼',colSev:'等級',colNote:'修改備註',colRef:'參考資料',colShot:'截圖',refImg:'參考圖片',
  hintTitle:'提示',confirmTitle:'請確認',ok:'確定',pdfFail:'PDF 產出失敗：',xlsxFail:'Excel 元件載入失敗（lib/exceljs.min.js），請確認檔案完整後重新整理頁面',urlInvalid:'請輸入有效的網址（以 http(s):// 或 www. 開頭）',closeVideo:'影片已關閉，所有修改與資訊已清除',colorCustom:'自訂顏色',toolSize:'工具大小',drawText:'文字',textPh:'輸入標註文字…',closeVideoConfirm:'確定要關閉影片嗎？\n所有修改紀錄與專案名稱都會被清除。',fontFail:'PDF 字型檔載入失敗（fonts/fonts.js），請確認檔案完整後重新整理頁面',libFail:'匯出元件載入失敗（lib/ 資料夾），請確認檔案完整後重新整理頁面',preparing:'正在準備匯出…',
  replaceConfirm:'目前有 {n} 筆修改紀錄。\n開啟新影片會清空目前清單（已自動暫存，重新開啟原影片可恢復）。要繼續嗎？',
  restoreConfirm:'找到這支影片上次的 {n} 筆修改紀錄（{time}）。\n要恢復嗎？',restoreTitle:'恢復上次進度',restored:'已恢復 {n} 筆修改',
  lastSession:'上次未完成：{name}（{n} 筆修改，{time}）<br>重新開啟同一支影片即可恢復',
  deleted:'已刪除修改 #{n}',undo:'復原',unsavedWarn:'修改紀錄尚未匯出，確定要離開嗎？',
  hkFrame:'上一格 / 下一格',hkMarkNav:'跳到上一個 / 下一個修改點',hkJKL:'倒退 1 秒 / 暫停 / 播放（連按加速）',refImgLabel:'參考圖：'},
 en:{changeVideo:'Open Video',videoInfo:'Media Info',hotkeys:'Shortcuts',export:'Export',projPh:'Enter project name first',toggleTheme:'Light / Dark',appearance:'Appearance',language:'Language',info:'Info',toolArrow:'Arrow',toolLine:'Line',toolRect:'Rectangle',toolEllipse:'Ellipse',
  dropHere:'Drop a video here, or',pickFile:'Choose video file',dropNote:'mp4 / mov / webm · Nothing is uploaded anywhere',
  play:'Play',pause:'Pause',markBtn:'Add Note',markList:'Revision List',markTitle:'Add Revision Note',
  notePh:'Revision note, e.g. subtitle typo; music cuts abruptly at 3:42, please add a fade',
  refLabel:'Reference (optional) — paste a URL and press Enter, or upload an image',refUrlPh:'https://... reference URL (press Enter)',
  uploadRef:'Upload reference image',draw:'Markup',more:'(click to view full text)',dwTitle:'This browser cannot decode this video',dwBody:'The file loaded successfully (media info and timecode work), but this codec is not supported for playback.<br>Common with Sony XAVC, ProRes, HEVC 10-bit and MXF footage.<br><br>Transcode to an H.264 MP4 proxy for review.',drawTitle:'Screenshot Markup',applyDraw:'Apply',marked:'marked',goto:'Jump to time',del:'Delete',edit:'Edit',sev1:'Must Fix',sev2:'Suggested',sev3:'FYI',cancel:'Cancel',save:'Save',close:'Close',
  emptyHint:'<span class="hk-hint">Press <kbd>M</kbd> or</span> Tap "Add Note" while playing<br>to create a timecoded revision here<br>Click any item to edit or re-annotate<br><br><span class="hk-hint">Press <kbd>?</kbd> for all shortcuts</span>',
  hkPlay:'Play / Pause',hkSeek:'Back 5s / Forward 5s',hkMark:'Add note at current time',hkSpeed:'Decrease / Increase speed',
  hkInfo:'Show media info',hkExport:'Open export menu',hkNew:'Open video (clears list)',hkHelp:'Show this shortcut table',hkEsc:'Close dialog / cancel',hkSave:'(In note dialog) save',
  tcLabel:'Timecode',noNote:'(no note)',needName:'Please enter a Project Name (top-left) before exporting',noMarks:'No revisions yet',
  pickVideo:'Please choose a video file',reportTitle:'Review Feedback',itemsCount:'revisions',analyzing:'Analyzing…',noVideo:'No video loaded',
  secGeneral:'General',secVideo:'Video Track',secAudio:'Audio Track',
  fFile:'File Name',fFormat:'Format',fMime:'MIME Type',fSize:'File Size',fDur:'Duration',fOverall:'Overall Bit Rate',
  fCodec:'Format',fProfile:'Profile',fLevel:'Level',fRes:'Resolution',fDar:'Display Aspect Ratio',fOrient:'Orientation',
  fFps:'Frame Rate',fFrames:'Total Frames',fChroma:'Chroma Subsampling',fDepth:'Bit Depth',fVBitrate:'Video Bit Rate',
  fABitrate:'Bit Rate',fSample:'Sampling Rate',fChannels:'Channels',fBits:'Bit Depth',fNoAudio:'No audio track in this file',
  landscape:'Landscape',portrait:'Portrait',mono:'Mono',stereo:'Stereo',ch:'channels',px:'px',bit:'bit',approx:'approx.',
  measured:'measured',defaultVal:'default — plays once to calibrate',onlyMp4:'Deep parsing supports MP4/MOV only',
  colNo:'No.',colTc:'Timecode',colSev:'Severity',colNote:'Revision Note',colRef:'Reference',colShot:'Screenshot',refImg:'Reference image',
  hintTitle:'Notice',confirmTitle:'Please confirm',ok:'OK',pdfFail:'PDF export failed: ',xlsxFail:'Excel component failed to load (lib/exceljs.min.js). Make sure the file is intact and reload',urlInvalid:'Please enter a valid URL (starting with http(s):// or www.)',closeVideo:'Video closed. All revisions and info cleared',colorCustom:'Custom color',toolSize:'Tool size',drawText:'Text',textPh:'Enter annotation text…',closeVideoConfirm:'Close this video?\nAll revisions and the project name will be cleared.',fontFail:'Failed to load PDF fonts (fonts/fonts.js). Make sure the file is intact and reload',libFail:'Failed to load export component (lib/ folder). Make sure the files are intact and reload',preparing:'Preparing export…',
  replaceConfirm:'You have {n} revisions.\nOpening a new video clears the current list (it is auto-saved; reopen the original video to restore). Continue?',
  restoreConfirm:'Found {n} revisions from your last session on this video ({time}).\nRestore them?',restoreTitle:'Restore session',restored:'Restored {n} revisions',
  lastSession:'Unfinished session: {name} ({n} revisions, {time})<br>Reopen the same video to restore',
  deleted:'Deleted revision #{n}',undo:'Undo',unsavedWarn:'Revisions have not been exported. Leave anyway?',
  hkFrame:'Previous / next frame',hkMarkNav:'Jump to previous / next revision',hkJKL:'Back 1s / pause / play (repeat to speed up)',refImgLabel:'Reference image:'}
};
let LANG=localStorage.getItem('rr_lang')||'zh';
const T=(k,vars)=>{
  let s=(I18N[LANG]&&I18N[LANG][k])||I18N.zh[k]||k;
  if(vars)s=s.replace(/\{(\w+)\}/g,(m,n)=>vars[n]!=null?vars[n]:m);
  return s;
};
const SEV_KEYS=['sev1','sev2','sev3'];
const SEV_VALUES={zh:['必須修改','建議修改','僅提醒'],en:['Must Fix','Suggested','FYI']};
function sevLabel(canonical){ // canonical 一律存中文，顯示依語言
  const i=SEV_VALUES.zh.indexOf(canonical);
  return i<0?canonical:SEV_VALUES[LANG][i];
}
function applyLang(){
  document.documentElement.lang=LANG==='zh'?'zh-Hant':'en';
  document.title=LANG==='zh'?'REGARD：影片校稿工具，審片資料一看就懂':'REGARD — Video Review Tool, Clear at a Glance';
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.innerHTML=T(el.dataset.i18n)});
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{el.placeholder=T(el.dataset.i18nPh)});
  document.getElementById('langLabel').textContent=LANG==='zh'?'繁中':'EN';
  const pl=document.querySelector('#btnPlay span[data-i18n]');
  if(pl)pl.textContent=(typeof video!=='undefined'&&video&&!video.paused)?T('pause'):T('play');
  renderMarks();
  if(!currentFile)showLastSession();
  localStorage.setItem('rr_lang',LANG);
}
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  const ic=document.getElementById('themeIcon');
  if(ic)ic.setAttribute('href',t==='light'?'#i-sun':'#i-moon');
  localStorage.setItem('rr_theme',t);
}
document.addEventListener('DOMContentLoaded',()=>{
  applyTheme(localStorage.getItem('rr_theme')||'dark');
  Draw.init();
  applyLang();
  document.getElementById('btnTheme').onclick=()=>
    applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');
  // 統一關閉所有下拉浮層（點擊新選單時互斥，避免多個同時展開）
  const closeAllMenus=()=>{
    document.querySelectorAll('.dd-menu.show,.xsel.open,.sev-pop.show,.color-pop.show,.shape-wrap.open').forEach(el=>{el.classList.remove('show');el.classList.remove('open');});
  };
  window.closeAllMenus=closeAllMenus;
  const lm=document.getElementById('langMenu');
  document.getElementById('btnLang').onclick=e=>{e.stopPropagation();const willOpen=!lm.classList.contains('show');closeAllMenus();lm.classList.toggle('show',willOpen)};
  lm.addEventListener('click',e=>{
    const it=e.target.closest('.dd-item');if(!it)return;
    LANG=it.dataset.lang;lm.classList.remove('show');applyLang();
  });
  const markSel=()=>lm.querySelectorAll('.dd-item').forEach(x=>x.classList.toggle('sel',x.dataset.lang===LANG));
  markSel();
  document.getElementById('btnLang').addEventListener('click',markSel);
  // 全域：點擊下拉容器以外的地方就關閉所有浮層（含其他下拉，達成互斥）
  document.addEventListener('click',e=>{
    if(!e.target.closest('.dropdown')&&!e.target.closest('.xsel')&&!e.target.closest('.sev-custom')&&!e.target.closest('.color-wrap')&&!e.target.closest('.shape-wrap'))
      closeAllMenus();
  });

});

/* 彈窗：預設置中、標題列拖曳移動、位置記憶（localStorage） */
const DLG_POS_KEY='reviewroom_dlg_pos_v2';
function loadDlgPos(){try{return JSON.parse(localStorage.getItem(DLG_POS_KEY))||{}}catch(e){return {}}}
function saveDlgPos(d){try{
  if(!d.style.left||!d.style.top)return;          // 尚未定位完成 → 不要存空值
  const all=loadDlgPos();
  all[d.id]={left:d.style.left,top:d.style.top,width:d.style.width||'',height:d.style.height||''};
  localStorage.setItem(DLG_POS_KEY,JSON.stringify(all));
}catch(e){}}
function centerDlg(d){
  const saved=loadDlgPos()[d.id];
  const hasSaved=saved&&saved.left&&saved.top;   // 空字串視為沒存過
  if(hasSaved){
    if(saved.width)d.style.width=saved.width;
    if(saved.height)d.style.height=saved.height;
    const L=Math.min(Math.max(0,parseInt(saved.left)||0),Math.max(0,innerWidth-120));
    const T=Math.min(Math.max(0,parseInt(saved.top)||0),Math.max(0,innerHeight-80));
    d.style.left=L+'px';d.style.top=T+'px';
    return;
  }
  // 未存過 → 等版面算完再置中
  d.style.left='';d.style.top='';
  requestAnimationFrame(()=>{
    d.style.left=Math.max(0,(innerWidth-d.offsetWidth)/2)+'px';
    d.style.top=Math.max(0,(innerHeight-d.offsetHeight)/2)+'px';
  });
}
document.querySelectorAll('dialog').forEach(d=>{
  d.addEventListener('close',()=>saveDlgPos(d));
  const bar=d.querySelector('.dlg-drag');
  if(!bar)return;
  bar.addEventListener('pointerdown',e=>{
    if(e.target.closest('.dlg-x'))return;
    e.preventDefault();
    const sx=e.clientX-d.offsetLeft,sy=e.clientY-d.offsetTop;
    const move=ev=>{
      d.style.left=(ev.clientX-sx)+'px';
      d.style.top=Math.max(0,ev.clientY-sy)+'px';
    };
    const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);saveDlgPos(d)};
    addEventListener('pointermove',move);
    addEventListener('pointerup',up);
  });
  // 右下角 resize 也存檔
  let roReady=false;
  d.addEventListener('close',()=>{roReady=false});
  new ResizeObserver(()=>{if(!d.open)return;if(!roReady){roReady=true;return}saveDlgPos(d)}).observe(d);
});

/* 修改視窗：整體尺寸依影片比例自適應（直式窄、橫式寬），保持一般彈窗大小 */
function fitMarkDlg(){
  const d=$('markDlg'),shot=$('dlgShot');
  const aspect=(video.videoWidth||16)/(video.videoHeight||9);
  const portrait=aspect<1;
  let w,h;
  if(portrait){h=Math.min(260,innerHeight*0.32);w=h*aspect;}
  else{w=Math.min(360,innerWidth*0.3);h=w/aspect;}
  shot.style.width=Math.round(w)+'px';
  shot.style.height=Math.round(h)+'px';
  const saved=loadDlgPos()[d.id];
  if(!saved||!saved.width)d.style.width=Math.max(portrait?380:Math.round(w)+40,360)+'px';
}
addEventListener('resize',()=>{if($('markDlg').open)fitMarkDlg()});


/* ---- 自動暫存（IndexedDB）：依影片檔（名稱＋大小＋修改時間）記住修改清單，重新開啟同一支影片即可恢復 ---- */
const Store={
  _p:null,
  open(){
    if(!this._p)this._p=new Promise(res=>{
      try{
        const rq=indexedDB.open('regard',1);
        rq.onupgradeneeded=()=>rq.result.createObjectStore('sessions',{keyPath:'key'});
        rq.onsuccess=()=>res(rq.result);
        rq.onerror=()=>res(null);
      }catch(e){res(null)}
    });
    return this._p;
  },
  async run(mode,fn){
    const db=await this.open();if(!db)return null;
    return new Promise(res=>{
      let out=null;
      try{
        const tx=db.transaction('sessions',mode);
        const rq=fn(tx.objectStore('sessions'));
        rq.onsuccess=()=>{out=rq.result};
        tx.oncomplete=()=>res(out);
        tx.onerror=tx.onabort=()=>res(null);
      }catch(e){res(null)}
    });
  },
  get(key){return this.run('readonly',st=>st.get(key))},
  put(rec){return this.run('readwrite',st=>st.put(rec))},
  del(key){return this.run('readwrite',st=>st.delete(key))},
  all(){return this.run('readonly',st=>st.getAll()).then(r=>r||[])}
};
const MAX_SESSIONS=10;
const fileKey=f=>`${f.name}|${f.size}|${f.lastModified}`;
let saveTimer=null, dirty=false;
function fmtDateTime(ms){
  const d=new Date(ms),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function scheduleSave(){
  if(!currentFile)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveSession,400);
}
async function saveSession(){
  clearTimeout(saveTimer);
  if(!currentFile)return;
  const key=fileKey(currentFile);
  if(!marks.length){await Store.del(key);return;}
  await Store.put({key,name:currentFile.name,proj:$('projName').value,marks,savedAt:Date.now()});
  const all=await Store.all();
  all.sort((a,b)=>b.savedAt-a.savedAt).slice(MAX_SESSIONS).forEach(r=>Store.del(r.key));
}
/* 修改清單有變動：標記為未匯出並排程暫存 */
function marksChanged(){dirty=true;scheduleSave();}
async function showLastSession(){
  const el=$('lastSession');
  const all=await Store.all();
  const last=all.sort((a,b)=>b.savedAt-a.savedAt)[0];
  el.innerHTML=last?T('lastSession',{name:esc(last.name),n:last.marks.length,time:fmtDateTime(last.savedAt)}):'';
  el.style.display=last?'':'none';
}
/* 舊版暫存資料可能把「（無備註）」當成備註內容存下來 */
function normalizeMark(m){
  const empty=[I18N.zh.noNote,I18N.en.noNote];
  return {...m,note:empty.includes(m.note)?'':(m.note||''),refs:m.refs||[],strokes:m.strokes||[]};
}
$('projName').addEventListener('input',scheduleSave);
addEventListener('beforeunload',e=>{
  if(currentFile&&marks.length)saveSession();
  if(dirty&&marks.length){e.preventDefault();e.returnValue=T('unsavedWarn');}
});

/* ---- 載入影片 ---- */
let videoURL=null;
$('pickBtn').onclick=()=>$('fileInput').click();
$('btnChangeVideo').onclick=()=>$('fileInput').click();
$('btnCloseVideo').onclick=async()=>{
  // 防呆：確認後才關閉（避免誤觸直接清掉所有修改）
  if(await appConfirm(T('closeVideoConfirm')))closeVideo();
};
function resetVideoState(){
  clearTimeout(saveTimer);
  marks=[];dirty=false;renderMarks();
  $('projName').value='';$('projName').style.borderColor='';
  fpsSource='default';detectedFps=30;
  clearTimeout(window._decodeTimer);
  $('decodeWarn').classList.remove('show');
}
function releaseVideo(){
  try{video.pause();}catch(e){}
  video.removeAttribute('src');video.load();
  if(videoURL){URL.revokeObjectURL(videoURL);videoURL=null;}
}
async function closeVideo(){
  const f=currentFile;
  releaseVideo();
  currentFile=null;
  resetVideoState();
  if(f)await Store.del(fileKey(f));        // 使用者已確認清除 → 暫存一併刪除
  $('videoWrap').classList.remove('show');
  $('ctrlBar').classList.add('hide');
  dz.classList.remove('hide');
  showLastSession();
  showToast(T('closeVideo'));
}
$('fileInput').onchange=e=>{const f=e.target.files[0];e.target.value='';loadFile(f);};
const dz=$('dropzone');
dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag')};
dz.ondragleave=()=>dz.classList.remove('drag');
dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');loadFile(e.dataTransfer.files[0])};

const VIDEO_EXT=['mp4','mov','m4v','webm','mkv','avi','wmv','flv','mpg','mpeg','m2ts','mts','ts','3gp','3g2','ogv','ogg','mxf','vob','rm','rmvb','asf','f4v','divx','xvid','m2v','dv','mpe','qt','amv','svi','m4p','braw','r3d','avchd','insv'];
function isVideoFile(f){
  if(!f)return false;
  if(f.type&&f.type.startsWith('video'))return true;
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  return VIDEO_EXT.includes(ext);
}
function showDecodeWarn(){
  if(video.videoWidth>0)return;      // 其實能播就不顯示
  $('decodeWarn').classList.add('show');
}
async function loadFile(f){
  if(!isVideoFile(f))return appAlert(T('pickVideo'));
  if(currentFile&&marks.length){
    await saveSession();
    if(!await appConfirm(T('replaceConfirm',{n:marks.length})))return;
  }
  releaseVideo();
  resetVideoState();
  currentFile=f;
  videoURL=URL.createObjectURL(f);
  video.src=videoURL;
  // 偵測「有中繼資料但畫面解不出來」的情況（Sony XAVC / ProRes / HEVC 10bit 等）
  video.onerror=showDecodeWarn;
  window._decodeTimer=setTimeout(()=>{
    if(video.readyState<2||!video.videoWidth)showDecodeWarn();
  },2600);
  video.onloadeddata=()=>{
    clearTimeout(window._decodeTimer);
    if(video.videoWidth)$('decodeWarn').classList.remove('show');
  };
  video.onloadedmetadata=()=>{
    dz.classList.add('hide');
    $('videoWrap').classList.add('show');
    $('ctrlBar').classList.remove('hide');
    $('seek').max=Math.floor(video.duration*100);
    video.playbackRate=parseFloat($('speedSel').dataset.value);
    renderMarks();                   // 縮圖比例依影片尺寸
  };
  detectFpsFromFile(f);
  const saved=await Store.get(fileKey(f));
  if(f!==currentFile||!saved||!saved.marks||!saved.marks.length)return;
  const ok=await appConfirm(T('restoreConfirm',{n:saved.marks.length,time:fmtDateTime(saved.savedAt)}),T('restoreTitle'));
  if(f!==currentFile)return;
  if(ok){
    marks=saved.marks.map(normalizeMark).sort((a,b)=>a.t-b.t);
    $('projName').value=saved.proj||'';
    renderMarks();
    showToast(T('restored',{n:marks.length}));
  }else{
    await Store.del(fileKey(f));
  }
}

/* ---- 影格率：優先讀檔案本身（MP4/MOV），讀不到才在播放時實測 ---- */
let detectedFps=30, fpsSource='default';   // 'default' | 'file' | 'measured'
const STD_FPS=[23.976,24,25,29.97,30,47.952,48,50,59.94,60,100,119.88,120];
function snapFps(f){
  for(const s of STD_FPS)if(Math.abs(f-s)/s<0.004)return s;
  return Math.round(f*1000)/1000;
}
function setFps(f,src){
  detectedFps=snapFps(f);fpsSource=src;
  renderMarks();syncUIOnce();
}
async function detectFpsFromFile(f){
  try{
    const info=await probeMp4(f);
    const v=(info.tracks||[]).find(t=>t.handler==='vide'&&t.fps>5&&t.fps<300);
    if(v&&f===currentFile)setFps(v.fps,'file');
  }catch(e){}
}
// 被動 FPS 偵測：只在「使用者本來就在播放」時取樣，不主動播放、不影響畫面
(function(){
  let samples=[];
  function cb(now,meta){
    if(fpsSource!=='default'){samples=[];return;}
    if(!samples.length||meta.mediaTime>samples[samples.length-1])samples.push(meta.mediaTime);
    if(samples.length<25&&!video.paused){video.requestVideoFrameCallback(cb);return;}
    const d=[];for(let i=1;i<samples.length;i++)d.push(samples[i]-samples[i-1]);
    const valid=d.filter(x=>x>0.0005).sort((a,b)=>a-b);
    if(valid.length>5){
      const f=1/valid[Math.floor(valid.length/2)];
      if(f>5&&f<200)setFps(f,'measured');
    }
    samples=[];
  }
  video.addEventListener('play',()=>{
    samples=[];
    if(fpsSource==='default'&&video.requestVideoFrameCallback)video.requestVideoFrameCallback(cb);
  });
})();

/* ---- 播放控制 ---- */
$('btnPlay').onclick=togglePlay;
video.onclick=togglePlay;
function togglePlay(){
  if(!video.src)return;
  video.paused?video.play():video.pause();
}
function syncPlayBtn(){
  const paused=video.paused;
  $('playIcon').setAttribute('href',paused?'#i-play':'#i-pause');
  $('btnPlay').querySelector('span[data-i18n]').textContent=paused?T('play'):T('pause');
}
video.addEventListener('play',syncPlayBtn);
video.addEventListener('pause',syncPlayBtn);
video.addEventListener('ended',syncPlayBtn);
function seekBy(sec){
  if(!video.duration)return;
  video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+sec));
}
/* 逐格：停在目標影格的前 1/4 處，避免瀏覽器落在影格邊界顯示成前一格 */
function stepFrame(dir){
  if(!video.duration)return;
  video.pause();
  const idx=Math.floor(video.currentTime*detectedFps+1e-6)+dir;
  video.currentTime=Math.max(0,Math.min(video.duration,(idx+0.25)/detectedFps));
}
function jumpMark(dir){
  if(!marks.length)return;
  const now=video.currentTime,eps=0.5/detectedFps;
  const m=dir<0?[...marks].reverse().find(x=>x.t<now-eps):marks.find(x=>x.t>now+eps);
  if(m){video.pause();video.currentTime=m.t;}
}
$('btnBack').onclick=()=>seekBy(-5);
$('btnFwd').onclick=()=>seekBy(5);
let tcEditing=false;
/* 進度條：fill 寬度與圓點位置都用同一個 pct% 計算，保證圓點永遠對準 fill 右端 */
function setSeek(pct){
  pct=Math.max(0,Math.min(100,pct));
  $('seekFill').style.width=pct+'%';
  $('seekDot').style.left=pct+'%';
}
/* 用 rAF 更新，比 timeupdate（每 ~250ms）順很多 */
let _rafId=null,_lastTc='';
function tickUI(){
  if(!video.duration){_rafId=requestAnimationFrame(tickUI);return}
  const tc=fmt(video.currentTime);
  if(tc!==_lastTc&&!tcEditing){_lastTc=tc;$('timecode').value=tc;}
  const pct=video.currentTime/video.duration*100;
  $('seek').value=video.currentTime*100;
  setSeek(pct);
  _rafId=requestAnimationFrame(tickUI);
}
function startTick(){if(_rafId==null)_rafId=requestAnimationFrame(tickUI)}
function stopTick(){if(_rafId!=null){cancelAnimationFrame(_rafId);_rafId=null}}

video.addEventListener('play',startTick);
video.addEventListener('pause',()=>{stopTick();syncUIOnce()});
video.addEventListener('seeked',()=>{if(video.paused)syncUIOnce()});
video.addEventListener('loadedmetadata',syncUIOnce);
function syncUIOnce(){
  if(!video.duration)return;
  if(!tcEditing)$('timecode').value=fmt(video.currentTime);
  $('seek').value=video.currentTime*100;
  setSeek(video.currentTime/video.duration*100);
}
['change','pointerup','mouseup','touchend'].forEach(ev=>
  $('seek').addEventListener(ev,()=>setTimeout(()=>$('seek').blur(),0)));

$('seek').oninput=e=>{
  const t=e.target.value/100;
  video.currentTime=t;
  if(video.duration)$('seekFill').style.width=(t/video.duration*100)+'%';
  if(!tcEditing)$('timecode').value=fmt(t);
};

/* 時間碼可手動輸入跳轉 */
const tcEl=()=>$('timecode');
tcEl().addEventListener('focus',()=>{tcEditing=true;tcEl().select()});
tcEl().addEventListener('blur',()=>{tcEditing=false;applyTcInput()});
tcEl().addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='Enter'){e.preventDefault();applyTcInput();tcEl().blur();}
  if(e.key==='Escape'){e.preventDefault();tcEditing=false;tcEl().value=fmt(video.currentTime);tcEl().blur();}
});
function applyTcInput(){
  const raw=tcEl().value.trim();
  const p=raw.split(/[:.;]/).map(x=>parseInt(x,10));
  if(p.some(isNaN)||p.length<2){tcEl().value=fmt(video.currentTime);return}
  let h=0,m=0,s=0,f=0;
  if(p.length===2){m=p[0];s=p[1];}
  else if(p.length===3){h=p[0];m=p[1];s=p[2];}
  else{h=p[0];m=p[1];s=p[2];f=p[3];}
  let t=h*3600+m*60+s+(f||0)/detectedFps;
  t=Math.max(0,Math.min(video.duration||0,t));
  video.currentTime=t;
  tcEl().value=fmt(t);
  syncUIOnce();
}
xselInit('speedSel',v=>{video.playbackRate=parseFloat(v)});
$('btnMark').onclick=()=>{if(video.src)addMark()};

/* 快捷鍵：綁在 window 捕獲階段，任何按鈕聚焦都不會失效；一律 preventDefault 阻止按鍵落入控件 */
window.addEventListener('keydown',e=>{
  const tg=e.target;
  const inField=tg&&(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'||tg.isContentEditable);
  if(inField){
    // 修改視窗：不管焦點在哪個欄位，Ctrl/Cmd+Enter 一律儲存
    if($('markDlg').open&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('dlgSave').click();return;}
    // 標註視窗：Enter 直接套用（但顏色選單內的輸入框例外，避免輸入 HEX/RGB 就誤觸完成）
    if($('drawDlg').open&&e.key==='Enter'&&tg.tagName!=='TEXTAREA'){
      if(tg.closest&&tg.closest('#colorPop'))return;   // 顏色選單內輸入不觸發完成
      e.preventDefault();$('drawDone').click();
    }
    return;
  }
  // 標註視窗開啟時：Enter 套用、Esc 由原生處理
  if($('drawDlg').open){
    if(e.key==='Enter'){e.preventDefault();$('drawDone').click();}
    return;
  }
  // 對話框開啟時：只允許 Ctrl+Enter 儲存標記
  if($('markDlg').open){
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){$('dlgSave').click();}
    return;
  }
  if($('infoDlg').open||$('hkDlg').open)return; // Esc 由 dialog 原生處理
  if(video.paused===undefined)return;

  const k=e.key.toLowerCase();
  const handled=()=>{
    e.preventDefault();
    e.stopPropagation();
  };
  if(e.ctrlKey||e.metaKey)return;     // 保留瀏覽器／系統快捷鍵
  const has=!!video.src;
  if(k===' '&&has){handled();togglePlay();}
  else if(e.key==='ArrowLeft'&&has){handled();seekBy(-5);}
  else if(e.key==='ArrowRight'&&has){handled();seekBy(5);}
  else if(!e.shiftKey&&e.key===','&&has){handled();stepFrame(-1);}
  else if(!e.shiftKey&&e.key==='.'&&has){handled();stepFrame(1);}
  else if(e.shiftKey&&(e.key==='<'||e.key===',')&&has){handled();stepSpeed(-1);}
  else if(e.shiftKey&&(e.key==='>'||e.key==='.')&&has){handled();stepSpeed(1);}
  else if(e.key==='['&&has){handled();jumpMark(-1);}
  else if(e.key===']'&&has){handled();jumpMark(1);}
  else if(k==='j'&&!e.altKey&&has){handled();seekBy(-1);}
  else if(k==='k'&&!e.altKey&&has){handled();video.pause();}
  else if(k==='l'&&!e.altKey&&has){handled();if(video.paused)video.play();else stepSpeed(1);}
  else if(k==='m'&&!e.altKey&&has){handled();addMark();}
  else if(k==='i'&&!e.altKey&&currentFile){handled();showInfo();}
  else if(e.altKey&&k==='e'){handled();toggleExportMenu();}
  else if(e.altKey&&k==='n'){handled();$('fileInput').click();}
  else if(e.key==='?'){handled();$('hkDlg').showModal();centerDlg($('hkDlg'));}
},true); // capture: 比 document 層級任何 focus 都優先

const SPEEDS=[0.5,1,1.25,1.5,2];
function stepSpeed(dir){
  const cur=parseFloat($('speedSel').dataset.value);
  let idx=SPEEDS.indexOf(cur);if(idx<0)idx=1;
  idx=Math.min(SPEEDS.length-1,Math.max(0,idx+dir));
  $('speedSel').setValue(String(SPEEDS[idx]));
  video.playbackRate=SPEEDS[idx];
}
// 按鈕點擊後把焦點還給 body，避免 Enter/空白誤觸按鈕
document.addEventListener('click',e=>{
  if(e.target.tagName==='BUTTON')e.target.blur();
});

/* 專業時間碼 HH:MM:SS:FF（最後一段為影格而非百分秒） */
function fmt(t){
  t=Math.max(0,t||0);
  const h=String(Math.floor(t/3600)).padStart(2,'0'),
        m=String(Math.floor(t%3600/60)).padStart(2,'0'),
        s=String(Math.floor(t%60)).padStart(2,'0');
  const ff=String(Math.min(Math.round(detectedFps)-1,Math.floor((t%1)*detectedFps+1e-6))).padStart(2,'0');
  return `${h}:${m}:${s}:${ff}`;
}
function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function proj(){return $('projName').value.trim()||T('reportTitle')}
function exportName(){return `${proj()}_${todayStr()}_Feedback`}
function grabFrame(){
  const c=document.createElement('canvas');
  c.width=video.videoWidth;c.height=video.videoHeight;
  c.getContext('2d').drawImage(video,0,0);
  return c.toDataURL('image/jpeg',0.85);
}

/* ---- 標記 + 參考資料 ---- */
function renderPendingRefs(){
  $('refArea').innerHTML=pendingRefs.map((r,i)=>r.type==='url'
    ?`<div class="ref-item"><svg class="ic" style="width:12px;height:12px"><use href="#i-link"/></svg><a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a><button class="ref-rm" data-i="${i}"><svg class="ic" style="width:11px;height:11px"><use href="#i-close"/></svg></button></div>`
    :`<div class="ref-item"><img class="ref-thumb" src="${r.dataURL}" alt=""><span class="ref-name">${esc(r.name||T('refImg'))}</span><button class="ref-rm" data-i="${i}"><svg class="ic" style="width:11px;height:11px"><use href="#i-close"/></svg></button></div>`
  ).join('');
  const ra=$('refArea');
  // 保險：只有當參考內容真的超出預覽高度時才允許滾動（平常 overflow:hidden，完全無滾動條）
  requestAnimationFrame(()=>{ ra.style.overflowY = ra.scrollHeight>ra.clientHeight+2 ? 'auto':'hidden'; });
  $('refArea').querySelectorAll('.ref-rm').forEach(b=>b.onclick=()=>{pendingRefs.splice(+b.dataset.i,1);renderPendingRefs()});
}
$('dlgRefUrl').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim();
    if(!v){e.preventDefault();return;}
    if(!/^https?:\/\//i.test(v)&&!/^www\./i.test(v)){   // 必須是網址
      e.preventDefault();
      e.target.style.borderColor='#ff5d5d';
      const err=$('refErr'); err.textContent=T('urlInvalid')||'請輸入有效的網址（以 http(s):// 或 www. 開頭）';
      err.style.display='block';
      setTimeout(()=>{err.style.display='none';},2600);
      return;
    }
    e.preventDefault();
    let url=v; if(/^www\./i.test(url))url='https://'+url;
    pendingRefs.push({type:'url',url});
    e.target.value='';e.target.style.borderColor='';$('refErr').style.display='none';renderPendingRefs();
  }
});
$('dlgRefPick').onclick=()=>$('dlgRefFile').click();
$('dlgRefFile').onchange=e=>{
  [...e.target.files].forEach(f=>{
    const rd=new FileReader();
    rd.onload=async()=>{pendingRefs.push({type:'img',dataURL:await toPdfSafeImage(rd.result),name:f.name});renderPendingRefs()};
    rd.readAsDataURL(f);
  });
  e.target.value='';
};

/* PDF / Excel 只吃 PNG、JPEG：其他格式（WebP、GIF…）先轉成 PNG */
function toPdfSafeImage(dataURL){
  if(/^data:image\/(png|jpe?g)/.test(dataURL))return Promise.resolve(dataURL);
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      const c=document.createElement('canvas');
      c.width=im.naturalWidth;c.height=im.naturalHeight;
      c.getContext('2d').drawImage(im,0,0);
      res(c.toDataURL('image/png'));
    };
    im.onerror=()=>res(dataURL);
    im.src=dataURL;
  });
}
const imgFormat=dataURL=>dataURL.startsWith('data:image/png')?'PNG':'JPEG';

let editIndex=-1;          // -1 = 新增，>=0 = 編輯第 n 筆
let pendingBase=null;      // 未標註的原始截圖
let pendingStrokes=[];     // 目前標註筆畫

function openMarkDlg(){
  $('markDlg').showModal();
  $('dlgShot').src=pendingShot;
  updateDrawFlag();
  fitMarkDlg();
  requestAnimationFrame(()=>centerDlg($('markDlg')));
  // 參考連結輸入框只是「暫存輸入」，沒按 Enter 就不算數：每次開窗一律清空，
  // 否則上次打到一半的網址會殘留到下一筆修改
  const ru=$('dlgRefUrl');
  if(ru){ru.value='';ru.style.borderColor='';}
  $('refErr').style.display='none';
  renderPendingRefs();
  $('dlgNote').focus();
}
function updateDrawFlag(){
  $('btnDraw').classList.toggle('active',pendingStrokes.length>0);
}
function addMark(){
  editIndex=-1;
  pendingT=video.currentTime;
  video.pause();
  pendingBase=grabFrame();
  pendingShot=pendingBase;
  pendingStrokes=[];
  pendingRefs=[];
  $('dlgRefUrl').value='';$('dlgRefUrl').style.borderColor='';$('refErr').style.display='none';
  $('dlgTc').textContent=T('tcLabel')+' '+fmt(pendingT);
  $('dlgNote').value='';
  document.querySelector('input[name=sev][value="必須修改"]').checked=true;
  $('dlgSave').querySelector('span').textContent=T('save');
  openMarkDlg();
}
function editMark(i){
  const m=marks[i];
  editIndex=i;
  pendingT=m.t;
  pendingBase=m.base||m.shot;
  pendingStrokes=m.strokes?JSON.parse(JSON.stringify(m.strokes)):[];
  pendingShot=m.shot;
  pendingRefs=m.refs?JSON.parse(JSON.stringify(m.refs)):[];
  $('dlgTc').textContent=T('tcLabel')+' '+fmt(m.t);
  $('dlgNote').value=m.note||'';
  const radio=document.querySelector(`input[name=sev][value="${m.sev}"]`);
  if(radio)radio.checked=true;
  $('dlgSave').querySelector('span').textContent=T('save');
  openMarkDlg();
}
// 標註按鈕 → 開獨立大彈窗
$('btnDraw').onclick=()=>{
  Draw.open(pendingBase,pendingStrokes,(flat,has)=>{
    pendingShot=flat;
    pendingStrokes=JSON.parse(JSON.stringify(Draw.strokes));
    $('dlgShot').src=flat;
    updateDrawFlag();
    fitMarkDlg();
  });
};
$('dlgCancel').onclick=()=>$('markDlg').close();
$('dlgSave').onclick=()=>{
  const note=$('dlgNote').value.trim();
  const sev=document.querySelector('input[name=sev]:checked').value;
  const rec={t:pendingT,note,sev,
             shot:pendingShot,base:pendingBase,strokes:pendingStrokes,refs:[...pendingRefs]};
  if(editIndex>=0)marks[editIndex]=rec;
  else marks.push(rec);
  marks.sort((a,b)=>a.t-b.t);
  editIndex=-1;
  marksChanged();
  renderMarks();
  $('markDlg').close();
};

/* ---- 清單 ---- */
const SEVCOLOR={'必須修改':'#ff5d5d','建議修改':'#ffb020','僅提醒':'#4f8cff'};
const SEVHEX={'必須修改':'FF5D5D','建議修改':'FFB020','僅提醒':'4F8CFF'};
function renderMarks(){
  const vw=video.videoWidth||16,vh=video.videoHeight||9,ar=vw/vh;
  const THUMB=ar>=1?{w:96,h:Math.round(96/ar)}:{w:Math.round(96*ar),h:96};
  $('markCount').textContent=marks.length;
  const list=$('markList');
  if(!marks.length){list.innerHTML='<div class="empty-hint">'+T('emptyHint')+'</div>';return}
  list.innerHTML='';
  marks.forEach((mk,i)=>{
    const card=document.createElement('div');card.className='mark-card';
    const refHtml=mk.refs.map(r=>r.type==='url'
      ?`<a class="mark-ref" href="${esc(r.url)}" target="_blank" onclick="event.stopPropagation()">${esc(r.url)}</a>`:'').join('');
    const hasRefImg=mk.refs.some(r=>r.type==='img');
    card.innerHTML=`<div class="mark-thumb-wrap">
        <img class="mark-thumb" style="width:${THUMB.w}px;height:${THUMB.h}px" src="${mk.shot}">
        ${hasRefImg?`<span class="ref-badge">${T('refImg')}</span>`:''}
        ${(mk.strokes&&mk.strokes.length)?`<span class="draw-flag"><svg class="ic" style="width:9px;height:9px"><use href="#i-pen"/></svg>${T('marked')}</span>`:''}
      </div>
      <div class="mark-body">
        <div class="mark-tc">#${i+1} · ${fmt(mk.t)}</div>
        <div class="mark-note${mk.note?'':' empty'}">${esc(mk.note||T('noNote'))}</div>
        ${mk.note.length>110?`<div class="mark-more">${T('more')}</div>`:''}
        ${refHtml}
        <div class="sev-custom" data-sev="${mk.sev}">
          <button type="button" class="sev-btn"><span class="dot-r" style="background:${SEVCOLOR[mk.sev]}"></span><span class="sev-txt">${sevLabel(mk.sev)}</span><svg class="ic sev-caret"><use href="#i-caret"/></svg></button>
          <div class="sev-pop">
            ${SEV_VALUES.zh.map(s=>`<div class="sev-opt" data-v="${s}" style="--dc:${SEVCOLOR[s]}"><span class="dot-r" style="background:${SEVCOLOR[s]}"></span>${sevLabel(s)}</div>`).join('')}
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px">
        <button class="mark-goto" title="${T('goto')}"><svg class="ic" style="width:13px;height:13px"><use href="#i-play"/></svg></button>
        <button class="mark-del" title="${T('del')}"><svg class="ic" style="width:13px;height:13px"><use href="#i-trash"/></svg></button>
      </div>`;
    card.onclick=e=>{
      if(e.target.closest('.mark-del')||e.target.closest('.mark-goto')||e.target.closest('.sev-custom'))return;
      video.currentTime=mk.t;
      editMark(i);                       // 點卡片 → 重新編輯（可重新標註）
    };
    card.querySelector('.mark-goto').onclick=ev=>{ev.stopPropagation();video.currentTime=mk.t;};
    card.querySelector('.mark-del').onclick=ev=>{ev.stopPropagation();deleteMark(i);};
    // 自定義等級選單（取代原生 select，統一為本風格）
    const sevBox=card.querySelector('.sev-custom');
    const sevBtn=sevBox.querySelector('.sev-btn');
    const sevPop=sevBox.querySelector('.sev-pop');
    const syncSev=v=>{mk.sev=v;marksChanged();sevBox.dataset.sev=v;sevBox.querySelector('.sev-txt').textContent=sevLabel(v);sevBox.querySelector('.dot-r').style.background=SEVCOLOR[v];sevPop.querySelectorAll('.sev-opt').forEach(o=>o.classList.toggle('sel',o.dataset.v===v));};
    // 渲染當下就把目前等級打勾，避免開啟選單時既有選項沒有勾記
    sevPop.querySelectorAll('.sev-opt').forEach(o=>o.classList.toggle('sel',o.dataset.v===mk.sev));
    sevBtn.onclick=e=>{
      e.stopPropagation();
      // 先記住原本狀態，再關閉全部浮層，否則自己的 show 會被清掉導致再點無法收合
      const willOpen=!sevPop.classList.contains('show');
      window.closeAllMenus&&window.closeAllMenus();
      // 先收起其他所有選單，並還原它們卡片的 z-index（避免從下往上點時 z-index 殘留導致壓層錯亂）
      document.querySelectorAll('.sev-pop.show').forEach(x=>{if(x!==sevPop)x.classList.remove('show');});
      document.querySelectorAll('.mark-card').forEach(c=>{if(c!==card)c.style.zIndex='';});
      sevPop.classList.toggle('show',willOpen);
      const open=willOpen;
      // 開啟時把所屬卡片提到最上層，避免被下一張卡片壓住
      card.style.position='relative';
      card.style.zIndex=open?'50':'';
      if(open){
        // 方向判斷：若下方空間不夠，改為顯示在按鈕上方
        const r=sevBtn.getBoundingClientRect();
        const ph=sevPop.offsetHeight||120;
        if(r.bottom+ph>window.innerHeight-6){
          sevPop.style.top='auto';
          sevPop.style.bottom='calc(100% + 5px)';
        }else{
          sevPop.style.top='calc(100% + 5px)';
          sevPop.style.bottom='auto';
        }
      }
    };
    sevPop.querySelectorAll('.sev-opt').forEach(o=>o.onclick=ev=>{ev.stopPropagation();syncSev(o.dataset.v);sevPop.classList.remove('show');card.style.zIndex='';});
    list.appendChild(card);
  });
}
/* 刪除後可在提示中復原 */
function deleteMark(i){
  const [removed]=marks.splice(i,1);
  marksChanged();renderMarks();
  showToast(T('deleted',{n:i+1}),{label:T('undo'),fn:()=>{
    marks.push(removed);marks.sort((a,b)=>a.t-b.t);
    marksChanged();renderMarks();
  }});
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));



/* ---- 匯出選單 ---- */
function toggleExportMenu(force){const m=$('exportMenu');if(typeof force==='boolean')m.classList.toggle('show',force);else m.classList.toggle('show')}
$('btnExport').onclick=e=>{e.stopPropagation();const willOpen=!$('exportMenu').classList.contains('show');closeAllMenus();toggleExportMenu(willOpen)};
document.addEventListener('click',e=>{if(!e.target.closest('.dropdown'))$('exportMenu').classList.remove('show')});
document.addEventListener('click',()=>document.querySelectorAll('.sev-pop.show').forEach(p=>{p.classList.remove('show');const c=p.closest('.mark-card');if(c)c.style.zIndex='';}));
$('exportMenu').addEventListener('click',e=>{
  const item=e.target.closest('.dd-item');if(!item)return;
  if(!marks.length){$('exportMenu').classList.remove('show');return appAlert(T('noMarks'))}
  // 專案名稱強制輸入（防呆）
  const nameInput=$('projName');
  if(!nameInput.value.trim()){
    $('exportMenu').classList.remove('show');
    nameInput.style.borderColor='var(--danger)';
    nameInput.focus();
    return appAlert(T('needName'));
  }
  nameInput.style.borderColor='';
  $('exportMenu').classList.remove('show');
  ({pdf:exportPdf,xlsx:exportXlsx})[item.dataset.fmt]();
});

function downloadBlob(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);
}

/* ---- PDF：jsPDF + 內嵌中文字型（真文字，可選取/搜尋），showSaveFilePicker 指定檔名 ---- */
function showToast(msg,action){
  let t=$('appToast');
  if(!t){t=document.createElement('div');t.id='appToast';document.body.appendChild(t);}
  t.innerHTML='';
  const txt=document.createElement('span');txt.textContent=msg;t.appendChild(txt);
  if(action){
    const b=document.createElement('button');b.type='button';b.textContent=action.label;
    b.onclick=()=>{t.classList.remove('show');action.fn();};
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.remove('show'),action?5000:2200);
}
/* 匯出元件（jsPDF / ExcelJS / 字型）體積大，只在匯出時才載入 */
const _scripts={};
function loadScript(src){
  if(!_scripts[src])_scripts[src]=new Promise((res,rej)=>{
    const el=document.createElement('script');
    el.src=src;el.onload=res;
    el.onerror=()=>{delete _scripts[src];el.remove();rej(new Error(src));};
    document.head.appendChild(el);
  });
  return _scripts[src];
}
async function saveAs(blob,name){
  if(window.showSaveFilePicker){
    try{
      const ext=name.split('.').pop();
      const fh=await showSaveFilePicker({suggestedName:name,
        types:[{description:ext.toUpperCase(),accept:{[blob.type||'application/octet-stream']:['.'+ext]}}]});
      const ws=await fh.createWritable();
      await ws.write(blob);await ws.close();
      return true;
    }catch(e){
      if(e.name==='AbortError')return false;
    }
  }
  downloadBlob(blob,name); // fallback：一般下載（檔名同樣正確）
  return true;
}
async function exportPdf(){
  showToast(T('preparing'));
  try{await loadScript('lib/jspdf.umd.min.js');}catch(e){return appAlert(T('libFail'));}
  try{await loadScript('fonts/fonts.js');}catch(e){return appAlert(T('fontFail'));}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
  const PW=doc.internal.pageSize.getWidth(),PH=doc.internal.pageSize.getHeight();
  const M=17, CW=PW-M*2;
  const hasCJK=s=>/[㐀-鿿豈-﫿＀-￯]/.test(s);
  // 易讀字型：中文 Noto Sans TC（黑體）、拉丁 Inter（現代無襯線）
  // 目標是「方便別人閱讀」，不是精品裝飾風，所以全部採用高易讀性的無襯線字型
  // 字型已內嵌於 fonts/fonts.js（window.REGARD_FONTS），完全離線可用（含 file:// 雙擊開啟）
  // jsPDF 會自動只子集化用到的字，PDF 體積不會爆增；文字皆為可選取/搜尋的真文字
  // 關鍵：每次匯出都會 new 一個新 doc，所以字型必須「每次都註冊進當下的 doc」，
  //       否則第二次匯出（新 doc）沒有字型 → 中文變亂碼。
  // 註：normal / bold 各自使用獨立字型檔，確保粗體是真的粗體（非合成）。
  const FONT_B64={
    NotoSansTC:()=>window.REGARD_FONTS&&window.REGARD_FONTS.NotoSansTC,
    NotoSansTCBold:()=>window.REGARD_FONTS&&window.REGARD_FONTS.NotoSansTCBold,
    Inter:()=>window.REGARD_FONTS&&window.REGARD_FONTS.Inter,
    InterBold:()=>window.REGARD_FONTS&&window.REGARD_FONTS.InterBold
  };
  function ensureFonts(){
    try{
      const defs=[
        ['NotoSansTC.ttf','NotoSansTC','NotoSansTC','normal'],
        ['NotoSansTCBold.ttf','NotoSansTCBold','NotoSansTC','bold'],
        ['Inter.ttf','Inter','Inter','normal'],
        ['InterBold.ttf','InterBold','Inter','bold']
      ];
      for(const [vfs,key,alias,style] of defs){
        const b64=FONT_B64[key]();
        if(!b64)throw new Error('font '+key+' missing');
        doc.addFileToVFS(vfs,b64);
        doc.addFont(vfs,alias,style);
      }
      return true;
    }catch(e){return false;}
  }
  // 字型選擇：含中文→Noto Sans TC（黑體，易讀）；純拉丁→Inter（現代無襯線，數字/符號清晰）
  function setCN(style,size){doc.setFont('NotoSansTC',style||'normal');doc.setFontSize(size);}
  function setLat(style,size){doc.setFont('Inter',style||'normal');doc.setFontSize(size);}
  function setBody(style,size){doc.setFont('Inter',style||'normal');doc.setFontSize(size);}
  function setF(text,style,size){
    if(hasCJK(text))setCN(style,size);else setLat(style,size);
  }
  const LH=6.1;   // 備註行高（mm），留白更舒適
  // 快速換行：jsPDF 原生 splitTextToSize 對內嵌中文字型是 O(n²) 會卡死，改為逐字估算寬度
  function wrapText(text,maxWmm,fsPt){
    const chars=Array.from(text||'');
    const lines=[];let cur='';let w=0;
    for(const ch of chars){
      let cw;
      if(hasCJK(ch)){cw=fsPt*0.36;}                 // CJK 全形約 1em（襯線略寬）
      else if(ch==='\n'){lines.push(cur);cur='';w=0;continue;}
      else{cw=doc.getTextWidth(ch);}                   // 拉丁/數字/符號用 jsPDF 量
      if(w+cw>maxWmm && cur!==''){lines.push(cur);cur=ch;w=cw;}
      else{cur+=ch;w+=cw;}
    }
    if(cur!=='')lines.push(cur);
    return lines.length?lines:[''];
  }
  const px2mm=px=>px*0.2646;
  const SEVRGB={'必須修改':[209,60,50],'建議修改':[196,124,20],'僅提醒':[60,110,190]};
  const GOLD=[154,123,72], INK=[29,29,31], GREY=[134,134,139], HAIR=[224,222,217];

  try{
    if(!ensureFonts())return appAlert(T('fontFail'));
    let y=M;
    const drawWatermark=()=>{
      try{
        const wmW=30,wmH=wmW/REGARD_LOGO_AR;
        doc.saveGraphicsState();
        if(doc.GState)doc.setGState(new doc.GState({opacity:0.055}));
        doc.addImage(REGARD_LOGO,'PNG',PW-wmW-9,PH-wmH-11,wmW,wmH,'REGARDWM','FAST');
        doc.restoreGraphicsState();
      }catch(e){}
    };

    // 標題區（精品留白）
    const projName=proj().trim()||T('reportTitle');
    setF(projName,'bold',26);doc.setTextColor(...INK);
    doc.text(projName,M,y+9);y+=15;
    setBody('normal',11);doc.setTextColor(...GREY);
    const dateStr=todayStr().replace(/(\d{4})(\d{2})(\d{2})/,'$1.$2.$3');
    if(LANG==='zh'){
      setCN('normal',10);
      doc.text(T('reportTitle')+'　·　共 '+marks.length+' 筆修改　·　'+dateStr,M,y+3.4);
    }else{
      setBody('normal',11);
      doc.text('REVIEW FEEDBACK   ·   '+marks.length+' ITEMS   ·   '+dateStr.toUpperCase(),M,y+3.4);
    }
    y+=11;

    // 等級統計（三種嚴重度固定並排，間距舒適，必顯示，皆為真文字）
    const cnt={};SEV_VALUES.zh.forEach(k=>cnt[k]=0);marks.forEach(m=>{if(cnt[m.sev]===undefined)cnt[m.sev]=0;cnt[m.sev]++;});
    let cx=M;
    for(let i=0;i<SEV_VALUES.zh.length;i++){
      const k=SEV_VALUES.zh[i];
      const rgb=SEVRGB[k];
      doc.setFillColor(rgb[0],rgb[1],rgb[2]);
      doc.circle(cx+1.7,y-1.0,1.15,'F');
      const label=sevLabel(k)+'  '+cnt[k];
      setCN('normal',9.5);doc.setTextColor(...GREY);
      doc.text(label,cx+4.6,y+0.8);
      cx+=doc.getTextWidth(label)+7;
    }
    y+=9;
    doc.setDrawColor(...HAIR);doc.setLineWidth(.22);
    doc.line(M,y,PW-M,y);y+=9;

    const vAsp=(video.videoWidth&&video.videoHeight)?video.videoHeight/video.videoWidth:9/16;
    const portrait=vAsp>1;
    const shotW=portrait?36:62;                 // mm
    const shotH=shotW*vAsp;
    const gap=8;
    const textX=M+shotW+gap, textW=PW-M-textX;

    for(let i=0;i<marks.length;i++){
      const m=marks[i];
      const rgb=SEVRGB[m.sev]||SEVRGB['僅提醒'];
      setCN('normal',11);
      const tc=fmt(m.t);
      const noteLines=wrapText(m.note||T('noNote'), textW, 11);
      const noteH=noteLines.length*LH;
      const urlRefs=m.refs.filter(r=>r.type==='url');
      const imgRefs=m.refs.filter(r=>r.type==='img');
      const refH=urlRefs.length?(urlRefs.length*5.2+4):0;
      const rowH=Math.max(shotH,10+noteH+refH)+10;
      if(y+rowH>PH-M-6){doc.addPage();y=M;}

      // 截圖
      try{doc.addImage(m.shot,'JPEG',M,y,shotW,shotH,undefined,'FAST');}catch(err){}
      doc.setDrawColor(...HAIR);doc.setLineWidth(.2);
      doc.roundedRect(M,y,shotW,shotH,1.8,1.8,'S');

      // 編號 + 時間碼 + 等級
      setLat('bold',12);doc.setTextColor(...INK);
      doc.text(tc,textX,y+4.6);
      const tcW=doc.getTextWidth(tc);
      doc.setFillColor(rgb[0],rgb[1],rgb[2]);
      doc.circle(textX+tcW+5.5,y+3.6,1.15,'F');
      const sevTxt=sevLabel(m.sev);
      setCN('bold',9);doc.setTextColor(rgb[0],rgb[1],rgb[2]);
      doc.text(sevTxt,textX+tcW+8.2,y+4.8);
      setBody('normal',8);doc.setTextColor(...GREY);
      doc.text('#'+(i+1),PW-M,y+4.4,{align:'right'});

      // 備註（真文字，自動換行，行距舒適）
      let ty=y+10;
      setCN('normal',11);doc.setTextColor(...INK);
      doc.text(noteLines,textX,ty+3.2);ty+=noteLines.length*LH;
      // 參考網址（可點擊）
      if(urlRefs.length){
        ty+=3;
        setBody('normal',9.5);
        urlRefs.forEach(r=>{
          doc.setTextColor(...GOLD);
          const disp=r.url.length>88?r.url.slice(0,86)+'…':r.url;
          doc.textWithLink(disp,textX,ty+3,{url:r.url});
          const uw=doc.getTextWidth(disp);
          doc.setDrawColor(...GOLD);doc.setLineWidth(.15);
          doc.line(textX,ty+3.9,textX+uw,ty+3.9);
          ty+=5.2;
        });
      }
      // 參考圖片
      for(const r of imgRefs){
        const dim=await imgDim(r.dataURL);
        const rw=Math.min(34,textW),rh=rw*dim.h/dim.w;
        if(ty+rh>PH-M){doc.addPage();y=M;ty=y;}
        try{doc.addImage(r.dataURL,imgFormat(r.dataURL),textX,ty+2,rw,rh,undefined,'FAST');}catch(err){}
        doc.setDrawColor(...HAIR);doc.roundedRect(textX,ty+2,rw,rh,1.2,1.2,'S');
        ty+=rh+3;
      }

      y=Math.max(y+shotH,ty)+8;
      doc.setDrawColor(...HAIR);doc.setLineWidth(.15);
      doc.line(M,y,PW-M,y);
    }

    const total=doc.internal.getNumberOfPages();
    for(let p=1;p<=total;p++){
      doc.setPage(p);
      drawWatermark();
      // 左下角品牌標準字：與頁首左上角一致（REGARD / THE ART OF PERSPECTIVE），且透明度同右上方 LOGO 浮水印
      try{
        doc.saveGraphicsState();
        if(doc.GState)doc.setGState(new doc.GState({opacity:0.055}));
        setBody('bold',9.5);doc.setTextColor(...GOLD);
        doc.text('REGARD',M,PH-10.5);
        setBody('normal',5.5);doc.setTextColor(...GREY);
        doc.text('THE ART OF PERSPECTIVE',M,PH-7.2);
        doc.restoreGraphicsState();
      }catch(e){}
      setBody('normal',8);doc.setTextColor(...GREY);
      doc.text(String(p)+' / '+total,PW-M,PH-8,{align:'right'});
    }
    if(await saveAs(doc.output('blob'),exportName()+'.pdf'))dirty=false;
  }catch(e){
    appAlert(T('pdfFail')+e.message);
  }
}

/* ---- Excel：圖片保持 16:9 原比例（依影片實際寬高比計算） ---- */
// ExcelJS 瀏覽器版的 addImage 不支援 base64 字串（會報 Unsupported media），
  // 統一改用 buffer（Uint8Array）方式加入圖片
  const xlsAddImg=async(wb,dataURL,ext)=>{
    if(!dataURL||!String(dataURL).startsWith('data:'))return null;
    try{
      const b64=dataURL.substring(dataURL.indexOf(',')+1);
      const bin=atob(b64);const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      return wb.addImage({buffer:bytes,extension:ext});
    }catch(e){return null;}
  };
async function exportXlsx(){
  showToast(T('preparing'));
  try{await loadScript('lib/exceljs.min.js');}catch(e){return appAlert(T('xlsxFail'));}
  const wb=new ExcelJS.Workbook();
  wb.creator='REGARD';
  const ws=wb.addWorksheet(T('reportTitle'));
  const landscape=video.videoWidth>=video.videoHeight;
  const IMG_W=landscape?400:230;
  const aspect=(video.videoWidth&&video.videoHeight)?video.videoHeight/video.videoWidth:9/16;
  const imgH=Math.round(IMG_W*aspect);
  const REF_W=190;
  ws.columns=[
    {header:T('colNo'),key:'n',width:6},
    {header:T('colTc'),key:'tc',width:15},
    {header:T('colSev'),key:'sev',width:13},
    {header:T('colNote'),key:'note',width:52},
    {header:T('colRef'),key:'refs',width:Math.ceil(REF_W/7)},
    {header:T('colShot'),key:'shot',width:Math.ceil(IMG_W/7)}
  ];
  // 品牌標題列（第 1 列）：REGARD 標誌 + 專案名
  ws.spliceRows(1,0,[]);
  ws.getRow(1).height=46;
  ws.mergeCells('A1:F1');
  const brandCell=ws.getCell('A1');
  brandCell.value={richText:[
    {text:'REGARD',font:{name:'Cinzel',size:16,bold:true,color:{argb:'FFC8A24B'}}},
    {text:'   THE ART OF PERSPECTIVE',font:{name:'Cinzel',size:8,color:{argb:'FF9A8B6A'}}},
    {text:'\n'+proj(),font:{name:'Calibri',size:11,bold:true,color:{argb:'FF3A352E'}}}
  ]};
  brandCell.alignment={vertical:'middle',horizontal:'left',wrapText:true,indent:5};
  brandCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2E8D5'}};
  brandCell.font={name:'Cinzel',size:16,bold:true,color:{argb:'FFC8A24B'},};
  brandCell.protection={locked:true};
  try{
    const lid=await xlsAddImg(wb,REGARD_LOGO,'png');
    if(lid)ws.addImage(lid,{tl:{col:0,row:0,colOff:6*9525,rowOff:6*9525},
                     ext:{width:Math.round(46*REGARD_LOGO_AR),height:46},editAs:'absolute'});
  }catch(e){}
  const hRow=ws.getRow(2);
  hRow.height=24;
  hRow.font={bold:true,color:{argb:'FF3A352E'},size:11};
  hRow.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7F1E2'}};
  hRow.alignment={vertical:'middle'};
  hRow.eachCell(c=>{c.border={bottom:{style:'medium',color:{argb:'FFC8A97E'}}};c.protection={locked:true}});
  ws.views=[{state:'frozen',ySplit:2}];
  ws.headerFooter={oddFooter:'&L&"Calibri"&8&KC8A24B REGARD — The Art of Perspective&R&8&K9A8B6A &P / &N',
                   evenFooter:'&L&"Calibri"&8&KC8A24B REGARD — The Art of Perspective&R&8&K9A8B6A &P / &N'};

  const SEVFILL={'必須修改':'FFFDECEA','建議修改':'FFFFF6E5','僅提醒':'FFEAF2FD'};
  const SEVFONT={'必須修改':'FFC0392B','建議修改':'FFA35F00','僅提醒':'FF0058B0'};

  let r=2;
  for(let i=0;i<marks.length;i++){
    const m=marks[i];
    r++;
    const urlRefs=m.refs.filter(x=>x.type==='url');
    const imgRefs=m.refs.filter(x=>x.type==='img');
    ws.addRow({n:i+1,tc:fmt(m.t),sev:sevLabel(m.sev),note:m.note||T('noNote'),refs:urlRefs.map(x=>x.url).join('\n')});
    const row=ws.getRow(r);
    const refDims=[];
    for(const ref of imgRefs){
      const dim=await imgDim(ref.dataURL);
      const w=Math.min(REF_W,dim.w),h=Math.round(w*dim.h/dim.w);
      refDims.push({ref,w,h});
    }
    // 列高：截圖 與 連結文字 取較大者（連結文字留在同列）
    let maxLinkPx=urlRefs.length?urlRefs.length*15:0;
    const rowPx=Math.max(imgH,maxLinkPx,44);
    row.height=Math.round(rowPx*0.75)+4;
    ['A','B','C','D','E'].forEach(col=>{
      ws.getCell(col+r).alignment={vertical:'top',wrapText:(col==='D'||col==='E'),horizontal:col==='A'?'center':'left'};
    });
    ws.getCell('B'+r).font={name:'Consolas',bold:true};
    ws.getCell('C'+r).font={bold:true,color:{argb:SEVFONT[m.sev]||'FF333333'}};
    ws.getCell('C'+r).fill={type:'pattern',pattern:'solid',fgColor:{argb:SEVFILL[m.sev]||'FFF5F5F5'}};
    row.eachCell(c=>{c.border={bottom:{style:'thin',color:{argb:'FFE0DED9'}}}});

    // 截圖（F 欄）
    try{
      const sid=await xlsAddImg(wb,m.shot,'jpeg');
      if(sid)ws.addImage(sid,{tl:{col:5,row:r-1},ext:{width:IMG_W,height:imgH},editAs:'oneCell'});
    }catch(err){}
    // 參考圖片：獨立成行，放在連結文字下方，絕不與其重疊
    for(const d of refDims){
      r++;
      ws.getRow(r).height=Math.round(d.h*0.75)+4;
      ws.getCell('E'+r).alignment={vertical:'top'};
      ws.getCell('E'+r).value=T('refImgLabel');
      try{
        const ext=imgFormat(d.ref.dataURL).toLowerCase();
        const rid=await xlsAddImg(wb,d.ref.dataURL,ext);
        if(rid)ws.addImage(rid,{tl:{col:4,row:r-1},ext:{width:d.w,height:d.h},editAs:'oneCell'});
      }catch(err){}
      ws.getRow(r).eachCell(c=>{if(c.col!==6)c.border={bottom:{style:'thin',color:{argb:'FFE0DED9'}}}});
    }
  }
  // 僅第1~2列鎖定（品牌+標題）；其餘資料列全部解鎖，使用者可自由編輯
  for(let rr=3;rr<=r;rr++){
    const row=ws.getRow(rr);
    row.eachCell(c=>{ if(c.protection&&c.protection.locked){} else {c.protection={locked:false};} });
  }
  ws.autoFilter={from:'A2',to:'F2'};
  ws.pageSetup={orientation:landscape?'landscape':'portrait',fitToPage:true,fitToWidth:1,margins:{left:.3,right:.3,top:.4,bottom:.4,header:.2,footer:.2}};
  await ws.protect('',{selectLockedCells:true,selectUnlockedCells:true,formatCells:true,formatColumns:true,formatRows:true,insertRows:true,deleteRows:true,sort:true,autoFilter:true,editObjects:false});
  const buf=await wb.xlsx.writeBuffer();
  if(await saveAs(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),exportName()+'.xlsx'))dirty=false;
}
function imgDim(dataURL){
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>res({w:im.naturalWidth,h:im.naturalHeight});
    im.onerror=()=>res({w:160,h:90});
    im.src=dataURL;
  });
}

/* ---- 影片資訊偵測 ---- */
$('btnInfo').onclick=()=>showInfo();
$('infoClose').onclick=()=>$('infoDlg').close();
$('hkClose').onclick=()=>$('hkDlg').close();
$('btnHotkeys').onclick=()=>{$('hkDlg').showModal();centerDlg($('hkDlg'))};
// ---- 本地 MP4/MOV 解析器（逐 box 定位 moov，支援 moov 在檔尾的大檔） ----
async function readBytes(file,offset,len){
  return new Uint8Array(await file.slice(offset,Math.min(offset+len,file.size)).arrayBuffer());
}
async function findMoov(file){
  let pos=0,guard=0;
  while(pos+8<=file.size&&guard++<5000){
    const hdr=await readBytes(file,pos,16);
    if(hdr.length<8)break;
    const d=new DataView(hdr.buffer);
    let size=d.getUint32(0);
    const type=String.fromCharCode(hdr[4],hdr[5],hdr[6],hdr[7]);
    let headerLen=8;
    if(size===1){ if(hdr.length<16)break; size=Number(d.getBigUint64(8)); headerLen=16; }
    else if(size===0){ size=file.size-pos; }
    if(size<8)break;
    if(type==='moov')return {offset:pos,size:size,headerLen:headerLen};
    pos+=size;
  }
  return null;
}
async function probeMp4(file){
  const loc=await findMoov(file);
  if(!loc)throw new Error('no moov');
  const MAXMOOV=32*1024*1024;
  const u8=await readBytes(file,loc.offset,Math.min(loc.size,MAXMOOV));
  const d=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const res={tracks:[]};
  let cur=null;
  function walk(start,end,depth){
    if(depth>7)return;
    let pos=start;
    while(pos+8<=end&&pos+8<=u8.length){
      let size=d.getUint32(pos);
      const type=String.fromCharCode(u8[pos+4],u8[pos+5],u8[pos+6],u8[pos+7]);
      let body=pos+8;
      if(size===1){ if(pos+16>u8.length)break; size=Number(d.getBigUint64(pos+8)); body=pos+16; }
      if(size<8)break;
      const boxEnd=Math.min(pos+size,end,u8.length);
      try{
        if(type==='trak'){cur={};res.tracks.push(cur);walk(body,boxEnd,depth+1);}
        else if(type==='moov'||type==='mdia'||type==='minf'||type==='stbl'){walk(body,boxEnd,depth+1);}
        else if(type==='mvhd'){
          const ver=u8[body];
          const ts=d.getUint32(body+(ver===1?20:12));
          const dur=ver===1?Number(d.getBigUint64(body+24)):d.getUint32(body+16);
          if(ts)res.durationSec=dur/ts;
        }
        else if(type==='hdlr'&&cur){
          cur.handler=String.fromCharCode(u8[body+8],u8[body+9],u8[body+10],u8[body+11]);
        }
        else if(type==='tkhd'&&cur){
          const off=boxEnd-8;                      // width/height 固定在 tkhd 尾端
          if(off>body&&off+8<=u8.length){cur.w=d.getUint32(off)/65536;cur.h=d.getUint32(off+4)/65536;}
        }
        else if(type==='mdhd'&&cur){
          const ver=u8[body];
          cur.timeScale=d.getUint32(body+(ver===1?20:12));
          const dur=ver===1?Number(d.getBigUint64(body+24)):d.getUint32(body+16);
          if(cur.timeScale)cur.mediaDur=dur/cur.timeScale;
        }
        else if(type==='stsd'&&cur){
          const cnt=d.getUint32(body+4);
          if(cnt>0&&body+16<=u8.length){
            const es=body+8;                       // 第一個 sample entry 起點
            const esSize=d.getUint32(es);
            cur.codec=String.fromCharCode(u8[es+4],u8[es+5],u8[es+6],u8[es+7]);
            const eEnd=Math.min(es+esSize,u8.length);
            if(cur.handler==='soun'){
              const ver=d.getUint16(es+16);
              cur.channels=d.getUint16(es+24);
              cur.bitsPerSample=d.getUint16(es+26);
              cur.sampleRate=d.getUint32(es+32)>>>16;
              if(ver===1&&es+44<u8.length){        // QuickTime v1 sound entry
                const sr=d.getUint32(es+32)>>>16; if(sr)cur.sampleRate=sr;
              }
              // esds → avgBitRate
              for(let q=es+28;q<eEnd-8;q++){
                if(u8[q]===0x65&&u8[q+1]===0x73&&u8[q+2]===0x64&&u8[q+3]===0x73){ // 'esds'
                  for(let z=q+8;z<Math.min(q+120,u8.length-14);z++){
                    if(u8[z]===0x04){
                      let p=z+1,n=0;
                      while(p<z+6&&(u8[p]&0x80)){p++;n++;}
                      p++;
                      const avg=d.getUint32(p+9);
                      if(avg>0&&avg<100e6)cur.bitRate=avg;
                      break;
                    }
                  }
                  break;
                }
              }
            }else{
              cur.codedW=d.getUint16(es+32);
              cur.codedH=d.getUint16(es+34);
              cur.entryDepth=d.getUint16(es+82);
              // 掃描子 box 找 avcC / hvcC（q 指向 box 起點：size(4)+type(4)+payload）
              for(let q=es+78;q<eEnd-12;q++){
                const t4=String.fromCharCode(u8[q+4],u8[q+5],u8[q+6],u8[q+7]);
                if(t4==='avcC'){
                  const b=q+8;
                  // ISO/IEC 14496-15 AVCDecoderConfigurationRecord
                  // +0 configurationVersion, +1 AVCProfileIndication, +2 profile_compatibility,
                  // +3 AVCLevelIndication, +4 lengthSizeMinusOne, +5 numOfSPS(低5位)
                  cur.profileIdc=u8[b+1];
                  cur.levelIdc=u8[b+3];
                  cur.chroma='4:2:0';cur.lumaDepth=8;
                  const hasExt=[100,110,122,244,44,83,86,118,128,138,139,134,135].includes(cur.profileIdc);
                  if(hasExt){
                    let p2=b+6;                                  // SPS 陣列起點
                    const numSps=u8[b+5]&0x1f;
                    for(let k=0;k<numSps&&p2+2<=eEnd;k++)p2+=2+d.getUint16(p2);
                    if(p2<eEnd){
                      const numPps=u8[p2];p2++;
                      for(let k=0;k<numPps&&p2+2<=eEnd;k++)p2+=2+d.getUint16(p2);
                    }
                    // 擴充：chroma_format(2位) / bit_depth_luma_minus8(3位) / bit_depth_chroma_minus8(3位)
                    if(p2+2<eEnd){
                      cur.chroma=['4:0:0','4:2:0','4:2:2','4:4:4'][u8[p2]&0x03];
                      cur.lumaDepth=(u8[p2+1]&0x07)+8;
                    }
                  }
                  break;
                }
                if(t4==='hvcC'){
                  const b=q+8;
                  // HEVCDecoderConfigurationRecord
                  // +1 profile_space/tier/profile_idc, +12 general_level_idc,
                  // +16 chromaFormat(低2位), +17 bitDepthLumaMinus8(低3位)
                  cur.hevc=true;
                  cur.profileIdc=u8[b+1]&0x1f;
                  cur.levelIdc=u8[b+12];
                  cur.chroma=['4:0:0','4:2:0','4:2:2','4:4:4'][u8[b+16]&0x03];
                  cur.lumaDepth=(u8[b+17]&0x07)+8;
                  break;
                }
              }
            }
          }
        }
        else if(type==='stts'&&cur&&cur.handler!=='soun'){
          const cnt=d.getUint32(body+4);
          if(cnt>0&&body+16<=u8.length){
            let total=0,samples=0;
            for(let k=0;k<Math.min(cnt,200);k++){
              const sc=d.getUint32(body+8+k*8),dt=d.getUint32(body+12+k*8);
              samples+=sc;total+=sc*dt;
            }
            cur.sampleCount=samples;
            if(cur.timeScale&&total>0)cur.fps=samples/(total/cur.timeScale);
          }
        }
      }catch(err){}
      pos+=size;
    }
  }
  walk(loc.headerLen,Math.min(loc.size,u8.length),0);

  // handler 缺失時用 codec 反推軌道類型
  const AUDIO_CC=['mp4a','ac-3','ec-3','Opus','opus','fLaC','flac','.mp3','sowt','twos','lpcm','alac','samr','sawb','ima4','ulaw','alaw'];
  res.tracks.forEach(t=>{
    if(t.handler!=='vide'&&t.handler!=='soun'){
      if(t.codec&&AUDIO_CC.includes(t.codec))t.handler='soun';
      else if(t.codec)t.handler='vide';
    }
  });
  // 過濾輔助軌：tmcd(時間碼)、sbtl/text(字幕)、meta(中繼資料)、chap(章節)
  const SKIP_CC=['tmcd','text','sbtl','subp','mebx','gpmd','fdsc','url ','urlt','clcp','sdsm','odsm'];
  const SKIP_HDLR=['tmcd','meta','text','sbtl','subt','hint','clcp','mdir','dhlr','odsm','sdsm'];
  res.tracks=res.tracks.filter(t=>{
    if(t.codec&&SKIP_CC.includes(t.codec))return false;
    if(t.handler&&SKIP_HDLR.includes(t.handler))return false;
    if(t.handler==='vide'&&!(t.codedW>16&&t.codedH>16))return false;   // 無有效畫面尺寸
    return t.handler==='vide'||t.handler==='soun';
  });
  return res;
}
const FOURCC_NAME={'avc1':'H.264／AVC','avc3':'H.264／AVC','hvc1':'H.265／HEVC','hev1':'H.265／HEVC','mp4v':'MPEG-4 Visual','av01':'AV1','vp09':'VP9','vp08':'VP8','apch':'Apple ProRes 422 HQ','apcn':'Apple ProRes 422','apcs':'Apple ProRes 422 LT','ap4h':'Apple ProRes 4444','dvh1':'DVCPRO HD',
  'mp4a':'AAC','ac-3':'Dolby Digital（AC-3）','ec-3':'Dolby Digital Plus（E-AC-3）','Opus':'Opus','fLaC':'FLAC','.mp3':'MP3','sowt':'PCM（小端序）','twos':'PCM（大端序）','lpcm':'線性 PCM','alac':'Apple 無損（ALAC）'};
const H264_PROFILE={66:'Baseline',77:'Main',88:'Extended',100:'High',110:'High 10',122:'High 4:2:2',244:'High 4:4:4 Predictive'};

async function showInfo(){
  $('infoDlg').showModal();
  centerDlg($('infoDlg'));
  const b=$('infoBody');
  b.innerHTML=T('analyzing');
  if(!currentFile){b.innerHTML=T('noVideo');return}
  const f=currentFile;
  const fmtSize=n=>n>1073741824?(n/1073741824).toFixed(2)+' GB':(n/1048576).toFixed(1)+' MB';
  const fmtRate=bps=>bps>=1e6?(bps/1e6).toFixed(2)+' Mbps':Math.round(bps/1e3)+' kbps';
  const sec=[];
  const g=[[T('fFile'),f.name],
           [T('fFormat'),(f.name.split('.').pop()||'').toUpperCase()],
           [T('fSize'),fmtSize(f.size)],
           [T('fDur'),fmt(video.duration)]];
  sec.push({title:T('secGeneral'),rows:g});
  const render=()=>{
    b.innerHTML=sec.map(s=>
      `<div class="info-sec">${s.title}</div><table class="info-table">`+
      s.rows.filter(r=>r[1]!=null&&r[1]!==''&&r[1]!=='—').map(r=>`<tr><td>${r[0]}</td><td>${esc(String(r[1]))}</td></tr>`).join('')+
      '</table>').join('');
  };
  render();
  try{
    const info=await probeMp4(f);
    const dur=info.durationSec||video.duration;
    if(dur)g.push([T('fOverall'),fmtRate(f.size*8/dur)]);
    let audioShown=false;
    for(const t of (info.tracks||[])){
      const name=FOURCC_NAME[t.codec]||t.codec||'—';
      if(t.handler==='vide'){
        const W=t.codedW||Math.round(t.w)||video.videoWidth;
        const H=t.codedH||Math.round(t.h)||video.videoHeight;
        sec.push({title:T('secVideo'),rows:[
          [T('fCodec'),name],
          [T('fVBitrate'),dur?fmtRate(f.size*8/dur*0.94)+'（'+T('approx')+'）':null],
          [T('fLevel'),t.levelIdc?(t.levelIdc/10).toFixed(1):null],
          [T('fRes'),W+' × '+H+' '+T('px')],
          [T('fDar'),aspectLabel(W,H)],
          [T('fOrient'),W>=H?T('landscape'):T('portrait')],
          [T('fFps'),t.fps?t.fps.toFixed(3)+' FPS':(fpsSource==='measured'?detectedFps+' FPS（'+T('measured')+'）':null)],
          [T('fChroma'),t.chroma||null],
          [T('fDepth'),t.lumaDepth?t.lumaDepth+' '+T('bit'):null],
        ]});
      }else if(t.handler==='soun'){
        audioShown=true;
        sec.push({title:T('secAudio'),rows:[
          [T('fCodec'),name],
          [T('fABitrate'),t.bitRate?fmtRate(t.bitRate):(dur?fmtRate(f.size*8/dur*0.06)+'（'+T('approx')+'）':null)],
          [T('fSample'),t.sampleRate?Math.round(t.sampleRate).toLocaleString()+' Hz':null],
          [T('fChannels'),t.channels?(t.channels===1?'1（'+T('mono')+'）':t.channels===2?'2（'+T('stereo')+'）':t.channels+' '+T('ch')):null],
        ]});
      }
    }
    if(!audioShown)sec.push({title:T('secAudio'),rows:[['—',T('fNoAudio')]]});
    render();
  }catch(e){
    sec.push({title:T('secVideo'),rows:[
      [T('fRes'),video.videoWidth+' × '+video.videoHeight+' '+T('px')],
      [T('fDar'),aspectLabel(video.videoWidth,video.videoHeight)],
      [T('fOrient'),video.videoWidth>=video.videoHeight?T('landscape'):T('portrait')],
      [T('fFps'),detectedFps+' FPS（'+(fpsSource==='measured'?T('measured'):T('defaultVal'))+'）'],
      [T('fOverall'),video.duration?fmtRate(f.size*8/video.duration):null],
    ]});
    render();
    b.innerHTML+='<p style="margin-top:8px;font-size:11px;color:var(--muted)">'+T('onlyMp4')+'</p>';
  }
}
function aspectLabel(w,h){
  if(!w||!h)return '—';
  const r=w/h;
  const known=[[16/9,'16:9'],[9/16,'9:16'],[4/3,'4:3'],[3/4,'3:4'],[21/9,'21:9'],[1,'1:1'],[2/3,'2:3'],[3/2,'3:2'],[5/4,'5:4'],[2.39,'2.39:1']];
  for(const [v,l] of known){if(Math.abs(r-v)/v<0.02)return l}
  // 未知比例 → 用最大公因數化簡
  const g=(a,b)=>b?g(b,a%b):a;
  const d=g(w,h);
  return (w/d)+':'+(h/d);
}
