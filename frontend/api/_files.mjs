import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function jsonFile(name,fallback){const paths=[resolve(process.cwd(),'bot',name),resolve(process.cwd(),'..','bot',name),resolve('/var/task/bot',name)];for(const path of paths){try{return JSON.parse(await readFile(path,'utf8'))}catch{}}return fallback}
export function send(res,value,status=200){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value))}
