import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
const project=path.resolve(import.meta.dirname,'..');
const testDeps=process.env.ROADOPS_TEST_DEPENDENCIES??path.join(project,'node_modules');
const req=createRequire(import.meta.url);
const {JSDOM}=req(path.join(testDeps,'jsdom'));
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/rejalashtirish'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','Node','NodeFilter','MutationObserver','getComputedStyle','FormData','localStorage'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const temp=mkdtempSync(path.join(os.tmpdir(),'roadops-funding-ui-'));
try{
 await build({entryPoints:[path.join(project,process.argv[2]??'tests/funding-interaction.tsx')],outfile:path.join(temp,'test.cjs'),bundle:true,platform:'node',format:'cjs',jsx:'automatic',alias:{'@':path.join(project,'src'),'react':path.join(project,'node_modules/react'),'react-dom':path.join(project,'node_modules/react-dom'),'@testing-library/react':path.join(testDeps,'@testing-library/react')},define:{'process.env.NEXT_PUBLIC_E2E_FIXTURES':'"true"','process.env.NODE_ENV':'"test"'},plugins:[{name:'route-context',setup(b){b.onResolve({filter:/components\/auth-provider$/},()=>({path:'auth',namespace:'context'}));b.onResolve({filter:/^next\/(link|navigation|image)$/},a=>({path:a.path,namespace:'context'}));b.onLoad({filter:/.*/,namespace:'context'},a=>({loader:'tsx',contents:a.path==='auth'?`export function useAuth(){return {user:{id:'demo-chief',permissions:['system.all']}}} export function useHasPermission(){return true}`:a.path==='next/link'?`import React from 'react';export default function Link(p){return <a {...p}/>}`:a.path==='next/image'?`import React from 'react';export default function Image({unoptimized,...p}){return <img {...p}/>} `:`export function usePathname(){return window.location.pathname} export function useSearchParams(){return new URLSearchParams(window.location.search)} export function useRouter(){return {push(path){window.history.pushState({},'',path)}}}`}));}}]});
 await req(path.join(temp,'test.cjs')).run();
}finally{dom.window.close();rmSync(temp,{recursive:true,force:true});}
