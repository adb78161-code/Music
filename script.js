const canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d");
let dpr=window.devicePixelRatio||1;
let strokes=[],undone=[],drawing=false,current=null;
let tool="pen",selected=0,grid=false,playing=false;
let scanX=0,scanRAF=0,scanStart=0,scanDuration=12000;
let audio=null, voices=[],lastScanTime=0,triggeredDots=new Set();

const palette=[
 {name:"green",color:"#159b78",note:"C4",freq:261.63},
 {name:"red",color:"#d94f2f",note:"D4",freq:293.66},
 {name:"purple",color:"#7465d7",note:"E4",freq:329.63},
 {name:"orange",color:"#f1a11f",note:"F4",freq:349.23},
 {name:"blue",color:"#385ac1",note:"G4",freq:392.00},
 {name:"pink",color:"#d66eaa",note:"A4",freq:440},
 {name:"sky",color:"#79b7df",note:"B4",freq:493.88},
 {name:"black",color:"#292925",note:"C5",freq:523.25},
 {name:"peach",color:"#f0bd7d",note:"D5",freq:587.33}
];

const pal=document.getElementById("palette");
palette.forEach((p,i)=>{
 const b=document.createElement("button");
 b.className="color"+(i===0?" selected":"");
 b.style.background=p.color;
 b.title=`${p.name} — ${p.note}`;
 b.onclick=()=>{
   selected=i;tool="pen";tools();
   document.querySelectorAll(".color").forEach(x=>x.classList.remove("selected"));
   b.classList.add("selected");
   playNote(p.freq,.22);
 };
 pal.appendChild(b);
});

function resize(){
 const r=canvas.getBoundingClientRect();
 dpr=window.devicePixelRatio||1;
 canvas.width=Math.round(r.width*dpr);
 canvas.height=Math.round(r.height*dpr);
 ctx.setTransform(dpr,0,0,dpr,0,0);
 redraw();
}
addEventListener("resize",resize);

function point(e){
 const r=canvas.getBoundingClientRect();
 return {x:e.clientX-r.left,y:e.clientY-r.top};
}

function redraw(){
 const w=canvas.clientWidth,h=canvas.clientHeight;
 ctx.clearRect(0,0,w,h);
 ctx.fillStyle="#fffefa";ctx.fillRect(0,0,w,h);

 if(grid){
   ctx.save();ctx.strokeStyle="#ece9e1";ctx.lineWidth=1;
   for(let x=0;x<w;x+=18){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
   for(let y=0;y<h;y+=18){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
   ctx.restore();
 }

 strokes.forEach(s=>{
   if(!s.points.length)return;
   ctx.save();
   ctx.lineWidth=s.width;ctx.lineCap="round";ctx.lineJoin="round";
   ctx.globalCompositeOperation=s.erase?"destination-out":"source-over";
   ctx.strokeStyle=s.erase?"#000":s.color;

   if(s.points.length===1){
     ctx.beginPath();ctx.arc(s.points[0].x,s.points[0].y,s.width/2,0,Math.PI*2);ctx.fill();
   }else{
     ctx.beginPath();
     s.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
     ctx.stroke();
   }
   ctx.restore();
 });

 // Delicate musical notation grows naturally from painted gestures.
 // These are visual ornaments; the scanner still reads the original strokes.
 strokes.forEach((s,idx)=>{
   if(s.erase||s.points.length<2)return;
   const step=Math.max(26,Math.floor(s.points.length/3));
   for(let i=step;i<s.points.length;i+=step*2){
     const p=s.points[i];
     drawAestheticNote(p.x,p.y,s.color,(idx+i)%3);
   }
 });

 if(playing)drawScanner(scanX);
}

function drawAestheticNote(x,y,color,variant){
 ctx.save();
 ctx.globalCompositeOperation="source-over";
 ctx.fillStyle=color;ctx.strokeStyle=color;ctx.globalAlpha=.62;
 const size=variant===0?18:variant===1?15:20;
 ctx.lineWidth=2;

 if(variant===0){
   ctx.beginPath();ctx.ellipse(x,y,size*.34,size*.25,-.22,0,Math.PI*2);ctx.fill();
   ctx.beginPath();ctx.moveTo(x+size*.28,y);ctx.lineTo(x+size*.28,y-size*1.45);ctx.stroke();
   ctx.beginPath();ctx.moveTo(x+size*.28,y-size*1.45);
   ctx.quadraticCurveTo(x+size*.85,y-size*1.35,x+size*.72,y-size*.95);ctx.stroke();
 }else if(variant===1){
   ctx.font=size*1.45+"px Georgia, serif";ctx.textAlign="center";ctx.textBaseline="middle";
   ctx.fillText("♪",x,y);
 }else{
   ctx.font=size*1.25+"px Georgia, serif";ctx.textAlign="center";ctx.textBaseline="middle";
   ctx.fillText("♫",x,y);
 }
 ctx.restore();
}
function drawScanner(x){
 const h=canvas.clientHeight;
 ctx.save();
 ctx.strokeStyle="#22221f";
 ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
 ctx.restore();
}

function begin(e){
 drawing=true;
 current={
   points:[point(e)],
   color:palette[selected].color,
   freq:palette[selected].freq,
   width:5,
   erase:tool==="eraser"
 };
 strokes.push(current);undone=[];
 if(!current.erase)startDrawingVoice(current.freq);
}
function move(e){
 if(!drawing)return;
 const p=point(e),prev=current.points[current.points.length-1];
 current.points.push(p);

 ctx.save();
 ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=current.width;
 ctx.globalCompositeOperation=current.erase?"destination-out":"source-over";
 ctx.strokeStyle=current.erase?"#000":current.color;
 ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);ctx.stroke();
 ctx.restore();

 if(audio&&audio.liveOsc&&!current.erase){
   // Drawing height gently bends the selected colour's note.
   const semitones=((canvas.clientHeight/2-p.y)/(canvas.clientHeight/2))*2;
   audio.liveOsc.frequency.setTargetAtTime(
     current.freq*Math.pow(2,semitones/12),audio.ctx.currentTime,.035
   );
 }
}
function end(){if(!drawing)return;drawing=false;stopDrawingVoice();current=null}

canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);begin(e)};
canvas.onpointermove=move;
canvas.onpointerup=end;
canvas.onpointercancel=end;

