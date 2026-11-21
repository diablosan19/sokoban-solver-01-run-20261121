import{readFileSync,writeFileSync,mkdirSync}from"node:fs";
const{MAKEFUN_INPUT_DIR:I="/input",MAKEFUN_OUTPUT_DIR:O="/output"}=process.env;
let W,D;
function F(a,f){let m={[a]:""},q=[a];for(let c of q)for(let k=0;k<4;k++){let n=c+D[k];if(f(n)&&!(n in m))m[n]=m[c]+"rldu"[k],q.push(n)}return m}
function S(C,G,B,p,l){
let V=new Set(),Q=[[B.sort(),p,""]],h=0;
while(h<Q.length){
let[b,x,m]=Q[h++];
if(h>3e5)return 0;
let R=F(x,z=>(z in C||z==p)&&!b.includes(z));
if(b.every(z=>G.includes(z))&&(l||p in R))return[m,x,b];
for(let z of b)for(let o of D){
let u=z-o,t=z+o;
if(!(u in R)||!(t in C||t==p)||b.includes(t))continue;
let n=b.slice();n[n.indexOf(z)]=t;n.sort();
if(!V.has(n+","+z))V.add(n+","+z),Q.push([n,z,m+R[u]+"rldu"[D.indexOf(o)]]);
}
}
return 0}
function L(T){
let r=T.split(/\r?\n/).filter(Boolean),w=Math.max(...r.map(z=>z.length));
W=w+2,D=[1,-1,W,-W];
let H="#".repeat(W),G=H+r.map(z=>"#"+z.padEnd(w)+"#").join("")+H,B=[],g=[],p=0;
[...G].forEach((c,i)=>{if(".*+".includes(c))g.push(i);if("$*".includes(c))B.push(i);if("@+".includes(c))p=i})
let y=p/W|0,R=[];
while(B.length){
let m=F(B[0],z=>G[z]!="#"&&(z/W|0)!=y),b=B.filter(z=>z in m),v=g.filter(z=>z in m),d=+Object.keys(m).find(c=>Math.abs((c/W|0)-y)==1),n,f;
if(!d)return"";
n=d+(d/W<y?W:-W),f=d/W<y?"d":"u";
R.push([m,v,b,d,n,f,v.includes(d)]),B=B.filter(z=>!(z in m));
}
R.sort((a,b)=>a[6]-b[6]||a[3]-b[3]);
let s="",c=p;
while(R.length){
let[C,gg,b,d,n,f]=R.shift(),l=!R.length,o;
s+=n>c?"r".repeat(n-c):"l".repeat(c-n);
o=S(C,gg,b,n,l);
if(!o)return"";
s+=o[0];
if(!l){
let u=F(o[1],z=>(z in C||z==n)&&!o[2].includes(z));
if(!(d in u))return"";
s+=u[d]+f,c=n;
}
}
return s}
for(let k=1;k<6;k++){
let a="/i00"+k,m="";
try{m=L(readFileSync(I+a+"/level.txt")+"")}catch(e){}
mkdirSync(O+a,{recursive:true});
writeFileSync(O+a+"/solution.txt",m);
}
