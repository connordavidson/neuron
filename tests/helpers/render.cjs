// Minimal deterministic hook/event harness. It does not claim native layout coverage.
function createRenderer() {
  let slots = [], cursor = 0, effects = [], tree, component, props;
  const same = (a,b) => a && b && a.length === b.length && a.every((x,i)=>Object.is(x,b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment',
    useState(initial) { const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}]; },
    useRef(initial) { const i=cursor++; return slots[i] ||= {current:initial}; },
    useMemo(f,deps) { const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) slots[i]={deps,value:f()}; return slots[i].value; },
    useCallback(f,deps) { return react.useMemo(()=>f,deps); },
    useEffect(f,deps) { const i=cursor++; if(!slots[i] || !same(slots[i].deps,deps)) { const old=slots[i]; slots[i]={deps}; effects.push(()=>{old?.cleanup?.();slots[i].cleanup=f();}); } },
  };
  const render = () => { cursor=0; tree=component(props); const pending=effects;effects=[];pending.forEach(f=>f()); return tree; };
  return {react, mount(c,p={}){if(component!==c){slots.forEach(s=>s?.cleanup?.());slots=[];}component=c;props=p;return render();},render, update(p){props=p;return render();},unmount(){slots.forEach(s=>s?.cleanup?.());},nodes(){return nodes(render());}};
}
function nodes(node) {
  if(Array.isArray(node))return node.flatMap(nodes);
  if(!node || typeof node!=='object')return [];
  // Extracted presentation components are expanded without mounting native views.
  if(typeof node.type==='function' && /Panel$/.test(node.type.name))return nodes(node.type(node.props));
  return [node,...nodes(node.props?.children)];
}
function nativeMock() {
 const listeners={};
 return {listeners, Alert:{alert(){}},Linking:{addEventListener:()=>({remove(){}}),getInitialURL:async()=>null},Platform:{OS:'ios'},
 useWindowDimensions:()=>({width:390,height:844,scale:3,fontScale:1}),
 ...Object.fromEntries(['Modal','View','Text','Pressable','SafeAreaView','ScrollView','FlatList','ActivityIndicator'].map(x=>[x,x])),
 StyleSheet:{create:x=>x,absoluteFill:{}},Animated:{Value:class{constructor(value){this.value=value;}},View:'AnimatedView',timing:()=>({start(){}})},
 AppState:{addEventListener:(name,callback)=>{listeners[name]=callback;return {remove(){delete listeners[name];}};}},};
}
const settle = async () => { for(let i=0;i<40;i++)await Promise.resolve(); };
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
module.exports={createRenderer,nativeMock,nodes,settle,deferred};
