import {MODEL, measuredMicro} from './protocol';
export interface ApiResult { text:string; model:string; responseId:string; inputTokens:number; outputTokens:number; costMicro:number; status:string; }
export function record(value:unknown): Record<string,unknown> {
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json_object');
  return value as Record<string,unknown>;
}
export function parseResponse(value:unknown):ApiResult {
  const data=record(value),usage=record(data.usage);
  if(typeof usage.input_tokens!=='number'||typeof usage.output_tokens!=='number'||typeof data.id!=='string'||typeof data.model!=='string') throw new Error('missing_api_usage');
  let text='';
  for(const raw of Array.isArray(data.output)?data.output:[]) {
    const item=record(raw);
    if(item.type!=='message') continue;
    for(const part of Array.isArray(item.content)?item.content:[]) {
      const content=record(part);
      if(content.type==='output_text'&&typeof content.text==='string') text+=content.text;
    }
  }
  return {text,model:data.model,responseId:data.id,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,costMicro:measuredMicro(usage.input_tokens,usage.output_tokens),status:typeof data.status==='string'?data.status:'unknown'};
}
export async function boundedJson(response:Response):Promise<unknown> {
  if(!response.body) throw new Error('empty_api_body');
  const reader=response.body.getReader(),decoder=new TextDecoder(); let text='',size=0;
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1_000_000){await reader.cancel();throw new Error('api_response_too_large');}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();return JSON.parse(text);
}
export async function requestModel(key:string,prompt:string,effort:'none'|'high',maxOutput:number):Promise<ApiResult> {
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    body:JSON.stringify({model:MODEL,input:[{role:'user',content:prompt}],reasoning:{effort},max_output_tokens:maxOutput,store:false}),
    signal:AbortSignal.timeout(150_000),
  });
  if(!response.ok) {await response.body?.cancel();throw new Error(`openai_http_${response.status}`);}
  return parseResponse(await boundedJson(response));
}
export function rating(text:string,min:number,max:number):number {
  const d=record(JSON.parse(text));
  if(typeof d.rating!=='number'||!Number.isInteger(d.rating)||d.rating<min||d.rating>max) throw new Error('invalid_grade');
  return d.rating;
}
export function evidence(text:string,reasoning:string) {
  const d=record(JSON.parse(text));
  if(typeof d.supported!=='boolean'||typeof d.quote!=='string'||typeof d.explanation!=='string') throw new Error('invalid_evidence');
  if(d.supported&&(!d.quote.trim()||!reasoning.includes(d.quote))) throw new Error('ungrounded_evidence_quote');
  return {supported:d.supported,quote:d.quote,explanation:d.explanation};
}