function tools(){
 document.getElementById("pen").classList.toggle("active",tool==="pen");
 document.getElementById("eraser").classList.toggle("active",tool==="eraser");
}
document.getElementById("pen").onclick=()=>{tool="pen";tools()};
document.getElementById("eraser").onclick=()=>{tool="eraser";tools()};
document.getElementById("undo").onclick=()=>{if(strokes.length){undone.push(strokes.pop());redraw()}};
document.getElementById("redo").onclick=()=>{if(undone.length){strokes.push(undone.pop());redraw()}};
document.getElementById("clear").onclick=()=>{stopPlayback();undone=strokes.slice();strokes=[];redraw()};
document.getElementById("grid").onclick=()=>{grid=!grid;document.getElementById("grid").classList.toggle("on",grid);redraw()};

function initAudio(){
 if(!audio){
   const ac=new(window.AudioContext||window.webkitAudioContext)();
   audio={ctx:ac,master:null,reverb:null,delay:null,feedback:null,liveOsc:null,liveGain:null};
   const master=ac.createGain();master.gain.value=.75;
   const dry=ac.createGain();dry.gain.value=.72;
   const wet=ac.createGain();wet.gain.value=.42;
   const delay=ac.createDelay(1.5);delay.delayTime.value=.32;
   const fb=ac.createGain();fb.gain.value=.34;
   const filter=ac.createBiquadFilter();filter.type="lowpass";filter.frequency.value=3600;
   delay.connect(fb);fb.connect(delay);delay.connect(filter);filter.connect(wet);
   dry.connect(master);wet.connect(master);master.connect(ac.destination);
   audio.master=master;audio.dry=dry;audio.wet=wet;audio.delay=delay;
 }
 if(audio.ctx.state==="suspended")audio.ctx.resume();
}

function voice(freq,duration=0.65,volume=.12){
 initAudio();
 const ac=audio.ctx;
 const osc=ac.createOscillator();
 const gain=ac.createGain();
 const filter=ac.createBiquadFilter();
 osc.type="sine";osc.frequency.value=freq;
 filter.type="lowpass";filter.frequency.value=2200;
 const now=ac.currentTime;
 gain.gain.setValueAtTime(.0001,now);
 gain.gain.exponentialRampToValueAtTime(volume,now+.035);
 gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume*.45),now+duration*.35);
 gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
 osc.connect(filter);filter.connect(gain);
 gain.connect(audio.dry);gain.connect(audio.delay);
 osc.start(now);osc.stop(now+duration+.04);
}

function playNote(freq,duration=.5){
 voice(freq,duration,.13);
}

function startDrawingVoice(freq){
 initAudio();stopDrawingVoice();
 const ac=audio.ctx,o=ac.createOscillator(),g=ac.createGain();
 o.type="sine";o.frequency.value=freq;
 g.gain.setValueAtTime(.0001,ac.currentTime);
 g.gain.exponentialRampToValueAtTime(.045,ac.currentTime+.08);
 o.connect(g);g.connect(audio.dry);g.connect(audio.delay);o.start();
 audio.liveOsc=o;audio.liveGain=g;
}
function stopDrawingVoice(){
 if(audio&&audio.liveOsc){
   const ac=audio.ctx,g=audio.liveGain,o=audio.liveOsc;
   try{g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.12);o.stop(ac.currentTime+.14)}catch(e){}
   audio.liveOsc=null;audio.liveGain=null;
 }
}

