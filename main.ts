import f from"node:fs";
const{MAKEFUN_INPUT_DIR:I="/input",MAKEFUN_OUTPUT_DIR:O="/output"}=process.env;
let W,D,G;
function S(v,b,F,c){
let V={},E={},Q=[[b.sort(),c,""]],h=0;
while(h<Q.length){
let[B,x,m]=Q[h++];
if(h>3e5)return 0;
if(B+""==v)return[m,x,B];
let R={[x]:-1},q=[x],L=x;
for(let a of q)for(let k in D){let n=a+D[k];if(G[n]!="#"&&!B.includes(n)&&!F.includes(n)&&!R[n]){R[n]=a;q.push(n);if(n<L)L=n}}
if(E[B+","+L])continue;E[B+","+L]=1;
for(let z of B)for(let k in D){
let u=z-D[k],t=z+D[k];
if(!R[u]||G[t]=="#"||B.includes(t)||F.includes(t))continue;
let n=B.map(w=>w-z?w:t).sort(),w2="";
for(let j=u;j!=x;j=R[j])w2="rldu"[D.indexOf(j-R[j])]+w2;
if(!V[n+","+z])V[n+","+z]=Q.push([n,z,m+w2+"rldu"[k]]);
}
}
return 0}
function L(T){
W=T.indexOf("\n");D=[1,-1,W,-W];G=T.replace(/\n/g,"");
let R={},A=[],s="",c=G.indexOf("@");
[...G].forEach((C,i)=>{let k=(i%W>6)*2+(i/W>8),r=R[k]=R[k]||[[],[]];if(".*+".includes(C))r[0].push(i);if("$*".includes(C)){r[1].push(i);A.push(i)}});
for(let k in R){
let[g,b]=R[k],F=A.filter(z=>!b.includes(z)),o=S(g.sort()+"",b,F,c);
if(!o)return"";
s+=o[0];c=o[1];A=F.concat(o[2]);
}
return s}
for(let k=1;k<6;k++){
let a="/i00"+k,m="";
try{m=L(f.readFileSync(I+a+"/level.txt")+"")}catch(e){}
f.mkdirSync(O+a,{recursive:true});
f.writeFileSync(O+a+"/solution.txt",m);
}
