const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Element {
 constructor(tag,props,...children){this.tag=tag;this.props=props||{};Object.assign(this,this.props);this.children=[];this.append(...children);this.classList={toggle(){}};}
 append(...children){this.children.push(...children.filter(c=>c!==null&&c!==undefined));}
 set innerHTML(value){this.children=[];}
 setAttribute(key,value){this.props[key]=value;}
 removeAttribute(key){delete this.props[key];}
 focus(){} scrollIntoView(){}
 querySelector(tag){return find(this,n=>n.tag===tag);}
}
function find(root,predicate){if(root instanceof Element){if(predicate(root))return root;for(const child of root.children){const hit=find(child,predicate);if(hit)return hit;}}return null;}
function text(root){return root instanceof Element?root.children.map(text).join(' '):String(root);}
let dialog,timerId=0;const timers=new Map(),requests=[];
const Model={state:{tab:'furnish',project:{name:'test',kind:'import',import:{}}},bus:{},safeName:s=>s,api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))};
const context={window:{MLO:{el:(...args)=>new Element(...args),Model,ImportModel:{},App:{},UI:{modal:d=>dialog=d,kit:{},closeModal(){},renderLeft(){},toast(){}}}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
vm.runInNewContext(fs.readFileSync('ui/js/fitmodels.js','utf8'),context);
const fm=context.window.MLO.FitModels;
fm.game.total=86690;fm.game.root='C:/GTA';fm.catalog.origin='game';
function fire(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=(id,name,archetype=name)=>({Id:id,Name:name,Archetype:archetype,Kind:'prop',Category:'Tools & Workshop',Tags:[],Dependencies:[]});
async function main(){
 fm.openCatalog();fire();assert.equal(requests.length,1);assert(requests[0].url.includes('scope=props'));assert(requests[0].url.includes('limit=24'));
 const search=find(dialog,n=>n.props['aria-label']==='Search models');search.props.oninput({target:{value:'hammer'}});fire();assert.equal(requests.length,2);
 requests[1].resolve({items:[row('tool','prop_tool_hammer')],total:50});await tick();assert(text(dialog).includes('prop_tool_hammer'));assert(text(dialog).includes('1–24 of 50'));
 requests[0].resolve({items:[row('stale','stale_initial')],total:1});await tick();assert(!text(dialog).includes('stale_initial'),'stale response overwrote latest search');
 find(dialog,n=>n.tag==='button'&&text(n)==='Next').props.onclick();fire();assert(requests[2].url.includes('offset=24'));
 requests[2].reject(new Error('test unavailable'));await tick();assert(text(dialog).includes('test unavailable'));
 find(dialog,n=>n.tag==='button'&&text(n)==='Retry search').props.onclick();fire();requests[3].resolve({items:[row('raw','archive_without_archetype',null)],total:50});await tick();
 const raw=find(dialog,n=>n.tag==='button'&&text(n).includes('archive_without_archetype'));assert(raw.disabled,'archive-only model must not be placeable');
 const category=find(dialog,n=>n.props['aria-label']==='Interior prop category');assert(text(category).includes('Plants'));assert(text(category).includes('Other / Uncategorised'));category.props.onchange({target:{value:'Plants'}});fire();assert(requests[4].url.includes('category=Plants')&&requests[4].url.includes('offset=0'));
 const collection=find(dialog,n=>n.props['aria-label']==='GTA prop collection');assert(text(collection).includes('Alla props'));collection.props.onchange({target:{value:'interior'}});fire();assert(requests[5].url.includes('scope=interior'));
 find(dialog,n=>n.props['aria-label']==='Close catalogue').props.onclick();requests[5].resolve({items:[],total:0});await tick();fire();assert.equal(requests.length,6,'closed catalogue scheduled a stale request');
 assert(requests.every(r=>r.url.includes('/rpf-browse?')),'metadata browsing requested geometry');
 console.log('PASS: paged UI, debounced search, stale results, retry, archive-only disable, categories and scopes; no geometry requests');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