const tempo=document.getElementById("tempo"),tempoText=document.getElementById("tempoText");
tempo.oninput=()=>tempoText.textContent=tempo.value;

function xRange(s){
 if(!s.points.length)return [Infinity,-Infinity];
 let min=Infinity,max=-Infinity;
 s.points.forEach(p=>{min=Math.min(min,p.x);max=Math.max(max,p.x)});
 return [min,max];
}

function pointAtX(s,x){
 for(let i=1;i<s.points.length;i++){
   const a=s.points[i-1],b=s.points[i];
   if((a.x<=x&&b.x>=x)||(a.x>=x&&b.x<=x)){
     const t=b.x===a.x?.5:Math.max(0,Math.min(1,(x-a.x)/(b.x-a.x)));
     return {y:a.y+(b.y-a.y)*t};
   }
 }
 return null;
}

function drawScanner(x){
 const h=canvas.clientHeight;
 ctx.save();
 ctx.strokeStyle="#22221f";
 ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();
 ctx.restore();
}

function scanFrame(now){
 if(!playing)return;
 const w=canvas.clientWidth;
 const elapsed=now-scanStart;
 const progress=Math.min(1,elapsed/scanDuration);
 scanX=progress*w;

 // One physical scan line. Every stroke is sampled only at the point
 // where that line crosses it. This creates the reference-style
 // left-to-right visual instrument behavior.
 strokes.forEach((s,index)=>{
   if(s.erase||s.points.length<2)return;
   const hit=pointAtX(s,scanX);
   if(!hit){voices.delete(index);return}

   const vertical=((canvas.clientHeight/2-hit.y)/(canvas.clientHeight/2))*6;
   const freq=s.freq*Math.pow(2,vertical/12);
   const state=voices.get(index);

   if(!state){
     voices.set(index,{last:now,freq});
     playMusicalNote(freq,.62,.085);
   }else if(now-state.last>430){
     // Long, soft notes with overlap = slow/reverb character.
     playMusicalNote(freq,.72,.065);
     state.last=now;state.freq=freq;
   }
 });

 redraw();
 if(progress<1)scanRAF=requestAnimationFrame(scanFrame);
 else stopPlayback();
}

function playMusicalNote(freq,duration,volume){
 initAudio();
 const ac=audio.ctx;
 const o=ac.createOscillator();
 const g=ac.createGain();
 const f=ac.createBiquadFilter();

 // Warm, soft instrument tone rather than a beep.
 o.type="triangle";
 o.frequency.setValueAtTime(freq,ac.currentTime);
 f.type="lowpass";f.frequency.value=2400;

 const t=ac.currentTime;
 g.gain.setValueAtTime(.0001,t);
 g.gain.exponentialRampToValueAtTime(volume,t+.09);
 g.gain.exponentialRampToValueAtTime(volume*.68,t+duration*.45);
 g.gain.exponentialRampToValueAtTime(.0001,t+duration);

 o.connect(f);f.connect(g);
 g.connect(audio.dry);
 g.connect(audio.delay);
 o.start(t);o.stop(t+duration+.06);
}

function startPlayback(){
 if(!strokes.some(s=>!s.erase&&s.points.length>1))return;
 initAudio();
 stopDrawingVoice();
 playing=true;
 scanX=0;
 scanStart=performance.now();
 voices=new Map();
 document.getElementById("play").textContent="Ⅱ";

 // Slow scan. Tempo changes the duration, but the minimum remains relaxed.
 const t=Number(tempo.value);
 scanDuration=18000-(t-40)*38;
 scanDuration=Math.max(9500,Math.min(18000,scanDuration));
 scanRAF=requestAnimationFrame(scanFrame);
}

function stopPlayback(){
 playing=false;
 cancelAnimationFrame(scanRAF);
 voices=new Map();
 stopDrawingVoice();
 document.getElementById("play").textContent="▶";
 redraw();
}

document.getElementById("play").onclick=()=>playing?stopPlayback():startPlayback();

document.querySelectorAll(".page").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
 b.classList.add("active");
});
document.getElementById("cloud").onclick=()=>{
 localStorage.setItem("visualMusic",JSON.stringify(strokes));
 alert("Drawing saved in this browser.");
};
document.getElementById("send").onclick=()=>{
 if(navigator.share)navigator.share({title:"My visual music",text:"My visual instrument"});
 else alert("Share is not supported here.");
};
document.getElementById("menu").onclick=()=>alert("Visual instrument controls");

resize();
