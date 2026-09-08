/** Deterministic digital-contract fair value. This is a small model, not a profit guarantee. */
export interface FairValueInput {
  spot: number; referencePrice: number; secondsLeft: number; volatility: number;
  yesAsk: number; noAsk: number;
}
export interface PriceObservation { usd: number; receivedAt: string }
export interface VolatilityEstimate { volatilityPerSqrtSecond: number; sampleCount: number; returnCount: number; windowSeconds: number; startedAt: string; endedAt: string }
export interface FairValueResult {
  modelProbabilityUp: number; marketProbabilityUp: number; edgeUp: number; edgeDown: number;
  selectedEdge: number; selectedOutcome: 'YES' | 'NO'; modelVersion: 'digital-lognormal-v1';
  modelInputs: FairValueInput;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1; const a = Math.abs(x); const t = 1 / (1 + .3275911 * a);
  return sign * (1 - (((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-a*a));
};
const normalCdf = (x: number) => .5 * (1 + erf(x / Math.SQRT2));

export function estimateRealizedVolatility(observations: readonly PriceObservation[], minimumSamples = 5): VolatilityEstimate | null {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 3) throw new Error('minimum volatility samples must be an integer of at least 3');
  const valid=observations.filter(x=>Number.isFinite(x.usd)&&x.usd>0&&Number.isFinite(Date.parse(x.receivedAt)))
    .sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt))
    .filter((x,i,a)=>i===0||Date.parse(x.receivedAt)>Date.parse(a[i-1].receivedAt));
  if(valid.length<minimumSamples)return null; const returns:number[]=[];
  for(let i=1;i<valid.length;i++){const dt=(Date.parse(valid[i].receivedAt)-Date.parse(valid[i-1].receivedAt))/1000;if(!(dt>0))continue;const r=Math.log(valid[i].usd/valid[i-1].usd)/Math.sqrt(dt);if(Number.isFinite(r))returns.push(r)}
  if(returns.length<minimumSamples-1)return null;const sigma=Math.sqrt(returns.reduce((n,r)=>n+r*r,0)/returns.length);
  if(!Number.isFinite(sigma)||sigma<=0)return null;return{volatilityPerSqrtSecond:sigma,sampleCount:valid.length,returnCount:returns.length,windowSeconds:(Date.parse(valid.at(-1)!.receivedAt)-Date.parse(valid[0].receivedAt))/1000,startedAt:valid[0].receivedAt,endedAt:valid.at(-1)!.receivedAt};
}

export function fairValue(input: FairValueInput, selectedOutcome: 'YES' | 'NO'): FairValueResult {
  for (const [name, value] of Object.entries(input)) if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  if (!(input.spot > 0) || !(input.referencePrice > 0)) throw new Error('spot and reference price must be positive');
  if (!(input.secondsLeft > 0)) throw new Error('time remaining must be positive');
  if (!(input.volatility > 0)) throw new Error('volatility must be positive');
  if (!(input.yesAsk > 0 && input.yesAsk < 1 && input.noAsk > 0 && input.noAsk < 1)) throw new Error('market asks must be inside (0, 1)');
  const z = Math.log(input.spot / input.referencePrice) / (input.volatility * Math.sqrt(input.secondsLeft));
  const modelProbabilityUp = clamp(normalCdf(z));
  const marketProbabilityUp = clamp(input.yesAsk / (input.yesAsk + input.noAsk));
  const edgeUp = modelProbabilityUp - input.yesAsk;
  const edgeDown = (1 - modelProbabilityUp) - input.noAsk;
  return { modelProbabilityUp, marketProbabilityUp, edgeUp, edgeDown,
    selectedEdge: selectedOutcome === 'YES' ? edgeUp : edgeDown, selectedOutcome,
    modelVersion: 'digital-lognormal-v1', modelInputs: { ...input } };
}
