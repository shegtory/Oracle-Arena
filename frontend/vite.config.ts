import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
function tradeReceiptApi():Plugin{const root=resolve(dirname(fileURLToPath(import.meta.url)),'../bot');const handler=(file:string)=>async(_req:unknown,res:{statusCode:number;setHeader:(k:string,v:string)=>void;end:(body:string)=>void})=>{try{const body=await readFile(resolve(root,file),'utf8');JSON.parse(body);res.statusCode=200;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(body)}catch(error){res.statusCode=file==='trade-history.json'?200:503;res.setHeader('Content-Type','application/json');res.end(file==='trade-history.json'?'[]':JSON.stringify({error:error instanceof Error?error.message:String(error)}))}};return{name:'oracle-arena-receipt-api',configureServer(server){server.middlewares.use('/api/trade-receipt',handler('last-trade-receipt.json'));server.middlewares.use('/api/trade-history',handler('trade-history.json'))},configurePreviewServer(server){server.middlewares.use('/api/trade-receipt',handler('last-trade-receipt.json'));server.middlewares.use('/api/trade-history',handler('trade-history.json'))}}}
export default defineConfig({plugins:[react(),tradeReceiptApi()]});
