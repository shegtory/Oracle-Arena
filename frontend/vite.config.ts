import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cycleView from '../api/cycle-view.mjs';
import signal from '../api/signals-latest.mjs';
import performance from '../api/performance.mjs';
function tradeReceiptApi():Plugin{const root=resolve(dirname(fileURLToPath(import.meta.url)),'../bot');const handler=(file:string)=>async(_req:unknown,res:{statusCode:number;setHeader:(k:string,v:string)=>void;end:(body:string)=>void})=>{try{const body=await readFile(resolve(root,file),'utf8');JSON.parse(body);res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(body)}catch(error){res.statusCode=file==='trade-history.json'?200:503;res.setHeader('Content-Type','application/json');res.end(file==='trade-history.json'?'[]':JSON.stringify({error:error instanceof Error?error.message:String(error)}))}};const mount=(server:any)=>{server.middlewares.use('/api/trade-receipt',handler('last-trade-receipt.json'));server.middlewares.use('/api/trade-history',handler('trade-history.json'));server.middlewares.use('/api/signals/latest',signal);server.middlewares.use('/api/performance',performance);server.middlewares.use((req:any,res:any,next:any)=>req.url?.startsWith('/api/cycles/')?cycleView(req,res):next())};return{name:'oracle-arena-receipt-api',configureServer:mount,configurePreviewServer:mount}}
export default defineConfig({plugins:[react(),tradeReceiptApi()]});
