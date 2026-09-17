export type WritingScript = 'latn'|'cyrl';
export function currentScript():WritingScript {try{return typeof localStorage!=='undefined'&&localStorage.getItem('roadops-script')==='cyrl'?'cyrl':'latn';}catch{return 'latn';}}
const cyr:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'j',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'x',ц:'ts',ч:'ch',ш:'sh',щ:'sh',ъ:'’',ы:'i',ь:'',э:'e',ю:'yu',я:'ya',ў:'o‘',қ:'q',ғ:'g‘',ҳ:'h'};
const lat:Record<string,string>={a:'а',b:'б',d:'д',e:'е',f:'ф',g:'г',h:'ҳ',i:'и',j:'ж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'қ',r:'р',s:'с',t:'т',u:'у',v:'в',x:'х',y:'й',z:'з',sh:'ш',ch:'ч',yo:'ё',yu:'ю',ya:'я',ye:'е',"o‘":'ў',"g‘":'ғ'};
const caseLike=(from:string,to:string)=>from===from.toUpperCase()?to.toUpperCase():from[0]===from[0]?.toUpperCase()?to[0]?.toUpperCase()+to.slice(1):to;
/** Display only. Identifiers, URLs, numbers and catalog codes remain stable. */
export function scriptText(text:string,script:WritingScript):string {
 text=text.replace(/мехнат/gi,x=>caseLike(x,'меҳнат')).replace(/улчов/gi,x=>caseLike(x,'ўлчов'));
 const protectedParts: string[]=[];
 const protect=text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b(?:IQN|RAMS|AI|RoadOps|Roadvision|RoadVision|Excel|API|JSON|DEMO)\b|\b(?:Ia|Ib|I|II|III|IV|V|VI|VII|VIII|IX|X)\b|\b[A-Za-z][\w-]*\d[\w:./+-]*\b/g,x=>{protectedParts.push(x);return `\uE000${protectedParts.length-1}\uE001`;});
 let value=script==='latn'?protect.replace(/[а-яёўқғҳъьы]/gi,(x,offset,all)=>{const base=cyr[x.toLowerCase()]??x;return caseLike(x,x.toLowerCase()==='е'&&(offset===0||/[\s(]/.test(all[offset-1]))?'ye':base);}):protect.replace(/[og][‘’ʻʼ']/gi,x=>x[0]+'‘').replace(/o‘|g‘|sh|ch|yo(?!‘)|yu|ya|ye|[a-z]/gi,(x,offset,all)=>caseLike(x,x.toLowerCase()==='e'&&(offset===0||/[\s(]/.test(all[offset-1]))?'э':lat[x.toLowerCase()]??x));
 if(script==='cyrl')value=value.replace(/([а-яёўқғҳ])[’'](?=[а-яёўқғҳ])/gi,'$1ъ');
 return value.replace(/\uE000(\d+)\uE001/g,(_,n)=>protectedParts[Number(n)]!);
}
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const encode=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/** Translate only visible XML strings and known sheet references; never whole XML. */
export function localizeWorkbookFiles(files:Record<string,string>,script:WritingScript):Record<string,string>{
 const names=[...(files['xl/workbook.xml']??'').matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"/g)].map(m=>decode(m[1]!));
 const translated=new Map(names.map(n=>[n,scriptText(n,script)]));
 const formula=(raw:string)=>{let f=decode(raw);for(const [a,b] of translated)f=f.replaceAll(`'${a.replaceAll("'","''")}'!`,`'${b.replaceAll("'","''")}'!`);return encode(f.replace(/"((?:[^"]|"")*)"/g,(_,literal)=>`"${scriptText(literal,script)}"`));};
 return Object.fromEntries(Object.entries(files).map(([path,xml])=>[path,xml
  .replace(/(<(?:\w+:)?t(?:\s[^>]*)?>)([\s\S]*?)(<\/(?:\w+:)?t>)/g,(_,a,v,b)=>a+encode(scriptText(decode(v),script))+b)
  .replace(/(<(?:\w+:)?f(?:\s[^>]*)?>)([\s\S]*?)(<\/(?:\w+:)?f>)/g,(_,a,v,b)=>a+formula(v)+b)
  .replace(/(<(?:\w+:)?definedName\b[^>]*>)([\s\S]*?)(<\/(?:\w+:)?definedName>)/g,(_,a,v,b)=>a+formula(v)+b)
  .replace(/(<(?:\w+:)?sheet\b[^>]*\bname=")([^"]+)(")/g,(_,a,v,b)=>a+encode(translated.get(decode(v))??decode(v))+b)
  .replace(/(<(?:\w+:)?c\b[^>]*\bt="str"[^>]*>[\s\S]*?<(?:\w+:)?v>)([^<]*)(<\/(?:\w+:)?v>)/g,(_,a,v,b)=>a+encode(scriptText(decode(v),script))+b)
 ]));
}

export function scriptFilename(name:string,script:WritingScript){const i=name.lastIndexOf('.');const stem=i<0?name:name.slice(0,i),extension=i<0?'':name.slice(i);return stem.split('-').map(part=>scriptText(part,script)).join('-')+extension;}
