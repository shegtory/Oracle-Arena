import{jsonFile,send}from'./_files.mjs';export default async function handler(_req,res){send(res,await jsonFile('trade-history.json',[]))}
