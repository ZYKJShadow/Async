import type { FingerprintInjectPatch } from '../main-src/browser/browserFingerprintNormalize.js';

function embedJsonInScriptLiteral(obj: unknown): string {
	const raw = JSON.stringify(obj);
	return raw
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')
		.replace(/<\/script/gi, '<\\/script');
}

/**
 * 生成注入到 webview 页面上下文的伪装脚本；`patch` 为 null 时不注入。
 * 参考 anything-analyzer 的 stealth 思路，仅对 patch 中出现的字段打补丁。
 */
export function buildBrowserFingerprintStealthScript(patch: FingerprintInjectPatch | null): string | null {
	if (!patch || Object.keys(patch).length === 0) {
		return null;
	}
	const json = embedJsonInScriptLiteral(patch);
	return `(function(){
'use strict';
var __patch=${json};
var __key='__asyncShellFp_'+Object.keys(__patch).sort().join('|');
if(window[__key])return;
window[__key]=true;

function makeNative(fn,name){
var nativeToString=function(){return 'function '+name+'() { [native code] }';};
Object.defineProperty(nativeToString,'name',{value:'toString'});
fn.toString=nativeToString;
return fn;
}
function overrideGetter(obj,prop,value){
try{
var desc=Object.getOwnPropertyDescriptor(obj,prop)||Object.getOwnPropertyDescriptor(Object.getPrototypeOf(obj),prop);
if(desc&&desc.get){
var newGet=makeNative(function(){return value;},'get '+prop);
Object.defineProperty(obj,prop,{get:newGet,configurable:true});
}else{
Object.defineProperty(obj,prop,{value:value,writable:false,configurable:true});
}
}catch(e){}
}

function mulberry32(seed){
return function(){
seed|=0;seed=seed+0x6D2B79F5|0;
var t=Math.imul(seed^seed>>>15,1|seed);
t=t+Math.imul(t^t>>>7,61|t)^t;
return((t^t>>>14)>>>0)/4294967296;
};
}

if(__patch.maskWebdriver){
try{
Object.defineProperty(navigator,'webdriver',{get:makeNative(function(){return false;},'get webdriver'),configurable:true});
}catch(e){}
}

if(__patch.platform!=null)overrideGetter(navigator,'platform',__patch.platform);

if(__patch.languages&&__patch.languages.length){
var langs=Object.freeze(__patch.languages.slice());
overrideGetter(navigator,'languages',langs);
overrideGetter(navigator,'language',langs[0]);
}

if(__patch.hardwareConcurrency!=null)overrideGetter(navigator,'hardwareConcurrency',__patch.hardwareConcurrency);
if(__patch.deviceMemory!=null)overrideGetter(navigator,'deviceMemory',__patch.deviceMemory);

if(__patch.screenWidth!=null)overrideGetter(screen,'width',__patch.screenWidth);
if(__patch.screenHeight!=null){
overrideGetter(screen,'height',__patch.screenHeight);
var off=typeof __patch.availHeightOffset==='number'?__patch.availHeightOffset:40;
var aw=__patch.screenWidth!=null?__patch.screenWidth:screen.width;
var ah=Math.max(0,__patch.screenHeight-off);
overrideGetter(screen,'availWidth',aw);
overrideGetter(screen,'availHeight',ah);
}else if(__patch.screenWidth!=null){
overrideGetter(screen,'availWidth',__patch.screenWidth);
}
if(__patch.colorDepth!=null){
overrideGetter(screen,'colorDepth',__patch.colorDepth);
overrideGetter(screen,'pixelDepth',__patch.colorDepth);
}

if(__patch.devicePixelRatio!=null)overrideGetter(window,'devicePixelRatio',__patch.devicePixelRatio);

try{
if(!window.chrome)window.chrome={};
if(!window.chrome.runtime){
window.chrome.runtime={
connect:makeNative(function(){},'connect'),
sendMessage:makeNative(function(){},'sendMessage')
};
}
}catch(e){}

if(__patch.timezone){
try{
var origDTF=Intl.DateTimeFormat;
var tz=__patch.timezone;
var newDTF=makeNative(function(locales,options){
var instance=new origDTF(locales,options);
var origResolved=instance.resolvedOptions.bind(instance);
instance.resolvedOptions=makeNative(function(){
var opts=origResolved();
opts.timeZone=tz;
return opts;
},'resolvedOptions');
return instance;
},'DateTimeFormat');
newDTF.prototype=origDTF.prototype;
newDTF.supportedLocalesOf=origDTF.supportedLocalesOf;
Intl.DateTimeFormat=newDTF;
}catch(e){}
}

if(__patch.timezoneOffsetMinutes!=null){
try{
var tzm=__patch.timezoneOffsetMinutes;
Date.prototype.getTimezoneOffset=makeNative(function(){return tzm;},'getTimezoneOffset');
}catch(e){}
}

if(__patch.canvasNoiseSeed!=null){
try{
var canvasRng=mulberry32(__patch.canvasNoiseSeed|0);
var origToDataURL=HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL=makeNative(function(){
try{
var ctx=this.getContext('2d');
if(ctx&&this.width*this.height<2000000){
var imageData=ctx.getImageData(0,0,this.width,this.height);
var data=imageData.data;
for(var i=0;i<data.length;i+=4){
data[i]=data[i]+Math.floor((canvasRng()-0.5)*2);
data[i+1]=data[i+1]+Math.floor((canvasRng()-0.5)*2);
}
ctx.putImageData(imageData,0,0);
}
}catch(e){}
return origToDataURL.apply(this,arguments);
},'toDataURL');
var origToBlob=HTMLCanvasElement.prototype.toBlob;
HTMLCanvasElement.prototype.toBlob=makeNative(function(){
try{
var ctx=this.getContext('2d');
if(ctx&&this.width*this.height<2000000){
var imageData=ctx.getImageData(0,0,this.width,this.height);
var data=imageData.data;
for(var i=0;i<data.length;i+=4){
data[i]=data[i]+Math.floor((canvasRng()-0.5)*2);
}
ctx.putImageData(imageData,0,0);
}
}catch(e){}
return origToBlob.apply(this,arguments);
},'toBlob');
}catch(e){}
}

if(__patch.webglVendor!=null||__patch.webglRenderer!=null){
try{
var VEND=__patch.webglVendor;
var REND=__patch.webglRenderer;
var origGetParam=WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter=makeNative(function(pname){
var UNMASKED_VENDOR=0x9245;
var UNMASKED_RENDERER=0x9246;
if(pname===UNMASKED_VENDOR&&VEND!=null)return VEND;
if(pname===UNMASKED_RENDERER&&REND!=null)return REND;
return origGetParam.call(this,pname);
},'getParameter');
if(typeof WebGL2RenderingContext!=='undefined'){
var origGetParam2=WebGL2RenderingContext.prototype.getParameter;
WebGL2RenderingContext.prototype.getParameter=makeNative(function(pname){
var UNMASKED_VENDOR=0x9245;
var UNMASKED_RENDERER=0x9246;
if(pname===UNMASKED_VENDOR&&VEND!=null)return VEND;
if(pname===UNMASKED_RENDERER&&REND!=null)return REND;
return origGetParam2.call(this,pname);
},'getParameter');
}
}catch(e){}
}

if(__patch.audioNoiseSeed!=null){
try{
var audioRng=mulberry32(__patch.audioNoiseSeed|0);
var origCreateOscillator=AudioContext.prototype.createOscillator;
AudioContext.prototype.createOscillator=makeNative(function(){
var osc=origCreateOscillator.call(this);
var origConnect=osc.connect.bind(osc);
osc.connect=makeNative(function(dest){
var args=Array.prototype.slice.call(arguments,1);
if(dest instanceof AnalyserNode){
var gainNode=osc.context.createGain();
gainNode.gain.value=1+(audioRng()-0.5)*0.0001;
origConnect(gainNode);
gainNode.connect(dest);
return dest;
}
return origConnect.apply(null,arguments);
},'connect');
return osc;
},'createOscillator');
}catch(e){}
}

if(__patch.webrtcPolicy==='block'){
try{
window.RTCPeerConnection=makeNative(function(){
throw new DOMException('WebRTC is disabled','NotAllowedError');
},'RTCPeerConnection');
window.webkitRTCPeerConnection=window.RTCPeerConnection;
}catch(e){}
}

})();`;
}
