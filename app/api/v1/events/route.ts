import {db} from '@/lib/db';
import {eventInput,ingest} from '@/lib/events';
import {apiError} from '@/lib/access';
export const maxDuration=30;
export async function POST(req:Request){try{const key=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||req.headers.get('x-api-key');if(!key)return Response.json({error:'API key required'},{status:401});const app=await db.application.findUnique({where:{apiKey:key}});if(!app)return Response.json({error:'Invalid API key'},{status:401});const text=await req.text();if(Buffer.byteLength(text)>262144)return Response.json({error:'Payload exceeds 256 KB'},{status:413});return Response.json(await ingest(app.id,eventInput.parse(JSON.parse(text))),{status:202});}catch(e){return apiError(e);}}
