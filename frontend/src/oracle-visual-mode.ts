export type OracleVisualMode = 'scanning' | 'up' | 'down' | 'neutral' | 'error';
export interface OracleVisualState { mode: OracleVisualMode; label: 'SCANNING'|'ANALYZING'|'VERIFYING'|'UP'|'DOWN'|'SKIP'|'NEUTRAL'|'ERROR'; direction: 'UP'|'DOWN'|null }
interface VisualReceipt { currentStage?:string;finishedAt?:string;error?:unknown;marketContext?:{asset?:string}|null;llmDecision?:{decision?:string;skipped?:boolean}|null;riskGate?:{outcome?:string}|null;order?:{status?:string}|null }
const ACTIVE_STAGES=new Set(['initializing','price_sample_1','trend_sampling','price_sample_2','eth_price','discovery','contract_context','llm_inference','risk_gate','order_execution']);
export function resolveOracleVisualState(receipt:VisualReceipt,{active=false,selectedAsset='BTC',linkError=false}:{active?:boolean;selectedAsset?:'BTC'|'ETH';linkError?:boolean}={}):OracleVisualState{
  const decisionAsset=(receipt.marketContext?.asset??'BTC').toUpperCase();
  const sameAsset=decisionAsset===selectedAsset;
  const parsed=sameAsset&&(receipt.llmDecision?.decision==='UP'||receipt.llmDecision?.decision==='DOWN')?receipt.llmDecision.decision:null;
  if(parsed)return{mode:parsed.toLowerCase() as 'up'|'down',label:parsed,direction:parsed};
  if(receipt.llmDecision?.decision==='SKIP'||receipt.llmDecision?.skipped||receipt.order?.status==='skipped')return{mode:'neutral',label:'SKIP',direction:null};
  const pipeline=sameAsset?(receipt.riskGate?.outcome==='YES'?'UP':receipt.riskGate?.outcome==='NO'?'DOWN':null):null;
  if(pipeline)return{mode:pipeline.toLowerCase() as 'up'|'down',label:pipeline,direction:pipeline};
  if(receipt.error||linkError)return{mode:'error',label:'ERROR',direction:null};
  if(active||(!receipt.finishedAt&&ACTIVE_STAGES.has(receipt.currentStage??'initializing'))){
    if(receipt.currentStage==='llm_inference')return{mode:'scanning',label:'ANALYZING',direction:null};
    if(receipt.currentStage==='risk_gate'||receipt.currentStage==='order_execution')return{mode:'scanning',label:'VERIFYING',direction:null};
    return{mode:'scanning',label:'SCANNING',direction:null};
  }
  return{mode:'neutral',label:'NEUTRAL',direction:null};
}
